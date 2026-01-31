/**
 * WebSocket Handler - WebSocket client management
 */

import type { ServerWebSocket } from 'bun';
import type { JobEvent } from '../../domain/types/queue';
import { handleCommand, type HandlerContext } from './handler';
import { parseCommand, serializeResponse, errorResponse } from './protocol';
import { wsLog } from '../../shared/logger';

/** Singleton TextDecoder for WebSocket messages */
const textDecoder = new TextDecoder();

/** WebSocket client data */
export interface WsData {
  id: string;
  authenticated: boolean;
  queueFilter: string | null;
}

/**
 * WebSocket Handler - manages WebSocket clients and message handling
 */
export class WsHandler {
  private readonly clients = new Map<string, ServerWebSocket<WsData>>();

  /** Get client count */
  get size(): number {
    return this.clients.size;
  }

  /** Broadcast event to all matching clients */
  broadcast(event: JobEvent): void {
    const message = JSON.stringify(event);
    for (const [, ws] of this.clients) {
      if (!ws.data.queueFilter || ws.data.queueFilter === event.queue) {
        ws.send(message);
      }
    }
  }

  /** Handle WebSocket open */
  onOpen(ws: ServerWebSocket<WsData>): void {
    this.clients.set(ws.data.id, ws);
    wsLog.info('Client connected', { clientId: ws.data.id });
  }

  /** Handle WebSocket message */
  async onMessage(
    ws: ServerWebSocket<WsData>,
    message: string | Buffer,
    ctx: HandlerContext
  ): Promise<void> {
    const text = typeof message === 'string' ? message : textDecoder.decode(message);
    const cmd = parseCommand(text);

    if (!cmd) {
      ws.send(errorResponse('Invalid command'));
      return;
    }

    try {
      const response = await handleCommand(cmd, ctx);

      // Update authentication state
      if (cmd.cmd === 'Auth' && response.ok) {
        ws.data.authenticated = true;
      }

      ws.send(serializeResponse(response));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      ws.send(errorResponse(msg, cmd.reqId));
    }
  }

  /** Handle WebSocket close */
  onClose(ws: ServerWebSocket<WsData>): void {
    this.clients.delete(ws.data.id);
    wsLog.info('Client disconnected', { clientId: ws.data.id });
  }

  /** Get clients map (for backward compatibility) */
  getClients(): Map<string, ServerWebSocket<WsData>> {
    return this.clients;
  }
}
