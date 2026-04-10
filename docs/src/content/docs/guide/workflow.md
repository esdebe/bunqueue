---
title: "Workflow Engine — Multi-Step Orchestration for Bun"
description: "Orchestrate multi-step workflows with saga compensation, conditional branching, human-in-the-loop signals, and step timeouts. Zero infrastructure — no Redis, no Temporal, no cloud service. TypeScript DSL built on bunqueue."
head:
  - tag: meta
    attrs:
      property: og:image
      content: https://bunqueue.dev/og/workflow.png
  - tag: meta
    attrs:
      name: keywords
      content: "workflow engine, orchestration, saga pattern, compensation, branching, human in the loop, step functions, temporal alternative, inngest alternative, bun workflow, typescript workflow, multi-step process, approval workflow, pipeline orchestration"
---

Orchestrate multi-step business processes with a fluent, chainable DSL. Saga compensation, conditional branching, human-in-the-loop signals, step timeouts — all built on top of bunqueue's Queue and Worker. No new infrastructure, no external services, no YAML.

```
validate ──→ reserve stock ──→ charge payment ──→ send confirmation
                  ↑                    ↑
            compensate:           compensate:
            release stock         refund payment
```

## bunqueue vs Competitors

| | **bunqueue** | **Temporal** | **Inngest** | **AWS Step Functions** | **Trigger.dev** |
|---|---|---|---|---|---|
| **Definition** | TypeScript DSL | TypeScript + decorators | `step.run()` wrappers | JSON (ASL) or visual UI | TypeScript functions |
| **Infrastructure** | None (embedded SQLite) | PostgreSQL + 7 services | Cloud-only (no self-host) | AWS-native | Redis + PostgreSQL |
| **Saga compensation** | Built-in | Manual | Manual | Manual | Manual |
| **Human-in-the-loop** | `.waitFor()` + `signal()` | Signals API | `step.waitForEvent()` | Callback tasks | Waitpoint tokens |
| **Branching** | `.branch().path()` | Code-level if/else | Code-level if/else | Choice state (JSON) | Code-level if/else |
| **Self-hosted** | Yes (zero-config) | Yes (complex) | No | No | Yes (complex) |
| **Pricing** | Free (MIT) | Free self-hosted / Cloud $$ | Free tier, then per-execution | Per state transition | Free tier, then $50/mo+ |
| **Setup time** | `bun add bunqueue` | Hours to days | Minutes (cloud) | Minutes (if on AWS) | 30min+ self-hosted |

### Why bunqueue?

- **Zero infrastructure.** Temporal needs PostgreSQL + 7 services. Trigger.dev needs Redis + PostgreSQL. bunqueue needs nothing — SQLite is embedded.
- **Saga pattern is first-class.** Every competitor requires you to implement compensation manually. bunqueue runs compensate handlers in reverse order automatically.
- **TypeScript-native DSL.** No JSON state machines (Step Functions), no decorators (Temporal), no wrapper functions (Inngest). Just `.step().step().branch().step()`.
- **Same process, same codebase.** No separate worker infrastructure, no deployment pipeline for workflow definitions. It's a library, not a platform.

### When to use something else

- **Multi-region HA with automatic failover** — Use Temporal or AWS Step Functions
- **Serverless-first with zero ops** — Use Inngest
- **Already running Redis with BullMQ** — Use BullMQ FlowProducer for simple parent-child chains

## Quick Start

```bash
bun add bunqueue
```

