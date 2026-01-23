# Code Review: Interface Issues

This document identifies code duplication and architectural concerns related to interface abstraction between east-aws and its dependencies (e3, east).

---

## Interface Overlap Analysis

This section analyzes which interfaces are shared between e3 and east-aws, where they overlap (good), and where they diverge (needs attention).

### StorageBackend Interfaces

| Interface | e3-core Methods | e3 LocalStorage | east-aws S3Dynamo | Overlap |
|-----------|-----------------|-----------------|-------------------|---------|
| **ObjectStore** | 5 | 5 | 5 + 1 extra | **100%** |
| **RefStore** | 14 | 14 | 14 + 25 extra | **100%** (but extras break abstraction) |
| **LockService** | 3 | 3 | 3 | **100%** |
| **LogStore** | 2 | 2 | 2 | **100%** |

**Verdict:** The core storage interfaces have **100% overlap** - both implementations provide all required methods. The problem is east-aws adds 26 extra methods outside the interfaces.

---

### ObjectStore (100% Overlap - Good)

| Method | e3-core Interface | LocalObjectStore | S3ObjectStore | Used By |
|--------|-------------------|------------------|---------------|---------|
| `write(repo, data)` | Yes | Yes | Yes | Both |
| `writeStream(repo, stream)` | Yes | Yes | Yes | Both |
| `read(repo, hash)` | Yes | Yes | Yes | Both |
| `exists(repo, hash)` | Yes | Yes | Yes | Both |
| `list(repo)` | Yes | Yes | Yes | GC |
| `deleteRepoBatch()` | No | No | **Extra** | Cloud GC only |

**Analysis:** Perfect interface adherence. The one extra method (`deleteRepoBatch`) is for cloud-specific batch deletion during GC - a reasonable extension that could be formalized.

---

### LockService (100% Overlap - Good)

| Method | e3-core Interface | LocalLockService | DynamoLockService | Used By |
|--------|-------------------|------------------|-------------------|---------|
| `acquire(repo, resource, operation)` | Yes | Yes | Yes | Both |
| `getState(repo, resource)` | Yes | Yes | Yes | Both |
| `isHolderAlive(holder)` | Yes | Yes | Yes | Both |

**Analysis:** Perfect interface adherence. No extra methods.

---

### LogStore (100% Overlap - Good)

| Method | e3-core Interface | LocalLogStore | DynamoLogStore | Used By |
|--------|-------------------|---------------|----------------|---------|
| `append(repo, taskHash, inputsHash, stream, data)` | Yes | Yes | Yes | Both |
| `read(repo, taskHash, inputsHash, stream, options)` | Yes | Yes | Yes | Both |

**Analysis:** Perfect interface adherence. No extra methods.

**Note:** `execute-task.ts` bypasses this interface with direct DynamoDB writes - this is a bug, not a missing interface method.

---

### RefStore (100% Overlap + 25 Extras - Problem)

| Method | e3-core Interface | LocalRefStore | DynamoRefStore | Used By |
|--------|-------------------|---------------|----------------|---------|
| **Package Management** |
| `packageList(repo)` | Yes | Yes | Yes | Both |
| `packageResolve(repo, name, version)` | Yes | Yes | Yes | Both |
| `packageWrite(repo, name, version, hash)` | Yes | Yes | Yes | Both |
| `packageRemove(repo, name, version)` | Yes | Yes | Yes | Both |
| **Workspace State** |
| `workspaceList(repo)` | Yes | Yes | Yes | Both |
| `workspaceRead(repo, name)` | Yes | Yes | Yes | Both |
| `workspaceWrite(repo, name, state)` | Yes | Yes | Yes | Both |
| `workspaceRemove(repo, name)` | Yes | Yes | Yes | Both |
| **Execution Cache** |
| `executionGet(repo, taskHash, inputsHash)` | Yes | Yes | Yes | Both |
| `executionWrite(repo, taskHash, inputsHash, status)` | Yes | Yes | Yes | Both |
| `executionGetOutput(repo, taskHash, inputsHash)` | Yes | Yes | Yes | Both |
| `executionWriteOutput(repo, taskHash, inputsHash, outputHash)` | Yes | Yes | Yes | Both |
| `executionList(repo)` | Yes | Yes | Yes | GC |
| `executionListForTask(repo, taskHash)` | Yes | Yes | Yes | Log lookup |

**Analysis:** All 14 interface methods are implemented. The overlap is complete.

---

### Extra Methods on DynamoRefStore (Not in Interface)

These methods exist only on `DynamoRefStore` and are not part of any e3-core interface:

#### Category 1: Multi-Tenant Repo Management (8 methods)

| Method | Purpose | Should Be Interface? |
|--------|---------|---------------------|
| `listRepos()` | List all tenant repos | **Yes** - `RepoManager` interface |
| `getRepoMetadata(repo)` | Get repo status/metadata | **Yes** |
| `createRepo(repo)` | Create new tenant repo | **Yes** |
| `setRepoStatus(repo, status)` | Set repo lifecycle status | **Yes** |
| `repoExists(repo)` | Check if repo exists | **Yes** |
| `deleteRepoBatch(repo, ...)` | Batch delete repo data | **Yes** |
| `deleteRepo(repo)` | Delete entire repo | **Yes** |
| `removeRepoMetadata(repo)` | Remove repo metadata | **Yes** |

**Analysis - Does e3-api-server have multi-repo support?**

Yes! e3-api-server supports multi-repo mode via `reposDir` config:

```typescript
// e3-api-server/src/server.ts
export interface ServerConfig {
  reposDir?: string;      // Multi-repo: repos are subdirectories
  singleRepoPath?: string; // Single-repo: one repo at /repos/default
}
```

**Why doesn't e3-api-server currently have RepoManager?**

Because the filesystem IS the state - but this is still ad-hoc code, not an interface:

| Operation | e3-api-server (filesystem) | east-aws (S3/DynamoDB) |
|-----------|---------------------------|------------------------|
| List repos | `fs.readdir(reposDir)` | Query `REPO#{name}` records |
| Create repo | `repoInit()` → creates directories | Write DynamoDB metadata |
| Delete repo | `rmSync(repoPath, { recursive: true })` | Delete DynamoDB + S3 |
| Check exists | `fs.stat()` on required subdirs | Query DynamoDB metadata |

**Why it STILL needs an interface:**

