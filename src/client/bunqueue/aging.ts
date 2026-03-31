/**
 * Bunqueue — Priority Aging
 * Automatically boosts priority of old waiting jobs.
 */

import type { Queue } from '../queue/queue';
import type { PriorityAgingConfig } from './types';

export class PriorityAger<T = unknown> {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly config: PriorityAgingConfig;
  private readonly queue: Queue<T>;

  constructor(config: PriorityAgingConfig, queue: Queue<T>) {
    this.config = config;
    this.queue = queue;
  }

  start(): void {
    const interval = this.config.interval ?? 60000;
    this.timer = setInterval(() => {
      void this.tick();
    }, interval);
  }

  private async tick(): Promise<void> {
    const minAge = this.config.minAge ?? 60000;
    const boost = this.config.boost ?? 1;
    const maxPriority = this.config.maxPriority ?? 100;
    const maxScan = this.config.maxScan ?? 100;

    // Get both waiting and prioritized jobs (jobs with priority > 0 are "prioritized")
    const [waiting, prioritized] = await Promise.all([
      this.queue.getWaitingAsync(0, maxScan),
      this.queue.getJobsAsync({ state: 'prioritized', start: 0, end: maxScan }),
    ]);
    const jobs = [...waiting, ...prioritized];
    const now = Date.now();

    for (const job of jobs) {
      const age = now - job.timestamp;
      if (age >= minAge && job.priority < maxPriority) {
        const newPriority = Math.min(job.priority + boost, maxPriority);
        try {
          await this.queue.changeJobPriority(job.id, {
            priority: newPriority,
          });
        } catch {
          // Best-effort — job may have been processed
        }
      }
    }
  }

  destroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
