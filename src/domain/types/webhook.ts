/**
 * Webhook domain types
 */

import { uuid } from '../../shared/hash';

/** Webhook ID type */
export type WebhookId = string;

/** Webhook event types */
export type WebhookEvent =
  | 'job.pushed'
  | 'job.started'
  | 'job.completed'
  | 'job.failed'
  | 'job.progress'
  | 'job.stalled';

/** Webhook configuration */
export interface Webhook {
  id: WebhookId;
  url: string;
  events: WebhookEvent[];
  queue: string | null; // null = all queues
  secret: string | null;
  createdAt: number;
  lastTriggered: number | null;
  successCount: number;
  failureCount: number;
  enabled: boolean;
}

/** Create a new webhook */
export function createWebhook(
  url: string,
  events: string[],
  queue?: string,
  secret?: string
): Webhook {
  return {
    id: uuid(),
    url,
    events: events as WebhookEvent[],
    queue: queue ?? null,
    secret: secret ?? null,
    createdAt: Date.now(),
    lastTriggered: null,
    successCount: 0,
    failureCount: 0,
    enabled: true,
  };
}

/** Webhook payload */
export interface WebhookPayload {
  event: WebhookEvent;
  timestamp: number;
  jobId: string;
  queue: string;
  data?: unknown;
  error?: string;
  progress?: number;
}
