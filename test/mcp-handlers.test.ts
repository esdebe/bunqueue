/**
 * MCP Backend Adapter Tests
 *
 * Tests the EmbeddedBackend adapter which is the core logic layer
 * for the MCP server. Verifies all operations work correctly through
 * the McpBackend interface.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { shutdownManager } from '../src/client/manager';
import { EmbeddedBackend } from '../src/mcp/adapter';

let backend: EmbeddedBackend;

beforeEach(() => {
  shutdownManager();
  backend = new EmbeddedBackend();
});

afterEach(() => {
  backend.shutdown();
});

// ─── Job Operations ─────────────────────────────────────────────────────────

describe('EmbeddedBackend - Job Operations', () => {
  test('addJob returns jobId', async () => {
    const result = await backend.addJob('test-q', 'email-send', { to: 'user@test.com' });
    expect(result.jobId).toBeDefined();
    expect(typeof result.jobId).toBe('string');
  });

  test('addJob respects priority option', async () => {
    const result = await backend.addJob('test-q', 'high-prio', { x: 1 }, { priority: 10 });
    expect(result.jobId).toBeDefined();
  });

  test('addJob respects delay option', async () => {
    const result = await backend.addJob('test-q', 'delayed', { x: 1 }, { delay: 5000 });
    expect(result.jobId).toBeDefined();
  });

  test('addJob respects attempts option', async () => {
    const result = await backend.addJob('test-q', 'retry', { x: 1 }, { attempts: 5 });
    expect(result.jobId).toBeDefined();

    const job = await backend.getJob(result.jobId);
    expect(job).not.toBeNull();
    expect(job!.maxAttempts).toBe(5);
  });

  test('addJobsBulk returns count and jobIds', async () => {
    const result = await backend.addJobsBulk('bulk-q', [
      { name: 'a', data: { v: 1 } },
      { name: 'b', data: { v: 2 } },
    ]);
    expect(result.jobIds).toHaveLength(2);
  });

  test('addJobsBulk handles empty array', async () => {
    const result = await backend.addJobsBulk('bulk-q', []);
    expect(result.jobIds).toHaveLength(0);
  });

  test('getJob returns full job details', async () => {
    const added = await backend.addJob('get-q', 'fetch-me', { key: 'value' });
    const job = await backend.getJob(added.jobId);

    expect(job).not.toBeNull();
    expect(job!.id).toBe(added.jobId);
    expect(job!.queue).toBe('get-q');
    expect(job!.createdAt).toBeDefined();
  });

  test('getJob returns null for non-existent job', async () => {
    const job = await backend.getJob('00000000-0000-0000-0000-000000000000');
    expect(job).toBeNull();
  });

  test('cancelJob returns true for waiting job', async () => {
    const added = await backend.addJob('cancel-q', 'to-cancel', {});
    const result = await backend.cancelJob(added.jobId);
    expect(result).toBe(true);
  });

  test('cancelled job is no longer retrievable', async () => {
    const added = await backend.addJob('cancel-q', 'gone', {});
    await backend.cancelJob(added.jobId);
    const job = await backend.getJob(added.jobId);
    expect(job).toBeNull();
  });

  test('getJobState returns state string', async () => {
    const added = await backend.addJob('state-q', 'check-state', {});
    const state = await backend.getJobState(added.jobId);
    expect(state).toBe('waiting');
  });

  test('updateProgress works for active job', async () => {
    const added = await backend.addJob('progress-q', 'prog-test', {});
    const pulled = await backend.pullJob('progress-q');
    expect(pulled).not.toBeNull();

    const result = await backend.updateProgress(pulled!.id, 75, 'Almost done');
    expect(result).toBe(true);
  });
});

// ─── Queue Control ─────────────────────────────────────────────────────────

describe('EmbeddedBackend - Queue Control', () => {
  test('listQueues returns array', async () => {
    await backend.addJob('lq-alpha', 'j', {});
    await backend.addJob('lq-beta', 'j', {});

    const queues = await backend.listQueues();
    expect(Array.isArray(queues)).toBe(true);
    expect(queues).toContain('lq-alpha');
    expect(queues).toContain('lq-beta');
  });

  test('countJobs returns correct count', async () => {
    await backend.addJob('count-q', 'j1', {});
    await backend.addJob('count-q', 'j2', {});
    await backend.addJob('count-q', 'j3', {});

    const count = await backend.countJobs('count-q');
    expect(count).toBe(3);
  });

  test('pauseQueue and resumeQueue work', async () => {
    await backend.pauseQueue('pause-q');
    const paused = await backend.isPaused('pause-q');
    expect(paused).toBe(true);

    await backend.resumeQueue('pause-q');
    const resumed = await backend.isPaused('pause-q');
    expect(resumed).toBe(false);
  });

  test('drainQueue removes waiting jobs', async () => {
    await backend.addJob('drain-q', 'j1', {});
    await backend.addJob('drain-q', 'j2', {});

    const removed = await backend.drainQueue('drain-q');
    expect(removed).toBe(2);

    const count = await backend.countJobs('drain-q');
    expect(count).toBe(0);
  });

  test('obliterateQueue removes all data', async () => {
    await backend.addJob('obliterate-q', 'j1', {});
    await backend.obliterateQueue('obliterate-q');

    const count = await backend.countJobs('obliterate-q');
    expect(count).toBe(0);
  });

  test('getJobCounts returns counts per state', async () => {
    await backend.addJob('counts-q', 'j1', {});
    await backend.addJob('counts-q', 'j2', {});

    const counts = await backend.getJobCounts('counts-q');
    expect(counts.waiting).toBe(2);
    expect(typeof counts.active).toBe('number');
    expect(typeof counts.completed).toBe('number');
  });
});

// ─── Rate Limiting ─────────────────────────────────────────────────────────

describe('EmbeddedBackend - Rate Limiting', () => {
  test('setRateLimit does not throw', async () => {
    await backend.setRateLimit('rl-q', 50);
  });

  test('setConcurrency does not throw', async () => {
    await backend.setConcurrency('conc-q', 10);
  });

  test('clearRateLimit does not throw', async () => {
    await backend.setRateLimit('rl-q2', 50);
    await backend.clearRateLimit('rl-q2');
  });

  test('clearConcurrency does not throw', async () => {
    await backend.setConcurrency('conc-q2', 10);
    await backend.clearConcurrency('conc-q2');
  });
});

// ─── DLQ Operations ─────────────────────────────────────────────────────────

describe('EmbeddedBackend - DLQ', () => {
  test('getDlq returns empty array for queue with no DLQ entries', async () => {
    const result = await backend.getDlq('dlq-empty-q');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  test('retryDlq returns 0 for empty DLQ', async () => {
    const result = await backend.retryDlq('dlq-retry-q');
    expect(result).toBe(0);
  });

  test('purgeDlq returns 0 for empty DLQ', async () => {
    const result = await backend.purgeDlq('dlq-purge-q');
    expect(result).toBe(0);
  });
});

// ─── Cron Jobs ─────────────────────────────────────────────────────────────

describe('EmbeddedBackend - Cron', () => {
  test('addCron with repeatEvery returns cron details', async () => {
    const result = await backend.addCron({
      name: 'test-cron-interval',
      queue: 'cron-q',
      data: { task: 'ping' },
      repeatEvery: 30000,
    });
    expect(result.name).toBe('test-cron-interval');
    expect(result.queue).toBe('cron-q');
  });

  test('listCrons returns cron entries', async () => {
    await backend.addCron({
      name: 'list-cron-1',
      queue: 'cron-q',
      data: {},
      repeatEvery: 1000,
    });

    const crons = await backend.listCrons();
    expect(Array.isArray(crons)).toBe(true);
    const names = crons.map((c) => c.name);
    expect(names).toContain('list-cron-1');
  });

  test('deleteCron removes existing cron', async () => {
    await backend.addCron({
      name: 'to-delete-cron',
      queue: 'cron-q',
      data: {},
      repeatEvery: 1000,
    });

    const result = await backend.deleteCron('to-delete-cron');
    expect(result).toBe(true);

    const crons = await backend.listCrons();
    const names = crons.map((c) => c.name);
    expect(names).not.toContain('to-delete-cron');
  });

  test('deleteCron returns false for non-existent cron', async () => {
    const result = await backend.deleteCron('does-not-exist');
    expect(result).toBe(false);
  });
});

// ─── Stats & Logs ─────────────────────────────────────────────────────────

describe('EmbeddedBackend - Stats & Logs', () => {
  test('getStats returns stats object', async () => {
    const stats = await backend.getStats();
    expect(stats).toBeDefined();
    expect(typeof stats).toBe('object');
  });

  test('stats are JSON-serializable (no BigInt)', async () => {
    await backend.addJob('stats-q', 'j', {});
    const stats = await backend.getStats();
    const json = JSON.stringify(stats);
    expect(json).toBeDefined();
    expect(() => JSON.parse(json)).not.toThrow();
  });

  test('getJobLogs returns empty array when no logs', async () => {
    const added = await backend.addJob('log-q', 'no-logs', {});
    const logs = await backend.getJobLogs(added.jobId);
    expect(Array.isArray(logs)).toBe(true);
    expect(logs).toHaveLength(0);
  });

  test('addJobLog and getJobLogs round-trip', async () => {
    const added = await backend.addJob('log-q', 'has-logs', {});

    await backend.addJobLog(added.jobId, 'Step 1 started', 'info');
    await backend.addJobLog(added.jobId, 'Warning encountered', 'warn');

    const logs = await backend.getJobLogs(added.jobId);
    expect(logs).toHaveLength(2);
    expect(logs[0].message).toBe('Step 1 started');
    expect(logs[0].level).toBe('info');
    expect(logs[1].message).toBe('Warning encountered');
    expect(logs[1].level).toBe('warn');
  });
});

// ─── Job Consumption (Pull/Ack/Fail) ─────────────────────────────────────

describe('EmbeddedBackend - Job Consumption', () => {
  test('pullJob returns a job from queue', async () => {
    await backend.addJob('pull-q', 'pull-test', { data: 1 });

    const job = await backend.pullJob('pull-q');
    expect(job).not.toBeNull();
    expect(job!.queue).toBe('pull-q');
  });

  test('pullJob returns null on empty queue', async () => {
    const job = await backend.pullJob('empty-pull-q');
    expect(job).toBeNull();
  });

  test('ackJob completes the job', async () => {
    await backend.addJob('ack-q', 'ack-test', {});
    const job = await backend.pullJob('ack-q');
    expect(job).not.toBeNull();

    await backend.ackJob(job!.id, { done: true });
    // Job should be completed now
    const state = await backend.getJobState(job!.id);
    expect(state).toBe('completed');
  });

  test('failJob marks job as failed', async () => {
    await backend.addJob('fail-q', 'fail-test', {});
    const job = await backend.pullJob('fail-q');
    expect(job).not.toBeNull();

    await backend.failJob(job!.id, 'Test error');
  });
});

// ─── End-to-end flows ─────────────────────────────────────────────────────

describe('EmbeddedBackend - End-to-end flows', () => {
  test('add job, retrieve it, cancel it, verify gone', async () => {
    const added = await backend.addJob('e2e-q', 'lifecycle', { step: 1 });
    expect(added.jobId).toBeDefined();

    const fetched = await backend.getJob(added.jobId);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(added.jobId);

    await backend.cancelJob(added.jobId);

    const gone = await backend.getJob(added.jobId);
    expect(gone).toBeNull();
  });

  test('add jobs, count, drain, verify empty', async () => {
    await backend.addJob('e2e-drain', 'j1', {});
    await backend.addJob('e2e-drain', 'j2', {});
    await backend.addJob('e2e-drain', 'j3', {});

    const count = await backend.countJobs('e2e-drain');
    expect(count).toBe(3);

    const removed = await backend.drainQueue('e2e-drain');
    expect(removed).toBe(3);

    const after = await backend.countJobs('e2e-drain');
    expect(after).toBe(0);
  });

  test('add cron, list, delete, verify removed', async () => {
    await backend.addCron({
      name: 'e2e-cron',
      queue: 'cron-q',
      data: { action: 'report' },
      repeatEvery: 60000,
    });

    let crons = await backend.listCrons();
    let names = crons.map((c) => c.name);
    expect(names).toContain('e2e-cron');

    await backend.deleteCron('e2e-cron');

    crons = await backend.listCrons();
    names = crons.map((c) => c.name);
    expect(names).not.toContain('e2e-cron');
  });

  test('add job, add logs, retrieve logs', async () => {
    const added = await backend.addJob('e2e-logs', 'logged', {});

    await backend.addJobLog(added.jobId, 'Phase 1', 'info');
    await backend.addJobLog(added.jobId, 'Phase 2', 'warn');
    await backend.addJobLog(added.jobId, 'Phase 3', 'error');

    const logs = await backend.getJobLogs(added.jobId);
    expect(logs).toHaveLength(3);
    expect(logs[0].message).toBe('Phase 1');
    expect(logs[2].level).toBe('error');
  });

  test('bulk add then count', async () => {
    const result = await backend.addJobsBulk('e2e-bulk', [
      { name: 'a', data: { n: 1 } },
      { name: 'b', data: { n: 2 } },
      { name: 'c', data: { n: 3 } },
      { name: 'd', data: { n: 4 } },
      { name: 'e', data: { n: 5 } },
    ]);
    expect(result.jobIds).toHaveLength(5);

    const count = await backend.countJobs('e2e-bulk');
    expect(count).toBe(5);
  });
});
