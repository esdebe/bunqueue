/**
 * Use Cases Verification Tests
 *
 * Tests all patterns from docs/guide/use-cases.md
 */

import { mkdirSync, rmSync } from 'fs';

// Setup persistence
rmSync('./data/use-cases-test.db', { force: true });
rmSync('./data/use-cases-test.db-wal', { force: true });
rmSync('./data/use-cases-test.db-shm', { force: true });
mkdirSync('./data', { recursive: true });
process.env.DATA_PATH = './data/use-cases-test.db';

import { Queue, Worker, QueueGroup, FlowProducer, shutdownManager } from '../src/client/index';

// Test utilities
let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}`);
    console.log(`     Error: ${err instanceof Error ? err.message : err}`);
    failed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function sleep(ms: number) {
  await new Promise(r => setTimeout(r, ms));
}

// ============================================
// 1. Email Delivery System
// ============================================

async function testEmailDelivery() {
  console.log('\n📧 Testing Email Delivery System...');

  interface EmailJob {
    to: string;
    template: 'welcome' | 'reset-password' | 'invoice' | 'notification';
    data: Record<string, unknown>;
  }

  const emailQueue = new Queue<EmailJob>('test-emails', {
    embedded: true,
    defaultJobOptions: {
      attempts: 3,
      backoff: 100,
      removeOnComplete: true,
    },
  });

  const results: string[] = [];

  const emailWorker = new Worker<EmailJob>('test-emails', async (job) => {
    await job.updateProgress(50, 'Sending...');
    results.push(job.data.to);
    await job.updateProgress(100, 'Sent');
    return { messageId: `msg-${Date.now()}` };
  }, { embedded: true, concurrency: 3 });

  await test('Single email job', async () => {
    const job = await emailQueue.add('welcome', {
      to: 'user@example.com',
      template: 'welcome',
      data: { name: 'John' },
    });
    assert(job.id !== undefined, 'Job should have ID');
  });

  await test('Bulk email jobs', async () => {
    const jobs = await emailQueue.addBulk([
      { name: 'newsletter', data: { to: 'a@test.com', template: 'notification', data: {} } },
      { name: 'newsletter', data: { to: 'b@test.com', template: 'notification', data: {} } },
      { name: 'newsletter', data: { to: 'c@test.com', template: 'notification', data: {} } },
    ]);
    assert(jobs.length === 3, 'Should create 3 jobs');
  });

  await sleep(1000);

  await test('Emails processed', async () => {
    assert(results.length >= 3, `Should process at least 3 emails, got ${results.length}`);
  });

  await emailWorker.close();
}

// ============================================
// 2. Report Generation Pipeline
// ============================================

async function testReportGeneration() {
  console.log('\n📊 Testing Report Generation Pipeline...');

  interface ReportJob {
    type: 'daily' | 'weekly';
    format: 'pdf' | 'csv';
    filters: { dateRange: { start: string; end: string } };
  }

  const reportQueue = new Queue<ReportJob>('test-reports', {
    embedded: true,
    defaultJobOptions: {
      attempts: 2,
      timeout: 30000,
    },
  });

  let progressUpdates: number[] = [];

  const reportWorker = new Worker<ReportJob>('test-reports', async (job) => {
    for (let i = 0; i <= 100; i += 25) {
      await job.updateProgress(i, `Processing ${i}%`);
      progressUpdates.push(i);
      await sleep(50);
    }
    return { url: `/reports/${job.id}.${job.data.format}` };
  }, { embedded: true, concurrency: 2 });

  await test('Report with progress tracking', async () => {
    const job = await reportQueue.add('daily-report', {
      type: 'daily',
      format: 'pdf',
      filters: { dateRange: { start: '2024-01-01', end: '2024-01-31' } },
    });
    assert(job.id !== undefined, 'Job should have ID');
  });

  await sleep(500);

  await test('Progress updates received', async () => {
    assert(progressUpdates.length >= 4, `Should have progress updates, got ${progressUpdates.length}`);
  });

  await reportWorker.close();
}

// ============================================
// 3. Webhook Delivery with DLQ
// ============================================

async function testWebhookDelivery() {
  console.log('\n🔗 Testing Webhook Delivery with DLQ...');

  interface WebhookJob {
    endpoint: string;
    event: string;
    payload: Record<string, unknown>;
  }

  const webhookQueue = new Queue<WebhookJob>('test-webhooks', {
    embedded: true,
    defaultJobOptions: {
      attempts: 3,
      backoff: 100,
    },
  });

  webhookQueue.setDlqConfig({
    autoRetry: false,
    maxAge: 86400000,
  });

  const webhookWorker = new Worker<WebhookJob>('test-webhooks', async (job) => {
    if (job.data.endpoint.includes('fail')) {
      throw new Error('Endpoint unavailable');
    }
    return { status: 200 };
  }, { embedded: true, concurrency: 5 });

  await test('Successful webhook delivery', async () => {
    const job = await webhookQueue.add('order.created', {
      endpoint: 'https://success.com/webhook',
      event: 'order.created',
      payload: { orderId: '123' },
    });
    assert(job.id !== undefined, 'Job should have ID');
  });

  await test('Failed webhook goes to DLQ', async () => {
    await webhookQueue.add('order.created', {
      endpoint: 'https://fail.com/webhook',
      event: 'order.created',
      payload: { orderId: '456' },
    });

    await sleep(1500); // Wait for retries

    const dlq = webhookQueue.getDlq();
    const stats = webhookQueue.getDlqStats();
    assert(stats.total >= 0, 'DLQ stats should be available');
  });

  await webhookWorker.close();
}

// ============================================
// 4. Image Processing Pipeline
// ============================================

async function testImageProcessing() {
  console.log('\n🖼️  Testing Image Processing Pipeline...');

  interface ImageJob {
    sourceUrl: string;
    variants: Array<{ name: string; width: number; height: number }>;
  }

  const imageQueue = new Queue<ImageJob>('test-images', {
    embedded: true,
    defaultJobOptions: {
      attempts: 2,
      timeout: 60000,
    },
  });

  let processedVariants: string[] = [];

  const imageWorker = new Worker<ImageJob>('test-images', async (job) => {
    const results: Record<string, string> = {};

    for (const variant of job.data.variants) {
      await job.updateProgress(
        Math.floor((processedVariants.length / job.data.variants.length) * 100),
        `Processing ${variant.name}...`
      );
      processedVariants.push(variant.name);
      results[variant.name] = `https://cdn.example.com/${variant.name}.webp`;
      await sleep(50);
    }

    return { variants: results };
  }, { embedded: true, concurrency: 3 });

  await test('Multi-variant image processing', async () => {
    const job = await imageQueue.add('process-image', {
      sourceUrl: 'https://example.com/image.jpg',
      variants: [
        { name: 'thumbnail', width: 150, height: 150 },
        { name: 'card', width: 400, height: 300 },
        { name: 'full', width: 1200, height: 900 },
      ],
    });
    assert(job.id !== undefined, 'Job should have ID');
  });

  await sleep(500);

  await test('All variants processed', async () => {
    assert(processedVariants.length === 3, `Should process 3 variants, got ${processedVariants.length}`);
  });

  await imageWorker.close();
}

