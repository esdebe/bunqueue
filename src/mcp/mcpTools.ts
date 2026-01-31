/**
 * MCP Tool Definitions
 * Tool schemas for the bunqueue MCP server
 */

export interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const TOOLS: Tool[] = [
  // Job Operations
  {
    name: 'bunqueue_add_job',
    description: 'Add a job to a queue. Returns the job ID.',
    inputSchema: {
      type: 'object',
      properties: {
        queue: { type: 'string', description: 'Queue name' },
        name: { type: 'string', description: 'Job name/type' },
        data: { type: 'object', description: 'Job payload data' },
        priority: { type: 'number', description: 'Priority (higher = processed first)' },
        delay: { type: 'number', description: 'Delay in milliseconds before processing' },
        attempts: { type: 'number', description: 'Max retry attempts (default: 3)' },
      },
      required: ['queue', 'name', 'data'],
    },
  },
  {
    name: 'bunqueue_add_jobs_bulk',
    description: 'Add multiple jobs to a queue in a single operation.',
    inputSchema: {
      type: 'object',
      properties: {
        queue: { type: 'string', description: 'Queue name' },
        jobs: {
          type: 'array',
          description: 'Array of jobs to add',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              data: { type: 'object' },
              priority: { type: 'number' },
              delay: { type: 'number' },
            },
          },
        },
      },
      required: ['queue', 'jobs'],
    },
  },
  {
    name: 'bunqueue_get_job',
    description: 'Get a job by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Job ID' },
      },
      required: ['jobId'],
    },
  },
  {
    name: 'bunqueue_cancel_job',
    description: 'Cancel a waiting or delayed job.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Job ID to cancel' },
      },
      required: ['jobId'],
    },
  },
  {
    name: 'bunqueue_update_progress',
    description: 'Update job progress (0-100).',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Job ID' },
        progress: { type: 'number', description: 'Progress value (0-100)' },
        message: { type: 'string', description: 'Optional progress message' },
      },
      required: ['jobId', 'progress'],
    },
  },
  // Queue Control
  {
    name: 'bunqueue_pause_queue',
    description: 'Pause job processing on a queue.',
    inputSchema: {
      type: 'object',
      properties: {
        queue: { type: 'string', description: 'Queue name' },
      },
      required: ['queue'],
    },
  },
  {
    name: 'bunqueue_resume_queue',
    description: 'Resume job processing on a paused queue.',
    inputSchema: {
      type: 'object',
      properties: {
        queue: { type: 'string', description: 'Queue name' },
      },
      required: ['queue'],
    },
  },
  {
    name: 'bunqueue_drain_queue',
    description: 'Remove all waiting jobs from a queue.',
    inputSchema: {
      type: 'object',
      properties: {
        queue: { type: 'string', description: 'Queue name' },
      },
      required: ['queue'],
    },
  },
  {
    name: 'bunqueue_obliterate_queue',
    description: 'Remove ALL data from a queue (waiting, active, completed, failed).',
    inputSchema: {
      type: 'object',
      properties: {
        queue: { type: 'string', description: 'Queue name' },
      },
      required: ['queue'],
    },
  },
  {
    name: 'bunqueue_list_queues',
    description: 'List all queues.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'bunqueue_count_jobs',
    description: 'Count jobs in a queue.',
    inputSchema: {
      type: 'object',
      properties: {
        queue: { type: 'string', description: 'Queue name' },
      },
      required: ['queue'],
    },
  },
  // Rate Limiting
  {
    name: 'bunqueue_set_rate_limit',
    description: 'Set rate limit for a queue (jobs per second).',
    inputSchema: {
      type: 'object',
      properties: {
        queue: { type: 'string', description: 'Queue name' },
        limit: { type: 'number', description: 'Max jobs per second' },
      },
      required: ['queue', 'limit'],
    },
  },
  {
    name: 'bunqueue_set_concurrency',
    description: 'Set concurrency limit for a queue.',
    inputSchema: {
      type: 'object',
      properties: {
        queue: { type: 'string', description: 'Queue name' },
        limit: { type: 'number', description: 'Max concurrent jobs' },
      },
      required: ['queue', 'limit'],
    },
  },
  // DLQ Operations
  {
    name: 'bunqueue_get_dlq',
    description: 'Get Dead Letter Queue entries for a queue.',
    inputSchema: {
      type: 'object',
      properties: {
        queue: { type: 'string', description: 'Queue name' },
        limit: { type: 'number', description: 'Max entries to return (default: 20)' },
      },
      required: ['queue'],
    },
  },
  {
    name: 'bunqueue_retry_dlq',
    description: 'Retry jobs from the Dead Letter Queue.',
    inputSchema: {
      type: 'object',
      properties: {
        queue: { type: 'string', description: 'Queue name' },
        jobId: { type: 'string', description: 'Specific job ID to retry (optional)' },
      },
      required: ['queue'],
    },
  },
  {
    name: 'bunqueue_purge_dlq',
    description: 'Remove all entries from the Dead Letter Queue.',
    inputSchema: {
      type: 'object',
      properties: {
        queue: { type: 'string', description: 'Queue name' },
      },
      required: ['queue'],
    },
  },
  // Cron Jobs
  {
    name: 'bunqueue_add_cron',
    description: 'Add a recurring cron job.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Unique cron job name' },
        queue: { type: 'string', description: 'Target queue name' },
        data: { type: 'object', description: 'Job payload data' },
        schedule: { type: 'string', description: 'Cron pattern (e.g., "0 * * * *" for hourly)' },
        repeatEvery: { type: 'number', description: 'Alternative: repeat every N milliseconds' },
        priority: { type: 'number', description: 'Job priority' },
      },
      required: ['name', 'queue', 'data'],
    },
  },
  {
    name: 'bunqueue_list_crons',
    description: 'List all scheduled cron jobs.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'bunqueue_delete_cron',
    description: 'Delete a cron job by name.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Cron job name to delete' },
      },
      required: ['name'],
    },
  },
  // Stats & Logs
  {
    name: 'bunqueue_get_stats',
    description: 'Get overall queue statistics.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'bunqueue_get_job_logs',
    description: 'Get logs for a specific job.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Job ID' },
      },
      required: ['jobId'],
    },
  },
  {
    name: 'bunqueue_add_job_log',
    description: 'Add a log entry to a job.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Job ID' },
        message: { type: 'string', description: 'Log message' },
        level: { type: 'string', enum: ['info', 'warn', 'error'], description: 'Log level' },
      },
      required: ['jobId', 'message'],
    },
  },
];
