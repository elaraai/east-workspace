# e3 Cloud Development Plan

Development roadmap for cloud deployment of e3, using S3 + DynamoDB storage (see `cloud-options.md` for architecture).

**Technology choices:**
- Infrastructure: AWS CDK (TypeScript)
- API: Lambda + API Gateway (HTTP API)
- Storage: S3 (objects), DynamoDB (refs, metadata, auth, execution state)
- Orchestration: Step Functions
- Compute: Lambda with container image (default), Fargate ECS fallback for long tasks
- Base Image: `ghcr.io/elaraai/e3` from east-plugin (includes Node.js 22 + Python 3.11 + east-py + e3)
- Frontend: CloudFront + S3 (Vite/React)
- Auth: Cognito with optional OIDC federation

**MVP simplification:** Lambda-based east-py execution using `ghcr.io/elaraai/e3` base image. ECS Fargate available as fallback for tasks >15min or >10GB memory.

## Overview

```
Phase 1              Phase 2              Phase 3              Phase 4              Phase 5
─────────────────────────────────────────────────────────────────────────────────────────────
e3-core              e3-api-server        e3-aws               MVP                  Production
abstractions         refactoring          S3DynamoStorage      (frontend +          (runners)
(foundational)                                                 Step Functions)
─────────────────────────────────────────────────────────────────────────────────────────────
     │                    │                    │                    │                    │
     ▼                    ▼                    ▼                    ▼                    ▼
  Storage DI          Handler extract      S3ObjectStore        CloudFront/S3        Fargate pools
  Execution DI        Multi-repo mode      DynamoRefStore       east-ui render       Heavy compute
  LocalStorage        JWT auth             Single table         Step Functions       EKS option
  repo param        CLI login            Integration          Task execution

     │                    │                    │
     └────────────────────┼────────────────────┘
                          │
                   Phase 1 required
```

**Key design decisions:**
- S3 + DynamoDB from the start (not EFS) - 10x cheaper storage, no VPC needed, instant repo creation
- Single DynamoDB table with composite keys - simpler operations
- Repository data prefixed by repo ID - multi-repo without separate resources
- **repo as parameter** - storage backends initialized once, repo passed to all operations
- e3-api-server handlers extracted for Lambda reuse, shared with e3-aws Lambda

---

## Progress Summary

### Completed

