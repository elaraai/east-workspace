# Plan: Provider-Agnostic Migration for e3-cloud

## Context

Two code reviews (design/code-review.md and design/code-review-fargate-1.md) identified systemic issues blocking multi-cloud portability: concrete AWS types used where interfaces exist, 25+ extra methods on DynamoRefStore beyond the RefStore interface, handlers bypassing storage abstractions, code duplication across packages, and zero unit tests (all tests are E2E against deployed AWS). This plan addresses every finding from both reviews across 7 phases, each independently shippable.

---

## Current Assessment (as of 2026-02-19)

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1 | **Complete** | Dedup, dead code removal, constant extraction |
| Phase 2 | **Complete** | Interface type fixes, ComputeResultStore, in-memory implementations |
| Phase 3 | **Complete** | Runner handler DI — all 11 handlers + execute-task-core refactored |
| Phase 4 | **Complete** | RepoManager, ExecutionTracker, DataflowRunStore, DataflowStorage interfaces |
| Phase 5 | **Complete** | API route decomposition, DataflowOrchestrator, SchedulerService interfaces |
| Phase 6a | **Complete** | API route unit tests (60 tests across 6 spec files) |
| Phase 6b | **Complete** | Runner handler unit tests (29 tests across 8 spec files) |
| Phase 6c | Pending | Interface contract tests (lower priority) |
| Phase 7 | Pending | Auth/GC abstraction (needed only for Azure/GCP) |

**Total unit tests: 111** (60 API + 29 runner + 22 core), all passing without AWS credentials.

### Key bug fixed
**Log schema mismatch in execute-task-core.ts**: `writeLog()` wrote `PK: REPO#{repo}, SK: LOG#{taskHash}#...` but `DynamoLogStore.read()` queries `PK: LOG/{repo}/{taskHash}/{inputsHash}/{executionId}, SK: {stream}/{chunk}`. Completely incompatible schemas — logs written during task execution were invisible to the API's log-reading endpoint. Fixed by replacing raw DynamoDB writes with injected `LogStore.append()` in the Phase 3 refactor.

### Architectural additions
- **`DataflowStorage`** interface in `e3-cloud-core` — extends `StorageBackend` with `executions`, `locks: CloudLockService`, `repoManager`, `dataflowRuns`, `executionTracker`
- **`CloudLockService`** — extends `LockService` with `renewLock()` and `forceRelease()`
- **Cloud-agnostic error types** — `RepoAlreadyExistsError`, `InvalidRepoStatusError` in `e3-cloud-core`
- **`SchedulerService.upsertSchedule()`** — expanded interface, schedule-routes.ts no longer uses raw SchedulerClient

---

## Phase 1: Deduplication and Dead Code Removal ✅ DONE

**Objective:** Mechanical cleanup — zero architectural changes, purely subtractive/substitutive.

**Tasks:**
1. Delete stub handlers if they exist (`check-cache.ts`, `run-task.ts` in e3-aws-runner)
2. Fix `TaskExecutionResult` duplication — `collect-compute-result.ts` should import from `execute-task-core.ts`
3. Replace `computeInputsHash` in `execute-task-core.ts` with `inputsHash` from `@elaraai/e3-core`
4. Extract timeout constants (`TIMEOUT_MIN_MINUTES`, `TIMEOUT_MAX_MINUTES`, `DEFAULT_TIMEOUT_SERVERLESS`, `DEFAULT_TIMEOUT_FARGATE`) to `e3-cloud-types`
5. Deduplicate `credentials.ts` across `test/manual/chain-perf/` and `test/manual/timeout-test/` into `test/manual/shared/`
6. Remove legacy V1 methods from `DynamoRefStore` if any remain

**Review findings addressed:** Fargate #4 (TaskExecutionResult x2), #6 (computeInputsHash), #7 (timeout validation), #8 (default timeout), #9 (credentials.ts). Original #5 (dead stubs), #6 (legacy V1/V2).

---

## Phase 2: Interface Type Fixes and ComputeResultStore ✅ DONE

**Objective:** Fix all concrete-type-where-interface-exists violations. Create the one missing interface (`ComputeResultStore`) plus missing in-memory implementations.

