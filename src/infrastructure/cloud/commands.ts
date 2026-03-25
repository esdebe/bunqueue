/**
 * Cloud Command Definitions
 * Whitelisted commands that the dashboard can execute via WebSocket.
 */

import type { QueueManager } from '../../application/queueManager';
import type { Job } from '../../domain/types/job';
import { jobId } from '../../domain/types/job';
import type { CloudCommand } from './commandHandler';

type Handler = (qm: QueueManager, cmd: CloudCommand) => unknown;

/** Helper: derive job state from timestamps */
function deriveState(j: {
  completedAt?: number | null;
  startedAt?: number | null;
  runAt: number;
}): string {
  if (j.completedAt) return 'completed';
  if (j.startedAt) return 'active';
  if (j.runAt > Date.now()) return 'delayed';
  return 'waiting';
}

/** Helper: map job to API response format */
function mapJob(j: Job) {
  const data = j.data as Record<string, unknown> | undefined;
  return {
    id: String(j.id),
    name: (data?.name as string | undefined) ?? 'default',
    queue: j.queue,
    state: deriveState(j),
    data,
    priority: j.priority,
    createdAt: j.createdAt,
    startedAt: j.startedAt ?? null,
    completedAt: j.completedAt ?? null,
    attempts: j.attempts,
    maxAttempts: j.maxAttempts,
    progress: j.progress,
    duration: j.completedAt && j.startedAt ? j.completedAt - j.startedAt : null,
  };
}

