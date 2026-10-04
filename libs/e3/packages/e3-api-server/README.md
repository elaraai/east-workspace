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

The server opens a repository before it serves it, as the CLI does: the one
repository when it starts, and each of several at its first request. A
repository an older release wrote is upgraded in place first, and one this e3
cannot open is refused, naming why and the fix. An upgrade waits for work
running in the repository, and no request waits with it: while a run or a task
holds a repository that owes one, a request to it is answered `503` with
`Retry-After` and the JSON error `{ error: { type:
'repository_upgrade_pending', message } }`, naming the steps and the work —
except that run's cancel and poll, so the run can always be stopped. The steps
apply at the first request that finds the repository still.

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
| `-j, --jobs <n>` | Cores: runner processes in flight at once, across every run and call the server serves and every upload it takes in (default: `E3_JOBS`, else the CPUs available) |
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

### Mounting the routes on another host

The route factories are exported, so a host that runs e3 on its own backends
mounts them over its own seams. The repositories' routes list, create and
remove repositories through the storage backend's `RepoStore`, and the
repository gate, mounted ahead of every repository's routes, checks that the
repository exists and is not being removed, and opens it without holding the
request. The dataflow routes take the runner, the orchestrator that runs a
repository's dataflows, and the state store it writes: a start leaves nothing
of the run in the request's host, and a poll and a cancel read the latest run
from that store, whichever instance answers them. The dataset transfer routes
(`createTransferRoutes`) take the transfer backend, whose upload store takes a
delivery in on the runner it was given: an init adopts only what takes nothing
in, and answers at once. A poll reads the latest run's summary from the store
(`readLatestSummary`), and its events only past the poll's cursor, so a store
whose reads cost by the byte answers a caught-up poll cheaply; the waits and
split progress it serves are the orchestrator's (`getProgress`), which has none
of a run another instance runs. A route answers for the repository in its URL
alone: a job, an upload or a run another repository started is not found
through it.

```typescript
import { Hono } from 'hono';
import { createExecutionRoutes, createRepositoriesRoutes, createRepositoryGate } from '@elaraai/e3-api-server';

const app = new Hono();
app.use('/api/repos/:repo/*', createRepositoryGate(storage, getRepoPath));
app.route('/api/repos', createRepositoriesRoutes(storage));
app.route('/api/repos/:repo/workspaces/:ws/dataflow', createExecutionRoutes(storage, getRepoPath, {
  getRunner: (repo) => runnerFor(repo),
  getOrchestrator: (repo) => orchestratorFor(repo),
  getStateStore: (repo) => stateStoreFor(repo),
}));
```

A host whose requests have a time limit, which an upgrade step may outlast,
leaves the steps to a job of its own. Given `applyUpgrades: false`, the gate
applies none: it answers every request to a repository that owes them `503`
`repository_upgrade_pending` — but a running dataflow's cancel and poll — until
the steps are applied, and calls `onUpgradePending` for each, where the host
starts its job, once. The job applies them with e3-core's
`repositoryUpgradeStep`, a part at a time, each running for the budget it is
given, until none is owed. A part takes the step up where the last one stopped,
whichever process ran it, and waits for work running in the repository as an
open does. No route applies a step itself: the record route (`getRecord`) only
reads, and refuses a repository that owes one as the gate does, gate or no.

```typescript
app.use('/api/repos/:repo/*', createRepositoryGate(storage, getRepoPath, {
  applyUpgrades: false,
  // Each run of the job applies a part, under its time limit, and the job
  // runs again while any step is owed:
  // repositoryUpgradeStep(storage, getRepoPath(repo), { budgetMs: 10 * 60_000 })
  onUpgradePending: (repo) => startUpgradeJob(repo),
}));
```

A host's own routes answer their errors as these do, with the mapping every
route uses, so no host keeps a copy of it that falls behind as it grows:

- `errorToVariant` gives an e3-core error as the API's `ErrorType`, which
  `sendError` answers in BEAST2;
- `errorToHttpStatus` and `sendJsonError` answer it as JSON, as the gate
  answers its refusals;
- `sendUpgradePending` answers a repository that owes upgrades as the gate
  does.

A host's own routes over records answer as the record and dataset routes do:

- `mutationResultOf` gives the outcome of a record operation as the
  `MutationResultType` value the mutation and compact routes answer with,
  such as a rollback's through e3-core's `recordSystemCommit`;