```typescript
import { Workflow, Engine } from 'bunqueue/workflow';

// Define a workflow
const orderFlow = new Workflow('order-pipeline')
  .step('validate', async (ctx) => {
    const { orderId, amount } = ctx.input as { orderId: string; amount: number };
    if (amount <= 0) throw new Error('Invalid amount');
    return { orderId, validated: true };
  })
  .step('charge', async (ctx) => {
    const { orderId } = ctx.steps['validate'] as { orderId: string };
    const txId = await payments.charge(orderId, ctx.input.amount);
    return { transactionId: txId };
  }, {
    compensate: async () => {
      // Runs automatically if a later step fails
      await payments.refund();
    },
  })
  .step('confirm', async (ctx) => {
    const { transactionId } = ctx.steps['charge'] as { transactionId: string };
    await mailer.send('order-confirm', { txId: transactionId });
    return { emailSent: true, transactionId };
  });

// Create engine and run
const engine = new Engine({ embedded: true });
engine.register(orderFlow);

const run = await engine.start('order-pipeline', {
  orderId: 'ORD-1',
  amount: 99.99,
});

// Check status
const exec = engine.getExecution(run.id);
console.log(exec.state);  // 'completed' | 'running' | 'failed' | 'waiting'
```

:::tip
The Engine supports both **embedded** and **TCP** modes. Pass `connection: { port: 6789 }` instead of `embedded: true` to connect to a running bunqueue server.
:::

## Core Concepts

### Steps

Steps are the building blocks. Each step receives a context with the workflow input and all previous step results:

```typescript
const flow = new Workflow('data-pipeline')
  .step('extract', async (ctx) => {
    const { source } = ctx.input as { source: string };
    const rawData = await fetchFromSource(source);
    return { records: rawData.length, data: rawData };
  })
  .step('transform', async (ctx) => {
    // Access previous step results via ctx.steps
    const { data } = ctx.steps['extract'] as { data: RawRecord[] };
    const cleaned = data.filter(r => r.valid).map(normalize);
    return { cleaned, dropped: data.length - cleaned.length };
  })
  .step('load', async (ctx) => {
    const { cleaned } = ctx.steps['transform'] as { cleaned: CleanRecord[] };
    await db.insertBatch('analytics', cleaned);
    // Access original input too
    return { loaded: cleaned.length, source: (ctx.input as { source: string }).source };
  });
```

**StepContext shape:**

| Property | Type | Description |
|---|---|---|
| `ctx.input` | `unknown` | The input passed to `engine.start()` |
| `ctx.steps` | `Record<string, unknown>` | Results from all completed steps (keyed by step name) |
| `ctx.signals` | `Record<string, unknown>` | Data from received signals (keyed by event name) |
| `ctx.executionId` | `string` | Unique execution ID |

Every step **must return a value** (or `undefined`). The return value becomes available to subsequent steps via `ctx.steps['step-name']`.

### Compensation (Saga Pattern)

