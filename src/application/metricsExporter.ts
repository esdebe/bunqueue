/**
 * Metrics Exporter
 * Prometheus metrics generation
 */

import type { WorkerManager } from './workerManager';
import type { WebhookManager } from './webhookManager';

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
  webhookManager: WebhookManager
): string {
  const workerStats = workerManager.getStats();
  const webhookStats = webhookManager.getStats();

  const lines: string[] = [
    '# HELP bunq_jobs_waiting Number of jobs waiting in queue',
    '# TYPE bunq_jobs_waiting gauge',
    `bunq_jobs_waiting ${stats.waiting}`,
    '',
    '# HELP bunq_jobs_delayed Number of delayed jobs',
    '# TYPE bunq_jobs_delayed gauge',
    `bunq_jobs_delayed ${stats.delayed}`,
    '',
    '# HELP bunq_jobs_active Number of jobs being processed',
    '# TYPE bunq_jobs_active gauge',
    `bunq_jobs_active ${stats.active}`,
    '',
    '# HELP bunq_jobs_dlq Number of jobs in dead letter queue',
    '# TYPE bunq_jobs_dlq gauge',
    `bunq_jobs_dlq ${stats.dlq}`,
    '',
    '# HELP bunq_jobs_completed Number of completed jobs',
    '# TYPE bunq_jobs_completed gauge',
    `bunq_jobs_completed ${stats.completed}`,
    '',
    '# HELP bunq_jobs_pushed_total Total jobs pushed',
    '# TYPE bunq_jobs_pushed_total counter',
    `bunq_jobs_pushed_total ${stats.totalPushed}`,
    '',
    '# HELP bunq_jobs_pulled_total Total jobs pulled',
    '# TYPE bunq_jobs_pulled_total counter',
    `bunq_jobs_pulled_total ${stats.totalPulled}`,
    '',
    '# HELP bunq_jobs_completed_total Total jobs completed',
    '# TYPE bunq_jobs_completed_total counter',
    `bunq_jobs_completed_total ${stats.totalCompleted}`,
    '',
    '# HELP bunq_jobs_failed_total Total jobs failed',
    '# TYPE bunq_jobs_failed_total counter',
    `bunq_jobs_failed_total ${stats.totalFailed}`,
    '',
    '# HELP bunq_uptime_seconds Server uptime in seconds',
    '# TYPE bunq_uptime_seconds gauge',
    `bunq_uptime_seconds ${Math.floor(stats.uptime / 1000)}`,
    '',
    '# HELP bunq_cron_jobs_total Total number of cron jobs',
    '# TYPE bunq_cron_jobs_total gauge',
    `bunq_cron_jobs_total ${stats.cronJobs}`,
    '',
    '# HELP bunq_workers_total Total number of registered workers',
    '# TYPE bunq_workers_total gauge',
    `bunq_workers_total ${workerStats.total}`,
    '',
    '# HELP bunq_workers_active Number of active workers',
    '# TYPE bunq_workers_active gauge',
    `bunq_workers_active ${workerStats.active}`,
    '',
    '# HELP bunq_workers_processed_total Total jobs processed by workers',
    '# TYPE bunq_workers_processed_total counter',
    `bunq_workers_processed_total ${workerStats.totalProcessed}`,
    '',
    '# HELP bunq_workers_failed_total Total jobs failed by workers',
    '# TYPE bunq_workers_failed_total counter',
    `bunq_workers_failed_total ${workerStats.totalFailed}`,
    '',
    '# HELP bunq_webhooks_total Total number of webhooks',
    '# TYPE bunq_webhooks_total gauge',
    `bunq_webhooks_total ${webhookStats.total}`,
    '',
    '# HELP bunq_webhooks_enabled Number of enabled webhooks',
    '# TYPE bunq_webhooks_enabled gauge',
    `bunq_webhooks_enabled ${webhookStats.enabled}`,
  ];

  return lines.join('\n');
}
