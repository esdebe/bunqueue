/**
 * LRU Map - Map with automatic least-recently-used eviction
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

/** Node in the doubly-linked list for LRU tracking */
interface LRUNode<K, V> {
  key: K;
  value: V;
  prev: LRUNode<K, V> | null;
  next: LRUNode<K, V> | null;
}

/**
 * LRU Map - automatically evicts least recently used entries
 * Optimized with doubly-linked list for O(1) move-to-front
 * without delete+re-insert overhead
 */
export class LRUMap<K, V> implements MapLike<K, V> {
  private readonly cache = new Map<K, LRUNode<K, V>>();
  private readonly maxSize: number;
  private readonly onEvict?: (key: K, value: V) => void;

  // Doubly-linked list head (most recent) and tail (least recent)
  private head: LRUNode<K, V> | null = null;
  private tail: LRUNode<K, V> | null = null;

  constructor(maxSize: number, onEvict?: (key: K, value: V) => void) {
    this.maxSize = maxSize;
    this.onEvict = onEvict;
  }

  /** Move node to front (most recently used) - O(1) */
  private moveToFront(node: LRUNode<K, V>): void {
    if (node === this.head) return; // Already at front

    // Detach from current position
    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;
    if (node === this.tail) this.tail = node.prev;

    // Move to front
    node.prev = null;
    node.next = this.head;
    if (this.head) this.head.prev = node;
    this.head = node;
    this.tail ??= node;
  }

  /** Remove node from list - O(1) */
  private removeNode(node: LRUNode<K, V>): void {
    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;
    if (node === this.head) this.head = node.next;
    if (node === this.tail) this.tail = node.prev;
  }

  /** Add node to front - O(1) */
  private addToFront(node: LRUNode<K, V>): void {
    node.prev = null;
    node.next = this.head;
    if (this.head) this.head.prev = node;
    this.head = node;
    this.tail ??= node;
  }

  get(key: K): V | undefined {
    const node = this.cache.get(key);
    if (!node) return undefined;

    // Move to front - O(1) without delete+re-insert
    this.moveToFront(node);
    return node.value;
  }

  set(key: K, value: V): void {
    const existing = this.cache.get(key);

    if (existing) {
      // Update value and move to front
      existing.value = value;
      this.moveToFront(existing);
    } else {
      // Evict if at capacity
      if (this.cache.size >= this.maxSize && this.tail) {
        const evicted = this.tail;
        this.cache.delete(evicted.key);
        this.removeNode(evicted);
        this.onEvict?.(evicted.key, evicted.value);
      }

      // Add new node
      const node: LRUNode<K, V> = { key, value, prev: null, next: null };
      this.cache.set(key, node);
      this.addToFront(node);
    }
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  delete(key: K): boolean {
    const node = this.cache.get(key);
    if (!node) return false;

    this.removeNode(node);
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.head = null;
    this.tail = null;
  }

  get size(): number {
    return this.cache.size;
  }

  *keys(): IterableIterator<K> {
    // Iterate from tail (oldest) to head (newest) to match original Map behavior
    let current = this.tail;
    while (current) {
      yield current.key;
      current = current.prev;
    }
  }

  *values(): IterableIterator<V> {
    // Iterate from tail (oldest) to head (newest) to match original Map behavior
    let current = this.tail;
    while (current) {
      yield current.value;
      current = current.prev;
    }
  }

  *entries(): IterableIterator<[K, V]> {
    // Iterate from tail (oldest) to head (newest) to match original Map behavior
    let current = this.tail;
    while (current) {
      yield [current.key, current.value];
      current = current.prev;
    }
  }

  forEach(callback: (value: V, key: K) => void): void {
    // Iterate from tail (oldest) to head (newest) to match original Map behavior
    let current = this.tail;
    while (current) {
      callback(current.value, current.key);
      current = current.prev;
    }
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }
}
