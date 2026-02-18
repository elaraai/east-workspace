# Scheduled Dataflow Execution

## Problem

Enterprise customers have "datasource tasks" that pull data from external systems (client databases, APIs, files). These tasks need to re-execute on a recurring schedule even when their input hashes haven't changed, because the external data may have changed.

This is a cloud-only enterprise feature. Local developers manage their own data pipelines and don't need automated scheduling.

## User Story

A customer deploys a package with tasks like `load_orders`, `load_customers` (datasource tasks) and downstream analytics tasks. They want:

- Datasource tasks to re-run nightly, pulling fresh data
- Downstream tasks to re-execute only when upstream outputs actually change
- Manual dataflow runs to continue working as before
- Ability to pause scheduling during maintenance windows or demos

## Design

### AWS Service: EventBridge Scheduler

We use **EventBridge Scheduler** (not EventBridge Rules) for per-workspace cron schedules.

| | EventBridge Rules (current GC) | EventBridge Scheduler |
|---|---|---|
| Model | One rule, targets all repos | One schedule per workspace |
| Use case | System-wide events | Per-entity cron jobs |
| Management | Manual rule lifecycle | Full CRUD API |
| Scale | 300 rules/account soft limit | 1M schedules/account |
| DLQ / Retry | Manual | Built-in |
| Timezone | UTC only | Native timezone support |
| Cost | Free | Free up to 14M/month |

EventBridge Rules work for the GC scheduler (single system-wide rule scanning all repos). For per-workspace user-defined schedules, EventBridge Scheduler is purpose-built: each schedule is an independent resource with its own cron expression, target, and retry policy.

> **Future:** We plan to migrate the GC scheduler from EventBridge Rules to EventBridge Scheduler as well — one schedule per repo with configurable frequency. The infrastructure and patterns established here (scheduler group, IAM role, trigger Lambda pattern) will be reusable.

### Architecture

```
CLI                          API                          AWS
───                          ───                          ───
e3-cloud schedule set  ────► PUT /schedule  ───┬────► DynamoDB (SCHEDULE/{repo}/{ws})
                                               └────► EventBridge Scheduler
                                                       (create/update schedule)

                          EventBridge Scheduler
                                │ (cron fires)
                                ▼
                          schedule-trigger Lambda
                                │
                                ├── Read schedule config from DynamoDB
                                ├── Validate workspace exists & is deployed
                                ├── Acquire workspace lock (skip if locked)
                                ├── Resolve forceTaskPatterns → matching task names
                                ├── Create execution state in DynamoDB
                                └── Start dataflow Step Functions
                                     (with forceTasks: string[])
```

### Per-Task Force via Pattern Matching

The current dataflow execution has:
- `force: boolean` — skip cache for **all** tasks
- `filter?: string` — run only **one** task by exact name

For schedules, we introduce **force task patterns**: a list of glob-style patterns that match task names. At execution time, patterns are resolved against the deployed task graph to produce a concrete `forceTasks: string[]` list.

#### Pattern Syntax

Patterns use a minimal glob syntax — not regex. `*` is the only wildcard.

