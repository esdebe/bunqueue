/**
 * Async Lock implementation
 * Provides read-write locks with timeout support
 */

/** Lock acquisition result */
export interface LockGuard {
  release(): void;
}

/** Lock timeout error */
export class LockTimeoutError extends Error {
  constructor(message: string = 'Lock acquisition timed out') {
    super(message);
    this.name = 'LockTimeoutError';
  }
}

/**
 * Simple async mutex lock
 * FIFO ordering for fairness
 */
export class AsyncLock {
  private locked = false;
  private readonly queue: Array<() => void> = [];

  /**
   * Acquire the lock
   * @param timeoutMs - Maximum time to wait (default: 5000ms)
   */
  async acquire(timeoutMs: number = 5000): Promise<LockGuard> {
    const start = Date.now();

    while (this.locked) {
      const remaining = timeoutMs - (Date.now() - start);
      if (remaining <= 0) {
        throw new LockTimeoutError();
      }

      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          const idx = this.queue.indexOf(resolve);
          if (idx !== -1) this.queue.splice(idx, 1);
          resolve();
        }, remaining);

        this.queue.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }

    this.locked = true;

    return {
      release: () => {
        this.locked = false;
        const next = this.queue.shift();
        if (next) next();
      },
    };
  }

  /** Check if lock is held */
  isLocked(): boolean {
    return this.locked;
  }

  /** Get queue length */
  getQueueLength(): number {
    return this.queue.length;
  }
}

/**
 * Read-Write Lock
 * Multiple readers OR single writer
 * Writers have priority to prevent starvation
 */
export class RWLock {
  private readers = 0;
  private writer = false;
  private writerWaiting = 0;
  private readonly readerQueue: Array<() => void> = [];
  private readonly writerQueue: Array<() => void> = [];

  /**
   * Acquire read lock
   * Multiple readers can hold simultaneously
   */
  async acquireRead(timeoutMs: number = 5000): Promise<LockGuard> {
    const start = Date.now();

    // Wait if writer is active or writers are waiting (writer priority)
    while (this.writer || this.writerWaiting > 0) {
      const remaining = timeoutMs - (Date.now() - start);
      if (remaining <= 0) {
        throw new LockTimeoutError('Read lock acquisition timed out');
      }

      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          const idx = this.readerQueue.indexOf(resolve);
          if (idx !== -1) this.readerQueue.splice(idx, 1);
          resolve();
        }, remaining);

        this.readerQueue.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }

    this.readers++;

    return {
      release: () => {
        this.readers--;
        if (this.readers === 0 && this.writerWaiting > 0) {
          const next = this.writerQueue.shift();
          if (next) next();
        }
      },
    };
  }

  /**
   * Acquire write lock
   * Exclusive access, no readers or other writers
   */
  async acquireWrite(timeoutMs: number = 5000): Promise<LockGuard> {
    const start = Date.now();
    this.writerWaiting++;

    try {
      while (this.writer || this.readers > 0) {
        const remaining = timeoutMs - (Date.now() - start);
        if (remaining <= 0) {
          throw new LockTimeoutError('Write lock acquisition timed out');
        }

        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            const idx = this.writerQueue.indexOf(resolve);
            if (idx !== -1) this.writerQueue.splice(idx, 1);
            resolve();
          }, remaining);

          this.writerQueue.push(() => {
            clearTimeout(timer);
            resolve();
          });
        });
      }

      this.writerWaiting--;
      this.writer = true;

      return {
        release: () => {
          this.writer = false;
          // Notify waiting writers first (priority)
          if (this.writerWaiting > 0) {
            const next = this.writerQueue.shift();
            if (next) next();
          } else {
            // Then notify all waiting readers
            const readers = this.readerQueue.splice(0);
            for (const reader of readers) {
              reader();
            }
          }
        },
      };
    } catch (e) {
      this.writerWaiting--;
      throw e;
    }
  }

  /** Get current state */
  getState(): { readers: number; writer: boolean; writerWaiting: number } {
    return {
      readers: this.readers,
      writer: this.writer,
      writerWaiting: this.writerWaiting,
    };
  }
}

/**
 * Execute with lock, ensuring release on error
 */
export async function withLock<T>(
  lock: AsyncLock,
  fn: () => T | Promise<T>,
  timeoutMs?: number
): Promise<T> {
  const guard = await lock.acquire(timeoutMs);
  try {
    return await fn();
  } finally {
    guard.release();
  }
}

/**
 * Execute with read lock
 */
export async function withReadLock<T>(
  lock: RWLock,
  fn: () => T | Promise<T>,
  timeoutMs?: number
): Promise<T> {
  const guard = await lock.acquireRead(timeoutMs);
  try {
    return await fn();
  } finally {
    guard.release();
  }
}

/**
 * Execute with write lock
 */
export async function withWriteLock<T>(
  lock: RWLock,
  fn: () => T | Promise<T>,
  timeoutMs?: number
): Promise<T> {
  const guard = await lock.acquireWrite(timeoutMs);
  try {
    return await fn();
  } finally {
    guard.release();
  }
}
