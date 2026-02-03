/**
 * Sandboxed Worker
 * Runs job processors in isolated Bun Worker processes
 */

import { getSharedManager, type SharedManager } from '../manager';
import type { Job as DomainJob } from '../../domain/types/job';
import type {
  SandboxedWorkerOptions,
  RequiredSandboxedWorkerOptions,
  WorkerProcess,
  IPCRequest,
  IPCResponse,
} from './types';
import { createWrapperScript, cleanupWrapperScript } from './wrapper';

const LOG_PREFIX = '[SandboxedWorker]';

/** Structured log helper */
function log(
  level: 'info' | 'warn' | 'error',
  message: string,
  data?: Record<string, unknown>
): void {
  const entry = data ? { message, ...data } : message;
  switch (level) {
    case 'info':
      console.log(LOG_PREFIX, entry);
      break;
    case 'warn':
      console.warn(LOG_PREFIX, entry);
      break;
    case 'error':
      console.error(LOG_PREFIX, entry);
      break;
  }
}

/**
 * Sandboxed Worker - runs processors in isolated Bun Worker processes
 */
export class SandboxedWorker {
  private readonly queueName: string;
  private readonly options: RequiredSandboxedWorkerOptions;
  private readonly workers: WorkerProcess[] = [];
  private running = false;
  private pullPromise: Promise<void> | null = null;
  private wrapperPath: string | null = null;
  private readonly manager: SharedManager;
  private readonly workerId: string;