**e3-aws repository:**
- [x] Repository structure (`cdk/platform/`, `packages/`, `web/`)
- [x] CDK stack consolidated into single `E3PlatformStack`
- [x] Cognito User Pool with hosted UI
- [x] Optional OIDC provider via SSM parameters
- [x] API Gateway HTTP API with JWT authorizer
- [x] Lambda API handlers (`packages/api/`)
- [x] S3DynamoStorage implementation (`packages/storage/`)
- [x] Device flow proxy (Cognito doesn't support native device flow)
- [x] Repo management endpoints (list, create, delete, status)
- [x] Repo lifecycle state machines (delete-repo, GC) with Step Functions
- [x] GC API endpoints (`POST /api/repos/{repo}/gc`, `GET /api/repos/{repo}/gc/{id}`)
- [x] Integration tests with node:test (`test/integration/`)
- [x] Frontend app scaffolding (`web/`)

**e3 repository:**
- [x] e3-api-server with all endpoints implemented
- [x] e3-api-client with full HTTP client library
- [x] Storage interfaces implemented (PR #30)
- [x] Storage interfaces updated to repo-as-parameter pattern (LocalStorage)
- [x] e3-api-server multi-repo mode with `--repos` option
- [x] e3-api-server repo create/remove endpoints (`PUT/DELETE /api/repos/:repo`)
- [x] e3-api-client `repoCreate`, `repoRemove`, `repoStatus`, `repoGc` functions
- [x] e3-cli `repo` command group (`create`, `remove`, `status`, `gc`)
- [x] e3-cli remote URL support for repo commands (unified URL format)
- [x] e3-cli auth (`login`, `logout`, `auth status`, `whoami`)
- [x] e3-api-server OIDC provider (discovery, device flow, token endpoint)
- [x] e3-api-server JWT authentication middleware

### Remaining

- [ ] Step Functions dataflow state machine
- [ ] Lambda handlers for dataflow execution (`packages/runner/`)
- [ ] ECS Service warm pool for Fargate runners
- [ ] Frontend integration (east-ui rendering)
- [ ] e3-api-tests consumption in integration tests

---

## Phase 1: e3-core Abstractions

**Goal:** Implement storage and execution interfaces in e3-core to enable pluggable backends.

**Location:** `../e3/packages/e3-core/`

### 1.1 Storage Interfaces

Storage interfaces take `repo` as a parameter, allowing backends to be initialized once and reused across requests:

```typescript
// interfaces.ts

interface ObjectStore {
  write(repo: string, data: Uint8Array): Promise<string>;
  read(repo: string, hash: string): Promise<Uint8Array>;
  exists(repo: string, hash: string): Promise<boolean>;
  list(repo: string): Promise<string[]>;
}

interface RefStore {
  packageList(repo: string): Promise<{ name: string; version: string }[]>;
  packageResolve(repo: string, name: string, version: string): Promise<string | null>;
  packageWrite(repo: string, name: string, version: string, hash: string): Promise<void>;
  workspaceList(repo: string): Promise<string[]>;
  workspaceRead(repo: string, name: string): Promise<Uint8Array | null>;
  workspaceWrite(repo: string, name: string, state: Uint8Array): Promise<void>;
  // ... etc
}

interface LockService {
  acquire(repo: string, resource: string, operation: LockOperation): Promise<LockHandle | null>;
  getState(repo: string, resource: string): Promise<LockState | null>;
}

interface LogStore {
  append(repo: string, taskHash: string, inputsHash: string, stream: 'stdout' | 'stderr', data: string): Promise<void>;
  read(repo: string, taskHash: string, inputsHash: string, stream: 'stdout' | 'stderr'): Promise<LogChunk>;
}

interface StorageBackend {
  readonly objects: ObjectStore;
  readonly refs: RefStore;
  readonly locks: LockService;
  readonly logs: LogStore;
}
```

**Implementations:**

```
packages/e3-core/src/storage/
├── interfaces.ts       # ObjectStore, RefStore, LockService, LogStore, StorageBackend
├── local/
│   ├── index.ts        # LocalStorage class
│   ├── objects.ts      # LocalObjectStore (repo = path to .e3 dir)
│   ├── refs.ts         # LocalRefStore
│   ├── locks.ts        # LocalLockService
│   └── logs.ts         # LocalLogStore
└── index.ts            # Re-exports
```

**Local implementation:** `repo` is the path to the `.e3` directory:

```typescript
class LocalObjectStore implements ObjectStore {
  async write(repo: string, data: Uint8Array): Promise<string> {
    const objectsDir = path.join(repo, 'objects');
    // ...
  }
}

// No config needed - repo IS the path
const storage = new LocalStorage();
await storage.objects.write('/path/to/repo/.e3', data);
```

### 1.2 Refactor e3-core Functions

Update functions to accept `StorageBackend` and `repo`:

```typescript
// Before
export async function workspaceList(repoPath: string): Promise<string[]>

// After
export async function workspaceList(storage: StorageBackend, repo: string): Promise<string[]> {
  return storage.refs.workspaceList(repo);
}
```

This pattern enables:
- **CLI**: `repo` from command args (e.g., `.` → resolved path)
- **Server**: `repo` from URL params (e.g., `/repos/:repo`)
- **Shared code**: Same storage instance, different repo per request

### 1.3 Execution Abstraction

Extract dataflow functions for orchestrator-agnostic execution:

```typescript
// Pure business logic functions (called by both local and Step Functions)
export async function dataflowGetGraph(storage: StorageBackend, repo: string, ws: string): Promise<TaskGraph>
export async function dataflowCheckCache(storage: StorageBackend, repo: string, taskHash: string, inputHashes: string[]): Promise<string | null>
export async function dataflowExecuteTask(storage: StorageBackend, repo: string, taskHash: string, inputHashes: string[], options?: ExecuteOptions): Promise<TaskResult>
export async function dataflowWriteOutput(storage: StorageBackend, repo: string, ws: string, taskHash: string, outputHash: string): Promise<void>
export async function dataflowGetReadyTasks(storage: StorageBackend, repo: string, ws: string, graph: TaskGraph, completed: Set<string>): Promise<string[]>
```

### Deliverables

- [ ] `StorageBackend` interface with `repo` parameter on all methods
- [ ] `LocalStorage` implementation (repo = path)
- [ ] e3-core functions refactored to use `(storage, repo, ...)`
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

Handlers are thin wrappers around e3-core functions, taking `storage` and `repo`, and returning a standard web `Response`:

```typescript
// handlers/workspaces.ts
import { some, none } from '@elaraai/east';
import { workspaceList, workspaceGetState } from '@elaraai/e3-core';
import { sendSuccess, sendError } from '../beast2.js';

export async function listWorkspaces(storage: StorageBackend, repo: string): Promise<string[]> {
  try {
    const workspaces = await workspaceList(storage, repoPath);
    const result = await Promise.all(
      workspaces.map(async (name) => {
        const state = await workspaceGetState(storage, repoPath, name);
        if (state) {
          return {
            name,
            deployed: true,
            packageName: some(state.packageName),
            packageVersion: some(state.packageVersion),
          };
        } else {
          return {
            name,
            deployed: false,
            packageName: none,
            packageVersion: none,
          };
        }
      })
    );
    return sendSuccess(c, ArrayType(WorkspaceInfoType), result);
  } catch (err) {
    return sendError(c, ArrayType(WorkspaceInfoType), errorToVariant(err));
  }
}
```

**Route pattern:**

Routes extract `repo` from URL and pass to handlers:

```typescript
// routes/workspaces.ts
export function workspaceRoutes(storage: StorageBackend) {
  return new Hono()
    .get('/repos/:repo/api/workspaces', async (c) => {
      const repo = c.req.param('repo');
      return await listWorkspaces(storage, repo);
    });
}
```

**Shared between Hono server and Lambda:**

```typescript
// Shared route setup - identical for both deployments
export function createRoutes(storage: StorageBackend) {
  const app = new Hono();
  app.route('/', workspaceRoutes(storage));
  app.route('/', packageRoutes(storage));
  // ...
  return app;
}

// e3-api-server (local)
const storage = new LocalStorage();
const app = createRoutes(storage);

// e3-aws Lambda
const storage = new S3DynamoStorage(s3, dynamo, bucket, table);
const app = createRoutes(storage);
```

### 2.2 Multi-Repo Server Mode

Update server configuration to support a directory of repositories:

```typescript
interface ServerConfig {
  // Multi-repo directory (mirrors cloud behavior)
  reposDir: string;

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
# Multi-repo directory mode (mirrors cloud)
e3-api-server --repos /path/to/repos/
# Serves /repos/alpha/api/..., /repos/beta/api/...
# where alpha/ and beta/ are subdirectories with .e3/
```

### 2.3 Authentication Architecture

**Design principles:**
- **OIDC everywhere** - local server and cloud use identical OAuth2/OIDC flows
- **No PATs** - only JWTs (access tokens + refresh tokens), stateless validation
- **No token database** - server validates JWT signatures, no per-request DB lookups
- **Cloud auth = Cognito** - e3-aws Lambda just validates Cognito-issued JWTs

**Token types:**

| Token | Lifetime | Purpose |
|-------|----------|---------|
| Access token | 1 hour (configurable, 15 min for cloud) | API authorization |
| Refresh token | 90 days | Get new access tokens without re-login |

**Local server as OIDC provider:**

```bash
# Start server (generates RSA keys on startup)
e3-api-server --repos ./repos

# Configure token expiry for testing
e3-api-server --repos ./repos --token-expiry 5s

# CI mode: auto-approve device flow (no browser interaction)
E3_AUTH_AUTO_APPROVE=1 e3-api-server --repos ./repos
```

**OIDC endpoints (local server provides these, cloud points to Cognito):**

| Endpoint | Purpose |
|----------|---------|
| `GET /.well-known/openid-configuration` | Discovery - tells CLI where auth endpoints are |
| `POST /oauth2/device_authorization` | Start device flow, returns device_code + user_code |
| `GET /device` | HTML page for user to approve (auto-approves in dev) |
| `POST /oauth2/token` | Exchange code for tokens OR refresh tokens |
| `GET /.well-known/jwks.json` | Public keys for JWT verification |

**JWT validation middleware (already exists):**

```typescript
// packages/e3-api-server/src/middleware/auth.ts
// Validates JWT signature using public key (from JWKS or config)
// Sets identity on context: { sub, email, roles }
```

### 2.4 CLI Auth Support

**Location:** `../e3/packages/e3-cli/`

**Login flow (Device Flow - RFC 8628):**

```
CLI                           Browser                    Server/Cognito
 │                              │                              │
 │ POST /oauth2/device_authorization                           │
 │─────────────────────────────────────────────────────────────>│
 │                              │                              │
 │ { device_code, user_code: "ABCD-1234", verification_uri }   │
 │<─────────────────────────────────────────────────────────────│
 │                              │                              │
 │ (opens browser)              │                              │
 │ ─────────────────────────────>                              │
 │                              │ GET /device?user_code=...    │
 │                              │─────────────────────────────>│
 │                              │                              │
 │                              │ (shows code, user clicks     │
 │                              │  Approve - or auto-approve)  │
 │                              │                              │
 │ (polls token endpoint)       │                              │
 │ POST /oauth2/token { device_code, grant_type }              │
 │─────────────────────────────────────────────────────────────>│
 │                              │                              │
 │ { access_token, refresh_token, expires_in }                 │
 │<─────────────────────────────────────────────────────────────│
```

**Credential storage:**

```
~/.e3/credentials.json
{
  "version": 1,
  "credentials": {
    "http://localhost:3000": {
      "accessToken": "eyJ...",
      "refreshToken": "eyJ...",
      "expiresAt": "2025-01-09T12:00:00Z"
    },
    "https://platform.example.com": {
      "accessToken": "eyJ...",
      "refreshToken": "eyJ...",
      "expiresAt": "2025-01-09T11:00:00Z"
    }
  }
}
```

**CLI token refresh logic:**

```typescript
async function getValidToken(serverUrl: string): Promise<string> {
  const creds = loadCredentials(serverUrl);

  if (!isExpired(creds.expiresAt)) {
    return creds.accessToken;
  }

  // Token expired - use refresh token to get new one
  const discovery = await fetchDiscovery(serverUrl);
  const newTokens = await refreshToken(discovery.token_endpoint, creds.refreshToken);
  saveCredentials(serverUrl, newTokens);
  return newTokens.accessToken;
}
```

**New commands:**

```bash
e3 login <server>           # Device flow login (opens browser)
e3 logout <server>          # Remove stored credentials
e3 auth status              # Show all stored credentials and expiry
e3 auth whoami [server]     # Show current user identity
```

**URL detection in CLI:**

All commands use a unified URL format: `http://server/repos/{name}` for remote repos, or a local path.

```typescript
// utils.ts
type RepoLocation =
  | { type: 'local'; path: string }
  | { type: 'remote'; baseUrl: string; repo: string };

// For most commands - validates repo exists
function parseRepoLocation(arg: string): RepoLocation {
  if (arg.startsWith('https://') || arg.startsWith('http://')) {
    const url = new URL(arg);
    const match = url.pathname.match(/^\/repos\/([^\/]+)/);
    return { type: 'remote', baseUrl: url.origin, repo: match[1] };
  }
  return { type: 'local', path: resolveRepo(arg) };  // resolveRepo validates existence
}

// For `repo create` - doesn't validate existence (repo is being created)
function parseRepoForCreate(arg: string): RepoLocation {
  if (arg.startsWith('https://') || arg.startsWith('http://')) {
    const url = new URL(arg);
    const match = url.pathname.match(/^\/repos\/([^\/]+)/);
    if (!match) throw new Error(`Invalid URL: expected /repos/{repo} in path`);
    return { type: 'remote', baseUrl: url.origin, repo: match[1] };
  }
  return { type: 'local', path: resolve(arg) };  // No existence check
}
```

**CLI command examples:**

```bash
# Local repository operations
e3 repo create .                              # Create repo at current dir
e3 repo status .                              # Show status
e3 repo remove .                              # Remove repo

# Remote repository operations (unified URL format)
e3 repo create http://localhost:3000/repos/my-repo   # Create remote repo
e3 repo status http://localhost:3000/repos/my-repo   # Show status
e3 repo remove http://localhost:3000/repos/my-repo   # Remove repo
e3 repo gc http://localhost:3000/repos/my-repo       # Garbage collection
```

**Update all CLI commands** to support remote:

```typescript
// Pattern for each command
const location = parseRepoLocation(repoArg);

if (location.type === 'local') {
  // Local: use LocalStorage with path as repo
  const storage = new LocalStorage();
  const repo = location.path;  // e.g., "/home/user/project/.e3"
  await workspaceList(storage, repo);
} else {
  // Remote: use e3-api-client
  const client = await createAuthenticatedClient(location);
  await client.workspaceList(location.repo);
}
```

### 2.5 e3-api-client Auth Headers

```typescript
// packages/e3-api-client/src/http.ts
export interface RequestOptions {
  token?: string;
}

export async function get<T>(
  url: string,
  path: string,
  successType: T,
  options?: RequestOptions
): Promise<Response<ValueTypeOf<T>>> {
  const headers: Record<string, string> = {
    'Accept': 'application/beast2',
  };

  if (options?.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }

  // ... existing fetch logic
}
```

### 2.6 Cloud (e3-aws) Integration

**Important:** AWS Cognito does NOT natively support OAuth 2.0 Device Authorization Grant (RFC 8628).
We must implement a device flow proxy in Lambda that wraps Cognito's authorization code flow.

**Reference:** [AWS Blog: Implement OAuth 2.0 device grant flow](https://aws.amazon.com/blogs/security/implement-oauth-2-0-device-grant-flow-by-using-amazon-cognito-and-aws-lambda/)

**Device flow proxy endpoints (served by Lambda):**

```typescript
// Discovery - points to our Lambda endpoints + Cognito JWKS
app.get('/.well-known/openid-configuration', (c) => {
  const baseUrl = process.env.BASE_URL;  // CloudFront URL
  const cognitoIssuer = process.env.COGNITO_ISSUER;
  return c.json({
    issuer: cognitoIssuer,
    device_authorization_endpoint: `${baseUrl}/oauth2/device_authorization`,
    token_endpoint: `${baseUrl}/oauth2/token`,
    jwks_uri: `${cognitoIssuer}/.well-known/jwks.json`,
  });
});

// POST /oauth2/device_authorization - Generate device_code, user_code
// Stores in DynamoDB: { device_code, user_code, status: 'pending', ttl: 5min }

// GET /device - HTML page for user approval
// Redirects to Cognito hosted UI with state=device_code

// GET /oauth2/callback - Cognito callback
// Exchanges auth code for tokens, stores in DynamoDB keyed by device_code

// POST /oauth2/token - CLI polls here
// Returns tokens if approved, "authorization_pending" if waiting
```

**CLI flow with Cognito (via device flow proxy):**
1. CLI fetches `/.well-known/openid-configuration` from e3-aws
2. Discovery points to Lambda's device flow endpoints
3. CLI starts device flow via `POST /oauth2/device_authorization`
4. User opens browser, approves via Cognito hosted UI
5. Callback stores Cognito tokens in DynamoDB
6. CLI polls `POST /oauth2/token` until approved
7. e3-aws Lambda validates Cognito-issued JWTs via API Gateway authorizer

**User Identity and Authorization:**

The API is the source of truth for user identity. When the API sees a new `sub` (user ID) in an access token, it queries Cognito to fetch and cache the user's profile.

*Identity flow:*
```
CLI                         API Lambda                  Cognito
 │                              │                          │
 │ GET /api/... (Bearer token)  │                          │
 │─────────────────────────────>│                          │
 │                              │                          │
 │                              │ (decode JWT, extract sub)│
 │                              │                          │
 │                              │ (check DynamoDB cache)   │
 │                              │                          │
 │                              │ AdminGetUser(sub)        │
 │                              │─────────────────────────>│
 │                              │                          │
 │                              │ {name, email, ...}       │
 │                              │<─────────────────────────│
 │                              │                          │
 │                              │ (cache in DynamoDB)      │
```

*DynamoDB user profile cache:*
```
PK: USER#{sub}              SK: #PROFILE
Attributes:
  - sub: string (Cognito subject, e.g., "99bef4d8-0051-7059-...")
  - email: string
  - name: string (display name)
  - givenName: string (first name)
  - familyName: string (last name)
  - cachedAt: timestamp
  - cognitoUsername: string (federated ID, e.g., "EntraID_GJ9K...")
```

*Key design decisions:*
- **Authz keyed by `sub`**: Permissions stored by Cognito subject ID (stable UUID)
- **Display via cached profile**: UI shows name/email from cached profile, not from JWT
- **CLI doesn't store id_token**: If CLI needs to display user info, it calls `GET /api/whoami`
- **Profile refresh**: Re-fetch from Cognito if cache is stale (e.g., >24 hours)

*API endpoint for CLI:*
```
GET /api/whoami
Response: { sub, email, name, givenName, familyName }
```

*Authorization (repo-level, future):*
- Cognito handles authentication (identity)
- e3-aws handles authorization (permissions) via DynamoDB
- Permissions keyed by `sub`, not email (emails can change)
- Token blacklist in DynamoDB if instant revocation needed
- For now: rely on short token expiry (15 min) and Cognito refresh token revocation

### Deliverables

- [x] Handlers extracted to `handlers/` directory
- [x] Routes refactored to use handlers (route factories: `createPackageRoutes`, etc.)
- [x] Multi-repo directory mode (`--repos` option)
- [x] JWT authentication middleware
- [x] **OIDC provider in e3-api-server:**
  - [x] Auto-generate RSA keys on startup
  - [x] `/.well-known/openid-configuration` discovery endpoint
  - [x] `/oauth2/device_authorization` endpoint
  - [x] `/device` HTML approval page (auto-approve in dev)
  - [x] `/oauth2/token` endpoint (code exchange + refresh)
  - [x] `/.well-known/jwks.json` endpoint
  - [x] `--token-expiry` CLI option
  - [x] `E3_AUTH_AUTO_APPROVE` env var for CI
- [x] **e3-cli auth:**
  - [x] Credential storage (`~/.e3/credentials.json`)
  - [x] `e3 login` with device flow
  - [x] `e3 logout` command
  - [x] `e3 auth status` command
  - [x] `e3 auth whoami` command
  - [x] Token refresh before API calls
- [x] e3-api-client updated with auth header support
- [x] All CLI commands inject auth token for remote URLs
- [ ] Route factory barrel export (`src/routes/index.ts`) for Lambda import
- [ ] Package.json exports field for `@elaraai/e3-api-server/routes`
- [ ] **e3-aws device flow proxy:**
  - [ ] `POST /oauth2/device_authorization` (generate codes, store in DynamoDB)
  - [ ] `GET /device` (approval page, redirects to Cognito)
  - [ ] `GET /oauth2/callback` (Cognito callback, exchange + store tokens)
  - [ ] `POST /oauth2/token` (CLI polls for tokens)

---

## Phase 3: S3DynamoStorage Implementation

**Goal:** Implement `StorageBackend` using S3 for objects, single DynamoDB table for refs.

**Location:** `packages/storage/` (this repository)

### 3.1 Single-Table DynamoDB Design

One table with composite keys, prefixed by repository ID:

```
Table: e3-{deploymentId}-data

Primary Key: PK (String), SK (String)

┌─────────────────────────────────────────────────────────────────────┐
│ REPOSITORY METADATA                                                  │
│ PK: REPO#{repo}           SK: #META                               │
│ Attributes: name, status, createdAt, statusChangedAt, executionArn? │
│ (status: 'creating' | 'active' | 'gc' | 'deleting')                  │
├─────────────────────────────────────────────────────────────────────┤
│ PACKAGES                                                             │
│ PK: REPO#{repo}           SK: PKG#{name}#{version}                │
│ Attributes: hash, createdAt                                         │
├─────────────────────────────────────────────────────────────────────┤
│ WORKSPACES                                                           │
│ PK: REPO#{repo}           SK: WS#{name}                           │
│ Attributes: state (Binary/BEAST2), updatedAt                        │
├─────────────────────────────────────────────────────────────────────┤
│ EXECUTION CACHE                                                      │
│ PK: REPO#{repo}           SK: EXEC#{taskHash}#{inputsHash}        │
│ Attributes: status (Binary/BEAST2), outputHash, updatedAt           │
├─────────────────────────────────────────────────────────────────────┤
│ DATAFLOW EXECUTION STATE                                             │
│ PK: REPO#{repo}           SK: EXEC#STATE#{workspace}              │
│ Attributes: executionId, status, startedAt, completedAt?,           │
│             taskCount, completedCount, failedCount, skippedCount,   │
│             cachedCount                                              │
├─────────────────────────────────────────────────────────────────────┤
│ DATAFLOW TASK STATUS                                                 │
│ PK: REPO#{repo}           SK: EXEC#TASK#{executionId}#{taskName}  │
│ Attributes: status, outputHash?, exitCode?, error?, duration?,      │
│             readyAt?, completedAt?                                   │
├─────────────────────────────────────────────────────────────────────┤
│ DATAFLOW GRAPH                                                       │
│ PK: REPO#{repo}           SK: EXEC#GRAPH#{executionId}            │
│ Attributes: graph (JSON string)                                      │
├─────────────────────────────────────────────────────────────────────┤
│ DATAFLOW EVENTS                                                      │
│ PK: REPO#{repo}           SK: EXEC#EVENT#{executionId}#{seq}      │
│ Attributes: eventType, task, timestamp, duration?, exitCode?,       │
│             message?, reason?                                        │
├─────────────────────────────────────────────────────────────────────┤
│ LOCKS                                                                │
│ PK: REPO#{repo}           SK: LOCK#{resource}                     │
│ Attributes: holder, operation, acquiredAt, expiresAt, ttl           │
├─────────────────────────────────────────────────────────────────────┤
│ LOG CHUNKS                                                           │
│ PK: REPO#{repo}           SK: LOG#{taskHash}#{inputsHash}#{stream}│
│                               #{timestamp}#{seq}                   │
│ Attributes: data, timestamp, ttl (7 days)                            │
├─────────────────────────────────────────────────────────────────────┤
│ USER PROFILES (cached from Cognito) - TODO                           │
│ PK: USER#{sub}              SK: #PROFILE                           │
│ Attributes: email, name, givenName, familyName, cachedAt             │
├─────────────────────────────────────────────────────────────────────┤
│ PERMISSIONS (e3-aws authz only) - TODO                               │
│ PK: USER#{sub}              SK: REPO#{repo}                        │
│ Attributes: role (admin|member), grantedAt, grantedBy               │
│ GSI1: PK=REPO#{repo} SK=USER#{sub} (query users per repo)         │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.1.1 Future Schema: Optimized Partitioning

**Goal:** Redesign DynamoDB schema to maximize partitioning and eliminate hot partition risks.

**Problem:** All items currently share `PK: REPO#{repo}`, creating hot partition risks:

| Item Type | Write Frequency | Read Frequency | Hot Partition Risk |
|-----------|-----------------|----------------|-------------------|
| Logs | **VERY HIGH** (64KB chunks every 2s per task) | Moderate | **CRITICAL** |
| Execution events | High (2 per task) | Low | Medium |
| Task statuses | High (1-3 per task) | Medium | Medium |
| Execution state counters | **VERY HIGH** (1 per task completion) | Medium | **HIGH** |
| Execution cache | Moderate (1 per task) | High (cache check) | Low |
| Packages | Low | Moderate | Low |
| Workspaces | Low | Moderate | Low |
| Repo metadata | Rare | Low | Low |

**Access Pattern Analysis:**

*Hierarchical Navigation (UI-driven):*
1. List repos → Choose repo
2. List workspaces in repo → Choose workspace
3. View tasks/datasets in workspace
4. View task execution history
5. View logs for specific execution

*Dataflow Execution (Write-heavy):*
1. Read task graph from workspace
2. Query all task statuses to find ready tasks
3. Check cache by `taskHash + inputsHash` (exact lookup)
4. Write task status updates
5. Increment execution counters (single item, concurrent updates!)
6. Append log chunks (many writes per task)
7. Write execution cache entry on completion

**Key Insight:** Execution cache is **repo-scoped, NOT workspace-scoped**. Same `taskHash + inputsHash` = same output, regardless of workspace. This enables cross-workspace cache sharing. Logs follow the same pattern.

---

**Future Schema:**

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. REPOS                                                             │
│ PK: REPO                    SK: {repo}                              │
│ Attributes: name, status, createdAt, statusChangedAt, executionArn? │
│                                                                     │
│ Rationale: Listing repos becomes Query PK=REPO. Repos rarely        │
│ created/updated so shared partition is fine.                        │
│                                                                     │
│ Access patterns:                                                    │
│   - List repos: Query PK=REPO                                       │
│   - Get repo: GetItem PK=REPO, SK={repo}                            │
├─────────────────────────────────────────────────────────────────────┤
│ 2. PACKAGES                                                          │
│ PK: PKG/{repo}              SK: {name}/{version}                    │
│ Attributes: hash, createdAt                                         │
│                                                                     │
│ Rationale: Separates package operations from other repo operations. │
│ Moderate write load during `e3 push`.                               │
│                                                                     │
│ Access patterns:                                                    │
│   - List packages: Query PK=PKG/{repo}                              │
│   - Get package: GetItem PK=PKG/{repo}, SK={name}/{version}         │
├─────────────────────────────────────────────────────────────────────┤
│ 3. WORKSPACES                                                        │
│ PK: WS/{repo}               SK: {name}                              │
│ Attributes: state (Binary/BEAST2), updatedAt                        │
│                                                                     │
│ Rationale: Separates workspace state from other repo operations.    │
│                                                                     │
│ Access patterns:                                                    │
│   - List workspaces: Query PK=WS/{repo}                             │
│   - Get workspace: GetItem PK=WS/{repo}, SK={name}                  │
├─────────────────────────────────────────────────────────────────────┤
│ 4. EXECUTION CACHE                                                   │
│ PK: CACHE/{repo}/{taskHash} SK: {inputsHash}                        │
│ Attributes: status (Binary/BEAST2), outputHash, updatedAt           │
│                                                                     │
│ Rationale: Partitioning by taskHash provides:                       │
│   - Better write distribution during scatter-gather patterns        │
│   - Higher capacity per task (up to 10GB of cache entries)          │
│   - Efficient per-task queries                                      │
│                                                                     │
│ Access patterns:                                                    │
│   - Check cache: GetItem PK=CACHE/{repo}/{taskHash}, SK={inputsHash}│
│   - List for task: Query PK=CACHE/{repo}/{taskHash}                 │
│   - List for GC: Parallel scan with PK begins_with CACHE/{repo}/    │
├─────────────────────────────────────────────────────────────────────┤
│ 5. DATAFLOW EXECUTIONS (with history)                                │
│ PK: EXEC/{repo}/{workspace} SK: 0 (Number) → counter: {nextId}      │
│                             SK: 1, 2, 3... (Number) → executions    │
│                                                                     │
│ Execution attributes: status, startedAt, completedAt?,              │
│   taskCount, completedCount, failedCount, skippedCount, cachedCount,│
│   eventSeq, graph (JSON string - stored as attribute)               │
│                                                                     │
│ Design notes:                                                       │
│   - SK=0 is counter; executions start at 1                          │
│   - Graph is attribute of execution item (no separate item)         │
│   - Number type SK gives natural ordering without padding           │
│                                                                     │
│ Creating new execution (atomic):                                    │
│   1. Use DynamoDB transaction or workspace lock                     │
│   2. Increment SK=0 nextId                                          │
│   3. Create new execution item at SK={nextId}                       │
│                                                                     │
│ Access patterns:                                                    │
│   - List executions (newest first):                                 │
│       Query PK=EXEC/{repo}/{ws}, SK > 0, ScanIndexForward=false     │
│   - Get latest: Same query with Limit=1                             │
│   - Get specific: GetItem PK=EXEC/{repo}/{ws}, SK={id}              │
│   - Update counters: UpdateItem on execution item                   │
│   - Create: Transaction (increment SK=0.nextId + put new item)      │
├─────────────────────────────────────────────────────────────────────┤
│ 6. DATAFLOW TASK STATUS (per execution)                              │
│ PK: TASK/{repo}/{executionId}  SK: {taskName}                       │
│ Attributes: status, outputHash?, exitCode?, error?, duration?,      │
│             readyAt?, completedAt?                                  │
│                                                                     │
│ Rationale: Each execution gets own partition for task statuses:     │
│   - Preserves task status history (not overwritten each run)        │
│   - Avoids 10GB partition limit accumulation                        │
│   - Efficient batch read for getReadyTasks() within single exec     │
│                                                                     │
│ Access patterns:                                                    │
│   - Get all task statuses: Query PK=TASK/{repo}/{executionId}       │
│   - Get single task: GetItem PK=TASK/{repo}/{execId}, SK={taskName} │
├─────────────────────────────────────────────────────────────────────┤
│ 7. DATAFLOW EVENTS (per execution)                                   │
│ PK: EVENT/{repo}/{executionId}  SK: {seq} (10-digit zero-padded)    │
│ Attributes: eventType, task, timestamp, duration?, exitCode?,       │
│             message?, reason?                                       │
│                                                                     │
│ Rationale: Events are append-only. Separate partition per exec:     │
│   - Write isolation (no contention with task status updates)        │
│   - Efficient pagination for event log viewing                      │
│   - Natural cleanup (delete all events for an execution)            │
│                                                                     │
│ Access patterns:                                                    │
│   - Append event: PutItem (seq from atomic counter in exec metadata)│
│   - List events: Query PK=EVENT/{repo}/{executionId} with pagination│
├─────────────────────────────────────────────────────────────────────┤
│ 8. LOCKS                                                             │
│ PK: LOCK/{repo}             SK: {resource}                          │
│ Attributes: holder, operation, acquiredAt, expiresAt, ttl           │
│                                                                     │
│ Rationale: Separates lock operations from other repo operations.    │
│ Lock contention is per-resource, so partition isolation helps.      │
├─────────────────────────────────────────────────────────────────────┤
│ 9. LOG CHUNKS                                                        │
│ PK: LOG/{repo}/{taskHash}/{inputsHash}                              │
│ SK: {stream}/{chunk_index}  (chunk_index: 6-digit zero-padded)      │
│ Attributes: data, timestamp, ttl (7 days)                           │
│                                                                     │
│ Key changes:                                                        │
│   - Partition per task execution (isolates log writes)              │
│   - Contiguous chunk index instead of timestamp+seq                 │
│   - Stream in SK enables reading stdout/stderr independently        │
│                                                                     │
│ Rationale: Logs are highest-volume writes. Each task execution's    │
│ logs go to own partition, eliminating hot partition issues.         │
│                                                                     │
│ Access patterns:                                                    │
│   - Append chunk: PutItem with next chunk index                     │
│   - Read stream: Query PK=LOG/..., SK begins_with {stream}/         │
│   - Full read: Query PK=LOG/{repo}/{taskHash}/{inputsHash}          │
└─────────────────────────────────────────────────────────────────────┘
```

**Summary Table:**

| Item Type | Current PK | Future PK | Future SK | Benefit |
|-----------|------------|-----------|-----------|---------|
| Repos | `REPO#{repo}` | `REPO` | `{repo}` | List without scan |
| Packages | `REPO#{repo}` | `PKG/{repo}` | `{name}/{version}` | Isolated writes |
| Workspaces | `REPO#{repo}` | `WS/{repo}` | `{name}` | Isolated writes |
| Exec cache | `REPO#{repo}` | `CACHE/{repo}/{taskHash}` | `{inputsHash}` | **Per-task partition** |
| Exec counter | (none) | `EXEC/{repo}/{workspace}` | `0` (Number) | Atomic ID generation |
| Exec metadata | `REPO#{repo}` | `EXEC/{repo}/{workspace}` | `{id}` (Number, 1+) | **History + graph as attr** |
| Task status | `REPO#{repo}` | `TASK/{repo}/{id}` | `{taskName}` | **Per-exec partition** |
| Events | `REPO#{repo}` | `EVENT/{repo}/{id}` | `{seq}` | Append isolation |
| Locks | `REPO#{repo}` | `LOCK/{repo}` | `{resource}` | Isolated contention |
| Logs | `REPO#{repo}` | `LOG/{repo}/{taskHash}/{inputsHash}` | `{stream}/{chunk}` | **Per-task partition** |

**GSI Requirements:**

```
GSI1: Repo membership (for future authz)
GSI1PK: USER/{sub}
GSI1SK: REPO/{repo}
Enables: "List repos for user"
```

No other GSIs needed - the partition key design supports all current access patterns.

**Design Decisions:**

1. **Execution cache scope**: Workspace-agnostic (keyed by `taskHash+inputsHash`). Enables cross-workspace cache sharing.

2. **Execution cache partitioning**: Per-task partitions (`CACHE/{repo}/{taskHash}`). Distributes write load during scatter-gather patterns.

3. **Execution history**: Preserved. Each execution gets own SK (Number type, starting at 1).

4. **Execution ID format**: Autoincrement numeric IDs with Number-type SK. SK=0 is counter, executions are 1+.

5. **Graph storage**: Graph is an attribute of the execution item (not a separate item).

6. **Task status isolation**: Per-execution partitions (`TASK/{repo}/{executionId}`) to avoid 10GB limit and preserve history.

7. **History retention**: No TTL on execution metadata. Cleanup handled by custom GC process.

8. **SK prefixes**: Only used where multiple item types share a partition. Currently none needed.

**Open Questions:**

1. **Log retention**: Current 7-day TTL on logs. Should this be configurable? Logs are keyed by taskHash+inputsHash, so shared across executions of same task+inputs.

2. **GC scope**: When GC runs, should it clean up old executions? Need to define policy (e.g., keep last N executions per workspace).

**Migration Strategy:** Incremental migration in 3 phases to minimize risk and allow validation at each step.

| Phase | Items | Rationale |
|-------|-------|-----------|
| 1 | REPOS, PACKAGES, WORKSPACES, LOCKS | Independent, low-volume, validates approach |
| 2 | LOGS, CACHE | Highest write volume, biggest hot partition benefit |
| 3 | EXEC, TASK, EVENT | Coupled items, introduces execution history semantics |

Each phase follows: (1) dual-write to old+new PK patterns, (2) migrate reads to prefer new, (3) let TTL expire or backfill, (4) remove old pattern support.

---

### 3.2 S3 Layout

```
s3://{bucket}/
  {repo}/objects/{hash}    # Content-addressed blobs
```

### 3.3 Implementation

```
packages/storage/src/
├── s3-dynamo-storage.ts      # S3DynamoStorage class
├── s3-object-store.ts        # S3-backed ObjectStore
├── dynamo-ref-store.ts       # DynamoDB-backed RefStore + repo management
├── dynamo-lock-service.ts    # DynamoDB-backed LockService (with TTL)
├── dynamo-log-store.ts       # DynamoDB-backed LogStore (chunked for streaming)
└── index.ts                  # Exports
```

**S3DynamoStorage:** Initialized once at Lambda startup, `repo` passed to methods:

```typescript
export class S3DynamoStorage implements StorageBackend {
  public readonly objects: ObjectStore;
  public readonly refs: RefStore;
  public readonly locks: LockService;
  public readonly logs: LogStore;

  constructor(
    s3: S3Client,
    dynamo: DynamoDBClient,
    bucket: string,
    tableName: string
  ) {
    this.objects = new S3ObjectStore(s3, bucket);
    this.refs = new DynamoRefStore(dynamo, tableName);
    this.locks = new DynamoLockService(dynamo, tableName);
    this.logs = new DynamoLogStore(dynamo, tableName);
  }
}

// S3ObjectStore - repo used as prefix
class S3ObjectStore implements ObjectStore {
  constructor(private s3: S3Client, private bucket: string) {}

  async write(repo: string, data: Uint8Array): Promise<string> {
    const hash = sha256(data);
    await this.s3.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: `${repo}/objects/${hash}`,
      Body: data
    }));
    return hash;
  }

  async read(repo: string, hash: string): Promise<Uint8Array> {
    const response = await this.s3.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: `${repo}/objects/${hash}`
    }));
    return response.Body.transformToByteArray();
  }
}

// DynamoRefStore - repo used in partition key
class DynamoRefStore implements RefStore {
  constructor(private dynamo: DynamoDBClient, private tableName: string) {}

  async workspaceList(repo: string): Promise<string[]> {
    const result = await this.dynamo.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `REPO#${repo}` },
        ':prefix': { S: 'WS#' }
      }
    }));
    return result.Items?.map(item => item.SK.S.replace('WS#', '')) ?? [];
  }
}
```

### 3.4 CDK Stack Updates

**Update `cdk/platform/lib/e3-platform-stack.ts`:**

- Remove: EFS filesystem, access points, VPC NAT gateway (not needed without EFS)
- Add: S3 bucket for objects
- Change: Single DynamoDB table (`e3-{deploymentId}-data`) instead of separate tables
- Update: Lambda environment variables, IAM permissions

### 3.5 Lambda Integration

**Update `packages/api/src/index.ts`:**

```typescript
import { S3DynamoStorage } from '@elaraai/e3-storage';
import { createRoutes } from '@elaraai/e3-api-server/routes';

