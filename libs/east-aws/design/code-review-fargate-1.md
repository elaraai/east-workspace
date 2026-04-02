# Code Review: Fargate Compute Branch (`af/fargate-compute`)

Review of interface abstraction adherence in the Fargate compute implementation, following up on the principles established in `code-review.md`.

---

## Executive Summary

The Fargate branch adds ~7,000 lines across 90+ files to support sized compute execution via ECS Fargate, including a WAIT_FOR_TASK_TOKEN callback optimization and performance benchmarking infrastructure. The `TaskConfigStore` follows the correct interface abstraction pattern. However, the core execution infrastructure carries forward the same concrete patterns identified in the original review and introduces new ones:

| Category | Original Review | Fargate Branch | Trend |
|----------|----------------|----------------|-------|
| Storage abstraction bypass in execute-task | **Critical** | Moved to new file, **not fixed** | Same |
| Direct AWS SDK in handlers | 1 handler | **3 handlers** + SFN client (core, compute-entry, collect-result) | **Worse** |
| Concrete types used where interfaces exist | DynamoRefStore | DynamoRefStore + **DynamoTaskConfigStore** + **S3DynamoStorage** | **Worse** |
| Code duplication | 6 instances | 6 original + **5 new** | **Worse** |
| Untestable without AWS | execute-task.ts | execute-task-core.ts + **2 new handlers** | **Worse** |
| InMemory test doubles | 0 | Still **0** | Same |
| Unit tests for handlers | 0 | Still **0** | Same |
| Tests only at E2E level | Yes | **Yes, all new tests require deployed infrastructure** | Same |

**Core problem:** The interfaces for storage and orchestration already exist upstream in e3-core (`ObjectStore`, `LogStore`, `ExecutionStateStore`, `DataflowOrchestrator`) and in the cloud-platform layer in e3-admin-core (`TaskConfigStore`). The extraction of execute-task.ts into execute-task-core.ts was a structural refactor (sharing code between Lambda and Fargate), not an architectural improvement — the concrete AWS coupling was carried over unchanged, bypassing interfaces that already exist. Two additional handlers were built following the same concrete pattern, and the only new cloud-platform interface actually needed (`ComputeResultStore`) was not created.

---

## What's Done Well

### 1. TaskConfigStore Interface (Correct Pattern)

**Files:**
- `packages/e3-admin-core/src/task-config-store.ts` (interface definition)
- `packages/e3-admin-types/src/task-config-types.ts` (types)
- `packages/e3-aws-storage/src/dynamo-task-config-store.ts` (implementation)

This follows exactly the pattern recommended in the original review:

```
e3-admin-core (defines interface)
└── TaskConfigStore (interface)

e3-aws-storage (implements for AWS)
└── DynamoTaskConfigStore implements TaskConfigStore

Future:
└── InMemoryTaskConfigStore implements TaskConfigStore  ← missing
└── CosmosTaskConfigStore implements TaskConfigStore    ← future
```

The interface is clean, cloud-agnostic, and properly separated from the concrete DynamoDB implementation.

### 2. Shared Core Logic (Correct Refactoring Direction)

The extraction of `execute-task-core.ts` as shared logic between Lambda and Fargate entry points is the right structural decision. Both `execute-task.ts` and `execute-task-compute-entry.ts` call the same `executeTaskCore()` function. The problem is **what's inside** that shared function.

### 3. Compute-Aware Dispatch

`dispatch-task.ts` correctly reads compute and timeout configuration and includes it in the dispatch result, allowing the Step Functions state machine to route tasks to the appropriate execution environment. The dispatch logic itself uses `stepPrepareTask` from e3-core — the right approach.

### 4. WAIT_FOR_TASK_TOKEN Optimization (Correct Architecture Decision)

The switch from `RUN_JOB` to `WAIT_FOR_TASK_TOKEN` in the CDK stack (`e3-platform-stack.ts`) is a sound optimization — it allows the Fargate container to signal completion before ECS deprovisioning, saving ~27s per task. The performance benchmarks in `test/manual/chain-perf/results.md` provide data-driven justification.

### 5. Test Helper Extraction (Good Refactoring)

`compute-helpers.ts` was extracted from `compute.ts` to share `executeAndLog()` and `buildResult()` between `compute.ts` and the new `compute-failure.ts`. This is the right DRY approach for test infrastructure.

