# e3 Cloud Architecture

Cloud deployment options for e3, enabling clients to execute solutions on sandboxed AWS infrastructure.

## Requirements

### Client Requirements
- **Isolated environments**: Clients (especially in risk-averse industries) require dedicated infrastructure, not shared tenancy
- **AWS sub-accounts**: Acceptable to run in client's own AWS organization or as sub-accounts of ours
- **Cost efficiency**: Minimize idle resource costs
- **Burst capacity**: Support interactive analytics with variable demand

### Technical Challenges
1. **Dataflow orchestration**: Currently persistent, low resource but may exceed Lambda's 15-minute limit
2. **Heavy compute tasks**: Large dependencies (PyTorch, Julia packages), high RAM, long-running, need low latency and scaling

## Architecture Overview

### Storage Abstraction Layer

The core insight: e3-core logic is runtime-agnostic, but currently coupled to filesystem operations. By introducing dependency injection, the same business logic can run against different backends.

```
┌─────────────────────────────────────────────────────────┐
│                    e3-core logic                        │
│   (packages, trees, dataflow, tasks, gc, etc.)          │
└─────────────────────────┬───────────────────────────────┘
                          │ interfaces
          ┌───────────────┼───────────────┐
          │               │               │
  ┌───────▼───────┐ ┌─────▼─────┐ ┌───────▼───────┐
  │ LocalBackend  │ │  Remote   │ │ CloudBackend  │
  │ (filesystem)  │ │  Client   │ │ (S3/DynamoDB) │
  └───────────────┘ └─────┬─────┘ └───────────────┘
                          │
                    ┌─────▼─────┐
                    │   HTTPS   │
                    │    API    │
                    └───────────┘
```

### Storage Interfaces

```typescript
interface ObjectStore {
  write(data: Uint8Array): Promise<string>;        // returns hash
  read(hash: string): Promise<Uint8Array>;
  exists(hash: string): Promise<boolean>;
}

interface RefStore {
  // Package refs
  packageList(): Promise<{ name: string; version: string }[]>;
  packageResolve(name: string, version: string): Promise<string | null>;
  packageWrite(name: string, version: string, hash: string): Promise<void>;
  packageRemove(name: string, version: string): Promise<void>;

  // Workspace state
  workspaceList(): Promise<string[]>;
  workspaceRead(name: string): Promise<WorkspaceState | null>;
  workspaceWrite(name: string, state: WorkspaceState): Promise<void>;
  workspaceRemove(name: string): Promise<void>;

  // Execution cache
  executionGet(taskHash: string, inputsHash: string): Promise<ExecutionStatus | null>;
  executionWrite(taskHash: string, inputsHash: string, status: ExecutionStatus): Promise<void>;
  executionGetOutput(taskHash: string, inputsHash: string): Promise<string | null>;
  executionWriteOutput(taskHash: string, inputsHash: string, outputHash: string): Promise<void>;
  executionList(): Promise<{ taskHash: string; inputsHash: string }[]>;
}

interface LockService {
  acquire(workspace: string, holder: LockHolder): Promise<boolean>;
  release(workspace: string, holder: LockHolder): Promise<void>;
  getHolder(workspace: string): Promise<LockHolder | null>;
}

interface LogStore {
  append(taskHash: string, inputsHash: string, stream: 'stdout' | 'stderr', data: string): Promise<void>;
  read(taskHash: string, inputsHash: string, stream: 'stdout' | 'stderr', offset?: number, limit?: number): Promise<LogChunk>;
}
```

### Backend Implementations

| Interface | LocalBackend | CloudBackend |
|-----------|--------------|--------------|
| ObjectStore | `fs.writeFile` to `.e3/objects/<xx>/<hash>` | S3 `PutObject` to `s3://bucket/objects/<hash>` |
| RefStore | Text/BEAST2 files in `.e3/packages/`, `.e3/workspaces/`, `.e3/executions/` | DynamoDB tables: `packages`, `workspaces`, `executions` |
| LockService | `flock` on `.e3/workspaces/<ws>.lock` | DynamoDB conditional write with TTL |
| LogStore | Append to `.e3/executions/<taskHash>/<inputsHash>/*.txt` | S3 multipart or CloudWatch Logs |

