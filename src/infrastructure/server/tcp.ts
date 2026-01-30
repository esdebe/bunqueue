/**
 * TCP Server
 * Handles TCP connections with JSON line protocol
 */

import type { Socket } from 'bun';
import type { QueueManager } from '../../application/queueManager';
import type { Response } from '../../domain/types/response';
import { handleCommand, type HandlerContext } from './handler';
import { LineBuffer, parseCommand, createConnectionState, type ConnectionState } from './protocol';
import { uuid } from '../../shared/hash';
import { tcpLog } from '../../shared/logger';
import { getRateLimiter } from './rateLimiter';

/** TCP Server configuration */
export interface TcpServerConfig {
  port: number;
  hostname?: string;
  authTokens?: string[];
}

/** Per-connection data */
interface ConnectionData {
  state: ConnectionState;
  buffer: LineBuffer;
  ctx: HandlerContext;
}

/** Reusable TextDecoder - avoid allocation per message */
const textDecoder = new TextDecoder();

/** Pre-allocated newline buffer for efficient writes */
const NEWLINE = '\n';

/** Serialize response with newline - avoids string concat per message */
function serializeResponseLine(response: Response): string {
  return JSON.stringify(response) + NEWLINE;
}

/** Error response with newline */
function errorResponseLine(message: string, reqId?: string): string {
  return JSON.stringify({ ok: false, error: message, reqId }) + NEWLINE;
}

/**
 * Create and start TCP server
 */
export function createTcpServer(queueManager: QueueManager, config: TcpServerConfig) {
  const authTokens = new Set(config.authTokens ?? []);
  const connections = new Map<string, Socket<ConnectionData>>();

  const server = Bun.listen<ConnectionData>({
    hostname: config.hostname ?? '0.0.0.0',
    port: config.port,

    socket: {
      open(socket) {
        const clientId = uuid();
        const state = createConnectionState(clientId);
        const ctx: HandlerContext = {
          queueManager,
          authTokens,
          authenticated: authTokens.size === 0, // Auto-auth if no tokens
        };

        socket.data = {
          state,
          buffer: new LineBuffer(),
          ctx,
        };

        connections.set(clientId, socket);
        tcpLog.info('Client connected', { clientId });
      },

      async data(socket, data) {
        const { buffer, ctx, state } = socket.data;
        const rateLimiter = getRateLimiter();

        // Check rate limit
        if (!rateLimiter.isAllowed(state.clientId)) {
          socket.write(errorResponseLine('Rate limit exceeded'));
          return;
        }

        const text = textDecoder.decode(data);
        const lines = buffer.addData(text);

        for (const line of lines) {
          const cmd = parseCommand(line);
          if (!cmd) {
            socket.write(errorResponseLine('Invalid command'));
            continue;
          }
          try {
            const response = await handleCommand(cmd, ctx);
            socket.write(serializeResponseLine(response));
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            socket.write(errorResponseLine(message, cmd.reqId));
          }
        }
      },

      close(socket) {
        const clientId = socket.data.state.clientId;
        connections.delete(clientId);
        getRateLimiter().removeClient(clientId);
        tcpLog.info('Client disconnected', { clientId });
      },

      error(_socket, error) {
        tcpLog.error('Connection error', { error: error.message });
      },

      drain(_socket) {
        // Called when socket is ready for more writes after backpressure
      },
    },
  });

  tcpLog.info('Server listening', { host: config.hostname ?? '0.0.0.0', port: config.port });

  return {
    server,
    connections,

    /** Get connection count */
    getConnectionCount(): number {
      return connections.size;
    },

    /** Broadcast to all connections */
    broadcast(message: string): void {
      const messageWithNewline = message + NEWLINE;
      for (const socket of connections.values()) {
        socket.write(messageWithNewline);
      }
    },

    /** Stop the server */
    stop(): void {
      server.stop();
      for (const socket of connections.values()) {
        socket.end();
      }
      connections.clear();
      tcpLog.info('Server stopped');
    },
  };
}

export type TcpServer = ReturnType<typeof createTcpServer>;