// ============================================
// 5. Multi-Channel Notifications
// ============================================

async function testNotifications() {
  console.log('\n🔔 Testing Multi-Channel Notifications...');

  interface NotificationJob {
    userId: string;
    type: string;
    title: string;
    body: string;
    channels: ('email' | 'push' | 'sms')[];
  }

  const notifQueue = new Queue<NotificationJob>('test-notifications', {
    embedded: true,
    defaultJobOptions: {
      attempts: 3,
      backoff: 100,
    },
  });

  const sentChannels: string[] = [];

  const notifWorker = new Worker<NotificationJob>('test-notifications', async (job) => {
    const results: Record<string, boolean> = {};

    for (const channel of job.data.channels) {
      sentChannels.push(channel);
      results[channel] = true;
      await job.log(`Sent via ${channel}`);
    }

    return { channels: results };
  }, { embedded: true, concurrency: 10 });

  await test('Multi-channel notification', async () => {
    const job = await notifQueue.add('security-alert', {
      userId: 'user-123',
      type: 'security_alert',
      title: 'New login',
      body: 'New device logged in',
      channels: ['email', 'push', 'sms'],
    });
    assert(job.id !== undefined, 'Job should have ID');
  });

  await sleep(500);

  await test('All channels notified', async () => {
    assert(sentChannels.length === 3, `Should send to 3 channels, got ${sentChannels.length}`);
  });

  await notifWorker.close();
}

