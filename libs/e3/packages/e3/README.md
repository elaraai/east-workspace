# @elaraai/e3

SDK for authoring e3 packages.

## Installation

```bash
npm install @elaraai/e3
```

## Example

```typescript
import e3 from '@elaraai/e3';
import { StringType, East, variant } from '@elaraai/east';

// Define input datasets with default values
const input_name = e3.input('name', StringType, variant('value', 'World'));
const input_prefix = e3.input('prefix', StringType, variant('value', 'Hello'));

// Define a task that combines inputs
const greet = e3.task(
  'greet',
  [input_prefix, input_name],
  East.function(
    [StringType, StringType],
    StringType,
    ($, prefix, name) => East.str`${prefix}, ${name}!`
  )
);

// Chain tasks - output of one feeds into the next
const shout = e3.task(
  'shout',
  [greet.output],  // reads from previous task's output
  East.function(
    [StringType],
    StringType,
    ($, greeting) => greeting.upperCase()
  )
);

// Create and export the package
const pkg = e3.package('greeting-pkg', '1.0.0', shout);
await e3.export(pkg, 'dist/greeting-pkg-1.0.0.zip');
```

This creates a package with:
- `.inputs.name` - String input (default: "World")
- `.inputs.prefix` - String input (default: "Hello")
- `.tasks.greet` - Combines inputs into greeting
- `.tasks.shout` - Transforms greeting to uppercase

## API

- `e3.input(name, type, variant('value', default))` - Define an input dataset
- `e3.task(name, inputs, fn)` - Define a task with East function
- `e3.streamTask(name, { inputs, output }, fn)` - Define a task that emits its output instead of returning it; `fn` receives the inputs, then `emit`
- `e3.output.array(T)`, `set(T)`, `dict(K, V, { merge? })`, `fold(T, { zero, combine })` - The output kinds a stream task emits into: what `emit` takes, and how the parts of the output combine
- `e3.partition(dataset, { by? })` - Mark a stream task's input as one its work may be split over, a piece at a time, in parallel
- `e3.record(name, type, initialValue)` - Define a record: state written only through its mutations, each an audited commit
- `e3.mutation.reduce(name, record, fn)`, `edit(name, record, fn)`, `patch(record, name?)` - Define a record's mutations: a reducer over the whole state, a body writing through an `edit` capability, or a patch a client sends
- `e3.recordIndex(name, record, { key | keys, value? })` - Define a second collection over a Dict record, in another order
- `e3.migration.value`, `rows`, `rekey(name, record, fn, { after? })` - Define the steps a deploy runs when a package changes a record's type
- `e3.package(name, version, ...items)` - Create a package (dependencies collected automatically)
- `e3.export(pkg, path)` - Export package to zip file

The [user guide](https://github.com/elaraai/east-workspace/blob/main/libs/e3/USAGE.md) covers the rest of the SDK, the CLI and setting up a project.


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

Dual AGPL-3.0 / Commercial. See [LICENSE.md](./LICENSE.md).

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
