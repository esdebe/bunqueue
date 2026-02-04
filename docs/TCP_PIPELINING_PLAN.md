# TCP Pipelining Implementation Plan

## Overview

This document outlines the implementation plan for adding TCP pipelining support to bunqueue, which will significantly improve throughput for Push and Process operations.

### Current Performance (bunqueue TCP vs BullMQ Redis)

| Operation | bunqueue | BullMQ | Difference |
|-----------|----------|--------|------------|
| Push | 16,252 ops/s | 60,827 ops/s | **4x slower** |
| Bulk Push | 99,100 ops/s | 37,900 ops/s | 2.6x faster |
| Process | 5,500 ops/s | 9,300 ops/s | 1.7x slower |

### Root Cause Analysis

1. **Single command per connection**: Client uses `currentCommand` variable - only 1 in-flight command per connection
2. **Sequential server processing**: Server awaits each `handleCommand()` before processing next
3. **Positional response matching**: Assumes first response is for current command (no reqId matching)

### Expected Performance After Pipelining

| Operation | Current | Expected | Improvement |
|-----------|---------|----------|-------------|
| Push | 16,252 ops/s | ~65,000 ops/s | **4x** |
| Process | 5,500 ops/s | ~18,000 ops/s | **3x** |

---

## Phase 1: Protocol Infrastructure (Low Risk)

**Goal**: Make `reqId` mandatory and prepare infrastructure for pipelining.

### Task 1.1: Update Protocol Types
**File**: `src/shared/protocol.ts`
**Effort**: 30 min
**Risk**: Low

```typescript
// Current
interface TcpCommand {
  reqId?: number;  // Optional
  cmd: string;
  // ...
}

// New
interface TcpCommand {
  reqId: number;   // Required for pipelining
  cmd: string;
  // ...
}
```

**Changes**:
- [ ] Make `reqId` required in `TcpCommand` interface
- [ ] Add `PROTOCOL_VERSION` constant (v2 for pipelining)
- [ ] Add `PipelineCapabilities` interface

### Task 1.2: Update Client Request ID Generation
**File**: `src/client/tcp/client.ts`
**Effort**: 30 min
**Risk**: Low

```typescript
// Add to TcpClient class
private nextReqId = 1;

private generateReqId(): number {
  return this.nextReqId++;
}
```

**Changes**:
- [ ] Add `nextReqId` counter to `TcpClient` class
- [ ] Update `sendCommand()` to always include `reqId`
- [ ] Ensure `reqId` wraps around safely (use modulo or BigInt)

### Task 1.3: Update Server Response Handling
**File**: `src/infrastructure/server/tcp.ts`
**Effort**: 30 min
**Risk**: Low

**Changes**:
- [ ] Ensure server always echoes `reqId` in response
- [ ] Add logging for reqId tracking (debug mode)
- [ ] Validate reqId is present in incoming commands

### Task 1.4: Add Protocol Tests
**File**: `test/protocol-reqid.test.ts` (new)
**Effort**: 1 hour
**Risk**: None

**Tests**:
- [ ] reqId is always present in client requests
- [ ] reqId is always echoed in server responses
- [ ] reqId counter increments correctly
- [ ] reqId wrap-around works correctly

---

## Phase 2: Client-Side Pipelining (Medium Risk)

**Goal**: Allow multiple commands in flight per connection.

### Task 2.1: Replace Single Command with Map
**File**: `src/client/tcp/client.ts`
**Effort**: 2 hours
**Risk**: Medium

```typescript
// Current (line 25)
private currentCommand: PendingCommand | null = null;

// New
private pendingCommands = new Map<number, PendingCommand>();
```

**Changes**:
- [ ] Replace `currentCommand` with `pendingCommands` Map
- [ ] Update `sendCommand()` to add command to Map with reqId as key
- [ ] Remove blocking behavior - don't wait for previous command

### Task 2.2: Update Response Handler
**File**: `src/client/tcp/client.ts`
**Effort**: 2 hours
**Risk**: Medium

```typescript
// Current (lines 126-142)
private handleResponse(response: TcpResponse): void {
  if (!this.currentCommand) return;
  // Assumes response is for currentCommand
}

// New
private handleResponse(response: TcpResponse): void {
  const reqId = response.reqId;
  const pending = this.pendingCommands.get(reqId);
  if (!pending) {
    console.warn(`Unknown reqId: ${reqId}`);
    return;
  }
  this.pendingCommands.delete(reqId);
  // Resolve/reject the pending command
}
```

**Changes**:
- [ ] Look up pending command by `reqId` from response
- [ ] Handle unknown `reqId` gracefully (log warning)
- [ ] Delete from Map after resolving
- [ ] Update timeout handling to check all pending commands

### Task 2.3: Update Command Queue Processing
**File**: `src/client/tcp/client.ts`
**Effort**: 1 hour
**Risk**: Medium

