# @elaraai/e3-api-server

HTTP server for e3 repositories.

## Installation

```bash
npm install @elaraai/e3-api-server
```

## Overview

REST API server exposing e3-core operations over HTTP. Uses BEAST2 binary serialization for efficient request/response encoding.

Supports two modes:
- **Single-repo mode**: Serve one repository, accessed via `/repos/default`
- **Multi-repo mode**: Serve multiple repositories from a directory, accessed via `/repos/:name`

## CLI Usage

```bash
# Single repository mode
e3-api-server --repo /path/to/repo
e3-api-server --repo /path/to/repo --port 8080 --cors

# Multi-repository mode (serves repos from subdirectories)
e3-api-server --repos /path/to/repos-dir

# With OIDC authentication
e3-api-server --repo /path/to/repo --oidc

# Custom port and host
e3-api-server --repo /path/to/repo --port 8080 --host 0.0.0.0
```

### CLI Options

| Option | Description |
|--------|-------------|
| `--repo <path>` | Single repository mode - serve one repo at `/repos/default` |
| `--repos <dir>` | Multi-repo mode - serve repos from subdirectories |
| `-p, --port <port>` | HTTP port (default: 3000) |
| `-H, --host <host>` | Bind address (default: localhost) |
| `--cors` | Enable CORS for cross-origin requests |
| `--oidc` | Enable built-in OIDC authentication provider |
| `--token-expiry <duration>` | Access token expiry, e.g., "5s", "15m", "1h" (default: 1h) |
| `--refresh-token-expiry <duration>` | Refresh token expiry, e.g., "7d", "90d" (default: 90d) |
| `-j, --jobs <n>` | Cores: runner processes in flight at once, across every run and call the server serves (default: `E3_JOBS`, else the CPUs available) |
| `--memory <size>` | Memory those runner processes may reserve between them, as `8G` or `512M` (default: `E3_MEMORY`, else the memory available, less a reserve for e3 and the OS) |

## Programmatic Usage

### Single Repository (Embedded Server)

For embedding in applications like VS Code extensions:

```typescript
import { createServer } from '@elaraai/e3-api-server';

// createServer is async
const server = await createServer({
  singleRepoPath: '/path/to/repo',
  port: 3000,
  host: 'localhost',
  cors: true,  // Enable for webview/cross-origin access
});

await server.start();
console.log(`Server listening on http://localhost:${server.port}`);
console.log('Access repository via: /repos/default');

// Graceful shutdown
await server.stop();
```

### Multi-Repository Mode

For serving multiple repositories:

```typescript
import { createServer } from '@elaraai/e3-api-server';

const server = await createServer({
  reposDir: '/path/to/repos',  // Each subdirectory is a repo
  port: 3000,
  host: 'localhost',
});

await server.start();
// Repos accessible at /repos/repo1, /repos/repo2, etc.
```

### With Authentication

```typescript
import { createServer } from '@elaraai/e3-api-server';

const server = await createServer({
  singleRepoPath: '/path/to/repo',
  port: 3000,
  oidc: {
    baseUrl: 'http://localhost:3000',
    tokenExpiry: '1h',
    refreshTokenExpiry: '90d',
  },
});

await server.start();
// OIDC endpoints available at /.well-known/*, /oauth2/*, /device
```

### ServerConfig Options

```typescript
interface ServerConfig {
  // Repository mode (specify exactly one)
  singleRepoPath?: string;  // Single repo at /repos/default
  reposDir?: string;        // Multi-repo from subdirectories

  // Server options
  port?: number;            // Default: 3000
  host?: string;            // Default: 'localhost'
  cors?: boolean;           // Enable CORS (default: false)

  // Authentication (optional)
  auth?: AuthConfig;        // External JWT validation
  oidc?: OidcConfig;        // Built-in OIDC provider

  // Dataset reads and uploads (optional)
  pageByteBudget?: number;        // Byte budget per dataset page (default: 4 MiB)
  transferPartBytes?: number;     // Part size for dataset uploads (default: 64 MiB)
  transferCommitWaitMs?: number;  // How long a commit waits before answering `processing` (default: 5000)