### CLI Routing

The e3 CLI determines backend based on repository URL:

```bash
# Local repository - uses LocalBackend directly
e3 workspace list .
e3 workspace list /path/to/repo

# Remote repository - uses RemoteClient (HTTPS to API)
e3 workspace list https://client-abc.e3.example.com/
e3 workspace list e3://client-abc/production
```

The `RemoteClient` implements the same interfaces but makes HTTPS calls to the API server, which in turn uses `CloudBackend`.

### Authentication & Authorization

Auth is separate from repository data and handled at the API layer, not in e3-core.

**Separation of concerns:**

| Data | Location | Rationale |
|------|----------|-----------|
| Identity (users, credentials) | External (Cognito, IdP, API keys) | Not repository-specific |
| Tenants & permissions | DynamoDB | Orthogonal to repository data |
| Repository data | ObjectStore + RefStore (or EFS) | The actual content |

**Tenant-based authorization model (Options 3 & 4):**

For multi-tenant cloud deployments, authorization is tenant-scoped:

```
┌─────────────────────────────────────────────────────────────┐
│  DynamoDB                                                   │
│                                                             │
│  tenants table:                                             │
│  ┌─────────────┬──────────────────────────────────────────┐ │
│  │ tenant_id   │ name, created_at, efs_path, settings...  │ │
│  ├─────────────┼──────────────────────────────────────────┤ │
│  │ acme-corp   │ "Acme Corporation", /tenants/acme-corp   │ │
│  │ widgets-inc │ "Widgets Inc", /tenants/widgets-inc      │ │
│  └─────────────┴──────────────────────────────────────────┘ │
│                                                             │
│  permissions table:                                         │
│  ┌─────────────────────┬────────────┬───────────┐           │
│  │ user_id             │ tenant_id  │ role      │           │
│  ├─────────────────────┼────────────┼───────────┤           │
│  │ alice@example.com   │ acme-corp  │ admin     │           │
│  │ alice@example.com   │ widgets-inc│ member    │           │
│  │ bob@example.com     │ acme-corp  │ member    │           │
│  └─────────────────────┴────────────┴───────────┘           │
└─────────────────────────────────────────────────────────────┘
```

| Role | Permissions |
|------|-------------|
| `admin` | Full access to tenant, manage members |
| `member` | Read/write all workspaces and packages |

Fine-grained permissions (per-workspace ACLs) deferred to future iteration.

**AuthService interface:**

```typescript
interface AuthService {
  authenticate(token: string): Promise<Identity | null>;
  authorize(identity: Identity, resource: Resource, action: Action): Promise<boolean>;
}

type Resource =
  | { type: 'tenant'; id: string }
  | { type: 'workspace'; tenant: string; name: string }
  | { type: 'package'; tenant: string; name: string };

type Action = 'read' | 'write' | 'admin';
```

**Implementations:**

| Deployment | AuthService | Notes |
|------------|-------------|-------|
| Local dev | `NoAuthService` | Always allows, no tokens needed |
| Option 1 (EC2) | `SimpleAuthService` | API keys in config, single tenant |
| Options 3/4 (Cloud) | `TenantAuthService` | JWT + DynamoDB tenant/permissions |

**Key principle:** e3-core has no auth awareness. Auth checks happen in e3-api-server middleware/routes before calling e3-core functions. This keeps e3-core as a pure library (like libgit2) that trusts its caller.

