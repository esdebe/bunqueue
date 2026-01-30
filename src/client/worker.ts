/**
 * Worker - BullMQ-style API
 * Default: TCP connection to localhost:6789
 * Optional: embedded mode with { embedded: true }
 *
 * Performance optimizations:
 * - Batch pull: fetches multiple jobs per round-trip (batchSize option)
 * - Batch ACK with results: acknowledges multiple jobs per round-trip
 * - Connection pooling: optional pool for high-concurrency scenarios
 * - Long polling: reduces round-trips when queue is empty
 * - TCP heartbeats: keeps jobs alive for stall detection
 */

import { EventEmitter } from 'events';
import { getSharedManager } from './manager';
// TCP connection pool is always used in TCP mode
import { TcpConnectionPool } from './tcpPool';
import type { WorkerOptions, Processor, ConnectionOptions } from './types';
import { createPublicJob } from './types';
import type { Job as InternalJob } from '../domain/types/job';
import { jobId } from '../domain/types/job';

/** Pending ACK item with result */
interface PendingAck {
  id: string;
  result: unknown;
  resolve: () => void;
  reject: (err: Error) => void;
}

/** Extended options with all defaults */
interface ExtendedWorkerOptions extends Required<Omit<WorkerOptions, 'connection' | 'embedded'>> {
  connection?: ConnectionOptions;
  embedded: boolean;
}

/** Check if embedded mode should be forced (for tests) */
const FORCE_EMBEDDED = process.env.BUNQUEUE_EMBEDDED === '1';

