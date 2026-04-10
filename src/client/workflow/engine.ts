/**
 * Engine - Public facade for the workflow engine
 * Manages lifecycle of internal Queue, Worker, and Store.
 */

import { Queue } from '../queue/queue';
import { Worker } from '../worker/worker';
import { WorkflowStore } from './store';
import { WorkflowExecutor } from './executor';
import type { Workflow } from './workflow';
import type { EngineOptions, RunHandle, Execution, ExecutionState, StepJobData } from './types';

const DEFAULT_QUEUE_NAME = '__wf:steps';

export class Engine {
  private readonly queue: Queue;
  private readonly worker: Worker;
  private readonly store: WorkflowStore;
  private readonly executor: WorkflowExecutor;

  constructor(opts: EngineOptions = {}) {
    const queueName = opts.queueName ?? DEFAULT_QUEUE_NAME;

    this.queue = new Queue(queueName, {
      connection: opts.connection,
      embedded: opts.embedded,
      dataPath: opts.dataPath,
    });

    this.store = new WorkflowStore(opts.dataPath);
    this.executor = new WorkflowExecutor(this.store, this.queue);

    this.worker = new Worker(
      queueName,
      async (job) => {
        const data = job.data as unknown as StepJobData;
        return this.executor.processStep(data);
      },
      {
        connection: opts.connection,
        embedded: opts.embedded,
        dataPath: opts.dataPath,
        concurrency: opts.concurrency ?? 5,
      }
    );
  }

  /** Register a workflow definition */
  register(workflow: Workflow): this {
    this.executor.register(workflow);
    return this;
  }

  /** Start a new workflow execution */
  async start(workflowName: string, input?: unknown): Promise<RunHandle> {
    return this.executor.start(workflowName, input);
  }

  /** Get execution state by ID */
  getExecution(id: string): Execution | null {
    return this.executor.getExecution(id);
  }

  /** List executions with optional filters */
  listExecutions(workflowName?: string, state?: ExecutionState): Execution[] {
    return this.executor.listExecutions(workflowName, state);
  }

  /** Send a signal to a waiting execution */
  async signal(executionId: string, event: string, payload?: unknown): Promise<void> {
    return this.executor.signal(executionId, event, payload);
  }

  /** Shut down the engine */
  async close(force = false): Promise<void> {
    await this.worker.close(force);
    this.queue.close();
    this.store.close();
  }
}
