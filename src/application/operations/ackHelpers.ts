/**
 * Ack Helpers - Shared batch processing utilities
 */

import type { Job, JobId } from '../../domain/types/job';
import type { JobLocation, EventType } from '../../domain/types/queue';
import type { Shard } from '../../domain/queue/shard';
import type { RWLock } from '../../shared/lock';
import { withWriteLock } from '../../shared/lock';
import { shardIndex, processingShardIndex } from '../../shared/hash';
import type { SetLike, MapLike } from '../../shared/lru';
import type { SqliteStorage } from '../../infrastructure/persistence/sqlite';

/** Extracted job with optional result */
export interface ExtractedJob<T = unknown> {
  id: JobId;
  job: Job;
  result?: T;
}

/** Context for batch operations */
export interface BatchContext {
  processingShards: Map<JobId, Job>[];
  processingLocks: RWLock[];
  shards: Shard[];
  shardLocks: RWLock[];
}

/**
 * Group job IDs by processing shard
 * Returns Map<shardIndex, jobIds[]>
 */
export function groupByProcShard(jobIds: JobId[]): Map<number, JobId[]> {
  const byProcShard = new Map<number, JobId[]>();
  for (const jobId of jobIds) {
    const procIdx = processingShardIndex(jobId);
    let group = byProcShard.get(procIdx);
    if (!group) {
      group = [];
      byProcShard.set(procIdx, group);
    }
    group.push(jobId);
  }
  return byProcShard;
}

/**
 * Group items by processing shard (with results)
 */
export function groupItemsByProcShard<T extends { id: JobId }>(items: T[]): Map<number, T[]> {
  const byProcShard = new Map<number, T[]>();
  for (const item of items) {
    const procIdx = processingShardIndex(item.id);
    let group = byProcShard.get(procIdx);
    if (!group) {
      group = [];
      byProcShard.set(procIdx, group);
    }
    group.push(item);
  }
  return byProcShard;
}

/**
 * Extract jobs from processing shards (one lock per shard)
 */
export async function extractJobs(
  byProcShard: Map<number, JobId[]>,
  ctx: BatchContext
): Promise<ExtractedJob[]> {
  const extractedJobs: ExtractedJob[] = [];

  await Promise.all(
    Array.from(byProcShard.entries()).map(async ([procIdx, ids]) => {
      await withWriteLock(ctx.processingLocks[procIdx], () => {
        for (const jobId of ids) {
          const job = ctx.processingShards[procIdx].get(jobId);
          if (job) {
            ctx.processingShards[procIdx].delete(jobId);
            extractedJobs.push({ id: jobId, job });
          }
        }
      });
    })
  );

  return extractedJobs;
}

/**
 * Extract jobs with results from processing shards
 */
export async function extractJobsWithResults<T>(
  byProcShard: Map<number, Array<{ id: JobId; result: T }>>,
  ctx: BatchContext
): Promise<Array<ExtractedJob<T>>> {
  const extractedJobs: Array<ExtractedJob<T>> = [];

  await Promise.all(
    Array.from(byProcShard.entries()).map(async ([procIdx, items]) => {
      await withWriteLock(ctx.processingLocks[procIdx], () => {
        for (const item of items) {
          const job = ctx.processingShards[procIdx].get(item.id);
          if (job) {
            ctx.processingShards[procIdx].delete(item.id);
            extractedJobs.push({ id: item.id, job, result: item.result });
          }
        }
      });
    })
  );

  return extractedJobs;
}

/**
 * Group extracted jobs by queue shard
 */
export function groupByQueueShard(extractedJobs: ExtractedJob[]): Map<number, Job[]> {
  const byQueueShard = new Map<number, Job[]>();
  for (let i = 0; i < extractedJobs.length; i++) {
    const job = extractedJobs[i].job;
    const idx = shardIndex(job.queue);
    let group = byQueueShard.get(idx);
    if (!group) {
      group = [];
      byQueueShard.set(idx, group);
    }
    group.push(job);
  }
  return byQueueShard;
}

/**
 * Release resources for each queue shard (one lock per shard)
 */
export async function releaseResources(
  byQueueShard: Map<number, Job[]>,
  ctx: BatchContext
): Promise<void> {
  await Promise.all(
    Array.from(byQueueShard.entries()).map(async ([idx, jobs]) => {
      await withWriteLock(ctx.shardLocks[idx], () => {
        const shard = ctx.shards[idx];
        for (const job of jobs) {
          shard.releaseJobResources(job.queue, job.uniqueKey, job.groupId);
        }
      });
    })
  );
}

/** Context for finalize operations */
export interface FinalizeContext {
  storage: SqliteStorage | null;
  completedJobs: SetLike<JobId>;
  jobResults: MapLike<JobId, unknown>;
  jobIndex: Map<JobId, JobLocation>;
  totalCompleted: { value: bigint };
  broadcast: (event: {
    eventType: EventType;
    queue: string;
    jobId: JobId;
    timestamp: number;
    data?: unknown;
  }) => void;
  onJobCompleted: (jobId: JobId) => void;
  onJobsCompleted?: (jobIds: JobId[]) => void;
  needsBroadcast?: () => boolean;
  hasPendingDeps?: () => boolean;
}

/**
 * Finalize batch ack - update indexes, metrics, broadcast, notify
 */
export function finalizeBatchAck<T>(
  extractedJobs: Array<ExtractedJob<T>>,
  ctx: FinalizeContext,
  includeResults: boolean
): void {
  const now = Date.now();
  const completedLocation: JobLocation = { type: 'completed' };
  const storage = ctx.storage;
  const hasStorage = storage !== null;
  const jobCount = extractedJobs.length;

  const needsBroadcast = ctx.needsBroadcast?.() ?? true;
  const hasPendingDeps = ctx.hasPendingDeps?.() ?? true;

  // Batch counter update
  ctx.totalCompleted.value += BigInt(jobCount);

  // Main loop
  for (let i = 0; i < jobCount; i++) {
    const { id: jobId, job, result } = extractedJobs[i];
    if (!job.removeOnComplete) {
      ctx.completedJobs.add(jobId);
      if (includeResults && result !== undefined) {
        ctx.jobResults.set(jobId, result);
        if (hasStorage) storage.storeResult(jobId, result);
      }
      ctx.jobIndex.set(jobId, completedLocation);
      if (hasStorage) storage.markCompleted(jobId, now);
    } else {
      ctx.jobIndex.delete(jobId);
      if (hasStorage) storage.deleteJob(jobId);
    }
  }

  // Broadcast events
  if (needsBroadcast) {
    for (let i = 0; i < jobCount; i++) {
      const { id: jobId, job, result } = extractedJobs[i];
      ctx.broadcast({
        eventType: 'completed' as EventType,
        queue: job.queue,
        jobId,
        timestamp: now,
        data: includeResults ? result : undefined,
      });
    }
  }

  // Notify completions
  if (hasPendingDeps && ctx.onJobsCompleted) {
    const completedIds = extractedJobs.map((e) => e.id);
    ctx.onJobsCompleted(completedIds);
  } else if (hasPendingDeps) {
    for (let i = 0; i < jobCount; i++) {
      ctx.onJobCompleted(extractedJobs[i].id);
    }
  }
}
