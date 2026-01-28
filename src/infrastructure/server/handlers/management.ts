/**
 * Management Command Handlers
 * Cancel, Progress, Pause, Resume, Drain, Stats, Metrics
 */

import type { Command } from '../../../domain/types/command';
import type { Response } from '../../../domain/types/response';
import * as resp from '../../../domain/types/response';
import { jobId } from '../../../domain/types/job';
import type { HandlerContext } from '../types';

/** Handle Cancel command */
export async function handleCancel(
  cmd: Extract<Command, { cmd: 'Cancel' }>,
  ctx: HandlerContext,
  reqId?: string
): Promise<Response> {
  const success = await ctx.queueManager.cancel(jobId(BigInt(cmd.id)));
  return success
    ? resp.ok(undefined, reqId)
    : resp.error('Job not found or cannot be cancelled', reqId);
}

/** Handle Progress command */
export async function handleProgress(
  cmd: Extract<Command, { cmd: 'Progress' }>,
  ctx: HandlerContext,
  reqId?: string
): Promise<Response> {
  const success = await ctx.queueManager.updateProgress(
    jobId(BigInt(cmd.id)),
    cmd.progress,
    cmd.message
  );
  return success ? resp.ok(undefined, reqId) : resp.error('Job not found or not active', reqId);
}

/** Handle GetProgress command */
export async function handleGetProgress(
  cmd: Extract<Command, { cmd: 'GetProgress' }>,
  ctx: HandlerContext,
  reqId?: string
): Promise<Response> {
  const progress = ctx.queueManager.getProgress(jobId(BigInt(cmd.id)));
  if (!progress) return resp.error('Job not found or not active', reqId);
  return {
    ok: true,
    progress: progress.progress,
    message: progress.message,
    reqId,
  } as Response;
}

/** Handle Pause command */
export async function handlePause(
  cmd: Extract<Command, { cmd: 'Pause' }>,
  ctx: HandlerContext,
  reqId?: string
): Promise<Response> {
  ctx.queueManager.pause(cmd.queue);
  return resp.ok(undefined, reqId);
}

/** Handle Resume command */
export async function handleResume(
  cmd: Extract<Command, { cmd: 'Resume' }>,
  ctx: HandlerContext,
  reqId?: string
): Promise<Response> {
  ctx.queueManager.resume(cmd.queue);
  return resp.ok(undefined, reqId);
}

/** Handle Drain command */
export async function handleDrain(
  cmd: Extract<Command, { cmd: 'Drain' }>,
  ctx: HandlerContext,
  reqId?: string
): Promise<Response> {
  const count = ctx.queueManager.drain(cmd.queue);
  return { ok: true, count, reqId } as Response;
}

/** Handle Stats command */
export function handleStats(ctx: HandlerContext, reqId?: string): Response {
  const s = ctx.queueManager.getStats();
  return resp.stats(
    {
      queued: s.waiting,
      processing: s.active,
      delayed: s.delayed,
      dlq: s.dlq,
      completed: s.completed,
      uptime: s.uptime,
      pushPerSec: 0,
      pullPerSec: 0,
    },
    reqId
  );
}

/** Handle Metrics command */
export function handleMetrics(ctx: HandlerContext, reqId?: string): Response {
  const s = ctx.queueManager.getStats();
  return resp.metrics(
    {
      totalPushed: Number(s.totalPushed),
      totalPulled: Number(s.totalPulled),
      totalCompleted: Number(s.totalCompleted),
      totalFailed: Number(s.totalFailed),
      avgLatencyMs: 0,
      avgProcessingMs: 0,
      memoryUsageMb: process.memoryUsage().heapUsed / 1024 / 1024,
      sqliteSizeMb: 0,
      activeConnections: 0,
    },
    reqId
  );
}
