# e3 Cloud Development Plan

Development roadmap for cloud deployment of e3, targeting Option 3 (EFS-Backed Serverless) from cloud-options.md.

**Technology choices:**
- Infrastructure: AWS CDK (TypeScript)
- API: Lambda + API Gateway
- Storage: EFS (repository), DynamoDB (auth/tenants)
- Orchestration: Step Functions
- Compute: Lambda (east-node), Fargate (east-py, julia)

## Overview

```
Phase 1          Phase 2          Phase 3          Phase 4          Phase 5          Phase 6
────────────────────────────────────────────────────────────────────────────────────────────────
e3-core          e3-cloud         MVP              Production       Optimization     White-label
abstractions     repository       (east-node +     (all runners)    (S3/DynamoDB?)   (custom apps)
+ CLI auth       + cloud infra    frontend)
────────────────────────────────────────────────────────────────────────────────────────────────
     │                │                │                │                │                │
     ▼                ▼                ▼                ▼                ▼                ▼
  Storage DI      CDK stacks      Step Functions   Fargate pools    Performance      Lambda@Edge
  Execution DI    Cognito/DDB     Lambda handlers  EKS option       evaluation       App upload
  JWT auth        EFS setup       CloudFront/S3    Heavy compute    Storage swap?    Theming SDK
  CLI login       OAuth flow      east-ui render                                     Custom domains
```

---

## Phase 1: e3-core Abstractions + Auth Foundation

**Goal:** Add dependency injection for storage operations, and add optional JWT authentication support to e3-api-server and e3-cli.

### 1.1 Define Storage Interfaces

Create interfaces in `e3-core` (or new `e3-types`):

```typescript
// packages/e3-core/src/storage/interfaces.ts

interface ObjectStore {
  write(data: Uint8Array): Promise<string>;
  read(hash: string): Promise<Uint8Array>;
  exists(hash: string): Promise<boolean>;
  list(prefix: string): Promise<string[]>;  // For GC
}

interface RefStore {
  // Packages
  packageList(): Promise<{ name: string; version: string }[]>;
  packageResolve(name: string, version: string): Promise<string | null>;
  packageWrite(name: string, version: string, hash: string): Promise<void>;
  packageRemove(name: string, version: string): Promise<void>;

  // Workspaces
  workspaceList(): Promise<string[]>;
  workspaceRead(name: string): Promise<WorkspaceState | null>;
  workspaceWrite(name: string, state: WorkspaceState): Promise<void>;
  workspaceRemove(name: string): Promise<void>;

  // Executions
  executionGet(taskHash: string, inputsHash: string): Promise<ExecutionStatus | null>;
  executionWrite(taskHash: string, inputsHash: string, status: ExecutionStatus): Promise<void>;
  executionGetOutput(taskHash: string, inputsHash: string): Promise<string | null>;
  executionWriteOutput(taskHash: string, inputsHash: string, outputHash: string): Promise<void>;
  executionList(): Promise<{ taskHash: string; inputsHash: string }[]>;
}

interface LockService {
  acquire(resource: string, holder: LockHolder, ttlMs?: number): Promise<boolean>;
  release(resource: string, holder: LockHolder): Promise<void>;
  getHolder(resource: string): Promise<LockHolder | null>;
}

interface LogStore {
  append(executionId: string, stream: 'stdout' | 'stderr', data: string): Promise<void>;
  read(executionId: string, stream: 'stdout' | 'stderr', offset?: number, limit?: number): Promise<LogChunk>;
}

// Combined storage context passed to e3-core functions
interface StorageBackend {
  objects: ObjectStore;
  refs: RefStore;
  locks: LockService;
  logs: LogStore;
}
```

### 1.2 Define Execution Interfaces

Separate orchestration from business logic to enable Step Functions replacement:

```typescript
// packages/e3-core/src/execution/interfaces.ts

/**
 * Task execution abstraction.
 * Local: spawns east-node/east-py/julia process
 * Cloud: dispatches to Lambda/Fargate
 */
interface TaskRunner {
  execute(
    taskHash: string,
    inputHashes: string[],
    options?: {
      force?: boolean;
      signal?: AbortSignal;
      onStdout?: (data: string) => void;
      onStderr?: (data: string) => void;
    }
  ): Promise<{
    state: 'success' | 'failed' | 'error';
    cached: boolean;
    outputHash?: string;
    exitCode?: number;
    error?: string;
  }>;
}

/**
 * Dataflow orchestration abstraction.
 * Local: in-process loop with AsyncMutex
 * Cloud: Step Functions state machine
 */
interface ExecutionHandle {
  id: string;  // Local: UUID, Cloud: Step Functions execution ARN
}

interface DataflowExecutor {
  start(storage: StorageBackend, ws: string, options?: DataflowOptions): Promise<ExecutionHandle>;
  getStatus(handle: ExecutionHandle): Promise<DataflowStatus>;
  cancel(handle: ExecutionHandle): Promise<void>;
}
```

### 1.3 Implement LocalBackend

Wrap existing filesystem code behind the interfaces:

```
packages/e3-core/src/storage/
├── interfaces.ts       # Interface definitions
├── local/
│   ├── index.ts        # LocalBackend factory
│   ├── objects.ts      # LocalObjectStore (wraps existing objects.ts)
│   ├── refs.ts         # LocalRefStore (wraps packages.ts, workspaces.ts, executions.ts)
│   ├── locks.ts        # LocalLockService (wraps workspaceLock.ts)
│   └── logs.ts         # LocalLogStore (wraps execution log handling)
└── index.ts            # Re-exports
```

