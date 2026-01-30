/**
 * bunqueue Throughput Benchmark
 *
 * Measures push/pull operations per second
 * Run: bun run bench/throughput.ts
 */

import { Queue, Worker } from '../src/client';

interface BenchmarkResult {
  operation: string;
  totalOps: number;
  durationMs: number;
  opsPerSecond: number;
}

async function benchmarkPush(queue: Queue, count: number): Promise<BenchmarkResult> {
  const start = performance.now();

  for (let i = 0; i < count; i++) {
    await queue.add('bench', { id: i, timestamp: Date.now() });
  }

  const duration = performance.now() - start;

  return {
    operation: 'push',
    totalOps: count,
    durationMs: Math.round(duration),
    opsPerSecond: Math.round(count / (duration / 1000)),
  };
}

async function benchmarkBulkPush(
  queue: Queue,
  count: number,
  batchSize: number
): Promise<BenchmarkResult> {
  const start = performance.now();
  const batches = Math.ceil(count / batchSize);

  for (let b = 0; b < batches; b++) {
    const jobs = [];
    const remaining = Math.min(batchSize, count - b * batchSize);
    for (let i = 0; i < remaining; i++) {
      jobs.push({
        name: 'bench',
        data: { id: b * batchSize + i, timestamp: Date.now() },
      });
    }
    await queue.addBulk(jobs);
  }

  const duration = performance.now() - start;

  return {
    operation: `bulk-push-${batchSize}`,
    totalOps: count,
    durationMs: Math.round(duration),
    opsPerSecond: Math.round(count / (duration / 1000)),
  };
}

async function benchmarkPull(queue: Queue, count: number): Promise<BenchmarkResult> {
  // First, add jobs to pull
  const jobs = Array.from({ length: count }, (_, i) => ({
    name: 'bench',
    data: { id: i },
  }));
  await queue.addBulk(jobs);

  const start = performance.now();
  let pulled = 0;

  const worker = new Worker(
    'bench-queue',
    async () => {
      pulled++;
      return { ok: true };
    },
    { concurrency: 100 }
  );

  // Wait for all jobs to be processed
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (pulled >= count) {
        clearInterval(check);
        resolve();
      }
    }, 10);
  });

  const duration = performance.now() - start;
  await worker.close();

  return {
    operation: 'pull+process',
    totalOps: count,
    durationMs: Math.round(duration),
    opsPerSecond: Math.round(count / (duration / 1000)),
  };
}

function printResults(results: BenchmarkResult[]) {
  console.log('\n' + '='.repeat(60));
  console.log('BENCHMARK RESULTS');
  console.log('='.repeat(60));

  console.log('\n| Operation | Total | Duration | Ops/sec |');
  console.log('|-----------|-------|----------|---------|');

  for (const r of results) {
    console.log(
      `| ${r.operation.padEnd(15)} | ${r.totalOps.toLocaleString().padStart(7)} | ${(r.durationMs + 'ms').padStart(8)} | ${r.opsPerSecond.toLocaleString().padStart(9)} |`
    );
  }

  console.log('\n' + '='.repeat(60));

  // Output JSON for processing
  console.log('\nJSON Output:');
  console.log(JSON.stringify(results, null, 2));
}

async function main() {
  console.log('bunqueue Throughput Benchmark');
  console.log('============================\n');

  const queue = new Queue('bench-queue');
  const results: BenchmarkResult[] = [];

  // Warmup
  console.log('Warming up...');
  for (let i = 0; i < 100; i++) {
    await queue.add('warmup', { i });
  }
  await queue.drain();

  // Single push benchmark
  console.log('Running single push benchmark (10,000 ops)...');
  results.push(await benchmarkPush(queue, 10_000));
  await queue.drain();

  // Bulk push benchmarks
  for (const batchSize of [10, 100, 1000]) {
    console.log(`Running bulk push benchmark (batch size: ${batchSize})...`);
    results.push(await benchmarkBulkPush(queue, 10_000, batchSize));
    await queue.drain();
  }

  // Pull benchmark
  console.log('Running pull benchmark (10,000 ops)...');
  results.push(await benchmarkPull(queue, 10_000));

  // Cleanup
  await queue.obliterate();

  printResults(results);
}

main().catch(console.error);