1. **Testability** - Can't unit test API handlers without filesystem/DynamoDB
2. **Portability** - e3-azure needs the same contract with different implementation
3. **Consistency** - e3-api-server's filesystem ops should also implement the interface

**Conclusion:** Define `RepoManager` interface in e3-core with implementations:
- `LocalRepoManager` (filesystem) - for e3-api-server
- `InMemoryRepoManager` - for tests
- `DynamoRepoManager` - for e3-aws
- `CosmosRepoManager` - for future e3-azure

#### Category 2: Dataflow Orchestration State (13 methods)

| Method | Purpose | Should Be Interface? |
|--------|---------|---------------------|
| `createExecution(repo, workspace)` | Create execution record | **Yes** - new `DataflowOrchestrator` |
| `startExecution(repo, workspace, id, graph)` | Start execution with graph | **Yes** - new `DataflowOrchestrator` |
| `getExecution(repo, workspace, id?)` | Get execution state | **Yes** - new `DataflowOrchestrator` |
| `updateExecution(repo, workspace, id, updates)` | Update execution | **Yes** - new `DataflowOrchestrator` |
| `incrementExecutionCounters(...)` | Increment task counters | **Yes** - new `DataflowOrchestrator` |
| `listExecutions(repo, workspace)` | List all executions | **Yes** - new `DataflowOrchestrator` |
| `getExecutionTasksV2(repo, id)` | Get task statuses | **Yes** - new `DataflowOrchestrator` |
| `setTaskStatus(repo, id, task, status)` | Set task status | **Yes** - new `DataflowOrchestrator` |
| `updateTaskStatus(repo, id, task, updates)` | Update task status | **Yes** - new `DataflowOrchestrator` |
| `getExecutionEventsV2(repo, id, offset, limit)` | Get execution events | **Yes** - new `DataflowOrchestrator` |
| `addExecutionEvent(repo, ws, id, event)` | Add execution event | **Yes** - new `DataflowOrchestrator` |

**Analysis:** These are needed for **distributed orchestration** where execution state must persist across Lambda invocations. e3-api-server uses in-memory state which doesn't need persistence. Should be a new `DataflowOrchestrator` interface.

#### Category 3: Legacy Methods (4 methods - DEAD CODE)

| Method | Purpose | Action |
|--------|---------|--------|
| `getExecutionState(repo, workspace)` | Phase 1 execution state | **Remove** - unused |
| `getExecutionTasks(repo, executionId: string)` | Phase 1 task list | **Remove** - unused |
| `getExecutionGraph(repo, executionId: string)` | Phase 1 graph | **Remove** - unused |
| `getExecutionEvents(repo, id: string, ...)` | Phase 1 events | **Remove** - unused |

**Analysis:** These are dead code from a schema migration. Phase 1 used string execution IDs with SK prefixes like `EXEC#TASK#{id}#`. Phase 3 uses numeric IDs with separate partition keys like `TASK/{repo}/{id}`. The V1 methods were never removed after migration.

**The "V2" Suffix Problem:**
The existence of `getExecutionTasksV2` alongside `getExecutionTasks` is a code smell indicating incomplete refactoring:

| Phase 1 (Dead) | Phase 3 (Active) |
|----------------|------------------|
| `DataflowExecutionState` (deprecated) | `DataflowExecution` |
| `executionId: string` | `id: number` |
| SK: `EXEC#TASK#{id}#` | PK: `TASK/{repo}/{id}` |
| `getExecutionTasks()` | `getExecutionTasksV2()` |
| `getExecutionEvents()` | `getExecutionEventsV2()` |

**Fix:** Remove all Phase 1 methods and types, then rename V2 methods to remove the suffix (or keep the suffix temporarily but mark V1 as `@deprecated` with clear deletion timeline).

---

### Proposed Interfaces

**The point of abstraction is testability and portability.**

Currently you **cannot**:
- Test any handler without DynamoDB
- Build e3-azure without duplicating the contract
- Swap implementations for local dev

Interfaces should be defined in **e3-core** even if e3-core doesn't use them directly. This enables:

```
e3-core (defines interfaces)
├── RepoManager (interface)
├── DataflowOrchestrator (interface)
└── StorageBackend, RefStore, etc.

e3-aws (implements for AWS)
├── DynamoRepoManager implements RepoManager
├── DynamoOrchestrator implements DataflowOrchestrator
└── S3ObjectStore, DynamoRefStore, etc.

e3-azure (future - implements for Azure)
├── CosmosRepoManager implements RepoManager
├── CosmosOrchestrator implements DataflowOrchestrator
└── BlobObjectStore, CosmosRefStore, etc.

tests (implements for testing)
├── InMemoryRepoManager implements RepoManager
├── InMemoryOrchestrator implements DataflowOrchestrator
└── InMemoryObjectStore, InMemoryRefStore, etc.
```

#### 1. RepoManager Interface (define in e3-core)

```typescript
// e3-core/src/storage/interfaces.ts
interface RepoManager {
  list(): Promise<string[]>;
  exists(repo: string): Promise<boolean>;
  create(repo: string): Promise<void>;
  delete(repo: string): Promise<void>;
  getMetadata(repo: string): Promise<RepoMetadata | null>;
  setStatus(repo: string, status: RepoStatus): Promise<void>;
}
```

| Implementation | Location | Use Case |
|----------------|----------|----------|
| `InMemoryRepoManager` | e3-core | Unit tests |
| `LocalRepoManager` | e3-core | Local dev, e3-api-server |
| `DynamoRepoManager` | e3-aws | AWS production |
| `CosmosRepoManager` | e3-azure (future) | Azure production |

#### 2. DataflowOrchestrator Interface (define in e3-core)

```typescript
// e3-core/src/storage/interfaces.ts
interface DataflowOrchestrator {
  // Execution lifecycle
  createExecution(repo: string, workspace: string): Promise<Execution>;
  startExecution(repo: string, workspace: string, executionId: number, graph: DataflowGraph): Promise<void>;
  getExecution(repo: string, workspace: string, executionId?: number): Promise<Execution | null>;
  updateExecution(repo: string, workspace: string, executionId: number, updates: Partial<Execution>): Promise<void>;
  listExecutions(repo: string, workspace: string): Promise<Execution[]>;

  // Task tracking
  getTaskStatuses(repo: string, executionId: number): Promise<TaskStatus[]>;
  setTaskStatus(repo: string, executionId: number, taskName: string, status: TaskStatus): Promise<void>;

  // Event stream
  getEvents(repo: string, executionId: number, offset?: number, limit?: number): Promise<{events: DataflowEvent[], total: number}>;
  addEvent(repo: string, workspace: string, executionId: number, event: DataflowEvent): Promise<void>;
}
```

