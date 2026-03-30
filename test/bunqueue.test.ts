import { describe, test, expect, afterEach } from 'bun:test';
import { Bunqueue, shutdownManager } from '../src/client';

afterEach(() => {
  shutdownManager();
});

// ============ Basic ============

describe('Bunqueue', () => {
  test('should create queue and worker together', () => {
    const bq = new Bunqueue('test-basic', {
      processor: async () => ({ ok: true }),
    });

    expect(bq.name).toBe('test-basic');
    expect(bq.queue).toBeDefined();
    expect(bq.worker).toBeDefined();
    expect(bq.isRunning()).toBe(true);
  });

  test('should add and process jobs', async () => {
    const processed: string[] = [];

    const bq = new Bunqueue<{ email: string }, { sent: boolean }>('test-process', {
      processor: async (job) => {
        processed.push(job.data.email);
        return { sent: true };
      },
      concurrency: 1,
    });

    await bq.add('send', { email: 'a@test.com' });
    await bq.add('send', { email: 'b@test.com' });

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (processed.length >= 2) {
          clearInterval(check);
          resolve();
        }
      }, 10);
    });

    expect(processed).toContain('a@test.com');
    expect(processed).toContain('b@test.com');
  });

  test('should emit completed events', async () => {
    const results: unknown[] = [];

    const bq = new Bunqueue<{ v: number }, { doubled: number }>('test-events', {
      processor: async (job) => ({ doubled: job.data.v * 2 }),
    });

    bq.on('completed', (_job, result) => {
      results.push(result);
    });

    await bq.add('double', { v: 5 });

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (results.length >= 1) {
          clearInterval(check);
          resolve();
        }
      }, 10);
    });

    expect(results[0]).toEqual({ doubled: 10 });
  });

  test('should emit failed events', async () => {
    const errors: Error[] = [];

    const bq = new Bunqueue('test-fail', {
      processor: async () => {
        throw new Error('boom');
      },
    });

    bq.on('failed', (_job, err) => {
      errors.push(err);
    });

    await bq.add('fail-task', { v: 1 });

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (errors.length >= 1) {
          clearInterval(check);
          resolve();
        }
      }, 10);
    });

    expect(errors[0].message).toBe('boom');
  });

  test('should support addBulk', async () => {
    let count = 0;

    const bq = new Bunqueue<{ i: number }>('test-bulk', {
      processor: async () => {
        count++;
        return { ok: true };
      },
      concurrency: 5,
    });

    await bq.addBulk([
      { name: 'task', data: { i: 1 } },
      { name: 'task', data: { i: 2 } },
      { name: 'task', data: { i: 3 } },
    ]);

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (count >= 3) {
          clearInterval(check);
          resolve();
        }
      }, 10);
    });

    expect(count).toBe(3);
  });

  test('should support pause and resume', () => {
    const bq = new Bunqueue('test-pause', {
      processor: async () => ({ ok: true }),
    });

    expect(bq.isPaused()).toBe(false);
    bq.pause();
    expect(bq.isPaused()).toBe(true);
    bq.resume();
    expect(bq.isPaused()).toBe(false);
  });

  test('should close gracefully', async () => {
    const bq = new Bunqueue('test-close', {
      processor: async () => ({ ok: true }),
    });

    expect(bq.isClosed()).toBe(false);
    await bq.close();
    expect(bq.isClosed()).toBe(true);
  });

  test('should support concurrency option', () => {
    const bq = new Bunqueue('test-concurrency', {
      processor: async () => ({ ok: true }),
      concurrency: 10,
    });

    expect(bq.worker.opts.concurrency).toBe(10);
  });

  test('should expose getJob', async () => {
    const bq = new Bunqueue<{ v: number }>('test-getjob', {
      processor: async () => ({ ok: true }),
      autorun: false,
    });

    const job = await bq.add('task', { v: 42 });
    const found = await bq.getJob(job.id);

    expect(found).not.toBeNull();
    expect(found!.data.v).toBe(42);
  });

  test('should expose getJobCounts', async () => {
    const bq = new Bunqueue<{ v: number }>('test-counts', {
      processor: async () => ({ ok: true }),
      autorun: false,
    });

    await bq.add('task', { v: 1 });
    await bq.add('task', { v: 2 });

    const counts = bq.getJobCounts();
    expect(counts.waiting).toBeGreaterThanOrEqual(2);
  });

  test('should support progress updates', async () => {
    const progressValues: number[] = [];

    const bq = new Bunqueue<{ v: number }>('test-progress', {
      processor: async (job) => {
        await job.updateProgress(50);
        await job.updateProgress(100);
        return { done: true };
      },
    });

    bq.on('progress', (_job, progress) => {
      progressValues.push(progress);
    });

    await bq.add('task', { v: 1 });

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (progressValues.length >= 2) {
          clearInterval(check);
          resolve();
        }
      }, 10);
    });

    expect(progressValues).toContain(50);
    expect(progressValues).toContain(100);
  });

  test('should chain on() calls', () => {
    const bq = new Bunqueue('test-chain', {
      processor: async () => ({ ok: true }),
    });

    const result = bq
      .on('completed', () => {})
      .on('failed', () => {})
      .on('error', () => {});

    expect(result).toBe(bq);
  });

  test('should support once()', async () => {
    let readyCount = 0;

    const bq = new Bunqueue('test-once', {
      processor: async () => ({ ok: true }),
      autorun: false,
    });

    bq.once('ready', () => {
      readyCount++;
    });

    bq.worker.run();

    await Bun.sleep(50);
    expect(readyCount).toBe(1);
  });

  test('should support off()', () => {
    const bq = new Bunqueue('test-off', {
      processor: async () => ({ ok: true }),
    });

    const listener = () => {};
    bq.on('completed', listener);
    bq.off('completed', listener);

    expect(bq.worker.listenerCount('completed')).toBe(0);
  });

  test('should support defaultJobOptions', async () => {
    const bq = new Bunqueue<{ v: number }>('test-defaults', {
      processor: async () => ({ ok: true }),
      autorun: false,
      defaultJobOptions: { priority: 10 },
    });

    const job = await bq.add('task', { v: 1 });
    expect(job).toBeDefined();
  });

  test('should throw if neither processor nor routes', () => {
    expect(() => {
      new Bunqueue('test-err', {} as never);
    }).toThrow('requires either');
  });

  test('should throw if both processor and routes', () => {
    expect(() => {
      new Bunqueue('test-err2', {
        processor: async () => ({}),
        routes: { a: async () => ({}) },
      } as never);
    }).toThrow('not both');
  });
});

