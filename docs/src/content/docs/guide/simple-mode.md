---
title: "Simple Mode — Queue + Worker in One Line"
description: "Bunqueue Simple Mode: create a queue and worker in a single object. Routes, middleware, cron, batch processing, advanced retry, circuit breaker, job TTL, priority aging, graceful cancellation — zero boilerplate."
head:
  - tag: meta
    attrs:
      property: og:image
      content: https://bunqueue.dev/og/getting-started.png
---

Simple Mode combines Queue and Worker into a single `Bunqueue` object. Produce jobs, consume them, add middleware, schedule crons, process in batches, retry with jitter, cancel gracefully, protect with circuit breakers — all from one place.

:::tip[When to use Simple Mode]
Use `Bunqueue` when producer and consumer live in the **same process** — microservices, scripts, prototypes, single-instance apps.

For **distributed systems** (producer on one machine, consumer on another), use [`Queue`](/guide/queue/) + [`Worker`](/guide/worker/) separately.
:::

## How It Works

`Bunqueue` is a thin wrapper. The constructor creates a `Queue` and a `Worker` internally, wired to the same queue name and connection. On top of that, it wires up optional subsystems — all built using existing Queue/Worker APIs, zero core modifications:

```
new Bunqueue('emails', opts)
    │
    ├── this.queue  = new Queue('emails', queueOpts)
    ├── this.worker = new Worker('emails', wrappedProcessor, workerOpts)
    │
    └── Optional subsystems (configured via opts):
        ├── RetryEngine ── jitter, fibonacci, exponential, custom backoff
        ├── CircuitBreaker ── pauses worker after N consecutive failures
        ├── BatchAccumulator ── buffers N jobs, processes them as a group
        ├── TriggerManager ── listens to events, creates follow-up jobs
        ├── TtlChecker ── rejects expired jobs before processing
        ├── PriorityAger ── boosts old waiting jobs' priority
        └── CancellationManager ── AbortController per active job
```

The processing pipeline for each job:

```
Job arrives → Circuit Breaker check → TTL check → Register AbortController
  → Retry wrapper (if configured)
    → Middleware chain (mw1 → mw2 → ... → processor/route/batch)
  → On success: reset circuit breaker, unregister controller
  → On failure: track failure in circuit breaker, unregister controller
```

The underlying logic — sharding, SQLite persistence, TCP protocol, write buffer, stall detection, DLQ, lock management — is **100% identical** to using `Queue` + `Worker` separately.

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

await emailQueue.add('send', { email: 'user@example.com' });
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

// Unknown routes fail — job moves to 'failed' state
await notifications.add('send-pigeon', { to: 'dave', message: 'Coo!' });
// Error: No route for job "send-pigeon" in queue "notifications"
```

:::caution
Use `processor`, `routes`, or `batch` — only one. Passing multiple throws an error at construction time. Passing none also throws.
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

Middlewares execute in the order they were added. They wrap like an onion — the first middleware added is the outermost layer:

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

### Error recovery

Middleware can catch errors thrown by the processor and return a fallback result:

```typescript
app.use(async (job, next) => {
  try {
    return await next();
  } catch (err) {
    console.error(`Job ${job.id} failed, recovering...`);
    return { recovered: true, error: err.message };
  }
});
```

### Result enrichment

Middleware can modify the result before it's returned:

```typescript
app.use(async (job, next) => {
  const result = await next();
  return { ...result, processedAt: Date.now() };
});
```

### Middleware with routes

Middleware works identically with `processor`, `routes`, and `batch`. The middleware wraps whichever handler is matched:

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

### Performance note

When no middleware is added, the processor runs directly — zero overhead.

## Batch Processing

Instead of processing jobs one by one, batch mode accumulates N jobs and hands them all to your batch processor at once. This is ideal for bulk database inserts, batch API calls, file uploads, or any operation that benefits from grouping.

### How it works

1. Jobs arrive and are buffered internally
2. When the buffer reaches `size` jobs **or** the `timeout` expires (whichever comes first), the batch processor is called with all buffered jobs
3. The batch processor must return an array of results — one per job, in the same order
4. Each job resolves with its corresponding result

```typescript
const app = new Bunqueue<{ row: Record<string, unknown> }, { inserted: boolean }>('db-inserts', {
  embedded: true,
  batch: {
    size: 50,        // Flush every 50 jobs
    timeout: 2000,   // Or every 2 seconds, whichever comes first
    processor: async (jobs) => {
      // Insert all rows in a single query
      const rows = jobs.map(j => j.data.row);
      await db.insertMany('table', rows);
      return jobs.map(() => ({ inserted: true }));
    },
  },
  concurrency: 10,
});

