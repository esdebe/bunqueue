/**
 * Bunqueue - Simplified all-in-one Queue + Worker
 *
 * @example
 * ```typescript
 * import { Bunqueue } from 'bunqueue/client';
 *
 * // Simple processor
 * const q = new Bunqueue<{ email: string }>('emails', {
 *   processor: async (job) => {
 *     await job.updateProgress(50);
 *     return { sent: true };
 *   },
 *   concurrency: 5,
 * });
 *
 * // Job routing
 * const q2 = new Bunqueue('notifications', {
 *   routes: {
 *     'send-email': async (job) => { ... },
 *     'send-sms': async (job) => { ... },
 *   },
 * });
 *
 * // Middleware
 * q.use(async (job, next) => {
 *   const start = Date.now();
 *   const result = await next();
 *   console.log(`Done in ${Date.now() - start}ms`);
 *   return result;
 * });
 *
 * // Cron
 * q.cron('daily-report', '0 9 * * *', { type: 'summary' });
 * ```
 */

import { Queue } from './queue/queue';
import { Worker } from './worker/worker';
import type {
  Job,
  JobOptions,
  QueueOptions,
  WorkerOptions,
  Processor,
  ConnectionOptions,
  FlowJobData,
} from './types';
import type { RepeatOpts, JobTemplate, SchedulerInfo } from './queue/scheduler';

/** Middleware function: receives job and next(), returns result */
export type BunqueueMiddleware<T = unknown, R = unknown> = (
  job: Job<T>,
  next: () => Promise<R>
) => Promise<R>;

export interface BunqueueOptions<T = unknown, R = unknown> {
  /** Job processor function (use this OR routes, not both) */
  processor?: Processor<T, R>;
  /** Named job processors — routes jobs by name to the right handler */
  routes?: Record<string, Processor<T, R>>;
  /** Worker concurrency (default: 1) */
  concurrency?: number;
  /** Connection options for TCP mode */
  connection?: ConnectionOptions;
  /** Use embedded mode (default: auto-detect) */
  embedded?: boolean;
  /** SQLite data path (embedded mode) */
  dataPath?: string;
  /** Default job options */
  defaultJobOptions?: JobOptions;
  /** Worker auto-start (default: true) */
  autorun?: boolean;
  /** Heartbeat interval in ms (default: 10000, 0=disabled) */
  heartbeatInterval?: number;
  /** Worker batch size (default: 10) */
  batchSize?: number;
  /** Long poll timeout in ms (default: 0) */
  pollTimeout?: number;
  /** Auto-batching options (TCP mode) */
  autoBatch?: QueueOptions['autoBatch'];
  /** Rate limiter options */
  limiter?: WorkerOptions['limiter'];
  /** Remove job on complete */
  removeOnComplete?: WorkerOptions['removeOnComplete'];
  /** Remove job on fail */
  removeOnFail?: WorkerOptions['removeOnFail'];
}

export class Bunqueue<T = unknown, R = unknown> {
  readonly name: string;
  readonly queue: Queue<T>;
  readonly worker: Worker<T, R>;
  private readonly middlewares: BunqueueMiddleware<T, R>[] = [];
  private readonly baseProcessor: Processor<T, R>;

  constructor(name: string, opts: BunqueueOptions<T, R>) {
    if (!opts.processor && !opts.routes) {
      throw new Error('Bunqueue requires either "processor" or "routes"');
    }
    if (opts.processor && opts.routes) {
      throw new Error('Bunqueue: use "processor" or "routes", not both');
    }

    this.name = name;

    // Build base processor from routes or single processor
    if (opts.routes) {
      const routeMap: Partial<Record<string, Processor<T, R>>> = opts.routes;
      this.baseProcessor = ((job: Job<T & FlowJobData>): Promise<R> | R => {
        const handler = routeMap[job.name];
        if (!handler) {
          throw new Error(`No route for job "${job.name}" in queue "${name}"`);
        }
        return handler(job);
      }) as Processor<T, R>;
    } else if (opts.processor) {
      this.baseProcessor = opts.processor;
    } else {
      // Should never reach here due to validation above
      throw new Error('Bunqueue requires either "processor" or "routes"');
    }

    // Wrapped processor that applies middleware chain
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const wrappedProcessor: Processor<T, R> = ((job: Job<T & FlowJobData>) =>
      self.executeWithMiddleware(job)) as Processor<T, R>;

    const queueOpts: QueueOptions = {
      connection: opts.connection,
      embedded: opts.embedded,
      dataPath: opts.dataPath,
      defaultJobOptions: opts.defaultJobOptions,
      autoBatch: opts.autoBatch,
    };

    const workerOpts: WorkerOptions = {
      connection: opts.connection,
      embedded: opts.embedded,
      dataPath: opts.dataPath,
      concurrency: opts.concurrency,
      autorun: opts.autorun,
      heartbeatInterval: opts.heartbeatInterval,
      batchSize: opts.batchSize,
      pollTimeout: opts.pollTimeout,
      limiter: opts.limiter,
      removeOnComplete: opts.removeOnComplete,
      removeOnFail: opts.removeOnFail,
    };

    this.queue = new Queue<T>(name, queueOpts);
    this.worker = new Worker<T, R>(name, wrappedProcessor, workerOpts);
  }

