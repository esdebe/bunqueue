/**
 * WorkerRateLimiter - Rate limiting for worker job processing
 * BullMQ v5 compatible sliding window rate limiter
 */

import type { RateLimiterOptions } from '../types';

export class WorkerRateLimiter {
  private limiterTokens: number[] = [];
  private rateLimitExpiration = 0;

  constructor(private readonly limiter: RateLimiterOptions | null) {}

  /**
   * Check if rate limiter allows processing another job.
   * Returns true if we can process, false if rate limited.
   */
  canProcessWithinLimit(): boolean {
    if (!this.limiter) return true;

    const now = Date.now();
    const windowStart = now - this.limiter.duration;

    // Remove expired tokens
    this.limiterTokens = this.limiterTokens.filter((t) => t > windowStart);

    // Check if we have capacity
    return this.limiterTokens.length < this.limiter.max;
  }

  /** Record a job completion for rate limiting. */
  recordJobForLimiter(): void {
    if (!this.limiter) return;
    this.limiterTokens.push(Date.now());
  }

  /**
   * Get time until rate limiter allows next job (ms).
   * Returns 0 if not rate limited.
   */
  getTimeUntilNextSlot(): number {
    if (!this.limiter) return 0;

    const now = Date.now();
    const windowStart = now - this.limiter.duration;

    // Remove expired tokens
    this.limiterTokens = this.limiterTokens.filter((t) => t > windowStart);

    if (this.limiterTokens.length < this.limiter.max) {
      return 0;
    }

    // Find oldest token and calculate when it expires
    const oldestToken = Math.min(...this.limiterTokens);
    return oldestToken + this.limiter.duration - now;
  }

  /** Get rate limiter info (for debugging/monitoring). */
  getRateLimiterInfo(): { current: number; max: number; duration: number } | null {
    if (!this.limiter) return null;

    const now = Date.now();
    const windowStart = now - this.limiter.duration;
    const currentTokens = this.limiterTokens.filter((t) => t > windowStart).length;

    return {
      current: currentTokens,
      max: this.limiter.max,
      duration: this.limiter.duration,
    };
  }

  /**
   * Apply rate limiting (BullMQ v5 compatible).
   * The worker will not process jobs until the rate limit expires.
   */
  rateLimit(expireTimeMs: number): void {
    if (expireTimeMs <= 0) return;

    // Fill rate limiter tokens to block processing
    if (this.limiter) {
      const now = Date.now();
      for (let i = 0; i < this.limiter.max; i++) {
        this.limiterTokens.push(now + expireTimeMs - this.limiter.duration);
      }
    }

    this.rateLimitExpiration = Date.now() + expireTimeMs;
  }

  /** Check if worker is currently rate limited. */
  isRateLimited(): boolean {
    return Date.now() < this.rateLimitExpiration;
  }
}