// Initialize once at Lambda cold start
const storage = new S3DynamoStorage(
  new S3Client({}),
  new DynamoDBClient({}),
  process.env.BUCKET_NAME!,
  process.env.TABLE_NAME!
);

// Use shared route setup from e3-api-server
const app = createRoutes(storage);

// Export Lambda handler
export const handler = handle(app);
```

The route handlers extract `repo` from the URL and pass it to e3-core functions:

```typescript
// Inside createRoutes() - shared between local server and Lambda
app.get('/repos/:repo/api/workspaces', async (c) => {
  const repo = c.req.param('repo');
  return c.json(await workspaceList(storage, repo));
});
```

### Deliverables

- [x] S3ObjectStore implementation (repo as prefix)
- [x] DynamoRefStore implementation (repo in partition key)
- [x] DynamoLockService implementation (with TTL, East text holder encoding)
- [x] DynamoLogStore implementation (chunked logs in DynamoDB)
- [x] S3DynamoStorage class (initialized once, no repo in constructor)
- [x] CDK stack updated (S3 bucket, single DynamoDB table, no EFS)
- [ ] DynamoRefStore repo management: `listRepos()`, `createRepo()`, `deleteRepo()`
- [ ] Lambda using shared routes from e3-api-server
- [ ] Integration tests

---

## Phase 4: MVP (Frontend + Step Functions)

**Goal:** Complete working system with frontend, Step Functions orchestration, and east-node execution.

### 4.1 Step Functions Orchestration

Step Functions manages the dataflow DAG execution using external state in DynamoDB (not Step Functions state) to handle large DAGs that exceed state size limits.

**Architecture principles:**
- **Dataflow-centric execution** - All execution goes through dataflow, no separate task execution path
- **External state** - Task completion tracked in DynamoDB, not Step Functions state
- **Direct Lambda invocation** - Tasks execute synchronously via Lambda container images
- **Ephemeral workspaces** - Ad hoc tasks execute as single-task dataflows in temporary workspaces

```
┌─────────────────────────────────────────────────────────────────┐
│  Dataflow State Machine                                         │
│                                                                 │
│  ┌─────────────┐                                                │
│  │ Initialize  │ → Create execution record in DynamoDB          │
│  └──────┬──────┘                                                │
│         │                                                       │
│  ┌──────▼──────┐                                                │
│  │  GetGraph   │ → Lambda: dataflowGetGraph()                   │
│  │             │   Store graph in DynamoDB, mark all pending    │
│  └──────┬──────┘                                                │
│         │                                                       │
│  ┌──────▼──────────────────────────────────────────────┐        │
│  │ ExecutionLoop                                        │        │
│  │                                                     │        │
│  │  ┌─────────────┐                                    │        │
│  │  │ GetReady    │ → Query DynamoDB for tasks with    │        │
│  │  │   Tasks     │   all dependencies completed       │        │
│  │  └──────┬──────┘                                    │        │
│  │         │                                           │        │
│  │  ┌──────▼──────────────────────────────────┐        │        │
│  │  │DispatchTasksMap (parallel, max 10)      │        │        │
│  │  │                                         │        │        │
│  │  │  For each ready task:                   │        │        │
│  │  │  ┌───────────────┐                      │        │        │
│  │  │  │ DispatchTask  │ → Check cache        │        │        │
│  │  │  └───────┬───────┘                      │        │        │
│  │  │          │                              │        │        │
│  │  │  ┌───────▼───────┐                      │        │        │
│  │  │  │ ExecuteOrSkip │ → If cached, skip    │        │        │
│  │  │  └───────┬───────┘                      │        │        │
│  │  │          │                              │        │        │
│  │  │  ┌───────▼───────────────────────┐      │        │        │
│  │  │  │ ExecuteTask (Lambda container)│      │        │        │
│  │  │  │ - Download inputs from S3     │      │        │        │
│  │  │  │ - Run east-py CLI             │      │        │        │
│  │  │  │ - Upload output to S3         │      │        │        │
│  │  │  │ - Return outputHash           │      │        │        │
│  │  │  └───────────────────────────────┘      │        │        │
│  │  └─────────────────────────────────────────┘        │        │
│  │         │                                           │        │
│  │  ┌──────▼──────┐                                    │        │
│  │  │WriteResults │ → Update workspace with outputs    │        │
│  │  └──────┬──────┘                                    │        │
│  │         │                                           │        │
│  │  ┌──────▼──────┐   No ┌─────────────┐               │        │
│  │  │ AllComplete?│ ───→ │ Loop back   │               │        │
│  │  └──────┬──────┘      └─────────────┘               │        │
│  │         │ Yes                                       │        │
│  └─────────┼───────────────────────────────────────────┘        │
│            │                                                    │
│  ┌─────────▼───┐                                                │
│  │  Finalize   │ → Update workspace state, cleanup              │
│  └─────────────┘                                                │
└─────────────────────────────────────────────────────────────────┘
```

**DynamoDB execution state:**

```
# Execution graph (for large DAGs exceeding Step Functions 256KB limit)
PK: REPO#{repo}  SK: EXEC#GRAPH#{executionId}
Attributes:
  - graph: JSON-encoded DataflowGraph
  - createdAt: timestamp

