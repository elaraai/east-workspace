# e3 Cloud Development Plan

Development roadmap for cloud deployment of e3, using S3 + DynamoDB storage (see `cloud-options.md` for architecture).

**Technology choices:**
- Infrastructure: AWS CDK (TypeScript)
- API: Lambda + API Gateway (HTTP API)
- Storage: S3 (objects), DynamoDB (refs, metadata, auth)
- Orchestration: Step Functions
- Compute: Lambda (east-node), Fargate (east-py, julia)
- Frontend: CloudFront + S3 (Vite/React)
- Auth: Cognito with optional OIDC federation

## Overview

```
Phase 1              Phase 2              Phase 3              Phase 4              Phase 5
─────────────────────────────────────────────────────────────────────────────────────────────
e3-core              e3-api-server        e3-aws               MVP                  Production
abstractions         refactoring          S3DynamoBackend      (frontend +          (runners)
(foundational)                                                 Step Functions)
─────────────────────────────────────────────────────────────────────────────────────────────
     │                    │                    │                    │                    │
     ▼                    ▼                    ▼                    ▼                    ▼
  Storage DI          Handler extract      S3ObjectStore        CloudFront/S3        Fargate pools
  Execution DI        Multi-repo mode      DynamoRefStore       east-ui render       Heavy compute
  LocalBackend        JWT auth             Single table         Step Functions       EKS option
                      CLI login            Integration          Task execution

     │                    │                    │
     └────────────────────┼────────────────────┘
                          │
                   Phase 1 required
```

**Key design decisions:**
- S3 + DynamoDB from the start (not EFS) - 10x cheaper storage, no VPC needed, instant repo creation
- Single DynamoDB table with composite keys - simpler operations
- Repository data prefixed by repo ID - multi-repo without separate resources
- e3-api-server handlers extracted for Lambda reuse

---

## Progress Summary

### Completed

**e3-aws repository:**
- [x] Repository structure (`cdk/platform/`, `packages/`, `web/`)
- [x] CDK stack consolidated into single `E3PlatformStack`
- [x] Cognito User Pool with hosted UI
- [x] Optional OIDC provider via SSM parameters
- [x] API Gateway HTTP API with JWT authorizer
- [x] Basic Lambda handler scaffolding (`packages/api/`)
- [x] Runner handler stubs (`packages/runner/`)
- [x] Frontend app scaffolding (`web/`)

**e3 repository:**
- [x] e3-api-server with all endpoints implemented
- [x] e3-api-client with full HTTP client library
- [x] Storage interfaces defined in design docs

### Remaining

- [ ] e3-core storage abstraction implementation
- [ ] e3-api-server handler extraction and multi-repo mode
- [ ] e3-cli remote URL support and auth
- [ ] S3DynamoBackend implementation
- [ ] Step Functions orchestration
- [ ] Frontend integration
- [ ] Fargate runners for heavy compute

---

## Phase 1: e3-core Abstractions

**Goal:** Implement storage and execution interfaces in e3-core to enable pluggable backends.

**Location:** `../e3/packages/e3-core/`

### 1.1 Storage Interfaces

The interfaces are already designed (see `cloud-options.md`). Implementation needed:

```
packages/e3-core/src/storage/
├── interfaces.ts       # ObjectStore, RefStore, LockService, LogStore, StorageBackend
├── local/
│   ├── index.ts        # LocalBackend factory
│   ├── objects.ts      # LocalObjectStore (wraps existing objects.ts)
│   ├── refs.ts         # LocalRefStore (wraps packages.ts, workspaces.ts, executions.ts)
│   ├── locks.ts        # LocalLockService (wraps workspaceLock.ts)
│   └── logs.ts         # LocalLogStore (wraps execution log handling)
└── index.ts            # Re-exports
```

### 1.2 Refactor e3-core Functions

Update functions to accept `StorageBackend` instead of `repoPath`:

```typescript
// Before
export async function workspaceGetDataset(repoPath: string, ws: string, path: TreePath): Promise<unknown>

// After
export async function workspaceGetDataset(storage: StorageBackend, ws: string, path: TreePath): Promise<unknown>
```

### 1.3 Execution Abstraction

Extract dataflow functions for orchestrator-agnostic execution:

```typescript
// Pure business logic functions (called by both local and Step Functions)
export async function dataflowGetGraph(storage: StorageBackend, ws: string): Promise<TaskGraph>
export async function dataflowCheckCache(storage: StorageBackend, taskHash: string, inputHashes: string[]): Promise<string | null>
export async function dataflowExecuteTask(storage: StorageBackend, taskHash: string, inputHashes: string[], options?: ExecuteOptions): Promise<TaskResult>
export async function dataflowWriteOutput(storage: StorageBackend, ws: string, taskHash: string, outputHash: string): Promise<void>
export async function dataflowGetReadyTasks(storage: StorageBackend, ws: string, graph: TaskGraph, completed: Set<string>): Promise<string[]>
```

### Deliverables

- [ ] `StorageBackend` interface and `LocalBackend` implementation
- [ ] e3-core functions refactored to use `StorageBackend`
- [ ] Dataflow functions extracted as public APIs
- [ ] Existing `dataflowExecute()` refactored to use new APIs (backward compatible)
- [ ] All tests passing

---

## Phase 2: e3-api-server Refactoring

**Goal:** Extract reusable handlers, add multi-repo mode, add JWT authentication.

**Location:** `../e3/packages/e3-api-server/`

### 2.1 Extract Route Handlers

Create pure handler functions that can be imported by both e3-api-server and e3-aws Lambda:

```
packages/e3-api-server/src/
├── handlers/                 # NEW: Pure functions, no Hono dependency
│   ├── workspaces.ts         # listWorkspaces(), getWorkspace(), createWorkspace(), etc.
│   ├── packages.ts           # listPackages(), importPackage(), etc.
│   ├── datasets.ts           # getDataset(), setDataset(), listTree(), etc.
│   ├── tasks.ts              # listTasks(), getTask()
│   ├── executions.ts         # startDataflow(), getGraph(), getLogs()
│   └── index.ts              # Re-export all handlers
├── routes/                   # Hono route definitions (thin wrappers around handlers)
│   └── ...
└── server.ts
```

**Handler pattern:**

Handlers are thin wrappers around e3-core functions:

```typescript
// handlers/workspaces.ts
import { workspaceList, workspaceGetState } from '@elaraai/e3-core';

export async function listWorkspaces(storage: StorageBackend): Promise<string[]> {
  return workspaceList(storage);  // e3-core function (after Phase 1 refactoring)
}

export async function getWorkspace(storage: StorageBackend, name: string): Promise<WorkspaceState | null> {
  return workspaceGetState(storage, name);
}

// routes/workspaces.ts (thin wrapper)
export function workspaceRoutes(getStorage: (repoId: string) => StorageBackend) {
  return new Hono()
    .get('/repos/:repo/api/workspaces', async (c) => {
      const storage = getStorage(c.req.param('repo'));
      return success(c, await listWorkspaces(storage));
    });
}
```

### 2.2 Multi-Repo Server Mode

Update server configuration to support a directory of repositories:

```typescript
interface ServerConfig {
  // Option A: Single repo (current, local dev)
  repo?: string;

  // Option B: Multi-repo directory (mirrors cloud behavior)
  reposDir?: string;

  // Auth (optional)
  auth?: {
    publicKeyPath?: string;  // Path to PEM public key for JWT validation
    issuer?: string;
    audience?: string;
  };

  port?: number;
  host?: string;
  cors?: boolean;
}
```

**CLI usage:**

```bash
# Single repo (current behavior, local dev)
e3-api-server .

# Multi-repo directory mode (mirrors cloud)
e3-api-server --repos /path/to/repos/
# Serves /repos/alpha/api/..., /repos/beta/api/...
# where alpha/ and beta/ are subdirectories with .e3/
```

### 2.3 JWT Authentication Middleware

```typescript
// auth.ts
export function createJwtMiddleware(config: AuthConfig): MiddlewareHandler {
  const publicKey = fs.readFileSync(config.publicKeyPath);

  return async (c, next) => {
    const header = c.req.header('Authorization');
    if (!header?.startsWith('Bearer ')) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    const token = header.slice(7);
    const payload = jwt.verify(token, publicKey, {
      issuer: config.issuer,
      audience: config.audience,
    });

    c.set('identity', payload);
    await next();
  };
}
```

### 2.4 CLI Auth Support

**Location:** `../e3/packages/e3-cli/`

**Credential storage:**

```
~/.e3/
└── credentials.json
    {
      "https://platform.example.com": {
        "token": "eyJ...",
        "expiresAt": "2025-01-10T..."
      }
    }
```

**New commands:**

```bash
# Store token manually (for local servers with auth)
e3 login https://localhost:3000 --token <paste-token>

# OAuth browser flow (for cloud with Cognito)
e3 login https://platform.example.com

# Check stored credentials
e3 auth status

# Remove stored credentials
e3 logout https://platform.example.com
```