  // ============ Middleware ============

  /** Add middleware to the processing pipeline */
  use(middleware: BunqueueMiddleware<T, R>): this {
    this.middlewares.push(middleware);
    return this;
  }

  private executeWithMiddleware(job: Job<T & FlowJobData>): Promise<R> {
    const asJob = job as unknown as Job<T>;
    if (this.middlewares.length === 0) {
      const result = this.baseProcessor(job);
      return result instanceof Promise ? result : Promise.resolve(result);
    }

    let index = 0;
    const middlewares = this.middlewares;
    const baseProcessor = this.baseProcessor;

    const next = (): Promise<R> => {
      if (index < middlewares.length) {
        const mw = middlewares[index++];
        return mw(asJob, next);
      }
      const result = baseProcessor(job);
      return result instanceof Promise ? result : Promise.resolve(result);
    };

    return next();
  }

  // ============ Queue Operations ============

  add(name: string, data: T, opts?: JobOptions): Promise<Job<T>> {
    return this.queue.add(name, data, opts);
  }

  addBulk(jobs: Array<{ name: string; data: T; opts?: JobOptions }>): Promise<Job<T>[]> {
    return this.queue.addBulk(jobs);
  }

  getJob(id: string): Promise<Job<T> | null> {
    return this.queue.getJob(id);
  }

  getJobCounts() {
    return this.queue.getJobCounts();
  }

  getJobCountsAsync() {
    return this.queue.getJobCountsAsync();
  }

  count() {
    return this.queue.count();
  }

  countAsync() {
    return this.queue.countAsync();
  }

  // ============ Cron ============

  /** Add a cron job */
  cron(
    schedulerId: string,
    pattern: string,
    data?: T,
    opts?: { timezone?: string; jobOpts?: JobOptions }
  ): Promise<SchedulerInfo | null> {
    const repeatOpts: RepeatOpts = { pattern, timezone: opts?.timezone };
    const jobTemplate: JobTemplate<T> = {
      name: schedulerId,
      data,
      opts: opts?.jobOpts,
    };
    return this.queue.upsertJobScheduler(schedulerId, repeatOpts, jobTemplate);
  }

  /** Add a repeating job (every N ms) */
  every(
    schedulerId: string,
    intervalMs: number,
    data?: T,
    opts?: { jobOpts?: JobOptions }
  ): Promise<SchedulerInfo | null> {
    const repeatOpts: RepeatOpts = { every: intervalMs };
    const jobTemplate: JobTemplate<T> = {
      name: schedulerId,
      data,
      opts: opts?.jobOpts,
    };
    return this.queue.upsertJobScheduler(schedulerId, repeatOpts, jobTemplate);
  }

  /** Remove a cron/repeating job */
  removeCron(schedulerId: string) {
    return this.queue.removeJobScheduler(schedulerId);
  }

  /** List all cron/repeating jobs */
  listCrons() {
    return this.queue.getJobSchedulers();
  }

  // ============ Worker Events ============

  on(event: 'ready' | 'drained' | 'closed', listener: () => void): this;
  on(event: 'active', listener: (job: Job<T>) => void): this;
  on(event: 'completed', listener: (job: Job<T>, result: R) => void): this;
  on(event: 'failed', listener: (job: Job<T>, error: Error) => void): this;
  on(event: 'progress', listener: (job: Job<T> | null, progress: number) => void): this;
  on(event: 'stalled', listener: (jobId: string, reason: string) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: any, listener: (...args: any[]) => void): this {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    this.worker.on(event, listener);
    return this;
  }

  once(event: 'ready' | 'drained' | 'closed', listener: () => void): this;
  once(event: 'active', listener: (job: Job<T>) => void): this;
  once(event: 'completed', listener: (job: Job<T>, result: R) => void): this;
  once(event: 'failed', listener: (job: Job<T>, error: Error) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  once(event: any, listener: (...args: any[]) => void): this {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    this.worker.once(event, listener);
    return this;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off(event: any, listener: (...args: any[]) => void): this {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    this.worker.off(event, listener);
    return this;
  }

  // ============ Control ============

  pause(): void {
    this.queue.pause();
    this.worker.pause();
  }

  resume(): void {
    this.queue.resume();
    this.worker.resume();
  }

  async close(force = false): Promise<void> {
    await this.worker.close(force);
    this.queue.close();
  }

  isRunning(): boolean {
    return this.worker.isRunning();
  }

  isPaused(): boolean {
    return this.worker.isPaused();
  }

  isClosed(): boolean {
    return this.worker.isClosed();
  }
}