# Task execution status (with claim tracking for long-running tasks)
PK: REPO#{repo}  SK: EXEC#TASK#{executionId}#{taskName}
Attributes:
  - status: dispatched | running | success | failed | error
  - claimedBy: string (container ID that claimed the task)
  - claimedAt: number (timestamp when claimed)
  - heartbeat: number (last heartbeat timestamp, updated every 60s)
  - outputHash: string (if success)
  - exitCode: number (if failed)
  - error: string (error message)
  - duration: number (execution time in ms)

# Execution state (for API polling)
PK: REPO#{repo}  SK: EXEC#STATE#{workspace}
Attributes:
  - executionId: string
  - status: running | completed | failed
  - startedAt, completedAt: timestamps
  - summary: { executed, cached, failed, skipped, duration }
```

**Task claim tracking:** SQS visibility timeout is finite (15 min). For long-running tasks:
- Container claims task via conditional DynamoDB write (prevents duplicate execution)
- Heartbeat updated every 60s to extend claim
- Stale claims (heartbeat > 5 min old) detected by Step Functions and marked failed
- SQS DLQ handles persistent failures after 3 retries

**Lambda handlers** (in `packages/runner/`):

| Handler | e3-core Function | Purpose |
|---------|------------------|---------|
| `get-graph.ts` | `dataflowGetGraph()` | Build task graph, store in DynamoDB |
| `get-ready.ts` | `dataflowGetReadyTasks()` | Find tasks with all dependencies completed |
| `dispatch-task.ts` | `dataflowCheckCache()` | Check cache, return task info for execution |
| `execute-task.ts` | Container Lambda | Execute task via east-py CLI, upload output |
| `write-result.ts` | `workspaceSetDatasetByHash()` | Update workspace with task output |
| `mark-skipped.ts` | `dataflowGetDependentsToSkip()` | Mark downstream tasks as skipped on failure |

**Execute-task Lambda** (container image from `ghcr.io/elaraai/e3`):
- Invoked directly by Step Functions (no SQS polling)
- Downloads inputs from S3
- Runs `east-py run <ir> -p ... -i ... -o ...`
- Uploads output to S3
- Returns outputHash (Step Functions handles retries)

### 4.1.1 Ephemeral Workspaces for Ad Hoc Tasks

Ad hoc task execution uses the same dataflow machinery via ephemeral workspaces:

```
Ad hoc task execution:
1. Create ephemeral workspace (unique name, e.g., "adhoc-{uuid}")
2. Set input datasets in workspace
3. Execute dataflow (single task in graph)
4. Read output dataset
5. Delete workspace (or auto-expire via TTL)
```

**Benefits:**
- No separate code path for ad hoc vs scheduled execution
- Same caching, logging, and monitoring
- Workspace provides isolation and cleanup boundary

**API pattern:**
```
POST /api/repos/{repo}/execute
{
  "package": "my-package",
  "version": "1.0.0",
  "task": "my-task",
  "inputs": { "x": 42, "y": "hello" }
}