  constructor(queueName: string, options: SandboxedWorkerOptions) {
    this.queueName = queueName;
    this.manager = options.manager ?? getSharedManager();
    this.workerId = `sandboxed-worker-${queueName}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    this.options = {
      processor: options.processor,
      concurrency: options.concurrency ?? 1,
      maxMemory: options.maxMemory ?? 256,
      timeout: options.timeout ?? 30000,
      autoRestart: options.autoRestart ?? true,
      maxRestarts: options.maxRestarts ?? 10,
      pollInterval: options.pollInterval ?? 10,
    };
  }

  /** Start the sandboxed worker pool */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.wrapperPath = await createWrapperScript(this.queueName, this.options.processor);

    // Spawn all workers and wait for them to be ready
    const spawnPromises: Promise<void>[] = [];
    for (let i = 0; i < this.options.concurrency; i++) {
      spawnPromises.push(this.spawnWorker(i));
    }
    await Promise.all(spawnPromises);

    this.pullPromise = this.pullLoop();
  }

  /** Stop all workers gracefully */
  async stop(): Promise<void> {
    this.running = false;

    for (const wp of this.workers) {
      if (wp.timeoutId) clearTimeout(wp.timeoutId);
      wp.worker.terminate();
    }
    this.workers.length = 0;

    if (this.pullPromise) await this.pullPromise;
    await cleanupWrapperScript(this.wrapperPath);
  }

  /** Get worker pool stats */
  getStats(): { total: number; busy: number; idle: number; restarts: number } {
    const busy = this.workers.filter((w) => w.busy).length;
    const restarts = this.workers.reduce((sum, w) => sum + w.restarts, 0);
    return { total: this.workers.length, busy, idle: this.workers.length - busy, restarts };
  }

  /** Reset worker state to idle */
  private resetWorkerState(wp: WorkerProcess): void {
    if (wp.timeoutId) {
      clearTimeout(wp.timeoutId);
      wp.timeoutId = null;
    }
    wp.busy = false;
    wp.currentJob = null;
    wp.currentToken = null;
  }

  private spawnWorker(index: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.wrapperPath) {
        resolve();
        return;
      }

      const worker = new Worker(this.wrapperPath, { smol: this.options.maxMemory <= 64 });
      const wp: WorkerProcess = {
        worker,
        busy: false,
        currentJob: null,
        currentToken: null,
        restarts: this.workers[index]?.restarts ?? 0,
        timeoutId: null,
      };

      let resolved = false;
      const readyTimeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          log('warn', 'Worker ready timeout, continuing anyway', { workerIndex: index });
          resolve();
        }
      }, 5000);

      worker.onmessage = (event: MessageEvent<IPCResponse>) => {
        if (event.data.type === 'ready' && !resolved) {
          resolved = true;
          clearTimeout(readyTimeout);
          resolve();
          return;
        }
        this.handleMessage(wp, event.data);
      };

      worker.onerror = (error) => {
        log('error', 'Worker error', { workerIndex: index, error: error.message });
        if (!resolved) {
          resolved = true;
          clearTimeout(readyTimeout);
          reject(new Error(error.message));
        }
        this.handleCrash(wp, index);
      };

      if (this.workers[index]) this.workers[index] = wp;
      else this.workers.push(wp);
    });
  }

  private async pullLoop(): Promise<void> {
    while (this.running) {
      const idle = this.workers.find((w) => !w.busy);
      if (!idle) {
        await Bun.sleep(this.options.pollInterval);
        continue;
      }

      const { job, token } = await this.manager.pullWithLock(this.queueName, this.workerId, 1000);
      if (job) this.dispatch(idle, job, token);
    }
  }

  private dispatch(wp: WorkerProcess, job: DomainJob, token: string | null): void {
    wp.busy = true;
    wp.currentJob = job;
    wp.currentToken = token;
    wp.timeoutId = setTimeout(() => {
      this.handleTimeout(wp, job);
    }, this.options.timeout);

    const request: IPCRequest = {
      type: 'job',
      job: { id: String(job.id), data: job.data, queue: job.queue, attempts: job.attempts },
    };
    try {
      wp.worker.postMessage(request);
    } catch (err) {
      log('error', 'Failed to dispatch job', {
        jobId: String(job.id),
        error: err instanceof Error ? err.message : String(err),
      });
      this.resetWorkerState(wp);
      this.manager
        .fail(job.id, 'Dispatch failed: worker terminated', token ?? undefined)
        .catch(() => {});
    }
  }

  private handleMessage(wp: WorkerProcess, msg: IPCResponse): void {
    if (msg.type === 'ready') return;
    if (!wp.currentJob || msg.jobId !== String(wp.currentJob.id)) return;

    switch (msg.type) {
      case 'result':
        this.complete(wp, msg.result);
        break;
      case 'error':
        this.fail(wp, msg.error ?? 'Unknown error');
        break;
      case 'progress':
        if (msg.progress !== undefined) {
          this.manager.updateProgress(wp.currentJob.id, msg.progress).catch(() => {});
        }
        break;
    }
  }

  private complete(wp: WorkerProcess, result: unknown): void {
    if (wp.currentJob) {
      const jobId = wp.currentJob.id;
      const token = wp.currentToken ?? undefined;
      this.manager.ack(jobId, result, token).catch((e: unknown) => {
        log('error', 'Failed to ack job', {
          jobId: String(jobId),
          error: e instanceof Error ? e.message : String(e),
        });
      });
    }
    this.resetWorkerState(wp);
  }

  private fail(wp: WorkerProcess, error: string): void {
    if (wp.currentJob) {
      const jobId = wp.currentJob.id;
      const token = wp.currentToken ?? undefined;
      this.manager.fail(jobId, error, token).catch((e: unknown) => {
        log('error', 'Failed to mark job as failed', {
          jobId: String(jobId),
          error: e instanceof Error ? e.message : String(e),
        });
      });
    }
    this.resetWorkerState(wp);
  }

  private handleTimeout(wp: WorkerProcess, job: DomainJob): void {
    log('warn', 'Job timed out', {
      jobId: String(job.id),
      timeoutMs: this.options.timeout,
    });
    wp.worker.terminate();
    const token = wp.currentToken ?? undefined;
    this.manager
      .fail(job.id, `Job timed out after ${this.options.timeout}ms`, token)
      .catch(() => {});

    this.resetWorkerState(wp);

    const index = this.workers.indexOf(wp);
    if (index !== -1) this.handleCrash(wp, index);
  }

  private handleCrash(wp: WorkerProcess, index: number): void {
    if (wp.currentJob) {
      const token = wp.currentToken ?? undefined;
      this.manager.fail(wp.currentJob.id, 'Worker crashed', token).catch(() => {});
    }

    this.resetWorkerState(wp);
    wp.restarts++;

    if (this.options.autoRestart && wp.restarts < this.options.maxRestarts && this.running) {
      log('info', 'Restarting worker', { workerIndex: index, attempt: wp.restarts });
      this.spawnWorker(index).catch((err: unknown) => {
        log('error', 'Failed to restart worker', {
          workerIndex: index,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    } else if (wp.restarts >= this.options.maxRestarts) {
      log('error', 'Worker exceeded max restarts', {
        workerIndex: index,
        maxRestarts: this.options.maxRestarts,
      });
    }
  }
}
