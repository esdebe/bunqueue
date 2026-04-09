/**
 * Bug #80: Deduplication not working for long-running scheduled jobs
 *
 * cleanEmptyQueues() in cleanupTasks.ts deletes shard.uniqueKeys for queues
 * with 0 waiting jobs, even when jobs holding those unique keys are still
 * actively processing. This wipes the dedup entry every ~10s (cleanup interval),
 * allowing the cron scheduler to create duplicate jobs.
 *
 * @see https://github.com/egeominotti/bunqueue/issues/80
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Queue } from '../src/client';
import { getSharedManager } from '../src/client/manager';
import { cleanup } from '../src/application/cleanupTasks';

describe('Bug #80: cleanup must not delete unique keys while jobs are processing', () => {
  let queue: Queue;
  const queueName = 'test-bug-80';

  beforeEach(() => {
    queue = new Queue(queueName, { embedded: true });
  });

  afterEach(async () => {
    const manager = getSharedManager();
    for (const cron of manager.listCrons()) {
      manager.removeCron(cron.name);
    }
    await queue.obliterate();
    await queue.close();
  });

  test('dedup key must survive cleanup while job is actively processing', async () => {
    const manager = getSharedManager();

    // Push a job with a uniqueKey (simulates cron fire with dedup)
    const job1 = await manager.push(queueName, {
      data: { tick: 1 },
      uniqueKey: 'singleton',
      dedup: { ttl: undefined },
    });

    // Worker pulls the job — queue is now "empty" (0 waiting) but job is processing
    const pulled = await manager.pull(queueName);
    expect(pulled).not.toBeNull();
    expect(pulled!.id).toBe(job1.id);

    // Simulate the 10s cleanup cycle running while job is still processing
    // This is the core of the bug: cleanEmptyQueues sees queue.size === 0
    // and deletes uniqueKeys for the queue, breaking dedup
    const bgCtx = (manager as any).contextFactory.getBackgroundContext();
    await cleanup(bgCtx);

    // Now try to push another job with the same uniqueKey
    // This simulates the next cron tick after cleanup
    const job2 = await manager.push(queueName, {
      data: { tick: 2 },
      uniqueKey: 'singleton',
      dedup: { ttl: undefined },
    });

    // BUG: job2 gets a NEW id because cleanup wiped the unique key
    // EXPECTED: job2.id should equal job1.id (deduplicated)
    expect(job2.id).toBe(job1.id);

    // There should be 0 waiting jobs (job1 is still active, job2 was deduplicated)
    const counts = manager.getQueueJobCounts(queueName);
    expect(counts.waiting).toBe(0);
  });

  test('dedup key must survive multiple cleanup cycles during long-running job', async () => {
    const manager = getSharedManager();

    // Push and pull a job with dedup
    const job1 = await manager.push(queueName, {
      data: { tick: 1 },
      uniqueKey: 'long-running',
    });
    const pulled = await manager.pull(queueName);
    expect(pulled).not.toBeNull();

    const bgCtx = (manager as any).contextFactory.getBackgroundContext();

    // Simulate 5 cleanup cycles (50 seconds of processing)
    for (let i = 0; i < 5; i++) {
      await cleanup(bgCtx);

      // Each cron tick after cleanup should still be deduplicated
      const attempt = await manager.push(queueName, {
        data: { tick: i + 2 },
        uniqueKey: 'long-running',
      });
      expect(attempt.id).toBe(job1.id);
    }

    // Still 0 waiting jobs
    const counts = manager.getQueueJobCounts(queueName);
    expect(counts.waiting).toBe(0);
  });

  test('cron every() with dedup should not create duplicates after cleanup', async () => {
    const manager = getSharedManager();

    // Setup cron that fires every 100ms with dedup
    await queue.upsertJobScheduler(
      'test-cron',
      { every: 100 },
      { name: 'test', data: {}, opts: { deduplication: { id: 'cron-dedup' } } }
    );

    // Wait for first cron tick to fire
    await new Promise((r) => setTimeout(r, 200));

    // Pull the first job
    const job1 = await manager.pull(queueName);
    expect(job1).not.toBeNull();

    // Run cleanup while job is processing
    const bgCtx = (manager as any).contextFactory.getBackgroundContext();
    await cleanup(bgCtx);

    // Wait for more cron ticks after cleanup
    await new Promise((r) => setTimeout(r, 300));

    // Pull again — should get nothing if dedup is working correctly
    // (The cron pushes should all be deduplicated against the still-active job1)
    const job2 = await manager.pull(queueName);

    // BUG: job2 is NOT null because cleanup broke the dedup
    // EXPECTED: job2 should be null (no new jobs created)
    expect(job2).toBeNull();
  });
});