**URL detection in CLI:**

```typescript
// utils.ts
type RepoLocation =
  | { type: 'local'; path: string }
  | { type: 'remote'; baseUrl: string; repoId: string };

function parseRepoLocation(arg: string): RepoLocation {
  if (arg.startsWith('https://') || arg.startsWith('http://')) {
    const url = new URL(arg);
    const match = url.pathname.match(/^\/repos\/([^\/]+)/);
    return { type: 'remote', baseUrl: url.origin, repoId: match[1] };
  }
  return { type: 'local', path: resolveRepo(arg) };
}
```

**Update all CLI commands** to support remote:

```typescript
// Pattern for each command
const location = parseRepoLocation(repoArg);
if (location.type === 'local') {
  const storage = new LocalBackend(location.path);
  // use storage directly
} else {
  const client = await createAuthenticatedClient(location);
  // use e3-api-client
}
```

### 2.5 e3-api-client Auth Headers

```typescript
// http.ts
interface ClientOptions {
  baseUrl: string;
  token?: string;
  getToken?: () => Promise<string | null>;
}

export function createClient(options: ClientOptions) {
  async function getHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = { 'Accept': 'application/beast2' };
    const token = options.token ?? (await options.getToken?.());
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }
  // ...
}
```

### Deliverables

- [ ] Handlers extracted to `handlers/` directory
- [ ] Routes refactored to use handlers
- [ ] Multi-repo directory mode (`--repos` option)
- [ ] JWT authentication middleware
- [ ] e3-cli credential storage (`~/.e3/credentials.json`)
- [ ] e3-cli `login`, `logout`, `auth status` commands
- [ ] e3-api-client updated with auth header support
- [ ] All CLI commands updated for remote URL support
- [ ] Tests passing (local and remote modes)

---

## Phase 3: S3DynamoBackend Implementation

**Goal:** Implement `StorageBackend` using S3 for objects, single DynamoDB table for refs.

**Location:** `packages/storage/` (this repository)

### 3.1 Single-Table DynamoDB Design

One table with composite keys, prefixed by repository ID:

```
Table: e3-{deploymentId}-data

Primary Key: PK (String), SK (String)

┌─────────────────────────────────────────────────────────────────────┐
│ REPOSITORY METADATA                                                  │
│ PK: REPO#{repoId}           SK: #META                               │
│ Attributes: name, createdAt, settings                               │
├─────────────────────────────────────────────────────────────────────┤
│ PACKAGES                                                             │
│ PK: REPO#{repoId}           SK: PKG#{name}#{version}                │
│ Attributes: hash, createdAt                                         │
├─────────────────────────────────────────────────────────────────────┤
│ WORKSPACES                                                           │
│ PK: REPO#{repoId}           SK: WS#{name}                           │
│ Attributes: state (Binary/BEAST2), updatedAt                        │
├─────────────────────────────────────────────────────────────────────┤
│ EXECUTIONS                                                           │
│ PK: REPO#{repoId}           SK: EXEC#{taskHash}#{inputsHash}        │
│ Attributes: status (Binary), outputHash, completedAt                │
├─────────────────────────────────────────────────────────────────────┤
│ LOCKS                                                                │
│ PK: REPO#{repoId}           SK: LOCK#{resource}                     │
│ Attributes: holder, acquiredAt, ttl (DynamoDB TTL for auto-delete)  │
├─────────────────────────────────────────────────────────────────────┤
│ PERMISSIONS (e3-aws authz only)                                      │
│ PK: USER#{userId}           SK: REPO#{repoId}                       │
│ Attributes: role (admin|member), grantedAt, grantedBy               │
│ GSI1: PK=REPO#{repoId} SK=USER#{userId} (query users per repo)      │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 S3 Layout

```
s3://{bucket}/
  {repoId}/objects/{hash}                              # Content-addressed blobs
  {repoId}/logs/{taskHash}/{inputsHash}/stdout.txt     # Execution logs
  {repoId}/logs/{taskHash}/{inputsHash}/stderr.txt
```

### 3.3 Implementation

```
packages/storage/src/
├── s3-dynamo-backend.ts      # S3DynamoBackend class
├── s3-object-store.ts        # S3-backed ObjectStore
├── dynamo-ref-store.ts       # DynamoDB-backed RefStore
├── dynamo-lock-service.ts    # DynamoDB-backed LockService (with TTL)
├── s3-log-store.ts           # S3-backed LogStore
└── index.ts                  # Exports
```

**S3DynamoBackend:**

```typescript
export class S3DynamoBackend implements StorageBackend {
  constructor(
    private s3: S3Client,
    private dynamo: DynamoDBClient,
    private bucket: string,
    private tableName: string,
    private repoId: string
  ) {}