/** All whitelisted commands */
export const COMMANDS: Partial<Record<string, Handler>> = {
  // --- Queue control ---
  'queue:pause': (qm, cmd) => {
    qm.pause(cmd.queue ?? '');
    return { queue: cmd.queue, paused: true };
  },
  'queue:resume': (qm, cmd) => {
    qm.resume(cmd.queue ?? '');
    return { queue: cmd.queue, paused: false };
  },
  'queue:drain': (qm, cmd) => {
    const count = qm.drain(cmd.queue ?? '');
    return { queue: cmd.queue, drained: count };
  },
  'queue:clean': (qm, cmd) => {
    const count = qm.clean(cmd.queue ?? '', cmd.graceMs ?? 0, cmd.state, cmd.limit);
    return { queue: cmd.queue, cleaned: count };
  },
  'queue:obliterate': (qm, cmd) => {
    qm.obliterate(cmd.queue ?? '');
    return { queue: cmd.queue, obliterated: true };
  },
  'queue:promoteAll': async (qm, cmd) => {
    const limit = cmd.limit ?? 1000;
    const jobs = qm.getJobs(cmd.queue ?? '', { state: ['delayed'], start: 0, end: limit - 1 });
    let promoted = 0;
    for (const j of jobs) {
      try {
        await qm.promote(j.id);
        promoted++;
      } catch {
        // skip
      }
    }
    return { queue: cmd.queue, promoted };
  },
  'queue:retryCompleted': (qm, cmd) => {
    const count = qm.retryCompleted(cmd.queue ?? '');
    return { queue: cmd.queue, retried: count };
  },

  // --- Queue config ---
  'queue:rateLimit': (qm, cmd) => {
    qm.setRateLimit(cmd.queue ?? '', cmd.max ?? 100);
    return { queue: cmd.queue, rateLimit: cmd.max ?? 100 };
  },
  'queue:clearRateLimit': (qm, cmd) => {
    qm.clearRateLimit(cmd.queue ?? '');
    return { queue: cmd.queue, rateLimit: null };
  },
  'queue:concurrency': (qm, cmd) => {
    qm.setConcurrency(cmd.queue ?? '', cmd.concurrency ?? 10);
    return { queue: cmd.queue, concurrency: cmd.concurrency ?? 10 };
  },
  'queue:clearConcurrency': (qm, cmd) => {
    qm.clearConcurrency(cmd.queue ?? '');
    return { queue: cmd.queue, concurrency: null };
  },
  'queue:stallConfig': (qm, cmd) => {
    qm.setStallConfig(cmd.queue ?? '', cmd.config ?? {});
    return { queue: cmd.queue, stallConfig: cmd.config };
  },
  'queue:dlqConfig': (qm, cmd) => {
    qm.setDlqConfig(cmd.queue ?? '', cmd.config ?? {});
    return { queue: cmd.queue, dlqConfig: cmd.config };
  },

  // --- Queue detail ---
  'queue:detail': (qm, cmd) => {
    const queue = cmd.queue ?? '';
    const counts = qm.getQueueJobCounts(queue);
    const paused = qm.isPaused(queue);
    const stallConfig = qm.getStallConfig(queue);
    const dlqConfig = qm.getDlqConfig(queue);
    const dlqEntries = qm.getDlqEntries(queue).slice(0, 50);
    const jobs = qm.getJobs(queue, {
      state: ['waiting', 'active', 'delayed', 'completed', 'failed'],
      start: 0,
      end: 49,
    });
    return {
      queue,
      paused,
      counts,
      stallConfig: {
        enabled: stallConfig.enabled,
        stallInterval: stallConfig.stallInterval,
        maxStalls: stallConfig.maxStalls,
      },
      dlqConfig: { maxRetries: dlqConfig.maxAutoRetries, maxAge: dlqConfig.maxAge ?? 0 },
      dlqEntries: dlqEntries.map((e) => ({
        jobId: String(e.job.id),
        reason: e.reason,
        error: e.error,
        enteredAt: e.enteredAt,
        retryCount: e.retryCount,
      })),
      jobs: jobs.map(mapJob),
    };
  },

  // --- Job operations ---
  'job:cancel': async (qm, cmd) => {
    const ok = await qm.cancel(jobId(cmd.jobId ?? ''));
    return { cancelled: ok };
  },
  'job:promote': async (qm, cmd) => {
    const ok = await qm.promote(jobId(cmd.jobId ?? ''));
    return { promoted: ok };
  },
  'job:push': async (qm, cmd) => {
    const job = await qm.push(cmd.queue ?? '', {
      data: cmd.data ?? {},
      priority: cmd.priority,
      delay: cmd.delay,
    });
    return { jobId: String(job.id), queue: cmd.queue };
  },
  'job:priority': async (qm, cmd) => {
    const ok = await qm.changePriority(jobId(cmd.jobId ?? ''), cmd.priority ?? 0);
    return { changed: ok };
  },
  'job:discard': async (qm, cmd) => {
    const ok = await qm.discard(jobId(cmd.jobId ?? ''));
    return { discarded: ok };
  },
  'job:delay': async (qm, cmd) => {
    await qm.changeDelay(jobId(cmd.jobId ?? ''), cmd.delay ?? 0);
    return { delayed: true };
  },
  'job:updateData': async (qm, cmd) => {
    const ok = await qm.updateJobData(jobId(cmd.jobId ?? ''), cmd.data);
    return { updated: ok };
  },
  'job:clearLogs': (qm, cmd) => {
    qm.clearLogs(jobId(cmd.jobId ?? ''), cmd.keepLogs);
    return { cleared: true };
  },

  // --- Job queries ---
  'job:retry': (qm, cmd) => {
    if (cmd.queue) {
      const count = qm.retryDlq(cmd.queue, cmd.jobId ? jobId(cmd.jobId) : undefined);
      return { retried: count };
    }
    return { retried: 0 };
  },
  'job:logs': (qm, cmd) => {
    const logs = qm.getLogs(jobId(cmd.jobId ?? ''));
    return { logs };
  },
  'job:result': (qm, cmd) => {
    const result = qm.getResult(jobId(cmd.jobId ?? ''));
    return { result: result ?? null };
  },
  'job:list': (qm, cmd) => {
    const limit = cmd.limit ?? 50;
    const offset = cmd.offset ?? 0;
    const states = cmd.state
      ? cmd.state.split(',')
      : ['waiting', 'active', 'delayed', 'completed', 'failed'];
    const jobs = qm.getJobs(cmd.queue ?? '', {
      state: states,
      start: offset,
      end: offset + limit - 1,
    });
    return { jobs: jobs.map(mapJob), total: qm.count(cmd.queue ?? ''), offset, limit };
  },
  'job:get': async (qm, cmd) => {
    const job = await qm.getJob(jobId(cmd.jobId ?? ''));
    if (!job) return { job: null };
    const mapped = mapJob(job);
    return {
      job: {
        ...mapped,
        logs: qm.getLogs(jobId(cmd.jobId ?? '')),
        result: qm.getResult(jobId(cmd.jobId ?? '')) ?? null,
      },
    };
  },

  // --- DLQ ---
  'dlq:retry': (qm, cmd) => {
    const count = qm.retryDlq(cmd.queue ?? '', cmd.jobId ? jobId(cmd.jobId) : undefined);
    return { retried: count };
  },
  'dlq:purge': (qm, cmd) => {
    const count = qm.purgeDlq(cmd.queue ?? '');
    return { purged: count };
  },

  // --- Cron ---
  'cron:upsert': (qm, cmd) => {
    qm.removeCron(cmd.name ?? '');
    const cron = qm.addCron({
      name: cmd.name ?? '',
      queue: cmd.queue ?? '',
      data: cmd.data ?? {},
      schedule: cmd.schedule,
    });
    return { name: cron.name, nextRun: cron.nextRun };
  },
  'cron:delete': (qm, cmd) => {
    const ok = qm.removeCron(cmd.name ?? '');
    return { deleted: ok };
  },

  // --- Webhooks ---
  'webhook:add': (qm, cmd) => {
    const wh = qm.webhookManager.add(
      cmd.url ?? '',
      cmd.events ?? [],
      cmd.queue ?? undefined,
      cmd.secret ?? undefined
    );
    return { id: wh.id, url: wh.url, events: wh.events };
  },
  'webhook:remove': (qm, cmd) => {
    const ok = qm.webhookManager.remove(cmd.webhookId ?? '');
    return { removed: ok };
  },
  'webhook:set-enabled': (qm, cmd) => {
    const ok = qm.webhookManager.setEnabled(cmd.webhookId ?? '', cmd.enabled ?? true);
    return { updated: ok };
  },

  // --- Stats & backup ---
  'stats:refresh': (qm) => {
    return qm.getStats();
  },
  's3:backup': async (qm) => {
    const handles = (qm as unknown as Record<string, unknown>).serverHandles as
      | { triggerBackup?: () => Promise<unknown> }
      | undefined;
    if (handles?.triggerBackup) {
      return await handles.triggerBackup();
    }
    return { error: 'S3 backup not configured' };
  },
};