| Implementation | Location | Use Case |
|----------------|----------|----------|
| `InMemoryOrchestrator` | e3-core | Unit tests, e3-api-server |
| `DynamoOrchestrator` | e3-aws | AWS production |
| `CosmosOrchestrator` | e3-azure (future) | Azure production |

---

### Interface Overlap Summary

| Interface | Methods | e3 Implements | east-aws Implements | Overlap | Action |
|-----------|---------|---------------|---------------------|---------|--------|
| ObjectStore | 5 | 5 | 5 | **100%** | None needed |
| RefStore | 14 | 14 | 14 | **100%** | None needed |
| LockService | 3 | 3 | 3 | **100%** | None needed |
| LogStore | 2 | 2 | 2 | **100%** | None needed |
| **Total Core** | **24** | **24** | **24** | **100%** | |
| RepoManager | 6 (proposed) | 0 | 8 on DynamoRefStore | **0%** | **Define interface in e3-core** |
| DataflowOrchestrator | 9 (proposed) | In-memory (no interface) | 13 on DynamoRefStore | **0%** | **Define interface in e3-core** |

**Conclusion:**
1. **Core storage interfaces (100% overlap)** - Well-designed, both implementations are complete
2. **RepoManager** - Interface needed in e3-core for testability and portability (e3-azure, e3-gcp)
3. **DataflowOrchestrator** - Interface needed in e3-core for testability and portability

**The fundamental problem:** 21 methods were added directly to `DynamoRefStore` instead of being defined as interfaces. This prevents:
- Unit testing without DynamoDB
- Building alternative cloud implementations (e3-azure)
- Local development with mock backends

---

## Proposed Test Architecture: e3-tests

Currently `e3-api-tests` provides HTTP API-level tests that are backend-agnostic (they hit endpoints, don't care what's behind them). This should be generalized to `e3-tests` with tests at multiple levels, injecting different interface implementations.

### Interface Implementations Matrix

| Interface | e3-tests | e3-core | east-aws | e3-azure (future) |
|-----------|----------|---------|----------|-------------------|
| **ObjectStore** | `InMemoryObjectStore` | `LocalObjectStore` | `S3ObjectStore` | `BlobObjectStore` |
| **RefStore** | `InMemoryRefStore` | `LocalRefStore` | `DynamoRefStore` | `CosmosRefStore` |
| **LockService** | `InMemoryLockService` | `LocalLockService` | `DynamoLockService` | `CosmosLockService` |
| **LogStore** | `InMemoryLogStore` | `LocalLogStore` | `DynamoLogStore` | `CosmosLogStore` |
| **RepoManager** | `InMemoryRepoManager` | `LocalRepoManager` | `DynamoRepoManager` | `CosmosRepoManager` |
| **DataflowOrchestrator** | `InMemoryOrchestrator` | `InMemoryOrchestrator`* | `DynamoOrchestrator` | `CosmosOrchestrator` |

*Local doesn't need persistent orchestration - uses in-memory state for current session.

### Test Levels

#### Level 1: Unit Tests (InMemory)

Test individual functions/handlers in isolation using InMemory implementations from `e3-tests`.

| Location | Test Target | Implementations Used |
|----------|-------------|---------------------|
| `e3-core/test/` | `dataflowGetGraph()`, `dataflowCheckCache()` | InMemoryStorage |
| `e3-core/test/` | `workspaceSetDataset()` | InMemoryStorage |
| `east-aws/test/unit/` | `dispatch-task` handler | InMemoryStorage, InMemoryOrchestrator |
| `east-aws/test/unit/` | `write-result` handler | InMemoryStorage, InMemoryOrchestrator |

**Benefit:** Fast, no I/O, runs anywhere, no credentials needed.

#### Level 2: Integration Tests (real storage)

Test storage implementations against real backends.

| Location | Test Target | Backend |
|----------|-------------|---------|
| `e3-api-server/test/integration/` | LocalStorage | Filesystem (tmpdir) |
| `east-aws/test/integration/` | S3ObjectStore | Real S3 |
| `east-aws/test/integration/` | DynamoRefStore | Real DynamoDB |
| `east-aws/test/integration/` | DynamoOrchestrator | Real DynamoDB |

**Benefit:** Tests real storage I/O, catches AWS-specific issues.

#### Level 3: API Tests

Test HTTP API endpoints against running servers.

| Location | Server | Backend |
|----------|--------|---------|
| `e3-api-server/test/api/` | Local e3-api-server | LocalStorage |
| `east-aws/test/e2e/` | Deployed API Gateway | S3DynamoStorage |

**Benefit:** Tests API contract end-to-end.

#### Level 4: E2E Tests (full deployment)

Test complete workflows against deployed infrastructure.

| Location | Test Scenario | Infrastructure |
|----------|---------------|----------------|
| `east-aws/test/e2e/` | Dataflow execution | Full AWS stack (Step Functions, Lambda) |
| `east-aws/test/e2e/` | GC workflow | Full AWS stack |

**Benefit:** Catches deployment issues, infrastructure bugs.

### Test Package Structure

**Principle:**
- `e3-tests` = shared test infrastructure (InMemory implementations, fixtures, utilities)
- Actual tests live alongside the implementations they test

