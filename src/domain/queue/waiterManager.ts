/**
 * WaiterManager - Manages job availability notifications
 * Handles worker polling with timeout-based waiting
 */

/** Threshold for triggering full waiters cleanup */
const WAITERS_CLEANUP_THRESHOLD = 1000;

export class WaiterManager {
  /** Waiter entries with cancellation flag for O(1) cleanup */
  private readonly waiters: Array<{ resolve: () => void; cancelled: boolean }> = [];

  /** Pending notification flag - set when notify() is called with no waiters */
  private pendingNotification = false;

  /** Notify that jobs are available - wakes first non-cancelled waiter */
  notify(): void {
    // Clean up leading cancelled waiters first
    while (this.waiters.length > 0 && this.waiters[0].cancelled) {
      this.waiters.shift();
    }

    // Wake the first active waiter
    const waiter = this.waiters.shift();
    if (waiter && !waiter.cancelled) {
      waiter.resolve();
    } else {
      // No active waiter - set pending flag so next waitForJob returns immediately
      this.pendingNotification = true;
    }

    // Periodic full cleanup when array grows too large
    if (this.waiters.length > WAITERS_CLEANUP_THRESHOLD) {
      this.cleanupWaiters();
    }
  }

  /** Wait for a job to become available (with timeout) */
  waitForJob(timeoutMs: number): Promise<void> {
    if (timeoutMs <= 0) return Promise.resolve();

    // Check for pending notification - if set, clear it and return immediately
    if (this.pendingNotification) {
      this.pendingNotification = false;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      const waiter = { resolve, cancelled: false };
      const cleanup = () => {
        if (waiter.cancelled) return;
        waiter.cancelled = true;
        resolve();
      };
      this.waiters.push(waiter);
      setTimeout(cleanup, timeoutMs);
    });
  }

  /** Remove all cancelled waiters from the array */
  private cleanupWaiters(): void {
    const active = this.waiters.filter((w) => !w.cancelled);
    this.waiters.length = 0;
    this.waiters.push(...active);
  }

  /** Current number of waiters */
  get length(): number {
    return this.waiters.length;
  }
}
