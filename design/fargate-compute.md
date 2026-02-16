# Fargate Heavy Compute Tasks

## Summary

Add the ability for users to designate specific tasks (by name or glob pattern) as **"heavy compute"** tasks that run on AWS Fargate instead of Lambda. This lifts Lambda's 15-minute timeout and 10 GB memory limits, allowing long-running or memory-intensive workloads while keeping fast, lightweight tasks on Lambda.

The feature follows the same pattern as scheduled execution: users configure compute profiles per-workspace via the `e3-cloud` CLI, the configuration is stored in DynamoDB, and the dispatch loop in the Step Functions state machine routes tasks to either Lambda or Fargate based on the stored configuration.

## Motivation

Lambda imposes hard limits:
- **15-minute maximum timeout** — tasks that run longer simply fail
- **10 GB maximum memory** — insufficient for large dataset processing
- **No GPU support** — blocks ML/AI workloads entirely

Fargate removes these constraints:
- Tasks can run for **hours** (Step Functions has a 24-hour state machine timeout)
- Up to **16 vCPU / 120 GB memory** per task
- Per-second billing with no idle costs when no tasks are running
- Same container image can be shared between Lambda and Fargate

## User Experience

### Naming

The feature is called **"compute profiles"**. A compute profile assigns a CPU/memory configuration to tasks matching a name or glob pattern.

### CLI Commands

```bash
# Set a compute profile for tasks matching a pattern
e3-cloud compute set https://dev.e3.elaraai.com/repos/my-repo/workspaces/main \
  --tasks "train*" \
  --cpu 4 \
  --memory 16

# Set for a single named task with custom timeout and storage
e3-cloud compute set https://dev.e3.elaraai.com/repos/my-repo/workspaces/main \
  --tasks "heavy-etl" \
  --cpu 8 \
  --memory 32 \
  --timeout 4h \
  --storage 100

# List compute profiles for a workspace
e3-cloud compute list https://dev.e3.elaraai.com/repos/my-repo/workspaces/main

# Get a specific profile
e3-cloud compute get https://dev.e3.elaraai.com/repos/my-repo/workspaces/main \
  --tasks "train*"

# Remove a compute profile
e3-cloud compute remove https://dev.e3.elaraai.com/repos/my-repo/workspaces/main \
  --tasks "train*"

# List all compute profiles across workspaces in a repo
e3-cloud compute list https://dev.e3.elaraai.com/repos/my-repo
```

### Configuration Options

| Option | Flag | Required | Default | Range |
|--------|------|----------|---------|-------|
| Task pattern | `--tasks` | Yes | — | Exact name or prefix glob (e.g. `train*`) |
| CPU | `--cpu` | Yes | — | 1, 2, 4, 8, 16 vCPU |
| Memory | `--memory` | Yes | — | See valid combinations below |
| Timeout | `--timeout` | No | 1 hour | 5 min – 24 hours |
| Ephemeral storage | `--storage` | No | 30 GB | 21 – 200 GB |

Only integer vCPU values are supported (no 0.25 or 0.5). Fractional vCPUs are designed for tiny web containers, not compute tasks. The minimum of 1 vCPU also ensures dedicated physical core allocation on Fargate's Firecracker microVMs.

### Valid CPU/Memory Combinations

The API validates at config time (not at launch time) that the combination is valid:

| CPU (vCPU) | Memory (GB) |
|------------|-------------|
| 1 | 2, 3, 4, 5, 6, 7, 8 |
| 2 | 4–16 (1 GB increments) |
| 4 | 8–30 (1 GB increments) |
| 8 | 16–60 (1 GB increments) |
| 16 | 32–120 (1 GB increments) |

### Task Pattern Matching

Patterns are restricted to **exact task names** and **prefix globs** (pattern ending with `*`). Non-prefix patterns (e.g. `*train`, `tr*in`) are rejected at config time.

When multiple patterns match a task, priority is:
1. **Exact match** wins over any glob
2. **Longer prefix** wins over shorter prefix (e.g. `train-model*` beats `train*`)

This is unambiguous and covers all practical use cases. The same restriction applies to schedule `forceTaskPatterns`.

### Default Behaviour

- Tasks with **no matching compute profile** run on Lambda (current behaviour, unchanged)
- Tasks with a **matching compute profile** run on Fargate with the specified CPU/memory

## Architecture

### Data Model

#### DynamoDB Schema

Following the schedule pattern, compute profiles are stored in the shared single-table:

```
PK: COMPUTE/{repo}
SK: {workspace}#{taskPattern}
```

The SK includes the task pattern to allow multiple profiles per workspace (one per pattern). The `#` separator is safe because workspace names and task patterns cannot contain `#`.

#### East Types (`e3-admin-types`)

```typescript
// packages/e3-admin-types/src/compute-profile-types.ts

export const ComputeProfileType = StructType({
  repo: StringType,
  workspace: StringType,
  taskPattern: StringType,       // Exact task name or prefix glob (e.g. "train*")
  cpu: IntegerType,              // vCPU count (1, 2, 4, 8, 16)
  memoryGb: IntegerType,         // Memory in GB
  timeoutMinutes: IntegerType,   // Task timeout in minutes (5–1440, default 60)
  storageGb: IntegerType,        // Ephemeral storage in GB (21–200, default 30)
  createdBy: StringType,         // User ID
  createdAt: StringType,         // ISO timestamp
  updatedAt: StringType,         // ISO timestamp
});

export const ComputeProfileRequestType = StructType({
  taskPattern: StringType,
  cpu: IntegerType,
  memoryGb: IntegerType,
  timeoutMinutes: OptionType(IntegerType),   // Default: 60
  storageGb: OptionType(IntegerType),        // Default: 30
});
```

#### Store Interface (`e3-admin-core`)

```typescript
// packages/e3-admin-core/src/compute-profile-store.ts

interface ComputeProfileStore {
  get(repo: string, workspace: string, taskPattern: string): Promise<ComputeProfile | null>;
  put(repo: string, workspace: string, profile: ComputeProfile): Promise<void>;
  delete(repo: string, workspace: string, taskPattern: string): Promise<void>;
  listForWorkspace(repo: string, workspace: string): Promise<ComputeProfile[]>;
  listForRepo(repo: string): Promise<ComputeProfile[]>;
  deleteAllForWorkspace(repo: string, workspace: string): Promise<void>;
  deleteAllForRepo(repo: string): Promise<void>;
}
```

#### DynamoDB Implementation (`e3-aws-storage`)

```typescript
// packages/e3-aws-storage/src/dynamo-compute-profile-store.ts

// PK: COMPUTE/{repo}
// SK: {workspace}#{taskPattern}
// Attributes: profile (BEAST2-encoded), updatedAt
```

Follows the same BEAST2 encoding pattern as `DynamoScheduleStore`.

### API Routes

#### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| PUT | `/api/repos/:repo/workspaces/:ws/compute` | Create/update a compute profile |
| GET | `/api/repos/:repo/workspaces/:ws/compute` | List profiles for a workspace |
| GET | `/api/repos/:repo/workspaces/:ws/compute/:pattern` | Get a specific profile |
| DELETE | `/api/repos/:repo/workspaces/:ws/compute/:pattern` | Delete a profile |
| GET | `/api/repos/:repo/compute` | List all profiles across workspaces |

#### Validation (PUT handler)

The PUT handler validates all fields server-side:

```typescript
function validateComputeProfile(request: ComputeProfileRequest): string | null {
  // Validate task pattern: exact name or prefix glob only
  if (request.taskPattern.includes('*') && !request.taskPattern.endsWith('*')) {
    return `Invalid pattern: '*' is only allowed at the end (prefix glob). Got: ${request.taskPattern}`;
  }
  if (request.taskPattern.indexOf('*') !== request.taskPattern.lastIndexOf('*')) {
    return `Invalid pattern: only one '*' allowed. Got: ${request.taskPattern}`;
  }

  // Validate CPU/memory combination
  const validMemory: Record<number, { min: number; max: number }> = {
    1:  { min: 2,  max: 8 },
    2:  { min: 4,  max: 16 },
    4:  { min: 8,  max: 30 },
    8:  { min: 16, max: 60 },
    16: { min: 32, max: 120 },
  };
  const range = validMemory[request.cpu];
  if (!range) return `Invalid CPU: ${request.cpu}. Must be one of: 1, 2, 4, 8, 16`;
  if (request.memoryGb < range.min || request.memoryGb > range.max) {
    return `Invalid memory for ${request.cpu} vCPU: ${request.memoryGb} GB. Must be ${range.min}–${range.max} GB`;
  }

  // Validate timeout (5 min – 24 hours)
  const timeout = request.timeoutMinutes ?? 60;
  if (timeout < 5 || timeout > 1440) {
    return `Invalid timeout: ${timeout} min. Must be 5–1440 (24 hours)`;
  }

  // Validate ephemeral storage (21–200 GB)
  const storage = request.storageGb ?? 30;
  if (storage < 21 || storage > 200) {
    return `Invalid storage: ${storage} GB. Must be 21–200`;
  }

  return null;
}
```

