/**
 * bunQ Worker Benchmark
 * Realistic benchmark with workers processing jobs end-to-end
 */

import { QueueManager } from '../application/queueManager';
import type { JobId } from '../domain/types/job';
import { EventType } from '../domain/types/queue';

const QUEUE_NAME = 'worker-benchmark';

interface BenchmarkResult {
  scenario: string;
  totalJobs: number;
  durationMs: number;
  jobsPerSecond: number;
  eventsReceived: number;
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/**
 * Simulate a worker that:
 * 1. Pulls jobs from queue
 * 2. Processes them (simulated work)
 * 3. Acks them (triggers completed event)
 */
async function runWorkerBenchmark(
  qm: QueueManager,
  totalJobs: number,
  workerCount: number,
  workDelayMs: number = 0
): Promise<BenchmarkResult> {
  let completedCount = 0;
  let eventsReceived = 0;

  // Subscribe to completed events
  const unsubscribe = qm.subscribe((event) => {
    if (event.eventType === EventType.Completed) {
      eventsReceived++;
    }
  });

  // Pre-push all jobs
  console.log(`    Pushing ${formatNumber(totalJobs)} jobs...`);
  const pushStart = performance.now();
  for (let i = 0; i < totalJobs; i++) {
    await qm.push(QUEUE_NAME, {
      data: { taskId: i, payload: `job-${i}` },
    });
  }
  const pushEnd = performance.now();
  console.log(`    Push completed in ${(pushEnd - pushStart).toFixed(0)}ms`);

  // Start workers
  console.log(`    Starting ${workerCount} workers...`);
  const start = performance.now();

  const workerPromises: Promise<void>[] = [];

  for (let w = 0; w < workerCount; w++) {
    workerPromises.push(
      (async () => {
        while (completedCount < totalJobs) {
          const job = await qm.pull(QUEUE_NAME, 10);
          if (!job) continue;

          // Simulate work
          if (workDelayMs > 0) {
            await new Promise((r) => setTimeout(r, workDelayMs));
          }

          // Process and ack (triggers completed event)
          await qm.ack(job.id, { processed: true, workerId: w });
          completedCount++;
        }
      })()
    );
  }

  await Promise.all(workerPromises);
  const end = performance.now();

  unsubscribe();

  const durationMs = end - start;
  const jobsPerSecond = (totalJobs / durationMs) * 1000;

  return {
    scenario: `${workerCount} worker(s), ${workDelayMs}ms work`,
    totalJobs,
    durationMs,
    jobsPerSecond,
    eventsReceived,
  };
}

/**
 * Benchmark with job dependencies
 * Parent job must complete before children can be processed
 */
async function runDependencyBenchmark(
  qm: QueueManager,
  chainLength: number,
  chains: number
): Promise<BenchmarkResult> {
  let eventsReceived = 0;
  let completedCount = 0;

  const unsubscribe = qm.subscribe((event) => {
    if (event.eventType === EventType.Completed) {
      eventsReceived++;
    }
  });

  console.log(`    Creating ${chains} chains of ${chainLength} dependent jobs...`);

  const start = performance.now();

  // Create job chains
  for (let c = 0; c < chains; c++) {
    let prevJobId: JobId | null = null;

    for (let i = 0; i < chainLength; i++) {
      const job = await qm.push(QUEUE_NAME, {
        data: { chain: c, step: i },
        dependsOn: prevJobId ? [prevJobId] : undefined,
      });
      prevJobId = job.id;
    }
  }

  const totalJobs = chains * chainLength;

  // Process all jobs
  while (completedCount < totalJobs) {
    const job = await qm.pull(QUEUE_NAME, 50);
    if (!job) continue;

    await qm.ack(job.id, { done: true });
    completedCount++;
  }

  const end = performance.now();
  unsubscribe();

  const durationMs = end - start;
  const jobsPerSecond = (totalJobs / durationMs) * 1000;

  return {
    scenario: `Dependencies: ${chains} chains x ${chainLength} jobs`,
    totalJobs,
    durationMs,
    jobsPerSecond,
    eventsReceived,
  };
}

/**
 * Benchmark with progress updates
 */
async function runProgressBenchmark(
  qm: QueueManager,
  totalJobs: number,
  updatesPerJob: number
): Promise<BenchmarkResult> {
  let eventsReceived = 0;

  const unsubscribe = qm.subscribe(() => {
    eventsReceived++;
  });

  // Push jobs
  for (let i = 0; i < totalJobs; i++) {
    await qm.push(QUEUE_NAME, { data: { id: i } });
  }

  const start = performance.now();

  // Process with progress updates
  for (let i = 0; i < totalJobs; i++) {
    const job = await qm.pull(QUEUE_NAME, 0);
    if (!job) break;

    // Send progress updates
    for (let p = 0; p < updatesPerJob; p++) {
      const progress = Math.floor(((p + 1) / updatesPerJob) * 100);
      await qm.updateProgress(job.id, progress, `Step ${p + 1}/${updatesPerJob}`);
    }

    await qm.ack(job.id, { completed: true });
  }

  const end = performance.now();
  unsubscribe();

  const durationMs = end - start;
  const jobsPerSecond = (totalJobs / durationMs) * 1000;

  return {
    scenario: `Progress: ${updatesPerJob} updates/job`,
    totalJobs,
    durationMs,
    jobsPerSecond,
    eventsReceived,
  };
}

function printResults(results: BenchmarkResult[]): void {
  console.log('\n' + '='.repeat(80));
  console.log('WORKER BENCHMARK RESULTS');
  console.log('='.repeat(80));
  console.log(
    'Scenario'.padEnd(40) +
      'Jobs'.padStart(8) +
      'Time(ms)'.padStart(10) +
      'Jobs/sec'.padStart(12) +
      'Events'.padStart(10)
  );
  console.log('-'.repeat(80));

  for (const r of results) {
    console.log(
      r.scenario.padEnd(40) +
        formatNumber(r.totalJobs).padStart(8) +
        formatNumber(r.durationMs).padStart(10) +
        formatNumber(r.jobsPerSecond).padStart(12) +
        formatNumber(r.eventsReceived).padStart(10)
    );
  }

  console.log('='.repeat(80));
}

async function main(): Promise<void> {
  console.log('bunQ Worker Benchmark');
  console.log('=====================');
  console.log('Simulates realistic worker scenarios with event handling\n');

  const results: BenchmarkResult[] = [];

  // Test 1: Single worker, no work delay
  {
    console.log('\n[1] Single worker, no work delay');
    const qm = new QueueManager();
    try {
      results.push(await runWorkerBenchmark(qm, 10_000, 1, 0));
    } finally {
      qm.shutdown();
    }
  }

  // Test 2: Multiple workers (concurrent processing)
  {
    console.log('\n[2] 4 concurrent workers, no work delay');
    const qm = new QueueManager();
    try {
      results.push(await runWorkerBenchmark(qm, 10_000, 4, 0));
    } finally {
      qm.shutdown();
    }
  }

  // Test 3: Single worker with simulated work
  {
    console.log('\n[3] Single worker, 1ms work delay');
    const qm = new QueueManager();
    try {
      results.push(await runWorkerBenchmark(qm, 1_000, 1, 1));
    } finally {
      qm.shutdown();
    }
  }

  // Test 4: Multiple workers with work delay
  {
    console.log('\n[4] 10 workers, 1ms work delay');
    const qm = new QueueManager();
    try {
      results.push(await runWorkerBenchmark(qm, 5_000, 10, 1));
    } finally {
      qm.shutdown();
    }
  }

  // Test 5: Job dependencies
  {
    console.log('\n[5] Job dependencies (chains)');
    const qm = new QueueManager();
    try {
      results.push(await runDependencyBenchmark(qm, 10, 100));
    } finally {
      qm.shutdown();
    }
  }

  // Test 6: Progress updates
  {
    console.log('\n[6] Progress updates');
    const qm = new QueueManager();
    try {
      results.push(await runProgressBenchmark(qm, 1_000, 5));
    } finally {
      qm.shutdown();
    }
  }

  // Test 7: Large batch with multiple workers
  {
    console.log('\n[7] Large batch (50k jobs, 8 workers)');
    const qm = new QueueManager();
    try {
      results.push(await runWorkerBenchmark(qm, 50_000, 8, 0));
    } finally {
      qm.shutdown();
    }
  }

  printResults(results);

  // Summary
  console.log('\nKEY METRICS:');
  console.log('-'.repeat(40));

  const singleWorker = results.find(
    (r) => r.scenario.includes('1 worker') && !r.scenario.includes('delay')
  );
  const multiWorker = results.find((r) => r.scenario.includes('8 workers'));

  if (singleWorker) {
    console.log(`Single worker throughput: ${formatNumber(singleWorker.jobsPerSecond)} jobs/sec`);
  }
  if (multiWorker) {
    console.log(`8 workers throughput:     ${formatNumber(multiWorker.jobsPerSecond)} jobs/sec`);
  }

  console.log('\nNote: Events column shows completed events received by subscribers');
}

main().catch(console.error);