- `getValuePage` answers a window of a collection the host names by hash,
  such as a record's state at a past commit, with the body, the `X-*` headers
  and the refusals of a dataset's page (`getDatasetPage`).

Each is exported from the root and the portable entries, and each handler from
`./handlers` too. e3-api-client reads what they answer: `parsePage` a page,
`parseErrorBody` a JSON refusal, and `objectGet` and `collectionGetStream` a
value by its hash.

A host whose requests have a time limit gives it to the routes that run a
program for a request, so that each answers its typed outcome before the host
cuts it off: the function and one-shot routes take `syncDeadlineMs`, and so do
the record routes, whose mutation and compaction answer `timed_out` or
`conflict` 2 s under it. The record routes' `historyLimit` is how many commits
a history request that names no `limit` is answered with; the client pages on
from the last one's parent. Unset, as on this server, neither is bounded. A
limit no request could meet is refused when the routes are mounted.

```typescript
app.route('/api/repos/:repo/workspaces/:ws/records', createWorkspaceRecordRoutes(storage, getRepoPath, getRunner, {
  syncDeadlineMs: 29_000,  // under a 30 s gateway
  historyLimit: 1_000,
}));
```

A dataset page or key search pinned to the value's hash (`hash=`) never
changes, so it is answered `Cache-Control: private, max-age=31536000,
immutable`: the caller's own cache keeps it for good, and no cache between
keeps a workspace's rows for whoever asks next. A host whose data any caller may
read lets those caches keep it too, a CDN's among them, with the dataset
routes' `cache: 'public'`; `getDatasetPage`, `getValuePage` and
`findDatasetKey` take the same. An answer not pinned is `no-store`.

```typescript
app.route('/api/repos/:repo/workspaces/:ws/datasets', createDatasetRoutes(storage, getRepoPath, transferBackend, {
  cache: 'public',  // every caller may read every workspace this host serves
}));
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
| DELETE | `/api/repos/:repo` | Remove repository (multi-repo mode): marked as being removed first, so a request to it is refused from then on |
| GET | `/api/repos/:repo/status` | Repository status (counts) |
| GET | `/api/repos/:repo/record` | The repository's record: the release that last wrote it, and the upgrades it has had. A read, which applies none it owes: without the gate ahead of it, a repository that owes one is refused as the gate refuses it, 503 `repository_upgrade_pending` with `Retry-After` |
| POST | `/api/repos/:repo/gc` | Start garbage collection (async) |
| GET | `/api/repos/:repo/gc/:id` | Get GC status |

### Packages

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/repos/:repo/packages` | List all packages |
| GET | `/api/repos/:repo/packages/:name/:version` | Get package details |
| POST | `/api/repos/:repo/import` | Start importing a package zip, as a job: answers the job's id and where to upload the zip |
| POST | `/api/repos/:repo/import/:id` | Import the uploaded zip |
| GET | `/api/repos/:repo/import/:id` | Poll an import job |
| POST | `/api/repos/:repo/packages/:name/:version/export` | Start exporting a package as a zip, as a job: answers the job's id |
| GET | `/api/repos/:repo/export/:id` | Poll an export job: once it completes, where to download the zip |
| DELETE | `/api/repos/:repo/packages/:name/:version` | Remove package |

