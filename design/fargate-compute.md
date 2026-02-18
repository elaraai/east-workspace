# Task Configs & Sized Compute

## Summary

Three features:

1. **Per-task compute config** — users assign a compute size (`serverless`, `small`, `medium`, `large`, `xlarge`) to tasks. Separate API routes and CLI command.
2. **Per-task timeout config** — users set a timeout override per task. Separate API routes and CLI command.
3. **Schedule improvements** — the schedule's `forceTaskPatterns` field is replaced with a concrete `forceTasks` list. CLI/web provides regex matching against deployed tasks to build the list.

Tasks with a non-serverless compute size run on provisioned infrastructure, lifting the 15-minute timeout and 10 GB memory limits. Tasks default to `serverless` with no config.

## Motivation

The default serverless execution mode imposes hard limits:
- **15-minute maximum timeout** — tasks that run longer simply fail
- **10 GB maximum memory** — insufficient for large dataset processing

Sized compute tiers remove these constraints:
- Tasks can run for **hours** (up to 1 year per state machine execution is the AWS limit)
- Up to **16 vCPU / 64 GB memory** per task (xlarge tier)
- Per-second billing with no idle costs when no tasks are running
- Same container image shared between all execution modes

## East Types

All new types in one place. These are the public-facing data model.

```typescript
// packages/e3-admin-types/src/task-config-types.ts

import {
  StructType, VariantType, NullType, StringType, IntegerType,
  DictionaryType, type ValueTypeOf,
} from '@elaraai/east';

/** Compute size — variant with no associated data per case */
export const ComputeSizeType = VariantType({
  serverless: NullType,
  small: NullType,
  medium: NullType,
  large: NullType,
  xlarge: NullType,
});
export type ComputeSize = ValueTypeOf<typeof ComputeSizeType>;

/** Timeout config */
export const TaskTimeoutType = StructType({
  minutes: IntegerType,          // 5–43200
});
export type TaskTimeout = ValueTypeOf<typeof TaskTimeoutType>;

/** Workspace compute configs — returned by GET /task-configs/compute */
export const ComputeConfigMapType = DictionaryType(StringType, ComputeSizeType);
export type ComputeConfigMap = ValueTypeOf<typeof ComputeConfigMapType>;

/** Workspace timeout configs — returned by GET /task-configs/timeout */
export const TimeoutConfigMapType = DictionaryType(StringType, TaskTimeoutType);
export type TimeoutConfigMap = ValueTypeOf<typeof TimeoutConfigMapType>;
```

Changes to the existing schedule type:

```typescript
// packages/e3-admin-types/src/schedule-types.ts — changes only

export const ScheduleRequestType = StructType({
  cronExpression: StringType,
  timezone: OptionType(StringType),
  forceTasks: ArrayType(StringType),    // was: forceTaskPatterns
  enabled: BooleanType,
  description: OptionType(StringType),
});

export const ScheduleType = StructType({
  // ... existing fields ...
  forceTasks: ArrayType(StringType),    // was: forceTaskPatterns
});
```

## Compute Size Tiers

Users select a named size. The platform maps sizes to infrastructure resources — this mapping is a server-side implementation detail that can change without breaking the API.

| Size | vCPU | Memory | Storage | Typical Use |
|------|------|--------|---------|-------------|
| `serverless` | — | up to 10 GB | — | Default. Quick tasks under 15 min |
| `small` | 2 | 8 GB | 30 GB | Light compute, longer-running tasks |
| `medium` | 4 | 16 GB | 30 GB | Standard compute workloads |
| `large` | 8 | 32 GB | 50 GB | Memory-heavy processing |
| `xlarge` | 16 | 64 GB | 100 GB | Large dataset processing |

### Timeout Defaults

| Compute Size | Default Timeout |
|-------------|----------------|
| `serverless` | 15 minutes |
| `small` / `medium` / `large` / `xlarge` | 1440 minutes (1 day) |

A task's timeout config overrides the default. Range: 5 minutes – 43200 minutes (30 days).

## User Experience

### CLI: Compute

The task name/pattern is a positional argument. `--regex` is a flag that changes interpretation.

