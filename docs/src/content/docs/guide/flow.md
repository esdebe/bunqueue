---
title: "FlowProducer — Job Dependencies, Chains & Parallel Workflows"
description: "Build complex job workflows in bunqueue with FlowProducer. Sequential chains, parallel fan-out/merge, and hierarchical dependency trees."
head:
  - tag: meta
    attrs:
      property: og:image
      content: https://bunqueue.dev/og/client-sdk.png
---

Create job flows with automatic dependency management: sequential chains, parallel execution with merge, and tree structures.

## Basic Usage

```typescript
import { FlowProducer } from 'bunqueue/client';

const flow = new FlowProducer({ embedded: true });
```

## Sequential Chain

Execute jobs in sequence where each job depends on the previous one completing.

```typescript
// A → B → C (sequential execution)
const { jobIds } = await flow.addChain([
  { name: 'fetch', queueName: 'pipeline', data: { url: 'https://api.example.com' } },
  { name: 'process', queueName: 'pipeline', data: {} },
  { name: 'store', queueName: 'pipeline', data: {} },
]);

console.log('Chain job IDs:', jobIds);
// Jobs execute in order: fetch completes → process starts → store starts
```

## Parallel with Merge

Run multiple jobs in parallel, then execute a final job after all complete.

```typescript
//   task1 ──┐
//   task2 ──┼──→ merge
//   task3 ──┘

const { parallelIds, finalId } = await flow.addBulkThen(
  [
    { name: 'fetch-api-1', queueName: 'parallel', data: { source: 'api1' } },
    { name: 'fetch-api-2', queueName: 'parallel', data: { source: 'api2' } },
    { name: 'fetch-api-3', queueName: 'parallel', data: { source: 'api3' } },
  ],
  { name: 'merge-results', queueName: 'parallel', data: {} }
);

console.log('Parallel IDs:', parallelIds);
console.log('Final merge job:', finalId);
```

## Tree Structure

Create hierarchical job trees where children depend on their parent.

```typescript
const { jobIds } = await flow.addTree({
  name: 'root',
  queueName: 'tree',
  data: { level: 0 },
  children: [
    {
      name: 'branch-1',
      queueName: 'tree',
      data: { level: 1 },
      children: [
        { name: 'leaf-1a', queueName: 'tree', data: { level: 2 } },
        { name: 'leaf-1b', queueName: 'tree', data: { level: 2 } },
      ],
    },
    {
      name: 'branch-2',
      queueName: 'tree',
      data: { level: 1 },
    },
  ],
});
```

## Accessing Parent Results

Workers can access results from previous jobs in the chain.

:::note[Automatic Properties]
When using FlowProducer, bunqueue automatically injects special properties into job data:
- `__flowParentId` - Parent job ID (for chain/tree flows)
- `__flowParentIds` - Array of parent IDs (for merge flows)
- `__parentId` - Parent job ID (BullMQ v5 compatible)
- `__parentQueue` - Parent job queue name (BullMQ v5 compatible)
- `__childrenIds` - Children job IDs (BullMQ v5 compatible)

These allow child jobs to access parent results. All fields are fully typed via the `FlowJobData` interface — IntelliSense works automatically inside Worker processors.
:::

:::tip[Persistence]
Parent-child relationships set via `updateJobParent` are persisted to SQLite. Both the parent's `childrenIds` and the child's `__parentId` survive server restarts. This ensures flow dependency graphs remain intact across process restarts when using durable storage.
:::

### `FlowJobData` Type

The `FlowJobData` interface is automatically intersected with your job data type `T` in Worker callbacks. You can also import it explicitly:

```typescript
import type { FlowJobData } from 'bunqueue/client';

interface MyJobData extends FlowJobData {
  email: string;
  subject: string;
}
```

