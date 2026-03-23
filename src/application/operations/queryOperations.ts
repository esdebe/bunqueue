/**
 * Query Operations
 * Get job, get result, get progress
 */

import type { Job, JobId } from '../../domain/types/job';
import { JobState } from '../../domain/types/job';
import type { JobLocation } from '../../domain/types/queue';
import type { Shard } from '../../domain/queue/shard';
import type { SqliteStorage } from '../../infrastructure/persistence/sqlite';
import { type RWLock, withReadLock } from '../../shared/lock';
import type { SetLike, MapLike } from '../../shared/lru';
import { shardIndex } from '../../shared/hash';

/** Context for query operations */
export interface QueryContext {
  storage: SqliteStorage | null;
  shards: Shard[];
  shardLocks: RWLock[];
  processingShards: Map<JobId, Job>[];
  processingLocks: RWLock[];
  jobIndex: Map<JobId, JobLocation>;
  completedJobs: SetLike<JobId>;
  completedJobsData: MapLike<JobId, Job>;
  jobResults: MapLike<JobId, unknown>;
  customIdMap: MapLike<string, JobId>;
}

/** Get job by ID */
export async function getJob(jobId: JobId, ctx: QueryContext): Promise<Job | null> {
  const location = ctx.jobIndex.get(jobId);
  if (!location) return null;

  switch (location.type) {
    case 'queue': {
      return await withReadLock(ctx.shardLocks[location.shardIdx], () => {
        const shard = ctx.shards[location.shardIdx];
        return (
          shard.getQueue(location.queueName).find(jobId) ?? shard.waitingDeps.get(jobId) ?? null
        );
      });
    }
    case 'processing': {
      return await withReadLock(ctx.processingLocks[location.shardIdx], () => {
        return ctx.processingShards[location.shardIdx].get(jobId) ?? null;
      });
    }
    case 'completed':
      return ctx.storage?.getJob(jobId) ?? ctx.completedJobsData.get(jobId) ?? null;
    case 'dlq': {
      if (ctx.storage) {
        const job = ctx.storage.getJob(jobId);
        if (job) return job;
      }
      const dlqShardIdx = shardIndex(location.queueName);
      const dlqJobs = ctx.shards[dlqShardIdx].getDlq(location.queueName);
      return dlqJobs.find((j) => j.id === jobId) ?? null;
    }
  }
}

/** Get job result */
export function getJobResult(jobId: JobId, ctx: QueryContext): unknown {
  return ctx.jobResults.get(jobId) ?? ctx.storage?.getResult(jobId);
}

/** Get job by custom ID */
export function getJobByCustomId(customId: string, ctx: QueryContext): Job | null {
  const jobId = ctx.customIdMap.get(customId);
  if (!jobId) return null;

  const location = ctx.jobIndex.get(jobId);
  if (!location) return null;

  if (location.type === 'queue') {
    const shard = ctx.shards[location.shardIdx];
    return shard.getQueue(location.queueName).find(jobId) ?? shard.waitingDeps.get(jobId) ?? null;
  }
  if (location.type === 'processing') {
    return ctx.processingShards[location.shardIdx].get(jobId) ?? null;
  }
  if (location.type === 'completed') {
    return ctx.storage?.getJob(jobId) ?? ctx.completedJobsData.get(jobId) ?? null;
  }
  if (location.type === 'dlq') {
    if (ctx.storage) {
      const job = ctx.storage.getJob(jobId);
      if (job) return job;
    }
    const dlqShardIdx = shardIndex(location.queueName);
    const dlqJobs = ctx.shards[dlqShardIdx].getDlq(location.queueName);
    return dlqJobs.find((j) => j.id === jobId) ?? null;
  }
  return null;
}

/** Get job progress */
export function getJobProgress(
  jobId: JobId,
  ctx: QueryContext
): { progress: number; message: string | null } | null {
  const location = ctx.jobIndex.get(jobId);
  if (location?.type !== 'processing') return null;

  const job = ctx.processingShards[location.shardIdx].get(jobId);
  if (!job) return null;

  return { progress: job.progress, message: job.progressMessage };
}

