---
title: "Simple Mode — Queue + Worker in One Line"
description: "Bunqueue Simple Mode: create a queue and worker in a single object. Routes, middleware, cron — zero boilerplate."
head:
  - tag: meta
    attrs:
      property: og:image
      content: https://bunqueue.dev/og/getting-started.png
---

Simple Mode combines Queue and Worker into a single `Bunqueue` object. Produce jobs, consume them, add middleware, schedule crons — all from one place.

:::tip[When to use Simple Mode]
Use `Bunqueue` when producer and consumer live in the **same process** — microservices, scripts, prototypes, single-instance apps.

For **distributed systems** (producer on one machine, consumer on another), use [`Queue`](/guide/queue/) + [`Worker`](/guide/worker/) separately.
:::

## How It Works

`Bunqueue` is a thin wrapper. The constructor creates a `Queue` and a `Worker` internally, wired to the same queue name and connection:

```
new Bunqueue('emails', opts)
    │
    ├── this.queue  = new Queue('emails', queueOpts)
    │
    └── this.worker = new Worker('emails', wrappedProcessor, workerOpts)
```

- **`add()`, `addBulk()`, `getJob()`, `getJobCounts()`, `cron()`, `every()`** delegate to the internal `Queue`
- **`on()`, `once()`, `off()`** delegate to the internal `Worker` (events)
- **`pause()`** pauses both Queue and Worker
- **`resume()`** resumes both Queue and Worker
- **`close()`** closes Worker first (waits for active jobs to finish), then closes Queue

The underlying logic — sharding, SQLite persistence, TCP protocol, write buffer, stall detection, DLQ, lock management — is **100% identical** to using `Queue` + `Worker` separately. Zero modifications to the core.

## Basic Usage

```typescript
import { Bunqueue } from 'bunqueue/client';

const emailQueue = new Bunqueue<{ email: string }>('emails', {
  embedded: true,
  processor: async (job) => {
    await job.updateProgress(50);
    console.log(`Sending to ${job.data.email}`);
    return { sent: true };
  },
  concurrency: 5,
});

emailQueue.on('completed', (job, result) => {
  console.log(`Job ${job.id} done:`, result);
});

emailQueue.on('failed', (job, err) => {
  console.error(`Job ${job.id} failed:`, err.message);
});

await emailQueue.add('send', { email: 'user@example.com' });
```

Compare this with the standard approach — same result, more boilerplate:

```typescript
// Standard: two objects, same config repeated twice
const queue = new Queue('emails', { embedded: true });
const worker = new Worker('emails', processor, { embedded: true, concurrency: 5 });
worker.on('completed', ...);
await queue.add('send', data);
```

## Routes

Route jobs to different handlers by name — no `switch` or `if/else` needed.

When a job arrives, `Bunqueue` looks up `routes[job.name]` and calls the matching handler. If no route matches, the job fails with an error.

```typescript
const notifications = new Bunqueue<{ to: string; message: string }>('notifications', {
  embedded: true,
  routes: {
    'send-email': async (job) => {
      await sendEmail(job.data.to, job.data.message);
      return { channel: 'email' };
    },
    'send-sms': async (job) => {
      await sendSMS(job.data.to, job.data.message);
      return { channel: 'sms' };
    },
    'send-push': async (job) => {
      await sendPush(job.data.to, job.data.message);
      return { channel: 'push' };
    },
  },
  concurrency: 10,
});

// Each job goes to the right handler based on the name
await notifications.add('send-email', { to: 'alice', message: 'Hello!' });
await notifications.add('send-sms', { to: 'bob', message: 'Hey!' });
await notifications.add('send-push', { to: 'charlie', message: 'Yo!' });

// Unknown routes fail — job moves to 'failed' state
await notifications.add('send-pigeon', { to: 'dave', message: 'Coo!' });
// Error: No route for job "send-pigeon" in queue "notifications"
```

:::caution
Use `processor` **or** `routes`, not both. Passing both throws an error at construction time. Passing neither also throws.
:::

## Middleware

Middleware wraps every job's execution — before and after the processor runs. Use it for logging, timing, error recovery, validation, result enrichment.

### How middleware executes

Each middleware receives the `job` and a `next()` function. Calling `next()` passes control to the next middleware in the chain, or to the processor if there are no more middlewares. The return value of `next()` is the processor's result (or the next middleware's result).

