#!/usr/bin/env bun
/**
 * Test Workflow Engine (Embedded Mode)
 * Tests: linear flow, branching, compensation, waitFor/signal, concurrent executions
 */

// Force embedded mode BEFORE imports
process.env.BUNQUEUE_EMBEDDED = '1';

import { Workflow, Engine } from '../../src/client/workflow';

let engine: Engine;
let passed = 0;
let failed = 0;

function pass(msg: string) { console.log(`   [PASS] ${msg}`); passed++; }
function fail(msg: string, detail?: string) { console.log(`   [FAIL] ${msg}${detail ? ': ' + detail : ''}`); failed++; }

async function cleanup() {
  if (engine) {
    try { await engine.close(true); } catch {}
  }
}

async function test1_linearFlow() {
  console.log('\n1. Linear workflow (3 steps with context passing)...');
  try {
    const log: string[] = [];

    const flow = new Workflow('emb-linear')
      .step('a', async () => { log.push('a'); return { x: 1 }; })
      .step('b', async (ctx) => {
        log.push('b');
        const prev = ctx.steps['a'] as { x: number };
        return { x: prev.x + 1 };
      })
      .step('c', async (ctx) => {
        log.push('c');
        const prev = ctx.steps['b'] as { x: number };
        return { total: prev.x + 1 };
      });

    engine = new Engine({ embedded: true });
    engine.register(flow);

    const run = await engine.start('emb-linear', { seed: 42 });
    await Bun.sleep(2000);

    const exec = engine.getExecution(run.id);
    if (!exec) { fail('Linear flow', 'execution not found'); await cleanup(); return; }
    if (exec.state !== 'completed') { fail('Linear flow', `state=${exec.state}`); await cleanup(); return; }
    if (log.join(',') !== 'a,b,c') { fail('Linear flow', `log=${log}`); await cleanup(); return; }

    const result = exec.steps['c'].result as { total: number };
    if (result.total !== 3) { fail('Linear flow', `total=${result.total}`); await cleanup(); return; }

    pass('Linear flow completed with correct context passing');
    await cleanup();
  } catch (e) {
    fail('Linear flow', String(e));
    await cleanup();
  }
}

async function test2_branching() {
  console.log('\n2. Branching workflow (VIP vs standard)...');
  try {
    const log: string[] = [];

    const flow = new Workflow('emb-branch')
      .step('classify', async (ctx) => {
        const input = ctx.input as { tier: string };
        return { tier: input.tier };
      })
      .branch((ctx) => (ctx.steps['classify'] as { tier: string }).tier)
      .path('vip', (w) => w.step('vip-handler', async () => { log.push('vip'); return { discount: 20 }; }))
      .path('basic', (w) => w.step('basic-handler', async () => { log.push('basic'); return { discount: 0 }; }))
      .step('done', async () => { log.push('done'); });

    engine = new Engine({ embedded: true });
    engine.register(flow);

    const run = await engine.start('emb-branch', { tier: 'vip' });
    await Bun.sleep(2000);

    const exec = engine.getExecution(run.id);
    if (!exec || exec.state !== 'completed') { fail('Branching', `state=${exec?.state}`); await cleanup(); return; }
    if (!log.includes('vip') || log.includes('basic')) { fail('Branching', `wrong path: ${log}`); await cleanup(); return; }
    if (!log.includes('done')) { fail('Branching', 'post-branch step not reached'); await cleanup(); return; }

    pass('Branching: VIP path taken correctly, basic skipped');
    await cleanup();
  } catch (e) {
    fail('Branching', String(e));
    await cleanup();
  }
}

async function test3_compensation() {
  console.log('\n3. Compensation (saga rollback on failure)...');
  try {
    const log: string[] = [];

    const flow = new Workflow('emb-compensate')
      .step('create', async () => {
        log.push('create');
        return { id: 1 };
      }, { compensate: async () => { log.push('undo-create'); } })
      .step('charge', async () => {
        log.push('charge');
        return { txId: 'abc' };
      }, { compensate: async () => { log.push('refund'); } })
      .step('explode', async () => {
        throw new Error('Boom');
      });

    engine = new Engine({ embedded: true });
    engine.register(flow);

    const run = await engine.start('emb-compensate');
    await Bun.sleep(2000);

    const exec = engine.getExecution(run.id);
    if (!exec || exec.state !== 'failed') { fail('Compensation', `state=${exec?.state}`); await cleanup(); return; }
    if (!log.includes('refund') || !log.includes('undo-create')) {
      fail('Compensation', `missing rollback: ${log}`);
      await cleanup();
      return;
    }
    // Compensation runs in reverse: refund before undo-create
    if (log.indexOf('refund') >= log.indexOf('undo-create')) {
      fail('Compensation', `wrong order: ${log}`);
      await cleanup();
      return;
    }

    pass('Compensation: saga rollback ran in reverse order');
    await cleanup();
  } catch (e) {
    fail('Compensation', String(e));
    await cleanup();
  }
}