// Each add() resolves only when its batch is processed
await app.add('insert', { row: { name: 'Alice', age: 30 } });
await app.add('insert', { row: { name: 'Bob', age: 25 } });
```

### Flush behavior

- **Buffer full**: When `size` jobs accumulate, the batch flushes immediately
- **Timeout**: If the buffer has jobs but hasn't reached `size`, it flushes after `timeout` ms
- **Close**: On `close()`, remaining buffered jobs are flushed before shutdown

### Error handling

If the batch processor throws, **all jobs in that batch fail** with the same error. For partial failures, catch errors inside your batch processor and return per-job results:

```typescript
batch: {
  size: 10,
  processor: async (jobs) => {
    return Promise.all(jobs.map(async (job) => {
      try {
        await processOne(job.data);
        return { ok: true };
      } catch {
        return { ok: false };
      }
    }));
  },
}
```

### Batch + Middleware

Middleware wraps each individual job, not the batch. The middleware chain runs per job, and the batch processor receives jobs after middleware has executed:

```
Job 1 → middleware chain → buffer
Job 2 → middleware chain → buffer
Job 3 → middleware chain → buffer
(buffer full) → batch processor([Job 1, Job 2, Job 3])
```

## Advanced Retry

The built-in retry in bunqueue uses fixed or exponential backoff. Simple Mode adds **5 strategies** and a **retry predicate** — all without modifying the core:

### Strategies

| Strategy | Formula | Best for |
|----------|---------|----------|
| `fixed` | `delay` every time | Rate-limited APIs |
| `exponential` | `delay × 2^(attempt-1)` | General purpose |
| `jitter` | `delay × 2^(attempt-1) × random(0.5, 1.0)` | Avoiding thundering herd |
| `fibonacci` | `delay × fib(attempt)` → 1, 1, 2, 3, 5, 8... | Gradual backoff |
| `custom` | Your function | Any custom logic |

### How it works

The retry engine wraps the entire middleware + processor chain. On failure:

1. Check if `attempt < maxAttempts`
2. Check `retryIf` predicate (if configured) — skip retry if it returns `false`
3. Calculate delay using the chosen strategy
4. Wait, then re-execute the entire chain

This is **in-process retry** — the job stays active while retrying. It's different from the core's `attempts` + `backoff` (which re-queues the job). Use Simple Mode retry for fast transient failures (network blips, rate limits). Use core retry for longer recovery (service outages).

### Configuration

```typescript
const app = new Bunqueue('api-calls', {
  embedded: true,
  processor: async (job) => {
    const res = await fetch(job.data.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { status: res.status };
  },

  retry: {
    maxAttempts: 5,       // Total attempts (including first try)
    delay: 1000,          // Base delay in ms
    strategy: 'jitter',   // Avoids thundering herd

    // Only retry on transient errors
    retryIf: (error, attempt) => {
      if (error.message.includes('HTTP 429')) return true;  // rate limit
      if (error.message.includes('HTTP 503')) return true;  // unavailable
      return false;  // don't retry 400, 404, etc.
    },
  },
});
```

### Custom backoff function

Full control over delay calculation:

```typescript
retry: {
  maxAttempts: 10,
  strategy: 'custom',
  customBackoff: (attempt, error) => {
    // Exponential with cap at 30 seconds
    return Math.min(1000 * Math.pow(2, attempt - 1), 30000);
  },
}
```

### Retry timing examples

With `delay: 1000`:

| Attempt | Fixed | Exponential | Jitter (approx) | Fibonacci |
|---------|-------|-------------|------------------|-----------|
| 1 | 1000ms | 1000ms | 500-1000ms | 1000ms |
| 2 | 1000ms | 2000ms | 1000-2000ms | 1000ms |
| 3 | 1000ms | 4000ms | 2000-4000ms | 2000ms |
| 4 | 1000ms | 8000ms | 4000-8000ms | 3000ms |
| 5 | 1000ms | 16000ms | 8000-16000ms | 5000ms |

## Graceful Cancellation

Cancel a running job at any time. The cancellation is cooperative — your processor checks an `AbortSignal` and decides how to clean up.

### How it works

When a job starts processing, Bunqueue registers an `AbortController` for it. You can:

1. Call `app.cancel(jobId)` to abort the controller
2. Inside the processor, check `app.getSignal(jobId)` to get the `AbortSignal`
3. When the signal is aborted, throw an error or clean up and exit

```typescript
const app = new Bunqueue('video-encoding', {
  embedded: true,
  processor: async (job) => {
    const signal = app.getSignal(job.id);

    for (const chunk of videoChunks) {
      // Check cancellation between chunks
      if (signal?.aborted) {
        await cleanupTempFiles(job.id);
        throw new Error('Job cancelled');
      }
      await encodeChunk(chunk);
      await job.updateProgress(chunk.index / videoChunks.length * 100);
    }

    return { encoded: true };
  },
});

const job = await app.add('encode', { videoId: 'abc123' });

// Later — cancel with 5 second grace period
app.cancel(job.id, 5000);
// The signal aborts after 5 seconds, giving the processor time to clean up

// Or cancel immediately
app.cancel(job.id);
```

### AbortSignal with fetch

Pass the signal directly to `fetch` for automatic request cancellation:

```typescript
processor: async (job) => {
  const signal = app.getSignal(job.id);
  const res = await fetch(job.data.url, { signal });
  return { data: await res.json() };
}

// Cancelling the job also cancels the HTTP request
app.cancel(job.id);
```

### API

| Method | Returns | Description |
|--------|---------|-------------|
| `cancel(jobId, gracePeriodMs?)` | `void` | Cancel a running job. Grace period (ms) delays the abort. |
| `isCancelled(jobId)` | `boolean` | Check if a job has been cancelled |
| `getSignal(jobId)` | `AbortSignal \| null` | Get the AbortSignal for a running job (null if not active) |

### Cancellation + Middleware

If a job is cancelled during middleware execution, the next `next()` call will throw `Error('Job cancelled')`. Middleware can catch this for cleanup:

```typescript
app.use(async (job, next) => {
  const resource = await acquireResource();
  try {
    return await next();
  } catch (err) {
    if (err.message === 'Job cancelled') {
      await releaseResource(resource);  // cleanup on cancel
    }
    throw err;
  }
});
```

## Circuit Breaker

Protects your worker when a downstream service goes down. Instead of hammering a broken service with retries, the circuit breaker **pauses the worker** after too many consecutive failures, then gradually recovers.

### States

```
CLOSED (normal) ──→ failures >= threshold ──→ OPEN (paused)
                                                │
                        ←── success ──── HALF-OPEN ←── resetTimeout expires
                        (back to CLOSED)     │
                                        failure → back to OPEN
```

1. **Closed** (default): Jobs process normally. Failures are counted.
2. **Open**: After `threshold` consecutive failures, the worker is **automatically paused**. No jobs are processed. After `resetTimeout` ms, the circuit transitions to half-open.
3. **Half-open**: The worker resumes and processes **one probe job**. If it succeeds → circuit closes (recovered). If it fails → circuit reopens (still broken).

### Configuration

```typescript
const app = new Bunqueue('payment-processor', {
  embedded: true,
  processor: async (job) => {
    const result = await paymentGateway.charge(job.data);
    return result;
  },

  circuitBreaker: {
    threshold: 5,         // Open after 5 consecutive failures
    resetTimeout: 30000,  // Try again after 30 seconds

    onOpen: (failures) => {
      console.error(`Circuit OPEN after ${failures} failures — worker paused`);
      alertOps('Payment gateway down');
    },
    onHalfOpen: () => {
      console.log('Circuit HALF-OPEN — probing with one job...');
    },
    onClose: () => {
      console.log('Circuit CLOSED — recovered');
      alertOps('Payment gateway recovered');
    },
  },
});
```

### Manual control

```typescript
// Check current state
app.getCircuitState(); // 'closed' | 'open' | 'half-open'

// Force reset (e.g., after manual fix)
app.resetCircuit(); // → closes circuit, resets failure count, resumes worker
```

### Circuit breaker + Retry

When both are configured, **retry runs first**. If all retries fail, that counts as one failure toward the circuit breaker threshold. This prevents a single transient error from opening the circuit:

```
Job fails → retry attempt 1 → retry attempt 2 → all retries exhausted → circuit breaker failure += 1
```

## Event Triggers

Automatically create follow-up jobs when a job completes or fails. Like webhooks, but in-process and zero-latency.

### Basic trigger

```typescript
const app = new Bunqueue<{ orderId: string }>('order-pipeline', {
  embedded: true,
  routes: {
    'place-order': async (job) => {
      await saveOrder(job.data.orderId);
      return { orderId: job.data.orderId, total: 99.99 };
    },
    'send-receipt': async (job) => {
      await emailReceipt(job.data.orderId);
      return { sent: true };
    },
    'update-inventory': async (job) => {
      await decrementStock(job.data.orderId);
      return { updated: true };
    },
  },
});

// When 'place-order' completes → create 'send-receipt' AND 'update-inventory'
app.trigger({
  on: 'place-order',           // Watch this job name
  create: 'send-receipt',      // Create this job
  data: (result, job) => ({    // Build the new job's data
    orderId: job.data.orderId,
  }),
});

app.trigger({
  on: 'place-order',
  create: 'update-inventory',
  data: (result, job) => ({
    orderId: job.data.orderId,
  }),
});

// One add() → three jobs total (place-order → send-receipt + update-inventory)
await app.add('place-order', { orderId: 'ORD-001' });
```

### Conditional triggers

Only create the follow-up job if a condition is met:

```typescript
app.trigger({
  on: 'payment',
  event: 'completed',               // Default is 'completed', can also be 'failed'
  create: 'fraud-alert',
  data: (result) => ({ amount: result.amount }),
  condition: (result) => result.amount > 10000,  // Only trigger for large payments
});
```

### Trigger on failure

React to failed jobs:

```typescript
app.trigger({
  on: 'critical-task',
  event: 'failed',
  create: 'alert-oncall',
  data: (error, job) => ({
    failedJobId: job.id,
    error: error.message,
  }),
});
```

### Trigger rule interface

```typescript
interface TriggerRule<T> {
  on: string;                                         // Job name to watch
  event?: 'completed' | 'failed';                     // Event type (default: 'completed')
  create: string;                                     // Job name to create
  data: (result: unknown, job: Job<T>) => T;          // Data builder
  opts?: JobOptions;                                   // Options for the created job
  condition?: (result: unknown, job: Job<T>) => boolean; // Optional filter
}
```

### Chaining

`trigger()` returns `this`:

```typescript
app
  .trigger({ on: 'step-1', create: 'step-2', data: (r) => r })
  .trigger({ on: 'step-2', create: 'step-3', data: (r) => r })
  .trigger({ on: 'step-3', create: 'notify', data: (r) => r });
```

## Job TTL (Time To Live)

Set an expiration time on jobs. If a job isn't processed before its TTL expires, it's rejected at processing time with an "expired" error. This is useful for time-sensitive tasks like OTP verification, real-time notifications, or flash sale processing.

### How it works

TTL is checked **when the worker picks up the job**, not when the job is added. If `Date.now() - job.timestamp > TTL`, the job is immediately rejected without running the processor. The job will be marked as failed with the error message `Job expired`.

```typescript
const app = new Bunqueue('otp-verification', {
  embedded: true,
  processor: async (job) => {
    return await verifyOTP(job.data.code);
  },

  ttl: {
    defaultTtl: 300000,  // 5 minutes — applies to all jobs by default
    perName: {
      'verify-otp': 60000,     // 1 minute for OTP
      'flash-sale': 30000,     // 30 seconds for flash sales
      'daily-report': 0,       // 0 = no TTL (never expires)
    },
  },
});

// This OTP expires in 1 minute
await app.add('verify-otp', { code: '123456' });

// If the worker is busy and doesn't process it within 60s → rejected
```

### Runtime TTL updates

Change TTL dynamically:

```typescript
// Change default TTL for all new jobs
app.setDefaultTtl(120000); // 2 minutes

// Change TTL for a specific job name
app.setNameTtl('urgent-task', 10000); // 10 seconds
```

### TTL resolution order

1. `perName[job.name]` — if a per-name TTL is set, it takes priority
2. `defaultTtl` — fallback for all job names
3. `0` — no TTL (job never expires)

### TTL + Retry

If a job expires during retry attempts, the retry stops immediately. The TTL check runs before each retry:

```
Job picked up → TTL check (expired?) → retry attempt 1 → TTL check → retry attempt 2 → ...
```

## Priority Aging

Prevents starvation of low-priority jobs. Over time, waiting jobs automatically get a priority boost, ensuring they eventually get processed even when higher-priority jobs keep arriving.

### How it works

A background timer runs every `interval` ms. On each tick:

1. Scan up to `maxScan` waiting and prioritized jobs
2. For each job older than `minAge` ms, increase its priority by `boost`
3. Cap priority at `maxPriority` (prevents overflow)

```typescript
const app = new Bunqueue('task-queue', {
  embedded: true,
  processor: async (job) => {
    return { processed: true };
  },

  priorityAging: {
    interval: 60000,    // Check every 60 seconds
    minAge: 300000,     // Start boosting after 5 minutes waiting
    boost: 2,           // Add 2 to priority per tick
    maxPriority: 100,   // Never exceed priority 100
    maxScan: 200,       // Scan up to 200 jobs per tick
  },
});

// A job added with priority 1...
await app.add('task', { data: 'old' }, { priority: 1 });

// After 5 minutes: priority 3
// After 10 minutes: priority 5
// After 25 minutes: priority 11
// Eventually reaches priority 100 (cap)
```

### Priority aging math

Given `boost: 2`, `minAge: 300000` (5min), `interval: 60000` (1min):

| Time waiting | Priority (started at 1) |
|-------------|------------------------|
| 0 - 5 min | 1 (no change, under minAge) |
| 5 - 6 min | 3 (+2 first boost) |
| 6 - 7 min | 5 (+2) |
| 7 - 8 min | 7 (+2) |
| ... | ... |
| ~55 min | 100 (capped at maxPriority) |

### Resource usage

The aging timer is lightweight — it runs `getWaitingAsync()` + `changeJobPriority()` on up to `maxScan` jobs. The timer is `unref()`'d so it doesn't keep the process alive during shutdown.

## Cron Jobs

Schedule recurring jobs with cron expressions or fixed intervals:

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

// Remove a scheduled job
await app.removeCron('healthcheck');
```

Both methods delegate to [`queue.upsertJobScheduler()`](/guide/cron/) internally. See the [Cron Jobs guide](/guide/cron/) for advanced patterns like `skipMissedOnRestart` and `skipIfNoWorker`.

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
const job = await app.getJob('job-id-here');
const counts = app.getJobCounts();           // sync (embedded only)
const counts = await app.getJobCountsAsync(); // async (works with TCP too)
const total = app.count();
```

## Control

### Pause and resume

`pause()` pauses **both** Queue and Worker. In-flight jobs finish normally.

```typescript
app.pause();
app.resume();
```

### Graceful shutdown

`close()` stops all background tasks (aging timer, circuit breaker timer, batch timer), cancels all active jobs, flushes remaining batches, then closes Worker (waits for active jobs) and Queue.

```typescript
await app.close();     // graceful
await app.close(true); // force
```

## Accessing Internal Objects

For advanced operations not directly exposed by Simple Mode:

```typescript
// Queue operations
app.queue.getWaiting();
app.queue.setStallConfig({ stallInterval: 30000 });
app.queue.setDlqConfig({ autoRetry: true });
app.queue.getDlq();

// Worker operations
app.worker.concurrency = 20;
```

## TCP Mode

Simple Mode works with TCP — just pass `connection` instead of `embedded`. Everything works identically:

```typescript
const app = new Bunqueue('tasks', {
  connection: { host: 'localhost', port: 6789 },
  processor: async (job) => ({ ok: true }),
  concurrency: 5,
});
```

## Full Example

All features together:

```typescript
import { Bunqueue, shutdownManager } from 'bunqueue/client';

const app = new Bunqueue<{ payload: string }>('my-app', {
  embedded: true,
  routes: {
    'process-order': async (job) => {
      return { orderId: job.data.payload, status: 'processed' };
    },
    'send-notification': async (job) => {
      return { status: 'sent' };
    },
    'alert-team': async (job) => {
      return { alerted: true };
    },
  },
  concurrency: 10,

  // Retry with jitter to avoid thundering herd
  retry: {
    maxAttempts: 3,
    delay: 1000,
    strategy: 'jitter',
    retryIf: (err) => err.message.includes('transient'),
  },

  // Pause worker after 5 consecutive failures
  circuitBreaker: {
    threshold: 5,
    resetTimeout: 30000,
    onOpen: () => console.error('Circuit opened!'),
  },

  // OTP jobs expire after 1 minute, others after 10 minutes
  ttl: {
    defaultTtl: 600000,
    perName: { 'verify-otp': 60000 },
  },

  // Boost old jobs' priority every minute
  priorityAging: {
    interval: 60000,
    minAge: 300000,
    boost: 1,
    maxPriority: 50,
  },
});

// Middleware: timing
app.use(async (job, next) => {
  const start = Date.now();
  const result = await next();
  console.log(`${job.name}: ${Date.now() - start}ms`);
  return result;
});

// Trigger: order → notification
app.trigger({
  on: 'process-order',
  create: 'send-notification',
  data: (result) => ({ payload: `Order ${result.orderId} confirmed` }),
});

// Trigger: on failure → alert (only for critical orders)
app.trigger({
  on: 'process-order',
  event: 'failed',
  create: 'alert-team',
  data: (err, job) => ({ payload: `FAILED: ${job.data.payload}` }),
});

// Cron: daily cleanup
await app.cron('cleanup', '0 2 * * *', { payload: 'nightly' });

// Events
app.on('completed', (job, result) => console.log('Done:', result));

// Add jobs
await app.add('process-order', { payload: 'ORD-001' });

// Cancel a slow job
const bigJob = await app.add('process-order', { payload: 'ORD-BIG' });
setTimeout(() => app.cancel(bigJob.id, 5000), 10000); // cancel after 10s with 5s grace

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

**Processing mode** (pick one):

| Option | Type | Description |
|--------|------|-------------|
| `processor` | `(job: Job<T>) => Promise<R>` | Single job handler |
| `routes` | `Record<string, Processor>` | Named job handlers |
| `batch` | `BatchConfig<T, R>` | Batch processor (size, timeout, processor) |

**Worker options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `concurrency` | `number` | `1` | Parallel job processing |
| `embedded` | `boolean` | auto | Use embedded SQLite mode |
| `connection` | `ConnectionOptions` | — | TCP server connection |
| `dataPath` | `string` | — | SQLite database path |
| `defaultJobOptions` | `JobOptions` | — | Default options for all jobs |
| `autorun` | `boolean` | `true` | Start worker immediately |
| `heartbeatInterval` | `number` | `10000` | Stall detection interval (ms) |
| `batchSize` | `number` | `10` | Jobs pulled per batch |
| `pollTimeout` | `number` | `0` | Long poll timeout (ms) |
| `autoBatch` | `AutoBatchOptions` | — | Auto-batching (TCP mode) |
| `limiter` | `RateLimiterOptions` | — | Rate limiting |
| `removeOnComplete` | `boolean \| number` | — | Auto-remove completed jobs |
| `removeOnFail` | `boolean \| number` | — | Auto-remove failed jobs |

**Advanced features:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `retry` | `RetryConfig` | — | Advanced retry with jitter/fibonacci/custom |
| `circuitBreaker` | `CircuitBreakerConfig` | — | Auto-pause after N failures |
| `ttl` | `JobTtlConfig` | — | Expire unprocessed jobs |
| `priorityAging` | `PriorityAgingConfig` | — | Boost old jobs' priority |

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| **Queue** | | |
| `add(name, data, opts?)` | `Promise<Job<T>>` | Add a single job |
| `addBulk(jobs)` | `Promise<Job<T>[]>` | Add multiple jobs |
| `getJob(id)` | `Promise<Job<T> \| null>` | Get job by ID |
| `getJobCounts()` | `object` | Counts by state (sync) |
| `getJobCountsAsync()` | `Promise<object>` | Counts by state (async) |
| `count()` / `countAsync()` | `number` / `Promise<number>` | Total job count |
| **Middleware** | | |
| `use(middleware)` | `this` | Add processing middleware |
| **Cron** | | |
| `cron(id, pattern, data?, opts?)` | `Promise<SchedulerInfo>` | Add cron job |
| `every(id, intervalMs, data?, opts?)` | `Promise<SchedulerInfo>` | Add repeating job |
| `removeCron(id)` | `Promise<boolean>` | Remove scheduled job |
| `listCrons()` | `Promise<SchedulerInfo[]>` | List all scheduled jobs |
| **Cancellation** | | |
| `cancel(jobId, gracePeriodMs?)` | `void` | Cancel a running job |
| `isCancelled(jobId)` | `boolean` | Check if job is cancelled |
| `getSignal(jobId)` | `AbortSignal \| null` | Get AbortSignal for a running job |
| **Circuit Breaker** | | |
| `getCircuitState()` | `CircuitState` | `'closed'` / `'open'` / `'half-open'` |
| `resetCircuit()` | `void` | Force close circuit and resume worker |
| **Triggers** | | |
| `trigger(rule)` | `this` | Register an event trigger |
| **TTL** | | |
| `setDefaultTtl(ms)` | `void` | Set default TTL for all jobs |
| `setNameTtl(name, ms)` | `void` | Set TTL for a specific job name |
| **Events** | | |
| `on(event, listener)` | `this` | Listen to worker events |
| `once(event, listener)` | `this` | Listen once |
| `off(event, listener)` | `this` | Remove listener |
| **Control** | | |
| `pause()` | `void` | Pause queue and worker |
| `resume()` | `void` | Resume queue and worker |
| `close(force?)` | `Promise<void>` | Graceful shutdown |
| `isRunning()` / `isPaused()` / `isClosed()` | `boolean` | State checks |

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | Queue name |
| `queue` | `Queue<T>` | Internal Queue instance |
| `worker` | `Worker<T, R>` | Internal Worker instance |