### 1.4 Refactor e3-core Functions (Storage)

Update e3-core functions to accept `StorageBackend` instead of `repoPath`:

```typescript
// Before
export async function workspaceGetDataset(repoPath: string, ws: string, path: TreePath): Promise<unknown>

// After
export async function workspaceGetDataset(storage: StorageBackend, ws: string, path: TreePath): Promise<unknown>
```

### 1.5 Refactor dataflow.ts for Execution Abstraction

Extract the inner functions from `dataflowExecute()` as standalone, exported functions. These are the business logic that both local and cloud execution share:

```typescript
// packages/e3-core/src/dataflow.ts

/**
 * Get the task dependency graph for a workspace.
 * Pure function - no side effects.
 */
export async function dataflowGetGraph(
  storage: StorageBackend,
  ws: string
): Promise<TaskGraph>;

/**
 * Check if a task's output is cached.
 * Returns the cached output hash if available, null otherwise.
 */
export async function dataflowCheckCache(
  storage: StorageBackend,
  taskHash: string,
  inputHashes: string[]
): Promise<string | null>;

/**
 * Execute a single task (spawn runner, collect output).
 * Does NOT update workspace tree - just returns result.
 */
export async function dataflowExecuteTask(
  storage: StorageBackend,
  taskHash: string,
  inputHashes: string[],
  options?: {
    signal?: AbortSignal;
    onStdout?: (data: string) => void;
    onStderr?: (data: string) => void;
  }
): Promise<{
  state: 'success' | 'failed' | 'error';
  outputHash?: string;
  exitCode?: number;
  error?: string;
}>;

/**
 * Write task output to workspace tree.
 * Called after successful task execution.
 */
export async function dataflowWriteOutput(
  storage: StorageBackend,
  ws: string,
  taskHash: string,
  outputHash: string
): Promise<void>;

/**
 * Get tasks that are ready to execute (all dependencies satisfied).
 * Used by orchestrator to determine next tasks to run.
 */
export async function dataflowGetReadyTasks(
  storage: StorageBackend,
  ws: string,
  graph: TaskGraph,
  completed: Set<string>
): Promise<string[]>;
```

The existing `dataflowExecute()` function is refactored to call these public APIs internally, keeping backward compatibility.

### 1.6 Implement LocalTaskRunner

Implement `TaskRunner` for local execution:

```typescript
// packages/e3-core/src/execution/local-task-runner.ts

export class LocalTaskRunner implements TaskRunner {
  constructor(private storage: StorageBackend) {}

  async execute(
    taskHash: string,
    inputHashes: string[],
    options?: ExecuteOptions
  ): Promise<TaskResult> {
    // Check cache first
    const cached = await dataflowCheckCache(this.storage, taskHash, inputHashes);
    if (cached && !options?.force) {
      return { state: 'success', cached: true, outputHash: cached };
    }

    // Execute the task
    const result = await dataflowExecuteTask(
      this.storage,
      taskHash,
      inputHashes,
      options
    );

    // Cache successful results
    if (result.state === 'success' && result.outputHash) {
      await this.storage.refs.executionWriteOutput(
        taskHash,
        hashInputs(inputHashes),
        result.outputHash
      );
    }

    return { ...result, cached: false };
  }
}
```

### 1.7 Implement LocalDataflowExecutor

Implement `DataflowExecutor` for local execution (wraps existing `processQueue` loop):

```typescript
// packages/e3-core/src/execution/local-dataflow-executor.ts

export class LocalDataflowExecutor implements DataflowExecutor {
  private executions = new Map<string, LocalExecution>();

  async start(
    storage: StorageBackend,
    ws: string,
    options?: DataflowOptions
  ): Promise<ExecutionHandle> {
    const id = crypto.randomUUID();
    const execution = new LocalExecution(storage, ws, options);
    this.executions.set(id, execution);

    // Start execution in background (non-blocking)
    execution.run().catch(err => {
      execution.setError(err);
    });

    return { id };
  }

  async getStatus(handle: ExecutionHandle): Promise<DataflowStatus> {
    const execution = this.executions.get(handle.id);
    if (!execution) throw new Error(`Unknown execution: ${handle.id}`);
    return execution.getStatus();
  }

  async cancel(handle: ExecutionHandle): Promise<void> {
    const execution = this.executions.get(handle.id);
    if (!execution) throw new Error(`Unknown execution: ${handle.id}`);
    execution.cancel();
  }
}

class LocalExecution {
  private taskRunner: LocalTaskRunner;
  private abortController = new AbortController();
  private status: DataflowStatus = { state: 'running', completed: [], pending: [] };

  constructor(
    private storage: StorageBackend,
    private ws: string,
    private options?: DataflowOptions
  ) {
    this.taskRunner = new LocalTaskRunner(storage);
  }

  async run(): Promise<void> {
    // Acquire workspace lock
    await this.storage.locks.acquire(`workspace:${this.ws}`, ...);

    try {
      const graph = await dataflowGetGraph(this.storage, this.ws);
      const completed = new Set<string>();

      // Process queue loop (existing logic, now using extracted functions)
      while (true) {
        const ready = await dataflowGetReadyTasks(this.storage, this.ws, graph, completed);
        if (ready.length === 0) break;

        // Execute ready tasks with concurrency limit
        await Promise.all(
          ready.slice(0, this.options?.concurrency ?? 4).map(async taskHash => {
            const inputs = getTaskInputHashes(graph, taskHash, completed);
            const result = await this.taskRunner.execute(taskHash, inputs, {
              signal: this.abortController.signal,
            });

            if (result.state === 'success') {
              await dataflowWriteOutput(this.storage, this.ws, taskHash, result.outputHash!);
              completed.add(taskHash);
            }
          })
        );
      }

      this.status = { state: 'completed', completed: [...completed], pending: [] };
    } finally {
      await this.storage.locks.release(`workspace:${this.ws}`, ...);
    }
  }

  cancel(): void {
    this.abortController.abort();
  }

  getStatus(): DataflowStatus { return this.status; }
  setError(err: Error): void { this.status = { state: 'failed', error: err.message, ... }; }
}
```

