#!/usr/bin/env bun
/**
 * Test WebSocket Pub/Sub (Real TCP Mode)
 * Tests: connect, subscribe, receive events, unsubscribe, ping/pong, close
 */

import { Queue } from '../../src/client';

const QUEUE_NAME = 'tcp-test-websocket';
const TCP_PORT = parseInt(process.env.TCP_PORT ?? '16789');
const HTTP_PORT = parseInt(process.env.HTTP_PORT ?? '16790');
const WS_URL = `ws://localhost:${HTTP_PORT}/ws`;

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    console.log(`   ✅ ${msg}`);
    passed++;
  } else {
    console.log(`   ❌ ${msg}`);
    failed++;
  }
}

async function waitForWsMessage(
  ws: WebSocket,
  predicate: (data: unknown) => boolean,
  timeoutMs = 5000
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.removeEventListener('message', handler);
      reject(new Error('Timeout waiting for WS message'));
    }, timeoutMs);

    function handler(event: MessageEvent) {
      try {
        const parsed = JSON.parse(String(event.data));
        if (predicate(parsed)) {
          clearTimeout(timeout);
          ws.removeEventListener('message', handler);
          resolve(parsed);
        }
      } catch {
        // Not JSON, skip
      }
    }

    ws.addEventListener('message', handler);
  });
}

async function connectWs(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const timeout = setTimeout(() => reject(new Error('WS connect timeout')), 5000);
    ws.addEventListener('open', () => {
      clearTimeout(timeout);
      resolve(ws);
    });
    ws.addEventListener('error', (e) => {
      clearTimeout(timeout);
      reject(e);
    });
  });
}

