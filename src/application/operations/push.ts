/**
 * Push Operations
 * Job push and batch push logic
 */

import {
  type Job,
  type JobId,
  type JobInput,
  createJob,
  generateJobId,
  jobId,
} from '../../domain/types/job';
import { type JobLocation, EventType } from '../../domain/types/queue';
import type { Shard } from '../../domain/queue/shard';
import type { SqliteStorage } from '../../infrastructure/persistence/sqlite';
import type { RWLock } from '../../shared/lock';
import { withWriteLock } from '../../shared/lock';
import { shardIndex } from '../../shared/hash';
import type { SetLike, MapLike } from '../../shared/lru';

const LOG_PREFIX = '[Push]';

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

/** Push operation context */
export interface PushContext {
  storage: SqliteStorage | null;
  shards: Shard[];
  shardLocks: RWLock[];
  completedJobs: SetLike<JobId>;
  customIdMap: MapLike<string, JobId>;
  jobIndex: Map<JobId, JobLocation>;
  totalPushed: { value: bigint };
  broadcast: (event: {
    eventType: EventType;
    queue: string;
    jobId: JobId;
    timestamp: number;
  }) => void;
}

/** Result of checking custom ID */
type CustomIdResult = { skip: true; existingJob: Job } | { skip: false; id: JobId };

/** Result of deduplication check */
type DedupResult = { skip: true; existingId: JobId } | { skip: false };

/**
 * Handle custom ID idempotency check
 * Returns existing job if found, or new ID to use
 */
function handleCustomId(input: JobInput, shard: Shard, ctx: PushContext): CustomIdResult {
  if (!input.customId) {
    return { skip: false, id: generateJobId() };
  }

  const id = jobId(input.customId);
  const existing = ctx.customIdMap.get(input.customId);

  // No existing mapping - register and proceed
  if (!existing) {
    ctx.customIdMap.set(input.customId, id);
    return { skip: false, id };
  }

  // Check if existing job is still in queue
  const location = ctx.jobIndex.get(existing);
  const existingJob =
    location?.type === 'queue' ? shard.getQueue(location.queueName).find(existing) : null;

  if (existingJob) {
    log('info', 'Duplicate customId, returning existing job', {
      customId: input.customId,
      existingJobId: String(existing),
    });
    return { skip: true, existingJob };
  }

  // Job gone (processing/completed) - allow reuse of customId
  ctx.customIdMap.delete(input.customId);
  ctx.customIdMap.set(input.customId, id);
  return { skip: false, id };
}

/**
 * Handle unique key deduplication
 * Returns existing job ID if duplicate found and should skip, or allows insert
 */
function handleDeduplication(
  job: Job,
  input: JobInput,
  queue: string,
  shard: Shard,
  ctx: PushContext
): DedupResult {
  if (!job.uniqueKey) {
    return { skip: false };
  }

  const q = shard.getQueue(queue);
  const existingEntry = shard.getUniqueKeyEntry(queue, job.uniqueKey);

  if (!existingEntry) {
    shard.registerUniqueKeyWithTtl(queue, job.uniqueKey, job.id, input.dedup?.ttl);
    return { skip: false };
  }

  const dedupOpts = input.dedup;

  // Replace strategy: remove old, insert new
  if (dedupOpts?.replace) {
    const existingJob = q.find(existingEntry.jobId);
    if (existingJob) {
      q.remove(existingEntry.jobId);
      shard.decrementQueued(existingEntry.jobId);
      ctx.jobIndex.delete(existingEntry.jobId);
      log('info', 'Dedup replace: removed existing job', {
        queue,
        uniqueKey: job.uniqueKey,
        removedJobId: String(existingEntry.jobId),
        newJobId: String(job.id),
      });
    }
    shard.releaseUniqueKey(queue, job.uniqueKey);
    shard.registerUniqueKeyWithTtl(queue, job.uniqueKey, job.id, dedupOpts?.ttl);
    return { skip: false };
  }

  // Extend strategy: reset TTL, return existing
  if (dedupOpts?.extend && dedupOpts?.ttl) {
    shard.extendUniqueKeyTtl(queue, job.uniqueKey, dedupOpts.ttl);
    if (input.customId) ctx.customIdMap.delete(input.customId);
    const existingJob = q.find(existingEntry.jobId);
    if (existingJob) {
      log('info', 'Dedup extend: extended TTL, returning existing job', {
        queue,
        uniqueKey: job.uniqueKey,
        existingJobId: String(existingEntry.jobId),
        ttl: dedupOpts.ttl,
      });
      return { skip: true, existingId: existingEntry.jobId };
    }
    throw new Error('Duplicate unique_key (extended TTL)');
  }

  // Default: return existing job (BullMQ-style)
  if (input.customId) ctx.customIdMap.delete(input.customId);
  const existingJob = q.find(existingEntry.jobId);
  if (existingJob) {
    ctx.broadcast({
      eventType: EventType.Duplicated,
      queue,
      jobId: existingEntry.jobId,
      timestamp: Date.now(),
    });
    return { skip: true, existingId: existingEntry.jobId };
  }

  // Job not in queue (completed/failed) - allow new insert
  shard.registerUniqueKeyWithTtl(queue, job.uniqueKey, job.id, input.dedup?.ttl);
  return { skip: false };
}

