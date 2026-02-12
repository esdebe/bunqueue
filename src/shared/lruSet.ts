/**
 * LRU Set - Set with automatic least-recently-used eviction
 */

/** Set-like interface for LRU compatibility */
export interface SetLike<T> {
  add(value: T): void;
  has(value: T): boolean;
  delete(value: T): boolean;
  clear(): void;
  readonly size: number;
}

/** Node in the doubly-linked list for LRUSet */
interface LRUSetNode<T> {
  value: T;
  prev: LRUSetNode<T> | null;
  next: LRUSetNode<T> | null;
}

/**
 * LRU Set - automatically evicts least recently used entries
 * Optimized with doubly-linked list for O(1) move-to-front
 */
export class LRUSet<T> implements SetLike<T> {
  private readonly cache = new Map<T, LRUSetNode<T>>();
  private readonly maxSize: number;
  private readonly onEvict?: (value: T) => void;

  // Doubly-linked list head (most recent) and tail (least recent)
  private head: LRUSetNode<T> | null = null;
  private tail: LRUSetNode<T> | null = null;

  constructor(maxSize: number, onEvict?: (value: T) => void) {
    this.maxSize = maxSize;
    this.onEvict = onEvict;
  }

  /** Move node to front - O(1) */
  private moveToFront(node: LRUSetNode<T>): void {
    if (node === this.head) return;

    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;
    if (node === this.tail) this.tail = node.prev;

    node.prev = null;
    node.next = this.head;
    if (this.head) this.head.prev = node;
    this.head = node;
    this.tail ??= node;
  }

  /** Remove node from list - O(1) */
  private removeNode(node: LRUSetNode<T>): void {
    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;
    if (node === this.head) this.head = node.next;
    if (node === this.tail) this.tail = node.prev;
  }

  /** Add node to front - O(1) */
  private addToFront(node: LRUSetNode<T>): void {
    node.prev = null;
    node.next = this.head;
    if (this.head) this.head.prev = node;
    this.head = node;
    this.tail ??= node;
  }

  add(value: T): void {
    const existing = this.cache.get(value);

    if (existing) {
      // Move to front
      this.moveToFront(existing);
    } else {
      // Evict if at capacity
      if (this.cache.size >= this.maxSize && this.tail) {
        const evicted = this.tail;
        this.cache.delete(evicted.value);
        this.removeNode(evicted);
        this.onEvict?.(evicted.value);
      }

      // Add new node
      const node: LRUSetNode<T> = { value, prev: null, next: null };
      this.cache.set(value, node);
      this.addToFront(node);
    }
  }

  has(value: T): boolean {
    return this.cache.has(value);
  }

  delete(value: T): boolean {
    const node = this.cache.get(value);
    if (!node) return false;

    this.removeNode(node);
    return this.cache.delete(value);
  }

  clear(): void {
    this.cache.clear();
    this.head = null;
    this.tail = null;
  }

  get size(): number {
    return this.cache.size;
  }

  *values(): IterableIterator<T> {
    // Iterate from tail (oldest) to head (newest) to match original Set behavior
    let current = this.tail;
    while (current) {
      yield current.value;
      current = current.prev;
    }
  }

  [Symbol.iterator](): IterableIterator<T> {
    return this.values();
  }
}
