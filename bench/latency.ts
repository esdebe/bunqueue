/**
 * bunqueue Latency Benchmark
 *
 * Measures operation latency percentiles
 * Run: bun run bench/latency.ts
 */

import { Queue, Worker } from '../src/client';

interface LatencyResult {
  operation: string;
  samples: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  avg: number;
}

function calculatePercentiles(latencies: number[]): Omit<LatencyResult, 'operation' | 'samples'> {
  const sorted = [...latencies].sort((a, b) => a - b);
  const len = sorted.length;

  return {
    p50: sorted[Math.floor(len * 0.5)],
    p95: sorted[Math.floor(len * 0.95)],
    p99: sorted[Math.floor(len * 0.99)],
    min: sorted[0],
    max: sorted[len - 1],
    avg: Math.round((latencies.reduce((a, b) => a + b, 0) / len) * 100) / 100,
  };
}

async function benchmarkPushLatency(queue: Queue, samples: number): Promise<LatencyResult> {
  const latencies: number[] = [];

  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    await queue.add('latency-test', { id: i });
    latencies.push(performance.now() - start);
  }

  return {
    operation: 'push',
    samples,
    ...calculatePercentiles(latencies),
  };
}

async function benchmarkPullLatency(queue: Queue, samples: number): Promise<LatencyResult> {
  // Add jobs first
  const jobs = Array.from({ length: samples }, (_, i) => ({
    name: 'latency-test',
    data: { id: i },
  }));
  await queue.addBulk(jobs);

  const latencies: number[] = [];
  let processed = 0;

  const worker = new Worker(
    'latency-queue',
    async () => {
      processed++;
      return { ok: true };
    },
    { concurrency: 1 }
  );

  // Measure time for each job
  worker.on('active', () => {
    (worker as any)._activeStart = performance.now();
  });

  worker.on('completed', () => {
    const start = (worker as any)._activeStart;
    if (start) {
      latencies.push(performance.now() - start);
    }
  });

  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (processed >= samples) {
        clearInterval(check);
        resolve();
      }
    }, 10);
  });

  await worker.close();

  return {
    operation: 'process',
    samples,
    ...calculatePercentiles(latencies),
  };
}

async function benchmarkRoundTrip(queue: Queue, samples: number): Promise<LatencyResult> {
  const latencies: number[] = [];

  for (let i = 0; i < samples; i++) {
    const start = performance.now();

    // Push
    const job = await queue.add('roundtrip', { id: i, start });

    // Pull and process
    const pulledJob = await queue.getJob(job.id);
    if (pulledJob) {
      latencies.push(performance.now() - start);
    }
  }

  return {
    operation: 'roundtrip',
    samples,
    ...calculatePercentiles(latencies),
  };
}

function printResults(results: LatencyResult[]) {
  console.log('\n' + '='.repeat(70));
  console.log('LATENCY BENCHMARK RESULTS (all values in ms)');
  console.log('='.repeat(70));

  console.log('\n| Operation | Samples | p50 | p95 | p99 | Min | Max | Avg |');
  console.log('|-----------|---------|-----|-----|-----|-----|-----|-----|');

  for (const r of results) {
    console.log(
      `| ${r.operation.padEnd(9)} | ${r.samples.toLocaleString().padStart(7)} | ${r.p50.toFixed(2).padStart(5)} | ${r.p95.toFixed(2).padStart(5)} | ${r.p99.toFixed(2).padStart(5)} | ${r.min.toFixed(2).padStart(5)} | ${r.max.toFixed(2).padStart(5)} | ${r.avg.toFixed(2).padStart(5)} |`
    );
  }

  console.log('\n' + '='.repeat(70));

  // Output JSON
  console.log('\nJSON Output:');
  console.log(JSON.stringify(results, null, 2));
}

async function main() {
  console.log('bunqueue Latency Benchmark');
  console.log('==========================\n');

  const queue = new Queue('latency-queue');
  const results: LatencyResult[] = [];
  const samples = 1000;

  // Warmup
  console.log('Warming up...');
  for (let i = 0; i < 100; i++) {
    await queue.add('warmup', { i });
  }
  await queue.drain();

  // Push latency
  console.log(`Measuring push latency (${samples} samples)...`);
  results.push(await benchmarkPushLatency(queue, samples));
  await queue.drain();

  // Round-trip latency
  console.log(`Measuring round-trip latency (${samples} samples)...`);
  results.push(await benchmarkRoundTrip(queue, samples));
  await queue.drain();

  // Pull/process latency
  console.log(`Measuring process latency (${samples} samples)...`);
  results.push(await benchmarkPullLatency(queue, samples));

  // Cleanup
  await queue.obliterate();

  printResults(results);
}

main().catch(console.error);
