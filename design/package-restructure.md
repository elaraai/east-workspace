# Package Restructure Plan

## Goal

Consolidate the three AWS packages (`e3-aws-api`, `e3-aws-storage`, `e3-aws-runner`) into a single `e3-aws` package, and extract all business logic into `e3-cloud-core` so that the AWS layer is purely implementations + thin wiring.

## Motivation

The current structure has several problems:

1. **GC handlers live in e3-aws-api** but are Step Function lambdas, not API routes
2. **SfnDataflowOrchestrator is duplicated** across e3-aws-storage and e3-aws-api
3. **e3-aws-runner mixes** Lambda handlers and Fargate entrypoint code
4. **e3-aws-api is a junk drawer** — API handlers, auth, orchestration, GC
5. **Business logic is locked into AWS** — the dataflow step logic and GC logic can't be reused for Azure/GCP without duplicating it

The fix follows the same pattern already established for routes: business logic in `e3-cloud-core` parameterized by interfaces, concrete AWS implementations in a single `e3-aws` package.

## Principles

- **All business logic in e3-cloud-core.** Routes, dataflow steps, GC steps, task execution — all cloud-agnostic, all parameterized by injected interfaces.
- **One AWS package.** Subdirectories, not sub-packages. Deployment boundaries are a CDK/Docker concern, not a package concern.
- **Every handler has the same shape:** `create backends → call cloud-agnostic logic → return result`.
- **e3-cloud-types is unchanged.** It defines the HTTP wire format consumed by external clients.

## End State

### Dependency graph

```
e3-core  (from ../e3)
   ^
   |
e3-cloud-core    interfaces, routes, steps, gc, testing
   ^
   |
e3-aws           storage, services, handlers (thin wiring)
   ^
   |
CDK              infrastructure, state machines, API Gateway
```

### e3-cloud-core (expanded)

```
e3-cloud-core/src/
├── index.ts
├── interfaces.ts          # existing + ComputeDispatcher, GcObjectStore
├── errors.ts
├── routes/                # API business logic (existing)
│   ├── admin-routes.ts
│   ├── repo-routes.ts
│   ├── dataflow-routes.ts
│   ├── schedule-routes.ts
│   ├── task-config-routes.ts
│   ├── gc-routes.ts
│   └── authz-middleware.ts
├── steps/                 # Dataflow step logic (from e3-aws-runner)
│   ├── get-graph.ts
│   ├── get-ready.ts
│   ├── dispatch-task.ts
│   ├── apply-results.ts
│   ├── apply-tree-updates.ts
│   ├── check-completion.ts
│   ├── mark-skipped.ts
│   ├── finalize-execution.ts
│   ├── execute-task.ts
│   └── collect-compute-result.ts
├── gc/                    # GC step logic (from e3-aws-api/repo-lifecycle)
│   ├── gc-mark.ts
│   ├── gc-sweep.ts
│   ├── gc-cleanup.ts
│   └── gc-scheduler.ts
└── testing/               # InMemory impls (existing + new)
    └── in-memory.ts
```

### e3-aws (merged)

```
e3-aws/src/
├── index.ts
├── backends.ts            # shared factory: create all AWS backends from env
├── storage/               # from e3-aws-storage
│   ├── s3-dynamo-storage.ts
│   ├── s3-object-store.ts
│   ├── dynamo-ref-store.ts
│   ├── dynamo-lock-service.ts
│   ├── dynamo-log-store.ts
│   ├── dynamo-acl-store.ts
│   ├── dynamo-schedule-store.ts
│   ├── dynamo-task-config-store.ts
│   ├── dynamo-compute-result-store.ts
│   ├── dynamo-state-store.ts
│   └── dynamo-s3-repo-store.ts
├── services/              # from e3-aws-api (auth, orchestrators, scheduler)
│   ├── cognito-identity.ts
│   ├── cognito-device-flow.ts
│   ├── cognito-discovery.ts
│   ├── cognito-pre-token.ts
│   ├── sfn-dataflow-orchestrator.ts
│   ├── sfn-gc-orchestrator.ts
│   ├── eventbridge-scheduler.ts
│   ├── lambda-compute-dispatch.ts
│   └── fargate-compute-dispatch.ts
└── handlers/              # thin entry points only
    ├── api.ts             # Hono composition root
    ├── pre-token-generation.ts
    ├── sfn/
    │   ├── get-graph.ts
    │   ├── get-ready.ts
    │   ├── dispatch-task.ts
    │   ├── execute-task.ts
    │   ├── collect-compute-result.ts
    │   ├── apply-results.ts
    │   ├── apply-tree-updates.ts
    │   ├── check-completion.ts
    │   ├── mark-skipped.ts
    │   ├── finalize-execution.ts
    │   └── schedule-trigger.ts
    ├── gc/
    │   ├── gc-mark.ts
    │   ├── gc-sweep.ts
    │   ├── gc-cleanup.ts
    │   ├── gc-scheduler.ts
    │   └── set-status.ts
    └── fargate/
        └── main.ts
```