  // Runner processes (optional)
  budget?: Budget | BudgetSettings;  // Cores and memory every runner the server spawns shares (default: from E3_JOBS / E3_MEMORY, else the machine)
}
```

## API Endpoints

All endpoints are prefixed with `/api/repos/:repo` where `:repo` is:
- `default` in single-repo mode
- The repository name in multi-repo mode

### Repository

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/repos` | List available repositories (multi-repo mode) |
| PUT | `/api/repos/:repo` | Create repository (multi-repo mode) |
| DELETE | `/api/repos/:repo` | Delete repository (multi-repo mode, async) |
| GET | `/api/repos/:repo/status` | Repository status (counts) |
| POST | `/api/repos/:repo/gc` | Start garbage collection (async) |
| GET | `/api/repos/:repo/gc/:id` | Get GC status |

### Packages

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/repos/:repo/packages` | List all packages |
| GET | `/api/repos/:repo/packages/:name/:version` | Get package details |
| POST | `/api/repos/:repo/packages` | Import package (zip body) |
| GET | `/api/repos/:repo/packages/:name/:version/export` | Export package as zip |
| DELETE | `/api/repos/:repo/packages/:name/:version` | Remove package |

### Workspaces

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/repos/:repo/workspaces` | List all workspaces |
| POST | `/api/repos/:repo/workspaces` | Create workspace |
| GET | `/api/repos/:repo/workspaces/:ws` | Get workspace info |
| GET | `/api/repos/:repo/workspaces/:ws/status` | Get workspace status (datasets, tasks, summary) |
| POST | `/api/repos/:repo/workspaces/:ws/deploy` | Start deploying a package to the workspace, as a job: answers the job's id |
| GET | `/api/repos/:repo/workspaces/:ws/deploy/:id` | Poll a deploy job: `processing`, what the deploy did for each record and index, or why it failed |
| DELETE | `/api/repos/:repo/workspaces/:ws` | Remove workspace |
| GET | `/api/repos/:repo/workspaces/:ws/export` | Export workspace as package zip |

A deploy that migrates a record, or builds an index over one, takes as long as
the record is large, so it runs as a job, on the runner the server runs every
record operation on. Its request names the package, what the deploy does with a
record it cannot keep as it is (`schema`: `migrate`, `fail` or `reset`),
whether it may drop a record the package no longer declares
(`allowDropRecords`), and whether it only says what it would do (`plan`).

