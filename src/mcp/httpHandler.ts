/**
 * HTTP Handler Registry
 * Spawns embedded Workers that auto-process jobs via HTTP calls.
 * Allows AI agents to register handlers so cron/queued jobs execute automatically.
 */

import { Worker } from '../client/worker/worker';

export interface HttpHandler {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

interface ActiveHandler {
  handler: HttpHandler;
  worker: Worker;
}

export class HttpHandlerRegistry {
  private readonly handlers = new Map<string, ActiveHandler>();

  register(queue: string, handler: HttpHandler): void {
    // Stop existing handler on this queue if any
    if (this.handlers.has(queue)) {
      this.unregister(queue);
    }

    const timeout = handler.timeoutMs ?? 30_000;

    const worker = new Worker(
      queue,
      async (job) => {
        const controller = new AbortController();
        const timer = setTimeout(() => {
          controller.abort();
        }, timeout);

        try {
          const init: RequestInit = {
            method: handler.method,
            headers: {
              'Content-Type': 'application/json',
              ...handler.headers,
            },
            signal: controller.signal,
          };

          if (handler.method !== 'GET' && handler.method !== 'DELETE') {
            init.body = JSON.stringify(handler.body ?? job.data);
          }

          const res = await fetch(handler.url, init);
          const contentType = res.headers.get('content-type') ?? '';
          const resBody: unknown = contentType.includes('json')
            ? await res.json()
            : await res.text();

          if (!res.ok) {
            throw new Error(
              `HTTP ${res.status}: ${typeof resBody === 'string' ? resBody : JSON.stringify(resBody)}`
            );
          }

          return { status: res.status, body: resBody };
        } finally {
          clearTimeout(timer);
        }
      },
      { embedded: true, concurrency: 1 }
    );

    this.handlers.set(queue, { handler, worker });
  }

  unregister(queue: string): boolean {
    const entry = this.handlers.get(queue);
    if (!entry) return false;

    void entry.worker.close(true);
    this.handlers.delete(queue);
    return true;
  }

  list(): Array<{ queue: string; handler: HttpHandler; active: boolean }> {
    const result: Array<{ queue: string; handler: HttpHandler; active: boolean }> = [];
    for (const [queue, entry] of this.handlers) {
      result.push({
        queue,
        handler: entry.handler,
        active: entry.worker.isRunning(),
      });
    }
    return result;
  }

  shutdown(): void {
    for (const [, entry] of this.handlers) {
      void entry.worker.close(true);
    }
    this.handlers.clear();
  }
}