async function main() {
  console.log('=== Test WebSocket Pub/Sub (TCP) ===\n');

  const queue = new Queue<{ msg: string }>(QUEUE_NAME, {
    connection: { port: TCP_PORT },
  });

  // Clean state
  queue.obliterate();
  await Bun.sleep(100);

  // ── Test 1: Connect ──────────────────────────────────
  console.log('1. Testing WS CONNECT...');
  let ws: WebSocket;
  try {
    ws = await connectWs();
    assert(ws.readyState === WebSocket.OPEN, 'WebSocket connected');
  } catch (e) {
    console.log(`   ❌ WS connect failed: ${e}`);
    failed++;
    await queue.close();
    printSummary();
    return;
  }

  // ── Test 2: Subscribe to job events ──────────────────
  console.log('\n2. Testing SUBSCRIBE...');
  try {
    ws.send(JSON.stringify({ cmd: 'Subscribe', events: ['job:completed', 'job:pushed'] }));
    await Bun.sleep(200);
    assert(true, 'Subscribe command sent without error');
  } catch (e) {
    console.log(`   ❌ Subscribe failed: ${e}`);
    failed++;
  }

  // ── Test 3: Receive job:pushed event ─────────────────
  console.log('\n3. Testing RECEIVE job:pushed event...');
  try {
    const eventPromise = waitForWsMessage(
      ws,
      (d: unknown) => {
        const obj = d as { event?: string };
        return obj.event === 'job:pushed';
      },
      5000
    );

    await queue.add('ws-test-job', { msg: 'hello websocket' });

    const event = (await eventPromise) as { event: string; data: { queue: string; jobId: string } };
    assert(event.event === 'job:pushed', `Received job:pushed event`);
    assert(event.data?.queue === QUEUE_NAME, `Event has correct queue: ${event.data?.queue}`);
    assert(typeof event.data?.jobId === 'string', `Event has jobId: ${event.data?.jobId}`);
  } catch (e) {
    console.log(`   ❌ Receive event failed: ${e}`);
    failed++;
  }

  // ── Test 4: Receive job:completed via worker ─────────
  console.log('\n4. Testing RECEIVE job:completed event...');
  try {
    queue.obliterate();
    await Bun.sleep(100);

    const completedPromise = waitForWsMessage(
      ws,
      (d: unknown) => {
        const obj = d as { event?: string };
        return obj.event === 'job:completed';
      },
      5000
    );

    await queue.add('ws-complete-test', { msg: 'complete me' });

    // Manually pull and ack to trigger completed event
    const job = await queue.pullAsync(0);
    if (job) {
      await queue.ackAsync(job.id, { done: true });
    }

    const event = (await completedPromise) as { event: string; ts: number; data: unknown };
    assert(event.event === 'job:completed', 'Received job:completed event');
    assert(typeof event.ts === 'number', `Event has timestamp: ${event.ts}`);
  } catch (e) {
    console.log(`   ❌ Completed event failed: ${e}`);
    failed++;
  }

  // ── Test 5: Unsubscribe ──────────────────────────────
  console.log('\n5. Testing UNSUBSCRIBE...');
  try {
    ws.send(JSON.stringify({ cmd: 'Unsubscribe', events: ['job:pushed'] }));
    await Bun.sleep(200);

    // Push a job - should NOT receive job:pushed (unsubscribed)
    let receivedPushed = false;
    const handler = (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(String(event.data)) as { event?: string };
        if (parsed.event === 'job:pushed') receivedPushed = true;
      } catch {
        // ignore
      }
    };
    ws.addEventListener('message', handler);

    await queue.add('should-not-trigger', { msg: 'no push event' });
    await Bun.sleep(500);

    ws.removeEventListener('message', handler);
    assert(!receivedPushed, 'No job:pushed event after unsubscribe');
  } catch (e) {
    console.log(`   ❌ Unsubscribe test failed: ${e}`);
    failed++;
  }

  // ── Test 6: Wildcard subscribe ───────────────────────
  console.log('\n6. Testing WILDCARD subscribe (job:*)...');
  try {
    ws.send(JSON.stringify({ cmd: 'Subscribe', events: ['job:*'] }));
    await Bun.sleep(200);

    const eventPromise = waitForWsMessage(
      ws,
      (d: unknown) => {
        const obj = d as { event?: string };
        return obj.event === 'job:pushed';
      },
      5000
    );

    await queue.add('wildcard-test', { msg: 'wildcard' });

    const event = (await eventPromise) as { event: string };
    assert(event.event === 'job:pushed', 'Wildcard job:* received job:pushed');
  } catch (e) {
    console.log(`   ❌ Wildcard test failed: ${e}`);
    failed++;
  }

  // ── Test 7: Health status periodic event ─────────────
  console.log('\n7. Testing PERIODIC health:status event...');
  try {
    ws.send(JSON.stringify({ cmd: 'Subscribe', events: ['health:status'] }));

    const event = (await waitForWsMessage(
      ws,
      (d: unknown) => {
        const obj = d as { event?: string };
        return obj.event === 'health:status';
      },
      15000
    )) as { event: string; data: { uptime: number; memory: unknown } };

    assert(event.event === 'health:status', 'Received health:status');
    assert(typeof event.data?.uptime === 'number', `Has uptime: ${event.data?.uptime}ms`);
    assert(event.data?.memory !== undefined, 'Has memory stats');
  } catch (e) {
    console.log(`   ❌ Health status failed: ${e}`);
    failed++;
  }

  // ── Test 8: TCP command over WebSocket ───────────────
  console.log('\n8. Testing TCP COMMAND over WebSocket...');
  try {
    // WebSocket also supports sending TCP commands (msgpack)
    // But the text protocol should handle JSON commands too
    ws.send(JSON.stringify({ cmd: 'Ping' }));
    const pong = (await waitForWsMessage(
      ws,
      (d: unknown) => {
        const obj = d as { ok?: boolean; pong?: boolean };
        return obj.ok === true || obj.pong === true;
      },
      3000
    )) as { ok: boolean };
    assert(pong.ok === true, 'Ping command returned ok:true');
  } catch (e) {
    console.log(`   ❌ TCP command over WS failed: ${e}`);
    failed++;
  }

  // ── Test 9: Close ────────────────────────────────────
  console.log('\n9. Testing WS CLOSE...');
  try {
    ws.close();
    await Bun.sleep(200);
    assert(
      ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING,
      'WebSocket closed'
    );
  } catch (e) {
    console.log(`   ❌ Close failed: ${e}`);
    failed++;
  }

  // Cleanup
  queue.obliterate();
  await queue.close();

  printSummary();
}

function printSummary() {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
