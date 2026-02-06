/**
 * Metrics Exporter
 * Prometheus metrics generation
 */

import type { WorkerManager } from './workerManager';
import type { WebhookManager } from './webhookManager';
import type { PerQueueStats } from './statsManager';
import { latencyTracker } from './latencyTracker';

/** Stats data structure */
export interface QueueStats {
  waiting: number;
  delayed: number;
  active: number;
  dlq: number;
  completed: number;
  totalPushed: bigint;
  totalPulled: bigint;
  totalCompleted: bigint;
  totalFailed: bigint;
  uptime: number;
  cronJobs: number;
  cronPending: number;
}

/** Generate Prometheus metrics */
export function generatePrometheusMetrics(
  stats: QueueStats,
  workerManager: WorkerManager,
  webhookManager: WebhookManager,
  perQueueStats?: Map<string, PerQueueStats>
): string {
  const workerStats = workerManager.getStats();
  const webhookStats = webhookManager.getStats();

  const lines: string[] = [
    '# HELP bunqueue_jobs_waiting Number of jobs waiting in queue',
    '# TYPE bunqueue_jobs_waiting gauge',
    `bunqueue_jobs_waiting ${stats.waiting}`,
    '',
    '# HELP bunqueue_jobs_delayed Number of delayed jobs',
    '# TYPE bunqueue_jobs_delayed gauge',
    `bunqueue_jobs_delayed ${stats.delayed}`,
    '',
    '# HELP bunqueue_jobs_active Number of jobs being processed',
    '# TYPE bunqueue_jobs_active gauge',
    `bunqueue_jobs_active ${stats.active}`,
    '',
    '# HELP bunqueue_jobs_dlq Number of jobs in dead letter queue',
    '# TYPE bunqueue_jobs_dlq gauge',
    `bunqueue_jobs_dlq ${stats.dlq}`,
    '',
    '# HELP bunqueue_jobs_completed Number of completed jobs',
    '# TYPE bunqueue_jobs_completed gauge',
    `bunqueue_jobs_completed ${stats.completed}`,
    '',
    '# HELP bunqueue_jobs_pushed_total Total jobs pushed',
    '# TYPE bunqueue_jobs_pushed_total counter',
    `bunqueue_jobs_pushed_total ${stats.totalPushed}`,
    '',
    '# HELP bunqueue_jobs_pulled_total Total jobs pulled',
    '# TYPE bunqueue_jobs_pulled_total counter',
    `bunqueue_jobs_pulled_total ${stats.totalPulled}`,
    '',
    '# HELP bunqueue_jobs_completed_total Total jobs completed',
    '# TYPE bunqueue_jobs_completed_total counter',
    `bunqueue_jobs_completed_total ${stats.totalCompleted}`,
    '',
    '# HELP bunqueue_jobs_failed_total Total jobs failed',
    '# TYPE bunqueue_jobs_failed_total counter',
    `bunqueue_jobs_failed_total ${stats.totalFailed}`,
    '',
    '# HELP bunqueue_uptime_seconds Server uptime in seconds',
    '# TYPE bunqueue_uptime_seconds gauge',
    `bunqueue_uptime_seconds ${Math.floor(stats.uptime / 1000)}`,
    '',
    '# HELP bunqueue_cron_jobs_total Total number of cron jobs',
    '# TYPE bunqueue_cron_jobs_total gauge',
    `bunqueue_cron_jobs_total ${stats.cronJobs}`,
    '',
    '# HELP bunqueue_workers_total Total number of registered workers',
    '# TYPE bunqueue_workers_total gauge',
    `bunqueue_workers_total ${workerStats.total}`,
    '',
    '# HELP bunqueue_workers_active Number of active workers',
    '# TYPE bunqueue_workers_active gauge',
    `bunqueue_workers_active ${workerStats.active}`,
    '',
    '# HELP bunqueue_workers_processed_total Total jobs processed by workers',
    '# TYPE bunqueue_workers_processed_total counter',
    `bunqueue_workers_processed_total ${workerStats.totalProcessed}`,
    '',
    '# HELP bunqueue_workers_failed_total Total jobs failed by workers',
    '# TYPE bunqueue_workers_failed_total counter',
    `bunqueue_workers_failed_total ${workerStats.totalFailed}`,
    '',
    '# HELP bunqueue_webhooks_total Total number of webhooks',
    '# TYPE bunqueue_webhooks_total gauge',
    `bunqueue_webhooks_total ${webhookStats.total}`,
    '',
    '# HELP bunqueue_webhooks_enabled Number of enabled webhooks',
    '# TYPE bunqueue_webhooks_enabled gauge',
    `bunqueue_webhooks_enabled ${webhookStats.enabled}`,
  ];

  // Per-queue metrics
  if (perQueueStats && perQueueStats.size > 0) {
    lines.push('');
    lines.push('# HELP bunqueue_queue_jobs_waiting Number of waiting jobs per queue');
    lines.push('# TYPE bunqueue_queue_jobs_waiting gauge');
    for (const [queue, qs] of perQueueStats) {
      lines.push(`bunqueue_queue_jobs_waiting{queue="${queue}"} ${qs.waiting}`);
    }

    lines.push('');
    lines.push('# HELP bunqueue_queue_jobs_delayed Number of delayed jobs per queue');
    lines.push('# TYPE bunqueue_queue_jobs_delayed gauge');
    for (const [queue, qs] of perQueueStats) {
      lines.push(`bunqueue_queue_jobs_delayed{queue="${queue}"} ${qs.delayed}`);
    }

    lines.push('');
    lines.push('# HELP bunqueue_queue_jobs_active Number of active jobs per queue');
    lines.push('# TYPE bunqueue_queue_jobs_active gauge');
    for (const [queue, qs] of perQueueStats) {
      lines.push(`bunqueue_queue_jobs_active{queue="${queue}"} ${qs.active}`);
    }

    lines.push('');
    lines.push('# HELP bunqueue_queue_jobs_dlq Number of DLQ jobs per queue');
    lines.push('# TYPE bunqueue_queue_jobs_dlq gauge');
    for (const [queue, qs] of perQueueStats) {
      lines.push(`bunqueue_queue_jobs_dlq{queue="${queue}"} ${qs.dlq}`);
    }
  }

  // Append latency histograms
  const histogramOutput = latencyTracker.toPrometheus();
  if (histogramOutput) {
    lines.push('');
    lines.push(histogramOutput);
  }

  return lines.join('\n');
}
