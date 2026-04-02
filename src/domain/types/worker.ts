/**
 * Worker domain types
 */

import { uuid } from '../../shared/hash';

/** Worker ID type */
export type WorkerId = string;

/** Worker status */
export interface Worker {
  id: WorkerId;
  name: string;
  queues: string[];
  concurrency: number;
  hostname: string;
  pid: number;
  registeredAt: number;
  lastSeen: number;
  activeJobs: number;
  processedJobs: number;
  failedJobs: number;
  currentJob: string | null;
  /** TCP client ID that registered this worker (for cleanup on disconnect) */
  clientId: string | null;
}

/** Options for creating a worker */
export interface CreateWorkerOptions {
  workerId?: string;
  hostname?: string;
  pid?: number;
  startedAt?: number;
  clientId?: string;
}

/** Create a new worker */
export function createWorker(
  name: string,
  queues?: string[],
  concurrency: number = 1,
  opts?: CreateWorkerOptions
): Worker {
  const now = Date.now();
  return {
    id: opts?.workerId ?? uuid(),
    name,
    queues: queues ?? [],
    concurrency,
    hostname: opts?.hostname ?? 'unknown',
    pid: opts?.pid ?? 0,
    registeredAt: opts?.startedAt ?? now,
    lastSeen: now,
    activeJobs: 0,
    processedJobs: 0,
    failedJobs: 0,
    currentJob: null,
    clientId: opts?.clientId ?? null,
  };
}

/** Job log entry */
export interface JobLogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

/** Create log entry */
export function createLogEntry(
  message: string,
  level: 'info' | 'warn' | 'error' = 'info'
): JobLogEntry {
  return {
    timestamp: Date.now(),
    level,
    message,
  };
}
