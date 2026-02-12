/**
 * Bounded Map - fast FIFO eviction without LRU tracking
 */

import type { MapLike } from './lruMap';

/**
 * Bounded Map - fast FIFO eviction without LRU tracking
 * Optimized for high-throughput scenarios where recency doesn't matter
 * Uses batch eviction to avoid per-item iterator overhead
 */
export class BoundedMap<K, V> implements MapLike<K, V> {
  private readonly cache = new Map<K, V>();
  private readonly maxSize: number;
  private readonly onEvict?: (key: K, value: V) => void;
  /** Evict 10% of items at once to amortize iterator cost */
  private readonly evictBatchSize: number;

  constructor(maxSize: number, onEvict?: (key: K, value: V) => void) {
    this.maxSize = maxSize;
    this.onEvict = onEvict;
    this.evictBatchSize = Math.max(1, Math.floor(maxSize * 0.1));
  }

  get(key: K): V | undefined {
    return this.cache.get(key);
  }

  set(key: K, value: V): void {
    // Fast path: key already exists - update in place
    if (this.cache.has(key)) {
      this.cache.set(key, value);
      return;
    }

    // Batch evict if at capacity
    if (this.cache.size >= this.maxSize) {
      this.evictBatch();
    }
    this.cache.set(key, value);
  }

  /** Evict multiple items at once - more efficient than one at a time */
  private evictBatch(): void {
    const toEvict: Array<{ key: K; value: V }> = [];
    const iter = this.cache.entries();
    for (let i = 0; i < this.evictBatchSize; i++) {
      const { value, done } = iter.next();
      if (done) break;
      toEvict.push({ key: value[0], value: value[1] });
    }
    for (const { key, value } of toEvict) {
      this.cache.delete(key);
      this.onEvict?.(key, value);
    }
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  keys(): IterableIterator<K> {
    return this.cache.keys();
  }

  values(): IterableIterator<V> {
    return this.cache.values();
  }

  entries(): IterableIterator<[K, V]> {
    return this.cache.entries();
  }

  forEach(callback: (value: V, key: K) => void): void {
    this.cache.forEach(callback);
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.cache[Symbol.iterator]();
  }
}
