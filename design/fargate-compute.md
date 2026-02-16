# Sized Compute Tasks

## Summary

Add the ability for users to configure per-task settings for compute, timeout, and schedule-force. Tasks with a compute config run in a **sized compute** tier (`small`, `medium`, `large`, `xlarge`) instead of the default **serverless** mode, lifting the 15-minute timeout and 10 GB memory limits. Tasks without any config continue to run in serverless mode with default settings (unchanged).

Per-task configs are stored against **concrete task names** (no server-side globs or patterns). The CLI provides client-side regex matching against deployed tasks for bulk configuration. The API is structured as three independent dimensions — compute, timeout, and schedule — with separate routes for each.

## Motivation

The default serverless execution mode imposes hard limits:
- **15-minute maximum timeout** — tasks that run longer simply fail
- **10 GB maximum memory** — insufficient for large dataset processing
- **No GPU support** — blocks ML/AI workloads entirely

Sized compute tiers remove these constraints:
- Tasks can run for **hours** (up to 24 hours per state machine execution)
- Up to **16 vCPU / 64 GB memory** per task (xlarge tier)
- Per-second billing with no idle costs when no tasks are running
- Same container image is shared between all execution modes

## User Experience

### CLI Commands

Three separate command groups, one per config dimension:

```bash
# --- Compute configs ---

# Set compute size for a single task
e3-cloud compute set https://dev.e3.elaraai.com/repos/my-repo/workspaces/main \
  --task "train-orders" \
  --size medium

# Set compute size for tasks matching a regex (resolved client-side against deployed tasks)
e3-cloud compute set https://dev.e3.elaraai.com/repos/my-repo/workspaces/main \
  --regex "train.*" \
  --size large
# CLI output:
#   Matched 3 tasks: train-orders, train-products, train-customers
#   Apply compute size 'large' to 3 tasks? [y/N]

# List compute configs for a workspace
e3-cloud compute list https://dev.e3.elaraai.com/repos/my-repo/workspaces/main

# Get compute config for a single task
e3-cloud compute get https://dev.e3.elaraai.com/repos/my-repo/workspaces/main \
  --task "train-orders"

# Remove compute config for a task (reverts to serverless)
e3-cloud compute remove https://dev.e3.elaraai.com/repos/my-repo/workspaces/main \
  --task "train-orders"

# Remove compute config for tasks matching a regex
e3-cloud compute remove https://dev.e3.elaraai.com/repos/my-repo/workspaces/main \
  --regex "train.*"

# --- Timeout configs ---

# Set timeout for tasks matching a regex
e3-cloud timeout set https://dev.e3.elaraai.com/repos/my-repo/workspaces/main \
  --regex "etl.*" \
  --timeout 4h

# List timeout configs
e3-cloud timeout list https://dev.e3.elaraai.com/repos/my-repo/workspaces/main

# --- Schedule-force configs ---

# Mark tasks to be force-run by schedule (skips cache)
e3-cloud schedule-force set https://dev.e3.elaraai.com/repos/my-repo/workspaces/main \
  --regex "input.*"

# List schedule-force configs
e3-cloud schedule-force list https://dev.e3.elaraai.com/repos/my-repo/workspaces/main
```

The `--task` flag sets a single task. The `--regex` flag fetches the deployed task list from the API, matches against it, confirms with the user, and POSTs a batch. The two flags are mutually exclusive.

### Client-Side Regex Flow

```
1. CLI fetches task list:  GET /api/repos/:repo/workspaces/:ws/tasks
2. CLI filters by regex:   taskNames.filter(name => regex.test(name))
3. CLI shows matches:      "Matched 3 tasks: train-orders, train-products, train-customers"
4. CLI confirms:           "Apply compute size 'large' to 3 tasks? [y/N]"
5. CLI POSTs batch:        POST /api/repos/:repo/workspaces/:ws/task-configs/compute
                           Body: { "train-orders": { "size": "large" }, ... }
```

A future web UI can present the same flow with a filter box / checkbox system.

### Compute Size Tiers

Users select a named size. The platform maps sizes to infrastructure resources — this mapping is an implementation detail that can change without breaking the API.