### New interfaces (in e3-cloud-core)

```typescript
/** Dispatch a task to compute (Lambda, Fargate, ACI, Cloud Run, etc.) */
interface ComputeDispatcher {
  dispatch(params: {
    repo: string;
    workspace: string;
    executionId: number;
    taskName: string;
    taskHash: string;
    computeSize: ComputeSize;
    timeout: number;
  }): Promise<{ ref: string }>;
}

/** GC-specific object storage operations */
interface GcObjectStore {
  deleteRepoBatch(repo: string, cursor?: string, batchSize?: number):
    Promise<{ deleted: number; cursor?: string }>;
  queryCatalogue(repo: string, cursor?: string, limit?: number):
    Promise<{ entries: CatalogueEntry[]; cursor?: string }>;
  deleteCatalogueEntries(repo: string, hashes: string[]): Promise<void>;
}
```

### Handler pattern (every handler looks like this)

```typescript
// e3-aws/src/handlers/sfn/get-graph.ts
import { createBackends } from '../../backends.js';
import { getGraph } from '@elaraai/e3-cloud-core/steps';

export async function handler(event: GetGraphEvent) {
  const backends = createBackends();
  return getGraph(backends, event.repo, event.workspace, event.executionId);
}
```

## Phases

### Phase 1: Merge AWS packages into e3-aws

Mechanical restructure. No logic changes, no new interfaces. Move files into subdirectories within a single package and update all imports.

**Work:**
- Create `e3-aws` package (package.json, tsconfig.json)
- Move `e3-aws-storage/src/*` → `e3-aws/src/storage/`
- Move `e3-aws-api/src/auth/*` → `e3-aws/src/services/cognito-*`
- Move `e3-aws-api/src/sfn-*`, `eventbridge-*` → `e3-aws/src/services/`
- Move `e3-aws-api/src/repo-lifecycle/*` → `e3-aws/src/handlers/gc/`
- Move `e3-aws-api/src/index.ts` → `e3-aws/src/handlers/api.ts`
- Move `e3-aws-runner/src/*` → `e3-aws/src/handlers/sfn/` + `handlers/fargate/`
- Update all imports across: CDK, e3-cloud-tests, e3-cloud-cli, Dockerfiles, CI
- Delete old packages
- Build + all unit tests pass

**Risk:** Low — purely mechanical. Git blame gets noisier but that's acceptable.

### Phase 2: Extract dataflow step logic to e3-cloud-core

Add `ComputeDispatcher` interface. Separate business logic from handler wiring in each SFN handler.

**Work:**
- Add `ComputeDispatcher` interface to `e3-cloud-core/src/interfaces.ts`
- Add `InMemoryComputeDispatcher` to testing
- For each SFN handler: extract logic into `e3-cloud-core/src/steps/`, leave thin wrapper in `e3-aws/src/handlers/sfn/`
- Move `execute-task-core.ts` logic → `e3-cloud-core/src/steps/execute-task.ts`
- Port runner unit tests to e3-cloud-core (testing against InMemory implementations)
- Build + all tests pass

**Risk:** Medium — requires understanding each handler's interface boundary. Some handlers may have AWS-isms baked into the logic that need abstracting.

### Phase 3: Extract GC logic to e3-cloud-core

Same pattern as Phase 2 but for garbage collection.

**Work:**
- Add `GcObjectStore` interface to `e3-cloud-core/src/interfaces.ts`
- Add `InMemoryGcObjectStore` to testing
- Extract GC mark/sweep/cleanup logic → `e3-cloud-core/src/gc/`
- Leave thin wrappers in `e3-aws/src/handlers/gc/`
- Port GC tests
- Build + all tests pass

**Risk:** Medium — GC is more tightly coupled to S3 versioning semantics. May need to iterate on the `GcObjectStore` interface.

### Phase 4: Shared backend factory + cleanup

Polish pass. Create `backends.ts`, deduplicate init code, update all documentation.

**Work:**
- Create `e3-aws/src/backends.ts` — single factory for all AWS backends
- Simplify every handler to use the shared factory
- Remove `e3-aws-storage/src/init.ts` singleton pattern (replaced by factory)
- Resolve remaining code review items (DynamoRefStore typing, duplicate SFN orchestrator)
- Update all README.md files, CLAUDE.md structure section
- Build + all tests pass
- Deploy to dev + integration tests pass

**Risk:** Low — cleanup only.

## Migration notes

- Each phase is independently deployable. No phase leaves the system in a broken state.
- Phase 1 is the foundation — phases 2-4 depend on it but are independent of each other.
- CDK references Lambda handler paths, so Phase 1 must update CDK handler entry points.
- The Docker image for Fargate references an entry point path, so Phase 1 must update the Dockerfile.
- External packages (e3-cloud-client, e3-cloud-cli, e3-cloud-tests) import from `@elaraai/e3-aws-storage` and `@elaraai/e3-aws-api` — these imports must be updated in Phase 1.