### 1.8 Update Dependents

- Update `e3-cli` to construct `LocalBackend` from repo path
- Update `e3-cli` to use `LocalDataflowExecutor` for `e3 run` command
- Update `e3-api-server` to construct backend at startup
- Update `e3-api-server` to use `LocalDataflowExecutor` for run endpoints
- Update integration tests

### 1.9 e3-api-server Auth Support

Add optional JWT authentication to e3-api-server:

```typescript
// packages/e3-api-server/src/auth.ts

interface AuthConfig {
  jwksUrl?: string;           // Cloud: Cognito JWKS endpoint
  publicKeyPath?: string;     // Local: path to PEM public key
  issuer?: string;            // Expected JWT issuer
  audience?: string;          // Expected JWT audience
}

interface AuthService {
  validateToken(token: string): Promise<Identity | null>;
}

// Implementations
class NoAuthService implements AuthService { ... }      // Always allows
class JwtAuthService implements AuthService { ... }    // Validates JWT
```

Server startup:

```bash
# No auth (current behavior, local dev)
e3-api-server --repo .

# With JWT auth (local, using public key)
e3-api-server --repo . --auth-public-key ./keys/public.pem

# With JWT auth (cloud-style, using JWKS)
e3-api-server --repo . --auth-jwks-url https://cognito-idp.../.well-known/jwks.json
```

Middleware validates `Authorization: Bearer <token>` header and sets identity on context.

### 1.10 e3-cli Auth Support

Add credential management and auth headers to e3-cli:

```
~/.e3/
└── credentials.json
    {
      "https://example.com/repos/acme": {
        "token": "eyJ...",
        "expiresAt": "2025-01-10T..."
      }
    }
```

**New CLI commands:**

```bash
# Store a token (manual, for local servers with auth)
e3 login https://localhost:3000 --token <paste-token>

# Check stored credentials
e3 auth status

# Remove stored credentials
e3 logout https://localhost:3000
```

**HTTP client updates:**

```typescript
// e3-api-client sends Authorization header if token available
const token = await getStoredToken(serverUrl);
if (token) {
  headers['Authorization'] = `Bearer ${token}`;
}
```

OAuth browser login flow (`e3 login <url>` without `--token`) deferred to Phase 2 when Cognito is set up.
We could optionally add token generation (via provided private key) to the CLI for testing purposes.

### Deliverables

**Storage abstraction:**
- [ ] Storage interfaces defined (`ObjectStore`, `RefStore`, `LockService`, `LogStore`)
- [ ] `LocalBackend` implementation passing all existing tests
- [ ] e3-core functions refactored to use `StorageBackend`

**Execution abstraction:**
- [ ] Execution interfaces defined (`TaskRunner`, `DataflowExecutor`)
- [ ] `dataflowGetGraph()`, `dataflowCheckCache()`, `dataflowExecuteTask()`, `dataflowWriteOutput()`, `dataflowGetReadyTasks()` extracted as public APIs
- [ ] `LocalTaskRunner` implementation
- [ ] `LocalDataflowExecutor` implementation
- [ ] Existing `dataflowExecute()` refactored to use new APIs (backward compatible)

**Dependents:**
- [ ] e3-cli updated for storage and execution DI
- [ ] e3-api-server updated for storage and execution DI
- [ ] Integration tests passing

**Auth:**
- [ ] `AuthService` interface and `JwtAuthService` implementation
- [ ] e3-api-server `--auth-public-key` and `--auth-jwks-url` options
- [ ] e3-cli credential storage (`~/.e3/credentials.json`)
- [ ] e3-cli `login --token`, `logout`, `auth status` commands
- [ ] e3-api-client sends Authorization header when token available
- [ ] Integration tests passing (with and without auth)

---

## Phase 2: e3-cloud Repository

**Goal:** Create the cloud infrastructure and application scaffold.

### 2.1 Repository Setup

Create private repository `e3-cloud`. Infrastructure managed with **AWS CDK (TypeScript)** - keeps everything in one language and integrates well with our existing tooling.

```
e3-cloud/
├── infrastructure/           # AWS CDK (TypeScript)
│   ├── lib/
│   │   ├── api-stack.ts      # API Gateway + Lambda
│   │   ├── storage-stack.ts  # EFS + DynamoDB
│   │   ├── compute-stack.ts  # Step Functions (+ later Fargate)
│   │   └── auth-stack.ts     # Cognito
│   └── bin/
│       └── e3-cloud.ts       # CDK app entry
│
├── packages/
│   ├── e3-cloud-api/         # Lambda handlers
│   │   ├── src/
│   │   │   ├── handlers/     # API route handlers
│   │   │   ├── auth/         # TenantAuthService
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── e3-cloud-storage/     # EFS-backed StorageBackend
│   │   ├── src/
│   │   │   ├── efs-backend.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   └── e3-cloud-runner/      # Task runner for Lambda/Fargate
│       ├── src/
│       │   ├── lambda.ts     # Lambda handler for east-node
│       │   └── index.ts
│       └── package.json
│
├── package.json              # Workspace root
└── README.md
```