```typescript
// e3-api-server route handler (cloud, path-based)
app.get('/repos/:repo/workspaces/:ws/get/*', async (c) => {
  const identity = c.get('identity');  // Set by auth middleware
  const repo = c.req.param('repo');
  const ws = c.req.param('ws');

  if (!await auth.authorize(identity, { type: 'repo', id: repo }, 'read')) {
    return error(c, 'permission_denied');
  }

  // Resolve repo to EFS path, then call e3-core
  const repoPath = `/mnt/efs/repos/${repo}/.e3`;
  return success(c, await workspaceGetDataset(repoPath, ws, path));
});
```

**Token-based authentication:**

JWT tokens are used for both local (optional) and cloud deployments.

```
Cloud login flow:
┌──────┐    ┌─────────┐    ┌────────┐    ┌────────────┐
│ CLI  │───►│ Cognito │───►│ Token  │───►│ API Gateway│
│login │    │ (OAuth) │    │ stored │    │ (JWKS)     │
└──────┘    └─────────┘    └────────┘    └────────────┘

Local (optional):
┌───────────┐    ┌────────┐    ┌────────────┐
│ e3-admin  │───►│ Token  │───►│ e3-api-srv │
│ gen-token │    │ (file) │    │ (pub key)  │
└───────────┘    └────────┘    └────────────┘
```

**e3-api-server auth configuration:**

```typescript
interface ServerConfig {
  repoPath: string;
  port?: number;

  // Auth (optional - if omitted, no auth required)
  auth?: {
    jwksUrl?: string;           // Cloud: Cognito JWKS endpoint
    publicKeyPath?: string;     // Local: path to PEM public key
    issuer?: string;            // Expected JWT issuer
    audience?: string;          // Expected JWT audience
  };
}
```

**e3-cli credential storage:**

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

**CLI auth commands:**

```bash
# Cloud login (opens browser → Cognito → callback with token)
e3 login https://example.com/repos/acme

# Local token (if server admin provided one)
e3 login https://localhost:3000 --token <paste-token>

# Status / logout
e3 auth status
e3 logout https://example.com/repos/acme
```

**URL structure (cloud):**

```
https://example.com/repos/{repo-name}/workspaces/...
https://example.com/repos/{repo-name}/packages/...
https://example.com/admin/...  # Platform administration
```

### Execution Abstraction

The dataflow executor (`packages/e3-core/src/dataflow.ts`) is refactored to separate business logic from orchestration. This enables Step Functions to replace the orchestration loop while reusing all e3-core logic.

**Key insight:** Everything in `dataflowExecute()` except the `processQueue()` loop is pure business logic that both local and cloud execution share.

```
┌─────────────────────────────────────────────────────────────────────┐
│  e3-core (shared business logic)                                     │
│                                                                      │
│  dataflowGetGraph()      → DAG with dependencies                     │
│  dataflowCheckCache()    → cached output or null                     │
│  dataflowExecuteTask()   → result + output hash                      │
│  dataflowWriteOutput()   → update workspace tree                     │
│  dataflowGetReadyTasks() → tasks ready to execute                    │
└──────────────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┴───────────────────┐
          │                                       │
┌─────────▼─────────┐               ┌─────────────▼─────────────┐
│ LocalOrchestrator │               │ StepFunctionsOrchestrator │
│ (processQueue     │               │ (ASL state machine)       │
│  loop in memory)  │               │                           │
│                   │               │ Calls e3-core functions   │
│ • AsyncMutex      │               │ via Lambda handlers       │
│ • Concurrency     │               │                           │
└───────────────────┘               └───────────────────────────┘
```

**Interfaces:**

```typescript
interface TaskRunner {
  execute(taskHash: string, inputHashes: string[], options?: ExecuteOptions): Promise<TaskResult>;
}

interface DataflowExecutor {
  start(storage: StorageBackend, ws: string, options?: DataflowOptions): Promise<ExecutionHandle>;
  getStatus(handle: ExecutionHandle): Promise<DataflowStatus>;
  cancel(handle: ExecutionHandle): Promise<void>;
}
```

**Benefits:**
- Zero duplication of business logic between local and cloud
- Consistent results regardless of orchestrator
- Cloud debugging: run locally with same logic
- Testable: mock `TaskRunner` for fast unit tests

