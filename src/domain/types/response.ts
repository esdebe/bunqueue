/**
 * Protocol responses
 * All response types for TCP/HTTP protocol
 */

import type { Job, JobId, JobState } from './job';

/** Base response interface */
interface BaseResponse {
  readonly ok: boolean;
  readonly reqId?: string;
}

/** Success response with job ID */
export interface OkResponse extends BaseResponse {
  readonly ok: true;
  readonly id?: string;
}

/** Batch success response */
export interface BatchResponse extends BaseResponse {
  readonly ok: true;
  readonly ids: string[];
}

/** Single job response */
export interface JobResponse extends BaseResponse {
  readonly ok: true;
  readonly job: Job;
}

/** Nullable job response (for pull with timeout) */
export interface NullableJobResponse extends BaseResponse {
  readonly ok: true;
  readonly job: Job | null;
}

/** Multiple jobs response */
export interface JobsResponse extends BaseResponse {
  readonly ok: true;
  readonly jobs: Job[];
}

/** Job state response */
export interface StateResponse extends BaseResponse {
  readonly ok: true;
  readonly id: string;
  readonly state: JobState;
}

/** Job result response */
export interface ResultResponse extends BaseResponse {
  readonly ok: true;
  readonly id: string;
  readonly result: unknown;
}

/** Job counts by state */
export interface JobCounts {
  readonly waiting: number;
  readonly delayed: number;
  readonly active: number;
  readonly completed: number;
  readonly failed: number;
}

/** Job counts response */
export interface JobCountsResponse extends BaseResponse {
  readonly ok: true;
  readonly counts: JobCounts;
}

/** Queue info */
export interface QueueInfo {
  readonly name: string;
  readonly waiting: number;
  readonly delayed: number;
  readonly active: number;
  readonly paused: boolean;
}

/** Queue list response */
export interface QueuesResponse extends BaseResponse {
  readonly ok: true;
  readonly queues: QueueInfo[];
}

/** Progress response */
export interface ProgressResponse extends BaseResponse {
  readonly ok: true;
  readonly progress: number;
  readonly message: string | null;
}

/** Boolean response */
export interface BoolResponse extends BaseResponse {
  readonly ok: true;
  readonly value: boolean;
}

/** Count response */
export interface CountResponse extends BaseResponse {
  readonly ok: true;
  readonly count: number;
}

/** Stats response */
export interface StatsData {
  readonly queued: number;
  readonly processing: number;
  readonly delayed: number;
  readonly dlq: number;
  readonly completed: number;
  readonly uptime: number;
  readonly pushPerSec: number;
  readonly pullPerSec: number;
}

export interface StatsResponse extends BaseResponse {
  readonly ok: true;
  readonly stats: StatsData;
}

/** Metrics response */
export interface MetricsData {
  readonly totalPushed: number;
  readonly totalPulled: number;
  readonly totalCompleted: number;
  readonly totalFailed: number;
  readonly avgLatencyMs: number;
  readonly avgProcessingMs: number;
  readonly memoryUsageMb: number;
  readonly sqliteSizeMb: number;
  readonly activeConnections: number;
}

export interface MetricsResponse extends BaseResponse {
  readonly ok: true;
  readonly metrics: MetricsData;
}

/** Cron job info */
export interface CronInfo {
  readonly name: string;
  readonly queue: string;
  readonly schedule: string | null;
  readonly repeatEvery: number | null;
  readonly nextRun: number;
  readonly executions: number;
}

/** Cron list response */
export interface CronListResponse extends BaseResponse {
  readonly ok: true;
  readonly crons: CronInfo[];
}

/** Error response */
export interface ErrorResponse extends BaseResponse {
  readonly ok: false;
  readonly error: string;
}

/** Union of all responses */
export type Response =
  | OkResponse
  | BatchResponse
  | JobResponse
  | NullableJobResponse
  | JobsResponse
  | StateResponse
  | ResultResponse
  | JobCountsResponse
  | QueuesResponse
  | ProgressResponse
  | BoolResponse
  | CountResponse
  | StatsResponse
  | MetricsResponse
  | CronListResponse
  | ErrorResponse
  | DataResponse<unknown>;

// ============ Response Builders ============

export function ok(id?: bigint, reqId?: string): OkResponse {
  return {
    ok: true,
    id: id?.toString(),
    reqId,
  };
}

export function batch(ids: bigint[], reqId?: string): BatchResponse {
  return {
    ok: true,
    ids: ids.map((id) => id.toString()),
    reqId,
  };
}

export function job(j: Job, reqId?: string): JobResponse {
  return {
    ok: true,
    job: serializeJobForResponse(j),
    reqId,
  } as JobResponse;
}

export function nullableJob(j: Job | null, reqId?: string): NullableJobResponse {
  return {
    ok: true,
    job: j ? serializeJobForResponse(j) : null,
    reqId,
  } as NullableJobResponse;
}

export function jobs(list: Job[], reqId?: string): JobsResponse {
  return {
    ok: true,
    jobs: list.map(serializeJobForResponse),
    reqId,
  } as JobsResponse;
}

/** Serialize job for JSON response (convert BigInt to string) */
function serializeJobForResponse(j: Job): Job {
  return {
    ...j,
    id: j.id.toString() as unknown as JobId,
    dependsOn: j.dependsOn.map((id) => id.toString() as unknown as JobId),
    parentId: j.parentId ? (j.parentId.toString() as unknown as JobId) : null,
    childrenIds: j.childrenIds.map((id) => id.toString() as unknown as JobId),
  };
}

export function error(message: string, reqId?: string): ErrorResponse {
  return {
    ok: false,
    error: message,
    reqId,
  };
}

/** Generic success response with data payload */
export interface DataResponse<T> extends BaseResponse {
  readonly ok: true;
  readonly data: T;
}

export function data<T>(payload: T, reqId?: string): DataResponse<T> {
  return {
    ok: true,
    data: payload,
    reqId,
  };
}

export function counts(c: JobCounts, reqId?: string): JobCountsResponse {
  return {
    ok: true,
    counts: c,
    reqId,
  };
}

export function stats(s: StatsData, reqId?: string): StatsResponse {
  return {
    ok: true,
    stats: s,
    reqId,
  };
}

export function metrics(m: MetricsData, reqId?: string): MetricsResponse {
  return {
    ok: true,
    metrics: m,
    reqId,
  };
}
