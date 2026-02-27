Hey! Switching is pretty straightforward — the API is intentionally close to BullMQ v5.

**Your `processorPath` → `SandboxedWorker`**

```typescript
import { SandboxedWorker } from 'bunqueue/client';

const worker = new SandboxedWorker('product', {
  processor: './src/modules/product/index.sync.ts',
  concurrency: 4,       // your 2 concurrency * 2 handlers
  autoRestart: true,     // auto-restart on crash
});
await worker.start();
```

Your processor file just needs to export a default async function. Instead of `worker.initFail()` / `worker.initComplete()`, you just `throw` on error or `return` on success — retries and DLQ are handled automatically.

**Cron jobs — same syntax**

```typescript
await queue.add('sync', data, {
  repeat: { pattern: '0 0 0 * * *' }
});
```

Or server-side schedulers (survives restarts):

```typescript
await queue.upsertJobScheduler('daily-sync',
  { pattern: '0 0 0 * * *' },
  { name: 'sync', data: { ...customerJobData } }
);
```

**Your event listeners map directly**

| Yours | bunqueue |
|---|---|
| `start` | `active` |
| `end` | `completed` |
| `error` | `failed` |
| `log` | `progress` + `job.log()` |

```typescript
const events = new QueueEvents('product');
events.on('active',    ({ jobId }) => { /* sync started in DB */ });
events.on('completed', ({ jobId, returnvalue }) => { /* sync done in DB */ });
events.on('failed',    ({ jobId, failedReason }) => { /* log error */ });
```

**What you get**
- No Redis — SQLite persistence, way less memory
- ~100k jobs/sec buffered
- Single binary: `bunqueue start` and you're running
- 100k jobs ~ 20-50 MB in memory vs hundreds of MB with Redis

I also wrote a full migration guide with your exact code patterns mapped 1:1: https://github.com/egeominotti/bunqueue/blob/main/MIGRATION_FROM_BULLMQ.md

Let me know if you have any questions!
