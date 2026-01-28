<p align="center">
  <img src=".github/banner.svg" alt="bunQ - High-performance job queue for Bun" width="700" />
</p>

<p align="center">
  <a href="https://github.com/egeominotti/bunq/actions"><img src="https://github.com/egeominotti/bunq/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/egeominotti/bunq/releases"><img src="https://img.shields.io/github/v/release/egeominotti/bunq" alt="Release"></a>
  <a href="https://github.com/egeominotti/bunq/blob/main/LICENSE"><img src="https://img.shields.io/github/license/egeominotti/bunq" alt="License"></a>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#sdk">SDK</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#installation">Installation</a> •
  <a href="#api-reference">API</a> •
  <a href="#docker">Docker</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/flashq"><img src="https://img.shields.io/npm/v/flashq" alt="npm"></a>
  <a href="https://www.npmjs.com/package/flashq"><img src="https://img.shields.io/npm/dm/flashq" alt="npm downloads"></a>
</p>

---

## Features

- **Blazing Fast** — Built on Bun runtime with native SQLite, optimized for maximum throughput
- **Persistent Storage** — SQLite with WAL mode for durability and concurrent access
- **Priority Queues** — FIFO, LIFO, and priority-based job ordering
- **Delayed Jobs** — Schedule jobs to run at specific times
- **Cron Scheduling** — Recurring jobs with cron expressions or fixed intervals
- **Retry & Backoff** — Automatic retries with exponential backoff
- **Dead Letter Queue** — Failed jobs preserved for inspection and retry
- **Job Dependencies** — Define parent-child relationships and execution order
- **Progress Tracking** — Real-time progress updates for long-running jobs
- **Rate Limiting** — Per-queue rate limits and concurrency control
- **Webhooks** — HTTP callbacks on job events
- **Real-time Events** — WebSocket and Server-Sent Events (SSE) support
- **Prometheus Metrics** — Built-in metrics endpoint for monitoring
- **Authentication** — Token-based auth for secure access
- **Dual Protocol** — TCP (high performance) and HTTP/REST (compatibility)

## SDK

Install the official TypeScript SDK to use bunQ in your Bun applications.

> **Note:** The SDK requires Bun runtime and a running bunQ server.

### Install

```bash
bun add flashq
```

### Basic Usage

```typescript
import { Queue, Worker } from 'flashq';

// Create a queue
const queue = new Queue('my-queue', {
  connection: { host: 'localhost', port: 6789 }
});

// Add a job
await queue.add('process-data', { userId: 123, action: 'sync' });

// Add with options
await queue.add('send-email',
  { to: 'user@example.com', subject: 'Hello' },
  {
    priority: 10,
    delay: 5000,        // 5 seconds
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 }
  }
);

// Create a worker
const worker = new Worker('my-queue', async (job) => {
  console.log('Processing:', job.name, job.data);

  // Update progress
  await job.updateProgress(50);

  // Do work...

  return { success: true };
}, {
  connection: { host: 'localhost', port: 6789 },
  concurrency: 5
});

// Handle events
worker.on('completed', (job, result) => {
  console.log(`Job ${job.id} completed:`, result);
});

worker.on('failed', (job, err) => {
  console.error(`Job ${job.id} failed:`, err.message);
});
```

### Cron Jobs

```typescript
import { Queue } from 'flashq';

const queue = new Queue('scheduled', {
  connection: { host: 'localhost', port: 6789 }
});

// Every hour
await queue.upsertJobScheduler('hourly-report',
  { pattern: '0 * * * *' },
  { name: 'generate-report', data: { type: 'hourly' } }
);

// Every 5 minutes
await queue.upsertJobScheduler('health-check',
  { every: 300000 },
  { name: 'ping', data: {} }
);
```

### Job Dependencies (Flows)