When a step fails, compensation handlers run **in reverse order** for all previously completed steps. This implements the [saga pattern](https://microservices.io/patterns/data/saga.html) — the industry-standard approach for distributed transactions without two-phase commit.

```typescript
const flow = new Workflow('money-transfer')
  .step('debit-source', async (ctx) => {
    const { from, amount } = ctx.input as { from: string; to: string; amount: number };
    await accounts.debit(from, amount);
    return { debited: true, account: from, amount };
  }, {
    compensate: async () => {
      // Undo: credit back the source account
      await accounts.credit(from, amount);
      console.log('Rolled back: source account credited');
    },
  })
  .step('credit-target', async (ctx) => {
    const { to, amount } = ctx.input as { from: string; to: string; amount: number };
    await accounts.credit(to, amount);
    return { credited: true, account: to, amount };
  }, {
    compensate: async () => {
      // Undo: debit back the target account
      await accounts.debit(to, amount);
      console.log('Rolled back: target account debited');
    },
  })
  .step('send-receipt', async () => {
    throw new Error('Email service down');
    // → Compensation runs automatically in reverse:
    //   1. credit-target compensate (debit target)
    //   2. debit-source compensate (credit source)
  });
```

**How it works:**

1. Steps A, B, C execute in order
2. Step C throws an error
3. Engine runs compensation for B, then A (reverse order)
4. Execution state becomes `'failed'`

Compensation is **best-effort** — if a compensate handler itself throws, the error is logged but the remaining compensations still run.

:::note
Not every step needs a compensate handler. Only add them to steps that produce side effects you need to undo (database writes, API calls, reservations, charges).
:::

### Branching

Route execution to different paths based on runtime conditions:

```typescript
const flow = new Workflow('support-ticket')
  .step('classify', async (ctx) => {
    const { message, plan } = ctx.input as { message: string; plan: string };
    const sentiment = await analyzeSentiment(message);
    const priority = plan === 'enterprise' ? 'high' : sentiment < 0 ? 'medium' : 'low';
    return { priority };
  })
  .branch((ctx) => (ctx.steps['classify'] as { priority: string }).priority)
  .path('high', (w) =>
    w.step('assign-senior', async (ctx) => {
      const agent = await roster.getAvailable('senior');
      await slack.notify(agent, 'Urgent ticket assigned');
      return { assignedTo: agent.name, sla: '1h' };
    })
  )
  .path('medium', (w) =>
    w.step('assign-regular', async (ctx) => {
      const agent = await roster.getAvailable('regular');
      return { assignedTo: agent.name, sla: '4h' };
    })
  )
  .path('low', (w) =>
    w.step('auto-reply', async (ctx) => {
      await mailer.sendTemplate('auto-reply', ctx.input);
      return { assignedTo: 'bot', sla: '24h' };
    })
  )
  .step('log-ticket', async (ctx) => {
    // This step always runs, regardless of which branch was taken
    await auditLog.write('ticket-created', { executionId: ctx.executionId });
    return { logged: true };
  });
```

**Rules:**

- The branch function returns a string that matches one of the `.path()` names
- Only the matching path executes; others are skipped entirely
- Steps after the branch block always run (convergence point)
- Each path can contain multiple steps, nested branches, or `waitFor` calls

### WaitFor (Human-in-the-Loop)

Pause execution until an external signal arrives. This is how you implement approval gates, manual review steps, or any process that needs human input:

```typescript
const flow = new Workflow('content-publishing')
  .step('draft', async (ctx) => {
    const { title, body } = ctx.input as { title: string; body: string };
    const draft = await cms.createDraft({ title, body });
    await slack.notify('#editorial', `New draft "${title}" ready for review`);
    return { draftId: draft.id, previewUrl: draft.previewUrl };
  })
  .waitFor('editorial-review')
  .step('publish-or-reject', async (ctx) => {
    const review = ctx.signals['editorial-review'] as {
      approved: boolean;
      editor: string;
      notes?: string;
    };

    if (!review.approved) {
      await cms.reject(ctx.steps['draft'].draftId, review.notes);
      return { status: 'rejected', editor: review.editor };
    }

    const published = await cms.publish(ctx.steps['draft'].draftId);
    return { status: 'published', url: published.url, editor: review.editor };
  });

// Start the workflow
const run = await engine.start('content-publishing', {
  title: 'Announcing Workflow Engine',
  body: '...',
});

// The execution pauses at 'editorial-review' with state: 'waiting'
// Your app can show a UI, send a Slack button, expose an API endpoint, etc.

// When the editor makes a decision (could be minutes, hours, or days later):
await engine.signal(run.id, 'editorial-review', {
  approved: true,
  editor: 'alice@company.com',
  notes: 'Great article, ship it!',
});
// → Execution resumes from 'publish-or-reject'
```

**Key behaviors:**

- `waitFor('event')` transitions the execution to `state: 'waiting'`
- The execution is persisted to SQLite — it survives process restarts
- `engine.signal(id, event, payload)` stores the payload and resumes execution
- The signal data is available in `ctx.signals['event-name']`
- You can have multiple `waitFor` calls in a single workflow (e.g., multi-stage approvals)

### Step Timeout

Prevent steps from running indefinitely:

```typescript
const flow = new Workflow('api-aggregation')
  .step('fetch-primary', async () => {
    const res = await fetch('https://api.primary.com/data');
    return await res.json();
  }, { timeout: 5000 })  // 5 second timeout
  .step('fetch-secondary', async () => {
    const res = await fetch('https://api.secondary.com/data');
    return await res.json();
  }, { timeout: 10000 })  // 10 second timeout
  .step('merge', async (ctx) => {
    const primary = ctx.steps['fetch-primary'];
    const secondary = ctx.steps['fetch-secondary'];
    return { ...primary, ...secondary };
  });
```

If a step exceeds its timeout, it fails with a `"timed out"` error. If the step has a compensate handler, compensation runs for all previously completed steps.

## Engine API

### Constructor

```typescript
// Embedded mode — everything in-process, no server needed
const engine = new Engine({ embedded: true });

// Embedded with SQLite persistence
const engine = new Engine({
  embedded: true,
  dataPath: './data/workflows.db',
});

// TCP mode — connects to a running bunqueue server
const engine = new Engine({
  connection: { host: 'localhost', port: 6789 },
});

// All options
const engine = new Engine({
  embedded: true,              // Use embedded mode (default: false)
  connection: { port: 6789 },  // TCP server connection (mutually exclusive with embedded)
  dataPath: './data/wf.db',    // SQLite persistence path
  concurrency: 10,             // Max parallel step executions (default: 5)
  queueName: '__wf:steps',     // Internal queue name (default: '__wf:steps')
});
```

### Methods

| Method | Returns | Description |
|---|---|---|
| `engine.register(workflow)` | `this` | Register a workflow definition. Chainable. |
| `engine.start(name, input?)` | `Promise<RunHandle>` | Start a new execution. Returns `{ id, workflowName }`. |
| `engine.getExecution(id)` | `Execution \| null` | Get full execution state by ID. |
| `engine.listExecutions(name?, state?)` | `Execution[]` | List executions with optional filters. |
| `engine.signal(id, event, payload?)` | `Promise<void>` | Send a signal to resume a waiting execution. |
| `engine.close(force?)` | `Promise<void>` | Shut down engine, queue, and worker. |

### Execution State

```typescript
const exec = engine.getExecution(run.id);

exec.id;            // 'wf_abc123' — unique execution ID
exec.workflowName;  // 'order-pipeline'
exec.state;         // 'running' | 'completed' | 'failed' | 'waiting'
exec.input;         // { orderId: 'ORD-1', amount: 99.99 }
exec.steps;         // Step-by-step status and results:
// {
//   'validate': { status: 'completed', result: { orderId: 'ORD-1', validated: true } },
//   'charge':   { status: 'completed', result: { transactionId: 'tx_abc' } },
//   'confirm':  { status: 'running' }
// }
exec.signals;       // { 'manager-approval': { approved: true } }
exec.createdAt;     // 1712700000000
exec.updatedAt;     // 1712700005000
```

**Execution states:**

| State | Meaning |
|---|---|
| `running` | Steps are being executed |
| `completed` | All steps finished successfully |
| `failed` | A step threw an error (compensation has run) |
| `waiting` | Paused at a `waitFor`, waiting for a signal |

## Real-World Examples

### E-commerce Order Pipeline

A complete order flow with inventory reservation, payment processing, and automatic rollback on failure:

```typescript
const orderFlow = new Workflow<{ orderId: string; items: Item[]; amount: number }>('process-order')
  .step('validate-order', async (ctx) => {
    const { orderId, items, amount } = ctx.input as OrderInput;

    if (items.length === 0) throw new Error('Empty cart');
    if (amount <= 0) throw new Error('Invalid amount');

    // Check all items are in catalog
    for (const item of items) {
      const exists = await catalog.exists(item.sku);
      if (!exists) throw new Error(`Unknown SKU: ${item.sku}`);
    }

    return { orderId, itemCount: items.length, amount };
  })
  .step('reserve-inventory', async (ctx) => {
    const { items } = ctx.input as OrderInput;
    const reservationId = await inventory.reserveBatch(items);
    return { reservationId };
  }, {
    compensate: async () => {
      // Release all reserved items if payment or shipping fails
      await inventory.releaseBatch(ctx.steps['reserve-inventory'].reservationId);
    },
  })
  .step('process-payment', async (ctx) => {
    const { amount, orderId } = ctx.steps['validate-order'] as ValidatedOrder;
    const charge = await stripe.charges.create({
      amount: Math.round(amount * 100),
      currency: 'usd',
      metadata: { orderId },
    });
    return { chargeId: charge.id, receiptUrl: charge.receipt_url };
  }, {
    compensate: async () => {
      // Full refund if shipping step fails
      await stripe.refunds.create({ charge: ctx.steps['process-payment'].chargeId });
    },
  })
  .step('create-shipment', async (ctx) => {
    const { orderId, items } = ctx.input as OrderInput;
    const { reservationId } = ctx.steps['reserve-inventory'] as { reservationId: string };
    const shipment = await shipping.create({ orderId, items, reservationId });
    return { trackingNumber: shipment.tracking, carrier: shipment.carrier };
  })
  .step('send-confirmation', async (ctx) => {
    const payment = ctx.steps['process-payment'] as { chargeId: string; receiptUrl: string };
    const shipment = ctx.steps['create-shipment'] as { trackingNumber: string; carrier: string };

    await mailer.send('order-confirmation', {
      to: ctx.input.email,
      orderId: ctx.input.orderId,
      receiptUrl: payment.receiptUrl,
      tracking: shipment.trackingNumber,
      carrier: shipment.carrier,
    });

    return { notified: true };
  });
```

**What happens on failure:**

- If `process-payment` fails → `reserve-inventory` compensation runs (items released)
- If `create-shipment` fails → `process-payment` compensation runs (refund), then `reserve-inventory` compensation runs (items released)
- If `send-confirmation` fails → full rollback: refund payment, release inventory

### CI/CD Deployment Pipeline with Approval Gate

Build, test, deploy to staging, wait for manual approval, then deploy to production:

```typescript
const deployFlow = new Workflow('deploy-pipeline')
  .step('build', async (ctx) => {
    const { repo, branch, commitSha } = ctx.input as DeployInput;
    const build = await ci.triggerBuild({ repo, branch, commitSha });
    await ci.waitForBuild(build.id); // Polls until complete
    return { buildId: build.id, artifact: build.artifactUrl, duration: build.durationMs };
  })
  .step('run-tests', async (ctx) => {
    const { buildId } = ctx.steps['build'] as { buildId: string };
    const results = await ci.runTestSuite(buildId, {
      suites: ['unit', 'integration', 'e2e'],
      parallel: true,
    });

    if (results.failed > 0) {
      throw new Error(`${results.failed}/${results.total} tests failed`);
    }

    return { passed: results.passed, coverage: results.coverage };
  })
  .step('deploy-staging', async (ctx) => {
    const { artifact } = ctx.steps['build'] as { artifact: string };
    await k8s.deploy('staging', artifact);
    const healthCheck = await k8s.waitForHealthy('staging', 60000);

    // Notify the team
    await slack.send('#deploys', {
      text: `Staging deploy ready for review`,
      url: `https://staging.example.com`,
    });

    return { env: 'staging', healthy: healthCheck.ok };
  }, {
    compensate: async () => {
      // Rollback staging to previous version
      await k8s.rollback('staging');
    },
  })
  .waitFor('production-approval')
  .step('deploy-production', async (ctx) => {
    const approval = ctx.signals['production-approval'] as {
      approver: string;
      strategy: 'rolling' | 'blue-green' | 'canary';
    };

    const { artifact } = ctx.steps['build'] as { artifact: string };

    // Deploy with the approved strategy
    await k8s.deploy('production', artifact, { strategy: approval.strategy });
    await k8s.waitForHealthy('production', 120000);

    await slack.send('#deploys', {
      text: `Production deploy complete (${approval.strategy})`,
      approvedBy: approval.approver,
    });

    return {
      env: 'production',
      approvedBy: approval.approver,
      strategy: approval.strategy,
    };
  }, {
    compensate: async () => {
      await k8s.rollback('production');
      await slack.send('#deploys', { text: 'Production rolled back!' });
    },
  });