```bash
# Set compute size for a single task
e3-cloud compute set <workspace-url> "train-orders" --size medium

# Regex mode — matches against deployed tasks, confirms, then batch writes
e3-cloud compute set <workspace-url> "train.*" --regex --size large
#   Matched 3 tasks: train-orders, train-products, train-customers
#   Set compute size 'large' for 3 tasks? [y/N]

# List compute configs for a workspace
e3-cloud compute list <workspace-url>

# Get compute config for a single task
e3-cloud compute get <workspace-url> "train-orders"

# Remove compute config (reverts to serverless)
e3-cloud compute remove <workspace-url> "train-orders"

# Bulk remove via regex
e3-cloud compute remove <workspace-url> "train.*" --regex
```

### CLI: Timeout

```bash
# Set timeout for a single task
e3-cloud timeout set <workspace-url> "heavy-etl" --timeout 4h

# Bulk set via regex
e3-cloud timeout set <workspace-url> "etl.*" --regex --timeout 2h

# List timeout configs
e3-cloud timeout list <workspace-url>

# Get timeout for a single task (returns effective timeout including default)
e3-cloud timeout get <workspace-url> "train-orders"

# Remove timeout override (reverts to default for compute size)
e3-cloud timeout remove <workspace-url> "heavy-etl"
```

### CLI: Schedule Force-Tasks

The schedule command gains `--force-tasks` and `--force-regex`:

```bash
# Set schedule with explicit force-tasks list
e3-cloud schedule set <workspace-url> \
  --cron "0 2 * * *" \
  --force-tasks "input-orders,input-products"

# Or use regex to build the list from deployed tasks
e3-cloud schedule set <workspace-url> \
  --cron "0 2 * * *" \
  --force-regex "input.*"
#   Matched 2 tasks: input-orders, input-products
#   Set as force-tasks? [y/N]
```

The `--force-regex` flag is resolved client-side — the API only stores concrete task names.

### Client-Side Regex Flow

When `--regex` is set (or `--force-regex` for schedules):

```
1. CLI fetches task list:  GET /api/repos/:repo/workspaces/:ws/tasks
2. CLI filters by regex:   taskNames.filter(name => regex.test(name))
3. CLI shows matches and confirms
4. CLI POSTs batch
```

### Default Behaviour

- **No compute config** → `serverless` (returned by GET)
- **No timeout config** → default for compute size (15 min serverless, 1 day sized; returned by GET)

The server always returns the effective value on GET, even for tasks with no explicit config.

## API Routes

All request and response bodies are **BEAST2-encoded** East values, consistent with the existing e3 API. The East type objects (`ComputeSizeType`, `TaskTimeoutType`, etc.) are used for both encoding/decoding on the server and for client-side type safety.

### Compute

```
GET    /api/repos/:repo/workspaces/:ws/task-configs/compute            → { [taskName]: ComputeSize }
POST   /api/repos/:repo/workspaces/:ws/task-configs/compute            → { [taskName]: ComputeSize }
         Body: { [taskName]: ComputeSize }
GET    /api/repos/:repo/workspaces/:ws/task-configs/compute/:task      → ComputeSize
PUT    /api/repos/:repo/workspaces/:ws/task-configs/compute/:task      → ComputeSize
         Body: ComputeSize
DELETE /api/repos/:repo/workspaces/:ws/task-configs/compute/:task      → 204
```

- GET collection returns only tasks with **explicit** configs (not every task as `serverless`)
- GET individual returns the explicit config, or `variant('serverless')` if none exists
- PUT `variant('serverless')` is equivalent to DELETE (removes the config entry)

### Timeout

```
GET    /api/repos/:repo/workspaces/:ws/task-configs/timeout            → { [taskName]: TaskTimeout }
POST   /api/repos/:repo/workspaces/:ws/task-configs/timeout            → { [taskName]: TaskTimeout }
         Body: { [taskName]: TaskTimeout }
GET    /api/repos/:repo/workspaces/:ws/task-configs/timeout/:task      → TaskTimeout
PUT    /api/repos/:repo/workspaces/:ws/task-configs/timeout/:task      → TaskTimeout
         Body: TaskTimeout
DELETE /api/repos/:repo/workspaces/:ws/task-configs/timeout/:task      → 204
```

- GET collection returns only tasks with **explicit** timeout overrides
- GET individual returns the explicit config, or `{ minutes: 15 }` (serverless default) / `{ minutes: 1440 }` (sized default) based on the task's compute config

### Unified View

```
GET    /api/repos/:repo/workspaces/:ws/task-configs                    → { compute: ComputeConfigMap, timeout: TimeoutConfigMap }
```

