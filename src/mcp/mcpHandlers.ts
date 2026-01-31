/**
 * MCP Tool Handlers
 * Implementation of tool operations for the bunqueue MCP server
 */

import { getSharedManager } from '../client/manager';
import { jobId } from '../domain/types/job';

export type ToolArgs = Record<string, unknown>;

interface JobData {
  name: string;
  data: unknown;
  priority?: number;
  delay?: number;
}

// Job Operations

export async function handleAddJob(args: ToolArgs) {
  const manager = getSharedManager();
  const job = await manager.push(args.queue as string, {
    data: { name: args.name as string, ...(args.data as object) },
    priority: args.priority as number | undefined,
    delay: args.delay as number | undefined,
    maxAttempts: args.attempts as number | undefined,
  });
  return { jobId: String(job.id), queue: args.queue, message: 'Job added successfully' };
}

export async function handleAddJobsBulk(args: ToolArgs) {
  const manager = getSharedManager();
  const jobs = args.jobs as JobData[];
  const inputs = jobs.map((j) => ({
    data: { name: j.name, ...(j.data as object) },
    priority: j.priority,
    delay: j.delay,
  }));
  const jobIds = await manager.pushBatch(args.queue as string, inputs);
  return { count: jobIds.length, jobIds: jobIds.map(String), queue: args.queue };
}

export async function handleGetJob(args: ToolArgs) {
  const manager = getSharedManager();
  const job = await manager.getJob(jobId(args.jobId as string));
  if (!job) return { error: 'Job not found' };
  const data = job.data as { name?: string } | null;
  return {
    id: String(job.id),
    name: data?.name ?? 'default',
    data: job.data,
    queue: job.queue,
    progress: job.progress,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    createdAt: new Date(job.createdAt).toISOString(),
  };
}

export async function handleCancelJob(args: ToolArgs) {
  const manager = getSharedManager();
  const cancelled = await manager.cancel(jobId(args.jobId as string));
  return { success: cancelled, jobId: args.jobId };
}

export async function handleUpdateProgress(args: ToolArgs) {
  const manager = getSharedManager();
  const updated = await manager.updateProgress(
    jobId(args.jobId as string),
    args.progress as number,
    args.message as string | undefined
  );
  return { success: updated, jobId: args.jobId, progress: args.progress };
}

// Queue Control

export function handlePauseQueue(args: ToolArgs) {
  const manager = getSharedManager();
  manager.pause(args.queue as string);
  return { success: true, queue: args.queue, message: 'Queue paused' };
}

export function handleResumeQueue(args: ToolArgs) {
  const manager = getSharedManager();
  manager.resume(args.queue as string);
  return { success: true, queue: args.queue, message: 'Queue resumed' };
}

export function handleDrainQueue(args: ToolArgs) {
  const manager = getSharedManager();
  const removed = manager.drain(args.queue as string);
  return { success: true, queue: args.queue, removed, message: `Removed ${removed} waiting jobs` };
}

export function handleObliterateQueue(args: ToolArgs) {
  const manager = getSharedManager();
  manager.obliterate(args.queue as string);
  return { success: true, queue: args.queue, message: 'Queue obliterated' };
}

export function handleListQueues() {
  const manager = getSharedManager();
  return { queues: manager.listQueues() };
}

export function handleCountJobs(args: ToolArgs) {
  const manager = getSharedManager();
  return { queue: args.queue, count: manager.count(args.queue as string) };
}

// Rate Limiting

export function handleSetRateLimit(args: ToolArgs) {
  const manager = getSharedManager();
  manager.setRateLimit(args.queue as string, args.limit as number);
  return { success: true, queue: args.queue, rateLimit: args.limit };
}

export function handleSetConcurrency(args: ToolArgs) {
  const manager = getSharedManager();
  manager.setConcurrency(args.queue as string, args.limit as number);
  return { success: true, queue: args.queue, concurrency: args.limit };
}

// DLQ Operations

export function handleGetDlq(args: ToolArgs) {
  const manager = getSharedManager();
  const limit = (args.limit as number) || 20;
  const jobs = manager.getDlq(args.queue as string, limit);
  return jobs.map((j) => {
    const data = j.data as { name?: string } | null;
    return {
      id: String(j.id),
      name: data?.name ?? 'default',
      data: j.data,
      attempts: j.attempts,
      createdAt: new Date(j.createdAt).toISOString(),
    };
  });
}