### 2.2 CDK Infrastructure

All infrastructure defined in TypeScript using AWS CDK. Core stacks:

**StorageStack:**
- EFS filesystem with access points per tenant
- DynamoDB tables: `tenants`, `users`, `permissions`
- VPC configuration for Lambda → EFS access

**AuthStack:**
- Cognito User Pool (or integration point for external IdP)
- JWT validation configuration

**ApiStack:**
- API Gateway (HTTP API)
- Lambda function for e3-cloud-api
- EFS mount for Lambda
- Environment configuration

**ComputeStack (Phase 3):**
- Step Functions state machine for dataflow
- Lambda function for east-node task execution

### 2.3 Tenant Management

DynamoDB schema:

```typescript
// tenants table
{
  PK: "TENANT#<tenant-id>",
  name: string,
  createdAt: string,
  efsAccessPointId: string,
  settings: { ... }
}

// permissions table
{
  PK: "USER#<user-id>",
  SK: "TENANT#<tenant-id>",
  role: "admin" | "member",
  grantedAt: string,
  grantedBy: string
}
```

### 2.4 EFS Backend

Implement `StorageBackend` using EFS:

```typescript
// packages/e3-cloud-storage/src/efs-backend.ts

export class EfsBackend implements StorageBackend {
  private basePath: string;  // /mnt/efs/tenants/<tenant-id>

  constructor(tenantId: string) {
    this.basePath = `/mnt/efs/tenants/${tenantId}`;
  }

  get objects(): ObjectStore {
    return new LocalObjectStore(path.join(this.basePath, '.e3'));
  }

  get refs(): RefStore {
    return new LocalRefStore(path.join(this.basePath, '.e3'));
  }

  // ... etc - mostly delegates to LocalBackend with different base path
}
```

### 2.5 OAuth Login Flow

Complete the OAuth browser login flow for e3-cli (deferred from Phase 1):

```bash
# Browser-based login (opens browser → Cognito hosted UI → callback)
e3 login https://example.com/repos/acme
```

**Flow:**

```
┌─────────┐    ┌─────────────┐    ┌─────────────┐    ┌──────────┐
│ e3 CLI  │───►│ Local HTTP  │◄───│  Browser    │◄───│ Cognito  │
│ login   │    │ callback    │    │  redirect   │    │ OAuth    │
│         │    │ :45678      │    │             │    │          │
└─────────┘    └──────┬──────┘    └─────────────┘    └──────────┘
                      │
                      ▼
               Store token in
               ~/.e3/credentials.json
```

**Implementation:**
1. CLI starts temporary HTTP server on localhost (e.g., port 45678)
2. Opens browser to Cognito authorization URL with redirect to localhost
3. User authenticates in browser
4. Cognito redirects to localhost with authorization code
5. CLI exchanges code for tokens
6. CLI stores tokens and shuts down temp server

### Deliverables

- [ ] e3-cloud repository created
- [ ] CDK infrastructure for EFS, DynamoDB, API Gateway, Lambda, Cognito
- [ ] Cognito User Pool with hosted UI configured
- [ ] Tenant management (create, list, delete)
- [ ] User/permission management
- [ ] `EfsBackend` implementation
- [ ] Basic API endpoints working (workspace list, get, set)
- [ ] OAuth browser login flow in e3-cli (`e3 login <url>`)
- [ ] Token refresh handling in e3-api-client

---

## Phase 3: MVP (east-node on Lambda)

**Goal:** Complete working system with east-node tasks running on Lambda, orchestrated by Step Functions.

### 3.1 Step Functions Architecture

Step Functions are used at **two levels**:

1. **Dataflow orchestration** - manages the overall DAG execution
2. **Task execution wrapper** - manages each individual task (failure, cancellation, status)

```
┌─────────────────────────────────────────────────────────────────┐
│  Dataflow State Machine                                         │
│                                                                 │
│  ┌─────────────┐                                                │
│  │ AcquireLock │                                                │
│  └──────┬──────┘                                                │
│         │                                                       │
│  ┌──────▼──────┐                                                │
│  │  GetGraph   │ (Lambda: compute task DAG)                     │
│  └──────┬──────┘                                                │
│         │                                                       │
│  ┌──────▼──────┐                                                │
│  │ ExecuteDAG  │ (Map state, respects dependencies)             │
│  │             │                                                │
│  │  For each ready task:                                        │
│  │  ┌───────────────────────────────────────────────────────┐   │
│  │  │ StartExecution: TaskExecutionStateMachine (nested)    │   │
│  │  │                                                       │   │
│  │  │  ┌─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┐    │   │
│  │  │    Task Execution State Machine (per task)       │    │   │
│  │  │  │                                               │    │   │
│  │  │    ┌──────────┐                                  │    │   │
│  │  │  │ │CheckCache│                                  │    │   │
│  │  │    └────┬─────┘                                  │    │   │
│  │  │  │      │ (miss)                                 │    │   │
│  │  │    ┌────▼─────┐   ┌──────────┐                   │    │   │
│  │  │  │ │ RunTask  │──►│ OnError: │                   │    │   │
│  │  │    │ (Lambda/ │   │ Retry/   │                   │    │   │
│  │  │  │ │ Fargate) │   │ Fail     │                   │    │   │
│  │  │    └────┬─────┘   └──────────┘                   │    │   │
│  │  │  │      │                                        │    │   │
│  │  │    ┌────▼─────┐                                  │    │   │
│  │  │  │ │WriteResult                                  │    │   │
│  │  │    └──────────┘                                  │    │   │
│  │  │  └─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┘    │   │
│  │  └───────────────────────────────────────────────────────┘   │
│  │             │                                                │
│  └──────┬──────┘                                                │
│         │                                                       │
│  ┌──────▼──────┐                                                │
│  │ ReleaseLock │                                                │
│  └─────────────┘                                                │
└─────────────────────────────────────────────────────────────────┘
```

