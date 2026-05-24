# @elaraai/e3-api-client

TypeScript client library for e3 API servers.

## Installation

```bash
npm install @elaraai/e3-api-client
```

## Overview

Stateless functions for interacting with an e3 API server. Uses BEAST2 binary serialization for efficient request/response encoding.

## API

### Repository

```typescript
import { repoStatus, repoGc } from '@elaraai/e3-api-client';

const status = await repoStatus('http://localhost:3000');
// { path: '/path/to/repo', objectCount: 42n, packageCount: 3n, workspaceCount: 2n }

const gcResult = await repoGc(url, { dryRun: true, minAge: variant('none', null) });
// { deletedObjects: 0n, retainedObjects: 42n, bytesFreed: 0n, ... }
```

### Packages

```typescript
import { packageList, packageImport, packageGet, packageExport, packageRemove } from '@elaraai/e3-api-client';

// List all packages
const packages = await packageList(url);
// [{ name: 'my-pkg', version: '1.0.0' }, ...]

// Import a package from zip bytes
const result = await packageImport(url, zipBytes);
// { name: 'my-pkg', version: '1.0.0', packageHash: 'abc123...', objectCount: 5n }

// Get package object
const pkg = await packageGet(url, 'my-pkg', '1.0.0');

// Export package as zip
const zip = await packageExport(url, 'my-pkg', '1.0.0');

// Remove package
await packageRemove(url, 'my-pkg', '1.0.0');
```

### Workspaces

```typescript
import { workspaceList, workspaceCreate, workspaceGet, workspaceStatus, workspaceDeploy, workspaceRemove } from '@elaraai/e3-api-client';

// Create workspace
const info = await workspaceCreate(url, 'production');
// { name: 'production', deployed: false, packageName: null, packageVersion: null }

// Deploy package to workspace
await workspaceDeploy(url, 'production', 'my-pkg@1.0.0');

// Get workspace status
const status = await workspaceStatus(url, 'production');
// { workspace: 'production', datasets: [...], tasks: [...], summary: { ... } }

// List workspaces
const workspaces = await workspaceList(url);
```

### Datasets

```typescript
import { datasetList, datasetListAt, datasetGet, datasetSet } from '@elaraai/e3-api-client';
import { encodeBeast2For, decodeBeast2For, StringType, variant } from '@elaraai/east';

// List root fields
const fields = await datasetList(url, 'production');
// ['inputs', 'tasks']

// List nested fields
const inputFields = await datasetListAt(url, 'production', [variant('field', 'inputs')]);
// ['config', 'data']

// Get dataset value (raw BEAST2 bytes)
const path = [variant('field', 'inputs'), variant('field', 'config')];
const bytes = await datasetGet(url, 'production', path);
const value = decodeBeast2For(StringType)(bytes);

// Set dataset value
const encoded = encodeBeast2For(StringType)('new value');
await datasetSet(url, 'production', path, encoded);
```

### Tasks

```typescript
import { taskList, taskGet } from '@elaraai/e3-api-client';

// List tasks
const tasks = await taskList(url, 'production');
// [{ name: 'compute', hash: 'abc123...' }, ...]

// Get task details
const task = await taskGet(url, 'production', 'compute');
// { name: 'compute', hash: '...', commandIr: '...', inputs: [...], output: [...] }
```

### Execution

```typescript
import { dataflowStart, dataflowExecute, dataflowGraph, taskLogs } from '@elaraai/e3-api-client';

// Start execution (non-blocking)
await dataflowStart(url, 'production', { force: true });

// Execute and wait for result (blocking)
const result = await dataflowExecute(url, 'production', { force: true });
// { success: true, executed: 1n, cached: 0n, failed: 0n, tasks: [...], duration: 1.234 }

// Get dependency graph
const graph = await dataflowGraph(url, 'production');
// { tasks: [{ name: 'compute', inputs: [...], output: '...', dependsOn: [...] }] }

// Read task logs
const logs = await taskLogs(url, 'production', 'compute', { stream: 'stdout' });
// { data: '...', offset: 0n, size: 1024n, totalSize: 2048n, complete: false }
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

- **[East C](https://github.com/elaraai/east-workspace/tree/main/libs/east-c)**: C11 native runtime for executing East IR. Tarballed for `linux-x64` and `linux-arm64`, attached to each GitHub Release.
  - `east-c`: Core runtime — type system, IR interpreter, 200+ builtins, serialization (Beast2, JSON, CSV, East text)
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