### 6. Failure Propagation Test Coverage

The new `compute-failure.ts` test suite adds thorough E2E coverage for failure scenarios: diamond with upstream failure, mixed success/failure in parallel, and all-Fargate failure. The tests use concurrent workspaces to overlap Fargate cold starts (~150s), reducing wall time from ~12 min to ~4 min.

---

## Critical Issues

### 1. execute-task-core.ts: Bypasses Existing Upstream Interfaces (Critical — Regression)

**File:** `packages/e3-aws-runner/src/handlers/execute-task-core.ts`

The original review (§4) identified that `execute-task.ts` bypasses the storage abstraction with direct S3/DynamoDB access. The extraction to `execute-task-core.ts` addressed code sharing between Lambda and Fargate but carried the same concrete coupling forward. The interfaces it should be using **already exist in e3-core** — `LogStore`, `ExecutionStateStore`, and `ObjectStore` — and are already implemented in e3-aws-storage (`DynamoLogStore`, `DynamoDBStateStore`, `S3ObjectStore`). This code bypasses them entirely.

**Module-level concrete coupling (lines 22-34):**
```typescript
import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient, UpdateItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { S3ObjectStore } from '@elaraai/e3-aws-storage/s3-object-store';

const s3 = new S3Client({});
const dynamo = new DynamoDBClient({});
const objectStore = new S3ObjectStore(s3, dynamo, BUCKET_NAME, TABLE_NAME);
```

Any import of this module instantiates real AWS clients. There is no way to:
- Inject mock storage for testing
- Run unit tests without AWS credentials
- Substitute an in-memory implementation

**Three functions bypass existing interfaces:**

| Function | Lines | Bypasses (existing interface) | Should Use |
|----------|-------|-------------------------------|------------|
| `writeLog()` | 415-438 | `LogStore` (e3-core) | `logs.append()` via `DynamoLogStore` |
| `checkExecutionStatus()` | 445-475 | `ExecutionStateStore` (e3-core) | `executions.read()` via `DynamoDBStateStore` |
| `recordStartEvent()` | 481-523 | `ExecutionStateStore` (e3-core) | `executions.recordEvent()` via `DynamoDBStateStore` |

Each function constructs raw DynamoDB key schemas (`REPO#`, `STATE/`, `EXEC/`, `EVENT/`) and calls `dynamo.send()` directly. These interfaces and their DynamoDB implementations **already exist** in the codebase — `S3DynamoStorage` already wires them up (see `s3-dynamo-storage.ts`). The handler simply doesn't use them.

**Impact:** The most complex handler in the codebase (523 lines of task execution, log buffering, process spawning, timeout handling) is **completely untestable** without real AWS infrastructure.

**What it should look like:**
```typescript
// All three interfaces already exist in @elaraai/e3-core:
import type { ObjectStore, LogStore } from '@elaraai/e3-core/storage/interfaces';
import type { ExecutionStateStore } from '@elaraai/e3-core/dataflow/state-store/interfaces';

export async function executeTaskCore(
  event: TaskExecutionEvent,
  deps: {
    objects: ObjectStore;           // Already exists — implemented by S3ObjectStore
    logs: LogStore;                 // Already exists — implemented by DynamoLogStore
    executions: ExecutionStateStore; // Already exists — implemented by DynamoDBStateStore
  },
  options?: ExecuteTaskCoreOptions
): Promise<TaskExecutionResult> {
  // Now testable with InMemory implementations
}
```

---

### 2. New Concrete Handlers Without Interfaces (Critical — New)

The Fargate implementation introduces a **new storage pattern** (`COMPUTE_RESULT/`) with no interface abstraction. Two handlers implement both sides of a write-then-read protocol using raw DynamoDB:

#### execute-task-compute-entry.ts — Writer + SFN Callback:
```typescript
// lines 19-25: Two concrete AWS clients at module level
const dynamo = new DynamoDBClient({});
const sfnClient = new SFNClient({});

// lines 64-78: Direct DynamoDB write
await dynamo.send(new PutItemCommand({
  TableName: TABLE_NAME,
  Item: marshall({
    PK: `COMPUTE_RESULT/${repo}/${workspace}`,
    SK: taskExecutionId,
    result: JSON.stringify(result),
    ttl,
  }),
}));

// lines 86-107: Direct Step Functions callback
if (taskToken) {
  await sfnClient.send(new SendTaskSuccessCommand({ taskToken, output: JSON.stringify(result) }));
  // or SendTaskFailureCommand for failures
}
```