```typescript
import { FlowProducer } from 'flashq';

const flow = new FlowProducer({
  connection: { host: 'localhost', port: 6789 }
});

// Create a flow with parent-child dependencies
await flow.add({
  name: 'final-step',
  queueName: 'pipeline',
  data: { step: 'aggregate' },
  children: [
    {
      name: 'step-1',
      queueName: 'pipeline',
      data: { step: 'fetch' }
    },
    {
      name: 'step-2',
      queueName: 'pipeline',
      data: { step: 'transform' }
    }
  ]
});
```

### Real-time Events

```typescript
import { QueueEvents } from 'flashq';

const events = new QueueEvents('my-queue', {
  connection: { host: 'localhost', port: 6789 }
});

events.on('completed', ({ jobId, returnvalue }) => {
  console.log(`Job ${jobId} completed with:`, returnvalue);
});

events.on('failed', ({ jobId, failedReason }) => {
  console.error(`Job ${jobId} failed:`, failedReason);
});

events.on('progress', ({ jobId, data }) => {
  console.log(`Job ${jobId} progress:`, data);
});
```

For more examples, see the [SDK documentation](https://www.npmjs.com/package/flashq).

## Quick Start

### Start the Server

```bash
# Using Bun directly
bun run src/main.ts

# Or with Docker
docker run -p 6789:6789 -p 6790:6790 ghcr.io/egeominotti/bunq
```

### Push a Job (HTTP)

```bash
curl -X POST http://localhost:6790/queues/emails/jobs \
  -H "Content-Type: application/json" \
  -d '{"data": {"to": "user@example.com", "subject": "Hello"}}'
```

### Pull a Job (HTTP)

```bash
curl http://localhost:6790/queues/emails/jobs
```

### Acknowledge Completion

```bash
curl -X POST http://localhost:6790/jobs/1/ack \
  -H "Content-Type: application/json" \
  -d '{"result": {"sent": true}}'
```

## Installation

### From Source

```bash
git clone https://github.com/egeominotti/bunq.git
cd bunq
bun install
bun run start
```

### Build Binary

```bash
bun run build
./dist/bunq
```

### Docker

```bash
docker pull ghcr.io/egeominotti/bunq
docker run -d \
  -p 6789:6789 \
  -p 6790:6790 \
  -v bunq-data:/app/data \
  ghcr.io/egeominotti/bunq
```

### Docker Compose

```yaml
version: "3.8"
services:
  bunq:
    image: ghcr.io/egeominotti/bunq
    ports:
      - "6789:6789"
      - "6790:6790"
    volumes:
      - bunq-data:/app/data
    environment:
      - AUTH_TOKENS=your-secret-token

volumes:
  bunq-data:
```

## Usage

### TCP Protocol (High Performance)

Connect via TCP for maximum throughput. Commands are newline-delimited JSON.

```bash
# Connect with netcat
nc localhost 6789

# Push a job
{"cmd":"PUSH","queue":"tasks","data":{"action":"process"}}

# Pull a job
{"cmd":"PULL","queue":"tasks"}

# Acknowledge
{"cmd":"ACK","id":"1"}
```

### HTTP REST API

```bash
# Push job
curl -X POST http://localhost:6790/queues/tasks/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "data": {"action": "process"},
    "priority": 10,
    "delay": 5000,
    "maxAttempts": 5
  }'

# Pull job (with timeout)
curl "http://localhost:6790/queues/tasks/jobs?timeout=30000"

# Get job by ID
curl http://localhost:6790/jobs/123

# Fail a job
curl -X POST http://localhost:6790/jobs/123/fail \
  -H "Content-Type: application/json" \
  -d '{"error": "Processing failed"}'

# Get stats
curl http://localhost:6790/stats
```

### WebSocket (Real-time)

```javascript
const ws = new WebSocket('ws://localhost:6790/ws');

ws.onmessage = (event) => {
  const job = JSON.parse(event.data);
  console.log('Job event:', job);
};

// Subscribe to specific queue
const wsQueue = new WebSocket('ws://localhost:6790/ws/queues/emails');
```

### Server-Sent Events (SSE)

```javascript
const events = new EventSource('http://localhost:6790/events');

events.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Event:', data);
};

// Filter by queue
const queueEvents = new EventSource('http://localhost:6790/events/queues/emails');
```

### Job Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `data` | any | required | Job payload |
| `priority` | number | 0 | Higher = processed first |
| `delay` | number | 0 | Delay in milliseconds |
| `maxAttempts` | number | 3 | Max retry attempts |
| `backoff` | number | 1000 | Initial backoff (ms), doubles each retry |
| `ttl` | number | null | Time-to-live in milliseconds |
| `timeout` | number | null | Job processing timeout |
| `uniqueKey` | string | null | Deduplication key |
| `jobId` | string | null | Custom job identifier |
| `dependsOn` | string[] | [] | Job IDs that must complete first |
| `tags` | string[] | [] | Tags for filtering |
| `groupId` | string | null | Group identifier |
| `lifo` | boolean | false | Last-in-first-out ordering |
| `removeOnComplete` | boolean | false | Auto-delete on completion |
| `removeOnFail` | boolean | false | Auto-delete on failure |

### Cron Jobs

```bash
# Cron expression (every hour)
curl -X POST http://localhost:6790/cron \
  -d '{"cmd":"Cron","name":"hourly-cleanup","queue":"maintenance","data":{"task":"cleanup"},"schedule":"0 * * * *"}'

# Fixed interval (every 5 minutes)
curl -X POST http://localhost:6790/cron \
  -d '{"cmd":"Cron","name":"health-check","queue":"monitoring","data":{"check":"ping"},"repeatEvery":300000}'

# With execution limit
curl -X POST http://localhost:6790/cron \
  -d '{"cmd":"Cron","name":"one-time-migration","queue":"migrations","data":{},"repeatEvery":0,"maxLimit":1}'
```

## API Reference

### Core Operations

| Command | Description |
|---------|-------------|
| `PUSH` | Add a job to a queue |
| `PUSHB` | Batch push multiple jobs |
| `PULL` | Get the next job from a queue |
| `PULLB` | Batch pull multiple jobs |
| `ACK` | Mark job as completed |
| `ACKB` | Batch acknowledge jobs |
| `FAIL` | Mark job as failed |

### Query Operations

| Command | Description |
|---------|-------------|
| `GetJob` | Get job by ID |
| `GetState` | Get job state |
| `GetResult` | Get job result |
| `GetJobs` | List jobs with filters |
| `GetJobCounts` | Count jobs by state |
| `GetJobByCustomId` | Find job by custom ID |
| `GetProgress` | Get job progress |
| `GetLogs` | Get job logs |

### Job Management

| Command | Description |
|---------|-------------|
| `Cancel` | Cancel a pending job |
| `Progress` | Update job progress |
| `Update` | Update job data |
| `ChangePriority` | Change job priority |
| `Promote` | Move delayed job to waiting |
| `MoveToDelayed` | Delay a waiting job |
| `Discard` | Discard a job |
| `Heartbeat` | Send job heartbeat |
| `AddLog` | Add log entry to job |

### Queue Control

| Command | Description |
|---------|-------------|
| `Pause` | Pause queue processing |
| `Resume` | Resume queue processing |
| `IsPaused` | Check if queue is paused |
| `Drain` | Remove all waiting jobs |
| `Obliterate` | Remove all queue data |
| `Clean` | Remove old jobs |
| `ListQueues` | List all queues |
| `RateLimit` | Set queue rate limit |
| `SetConcurrency` | Set max concurrent jobs |

### Dead Letter Queue

| Command | Description |
|---------|-------------|
| `Dlq` | Get failed jobs |
| `RetryDlq` | Retry failed jobs |
| `PurgeDlq` | Clear failed jobs |

### Scheduling

| Command | Description |
|---------|-------------|
| `Cron` | Create/update cron job |
| `CronDelete` | Delete cron job |
| `CronList` | List all cron jobs |

### Workers & Webhooks

| Command | Description |
|---------|-------------|
| `RegisterWorker` | Register a worker |
| `UnregisterWorker` | Unregister a worker |
| `ListWorkers` | List active workers |
| `AddWebhook` | Add webhook endpoint |
| `RemoveWebhook` | Remove webhook |
| `ListWebhooks` | List webhooks |

### Monitoring

| Command | Description |
|---------|-------------|
| `Stats` | Get server statistics |
| `Metrics` | Get job metrics |
| `Prometheus` | Prometheus format metrics |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TCP_PORT` | 6789 | TCP protocol port |
| `HTTP_PORT` | 6790 | HTTP/WebSocket port |
| `HOST` | 0.0.0.0 | Bind address |
| `AUTH_TOKENS` | - | Comma-separated auth tokens |
| `DATA_PATH` | - | SQLite database path (in-memory if not set) |
| `CORS_ALLOW_ORIGIN` | * | Allowed CORS origins |

### Authentication

Enable authentication by setting `AUTH_TOKENS`:

```bash
AUTH_TOKENS=token1,token2 bun run start
```

**HTTP:**
```bash
curl -H "Authorization: Bearer token1" http://localhost:6790/stats
```

**TCP:**
```json
{"cmd":"Auth","token":"token1"}
```

**WebSocket:**
```json
{"cmd":"Auth","token":"token1"}
```

## Monitoring

### Health Check

```bash
curl http://localhost:6790/health
# {"ok":true,"status":"healthy"}
```

### Prometheus Metrics

```bash
curl http://localhost:6790/prometheus
```

Metrics include:
- `bunq_jobs_total{queue,state}` — Job counts by state
- `bunq_jobs_processed_total{queue}` — Total processed jobs
- `bunq_jobs_failed_total{queue}` — Total failed jobs
- `bunq_queue_latency_seconds{queue}` — Processing latency

### Statistics

```bash
curl http://localhost:6790/stats
```

```json
{
  "ok": true,
  "stats": {
    "waiting": 150,
    "active": 10,
    "delayed": 25,
    "completed": 10000,
    "failed": 50,
    "dlq": 5,
    "totalPushed": 10235,
    "totalPulled": 10085,
    "totalCompleted": 10000,
    "totalFailed": 50
  }
}
```

## Docker

### Build

```bash
docker build -t bunq .
```

### Run

```bash
# Basic
docker run -p 6789:6789 -p 6790:6790 bunq

# With persistence
docker run -p 6789:6789 -p 6790:6790 \
  -v bunq-data:/app/data \
  -e DATA_PATH=/app/data/bunq.db \
  bunq

# With authentication
docker run -p 6789:6789 -p 6790:6790 \
  -e AUTH_TOKENS=secret1,secret2 \
  bunq
```

### Docker Compose

```bash
# Production
docker compose up -d

# Development (hot reload)
docker compose --profile dev up bunq-dev
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        bunQ Server                          │
├─────────────────────────────────────────────────────────────┤
│   HTTP/WS (Bun.serve)    │    TCP Protocol (Bun.listen)    │
├─────────────────────────────────────────────────────────────┤
│                      Core Engine                            │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌──────────┐     │
│  │  Queues  │ │ Workers  │ │ Scheduler │ │   DLQ    │     │
│  │ (32 shards) │          │ │  (Cron)   │ │          │     │
│  └──────────┘ └──────────┘ └───────────┘ └──────────┘     │
├─────────────────────────────────────────────────────────────┤
│               SQLite (WAL mode, 256MB mmap)                 │
└─────────────────────────────────────────────────────────────┘
```

### Performance Optimizations

- **32 Shards** — Lock contention minimized with FNV-1a hash distribution
- **WAL Mode** — Concurrent reads during writes
- **Memory-mapped I/O** — 256MB mmap for fast access
- **Batch Operations** — Bulk inserts and updates
- **Bounded Collections** — Automatic memory cleanup

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

```bash
# Install dependencies
bun install

# Run tests
bun test

# Run linter
bun run lint

# Format code
bun run format

# Type check
bun run typecheck

# Run all checks
bun run check
```

## License

MIT License — see [LICENSE](LICENSE) for details.

---

<p align="center">
  Built with <a href="https://bun.sh">Bun</a> 🥟
</p>