### Workspaces

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/repos/:repo/workspaces` | List all workspaces |
| POST | `/api/repos/:repo/workspaces` | Create workspace |
| GET | `/api/repos/:repo/workspaces/:ws` | Get workspace info |
| GET | `/api/repos/:repo/workspaces/:ws/status` | Get workspace status (datasets, tasks, summary). With `?path=` (repeated, each a dataset's keypath, `.inputs.x`), only those datasets and the tasks producing them, each as the whole status gives it: a path that names no dataset is left out, and one that is no keypath is refused 400 `bad_request` |
| POST | `/api/repos/:repo/workspaces/:ws/deploy` | Start deploying a package to the workspace, as a job: answers the job's id |
| GET | `/api/repos/:repo/workspaces/:ws/deploy/:id` | Poll a deploy job: `processing` with how far it has got, what the deploy did for each record and index, or why it failed |
| GET | `/api/repos/:repo/workspaces/:ws/lock` | What holds the workspace exclusively, and how far it says it has got; none when nothing does |
| DELETE | `/api/repos/:repo/workspaces/:ws` | Remove workspace |
| POST | `/api/repos/:repo/workspaces/:ws/export` | Start exporting the workspace as a package zip, as a job polled at `/api/repos/:repo/export/:id` |

A deploy that migrates a record, or builds an index over one, takes as long as
the record is large, so it runs as a job, on the runner the server runs every
record operation on. Its request names the package, what the deploy does with a
record it cannot keep as it is (`schema`: `migrate`, `fail` or `reset`),
whether it may drop a record the package no longer declares
(`allowDropRecords`), and whether it only says what it would do (`plan`).

While it runs, the job's `processing` says how far it has got: each file
source's step, and each record's (waiting, migrating step n of m, building
index n of m, done). The deploy reports the same through the workspace's lock,
which `/lock` answers. A workspace deployed for the first time has no status
until its deploy ends, so `/lock` is where another client, such as e3-ui's TUI,
follows that deploy.

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
[`design/e3-data-architecture.md`](https://github.com/elaraai/east-workspace/blob/main/libs/e3/design/e3-data-architecture.md#dataset-download).

### Objects

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/repos/:repo/objects/:hash` | An object's bytes; one over 1 MB answers JSON `{ url }` to download it from; a hash that is no SHA-256 in lowercase hex is refused 400 `invalid_name` |
| GET | `/api/downloads/:id` | A download a `{ url }` answer names (no `Authorization`) |

### Dataset transfer

