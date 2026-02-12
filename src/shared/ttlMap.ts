/**
 * TTL Map - entries expire after timeout
 * Optimized with MinHeap for O(log n) insert and O(k) cleanup
 */

import { MinHeap } from './minHeap';

/**
 * TTL Map - entries expire after timeout
 * Optimized with MinHeap for O(log n) insert and O(k) cleanup
 *
 * IMPORTANT: You MUST call stop() when done with this instance to prevent memory leaks.
 * The cleanup interval will keep running until stop() is called, preventing the instance
 * from being garbage collected.
 *
 * @example
 * ```typescript
 * const map = new TTLMap<string, number>(60_000); // 60s TTL
 * try {
 *   map.set('key', 123);
 *   // use map...
 * } finally {
 *   map.stop(); // REQUIRED: stops cleanup interval
 * }
 * ```
 *
 * Memory leak prevention:
 * - Each heap entry stores (expiresAt, key)
 * - During cleanup, we verify the key still exists in cache AND has matching expiresAt
 * - Stale entries (deleted keys or updated TTLs) are skipped and removed from heap
 * - Periodic compaction rebuilds heap when stale ratio exceeds threshold
 */
export class TTLMap<K, V> {
  private readonly cache = new Map<K, { value: V; expiresAt: number }>();
  private readonly ttlMs: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Expiry heap: MinHeap of (expiresAt, key) for efficient cleanup
   * O(log n) insert instead of O(n) with array splice
   */
  private readonly expiryHeap = new MinHeap<{ expiresAt: number; key: K }>(
    (a, b) => a.expiresAt - b.expiresAt
  );

  /** Count of stale entries in heap (deleted or updated keys) */
  private staleCount = 0;

  /** Rebuild heap when stale entries exceed this ratio of heap size */
  private static readonly COMPACTION_THRESHOLD = 0.5;

  /** Minimum heap size before considering compaction (avoid frequent rebuilds for small heaps) */
  private static readonly MIN_COMPACTION_SIZE = 100;

  /**
   * Create a new TTLMap instance.
   *
   * @param ttlMs - Default time-to-live for entries in milliseconds
   * @param cleanupIntervalMs - Interval between cleanup runs (default: 60000ms / 1 minute).
   *                           Lower values = more frequent cleanup but higher CPU usage.
   *                           Set based on expected entry volume and TTL duration.
   */
  constructor(ttlMs: number, cleanupIntervalMs: number = 60_000) {
    this.ttlMs = ttlMs;
    this.startCleanup(cleanupIntervalMs);
  }

  private startCleanup(intervalMs: number): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, intervalMs);
  }

  /** O(k log n) cleanup where k = expired entries */
  private cleanup(): void {
    const now = Date.now();

    // Remove expired entries from heap - O(k log n)
    while (!this.expiryHeap.isEmpty) {
      const top = this.expiryHeap.peek();
      if (!top || top.expiresAt > now) break;

      this.expiryHeap.pop();
      const { key, expiresAt } = top;

      // Verify entry still exists and has same expiry (might have been updated or deleted)
      const entry = this.cache.get(key);
      if (entry?.expiresAt === expiresAt) {
        // Valid expired entry - delete from cache
        this.cache.delete(key);
      } else {
        // Stale heap entry (key deleted or TTL updated) - already removed, decrement counter
        if (this.staleCount > 0) this.staleCount--;
      }
    }

    // Compact heap if too many stale entries accumulated
    this.maybeCompact();
  }

  /**
   * Rebuild heap if stale entry ratio exceeds threshold
   * This prevents unbounded heap growth from delete() and set() updates
   */
  private maybeCompact(): void {
    const heapSize = this.expiryHeap.size;
    if (
      heapSize >= TTLMap.MIN_COMPACTION_SIZE &&
      this.staleCount / heapSize > TTLMap.COMPACTION_THRESHOLD
    ) {
      this.rebuildHeap();
    }
  }

  /** Rebuild heap with only valid entries - O(n log n) */
  private rebuildHeap(): void {
    this.expiryHeap.clear();
    this.staleCount = 0;

    // Re-add all valid cache entries to heap
    for (const [key, entry] of this.cache) {
      this.expiryHeap.push({ expiresAt: entry.expiresAt, key });
    }
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
      this.staleCount++; // Heap entry is now stale
      return undefined;
    }
    return entry.value;
  }

  /** O(log n) insert with MinHeap instead of O(n) with array splice */
  set(key: K, value: V, ttlMs?: number): void {
    const expiresAt = Date.now() + (ttlMs ?? this.ttlMs);

    // Check if key already exists - old heap entry becomes stale
    if (this.cache.has(key)) {
      this.staleCount++;
    }

    this.cache.set(key, { value, expiresAt });

    // Add to expiry heap - O(log n) with MinHeap
    this.expiryHeap.push({ expiresAt, key });
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: K): boolean {
    const existed = this.cache.delete(key);
    if (existed) {
      // Heap entry is now stale - will be cleaned up lazily or during compaction
      this.staleCount++;
    }
    return existed;
  }

  clear(): void {
    this.cache.clear();
    this.expiryHeap.clear();
    this.staleCount = 0;
  }

  /**
   * Stop the cleanup interval. MUST be called when done with this instance
   * to prevent memory leaks. The interval keeps a reference to the instance,
   * preventing garbage collection until stop() is called.
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  get size(): number {
    return this.cache.size;
  }

  /** Get heap size (for debugging/monitoring) */
  get heapSize(): number {
    return this.expiryHeap.size;
  }

  /** Get count of stale heap entries (for debugging/monitoring) */
  get staleEntryCount(): number {
    return this.staleCount;
  }
}