See `cloud-devplan.md` Phase 1 for implementation details.

---

## Deployment Options

### Option 1: EC2 Per Client (Persistent)

Dedicated EC2 instance per client/project with existing e3 stack.

```
┌─────────────────────────────────────────────┐
│  Client AWS Sub-Account                     │
│  ┌─────────────────────────────────────┐    │
│  │  EC2 Instance                       │    │
│  │  ├── e3-api-server                  │    │
│  │  ├── east-node, east-py, julia      │    │
│  │  └── EBS: .e3/ repository           │    │
│  └─────────────────────────────────────┘    │
│                    │                        │
│  ┌─────────────────▼─────────────────────┐  │
│  │  ALB + ACM (HTTPS)                    │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

**Pros:**
- Simplest migration - existing code works as-is
- Full runtime flexibility
- Easy debugging (SSH access)

**Cons:**
- Idle costs (even when stopped, EBS costs remain)
- Manual scaling
- Instance management overhead

**Best for:** Early adopters, clients needing maximum isolation, development/staging.

### Option 2: Container-Based (ECS Fargate)

Containerized e3 services with better resource utilization.

```
┌─────────────────────────────────────────────┐
│  Client AWS Sub-Account                     │
│  ┌─────────────────────────────────────┐    │
│  │  ECS Cluster                        │    │
│  │  ├── e3-api-server (Fargate)        │    │
│  │  └── Runner tasks (Fargate Spot)    │    │
│  └─────────────────────────────────────┘    │
│                    │                        │
│  ┌─────────────────▼─────────────────────┐  │
│  │  EFS (shared workspace storage)       │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

**Pros:**
- Scales to zero (Fargate tasks terminate when idle)
- Existing code works with minimal changes
- Spot pricing for cost reduction

**Cons:**
- Cold start latency (~30-60s for container pull)
- EFS costs (~$0.30/GB/month)
- Container orchestration complexity

**Best for:** Clients with moderate usage, batch workloads.

### Option 3: EFS-Backed Serverless

Serverless compute with EFS for repository storage. Reuses existing e3-core filesystem code with minimal changes.