→ Creates ephemeral workspace
→ Sets inputs
→ Executes single-task dataflow
→ Returns output (or execution handle for async)
→ Cleans up workspace
```

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

**Dataflow-centric design:** All execution goes through dataflow. There is no separate task execution endpoint - ad hoc tasks use ephemeral workspaces with single-task dataflows.

```
# Repository management
GET  /api/repos                                # List repositories
POST /api/repos                                # Create repository
GET  /api/repos/{repo}                         # Get repository status
DELETE /api/repos/{repo}                       # Delete repository (async)
POST /api/repos/{repo}/gc                      # Start garbage collection
GET  /api/repos/{repo}/gc/{id}                 # Get GC status

# Package management
GET  /api/repos/{repo}/packages                # List packages
POST /api/repos/{repo}/packages/import         # Import package

# Workspace management
GET  /api/repos/{repo}/workspaces              # List workspaces
POST /api/repos/{repo}/workspaces              # Create workspace
GET  /api/repos/{repo}/workspaces/{ws}         # Get workspace state
DELETE /api/repos/{repo}/workspaces/{ws}       # Delete workspace

# Dataset operations
GET  /api/repos/{repo}/workspaces/{ws}/datasets/{path}    # Get dataset value
PUT  /api/repos/{repo}/workspaces/{ws}/datasets/{path}    # Set dataset value