  get objects(): ObjectStore {
    return new S3ObjectStore(this.s3, this.bucket, this.repoId);
  }

  get refs(): RefStore {
    return new DynamoRefStore(this.dynamo, this.tableName, this.repoId);
  }

  get locks(): LockService {
    return new DynamoLockService(this.dynamo, this.tableName, this.repoId);
  }

  get logs(): LogStore {
    return new S3LogStore(this.s3, this.bucket, this.repoId);
  }
}
```

### 3.4 CDK Stack Updates

**Update `cdk/platform/lib/e3-platform-stack.ts`:**

- Remove: EFS filesystem, access points, VPC NAT gateway (not needed without EFS)
- Add: S3 bucket for objects and logs
- Change: Single DynamoDB table (`e3-{deploymentId}-data`) instead of separate tables
- Update: Lambda environment variables, IAM permissions

### 3.5 Lambda Integration

**Update `packages/api/src/index.ts`:**

```typescript
import { S3DynamoBackend } from '@elaraai/e3-storage';
import { listWorkspaces, getWorkspace, ... } from '@elaraai/e3-api-server/handlers';

const s3 = new S3Client({});
const dynamo = new DynamoDBClient({});

function getStorage(repoId: string): StorageBackend {
  return new S3DynamoBackend(
    s3, dynamo,
    process.env.BUCKET_NAME!,
    process.env.TABLE_NAME!,
    repoId
  );
}