#### collect-compute-result.ts (lines 49-79) — Reader:
```typescript
const dynamo = new DynamoDBClient({});
const response = await dynamo.send(
  new GetItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ PK: pk, SK: sk }),
  })
);
const result: TaskExecutionResult = JSON.parse(item.result as string);
await dynamo.send(new DeleteItemCommand({ ... }));
```

**Problems:**
1. **No interface** — The compute result store pattern (write result, read result, delete result) is a cloud-platform concept that should be abstracted as `ComputeResultStore` in e3-admin-core
2. **DynamoDB key schema duplicated** — `COMPUTE_RESULT/${repo}/${workspace}` appears in both files with no shared constant or builder
3. **JSON serialization asymmetry** — Writer uses `JSON.stringify(result)`, reader uses `JSON.parse(item.result)`, with no type-safe contract
4. **TaskExecutionResult defined twice** — In both `execute-task-core.ts:152-161` and `collect-compute-result.ts:30-39` (identical but separate declarations)
5. **Neither handler is testable** — Both require real DynamoDB

**Note on the SFN callback (lines 86-107):** The `SendTaskSuccessCommand`/`SendTaskFailureCommand` calls are purely AWS-specific — they implement Step Functions' `WAIT_FOR_TASK_TOKEN` pattern. An Azure equivalent (e.g. Durable Functions) would use a completely different mechanism. This is Layer 3 (AWS-specific) and does not need a cloud-platform abstraction. The key concern is that it's tangled in the same function as the DynamoDB write, making the testable logic (result serialization) inseparable from the AWS plumbing.

**What it should look like:**
```typescript
// In e3-admin-core (cloud-platform layer, alongside TaskConfigStore):
interface ComputeResultStore {
  write(repo: string, workspace: string, taskExecutionId: string, result: TaskExecutionResult): Promise<void>;
  read(repo: string, workspace: string, taskExecutionId: string): Promise<TaskExecutionResult | null>;
  delete(repo: string, workspace: string, taskExecutionId: string): Promise<void>;
}

// In e3-aws-storage:
class DynamoComputeResultStore implements ComputeResultStore { ... }

// In tests:
class InMemoryComputeResultStore implements ComputeResultStore { ... }
```

---

### 3. Concrete Types Used Where Interfaces Exist (High — Regression)

The original review (§1) identified that `S3DynamoStorage.refs` is typed as `DynamoRefStore` (concrete) instead of `RefStore` (interface). This branch adds new instances of the same pattern:

#### dispatch-task.ts (lines 8, 24):
```typescript
import { S3DynamoStorage, DynamoTaskConfigStore } from '@elaraai/e3-aws-storage';
const taskConfigStore = new DynamoTaskConfigStore(dynamo, process.env.TABLE_NAME!);
```
Uses concrete `DynamoTaskConfigStore` instead of `TaskConfigStore` interface. Cannot inject InMemory implementation for testing.

#### task-config-routes.ts (lines 33-34, 57-59):
```typescript
import type { DynamoTaskConfigStore } from '@elaraai/e3-aws-storage';
import type { S3DynamoStorage } from '@elaraai/e3-aws-storage';

export function createTaskConfigRoutes(
  taskConfigStore: DynamoTaskConfigStore,  // Should be TaskConfigStore
  storage: S3DynamoStorage,               // Should be { locks: LockService }
) {
```

The function signature accepts concrete AWS types despite the `TaskConfigStore` interface existing in `e3-admin-core`. The correct interface was created but isn't being used at the call site.

**Fix:**
```typescript
import type { TaskConfigStore } from '@elaraai/e3-admin-core';
import type { LockService } from '@elaraai/e3-core';

export function createTaskConfigRoutes(
  taskConfigStore: TaskConfigStore,
  locks: LockService,
) {
```

---

### 4. No Unit Tests — All Tests Require Deployed Infrastructure (High — Unchanged)

The original review proposed a 4-level test architecture (Unit → Integration → API → E2E). The Fargate branch adds tests only at the E2E and manual levels:

| New Test File | Level | Requires |
|---------------|-------|----------|
| `e3-cloud-tests/src/suites/compute.ts` | E2E | Live e3 server + Fargate cluster |
| `e3-cloud-tests/src/suites/compute-failure.ts` | E2E | Live e3 server + Fargate cluster |
| `e3-cloud-tests/src/suites/compute-helpers.ts` | E2E (shared) | Live e3 server |
| `e3-cloud-tests/src/suites/task-configs.ts` | E2E | Live e3 server |
| `e3-cloud-tests/src/suites/cleanup.ts` | E2E | Live e3 server + deploy |
| `test/integration/src/cloud-compute.spec.ts` | E2E | `dev.e3.elaraai.com` |
| `test/integration/src/cloud-cleanup.spec.ts` | E2E | `dev.e3.elaraai.com` |
| `test/manual/chain-perf/` | Manual perf | `dev.e3.elaraai.com` + AWS creds |
| `test/manual/timeout-test/` | Manual | `dev.e3.elaraai.com` + AWS creds |

**Zero unit tests were added.** None of the following are testable without AWS:
- `executeTaskCore()` — process spawning + log buffering + cancellation logic
- `collect-compute-result` handler — read/delete compute result
- `dispatch-task` handler — compute size resolution + timeout defaulting
- Task config route handlers — CRUD + locking logic
- Timeout default logic (serverless=15min, Fargate=1440min)

**Missing InMemory implementations:**
- `InMemoryTaskConfigStore` — would enable testing dispatch-task and config routes
- `InMemoryComputeResultStore` — would enable testing collect-compute-result
- `InMemoryLogStore` — already defined in original review, still missing
- `InMemoryExecutionStateStore` — would enable testing checkExecutionStatus/recordStartEvent

---

## Code Duplication Issues

### New Duplications (Added by This Branch)

#### 1. TaskExecutionResult Type Defined Twice

**Locations:**
- `execute-task-core.ts:152-161`
- `collect-compute-result.ts:30-39`

Identical interface, defined independently in two files. If one changes without the other, the JSON serialization contract breaks silently.

**Fix:** Import from `execute-task-core.ts` or extract to shared types.

#### 2. COMPUTE_RESULT/ Key Schema Duplicated

**Locations:**
- `execute-task-compute-entry.ts:68` — `PK: \`COMPUTE_RESULT/${repo}/${workspace}\``
- `collect-compute-result.ts:46` — `const pk = \`COMPUTE_RESULT/${repo}/${workspace}\``

**Fix:** Define in shared module or (better) abstract behind interface.

#### 3. `computeInputsHash` Still Duplicated from e3-core

**Location:** `execute-task-core.ts:406-409`

The original review (§3) identified this. e3-core exports `inputsHash()`. This branch continues to use a local duplicate. Note that `dispatch-task.ts:110` already imports `inputsHash` from e3-core correctly — the same import should be used here.

#### 4. Timeout Validation Duplicated Between API and CLI

**Locations:**
- `task-config-routes.ts:44-49` — `if (minutes < 1n || minutes > 43200n)`
- `commands/timeout.ts:30-31` — `if (minutes < 1 || minutes > 43200)`

Same bounds (recently changed together from 5→1, illustrating the maintenance cost), different numeric types (BigInt vs number). If bounds change again, must update both.

**Fix:** Extract to `e3-admin-types` or `e3-admin-core`:
```typescript
export const TIMEOUT_MIN_MINUTES = 1;
export const TIMEOUT_MAX_MINUTES = 43200;
```

#### 5. credentials.ts Duplicated Verbatim Between Manual Test Suites

**Locations:**
- `test/manual/chain-perf/src/credentials.ts` (126 lines)
- `test/manual/timeout-test/src/credentials.ts` (126 lines)

These are byte-for-byte identical files handling SSO token refresh, credential file reading, and Cognito authentication. Both implement `getCredentialsPath()`, `readCredentials()`, `writeCredentials()`, `refreshAccessToken()`, and `getToken()`.

**Fix:** Extract to `test/manual/shared/credentials.ts` and import from both suites.

#### 6. Default Timeout Logic Duplicated

**Locations:**
- `dispatch-task.ts:100` — `isServerless ? 15 : 1440`
- `task-config-routes.ts:230` — `computeSize.type === 'serverless' ? 15n : 1440n`

