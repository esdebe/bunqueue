/**
 * Command Handler Router
 * Routes commands to appropriate handlers
 */

import type { Command } from '../../domain/types/command';
import type { Response } from '../../domain/types/response';
import * as resp from '../../domain/types/response';
import { constantTimeEqual } from '../../shared/hash';
import type { HandlerContext } from './types';

// Import handlers
import {
  handlePush,
  handlePushBatch,
  handlePull,
  handlePullBatch,
  handleAck,
  handleAckBatch,
  handleFail,
} from './handlers/core';

import {
  handleGetJob,
  handleGetState,
  handleGetResult,
  handleGetJobCounts,
  handleGetJobByCustomId,
  handleGetJobs,
} from './handlers/query';

import {
  handleCancel,
  handleProgress,
  handleGetProgress,
  handlePause,
  handleResume,
  handleDrain,
  handleStats,
  handleMetrics,
} from './handlers/management';

import { handleDlq, handleRetryDlq, handlePurgeDlq } from './handlers/dlq';

import { handleCron, handleCronDelete, handleCronList } from './handlers/cron';

import {
  handleUpdate,
  handleChangePriority,
  handlePromote,
  handleMoveToDelayed,
  handleDiscard,
  handleWaitJob,
  handleIsPaused,
  handleObliterate,
  handleListQueues,
  handleClean,
  handleCount,
  handleRateLimit,
  handleRateLimitClear,
  handleSetConcurrency,
  handleClearConcurrency,
} from './handlers/advanced';

import {
  handleAddLog,
  handleGetLogs,
  handleHeartbeat,
  handleRegisterWorker,
  handleUnregisterWorker,
  handleListWorkers,
  handleAddWebhook,
  handleRemoveWebhook,
  handleListWebhooks,
  handlePrometheus,
} from './handlers/monitoring';

// Re-export types
export type { HandlerContext } from './types';

/**
 * Handle authentication command
 */
function handleAuth(
  cmd: Extract<Command, { cmd: 'Auth' }>,
  ctx: HandlerContext,
  reqId?: string
): Response {
  for (const token of ctx.authTokens) {
    if (constantTimeEqual(cmd.token, token)) {
      ctx.authenticated = true;
      return resp.ok(undefined, reqId);
    }
  }
  return resp.error('Invalid token', reqId);
}

/**
 * Main command handler - routes to specific handlers
 */
export async function handleCommand(cmd: Command, ctx: HandlerContext): Promise<Response> {
  const reqId = cmd.reqId;

  try {
    // Auth command is always allowed
    if (cmd.cmd === 'Auth') {
      return handleAuth(cmd, ctx, reqId);
    }

    // Check authentication if tokens are configured
    if (ctx.authTokens.size > 0 && !ctx.authenticated) {
      return resp.error('Not authenticated', reqId);
    }

    // Route to handler
    switch (cmd.cmd) {
      // Core operations
      case 'PUSH':
        return await handlePush(cmd, ctx, reqId);
      case 'PUSHB':
        return await handlePushBatch(cmd, ctx, reqId);
      case 'PULL':
        return await handlePull(cmd, ctx, reqId);
      case 'PULLB':
        return await handlePullBatch(cmd, ctx, reqId);
      case 'ACK':
        return await handleAck(cmd, ctx, reqId);
      case 'ACKB':
        return await handleAckBatch(cmd, ctx, reqId);
      case 'FAIL':
        return await handleFail(cmd, ctx, reqId);

      // Query operations
      case 'GetJob':
        return await handleGetJob(cmd, ctx, reqId);
      case 'GetState':
        return await handleGetState(cmd, ctx, reqId);
      case 'GetResult':
        return await handleGetResult(cmd, ctx, reqId);
      case 'GetJobCounts':
        return await handleGetJobCounts(cmd, ctx, reqId);
      case 'GetJobByCustomId':
        return await handleGetJobByCustomId(cmd, ctx, reqId);
      case 'GetJobs':
        return await handleGetJobs(cmd, ctx, reqId);
      case 'Count':
        return await handleCount(cmd, ctx, reqId);
      case 'GetProgress':
        return await handleGetProgress(cmd, ctx, reqId);

      // Management operations
      case 'Cancel':
        return await handleCancel(cmd, ctx, reqId);
      case 'Progress':
        return await handleProgress(cmd, ctx, reqId);
      case 'Update':
        return await handleUpdate(cmd, ctx, reqId);
      case 'ChangePriority':
        return await handleChangePriority(cmd, ctx, reqId);
      case 'Promote':
        return await handlePromote(cmd, ctx, reqId);
      case 'MoveToDelayed':
        return await handleMoveToDelayed(cmd, ctx, reqId);
      case 'Discard':
        return await handleDiscard(cmd, ctx, reqId);
      case 'WaitJob':
        return await handleWaitJob(cmd, ctx, reqId);

      // Queue control
      case 'Pause':
        return await handlePause(cmd, ctx, reqId);
      case 'Resume':
        return await handleResume(cmd, ctx, reqId);
      case 'IsPaused':
        return await handleIsPaused(cmd, ctx, reqId);
      case 'Drain':
        return await handleDrain(cmd, ctx, reqId);
      case 'Obliterate':
        return await handleObliterate(cmd, ctx, reqId);
      case 'ListQueues':
        return await handleListQueues(cmd, ctx, reqId);
      case 'Clean':
        return await handleClean(cmd, ctx, reqId);

      // DLQ operations
      case 'Dlq':
        return await handleDlq(cmd, ctx, reqId);
      case 'RetryDlq':
        return await handleRetryDlq(cmd, ctx, reqId);
      case 'PurgeDlq':
        return await handlePurgeDlq(cmd, ctx, reqId);

      // Rate limiting
      case 'RateLimit':
        return await handleRateLimit(cmd, ctx, reqId);
      case 'RateLimitClear':
        return await handleRateLimitClear(cmd, ctx, reqId);
      case 'SetConcurrency':
        return await handleSetConcurrency(cmd, ctx, reqId);
      case 'ClearConcurrency':
        return await handleClearConcurrency(cmd, ctx, reqId);

      // Cron operations
      case 'Cron':
        return await handleCron(cmd, ctx, reqId);
      case 'CronDelete':
        return await handleCronDelete(cmd, ctx, reqId);
      case 'CronList':
        return await handleCronList(cmd, ctx, reqId);

      // Monitoring
      case 'Stats':
        return handleStats(ctx, reqId);
      case 'Metrics':
        return handleMetrics(ctx, reqId);
      case 'Prometheus':
        return await handlePrometheus(cmd, ctx, reqId);

      // Job Logs
      case 'AddLog':
        return await handleAddLog(cmd, ctx, reqId);
      case 'GetLogs':
        return await handleGetLogs(cmd, ctx, reqId);

      // Workers
      case 'Heartbeat':
        return await handleHeartbeat(cmd, ctx, reqId);
      case 'RegisterWorker':
        return await handleRegisterWorker(cmd, ctx, reqId);
      case 'UnregisterWorker':
        return await handleUnregisterWorker(cmd, ctx, reqId);
      case 'ListWorkers':
        return await handleListWorkers(cmd, ctx, reqId);

      // Webhooks
      case 'AddWebhook':
        return await handleAddWebhook(cmd, ctx, reqId);
      case 'RemoveWebhook':
        return await handleRemoveWebhook(cmd, ctx, reqId);
      case 'ListWebhooks':
        return await handleListWebhooks(cmd, ctx, reqId);

      default:
        return resp.error(`Unknown command: ${(cmd as Command).cmd}`, reqId);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return resp.error(message, reqId);
  }
}
