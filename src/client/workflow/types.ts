/**
 * Workflow Engine Types
 */

import type { ConnectionOptions } from '../types';

/** Context passed to step handlers */
export interface StepContext<TInput = unknown> {
  /** Original workflow input */
  readonly input: TInput;
  /** Results from completed steps (step name → result) */
  readonly steps: Readonly<Record<string, unknown>>;
  /** Signals received via engine.signal() */
  readonly signals: Readonly<Record<string, unknown>>;
  /** Current execution ID */
  readonly executionId: string;
}

/** Step handler function */
export type StepHandler<TInput = unknown, TResult = unknown> = (
  ctx: StepContext<TInput>
) => Promise<TResult> | TResult;

/** Compensate handler (rollback on failure) */
export type CompensateHandler<TInput = unknown> = (
  ctx: StepContext<TInput>
) => Promise<void> | void;

/** Options for a single step */
export interface StepOptions<TInput = unknown> {
  retry?: number;
  timeout?: number;
  compensate?: CompensateHandler<TInput>;
}

/** Internal step definition */
export interface StepDefinition {
  name: string;
  handler: StepHandler;
  compensate?: CompensateHandler;
  retry: number;
  timeout: number;
}

/** Branch condition function */
export type BranchCondition = (ctx: StepContext) => string;

/** Internal branch definition */
export interface BranchDefinition {
  condition: BranchCondition;
  paths: Map<string, StepDefinition[]>;
}

/** Workflow node (discriminated union) */
export type WorkflowNode =
  | { type: 'step'; def: StepDefinition }
  | { type: 'branch'; def: BranchDefinition }
  | { type: 'waitFor'; event: string; timeout?: number };

/** Execution state */
export type ExecutionState = 'running' | 'waiting' | 'completed' | 'failed' | 'compensating';

/** Step execution state */
export type StepState = 'pending' | 'running' | 'completed' | 'failed';

/** Record of a step's execution */
export interface StepRecord {
  status: StepState;
  result?: unknown;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

/** Full execution state */
export interface Execution {
  id: string;
  workflowName: string;
  state: ExecutionState;
  input: unknown;
  steps: Record<string, StepRecord>;
  currentNodeIndex: number;
  /** Flattened step list for branch resolution */
  resolvedSteps?: string[];
  signals: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/** Engine configuration */
export interface EngineOptions {
  embedded?: boolean;
  dataPath?: string;
  connection?: ConnectionOptions;
  /** Internal queue name (default: __wf:steps) */
  queueName?: string;
  /** Worker concurrency (default: 5) */
  concurrency?: number;
}

/** Handle returned from engine.start() */
export interface RunHandle {
  id: string;
  workflowName: string;
}

/** Internal job data for step execution */
export interface StepJobData {
  executionId: string;
  workflowName: string;
  nodeIndex: number;
}