Values too large to `PUT` inline are staged in parts and committed. The init
and the commit name the protocol version with `?protocol=3`, and the client's
release with `&release=`, which decides nothing. A request of another version,
or none, is refused, naming the server's release, the request's, and the fix.
The full protocol is in
[`design/e3-data-architecture.md`](https://github.com/elaraai/east-workspace/blob/main/libs/e3/design/e3-data-architecture.md#dataset-transfer).

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/repos/:repo/workspaces/:ws/datasets/*path/upload` | Start an upload: `completed` (already stored) or `upload_parts` |
| GET | `/api/repos/:repo/workspaces/:ws/datasets/*path/upload/:id/parts/:n` | URL and headers for part `n` |
| POST | `/api/repos/:repo/workspaces/:ws/datasets/*path/upload/:id` | Commit: `completed`, `error`, or `processing`, with how far it has taken the file in once the store has said |
| GET | `/api/repos/:repo/workspaces/:ws/datasets/*path/upload/:id` | Poll a commit |
| PUT | `/api/uploads/:id` | A package zip being imported (no `Authorization`) |
| PUT | `/api/uploads/:id/parts/:n` | Part `n` of a dataset upload (no `Authorization`) |

A commit takes a collection in by intake units on the repository's runner — a
piece of its segments each, as many at once as the server's budget allows — and
its `processing` says how many pieces are in. An upload stopped part way and
sent again takes up from the pieces it finished.

An init whose bytes the store already knows answers `completed` when adopting
them takes nothing in: the manifest an earlier delivery of them became, or an
object of a value that is not a collection. A collection the store holds whole,
which no finished intake has taken in, is uploaded and committed as any other,
and its commit takes it in.

### Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/repos/:repo/workspaces/:ws/tasks` | List tasks |
| GET | `/api/repos/:repo/workspaces/:ws/tasks/:task` | Get task details |

### Functions and one-shot

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/repos/:repo/packages/:pkg/:version/functions` | A package's functions and their signatures |
| GET | `/api/repos/:repo/packages/:pkg/:version/functions/:fn` | One function's signature |
| POST | `/api/repos/:repo/packages/:pkg/:version/functions/:fn` | Call a package's function: its result, inline |
| GET | `/api/repos/:repo/workspaces/:ws/functions` | The deployed package's functions |
| GET | `/api/repos/:repo/workspaces/:ws/functions/:fn` | One function's signature |
| POST | `/api/repos/:repo/workspaces/:ws/functions/:fn` | Call one of them |
| POST | `/api/repos/:repo/workspaces/:ws/one-shot` | Run a caller's program over the workspace's datasets: its result, naming the datasets it read (`inputs`) |
| POST | `/api/repos/:repo/workspaces/:ws/one-shot/split` | Launch a split call — a caller's program over a dataset's pieces — as a job: answers the job's id; with `?explain=1` the job plans the pieces the call would run, and runs nothing |
| GET | `/api/repos/:repo/workspaces/:ws/one-shot/split/:id` | Poll a split call: how far it has got, its result, the pieces an explain planned, or why it failed |

What a caller may run through one-shot is the grant the host gives it
(`OneShotAccess`). This server's, with auth, gives an elevated role (`admin`,
`owner`) any program, and any other identity a platform-free one: a stock
runner given no platform, and a program that calls none. Without auth, a
single-tenant server, it gives any.

A call to a function runs it on the runner its author chose, for any caller.
A call that names a runner of its own is held to the same grant, which the
function routes take as `access`: a runner on the `custom` runtime is refused,
`invalid`, whoever names it, and one that loads a platform package the
function's own runner does not is refused `permission_denied` (path `runner`)
without the elevated grant. A host that mounts the function routes without
`access` refuses every caller such a runner.

A split call runs as a split task, so each
piece and merge is cached: a relaunch is served from the cache, and one after
an append reruns only the pieces the append reached. Its timeout is one budget
for the whole job, counted from its launch. A call is polled only through the
repository and workspace that launched it, and a caller with a platform-free
grant polls only a platform-free call, or one such a caller launched.

### Records

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/repos/:repo/workspaces/:ws/records/:rec` | The record's mutations and indexes, with their types |
| GET | `/api/repos/:repo/workspaces/:ws/records/:rec/history` | Its commits, newest first: `?limit=` of them from `?from=`, the head when absent; with no limit, the whole chain, or the host's page (`historyLimit`) |
| POST | `/api/repos/:repo/workspaces/:ws/records/:rec/mutations/:mut` | Apply a mutation: `committed`, `invalid`, `failed`, `timed_out` or `conflict`; with an `Idempotency-Key`, a retry answers the first call's commit |
| POST | `/api/repos/:repo/workspaces/:ws/records/:rec/compact` | Collapse the history to a `$compact` root, the state kept (an elevated role when auth is on) |

### Execution

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/repos/:repo/workspaces/:ws/dataflow` | Start a run of the dataflow (answers 202 once it has started) |
| GET | `/api/repos/:repo/workspaces/:ws/dataflow` | Get workspace status (for polling) |
| GET | `/api/repos/:repo/workspaces/:ws/dataflow/execution` | The latest run's state, its id (`runId`) and the sequence number of its last event (`lastSeq`), and its events past the poll's cursor (`since`, the `nextSeq` the poll before answered; at most `limit` of them, and never more than 1,000, the default: a `nextSeq` before `lastSeq` left some for the next poll), with the server's budget in use; while the run is in flight, the tasks and units waiting for room and each split task's progress, as the orchestrator running it answers them |
| GET | `/api/repos/:repo/workspaces/:ws/dataflow/budget` | The budget a run gets: the server's cores and memory, and what its runners hold now (`none` from a host whose runners hold none) |
| POST | `/api/repos/:repo/workspaces/:ws/dataflow/cancel` | Cancel the run in progress |
| GET | `/api/repos/:repo/workspaces/:ws/dataflow/graph` | Get dependency graph |
| GET | `/api/repos/:repo/workspaces/:ws/dataflow/logs/:task` | Read task logs |

## Request/Response Format

All requests and responses use BEAST2 binary encoding with `Content-Type: application/beast2`.

Response bodies are wrapped in a variant type:
- `{ type: 'success', value: <result> }` - Operation succeeded
- `{ type: 'error', value: <error> }` - Operation failed

Error variants include:
- `invalid_name` - A name, hash or id is not of its form: its kind (a workspace's name, an object's hash, a run's id, …), the value, and why, whichever backend the server runs over
- `workspace_not_found` - Workspace doesn't exist
- `workspace_not_deployed` - No package deployed to workspace
- `workspace_locked` - Workspace is locked by another process
- `package_not_found` - Package doesn't exist
- `package_exists` - Package already exists
- `dataset_not_found` - Dataset path doesn't exist
- `task_not_found` - Task doesn't exist
- `permission_denied` - The caller's grant does not run the request: a one-shot or split call (path `one-shot`), or a function call's runner (path `runner`)
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
  - [@elaraai/e3-cli](https://www.npmjs.com/package/@elaraai/e3-cli): `e3 repo`, `e3 package`, `e3 workspace`, `e3 dataflow run`, `e3 watch`, `e3 task logs` commands
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
