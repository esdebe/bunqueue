/**
 * LRU (Least Recently Used) Cache implementations
 * Bounded collections with automatic eviction
 */

/** Map-like interface for LRU compatibility */
export interface MapLike<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  has(key: K): boolean;
  delete(key: K): boolean;
  clear(): void;
  readonly size: number;
}

/** Set-like interface for LRU compatibility */
export interface SetLike<T> {
  add(value: T): void;
  has(value: T): boolean;
  delete(value: T): boolean;
  clear(): void;
  readonly size: number;
}

/**
 * LRU Map - automatically evicts least recently used entries
 */
export class LRUMap<K, V> implements MapLike<K, V> {
  private readonly cache = new Map<K, V>();
  private readonly maxSize: number;
  private readonly onEvict?: (key: K, value: V) => void;

  constructor(maxSize: number, onEvict?: (key: K, value: V) => void) {
    this.maxSize = maxSize;
    this.onEvict = onEvict;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    // If key exists, delete and re-add to update position
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict oldest entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        const evictedValue = this.cache.get(firstKey);
        this.cache.delete(firstKey);
        if (evictedValue !== undefined) {
          this.onEvict?.(firstKey, evictedValue);
        }
      }
    }
    this.cache.set(key, value);
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

/**
 * LRU Set - automatically evicts least recently used entries
 */
export class LRUSet<T> implements SetLike<T> {
  private readonly cache = new Set<T>();
  private readonly maxSize: number;
  private readonly onEvict?: (value: T) => void;

  constructor(maxSize: number, onEvict?: (value: T) => void) {
    this.maxSize = maxSize;
    this.onEvict = onEvict;
  }

  add(value: T): void {
    // If value exists, delete and re-add to update position
    if (this.cache.has(value)) {
      this.cache.delete(value);
    } else if (this.cache.size >= this.maxSize) {
      // Evict oldest entry
      const firstValue = this.cache.values().next().value;
      if (firstValue !== undefined) {
        this.cache.delete(firstValue);
        this.onEvict?.(firstValue);
      }
    }
    this.cache.add(value);
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

/**
 * TTL Map - entries expire after timeout
 */
export class TTLMap<K, V> {
  private readonly cache = new Map<K, { value: V; expiresAt: number }>();
  private readonly ttlMs: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(ttlMs: number, cleanupIntervalMs: number = 60_000) {
    this.ttlMs = ttlMs;
    this.startCleanup(cleanupIntervalMs);
  }

  private startCleanup(intervalMs: number): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, intervalMs);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
      }
    }
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V, ttlMs?: number): void {
    const expiresAt = Date.now() + (ttlMs ?? this.ttlMs);
    this.cache.set(key, { value, expiresAt });
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  get size(): number {
    return this.cache.size;
  }
}