```
┌───────────────────────────────────────────────────────────────────┐
│  Cloud Server (multi-tenant)                                      │
│                                                                   │
│  ┌──────────────┐    ┌──────────────┐    ┌────────────────┐       │
│  │ API Gateway  │───►│   Lambda     │───►│   DynamoDB     │       │
│  │   (HTTPS)    │    │ (e3-core +   │    │ (tenants,      │       │
│  └──────────────┘    │  EFS mount)  │    │  users, authz) │       │
│                      └──────┬───────┘    └────────────────┘       │
│                             │                                     │
│                      ┌──────▼───────┐                             │
│                      │ Step Function│                             │
│                      │ (orchestrate)│                             │
│                      └──────┬───────┘                             │
│                             │                                     │
│              ┌──────────────┼──────────────┐                      │
│              │              │              │                      │
│       ┌──────▼──────┐ ┌─────▼─────┐ ┌──────▼──────┐               │
│       │   Lambda    │ │  Fargate  │ │  Fargate    │               │
│       │ (east-node) │ │ (east-py) │ │  (julia)    │               │
│       │  EFS mount  │ │ EFS mount │ │  EFS mount  │               │
│       └─────────────┘ └───────────┘ └─────────────┘               │
│              │              │              │                      │
│              └──────────────┼──────────────┘                      │
│                             │                                     │
│  ┌──────────────────────────▼──────────────────────────────────┐  │
│  │                         EFS                                 │  │
│  │  /tenants/                                                  │  │
│  │  ├── acme-corp/        # Tenant's e3 repository             │  │
│  │  │   └── .e3/          # Standard local structure           │  │
│  │  ├── widgets-inc/                                           │  │
│  │  │   └── .e3/                                               │  │
│  │  └── ...                                                    │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

**Components:**

| Component | Service | Purpose |
|-----------|---------|---------|
| API | API Gateway + Lambda | Request handling, tenant routing |
| Auth/Tenants | DynamoDB | Tenant registry, user permissions |
| Repository | EFS | Standard `.e3/` directory per tenant |
| Orchestration | Step Functions | Dataflow coordination |
| Light tasks | Lambda + EFS | east-node with EFS mount |
| Heavy tasks | Fargate + EFS | east-py, julia with EFS mount |

**Key difference from Option 4:** Repository storage uses EFS with standard filesystem layout (`.e3/objects/`, `.e3/workspaces/`, etc.) rather than S3/DynamoDB. This means:
- Existing e3-core code works with minimal changes
- No storage abstraction layer required initially
- Simpler migration path from local development

**Multi-tenant model:**

| Entity | Storage | Description |
|--------|---------|-------------|
| Tenant | EFS directory `/tenants/{tenant-id}/.e3/` | Isolated e3 repository |
| User | DynamoDB `users` table | Identity, linked to IdP |
| Permission | DynamoDB `permissions` table | User → Tenant access grants |

**Pros:**
- Existing e3-core code works as-is (POSIX filesystem)
- Simpler than full S3/DynamoDB abstraction
- Multi-tenant on shared infrastructure
- Lambda + Fargate for serverless scaling

**Cons:**
- EFS cost (~$0.30/GB/month) higher than S3
- EFS latency (2-10ms) slower than local disk
- Tenant isolation via directory permissions, not infrastructure

**Best for:** Faster time-to-market, multi-tenant SaaS, when storage abstraction is deferred.

### Option 4: Hybrid Serverless (Full Abstraction)

Serverless control plane with mixed compute backends. Tasks route to Lambda or Fargate based on runner type and requirements.

```
┌───────────────────────────────────────────────────────────────────┐
│  Client AWS Sub-Account                                           │
│                                                                   │
│  ┌──────────────┐    ┌──────────────┐    ┌────────────────┐       │
│  │ API Gateway  │───►│   Lambda     │───►│   DynamoDB     │       │
│  │   (HTTPS)    │    │ (e3-core +   │    │ (refs, state,  │       │
│  └──────────────┘    │ CloudBackend)│    │    locks)      │       │
│                      └──────┬───────┘    └────────────────┘       │
│                             │                                     │
│                      ┌──────▼───────┐    ┌────────────────┐       │
│                      │ Step Function│    │       S3       │       │
│                      │ (orchestrate)│    │   (objects)    │       │
│                      └──────┬───────┘    └────────────────┘       │
│                             │                                     │
│              ┌──────────────┼──────────────┐                      │
│              │              │              │                      │
│       ┌──────▼──────┐ ┌─────▼─────┐ ┌──────▼──────┐               │
│       │   Lambda    │ │  Fargate  │ │  Fargate    │               │
│       │ (east-node) │ │ (east-py) │ │  (julia)    │               │
│       │             │ │  + pool   │ │  + pool     │               │
│       │ • Fast      │ │           │ │             │               │
│       │ • <15 min   │ │ • PyTorch │ │ • Long-run  │               │
│       │ • <10GB RAM │ │ • >15 min │ │ • Heavy     │               │
│       └─────────────┘ └───────────┘ └─────────────┘               │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

**Components:**

| Component | Service | Purpose |
|-----------|---------|---------|
| API | API Gateway + Lambda | Stateless request handling |
| Metadata | DynamoDB | Package refs, workspace state, execution cache, locks |
| Objects | S3 | Content-addressed blob storage |
| Orchestration | Step Functions | Dataflow coordination, task dispatch |
| Light tasks | Lambda | east-node tasks (<15 min, <10GB RAM) |
| Heavy tasks | Fargate pool | east-py, julia (large deps, long-running) |

**Task routing:**

| Runner | Compute | Rationale |
|--------|---------|-----------|
| east-node | Lambda | Small package, fast startup, JS-native |
| east-py | Fargate | PyTorch/ML deps, may exceed Lambda limits |
| julia | Fargate | JIT warmup benefits from persistent process |

