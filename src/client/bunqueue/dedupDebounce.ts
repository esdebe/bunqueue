/**
 * Bunqueue — Deduplication & Debounce defaults merger
 */

import type { JobOptions } from '../types';
import type { BunqueueDeduplicationConfig, BunqueueDebounceConfig } from './types';

export class DedupDebounceMerger {
  private readonly dedup: BunqueueDeduplicationConfig | null;
  private readonly debounce: BunqueueDebounceConfig | null;

  constructor(dedup: BunqueueDeduplicationConfig | null, debounce: BunqueueDebounceConfig | null) {
    this.dedup = dedup;
    this.debounce = debounce;
  }

  get active(): boolean {
    return this.dedup !== null || this.debounce !== null;
  }

  merge(name: string, opts?: JobOptions, data?: unknown): JobOptions | undefined {
    if (!this.active) return opts;
    const merged: JobOptions = { ...opts };
    if (this.dedup && !merged.deduplication) {
      const dataKey = data !== undefined ? JSON.stringify(data) : '';
      merged.deduplication = {
        id: `${name}:${dataKey}`,
        ttl: this.dedup.ttl ?? 3600000,
        extend: this.dedup.extend,
        replace: this.dedup.replace,
      };
    }
    if (this.debounce && !merged.debounce) {
      merged.debounce = {
        id: name,
        ttl: this.debounce.ttl,
      };
    }
    return merged;
  }
}
