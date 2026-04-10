/**
 * WorkflowExecutor - Core execution logic
 * Processes steps as bunqueue jobs, handles transitions, branching, compensation.
 */

import type { Queue } from '../queue/queue';
import type { Workflow } from './workflow';
import type { WorkflowStore } from './store';
import type {
  Execution,
  StepJobData,
  RunHandle,
  StepContext,
  WorkflowNode,
  StepDefinition,
} from './types';

/** Thrown when a step needs to wait for a signal */
class WaitForSignalError extends Error {
  constructor(readonly event: string) {
    super(`Waiting for signal: ${event}`);
  }
}

export class WorkflowExecutor {
  private readonly workflows = new Map<string, Workflow>();

  constructor(
    private readonly store: WorkflowStore,
    private readonly queue: Queue
  ) {}

  register(workflow: Workflow): void {
    const names = workflow.getStepNames();
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    if (dupes.length > 0) {
      throw new Error(`Duplicate step names in "${workflow.name}": ${dupes.join(', ')}`);
    }
    this.workflows.set(workflow.name, workflow);
  }

  async start(workflowName: string, input: unknown): Promise<RunHandle> {
    const wf = this.workflows.get(workflowName);
    if (!wf) throw new Error(`Workflow "${workflowName}" not registered`);
    if (wf.nodes.length === 0) throw new Error(`Workflow "${workflowName}" has no steps`);

    const now = Date.now();
    const exec: Execution = {
      id: `wf_${now}_${Math.random().toString(36).slice(2, 10)}`,
      workflowName,
      state: 'running',
      input,
      steps: {},
      currentNodeIndex: 0,
      signals: {},
      createdAt: now,
      updatedAt: now,
    };

    this.store.save(exec);
    await this.enqueueNode(exec);
    return { id: exec.id, workflowName };
  }

  /** Process a step job — this is the Worker processor function */
  async processStep(data: StepJobData): Promise<unknown> {
    const exec = this.store.get(data.executionId);
    if (exec?.state !== 'running') return null;

    const wf = this.workflows.get(exec.workflowName);
    if (!wf) throw new Error(`Workflow "${exec.workflowName}" not registered`);

    const node = wf.nodes[data.nodeIndex] as WorkflowNode | undefined;
    if (!node) {
      exec.state = 'completed';
      this.store.update(exec);
      return null;
    }

    try {
      await this.executeNode(exec, node, data.nodeIndex, wf);
    } catch (err) {
      if (err instanceof WaitForSignalError) return null;
      exec.state = 'failed';
      this.store.update(exec);
      await this.runCompensation(exec, wf);
      throw err;
    }

    return null;
  }

  async signal(executionId: string, event: string, payload: unknown): Promise<void> {
    const exec = this.store.get(executionId);
    if (!exec) throw new Error(`Execution "${executionId}" not found`);

    exec.signals[event] = payload;
    exec.state = 'running';
    this.store.update(exec);
    await this.enqueueNode(exec);
  }

  getExecution(id: string): Execution | null {
    return this.store.get(id);
  }

  listExecutions(workflowName?: string, state?: Execution['state']): Execution[] {
    return this.store.list(workflowName, state);
  }

  // ============ Internal ============

  private async executeNode(
    exec: Execution,
    node: WorkflowNode,
    nodeIndex: number,
    wf: Workflow
  ): Promise<void> {
    if (node.type === 'step') {
      await this.executeStep(exec, node.def, nodeIndex, wf);
    } else if (node.type === 'branch') {
      await this.executeBranch(exec, node, nodeIndex, wf);
    } else {
      await this.executeWaitFor(exec, node, nodeIndex);
    }
  }

  private async executeStep(
    exec: Execution,
    def: StepDefinition,
    nodeIndex: number,
    wf: Workflow
  ): Promise<void> {
    const ctx = this.buildContext(exec);
    exec.steps[def.name] = { status: 'running', startedAt: Date.now() };
    this.store.update(exec);

    try {
      const result = await this.runWithTimeout(def.handler(ctx), def.timeout);
      exec.steps[def.name] = {
        status: 'completed',
        result,
        startedAt: exec.steps[def.name].startedAt,
        completedAt: Date.now(),
      };
      exec.currentNodeIndex = nodeIndex + 1;
      this.store.update(exec);
      await this.advanceToNext(exec, wf);
    } catch (err) {
      exec.steps[def.name] = {
        status: 'failed',
        error: String(err),
        startedAt: exec.steps[def.name].startedAt,
        completedAt: Date.now(),
      };
      this.store.update(exec);
      throw err;
    }
  }