**Task Execution State Machine** provides per-task:

| Feature | Implementation |
|---------|----------------|
| **Status tracking** | Execution ARN stored, queryable via API |
| **Failure handling** | Catch blocks with configurable retry |
| **Cancellation** | StopExecution API cancels cleanly |
| **Timeouts** | TimeoutSeconds per state |
| **Logging** | CloudWatch integration via task token |

This means a user can:
- Query status of individual tasks (not just overall dataflow)
- Cancel a specific long-running task
- See detailed failure info per task
- Retry individual failed tasks

### 3.2 Step Functions ↔ e3-core Integration

Each Step Functions state calls an e3-core function via a Lambda handler. This reuses all the business logic from Phase 1:

| Step Functions State | Lambda Handler | e3-core Function |
|---------------------|----------------|------------------|
| GetGraph | `getGraphHandler` | `dataflowGetGraph()` |
| CheckCache | `checkCacheHandler` | `dataflowCheckCache()` |
| RunTask | `runTaskHandler` | `dataflowExecuteTask()` |
| WriteResult | `writeResultHandler` | `dataflowWriteOutput()` |
| GetReady | `getReadyHandler` | `dataflowGetReadyTasks()` |

**Lambda handlers** (thin wrappers around e3-core):

```typescript
// packages/e3-cloud-runner/src/handlers/get-graph.ts

import { dataflowGetGraph } from 'e3-core';
import { EfsBackend } from 'e3-cloud-storage';

export async function handler(event: {
  tenantId: string;
  workspace: string;
}): Promise<TaskGraph> {
  const storage = new EfsBackend(event.tenantId);
  return dataflowGetGraph(storage, event.workspace);
}
```

```typescript
// packages/e3-cloud-runner/src/handlers/check-cache.ts

import { dataflowCheckCache } from 'e3-core';
import { EfsBackend } from 'e3-cloud-storage';

export async function handler(event: {
  tenantId: string;
  taskHash: string;
  inputHashes: string[];
}): Promise<{ cached: boolean; outputHash?: string }> {
  const storage = new EfsBackend(event.tenantId);
  const outputHash = await dataflowCheckCache(storage, event.taskHash, event.inputHashes);
  return { cached: outputHash !== null, outputHash: outputHash ?? undefined };
}
```

```typescript
// packages/e3-cloud-runner/src/handlers/write-result.ts

import { dataflowWriteOutput } from 'e3-core';
import { EfsBackend } from 'e3-cloud-storage';

export async function handler(event: {
  tenantId: string;
  workspace: string;
  taskHash: string;
  outputHash: string;
}): Promise<void> {
  const storage = new EfsBackend(event.tenantId);
  await dataflowWriteOutput(storage, event.workspace, event.taskHash, event.outputHash);
}
```

**Key benefit:** Zero business logic in Step Functions or Lambda handlers - all logic lives in e3-core and is testable locally.

### 3.3 Lambda Task Runner

Lambda function that executes east-node tasks, using `dataflowExecuteTask()` from e3-core:

```typescript
// packages/e3-cloud-runner/src/handlers/run-task.ts

import { dataflowExecuteTask } from 'e3-core';
import { EfsBackend } from 'e3-cloud-storage';

export async function handler(event: {
  tenantId: string;
  taskHash: string;
  inputHashes: string[];
}): Promise<{
  state: 'success' | 'failed' | 'error';
  outputHash?: string;
  exitCode?: number;
  error?: string;
}> {
  const { tenantId, taskHash, inputHashes } = event;

  // Mount point is already configured via Lambda EFS
  const storage = new EfsBackend(tenantId);

  // Execute task using e3-core function
  // This handles: reading task definition, spawning runner, collecting output
  const result = await dataflowExecuteTask(
    storage,
    taskHash,
    inputHashes,
    {
      // CloudWatch logs integration for stdout/stderr
      onStdout: (data) => console.log(data),
      onStderr: (data) => console.error(data),
    }
  );

  // Cache successful results
  if (result.state === 'success' && result.outputHash) {
    await storage.refs.executionWriteOutput(
      taskHash,
      hashInputs(inputHashes),
      result.outputHash
    );
  }

  return result;
}
```

**Note:** For east-node tasks, the Lambda can run `east-node` directly since it's bundled with the Lambda function. For east-py/julia tasks (Phase 4), this handler is different - it dispatches to Fargate.

### 3.4 API Integration

Update API to trigger Step Functions:

```typescript
// POST /api/tenants/:tenant/workspaces/:ws/start
app.post('/api/tenants/:tenant/workspaces/:ws/start', async (c) => {
  // Auth check...

  // Start Step Functions execution
  const execution = await sfn.startExecution({
    stateMachineArn: DATAFLOW_STATE_MACHINE_ARN,
    input: JSON.stringify({
      tenantId: tenant,
      workspace: ws,
      // ... options
    }),
  });

  return success(c, { executionArn: execution.executionArn });
});

// GET /api/tenants/:tenant/workspaces/:ws/status
// Returns Step Functions execution status + workspace status
```