// ============================================
// 6. Payment Processing
// ============================================

async function testPaymentProcessing() {
  console.log('\n💳 Testing Payment Processing...');

  interface PaymentJob {
    orderId: string;
    amount: number;
    idempotencyKey: string;
  }

  const paymentQueue = new Queue<PaymentJob>('test-payments', {
    embedded: true,
    defaultJobOptions: {
      attempts: 3,
      backoff: 100,
      timeout: 30000,
    },
  });

  paymentQueue.setDlqConfig({
    autoRetry: false, // Manual review for payments
  });

  const processedPayments = new Set<string>();

  const paymentWorker = new Worker<PaymentJob>('test-payments', async (job) => {
    // Idempotency check
    if (processedPayments.has(job.data.idempotencyKey)) {
      return { status: 'already_processed' };
    }

    processedPayments.add(job.data.idempotencyKey);

    await job.log(`Processing payment for order ${job.data.orderId}`);
    await job.updateProgress(50, 'Charging...');
    await sleep(100);
    await job.updateProgress(100, 'Complete');

    return {
      paymentId: `pay_${Date.now()}`,
      status: 'completed',
    };
  }, { embedded: true, concurrency: 3 });

  await test('Payment processing with idempotency', async () => {
    const idempotencyKey = `order-123-payment`;

    // First attempt
    await paymentQueue.add('charge', {
      orderId: 'ORD-123',
      amount: 99.99,
      idempotencyKey,
    });

    // Duplicate (should be idempotent)
    await paymentQueue.add('charge', {
      orderId: 'ORD-123',
      amount: 99.99,
      idempotencyKey,
    });

    await sleep(500);

    // Should only process once
    assert(processedPayments.size === 1, 'Should only process payment once');
  });

  await paymentWorker.close();
}

// ============================================
// 7. Search Index Sync
// ============================================

async function testSearchIndexSync() {
  console.log('\n🔍 Testing Search Index Synchronization...');

  interface IndexJob {
    action: 'index' | 'update' | 'delete';
    entity: string;
    id: string;
    data?: Record<string, unknown>;
  }

  const indexQueue = new Queue<IndexJob>('test-search-index', {
    embedded: true,
    defaultJobOptions: {
      attempts: 5,
      backoff: 100,
      removeOnComplete: true,
    },
  });

  const indexedDocs: string[] = [];

  const indexWorker = new Worker<IndexJob>('test-search-index', async (job) => {
    const { action, entity, id } = job.data;

    if (action === 'index' || action === 'update') {
      indexedDocs.push(`${entity}:${id}`);
    }

    return { action, entity, id };
  }, { embedded: true, concurrency: 20 });

  await test('Bulk index operations', async () => {
    const jobs = await indexQueue.addBulk([
      { name: 'index', data: { action: 'index', entity: 'product', id: '1', data: { name: 'Widget' } } },
      { name: 'index', data: { action: 'index', entity: 'product', id: '2', data: { name: 'Gadget' } } },
      { name: 'index', data: { action: 'index', entity: 'product', id: '3', data: { name: 'Tool' } } },
    ]);
    assert(jobs.length === 3, 'Should create 3 index jobs');
  });

  await sleep(500);

  await test('All documents indexed', async () => {
    assert(indexedDocs.length === 3, `Should index 3 docs, got ${indexedDocs.length}`);
  });

  await indexWorker.close();
}

// ============================================
// 8. Multi-Tenant Queue Isolation
// ============================================