export function handleRetryDlq(args: ToolArgs) {
  const manager = getSharedManager();
  const id = args.jobId ? jobId(args.jobId as string) : undefined;
  const retried = manager.retryDlq(args.queue as string, id);
  return { success: true, queue: args.queue, retried };
}

export function handlePurgeDlq(args: ToolArgs) {
  const manager = getSharedManager();
  const purged = manager.purgeDlq(args.queue as string);
  return { success: true, queue: args.queue, purged };
}

// Cron Jobs

export function handleAddCron(args: ToolArgs) {
  const manager = getSharedManager();
  const cron = manager.addCron({
    name: args.name as string,
    queue: args.queue as string,
    data: args.data as Record<string, unknown>,
    schedule: args.schedule as string | undefined,
    repeatEvery: args.repeatEvery as number | undefined,
    priority: args.priority as number | undefined,
  });
  return {
    success: true,
    name: cron.name,
    queue: cron.queue,
    nextRun: cron.nextRun ? new Date(cron.nextRun).toISOString() : null,
  };
}

export function handleListCrons() {
  const manager = getSharedManager();
  return manager.listCrons().map((c) => ({
    name: c.name,
    queue: c.queue,
    schedule: c.schedule,
    repeatEvery: c.repeatEvery,
    nextRun: c.nextRun ? new Date(c.nextRun).toISOString() : null,
    executions: c.executions,
  }));
}

export function handleDeleteCron(args: ToolArgs) {
  const manager = getSharedManager();
  const deleted = manager.removeCron(args.name as string);
  return { success: deleted, name: args.name };
}

// Stats & Logs

export function handleGetStats(): Record<string, number> {
  const manager = getSharedManager();
  const stats = manager.getStats();
  // Convert BigInt to number for JSON serialization
  return JSON.parse(
    JSON.stringify(stats, (_key, value: unknown) =>
      typeof value === 'bigint' ? Number(value) : value
    )
  ) as Record<string, number>;
}

export function handleGetJobLogs(args: ToolArgs) {
  const manager = getSharedManager();
  return manager.getLogs(jobId(args.jobId as string));
}

export function handleAddJobLog(args: ToolArgs) {
  const manager = getSharedManager();
  const level = (args.level as 'info' | 'warn' | 'error' | undefined) ?? 'info';
  const added = manager.addLog(jobId(args.jobId as string), args.message as string, level);
  return { success: added, jobId: args.jobId };
}

// Handler registry

type ToolHandler = (args: ToolArgs) => unknown;

export const TOOL_HANDLERS = new Map<string, ToolHandler>([
  ['bunqueue_add_job', handleAddJob],
  ['bunqueue_add_jobs_bulk', handleAddJobsBulk],
  ['bunqueue_get_job', handleGetJob],
  ['bunqueue_cancel_job', handleCancelJob],
  ['bunqueue_update_progress', handleUpdateProgress],
  ['bunqueue_pause_queue', handlePauseQueue],
  ['bunqueue_resume_queue', handleResumeQueue],
  ['bunqueue_drain_queue', handleDrainQueue],
  ['bunqueue_obliterate_queue', handleObliterateQueue],
  ['bunqueue_list_queues', () => handleListQueues()],
  ['bunqueue_count_jobs', handleCountJobs],
  ['bunqueue_set_rate_limit', handleSetRateLimit],
  ['bunqueue_set_concurrency', handleSetConcurrency],
  ['bunqueue_get_dlq', handleGetDlq],
  ['bunqueue_retry_dlq', handleRetryDlq],
  ['bunqueue_purge_dlq', handlePurgeDlq],
  ['bunqueue_add_cron', handleAddCron],
  ['bunqueue_list_crons', () => handleListCrons()],
  ['bunqueue_delete_cron', handleDeleteCron],
  ['bunqueue_get_stats', () => handleGetStats()],
  ['bunqueue_get_job_logs', handleGetJobLogs],
  ['bunqueue_add_job_log', handleAddJobLog],
]);

export function handleToolCall(name: string, args: ToolArgs): unknown {
  const handler = TOOL_HANDLERS.get(name);
  if (!handler) throw new Error(`Unknown tool: ${name}`);
  return handler(args);
}