```typescript
const app = new Bunqueue('tasks', {
  embedded: true,
  processor: async (job) => {
    return { result: job.data.value * 2 };
  },
});

app.use(async (job, next) => {
  console.log(`[start] ${job.name} #${job.id}`);
  const result = await next();  // calls the processor (or next middleware)
  console.log(`[done] ${job.name} #${job.id}`);
  return result;                // must return the result
});
```

### Execution order

Middlewares are added with `use()` and execute in the order they were added. They wrap like an onion — the first middleware added is the outermost layer:

```typescript
app.use(async (job, next) => {   // 1st added = outermost
  console.log('mw1 before');
  const r = await next();
  console.log('mw1 after');
  return r;
});

app.use(async (job, next) => {   // 2nd added = inner
  console.log('mw2 before');
  const r = await next();
  console.log('mw2 after');
  return r;
});

// Execution for each job:
// mw1 before → mw2 before → processor → mw2 after → mw1 after
```

Visually:

```
middleware 1 (before)
  → middleware 2 (before)
    → processor / route handler
  ← middleware 2 (after)
← middleware 1 (after)
```

### Error recovery

Middleware can catch errors thrown by the processor and return a fallback result. When the middleware catches and returns a value, the job completes successfully (with the recovered result) instead of failing:

```typescript
app.use(async (job, next) => {
  try {
    return await next();
  } catch (err) {
    console.error(`Job ${job.id} failed, recovering...`);
    // Return fallback — job will be marked as 'completed', not 'failed'
    return { recovered: true, error: err.message };
  }
});
```

If the middleware re-throws (or doesn't catch), the error propagates normally and the job fails as usual with retries/DLQ.

### Result enrichment

Middleware can modify the result before it's returned to the worker:

```typescript
app.use(async (job, next) => {
  const result = await next();
  return {
    ...result,
    processedAt: Date.now(),
    processedBy: 'worker-1',
  };
});
```

The enriched result is what gets emitted in the `completed` event and stored as the job result.

### Middleware with routes

Middleware works identically with both `processor` and `routes`. The middleware wraps whichever handler is matched by the job name:

```typescript
const app = new Bunqueue('orders', {
  embedded: true,
  routes: {
    'create-order': async (job) => { /* ... */ },
    'cancel-order': async (job) => { /* ... */ },
  },
});

// This middleware runs for ALL routes
app.use(async (job, next) => {
  console.log(`Processing ${job.name}`);
  return next();
});
```

### Chaining

`use()` returns `this`, so you can chain calls:

```typescript
app
  .use(loggingMiddleware)
  .use(timingMiddleware)
  .use(errorRecoveryMiddleware);
```

### Performance note

When no middleware is added, the processor runs directly — zero overhead. The middleware chain is only built when at least one middleware exists.

## Cron Jobs

Schedule recurring jobs with cron expressions or fixed intervals. Cron jobs produce jobs into the same queue and are processed by the same worker.

```typescript
const app = new Bunqueue<{ type: string }>('scheduler', {
  embedded: true,
  processor: async (job) => {
    console.log(`Running ${job.data.type}`);
    return { ok: true };
  },
});

// Cron pattern (every day at 9 AM)
await app.cron('daily-report', '0 9 * * *', { type: 'report' });

// Cron with timezone
await app.cron('eu-digest', '0 8 * * 1', { type: 'weekly' }, {
  timezone: 'Europe/Rome',
});

// Fixed interval (every 30 seconds)
await app.every('healthcheck', 30000, { type: 'ping' });

// List all scheduled jobs
const crons = await app.listCrons();
console.log(crons); // [{ id: 'daily-report', name: ..., next: ... }, ...]

// Remove a scheduled job
await app.removeCron('healthcheck');
```

### Cron method signatures

```typescript
// Cron pattern
app.cron(schedulerId: string, pattern: string, data?: T, opts?: {
  timezone?: string;    // IANA timezone (default: 'UTC')
  jobOpts?: JobOptions; // priority, delay, attempts, etc.
})