### Datasets

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/repos/:repo/workspaces/:ws/datasets` | List root datasets |
| GET | `/api/repos/:repo/workspaces/:ws/datasets/*path` | Get dataset value (BEAST2); a value over 1 MB that is not a collection answers JSON `{ url }` to download it from |
| GET | `/api/repos/:repo/workspaces/:ws/datasets/*path?segments=true` | A collection answers JSON `{ manifest }`, the manifest to download it by; any other value as above |
| PUT | `/api/repos/:repo/workspaces/:ws/datasets/*path` | Set dataset value (BEAST2) |

A collection is streamed as the splice of its segments. A client whose host
buffers responses downloads the manifest, the header it names and its segments
through the objects route and splices them itself, as e3-api-client's
`datasetGet` does; see
[`design/e3-api.md`](https://github.com/elaraai/east-workspace/blob/main/libs/e3/design/e3-api.md#dataset-download).

### Objects

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/repos/:repo/objects/:hash` | An object's bytes; one over 1 MB answers JSON `{ url }` to download it from |
| GET | `/api/downloads/:id` | A download a `{ url }` answer names (no `Authorization`) |

### Dataset transfer

Values too large to `PUT` inline are staged in parts and committed. The init
and the commit name the protocol version with `?protocol=2`, and a request of
another version, or none, is refused, naming the fix. The full protocol is in
[`design/e3-api.md`](https://github.com/elaraai/east-workspace/blob/main/libs/e3/design/e3-api.md#dataset-transfer).

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/repos/:repo/workspaces/:ws/datasets/*path/upload` | Start an upload: `completed` (already stored) or `upload_parts` |
| GET | `/api/repos/:repo/workspaces/:ws/datasets/*path/upload/:id/parts/:n` | URL and headers for part `n` |
| POST | `/api/repos/:repo/workspaces/:ws/datasets/*path/upload/:id` | Commit: `completed`, `error`, or `processing` |
| GET | `/api/repos/:repo/workspaces/:ws/datasets/*path/upload/:id` | Poll a commit |
| PUT | `/api/uploads/:id` | A package zip being imported (no `Authorization`) |
| PUT | `/api/uploads/:id/parts/:n` | Part `n` of a dataset upload (no `Authorization`) |

### Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/repos/:repo/workspaces/:ws/tasks` | List tasks |
| GET | `/api/repos/:repo/workspaces/:ws/tasks/:task` | Get task details |

### Execution

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/repos/:repo/workspaces/:ws/dataflow/start` | Start dataflow (async, returns immediately) |
| POST | `/api/repos/:repo/workspaces/:ws/dataflow/execute` | Execute dataflow (blocking, returns result) |
| GET | `/api/repos/:repo/workspaces/:ws/dataflow/graph` | Get dependency graph |
| GET | `/api/repos/:repo/workspaces/:ws/dataflow/logs/:task` | Read task logs |
| GET | `/api/repos/:repo/workspaces/:ws/dataflow/state` | Get current execution state |

## Request/Response Format

All requests and responses use BEAST2 binary encoding with `Content-Type: application/beast2`.

Response bodies are wrapped in a variant type:
- `{ type: 'success', value: <result> }` - Operation succeeded
- `{ type: 'error', value: <error> }` - Operation failed

Error variants include:
- `workspace_not_found` - Workspace doesn't exist
- `workspace_not_deployed` - No package deployed to workspace
- `workspace_locked` - Workspace is locked by another process
- `package_not_found` - Package doesn't exist
- `package_exists` - Package already exists
- `dataset_not_found` - Dataset path doesn't exist
- `task_not_found` - Task doesn't exist
- `internal` - Internal server error

## Using with e3-api-client

```typescript
import { workspaceList, workspaceStatus, datasetGet } from '@elaraai/e3-api-client';

const baseUrl = 'http://localhost:3000';
const repo = 'default';  // In single-repo mode
const options = { token: '' };  // Empty token if no auth configured

// List workspaces
const workspaces = await workspaceList(baseUrl, repo, options);

// Get workspace status
const status = await workspaceStatus(baseUrl, repo, 'my-workspace', options);

// Get dataset value
const path = [{ value: 'inputs' }, { value: 'data' }];
const data = await datasetGet(baseUrl, repo, 'my-workspace', path, options);
```

## Claude Code plugin

The East ecosystem also ships a [Claude Code](https://claude.com/claude-code) plugin — East language skills, example search, and preemptive diagnostics for East code — installed separately from the `elaraai` marketplace:

```text
# Inside Claude Code
/plugin marketplace add elaraai/east-workspace
/plugin install east@elaraai
```

```bash
# From a terminal
claude plugin marketplace add elaraai/east-workspace
claude plugin install east@elaraai
```

## License

BSL 1.1. See [LICENSE.md](./LICENSE.md).

### Ecosystem

- **[East](https://github.com/elaraai/east-workspace/tree/main/libs/east)**: Statically typed, expression-based language with serializable IR. Run portable logic across TypeScript, Python, C, and other runtimes.
  - [@elaraai/east](https://www.npmjs.com/package/@elaraai/east): Core language SDK with type system, expressions, and reference JS compiler

- **[East Node](https://github.com/elaraai/east-workspace/tree/main/libs/east-node)**: Node.js platform functions for I/O, databases, and system operations.
  - [@elaraai/east-node-std](https://www.npmjs.com/package/@elaraai/east-node-std): Console, FileSystem, Fetch, Crypto, Time, Path, Random
  - [@elaraai/east-node-io](https://www.npmjs.com/package/@elaraai/east-node-io): SQLite, PostgreSQL, MySQL, MongoDB, Redis, S3, FTP, SFTP, XLSX, XML, compression
  - [@elaraai/east-node-cli](https://www.npmjs.com/package/@elaraai/east-node-cli): CLI for running East IR programs in Node.js

- **[East C](https://github.com/elaraai/east-workspace/tree/main/libs/east-c)**: C11 native runtime for executing East IR. Distributed via npm (launcher + per-platform optional dependencies) and as tarballs on each GitHub Release.
  - [@elaraai/east-c-cli](https://www.npmjs.com/package/@elaraai/east-c-cli): npm launcher — installs the matching native binary as an optional dependency
  - `east-c`: Core runtime — type system, IR interpreter, builtins, serialization (Beast2, JSON, CSV, East text)
  - `east-c-std`: Console, FileSystem, Fetch, Crypto, Time, Path, Random
  - `east-c-cli`: CLI for running East IR programs natively

- **[East Python](https://github.com/elaraai/east-workspace/tree/main/libs/east-py)**: Python runtime, standard platform, I/O, and data-science platform functions. Published to PyPI.
  - [east-py](https://pypi.org/project/east-py/): Core Python runtime — type system, IR compiler, 212+ builtins, Cython-accelerated hot paths
  - [east-py-std](https://pypi.org/project/east-py-std/): Console, FileSystem, Fetch, Crypto, Time, Path, Random
  - [east-py-io](https://pypi.org/project/east-py-io/): SQLite, PostgreSQL, MySQL, MongoDB, Redis, S3, FTP, SFTP, XLSX, XML, compression
  - [east-py-cli](https://pypi.org/project/east-py-cli/): CLI for running East IR programs in Python
  - [east-py-datascience](https://pypi.org/project/east-py-datascience/) (PyPI) + [@elaraai/east-py-datascience](https://www.npmjs.com/package/@elaraai/east-py-datascience) (npm): Optimization (MADS, Optuna, ALNS, GoogleOR), ML (XGBoost, LightGBM, NGBoost, PyTorch, Lightning, GP), Bayesian inference (PyMC), explainability (SHAP), conformal prediction (MAPIE)

- **[East UI](https://github.com/elaraai/east-workspace/tree/main/libs/east-ui)**: Typed UI component definitions and React renderer, plus VS Code preview.
  - [@elaraai/east-ui](https://www.npmjs.com/package/@elaraai/east-ui): 50+ typed UI components for layouts, forms, charts, tables, dialogs
  - [@elaraai/east-ui-components](https://www.npmjs.com/package/@elaraai/east-ui-components): React renderer with Chakra UI v3 styling
  - [@elaraai/e3-ui](https://www.npmjs.com/package/@elaraai/e3-ui): e3 + UI bridge — Data bindings, `e3.ui()` task, manifest
  - [@elaraai/e3-ui-components](https://www.npmjs.com/package/@elaraai/e3-ui-components): React Query hooks and preview components for the e3 API
  - [east-ui-preview](https://marketplace.visualstudio.com/items?itemName=ElaraAI.east-ui-preview): VS Code extension for live East UI component preview

- **[e3 — East Execution Engine](https://github.com/elaraai/east-workspace/tree/main/libs/e3)**: Durable execution engine for running East pipelines at scale. Git-like content-addressable storage, automatic memoization, reactive dataflow, real-time monitoring.
  - [@elaraai/e3](https://www.npmjs.com/package/@elaraai/e3): SDK for authoring e3 packages with typed tasks and pipelines
  - [@elaraai/e3-core](https://www.npmjs.com/package/@elaraai/e3-core): Object store, dataflow orchestrator, execution state
  - [@elaraai/e3-types](https://www.npmjs.com/package/@elaraai/e3-types): Shared type definitions for e3 packages
  - [@elaraai/e3-cli](https://www.npmjs.com/package/@elaraai/e3-cli): `e3 repo`, `e3 package`, `e3 workspace`, `e3 start`, `e3 watch`, `e3 logs` commands
  - [@elaraai/e3-api-client](https://www.npmjs.com/package/@elaraai/e3-api-client): HTTP client for remote e3 repositories
  - [@elaraai/e3-api-server](https://www.npmjs.com/package/@elaraai/e3-api-server): REST API server for e3 repositories
  - [@elaraai/e3-api-tests](https://www.npmjs.com/package/@elaraai/e3-api-tests): Shared API compliance test suites

## Links

- [East Language](https://github.com/elaraai/east-workspace/tree/main/libs/east)
- [East Python Runtime](https://github.com/elaraai/east-workspace/tree/main/libs/east-py)
- [Elara AI](https://elaraai.com/)
- [Issues](https://github.com/elaraai/east-workspace/issues)
- support@elara.ai

## About Elara

East is developed by [Elara AI Pty Ltd](https://elaraai.com/), an AI-powered platform that creates economic digital twins of businesses that optimize performance. Elara combines business objectives, decisions and data to help organizations make data-driven decisions across operations, purchasing, sales and customer engagement, and project and investment planning. East powers the computational layer of Elara solutions, enabling the expression of complex business logic and data in a simple, type-safe and portable language.

---

*Developed by [Elara AI Pty Ltd](https://elaraai.com/).*

---

*Developed by [Elara AI Pty Ltd](https://elaraai.com/)*