/**
 * Insert job into shard (queue or waitingDeps)
 */
function insertJobToShard(
  job: Job,
  queue: string,
  shard: Shard,
  shardIdx: number,
  ctx: PushContext
): void {
  const hasDeps = job.dependsOn.length > 0;
  const needsWaiting = hasDeps && !job.dependsOn.every((depId) => ctx.completedJobs.has(depId));

  if (needsWaiting) {
    shard.waitingDeps.set(job.id, job);
    shard.registerDependencies(job.id, job.dependsOn);
    log('info', 'Job waiting for dependencies', {
      queue,
      jobId: String(job.id),
      pendingDeps: job.dependsOn.filter((d) => !ctx.completedJobs.has(d)).map(String),
    });
  } else {
    shard.getQueue(queue).push(job);
    const isDelayed = job.runAt > Date.now();
    shard.incrementQueued(job.id, isDelayed, job.createdAt, queue, job.runAt);
  }

  ctx.jobIndex.set(job.id, { type: 'queue', shardIdx, queueName: queue });
}

/**
 * Push a single job to queue
 * NOTE: customId check happens OUTSIDE lock for performance (unlike batch)
 */
export async function pushJob(queue: string, input: JobInput, ctx: PushContext): Promise<Job> {
  const idx = shardIndex(queue);
  const now = Date.now();

  // Check custom ID idempotency OUTSIDE lock (original behavior)
  const id = input.customId ? jobId(input.customId) : generateJobId();
  if (input.customId) {
    const existing = ctx.customIdMap.get(input.customId);
    if (existing) {
      const location = ctx.jobIndex.get(existing);
      if (location?.type === 'queue') {
        const shard = ctx.shards[location.shardIdx];
        const existingJob = shard.getQueue(location.queueName).find(existing);
        if (existingJob) {
          log('info', 'Duplicate customId, returning existing job', {
            queue,
            customId: input.customId,
            existingJobId: String(existing),
          });
          return existingJob;
        }
      }
      ctx.customIdMap.delete(input.customId);
    }
    ctx.customIdMap.set(input.customId, id);
  }

  const job = createJob(id, queue, input, now);
  let result: { job: Job; persisted: boolean } | undefined;

  await withWriteLock(ctx.shardLocks[idx], () => {
    const shard = ctx.shards[idx];

    // Check deduplication
    const dedupResult = handleDeduplication(job, input, queue, shard, ctx);
    if (dedupResult.skip) {
      const existingJob = shard.getQueue(queue).find(dedupResult.existingId);
      if (existingJob) {
        result = { job: existingJob, persisted: false };
        return;
      }
    }

    // Insert to shard
    insertJobToShard(job, queue, shard, idx, ctx);
    shard.notify();
    result = { job, persisted: true };
  });

  if (!result) {
    log('error', 'Push failed unexpectedly', { queue, jobId: String(id) });
    throw new Error('Push failed');
  }

  if (result.persisted) {
    ctx.storage?.insertJob(result.job, input.durable);
    ctx.totalPushed.value++;
    ctx.broadcast({
      eventType: 'pushed' as EventType,
      queue,
      jobId: result.job.id,
      timestamp: now,
    });
  }

  return result.job;
}

/**
 * Push multiple jobs to queue
 * NOTE: customId check happens INSIDE lock (safer for concurrent batch inserts)
 */
export async function pushJobBatch(
  queue: string,
  inputs: JobInput[],
  ctx: PushContext
): Promise<JobId[]> {
  const now = Date.now();
  const idx = shardIndex(queue);
  const resultIds: JobId[] = [];
  const jobsToInsert: Job[] = [];

  await withWriteLock(ctx.shardLocks[idx], () => {
    const shard = ctx.shards[idx];

    for (const input of inputs) {
      // Check custom ID idempotency
      const customIdResult = handleCustomId(input, shard, ctx);
      if (customIdResult.skip) {
        resultIds.push(customIdResult.existingJob.id);
        continue;
      }

      const job = createJob(customIdResult.id, queue, input, now);

      // Check deduplication
      const dedupResult = handleDeduplication(job, input, queue, shard, ctx);
      if (dedupResult.skip) {
        resultIds.push(dedupResult.existingId);
        continue;
      }

      // Insert to shard
      insertJobToShard(job, queue, shard, idx, ctx);
      jobsToInsert.push(job);
      resultIds.push(job.id);
    }

    if (jobsToInsert.length > 0) {
      shard.notify();
    }
  });

  if (jobsToInsert.length > 0) {
    ctx.storage?.insertJobsBatch(jobsToInsert);
    ctx.totalPushed.value += BigInt(jobsToInsert.length);
    log('info', 'Batch push completed', {
      queue,
      inserted: jobsToInsert.length,
      duplicates: inputs.length - jobsToInsert.length,
    });
  }

  return resultIds;
}
