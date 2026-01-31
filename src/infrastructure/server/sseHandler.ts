/**
 * SSE Handler - Server-Sent Events management
 */

import type { JobEvent } from '../../domain/types/queue';
import { uuid } from '../../shared/hash';

/** Singleton TextEncoder for SSE messages */
const textEncoder = new TextEncoder();

/** SSE client tracking */
export interface SseClient {
  id: string;
  controller: ReadableStreamDefaultController;
  queueFilter: string | null;
}

/**
 * SSE Handler - manages Server-Sent Events clients
 */
export class SseHandler {
  private readonly clients = new Map<string, SseClient>();

  /** Get client count */
  get size(): number {
    return this.clients.size;
  }

  /** Broadcast event to all matching clients */
  broadcast(event: JobEvent): void {
    const message = JSON.stringify(event);
    const sseMessage = `data: ${message}\n\n`;
    const disconnected: string[] = [];

    for (const [clientId, client] of this.clients) {
      if (!client.queueFilter || client.queueFilter === event.queue) {
        try {
          client.controller.enqueue(textEncoder.encode(sseMessage));
        } catch {
          disconnected.push(clientId);
        }
      }
    }

    for (const clientId of disconnected) {
      this.clients.delete(clientId);
    }
  }

  /** Create SSE response for a new client */
  createResponse(queueFilter: string | null, corsOrigin: string): Response {
    const clientId = uuid();

    const stream = new ReadableStream({
      start: (controller) => {
        this.clients.set(clientId, {
          id: clientId,
          controller,
          queueFilter,
        });
        controller.enqueue(
          textEncoder.encode(`data: {"connected":true,"clientId":"${clientId}"}\n\n`)
        );
      },
      cancel: () => {
        this.clients.delete(clientId);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': corsOrigin,
      },
    });
  }

  /** Close all connections */
  closeAll(): void {
    for (const [, client] of this.clients) {
      try {
        client.controller.close();
      } catch {
        // Ignore
      }
    }
    this.clients.clear();
  }

  /** Get clients map (for backward compatibility) */
  getClients(): Map<string, SseClient> {
    return this.clients;
  }
}