# Execution (dataflow only)
POST /api/repos/{repo}/workspaces/{ws}/execute            # Start dataflow execution
GET  /api/repos/{repo}/workspaces/{ws}/executions/{id}    # Get execution status
GET  /api/repos/{repo}/workspaces/{ws}/graph              # Get task dependency graph

# Ad hoc execution (ephemeral workspace, single-task dataflow)
POST /api/repos/{repo}/execute                 # Execute task in ephemeral workspace
{
  "package": "pkg-name",
  "version": "1.0.0",
  "task": "task-name",
  "inputs": { ... }
}
```

### Deliverables

- [ ] Step Functions state machine (CDK)
- [ ] Lambda handlers for dataflow execution
- [ ] CloudFront distribution with S3 + API Gateway routing
- [ ] Frontend app with Cognito login
- [ ] Workspace list and UI rendering
- [ ] End-to-end test (create repo → deploy package → execute → view UI)

---

## Phase 5: Fallback Runners (Fargate) - Optional

**Goal:** Provide Fargate-based task execution for tasks exceeding Lambda limits (>15min or >10GB memory).

**Note:** Lambda is the default execution path. Fargate is only needed for long-running or memory-intensive tasks.

**When to use Fargate:**
- Tasks that run longer than 15 minutes
- Tasks requiring more than 10GB memory
- Tasks with specific hardware requirements (GPU, etc.)

### 5.1 Latency Requirements

| Approach | Cold Start | Use Case |
|----------|------------|----------|
| Fargate RunTask | 30-60s | Unacceptable for interactive use |
| **ECS Service (warm pool)** | **<1s** | east-py tasks |

Fargate's `RunTask` API has 30-60 second cold start latency due to container image pull and initialization. For interactive workloads, this is unacceptable. Instead, we use an ECS Service pattern with warm containers.

### 5.2 ECS Service Warm Pool Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  ECS Service (east-py runner)                                   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Auto-scaling configuration:                              │    │
│  │   - Min capacity: 0 (scale to zero when idle)            │    │
│  │   - Max capacity: N (based on expected load)             │    │
│  │   - Scale-out: Fast (target tracking on queue depth)     │    │
│  │   - Scale-in: Slow (keep warm containers available)      │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                          │
│  │Container│  │Container│  │Container│  (warm, polling)         │
│  │  (idle) │  │(running)│  │  (idle) │                          │
│  └────┬────┘  └────┬────┘  └────┬────┘                          │
│       │            │            │                               │
│       └────────────┼────────────┘                               │
│                    │                                            │
│              ┌─────▼─────┐                                      │
│              │ SQS Queue │ ← Task dispatch from Step Functions  │
│              └───────────┘                                      │
└─────────────────────────────────────────────────────────────────┘
```