```
e3/packages/e3-tests/                # SHARED TEST INFRASTRUCTURE ONLY
├── src/
│   ├── index.ts                    # Main exports
│   ├── in-memory/                  # InMemory implementations (test doubles)
│   │   ├── in-memory-storage.ts    # Bundles all InMemory implementations
│   │   ├── in-memory-object-store.ts
│   │   ├── in-memory-ref-store.ts
│   │   ├── in-memory-lock-service.ts
│   │   ├── in-memory-log-store.ts
│   │   ├── in-memory-repo-manager.ts
│   │   └── in-memory-orchestrator.ts
│   ├── fixtures/                   # Test data creation helpers
│   │   ├── packages.ts             # Create test package zips
│   │   └── workspaces.ts           # Create test workspace states
│   └── utils/                      # Shared test utilities
│       ├── assertions.ts           # Custom assertions
│       └── setup.ts                # Common setup/teardown

e3/packages/e3-core/test/           # e3-core UNIT TESTS (InMemory)
├── dataflow.test.ts
├── storage.test.ts
├── workspaces.test.ts
└── packages.test.ts

e3/packages/e3-api-server/test/     # LOCAL API TESTS
├── api/                            # API contract tests (local server)
│   ├── repository.test.ts
│   ├── packages.test.ts
│   ├── workspaces.test.ts
│   ├── datasets.test.ts
│   └── dataflow.test.ts
└── integration/                    # Local filesystem integration
    ├── local-storage.test.ts
    └── dataflow-local.test.ts

east-aws/test/
├── unit/                           # Handler unit tests (InMemory, no AWS)
│   ├── dispatch-task.test.ts
│   ├── write-result.test.ts
│   ├── mark-skipped.test.ts
│   └── apply-tree-updates.test.ts
├── integration/                    # AWS storage tests (needs credentials)
│   ├── s3-object-store.test.ts
│   ├── dynamo-ref-store.test.ts
│   ├── dynamo-orchestrator.test.ts
│   └── dynamo-repo-manager.test.ts
└── e2e/                            # Full deployment tests (current test/integration/)
    ├── dataflow.test.ts
    ├── diamond.test.ts
    └── gc.test.ts
```

### Test Configuration Examples

**e3-core unit tests** (use InMemory from e3-tests):

```typescript
// e3/packages/e3-core/test/dataflow.test.ts
import { InMemoryStorage } from '@elaraai/e3-tests';

const storage = new InMemoryStorage();
// Test dataflowGetGraph, dataflowCheckCache, etc.
```

**e3-api-server local tests** (use LocalStorage):

```typescript
// e3/packages/e3-api-server/test/integration/local-storage.test.ts
import { LocalStorage } from '@elaraai/e3-core';

const storage = new LocalStorage(tmpDir);
// Test against real filesystem
```

**east-aws handler unit tests** (use InMemory from e3-tests):

```typescript
// east-aws/test/unit/dispatch-task.test.ts
import { InMemoryStorage, InMemoryOrchestrator } from '@elaraai/e3-tests';

const storage = new InMemoryStorage();
const orchestrator = new InMemoryOrchestrator();
// Test handler logic without AWS
```

**east-aws AWS integration tests** (need credentials):

```typescript
// east-aws/test/integration/dynamo-orchestrator.test.ts
const orchestrator = new DynamoOrchestrator(dynamo, tableName);
// Test DynamoDB operations
```

**east-aws E2E tests** (need deployed stack):

```typescript
// east-aws/test/e2e/dataflow.test.ts
// Uses HTTP client against deployed API Gateway
const client = new E3ApiClient('https://dev.e3.elaraai.com');
```

### What This Enables

| Scenario | Before (current) | After (with interfaces) |
|----------|------------------|------------------------|
| Test east-aws handler logic | ❌ Need real DynamoDB | ✅ Inject InMemory from e3-tests |
| Test e3-core dataflow logic | ❌ Need filesystem setup | ✅ Use InMemory from e3-tests |
| Add e3-azure | ❌ Duplicate test infrastructure | ✅ Import InMemory from e3-tests |
| Debug handler locally | ❌ Deploy to AWS first | ✅ Run unit tests with InMemory |
| CI for e3-core | ❌ Need test fixtures on disk | ✅ InMemory, runs anywhere |
| CI for east-aws handlers | ❌ Need AWS credentials | ✅ Unit tests use InMemory |

### Migration Path

1. **Define missing interfaces in e3-core:**
   - `RepoManager`
   - `DataflowOrchestrator`

2. **Create e3-tests package with InMemory implementations:**
   - `InMemoryStorage` (bundles all InMemory implementations)
   - `InMemoryRepoManager`
   - `InMemoryOrchestrator`
   - Fixtures and utilities

3. **Refactor east-aws to use interfaces:**
   - Extract `DynamoRepoManager` from `DynamoRefStore`
   - Extract `DynamoOrchestrator` from `DynamoRefStore`
   - Fix `S3DynamoStorage.refs` type to `RefStore`

4. **Add tests to appropriate packages:**
   - `e3-core/test/` - Unit tests using InMemory
   - `e3-api-server/test/` - API and local integration tests
   - `east-aws/test/unit/` - Handler unit tests using InMemory
   - `east-aws/test/integration/` - AWS storage tests
   - Keep existing `east-aws/test/e2e/` (was `test/integration/`)

5. **Update CI pipelines:**
   - Unit tests: No infrastructure needed (InMemory)
   - Local integration: No credentials needed (filesystem)
   - AWS integration: Needs AWS credentials
   - E2E: Needs deployed stack

---

## Executive Summary

The codebase has **inconsistent adherence to the interface abstraction pattern**. While `StorageBackend` is properly implemented for `ObjectStore`, `LockService`, and `LogStore`, the execution/dataflow orchestration has grown outside the defined interfaces:

1. `DynamoRefStore` adds 25+ methods beyond the `RefStore` interface
2. No `DataflowExecutor` or `TaskRunner` implementations exist despite interfaces being defined in e3-core
3. Runner handlers directly couple to DynamoDB-specific methods
4. Some handlers bypass the storage abstraction entirely

---

## Architectural Issues

### 1. RefStore Interface Violation (Critical)

**Location:** `packages/storage/src/dynamo-ref-store.ts`

The `DynamoRefStore` class declares `implements RefStore` but adds ~25 methods that are **not part of the interface**:

| Interface Methods (RefStore) | Extra Methods (DynamoRefStore only) |
|------------------------------|-------------------------------------|
| `packageList`, `packageResolve`, `packageWrite`, `packageRemove` | `listRepos`, `getRepoMetadata`, `createRepo`, `setRepoStatus`, `repoExists`, `deleteRepoBatch`, `deleteRepo`, `removeRepoMetadata` |
| `workspaceList`, `workspaceRead`, `workspaceWrite`, `workspaceRemove` | `getExecutionState`, `getExecutionTasks`, `getExecutionGraph`, `getExecutionEvents` |
| `executionGet`, `executionWrite`, `executionGetOutput`, `executionWriteOutput`, `executionList`, `executionListForTask` | `createExecution`, `startExecution`, `getExecution`, `updateExecution`, `incrementExecutionCounters`, `listExecutions`, `getExecutionTasksV2`, `setTaskStatus`, `updateTaskStatus`, `getExecutionEventsV2`, `addExecutionEvent` |

