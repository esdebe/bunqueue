/**
 * Bounded Set - fast FIFO eviction without LRU tracking
 */

import type { SetLike } from './lruSet';

/**
 * Bounded Set - fast FIFO eviction without LRU tracking
 * Optimized for high-throughput scenarios where recency doesn't matter
 * Uses batch eviction to avoid per-item iterator overhead
 */
export class BoundedSet<T> implements SetLike<T> {
  private readonly cache = new Set<T>();
  private readonly maxSize: number;
  private readonly onEvict?: (value: T) => void;
  /** Evict 10% of items at once to amortize iterator cost */
  private readonly evictBatchSize: number;

  constructor(maxSize: number, onEvict?: (value: T) => void) {
    this.maxSize = maxSize;
    this.onEvict = onEvict;
    this.evictBatchSize = Math.max(1, Math.floor(maxSize * 0.1));
  }

  add(value: T): void {
    // Fast path: already exists - no-op
    if (this.cache.has(value)) return;

    // Batch evict if at capacity - amortizes iterator cost
    if (this.cache.size >= this.maxSize) {
      this.evictBatch();
    }
    this.cache.add(value);
  }

  /** Evict multiple items at once - more efficient than one at a time */
  private evictBatch(): void {
    const toEvict: T[] = [];
    const iter = this.cache.values();
    for (let i = 0; i < this.evictBatchSize; i++) {
      const { value, done } = iter.next();
      if (done) break;
      toEvict.push(value);
    }
    for (const value of toEvict) {
      this.cache.delete(value);
      this.onEvict?.(value);
    }
  }

  has(value: T): boolean {
    return this.cache.has(value);
  }

  delete(value: T): boolean {
    return this.cache.delete(value);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  values(): IterableIterator<T> {
    return this.cache.values();
  }

  [Symbol.iterator](): IterableIterator<T> {
    return this.cache[Symbol.iterator]();
  }
}