// ============ Routes ============

describe('Bunqueue - Routes', () => {
  test('should route jobs by name', async () => {
    const log: string[] = [];

    const bq = new Bunqueue<{ to: string }>('test-routes', {
      routes: {
        'send-email': async (job) => {
          log.push(`email:${job.data.to}`);
          return { channel: 'email' };
        },
        'send-sms': async (job) => {
          log.push(`sms:${job.data.to}`);
          return { channel: 'sms' };
        },
      },
      concurrency: 2,
    });

    await bq.add('send-email', { to: 'alice' });
    await bq.add('send-sms', { to: 'bob' });

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (log.length >= 2) {
          clearInterval(check);
          resolve();
        }
      }, 10);
    });

    expect(log).toContain('email:alice');
    expect(log).toContain('sms:bob');
  });

  test('should fail for unknown route', async () => {
    const errors: Error[] = [];

    const bq = new Bunqueue('test-no-route', {
      routes: {
        known: async () => ({ ok: true }),
      },
    });

    bq.on('failed', (_job, err) => {
      errors.push(err);
    });

    await bq.add('unknown-job', {});

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (errors.length >= 1) {
          clearInterval(check);
          resolve();
        }
      }, 10);
    });

    expect(errors[0].message).toContain('No route for job "unknown-job"');
  });

  test('should handle multiple routes with different data', async () => {
    const results: unknown[] = [];

    const bq = new Bunqueue<{ value: number }>('test-routes-data', {
      routes: {
        double: async (job) => ({ result: job.data.value * 2 }),
        triple: async (job) => ({ result: job.data.value * 3 }),
      },
    });

    bq.on('completed', (_job, result) => {
      results.push(result);
    });

    await bq.add('double', { value: 5 });
    await bq.add('triple', { value: 5 });

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (results.length >= 2) {
          clearInterval(check);
          resolve();
        }
      }, 10);
    });

    expect(results).toContainEqual({ result: 10 });
    expect(results).toContainEqual({ result: 15 });
  });
});

// ============ Middleware ============

