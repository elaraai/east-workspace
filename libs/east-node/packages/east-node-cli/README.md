# East Node CLI

> Command-line interface for running East IR programs with Node.js

[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE.md)
[![Node Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org)

**East Node CLI** provides a command-line interface for executing compiled [East](https://github.com/elaraai/east-workspace/tree/main/libs/east) IR programs using Node.js platform implementations.

## Installation

```bash
# Install the CLI
npm install -g @elaraai/east-node-cli

# Install platform packages (required)
npm install @elaraai/east-node-std
npm install @elaraai/east-node-io  # if using I/O functions
```

## Usage

### Running Programs

```bash
# Run with standard platform
east-node run ./program.beast2 -p @elaraai/east-node-std

# Run with multiple platforms
east-node run ./db-query.beast2 \
    -p @elaraai/east-node-std \
    -p @elaraai/east-node-io

# Run with input files
east-node run ./transform.beast2 \
    -p @elaraai/east-node-std \
    -i input.json \
    -i config.east

# Run with output file
east-node run ./process.beast2 \
    -p @elaraai/east-node-std \
    -i input.beast2 \
    -o result.json

# Verbose mode
east-node run ./program.beast2 -p @elaraai/east-node-std -v
```

### Exiting with the Parent

With `--exit-with-parent` on its command line (`run` and `exec`) the runner
watches its stdin from a worker thread, reading it through a socket on the
worker's own event loop, and kills its own process as soon as stdin ends,
closes or cannot be read. A parent that spawns the runner with a stdin pipe
it never writes to — as e3 does — takes the runner down with it when it dies,
even while the body is computing. The watcher never blocks in a read, so it
never holds up the runner's own exit. The runner opens `process.stdin` before
the watcher reads, so it keeps full use of its stdin over any pipe — on
Windows a read pending on a synchronous pipe holds the pipe's file-object
lock, and opening stdin after it (as the first import of `node:process` does)
would otherwise wait until the parent is gone. Without the flag, stdin is left
alone.

```bash
east-node run ./task.beast2 --exit-with-parent -p @elaraai/east-node-std -o out.beast2
```

### Version Information

```bash
# Show CLI version
east-node version

# Show CLI and platform versions
east-node version -p @elaraai/east-node-std -p @elaraai/east-node-io
```

### Transpiling IR to TypeScript

```bash
# Print an IR program as East.function builder source
east-node transpile ./program.beast2 -o program.ts

# Every IR file in a directory, plus the IR each printed module builds
# back — the round-trip check
east-node transpile ./ir/ -o ./ts/ --rebuild ./rebuilt/
```

The printed module imports `@elaraai/east` and rebuilds the same IR
(equal under `east-c ir normalize`): the `$`-forms for statements,
expression methods and `East.value(..., T)` constructions for values.
Builtins the TypeScript surface has no spelling for print through
`East.builtin(...)`. `east-py transpile` is the python twin; the two
printers and the cross-language sweep are described in
`docs/conventions/EAST_CODEGEN.md`.

### Exporting functions for another language

```bash
# Write a module's `eastFunctions` export as a function manifest that a python
# package (or another TypeScript package) imports with East.import_function /
# East.importFunction; -p names the platform packages implementing any
# platform calls the functions make
east-node export-functions dist/pricing.js -o pricing.functions.beast2 -p @elaraai/east-node-std
```

## CLI Reference

### `east-node run`

Execute an East IR program.

```
east-node run <ir_file> [options]

Arguments:
  ir_file                    Path to IR file (.beast2, .beast, .east, or .json)

Options:
  -p, --package <package>    Platform package to load (can be repeated)
  -i, --input <file>         Input data file (can be repeated)
  -o, --output <file>        Output file path for result
  -v, --verbose              Enable verbose output
  --exit-with-parent         Exit as soon as stdin reaches end of file — for a parent
                             that holds a stdin pipe it never writes to
  -h, --help                 Display help
```

### `east-node transpile`

Print an East IR program as TypeScript `East.function` builder source.

```
east-node transpile <input> [options]

Arguments:
  input                      Path to an IR file (.beast2, .beast, .east, or .json), or a directory of them

Options:
  -o, --output <path>        Write the module here (a directory when <input> is one; default: stdout)
  --name <name>              The module-level export bound to the rebuilt function (default: main)
  --import-from <specifier>  The module the printed source imports East from (default: @elaraai/east)
  --rebuild <path>           Import the printed module and write the IR it builds here
                             (.beast2 or .json; a directory in directory mode)
```

### `east-node export-functions`

Write a module's `eastFunctions` export (name → `East.function` result) as a function manifest.

```
east-node export-functions <module> -o <file> [options]

Arguments:
  module                       Path to the built module exporting `eastFunctions`

Options:
  -o, --output <file>          The manifest to write (.beast2)
  -p, --package <package...>   Platform packages implementing the functions' platform calls
                               (every dependency must be provided by one; recorded as its provider)
  --name <name>                The package name importers use (default: the module file's stem)
  --package-version <version>  The version recorded in the manifest (default: 0.0.0)
  --only <name...>             Export only these functions of `eastFunctions` (default: all)
```

### `east-node version`

Show version information.

```
east-node version [options]

Options:
  -p, --package <package>    Platform package to check (can be repeated)
```

## Supported File Formats

| Extension | Format |
|-----------|--------|
| `.beast2`, `.beast` | Binary East format |
| `.east` | Text East format |
| `.json` | JSON format |

## Large Inputs

Indexed `.beast2` collection inputs (Array/Set/Dict) at or above 64 MiB open
**lazily by default**: size, single-pass iteration, and keyed reads are served
from the blob's segment index with O(segment) decoded memory, and any other
operation transparently decodes the whole value once. Semantics are identical
to an eager decode, so the threshold is a memory knob, not a behavior toggle.

Control it with the `EAST_LAZY_INPUT_BYTES` environment variable: a byte
threshold, or `0` to disable lazy opening entirely.

A collection input may also be a manifest directory, the form e3 stages a
stored collection in: the input file holds a manifest, and each segment it
names is a standalone blob in `<file>.segments/<sha256>.beast2`. It opens
over those files — lazily, a read opening only the segments it reaches, or
whole — and counts as the size of its segments against the threshold.

Lazy opening applies only to **value-semantic element shapes** (scalars,
structs, variants). An element type that transitively contains an Array, Set,
Dict or Ref — which East mutates in place through read-out elements — or a
Vector/Matrix/function (identity-compared) always decodes whole, keeping
writes and identity semantics exactly eager. The same rule applies in the
east-c and east-py runners.

## Platform Packages

Platform packages provide the runtime implementations for East platform functions:

- **[@elaraai/east-node-std](https://www.npmjs.com/package/@elaraai/east-node-std)** - Standard platform (console, filesystem, crypto, time, etc.)
- **[@elaraai/east-node-io](https://www.npmjs.com/package/@elaraai/east-node-io)** - I/O platform (SQL, S3, FTP, Redis, MongoDB, etc.)

## Creating Platform Packages

Any npm package can provide platform functions by following this convention:

1. Export a `./platform` subpath that default-exports `PlatformFunction[]`
2. Export `./package.json` for version discovery

See the [design document](../../docs/east-node-cli-design.md) for details.

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

Dual-licensed:
- **Open Source**: [AGPL-3.0](LICENSE.md) - Free for open source use
- **Commercial**: Available for proprietary use - contact support@elara.ai


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

- **Website**: [https://elaraai.com/](https://elaraai.com/)
- **East Repository**: [https://github.com/elaraai/east-workspace/tree/main/libs/east](https://github.com/elaraai/east-workspace/tree/main/libs/east)
- **Issues**: [https://github.com/elaraai/east-workspace/issues](https://github.com/elaraai/east-workspace/issues)
- **Email**: support@elara.ai

## About Elara

East is developed by [Elara AI Pty Ltd](https://elaraai.com/), an AI-powered platform that creates economic digital twins of businesses that optimize performance. Elara combines business objectives, decisions and data to help organizations make data-driven decisions across operations, purchasing, sales and customer engagement, and project and investment planning. East powers the computational layer of Elara solutions, enabling the expression of complex business logic and data in a simple, type-safe and portable language.

---

*Developed by [Elara AI Pty Ltd](https://elaraai.com/).*

---

*Developed by [Elara AI Pty Ltd](https://elaraai.com/)*