The business rule "serverless tasks default to 15 minutes, Fargate tasks default to 1440 minutes" is embedded in two handlers. This should be a method on the `TaskConfigStore` interface:

```typescript
interface TaskConfigStore {
  // ... existing methods ...
  /** Get effective timeout (explicit config or compute-aware default) */
  getEffectiveTimeout(repo: string, workspace: string, taskName: string): Promise<TaskTimeout>;
}
```

---

## Persistent Issues from Original Review

| # | Issue | Original § | Status |
|---|-------|-----------|--------|
| 1 | `S3DynamoStorage.refs` typed as `DynamoRefStore` not `RefStore` | §1 | **Unfixed** |
| 2 | 25+ extra methods on `DynamoRefStore` outside interface | §1 | **Unfixed** |
| 3 | Handlers bypass `ExecutionStateStore` and `DataflowOrchestrator` (both exist in e3-core) | §2 | **Unfixed** — now in more handlers |
| 4 | No `TaskRunner` interface implementation | §3 | **Unfixed** |
| 5 | execute-task bypasses storage abstraction | §4 | **Moved to execute-task-core.ts, not fixed** |
| 6 | `parsePathString` duplicated from e3-core | §Code Dup 1 | **Unfixed** |
| 7 | `ObjectNotFoundError` duplicated | §Code Dup 2 | **Unfixed** |
| 8 | AWS client initialization repeated in every handler | §Code Dup 4 | **Unfixed, now in more files** |
| 9 | Legacy V1/V2 method duplication | §6 | **Unfixed** |
| 10 | Stub handlers (check-cache.ts, run-task.ts) | §5 | **Unfixed** |

---

## Interface Layer Architecture

Interfaces fall into three layers. Understanding which layer each concern belongs to determines where interfaces should be defined, what gets reused across cloud providers, and what stays AWS-specific.

### Layer 1: Upstream (e3-core) — Already Exist

These interfaces are defined in e3-core and implemented in e3-aws-storage. They are the foundation for storage and orchestration across any deployment target.

| Interface | Location | e3-aws Implementation | Used by Handlers? |
|-----------|----------|----------------------|-------------------|
| `ObjectStore` | `e3-core/storage/interfaces` | `S3ObjectStore` | Partially (via module-level instantiation) |
| `LogStore` | `e3-core/storage/interfaces` | `DynamoLogStore` | **No** — `writeLog()` bypasses it |
| `RefStore` | `e3-core/storage/interfaces` | `DynamoRefStore` | Yes, but typed as concrete `DynamoRefStore` |
| `LockService` | `e3-core/storage/interfaces` | `DynamoLockService` | Yes |
| `RepoStore` | `e3-core/storage/interfaces` | `DynamoS3RepoStore` | Yes |
| `ExecutionStateStore` | `e3-core/dataflow/state-store/interfaces` | `DynamoDBStateStore` | **No** — `checkExecutionStatus()`, `recordStartEvent()` bypass it |
| `DataflowOrchestrator` | `e3-core/dataflow/orchestrator/interfaces` | Step Functions impl | Yes (at orchestrator level) |

`S3DynamoStorage` already wires all of these: `objects`, `refs`, `locks`, `logs`, `repos`, `executions`. The handler code in `execute-task-core.ts` bypasses three of them with direct DynamoDB calls.

### Layer 2: Cloud-Platform (e3-admin-core) — Portable Across Cloud Providers

These are concerns that exist in any hosted deployment (AWS, Azure, GCP) but are not part of e3-core's execution engine. They belong in e3-admin-core as interfaces, with AWS implementations in e3-aws-storage.

| Interface | Location | e3-aws Implementation | Status |
|-----------|----------|----------------------|--------|
| `TaskConfigStore` | `e3-admin-core` | `DynamoTaskConfigStore` | **Exists** — correct pattern |
| `AclStore` | `e3-admin-core` | `DynamoAclStore` | **Exists** |
| `ScheduleStore` | `e3-admin-core` | `DynamoScheduleStore` | **Exists** |
| `ComputeResultStore` | — | Raw DynamoDB in two handlers | **Missing** — needs interface |

`ComputeResultStore` is the only new cloud-platform interface needed. The write/read/delete pattern for passing results between a compute container and the orchestrator is cloud-agnostic (Azure would use Cosmos DB or Table Storage, same interface).

### Layer 3: AWS-Specific (e3-aws) — Not Abstractable

