# @elaraai/e3-api-tests

Compliance test suite for e3 API servers, used for integration tests in the e3 monorepo. Intended to verify the reference server (`@elaraai/e3-api-server`), and ensure any alternative e3 server implementations conform to the same API contract.

## Installation

```bash
npm install @elaraai/e3-api-tests
```

## Usage

Each test receives a fresh, isolated context via a `TestSetup<T>` factory, enabling concurrent execution:

```typescript
import { describe, after } from 'node:test';
import { createServer } from '@elaraai/e3-api-server';
import { allApiTests, createTestContext, type TestSetup, type TestContext } from '@elaraai/e3-api-tests';

// Shared server (one per test run)
const server = await createServer({ reposDir: tempDir, port: 0 });
await server.start();

// Per-test setup: creates a fresh repo + context
const setup: TestSetup<TestContext> = async (t) => {
  const ctx = await createTestContext({
    baseUrl: `http://localhost:${server.port}`,
    getToken: async () => '',
    // No auth: a reader's token is the admin's
    getReaderToken: async () => '',
    cleanup: true,
  });
  t.after(() => ctx.cleanup());
  return ctx;
};

describe('API compliance', { concurrency: true }, () => {
  after(() => server.stop());
  allApiTests(setup);
});
```

The suites call as two callers:

- **`getToken`'s**, who may do anything the suites do.
- **`getReaderToken(repo)`'s**, who may read `repo`, and whose one-shot grant there is `platform_free`: the reader cases in `functionTests` run as it. A harness whose server keeps access per repository grants this caller access to `repo` before it answers.

A server with no auth answers any token. One with auth needs both tokens signed or fetched, as `test/integration/src/api-compliance.spec.ts` signs them for the local server.

A harness whose server answers requests in its own process, such as e3 running in a page, gives `fetch`. Every request of the suites then goes through it: the client's calls, the suites' own requests (`ctx.fetch`) and e3's platform functions. `test/integration/src/api-compliance-fetch.spec.ts` runs the suites through a `fetch` that forwards to the local server, while the global `fetch` refuses every request.

A harness whose server runs no commands, such as e3 running in a page, sets `commands: false`. The suites' tasks are East, which every server runs, and their failing tasks fail in East: each is recorded `failed`, exit code 1, with its message in its stderr log. One case in `dataflowTests` runs a command, a custom task that exits 1. On a server that runs commands it expects that task `failed`, exit code 1; on one that runs none, recorded `error`, with a message saying the server runs no commands.

## Exports

| Export | Description |
|--------|-------------|
| `TestSetup<T>` | Type for per-test context factory: `(t: TestContext) => Promise<T>` |
| `createTestContext` | Create test context with helpers for setup/teardown |
| `allApiTests` | Register every API test suite of `apiTestSuites`: repository, packages, workspaces, datasets, dataset pages, dataset transfer, dataflow, functions, records, keyed records, record deploys, package transfer and platform |
| `apiTestSuites` | Every API test suite by name, in the order `allApiTests` registers them: for a harness that runs them in parts, and checks its parts name each once |
| `allTests` | Register all tests including CLI tests (requires credentials env) |
| `repositoryTests` | Repository CRUD tests |
| `packageTests` | Package import/export tests |
| `workspaceTests` | Workspace management tests |
| `datasetTests` | Dataset read/write tests |
| `datasetPageTests` | Paged dataset reads and key search |
| `datasetTransferTests` | Dataset uploads and downloads through the transfer protocol |
| `dataflowTests` | Dataflow execution tests |
| `functionTests` | Function calls, one-shots and split calls, as an admin and as a reader |
| `recordTests` | Record mutations |
| `keyedRecordTests` | Keyed records: every write form, and their indexes |
| `recordDeployTests` | Records across deploys: migrations |
| `packageTransferTests` | Package imports and exports as jobs |
| `platformTests` | Platform capability tests |
| `cliTests` | CLI integration tests |
| `transferTests` | Cross-repository transfer tests |
| `createPackageZip` | Create a test package zip file |
| `runE3Command` | Run an e3 CLI command |

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
