# Plan: Provider-Agnostic Migration for e3-cloud

## Context

Two code reviews (design/code-review.md and design/code-review-fargate-1.md) identified systemic issues blocking multi-cloud portability: concrete AWS types used where interfaces exist, 25+ extra methods on DynamoRefStore beyond the RefStore interface, handlers bypassing storage abstractions, code duplication across packages, and zero unit tests (all tests are E2E against deployed AWS). This plan addresses every finding from both reviews across 7 phases, each independently shippable.

---

## Phase 1: Deduplication and Dead Code Removal

**Objective:** Mechanical cleanup — zero architectural changes, purely subtractive/substitutive.

**Tasks:**
1. Delete stub handlers if they exist (`check-cache.ts`, `run-task.ts` in e3-aws-runner)
2. Fix `TaskExecutionResult` duplication — `collect-compute-result.ts` should import from `execute-task-core.ts`
3. Replace `computeInputsHash` in `execute-task-core.ts` with `inputsHash` from `@elaraai/e3-core`
4. Extract timeout constants (`TIMEOUT_MIN_MINUTES`, `TIMEOUT_MAX_MINUTES`, `DEFAULT_TIMEOUT_SERVERLESS`, `DEFAULT_TIMEOUT_FARGATE`) to `e3-cloud-types`
5. Deduplicate `credentials.ts` across `test/manual/chain-perf/` and `test/manual/timeout-test/` into `test/manual/shared/`
6. Remove legacy V1 methods from `DynamoRefStore` if any remain

**Files touched:**
- `packages/e3-aws-runner/src/handlers/execute-task-core.ts`
- `packages/e3-aws-runner/src/handlers/collect-compute-result.ts`
- `packages/e3-aws-runner/src/handlers/dispatch-task.ts`
- `packages/e3-aws-api/src/task-config-routes.ts`
- `packages/e3-cloud-types/src/`
- `test/manual/`

**Review findings addressed:** Fargate #4 (TaskExecutionResult x2), #6 (computeInputsHash), #7 (timeout validation), #8 (default timeout), #9 (credentials.ts). Original #5 (dead stubs), #6 (legacy V1/V2).

---

## Phase 2: Interface Type Fixes and ComputeResultStore

**Objective:** Fix all concrete-type-where-interface-exists violations. Create the one missing interface (`ComputeResultStore`) plus missing in-memory implementations.