/** Extended context for getJobs (needs SHARD_COUNT) */
export interface GetJobsContext extends QueryContext {
  shardCount: number;
}

/** Get job state by ID */
export async function getJobState(jobId: JobId, ctx: QueryContext): Promise<JobState | 'unknown'> {
  const location = ctx.jobIndex.get(jobId);

  // Check completed set first (fast path)
  if (ctx.completedJobs.has(jobId)) {
    return JobState.Completed;
  }

  if (!location) {
    return 'unknown';
  }

  switch (location.type) {
    case 'queue': {
      // Check if job is delayed, waiting, or waiting for children/deps
      const result = await withReadLock(ctx.shardLocks[location.shardIdx], () => {
        const shard = ctx.shards[location.shardIdx];
        const queueJob = shard.getQueue(location.queueName).find(jobId);
        if (queueJob) return { job: queueJob, waitingDeps: false, waitingChildren: false };
        const depsJob = shard.waitingDeps.get(jobId);
        if (depsJob) return { job: depsJob, waitingDeps: true, waitingChildren: false };
        const childrenJob = shard.waitingChildren.get(jobId);
        if (childrenJob) return { job: childrenJob, waitingDeps: false, waitingChildren: true };
        return null;
      });
      if (!result) return 'unknown';
      if (result.waitingDeps || result.waitingChildren) return 'waiting-children' as JobState;
      const now = Date.now();
      if (result.job.runAt > now) return JobState.Delayed;
      return result.job.priority > 0 ? JobState.Prioritized : JobState.Waiting;
    }
    case 'processing':
      return JobState.Active;
    case 'completed':
      return JobState.Completed;
    case 'dlq':
      return JobState.Failed;
  }
}

/** Collect completed jobs for a queue from index + storage */
function collectCompletedJobs(queue: string, ctx: GetJobsContext, maxCollect: number): Job[] {
  const jobs: Job[] = [];
  for (const [jId, location] of ctx.jobIndex) {
    if (location.type === 'completed' && location.queueName === queue) {
      const job = ctx.storage?.getJob(jId) ?? ctx.completedJobsData?.get(jId) ?? null;
      if (job) {
        jobs.push(job);
        if (jobs.length >= maxCollect) break;
      }
    }
  }
  return jobs;
}

/** Collect active jobs for a queue across all processing shards */
function collectActiveJobs(
  queue: string,
  shardIdx: number,
  ctx: GetJobsContext,
  maxCollect: number
): Job[] {
  const jobs: Job[] = [];
  // Own shard first (most likely location)
  for (const job of ctx.processingShards[shardIdx].values()) {
    if (job.queue === queue) jobs.push(job);
    if (jobs.length >= maxCollect) return jobs;
  }
  // Other shards
  for (let i = 0; i < ctx.shardCount; i++) {
    if (i === shardIdx) continue;
    for (const job of ctx.processingShards[i].values()) {
      if (job.queue === queue) jobs.push(job);
      if (jobs.length >= maxCollect) return jobs;
    }
  }
  return jobs;
}

/** Collect waiting/delayed/prioritized jobs in a single pass */
function collectTemporalJobs(
  shard: Shard,
  queue: string,
  needs: { waiting: boolean; prioritized: boolean; delayed: boolean },
  maxCollect: number
): Job[] {
  const { waiting: needWaiting, prioritized: needPrioritized, delayed: needDelayed } = needs;
  const now = Date.now();
  const jobs: Job[] = [];
  for (const j of shard.getQueue(queue).values()) {
    if (jobs.length >= maxCollect) break;
    const isDelayed = j.runAt > now;
    if (isDelayed && needDelayed) {
      jobs.push(j);
    } else if (!isDelayed) {
      // BullMQ v5: priority>0 → "prioritized", priority=0 → "waiting"
      if (j.priority > 0 ? needPrioritized : needWaiting) {
        jobs.push(j);
      }
    }
  }
  return jobs;
}

