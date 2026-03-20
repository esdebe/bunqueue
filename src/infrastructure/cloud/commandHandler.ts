/**
 * Cloud Command Handler
 * Processes commands received from the dashboard via WebSocket.
 * Only active when BUNQUEUE_CLOUD_REMOTE_COMMANDS=true.
 *
 * All commands are whitelisted — unknown actions are rejected.
 */

import type { QueueManager } from '../../application/queueManager';
import { cloudLog } from './logger';
import { COMMANDS } from './commands';

/** Incoming command from dashboard (fields at top level) */
export interface CloudCommand {
  type: 'command';
  id: string;
  action: string;
  queue?: string;
  jobId?: string;
  name?: string;
  schedule?: string;
  data?: unknown;
  config?: Record<string, unknown>;
  graceMs?: number;
  state?: string;
  limit?: number;
  offset?: number;
  priority?: number;
  delay?: number;
  url?: string;
  events?: string[];
  secret?: string;
  webhookId?: string;
  enabled?: boolean;
  keepLogs?: number;
  max?: number;
  concurrency?: number;
}

/** Result sent back to dashboard */
export interface CloudCommandResult {
  type: 'command_result';
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

/** Process a command and return the result */
export async function handleCommand(
  queueManager: QueueManager,
  cmd: CloudCommand
): Promise<CloudCommandResult> {
  const handler = COMMANDS[cmd.action];

  if (!handler) {
    cloudLog.warn('Unknown remote command', { action: cmd.action, id: cmd.id });
    return {
      type: 'command_result',
      id: cmd.id,
      success: false,
      error: `Unknown command: ${cmd.action}`,
    };
  }

  try {
    const data = await handler(queueManager, cmd);
    cloudLog.info('Remote command executed', { action: cmd.action, id: cmd.id });
    return { type: 'command_result', id: cmd.id, success: true, data };
  } catch (err) {
    cloudLog.error('Remote command failed', {
      action: cmd.action,
      id: cmd.id,
      error: String(err),
    });
    return {
      type: 'command_result',
      id: cmd.id,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