| Size | vCPU | Memory | Storage | Typical Use |
|------|------|--------|---------|-------------|
| `small` | 2 | 8 GB | 30 GB | Light compute, longer-running tasks |
| `medium` | 4 | 16 GB | 30 GB | Standard compute workloads |
| `large` | 8 | 32 GB | 50 GB | Memory-heavy processing |
| `xlarge` | 16 | 64 GB | 100 GB | Large dataset processing |

All sizes use the same container image. The only user-facing parameter is the size name.

### Timeout Config Options

| Option | Flag | Required | Default | Range |
|--------|------|----------|---------|-------|
| Timeout | `--timeout` | Yes | — | 5m–24h (e.g. "30m", "2h", "1h30m") |

Tasks with no timeout config use the platform default: 15 minutes for serverless tasks, 1 hour for sized compute tasks (those with a compute config).

### Schedule-Force Config

No options beyond the task selection. A task either has schedule-force enabled or it doesn't. This replaces the `forceTaskPatterns` field on the schedule object.

### Default Behaviour

Tasks with **no config** use platform defaults — no config means no config, not an empty config object. Specifically:
- **No compute config** → runs in serverless mode (10 GB memory, 15-minute timeout)
- **No timeout config** → serverless default (15 min) or sized compute default (1 hour) depending on execution target
- **No schedule-force** → task uses cache normally during scheduled runs

## Architecture

### API Routes

Three separate route groups, one per dimension. Each has an individual task resource and a collection with batch POST.

#### Compute

```
GET    /api/repos/:repo/workspaces/:ws/task-configs/compute            → { [taskName]: ComputeConfig }
POST   /api/repos/:repo/workspaces/:ws/task-configs/compute            → { [taskName]: ComputeConfig }
         Body: { [taskName]: { size } }
GET    /api/repos/:repo/workspaces/:ws/task-configs/compute/:task      → ComputeConfig
PUT    /api/repos/:repo/workspaces/:ws/task-configs/compute/:task      → ComputeConfig
         Body: { size }
DELETE /api/repos/:repo/workspaces/:ws/task-configs/compute/:task      → 204
```

#### Timeout

```
GET    /api/repos/:repo/workspaces/:ws/task-configs/timeout            → { [taskName]: TimeoutConfig }
POST   /api/repos/:repo/workspaces/:ws/task-configs/timeout            → { [taskName]: TimeoutConfig }
         Body: { [taskName]: { minutes } }
GET    /api/repos/:repo/workspaces/:ws/task-configs/timeout/:task      → TimeoutConfig
PUT    /api/repos/:repo/workspaces/:ws/task-configs/timeout/:task      → TimeoutConfig
         Body: { minutes }
DELETE /api/repos/:repo/workspaces/:ws/task-configs/timeout/:task      → 204
```

#### Schedule-Force

```
GET    /api/repos/:repo/workspaces/:ws/task-configs/schedule           → { [taskName]: ScheduleForceConfig }
POST   /api/repos/:repo/workspaces/:ws/task-configs/schedule           → { [taskName]: ScheduleForceConfig }
         Body: { [taskName]: { force: true } }
GET    /api/repos/:repo/workspaces/:ws/task-configs/schedule/:task     → ScheduleForceConfig
PUT    /api/repos/:repo/workspaces/:ws/task-configs/schedule/:task     → ScheduleForceConfig
         Body: { force: true }
DELETE /api/repos/:repo/workspaces/:ws/task-configs/schedule/:task     → 204
```

#### Unified View

```
GET    /api/repos/:repo/workspaces/:ws/task-configs                    → AllTaskConfigs
```

Returns:
```json
{
  "compute":  { "train-orders": { "size": "medium" }, "train-products": { "size": "large" }, ... },
  "timeout":  { "heavy-etl": { "minutes": 240 }, ... },
  "schedule": { "input-orders": { "force": true }, ... }
}
```

The structure mirrors the route hierarchy. A task only appears in a dictionary if it has an explicit config for that dimension.

#### Validation

All validation happens server-side on the POST/PUT handlers:

- **Compute:** size must be one of `small`, `medium`, `large`, `xlarge`
- **Timeout:** minutes must be 5–1440
- **Schedule-force:** `force` must be `true` (DELETE to remove, don't set `false`)
- **Task existence:** All task names validated against the deployed workspace — reject unknown tasks with a clear error listing which names were invalid

### Data Model

#### DynamoDB Schema

All three dimensions stored in the shared single-table. One item per task per dimension:

```
PK: TASKCONFIG/{repo}/{workspace}
SK: compute#{taskName}       → BEAST2-encoded ComputeConfig
SK: timeout#{taskName}       → BEAST2-encoded TimeoutConfig
SK: schedule#{taskName}      → BEAST2-encoded ScheduleForceConfig
```

This allows:
- **List all configs for a workspace:** Query `PK = TASKCONFIG/{repo}/{workspace}` (returns all three dimensions)
- **List one dimension:** Query with `SK begins_with compute#` (or `timeout#` or `schedule#`)
- **Get one task's config:** GetItem with exact PK/SK
- **Batch write:** BatchWriteItem for the POST dictionary
- **Cleanup:** Query by PK prefix, then batch delete

#### East Types (`e3-admin-types`)

```typescript
// packages/e3-admin-types/src/task-config-types.ts

export const ComputeSizeType = StringEnumType(['small', 'medium', 'large', 'xlarge']);

export const ComputeConfigType = StructType({
  size: ComputeSizeType,         // Named size tier
});

export const TimeoutConfigType = StructType({
  minutes: IntegerType,          // 5–1440
});

export const ScheduleForceConfigType = StructType({
  force: BooleanType,            // always true (delete to remove)
});

// Unified view returned by GET /task-configs
export const AllTaskConfigsType = StructType({
  compute: DictionaryType(StringType, ComputeConfigType),
  timeout: DictionaryType(StringType, TimeoutConfigType),
  schedule: DictionaryType(StringType, ScheduleForceConfigType),
});
```

#### Store Interface (`e3-admin-core`)

```typescript
// packages/e3-admin-core/src/task-config-store.ts

interface TaskConfigStore {
  // Compute
  getCompute(repo: string, workspace: string, taskName: string): Promise<ComputeConfig | null>;
  putCompute(repo: string, workspace: string, taskName: string, config: ComputeConfig): Promise<void>;
  deleteCompute(repo: string, workspace: string, taskName: string): Promise<void>;
  listCompute(repo: string, workspace: string): Promise<Record<string, ComputeConfig>>;

  // Timeout
  getTimeout(repo: string, workspace: string, taskName: string): Promise<TimeoutConfig | null>;
  putTimeout(repo: string, workspace: string, taskName: string, config: TimeoutConfig): Promise<void>;
  deleteTimeout(repo: string, workspace: string, taskName: string): Promise<void>;
  listTimeout(repo: string, workspace: string): Promise<Record<string, TimeoutConfig>>;

  // Schedule-force
  getScheduleForce(repo: string, workspace: string, taskName: string): Promise<ScheduleForceConfig | null>;
  putScheduleForce(repo: string, workspace: string, taskName: string, config: ScheduleForceConfig): Promise<void>;
  deleteScheduleForce(repo: string, workspace: string, taskName: string): Promise<void>;
  listScheduleForce(repo: string, workspace: string): Promise<Record<string, ScheduleForceConfig>>;

  // Unified
  listAll(repo: string, workspace: string): Promise<AllTaskConfigs>;

  // Cleanup
  deleteAllForWorkspace(repo: string, workspace: string): Promise<void>;
  deleteAllForRepo(repo: string): Promise<void>;
}
```

### API Client (`e3-admin-client`)

```typescript
// packages/e3-admin-client/src/task-configs.ts

// Compute
export async function getComputeConfig(url, repo, workspace, taskName, options);
export async function setComputeConfig(url, repo, workspace, taskName, config, options);
export async function setComputeConfigs(url, repo, workspace, configs: Record<string, ComputeConfig>, options);
export async function removeComputeConfig(url, repo, workspace, taskName, options);
export async function listComputeConfigs(url, repo, workspace, options);

// Timeout
export async function getTimeoutConfig(url, repo, workspace, taskName, options);
export async function setTimeoutConfig(url, repo, workspace, taskName, config, options);
export async function setTimeoutConfigs(url, repo, workspace, configs: Record<string, TimeoutConfig>, options);
export async function removeTimeoutConfig(url, repo, workspace, taskName, options);
export async function listTimeoutConfigs(url, repo, workspace, options);

// Schedule-force
export async function getScheduleForceConfig(url, repo, workspace, taskName, options);
export async function setScheduleForceConfig(url, repo, workspace, taskName, config, options);
export async function setScheduleForceConfigs(url, repo, workspace, configs: Record<string, ScheduleForceConfig>, options);
export async function removeScheduleForceConfig(url, repo, workspace, taskName, options);
export async function listScheduleForceConfigs(url, repo, workspace, options);

// Unified
export async function listAllTaskConfigs(url, repo, workspace, options);
```

### Orphaned Config Cleanup

When a workspace is deployed and the task set changes, configs may reference tasks that no longer exist. The deploy step handles this with **warn + auto-delete**:

1. After a successful workspace deploy, the API compares existing task config names against the new task set
2. Configs referencing removed tasks are deleted
3. The deploy response includes the list of removed configs

```
Deployed workspace 'main' (12 tasks)
Removed 2 orphaned task configs:
  compute: heavy-etl
  schedule: old-transform
```

This keeps the config clean without requiring manual maintenance. If a task is re-added later, it gets reconfigured — simpler than managing orphaned state.

### Impact on Schedules

The schedule object's `forceTaskPatterns` field is **replaced** by the schedule-force task configs. The schedule trigger handler changes:

```typescript
// schedule-trigger.ts — before:
const forceTasks = resolveForceTaskPatterns(schedule.forceTaskPatterns, taskGraph);

// schedule-trigger.ts — after:
const scheduleConfigs = await storage.taskConfigs.listScheduleForce(repo, workspace);
const forceTasks = Object.keys(scheduleConfigs);
```

This is a **breaking change** to the schedule API — `forceTaskPatterns` is removed from `ScheduleRequestType`. Existing schedules need migration (move patterns → resolve to concrete tasks → write as schedule-force configs).

## Execution Flow Changes

### dispatch-task Modifications

The dispatch-task handler reads task configs, resolves the size to infrastructure parameters, and passes routing information downstream:

```typescript
// Size → infrastructure mapping (server-side implementation detail)
const COMPUTE_SIZES = {
  small:  { cpu: 2,  memoryGb: 8,  storageGb: 30  },
  medium: { cpu: 4,  memoryGb: 16, storageGb: 30  },
  large:  { cpu: 8,  memoryGb: 32, storageGb: 50  },
  xlarge: { cpu: 16, memoryGb: 64, storageGb: 100 },
} as const;

// In dispatch-task.ts handler, after determining task is 'ready':

const computeConfig = await storage.taskConfigs.getCompute(repo, workspace, taskName);
const timeoutConfig = await storage.taskConfigs.getTimeout(repo, workspace, taskName);

const computeSize = computeConfig?.size;
const sizeSpec = computeSize ? COMPUTE_SIZES[computeSize] : undefined;
const timeoutMinutes = timeoutConfig?.minutes
  ?? (computeSize ? 60 : 15);  // Sized compute default 60 min, serverless default 15 min

return {
  taskName,
  status: 'ready',
  taskHash: prepare.taskHash,
  inputHashes: prepare.inputHashes,
  outputPath: prepare.outputPath,
  taskExecutionId,
  cached: false,
  // Routing information (resolved from size)
  computeSize,
  computeCpu: sizeSpec?.cpu,
  computeMemoryGb: sizeSpec?.memoryGb,
  computeStorageGb: sizeSpec?.storageGb,
  computeTimeoutMinutes: computeSize ? timeoutMinutes : undefined,
};
```

### DispatchTaskResult Extension

```typescript
export interface DispatchTaskResult {
  // ... existing fields ...
  /** Compute size: undefined = serverless, named size = sized compute */
  computeSize?: 'small' | 'medium' | 'large' | 'xlarge';
  /** Resolved vCPU count (from size, when computeSize is set) */
  computeCpu?: number;
  /** Resolved memory in GB (from size, when computeSize is set) */
  computeMemoryGb?: number;
  /** Timeout in minutes (when computeSize is set) */
  computeTimeoutMinutes?: number;
  /** Resolved ephemeral storage in GB (from size, when computeSize is set) */
  computeStorageGb?: number;
}
```

### Step Functions State Machine Changes

A new Choice state is inserted between `IsCached` and `ExecuteTaskState` to route based on whether a compute size is set:

```
DispatchTaskState
  → IsNotReady?
    → yes: SkipNotReady
    → no: PrepareExecution
      → IsCached?
        → yes: PrepareCachedWrite (terminal)
        → no: ChooseExecutor          ← NEW
          → computeSize present: ExecuteTaskComputeState  ← NEW
            → DidComputeSucceed?       ← NEW
              → PrepareSuccessWrite / PrepareFailureWrite
          → default (serverless): ExecuteTaskState (existing)
            → DidExecutionSucceed?
              → PrepareSuccessWrite / PrepareFailureWrite
```

The key insight is that **cached tasks skip execution entirely** regardless of target, so the Choice goes after the cache check.

#### CDK Changes

```typescript
// New: ECS Cluster for sized compute
const cluster = new ecs.Cluster(this, 'ComputeCluster', {
  clusterName: `${prefix}-compute`,
  vpc: computeVpc,
});

// New: Task definition (base definition, overridden at runtime via container overrides)
const computeTaskDef = new ecs.FargateTaskDefinition(this, 'ComputeTaskDef', {
  family: `${prefix}-execute-task`,
  cpu: 256,     // Minimum — overridden per-task at runtime
  memoryLimitMiB: 512,
  runtimePlatform: {
    cpuArchitecture: ecs.CpuArchitecture.X86_64,
    operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
  },
});

// Container uses the SAME ECR image as the serverless runner
const computeContainer = computeTaskDef.addContainer('TaskRunner', {
  containerName: 'task-runner',
  image: ecs.ContainerImage.fromEcrRepository(runnerRepo, 'latest'),
  logging: new ecs.AwsLogDriver({
    logGroup: new logs.LogGroup(this, 'ComputeTaskLogs', {
      logGroupName: `/ecs/${prefix}-execute-task`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    }),
    streamPrefix: 'task',
  }),
});

// New: EcsRunTask state for sized compute execution
const executeTaskComputeState = new tasks.EcsRunTask(this, 'ExecuteTaskComputeState', {
  integrationPattern: sfn.IntegrationPattern.RUN_JOB,  // Wait for completion
  cluster,
  taskDefinition: computeTaskDef,
  launchTarget: new tasks.EcsFargateLaunchTarget({
    platformVersion: ecs.FargatePlatformVersion.LATEST,
  }),
  assignPublicIp: true,  // Public subnet — matches current serverless security posture
  securityGroups: [taskSecurityGroup],
  subnets: { subnetType: ec2.SubnetType.PUBLIC },
  taskTimeout: sfn.Timeout.at('$.computeTimeoutIso'),  // Enforced by Step Functions
  containerOverrides: [{
    containerDefinition: computeContainer,
    environment: [
      { name: 'TASK_EVENT', value: sfn.JsonPath.jsonToString(sfn.JsonPath.objectAt('$')) },
    ],
    cpu: sfn.JsonPath.numberAt('$.computeCpuUnits'),     // 256, 512, 1024, etc.
    memoryMiB: sfn.JsonPath.numberAt('$.computeMemoryMiB'),  // In MiB
  }],
  resultPath: '$.execution',
}).addRetry({
  errors: ['States.TaskFailed', 'States.Timeout'],
  maxAttempts: 2,
  backoffRate: 2,
}).addCatch(/* same catch as serverless path */);
```

### Compute Container Entrypoint

The compute container uses the **same Docker image** as the serverless runner but needs a different entrypoint. Instead of the serverless runtime interface, the compute task reads its event from the `TASK_EVENT` environment variable (passed by Step Functions container overrides).

A new entrypoint script is added to the Docker image:

```typescript
// packages/e3-aws-runner/src/handlers/execute-task-compute-entry.ts

// Parse the task event from environment variable (passed by Step Functions)
const event = JSON.parse(process.env.TASK_EVENT!);

// Reuse the same execution logic as the serverless handler
import { executeTask } from './execute-task-core.js';
const result = await executeTask(event);

// Write result to stdout for Step Functions to capture
// (EcsRunTask captures container exit code; result is written to DynamoDB)
console.log(JSON.stringify(result));
process.exit(result.status === 'success' ? 0 : 1);
```

This requires a minor refactor: extract the core execution logic from `execute-task.ts` into a shared `execute-task-core.ts` module that both the serverless handler and the compute entrypoint can import.

### Dockerfile Changes

```dockerfile
# Add compute entrypoint alongside serverless entrypoint
COPY packages/e3-aws-runner/dist/src/handlers/execute-task-compute-entry.js ./dist/handlers/
COPY packages/e3-aws-runner/dist/src/handlers/execute-task-core.js ./dist/handlers/
```

The serverless entrypoint remains the default `CMD`. The compute task overrides the command via Step Functions container overrides to run the compute entry script instead.

### Result Handling

Compute tasks communicate results back through the **same DynamoDB execution state** as serverless tasks. The `apply-results` handler doesn't need to change — it already processes results by task name and status, regardless of where they executed.

However, the Step Functions `EcsRunTask` state returns ECS task metadata (not a direct response payload). We need a small handler after the compute execution to read the result from DynamoDB:

**Approach:** The compute container writes its result to a well-known DynamoDB key, and a thin "collect-result" handler reads it and returns the same `TaskExecutionResult` shape. This keeps `apply-results` completely unchanged.

```
ExecuteTaskComputeState (EcsRunTask, waits for completion)
  → CollectComputeResult (reads result from DynamoDB)
    → DidComputeSucceed? (same Choice pattern as serverless path)
```

#### Compute Result Storage

```
PK: COMPUTE_RESULT/{repo}/{workspace}
SK: {taskExecutionId}
Attributes: result (JSON), ttl (1 hour)
```

The compute container writes its `TaskExecutionResult` here before exiting. The `collect-result` handler reads and deletes it. Short TTL ensures cleanup of any orphaned results.

### Timeout Enforcement

The timeout is enforced by **Step Functions, not the container**. The `EcsRunTask` state sets a `taskTimeout` based on the task's timeout config (or the sized compute default of 60 minutes). If the container exceeds the timeout, Step Functions stops the task immediately and the state transitions to the failure path — the error propagates through `apply-results` which marks dependent tasks as skipped, and the dataflow proceeds to finalization.

This is critical: if the container hangs or ignores an internal timeout, the state machine must be able to kill it and continue. The container should not be trusted to enforce its own timeout.

The `dispatch-task` handler converts `timeoutMinutes` to an ISO 8601 duration string (e.g. `PT60M`) and passes it through the state as `computeTimeoutIso`. Step Functions natively supports dynamic timeouts via JSONPath references.

The serverless execute-task path continues to use its built-in 15-minute timeout, which is also enforced externally (by the serverless runtime, not the container).

### Compute Concurrency

The underlying infrastructure has **vCPU-based quotas** (default 4,000 vCPU soft limit per account, auto-increases with usage, can be raised via support ticket). There is no per-task count limit — a 4 vCPU task consumes 4 vCPU of quota.

No artificial concurrency limit is needed. Natural constraints handle throttling:
- The **dependency graph** limits how many tasks are ready at any time
- The **Map state's existing retry policy** (2 retries, exponential backoff) handles transient launch failures from capacity limits
- The **cyclic dispatch loop** only dispatches ready tasks per iteration, not the entire graph at once
- The **launch rate** (100 burst, 20/second sustained) is well above typical dataflow parallelism

## Container Image Optimization

### zstd Compression

Update the Docker build to use zstd compression for faster sized compute cold starts:

```bash
# scripts/build-runner.sh changes:
docker buildx build \
  -f docker/Dockerfile.runner \
  --output type=image,name="$ECR_REPO_URI:latest",push=true,compression=zstd,oci-mediatypes=true \
  .
```

This requires `docker buildx` (available in Docker 19.03+) and produces OCI-format images with zstd-compressed layers. ECR supports OCI images natively.

**Expected improvement:** Up to 27% reduction in image pull time, with larger images seeing the greatest benefit. Our runner image (~3-4 GB uncompressed) should benefit significantly.

### SOCI Index Manifest v2 (Lazy Loading)

SOCI v2 enables lazy loading of container image layers — the container can start before the full image is pulled, loading layers on demand as the application accesses them.

**SOCI v2 is enabled by default** in all AWS accounts (as of mid-2025). We just need to generate and push the SOCI index alongside the image.

#### Automated Approach: CloudFormation SOCI Index Builder

Deploy the [AWS SOCI Index Builder](https://github.com/awslabs/cfn-ecr-aws-soci-index-builder) CloudFormation stack. This creates an EventBridge rule that automatically generates SOCI v2 indexes whenever an image is pushed to ECR.

Add to the CDK stack:

```typescript
// Deploy the SOCI index builder CloudFormation stack
// Automatically generates SOCI indexes on every ECR push
new cfn.CfnStack(this, 'SociIndexBuilder', {
  templateUrl: 'https://aws-soci-index-builder.s3.amazonaws.com/latest/template.yaml',
  parameters: {
    SociRepositoryImageTagFilters: `${prefix}-runner:*`,
  },
});
```

#### Manual Approach: Build Script

Alternatively, generate SOCI indexes in the build script after pushing the image:

```bash
# After docker push, generate SOCI v2 index
soci create "$ECR_REPO_URI:latest"
soci push "$ECR_REPO_URI:latest"
```

**Recommendation:** Use the automated CloudFormation approach. It's zero-maintenance and handles all future pushes automatically.

### GitHub Actions Changes

```yaml
# .github/workflows/build-runner.yml additions:

- name: Set up Docker Buildx
  uses: docker/setup-buildx-action@v3

- name: Build and push runner image (zstd + OCI)
  run: |
    docker buildx build \
      -f docker/Dockerfile.runner \
      --output type=image,name=$ECR_URI:latest,push=true,compression=zstd,oci-mediatypes=true \
      .

# SOCI index is generated automatically by the SOCI Index Builder stack
```

### Expected Startup Improvement

| Optimization | Estimated Improvement |
|-------------|----------------------|
| zstd compression | ~27% faster image pull |
| SOCI v2 lazy loading | ~50-60% faster startup |
| **Combined** | **~65-70% faster startup** |

For a ~3-4 GB image, this could reduce sized compute cold start from ~45-60s to ~15-20s.

## CDK Infrastructure Summary

### New Resources

| Resource | Type | Cost | Purpose |
|----------|------|------|---------|
| `ComputeVpc` | `ec2.Vpc` | Free | VPC with public subnets for compute tasks |
| `ComputeTaskSg` | `ec2.SecurityGroup` | Free | Deny inbound, allow outbound |
| `ComputeCluster` | `ecs.Cluster` | Free | ECS cluster for compute tasks |
| `ComputeTaskDef` | `ecs.FargateTaskDefinition` | Free | Task definition (overridden per size) |
| `ComputeTaskLogs` | `logs.LogGroup` | Pay per use | CloudWatch logs for compute tasks |
| `ExecuteTaskComputeState` | `tasks.EcsRunTask` | Pay per use | Step Functions state for compute execution |
| `CollectComputeResultFn` | `NodejsFunction` | Pay per use | Collects results from compute tasks |
| `SociIndexBuilder` | `cfn.CfnStack` | Free | Auto-generates SOCI indexes on ECR push |

### VPC and Networking

Sized compute tasks must run inside a VPC. The current platform stack has no VPC — all serverless functions run outside a VPC and reach AWS services (S3, DynamoDB, ECR) over the public internet using IAM credentials. This is standard for serverless architectures.

**Decision: Public subnets with assigned public IPs (scale-to-zero cost).**

This matches the security posture of the existing serverless execution:
- Tasks get a public IP and reach AWS services over the internet (same as serverless today)
- Security groups deny all inbound traffic — tasks don't listen on any ports
- IAM roles control access to S3, DynamoDB, ECR
- All traffic is TLS encrypted
- No idle infrastructure costs — the VPC, subnets, and security groups are free; public IPs are only billed while a task is running ($0.005/hour, i.e. ~$0.0008 per 10-minute task)

**Alternative for enterprise clients:** Private subnets + NAT Gateway (~$38/AZ/month, ~$76/month for 2 AZs) can be offered as a deployment option if a client's security policy requires no public IPs on compute resources. This is a CDK configuration change (subnet type + NAT Gateway) with no code changes needed.

#### CDK VPC Resources

```typescript
// New VPC for sized compute (no NAT Gateway — scale-to-zero cost)
const computeVpc = new ec2.Vpc(this, 'ComputeVpc', {
  vpcName: `${prefix}-compute`,
  maxAzs: 2,
  natGateways: 0,  // No NAT — tasks use public IPs
  subnetConfiguration: [
    {
      name: 'public',
      subnetType: ec2.SubnetType.PUBLIC,
      cidrMask: 24,
    },
  ],
});

// Security group: deny all inbound, allow all outbound (tasks need internet access)
const taskSecurityGroup = new ec2.SecurityGroup(this, 'ComputeTaskSg', {
  vpc: computeVpc,
  description: 'Security group for sized compute tasks',
  allowAllOutbound: true,  // Tasks need to reach S3, DynamoDB, ECR, and external APIs
});
// No ingress rules — all inbound traffic is denied by default
```

Tasks need outbound internet access for:
- AWS service APIs (S3, DynamoDB, ECR, CloudWatch Logs)
- External APIs that tasks may call during execution

### IAM Permissions

The compute task execution role needs:
- S3 read/write (data bucket)
- DynamoDB read/write (data table)
- ECR pull (runner repository)
- CloudWatch Logs write

The Step Functions role needs:
- `ecs:RunTask` on the task definition
- `iam:PassRole` for the task execution role and task role
- `ecs:StopTask`, `ecs:DescribeTasks` (for `.sync` integration)
- EventBridge permissions (for `.sync` callback)

## Cleanup

Task configs are cleaned up on:
- **Workspace deploy** — orphaned configs (referencing removed tasks) are auto-deleted with a warning
- **Workspace deletion** — delete all configs for that workspace
- **Repository deletion** — delete all configs for all workspaces

This follows the same cascading delete pattern as schedules.

## Implementation Plan

### Phase 1: Task Configs (Storage + API + CLI)
1. Add `ComputeConfigType`, `TimeoutConfigType`, `ScheduleForceConfigType`, `AllTaskConfigsType` to `e3-admin-types`
2. Add `TaskConfigStore` interface to `e3-admin-core`
3. Implement `DynamoTaskConfigStore` in `e3-aws-storage`
4. Add task config API routes to `e3-aws-api` (compute, timeout, schedule-force, unified)
5. Add task config client functions to `e3-admin-client`
6. Add `compute`, `timeout`, `schedule-force` CLI commands to `e3-cloud-cli`
7. Migrate `forceTaskPatterns` from schedule to schedule-force task configs

### Phase 2: Sized Compute Execution
8. Add ECS Cluster + Task Definition + VPC to CDK stack
9. Refactor `execute-task.ts` into `execute-task-core.ts` + serverless entry + compute entry
10. Add `collect-compute-result` handler
11. Add `ExecuteTaskComputeState` and `ChooseExecutor` Choice to state machine
12. Modify `dispatch-task.ts` to read compute configs, resolve size → resources, and route
13. Update Dockerfile with compute entrypoint

### Phase 3: Image Optimization
14. Switch Docker build to `buildx` with zstd compression
15. Deploy SOCI Index Builder CloudFormation stack via CDK
16. Update `build-runner.sh` and GitHub Actions workflow
17. Verify SOCI indexes are generated and used

### Phase 4: Testing + Documentation
18. Integration tests for task config CRUD (all three dimensions)
19. Integration test for sized compute execution (create compute config, run dataflow, verify task ran in compute mode)
20. Integration test for orphaned config cleanup on workspace deploy
21. Update CLAUDE.md, README files, and deployment docs

## Resolved Decisions

1. **Config granularity** — Per concrete task name. No server-side globs or patterns. Client-side regex for bulk operations.
2. **API structure** — Separate routes per dimension (compute, timeout, schedule), unified view at parent route. POST accepts dictionary for batch operations.
3. **Timeout per task** — Yes, separate config dimension. Sized compute default 1 hour, serverless default 15 min.
4. **Compute sizes** — Predefined tiers (small/medium/large/xlarge) instead of custom CPU/memory. Size-to-resource mapping is a server-side implementation detail.
5. **Cost visibility** — No. We may charge a different rate to what AWS charges us.
7. **VPC** — Public subnets with assigned public IPs. Scale-to-zero cost, same security posture as current serverless execution. Private subnet + NAT Gateway available as a deployment option for enterprise clients.
8. **Timeout enforcement** — Step Functions owns the timeout via `taskTimeout`. Container is not trusted to self-enforce.
9. **Orphaned configs** — Auto-deleted on workspace deploy with warning output.
10. **Schedule force-tasks** — Migrated from `forceTaskPatterns` on schedule to per-task schedule-force configs. Breaking change to schedule API.
