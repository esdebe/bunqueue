/**
 * Priority Queue Tests
 */

import { describe, test, expect } from 'bun:test';
import { IndexedPriorityQueue } from '../src/domain/queue/priorityQueue';
import { createJob, jobId } from '../src/domain/types/job';

describe('IndexedPriorityQueue', () => {
  function makeJob(id: number, priority = 0, runAt = Date.now()) {
    const job = createJob(jobId(`test-job-${id}`), 'test', { data: { id } }, runAt);
    (job as { priority: number }).priority = priority;
    return job;
  }

  test('should start empty', () => {
    const queue = new IndexedPriorityQueue();
    expect(queue.size).toBe(0);
    expect(queue.isEmpty).toBe(true);
    expect(queue.pop()).toBeNull();
  });

  test('should push and pop single job', () => {
    const queue = new IndexedPriorityQueue();
    const job = makeJob(1);

    queue.push(job);
    expect(queue.size).toBe(1);
    expect(queue.isEmpty).toBe(false);

    const popped = queue.pop();
    expect(popped).not.toBeNull();
    expect(popped?.id).toBe(job.id);
    expect(queue.size).toBe(0);
  });

  test('should respect priority order (higher first)', () => {
    const queue = new IndexedPriorityQueue();
    const low = makeJob(1, 1);
    const high = makeJob(2, 10);
    const medium = makeJob(3, 5);

    queue.push(low);
    queue.push(high);
    queue.push(medium);

    expect(queue.pop()?.id).toBe(high.id);
    expect(queue.pop()?.id).toBe(medium.id);
    expect(queue.pop()?.id).toBe(low.id);
  });

  test('should find job by id', () => {
    const queue = new IndexedPriorityQueue();
    const job1 = makeJob(1);
    const job2 = makeJob(2);

    queue.push(job1);
    queue.push(job2);

    expect(queue.find(job1.id)?.id).toBe(job1.id);
    expect(queue.find(job2.id)?.id).toBe(job2.id);
    expect(queue.find(jobId('test-job-999'))).toBeNull();
  });

  test('should remove job by id', () => {
    const queue = new IndexedPriorityQueue();
    const job1 = makeJob(1, 10);
    const job2 = makeJob(2, 5);

    queue.push(job1);
    queue.push(job2);

    const removed = queue.remove(job1.id);
    expect(removed?.id).toBe(job1.id);
    expect(queue.size).toBe(1);
  });

  test('should update priority', () => {
    const queue = new IndexedPriorityQueue();
    const job1 = makeJob(1, 1);
    const job2 = makeJob(2, 10);

    queue.push(job1);
    queue.push(job2);

    queue.updatePriority(job1.id, 100);

    expect(queue.pop()?.id).toBe(job1.id);
  });

  test('should clear all jobs', () => {
    const queue = new IndexedPriorityQueue();
    queue.push(makeJob(1));
    queue.push(makeJob(2));

    queue.clear();
    expect(queue.size).toBe(0);
  });
});