app.get('/repos/:repo/api/workspaces', async (c) => {
  const storage = getStorage(c.req.param('repo'));
  return c.json(await listWorkspaces(storage));
});
```

### Deliverables

- [ ] S3ObjectStore implementation
- [ ] DynamoRefStore implementation
- [ ] DynamoLockService implementation (with TTL)
- [ ] S3LogStore implementation
- [ ] S3DynamoBackend class
- [ ] CDK stack updated (S3 bucket, single DynamoDB table)
- [ ] Lambda handlers using S3DynamoBackend
- [ ] Integration tests

---

## Phase 4: MVP (Frontend + Step Functions)

**Goal:** Complete working system with frontend, Step Functions orchestration, and east-node execution.

### 4.1 Step Functions Orchestration

Step Functions manages the dataflow DAG execution, calling e3-core functions via Lambda:

```
┌─────────────────────────────────────────────────────────────────┐
│  Dataflow State Machine                                         │
│                                                                 │
│  ┌─────────────┐                                                │
│  │ AcquireLock │                                                │
│  └──────┬──────┘                                                │
│         │                                                       │
│  ┌──────▼──────┐                                                │
│  │  GetGraph   │ (Lambda: dataflowGetGraph)                     │
│  └──────┬──────┘                                                │
│         │                                                       │
│  ┌──────▼──────┐                                                │
│  │ ExecuteDAG  │ (Map state with dependency ordering)           │
│  │             │                                                │
│  │  Per task:  │                                                │
│  │  ┌─────────────────────────────────────────────────────┐     │
│  │  │ CheckCache → (hit) → Skip                           │     │
│  │  │     ↓ (miss)                                        │     │
│  │  │ RunTask → WriteResult                               │     │
│  │  └─────────────────────────────────────────────────────┘     │
│  └──────┬──────┘                                                │
│         │                                                       │
│  ┌──────▼──────┐                                                │
│  │ ReleaseLock │                                                │
│  └─────────────┘                                                │
└─────────────────────────────────────────────────────────────────┘
```

**Lambda handlers** (in `packages/runner/`):

| Handler | e3-core Function |
|---------|------------------|
| `get-graph.ts` | `dataflowGetGraph()` |
| `check-cache.ts` | `dataflowCheckCache()` |
| `run-task.ts` | `dataflowExecuteTask()` |
| `write-result.ts` | `dataflowWriteOutput()` |

### 4.2 Frontend

**CloudFront + S3 architecture:**

```
CloudFront (platform.elaraai.com)
    │
    ├── /repos/{repo}/           → S3 (Vite app, SPA routing)
    ├── /repos/{repo}/api/*      → API Gateway (pass-through)
    └── /login                   → S3 (global login page)
```

**Default app features (`web/`):**

- Cognito authentication (JWT in localStorage)
- Repository selection
- Workspace list and navigation
- `UIComponentType` rendering via `east-ui-components`

### 4.3 API Endpoints

```
GET  /repos                                    # List repositories (user has access to)
POST /repos                                    # Create repository (admin)
GET  /repos/{repo}/api/workspaces              # List workspaces
POST /repos/{repo}/api/workspaces              # Create workspace
GET  /repos/{repo}/api/workspaces/{ws}         # Get workspace state
POST /repos/{repo}/api/workspaces/{ws}/start   # Start dataflow execution
GET  /repos/{repo}/api/workspaces/{ws}/status  # Get execution status
GET  /repos/{repo}/api/workspaces/{ws}/graph   # Get task dependency graph
GET  /repos/{repo}/api/workspaces/{ws}/get/*   # Get dataset value
PUT  /repos/{repo}/api/workspaces/{ws}/set/*   # Set dataset value
...
```

### Deliverables

- [ ] Step Functions state machine (CDK)
- [ ] Lambda handlers for dataflow execution
- [ ] CloudFront distribution with S3 + API Gateway routing
- [ ] Frontend app with Cognito login
- [ ] Workspace list and UI rendering
- [ ] End-to-end test (create repo → deploy package → execute → view UI)

---

## Phase 5: Production Runners (Fargate)

**Goal:** Add support for heavy compute tasks (east-py, julia) on Fargate.

### 5.1 Task Routing

Step Functions routes to Lambda or Fargate based on runner type:

```typescript
// In Step Functions ASL
{
  "RunTask": {
    "Type": "Choice",
    "Choices": [
      {
        "Variable": "$.task.runner",
        "StringEquals": "east-node",
        "Next": "RunLambda"
      }
    ],
    "Default": "RunFargate"
  }
}
```

### 5.2 Fargate Configuration

- ECS Cluster (Fargate)
- Task definitions for east-py, julia runners
- Container images with dependencies pre-installed
- S3 access for reading inputs, writing outputs

### 5.3 Warm Pool (Optional)

For lower latency:

- SQS queue for task dispatch
- Long-running Fargate tasks that poll for work
- Auto-scaling based on queue depth

### Deliverables

- [ ] Fargate task definitions and container images
- [ ] Step Functions updated with runner routing
- [ ] S3 integration for task I/O
- [ ] (Optional) Warm pool with SQS
- [ ] Performance testing with heavy workloads

---

## Phase 6: White-Labelling (Future)

**Goal:** Enable custom-branded frontend apps per repository.

### Features

- Custom app upload via presigned S3 URLs
- Lambda@Edge for app routing (custom app vs default)
- Custom domains with ACM certificates
- Theming SDK for consistent branding

### Deliverables

- [ ] App upload API endpoint
- [ ] Lambda@Edge routing
- [ ] `@elaraai/e3-app-sdk` package
- [ ] Custom domain support
- [ ] Documentation

---

## Summary

| Phase | Focus | Key Outcome |
|-------|-------|-------------|
| 1 | e3-core abstractions | StorageBackend interface, LocalBackend implementation |
| 2 | e3-api-server refactoring | Reusable handlers, multi-repo mode, JWT auth, CLI remote |
| 3 | S3DynamoBackend | Cloud storage implementation, CDK updates |
| 4 | MVP | Frontend, Step Functions, end-to-end flow |
| 5 | Production runners | Fargate for heavy compute |
| 6 | White-labelling | Custom apps, theming |

**Architecture:**

```
┌─────────────────────────────────────────────────────────────────────┐
│                         e3-core handlers                             │
│  listWorkspaces() → getWorkspace() → getDataset() → startDataflow() │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
         ┌─────────────────────┴─────────────────────┐
         │                                           │
┌────────▼────────┐                     ┌────────────▼────────────┐
│ e3-api-server   │                     │ e3-aws Lambda           │
│                 │                     │                         │
│ • LocalBackend  │                     │ • S3DynamoBackend       │
│ • Multi-repo    │                     │ • Step Functions        │
│ • JWT auth      │                     │ • Cognito               │
└─────────────────┘                     └─────────────────────────┘
```

**Dependencies:**
- Phase 1 must complete first (e3-core storage abstraction is foundational)
- Phase 2 depends on Phase 1 (handlers call e3-core functions that use StorageBackend)
- Phase 2 JWT auth and CLI login can start early (no storage dependency)
- Phase 3 depends on Phase 1 (implements StorageBackend interface)
- Phase 4 depends on Phase 2 + 3
- Phase 5 depends on Phase 4
- Phase 6 depends on Phase 4

**Note:** `cloud-options.md` should also be updated to reflect the S3/DynamoDB architecture (currently still references EFS).