Step Functions dispatches to the appropriate compute based on the task's runner type. Lambda tasks invoke directly; Fargate tasks go via SQS to the warm pool.

**Pros:**
- Near-zero idle cost for lightweight tasks (Lambda)
- No constraints for heavy tasks (Fargate)
- Best latency per task type (Lambda: instant, Fargate: warm pool)
- Single architecture handles all workloads

**Cons:**
- More complex dispatch logic
- Two compute models to maintain
- Fargate pool still has some idle cost if kept warm

**Best for:** Production deployments with mixed workloads.

---

## Solving the Core Challenges

### Challenge 1: Dataflow Orchestration (>15 min)

**Problem:** Dataflow management is lightweight but persistent - coordinates task execution, handles failures, updates workspace state. May run longer than Lambda's 15-minute limit.

**Solution: AWS Step Functions**

Step Functions can run for up to 1 year, perfect for orchestration.

```
┌─────────────────────────────────────────────────────────────┐
│  Step Function: DataflowExecution                           │
│                                                             │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────────┐   │
│  │  Acquire │───►│  Get Graph   │───►│  Execute Tasks   │   │
│  │   Lock   │    │  (Lambda)    │    │  (Map state)     │   │
│  └──────────┘    └──────────────┘    └────────┬─────────┘   │
│                                               │             │
│                                      ┌────────▼─────────┐   │
│                                      │  For each task:  │   │
│                                      │  ┌─────────────┐ │   │
│                                      │  │ Check cache │ │   │
│                                      │  └──────┬──────┘ │   │
│                                      │         │        │   │
│                                      │  ┌──────▼──────┐ │   │
│                                      │  │ Dispatch to │ │   │
│                                      │  │ Runner Pool │ │   │
│                                      │  └──────┬──────┘ │   │
│                                      │         │        │   │
│                                      │  ┌──────▼──────┐ │   │
│                                      │  │Wait/Poll for│ │   │
│                                      │  │ completion  │ │   │
│                                      │  └─────────────┘ │   │
│                                      └──────────────────┘   │
│                                               │             │
│                                      ┌────────▼─────────┐   │
│                                      │  Update state,   │   │
│                                      │  release lock    │   │
│                                      └──────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Key aspects:**
- Map state handles parallel task execution with configurable concurrency
- Wait states poll for runner completion (or use callbacks via SQS/EventBridge)
- Error handling with retries and catch blocks
- State persisted automatically by Step Functions
- Express Workflows for sub-second tasks, Standard for long-running

### Challenge 2: Heavy Compute Tasks

**Problem:** Tasks may require:
- Large dependencies (PyTorch ~2GB, Julia packages)
- High RAM (ML training, large datasets)
- Long runtime (>15 min for training jobs)
- Low latency (interactive analytics shouldn't wait for cold starts)
- Scaling (burst of concurrent users)

**Solution: Warm Runner Pool**

Maintain a pool of pre-initialized runners that claim tasks from a queue.

```
┌─────────────────────────────────────────────────────────────┐
│  Runner Pool Architecture                                   │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Auto Scaling Group (per runner type)                 │  │
│  │                                                       │  │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐   │  │
│  │  │ Runner  │  │ Runner  │  │ Runner  │  │ Runner  │   │  │
│  │  │ (warm)  │  │ (warm)  │  │ (busy)  │  │ (busy)  │   │  │
│  │  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘   │  │
│  │       │            │            │            │        │  │
│  │       └────────────┴─────┬──────┴────────────┘        │  │
│  │                          │                            │  │
│  └──────────────────────────┼────────────────────────────┘  │
│                             │                               │
│                    ┌────────▼────────┐                      │
│                    │    SQS Queue    │                      │
│                    │  (task claims)  │                      │
│                    └────────┬────────┘                      │
│                             │                               │
│                    ┌────────▼────────┐                      │
│                    │  Step Function  │                      │
│                    │  (dispatches)   │                      │
│                    └─────────────────┘                      │
└─────────────────────────────────────────────────────────────┘
```

**Runner Lifecycle:**

```
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
│  Init   │────►│  Warm   │────►│  Busy   │────►│  Warm   │
│         │     │ (poll)  │     │ (work)  │     │ (poll)  │
└─────────┘     └────┬────┘     └─────────┘     └────┬────┘
                     │                               │
                     │  (idle timeout)               │
                     ▼                               │
               ┌─────────┐                           │
               │Terminate│◄──────────────────────────┘
               └─────────┘     (scale-in policy)
