/**
 * Job Processor
 * Handles job execution and result reporting
 */

import type { EventEmitter } from 'events';
import type { TcpConnection } from './types';
import type { Processor, Job } from '../types';
import { createPublicJob } from '../types';
import type { Job as InternalJob } from '../../domain/types/job';
import { jobId } from '../../domain/types/job';
import { getSharedManager } from '../manager';
import type { AckBatcher } from './ackBatcher';

/** Processor configuration */
export interface ProcessorConfig<T, R> {
  name: string;
  processor: Processor<T, R>;
  embedded: boolean;
  tcp: TcpConnection | null;
  ackBatcher: AckBatcher;
  emitter: EventEmitter;
  token?: string | null; // Lock token for ownership verification
}

/**
 * Process a single job
 */
export async function processJob<T, R>(
  internalJob: InternalJob,
  config: ProcessorConfig<T, R>
): Promise<void> {
  const { processor, embedded, tcp, ackBatcher, emitter, token } = config;
  const jobData = internalJob.data as { name?: string } | null;
  const jobName = jobData?.name ?? 'default';
  const jobIdStr = String(internalJob.id);

  const job = createPublicJob<T>(
    internalJob,
    jobName,
    createProgressHandler(embedded, tcp, emitter),
    createLogHandler(embedded, tcp)
  );

  emitter.emit('active', job);

  try {
    const result = await processor(job);

    if (embedded) {
      const manager = getSharedManager();
      // Pass token for lock verification
      await manager.ack(internalJob.id, result, token ?? undefined);
    } else {
      // Queue with token for batch ACK
      ackBatcher.queue(jobIdStr, result, token ?? undefined);
    }

    (job as { returnvalue?: unknown }).returnvalue = result;
    emitter.emit('completed', job, result);
  } catch (error) {
    await handleJobFailure(internalJob, error, config, { job, jobIdStr, token });
  }
}

function createProgressHandler(
  embedded: boolean,
  tcp: TcpConnection | null,
  emitter: EventEmitter
) {
  return async (id: string, progress: number, message?: string) => {
    if (embedded) {
      const manager = getSharedManager();
      await manager.updateProgress(jobId(id), progress, message);
    } else if (tcp) {
      await tcp.send({ cmd: 'Progress', id, progress, message });
    }
    emitter.emit('progress', null, progress);
  };
}

function createLogHandler(embedded: boolean, tcp: TcpConnection | null) {
  return async (id: string, message: string) => {
    if (embedded) {
      const manager = getSharedManager();
      manager.addLog(jobId(id), message);
    } else if (tcp) {
      await tcp.send({ cmd: 'AddLog', id, message });
    }
  };
}

interface FailureContext<T> {
  job: Job<T>;
  jobIdStr: string;
  token?: string | null;
}

async function handleJobFailure<T, R>(
  internalJob: InternalJob,
  error: unknown,
  config: ProcessorConfig<T, R>,
  context: FailureContext<T>
): Promise<void> {
  const { embedded, tcp, emitter } = config;
  const { job, jobIdStr, token } = context;
  const err = error instanceof Error ? error : new Error(String(error));

  try {
    if (embedded) {
      const manager = getSharedManager();
      // Pass token for lock verification
      await manager.fail(internalJob.id, err.message, token ?? undefined);
    } else if (tcp) {
      // Include token for lock verification
      await tcp.send({
        cmd: 'FAIL',
        id: internalJob.id,
        error: err.message,
        token: token ?? undefined,
      });
    }
  } catch (failError) {
    const wrappedError = failError instanceof Error ? failError : new Error(String(failError));
    emitter.emit('error', Object.assign(wrappedError, { context: 'fail', jobId: jobIdStr }));
  }

  (job as { failedReason?: string }).failedReason = err.message;
  emitter.emit('failed', job, err);
}
