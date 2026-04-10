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

/** Schema-like object — any object with a .parse() method (Zod, ArkType, Valibot, etc.) */
export interface SchemaLike {
  parse(data: unknown): unknown;
}

/** Options for a single step */
export interface StepOptions<TInput = unknown> {
  retry?: number;
  timeout?: number;
  compensate?: CompensateHandler<TInput>;
  /** Validate step input before execution */
  inputSchema?: SchemaLike;
  /** Validate step output after execution */
  outputSchema?: SchemaLike;
}

/** Internal step definition */
export interface StepDefinition {
  name: string;
  handler: StepHandler;
  compensate?: CompensateHandler;
  retry: number;
  timeout: number;
  inputSchema?: SchemaLike;
  outputSchema?: SchemaLike;
}

/** Branch condition function */
export type BranchCondition = (ctx: StepContext) => string;

/** Internal branch definition */
export interface BranchDefinition {
  condition: BranchCondition;
  paths: Map<string, StepDefinition[]>;
}

/** Definition of a parallel step group */
export interface ParallelDefinition {
  steps: StepDefinition[];
}

/** Input mapper for sub-workflows */
export type SubWorkflowInputMapper = (ctx: StepContext) => unknown;

/** Loop condition: receives context + iteration count, returns boolean */
export type LoopCondition = (ctx: StepContext, iteration: number) => boolean | Promise<boolean>;

/** Definition of a doUntil/doWhile loop */
export interface LoopDefinition {
  condition: LoopCondition;
  steps: StepDefinition[];
  maxIterations: number;
}

/** Item extractor for forEach */
export type ForEachItemsExtractor = (ctx: StepContext) => unknown[];

/** Definition of a forEach loop */
export interface ForEachDefinition {
  items: ForEachItemsExtractor;
  step: StepDefinition;
  maxIterations: number;
}

/** Transform function for map */
export type MapTransformFn = (ctx: StepContext) => unknown;

/** Definition of a map node */
export interface MapDefinition {
  name: string;
  transform: MapTransformFn;
}

/** Workflow node (discriminated union) */
export type WorkflowNode =
  | { type: 'step'; def: StepDefinition }
  | { type: 'branch'; def: BranchDefinition }
  | { type: 'waitFor'; event: string; timeout?: number }
  | { type: 'parallel'; def: ParallelDefinition }
  | { type: 'subWorkflow'; name: string; inputMapper: SubWorkflowInputMapper }
  | { type: 'doUntil'; def: LoopDefinition }
  | { type: 'doWhile'; def: LoopDefinition }
  | { type: 'forEach'; def: ForEachDefinition }
  | { type: 'map'; def: MapDefinition };

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
  attempts?: number;
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

/** All workflow event types */
export type WorkflowEventType =
  | 'step:started'
  | 'step:completed'
  | 'step:failed'
  | 'step:retry'
  | 'workflow:started'
  | 'workflow:completed'
  | 'workflow:failed'
  | 'workflow:compensating'
  | 'workflow:waiting'
  | 'signal:received'
  | 'signal:timeout';

/** Base event payload */
export interface WorkflowEvent {
  type: WorkflowEventType;
  executionId: string;
  workflowName: string;
  timestamp: number;
}

/** Step-level event payload */
export interface StepEvent extends WorkflowEvent {
  stepName: string;
  result?: unknown;
  error?: string;
  attempt?: number;
  maxAttempts?: number;
}

/** Workflow lifecycle event payload */
export interface WorkflowLifecycleEvent extends WorkflowEvent {
  state: ExecutionState;
  input?: unknown;
}

/** Signal event payload */
export interface SignalEvent extends WorkflowEvent {
  event: string;
  payload?: unknown;
}

/** Event listener function */
export type WorkflowEventListener = (
  event: WorkflowEvent | StepEvent | WorkflowLifecycleEvent | SignalEvent
) => void;

/** Engine configuration */
export interface EngineOptions {
  embedded?: boolean;
  dataPath?: string;
  connection?: ConnectionOptions;
  /** Internal queue name (default: __wf:steps) */
  queueName?: string;
  /** Worker concurrency (default: 5) */
  concurrency?: number;
  /** Global event listener for observability */
  onEvent?: WorkflowEventListener;
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

/** Options for cleanup */
export interface CleanupOptions {
  maxAge: number;
  states?: ExecutionState[];
}