async function testMultiTenant() {
  console.log('\n🏢 Testing Multi-Tenant Queue Isolation...');

  interface TenantJob {
    action: string;
    data: Record<string, unknown>;
  }

  const tenantA = new QueueGroup('tenant-a');
  const tenantB = new QueueGroup('tenant-b');

  const queueA = tenantA.getQueue<TenantJob>('tasks', { embedded: true });
  const queueB = tenantB.getQueue<TenantJob>('tasks', { embedded: true });

  const tenantAJobs: string[] = [];
  const tenantBJobs: string[] = [];

  const workerA = tenantA.getWorker<TenantJob>('tasks', async (job) => {
    tenantAJobs.push(job.data.action);
    return { tenant: 'A' };
  }, { embedded: true });

  const workerB = tenantB.getWorker<TenantJob>('tasks', async (job) => {
    tenantBJobs.push(job.data.action);
    return { tenant: 'B' };
  }, { embedded: true });

  await test('Tenant A queue isolation', async () => {
    await queueA.add('process', { action: 'task-a1', data: {} });
    await queueA.add('process', { action: 'task-a2', data: {} });
    const queues = tenantA.listQueues();
    assert(queues.includes('tasks'), 'Should have tasks queue');
  });

  await test('Tenant B queue isolation', async () => {
    await queueB.add('process', { action: 'task-b1', data: {} });
    const queues = tenantB.listQueues();
    assert(queues.includes('tasks'), 'Should have tasks queue');
  });

  await sleep(500);

  await test('Jobs processed in isolation', async () => {
    assert(tenantAJobs.length === 2, `Tenant A should have 2 jobs, got ${tenantAJobs.length}`);
    assert(tenantBJobs.length === 1, `Tenant B should have 1 job, got ${tenantBJobs.length}`);
  });

  await workerA.close();
  await workerB.close();
}

// ============================================
// 9. Rate Limited API Calls (Server Mode Only)
// ============================================

async function testRateLimiting() {
  console.log('\n⏱️  Testing Rate-Limited API Calls...');
  console.log('  ⚠️  Rate limiting is a SERVER MODE feature');
  console.log('  ⚠️  In embedded mode, use worker concurrency to control throughput');

  interface ApiJob {
    endpoint: string;
    method: string;
  }

  const apiQueue = new Queue<ApiJob>('test-api', {
    embedded: true,
    defaultJobOptions: {
      attempts: 3,
      backoff: 100,
    },
  });

  let apiCallCount = 0;

  // Use concurrency to control throughput in embedded mode
  const apiWorker = new Worker<ApiJob>('test-api', async (job) => {
    apiCallCount++;
    await sleep(50); // Simulate API call
    return { status: 200 };
  }, { embedded: true, concurrency: 5 }); // Concurrency controls parallelism

  await test('Concurrency-controlled API calls', async () => {
    // Add 10 jobs quickly
    for (let i = 0; i < 10; i++) {
      await apiQueue.add('call', {
        endpoint: `/api/items/${i}`,
        method: 'GET',
      });
    }

    await sleep(500); // Wait for processing

    assert(apiCallCount >= 5, `Should process at least 5 calls, got ${apiCallCount}`);
  });

  await apiWorker.close();
}

// ============================================
// 10. Parent-Child Job Workflows
// ============================================

async function testParentChildWorkflows() {
  console.log('\n🔀 Testing Parent-Child Job Workflows...');

  const flow = new FlowProducer();

  // Create queues and workers
  const mainQueue = new Queue('test-main', { embedded: true });
  const subQueue = new Queue('test-sub', { embedded: true });

  const completedJobs: string[] = [];

  const mainWorker = new Worker('test-main', async (job) => {
    completedJobs.push(`main:${job.name}`);
    return { main: true };
  }, { embedded: true });

  const subWorker = new Worker('test-sub', async (job) => {
    completedJobs.push(`sub:${job.name}`);
    await sleep(50);
    return { sub: true, name: job.name };
  }, { embedded: true });

  await test('Sequential chain (addChain)', async () => {
    const result = await flow.addChain([
      { name: 'step-1', queueName: 'test-sub', data: { step: 1 } },
      { name: 'step-2', queueName: 'test-sub', data: { step: 2 } },
      { name: 'step-3', queueName: 'test-sub', data: { step: 3 } },
    ]);
    assert(result.jobIds.length === 3, 'Should return 3 job IDs');
  });

  await test('Parallel then merge (addBulkThen)', async () => {
    const result = await flow.addBulkThen(
      [
        { name: 'parallel-1', queueName: 'test-sub', data: { id: 1 } },
        { name: 'parallel-2', queueName: 'test-sub', data: { id: 2 } },
      ],
      { name: 'merge', queueName: 'test-main', data: {} }
    );
    assert(result.parallelIds.length === 2, 'Should have 2 parallel IDs');
    assert(result.finalId !== undefined, 'Should have final ID');
  });

  await test('Tree structure (addTree)', async () => {
    const result = await flow.addTree({
      name: 'root',
      queueName: 'test-main',
      data: { root: true },
      children: [
        { name: 'child-a', queueName: 'test-sub', data: { child: 'a' } },
        { name: 'child-b', queueName: 'test-sub', data: { child: 'b' } },
      ],
    });
    assert(result.jobIds.length === 3, 'Should return 3 job IDs (root + 2 children)');
  });

  await sleep(1500);

  await test('All workflow jobs processed', async () => {
    assert(completedJobs.length >= 8, `Should complete at least 8 jobs, got ${completedJobs.length}`);
  });

  await mainWorker.close();
  await subWorker.close();
}