```

**Implementation:**

1. **Runner Types**: Separate ASG per runtime (east-node, east-py, julia)
2. **Container Images**: Pre-baked with all dependencies (PyTorch, Julia packages)
3. **Claim Protocol**:
   - Runner polls SQS with long-polling
   - Message contains: task hash, input hashes, S3 paths
   - Runner downloads inputs from S3, executes, uploads output
   - Sends completion notification (SQS callback or EventBridge)
4. **Scaling**:
   - Target tracking on queue depth (e.g., 1 runner per 5 messages)
   - Minimum warm capacity for latency SLA
   - Scale-in protection for busy runners
5. **Spot Instances**: Use Spot for cost savings, with on-demand fallback

**Alternative: Fargate Spot**

For simpler management, use Fargate instead of EC2:
- No instance management
- Pay per task (but higher per-hour rate than EC2 Spot)
- 200GB ephemeral storage (plenty for most tasks)
- Up to 16 vCPU, 120GB RAM

Trade-off: Longer cold start (~60s) but zero server management.

---

## Data Model (DynamoDB)

### Tables

**packages**
```
PK: name#version
Attributes: hash, createdAt
```

**workspaces**
```
PK: name
Attributes: state (BEAST2 blob), updatedAt
```

**executions**
```
PK: taskHash#inputsHash
Attributes: status (BEAST2 blob), outputHash, completedAt
GSI: taskHash (for listing executions per task)
```

**locks**
```
PK: workspace
Attributes: holder (pid, acquiredAt, etc.), ttl
Condition: attribute_not_exists(PK) OR ttl < now
```

### S3 Layout

```
s3://client-bucket/
├── objects/
│   └── <sha256-hash>         # Raw BEAST2 blobs
└── logs/
    └── <taskHash>/<inputsHash>/
        ├── stdout.txt
        └── stderr.txt