/** Collect jobs from in-memory structures by state filter */
function collectJobsByState(
  queue: string,
  shardIdx: number,
  states: string[] | null,
  ctx: GetJobsContext
): Job[] {
  const shard = ctx.shards[shardIdx];
  const jobs: Job[] = [];
  const needWaiting = !states || states.includes('waiting');
  const needPrioritized = !states || states.includes('prioritized');
  const needDelayed = !states || states.includes('delayed');

  if (needWaiting || needPrioritized || needDelayed) {
    jobs.push(
      ...collectTemporalJobs(
        shard,
        queue,
        { waiting: needWaiting, prioritized: needPrioritized, delayed: needDelayed },
        Infinity
      )
    );
  }
  if (!states || states.includes('active')) {
    jobs.push(...collectActiveJobs(queue, shardIdx, ctx, Infinity));
  }
  if (!states || states.includes('failed')) {
    jobs.push(...shard.getDlq(queue));
  }
  if (!states || states.includes('completed')) {
    jobs.push(...collectCompletedJobs(queue, ctx, Infinity));
  }
  return jobs;
}

/** Get jobs from queue with filters */
export function getJobs(
  queue: string,
  shardIdx: number,
  options: {
    state?: string | string[];
    start?: number;
    end?: number;
    asc?: boolean;
  },
  ctx: GetJobsContext
): Job[] {
  const { state, start = 0, end = 100, asc = true } = options;

  // Normalize state to an array or null (no filter)
  const states = !state
    ? null
    : Array.isArray(state)
      ? state.length === 0
        ? null
        : state
      : [state];

  const limit = end - start;

  // Fast path: use SQLite pagination (idx_jobs_queue_state index)
  // Routes ALL state combinations through SQLite when available — O(log n + k)
  // Note: SQLite stores 'waiting' (never 'prioritized'), so we translate
  // 'prioritized' → query 'waiting' with priority > 0, and filter results.
  if (ctx.storage) {
    if (!states) {
      return ctx.storage.queryJobs(queue, { limit, offset: start, asc });
    }
    // Translate 'prioritized' → 'waiting' for SQLite, then filter in-memory
    const hasPrioritized = states.includes('prioritized');
    const hasWaiting = states.includes('waiting');
    if (hasPrioritized || hasWaiting) {
      // Map both to 'waiting' in SQLite, then filter by priority
      const sqlStates = states
        .map((s) => (s === 'prioritized' ? 'waiting' : s))
        .filter((s, i, arr) => arr.indexOf(s) === i); // dedupe
      let jobs: Job[];
      if (sqlStates.length === 1) {
        jobs = ctx.storage.queryJobs(queue, {
          state: sqlStates[0],
          limit: limit * 2,
          offset: start,
          asc,
        });
      } else {
        jobs = ctx.storage.queryJobs(queue, {
          states: sqlStates,
          limit: limit * 2,
          offset: start,
          asc,
        });
      }
      // Post-filter: 'prioritized' = priority > 0, 'waiting' = priority <= 0
      if (hasPrioritized && !hasWaiting) {
        jobs = jobs.filter((j) => j.priority > 0);
      } else if (hasWaiting && !hasPrioritized) {
        jobs = jobs.filter((j) => j.priority <= 0);
      }
      // else: both requested, no filter needed
      return jobs.slice(0, limit);
    }
    if (states.length === 1) {
      return ctx.storage.queryJobs(queue, { state: states[0], limit, offset: start, asc });
    }
    return ctx.storage.queryJobs(queue, { states, limit, offset: start, asc });
  }

  // In-memory path (embedded mode only)
  const jobs = collectJobsByState(queue, shardIdx, states, ctx);
  jobs.sort((a, b) => (asc ? a.createdAt - b.createdAt : b.createdAt - a.createdAt));
  return jobs.slice(start, end);
}