**What e3 does:**
```typescript
// e3/packages/e3-core/src/storage/local/LocalBackend.ts
export class LocalStorage implements StorageBackend {
  public readonly objects: ObjectStore;  // Interface type
  public readonly refs: RefStore;        // Interface type
  public readonly locks: LockService;    // Interface type
  public readonly logs: LogStore;        // Interface type
}
```
LocalStorage types all properties as **interfaces**, not concrete classes. LocalRefStore only implements the RefStore methods - no extra methods.

**What east-aws does instead:**
```typescript
// packages/storage/src/s3-dynamo-storage.ts:45
public readonly refs: DynamoRefStore;  // Concrete type exposes extra methods!
```

**Impact:**
- Runner handlers directly call these non-interface methods (e.g., `storage.refs.setTaskStatus()`)
- Cannot substitute a mock RefStore for testing
- Tight coupling to DynamoDB schema

---

### 2. Missing DataflowExecutor Implementation (Critical)

**Location:** e3-core defines `DataflowExecutor` interface but east-aws doesn't implement it

The e3-core interface at `e3/packages/e3-core/src/execution/interfaces.ts` defines:

```typescript
interface DataflowExecutor {
  start(storage, workspace, options): Promise<ExecutionHandle>;
  getStatus(handle): Promise<DataflowStatus>;
  cancel(handle): Promise<void>;
  wait(handle): Promise<DataflowExecuteResult>;
}
```

**What e3 does:**
```typescript
// e3/packages/e3-core/src/dataflow.ts
export async function dataflowExecute(storage: StorageBackend, repo, ws, options): Promise<DataflowResult> {
  // Acquire lock through storage.locks interface
  const lock = await storage.locks.acquire(repo, ws, variant('dataflow', null));

  // Build dependency graph using storage.objects.read()
  const { taskNodes, taskDependents } = await buildDependencyGraph(storage, repo, ws);

  // Execute with in-process async loop + AsyncMutex for serialization
  const workspaceUpdateMutex = new AsyncMutex();
  // ... process ready queue, execute tasks, update workspace ...
}

export function dataflowStart(storage, repo, ws, options): Promise<DataflowResult> {
  // Non-blocking variant - returns promise immediately
  return dataflowExecuteWithLock(storage, repo, ws, options)
    .finally(() => options.lock.release());
}
```

```typescript
// e3/packages/e3-api-server/src/handlers/dataflow.ts
export async function startDataflow(storage: StorageBackend, repoPath, workspace, options) {
  // Acquire lock through interface
  const lock = await storage.locks.acquire(repoPath, workspace, variant('dataflow', null));

  // Create in-memory execution state for polling
  createExecutionState(repoPath, workspace);  // Simple in-memory Map

  // Start execution without awaiting (background)
  dataflowStart(storage, repoPath, workspace, {
    lock,
    onTaskStart: (name) => addExecutionEvent(repoPath, workspace, ...),
    onTaskComplete: (result) => addExecutionEvent(repoPath, workspace, ...),
  }).then((result) => completeExecution(...));

  return sendSuccessWithStatus(NullType, null, 202);
}
```

e3-api-server uses:
- e3-core's `dataflowStart()` for actual execution (uses storage interfaces)
- Simple in-memory Map for execution state (`execution-state.ts`)
- Callbacks for event tracking

**What east-aws does instead:**
```typescript
// packages/api/src/index.ts:441-476
// Directly calls DynamoRefStore methods, not through any interface
const execution = await refStore.createExecution(repo, workspace);  // Not in RefStore!

await sfn.send(new StartExecutionCommand({
  stateMachineArn: DATAFLOW_STATE_MACHINE_ARN,
  input: JSON.stringify({ repo, workspace, executionId: execution.id }),
}));
```

- No `StepFunctionsDataflowExecutor` class exists
- Step Functions state machine handles orchestration outside any interface
- Execution state stored in DynamoDB through non-interface methods

**Impact:**
- Cannot test dataflow execution without AWS infrastructure
- Cannot swap execution backends (e.g., local for dev, Step Functions for prod)
- API is tightly coupled to Step Functions + DynamoDB

---

### 3. Missing TaskRunner Implementation (Critical)

**Location:** e3-core defines `TaskRunner` interface but east-aws doesn't implement it

The e3-core interface defines:

```typescript
interface TaskRunner {
  execute(storage, taskHash, inputHashes, options): Promise<TaskResult>;
}
```

**What e3 does:**
```typescript
// e3/packages/e3-core/src/executions.ts
export async function taskExecute(storage: StorageBackend, repo, taskHash, inputHashes, options) {
  // Read task IR through storage interface
  const taskData = await storage.objects.read(repo, taskHash);

  // Read inputs through storage interface
  for (const inputHash of inputHashes) {
    const inputData = await storage.objects.read(repo, inputHash);
    // Stage to temp file...
  }

  // Execute CLI (spawn process)
  const result = spawn(cmd, args);

  // Write output through storage interface
  const outputHash = await storage.objects.write(repo, outputData);

  // Write logs through storage interface
  await storage.logs.append(repo, taskHash, inputsHash, 'stdout', stdout);

  // Cache execution through storage interface
  await storage.refs.executionWrite(repo, taskHash, inputsHash, status);

  return { state: 'success', outputHash };
}
```

All I/O goes through the storage abstraction (`storage.objects`, `storage.logs`, `storage.refs`).

**What east-aws does instead:**
```typescript
// packages/runner/src/handlers/execute-task.ts
const s3 = new S3Client({});           // Direct AWS client
const dynamo = new DynamoDBClient({}); // Direct AWS client

// Direct S3 usage - NOT through ObjectStore
await downloadObject(repo, inputHashes[0], taskIrPath);  // Custom S3 helper
await uploadOutput(repo, outputHash, outputPath);        // Custom S3 helper

// Direct DynamoDB usage - NOT through LogStore
await writeLog(repo, taskHash, inputsHash, 'stdout', data);  // Custom DynamoDB helper

// Custom LogBuffer class instead of using DynamoLogStore
class LogBuffer {
  async write(data: string) {
    await writeLog(...);  // Direct DynamoDB write
  }
}
```