```

---

## API Changes

The existing e3-api-server endpoints remain unchanged. For cloud deployment:

1. **LocalBackend → CloudBackend**: Swap implementation at server startup
2. **New `/api/tasks/:taskHash/:inputsHash/callback` endpoint**: For runners to report completion
3. **WebSocket endpoint (optional)**: For real-time log streaming

The e3-api-client already works - it just needs the server URL.

---

## Migration Path

### Phase 1: Storage Abstraction
1. Define `ObjectStore`, `RefStore`, `LockService`, `LogStore` interfaces
2. Implement `LocalBackend` wrapping current filesystem code
3. Refactor e3-core to use injected backends
4. Tests pass with LocalBackend

### Phase 2: Cloud Backend
1. Implement `CloudBackend` (S3 + DynamoDB)
2. Deploy Lambda-based API server
3. Validate with integration tests

### Phase 3: Task Execution
1. Implement Step Functions orchestration
2. Build runner container images
3. Deploy runner pool infrastructure
4. End-to-end testing

### Phase 4: Production Hardening
1. Multi-region support
2. Monitoring and alerting
3. Cost optimization (Spot, reserved capacity)
4. Client onboarding automation

---

## Cost Comparison (Estimated)

Scenario: 10 workspaces, 100GB data, 1000 task executions/month, 100 compute-hours

| Component | Option 1 (EC2) | Option 3 (Hybrid) |
|-----------|----------------|-------------------|
| Compute (idle) | ~$50/mo (t3.medium stopped, EBS) | ~$0 |
| Compute (active) | ~$30/mo | ~$40/mo (Fargate Spot) |
| Storage | ~$10/mo (EBS) | ~$3/mo (S3) + ~$5/mo (DynamoDB) |
| API | Included | ~$5/mo (Lambda + API GW) |
| Orchestration | Included | ~$2/mo (Step Functions) |
| **Total** | **~$90/mo** | **~$55/mo** |

The hybrid approach wins on cost, especially for variable/bursty workloads.

---

## Frontend Architecture

End users interact with e3 solutions via web UIs, not the CLI. These UIs render `UIComponentType` datasets from workspaces using the `east-ui` component library.

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  CloudFront Distribution (platform.elaraai.com)                             │
│                                                                              │
│  /repos/{tenant}/           → Main app (S3)                                 │
│  /repos/{tenant}/api/...    → API Gateway (pass-through)                    │
│  /login                     → Global login (pre-tenant selection)           │
└───────────────────────────────────────────────────────────────────────────┘
                │                              │
                ▼                              ▼
┌───────────────────────────────┐  ┌────────────────────────────────────────┐
│  S3: e3-frontend-apps         │  │  API Gateway → Lambda                   │
│                               │  │                                        │
│  /default/                    │  │  Tenant extracted from path,           │
│  └── main/   ← Vite app       │  │  validates JWT, calls e3-core          │
│      └── assets/              │  └────────────────────────────────────────┘
│                               │
│  /tenants/                    │
│  └── acme/   ← Custom app     │
│      └── main/ (optional)     │
└───────────────────────────────┘
```

### How It Works

1. **Default app** - A generic "e3 viewer" Vite app that:
   - Authenticates via Cognito (JWT stored in localStorage)
   - Lists workspaces for the tenant
   - Fetches `UIComponentType` datasets from the API
   - Renders them using `EastChakraComponent` from `east-ui-components`

2. **UIComponentType rendering** - Any workspace dataset with type `UIComponentType` can be rendered:
   ```typescript
   // Fetch UI dataset from API
   const ui = await e3.workspaces.get('production', '/dashboard');

   // Render with east-ui-components
   <UIStoreProvider>
     <EastChakraComponent value={ui} />
   </UIStoreProvider>
   ```

3. **ReactiveComponent "islands"** - Parts of the UI wrapped in `ReactiveComponent` update independently based on state changes, without re-rendering the entire page

4. **Custom tenant apps** (optional) - For white-labeling:
   - Custom Chakra UI themes (colors, fonts, logos)
   - Custom login UI (SSO integrations)
   - Same `east-ui-components` and `e3-api-client` underneath

### URL Structure

```
https://platform.elaraai.com/
├── login                           → Global login (select tenant)
└── repos/
    └── {tenant}/                   → Tenant's main app
        ├── api/workspaces/...      → API (proxied to API Gateway)
        └── **                      → SPA routes (workspaces, dashboards, etc.)
```

No custom domains (e.g., `analytics.acme.com`) initially - path-based routing is simpler and sufficient. See `cloud-devplan.md` Phase 6 for custom apps, theming SDK, and optional custom domain support.

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Single domain | `platform.elaraai.com` | Simpler SSL, no per-tenant DNS |
| Path-based tenants | `/repos/{tenant}/` | Mirrors API structure |
| Default app | Generic e3 viewer | Most tenants don't need custom apps |
| Custom apps | Optional, branding only | Upload to S3, same core libraries |
| SSR | Not required initially | UIComponentType is JSON; client renders |

---

## Open Questions

1. **Log streaming**: CloudWatch Logs vs S3 multipart vs WebSocket relay?
2. **Runner image updates**: How to roll out new dependencies without downtime?
3. **Cross-region**: Support for data residency requirements?
4. **Secrets management**: How do runners access client credentials for integrations?
5. **Quotas**: Per-client limits on storage, compute, concurrent tasks?
