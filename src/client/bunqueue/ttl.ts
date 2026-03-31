/**
 * Bunqueue — Job TTL (Time To Live)
 * Expire unprocessed jobs based on configurable TTL.
 */

import type { JobTtlConfig } from './types';

export class TtlChecker {
  private readonly config: JobTtlConfig;

  constructor(config: JobTtlConfig) {
    this.config = config;
  }

  /** Get TTL for a specific job name */
  getTtl(jobName: string): number {
    return this.config.perName?.[jobName] ?? this.config.defaultTtl ?? 0;
  }

  /** Check if a job has expired */
  isExpired(jobName: string, jobTimestamp: number): boolean {
    const ttl = this.getTtl(jobName);
    if (ttl <= 0) return false;
    return Date.now() - jobTimestamp > ttl;
  }

  /** Set default TTL */
  setDefaultTtl(ttlMs: number): void {
    this.config.defaultTtl = ttlMs;
  }

  /** Set TTL for a specific job name */
  setNameTtl(jobName: string, ttlMs: number): void {
    this.config.perName ??= {};
    this.config.perName[jobName] = ttlMs;
  }
}
