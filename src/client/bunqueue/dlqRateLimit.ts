/**
 * Bunqueue — DLQ & Rate Limit helpers
 * Mixin-style functions that delegate to Queue methods.
 */

import type { Queue } from '../queue/queue';
import type { DlqConfig, DlqEntry, DlqStats, DlqFilter } from '../types';

export class DlqRateLimitManager<T = unknown> {
  constructor(private readonly queue: Queue<T>) {}

  // ── DLQ ──

  setDlqConfig(config: Partial<DlqConfig>): void {
    this.queue.setDlqConfig(config);
  }
  getDlqConfig(): DlqConfig {
    return this.queue.getDlqConfig();
  }
  getDlq(filter?: DlqFilter): DlqEntry<T>[] {
    return this.queue.getDlq(filter);
  }
  getDlqStats(): DlqStats {
    return this.queue.getDlqStats();
  }
  retryDlq(id?: string) {
    return this.queue.retryDlq(id);
  }
  purgeDlq() {
    return this.queue.purgeDlq();
  }

  // ── Rate Limiting ──

  setGlobalRateLimit(max: number, duration?: number): void {
    this.queue.setGlobalRateLimit(max, duration);
  }
  removeGlobalRateLimit(): void {
    this.queue.removeGlobalRateLimit();
  }
}