// Usage
const run = await engine.start('deploy-pipeline', {
  repo: 'myapp',
  branch: 'release/v2.5',
  commitSha: 'abc123f',
});

// After QA on staging (hours/days later):
await engine.signal(run.id, 'production-approval', {
  approver: 'cto@company.com',
  strategy: 'canary',
});
```

### KYC Onboarding with Risk-Based Branching

Different verification paths based on risk scoring — low-risk users get auto-approved, medium-risk need document upload, high-risk go to manual compliance review:

```typescript
const kycFlow = new Workflow('kyc-onboarding')
  .step('create-account', async (ctx) => {
    const { email, name, country } = ctx.input as OnboardingInput;
    const user = await db.users.create({ email, name, country, status: 'pending' });
    return { userId: user.id };
  }, {
    compensate: async () => {
      // Delete the account if verification fails
      await db.users.delete(ctx.steps['create-account'].userId);
    },
  })
  .step('risk-assessment', async (ctx) => {
    const { country, email } = ctx.input as OnboardingInput;
    const score = await riskEngine.assess({ country, email, ip: ctx.input.ip });

    return {
      score,
      riskLevel: score > 80 ? 'low' : score > 50 ? 'medium' : 'high',
    };
  })
  .branch((ctx) => (ctx.steps['risk-assessment'] as { riskLevel: string }).riskLevel)
  .path('low', (w) =>
    w.step('auto-approve', async () => {
      return { approved: true, method: 'automatic', verifiedAt: Date.now() };
    })
  )
  .path('medium', (w) =>
    w.step('request-documents', async (ctx) => {
      const { userId } = ctx.steps['create-account'] as { userId: string };
      await mailer.send('document-request', { userId });
      return { documentsRequested: true };
    })
    .waitFor('documents-uploaded')
    .step('verify-documents', async (ctx) => {
      const docs = ctx.signals['documents-uploaded'] as { files: string[] };
      const verification = await docVerification.check(docs.files);

      if (!verification.passed) {
        throw new Error(`Document verification failed: ${verification.reason}`);
      }

      return { approved: true, method: 'document-review', verifiedAt: Date.now() };
    })
  )
  .path('high', (w) =>
    w.step('flag-compliance', async (ctx) => {
      const { userId } = ctx.steps['create-account'] as { userId: string };
      const { score } = ctx.steps['risk-assessment'] as { score: number };
      await complianceQueue.assign({ userId, riskScore: score });
      return { flagged: true };
    })
    .waitFor('compliance-decision')
    .step('apply-compliance-decision', async (ctx) => {
      const decision = ctx.signals['compliance-decision'] as {
        approved: boolean;
        reviewer: string;
        notes: string;
      };

      if (!decision.approved) {
        throw new Error(`Rejected by compliance: ${decision.notes}`);
      }

      return { approved: true, method: 'compliance-review', reviewer: decision.reviewer };
    })
  )
  .step('activate-account', async (ctx) => {
    const { userId } = ctx.steps['create-account'] as { userId: string };
    await db.users.update(userId, { status: 'active', activatedAt: Date.now() });
    await mailer.send('welcome', { userId });
    return { activated: true };
  });
