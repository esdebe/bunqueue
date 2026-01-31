/**
 * SQLite Serialization Utilities
 * MessagePack encoding/decoding and row conversion
 */

import { encode, decode } from '@msgpack/msgpack';
import { type Job, jobId } from '../../domain/types/job';
import type { DlqEntry } from '../../domain/types/dlq';
import type { DbJob } from './statements';
import { storageLog } from '../../shared/logger';

/** Encode data to MessagePack buffer */
export function pack(data: unknown): Uint8Array {
  return encode(data);
}

/** Decode MessagePack buffer to data */
export function unpack<T>(buffer: Uint8Array | null, fallback: T, context: string): T {
  if (!buffer) return fallback;
  try {
    return decode(buffer) as T;
  } catch (err) {
    storageLog.error('MessagePack decode error', { context, error: String(err) });
    return fallback;
  }
}

/** Convert database row to Job object */
export function rowToJob(row: DbJob): Job {
  const jobContext = `rowToJob:${row.id}`;
  const dependsOn: string[] = row.depends_on
    ? unpack<string[]>(row.depends_on, [], `${jobContext}:dependsOn`)
    : [];
  const childrenIds: string[] = row.children_ids
    ? unpack<string[]>(row.children_ids, [], `${jobContext}:childrenIds`)
    : [];
  const tags: string[] = row.tags ? unpack<string[]>(row.tags, [], `${jobContext}:tags`) : [];

  return {
    id: jobId(row.id),
    queue: row.queue,
    data: unpack(row.data, {}, `${jobContext}:data`),
    priority: row.priority,
    createdAt: row.created_at,
    runAt: row.run_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    backoff: row.backoff,
    ttl: row.ttl,
    timeout: row.timeout,
    uniqueKey: row.unique_key,
    customId: row.custom_id,
    dependsOn: dependsOn.map((s) => jobId(s)),
    parentId: row.parent_id ? jobId(row.parent_id) : null,
    childrenIds: childrenIds.map((s) => jobId(s)),
    childrenCompleted: 0,
    tags,
    lifo: row.lifo === 1,
    groupId: row.group_id,
    progress: row.progress ?? 0,
    progressMessage: row.progress_msg,
    removeOnComplete: row.remove_on_complete === 1,
    removeOnFail: row.remove_on_fail === 1,
    repeat: null,
    lastHeartbeat: row.last_heartbeat ?? row.created_at,
    stallTimeout: row.stall_timeout,
    stallCount: 0,
  };
}

/** Reconstruct DlqEntry from MessagePack-decoded data */
export function reconstructDlqEntry(entry: DlqEntry): DlqEntry {
  return {
    ...entry,
    job: {
      ...entry.job,
      id: jobId(String(entry.job.id)),
      dependsOn: entry.job.dependsOn.map((id) => jobId(String(id))),
      parentId: entry.job.parentId ? jobId(String(entry.job.parentId)) : null,
      childrenIds: entry.job.childrenIds.map((id) => jobId(String(id))),
    },
  };
}