  private async executeBranch(
    exec: Execution,
    node: Extract<WorkflowNode, { type: 'branch' }>,
    nodeIndex: number,
    wf: Workflow
  ): Promise<void> {
    const ctx = this.buildContext(exec);
    const pathName = node.def.condition(ctx);
    const pathSteps = node.def.paths.get(pathName);

    if (!pathSteps || pathSteps.length === 0) {
      exec.currentNodeIndex = nodeIndex + 1;
      this.store.update(exec);
      await this.advanceToNext(exec, wf);
      return;
    }

    // Execute branch steps inline
    for (const step of pathSteps) {
      await this.executeStep(exec, step, nodeIndex, wf);
    }

    exec.currentNodeIndex = nodeIndex + 1;
    this.store.update(exec);
    await this.advanceToNext(exec, wf);
  }

  private async executeWaitFor(
    exec: Execution,
    node: Extract<WorkflowNode, { type: 'waitFor' }>,
    nodeIndex: number
  ): Promise<void> {
    if (exec.signals[node.event] !== undefined) {
      exec.currentNodeIndex = nodeIndex + 1;
      this.store.update(exec);
      await this.enqueueNode(exec);
      return;
    }

    // Not yet received — pause execution
    exec.state = 'waiting';
    this.store.update(exec);
    throw new WaitForSignalError(node.event);
  }

  private async advanceToNext(exec: Execution, wf: Workflow): Promise<void> {
    if (exec.currentNodeIndex >= wf.nodes.length) {
      exec.state = 'completed';
      this.store.update(exec);
      return;
    }
    await this.enqueueNode(exec);
  }

  private async enqueueNode(exec: Execution): Promise<void> {
    const jobData: StepJobData = {
      executionId: exec.id,
      workflowName: exec.workflowName,
      nodeIndex: exec.currentNodeIndex,
    };
    await this.queue.add('wf:step', jobData as unknown as Record<string, unknown>);
  }

  private async runCompensation(exec: Execution, wf: Workflow): Promise<void> {
    const completedSteps = Object.entries(exec.steps)
      .filter(([, s]) => s.status === 'completed')
      .reverse();

    if (completedSteps.length === 0) return;

    exec.state = 'compensating';
    this.store.update(exec);

    const ctx = this.buildContext(exec);
    for (const [name] of completedSteps) {
      const def = this.findStepDef(wf, name);
      if (def?.compensate) {
        try {
          await def.compensate(ctx);
        } catch {
          // Compensation errors are logged but don't stop the chain
        }
      }
    }

    exec.state = 'failed';
    this.store.update(exec);
  }

  private findStepDef(wf: Workflow, name: string): StepDefinition | null {
    for (const node of wf.nodes) {
      if (node.type === 'step' && node.def.name === name) return node.def;
      if (node.type === 'branch') {
        for (const steps of node.def.paths.values()) {
          const found = steps.find((s) => s.name === name);
          if (found) return found;
        }
      }
    }
    return null;
  }

  private buildContext(exec: Execution): StepContext {
    const stepResults: Record<string, unknown> = {};
    for (const [name, record] of Object.entries(exec.steps)) {
      if (record.status === 'completed') stepResults[name] = record.result;
    }
    return {
      input: exec.input,
      steps: stepResults,
      signals: exec.signals,
      executionId: exec.id,
    };
  }

  private runWithTimeout<T>(promise: Promise<T> | T, timeoutMs: number): Promise<T> {
    if (!(promise instanceof Promise)) return Promise.resolve(promise);
    if (timeoutMs <= 0) return promise;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Step timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      promise.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e: unknown) => {
          clearTimeout(timer);
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      );
    });
  }
}