```

### Data Pipeline (ETL)

Extract, transform, load with metrics aggregation at each stage:

```typescript
const etlFlow = new Workflow('daily-etl')
  .step('extract', async (ctx) => {
    const { date, sources } = ctx.input as { date: string; sources: string[] };
    const records: Record[] = [];

    for (const source of sources) {
      const data = await dataLake.query(source, { date });
      records.push(...data);
    }

    return { totalRecords: records.length, sources: sources.length, data: records };
  })
  .step('transform', async (ctx) => {
    const { data } = ctx.steps['extract'] as { data: Record[] };

    const cleaned = data
      .filter(r => r.timestamp && r.value !== null)
      .map(r => ({ ...r, value: normalize(r.value), processedAt: Date.now() }));

    const dropped = data.length - cleaned.length;

    return { cleanedRecords: cleaned.length, droppedRecords: dropped, data: cleaned };
  })
  .step('load', async (ctx) => {
    const { data } = ctx.steps['transform'] as { data: CleanRecord[] };
    const extract = ctx.steps['extract'] as { totalRecords: number; sources: number };
    const transform = ctx.steps['transform'] as { cleanedRecords: number; droppedRecords: number };

    // Batch insert
    const batches = chunk(data, 1000);
    for (const batch of batches) {
      await warehouse.insertBatch('analytics_events', batch);
    }

    return {
      pipeline: 'daily-etl',
      date: ctx.input.date,
      metrics: {
        sourcesProcessed: extract.sources,
        rawRecords: extract.totalRecords,
        cleanedRecords: transform.cleanedRecords,
        droppedRecords: transform.droppedRecords,
        loadedRecords: data.length,
      },
    };
  });