```typescript
import { FlowProducer, Worker } from 'bunqueue/client';

const flow = new FlowProducer({ embedded: true });

const worker = new Worker('pipeline', async (job) => {
  // Check if this job has a parent (chain scenario)
  // __flowParentId is automatically injected by FlowProducer
  if (job.data.__flowParentId) {
    const parentResult = flow.getParentResult(job.data.__flowParentId);
    console.log('Parent result:', parentResult);
  }

  // Check if this job has multiple parents (merge scenario)
  // __flowParentIds is automatically injected for merge flows
  if (job.data.__flowParentIds) {
    const parentResults = flow.getParentResults(job.data.__flowParentIds);
    parentResults.forEach((result, id) => {
      console.log(`Parent ${id}:`, result);
    });
  }

  return { processed: true };
}, { embedded: true });
```

## Job Options

Each step can have its own options.

```typescript
await flow.addChain([
  {
    name: 'fetch',
    queueName: 'pipeline',
    data: { url: '...' },
    opts: {
      priority: 10,
      attempts: 5,
      timeout: 30000,
    },
  },
  {
    name: 'process',
    queueName: 'pipeline',
    data: {},
    opts: {
      delay: 1000,  // Wait 1s after fetch completes
    },
  },
]);
```

## FlowStep Interface

```typescript
interface FlowStep<T = unknown> {
  name: string;           // Job name
  queueName: string;      // Target queue
  data: T;                // Job data
  opts?: JobOptions;      // Optional job options
  children?: FlowStep[];  // Child steps (for tree structures)
}
```

## BullMQ v5 Compatible API

FlowProducer also supports the BullMQ v5 flow API where children are processed **before** their parent. This is the inverse of the bunqueue-native API above.

:::note[EventEmitter]
FlowProducer extends Node.js `EventEmitter` (BullMQ v5 compatible). The `close()` method returns `Promise<void>`, and the `closing` property tracks shutdown state.
:::

### `add(flow, opts?)` — Add a Flow Tree

```typescript
const result = await flow.add({
  name: 'parent-job',
  queueName: 'my-queue',
  data: { type: 'report' },
  children: [
    { name: 'child-1', queueName: 'my-queue', data: { section: 'intro' } },
    { name: 'child-2', queueName: 'my-queue', data: { section: 'body' } },
  ],
});

// result.job — the parent Job
// result.children — array of JobNode (each with .job and optional .children)
```

Children complete first, then the parent becomes available for processing. Inside the parent's worker, use `job.getChildrenValues()` to access child results.

**Atomicity:** If any part of the flow fails during creation, all already-created jobs are automatically rolled back (cancelled). This ensures you never end up with partial flows.

### `add()` with FlowOpts

Pass per-queue default job options as the second argument:

```typescript
const result = await flow.add(
  {
    name: 'report',
    queueName: 'reports',
    children: [
      { name: 'fetch', queueName: 'api', data: { url: '...' } },
      { name: 'render', queueName: 'cpu', data: {} },
    ],
  },
  {
    queuesOptions: {
      api: { attempts: 5, backoff: 2000 },  // defaults for all 'api' jobs
      cpu: { timeout: 60000 },               // defaults for all 'cpu' jobs
    },
  }
);
```

Per-job `opts` override `queuesOptions` defaults.

### `addBulk(flows)` — Add Multiple Flows

```typescript
const results = await flow.addBulk([
  { name: 'report-1', queueName: 'reports', data: {}, children: [...] },
  { name: 'report-2', queueName: 'reports', data: {}, children: [...] },
]);
```

**Atomicity:** If any flow in the batch fails, all jobs from all flows are rolled back.

### `getFlow(opts)` — Retrieve a Flow Tree

```typescript
const tree = await flow.getFlow({
  id: 'job-123',          // Root job ID
  queueName: 'my-queue',  // Queue name
  depth: 3,               // Max depth to traverse (default: Infinity)
  maxChildren: 100,       // Max children per node (default: unlimited)
});

if (tree) {
  console.log(tree.job.id);       // Root job
  console.log(tree.children);     // Child nodes (recursive)
}
```

## failParentOnFailure