These are tightly coupled to AWS service primitives and would be completely different on another cloud provider. They stay in e3-aws with no interface.

- **CDK infrastructure** — ECS cluster, task definitions, Step Functions state machine
- **DynamoDB key schemas** — `REPO#`, `STATE/`, `TASK_CONFIG/`, etc. (encapsulated within implementations)
- **SFN task-token callback** — `SendTaskSuccessCommand`/`SendTaskFailureCommand` (Step Functions `WAIT_FOR_TASK_TOKEN` pattern; Azure Durable Functions uses a different mechanism entirely)
- **EventBridge Scheduler** — schedule triggers
- **ECR / Lambda container image** — runner packaging

---

## Architectural Pattern Analysis

### The Pattern That Works (TaskConfigStore)

```
e3-admin-types          →  Types (ComputeSize, TaskTimeout)
     ↓
e3-admin-core           →  Interface (TaskConfigStore)
     ↓
e3-aws-storage          →  Implementation (DynamoTaskConfigStore)
     ↓
e3-aws-api routes       →  Should consume via interface (currently concrete)
dispatch-task handler   →  Should consume via interface (currently concrete)
```

This pattern enables:
- Unit testing with InMemory (if InMemory was created)
- Alternative implementations (Azure Cosmos, local file)
- Clean separation of concerns

### The Pattern That Doesn't Work (Everything Else)

```
execute-task-core.ts    →  Module-level S3Client, DynamoDBClient
                        →  Direct DynamoDB writes for logs (bypasses existing LogStore)
                        →  Direct DynamoDB reads for execution status (bypasses existing ExecutionStateStore)
                        →  Direct DynamoDB writes for events (bypasses existing ExecutionStateStore)
                        →  Cannot inject dependencies, cannot test

compute-entry.ts        →  Module-level DynamoDBClient + SFNClient
                        →  Direct DynamoDB write for compute result (no interface — needs ComputeResultStore)
                        →  Direct SFN callback (AWS-specific, acceptable)
                        →  Cannot inject dependencies, cannot test

collect-result.ts       →  Module-level DynamoDBClient
                        →  Direct DynamoDB read/delete for compute result (no interface — needs ComputeResultStore)
                        →  Cannot inject dependencies, cannot test
```

This pattern prevents:
- Any unit testing
- Alternative implementations
- Local development without AWS credentials

---

## DynamoDB Schema Coupling

The Fargate branch adds a new DynamoDB key pattern with no abstraction:

| Key Pattern | Files That Know About It | Abstracted? |
|-------------|-------------------------|-------------|
| `REPO#` | dynamo-ref-store, execute-task-core | No |
| `LOG#` | dynamo-log-store, execute-task-core | **No — bypasses DynamoLogStore** |
| `STATE/` | dynamo-ref-store, execute-task-core | **No — bypasses ExecutionStateStore** |
| `EXEC/` | dynamo-ref-store, execute-task-core | **No — bypasses ExecutionStateStore** |
| `EVENT/` | dynamo-ref-store, execute-task-core | **No — bypasses ExecutionStateStore** |
| `COMPUTE_RESULT/` | compute-entry, collect-result | **No — new, no interface** |
| `TASK_CONFIG/` | dynamo-task-config-store | **Yes** (behind TaskConfigStore) |

6 out of 7 key patterns are leaked across multiple files with no abstraction. Only `TASK_CONFIG/` is properly encapsulated.

---

## Summary of New Issues

| # | Issue | Severity | Layer | Files |
|---|-------|----------|-------|-------|
| 1 | execute-task-core.ts bypasses existing LogStore and ExecutionStateStore with direct DynamoDB | **Critical** | Layer 1 bypass | execute-task-core.ts |
| 2 | COMPUTE_RESULT/ storage pattern has no interface (needs `ComputeResultStore` in e3-admin-core) | **Critical** | Layer 2 missing | compute-entry.ts, collect-result.ts |
| 3 | TaskConfigStore interface exists but concrete types used in consumers | **High** | Layer 2 misuse | dispatch-task.ts, task-config-routes.ts |
| 4 | All new tests are E2E only — zero unit tests added | **High** | — | test/, e3-cloud-tests/ |
| 5 | No InMemoryTaskConfigStore created | **High** | Layer 2 missing | (missing) |
| 6 | TaskExecutionResult type defined in two files | **Medium** | — | execute-task-core.ts, collect-result.ts |
| 7 | COMPUTE_RESULT/ key schema duplicated | **Medium** | Layer 3 | compute-entry.ts, collect-result.ts |
| 8 | computeInputsHash still duplicated from e3-core | **Medium** | Layer 1 | execute-task-core.ts |
| 9 | Timeout validation duplicated between API and CLI (recently changed together 5→1, proving maintenance cost) | **Medium** | Layer 2 | task-config-routes.ts, timeout.ts |
| 10 | Default timeout logic duplicated in two handlers | **Medium** | Layer 2 | dispatch-task.ts, task-config-routes.ts |
| 11 | credentials.ts duplicated verbatim between manual test suites | **Low** | — | chain-perf/, timeout-test/ |