### 3.5 Frontend (Default App)

The MVP includes a default web app that renders `UIComponentType` datasets from workspaces.

**Architecture:**

```
CloudFront (platform.elaraai.com)
    │
    ├── /repos/{tenant}/        → S3 (default Vite app)
    ├── /repos/{tenant}/api/*   → API Gateway (pass-through)
    └── /login                  → S3 (global login)
```

**Default app features:**

```typescript
// apps/main/src/App.tsx

import { E3Client } from '@elaraai/e3-api-client';
import { EastChakraComponent, UIStoreProvider } from '@elaraai/east-ui-components';

// Tenant from URL path
const tenant = location.pathname.match(/^\/repos\/([^\/]+)/)?.[1];
const client = new E3Client({ baseUrl: `/repos/${tenant}/api` });

function WorkspaceView({ workspace, path }: { workspace: string; path: string }) {
  const [ui, setUi] = useState<UIComponentType | null>(null);

  useEffect(() => {
    client.workspaces.get(workspace, path).then(setUi);
  }, [workspace, path]);

  if (!ui) return <Spinner />;

  return (
    <UIStoreProvider>
      <EastChakraComponent value={ui} />
    </UIStoreProvider>
  );
}
```

**CDK additions (FrontendStack):**

```typescript
// S3 bucket for frontend apps
const appsBucket = new s3.Bucket(this, 'FrontendApps');

// CloudFront distribution
const distribution = new cloudfront.Distribution(this, 'Distribution', {
  defaultBehavior: {
    origin: new origins.S3Origin(appsBucket),
  },
  additionalBehaviors: {
    '/repos/*/api/*': {
      origin: new origins.HttpOrigin(apiGatewayDomain),
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
    },
    '/repos/*': {
      origin: new origins.S3Origin(appsBucket),
      // SPA routing: serve index.html for all paths
    },
  },
});
```

### 3.6 Testing & Validation

- Deploy to test environment
- Create test tenant
- Deploy sample package with east-node tasks and UIComponentType dashboard
- Execute dataflow, verify results
- Test frontend: login, workspace list, UI rendering
- Test concurrent executions
- Test error handling and retries

### Deliverables

**Backend:**
- [ ] Lambda handlers for e3-core functions (`getGraphHandler`, `checkCacheHandler`, `runTaskHandler`, `writeResultHandler`, `getReadyHandler`)
- [ ] Step Functions state machine (Dataflow + Task Execution) deployed via CDK
- [ ] Lambda task runner for east-node with EFS mount
- [ ] API endpoints: start, status, cancel, logs
- [ ] `StepFunctionsDataflowExecutor` implementing `DataflowExecutor` interface

**Frontend:**
- [ ] Default Vite app with Cognito login
- [ ] Workspace list and navigation
- [ ] `UIComponentType` rendering via `east-ui-components`
- [ ] CloudFront distribution with S3 + API Gateway routing
- [ ] CI/CD pipeline for frontend deployment

**Validation:**
- [ ] End-to-end test passing (backend + frontend)
- [ ] Documentation for MVP usage

---

## Phase 4: Production Runners (Fargate/EKS)

**Goal:** Add support for heavy compute tasks (east-py, julia) on Fargate or EKS.

### 4.1 Fargate Task Runner

For tasks that exceed Lambda limits:

```
┌─────────────────────────────────────────────────────────┐
│  Step Functions                                         │
│                                                         │
│  ┌──────────────┐                                       │
│  │  RunTask     │                                       │
│  │  (Choice)    │                                       │
│  └──────┬───────┘                                       │
│         │                                               │
│    ┌────┴─────┐                                         │
│    │          │                                         │
│ ┌──▼──┐    ┌──▼───┐                                     │
│ │east │    │east- │                                     │
│ │node │    │py/   │                                     │
│ │     │    │julia │                                     │
│ └──┬──┘    └──┬───┘                                     │
│    │          │                                         │
│ ┌──▼───┐   ┌──▼───────────────┐                         │
│ │Lambda│   │Fargate Task      │                         │
│ └──────┘   │(ECS RunTask      │                         │
│            │ with .waitFor)   │                         │
│            └──────────────────┘                         │
└─────────────────────────────────────────────────────────┘
```

**Infrastructure additions:**
- ECS Cluster (Fargate)
- Task definitions for east-py, julia runners
- Container images with dependencies pre-installed
- EFS mount configuration for Fargate tasks

### 4.2 Warm Pool (Optional)

For lower latency on Fargate:

- SQS queue for task dispatch
- Long-running Fargate tasks that poll for work
- Auto-scaling based on queue depth
- Scale-in protection for busy tasks

### 4.3 EKS Option

For clients requiring Kubernetes or more control:

- EKS cluster with managed node groups
- Kubernetes Jobs for task execution
- Persistent Volume Claims for EFS
- Step Functions → EKS integration via Lambda

### 4.4 Runner Configuration

Task routing based on runner type:

```typescript
// In Step Functions definition
{
  "RunTask": {
    "Type": "Choice",
    "Choices": [
      {
        "Variable": "$.task.runner",
        "StringEquals": "east-node",
        "Next": "RunLambda"
      },
      {
        "Variable": "$.task.runner",
        "StringEquals": "east-py",
        "Next": "RunFargate"
      },
      {
        "Variable": "$.task.runner",
        "StringEquals": "julia",
        "Next": "RunFargate"
      }
    ],
    "Default": "RunFargate"
  }
}
```