**Tasks:**
1. Fix `task-config-routes.ts`: `DynamoTaskConfigStore` → `TaskConfigStore`, `S3DynamoStorage` → `{ locks: LockService }`
2. Fix `admin-routes.ts`: `DynamoRefStore` → narrow inline type (pending Phase 4's `RepoManager`)
3. Fix `schedule-routes.ts`: `DynamoRefStore` → `RefStore`
4. Create `ComputeResultStore` interface in `e3-cloud-core/src/compute-result-store.ts`
5. Create `DynamoComputeResultStore` in `e3-aws-storage/src/dynamo-compute-result-store.ts`
6. Create `InMemoryComputeResultStore` in `e3-cloud-core/src/testing/`
7. Create `InMemoryTaskConfigStore` in `e3-cloud-core/src/testing/`
8. Create `InMemoryScheduleStore` in `e3-cloud-core/src/testing/`

**Review findings addressed:** Fargate #2 (COMPUTE_RESULT/ no interface), #3 (concrete types), #5 (COMPUTE_RESULT/ key duplication).

---

## Phase 3: Runner Handler Dependency Injection ✅ DONE

**Objective:** Transform all runner handlers from module-level AWS client instantiation to dependency injection.

**Pattern applied to all 11 handlers + execute-task-core:**
```typescript
// Pure function — testable, cloud-agnostic
export async function handleXxx(deps: XxxDeps, event: XxxEvent): Promise<XxxResult> { ... }

// Lambda entry point — thin wrapper
export async function handler(event: XxxEvent): Promise<XxxResult> {
  return handleXxx(buildDeps(), event);
}
```

**Key changes:**
- `execute-task-core.ts`: Removed all direct S3/DynamoDB imports. Accepts `TaskExecutionDeps { objects, logs, executions, executionTracker }`. `LogBuffer` now uses `LogStore.append()` — **fixes the log schema bug**.
- `execute-task-compute-entry.ts`: Exports `handleComputeEntry(deps, event)`. Fargate entry constructs deps from raw clients (keeps dependency tree small).
- `schedule-trigger.ts`: Replaced raw `SFNClient` with `DataflowOrchestrator` interface.
- All other handlers: Simple extraction — `handleGetReady(storage, event)`, `handleApplyResults(storage, event)`, etc.

**Review findings addressed:** Fargate #1 (execute-task-core bypasses LogStore/ExecutionStateStore). Original #4 (execute-task bypasses storage), #7 (AWS client init duplication).

---

## Phase 4: Extract DynamoRefStore Bloat into Proper Interfaces ✅ DONE

**Objective:** Define cloud-platform interfaces for the 25+ non-RefStore methods on DynamoRefStore.

**New interfaces in `e3-cloud-core`:**
1. **`RepoManager`** — `listRepos()`, `repoExists()`, `createRepo()`, `setRepoStatus()`, `getRepoMetadata()`, `removeRepoMetadata()`
2. **`ExecutionTracker`** — `createExecution()`, `startExecution()`, `getExecution()`, `updateExecution()`, `incrementExecutionCounters()`, `getExecutionTasks()`, `setTaskStatus()`, `updateTaskStatus()`, `addExecutionEvent()`, `getExecutionEvents()`, `listExecutions()`
3. **`DataflowRunStore`** — `get()`, `write()`, `list()`, `getLatest()`, `delete()`
4. **`DataflowStorage`** — extends `StorageBackend` with `executions`, `locks: CloudLockService`, `repoManager`, `dataflowRuns`, `executionTracker`
5. **Cloud-agnostic errors** — `RepoAlreadyExistsError`, `InvalidRepoStatusError` (promoted from e3-aws-storage)

**New in-memory implementations in `e3-cloud-core/testing`:**
- `InMemoryRepoManager`, `InMemoryExecutionTracker`, `InMemoryDataflowRunStore`

**Consumer updates:**
- `S3DynamoStorage` exposes `.repoManager`, `.executionTracker`, `.dataflowRuns` alongside existing `.refs`
- `repo-routes.ts` catches `RepoAlreadyExistsError` instead of AWS `ConditionalCheckFailedException`
- `dataflow-routes.ts` uses `DataflowStorage` from cloud-core (removed local definition)

**Review findings addressed:** Original #1 (DynamoRefStore 25+ extra methods).

---

## Phase 5: API Handler Decomposition ✅ DONE

**Objective:** Break the monolithic `index.ts` into injectable route modules.

**New interfaces in `e3-cloud-core`:**
1. **`DataflowOrchestrator`** — `startExecution(params): Promise<string>`
2. **`SchedulerService`** — `upsertSchedule(params): Promise<void>`, `deleteSchedule(name): Promise<void>`

**Route modules:**
- `dataflow-routes.ts` — accepts `DataflowStorage`, `DataflowOrchestrator`
- `gc-routes.ts` — accepts `RepoManager`, SFN client, state machine ARN
- `repo-routes.ts` — accepts `RepoManager`, `AclStore`, `ScheduleStore`, `TaskConfigStore`, `SchedulerService`
- `schedule-routes.ts` — accepts `AclStore`, `ScheduleStore`, `RefStore`, `SchedulerService`
- `task-config-routes.ts` — accepts `TaskConfigStore`, `LockService`

**AWS implementations:**
- `SfnDataflowOrchestrator` (wraps SFNClient)
- `EventBridgeSchedulerService` (wraps SchedulerClient with group name, role ARN, target ARN, DLQ ARN)

**Result:** `index.ts` is a ~130-line composition root.

**Review findings addressed:** Original #2 (missing DataflowExecutor cloud impl).

---

## Phase 6: Unit Test Infrastructure

### Phase 6a: API Route Unit Tests ✅ DONE

Added in-memory mocks (`InMemoryDataflowOrchestrator`, `InMemorySchedulerService`) to `e3-cloud-core/testing`. Created shared test helpers (`test-helpers.ts`) with BEAST2 encode/decode, mock identity, and Hono fetch utilities.

**Test files** (60 tests, all passing without AWS credentials):
- `e3-aws-api/src/task-config-routes.spec.ts` — 20 tests
- `e3-aws-api/src/repo-routes.spec.ts` — 10 tests
- `e3-aws-api/src/dataflow-routes.spec.ts` — 7 tests
- `e3-aws-api/src/gc-routes.spec.ts` — 9 tests
- `e3-aws-api/src/schedule-routes.spec.ts` — 14 tests (cron conversion + validation)

### Phase 6b: Runner Handler Unit Tests ✅ DONE

Created shared test helpers (`test-helpers.ts`) with `createMockStorage()`, `taskState()`, and `graphTask()` factories for constructing properly-typed test state.

**Test files** (29 tests, all passing without AWS credentials):
- `e3-aws-runner/src/handlers/collect-compute-result.spec.ts` — 2 tests (success + container crash)
- `e3-aws-runner/src/handlers/check-completion.spec.ts` — 6 tests (success, cached, failed, running, stale heartbeat, auto-discovery)
- `e3-aws-runner/src/handlers/get-ready.spec.ts` — 4 tests (not found, cancelled, ready tasks, status counting)
- `e3-aws-runner/src/handlers/dispatch-task.spec.ts` — 4 tests (cancelled, default timeout, custom config)
- `e3-aws-runner/src/handlers/mark-skipped.spec.ts` — 3 tests (not found, skip dependents, no graph)
- `e3-aws-runner/src/handlers/finalize-execution.spec.ts` — 4 tests (not found, success, cancelled preservation, lock release)
- `e3-aws-runner/src/handlers/schedule-trigger.spec.ts` — 3 tests (not found, disabled, workspace missing)
- `e3-aws-runner/src/handlers/apply-tree-updates.spec.ts` — 3 tests (empty, filtered, skipped)

### Phase 6c: Interface Contract Tests (PENDING)

**Interface contract tests** (`e3-cloud-core/test/`):
- Parameterized suites for `TaskConfigStore`, `ComputeResultStore`, `RepoManager`, `ExecutionTracker` — run against in-memory first, reusable against DynamoDB in integration tests.

**Review findings addressed:** Fargate #4 (all tests E2E only). Original #8 (no unit tests).

---

## Phase 7: Auth and GC Abstraction (Lower Priority)

**Objective:** Abstract remaining AWS-specific subsystems. Needed only when adding Azure/GCP.

**Tasks:**
1. `AuthProvider` interface — `validateToken()`, `getUserInfo()`, `getDiscoveryDocument()`
2. `DeviceFlowStore` interface — abstracts device flow code storage (currently direct DynamoDB)
3. `GcOrchestrator` interface — `startGc()`, `getGcStatus()`
4. Refactor GC lifecycle handlers to use `RepoManager` and `RepoStore` via injection
5. Lock holder liveness improvement (thread execution ARN through state machine)

---

## What Remains Provider-Specific (By Design)

These items are inherently tied to the cloud provider and stay that way:
- **CDK infrastructure** — Step Functions state machine shape, Lambda definitions, Fargate task defs, VPC/ECS cluster
- **Storage backends** — `e3-aws-storage` (S3 + DynamoDB implementations of interfaces)
- **Container runtime** — Docker image, ECR, SOCI index
- **Auth infrastructure** — Cognito user pool, pre-token-generation trigger, OIDC federation
- **Thin handler entry points** — Lambda event parsing, Fargate env var reading, SFN task-token callbacks

When adding Azure/GCP, you implement the interfaces (StorageBackend, RepoManager, ExecutionTracker, DataflowOrchestrator, SchedulerService, etc.) and write equivalent infrastructure code. All business logic is shared.

---

## Remaining Cleanup (Lower Priority)

- **`credentials.ts` dedup**: 3 identical copies in `test/manual/*/src/`. Extract to `test/manual/shared/`.
- **`S3DynamoStorage.refs` type**: Change from `DynamoRefStore` to `RefStore`. Requires verifying no consumer relies on the concrete type.
- **`DataflowStorage` interface**: The structural type workaround with `locks: CloudLockService` is functional but inelegant. Consider adding `renewLock`/`forceRelease` to `LockService` in e3-core.

---

## Verification

After each phase:
1. `npm run build` — all packages compile
2. `npm test` — unit tests pass (111 tests across 3 packages)
3. Deploy to dev and run integration tests: `cd test/integration && AWS_PROFILE=elaraai-dev-elara-e3 npm run test:integration`
4. `npm test` runs without any AWS credentials or environment variables