Returns both dimensions. Only tasks with explicit configs appear in each map.

### Schedules (changes only)

The existing schedule routes are unchanged. The `ScheduleRequestType` body changes:
- `forceTaskPatterns: string[]` → `forceTasks: string[]`

This is a **breaking change** to the schedule API.

### Validation

All validation is server-side:
- **compute:** must be a valid `ComputeSize` variant
- **timeout:** minutes must be 5–43200
- **Task existence:** task names validated against deployed workspace — unknown tasks rejected with a clear error

## Data Model

### DynamoDB Schema

Two items per configured task, stored in the shared single-table:

```
PK: TASKCONFIG/{repo}/{workspace}
SK: compute#{taskName}       → BEAST2-encoded ComputeSize
SK: timeout#{taskName}       → BEAST2-encoded TaskTimeout
```

- **List one dimension:** Query with `SK begins_with compute#` or `SK begins_with timeout#`
- **List all:** Query `PK = TASKCONFIG/{repo}/{workspace}`
- **Get one:** GetItem with exact PK/SK
- **Batch write:** BatchWriteItem for the POST dictionary
- **Cleanup:** Query by PK, then batch delete

Schedule `forceTasks` is stored as part of the existing schedule item (replaces `forceTaskPatterns`).

### Store Interface (`e3-admin-core`)

```typescript
// packages/e3-admin-core/src/task-config-store.ts
interface TaskConfigStore {
  // Compute
  getCompute(repo: string, workspace: string, taskName: string): Promise<ComputeSize | null>;
  putCompute(repo: string, workspace: string, taskName: string, size: ComputeSize): Promise<void>;
  putComputeBatch(repo: string, workspace: string, configs: Record<string, ComputeSize>): Promise<void>;
  deleteCompute(repo: string, workspace: string, taskName: string): Promise<void>;
  deleteComputeBatch(repo: string, workspace: string, taskNames: string[]): Promise<void>;
  listCompute(repo: string, workspace: string): Promise<Record<string, ComputeSize>>;

  // Timeout
  getTimeout(repo: string, workspace: string, taskName: string): Promise<TaskTimeout | null>;
  putTimeout(repo: string, workspace: string, taskName: string, timeout: TaskTimeout): Promise<void>;
  putTimeoutBatch(repo: string, workspace: string, configs: Record<string, TaskTimeout>): Promise<void>;
  deleteTimeout(repo: string, workspace: string, taskName: string): Promise<void>;
  deleteTimeoutBatch(repo: string, workspace: string, taskNames: string[]): Promise<void>;
  listTimeout(repo: string, workspace: string): Promise<Record<string, TaskTimeout>>;

  // Cleanup
  deleteAllForWorkspace(repo: string, workspace: string): Promise<void>;
  deleteAllForRepo(repo: string): Promise<void>;
}
```

## Execution Flow

### dispatch-task Changes

The dispatch-task handler reads both configs and adds routing information:

```typescript
const computeSize = await storage.taskConfigs.getCompute(repo, workspace, taskName);
const timeoutConfig = await storage.taskConfigs.getTimeout(repo, workspace, taskName);

const effectiveCompute = computeSize ?? variant('serverless');
const isServerless = effectiveCompute.type === 'serverless';
const timeoutMinutes = timeoutConfig?.minutes
  ?? (isServerless ? 15 : 1440);

return {
  // ... existing fields (taskName, status, taskHash, inputHashes, etc.) ...
  computeSize: effectiveCompute,
  timeoutMinutes,
};
```

### DispatchTaskResult Extension

```typescript
export interface DispatchTaskResult {
  taskName: string;
  status: 'ready' | 'cached' | 'not_ready' | 'cancelled';
  outputHash?: string;
  taskHash?: string;
  inputHashes?: string[];
  outputPath?: string;
  taskExecutionId?: string;
  cached: boolean;
  /** Compute size — variant('serverless') for default execution */
  computeSize: ComputeSize;
  /** Resolved timeout in minutes */
  timeoutMinutes: number;
}
```

The size → infrastructure mapping (CPU units, memory MiB, storage GiB) is resolved in a **Pass state** in the state machine, not in dispatch-task. This keeps the dispatch result clean and the mapping in one place.

### State Machine Changes

