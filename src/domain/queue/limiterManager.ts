/**
 * LimiterManager - Rate limiting and concurrency control
 */

import { type QueueState, createQueueState, RateLimiter, ConcurrencyLimiter } from '../types/queue';

/**
 * Manages rate limiting and concurrency for queues
 */
export class LimiterManager {
  /** Queue state (pause, rate limit, concurrency) */
  private readonly queueState = new Map<string, QueueState>();

  /** Rate limiters per queue */
  private readonly rateLimiters = new Map<string, RateLimiter>();

  /** Concurrency limiters per queue */
  private readonly concurrencyLimiters = new Map<string, ConcurrencyLimiter>();

  /** Get queue state */
  getState(name: string): QueueState {
    let state = this.queueState.get(name);
    if (!state) {
      state = createQueueState(name);
      this.queueState.set(name, state);
    }
    return state;
  }

  /** Check if queue is paused */
  isPaused(name: string): boolean {
    return this.queueState.get(name)?.paused ?? false;
  }

  /** Pause queue */
  pause(name: string): void {
    this.getState(name).paused = true;
  }

  /** Resume queue */
  resume(name: string): void {
    this.getState(name).paused = false;
  }

  // ============ Rate Limiting ============

  /** Set rate limit for queue */
  setRateLimit(queue: string, limit: number): void {
    this.rateLimiters.set(queue, new RateLimiter(limit));
    this.getState(queue).rateLimit = limit;
  }

  /** Clear rate limit */
  clearRateLimit(queue: string): void {
    this.rateLimiters.delete(queue);
    const state = this.queueState.get(queue);
    if (state) state.rateLimit = null;
  }

  /** Try to acquire rate limit token */
  tryAcquireRateLimit(queue: string): boolean {
    const limiter = this.rateLimiters.get(queue);
    return !limiter || limiter.tryAcquire();
  }

  // ============ Concurrency Limiting ============

  /** Set concurrency limit for queue */
  setConcurrency(queue: string, limit: number): void {
    let limiter = this.concurrencyLimiters.get(queue);
    if (limiter) {
      limiter.setLimit(limit);
    } else {
      limiter = new ConcurrencyLimiter(limit);
      this.concurrencyLimiters.set(queue, limiter);
    }
    this.getState(queue).concurrencyLimit = limit;
  }

  /** Clear concurrency limit */
  clearConcurrency(queue: string): void {
    this.concurrencyLimiters.delete(queue);
    const state = this.queueState.get(queue);
    if (state) state.concurrencyLimit = null;
  }

  /** Try to acquire concurrency slot */
  tryAcquireConcurrency(queue: string): boolean {
    const limiter = this.concurrencyLimiters.get(queue);
    return !limiter || limiter.tryAcquire();
  }

  /** Release concurrency slot */
  releaseConcurrency(queue: string): void {
    this.concurrencyLimiters.get(queue)?.release();
  }

  // ============ Queue Management ============

  /** Get all queue names with state */
  getQueueNames(): string[] {
    return Array.from(this.queueState.keys());
  }

  /** Delete queue data */
  deleteQueue(queue: string): void {
    this.queueState.delete(queue);
    this.rateLimiters.delete(queue);
    this.concurrencyLimiters.delete(queue);
  }

  /** Get the underlying state map (for backward compatibility) */
  getStateMap(): Map<string, QueueState> {
    return this.queueState;
  }
}