```typescript
// Current (lines 241-266)
private processNextCommand(): void {
  if (this.currentCommand) return;  // Blocks if command in flight
  // ...
}

// New
private processNextCommand(): void {
  // No blocking - can send multiple commands
  while (this.commandQueue.length > 0 && this.pendingCommands.size < MAX_IN_FLIGHT) {
    const cmd = this.commandQueue.shift()!;
    this.sendCommandImmediate(cmd);
  }
}
```

**Changes**:
- [ ] Add `MAX_IN_FLIGHT` constant (default: 100)
- [ ] Remove blocking on `currentCommand`
- [ ] Add backpressure when `pendingCommands.size >= MAX_IN_FLIGHT`
- [ ] Update drain/close logic to wait for all pending commands

### Task 2.4: Add Client Pipelining Tests
**File**: `test/client-pipelining.test.ts` (new)
**Effort**: 2 hours
**Risk**: None

**Tests**:
- [ ] Multiple commands can be in flight simultaneously
- [ ] Responses are matched correctly by reqId
- [ ] Out-of-order responses work correctly
- [ ] Backpressure activates at MAX_IN_FLIGHT
- [ ] Timeout handling works for pipelined commands
- [ ] Connection close waits for all pending commands

---

## Phase 3: Server-Side Parallel Processing (Medium Risk)

**Goal**: Process multiple commands concurrently on server.

### Task 3.1: Parallel Frame Processing
**File**: `src/infrastructure/server/tcp.ts`
**Effort**: 2 hours
**Risk**: Medium

```typescript
// Current (lines 141-162)
for (const frame of frames) {
  const response = await handleCommand(frame);  // Sequential
  socket.write(packFrame(response));
}

// New
const responses = await Promise.all(
  frames.map(frame => handleCommand(frame))  // Parallel
);
// Maintain order for responses
for (let i = 0; i < frames.length; i++) {
  responses[i].reqId = frames[i].reqId;  // Preserve reqId
  socket.write(packFrame(responses[i]));
}
```

**Changes**:
- [ ] Use `Promise.all()` for parallel command processing
- [ ] Maintain response order or rely on reqId matching
- [ ] Add error handling for individual command failures
- [ ] Consider concurrency limits per connection

### Task 3.2: Concurrency Limiter
**File**: `src/infrastructure/server/tcp.ts`
**Effort**: 1 hour
**Risk**: Low

```typescript
// Add per-connection concurrency limit
const MAX_CONCURRENT_PER_CONNECTION = 50;

async function processFramesBatch(frames: Frame[]): Promise<Response[]> {
  const semaphore = new Semaphore(MAX_CONCURRENT_PER_CONNECTION);
  return Promise.all(
    frames.map(async frame => {
      await semaphore.acquire();
      try {
        return await handleCommand(frame);
      } finally {
        semaphore.release();
      }
    })
  );
}
```

**Changes**:
- [ ] Add `Semaphore` utility class in `src/shared/`
- [ ] Limit concurrent command processing per connection
- [ ] Make limit configurable via environment variable

### Task 3.3: Add Server Pipelining Tests
**File**: `test/server-pipelining.test.ts` (new)
**Effort**: 2 hours
**Risk**: None

**Tests**:
- [ ] Server processes multiple frames in parallel
- [ ] Response reqIds match request reqIds
- [ ] Concurrency limit is respected
- [ ] Individual command errors don't affect others
- [ ] Memory usage stays bounded under load

---

## Phase 4: Integration & Compatibility (Low Risk)

**Goal**: Ensure backward compatibility and add opt-in pipelining.

### Task 4.1: Version Negotiation
**File**: `src/shared/protocol.ts`, `src/client/tcp/client.ts`, `src/infrastructure/server/tcp.ts`
**Effort**: 2 hours
**Risk**: Low

```typescript
// Client sends capabilities on connect
interface ClientHello {
  protocolVersion: 2;
  capabilities: ['pipelining'];
}

// Server responds with supported features
interface ServerHello {
  protocolVersion: 2;
  capabilities: ['pipelining'];
}
```

**Changes**:
- [ ] Add `HELLO` command for capability exchange
- [ ] Client sends supported protocol version on connect
- [ ] Server responds with supported capabilities
- [ ] Fall back to v1 (no pipelining) if server doesn't support v2

### Task 4.2: Opt-in Pipelining Flag
**File**: `src/client/tcp/client.ts`
**Effort**: 1 hour
**Risk**: Low

```typescript
interface TcpClientOptions {
  // ...existing options
  pipelining?: boolean;  // Default: true for v2 servers
  maxInFlight?: number;  // Default: 100
}
```

**Changes**:
- [ ] Add `pipelining` option to client config
- [ ] Add `maxInFlight` option for backpressure tuning
- [ ] Default to pipelining enabled if server supports it

### Task 4.3: Backward Compatibility Tests
**File**: `test/backward-compat.test.ts` (new)
**Effort**: 1 hour
**Risk**: None

**Tests**:
- [ ] New client works with old server (falls back to v1)
- [ ] Old client works with new server
- [ ] Mixed client versions in pool work correctly

