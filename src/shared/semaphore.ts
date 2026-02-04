/**
 * Semaphore for concurrency limiting
 * Used to limit parallel operations (e.g., TCP command processing)
 */

export class Semaphore {
  private permits: number;
  private readonly maxPermits: number;
  private readonly waitQueue: Array<() => void> = [];

  constructor(maxPermits: number) {
    this.permits = maxPermits;
    this.maxPermits = maxPermits;
  }

  /** Acquire a permit, waiting if necessary */
  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    // Wait for a permit to be released
    return new Promise((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  /** Try to acquire a permit without waiting */
  tryAcquire(): boolean {
    if (this.permits > 0) {
      this.permits--;
      return true;
    }
    return false;
  }

  /** Release a permit */
  release(): void {
    const next = this.waitQueue.shift();
    if (next) {
      // Give permit to next waiter
      next();
    } else {
      // No waiters, increase available permits
      this.permits = Math.min(this.permits + 1, this.maxPermits);
    }
  }

  /** Get available permits */
  available(): number {
    return this.permits;
  }

  /** Get number of waiters */
  waiting(): number {
    return this.waitQueue.length;
  }
}

/**
 * Run function with semaphore-controlled concurrency
 */
export async function withSemaphore<T>(semaphore: Semaphore, fn: () => Promise<T>): Promise<T> {
  await semaphore.acquire();
  try {
    return await fn();
  } finally {
    semaphore.release();
  }
}
