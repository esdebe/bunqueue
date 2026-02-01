# BullMQ v5 Compatibility Report

Documento di confronto tra BullMQ v5 e bunqueue per raggiungere la piena compatibilità API.

## Indice

- [Queue Class](#queue-class)
- [Worker Class](#worker-class)
- [Job Class](#job-class)
- [JobOptions](#joboptions)
- [FlowProducer](#flowproducer)
- [QueueEvents](#queueevents)
- [Riepilogo Implementazione](#riepilogo-implementazione)

---

## Queue Class

### Metodi Implementati ✅

| Metodo | Firma | Note |
|--------|-------|------|
| `add(name, data, opts?)` | `add(name: string, data: T, opts?: JobOptions): Promise<Job<T>>` | Identico a BullMQ |
| `addBulk(jobs)` | `addBulk(jobs: {name, data, opts?}[]): Promise<Job<T>[]>` | Identico a BullMQ |
| `getJob(id)` | `getJob(id: string): Promise<Job<T> \| null>` | Identico a BullMQ |
| `getJobs(options)` | `getJobsAsync(options): Promise<Job<T>[]>` | Versione async |
| `getJobCounts()` | `getJobCountsAsync(): Promise<{waiting, active, completed, failed}>` | Versione async |
| `getCountsPerPriority()` | `getCountsPerPriorityAsync(): Promise<Record<number, number>>` | Versione async |
| `remove(id)` | `remove(id: string): void` | Identico a BullMQ |
| `pause()` | `pause(): void` | Identico a BullMQ |
| `resume()` | `resume(): void` | Identico a BullMQ |
| `drain()` | `drain(): void` | Identico a BullMQ |
| `obliterate()` | `obliterate(): void` | Identico a BullMQ |
| `close()` | `close(): void` | Identico a BullMQ |

### Metodi Extra bunqueue ✅

| Metodo | Firma | Descrizione |
|--------|-------|-------------|
| `setStallConfig(config)` | `setStallConfig(config: Partial<StallConfig>): void` | Configura stall detection |
| `getStallConfig()` | `getStallConfig(): StallConfig` | Ottiene config stall |
| `setDlqConfig(config)` | `setDlqConfig(config: Partial<DlqConfig>): void` | Configura DLQ |
| `getDlqConfig()` | `getDlqConfig(): DlqConfig` | Ottiene config DLQ |
| `getDlq(filter?)` | `getDlq(filter?: DlqFilter): DlqEntry<T>[]` | Lista entry DLQ |
| `getDlqStats()` | `getDlqStats(): DlqStats` | Statistiche DLQ |
| `retryDlq(id?)` | `retryDlq(id?: string): number` | Riprova job da DLQ |
| `retryDlqByFilter(filter)` | `retryDlqByFilter(filter: DlqFilter): number` | Riprova con filtro |
| `purgeDlq()` | `purgeDlq(): number` | Svuota DLQ |
| `retryCompleted(id?)` | `retryCompletedAsync(id?: string): Promise<number>` | Riprova job completati |

### Metodi Da Implementare 🔴

| Metodo | Firma BullMQ v5 | Priorità | Complessità |
|--------|-----------------|----------|-------------|
| `count()` | `count(): Promise<number>` | Media | Bassa |
| `isPaused()` | `isPaused(): Promise<boolean>` | Bassa | Bassa |
| `getJobState(jobId)` | `getJobState(jobId: string): Promise<'waiting' \| 'active' \| 'completed' \| 'failed' \| 'delayed' \| 'unknown'>` | **Alta** | Bassa |
| `getJobLogs(jobId, start?, end?, asc?)` | `getJobLogs(jobId: string, start?: number, end?: number, asc?: boolean): Promise<{logs: string[], count: number}>` | Media | Media |
| `addJobLog(jobId, logRow, keepLogs?)` | `addJobLog(jobId: string, logRow: string, keepLogs?: number): Promise<number>` | Media | Bassa |
| `updateJobProgress(jobId, progress)` | `updateJobProgress(jobId: string, progress: number \| object): Promise<void>` | Media | Bassa |
| `clean(grace, limit, type?)` | `clean(grace: number, limit: number, type?: 'completed' \| 'wait' \| 'active' \| 'paused' \| 'delayed' \| 'failed'): Promise<string[]>` | **Alta** | Media |
| `retryJobs(opts?)` | `retryJobs(opts?: {count?: number, state?: 'completed' \| 'failed', timestamp?: number}): Promise<void>` | **Alta** | Media |
| `promoteJobs(opts?)` | `promoteJobs(opts?: {count?: number}): Promise<void>` | Media | Bassa |
| `trimEvents(maxLength)` | `trimEvents(maxLength: number): Promise<number>` | Bassa | Bassa |
| `getActive(start?, end?)` | `getActive(start?: number, end?: number): Promise<Job[]>` | Bassa | Bassa |
| `getCompleted(start?, end?)` | `getCompleted(start?: number, end?: number): Promise<Job[]>` | Bassa | Bassa |
| `getFailed(start?, end?)` | `getFailed(start?: number, end?: number): Promise<Job[]>` | Bassa | Bassa |
| `getDelayed(start?, end?)` | `getDelayed(start?: number, end?: number): Promise<Job[]>` | Bassa | Bassa |
| `getWaiting(start?, end?)` | `getWaiting(start?: number, end?: number): Promise<Job[]>` | Bassa | Bassa |
| `getPrioritized(start?, end?)` | `getPrioritized(start?: number, end?: number): Promise<Job[]>` | Bassa | Bassa |
| `getWaitingChildren(start?, end?)` | `getWaitingChildren(start?: number, end?: number): Promise<Job[]>` | Media | Media |
| `getActiveCount()` | `getActiveCount(): Promise<number>` | Bassa | Bassa |
| `getCompletedCount()` | `getCompletedCount(): Promise<number>` | Bassa | Bassa |
| `getFailedCount()` | `getFailedCount(): Promise<number>` | Bassa | Bassa |
| `getDelayedCount()` | `getDelayedCount(): Promise<number>` | Bassa | Bassa |
| `getWaitingCount()` | `getWaitingCount(): Promise<number>` | Bassa | Bassa |
| `getWaitingChildrenCount()` | `getWaitingChildrenCount(): Promise<number>` | Media | Bassa |
| `getPrioritizedCount()` | `getPrioritizedCount(): Promise<number>` | Bassa | Bassa |
| `getDependencies(parentId, type, start, end)` | `getDependencies(parentId: string, type: 'processed' \| 'unprocessed', start: number, end: number): Promise<{nextProcessedCursor, nextUnprocessedCursor, processed, unprocessed}>` | Media | Alta |
| `setGlobalConcurrency(concurrency)` | `setGlobalConcurrency(concurrency: number): Promise<void>` | **Alta** | Media |
| `removeGlobalConcurrency()` | `removeGlobalConcurrency(): Promise<void>` | Media | Bassa |
| `getGlobalConcurrency()` | `getGlobalConcurrency(): Promise<number \| null>` | Bassa | Bassa |
| `setGlobalRateLimit(max, duration)` | `setGlobalRateLimit(max: number, duration: number): Promise<void>` | **Alta** | Media |
| `removeGlobalRateLimit()` | `removeGlobalRateLimit(): Promise<void>` | Media | Bassa |
| `getGlobalRateLimit()` | `getGlobalRateLimit(): Promise<{max: number, duration: number} \| null>` | Bassa | Bassa |
| `getRateLimitTtl(maxJobs?)` | `getRateLimitTtl(maxJobs?: number): Promise<number>` | Bassa | Bassa |
| `rateLimit(expireTimeMs)` | `rateLimit(expireTimeMs: number): Promise<void>` | Media | Bassa |
| `isMaxed()` | `isMaxed(): Promise<boolean>` | Bassa | Bassa |
| `upsertJobScheduler(id, repeatOpts, template?)` | `upsertJobScheduler(id: string, repeatOpts: RepeatOptions, jobTemplate?: {name?, data?, opts?}): Promise<JobScheduler>` | **Alta** | Alta |
| `removeJobScheduler(id)` | `removeJobScheduler(id: string): Promise<boolean>` | Media | Bassa |
| `getJobScheduler(id)` | `getJobScheduler(id: string): Promise<JobScheduler \| null>` | Media | Bassa |
| `getJobSchedulers(start?, end?, asc?)` | `getJobSchedulers(start?: number, end?: number, asc?: boolean): Promise<JobScheduler[]>` | Media | Bassa |
| `getJobSchedulersCount()` | `getJobSchedulersCount(): Promise<number>` | Bassa | Bassa |
| `getDeduplicationJobId(id)` | `getDeduplicationJobId(id: string): Promise<string \| null>` | Media | Media |
| `removeDeduplicationKey(id)` | `removeDeduplicationKey(id: string): Promise<number>` | Media | Bassa |
| `getMetrics(type, start?, end?)` | `getMetrics(type: 'completed' \| 'failed', start?: number, end?: number): Promise<Metrics>` | Media | Media |
| `getWorkers()` | `getWorkers(): Promise<{id: string, name: string, addr: string, ...}[]>` | Media | Media |
| `getWorkersCount()` | `getWorkersCount(): Promise<number>` | Bassa | Bassa |
| `waitUntilReady()` | `waitUntilReady(): Promise<RedisClient>` | Bassa | Bassa |
| `disconnect()` | `disconnect(): Promise<void>` | Bassa | Bassa |

---

## Worker Class

### Metodi/Opzioni Implementati ✅

| Metodo/Opzione | Firma | Note |
|----------------|-------|------|
| `constructor(name, processor, opts?)` | `new Worker(name: string, processor: Processor, opts?: WorkerOptions)` | Identico |
| `run()` | `run(): void` | Identico |
| `pause()` | `pause(): void` | Identico |
| `resume()` | `resume(): void` | Identico |
| `close(force?)` | `close(force?: boolean): Promise<void>` | Identico |
| **Opzione:** `concurrency` | `number` (default: 1) | Identico |
| **Opzione:** `autorun` | `boolean` (default: true) | Identico |
| **Opzione:** `heartbeatInterval` | `number` (default: 10000) | Equivalente a `stalledInterval` |
| **Opzione:** `batchSize` | `number` (default: 10, max: 1000) | Extra bunqueue |
| **Opzione:** `pollTimeout` | `number` (default: 0, max: 30000) | Extra bunqueue |
| **Opzione:** `useLocks` | `boolean` (default: true) | Extra bunqueue |
| **Evento:** `completed` | `(job: Job, result: R) => void` | Identico |
| **Evento:** `failed` | `(job: Job \| undefined, error: Error) => void` | Identico |
| **Evento:** `progress` | `(job: Job, progress: number) => void` | Identico |
| **Evento:** `error` | `(error: Error) => void` | Identico |
| **Evento:** `ready` | `() => void` | Identico |
| **Evento:** `closed` | `() => void` | Identico |

### Metodi/Opzioni Da Implementare 🔴

| Metodo/Opzione | Firma BullMQ v5 | Priorità | Complessità |
|----------------|-----------------|----------|-------------|
| `isRunning()` | `isRunning(): boolean` | Media | Bassa |
| `isPaused()` | `isPaused(): boolean` | Media | Bassa |
| `isClosed()` | `isClosed(): boolean` | Bassa | Bassa |
| `waitUntilReady()` | `waitUntilReady(): Promise<void>` | Bassa | Bassa |
| `getNextJob(token, opts?)` | `getNextJob(token: string, opts?: GetNextJobOptions): Promise<Job \| undefined>` | Bassa | Media |
| `processJob(job, token, cb?)` | `processJob(job: Job, token: string, callback?: Function): Promise<void \| Job>` | Bassa | Media |
| `cancelJob(jobId, reason?)` | `cancelJob(jobId: string, reason?: string): boolean` | Media | Bassa |
| `cancelAllJobs(reason?)` | `cancelAllJobs(reason?: string): void` | Media | Bassa |
| `extendJobLocks(jobIds, tokens, duration)` | `extendJobLocks(jobIds: string[], tokens: string[], duration: number): Promise<number>` | Bassa | Media |
| **Opzione:** `limiter` | `{max: number, duration: number, groupKey?: string}` | **Alta** | Alta |
| **Opzione:** `lockDuration` | `number` (default: 30000) | Media | Bassa |
| **Opzione:** `maxStalledCount` | `number` (default: 1) | Media | Bassa |
| **Opzione:** `skipStalledCheck` | `boolean` | Bassa | Bassa |
| **Opzione:** `skipLockRenewal` | `boolean` | Bassa | Bassa |
| **Opzione:** `drainDelay` | `number` (default: 5000) | Bassa | Bassa |
| **Opzione:** `removeOnComplete` | `boolean \| number \| KeepJobs` | Media | Bassa |
| **Opzione:** `removeOnFail` | `boolean \| number \| KeepJobs` | Media | Bassa |
| **Evento:** `drained` | `() => void` | Media | Bassa |
| **Evento:** `stalled` | `(jobId: string, prev: string) => void` | Media | Bassa |

---

## Job Class

### Proprietà Implementate ✅

| Proprietà | Tipo | Note |
|-----------|------|------|
| `id` | `string` | Identico |
| `name` | `string` | Identico |
| `data` | `T` | Identico |
| `queueName` | `string` | Identico |
| `timestamp` | `number` | Identico |
| `attemptsMade` | `number` | Identico |
| `progress` | `number` | Identico |
| `returnvalue` | `unknown \| undefined` | Identico |
| `failedReason` | `string \| undefined` | Identico |

### Metodi Implementati ✅

| Metodo | Firma | Note |
|--------|-------|------|
| `updateProgress(progress, message?)` | `updateProgress(progress: number, message?: string): Promise<void>` | Esteso con message |
| `log(message)` | `log(message: string): Promise<void>` | Identico |

### Proprietà Da Implementare 🔴

| Proprietà | Tipo BullMQ v5 | Priorità | Complessità |
|-----------|----------------|----------|-------------|
| `delay` | `number` | Bassa | Bassa |
| `processedOn` | `number \| undefined` | Media | Bassa |
| `finishedOn` | `number \| undefined` | Media | Bassa |
| `stacktrace` | `string[] \| null` | Media | Media |
| `stalledCounter` | `number` | Bassa | Bassa |
| `priority` | `number` | Media | Bassa |
| `parentKey` | `string \| undefined` | Media | Bassa |
| `parent` | `{id: string, queueQualifiedName: string} \| undefined` | Media | Bassa |
| `opts` | `JobsOptions` | Media | Bassa |
| `token` | `string \| undefined` | Bassa | Bassa |
| `processedBy` | `string \| undefined` | Bassa | Bassa |
| `deduplicationId` | `string \| undefined` | Media | Bassa |
| `repeatJobKey` | `string \| undefined` | Bassa | Bassa |
| `attemptsStarted` | `number` | Bassa | Bassa |

### Metodi Da Implementare 🔴

| Metodo | Firma BullMQ v5 | Priorità | Complessità |
|--------|-----------------|----------|-------------|
| `getState()` | `getState(): Promise<'waiting' \| 'active' \| 'completed' \| 'failed' \| 'delayed' \| 'waiting-children' \| 'unknown'>` | **Alta** | Bassa |
| `isWaiting()` | `isWaiting(): Promise<boolean>` | Bassa | Bassa |
| `isActive()` | `isActive(): Promise<boolean>` | Bassa | Bassa |
| `isDelayed()` | `isDelayed(): Promise<boolean>` | Bassa | Bassa |
| `isCompleted()` | `isCompleted(): Promise<boolean>` | Bassa | Bassa |
| `isFailed()` | `isFailed(): Promise<boolean>` | Bassa | Bassa |
| `isWaitingChildren()` | `isWaitingChildren(): Promise<boolean>` | Bassa | Bassa |
| `updateData(data)` | `updateData(data: T): Promise<void>` | Media | Bassa |
| `moveToCompleted(returnValue, token, fetchNext?)` | `moveToCompleted(returnValue: R, token: string, fetchNext?: boolean): Promise<JobData \| null>` | Bassa | Media |
| `moveToFailed(error, token, fetchNext?)` | `moveToFailed(error: Error, token: string, fetchNext?: boolean): Promise<void>` | Bassa | Media |
| `moveToWait(token?)` | `moveToWait(token?: string): Promise<boolean>` | Media | Media |
| `moveToDelayed(timestamp, token?)` | `moveToDelayed(timestamp: number, token?: string): Promise<void>` | Media | Media |
| `moveToWaitingChildren(token, opts?)` | `moveToWaitingChildren(token: string, opts?: MoveToChildrenOpts): Promise<boolean>` | Media | Alta |
| `retry(state?, opts?)` | `retry(state?: 'completed' \| 'failed', opts?: {failParentOnFailure?: boolean}): Promise<void>` | **Alta** | Media |
| `promote()` | `promote(): Promise<void>` | Media | Bassa |
| `changeDelay(delay)` | `changeDelay(delay: number): Promise<void>` | Media | Bassa |
| `changePriority(opts)` | `changePriority(opts: {priority: number, lifo?: boolean}): Promise<void>` | Media | Media |
| `extendLock(token, duration)` | `extendLock(token: string, duration: number): Promise<number>` | Bassa | Bassa |
| `getChildrenValues()` | `getChildrenValues(): Promise<{[jobKey: string]: unknown}>` | **Alta** | Media |
| `getDependencies(opts?)` | `getDependencies(opts?: {processed?, unprocessed?}): Promise<{processed, unprocessed, nextProcessedCursor, nextUnprocessedCursor}>` | Media | Alta |
| `getDependenciesCount(opts?)` | `getDependenciesCount(opts?: {...}): Promise<{processed: number, unprocessed: number}>` | Bassa | Bassa |
| `remove(opts?)` | `remove(opts?: {removeChildren?: boolean}): Promise<void>` | **Alta** | Media |
| `clearLogs(keepLogs?)` | `clearLogs(keepLogs?: number): Promise<void>` | Bassa | Bassa |
| `waitUntilFinished(queueEvents, ttl?)` | `waitUntilFinished(queueEvents: QueueEvents, ttl?: number): Promise<R>` | Media | Media |
| `asJSON()` | `asJSON(): JobJsonRaw` | Bassa | Bassa |
| `toJSON()` | `toJSON(): JobJson` | Bassa | Bassa |

---

## JobOptions

### Opzioni Implementate ✅

| Opzione | Tipo | Note |
|---------|------|------|
| `priority` | `number` | Identico |
| `delay` | `number` | Identico |
| `attempts` | `number` | Identico |
| `backoff` | `number` | Identico (BullMQ supporta anche oggetto) |
| `timeout` | `number` | Identico |
| `jobId` | `string` | Identico |
| `removeOnComplete` | `boolean` | Identico (BullMQ supporta anche number/KeepJobs) |
| `removeOnFail` | `boolean` | Identico (BullMQ supporta anche number/KeepJobs) |
| `repeat` | `{every?: number, limit?: number, pattern?: string}` | Identico |
| `stallTimeout` | `number` | Extra bunqueue |
| `durable` | `boolean` | Extra bunqueue |

### Opzioni Da Implementare 🔴

| Opzione | Tipo BullMQ v5 | Priorità | Complessità |
|---------|----------------|----------|-------------|
| `lifo` | `boolean` | Media | Media |
| `stackTraceLimit` | `number` | Bassa | Bassa |
| `parent` | `{id: string, queue: string}` | **Alta** | Media |
| `keepLogs` | `number` | Bassa | Bassa |
| `sizeLimit` | `number` | Bassa | Bassa |
| `failParentOnFailure` | `boolean` | Media | Media |
| `removeDependencyOnFailure` | `boolean` | Bassa | Bassa |
| `deduplication` | `{id: string, ttl?: number}` | Media | Media |
| `debounce` | `{id: string, ttl: number}` | Media | Media |
| `backoff` (oggetto) | `{type: 'fixed' \| 'exponential', delay: number}` | Media | Bassa |
| `removeOnComplete` (esteso) | `number \| {age?: number, count?: number}` | Bassa | Bassa |
| `removeOnFail` (esteso) | `number \| {age?: number, count?: number}` | Bassa | Bassa |
| `repeat.startDate` | `Date \| string \| number` | Bassa | Bassa |
| `repeat.endDate` | `Date \| string \| number` | Bassa | Bassa |
| `repeat.tz` | `string` | Bassa | Bassa |
| `repeat.immediately` | `boolean` | Bassa | Bassa |
| `repeat.count` | `number` | Bassa | Bassa |
| `repeat.prevMillis` | `number` | Bassa | Bassa |
| `repeat.offset` | `number` | Bassa | Bassa |
| `repeat.jobId` | `string` | Bassa | Bassa |

---

## FlowProducer

### Metodi Implementati ✅

| Metodo | Firma bunqueue | Note |
|--------|----------------|------|
| `addChain(steps)` | `addChain(steps: FlowStep[]): Promise<FlowResult>` | API diversa da BullMQ |
| `addBulkThen(parallel, final)` | `addBulkThen(parallel: FlowStep[], final: FlowStep): Promise<{parallelIds, finalId}>` | API diversa da BullMQ |
| `addTree(root)` | `addTree(root: FlowStep): Promise<FlowResult>` | API diversa da BullMQ |
| `getParentResult(parentId)` | `getParentResult(parentId: string): unknown` | Solo embedded |
| `getParentResults(parentIds)` | `getParentResults(parentIds: string[]): Map<string, unknown>` | Solo embedded |
| `close()` | `close(): void` | Identico |

### Metodi Da Implementare 🔴

| Metodo | Firma BullMQ v5 | Priorità | Complessità |
|--------|-----------------|----------|-------------|
| `add(flow)` | `add(flow: FlowJob, opts?: FlowProducerOptions): Promise<JobNode>` | **Alta** | Alta |
| `addBulk(flows)` | `addBulk(flows: FlowJob[]): Promise<JobNode[]>` | Media | Alta |
| `getFlow(opts)` | `getFlow(opts: {id: string, queueName: string, depth?: number, maxChildren?: number}): Promise<JobNode \| null>` | Media | Alta |
| `disconnect()` | `disconnect(): Promise<void>` | Bassa | Bassa |
| `waitUntilReady()` | `waitUntilReady(): Promise<void>` | Bassa | Bassa |

### Struttura FlowJob BullMQ v5

```typescript
interface FlowJob {
  name: string;
  queueName: string;
  data?: any;
  prefix?: string;
  opts?: Omit<JobsOptions, 'repeat'>;
  children?: FlowChildJob[];
}

interface JobNode {
  job: Job;
  children?: JobNode[];
}
```

---

## QueueEvents

### Eventi Implementati ✅

| Evento | Payload | Note |
|--------|---------|------|
| `waiting` | `{jobId: string}` | Identico |
| `active` | `{jobId: string}` | Identico |
| `completed` | `{jobId: string, returnvalue: any}` | Identico |
| `failed` | `{jobId: string, failedReason: string}` | Identico |
| `progress` | `{jobId: string, data: any}` | Identico |
| `stalled` | `{jobId: string}` | Identico |

### Metodi Implementati ✅

| Metodo | Firma | Note |
|--------|-------|------|
| `constructor(name)` | `new QueueEvents(name: string)` | Identico |
| `close()` | `close(): void` | Identico |
| `on(event, listener)` | Ereditato da EventEmitter | Identico |
| `once(event, listener)` | Ereditato da EventEmitter | Identico |
| `off(event, listener)` | Ereditato da EventEmitter | Identico |

### Eventi Da Implementare 🔴

| Evento | Payload BullMQ v5 | Priorità | Complessità |
|--------|-------------------|----------|-------------|
| `drained` | `{id: string}` | Media | Bassa |
| `removed` | `{jobId: string, prev: string}` | Media | Bassa |
| `delayed` | `{jobId: string, delay: number}` | Media | Bassa |
| `duplicated` | `{jobId: string}` | Bassa | Bassa |
| `retried` | `{jobId: string, prev: string}` | Media | Bassa |
| `error` | `Error` | **Alta** | Bassa |
| `waiting-children` | `{jobId: string}` | Bassa | Bassa |

### Metodi Da Implementare 🔴

| Metodo | Firma BullMQ v5 | Priorità | Complessità |
|--------|-----------------|----------|-------------|
| `waitUntilReady()` | `waitUntilReady(): Promise<void>` | Bassa | Bassa |
| `disconnect()` | `disconnect(): Promise<void>` | Bassa | Bassa |

---

## Riepilogo Implementazione

### Statistiche Generali

| Componente | Implementati | Da Implementare | Copertura |
|------------|--------------|-----------------|-----------|
| Queue (metodi) | 12 | 47 | 20% |
| Queue (extra bunqueue) | 10 | - | - |
| Worker (metodi/opzioni) | 14 | 18 | 44% |
| Job (proprietà) | 9 | 14 | 39% |
| Job (metodi) | 2 | 26 | 7% |
| JobOptions | 11 | 20 | 35% |
| FlowProducer | 6 | 5 | 55% |
| QueueEvents | 6 eventi + 4 metodi | 7 eventi + 2 metodi | 53% |

### Priorità Alta (Must Have) 🔴

Questi metodi sono essenziali per la compatibilità BullMQ:

1. **Queue**
   - `getJobState(jobId)` - Ottenere stato job
   - `clean(grace, limit, type?)` - Pulizia job vecchi
   - `retryJobs(opts?)` - Riprova job falliti/completati
   - `setGlobalConcurrency(concurrency)` - Limite concorrenza globale
   - `setGlobalRateLimit(max, duration)` - Rate limiting globale
   - `upsertJobScheduler(id, repeatOpts, template?)` - Job schedulati

2. **Worker**
   - `limiter` option - Rate limiting per worker

3. **Job**
   - `getState()` - Stato corrente del job
   - `retry(state?, opts?)` - Riprova job
   - `remove(opts?)` - Rimuovi job
   - `getChildrenValues()` - Risultati job figli

4. **JobOptions**
   - `parent` - Dipendenze parent/child

5. **FlowProducer**
   - `add(flow)` - API identica a BullMQ

6. **QueueEvents**
   - `error` - Evento errore

### Priorità Media (Should Have) 🟡

Funzionalità importanti ma non bloccanti:

- Queue: `promoteJobs`, `getJobLogs`, `addJobLog`, `updateJobProgress`, `getMetrics`, `getWorkers`, `getDependencies`, deduplication
- Worker: `isRunning`, `isPaused`, `cancelJob`, `cancelAllJobs`, `lockDuration`, `maxStalledCount`, evento `drained`
- Job: `processedOn`, `finishedOn`, `stacktrace`, `priority`, `parent`, `updateData`, `moveToWait`, `moveToDelayed`, `promote`, `changeDelay`, `changePriority`, `waitUntilFinished`
- JobOptions: `lifo`, `failParentOnFailure`, `deduplication`, `debounce`, backoff oggetto
- FlowProducer: `addBulk`, `getFlow`
- QueueEvents: `drained`, `removed`, `delayed`, `retried`

### Priorità Bassa (Nice to Have) 🟢

Funzionalità avanzate/di convenienza:

- Queue: `count`, `isPaused`, `trimEvents`, `getActive/Completed/...`, contatori singoli, `waitUntilReady`, `disconnect`
- Worker: `isClosed`, `waitUntilReady`, `getNextJob`, `processJob`, `extendJobLocks`
- Job: `delay`, `stalledCounter`, `token`, `processedBy`, `isWaiting/Active/...`, `moveToCompleted/Failed`, `extendLock`, `clearLogs`, `asJSON`, `toJSON`
- JobOptions: `stackTraceLimit`, `keepLogs`, `sizeLimit`, `removeDependencyOnFailure`, repeat esteso
- FlowProducer: `disconnect`, `waitUntilReady`
- QueueEvents: `duplicated`, `waiting-children`, `waitUntilReady`, `disconnect`

---

## Piano di Implementazione Suggerito

### Fase 1: Core Compatibility (Alta Priorità)

1. `Queue.getJobState(jobId)`
2. `Job.getState()`
3. `Queue.clean(grace, limit, type?)`
4. `Queue.retryJobs(opts?)`
5. `Job.retry(state?, opts?)`
6. `Job.remove(opts?)`
7. `QueueEvents.error`

### Fase 2: Flow & Dependencies

1. `FlowProducer.add(flow)` - API identica BullMQ
2. `JobOptions.parent`
3. `Job.getChildrenValues()`
4. `Queue.getDependencies(parentId, type, start, end)`

### Fase 3: Rate Limiting & Concurrency

1. `Queue.setGlobalConcurrency(concurrency)`
2. `Queue.setGlobalRateLimit(max, duration)`
3. `Worker.limiter` option

### Fase 4: Scheduling

1. `Queue.upsertJobScheduler(id, repeatOpts, template?)`
2. `Queue.removeJobScheduler(id)`
3. `Queue.getJobSchedulers()`

### Fase 5: Observability

1. `Queue.getJobLogs(jobId, ...)`
2. `Queue.addJobLog(jobId, logRow, keepLogs?)`
3. `Queue.getMetrics(type, start?, end?)`
4. `Queue.getWorkers()`
5. Eventi QueueEvents mancanti

### Fase 6: Convenience Methods

1. Metodi `getActive/Completed/Failed/...`
2. Metodi contatore singoli
3. `Worker.isRunning()`, `isPaused()`
4. Proprietà Job mancanti
5. JobOptions estese
