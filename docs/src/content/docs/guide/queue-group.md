---
title: Queue Group
description: Namespace isolation for related queues
head:
  - tag: meta
    attrs:
      property: og:image
      content: https://egeominotti.github.io/bunqueue/og/client-sdk.png
---

`QueueGroup` provides namespace isolation for related queues. All queues in a group share a common prefix.

## Basic Usage

```typescript
import { QueueGroup } from 'bunqueue/client';

// Create a group with namespace (embedded mode)
const billing = new QueueGroup('billing', { embedded: true });

// Get queues (automatically prefixed)
const invoices = billing.getQueue('invoices');   // → "billing:invoices"
const payments = billing.getQueue('payments');   // → "billing:payments"

// Add jobs
await invoices.add('create', { amount: 100 });
await payments.add('process', { orderId: '123' });
```

## Creating Workers

```typescript
// Create worker for a queue in the group
const invoiceWorker = billing.getWorker('invoices', async (job) => {
  console.log('Processing invoice:', job.data);
  return { processed: true };
}, { embedded: true });

const paymentWorker = billing.getWorker('payments', async (job) => {
  console.log('Processing payment:', job.data);
  return { processed: true };
}, { embedded: true });
```

## Listing Queues

```typescript
// List all queues in the group (without prefix)
const queues = billing.listQueues();
// ['invoices', 'payments']
```

## Bulk Operations

Perform operations on all queues in the group at once:

```typescript
// Pause all queues in the group
billing.pauseAll();

// Resume all queues in the group
billing.resumeAll();

// Drain all queues (remove waiting jobs)
billing.drainAll();

// Obliterate all queues (remove all data)
billing.obliterateAll();

// Get aggregated stats for all queues
const stats = billing.getStats();
// { waiting: 10, active: 2, completed: 150, failed: 3 }
```

## Options

Pass options when creating the group, queues or workers:

```typescript
const billing = new QueueGroup('billing', { embedded: true });

// Queue with options (inherits embedded from group)
const invoices = billing.getQueue<InvoiceData>('invoices', {
  defaultJobOptions: {
    attempts: 5,
    backoff: 2000,
  }
});

// Worker with options
const worker = billing.getWorker('invoices', processor, {
  embedded: true,
  concurrency: 10,
});
```

## Use Cases

### Multi-Tenant Applications

```typescript
// Create a group per tenant (embedded mode)
const tenantA = new QueueGroup('tenant-a', { embedded: true });
const tenantB = new QueueGroup('tenant-b', { embedded: true });

// Each tenant has isolated queues
const tasksA = tenantA.getQueue('tasks');
const tasksB = tenantB.getQueue('tasks');

// Jobs are isolated
await tasksA.add('process', { tenantId: 'a' });
await tasksB.add('process', { tenantId: 'b' });
```

### Microservice Domains

```typescript
// Group queues by domain (embedded mode)
const orders = new QueueGroup('orders', { embedded: true });
const notifications = new QueueGroup('notifications', { embedded: true });
const analytics = new QueueGroup('analytics', { embedded: true });

// Each domain has its own queues
const orderQueue = orders.getQueue('process');
const emailQueue = notifications.getQueue('email');
const eventQueue = analytics.getQueue('events');
```

### Environment Separation

```typescript
const env = process.env.NODE_ENV || 'development';
const group = new QueueGroup(`${env}-tasks`);

const queue = group.getQueue('jobs', { embedded: true });
// → "development-tasks:jobs" or "production-tasks:jobs"
```

## Methods Reference

| Method | Description |
|--------|-------------|
| `getQueue(name, opts?)` | Get a queue within the group |
| `getWorker(name, processor, opts?)` | Create a worker for a queue in the group |
| `listQueues()` | List all queue names in the group (without prefix) |
| `pauseAll()` | Pause all queues in the group |
| `resumeAll()` | Resume all queues in the group |
| `drainAll()` | Remove waiting jobs from all queues |
| `obliterateAll()` | Remove all data from all queues |

## Complete Example

```typescript
import { QueueGroup, shutdownManager } from 'bunqueue/client';

interface OrderData {
  orderId: string;
  amount: number;
}

interface NotificationData {
  userId: string;
  message: string;
}

// Create groups
const orders = new QueueGroup('orders');
const notifications = new QueueGroup('notifications');

// Create queues
const orderQueue = orders.getQueue<OrderData>('process', { embedded: true });
const emailQueue = notifications.getQueue<NotificationData>('email', { embedded: true });

// Create workers
const orderWorker = orders.getWorker<OrderData>('process', async (job) => {
  console.log(`Processing order: ${job.data.orderId}`);

  // Create notification after order
  await emailQueue.add('order-confirmation', {
    userId: 'user-123',
    message: `Order ${job.data.orderId} confirmed!`,
  });

  return { processed: true };
}, { embedded: true, concurrency: 5 });

const emailWorker = notifications.getWorker<NotificationData>('email', async (job) => {
  console.log(`Sending email to: ${job.data.userId}`);
  return { sent: true };
}, { embedded: true, concurrency: 3 });

// Add an order
await orderQueue.add('new-order', { orderId: 'ORD-001', amount: 99.99 });

// Check queues in each group
console.log('Order queues:', orders.listQueues());
console.log('Notification queues:', notifications.listQueues());

// Graceful shutdown
process.on('SIGINT', async () => {
  await orderWorker.close();
  await emailWorker.close();
  shutdownManager();
  process.exit(0);
});
```