/** TCP connection interface (shared between TcpClient and TcpConnectionPool) */
interface TcpConnection {
  send: (cmd: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

/**
 * Worker class for processing jobs
 * Default: connects to bunqueue server via TCP
 * Use { embedded: true } for in-process mode
 * Set BUNQUEUE_EMBEDDED=1 env var to force embedded mode
 */
export class Worker<T = unknown, R = unknown> extends EventEmitter {
  readonly name: string;
  private readonly opts: ExtendedWorkerOptions;
  private readonly processor: Processor<T, R>;
  private readonly embedded: boolean;
  private readonly tcp: TcpConnection | null;
  private readonly tcpPool: TcpConnectionPool | null;
  private running = false;
  private activeJobs = 0;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly activeJobIds: Set<string> = new Set(); // Track active job IDs for heartbeat
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private consecutiveErrors = 0;
  private readonly pendingJobs: InternalJob[] = []; // Buffer for batch-pulled jobs

  // Batch ACK state
  private readonly pendingAcks: PendingAck[] = [];
  private ackTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly ackBatchSize: number;
  private readonly ackInterval: number;

  private static readonly MAX_BACKOFF_MS = 30_000;
  private static readonly BASE_BACKOFF_MS = 100;
  private static readonly MAX_POLL_TIMEOUT = 30_000;

  constructor(name: string, processor: Processor<T, R>, opts: WorkerOptions = {}) {
    super();
    this.name = name;
    this.processor = processor;
    this.embedded = opts.embedded ?? FORCE_EMBEDDED;
    const concurrency = opts.concurrency ?? 1;
    this.opts = {
      concurrency,
      autorun: opts.autorun ?? true,
      heartbeatInterval: opts.heartbeatInterval ?? 10000,
      batchSize: Math.min(opts.batchSize ?? 10, 1000), // Default 10, max 1000
      pollTimeout: Math.min(opts.pollTimeout ?? 0, Worker.MAX_POLL_TIMEOUT), // Default 0, max 30s
      embedded: this.embedded,
    };

    // Batch ACK settings
    this.ackBatchSize = opts.batchSize ?? 10; // ACK when this many complete
    this.ackInterval = 50; // Or after 50ms, whichever comes first

    if (this.embedded) {
      this.tcp = null;
      this.tcpPool = null;
    } else {
      const connOpts: ConnectionOptions = opts.connection ?? {};
      // Always use pool - default poolSize = min(concurrency, 8), user can override
      const poolSize = connOpts.poolSize ?? Math.min(concurrency, 8);

      // Use connection pool (always enabled for TCP mode)
      this.tcpPool = new TcpConnectionPool({
        host: connOpts.host ?? 'localhost',
        port: connOpts.port ?? 6789,
        token: connOpts.token,
        poolSize,
      });
      this.tcp = this.tcpPool;
    }

    if (this.opts.autorun) {
      this.run();
    }
  }

  /** Start processing */
  run(): void {
    if (this.running) return;
    this.running = true;
    this.emit('ready');

    // Start global heartbeat timer for TCP mode
    if (!this.embedded && this.opts.heartbeatInterval > 0) {
      this.startGlobalHeartbeat();
    }

    this.poll();
  }

  /** Pause processing */
  pause(): void {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Resume processing */
  resume(): void {
    this.run();
  }

  /** Close worker gracefully */
  async close(force = false): Promise<void> {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    // Stop global heartbeat timer
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Flush pending ACKs
    await this.flushAcks();

    // Stop ACK timer
    if (this.ackTimer) {
      clearTimeout(this.ackTimer);
      this.ackTimer = null;
    }

    if (!force) {
      while (this.activeJobs > 0) {
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    // Close pool if using pooled connections (not shared)
    if (this.tcpPool) {
      this.tcpPool.close();
    }

    this.emit('closed');
  }

  /** Start global heartbeat timer for all active jobs (TCP mode) */
  private startGlobalHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      void this.sendBatchHeartbeat();
    }, this.opts.heartbeatInterval);
  }

  /** Send batch heartbeat for all active jobs */
  private async sendBatchHeartbeat(): Promise<void> {
    if (this.activeJobIds.size === 0 || !this.tcp) return;

    try {
      const ids = Array.from(this.activeJobIds);
      if (ids.length === 1) {
        await this.tcp.send({ cmd: 'JobHeartbeat', id: ids[0] });
      } else {
        await this.tcp.send({ cmd: 'JobHeartbeatB', ids });
      }
    } catch (err) {
      // Heartbeat errors are non-fatal, just emit for logging
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit('error', Object.assign(error, { context: 'heartbeat' }));
    }
  }

  private poll(): void {
    if (!this.running) return;

    if (this.activeJobs >= this.opts.concurrency) {
      this.pollTimer = setTimeout(() => {
        this.poll();
      }, 10);
      return;
    }

    void this.tryProcess();
  }

  private async tryProcess(): Promise<void> {
    if (!this.running) return;

    try {
      // Get job from pending buffer or fetch new batch
      let job: InternalJob | null = this.pendingJobs.shift() ?? null;

      if (!job) {
        // Fetch new batch - calculate how many we can process
        const availableSlots = this.opts.concurrency - this.activeJobs;
        const batchSize = Math.min(this.opts.batchSize, availableSlots, 1000);

        if (batchSize > 0) {
          const jobs = this.embedded
            ? await this.pullBatchEmbedded(batchSize)
            : await this.pullBatchTcp(batchSize);

          // Take first job, buffer the rest
          const firstJob = jobs.shift();
          if (firstJob) {
            job = firstJob;
            this.pendingJobs.push(...jobs);
          }
        }
      }

      if (job) {
        // Reset error count only when we successfully got a job
        this.consecutiveErrors = 0;
        this.activeJobs++;
        const jobIdStr = String(job.id);
        this.activeJobIds.add(jobIdStr);

        void this.processJob(job).finally(() => {
          this.activeJobs--;
          this.activeJobIds.delete(jobIdStr);
          if (this.running) this.poll();
        });

        // Process more jobs from buffer if available
        if (this.activeJobs < this.opts.concurrency && this.pendingJobs.length > 0) {
          setImmediate(() => {
            void this.tryProcess();
          });
        } else if (this.activeJobs < this.opts.concurrency) {
          // No buffered jobs, schedule another fetch
          setImmediate(() => {
            void this.tryProcess();
          });
        }
      } else {
        // No jobs available, wait before polling again
        // Use longer wait if long polling is enabled and server didn't block
        const waitTime = this.opts.pollTimeout > 0 ? 10 : 50;
        this.pollTimer = setTimeout(() => {
          this.poll();
        }, waitTime);
      }
    } catch (err) {
      this.consecutiveErrors++;

      // Emit error with context
      const error = err instanceof Error ? err : new Error(String(err));
      const wrappedError = Object.assign(error, {
        queue: this.name,
        consecutiveErrors: this.consecutiveErrors,
        context: 'pull',
      });
      this.emit('error', wrappedError);

      // Exponential backoff: 100ms, 200ms, 400ms, ... up to 30s
      const backoffMs = Math.min(
        Worker.BASE_BACKOFF_MS * Math.pow(2, this.consecutiveErrors - 1),
        Worker.MAX_BACKOFF_MS
      );

      this.pollTimer = setTimeout(() => {
        this.poll();
      }, backoffMs);
    }
  }

  /** Pull batch (embedded) */
  private async pullBatchEmbedded(count: number): Promise<InternalJob[]> {
    const manager = getSharedManager();
    if (count === 1) {
      const job = await manager.pull(this.name, 0);
      return job ? [job] : [];
    }
    return manager.pullBatch(this.name, count, 0);
  }

  /** Pull batch of jobs via TCP with optional long polling */
  private async pullBatchTcp(count: number): Promise<InternalJob[]> {
    if (!this.tcp) return [];
    const response = await this.tcp.send({
      cmd: count === 1 ? 'PULL' : 'PULLB',
      queue: this.name,
      timeout: this.opts.pollTimeout, // Long polling support
      count, // For PULLB
    });

    if (!response.ok) return [];

    // Handle single job response (PULL)
    if (count === 1 && response.job) {
      return [this.parseJob(response.job as Record<string, unknown>)];
    }

    // Handle batch response (PULLB)
    const jobs = response.jobs as Array<Record<string, unknown>> | undefined;
    if (!jobs || jobs.length === 0) return [];

    return jobs.map((j) => this.parseJob(j));
  }

  /** Parse job from TCP response */
  private parseJob(jobData: Record<string, unknown>): InternalJob {
    const priority = jobData.priority as number | undefined;
    const createdAt = jobData.createdAt as number | undefined;
    const runAt = jobData.runAt as number | undefined;
    const attempts = jobData.attempts as number | undefined;
    const maxAttempts = jobData.maxAttempts as number | undefined;
    const backoff = jobData.backoff as number | undefined;
    const ttl = jobData.ttl as number | undefined;
    const timeout = jobData.timeout as number | undefined;
    const uniqueKey = jobData.uniqueKey as string | undefined;
    const customId = jobData.customId as string | undefined;
    const progress = jobData.progress as number | undefined;
    const progressMessage = jobData.progressMessage as string | undefined;
    const removeOnComplete = jobData.removeOnComplete as boolean | undefined;

    return {
      id: jobId(jobData.id as string),
      queue: this.name,
      data: jobData.data,
      priority: priority ?? 0,
      createdAt: createdAt ?? Date.now(),
      runAt: runAt ?? Date.now(),
      startedAt: Date.now(),
      completedAt: null,
      attempts: attempts ?? 0,
      maxAttempts: maxAttempts ?? 3,
      backoff: backoff ?? 1000,
      ttl: ttl ?? null,
      timeout: timeout ?? null,
      uniqueKey: uniqueKey ?? null,
      customId: customId ?? null,
      progress: progress ?? 0,
      progressMessage: progressMessage ?? null,
      dependsOn: [],
      parentId: null,
      childrenIds: [],
      childrenCompleted: 0,
      tags: [],
      groupId: null,
      lifo: false,
      removeOnComplete: removeOnComplete ?? false,
      removeOnFail: false,
      stallCount: 0,
      stallTimeout: null,
      lastHeartbeat: Date.now(),
      repeat: null,
    } as InternalJob;
  }

  /** Queue ACK for batch processing with result */
  private queueAck(id: string, result: unknown): void {
    this.pendingAcks.push({
      id,
      result,
      resolve: () => {},
      reject: () => {},
    });

    // Flush if batch is full
    if (this.pendingAcks.length >= this.ackBatchSize) {
      void this.flushAcks();
    } else {
      // Start timer for partial batch (if not already running)
      this.ackTimer ??= setTimeout(() => {
        this.ackTimer = null;
        void this.flushAcks();
      }, this.ackInterval);
    }
  }

  /** Flush pending ACKs in batch with results */
  private async flushAcks(): Promise<void> {
    if (this.pendingAcks.length === 0) return;

    const batch = this.pendingAcks.splice(0, this.pendingAcks.length);

    if (this.ackTimer) {
      clearTimeout(this.ackTimer);
      this.ackTimer = null;
    }

    try {
      if (this.embedded) {
        // Embedded: batch ack with results
        const manager = getSharedManager();
        const items = batch.map((a) => ({ id: jobId(a.id), result: a.result }));
        await manager.ackBatchWithResults(items);
      } else if (this.tcp) {
        // TCP: use ACKB command with results
        const response = await this.tcp.send({
          cmd: 'ACKB',
          ids: batch.map((a) => a.id),
          results: batch.map((a) => a.result), // Include results
        });

        if (!response.ok) {
          const errMsg = response.error as string | undefined;
          throw new Error(errMsg ?? 'Batch ACK failed');
        }
      }

      // Resolve all promises
      for (const ack of batch) {
        ack.resolve();
      }
    } catch (err) {
      // Reject all promises
      const error = err instanceof Error ? err : new Error(String(err));
      for (const ack of batch) {
        ack.reject(error);
      }
    }
  }

  private async processJob(internalJob: InternalJob): Promise<void> {
    const jobData = internalJob.data as { name?: string } | null;
    const name = jobData?.name ?? 'default';
    const jobIdStr = String(internalJob.id);

    // Create job with progress and log methods
    const job = createPublicJob<T>(
      internalJob,
      name,
      async (id, progress, message) => {
        if (this.embedded) {
          const manager = getSharedManager();
          await manager.updateProgress(jobId(id), progress, message);
        } else if (this.tcp) {
          await this.tcp.send({
            cmd: 'Progress',
            id,
            progress,
            message,
          });
        }
        this.emit('progress', job, progress);
      },
      async (id, message) => {
        if (this.embedded) {
          const manager = getSharedManager();
          manager.addLog(jobId(id), message);
        } else if (this.tcp) {
          await this.tcp.send({
            cmd: 'AddLog',
            id,
            message,
          });
        }
      }
    );

    this.emit('active', job);

    try {
      const result = await this.processor(job);

      // Use batch ACK for both modes
      if (this.embedded) {
        const manager = getSharedManager();
        await manager.ack(internalJob.id, result);
      } else {
        // Queue for batch ACK with result
        this.queueAck(jobIdStr, result);
      }

      (job as { returnvalue?: unknown }).returnvalue = result;
      this.emit('completed', job, result);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      // Try to fail the job (not batched - failures are less common)
      try {
        if (this.embedded) {
          const manager = getSharedManager();
          await manager.fail(internalJob.id, err.message);
        } else if (this.tcp) {
          await this.tcp.send({
            cmd: 'FAIL',
            id: internalJob.id,
            error: err.message,
          });
        }
      } catch (failError) {
        const wrappedError = failError instanceof Error ? failError : new Error(String(failError));
        this.emit('error', Object.assign(wrappedError, { context: 'fail', jobId: jobIdStr }));
      }

      (job as { failedReason?: string }).failedReason = err.message;
      this.emit('failed', job, err);
    }
  }
}