```
DispatchTaskState
  → IsNotReady? → SkipNotReady
  → IsCached? → PrepareCachedWrite
  → ChooseExecutor (NEW, checks computeSize.type)
    → not 'serverless' → ResolveComputeParams (Pass, maps size → cpu/memory/storage)
      → ExecuteTaskComputeState (EcsRunTask)
        → CollectComputeResult → DidComputeSucceed? → ...
    → 'serverless' → ExecuteTaskState (existing)
      → DidExecutionSucceed? → ...
```

The `ResolveComputeParams` Pass state maps `computeSize` to the actual CPU units, memory MiB, storage GiB, and timeout ISO duration needed by EcsRunTask. This keeps the mapping defined once in CDK rather than duplicated in Lambda code.

### Timeout Enforcement

Step Functions owns the timeout via `taskTimeout` on both paths. The container is not trusted to self-enforce. If the timeout fires, Step Functions stops the task and the error propagates through `apply-results`.

### Result Handling

The compute container writes its `TaskExecutionResult` to a well-known DynamoDB key before exiting. A thin `collect-compute-result` handler reads and deletes it:

```
PK: COMPUTE_RESULT/{repo}/{workspace}
SK: {taskExecutionId}
Attributes: result (BEAST2-encoded), ttl (1 hour)
```

Short TTL handles orphaned results. This keeps `apply-results` completely unchanged.

### Compute Container Entrypoint

Same Docker image, different entrypoint:

```typescript
// packages/e3-aws-runner/src/handlers/execute-task-compute-entry.ts
const event = JSON.parse(process.env.TASK_EVENT!);
const { executeTask } = await import('./execute-task-core.js');
const result = await executeTask(event);
// Write result to DynamoDB, then exit
process.exit(result.status === 'success' ? 0 : 1);
```

Requires refactoring `execute-task.ts` into `execute-task-core.ts` (shared logic) + serverless entry + compute entry.

## CDK Infrastructure

### New Resources

| Resource | Type | Cost | Purpose |
|----------|------|------|---------|
| `ComputeVpc` | `ec2.Vpc` | Free | VPC with public subnets |
| `ComputeTaskSg` | `ec2.SecurityGroup` | Free | Deny inbound, allow outbound |
| `ComputeCluster` | `ecs.Cluster` | Free | ECS cluster |
| `ComputeTaskDef` | `ecs.FargateTaskDefinition` | Free | Base task definition (overridden per size) |
| `ComputeTaskLogs` | `logs.LogGroup` | Pay per use | CloudWatch logs |
| `ExecuteTaskComputeState` | `tasks.EcsRunTask` | Pay per use | Step Functions compute execution |
| `CollectComputeResultFn` | `NodejsFunction` | Pay per use | Reads compute task results |
| `SociIndexBuilder` | `cfn.CfnStack` | Free | Auto-generates SOCI indexes on ECR push |

### VPC

**Decision: Public subnets with assigned public IPs (scale-to-zero cost).**

Matches the security posture of existing serverless execution:
- Security groups deny all inbound traffic
- IAM roles control access to AWS services
- All traffic TLS encrypted
- Public IPs billed only while a task runs (~$0.0008 per 10-minute task)

**Enterprise alternative:** Private subnets + NAT Gateway (~$76/month for 2 AZs). CDK config change only.

## Container Image Optimization

### SOCI v2 Lazy Loading (deployed)