When a child job fails terminally (no more retries) and has `failParentOnFailure: true`, the parent job is automatically moved to `failed` state — even if other children are still running.

```typescript
const result = await flow.add({
  name: 'report',
  queueName: 'reports',
  data: {},
  children: [
    {
      name: 'critical-fetch',
      queueName: 'api',
      data: { url: '...' },
      opts: {
        failParentOnFailure: true,  // Parent fails if this child fails
        attempts: 3,
      },
    },
    {
      name: 'optional-fetch',
      queueName: 'api',
      data: { url: '...' },
      opts: {
        // No failParentOnFailure — parent continues if this fails
        attempts: 1,
      },
    },
  ],
});
```

**Related options:**
| Option | Behavior |
|--------|----------|
| `failParentOnFailure` | Parent moves to `failed` when this child terminally fails |
| `removeDependencyOnFailure` | Remove this child's dependency link on failure (parent ignores it) |
| `continueParentOnFailure` | Parent continues processing even if this child fails |
| `ignoreDependencyOnFailure` | Move to parent's failed dependencies instead of blocking |

### FlowJob Interface

```typescript
interface FlowJob<T = unknown> {
  name: string;           // Job name
  queueName: string;      // Target queue
  data: T;                // Job data
  opts?: JobOptions;      // Optional job options
  children?: FlowJob[];   // Child jobs (processed BEFORE parent)
}
```

### JobNode Interface

```typescript
interface JobNode<T = unknown> {
  job: Job<T>;            // The job instance
  children?: JobNode[];   // Child nodes
}
```

## Methods Reference

| Method | Description |
|--------|-------------|
| `add(flow, opts?)` | BullMQ v5: tree where children complete before parent |
| `addBulk(flows[])` | BullMQ v5: add multiple flow trees (atomic) |
| `getFlow(opts)` | BullMQ v5: retrieve a flow tree by root job ID |
| `addChain(steps[])` | Sequential execution: A → B → C |
| `addBulkThen(parallel[], final)` | Parallel then converge: [A, B, C] → D |
| `addTree(root)` | Hierarchical tree with nested children |
| `getParentResult(parentId)` | Get result from single parent job (embedded only) |
| `getParentResults(parentIds[])` | Get results from multiple parent jobs (embedded only) |
| `close()` | Close connection pool, returns `Promise<void>` |
| `disconnect()` | Alias for `close()` |
| `waitUntilReady()` | Wait until FlowProducer is connected |

## Complete Example

```typescript
import { FlowProducer, Worker, Queue, shutdownManager } from 'bunqueue/client';

// Create queues
const pipelineQueue = new Queue('pipeline', { embedded: true });

// Create flow producer
const flow = new FlowProducer({ embedded: true });

// Create worker
const worker = new Worker('pipeline', async (job) => {
  console.log(`Processing ${job.data.name || job.name}`);

  if (job.name === 'fetch') {
    // Simulate API call
    return { data: [1, 2, 3] };
  }

  if (job.name === 'process') {
    // Access parent result
    const fetchResult = flow.getParentResult(job.data.__flowParentId);
    return { processed: fetchResult.data.map(x => x * 2) };
  }

  if (job.name === 'store') {
    const processResult = flow.getParentResult(job.data.__flowParentId);
    console.log('Storing:', processResult.processed);
    return { stored: true };
  }

  return {};
}, { embedded: true, concurrency: 3 });

// Add a pipeline
const { jobIds } = await flow.addChain([
  { name: 'fetch', queueName: 'pipeline', data: {} },
  { name: 'process', queueName: 'pipeline', data: {} },
  { name: 'store', queueName: 'pipeline', data: {} },
]);

console.log('Pipeline started with jobs:', jobIds);

// Cleanup
process.on('SIGINT', async () => {
  await worker.close();
  shutdownManager();
  process.exit(0);
});
```

:::tip[Related Guides]
- [Queue API](/guide/queue/) - Job options and queue configuration
- [Worker API](/guide/worker/) - Process flow jobs with workers
:::