// Fixed interval
app.every(schedulerId: string, intervalMs: number, data?: T, opts?: {
  jobOpts?: JobOptions;
})
```

Both methods delegate to [`queue.upsertJobScheduler()`](/guide/cron/) internally — the full cron feature set is available. See the [Cron Jobs guide](/guide/cron/) for advanced patterns like `skipMissedOnRestart` and `skipIfNoWorker`.

## Events

All worker events are available via `on()`, `once()`, and `off()`:

```typescript
app.on('completed', (job, result) => { });  // Job finished successfully
app.on('failed', (job, error) => { });      // Job failed (after all retries)
app.on('active', (job) => { });             // Job started processing
app.on('progress', (job, progress) => { }); // Progress updated (0-100)
app.on('stalled', (jobId, reason) => { });  // Job stalled (no heartbeat)
app.on('error', (error) => { });            // Worker error
app.on('ready', () => { });                 // Worker started
app.on('drained', () => { });               // Queue empty, no more jobs
app.on('closed', () => { });                // Worker shut down
```

All event methods return `this` for chaining:

```typescript
app
  .on('completed', handleCompleted)
  .on('failed', handleFailed)
  .on('error', handleError);
```

## Adding Jobs

### Single job

```typescript
const job = await app.add('task-name', { key: 'value' });
console.log(job.id); // UUID
```

### With options

```typescript
await app.add('urgent', { data: 'important' }, {
  priority: 10,      // Higher = processed sooner
  delay: 5000,       // Wait 5s before processing
  attempts: 5,       // Retry up to 5 times
  backoff: 2000,     // 2s between retries
  durable: true,     // Immediate disk write (bypass write buffer)
});
```

### Bulk add

```typescript
await app.addBulk([
  { name: 'email', data: { to: 'alice' } },
  { name: 'email', data: { to: 'bob' } },
  { name: 'email', data: { to: 'charlie' }, opts: { priority: 10 } },
]);
```

## Querying

```typescript
// Get a specific job
const job = await app.getJob('job-id-here');
console.log(job?.data, job?.id);

// Get counts by state
const counts = app.getJobCounts();          // sync (embedded only)
const counts = await app.getJobCountsAsync(); // async (works with TCP too)
// { waiting: 5, active: 2, completed: 100, failed: 3, delayed: 1, paused: 0, prioritized: 0 }

// Total count
const total = app.count();             // sync
const total = await app.countAsync();  // async
```

## Control

### Pause and resume

`pause()` pauses **both** the Queue (stops accepting new jobs via cron) and the Worker (stops pulling jobs). In-flight jobs finish normally.

```typescript
app.pause();
console.log(app.isPaused()); // true

// Later...
app.resume();
console.log(app.isPaused()); // false
```

### Graceful shutdown

`close()` first closes the Worker (waits for all active jobs to finish), then closes the Queue (flushes pending batches, releases connections).

```typescript
// Wait for active jobs to finish
await app.close();

// Or force-close (cancel active jobs immediately)
await app.close(true);

// For embedded mode, also shut down the shared manager
shutdownManager();
```

### State checks

```typescript
app.isRunning(); // Worker is actively polling for jobs
app.isPaused();  // Queue and worker are paused
app.isClosed();  // Worker has been shut down
```

## Accessing Internal Objects

For advanced operations not directly exposed by Simple Mode, access the internal `Queue` and `Worker`:

```typescript
const app = new Bunqueue('tasks', { embedded: true, processor: myProcessor });

// Queue operations
app.queue.getWaiting();
app.queue.getDelayed();
app.queue.setStallConfig({ stallInterval: 30000 });
app.queue.setDlqConfig({ autoRetry: true });
app.queue.getDlq();

// Worker operations
app.worker.concurrency = 20;  // Change concurrency at runtime
app.worker.cancelJob(jobId);
app.worker.cancelAllJobs();
```

## TCP Mode

Simple Mode works with TCP too — just pass `connection` instead of `embedded`. Everything (routes, middleware, cron, events) works identically:

```typescript
const app = new Bunqueue('tasks', {
  connection: { host: 'localhost', port: 6789 },
  processor: async (job) => {
    return { ok: true };
  },
  concurrency: 5,
});
```

Requires a running bunqueue server (`bunqueue start` or Docker). See [Server Guide](/guide/server/).

## Full Example

Putting it all together — routes, middleware, cron, events, bulk operations, graceful shutdown:

```typescript
import { Bunqueue, shutdownManager } from 'bunqueue/client';

const app = new Bunqueue<{ payload: string }>('my-app', {
  embedded: true,
  routes: {
    'process-order': async (job) => {
      return { status: 'processed', orderId: job.data.payload };
    },
    'send-notification': async (job) => {
      return { status: 'sent' };
    },
  },
  concurrency: 10,
});