### API Client (`e3-admin-client`)

```typescript
// packages/e3-admin-client/src/compute-profiles.ts

export async function setComputeProfile(url, repo, workspace, request, options);
export async function getComputeProfile(url, repo, workspace, taskPattern, options);
export async function listComputeProfiles(url, repo, workspace, options);
export async function removeComputeProfile(url, repo, workspace, taskPattern, options);
export async function listAllComputeProfiles(url, repo, options);
```

### CLI (`e3-cloud-cli`)

New `compute` command group following the same pattern as `schedule`:

```typescript
// packages/e3-cloud-cli/src/commands/compute.ts

computeCommand
  .command('set <url>')
  .requiredOption('--tasks <pattern>', 'Task name or prefix glob (e.g. "train*")')
  .requiredOption('--cpu <vcpu>', 'Number of vCPUs (1, 2, 4, 8, 16)')
  .requiredOption('--memory <gb>', 'Memory in GB')
  .option('--timeout <duration>', 'Task timeout (e.g. "30m", "2h", "1h30m")', '1h')
  .option('--storage <gb>', 'Ephemeral storage in GB (21–200)', '30')
  .action(...)

computeCommand.command('list <url>').action(...)
computeCommand.command('get <url>').requiredOption('--tasks <pattern>').action(...)
computeCommand.command('remove <url>').requiredOption('--tasks <pattern>').action(...)
```

## Execution Flow Changes

### dispatch-task Modifications

The dispatch-task handler must resolve compute profiles and pass the routing decision downstream. The dispatch-task Lambda already has access to storage, so it can read compute profiles from DynamoDB.

```typescript
// In dispatch-task.ts handler, after determining task is 'ready':

// Load compute profiles for this workspace
const profiles = await storage.computeProfiles.listForWorkspace(repo, workspace);

// Find matching profile (first match wins, most-specific pattern first)
const matchedProfile = resolveComputeProfile(profiles, taskName);

return {
  taskName,
  status: 'ready',
  taskHash: prepare.taskHash,
  inputHashes: prepare.inputHashes,
  outputPath: prepare.outputPath,
  taskExecutionId,
  cached: false,
  // NEW: Fargate routing information
  executionTarget: matchedProfile ? 'fargate' : 'lambda',
  fargateCpu: matchedProfile?.cpu,
  fargateMemoryGb: matchedProfile?.memoryGb,
};
```

The `resolveComputeProfile` function reuses the same glob matching logic from `schedule-trigger.ts` (`globToRegex`).

### DispatchTaskResult Extension

```typescript
export interface DispatchTaskResult {
  // ... existing fields ...
  /** Where to execute: 'lambda' (default) or 'fargate' */
  executionTarget?: 'lambda' | 'fargate';
  /** Fargate vCPU (when executionTarget is 'fargate') */
  fargateCpu?: number;
  /** Fargate memory in GB (when executionTarget is 'fargate') */
  fargateMemoryGb?: number;
  /** Fargate timeout in minutes (when executionTarget is 'fargate') */
  fargateTimeoutMinutes?: number;
  /** Fargate ephemeral storage in GB (when executionTarget is 'fargate') */
  fargateStorageGb?: number;
}
```

### Step Functions State Machine Changes

A new Choice state is inserted between `IsCached` and `ExecuteTaskState` to route between Lambda and Fargate execution:

```
DispatchTaskState
  → IsNotReady?
    → yes: SkipNotReady
    → no: PrepareExecution
      → IsCached?
        → yes: PrepareCachedWrite (terminal)
        → no: ChooseExecutor          ← NEW
          → 'fargate': ExecuteTaskFargateState  ← NEW
            → DidFargateSucceed?       ← NEW
              → PrepareSuccessWrite / PrepareFailureWrite
          → 'lambda' (default): ExecuteTaskState (existing Lambda)
            → DidExecutionSucceed?
              → PrepareSuccessWrite / PrepareFailureWrite
```

The key insight is that **cached tasks skip execution entirely** regardless of target, so the Choice goes after the cache check.

#### CDK Changes