describe('Bunqueue - Middleware', () => {
  test('should execute middleware around processor', async () => {
    const order: string[] = [];

    const bq = new Bunqueue<{ v: number }>('test-mw', {
      processor: async (job) => {
        order.push(`process:${job.data.v}`);
        return { ok: true };
      },
    });

    bq.use(async (_job, next) => {
      order.push('before');
      const result = await next();
      order.push('after');
      return result;
    });

    await bq.add('task', { v: 1 });

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (order.length >= 3) {
          clearInterval(check);
          resolve();
        }
      }, 10);
    });

    expect(order).toEqual(['before', 'process:1', 'after']);
  });

  test('should chain multiple middlewares in order', async () => {
    const order: string[] = [];

    const bq = new Bunqueue('test-mw-chain', {
      processor: async () => {
        order.push('core');
        return { ok: true };
      },
    });

    bq.use(async (_job, next) => {
      order.push('mw1-before');
      const r = await next();
      order.push('mw1-after');
      return r;
    });

    bq.use(async (_job, next) => {
      order.push('mw2-before');
      const r = await next();
      order.push('mw2-after');
      return r;
    });

    await bq.add('task', {});

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (order.length >= 5) {
          clearInterval(check);
          resolve();
        }
      }, 10);
    });

    expect(order).toEqual(['mw1-before', 'mw2-before', 'core', 'mw2-after', 'mw1-after']);
  });

  test('middleware can modify the result', async () => {
    const results: unknown[] = [];

    const bq = new Bunqueue<{ v: number }>('test-mw-modify', {
      processor: async (job) => ({ value: job.data.v }),
    });

    bq.use(async (_job, next) => {
      const result = await next();
      return { ...result, enhanced: true };
    });

    bq.on('completed', (_job, result) => {
      results.push(result);
    });

    await bq.add('task', { v: 42 });

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (results.length >= 1) {
          clearInterval(check);
          resolve();
        }
      }, 10);
    });

    expect(results[0]).toEqual({ value: 42, enhanced: true });
  });

  test('middleware can catch errors', async () => {
    const recovered: unknown[] = [];

    const bq = new Bunqueue('test-mw-catch', {
      processor: async () => {
        throw new Error('oops');
      },
    });

    bq.use(async (_job, next) => {
      try {
        return await next();
      } catch {
        recovered.push('caught');
        return { recovered: true };
      }
    });

    bq.on('completed', (_job, result) => {
      recovered.push(result);
    });

    await bq.add('task', {});

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (recovered.length >= 2) {
          clearInterval(check);
          resolve();
        }
      }, 10);
    });

    expect(recovered).toContain('caught');
    expect(recovered).toContainEqual({ recovered: true });
  });

  test('middleware works with routes', async () => {
    const log: string[] = [];

    const bq = new Bunqueue<{ v: number }>('test-mw-routes', {
      routes: {
        double: async (job) => {
          log.push('route');
          return { result: job.data.v * 2 };
        },
      },
    });

    bq.use(async (_job, next) => {
      log.push('mw');
      return next();
    });

    await bq.add('double', { v: 3 });

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (log.length >= 2) {
          clearInterval(check);
          resolve();
        }
      }, 10);
    });

    expect(log).toEqual(['mw', 'route']);
  });

  test('use() should be chainable', () => {
    const bq = new Bunqueue('test-mw-chain-api', {
      processor: async () => ({ ok: true }),
    });

    const result = bq
      .use(async (_job, next) => next())
      .use(async (_job, next) => next());

    expect(result).toBe(bq);
  });
});

// ============ Cron ============

describe('Bunqueue - Cron', () => {
  test('should add a cron job', async () => {
    const bq = new Bunqueue<{ type: string }>('test-cron', {
      processor: async () => ({ ok: true }),
      autorun: false,
    });

    const info = await bq.cron('daily-report', '0 9 * * *', { type: 'summary' });

    expect(info).not.toBeNull();
    expect(info!.id).toBe('daily-report');
    expect(info!.next).toBeGreaterThan(0);
  });

  test('should add a repeating job with every()', async () => {
    const bq = new Bunqueue<{ type: string }>('test-every', {
      processor: async () => ({ ok: true }),
      autorun: false,
    });

    const info = await bq.every('heartbeat', 5000, { type: 'ping' });

    expect(info).not.toBeNull();
    expect(info!.id).toBe('heartbeat');
    expect(info!.next).toBeGreaterThan(0);
  });

  test('should list cron jobs', async () => {
    const bq = new Bunqueue('test-cron-list', {
      processor: async () => ({ ok: true }),
      autorun: false,
    });

    await bq.cron('job-a', '*/5 * * * *');
    await bq.cron('job-b', '0 * * * *');

    const list = await bq.listCrons();

    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  test('should remove a cron job', async () => {
    const bq = new Bunqueue('test-cron-remove', {
      processor: async () => ({ ok: true }),
      autorun: false,
    });

    await bq.cron('to-remove', '*/10 * * * *');
    await bq.removeCron('to-remove');

    const list = await bq.listCrons();
    const found = list.find((c: { name: string }) => c.name === 'to-remove');
    expect(found).toBeUndefined();
  });

  test('should support timezone in cron', async () => {
    const bq = new Bunqueue('test-cron-tz', {
      processor: async () => ({ ok: true }),
      autorun: false,
    });

    const info = await bq.cron('tz-job', '0 9 * * *', { type: 'report' }, {
      timezone: 'Europe/Rome',
    });

    expect(info).not.toBeNull();
  });
});