// Middleware: logging + timing
app.use(async (job, next) => {
  const start = Date.now();
  console.log(`→ ${job.name}`);
  const result = await next();
  console.log(`← ${job.name} (${Date.now() - start}ms)`);
  return result;
});

// Middleware: error recovery
app.use(async (job, next) => {
  try {
    return await next();
  } catch (err) {
    console.error(`${job.name} failed:`, err);
    return { status: 'error', recovered: true };
  }
});

// Events
app
  .on('completed', (job, result) => console.log('Done:', result))
  .on('failed', (job, err) => console.error('Failed:', err.message));

// Cron: nightly cleanup
await app.cron('cleanup', '0 2 * * *', { payload: 'nightly' });

// Add jobs
await app.add('process-order', { payload: 'ORD-001' });
await app.add('send-notification', { payload: 'Welcome!' });
await app.addBulk([
  { name: 'process-order', data: { payload: 'ORD-002' } },
  { name: 'process-order', data: { payload: 'ORD-003' } },
]);

// Graceful shutdown
process.on('SIGINT', async () => {
  await app.close();
  shutdownManager();
});
```

## API Reference

### Constructor

```typescript
new Bunqueue<T, R>(name: string, opts: BunqueueOptions<T, R>)
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `processor` | `(job: Job<T>) => Promise<R>` | — | Job handler (use this OR `routes`) |
| `routes` | `Record<string, Processor>` | — | Named job handlers (use this OR `processor`) |
| `concurrency` | `number` | `1` | Parallel job processing |
| `embedded` | `boolean` | auto | Use embedded SQLite mode |
| `connection` | `ConnectionOptions` | — | TCP server connection |
| `dataPath` | `string` | — | SQLite database path |
| `defaultJobOptions` | `JobOptions` | — | Default options for all jobs |
| `autorun` | `boolean` | `true` | Start worker immediately |
| `heartbeatInterval` | `number` | `10000` | Stall detection interval (ms) |
| `batchSize` | `number` | `10` | Jobs pulled per batch |
| `pollTimeout` | `number` | `0` | Long poll timeout (ms) |
| `autoBatch` | `{ enabled, maxSize, maxDelayMs }` | — | Auto-batching (TCP mode) |
| `limiter` | `RateLimiterOptions` | — | Rate limiting |
| `removeOnComplete` | `boolean \| number` | — | Auto-remove completed jobs |
| `removeOnFail` | `boolean \| number` | — | Auto-remove failed jobs |

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `add(name, data, opts?)` | `Promise<Job<T>>` | Add a single job |
| `addBulk(jobs)` | `Promise<Job<T>[]>` | Add multiple jobs at once |
| `getJob(id)` | `Promise<Job<T> \| null>` | Get job by ID |
| `getJobCounts()` | `object` | Counts by state (sync, embedded only) |
| `getJobCountsAsync()` | `Promise<object>` | Counts by state (async, works with TCP) |
| `count()` | `number` | Total job count (sync) |
| `countAsync()` | `Promise<number>` | Total job count (async) |
| `use(middleware)` | `this` | Add processing middleware |
| `cron(id, pattern, data?, opts?)` | `Promise<SchedulerInfo>` | Add cron job |
| `every(id, intervalMs, data?, opts?)` | `Promise<SchedulerInfo>` | Add repeating job |
| `removeCron(id)` | `Promise<boolean>` | Remove scheduled job |
| `listCrons()` | `Promise<SchedulerInfo[]>` | List all scheduled jobs |
| `on(event, listener)` | `this` | Listen to worker events |
| `once(event, listener)` | `this` | Listen once |
| `off(event, listener)` | `this` | Remove listener |
| `pause()` | `void` | Pause queue and worker |
| `resume()` | `void` | Resume queue and worker |
| `close(force?)` | `Promise<void>` | Graceful shutdown (worker first, then queue) |
| `isRunning()` | `boolean` | Worker is actively polling |
| `isPaused()` | `boolean` | Queue and worker are paused |
| `isClosed()` | `boolean` | Worker has been shut down |

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | Queue name |
| `queue` | `Queue<T>` | Internal Queue instance (for advanced operations) |
| `worker` | `Worker<T, R>` | Internal Worker instance (for advanced operations) |