**Tasks:**
1. Fix `task-config-routes.ts`: `DynamoTaskConfigStore` → `TaskConfigStore`, `S3DynamoStorage` → `{ locks: LockService }`
2. Fix `admin-routes.ts`: `DynamoRefStore` → narrow inline type (pending Phase 4's `RepoManager`)
3. Fix `schedule-routes.ts`: `DynamoRefStore` → `RefStore`
4. Create `ComputeResultStore` interface in `e3-cloud-core/src/compute-result-store.ts` — methods: `write()`, `read()`, `delete()`
5. Create `DynamoComputeResultStore` in `e3-aws-storage/src/dynamo-compute-result-store.ts` — extracts `COMPUTE_RESULT/` key logic from `execute-task-compute-entry.ts` and `collect-compute-result.ts`
6. Create `InMemoryComputeResultStore` in `e3-cloud-core/src/testing/`
7. Create `InMemoryTaskConfigStore` in `e3-cloud-core/src/testing/`
8. Create `InMemoryScheduleStore` in `e3-cloud-core/src/testing/`

**Review findings addressed:** Fargate #2 (COMPUTE_RESULT/ no interface), #3 (concrete types), #5 (COMPUTE_RESULT/ key duplication).

---

## Phase 3: Runner Handler Dependency Injection

**Objective:** Transform all runner handlers from module-level AWS client instantiation to dependency injection. This is the highest-impact change — makes the entire execution pipeline unit-testable.

**Tasks:**
1. Create `getStorage()` singleton helper in `e3-aws-storage/src/init.ts` (eliminates repeated `new S3Client / new DynamoDBClient / new S3DynamoStorage` in every handler)
2. Refactor `execute-task-core.ts` to accept injected deps:
   ```typescript
   interface TaskExecutionDeps {
     objects: ObjectStore;
     logs: LogStore;
     executions: ExecutionStateStore;
   }
   ```
   - Replace direct S3/DynamoDB log writes with `deps.logs.append()`
   - Replace direct execution status checks with `deps.executions.read()`
   - Replace `LogBuffer` DynamoDB writes with `LogStore`
3. Update `execute-task.ts` (Lambda entry): construct deps from `getStorage()`, delegate to `executeTaskCore(event, deps)`
4. Update `execute-task-compute-entry.ts` (Fargate entry): same pattern, plus use `DynamoComputeResultStore` instead of direct DynamoDB. SFN task-token callback stays here (correctly Layer 3).
5. Update `collect-compute-result.ts`: export pure `collectResult(store: ComputeResultStore, event)` + thin handler wrapper
6. Update `dispatch-task.ts`: export pure `dispatchTask(storage: StorageBackend, configStore: TaskConfigStore, event)` + thin handler
7. Update remaining handlers (`get-graph`, `get-ready`, `apply-results`, `apply-tree-updates`, `mark-skipped`, `check-completion`, `finalize-execution`, `schedule-trigger`): replace repeated AWS client init with `getStorage()`, export pure functions + thin handlers
8. Note: `check-completion.ts` and `get-graph.ts`/`finalize-execution.ts` still cast to `DynamoRefStore` for non-interface methods — these casts are cleaned up in Phase 4

**Review findings addressed:** Fargate #1 (execute-task-core bypasses LogStore/ExecutionStateStore). Original #4 (execute-task bypasses storage), #7 (AWS client init duplication).

---

## Phase 4: Extract DynamoRefStore Bloat into Proper Interfaces

**Objective:** Define cloud-platform interfaces for the 25+ non-RefStore methods on DynamoRefStore, extract implementations, create in-memory test doubles.

**New interfaces in `e3-cloud-core`:**
1. **`RepoManager`** — `list()`, `exists()`, `create()`, `delete()`, `getMetadata()`, `setStatus()`. Types: `RepoMetadata`, `RepoStatus`
2. **`ExecutionTracker`** — `createExecution()`, `startExecution()`, `getExecution()`, `updateExecution()`, `incrementCounters()`, `getTaskStatuses()`, `setTaskStatus()`, `addEvent()`, `getEvents()`, `listExecutions()`
3. **`DataflowRunStore`** — `get()`, `write()`, `list()`, `getLatest()`, `delete()`

**New AWS implementations in `e3-aws-storage`:**
- `DynamoRepoManager`, `DynamoExecutionTracker`, `DynamoDataflowRunStore` — extracted from `DynamoRefStore`

**New in-memory implementations in `e3-cloud-core/testing`:**
- `InMemoryRepoManager`, `InMemoryExecutionTracker`, `InMemoryDataflowRunStore`

**Consumer updates:**
- `S3DynamoStorage` exposes `.repoManager`, `.executionTracker`, `.dataflowRuns` alongside existing `.refs`
- `index.ts` (API): replace `refs as DynamoRefStore` casts with proper typed access
- `admin-routes.ts`: accept `RepoManager`
- `check-completion.ts`: use `ExecutionTracker`
- `get-graph.ts`, `finalize-execution.ts`: use `DataflowRunStore`
- GC lifecycle handlers: use `RepoManager`

**Review findings addressed:** Original #1 (DynamoRefStore 25+ extra methods).

---

## Phase 5: API Handler Decomposition

**Objective:** Break the 879-line monolithic `index.ts` into injectable route modules. Define orchestration and scheduling interfaces.

**New interfaces in `e3-cloud-core`:**
1. **`DataflowOrchestrator`** — `startExecution()`, `cancelExecution()`, `getStatus()`, `describeExecution()`
2. **`SchedulerService`** — `createSchedule()`, `updateSchedule()`, `deleteSchedule()`

**Route extraction:**
- `dataflow-routes.ts` — accepts `StorageBackend`, `ExecutionTracker`, `DataflowOrchestrator`
- `gc-routes.ts` — accepts `RepoManager`, `DataflowOrchestrator`
- `repo-routes.ts` — accepts `RepoManager`, `AclStore`, `ScheduleStore`, `TaskConfigStore`, `SchedulerService`

**AWS implementations:**
- `StepFunctionsOrchestrator` (wraps SFNClient)
- `EventBridgeSchedulerService` (wraps SchedulerClient)

**Result:** `index.ts` becomes ~100-line composition root: construct AWS clients, build concrete implementations, mount routes.

**Review findings addressed:** Original #2 (missing DataflowExecutor cloud impl).

---

## Phase 6: Unit Test Infrastructure

**Objective:** Comprehensive unit tests for all handlers using in-memory implementations. CI runs without AWS credentials.

### Phase 6a: API Route Unit Tests ✅ DONE

Added in-memory mocks (`InMemoryDataflowOrchestrator`, `InMemorySchedulerService`) to `e3-cloud-core/testing`. Created shared test helpers (`test-helpers.ts`) with BEAST2 encode/decode, mock identity, and Hono fetch utilities. Fixed `dataflow-routes.ts` to use a structural `DataflowStorage` interface instead of concrete `S3DynamoStorage`.

**Test files** (46 new tests, all passing without AWS credentials):
- `e3-aws-api/src/task-config-routes.spec.ts` — 20 tests (GET/PUT/POST/DELETE for compute and timeout configs)
- `e3-aws-api/src/repo-routes.spec.ts` — 10 tests (list, create, delete repos with ACL/schedule cleanup)
- `e3-aws-api/src/dataflow-routes.spec.ts` — 7 tests (cancel, execution status, start validation)
- `e3-aws-api/src/gc-routes.spec.ts` — 9 tests (start GC, status polling, error handling)

### Phase 6b: Runner Handler DI + Tests (PENDING)

**Runner handler tests** (`e3-aws-runner/test/`):
- `dispatch-task.test.ts`, `collect-compute-result.test.ts`, `apply-results.test.ts`, `apply-tree-updates.test.ts`, `get-ready.test.ts`, `mark-skipped.test.ts`, `check-completion.test.ts`, `finalize-execution.test.ts`
- Requires DI refactor of runner handlers before tests can be written.

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

## Verification

After each phase:
1. `npm run build` — all packages compile
2. `npm test` — unit tests pass (Phases 1-5: existing tests; Phase 6: new unit tests)
3. Deploy to dev and run integration tests: `cd test/integration && AWS_PROFILE=elaraai-dev-elara-e3 npm run test:integration`
4. After Phase 6: `npm test` runs without any AWS credentials or environment variables
