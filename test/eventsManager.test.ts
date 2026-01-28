/**
 * Events Manager Tests
 * Event subscription and broadcasting
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { QueueManager } from '../src/application/queueManager';
import { EventType } from '../src/domain/types/queue';

describe('Events Manager', () => {
  let qm: QueueManager;

  beforeEach(() => {
    qm = new QueueManager();
  });

  afterEach(() => {
    qm.shutdown();
  });

  describe('subscribe', () => {
    test('should receive push events', async () => {
      const events: string[] = [];

      qm.subscribe((event) => {
        events.push(event.eventType);
      });

      await qm.push('test-queue', { data: {} });

      expect(events).toContain('pushed');
    });

    test('should receive pull events', async () => {
      const events: string[] = [];

      qm.subscribe((event) => {
        events.push(event.eventType);
      });

      await qm.push('test-queue', { data: {} });
      await qm.pull('test-queue');

      expect(events).toContain('pulled');
    });

    test('should receive completed events', async () => {
      const events: string[] = [];

      qm.subscribe((event) => {
        events.push(event.eventType);
      });

      await qm.push('test-queue', { data: {} });
      const job = await qm.pull('test-queue');
      await qm.ack(job!.id, { result: 'done' });

      expect(events).toContain('completed');
    });

    test('should receive failed events', async () => {
      const events: string[] = [];

      qm.subscribe((event) => {
        events.push(event.eventType);
      });

      await qm.push('test-queue', { data: {}, maxAttempts: 1 });
      const job = await qm.pull('test-queue');
      await qm.fail(job!.id, 'Error');

      expect(events).toContain('failed');
    });

    test('should include job data in event', async () => {
      let capturedEvent: { jobId?: unknown; queue?: string; data?: unknown } | null = null;

      qm.subscribe((event) => {
        if (event.eventType === EventType.Pushed) {
          capturedEvent = event;
        }
      });

      await qm.push('test-queue', { data: { message: 'hello' } });

      expect(capturedEvent).not.toBeNull();
      expect(capturedEvent!.queue).toBe('test-queue');
      expect(capturedEvent!.jobId).toBeDefined();
    });

    test('should include result in completed event', async () => {
      let capturedData: unknown = null;

      qm.subscribe((event) => {
        if (event.eventType === EventType.Completed) {
          capturedData = event.data;
        }
      });

      await qm.push('test-queue', { data: {} });
      const job = await qm.pull('test-queue');
      await qm.ack(job!.id, { success: true, output: 'processed' });

      expect(capturedData).toEqual({ success: true, output: 'processed' });
    });
  });

  describe('unsubscribe', () => {
    test('should stop receiving events after unsubscribe', async () => {
      const events: string[] = [];

      const unsubscribe = qm.subscribe((event) => {
        events.push(event.eventType);
      });

      await qm.push('test-queue', { data: { id: 1 } });
      expect(events.length).toBe(1);

      unsubscribe();

      await qm.push('test-queue', { data: { id: 2 } });
      expect(events.length).toBe(1); // No new events
    });
  });

  describe('multiple subscribers', () => {
    test('should notify all subscribers', async () => {
      const events1: string[] = [];
      const events2: string[] = [];

      qm.subscribe((event) => {
        events1.push(event.eventType);
      });

      qm.subscribe((event) => {
        events2.push(event.eventType);
      });

      await qm.push('test-queue', { data: {} });

      expect(events1).toContain('pushed');
      expect(events2).toContain('pushed');
    });

    test('should handle subscriber errors gracefully', async () => {
      const events: string[] = [];

      // First subscriber throws
      qm.subscribe(() => {
        throw new Error('Subscriber error');
      });

      // Second subscriber should still receive events
      qm.subscribe((event) => {
        events.push(event.eventType);
      });

      await qm.push('test-queue', { data: {} });

      expect(events).toContain('pushed');
    });
  });

  describe('event timing', () => {
    test('should include timestamp in events', async () => {
      let timestamp = 0;

      qm.subscribe((event) => {
        timestamp = event.timestamp;
      });

      const before = Date.now();
      await qm.push('test-queue', { data: {} });
      const after = Date.now();

      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('event types', () => {
    test('should emit events for multiple pushes', async () => {
      const events: string[] = [];

      qm.subscribe((event) => {
        events.push(event.eventType);
      });

      await qm.push('test-queue', { data: { id: 1 } });
      await qm.push('test-queue', { data: { id: 2 } });

      // Should receive 2 pushed events
      expect(events.filter((e) => e === 'pushed').length).toBe(2);
    });
  });
});