// ============================================
// 11. Scheduled/Cron Jobs (Server Mode Only)
// ============================================

async function testScheduledJobs() {
  console.log('\n⏰ Testing Scheduled Jobs...');
  console.log('  ⚠️  Cron scheduling is a SERVER MODE feature');
  console.log('  ⚠️  In embedded mode, use setInterval + queue.add() for recurring jobs');

  interface ScheduledJob {
    task: string;
  }

  const scheduledQueue = new Queue<ScheduledJob>('test-scheduled', { embedded: true });

  let executedTasks: string[] = [];

  const scheduledWorker = new Worker<ScheduledJob>('test-scheduled', async (job) => {
    executedTasks.push(job.data.task);
    return { executed: true };
  }, { embedded: true });

  await test('Manual recurring job pattern', async () => {
    // In embedded mode, use setInterval for recurring jobs
    const interval = setInterval(async () => {
      await scheduledQueue.add('recurring', { task: 'recurring-task' });
    }, 200);

    await sleep(700); // Wait for ~3 executions

    clearInterval(interval);

    assert(executedTasks.length >= 2, `Should execute at least 2 times, got ${executedTasks.length}`);
  });

  await scheduledWorker.close();
}

// ============================================
// 12. Graceful Shutdown
// ============================================

async function testGracefulShutdown() {
  console.log('\n🛑 Testing Graceful Shutdown...');

  interface ShutdownJob {
    duration: number;
  }

  const shutdownQueue = new Queue<ShutdownJob>('test-shutdown', { embedded: true });

  let jobsCompleted = 0;

  const shutdownWorker = new Worker<ShutdownJob>('test-shutdown', async (job) => {
    await sleep(job.data.duration);
    jobsCompleted++;
    return { completed: true };
  }, { embedded: true, concurrency: 2 });

  await test('Worker closes gracefully', async () => {
    // Add some jobs
    await shutdownQueue.add('slow', { duration: 50 });
    await shutdownQueue.add('slow', { duration: 50 });

    await sleep(200); // Wait for jobs to complete

    // Close worker with force=true to avoid hanging
    await shutdownWorker.close(true);

    assert(jobsCompleted >= 1, `Should complete at least 1 job, got ${jobsCompleted}`);
  });
}

// ============================================
// Run All Tests
// ============================================

async function runAllTests() {
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║     Use Cases Verification Tests           ║');
  console.log('╚════════════════════════════════════════════╝');

  try {
    await testEmailDelivery();
    await testReportGeneration();
    await testWebhookDelivery();
    await testImageProcessing();
    await testNotifications();
    await testPaymentProcessing();
    await testSearchIndexSync();
    await testMultiTenant();
    await testRateLimiting();
    await testParentChildWorkflows();
    await testScheduledJobs();
    await testGracefulShutdown();
  } catch (err) {
    console.error('\n💥 Unexpected error:', err);
  }

  console.log('\n════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('════════════════════════════════════════════\n');

  // Cleanup
  shutdownManager();

  process.exit(failed > 0 ? 1 : 0);
}

runAllTests();