### Task 4.4: Update Documentation
**Files**: `README.md`, `docs/`
**Effort**: 1 hour
**Risk**: None

**Changes**:
- [ ] Document pipelining feature
- [ ] Add performance comparison charts
- [ ] Document configuration options
- [ ] Add migration guide from v1

---

## Phase 5: Benchmarking & Optimization (Post-Launch)

### Task 5.1: Comprehensive Benchmarks
**File**: `bench/pipelining/`
**Effort**: 2 hours

**Benchmarks**:
- [ ] Push throughput: 1, 10, 50, 100 in-flight commands
- [ ] Process throughput with various concurrency levels
- [ ] Memory usage under sustained load
- [ ] Latency distribution (p50, p95, p99)

### Task 5.2: Performance Tuning
**Effort**: Variable

**Optimizations**:
- [ ] Tune `MAX_IN_FLIGHT` based on benchmarks
- [ ] Tune server concurrency limit
- [ ] Profile memory allocation patterns
- [ ] Optimize response serialization

---

## Implementation Timeline

| Phase | Tasks | Estimated Time | Dependencies |
|-------|-------|----------------|--------------|
| **Phase 1** | 1.1 - 1.4 | 3 hours | None |
| **Phase 2** | 2.1 - 2.4 | 7 hours | Phase 1 |
| **Phase 3** | 3.1 - 3.3 | 5 hours | Phase 1 |
| **Phase 4** | 4.1 - 4.4 | 5 hours | Phase 2, 3 |
| **Phase 5** | 5.1 - 5.2 | 4 hours | Phase 4 |

**Total Estimated Time**: ~24 hours

---

## Risk Mitigation

### High-Risk Areas
1. **Response ordering**: Mitigated by reqId-based matching
2. **Memory leaks**: Mitigated by timeout cleanup of pending commands
3. **Backward compatibility**: Mitigated by version negotiation

### Rollback Plan
- Feature flag `BUNQUEUE_PIPELINING=0` to disable
- Keep v1 protocol support indefinitely
- Monitoring for error rate spikes after deployment

---

## Success Criteria

1. **Push throughput**: >= 60,000 ops/s (4x improvement)
2. **Process throughput**: >= 15,000 ops/s (3x improvement)
3. **All existing tests pass**: 1009+ tests
4. **No memory leaks**: Stable heap under 24h load test
5. **Backward compatible**: Old clients work with new server

---

## Files to Modify

| File | Phase | Changes |
|------|-------|---------|
| `src/shared/protocol.ts` | 1, 4 | reqId required, version negotiation |
| `src/client/tcp/client.ts` | 1, 2, 4 | Map-based tracking, pipelining |
| `src/infrastructure/server/tcp.ts` | 1, 3, 4 | Parallel processing, capabilities |
| `src/shared/semaphore.ts` | 3 | New file - concurrency limiter |
| `test/protocol-reqid.test.ts` | 1 | New file |
| `test/client-pipelining.test.ts` | 2 | New file |
| `test/server-pipelining.test.ts` | 3 | New file |
| `test/backward-compat.test.ts` | 4 | New file |

---

## Checklist Summary

### Phase 1: Protocol Infrastructure ✅ COMPLETED
- [x] Task 1.1: Update Protocol Types (reqId already defined, kept as optional for backward compat)
- [x] Task 1.2: Update Client Request ID Generation (added reqIdCounter, generateReqId())
- [x] Task 1.3: Update Server Response Handling (already echoes reqId correctly)
- [x] Task 1.4: Add Protocol Tests (test/protocol-reqid.test.ts - 7 tests pass)

### Phase 2: Client-Side Pipelining ✅ COMPLETED
- [x] Task 2.1: Replace Single Command with Map (added inFlightByReqId Map)
- [x] Task 2.2: Update Response Handler (reqId-based matching in handleData)
- [x] Task 2.3: Update Command Queue Processing (processQueue sends multiple up to maxInFlight)
- [x] Task 2.4: Add Client Pipelining Tests (test/client-pipelining.test.ts - 7 tests, 125k ops/sec)

### Phase 3: Server-Side Parallel Processing ✅ COMPLETED
- [x] Task 3.1: Parallel Frame Processing (Promise.all for frames in tcp.ts)
- [x] Task 3.2: Concurrency Limiter (Semaphore with MAX_CONCURRENT=50 per connection)
- [x] Task 3.3: Add Server Pipelining Tests (test/server-pipelining.test.ts - 7 tests, 111k ops/sec)

### Phase 4: Integration & Compatibility ✅ COMPLETED
- [x] Task 4.1: Version Negotiation (Hello command, PROTOCOL_VERSION=2)
- [x] Task 4.2: Opt-in Pipelining Flag (pipelining: true/false in options)
- [x] Task 4.3: Backward Compatibility Tests (test/backward-compat.test.ts - 10 tests)
- [x] Task 4.4: Update Documentation (see below)

### Phase 5: Benchmarking & Optimization
- [ ] Task 5.1: Comprehensive Benchmarks
- [ ] Task 5.2: Performance Tuning