**Container lifecycle:**

```
┌──────────────────────────────────────────────────────────────┐
│  Container (long-running)                                    │
│                                                              │
│  startup:                                                    │
│    - Load runtime (Python/Julia)                             │
│    - Pre-warm interpreters                                   │
│    - Connect to SQS                                          │
│                                                              │
│  loop:                                                       │
│    1. Poll SQS for task (long poll, 20s)                     │
│    2. Receive task: { repo, taskHash, inputHashes }          │
│    3. Read inputs from S3                                    │
│    4. Execute task                                           │
│    5. Write output to S3                                     │
│    6. Update DynamoDB: task status = completed               │
│    7. Delete SQS message                                     │
│    8. Return to polling                                      │
│                                                              │
│  graceful shutdown:                                          │
│    - Finish current task                                     │
│    - Stop accepting new tasks                                │
└──────────────────────────────────────────────────────────────┘
```

**Task dispatch flow:**

```
Step Functions                     SQS                    ECS Container
      │                             │                           │
      │ SendMessage(task)           │                           │
      │────────────────────────────>│                           │
      │                             │                           │
      │                             │ ReceiveMessage            │
      │                             │<──────────────────────────│
      │                             │                           │
      │                             │ task: {repo, hash, ...}   │
      │                             │──────────────────────────>│
      │                             │                           │
      │                             │           [execute task]  │
      │                             │                           │
      │                             │ DeleteMessage             │
      │                             │<──────────────────────────│
      │                             │                           │
      │                     [Update DynamoDB: completed]        │
      │                             │                           │
      │ [Poll DynamoDB for status]  │                           │
      │<────────────────────────────────────────────────────────│
```

### 5.3 Task Dispatch (MVP)

MVP uses single runner (east-py via ECS Service). No routing logic needed:

```typescript
// In dispatch-task Lambda
// All tasks go to the east-py SQS queue
await sqs.sendMessage({
  QueueUrl: TASK_QUEUE_URL,
  MessageBody: JSON.stringify({
    repo,
    workspace,
    executionId,
    taskName,
    taskHash,
    inputHashes,
  }),
  MessageGroupId: repo,  // FIFO queue
  MessageDeduplicationId: `${executionId}-${taskName}`,
});

// Write "dispatched" status to DynamoDB
await dynamodb.putItem({
  TableName: TABLE_NAME,
  Item: {
    PK: { S: `REPO#${repo}` },
    SK: { S: `EXEC#TASK#${executionId}#${taskName}` },
    status: { S: 'dispatched' },
    dispatchedAt: { N: String(Date.now()) },
  },
});
```

**Future:** Add task routing for multiple runners (east-node via Lambda, julia via separate ECS Service).

### 5.4 Runner Registry (MVP)

**MVP: Single runner type** (east-py via ECS Service):

| Runner | Compute | Image | Packages |
|--------|---------|-------|----------|
| `east-py` | ECS Service | `{account}.dkr.ecr.{region}.amazonaws.com/{prefix}-east-py-runner` | east-py, east-py-std, east-py-io, east-py-datascience |

**Container includes:**
- Python 3.11 runtime
- All east-py packages (core, std, io, datascience)
- boto3 for S3/DynamoDB access
- SQS long-polling for task dispatch
- Heartbeat mechanism for long-running tasks

**Future:** Add east-node (Lambda), julia (ECS Service), user-defined runners.

### 5.5 CDK Resources

```typescript
// SQS FIFO Queue for task dispatch
const taskQueue = new sqs.Queue(this, 'TaskQueue', {
  queueName: `${prefix}-tasks.fifo`,
  fifo: true,
  visibilityTimeout: Duration.minutes(15),
  deadLetterQueue: {
    queue: new sqs.Queue(this, 'TaskDLQ', {
      queueName: `${prefix}-tasks-dlq.fifo`,
      fifo: true,
    }),
    maxReceiveCount: 3,
  },
});

// ECS Cluster and Service
const cluster = new ecs.Cluster(this, 'RunnerCluster', {
  clusterName: `${prefix}-runners`,
  vpc,
});

const taskDef = new ecs.FargateTaskDefinition(this, 'RunnerTaskDef', {
  memoryLimitMiB: 4096,
  cpu: 2048,
});

taskDef.addContainer('runner', {
  image: ecs.ContainerImage.fromEcrRepository(runnerRepo, 'latest'),
  environment: {
    TASK_QUEUE_URL: taskQueue.queueUrl,
    BUCKET_NAME: dataBucket.bucketName,
    TABLE_NAME: dataTable.tableName,
  },
});

const service = new ecs.FargateService(this, 'RunnerService', {
  cluster,
  taskDefinition: taskDef,
  desiredCount: 1,  // Warm pool
});

// Auto-scaling based on queue depth
const scaling = service.autoScaleTaskCount({
  minCapacity: 0,
  maxCapacity: 10,
});

scaling.scaleOnMetric('QueueScaling', {
  metric: taskQueue.metricApproximateNumberOfMessagesVisible(),
  scalingSteps: [
    { upper: 0, change: -1 },   // Scale to 0 when queue empty
    { lower: 1, change: +1 },   // Scale up on messages
  ],
  cooldown: Duration.seconds(60),
});
```

### 5.6 Failure Handling (MVP)

**MVP approach:** Users "babysit" dataflows and restart on persistent failure.

- **Transient failure:** Task fails, message returns to queue via SQS visibility timeout
- **Persistent failure:** After 3 retries, message goes to DLQ; downstream tasks skipped
- **Long-running tasks:** Heartbeat extends claim; if heartbeat stops (crash), claim expires after 5 min
- **Stale claim detection:** `check-completion` Lambda detects claims with old heartbeats and marks as failed

**Future:** Automatic retries, exponential backoff, alerting.

### Deliverables

- [ ] SQS FIFO queue for task dispatch
- [ ] ECS Cluster with Fargate capacity provider
- [ ] ECR repository for east-py runner image
- [ ] Dockerfile for east-py runner (includes datascience package)
- [ ] Python runner script with SQS polling and heartbeat
- [ ] ECS Service with auto-scaling on queue depth
- [ ] Task claim tracking in DynamoDB
- [ ] Stale claim detection in check-completion Lambda
- [ ] CloudWatch metrics and alarms
- [ ] Integration tests (e3-api-tests dataflow suite)

---

## Future: Log Sharding by Execution

**Goal:** Prevent log-heavy tasks from creating hot partitions that slow down other repo operations.

### Problem

Current log storage uses `PK: REPO#{repo}`, meaning all log writes for a repository share the same DynamoDB partition:

```
Current schema:
PK: REPO#{repo}
SK: LOG#{taskHash}#{inputsHash}#{stream}#{timestamp}#{seq}
```

DynamoDB partitions have throughput limits (~1000 WCU per partition). A task producing heavy log output can:
- Exhaust the partition's write capacity
- Cause throttling on unrelated operations (workspace reads, dataset gets, etc.)
- Create latency spikes across the entire repository

### Solution: Execution-Scoped Partition Keys

Move logs to execution-scoped partitions, isolating log traffic from repo metadata operations:

```
New schema:
PK: LOG#{repo}#{executionId}#{taskName}
SK: {stream}#{timestamp}#{seq}

Example:
PK: LOG#demo#abc123#format
SK: stdout#000001737388800000#000001
Attributes: data, timestamp, ttl
```

**Benefits:**
- Each task's logs go to a separate partition
- Repo operations (`REPO#{repo}`) unaffected by log traffic
- Better parallelism for concurrent task log writes
- Natural isolation between executions

### Schema Design

```
┌─────────────────────────────────────────────────────────────────────┐
│ LOG CHUNKS (sharded by execution + task)                            │
│ PK: LOG#{repo}#{executionId}#{taskName}                            │
│ SK: {stream}#{timestamp}#{seq}                                     │
│ Attributes:                                                         │
│   - data: string (log chunk content)                                │
│   - timestamp: number (ms since epoch)                              │
│   - ttl: number (DynamoDB TTL for auto-cleanup)                     │
├─────────────────────────────────────────────────────────────────────┤
│ LOG INDEX (for cleanup - tracks which log partitions exist)         │
│ PK: REPO#{repo}                                                    │
│ SK: LOGIDX#{executionId}#{taskName}                                │
│ Attributes:                                                         │
│   - createdAt: timestamp                                            │
│   - ttl: number (same as log chunks)                                │
└─────────────────────────────────────────────────────────────────────┘
```

