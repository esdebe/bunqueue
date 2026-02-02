/**
 * Flow Job Factory
 * Creates simple Job objects for FlowProducer results
 */

import type { Job } from './types';

/** Extract user data (remove internal fields like __parentId, __childrenIds, name) */
export function extractUserDataFromInternal(data: Record<string, unknown>): unknown {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith('__') && key !== 'name') {
      result[key] = value;
    }
  }
  return result;
}

/** Create a simple Job object for flow results */
export function createFlowJobObject<T>(
  id: string,
  name: string,
  data: T,
  queueName: string
): Job<T> {
  const ts = Date.now();
  return {
    id,
    name,
    data,
    queueName,
    attemptsMade: 0,
    timestamp: ts,
    progress: 0,
    // BullMQ v5 properties
    delay: 0,
    processedOn: undefined,
    finishedOn: undefined,
    stacktrace: null,
    stalledCounter: 0,
    priority: 0,
    parentKey: undefined,
    opts: {},
    token: undefined,
    processedBy: undefined,
    deduplicationId: undefined,
    repeatJobKey: undefined,
    attemptsStarted: 0,
    // Methods - no-op implementations for flow results
    updateProgress: () => Promise.resolve(),
    log: () => Promise.resolve(),
    getState: () => Promise.resolve('waiting' as const),
    remove: () => Promise.resolve(),
    retry: () => Promise.resolve(),
    getChildrenValues: () => Promise.resolve({}),
    // BullMQ v5 state check methods
    isWaiting: () => Promise.resolve(true),
    isActive: () => Promise.resolve(false),
    isDelayed: () => Promise.resolve(false),
    isCompleted: () => Promise.resolve(false),
    isFailed: () => Promise.resolve(false),
    isWaitingChildren: () => Promise.resolve(false),
    // BullMQ v5 mutation methods
    updateData: () => Promise.resolve(),
    promote: () => Promise.resolve(),
    changeDelay: () => Promise.resolve(),
    changePriority: () => Promise.resolve(),
    extendLock: () => Promise.resolve(0),
    clearLogs: () => Promise.resolve(),
    // BullMQ v5 dependency methods
    getDependencies: () => Promise.resolve({ processed: {}, unprocessed: [] }),
    getDependenciesCount: () => Promise.resolve({ processed: 0, unprocessed: 0 }),
    // BullMQ v5 serialization methods
    toJSON: () => ({
      id,
      name,
      data,
      opts: {},
      progress: 0,
      delay: 0,
      timestamp: ts,
      attemptsMade: 0,
      stacktrace: null,
      queueQualifiedName: `bull:${queueName}`,
    }),
    asJSON: () => ({
      id,
      name,
      data: JSON.stringify(data),
      opts: '{}',
      progress: '0',
      delay: '0',
      timestamp: String(ts),
      attemptsMade: '0',
      stacktrace: null,
    }),
    // BullMQ v5 move methods
    moveToCompleted: () => Promise.resolve(null),
    moveToFailed: () => Promise.resolve(),
    moveToWait: () => Promise.resolve(false),
    moveToDelayed: () => Promise.resolve(),
    moveToWaitingChildren: () => Promise.resolve(false),
    waitUntilFinished: () => Promise.resolve(undefined),
    // BullMQ v5 additional methods
    discard: () => {},
    getFailedChildrenValues: () => Promise.resolve({}),
    getIgnoredChildrenFailures: () => Promise.resolve({}),
    removeChildDependency: () => Promise.resolve(false),
    removeDeduplicationKey: () => Promise.resolve(false),
    removeUnprocessedChildren: () => Promise.resolve(),
  };
}
