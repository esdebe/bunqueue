/**
 * SQLite schema and migrations
 */

/** SQLite PRAGMA settings for optimal performance */
export const PRAGMA_SETTINGS = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -64000;
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 268435456;
PRAGMA page_size = 4096;
`;

/** Main schema creation */
export const SCHEMA = `
-- Jobs table
CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY,
    queue TEXT NOT NULL,
    data TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    run_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    backoff INTEGER NOT NULL DEFAULT 1000,
    ttl INTEGER,
    timeout INTEGER,
    unique_key TEXT,
    custom_id TEXT,
    depends_on TEXT,
    parent_id INTEGER,
    children_ids TEXT,
    tags TEXT,
    state TEXT NOT NULL DEFAULT 'waiting',
    lifo INTEGER NOT NULL DEFAULT 0,
    group_id TEXT,
    progress INTEGER DEFAULT 0,
    progress_msg TEXT,
    remove_on_complete INTEGER DEFAULT 0,
    remove_on_fail INTEGER DEFAULT 0,
    stall_timeout INTEGER,
    last_heartbeat INTEGER
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_jobs_queue_state
    ON jobs(queue, state);
CREATE INDEX IF NOT EXISTS idx_jobs_run_at
    ON jobs(run_at) WHERE state IN ('waiting', 'delayed');
CREATE INDEX IF NOT EXISTS idx_jobs_unique
    ON jobs(queue, unique_key) WHERE unique_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_custom_id
    ON jobs(custom_id) WHERE custom_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_parent
    ON jobs(parent_id) WHERE parent_id IS NOT NULL;

-- Job results storage
CREATE TABLE IF NOT EXISTS job_results (
    job_id INTEGER PRIMARY KEY,
    result TEXT,
    completed_at INTEGER NOT NULL
);

-- Dead letter queue
CREATE TABLE IF NOT EXISTS dlq (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    queue TEXT NOT NULL,
    data TEXT NOT NULL,
    error TEXT,
    failed_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dlq_queue ON dlq(queue);
CREATE INDEX IF NOT EXISTS idx_dlq_job_id ON dlq(job_id);

-- Cron jobs
CREATE TABLE IF NOT EXISTS cron_jobs (
    name TEXT PRIMARY KEY,
    queue TEXT NOT NULL,
    data TEXT NOT NULL,
    schedule TEXT,
    repeat_every INTEGER,
    priority INTEGER NOT NULL DEFAULT 0,
    next_run INTEGER NOT NULL,
    executions INTEGER NOT NULL DEFAULT 0,
    max_limit INTEGER
);

-- Sequence for job IDs
CREATE TABLE IF NOT EXISTS sequences (
    name TEXT PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 0
);

-- Initialize job_id sequence
INSERT OR IGNORE INTO sequences (name, value) VALUES ('job_id', 0);

-- Queue state persistence (optional)
CREATE TABLE IF NOT EXISTS queue_state (
    name TEXT PRIMARY KEY,
    paused INTEGER NOT NULL DEFAULT 0,
    rate_limit INTEGER,
    concurrency_limit INTEGER
);
`;

/** Migration version table */
export const MIGRATION_TABLE = `
CREATE TABLE IF NOT EXISTS migrations (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
);
`;

/** Current schema version */
export const SCHEMA_VERSION = 1;

/** All migrations in order */
export const MIGRATIONS: Record<number, string> = {
  1: SCHEMA,
};