**Impact:**
- Cannot test task execution without spawning processes
- Cannot mock storage for unit tests
- Duplicate log-writing logic outside `LogStore` interface
- Object read/write bypasses `ObjectStore` interface

---

### 4. execute-task.ts Bypasses Storage Abstraction (High)

**Location:** `packages/runner/src/handlers/execute-task.ts`

**What e3 does:**
```typescript
// All I/O through storage interfaces
const taskData = await storage.objects.read(repo, taskHash);
const outputHash = await storage.objects.write(repo, outputData);
await storage.logs.append(repo, taskHash, inputsHash, stream, data);
```

**What east-aws does instead:**
```typescript
// Direct AWS SDK usage, bypassing storage abstraction
const s3 = new S3Client({});
await downloadObject(repo, inputHashes[0], taskIrPath);  // Direct S3
await uploadOutput(repo, outputHash, outputPath);        // Direct S3

const dynamo = new DynamoDBClient({});
await writeLog(repo, taskHash, inputsHash, 'stdout', data);  // Direct DynamoDB
await recordStartEvent(repo, workspace, executionId, taskName);  // Direct DynamoDB
```

**Should use:**
```typescript
// Through storage abstraction (like e3 does)
await storage.objects.read(repo, hash);
await storage.objects.write(repo, data);
await storage.logs.append(repo, taskHash, inputsHash, 'stdout', data);
```

---

### 5. Stub Handlers Never Integrated (Medium)

**Location:** `packages/runner/src/handlers/`

Two handlers are placeholder stubs with TODO comments:

**check-cache.ts:38:**
```typescript
// TODO: Call e3-core dataflowCheckCache() once integrated
// Placeholder - always miss
return { cached: false };
```

**run-task.ts:41:**
```typescript
// TODO: Call e3-core dataflowExecuteTask() once integrated
// Placeholder
return { state: 'success', outputHash: 'placeholder-output-hash' };
```

**What e3 does:**
e3-core exports `dataflowCheckCache()` which properly checks the execution cache through `storage.refs.executionGetOutput()`.

**What east-aws does instead:**
- `dispatch-task.ts` correctly calls `dataflowCheckCache()` from e3-core
- But `check-cache.ts` and `run-task.ts` remain as unused stubs

These appear to be superseded by `dispatch-task.ts` and `execute-task.ts` but remain in the codebase.

---

### 6. Legacy/V2 Method Duplication - Dead Code (Medium)

**Location:** `packages/storage/src/dynamo-ref-store.ts`

There are two parallel schemas in the codebase from an incomplete migration:

| Aspect | Phase 1 (Dead Code) | Phase 3 (Active) |
|--------|---------------------|------------------|
| Execution ID | `string` | `number` |
| Type | `DataflowExecutionState` | `DataflowExecution` |
| Task PK | `{repo}` | `TASK/{repo}/{executionId}` |
| Task SK | `EXEC#TASK#{id}#{task}` | `{taskName}` |
| Methods | `getExecutionTasks()` | `getExecutionTasksV2()` |
| | `getExecutionEvents()` | `getExecutionEventsV2()` |
| | `getExecutionState()` | `getExecution()` |
| | `getExecutionGraph()` | (graph stored in execution record) |

**The Phase 1 methods are never called** - they are dead code that was left behind after migrating to Phase 3.

**What e3 does:**
e3-api-server uses a simple in-memory Map for execution state:
```typescript
// e3/packages/e3-api-server/src/execution-state.ts
const executionStates = new Map<string, ExecutionStateInternal>();

export function createExecutionState(repoPath, workspace) {
  executionStates.set(key, { status: 'running', events: [] });
}
```
No persistence needed - state is for current server session only. No migration cruft.

**What east-aws does instead:**
- Multiple DynamoDB schema versions coexist
- Phase 1 methods remain as dead code (~100 lines)
- V2 suffix on method names instead of clean rename
- `@deprecated` tag on `DataflowExecutionState` but type still exported

**Fix:**
1. Delete Phase 1 methods: `getExecutionState`, `getExecutionTasks`, `getExecutionEvents`, `getExecutionGraph`
2. Delete `DataflowExecutionState` interface
3. Rename V2 methods to remove suffix (or keep suffix with roadmap to remove)

---

## Code Duplication Issues

### 1. `parsePathString` - Direct Copy from e3-core (High)

**Location:** `packages/runner/src/handlers/apply-tree-updates.ts:75-113`

Exact copy of the function in `e3/packages/e3-core/src/dataflow.ts:69-107`.

**Fix:** Export from `@elaraai/e3-core` and import.

---

### 2. `ObjectNotFoundError` - Duplicated Error Class (Medium)

**Location:** `packages/storage/src/s3-object-store.ts:231-239`

e3-core exports `ObjectNotFoundError` but east-aws defines its own version with a different signature:

| Version | Constructor | Message |
|---------|-------------|---------|
| e3-core | `ObjectNotFoundError(hash: string)` | `Object '{hash}...' not found` |
| east-aws | `ObjectNotFoundError(repo: string, hash: string)` | `Object not found: {hash} in repo {repo}` |

**Fix:** Either import from `@elaraai/e3-core` (losing repo context), or extend e3-core's error with repo information. Consider adding `repo` parameter to e3-core's version for consistency.

---

### 3. `computeInputsHash` - Duplicated (Medium)

**Locations:**
- `packages/runner/src/handlers/write-result.ts:159-162`
- `packages/runner/src/handlers/execute-task.ts:392-395`

This function computes SHA256 of joined input hashes. e3-core exports the identical function as `inputsHash`.

**Fix:** Import from `@elaraai/e3-core`.

---

### 4. AWS Client Initialization - Repeated 20+ Times (Medium)

The following pattern appears in every Lambda handler:

```typescript
const s3 = new S3Client({});
const dynamo = new DynamoDBClient({});
const storage = new S3DynamoStorage(s3, dynamo, process.env.BUCKET_NAME!, process.env.TABLE_NAME!);
```

**Fix:** Create shared initialization in `@elaraai/e3-storage`.

---

### 5. `getStoredGraph` Helper - Duplicated (Low)

**Locations:**
- `packages/runner/src/handlers/dispatch-task.ts:141`
- `packages/runner/src/handlers/mark-skipped.ts:109`

