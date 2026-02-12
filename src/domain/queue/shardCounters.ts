/**
 * ShardCounters - Running counters for O(1) stats retrieval
 * Tracks queued, delayed, and DLQ job counts
 */

import type { JobId } from '../types/job';
import type { TemporalManager } from './temporalManager';

/** Shard statistics counters for O(1) stats retrieval */
export interface ShardStats {
  /** Total jobs in all queues (waiting + delayed) */
  queuedJobs: number;
  /** Jobs with runAt > now at time of push */
  delayedJobs: number;
  /** Total jobs in DLQ */
  dlqJobs: number;
}

export class ShardCounters {
  /** Running counters for O(1) stats */
  private readonly stats: ShardStats = {
    queuedJobs: 0,
    delayedJobs: 0,
    dlqJobs: 0,
  };

  constructor(private readonly temporalManager: TemporalManager) {}

  getStats(): ShardStats {
    return { ...this.stats };
  }

  incrementQueued(
    jobId: JobId,
    isDelayed: boolean,
    createdAt?: number,
    queue?: string,
    runAt?: number
  ): void {
    this.stats.queuedJobs++;
    if (isDelayed) {
      this.stats.delayedJobs++;
      if (runAt !== undefined) {
        this.temporalManager.addDelayed(jobId, runAt);
      }
    }
    if (createdAt !== undefined && queue !== undefined) {
      this.temporalManager.addToIndex(createdAt, jobId, queue);
    }
  }

  decrementQueued(jobId: JobId): void {
    this.stats.queuedJobs = Math.max(0, this.stats.queuedJobs - 1);
    if (this.temporalManager.removeDelayed(jobId)) {
      this.stats.delayedJobs = Math.max(0, this.stats.delayedJobs - 1);
    }
  }

  incrementDlq(): void {
    this.stats.dlqJobs++;
  }

  decrementDlq(count: number = 1): void {
    this.stats.dlqJobs = Math.max(0, this.stats.dlqJobs - count);
  }

  refreshDelayedCount(now: number): void {
    const readyCount = this.temporalManager.refreshDelayed(now);
    this.stats.delayedJobs = Math.max(0, this.stats.delayedJobs - readyCount);
  }

  resetQueuedCounters(): void {
    this.stats.queuedJobs = 0;
    this.stats.delayedJobs = 0;
    this.temporalManager.clearDelayed();
  }

  resetDlqCounter(): void {
    this.stats.dlqJobs = 0;
  }

  /** Adjust queuedJobs counter directly (for drain/obliterate) */
  adjustQueued(delta: number): void {
    this.stats.queuedJobs = Math.max(0, this.stats.queuedJobs + delta);
  }

  /** Adjust dlqJobs counter directly (for obliterate) */
  adjustDlq(delta: number): void {
    this.stats.dlqJobs = Math.max(0, this.stats.dlqJobs + delta);
  }

  /** Sync delayedJobs to the temporal manager's actual count */
  syncDelayedCount(): void {
    this.stats.delayedJobs = this.temporalManager.delayedCount;
  }
}
