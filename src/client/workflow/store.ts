/**
 * WorkflowStore - SQLite persistence for workflow executions
 */

import { Database } from 'bun:sqlite';
import { Packr, Unpackr } from 'msgpackr';
import type { Execution, ExecutionState, StepRecord } from './types';

const packr = new Packr({ structuredClone: true });
const unpackr = new Unpackr({ structuredClone: true });

function pack(data: unknown): Uint8Array {
  return packr.pack(data);
}

function unpack(buf: Uint8Array | null): unknown {
  if (!buf) return null;
  return unpackr.unpack(buf);
}

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS workflow_executions (
  id TEXT PRIMARY KEY,
  workflow_name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'running',
  input BLOB,
  steps BLOB,
  current_node_index INTEGER NOT NULL DEFAULT 0,
  resolved_steps BLOB,
  signals BLOB,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`;

const CREATE_IDX_NAME = `CREATE INDEX IF NOT EXISTS idx_wf_name ON workflow_executions(workflow_name)`;
const CREATE_IDX_STATE = `CREATE INDEX IF NOT EXISTS idx_wf_state ON workflow_executions(state)`;

export class WorkflowStore {
  private readonly db: Database;
  private readonly stmts: {
    upsert: ReturnType<Database['prepare']>;
    get: ReturnType<Database['prepare']>;
    updateState: ReturnType<Database['prepare']>;
    list: ReturnType<Database['prepare']>;
    listByName: ReturnType<Database['prepare']>;
    listByState: ReturnType<Database['prepare']>;
    listByBoth: ReturnType<Database['prepare']>;
  };

  constructor(dbPath?: string) {
    this.db = new Database(dbPath ?? ':memory:', { create: true });
    this.db.run('PRAGMA journal_mode = WAL');
    this.db.run(CREATE_TABLE);
    this.db.run(CREATE_IDX_NAME);
    this.db.run(CREATE_IDX_STATE);

    this.stmts = {
      upsert: this.db.prepare(`
        INSERT OR REPLACE INTO workflow_executions
        (id, workflow_name, state, input, steps, current_node_index, resolved_steps, signals, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      get: this.db.prepare(`SELECT * FROM workflow_executions WHERE id = ?`),
      updateState: this.db.prepare(`
        UPDATE workflow_executions
        SET state = ?, steps = ?, current_node_index = ?, resolved_steps = ?, signals = ?, updated_at = ?
        WHERE id = ?
      `),
      list: this.db.prepare(`SELECT * FROM workflow_executions ORDER BY created_at DESC LIMIT 100`),
      listByName: this.db.prepare(
        `SELECT * FROM workflow_executions WHERE workflow_name = ? ORDER BY created_at DESC LIMIT 100`
      ),
      listByState: this.db.prepare(
        `SELECT * FROM workflow_executions WHERE state = ? ORDER BY created_at DESC LIMIT 100`
      ),
      listByBoth: this.db.prepare(
        `SELECT * FROM workflow_executions WHERE workflow_name = ? AND state = ? ORDER BY created_at DESC LIMIT 100`
      ),
    };
  }

  save(exec: Execution): void {
    this.stmts.upsert.run(
      exec.id,
      exec.workflowName,
      exec.state,
      pack(exec.input),
      pack(exec.steps),
      exec.currentNodeIndex,
      exec.resolvedSteps ? pack(exec.resolvedSteps) : null,
      pack(exec.signals),
      exec.createdAt,
      exec.updatedAt
    );
  }

  get(id: string): Execution | null {
    const row = this.stmts.get.get(id) as Record<string, unknown> | null;
    return row ? this.rowToExecution(row) : null;
  }

  update(exec: Execution): void {
    exec.updatedAt = Date.now();
    this.stmts.updateState.run(
      exec.state,
      pack(exec.steps),
      exec.currentNodeIndex,
      exec.resolvedSteps ? pack(exec.resolvedSteps) : null,
      pack(exec.signals),
      exec.updatedAt,
      exec.id
    );
  }

  list(workflowName?: string, state?: ExecutionState): Execution[] {
    let rows: Record<string, unknown>[];
    if (workflowName && state) {
      rows = this.stmts.listByBoth.all(workflowName, state) as Record<string, unknown>[];
    } else if (workflowName) {
      rows = this.stmts.listByName.all(workflowName) as Record<string, unknown>[];
    } else if (state) {
      rows = this.stmts.listByState.all(state) as Record<string, unknown>[];
    } else {
      rows = this.stmts.list.all() as Record<string, unknown>[];
    }
    return rows.map((r) => this.rowToExecution(r));
  }

  close(): void {
    this.db.close();
  }

  private rowToExecution(row: Record<string, unknown>): Execution {
    return {
      id: row.id as string,
      workflowName: row.workflow_name as string,
      state: row.state as ExecutionState,
      input: unpack(row.input as Uint8Array | null),
      steps: (unpack(row.steps as Uint8Array | null) as Record<string, StepRecord> | null) ?? {},
      currentNodeIndex: row.current_node_index as number,
      resolvedSteps: row.resolved_steps
        ? (unpack(row.resolved_steps as Uint8Array | null) as string[])
        : undefined,
      signals: (unpack(row.signals as Uint8Array | null) as Record<string, unknown> | null) ?? {},
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }
}
