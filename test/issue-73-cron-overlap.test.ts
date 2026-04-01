/**
 * Issue #73: Cron fires while previous job is still active, causing
 * jobs to accumulate in the queue. On worker restart, accumulated
 * jobs are picked up immediately ("starts right away").
 *
 * Root cause: When a cron interval is shorter than the job processing
 * time, the cron fires again and pushes a second job. Without dedup,
 * these jobs accumulate. When the worker restarts, it immediately
 * pulls the waiting job.
 *
 * Fix: Add `preventOverlap` option to cron jobs. When enabled,
 * cron-fired jobs automatically get a uniqueKey derived from the
 * cron name, leveraging the existing dedup mechanism to block pushes
 * while a previous job is still active/waiting.
 *
 * @see https://github.com/egeominotti/bunqueue/issues/73
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Queue } from '../src/client';
import { getSharedManager } from '../src/client/manager';

describe('Issue #73: cron overlap prevention', () => {
  let queue: Queue;
  const queueName = 'test-issue-73';

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

  test('cron without preventOverlap pushes duplicate jobs when previous is active (BUG)', async () => {
    const manager = getSharedManager();

    // Add cron WITHOUT preventOverlap (old behavior)
    manager.addCron({
      name: 'overlap-allowed',
      queue: queueName,
      data: { type: 'test' },
      schedule: '* * * * *',
      preventOverlap: false,
    });

    // Simulate cron firing: push first job
    await manager.push(queueName, { data: { tick: 1 } });

    // Worker pulls job (now active)
    const pulled = await manager.pull(queueName);
    expect(pulled).not.toBeNull();

    // Simulate cron firing again while job is active
    await manager.push(queueName, { data: { tick: 2 } });

    // Without overlap prevention, second job DOES accumulate
    const counts = manager.getQueueJobCounts(queueName);
    expect(counts.waiting).toBe(1); // job 2 is waiting
  });

  test('cron with preventOverlap blocks push while previous job is active', async () => {
    const manager = getSharedManager();

    // Add cron WITH preventOverlap
    manager.addCron({
      name: 'overlap-blocked',
      queue: queueName,
      data: { type: 'test' },
      schedule: '* * * * *',
      preventOverlap: true,
    });

    // Get the cron to verify preventOverlap is set
    const cron = manager.getCron('overlap-blocked');
    expect(cron).not.toBeUndefined();
    expect(cron!.preventOverlap).toBe(true);

    // Simulate cron firing: push job with the auto-generated uniqueKey
    const job1 = await manager.push(queueName, {
      data: { tick: 1 },
      uniqueKey: 'cron:overlap-blocked',
    });

    // Worker pulls job (now active)
    const pulled = await manager.pull(queueName);
    expect(pulled).not.toBeNull();
    expect(pulled!.id).toBe(job1.id);

    // Simulate cron firing again — push with same uniqueKey should be blocked
    const job2 = await manager.push(queueName, {
      data: { tick: 2 },
      uniqueKey: 'cron:overlap-blocked',
    });

    // Should return the existing job ID (deduplicated)
    expect(job2.id).toBe(job1.id);

    // No new waiting jobs should accumulate
    const counts = manager.getQueueJobCounts(queueName);
    expect(counts.waiting).toBe(0);
  });

  test('cron with preventOverlap allows push after previous job is acked', async () => {
    const manager = getSharedManager();

    // Push first job with cron unique key
    const job1 = await manager.push(queueName, {
      data: { tick: 1 },
      uniqueKey: 'cron:ack-test',
    });

    // Pull and ack the job
    const pulled = await manager.pull(queueName);
    expect(pulled).not.toBeNull();
    await manager.ack(job1.id);

    // Now push again — should succeed (unique key was released on ack)
    const job2 = await manager.push(queueName, {
      data: { tick: 2 },
      uniqueKey: 'cron:ack-test',
    });

    // Should be a NEW job (not deduplicated)
    expect(job2.id).not.toBe(job1.id);

    const counts = manager.getQueueJobCounts(queueName);
    expect(counts.waiting).toBe(1);
  });

  test('preventOverlap defaults to true for new cron jobs', () => {
    const manager = getSharedManager();

    manager.addCron({
      name: 'default-overlap',
      queue: queueName,
      data: {},
      schedule: '* * * * *',
    });

    const cron = manager.getCron('default-overlap');
    expect(cron).not.toBeUndefined();
    expect(cron!.preventOverlap).toBe(true);
  });

  test('fireCronJob uses uniqueKey when preventOverlap is true', async () => {
    const manager = getSharedManager();

    // Create cron with preventOverlap (default: true)
    manager.addCron({
      name: 'fire-test',
      queue: queueName,
      data: { type: 'cron' },
      schedule: '* * * * *',
    });

    // Access the scheduler to manually trigger a tick
    const scheduler = (manager as any).cronScheduler;

    // Force the cron's nextRun to the past so tick() fires it
    const cronEntry = scheduler.cronJobs.get('fire-test');
    expect(cronEntry).toBeDefined();
    cronEntry.cron.nextRun = Date.now() - 1000;

    // Rebuild heap with updated nextRun
    scheduler.cronHeap.buildFrom(
      Array.from(scheduler.cronJobs.values()).map((e: any) => ({
        cron: e.cron,
        generation: e.generation,
      }))
    );

    // Tick should fire the cron and push a job with uniqueKey
    await (scheduler as any).tick();

    // Verify a job was pushed
    let counts = manager.getQueueJobCounts(queueName);
    expect(counts.waiting).toBe(1);

    // Pull the job (making it active)
    const pulled = await manager.pull(queueName);
    expect(pulled).not.toBeNull();
    expect(pulled!.uniqueKey).toBe('cron:fire-test');

    // Force cron to fire again
    cronEntry.cron.nextRun = Date.now() - 1000;
    scheduler.cronHeap.buildFrom(
      Array.from(scheduler.cronJobs.values()).map((e: any) => ({
        cron: e.cron,
        generation: e.generation,
      }))
    );
    await (scheduler as any).tick();

    // No new job should be waiting (blocked by dedup)
    counts = manager.getQueueJobCounts(queueName);
    expect(counts.waiting).toBe(0);
  });

  test('preventOverlap does not interfere with user-defined uniqueKey', async () => {
    const manager = getSharedManager();

    // Create cron with explicit uniqueKey (user-defined takes precedence)
    manager.addCron({
      name: 'user-key-test',
      queue: queueName,
      data: {},
      schedule: '* * * * *',
      uniqueKey: 'my-custom-key',
      preventOverlap: true,
    });

    // Access scheduler to fire cron
    const scheduler = (manager as any).cronScheduler;
    const cronEntry = scheduler.cronJobs.get('user-key-test');
    cronEntry.cron.nextRun = Date.now() - 1000;
    scheduler.cronHeap.buildFrom(
      Array.from(scheduler.cronJobs.values()).map((e: any) => ({
        cron: e.cron,
        generation: e.generation,
      }))
    );

    await (scheduler as any).tick();

    const pulled = await manager.pull(queueName);
    expect(pulled).not.toBeNull();
    // User-defined uniqueKey should be used, not auto-generated
    expect(pulled!.uniqueKey).toBe('my-custom-key');
  });

  test('full restart simulation: no leftover jobs with preventOverlap', async () => {
    const manager = getSharedManager();
    const scheduler = (manager as any).cronScheduler;

    // Create cron with preventOverlap (default)
    manager.addCron({
      name: 'restart-overlap-test',
      queue: queueName,
      data: { type: 'long-running' },
      schedule: '* * * * *',
    });

    // Step 1: First cron fire — push job
    const cronEntry = scheduler.cronJobs.get('restart-overlap-test');
    cronEntry.cron.nextRun = Date.now() - 1000;
    scheduler.cronHeap.buildFrom(
      Array.from(scheduler.cronJobs.values()).map((e: any) => ({
        cron: e.cron,
        generation: e.generation,
      }))
    );
    await (scheduler as any).tick();

    // Worker pulls the job (active)
    const job1 = await manager.pull(queueName);
    expect(job1).not.toBeNull();

    // Step 2: Simulate 60s later — cron fires again while job1 is active
    cronEntry.cron.nextRun = Date.now() - 1000;
    scheduler.cronHeap.buildFrom(
      Array.from(scheduler.cronJobs.values()).map((e: any) => ({
        cron: e.cron,
        generation: e.generation,
      }))
    );
    await (scheduler as any).tick();

    // No new jobs should be in the queue (blocked by dedup)
    let counts = manager.getQueueJobCounts(queueName);
    expect(counts.waiting).toBe(0);

    // Step 3: Worker finishes and acks
    await manager.ack(job1!.id);

    // Step 4: Simulate "restart" — worker reconnects and pulls
    const afterRestart = await manager.pull(queueName);

    // No leftover jobs — worker should NOT get a job immediately
    expect(afterRestart).toBeNull();

    // Step 5: Next cron fire after restart should work normally
    // Clear lastFiredAt to avoid overlap detection in fast test environment
    (scheduler as any).lastFiredAt.clear();
    cronEntry.cron.nextRun = Date.now() - 1000;
    scheduler.cronHeap.buildFrom(
      Array.from(scheduler.cronJobs.values()).map((e: any) => ({
        cron: e.cron,
        generation: e.generation,
      }))
    );
    await (scheduler as any).tick();

    counts = manager.getQueueJobCounts(queueName);
    expect(counts.waiting).toBe(1);

    const job2 = await manager.pull(queueName);
    expect(job2).not.toBeNull();
    expect(job2!.id).not.toBe(job1!.id);
  });
});
