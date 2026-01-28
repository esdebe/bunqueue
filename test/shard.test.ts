/**
 * Shard Tests
 */

import { describe, test, expect } from 'bun:test';
import { Shard } from '../src/domain/queue/shard';
import { createJob, jobId } from '../src/domain/types/job';

describe('Shard', () => {
  function makeJob(id: number, queue = 'test') {
    return createJob(jobId(BigInt(id)), queue, { data: { id } }, Date.now());
  }

  test('should create and get queue', () => {
    const shard = new Shard();
    const queue = shard.getQueue('emails');

    expect(queue).toBeDefined();
    expect(queue.isEmpty).toBe(true);
  });

  test('should track queue state', () => {
    const shard = new Shard();
    const state = shard.getState('emails');

    expect(state.paused).toBe(false);
    expect(state.rateLimit).toBeNull();
  });

  test('should pause and resume queue', () => {
    const shard = new Shard();

    shard.pause('emails');
    expect(shard.isPaused('emails')).toBe(true);

    shard.resume('emails');
    expect(shard.isPaused('emails')).toBe(false);
  });

  test('should manage unique keys', () => {
    const shard = new Shard();

    expect(shard.isUniqueAvailable('emails', 'key1')).toBe(true);

    shard.registerUniqueKey('emails', 'key1');
    expect(shard.isUniqueAvailable('emails', 'key1')).toBe(false);

    shard.releaseUniqueKey('emails', 'key1');
    expect(shard.isUniqueAvailable('emails', 'key1')).toBe(true);
  });

  test('should manage FIFO groups', () => {
    const shard = new Shard();

    expect(shard.isGroupActive('emails', 'group1')).toBe(false);

    shard.activateGroup('emails', 'group1');
    expect(shard.isGroupActive('emails', 'group1')).toBe(true);

    shard.releaseGroup('emails', 'group1');
    expect(shard.isGroupActive('emails', 'group1')).toBe(false);
  });

  test('should manage DLQ', () => {
    const shard = new Shard();
    const job = makeJob(1, 'emails');

    shard.addToDlq(job);
    expect(shard.getDlqCount('emails')).toBe(1);

    const dlqJobs = shard.getDlq('emails');
    expect(dlqJobs.length).toBe(1);
    expect(dlqJobs[0].id).toBe(job.id);

    const removed = shard.removeFromDlq('emails', job.id);
    expect(removed?.id).toBe(job.id);
    expect(shard.getDlqCount('emails')).toBe(0);
  });

  test('should clear DLQ', () => {
    const shard = new Shard();
    shard.addToDlq(makeJob(1, 'emails'));
    shard.addToDlq(makeJob(2, 'emails'));

    const count = shard.clearDlq('emails');
    expect(count).toBe(2);
    expect(shard.getDlqCount('emails')).toBe(0);
  });

  test('should drain queue', () => {
    const shard = new Shard();
    const queue = shard.getQueue('emails');
    queue.push(makeJob(1, 'emails'));
    queue.push(makeJob(2, 'emails'));

    const count = shard.drain('emails');
    expect(count).toBe(2);
    expect(queue.isEmpty).toBe(true);
  });

  test('should obliterate queue completely', () => {
    const shard = new Shard();
    shard.getQueue('emails').push(makeJob(1, 'emails'));
    shard.addToDlq(makeJob(2, 'emails'));
    shard.registerUniqueKey('emails', 'key1');
    shard.pause('emails');

    shard.obliterate('emails');

    expect(shard.queues.has('emails')).toBe(false);
    expect(shard.dlq.has('emails')).toBe(false);
    expect(shard.isPaused('emails')).toBe(false);
  });

  test('should get queue names', () => {
    const shard = new Shard();
    shard.getQueue('emails');
    shard.getQueue('notifications');
    shard.addToDlq(makeJob(1, 'reports'));

    const names = shard.getQueueNames();
    expect(names).toContain('emails');
    expect(names).toContain('notifications');
    expect(names).toContain('reports');
  });

  test('should release job resources', () => {
    const shard = new Shard();
    shard.registerUniqueKey('emails', 'key1');
    shard.activateGroup('emails', 'group1');

    shard.releaseJobResources('emails', 'key1', 'group1');

    expect(shard.isUniqueAvailable('emails', 'key1')).toBe(true);
    expect(shard.isGroupActive('emails', 'group1')).toBe(false);
  });
});