**Fix:** Extract to shared module.

---

### 6. Execution ARN Construction - Duplicated (Low)

**Locations:**
- `packages/api/src/index.ts:218-222`
- `packages/api/src/index.ts:336-340`

**Fix:** Extract to utility function.

---

## Implementation Plan

### Phase 1: Interface Definitions (e3-core)

**Goal:** Define missing interfaces so implementations can be swapped.

#### 1.1 Create `RepoManager` interface

**File:** `e3/packages/e3-core/src/storage/interfaces.ts`

```typescript
export interface RepoManager {
  list(): Promise<string[]>;
  exists(repo: string): Promise<boolean>;
  create(repo: string): Promise<void>;
  delete(repo: string): Promise<void>;
  getMetadata(repo: string): Promise<RepoMetadata | null>;
  setStatus(repo: string, status: RepoStatus): Promise<void>;
}

export type RepoStatus = 'creating' | 'active' | 'gc' | 'deleting';

export interface RepoMetadata {
  name: string;
  status: RepoStatus;
  createdAt: string;
  statusChangedAt: string;
}
```

#### 1.2 Create `DataflowOrchestrator` interface

**File:** `e3/packages/e3-core/src/storage/interfaces.ts`

```typescript
export interface DataflowOrchestrator {
  // Execution lifecycle
  createExecution(repo: string, workspace: string): Promise<DataflowExecution>;
  startExecution(repo: string, workspace: string, executionId: number, graph: DataflowGraph, taskCount: number): Promise<void>;
  getExecution(repo: string, workspace: string, executionId?: number): Promise<DataflowExecution | null>;
  updateExecution(repo: string, workspace: string, executionId: number, updates: Partial<DataflowExecution>): Promise<void>;
  listExecutions(repo: string, workspace: string, limit?: number): Promise<DataflowExecution[]>;

  // Task tracking
  getTaskStatuses(repo: string, executionId: number): Promise<TaskExecutionStatus[]>;
  setTaskStatus(repo: string, executionId: number, taskName: string, status: Omit<TaskExecutionStatus, 'taskName'>): Promise<void>;
  updateTaskStatus(repo: string, executionId: number, taskName: string, updates: Partial<TaskExecutionStatus>): Promise<void>;

  // Event stream
  getEvents(repo: string, executionId: number, offset?: number, limit?: number): Promise<{ events: DataflowEvent[]; total: number }>;
  addEvent(repo: string, workspace: string, executionId: number, event: Omit<DataflowEvent, 'seq'>): Promise<number>;

  // Counters
  incrementCounters(repo: string, workspace: string, executionId: number, increments: Partial<ExecutionCounters>): Promise<void>;
}
```

#### 1.3 Create InMemory implementations

**Files to create:**
- `e3/packages/e3-core/src/storage/in-memory/InMemoryRepoManager.ts`
- `e3/packages/e3-core/src/storage/in-memory/InMemoryOrchestrator.ts`

These are test doubles for unit testing without AWS.

#### 1.4 Export `parsePathString`

**File:** `e3/packages/e3-core/src/index.ts`

Add to exports:
```typescript
export { parsePathString } from './dataflow.js';
```

Also make it public in `dataflow.ts` (currently internal).

---

### Phase 2: Refactor east-aws Storage (east-aws)

**Goal:** Separate interface implementations from concrete types.

#### 2.1 Extract `DynamoRepoManager` class

**Files:**
- **Create:** `packages/storage/src/dynamo-repo-manager.ts`
- **Modify:** `packages/storage/src/dynamo-ref-store.ts` (remove repo methods)

Move these methods from `DynamoRefStore` to new class:
- `listRepos()` → `list()`
- `createRepo()` → `create()`
- `deleteRepo()` → `delete()`
- `getRepoMetadata()` → `getMetadata()`
- `setRepoStatus()` → `setStatus()`
- `repoExists()` → `exists()`
- `deleteRepoBatch()` (helper, can stay internal)
- `removeRepoMetadata()` (helper, can stay internal)

#### 2.2 Extract `DynamoOrchestrator` class

**Files:**
- **Create:** `packages/storage/src/dynamo-orchestrator.ts`
- **Modify:** `packages/storage/src/dynamo-ref-store.ts` (remove orchestration methods)

Move these methods from `DynamoRefStore` to new class:
- `createExecution()`
- `startExecution()`
- `getExecution()`
- `updateExecution()`
- `listExecutions()`
- `getExecutionTasksV2()` → `getTaskStatuses()`
- `setTaskStatus()`
- `updateTaskStatus()`
- `getExecutionEventsV2()` → `getEvents()`
- `addExecutionEvent()` → `addEvent()`
- `incrementExecutionCounters()` → `incrementCounters()`

#### 2.3 Remove legacy methods (dead code)

**File:** `packages/storage/src/dynamo-ref-store.ts`

Delete:
- `getExecutionState()` (Phase 1)
- `getExecutionTasks()` (Phase 1)
- `getExecutionGraph()` (Phase 1)
- `getExecutionEvents()` (Phase 1)
- `DataflowExecutionState` interface (deprecated)

#### 2.4 Fix `S3DynamoStorage` type

**File:** `packages/storage/src/s3-dynamo-storage.ts`

```typescript
// Before:
public readonly refs: DynamoRefStore;

// After:
public readonly refs: RefStore;
public readonly repoManager: RepoManager;
public readonly orchestrator: DataflowOrchestrator;
```

---

### Phase 3: Fix Handler Abstractions (east-aws)

**Goal:** Handlers use interfaces, not concrete types.

#### 3.1 Refactor `execute-task.ts`

**File:** `packages/runner/src/handlers/execute-task.ts`

**Changes:**
1. Use `storage.objects.read()` instead of direct S3 `downloadObject()`
2. Use `storage.objects.write()` instead of direct S3 `uploadObject()`
3. Use `storage.logs.append()` instead of `writeLog()` + `LogBuffer`
4. Import `inputsHash` from `@elaraai/e3-core` instead of local `computeInputsHash()`

**Why not done originally:** Performance concern - direct SDK calls may be faster. Solution: benchmark first, optimize later if needed.

#### 3.2 Refactor `write-result.ts`

**File:** `packages/runner/src/handlers/write-result.ts`

**Changes:**
1. Import `inputsHash` from `@elaraai/e3-core`
2. Access orchestrator via `storage.orchestrator.setTaskStatus()` etc.