```typescript
// New: ECS Cluster (no capacity providers needed for Fargate)
const cluster = new ecs.Cluster(this, 'FargateCluster', {
  clusterName: `${prefix}-compute`,
  vpc: computeVpc,
});

// New: Fargate task definition (base definition, overridden at runtime)
const fargateTaskDef = new ecs.FargateTaskDefinition(this, 'FargateTaskDef', {
  family: `${prefix}-execute-task`,
  cpu: 256,     // Minimum — overridden per-task at runtime
  memoryLimitMiB: 512,
  runtimePlatform: {
    cpuArchitecture: ecs.CpuArchitecture.X86_64,
    operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
  },
});

// Container uses the SAME ECR image as the Lambda runner
const fargateContainer = fargateTaskDef.addContainer('TaskRunner', {
  containerName: 'task-runner',
  image: ecs.ContainerImage.fromEcrRepository(runnerRepo, 'latest'),
  logging: new ecs.AwsLogDriver({
    logGroup: new logs.LogGroup(this, 'FargateTaskLogs', {
      logGroupName: `/ecs/${prefix}-execute-task`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    }),
    streamPrefix: 'task',
  }),
});

// New: EcsRunTask state for Fargate execution
const executeTaskFargateState = new tasks.EcsRunTask(this, 'ExecuteTaskFargateState', {
  integrationPattern: sfn.IntegrationPattern.RUN_JOB,  // Wait for completion
  cluster,
  taskDefinition: fargateTaskDef,
  launchTarget: new tasks.EcsFargateLaunchTarget({
    platformVersion: ecs.FargatePlatformVersion.LATEST,
  }),
  assignPublicIp: true,  // Public subnet — matches current Lambda security posture
  securityGroups: [taskSecurityGroup],
  subnets: { subnetType: ec2.SubnetType.PUBLIC },
  containerOverrides: [{
    containerDefinition: fargateContainer,
    environment: [
      { name: 'TASK_EVENT', value: sfn.JsonPath.jsonToString(sfn.JsonPath.objectAt('$')) },
    ],
    cpu: sfn.JsonPath.numberAt('$.fargateCpuUnits'),     // 256, 512, 1024, etc.
    memoryMiB: sfn.JsonPath.numberAt('$.fargateMemoryMiB'),  // In MiB
  }],
  resultPath: '$.execution',
}).addRetry({
  errors: ['States.TaskFailed', 'States.Timeout'],
  maxAttempts: 2,
  backoffRate: 2,
}).addCatch(/* same catch as Lambda path */);
```

### Fargate Container Entrypoint

The Fargate container uses the **same Docker image** as the Lambda runner but needs a different entrypoint. Instead of the Lambda RIC (`aws-lambda-ric`), the Fargate task reads its event from the `TASK_EVENT` environment variable (passed by Step Functions container overrides).

A new entrypoint script is added to the Docker image:

```typescript
// packages/e3-aws-runner/src/handlers/execute-task-fargate-entry.ts

// Parse the task event from environment variable (passed by Step Functions)
const event = JSON.parse(process.env.TASK_EVENT!);

// Reuse the same execution logic as the Lambda handler
import { executeTask } from './execute-task-core.js';
const result = await executeTask(event);

// Write result to stdout for Step Functions to capture
// (EcsRunTask captures container exit code; result is written to DynamoDB)
console.log(JSON.stringify(result));
process.exit(result.status === 'success' ? 0 : 1);
```

This requires a minor refactor: extract the core execution logic from `execute-task.ts` into a shared `execute-task-core.ts` module that both the Lambda handler and the Fargate entrypoint can import.

### Dockerfile Changes

```dockerfile
# Add Fargate entrypoint alongside Lambda entrypoint
COPY packages/e3-aws-runner/dist/src/handlers/execute-task-fargate-entry.js ./dist/handlers/
COPY packages/e3-aws-runner/dist/src/handlers/execute-task-core.js ./dist/handlers/
```

The Lambda entrypoint remains the default `CMD`. The Fargate task overrides the command via Step Functions container overrides to run the Fargate entry script instead.

### Result Handling

Fargate tasks communicate results back through the **same DynamoDB execution state** as Lambda tasks. The `apply-results` handler doesn't need to change — it already processes results by task name and status, regardless of where they executed.

However, the Step Functions `EcsRunTask` state returns ECS task metadata (not a Lambda response payload). We need a small Lambda after the Fargate execution to read the result from DynamoDB:

**Alternative approach (simpler):** The Fargate container writes its result to a well-known DynamoDB key, and a thin "collect-fargate-result" Lambda reads it and returns the same `TaskExecutionResult` shape. This keeps `apply-results` completely unchanged.

```
ExecuteTaskFargateState (EcsRunTask, waits for completion)
  → CollectFargateResult (Lambda — reads result from DynamoDB)
    → DidFargateSucceed? (same Choice pattern as Lambda path)
```

#### Fargate Result Storage

```
PK: FARGATE_RESULT/{repo}/{workspace}
SK: {taskExecutionId}
Attributes: result (JSON), ttl (1 hour)
```

The Fargate container writes its `TaskExecutionResult` here before exiting. The `collect-fargate-result` Lambda reads and deletes it. Short TTL ensures cleanup of any orphaned results.

## Container Image Optimization

### zstd Compression

Update the Docker build to use zstd compression for faster Fargate cold starts:

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

SOCI v2 enables lazy loading of container image layers — Fargate can start the container before the full image is pulled, loading layers on demand as the application accesses them.

**SOCI v2 is enabled by default** in all AWS accounts (as of mid-2025). We just need to generate and push the SOCI index alongside the image.

#### Automated Approach: CloudFormation SOCI Index Builder

Deploy the [AWS SOCI Index Builder](https://github.com/awslabs/cfn-ecr-aws-soci-index-builder) CloudFormation stack. This creates an EventBridge rule that automatically generates SOCI v2 indexes whenever an image is pushed to ECR.

Add to the CDK stack:

```typescript
// Option 1: Deploy the SOCI index builder CloudFormation stack
// This automatically generates SOCI indexes on every ECR push
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
# Using the soci CLI (installed in CI)
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

For a ~3-4 GB image, this could reduce Fargate cold start from ~45-60s to ~15-20s.

## CDK Infrastructure Summary

### New Resources

| Resource | Type | Cost | Purpose |
|----------|------|------|---------|
| `ComputeVpc` | `ec2.Vpc` | Free | VPC with public subnets for Fargate tasks |
| `FargateTaskSg` | `ec2.SecurityGroup` | Free | Deny inbound, allow outbound |
| `FargateCluster` | `ecs.Cluster` | Free | ECS cluster for Fargate tasks |
| `FargateTaskDef` | `ecs.FargateTaskDefinition` | Free | Task definition (overridden per-task) |
| `FargateTaskLogs` | `logs.LogGroup` | Pay per use | CloudWatch logs for Fargate tasks |
| `ExecuteTaskFargateState` | `tasks.EcsRunTask` | Pay per use | Step Functions state for Fargate execution |
| `CollectFargateResultFn` | `NodejsFunction` | Pay per use | Lambda to collect Fargate results |
| `SociIndexBuilder` | `cfn.CfnStack` | Free | Auto-generates SOCI indexes on ECR push |

### VPC and Networking

Fargate tasks must run inside a VPC. The current platform stack has no VPC — all Lambdas run outside a VPC and reach AWS services (S3, DynamoDB, ECR) over the public internet using IAM credentials. This is standard for serverless architectures.

**Decision: Public subnets with assigned public IPs (scale-to-zero cost).**

This matches the security posture of the existing Lambda-based execution:
- Tasks get a public IP and reach AWS services over the internet (same as Lambda today)
- Security groups deny all inbound traffic — tasks don't listen on any ports
- IAM roles control access to S3, DynamoDB, ECR
- All traffic is TLS encrypted
- No idle infrastructure costs — the VPC, subnets, and security groups are free; public IPs are only billed while a task is running ($0.005/hour, i.e. ~$0.0008 per 10-minute task)

**Alternative for enterprise clients:** Private subnets + NAT Gateway (~$38/AZ/month, ~$76/month for 2 AZs) can be offered as a deployment option if a client's security policy requires no public IPs on compute resources. This is a CDK configuration change (subnet type + NAT Gateway) with no code changes needed.

#### CDK VPC Resources

```typescript
// New VPC for Fargate compute (no NAT Gateway — scale-to-zero cost)
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
const taskSecurityGroup = new ec2.SecurityGroup(this, 'FargateTaskSg', {
  vpc: computeVpc,
  description: 'Security group for Fargate compute tasks',
  allowAllOutbound: true,  // Tasks need to reach S3, DynamoDB, ECR, and external APIs
});
// No ingress rules — all inbound traffic is denied by default
```

Tasks need outbound internet access for:
- AWS service APIs (S3, DynamoDB, ECR, CloudWatch Logs)
- External APIs that tasks may call during execution

### IAM Permissions

The Fargate task execution role needs:
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

Compute profiles are cleaned up on:
- **Workspace deletion** — delete all profiles for that workspace
- **Repository deletion** — delete all profiles for all workspaces

This follows the same cascading delete pattern as schedules.

## Implementation Plan

### Phase 1: Infrastructure + Storage
1. Add `ComputeProfileType` and `ComputeProfileRequestType` to `e3-admin-types`
2. Add `ComputeProfileStore` interface to `e3-admin-core`
3. Implement `DynamoComputeProfileStore` in `e3-aws-storage`
4. Add compute profile API routes to `e3-aws-api`
5. Add compute profile client functions to `e3-admin-client`
6. Add `compute` CLI commands to `e3-cloud-cli`

### Phase 2: Fargate Execution
7. Add ECS Cluster + Task Definition + VPC to CDK stack
8. Refactor `execute-task.ts` into `execute-task-core.ts` + Lambda entry + Fargate entry
9. Add `collect-fargate-result` Lambda handler
10. Add `ExecuteTaskFargateState` and `ChooseExecutor` Choice to state machine
11. Modify `dispatch-task.ts` to resolve compute profiles and set `executionTarget`
12. Update Dockerfile with Fargate entrypoint

### Phase 3: Image Optimization
13. Switch Docker build to `buildx` with zstd compression
14. Deploy SOCI Index Builder CloudFormation stack via CDK
15. Update `build-runner.sh` and GitHub Actions workflow
16. Verify SOCI indexes are generated and used (check `Snapshotter: soci` in task metadata)

### Phase 4: Testing + Documentation
17. Integration tests for compute profile CRUD
18. Integration test for Fargate task execution (create profile, run dataflow, verify task ran on Fargate)
19. Update CLAUDE.md, README files, and deployment docs

## Resolved Decisions

1. **Timeout per task** — Yes, configurable via `--timeout`. Default 1 hour, range 5 min – 24 hours.
2. **Ephemeral storage** — Yes, configurable via `--storage`. Default 30 GB, range 21–200 GB.
3. **Profile priority** — Exact match wins over prefix glob. Longer prefix wins over shorter. Only exact names and prefix globs are allowed (non-prefix patterns like `*train` rejected at config time).
4. **Cost visibility** — No. We may charge a different rate to what AWS charges us.
5. **Naming** — "Compute profiles".
6. **CPU values** — Integer only (1, 2, 4, 8, 16). Fractional vCPUs (0.25, 0.5) are excluded — they're for tiny web containers, not compute tasks. Minimum 1 vCPU is safe given Fargate's Firecracker microVM isolation.
7. **VPC** — Public subnets with assigned public IPs. Scale-to-zero cost, same security posture as current Lambda execution. Private subnet + NAT Gateway available as a deployment option for enterprise clients.

### Timeout Enforcement

The timeout is enforced by **Step Functions, not the container**. The `EcsRunTask` state sets a `taskTimeout` based on the compute profile's `timeoutMinutes`. If the container exceeds the timeout, Step Functions stops the ECS task immediately and the state transitions to the failure path — the error propagates through `apply-results` which marks dependent tasks as skipped, and the dataflow proceeds to finalization.

This is critical: if the container hangs or ignores an internal timeout, the state machine must be able to kill it and continue. The container should not be trusted to enforce its own timeout.

```typescript
const executeTaskFargateState = new tasks.EcsRunTask(this, 'ExecuteTaskFargateState', {
  // ...
  taskTimeout: sfn.Timeout.at('$.fargateTimeoutIso'),  // ISO 8601 duration from dispatch
  // ...
});
```

The `dispatch-task` handler converts `timeoutMinutes` to an ISO 8601 duration string (e.g. `PT60M`) and passes it through the state as `fargateTimeoutIso`. Step Functions natively supports dynamic timeouts via JSONPath references.

The Lambda execute-task path continues to use Lambda's built-in 15-minute timeout, which is also enforced externally (by the Lambda service, not the container).

## Open Questions

1. **Concurrent Fargate task limit** — Fargate has per-account service quotas (default 500 running tasks). Should we set a lower `maxConcurrency` on the Map state for Fargate tasks, or let the account quota be the natural limit?