async function test4_waitForSignal() {
  console.log('\n4. WaitFor + Signal (human-in-the-loop)...');
  try {
    const log: string[] = [];

    const flow = new Workflow('emb-signal')
      .step('submit', async () => { log.push('submit'); return { ok: true }; })
      .waitFor('approval')
      .step('process', async (ctx) => {
        const data = ctx.signals['approval'] as { approved: boolean };
        log.push(data.approved ? 'approved' : 'rejected');
        return { done: true };
      });

    engine = new Engine({ embedded: true });
    engine.register(flow);

    const run = await engine.start('emb-signal');
    await Bun.sleep(1000);

    let exec = engine.getExecution(run.id);
    if (!exec || exec.state !== 'waiting') { fail('WaitFor', `expected waiting, got ${exec?.state}`); await cleanup(); return; }

    await engine.signal(run.id, 'approval', { approved: true });
    await Bun.sleep(1500);

    exec = engine.getExecution(run.id);
    if (!exec || exec.state !== 'completed') { fail('WaitFor', `after signal: state=${exec?.state}`); await cleanup(); return; }
    if (log.join(',') !== 'submit,approved') { fail('WaitFor', `log=${log}`); await cleanup(); return; }

    pass('WaitFor + Signal: paused, then resumed on signal');
    await cleanup();
  } catch (e) {
    fail('WaitFor', String(e));
    await cleanup();
  }
}

async function test5_concurrentExecutions() {
  console.log('\n5. Concurrent executions (5 parallel runs)...');
  try {
    const flow = new Workflow('emb-concurrent')
      .step('compute', async (ctx) => {
        const input = ctx.input as { n: number };
        await Bun.sleep(50);
        return { result: input.n * 2 };
      });

    engine = new Engine({ embedded: true, concurrency: 10 });
    engine.register(flow);

    const runs = await Promise.all(
      Array.from({ length: 5 }, (_, i) => engine.start('emb-concurrent', { n: i }))
    );

    await Bun.sleep(3000);

    let allCompleted = true;
    for (const run of runs) {
      const exec = engine.getExecution(run.id);
      if (!exec || exec.state !== 'completed') {
        allCompleted = false;
        break;
      }
    }

    if (!allCompleted) { fail('Concurrent', 'not all executions completed'); await cleanup(); return; }

    pass('Concurrent: 5 parallel executions all completed');
    await cleanup();
  } catch (e) {
    fail('Concurrent', String(e));
    await cleanup();
  }
}

async function test6_stepTimeout() {
  console.log('\n6. Step timeout...');
  try {
    const flow = new Workflow('emb-timeout')
      .step('slow', async () => {
        await Bun.sleep(5000);
        return { done: true };
      }, { timeout: 200 });

    engine = new Engine({ embedded: true });
    engine.register(flow);

    const run = await engine.start('emb-timeout');
    await Bun.sleep(2000);

    const exec = engine.getExecution(run.id);
    if (!exec || exec.state !== 'failed') { fail('Step timeout', `state=${exec?.state}`); await cleanup(); return; }
    if (!exec.steps['slow'].error?.includes('timed out')) {
      fail('Step timeout', `error=${exec.steps['slow'].error}`);
      await cleanup();
      return;
    }

    pass('Step timeout: slow step correctly timed out');
    await cleanup();
  } catch (e) {
    fail('Step timeout', String(e));
    await cleanup();
  }
}

async function test7_ecommerceFlow() {
  console.log('\n7. E-commerce order flow (end-to-end)...');
  try {
    const db: Record<string, unknown> = {};

    const orderFlow = new Workflow<{ orderId: string; amount: number }>('emb-order')
      .step('validate', async (ctx) => {
        const input = ctx.input as { orderId: string; amount: number };
        if (input.amount <= 0) throw new Error('Invalid amount');
        return { valid: true, orderId: input.orderId };
      })
      .step('reserve-stock', async () => {
        db['stock'] = 'reserved';
        return { reserved: true };
      }, { compensate: async () => { db['stock'] = 'available'; } })
      .step('charge', async () => {
        db['payment'] = 'charged';
        return { txId: 'tx_001' };
      }, { compensate: async () => { db['payment'] = 'refunded'; } })
      .step('confirm', async (ctx) => {
        const tx = (ctx.steps['charge'] as { txId: string }).txId;
        return { confirmed: true, txId: tx };
      });

    engine = new Engine({ embedded: true });
    engine.register(orderFlow);

    const run = await engine.start('emb-order', { orderId: 'ORD-1', amount: 99.99 });
    await Bun.sleep(2500);

    const exec = engine.getExecution(run.id);
    if (!exec || exec.state !== 'completed') { fail('E-commerce', `state=${exec?.state}`); await cleanup(); return; }
    if (db['stock'] !== 'reserved' || db['payment'] !== 'charged') {
      fail('E-commerce', `db state wrong`);
      await cleanup();
      return;
    }

    const confirm = exec.steps['confirm'].result as { confirmed: boolean; txId: string };
    if (confirm.txId !== 'tx_001') { fail('E-commerce', `txId=${confirm.txId}`); await cleanup(); return; }

    pass('E-commerce: full order flow with context passing');
    await cleanup();
  } catch (e) {
    fail('E-commerce', String(e));
    await cleanup();
  }
}

async function main() {
  console.log('=== Test Workflow Engine (Embedded) ===');

  await test1_linearFlow();
  await test2_branching();
  await test3_compensation();
  await test4_waitForSignal();
  await test5_concurrentExecutions();
  await test6_stepTimeout();
  await test7_ecommerceFlow();

  // Summary
  console.log('\n=== Summary ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