### Deliverables

- [ ] Fargate task definitions and container images
- [ ] Step Functions updated with runner routing
- [ ] EFS mounts working for Fargate
- [ ] (Optional) Warm pool implementation
- [ ] (Optional) EKS integration
- [ ] Performance testing with heavy workloads

---

## Phase 5: Optimization & Evaluation

**Goal:** Evaluate performance and decide whether to migrate repository storage from EFS to S3/DynamoDB.

### 5.1 Performance Benchmarking

Metrics to collect:

| Metric | Target | Measurement |
|--------|--------|-------------|
| API latency (p50) | <100ms | CloudWatch |
| API latency (p99) | <500ms | CloudWatch |
| Task startup (Lambda) | <1s | Step Functions |
| Task startup (Fargate) | <30s (warm), <90s (cold) | Step Functions |
| Object read latency | <50ms | Custom metrics |
| Object write latency | <100ms | Custom metrics |
| Concurrent tasks | 100+ | Load test |

### 5.2 Cost Analysis

Compare actual costs against estimates:

| Component | Estimated | Actual | Notes |
|-----------|-----------|--------|-------|
| EFS storage | $0.30/GB/mo | | |
| EFS throughput | | | May need provisioned |
| Lambda | | | Per-invocation |
| Fargate | | | Per-task |
| DynamoDB | | | On-demand |
| Data transfer | | | Cross-AZ? |

### 5.3 Decision: EFS vs S3/DynamoDB

Evaluate whether to implement Option 4 (S3/DynamoDB backend):

**Stay with EFS if:**
- Performance is acceptable
- Cost is acceptable
- Simplicity is valued
- No multi-region requirements

**Switch to S3/DynamoDB if:**
- EFS throughput is bottleneck
- Cost savings significant (S3 ~10x cheaper per GB)
- Multi-region replication needed
- Want to eliminate EFS (simpler Lambda config)

### 5.4 S3/DynamoDB Implementation (If Needed)

If decision is to switch:

```typescript
// packages/e3-cloud-storage/src/s3-dynamo-backend.ts

export class S3DynamoBackend implements StorageBackend {
  constructor(
    private s3: S3Client,
    private dynamo: DynamoDBClient,
    private bucket: string,
    private tablePrefix: string
  ) {}

  get objects(): ObjectStore {
    return new S3ObjectStore(this.s3, this.bucket);
  }

  get refs(): RefStore {
    return new DynamoRefStore(this.dynamo, this.tablePrefix);
  }

  get locks(): LockService {
    return new DynamoLockService(this.dynamo, `${this.tablePrefix}-locks`);
  }

  // ...
}
```

This is where the Phase 1 abstractions pay off - swap backend without changing e3-core.

### Deliverables

- [ ] Performance benchmarks documented
- [ ] Cost analysis completed
- [ ] Decision documented with rationale
- [ ] (If needed) S3/DynamoDB backend implementation
- [ ] (If needed) Migration tooling and process

---

## Phase 6: Custom Apps & White-Labelling

**Goal:** Enable tenants to deploy custom-branded frontend apps.

### 6.1 Custom App Upload

Allow tenants to upload their own Vite app builds via presigned S3 URLs:

```typescript
// POST /repos/{tenant}/api/admin/app-upload
// Returns presigned URLs for uploading app files

export async function handler(event: APIGatewayEvent) {
  const tenant = extractTenant(event.path);
  const { files } = JSON.parse(event.body!);  // ['index.html', 'assets/main.js', ...]

  // Must be tenant admin
  await requireRole(event, tenant, 'admin');

  const uploadUrls: Record<string, string> = {};
  for (const file of files) {
    const key = `tenants/${tenant}/main/${file}`;
    uploadUrls[file] = await getSignedUrl(s3, new PutObjectCommand({
      Bucket: 'e3-frontend-apps',
      Key: key,
    }), { expiresIn: 3600 });
  }

  return { statusCode: 200, body: JSON.stringify({ uploadUrls }) };
}
```

Tenant uploads their custom build:

```bash
# Build custom app
npm run build

# Get upload URLs
URLS=$(curl -X POST https://platform.elaraai.com/repos/acme/api/admin/app-upload \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"files": ["index.html", "assets/main.js", "assets/main.css"]}')

# Upload files
curl -X PUT "$(echo $URLS | jq -r '.uploadUrls["index.html"]')" --upload-file dist/index.html
# ... repeat for each file

# Invalidate cache
curl -X POST https://platform.elaraai.com/repos/acme/api/admin/app-invalidate \
  -H "Authorization: Bearer $TOKEN"
```

### 6.2 Lambda@Edge Tenant Routing

Add Lambda@Edge to serve custom apps when available, falling back to default:

```typescript
// lambda-edge/origin-request.ts

export async function handler(event: CloudFrontRequestEvent) {
  const request = event.Records[0].cf.request;
  const match = request.uri.match(/^\/repos\/([^\/]+)(\/.*)?$/);

  if (!match) return request;  // Not a tenant route

  const tenant = match[1];
  const subPath = match[2] || '/';

  if (subPath.startsWith('/api/')) return request;  // API pass-through

  // Check if tenant has custom app
  const hasCustomApp = await checkCustomApp(tenant);

  // Rewrite origin path
  request.origin!.s3!.path = hasCustomApp
    ? `/tenants/${tenant}/main`
    : `/default/main`;

  // SPA routing: non-file paths → index.html
  if (!subPath.includes('.')) {
    request.uri = '/index.html';
  }

  return request;
}
```