| Syntax | Meaning |
|--------|---------|
| `*` | Matches zero or more characters |
| `\*` | Literal `*` (for task names containing asterisks) |
| `\\` | Literal `\` |
| anything else | Matched literally |

Patterns are matched against the **full** task name (not substring — `orders` does not match `load_orders`, but `*orders` does).

**Examples:**

```
Pattern         Matches
───────         ───────
load_orders     load_orders (exact match only)
input*          input_orders, input_customers, input (starts with "input")
*orders         load_orders, input_orders (ends with "orders")
*transform*     pre_transform_data, transform_output (contains "transform")
*               all tasks (equivalent to force: true)
load\*special   load*special (literal asterisk in task name)
path\\to\\task  path\to\task (literal backslashes in task name)
```

**Implementation:** Each pattern is converted to a regex internally:
1. Parse the pattern, handling `\\` and `\*` escape sequences
2. Escape all regex metacharacters (`.`, `+`, `(`, etc.) in literal segments
3. Replace unescaped `*` with `.*`
4. Anchor with `^...$` for full-name matching

**Behaviour:**
1. Schedule fires → schedule-trigger Lambda reads patterns from DynamoDB
2. Lambda calls `dataflowGetGraph()` to get the current task graph
3. Matches patterns against task names to produce `forceTasks: string[]`
4. Passes `forceTasks` through Step Functions to dispatch-task
5. In dispatch-task: `if (cachedOutputHash && !force && !forceTasks?.includes(taskName))` — forced tasks skip cache
6. Downstream tasks with changed inputs re-execute naturally; unchanged inputs use cache

This design means:
- A user can deploy a new package (adding/removing tasks) without updating the schedule
- Patterns like `input*` adapt to the current task graph automatically
- If no tasks match a pattern, the dataflow still runs (just nothing is forced)

### Triggered-By Tracking

The `DataflowRun` type gains a `triggeredBy` field to distinguish how a run was initiated:

```
triggeredBy: variant
  schedule: { schedulerExecutionId,     -- Unique ID per EventBridge invocation
              scheduledTime }           -- ISO 8601 time the trigger was scheduled for
  user:     { userId, email }           -- Manual execution via API
```

EventBridge Scheduler supports **context attributes** that are resolved at invocation time. The schedule target input includes these as template placeholders:

```json
{
  "repo": "acme",
  "workspace": "main",
  "schedulerExecutionId": "<aws.scheduler.execution-id>",
  "scheduledTime": "<aws.scheduler.scheduled-time>"
}
```

AWS resolves `<aws.scheduler.execution-id>` to a unique ID per trigger event and `<aws.scheduler.scheduled-time>` to the ISO 8601 time the invocation was scheduled for. The schedule-trigger Lambda passes these through to the DataflowRun record, providing a traceable link from execution history back to the specific EventBridge invocation — useful for debugging missed/failed triggers and correlating with CloudWatch Scheduler logs.

### Lock Handling

The `LockOperation` variant type gains a `schedule` case:

```
LockOperation: variant
  dataflow:      null
  deployment:    null
  removal:       null
  dataset_write: null
  schedule:      null      -- NEW
```

When the schedule-trigger Lambda acquires a workspace lock, it uses `variant('schedule', null)`. If the workspace is already locked (manual run in progress, or previous scheduled run still executing), the schedule-trigger **skips gracefully** — logs the skip and returns. The next scheduled invocation will try again.

## Data Model

### DynamoDB Schema

One schedule per workspace:

```
PK: SCHEDULE/{repo}
SK: {workspace}
```

| Field | Type | Description |
|-------|------|-------------|
| `PK` | string | `SCHEDULE/{repo}` |
| `SK` | string | `{workspace}` |
| `cronExpression` | string | Unix 5-field cron (e.g. `0 2 * * *`) |
| `timezone` | string | IANA timezone (e.g. `Australia/Sydney`) |
| `forceTaskPatterns` | string[] | Regex patterns matching tasks to force |
| `enabled` | boolean | Whether schedule is active |
| `description` | string? | Optional human-readable description |
| `createdBy` | string | User ID who created the schedule |
| `createdAt` | string | ISO 8601 |
| `updatedAt` | string | ISO 8601 |
| `schedulerName` | string | EventBridge Scheduler name (for management) |

### East Types

Following the established pattern of types → core → client packages:

#### e3-cloud-types (new types)

```typescript
// Schedule data model
export const ScheduleType = StructType({
  repo: StringType,
  workspace: StringType,
  cronExpression: StringType,           // Unix 5-field: "0 2 * * *"
  timezone: StringType,                 // IANA: "Australia/Sydney"
  forceTaskPatterns: ArrayType(StringType),
  enabled: BooleanType,
  description: OptionType(StringType),
  createdBy: StringType,                // userId
  createdAt: StringType,                // ISO 8601
  updatedAt: StringType,                // ISO 8601
});

// PUT request body
export const ScheduleRequestType = StructType({
  cronExpression: StringType,
  timezone: OptionType(StringType),     // Falls back to deployment default
  forceTaskPatterns: ArrayType(StringType),
  enabled: BooleanType,
  description: OptionType(StringType),
});
```

#### e3-cloud-core (new interface)

```typescript
export interface ScheduleStore {
  get(repo: string, workspace: string): Promise<Schedule | null>;
  put(repo: string, workspace: string, schedule: Schedule): Promise<void>;
  delete(repo: string, workspace: string): Promise<void>;
  listForRepo(repo: string): Promise<Schedule[]>;
  deleteAllForRepo(repo: string): Promise<void>;
}
```

#### e3-cloud-client (new functions)

```typescript
export async function getSchedule(url: string, repo: string, workspace: string, options: RequestOptions): Promise<Schedule | null>;
export async function setSchedule(url: string, repo: string, workspace: string, request: ScheduleRequest, options: RequestOptions): Promise<Schedule>;
export async function removeSchedule(url: string, repo: string, workspace: string, options: RequestOptions): Promise<void>;
export async function listSchedules(url: string, repo: string, options: RequestOptions): Promise<Schedule[]>;
```

### Cron Expression Format

Our interfaces and storage use **Unix 5-field cron** (minute, hour, day-of-month, month, day-of-week). This is cloud-vendor-agnostic.

When calling AWS EventBridge Scheduler APIs, we convert to the AWS 6-field format (which adds a year field). The conversion happens in the API handler, not in the data model.

```
User input (Unix):    0 2 * * *           → "daily at 2 AM"
Stored in DynamoDB:   0 2 * * *           → Unix 5-field
AWS Scheduler API:    cron(0 2 * * ? *)   → AWS 6-field (day-of-week ? when day-of-month is *)
```

### Timezone

Each deployment has a **default timezone** configured in the deployment JSON:

```json
{
  "name": "elara-dev",
  "aws": { "region": "ap-southeast-2", ... },
  "scheduling": {
    "defaultTimezone": "Australia/Sydney"
  },
  ...
}
```

- The deployment default is passed to the API handler as an environment variable
- The schedule `timezone` field is always stored explicitly (resolved from request or default at creation time)
- EventBridge Scheduler natively supports IANA timezones — no conversion needed
- Users can override per-schedule via `--timezone` flag

## API

### Endpoints

All require `member` role on the repo (same as dataflow execution).

```
PUT    /api/repos/:repo/workspaces/:ws/schedule   — Create or update schedule
GET    /api/repos/:repo/workspaces/:ws/schedule   — Get schedule (404 if none)
DELETE /api/repos/:repo/workspaces/:ws/schedule   — Delete schedule
GET    /api/repos/:repo/schedules                 — List all schedules for repo
```

PUT is idempotent: creates the EventBridge schedule on first call, updates on subsequent calls.

### PUT /api/repos/:repo/workspaces/:ws/schedule

Request body: `ScheduleRequestType` (BEAST2 encoded)

Handler logic:
1. Decode and validate request
2. Validate workspace exists (don't need to check deployed — may deploy later)
3. Validate cron expression syntax
4. Resolve timezone: use request value, or fall back to deployment default
5. Generate EventBridge Scheduler name: `{prefix}-{repo}-{workspace}`
6. Write schedule to DynamoDB
7. Create or update EventBridge Scheduler schedule:
   - Schedule expression: convert Unix cron → AWS cron
   - Timezone: IANA string (native support)
   - Target: schedule-trigger Lambda ARN
   - Input: `{ "repo": "{repo}", "workspace": "{workspace}", "schedulerExecutionId": "<aws.scheduler.execution-id>", "scheduledTime": "<aws.scheduler.scheduled-time>" }`
   - State: ENABLED or DISABLED based on `enabled` flag
   - Retry policy: 0 retries (next invocation will try again)
   - LoggingConfiguration: enabled (logs delivery attempts, failures, and retries to CloudWatch)
8. Return `ScheduleType` response

### DELETE /api/repos/:repo/workspaces/:ws/schedule

1. Read schedule from DynamoDB (get `schedulerName`)
2. Delete EventBridge Scheduler schedule
3. Delete DynamoDB record
4. Return 200

### Cleanup

Schedules must be cleaned up when their workspace or repo is deleted:

**On repo delete:** Add to the existing `deleteRepoBatch` scan prefixes:
```typescript
scanPrefixes.push(`SCHEDULE/${repo}/`);
```
Also delete all EventBridge Scheduler schedules for the repo.

**On workspace delete:** Delete the schedule (DynamoDB + EventBridge Scheduler) before removing the workspace.

## CLI

### Commands

```bash
# Set a schedule — run daily at 2 AM Sydney time, forcing datasource tasks
e3-cloud schedule set https://dev.e3.elaraai.com/repos/acme/workspaces/main \
  --cron "0 2 * * *" \
  --force-tasks "load_orders,load_customers" \
  --description "Nightly data refresh"

# Set with regex patterns
e3-cloud schedule set https://dev.e3.elaraai.com/repos/acme/workspaces/main \
  --cron "0 2 * * *" \
  --force-tasks "input.*"

# Set with explicit timezone override
e3-cloud schedule set https://dev.e3.elaraai.com/repos/acme/workspaces/main \
  --cron "0 14 * * 1-5" \
  --force-tasks "load_orders" \
  --timezone "America/New_York" \
  --description "Weekday 2 PM ET refresh"

# View current schedule
e3-cloud schedule get https://dev.e3.elaraai.com/repos/acme/workspaces/main

# Disable without removing (e.g. for maintenance)
e3-cloud schedule set https://dev.e3.elaraai.com/repos/acme/workspaces/main \
  --enabled false

# Re-enable
e3-cloud schedule set https://dev.e3.elaraai.com/repos/acme/workspaces/main \
  --enabled true

# Remove entirely
e3-cloud schedule remove https://dev.e3.elaraai.com/repos/acme/workspaces/main

# List all schedules for a repo
e3-cloud schedule list https://dev.e3.elaraai.com/repos/acme
```

### Output Examples

**`schedule get`:**
```
Schedule for acme/main:
  Cron:            0 2 * * *  (daily at 2:00 AM)
  Timezone:        Australia/Sydney
  Force tasks:     input.*
  Status:          enabled
  Description:     Nightly data refresh
  Last updated:    2026-02-10T14:30:00Z
```

**`schedule list`:**
```
Schedules for acme:
  main        0 2 * * *   Australia/Sydney   enabled    Nightly data refresh
  staging     0 6 * * 1   Australia/Sydney   disabled   Weekly Monday refresh
```

### URL Parsing

The CLI already parses URLs like `https://server/repos/{repo}`. Extend to also parse `https://server/repos/{repo}/workspaces/{workspace}` for schedule commands. The `list` command only needs the repo URL.

## Infrastructure (CDK)

### New Resources

```typescript
// 1. EventBridge Scheduler Group — organises all e3 schedules
const schedulerGroup = new scheduler.CfnScheduleGroup(this, 'ScheduleGroup', {
  name: `${prefix}-schedules`,
});

// 2. Schedule Trigger Lambda
const scheduleTriggerFn = new nodejs.NodejsFunction(this, 'ScheduleTriggerHandler', {
  functionName: `${prefix}-schedule-trigger`,
  runtime: lambda.Runtime.NODEJS_22_X,
  entry: path.join(runnerPackagePath, 'src', 'handlers', 'schedule-trigger.ts'),
  handler: 'handler',
  timeout: cdk.Duration.minutes(2),
  memorySize: 512,
  environment: {
    TABLE_NAME: this.dataTable.tableName,
    BUCKET_NAME: this.dataBucket.bucketName,
    DATAFLOW_STATE_MACHINE_ARN: this.dataflowStateMachine.stateMachineArn,
  },
});
this.dataTable.grantReadWriteData(scheduleTriggerFn);
this.dataflowStateMachine.grantStartExecution(scheduleTriggerFn);

// 3. IAM Role for EventBridge Scheduler → Lambda invocation
const schedulerRole = new iam.Role(this, 'SchedulerExecutionRole', {
  roleName: `${prefix}-scheduler-role`,
  assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
});
scheduleTriggerFn.grantInvoke(schedulerRole);

// 4. CloudWatch log group for EventBridge Scheduler delivery logging
//    Logs every schedule invocation (success, failure, throttle) for production
//    debugging and enterprise support. The schedule-trigger Lambda also logs
//    its own outcomes (started/skipped + reason + schedulerExecutionId), so
//    between the two log groups you get full end-to-end observability.
const schedulerLogGroup = new logs.LogGroup(this, 'SchedulerLogGroup', {
  logGroupName: `/aws/scheduler/${prefix}-schedules`,
  retention: logs.RetentionDays.ONE_MONTH,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});
schedulerLogGroup.grantWrite(schedulerRole);

// 5. API handler permissions for Scheduler management
apiHandler.addToRolePolicy(new iam.PolicyStatement({
  actions: [
    'scheduler:CreateSchedule',
    'scheduler:UpdateSchedule',
    'scheduler:DeleteSchedule',
    'scheduler:GetSchedule',
  ],
  resources: [
    `arn:aws:scheduler:${this.region}:${this.account}:schedule/${prefix}-schedules/*`,
  ],
}));
apiHandler.addToRolePolicy(new iam.PolicyStatement({
  actions: ['iam:PassRole'],
  resources: [schedulerRole.roleArn],
  conditions: {
    StringEquals: {
      'iam:PassedToService': 'scheduler.amazonaws.com',
    },
  },
}));

// 5. Environment variables for API handler
apiHandler.addEnvironment('SCHEDULER_GROUP_NAME', `${prefix}-schedules`);
apiHandler.addEnvironment('SCHEDULER_ROLE_ARN', schedulerRole.roleArn);
apiHandler.addEnvironment('SCHEDULE_TRIGGER_FN_ARN', scheduleTriggerFn.functionArn);
apiHandler.addEnvironment('DEFAULT_TIMEZONE', deploymentConfig.scheduling?.defaultTimezone ?? 'UTC');
```

### Deployment Config Extension

```json
{
  "name": "elara-dev",
  "aws": {
    "accountId": "925445553972",
    "region": "ap-southeast-2",
    "profile": "elaraai-dev-elara-e3"
  },
  "scheduling": {
    "defaultTimezone": "Australia/Sydney"
  },
  ...
}
```

### Stack Outputs

New outputs for integration testing:

```typescript
new cdk.CfnOutput(this, 'SchedulerGroupName', {
  value: schedulerGroup.name!,
  exportName: `${prefix}-scheduler-group-name`,
});
new cdk.CfnOutput(this, 'ScheduleTriggerFnArn', {
  value: scheduleTriggerFn.functionArn,
  exportName: `${prefix}-schedule-trigger-fn-arn`,
});
```

## schedule-trigger Lambda

Located in `packages/e3-aws-runner/src/handlers/schedule-trigger.ts`.

This handler mirrors the dataflow start logic in the API handler but runs without user authentication (invoked by EventBridge Scheduler with a service role).

```typescript
interface ScheduleTriggerEvent {
  repo: string;
  workspace: string;
  schedulerExecutionId: string;   // Resolved from <aws.scheduler.execution-id>
  scheduledTime: string;          // Resolved from <aws.scheduler.scheduled-time>
}

interface ScheduleTriggerResult {
  status: 'started' | 'skipped';
  reason?: 'disabled' | 'locked' | 'not_found' | 'not_deployed';
  executionId?: string;
  runId?: string;
  schedulerExecutionId?: string;
}
```

**Handler flow:**
1. Read schedule from DynamoDB (`SCHEDULE/{repo}/{workspace}`)
2. If not found or disabled → return `skipped`
3. Validate workspace exists and has a deployed package
4. Get task graph via `dataflowGetGraph()`
5. Resolve `forceTaskPatterns` against task graph → `forceTasks: string[]`
6. Acquire workspace lock with `variant('schedule', null)` — if locked, return `skipped`
7. Create execution state (same pattern as API handler)
8. Generate `runId` (UUIDv7) and execution name
9. Start Step Functions with `{ repo, workspace, executionId, forceTasks, runId }`
10. Create DataflowRun with `triggeredBy: variant('schedule', { schedulerExecutionId, scheduledTime })`
11. Return `started` with executionId, runId, and schedulerExecutionId

## Step Functions Changes

### State Machine Input

Add `forceTasks` to the state machine input schema:

```json
{
  "repo": "acme",
  "workspace": "main",
  "executionId": 42,
  "force": false,
  "forceTasks": ["load_orders", "load_customers"],
  "runId": "...",
  "triggeredBy": "schedule"
}
```

For manually triggered dataflows, `forceTasks` is omitted (or empty array). The existing `force: true` flag continues to work as before (forces all tasks).

### Pass-Through in State Machine

`forceTasks` must be threaded through the state machine to reach dispatch-task. Update the Map iterator's Parameters in the CDK state machine definition:

```json
{
  "repo.$": "$.repo",
  "workspace.$": "$.workspace",
  "executionId.$": "$.executionId",
  "taskName.$": "$$.Map.Item.Value",
  "force.$": "$.force",
  "forceTasks.$": "$.forceTasks",
  "runId.$": "$.runId"
}
```

### dispatch-task Change

One-line change in `dispatch-task.ts`:

```typescript
// Before:
if (prepare.cachedOutputHash && !force) {

// After:
if (prepare.cachedOutputHash && !force && !forceTasks?.includes(taskName)) {
```

Where `forceTasks` comes from the event:
```typescript
const { repo, workspace, executionId, taskName, force, forceTasks } = event;
```

## Implementation Plan

### Phase 1: Infrastructure & Data Model
1. Add `scheduling.defaultTimezone` to DeploymentConfig and elara-dev.json
2. Add East types to e3-cloud-types (ScheduleType, ScheduleRequestType)
3. Add ScheduleStore interface to e3-cloud-core
4. Implement DynamoScheduleStore in e3-aws-storage
5. Add CDK resources (Scheduler group, trigger Lambda, IAM role, API permissions)

### Phase 2: API & Trigger Lambda
1. Add schedule API endpoints to e3-aws-api (PUT, GET, DELETE, list)
2. Implement EventBridge Scheduler management in API handler (cron conversion, create/update/delete)
3. Implement schedule-trigger Lambda in e3-aws-runner
4. Add forceTasks to dispatch-task handler
5. Thread forceTasks through Step Functions state machine definition
6. Add triggeredBy to DataflowRun creation (get-graph + API handler)

### Phase 3: CLI & Cleanup
1. Add schedule commands to e3-cloud-cli (set, get, remove, list)
2. Add client functions to e3-cloud-client
3. Add schedule cleanup to repo delete flow
4. Add schedule cleanup to workspace delete flow
5. Update README.md files with schedule documentation

### Phase 4: Testing
1. Unit tests for cron conversion (Unix → AWS format)
2. Unit tests for force task pattern matching
3. Integration tests: create schedule, verify EventBridge schedule created
4. Integration tests: trigger schedule, verify dataflow runs with forced tasks
5. Integration tests: delete schedule, verify cleanup

## Appendix: Cron Conversion

Unix 5-field to AWS 6-field conversion:

```
Unix:  min hour dom month dow
AWS:   cron(min hour dom month dow year)
```

Rules:
- If both `dom` and `dow` are `*`, set `dow` to `?` (AWS requires exactly one `?`)
- If `dom` is not `*`, set `dow` to `?`
- If `dow` is not `*`, set `dom` to `?`
- Append `*` for year field
- AWS `dow` uses `1-7` (Sun-Sat) or `SUN-SAT`; Unix uses `0-7` (both 0 and 7 = Sun) — normalize

Examples:
```
0 2 * * *     →  cron(0 2 * * ? *)      daily at 2 AM
30 8 * * 1-5  →  cron(30 8 ? * 2-6 *)   weekdays at 8:30 AM (AWS MON=2)
0 0 1 * *     →  cron(0 0 1 * ? *)      first of every month
*/15 * * * *  →  cron(*/15 * * * ? *)    every 15 minutes
```

## Appendix: Fault Tolerance Audit

A platform-wide review of distributed failure modes for all server-side paths where we control both sides. User-facing interactions (API responses, CLI errors) are excluded — those propagate errors to the caller by design.

### Delivery Guarantees

EventBridge Scheduler provides **at-least-once** delivery to Lambda targets. There is no exactly-once primitive in the Scheduler → Lambda path. For our schedule-trigger, the workspace lock provides natural idempotency: a duplicate invocation hits the lock and returns `skipped`. The worst-case race (two invocations both acquiring before either locks) results in two dataflow runs — operationally harmless since task execution is cache-idempotent.

### Gap Summary

| # | Component | Gap | Severity | Impact | Current Recovery |
|---|-----------|-----|----------|--------|------------------|
| 1 | GC state machine | No catch blocks — repo stuck in `gc` status forever | **CRITICAL** | Repo permanently frozen (blocks all writes, dataflows, deletion) | Manual DynamoDB update |
| 2 | Workspace locks | TTL (5 min) shorter than dataflow execution (up to 24h) | **HIGH** | Lock expires mid-execution, concurrent dataflow corrupts state | None — design flaw |
| 3 | Workspace locks | No lock renewal mechanism | **HIGH** | Same as #2 | None |
| 4 | Dataflow SM | No catch on GetReady, ApplyResults, ApplyTreeUpdates | **HIGH** | Orphaned lock + execution stuck in `running` | Lock TTL (5 min) only |
| 5 | Dataflow SM | No catch on Map state itself | MEDIUM | Same as #4 | Lock TTL (5 min) only |
| 6 | Scheduler | `MaximumRetryAttempts: 0` with no DLQ | MEDIUM | Scheduled execution silently dropped | Next cron firing |
| 7 | Scheduler | DynamoDB/EventBridge write non-atomic | LOW | Phantom schedule record (exists in DB, never fires) | Manual cleanup |
| 8 | Dataflow SM | No DLQ on state machine | LOW | SM failure with no alerting | CloudWatch only |
| 9 | Dataflow SM | No iteration cap on WaitForProgress loop | MEDIUM | Zombie tasks hold lock for up to 24h | SM timeout |
| 10 | GC SM | No DLQ on state machine | LOW | Silent GC failure | CloudWatch only |
| 11 | GC scheduler | No DLQ on EventBridge Rule target | LOW | Missed daily GC | Next day |
| 12 | Repo deletion | Non-atomic multi-step delete | MEDIUM | Partially deleted repo stuck in `deleting` | Manual cleanup |
| 13 | apply-results | Non-atomic multi-write on retry | LOW | Duplicate execution records (unique UUIDs, low impact) | Idempotent by design |
| 14 | GC SM | Orphaned `gc-temp/` files on failure | LOW | S3 storage waste | Manual cleanup or lifecycle rule |
| 15 | S3+DynamoDB | S3 write without catalogue entry | None | Orphaned S3 version | GC cleanup (by design) |

### Detailed Analysis

#### Gap 1: GC State Machine — No Error Recovery (CRITICAL)

The GC flow transitions a repo from `active` → `gc` status, then runs mark → sweep → cleanup, then transitions back to `active`. There are **zero `addCatch` blocks** on any GC Lambda state (`gcMarkState`, `gcSweepState`, `gcCleanupState`). If any of these Lambdas throw an unrecoverable error after `retryOnServiceExceptions` retries are exhausted, the state machine fails and the repo is stuck in `gc` status permanently.

A repo in `gc` status blocks all writes, dataflow execution, and deletion. The only recovery is a manual DynamoDB update changing the repo status back to `active`.

**Fix:** Add a catch-all on each GC state that routes to a `SetActiveOnError` state, reverting the repo status from `gc` to `active` before failing the state machine. This follows the same pattern as `getGraphState.addCatch(prepareFinalizeFailure)` in the dataflow state machine.

#### Gaps 2–3: Workspace Lock TTL vs Execution Duration (HIGH)

The workspace lock is acquired once with a 5-minute TTL (`DEFAULT_LOCK_TTL_SECONDS = 300`) and never renewed. The dataflow state machine has a 24-hour timeout. After 5 minutes, the lock's conditional write (`expiresAt < :now`) allows another caller to acquire it while the first dataflow is still running. Two concurrent dataflows on the same workspace would corrupt execution state.

In practice this hasn't caused issues because most dataflows complete within minutes and users don't typically trigger rapid concurrent runs. But for scheduled execution (where cron fires are automatic and unattended), the risk increases — a slow dataflow could still be running when the next cron fires an hour later.

**Fix options (pick one):**
1. **Lock renewal** — Add a heartbeat step in the state machine loop (e.g., in the WaitForProgress cycle) that extends the lock TTL. Requires a new Lambda or extending an existing handler.
2. **Long TTL** — Increase `DEFAULT_LOCK_TTL_SECONDS` to 25 hours (matching SM timeout + buffer). Simple but means a crashed execution blocks the workspace for 25 hours until TTL expires.
3. **Execution-state guard** — Instead of (or in addition to) the TTL lock, check execution state (`status === 'running'`) when acquiring. This is more robust but requires changes to the locking protocol.

Recommendation: Option 1 (lock renewal) gives the best balance — short TTL for crash recovery, extended protection during long runs.

#### Gap 4: Dataflow State Machine — Incomplete Catch Coverage (HIGH)

Only `getGraphState` and `executeTaskState` have `addCatch`. If `ApplyResults`, `ApplyTreeUpdates`, `GetReady`, or `FinalizeExecution` itself crashes after `retryOnServiceExceptions` retries are exhausted, the state machine fails with no lock release and execution state stuck in `running`.

The lock's 5-minute TTL is the only recovery, which compounds with Gap 2 — the lock expires, another run starts, but the old execution state is still `running`.

**Fix:** Add `addCatch` on all remaining Lambda states, routing to the failure finalization path (`prepareFinalizeFailure`). The existing `getGraphState.addCatch(prepareFinalizeFailure)` is the model to follow.

#### Gap 6: Scheduler — Silent Failure (MEDIUM)

With `MaximumRetryAttempts: 0` and no DLQ, if the schedule-trigger Lambda fails to be invoked (throttle, permissions issue, cold-start timeout), the event is silently dropped. CloudWatch `FailedInvocations` metric increments, but nobody sees it without an alarm. The CloudWatch Scheduler log group captures delivery attempts but not Lambda execution failures.

**Fix:** Add a shared SQS queue as a DLQ for EventBridge Scheduler. Reference it in each schedule's `DeadLetterConfig.Arn`. The queue captures the full failure payload (error code, error message, original target input with repo/workspace). Add a CloudWatch alarm on `ApproximateNumberOfMessagesVisible > 0` for operational alerting.

### Recommended Fix Priority

1. **GC catch blocks** (Gap 1) — Highest severity, straightforward fix. Add catch blocks routing to a `SetActiveOnError` state.
2. **Lock renewal** (Gaps 2–3) — Add heartbeat in the WaitForProgress loop to extend lock TTL during long dataflows.
3. **Dataflow SM catch blocks** (Gap 4) — Add catch on remaining states, routing to failure finalization path.
4. **Scheduler DLQ** (Gap 6) — One SQS queue, reference in schedule `DeadLetterConfig`. Add CloudWatch alarm.
5. **SM DLQs + CloudWatch alarms** (Gaps 8, 10, 11) — Alerting for state machine and GC scheduler failures.