#### 3.3 Refactor other handlers

**Files:**
- `dispatch-task.ts` - Use `storage.orchestrator.setTaskStatus()`
- `mark-skipped.ts` - Use `storage.orchestrator.setTaskStatus()`, `addEvent()`
- `get-graph.ts` - Use `storage.orchestrator.startExecution()`
- `finalize-dataflow.ts` - Use `storage.orchestrator.updateExecution()`

#### 3.4 Remove stub handlers

**Delete:**
- `packages/runner/src/handlers/check-cache.ts`
- `packages/runner/src/handlers/run-task.ts`

Update any Step Functions state machine definitions that reference them.

---

### Phase 4: Code Duplication Fixes (east-aws)

#### 4.1 Import `parsePathString` from e3-core

**File:** `packages/runner/src/handlers/apply-tree-updates.ts`

```typescript
// Before:
function parsePathString(pathStr: string): TreePath { ... }

// After:
import { parsePathString } from '@elaraai/e3-core';
```

#### 4.2 Create shared `getStoredGraph` helper

**Files:**
- **Create:** `packages/runner/src/handlers/shared/graph-utils.ts`
- **Modify:** `dispatch-task.ts`, `mark-skipped.ts` to import from shared

#### 4.3 Create shared ARN construction utility

**File:** `packages/api/src/utils/arn.ts`

```typescript
export function buildExecutionArn(stateMachineArn: string, executionId: string): string {
  const arnParts = stateMachineArn.split(':');
  const region = arnParts[3];
  const account = arnParts[4];
  const stateMachineName = arnParts[6];
  return `arn:aws:states:${region}:${account}:execution:${stateMachineName}:${executionId}`;
}
```

#### 4.4 Create shared storage initialization

**File:** `packages/storage/src/init.ts`

```typescript
import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3DynamoStorage } from './s3-dynamo-storage.js';

let storage: S3DynamoStorage | null = null;

export function getStorage(): S3DynamoStorage {
  if (!storage) {
    storage = new S3DynamoStorage(
      new S3Client({}),
      new DynamoDBClient({}),
      process.env.BUCKET_NAME!,
      process.env.TABLE_NAME!
    );
  }
  return storage;
}
```

---

### Phase 5: Testing Infrastructure

#### 5.1 Create e3-tests package (shared infrastructure)

**Create:** `e3/packages/e3-tests/`

Contains only:
- InMemory implementations (test doubles for all interfaces)
- Fixtures (test data creation helpers)
- Utilities (shared assertions, setup/teardown)

Does NOT contain actual test files.

#### 5.2 Add unit tests to e3-core

**New test files:** `e3/packages/e3-core/test/`
- `dataflow.test.ts` - Test dataflow functions with InMemory storage
- `storage.test.ts` - Test storage interface contracts
- `workspaces.test.ts` - Test workspace operations

#### 5.3 Add handler unit tests to east-aws

**New test files:** `east-aws/test/unit/`
- `dispatch-task.test.ts`
- `write-result.test.ts`
- `mark-skipped.test.ts`
- `apply-tree-updates.test.ts`

These import `InMemoryStorage` and `InMemoryOrchestrator` from `@elaraai/e3-tests` to test handler logic without AWS.

---

## Priority Order

| Priority | Task | Effort | Impact |
|----------|------|--------|--------|
| **P0** | Define `DataflowOrchestrator` interface | Medium | Enables all handler refactors |
| **P0** | Define `RepoManager` interface | Low | Enables testable repo management |
| **P0** | Create `InMemoryOrchestrator` | Medium | Enables unit testing |
| **P1** | Extract `DynamoOrchestrator` class | Medium | Cleaner separation |
| **P1** | Fix `S3DynamoStorage` types | Low | Type safety |
| **P1** | Remove dead V1 methods | Low | Reduces confusion |
| **P2** | Refactor `execute-task.ts` | High | Most complex, highest impact |
| **P2** | Fix code duplication | Low | Cleaner code |
| **P2** | Remove stub handlers | Low | Cleanup |
| **P3** | Create e3-tests package | High | Full test coverage |

---

## Success Criteria

After implementation:

1. **Testability:** Can run handler unit tests without AWS credentials
2. **Type Safety:** `S3DynamoStorage.refs` typed as `RefStore` (not `DynamoRefStore`)
3. **No Dead Code:** V1 methods and stub handlers removed
4. **No Duplication:** Shared functions imported from e3-core or shared modules
5. **Interface Compliance:** All orchestration accessed through `DataflowOrchestrator` interface
6. **Portability:** Clear path to `e3-azure` by implementing same interfaces

---

## Summary

| Category | Issue Count | Severity |
|----------|-------------|----------|
| Interface violations | 4 | Critical |
| Code duplication | 6 | Medium |
| Stub/incomplete code | 2 | Medium |
| Legacy code | 2 | Low |

The core issue is that **dataflow orchestration grew outside the interface abstraction**. The storage interfaces (`ObjectStore`, `RefStore`, `LockService`, `LogStore`) are well-defined, but execution management was added directly to `DynamoRefStore` without corresponding interface definitions in e3-core.

e3 uses in-process execution with simple in-memory state tracking. east-aws needs persistent state for Step Functions orchestration, but instead of creating a proper interface, the persistence methods were added directly to `DynamoRefStore`, breaking the abstraction.

This makes the cloud implementation difficult to test in isolation and tightly couples the codebase to AWS-specific patterns.

---

## What's Done Well

Some handlers correctly use e3-core building block functions for the core dataflow logic:

| Handler | e3-core Functions Used |
|---------|----------------------|
| `dispatch-task.ts` | `dataflowResolveInputHashes`, `dataflowCheckCache`, `DataflowGraph` |
| `mark-skipped.ts` | `dataflowGetDependentsToSkip`, `DataflowGraph` |
| `apply-tree-updates.ts` | `workspaceSetDatasetByHash` |

The problem is that **orchestration state methods** (setTaskStatus, addExecutionEvent, incrementExecutionCounters, getExecution, etc.) are called directly on `DynamoRefStore` instead of through an interface. These methods exist only on the concrete AWS implementation and cannot be mocked or swapped.

Additionally, `execute-task.ts` bypasses the storage abstraction entirely for performance reasons (direct S3/DynamoDB access), which is the most significant abstraction violation.