### 6.3 Tenant App Registry

Track custom app deployments in DynamoDB:

```typescript
// tenants table (extended)
{
  PK: "TENANT#acme",
  name: "Acme Corporation",
  customApp: {
    main: {
      version: "2.3.1",
      deployedAt: "2025-01-05T10:30:00Z",
      deployedBy: "alice@acme.com",
      files: ["index.html", "assets/main-abc123.js", "assets/main-abc123.css"]
    }
  },
  // ... other tenant settings
}
```

### 6.4 Custom Domains (Optional)

For enterprise white-labelling with custom domains:

```
https://analytics.acme.com → CNAME to platform.elaraai.com
                           → CloudFront checks Host header
                           → Lambda@Edge maps acme.com → tenant "acme"
```

**Requirements:**
- ACM certificate for custom domain (tenant provides or we provision)
- CloudFront alternate domain name
- DynamoDB mapping: `{ domain: "analytics.acme.com", tenant: "acme" }`
- DNS verification process

### 6.5 Theming SDK

Provide a theming SDK for custom apps:

```typescript
// @elaraai/e3-app-sdk

import { E3Client } from '@elaraai/e3-api-client';
import { EastChakraComponent, UIStoreProvider } from '@elaraai/east-ui-components';
import { ChakraProvider, extendTheme } from '@chakra-ui/react';

// Tenant extracts from URL automatically
export const tenant = location.pathname.match(/^\/repos\/([^\/]+)/)?.[1];
export const client = new E3Client({ baseUrl: `/repos/${tenant}/api` });

// Theme customization
export function E3App({ theme, children }: { theme?: ThemeOverride; children: React.ReactNode }) {
  const chakraTheme = extendTheme(theme || {});
  return (
    <ChakraProvider theme={chakraTheme}>
      <UIStoreProvider>
        {children}
      </UIStoreProvider>
    </ChakraProvider>
  );
}

// Pre-built components
export { WorkspaceList, WorkspaceView, DataflowStatus } from './components';
```

Custom app example:

```typescript
// acme-app/src/App.tsx
import { E3App, WorkspaceView, client } from '@elaraai/e3-app-sdk';

const acmeTheme = {
  colors: {
    brand: { 500: '#E31837' },  // Acme red
  },
  fonts: {
    heading: 'Acme Sans, sans-serif',
  },
};

function App() {
  return (
    <E3App theme={acmeTheme}>
      <AcmeHeader logo="/acme-logo.png" />
      <WorkspaceView workspace="production" path="/dashboard" />
      <AcmeFooter />
    </E3App>
  );
}
```

### Deliverables

- [ ] App upload API endpoint with presigned URLs
- [ ] Cache invalidation API endpoint
- [ ] Lambda@Edge for tenant app routing
- [ ] Tenant app registry in DynamoDB
- [ ] `@elaraai/e3-app-sdk` package with theming support
- [ ] Documentation for custom app development
- [ ] (Optional) Custom domain support with ACM integration

---

## Summary

| Phase | Focus | Key Outcome |
|-------|-------|-------------|
| 1 | e3-core abstractions | Storage + Execution interfaces, LocalBackend, LocalTaskRunner, LocalDataflowExecutor |
| 2 | e3-cloud scaffold | Infrastructure, tenant auth, EFS backend |
| 3 | MVP | Step Functions + Lambda, CloudFront + east-ui frontend |
| 4 | Production runners | Fargate/EKS for heavy compute |
| 5 | Optimization | Performance tuning, potential S3/DynamoDB migration |
| 6 | White-labelling | Custom tenant apps, theming SDK, optional custom domains |

**Execution abstraction architecture:**

```
┌─────────────────────────────────────────────────────────────────────┐
│                         e3-core functions                            │
│  dataflowGetGraph() → dataflowCheckCache() → dataflowExecuteTask()  │
│                                           → dataflowWriteOutput()    │
│                                           → dataflowGetReadyTasks()  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
         ┌─────────────────────┴─────────────────────┐
         │                                           │
┌────────▼────────┐                     ┌────────────▼────────────┐
│ LocalDataflow   │                     │ StepFunctionsDataflow   │
│ Executor        │                     │ Executor                │
│                 │                     │                         │
│ • In-process    │                     │ • Lambda handlers call  │
│ • AsyncMutex    │                     │   e3-core functions     │
│ • Local tests   │                     │ • Scales horizontally   │
└─────────────────┘                     └─────────────────────────┘
```

**Frontend architecture:**

```
┌─────────────────────────────────────────────────────────────────────┐
│  CloudFront (platform.elaraai.com)                                  │
│                                                                      │
│  /repos/{tenant}/        → S3 (default Vite app)                    │
│  /repos/{tenant}/api/*   → API Gateway                              │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│  Default App (Vite + React)                                         │
│                                                                      │
│  • Fetches UIComponentType datasets from API                        │
│  • Renders with EastChakraComponent (east-ui-components)            │
│  • ReactiveComponent "islands" for interactive parts                │
└─────────────────────────────────────────────────────────────────────┘
```

Dependencies:
- Phase 2 depends on Phase 1 (needs storage + execution interfaces)
- Phase 3 depends on Phase 2 (needs infrastructure)
- Phase 4 depends on Phase 3 (extends MVP)
- Phase 5 depends on Phase 4 (evaluates full system)
- Phase 6 depends on Phase 3 (needs frontend infrastructure) - can run in parallel with 4/5