The [SOCI Index Builder](https://github.com/awslabs/cfn-ecr-aws-soci-index-builder) CloudFormation stack is deployed in CDK. It auto-generates Seekable OCI indexes on ECR push via EventBridge. Fargate automatically detects and uses SOCI indexes for lazy container loading — containers start without waiting for the full image pull.

This is particularly effective for our image because `east-py-datascience` (numpy, pandas, etc.) comprises the bulk of the image size but is rarely used at runtime. SOCI lazy-loads these layers on demand rather than pulling them upfront.

**Performance:** ~40-50% faster cold starts for images >250 MB. SOCI v2 is the default on Fargate as of 2025 and provides improved deployment consistency via cryptographic verification.

### zstd Compression (rejected)

~~Switch `docker build` to `docker buildx build` with `compression=zstd,oci-mediatypes=true`.~~

**Decision: Do not use zstd.** SOCI lazy loading is incompatible with zstd-compressed layers ([soci-snapshotter#519](https://github.com/awslabs/soci-snapshotter/issues/519)). The fundamental blocker is that zstd uses variable compression windows up to 2 GB (vs gzip's 32 KB), making post-hoc indexing impractical. SOCI provides a larger benefit (~40-50%) than zstd (~27%), and our image benefits significantly from lazy loading due to the large rarely-used datascience layers. Additionally, zstd support on Lambda is undocumented and we share one image for both Lambda and Fargate execution.

## Orphaned Config Cleanup

On workspace deploy, the deploy handler (in `e3-aws-api`) automatically cleans up configs referencing tasks no longer in the deployed package. This runs after e3-core's deploy completes and releases its lock:

```typescript
// In e3-aws middleware wrapping the workspace deploy route, after e3-core returns:
const deployedTasks = getDeployedTaskNames(workspace);
const computeConfigs = await storage.taskConfigs.listCompute(repo, workspace);
const timeoutConfigs = await storage.taskConfigs.listTimeout(repo, workspace);
const orphanedCompute = Object.keys(computeConfigs).filter(t => !deployedTasks.includes(t));
const orphanedTimeout = Object.keys(timeoutConfigs).filter(t => !deployedTasks.includes(t));
if (orphanedCompute.length > 0) {
  await storage.taskConfigs.deleteComputeBatch(repo, workspace, orphanedCompute);
}
if (orphanedTimeout.length > 0) {
  await storage.taskConfigs.deleteTimeoutBatch(repo, workspace, orphanedTimeout);
}
console.log('Orphan cleanup', { orphanedCompute, orphanedTimeout });
```

- Silent to the user — logged to CloudWatch for operational visibility
- No changes to e3-core or the deploy response type (East structs are not extensible)
- Runs **after** e3-core releases the deployment lock — safe because orphan deletion is idempotent and only removes configs for tasks that no longer exist in the deployed workspace
- Note: deployment itself runs in a **single Lambda invocation** (not Step Functions). e3-core acquires/releases the `variant('deployment', null)` lock internally with try/finally. If the Lambda crashes mid-deploy, the lock is held until TTL (5 minutes).

Configs also cascade-delete on workspace deletion and repository deletion.

## Locking

Config mutation endpoints acquire the workspace lock in-process, same pattern as deployment/removal/dataset_write in e3-core:

```typescript
// In each config PUT/POST/DELETE handler:
const lock = await storage.locks.acquire(repo, `workspace/${workspace}`, variant('dataset_write', null), { wait: false });
if (!lock) {
  return { statusCode: 409, body: 'Workspace is locked' };
}
try {
  // batch writes, deletes, etc.
  console.log(`Task config updated`, { repo, workspace, action, identity: identity?.sub, email: identity?.email });
} finally {
  await lock.release();
}
```

All config mutations are audit-logged to CloudWatch with the requestor's `sub` and `email` from the JWT identity, following the existing pattern used by repo deletion and GC.

This prevents concurrent config edits and avoids races with deployment (which cleans up orphaned configs). Uses the existing `dataset_write` lock operation (may be renamed to `write` in future).

The new sized compute states added to the dataflow state machine (Phase 5) must follow the existing catch pattern: `addCatch(prepareFinalizeFailure)` on `ChooseExecutor`, `ResolveComputeParams`, `ExecuteTaskComputeState`, and `CollectComputeResult` to ensure lock release on failure.

## Package Map

| Package | What it gets |
|---------|-------------|
| `e3-admin-types` | `ComputeSizeType`, `TaskTimeoutType`, `ComputeConfigMapType`, `TimeoutConfigMapType` — East type objects + TS types |
| `e3-admin-core` | `TaskConfigStore` interface |
| `e3-aws-storage` | `DynamoTaskConfigStore` — implements `TaskConfigStore` using DynamoDB + BEAST2 encode/decode |
| `e3-aws-api` | Route handlers for `/task-configs/compute`, `/task-configs/timeout`, `/task-configs`. BEAST2 decode request bodies, encode responses. |
| `e3-admin-client` | `getCompute`, `setCompute`, `setComputeBatch`, `removeCompute`, `listCompute` + same for timeout + `listTaskConfigs`. BEAST2 encode requests, decode responses. |
| `e3-cloud-cli` | `compute` and `timeout` commands. Uses `e3-admin-client`. Client-side regex resolution. |
| `e3-aws-runner` | `dispatch-task.ts` reads configs via `TaskConfigStore`. `execute-task-core.ts` + `execute-task-compute-entry.ts` new files. |
| `cdk/platform` | ECS Cluster, VPC, Task Definition, state machine changes, `collect-compute-result` Lambda, SOCI Index Builder |

## Implementation Plan

### Phase 1: Types + Store (foundation) — Done
1. **`e3-admin-types`**: Add `task-config-types.ts` with `ComputeSizeType`, `TaskTimeoutType`, `ComputeConfigMapType`, `TimeoutConfigMapType`
2. **`e3-admin-core`**: Add `task-config-store.ts` with `TaskConfigStore` interface
3. **`e3-aws-storage`**: Implement `DynamoTaskConfigStore`
   - BEAST2 encode/decode using `ComputeSizeType` and `TaskTimeoutType`
   - DynamoDB PK: `TASKCONFIG/{repo}/{workspace}`, SK: `compute#{taskName}` / `timeout#{taskName}`
   - `putBatch` / `deleteBatch` use `BatchWriteItem` (25-item DynamoDB limit per batch, chunk if needed)
   - `deleteAllForWorkspace` / `deleteAllForRepo` query + batch delete

### Phase 2: Compute API + CLI — Done
4. **`e3-aws-api`**: Add compute route handlers in `task-config-routes.ts`
   - All mutation handlers (`PUT`, `POST`, `DELETE`) acquire workspace lock with `variant('dataset_write', null)`, try/finally release
   - `GET /task-configs/compute` → query `SK begins_with compute#`, BEAST2 decode, return as `ComputeConfigMapType`
   - `POST /task-configs/compute` → BEAST2 decode body as `ComputeConfigMapType`, validate task names against workspace, `putComputeBatch`
   - `GET /task-configs/compute/:task` → `getCompute`, return explicit or `variant('serverless')` default
   - `PUT /task-configs/compute/:task` → validate, `putCompute` (or `deleteCompute` if `variant('serverless')`)
   - `DELETE /task-configs/compute/:task` → `deleteCompute`
5. **`e3-admin-client`**: Add compute client functions — BEAST2 encode requests, decode responses
6. **`e3-cloud-cli`**: Add `compute` command with `set`, `list`, `get`, `remove` subcommands. `--regex` flag does client-side resolution via task list API.

### Phase 3: Timeout API + CLI — Done
7. **`e3-aws-api`**: Add timeout route handlers (same pattern as compute, same locking)
   - `GET /task-configs/timeout/:task` returns effective default based on task's compute config when no explicit override
8. **`e3-aws-api`**: Add unified `GET /task-configs` route — queries all `TASKCONFIG/` items, splits by SK prefix, returns `{ compute: ..., timeout: ... }`
9. **`e3-admin-client`**: Add timeout client functions
10. **`e3-cloud-cli`**: Add `timeout` command

### Phase 4: Schedule Force-Tasks Migration — Done
11. **`e3-admin-types`**: Change `forceTaskPatterns` → `forceTasks` in `ScheduleType` and `ScheduleRequestType`
12. **`e3-aws-api`** / **`e3-aws-storage`**: Update schedule routes and DynamoDB store for renamed field
13. **`e3-aws-runner`**: Update `schedule-trigger.ts` to use `forceTasks` directly (no pattern resolution)
14. **`e3-cloud-cli`**: Update schedule command with `--force-tasks` and `--force-regex` flags
15. **Migration**: One-time script to resolve existing `forceTaskPatterns` → concrete task names for deployed schedules

### Phase 5: Sized Compute Execution + Deploy Cleanup — Done
16. **`e3-aws-api`**: Add orphan cleanup to deploy handler — after e3-core deploy returns, compare deployed task names against stored configs, delete orphans, log to CloudWatch
17. **`cdk/platform`**: Add VPC (public subnets, no NAT), security group, ECS Cluster, task definition, CloudWatch log group
18. **`e3-aws-runner`**: Refactor `execute-task.ts` → `execute-task-core.ts` (shared logic) + serverless entry + `execute-task-compute-entry.ts`
19. **`e3-aws-runner`**: Add `collect-compute-result.ts` handler — reads `COMPUTE_RESULT/` from DynamoDB, returns `TaskExecutionResult`
20. **`cdk/platform`**: Add state machine changes — `ChooseExecutor` Choice, `ResolveComputeParams` Pass, `ExecuteTaskComputeState` EcsRunTask, `CollectComputeResult` Lambda. All new states must `addCatch(prepareFinalizeFailure)`.
21. **`e3-aws-runner`**: Modify `dispatch-task.ts` to read task configs via `TaskConfigStore`, populate `computeSize` and `timeoutMinutes` on result
22. **`docker/Dockerfile.runner`**: Add compute entrypoint file to image

### Phase 6: Image Optimization — Done
23. ~~**`scripts/build-runner.sh`**: Switch to `docker buildx build` with `compression=zstd,oci-mediatypes=true`~~ — **Rejected:** zstd is incompatible with SOCI lazy loading
24. **`cdk/platform`**: Deploy SOCI Index Builder CloudFormation stack — **Done**
25. **`scripts/build-runner.sh`**: Add `--pull` flag to ensure fresh base image on rebuild — **Done**

### Phase 7: Testing + Documentation — Done
26. Integration tests: compute config CRUD, timeout config CRUD, unified view, sized compute execution end-to-end, orphan cleanup on workspace deploy, schedule force-tasks
27. Update CLAUDE.md, package README files, deployment docs

## Resolved Decisions

1. **Config structure** — Compute and timeout are separate features with separate routes, DynamoDB entries, and CLI commands.
2. **Compute type** — `VariantType` with `serverless | small | medium | large | xlarge`. Server returns `serverless` default on GET for unconfigured tasks.
3. **Timeout defaults** — Server returns effective timeout on GET: 15 min (serverless) or 1440 min (sized). Explicit overrides stored separately.
4. **Config granularity** — Per concrete task name. No server-side globs. Client-side regex for bulk CLI operations.
5. **Compute sizes** — Predefined tiers. Size → resource mapping is server-side only.
6. **Schedule force-tasks** — `forceTaskPatterns` → `forceTasks` (concrete names). Breaking change. CLI/web handles regex client-side.
7. **VPC** — Public subnets, no NAT Gateway. Scale-to-zero cost. Private subnet option for enterprise.
8. **Timeout enforcement** — Step Functions owns timeout. Container not trusted to self-enforce.
9. **Orphaned configs** — Auto-deleted on workspace deploy, after e3-core returns. Logged to CloudWatch. No e3-core changes needed.
10. **Locking** — Config mutations acquire the workspace lock in-process (try/finally) using existing `dataset_write` operation. No e3-types changes needed. New compute states in the state machine must `addCatch(prepareFinalizeFailure)`.
11. **Cost visibility** — No. We may charge differently from infrastructure cost.
12. **Concurrency** — No artificial limit. vCPU-based quotas (4,000 default), dependency graph, and retry policies handle natural throttling.

## Future Work: ECS Workers

The current Fargate task model launches a fresh container per task (~150s cold start). An ECS worker model would keep containers warm between tasks for sub-second execution after the first cold start.

### Architecture

- One SQS queue + one ECS Service (desiredCount: 0) per compute size (small/medium/large/xlarge)
- Lambda-driven scale-up: Step Functions sends `{event, taskToken}` to SQS; a Lambda ensures the ECS service is running
- Worker self-shutdown: after idle timeout (e.g. 5 min with no messages), worker sets own service desiredCount to 0 and exits
- Same WAIT_FOR_TASK_TOKEN integration — worker calls SendTaskSuccess/SendTaskFailure after execution

### Performance

Warm worker experiment (2026-02-18):
- Cold start (job 1): 203.9s total (container boot dominates)
- Warm start (job 2): 892ms total (228x speedup)
- Chain-5 dataflow: ~17 min (Fargate tasks) → estimated ~30s (warm workers)

### Cost

- Fixed: ~$0.40/month (CloudWatch alarms for queue depth monitoring)
- Compute: identical $/vCPU-second and $/GB-second rates as Fargate tasks
- Idle drain: worker runs ~5 min after last job before scaling to zero
- Scale-to-zero: $0 when no jobs are running

### Scaling

For heavy workloads (multiple parallel tasks of the same compute size):
- Lambda sets desiredCount to match queue depth (capped at MAX_WORKERS)
- Each worker self-terminates when idle, decrementing desiredCount
- No CloudWatch autoscaling policies — scaling is deterministic and Lambda-driven

### Tradeoffs vs Fargate Tasks

| | Fargate Tasks (current) | ECS Workers |
|---|---|---|
| Scaling | AWS handles it | We build and maintain it |
| Parallelism | Unlimited, automatic | Managed worker count |
| Cold start | Every task (~150s) | First task only, then <1s |
| Failure isolation | Built-in, per-task | We handle retries/failures |
| Complexity | ~0 operational | Medium, ongoing |