---

## Recommendations

### Priority 0: Fix Interface Usage (Quick Wins)

These require no new interfaces — the interfaces already exist.

1. **Change `task-config-routes.ts` parameter types** from `DynamoTaskConfigStore` / `S3DynamoStorage` to `TaskConfigStore` / `LockService`
2. **Change `dispatch-task.ts`** to accept `TaskConfigStore` via dependency injection instead of constructing `DynamoTaskConfigStore` at module level
3. **Import `inputsHash` from `@elaraai/e3-core`** instead of duplicating `computeInputsHash`
4. **Import `TaskExecutionResult`** in `collect-compute-result.ts` from `execute-task-core.ts` instead of redefining

### Priority 1: Create `ComputeResultStore` and InMemory Implementations

1. **Create `ComputeResultStore` interface in e3-admin-core** — the only new cloud-platform interface needed
2. **Create `InMemoryTaskConfigStore`** — enable unit testing of dispatch-task and config routes
3. **Create `InMemoryComputeResultStore`** — enable unit testing of collect-compute-result
4. **Extract timeout defaults** to `TaskConfigStore.getEffectiveTimeout()` method

### Priority 2: Wire execute-task-core.ts to Existing Interfaces

`LogStore`, `ExecutionStateStore`, and `ObjectStore` already exist in e3-core. The handler needs to accept them as parameters instead of constructing raw DynamoDB clients at module level.

1. **Accept dependencies as parameters** instead of module-level globals:
   ```typescript
   interface TaskExecutionDeps {
     objects: ObjectStore;
     logs: LogStore;
     executions: ExecutionStateStore;
   }
   ```
2. **Use `logs.append()`** instead of direct `writeLog()` DynamoDB calls
3. **Use `executions`** for `checkExecutionStatus()` and `recordStartEvent()`
4. **Make `LogBuffer` accept `LogStore`** instead of calling `writeLog()` directly

### Priority 3: Add Unit Tests

With the above interfaces in place, add unit tests that run without AWS:
- `dispatch-task.test.ts` — test cache behavior, compute routing, timeout defaults
- `collect-compute-result.test.ts` — test result reading, missing result handling
- `task-config-routes.test.ts` — test CRUD, lock handling, validation
- `execute-task-core.test.ts` — test spawning, timeout, log buffering (with mocked deps)

---

## Conclusion

The Fargate branch shows an inconsistency in approach. `TaskConfigStore` follows clean interface-driven design. The test helper extraction (`compute-helpers.ts`) and failure test coverage are well-structured. The WAIT_FOR_TASK_TOKEN optimization is a sound performance decision backed by benchmarking data.

However, the execution infrastructure bypasses interfaces that already exist. `LogStore`, `ExecutionStateStore`, and `ObjectStore` are all defined in e3-core and implemented in e3-aws-storage — `execute-task-core.ts` ignores them and talks directly to DynamoDB. The only new cloud-platform interface actually needed is `ComputeResultStore` in e3-admin-core, and it wasn't created. Meanwhile the SFN task-token callback is correctly AWS-specific (Layer 3) and doesn't need abstraction.

The result is that the new handler files are untestable without AWS infrastructure, the DynamoDB schema is leaked across 7+ files, and the gap between the interfaces that exist and the code that uses them is widening.

The fix is not complex — most issues are addressed by wiring handlers to interfaces that already exist, creating one new cloud-platform interface (`ComputeResultStore`), and adding InMemory implementations for unit testing. The correct pattern is already established in this branch; it just needs to be applied consistently.