```

## How It Works Internally

The workflow engine is a **pure consumer layer** built on top of bunqueue. Zero modifications to the core engine.

```
Workflow DSL (.step / .branch / .waitFor)
        │
        ▼
┌──────────────────────────────────────────────────────────────────┐
│  Engine                                                          │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Executor                                                │    │
│  │  • Resolves current node (step / branch / waitFor)       │    │
│  │  • Runs step handler with timeout                        │    │
│  │  • Evaluates branch condition, picks path                │    │
│  │  • Checks signal availability for waitFor                │    │
│  │  • Runs compensation in reverse on failure               │    │
│  └──────────────────┬──────────────────────────────────────┘    │
│                      │                                           │
│  ┌──────────────────┼──────────────────────────────────────┐    │
│  │                   │                                      │    │
│  │  ┌────────┐  ┌───▼────┐  ┌───────────────────────┐     │    │
│  │  │ Queue  │  │ Worker │  │ Store (SQLite)         │     │    │
│  │  │__wf:   │  │ pulls  │  │ workflow_executions    │     │    │
│  │  │steps   │──│ & runs │──│ table: id, state,      │     │    │
│  │  │        │  │ steps  │  │ input, steps, signals  │     │    │
│  │  └────────┘  └────────┘  └───────────────────────┘     │    │
│  │  bunqueue internals (Queue + Worker + SQLite)           │    │
│  └─────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

**Execution flow:**

1. **`engine.start()`** creates an `Execution` record in SQLite and enqueues the first step as a job on the internal `__wf:steps` queue
2. **Worker picks up** the step job. The Executor loads the execution state, resolves the current node
3. **Step node**: runs the handler (with optional timeout), saves result, enqueues next node
4. **Branch node**: evaluates the condition function, runs the matching path's steps inline
5. **WaitFor node**: checks if the signal exists. If not, sets state to `'waiting'` and stops
6. **`engine.signal()`** stores the signal payload in the execution record and re-enqueues the next step
7. **On failure**: the Executor walks completed steps in reverse, calling each compensate handler

Each workflow step is a regular bunqueue job. You get all of bunqueue's features for free: SQLite persistence, concurrency control, and monitoring via the dashboard.

## Next Steps

- [Simple Mode](/guide/simple-mode/) — All-in-one Queue + Worker for simpler use cases
- [Queue API](/guide/queue/) — Low-level queue operations
- [Flow Producer](/guide/flow/) — Parent-child job dependencies (simpler than workflows)
- [MCP Server](/guide/mcp/) — Let AI agents orchestrate workflows via natural language
- [Examples](/examples/) — More code recipes