**Log Index purpose:**
- Track which log partitions exist for an execution
- Enable cleanup when execution/repo is deleted (can't query across partition keys)
- Auto-expires with same TTL as log chunks

### Interface Changes

**Current LogStore interface (e3-core):**
```typescript
interface LogStore {
  append(repo: string, taskHash: string, inputsHash: string,
         stream: 'stdout' | 'stderr', data: string): Promise<void>;
  read(repo: string, taskHash: string, inputsHash: string,
       stream: 'stdout' | 'stderr', options?: LogReadOptions): Promise<LogChunk>;
}
```

**New LogStore interface:**
```typescript
interface LogStore {
  // Append requires executionId and taskName for partition routing
  append(repo: string, executionId: string, taskName: string,
         stream: 'stdout' | 'stderr', data: string): Promise<void>;

  // Read by execution context (primary use case)
  read(repo: string, executionId: string, taskName: string,
       stream: 'stdout' | 'stderr', options?: LogReadOptions): Promise<LogChunk>;

  // Legacy read by hash (for cached task log lookup)
  readByHash(repo: string, taskHash: string, inputsHash: string,
             stream: 'stdout' | 'stderr', options?: LogReadOptions): Promise<LogChunk>;

  // Cleanup all logs for an execution
  deleteExecution(repo: string, executionId: string): Promise<void>;
}
```

### Concurrency Considerations

**Write concurrency (multiple tasks writing simultaneously):**
- Different tasks → different partition keys → no contention
- Same task, different streams (stdout/stderr) → same partition, different SK prefix → no contention
- Same task, same stream → timestamp + sequence ensures ordering

**Sequence number generation:**
- Current: In-memory counter per Lambda instance (can have gaps across instances)
- New: Keep same approach - gaps are acceptable, ordering within instance is preserved
- Alternative: Use DynamoDB atomic counter (adds latency, probably not worth it)

**Read-your-writes for log tailing:**
- DynamoDB eventually consistent reads are typically <100ms
- For real-time tailing, use consistent reads (slightly higher latency/cost)
- Current behavior is acceptable for most use cases

**Cleanup race conditions:**
- Log writes may arrive after execution marked complete
- TTL handles this - stale log chunks auto-delete after 7 days
- Explicit cleanup can skip in-progress writes (they'll TTL out)

### Migration Strategy

**Phase 1: Add new interface, keep old working**
1. Add `executionId` and `taskName` to LogStore interface (optional params initially)
2. Update DynamoLogStore to write to new PK pattern when params provided
3. Update task execution to pass execution context to log writes
4. Old logs continue working with legacy read path

**Phase 2: Migrate reads**
1. Update log read APIs to use execution context when available
2. Fall back to hash-based lookup for cached task logs
3. Add log index writes for cleanup tracking

**Phase 3: Cleanup and deprecation**
1. Remove legacy PK pattern from new writes
2. Keep legacy read support for old logs (they'll TTL out)
3. Update GC to clean up log indexes

### Code Changes Required

| File | Change |
|------|--------|
| `e3-core/src/storage/interfaces.ts` | Update LogStore interface |
| `e3-core/src/storage/local/LocalLogStore.ts` | Update local implementation |
| `e3-core/src/executions.ts` | Pass executionId/taskName to log writes |
| `e3-aws/packages/storage/src/dynamo-log-store.ts` | New PK pattern, log index |
| `e3-aws/packages/runner/src/handlers/execute-task.ts` | Pass execution context |
| `e3-aws/packages/api/src/index.ts` | Update log read endpoints |

### Deliverables

- [ ] Update LogStore interface with execution context parameters
- [ ] Update DynamoLogStore with new partition key pattern
- [ ] Add log index writes for cleanup tracking
- [ ] Update task execution to pass execution context
- [ ] Update log read API to use execution context
- [ ] Add `deleteExecution` for explicit log cleanup
- [ ] Update GC to clean up orphaned log indexes
- [ ] Migration support for legacy logs (read fallback)
- [ ] Integration tests for new log patterns

---

## Future: Scatter-Gather Patterns

**Goal:** Support parallel processing of array datasets with automatic fan-out and fan-in.

### Pachyderm-like Pattern

East dataflows can express array processing with type-aware glob patterns:

```
input[*] → task → output[*]
```

**Semantics:**
- `dataset[*]` expands to N parallel tasks (one per array element)
- Each task receives a single element as input
- Outputs are gathered into the result array

**Example:**

```typescript
// East package definition
const processImages = task({
  inputs: { image: ImageType },
  outputs: { thumbnail: ThumbnailType },
  runner: 'east-py',
  fn: async ({ image }) => ({ thumbnail: resize(image, 100, 100) }),
});

const workspace = {
  images: ArrayType(ImageType),     // Input: 1000 images
  thumbnails: ArrayType(ThumbnailType), // Output: 1000 thumbnails

  dataflow: {
    'thumbnails[*]': processImages({ image: 'images[*]' }),
  },
};
```

**Execution:**
1. Dataflow executor detects `[*]` pattern
2. Expands to 1000 parallel tasks
3. Each task processes one image
4. Results gathered into `thumbnails` array

### Implementation Considerations

**Static vs Dynamic expansion:**
- **Static:** Expand at dataflow build time (requires knowing array size)
- **Dynamic:** Expand at execution time (more flexible, but complex state)

**State management:**
- Track individual element tasks in DynamoDB
- Completion = all elements completed
- Partial results available as elements complete

**Chunking for efficiency:**
- For very large arrays, chunk into batches
- Single task processes N elements instead of 1
- Reduces orchestration overhead

### Deliverables (Future)

- [ ] `[*]` pattern support in dataflow graph builder
- [ ] Scatter state machine pattern (fan-out)
- [ ] Gather state machine pattern (fan-in)
- [ ] Chunking configuration
- [ ] Progress tracking for partial completion

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
| 1 | e3-core abstractions | StorageBackend interface with repo parameter, LocalStorage |
| 2 | e3-api-server refactoring | Shared handlers/routes, multi-repo mode, JWT auth, CLI remote |
| 3 | S3DynamoStorage | Cloud storage implementation, CDK updates |
| 4 | MVP | Frontend, Step Functions dataflow execution, dataflow-centric API |
| 5 | Production runners | ECS Service warm pool for Fargate, <1s latency |
| 6 | White-labelling | Custom apps, theming |
| Future | Scatter-gather | Parallel array processing with fan-out/fan-in |

**Architecture:**

```
┌─────────────────────────────────────────────────────────────────────┐
│                         e3-core functions                            │
│  workspaceList(storage, repo) → getDataset(storage, repo, ...)  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────┴──────────────────────────────────────┐
│                    Shared route handlers                             │
│  createRoutes(storage) - identical code for local server & Lambda   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
         ┌─────────────────────┴─────────────────────┐
         │                                           │
┌────────▼────────┐                     ┌────────────▼────────────┐
│ e3-api-server   │                     │ e3-aws Lambda           │
│                 │                     │                         │
│ LocalStorage()  │                     │ S3DynamoStorage(        │
│ repo = path   │                     │   s3, dynamo,           │
│                 │                     │   bucket, table         │
│                 │                     │ )                       │
│ • Multi-repo    │                     │ repo from URL         │
│ • JWT auth      │                     │                         │
└─────────────────┘                     └─────────────────────────┘

**Cloud execution architecture (Lambda-based):**

┌──────────────────────────────────────────────────────────────────────┐
│  API Gateway                                                          │
│    │                                                                  │
│    ├── /api/* ────────────────────────> Lambda (API handlers)         │
│    │                                        │                         │
│    │                            POST /execute                         │
│    │                                        │                         │
│    │                                        ▼                         │
│    │                              ┌─────────────────┐                  │
│    │                              │ Step Functions  │                  │
│    │                              │ (Dataflow SM)   │                  │
│    │                              └────────┬────────┘                  │
│    │                                       │                          │
│    │                              GetGraph │ GetReady                  │
│    │                              Dispatch │ WriteResults              │
│    │                                       │                          │
│    │                                       ▼                          │
│    │                              ┌───────────────────────────────┐   │
│    │                              │  ExecuteTask Lambda           │   │
│    │                              │  (Container: ghcr.io/elaraai/e3) │
│    │                              │  - Download inputs from S3    │   │
│    │                              │  - Run east-py CLI            │   │
│    │                              │  - Upload output to S3        │   │
│    │                              │  - Return outputHash          │   │
│    │                              │  (15min timeout, 10GB memory) │   │
│    │                              └───────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

**Key insight:** Storage backends are initialized once (at server/Lambda startup).
The `repo` flows from CLI args or URL params through handlers to storage methods.
This enables maximum code sharing between local server and Lambda.

**Dependencies:**
- Phase 1 must complete first (e3-core storage abstraction is foundational)
- Phase 2 depends on Phase 1 (handlers call e3-core functions that use StorageBackend)
- Phase 2 JWT auth and CLI login can start early (no storage dependency)
- Phase 3 depends on Phase 1 (implements StorageBackend interface)
- Phase 4 depends on Phase 2 + 3
- Phase 5 depends on Phase 4
- Phase 6 depends on Phase 4

**Note:** `cloud-options.md` should also be updated to reflect the S3/DynamoDB architecture (currently still references EFS).
