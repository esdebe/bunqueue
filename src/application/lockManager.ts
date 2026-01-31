/**
 * Lock Manager - Job lock and client tracking
 * Handles BullMQ-style lock-based job ownership
 */

import type { Job, JobId, JobLock } from '../domain/types/job';
import { isLockExpired } from '../domain/types/job';
import { FailureReason } from '../domain/types/dlq';
import { EventType } from '../domain/types/queue';
import type { IndexedPriorityQueue } from '../domain/queue/priorityQueue';
import { queueLog } from '../shared/logger';
import { shardIndex, processingShardIndex } from '../shared/hash';
import { withWriteLock } from '../shared/lock';
import type { LockContext } from './types';

// Re-export lock operations
export {
  createLock,
  verifyLock,
  renewJobLock,
  renewJobLockBatch,
  releaseLock,
  getLockInfo,
} from './lockOperations';

// Re-export client tracking
export { registerClientJob, unregisterClientJob, releaseClientJobs } from './clientTracking';

/**
 * Check and handle expired locks.
 * Jobs with expired locks are requeued for retry.
 *
 * Uses proper locking to prevent race conditions.
 */
export async function checkExpiredLocks(ctx: LockContext): Promise<void> {
  const now = Date.now();

  // Phase 1: Collect expired locks (read-only)
  const expired: Array<{ jobId: JobId; lock: JobLock; procIdx: number }> = [];

  for (const [jobId, lock] of ctx.jobLocks) {
    if (isLockExpired(lock, now)) {
      const procIdx = processingShardIndex(String(jobId));
      expired.push({ jobId, lock, procIdx });
    }
  }

  if (expired.length === 0) return;

  // Phase 2: Group by processing shard
  const byProcShard = new Map<number, typeof expired>();
  for (const item of expired) {
    let list = byProcShard.get(item.procIdx);
    if (!list) {
      list = [];
      byProcShard.set(item.procIdx, list);
    }
    list.push(item);
  }

  // Phase 3: Process each shard with proper locking
  for (const [procIdx, items] of byProcShard) {
    await withWriteLock(ctx.processingLocks[procIdx], async () => {
      for (const { jobId, lock } of items) {
        await processExpiredLock(jobId, lock, procIdx, ctx, now);
      }
    });
  }

  queueLog.info('Processed expired locks', { count: expired.length });
}

/** Process a single expired lock */
async function processExpiredLock(
  jobId: JobId,
  lock: JobLock,
  procIdx: number,
  ctx: LockContext,
  now: number
): Promise<void> {
  const job = ctx.processingShards[procIdx].get(jobId);

  if (job) {
    const idx = shardIndex(job.queue);

    await withWriteLock(ctx.shardLocks[idx], () => {
      const shard = ctx.shards[idx];
      const queue = shard.getQueue(job.queue);

      // Remove from processing
      ctx.processingShards[procIdx].delete(jobId);

      // Increment attempts and reset state
      job.attempts++;
      job.startedAt = null;
      job.lastHeartbeat = now;
      job.stallCount++;

      // Check if max stalls exceeded
      const stallConfig = shard.getStallConfig(job.queue);
      if (stallConfig.maxStalls > 0 && job.stallCount >= stallConfig.maxStalls) {
        handleMaxStallsExceeded({ jobId, job, lock, shard, ctx, now });
      } else {
        requeueExpiredJob({ jobId, job, lock, queue, idx, ctx, now });
      }
    });
  }

  // Remove the expired lock
  ctx.jobLocks.delete(jobId);
}

/** Options for handling max stalls exceeded */
interface MaxStallsOptions {
  jobId: JobId;
  job: Job;
  lock: JobLock;
  shard: LockContext['shards'][number];
  ctx: LockContext;
  now: number;
}

/** Move job to DLQ when max stalls exceeded */
function handleMaxStallsExceeded(opts: MaxStallsOptions): void {
  const { jobId, job, lock, shard, ctx, now } = opts;
  shard.addToDlq(job, FailureReason.Stalled, `Lock expired after ${lock.renewalCount} renewals`);
  ctx.jobIndex.set(jobId, { type: 'dlq', queueName: job.queue });

  queueLog.warn('Job moved to DLQ due to lock expiration', {
    jobId: String(jobId),
    queue: job.queue,
    owner: lock.owner,
    renewals: lock.renewalCount,
    stallCount: job.stallCount,
  });

  ctx.eventsManager.broadcast({
    eventType: EventType.Failed,
    jobId,
    queue: job.queue,
    timestamp: now,
    error: 'Lock expired (max stalls reached)',
  });
}

/** Options for requeuing expired job */
interface RequeueOptions {
  jobId: JobId;
  job: Job;
  lock: JobLock;
  queue: IndexedPriorityQueue;
  idx: number;
  ctx: LockContext;
  now: number;
}

/** Requeue job for retry */
function requeueExpiredJob(opts: RequeueOptions): void {
  const { jobId, job, lock, queue, idx, ctx, now } = opts;
  queue.push(job);
  ctx.jobIndex.set(jobId, { type: 'queue', shardIdx: idx, queueName: job.queue });

  queueLog.info('Job requeued due to lock expiration', {
    jobId: String(jobId),
    queue: job.queue,
    owner: lock.owner,
    renewals: lock.renewalCount,
    attempt: job.attempts,
  });

  ctx.eventsManager.broadcast({
    eventType: EventType.Stalled,
    jobId,
    queue: job.queue,
    timestamp: now,
  });
}
