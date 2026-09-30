# east-c-cli

> Command-line runner for east-c — execute compiled East IR natively from the terminal

[![License](https://img.shields.io/badge/license-BUSL--1.1-orange.svg)](LICENSE.md)

**east-c-cli** is the command-line entry point for the C runtime. It links against [`east-c`](../east-c) (core) and [`east-c-std`](../east-c-std) (standard platform) to execute East IR programs.

## Build

Requires CMake 3.16+ and a C11 compiler.

```bash
make build    # From libs/east-c/
make test
make clean
```

See [`docs/conventions/MAKEFILE_TARGETS.md`](../../../../docs/conventions/MAKEFILE_TARGETS.md).

## Usage

```bash
# Run a Beast2-encoded IR file
./build/packages/east-c-cli/east-c run program.beast2

# Run a JSON-encoded IR file
./build/packages/east-c-cli/east-c run program.json

# With arguments
./build/packages/east-c-cli/east-c run program.beast2 --input '"hello"'
```

The CLI loads the standard platform from `east-c-std` by default. Custom platform functions can be linked at build time.

### Running a unit (`exec`)

`east-c exec <unit.beast2>` is the command e3 runs: the machine-facing twin
of `run`. The unit file names the work — a program to run over its inputs, or
the parts of an output to merge — with the platforms, the threads the runner
may use, the output's kind (a value the program returns, or an array, set,
dict or fold it emits into), and where to write the output and a typed
result: the outcome (`ok`, or `failed` with the message and its source
locations), the peak memory, and the time spent loading, compiling, executing
and writing. Paths in a unit may be relative to its file, so a unit and the
files it names replay wherever they are moved together. A run unit says how its
inputs are read (`decode`, below). It exits 0 when the outcome is `ok` and 1
when the result records a failure; `-v` prints where the time went and the peak
memory.

### How inputs are read

A collection input opens lazily, whatever it weighs: an indexed beast2 file is
mapped, and a read decodes only the segments it reaches — its size, a keyed
read and the `$.for` loop decode a segment at a time, and an operation the
pager cannot serve decodes the input whole, once, when it first needs it.
`--decode whole` decodes every input before the program runs instead, which
suits a program that reads most of an input at random: lazily, a read beyond
the segments the pager keeps (64 MiB of them, `EAST_PAGED_CACHE_BYTES`)
decodes its segment again. `exec` reads the same choice from its unit's
`decode`. A value that is not a collection, and a collection whose elements
hold a Ref or a function, is decoded whole either way.

```bash
east-c run task.beast2 -i rows.beast2 --decode whole -o out.beast2
```

With `-v` the runner says how each input opened, and what reading it came to:
the segments a lazy input decoded, or what an input decoded whole holds in
memory — the growth in resident memory across its decode, beside the size it
weighs on disk, since a nested collection decodes at many times that size.
Reads that decode segments again are said to, with what decoding the input
whole would do instead.

A collection input may also be a manifest directory, the form e3 stages a
stored collection in: the input file holds a manifest, and each segment it
names is a standalone blob in `<file>.segments/<sha256>.beast2`. It opens
over those files — lazily, a read opening only the segments it reaches, or
whole — and weighs its segments in the `-v` account.

### Exiting with the parent

With `--exit-with-parent` on its command line (any command, anywhere among
the arguments) the runner watches its stdin on a thread of its own and exits
with status 1 as soon as a read returns end of file or fails. A parent that
spawns the runner with a stdin pipe it never writes to — as e3 does — takes
the runner down with it when it dies, even while the body is computing.
Without the flag, stdin is left alone.

```bash
east-c run task.beast2 --exit-with-parent -o out.beast2
```

On Windows the watcher reads a synchronous pipe or an overlapped one. Hand it
an overlapped pipe — `FILE_FLAG_OVERLAPPED`, or Node's stdio `'overlapped'`,
as e3 does: a read pending on a synchronous pipe holds the pipe's file-object
lock, so any other use of stdin in the runner would wait until the parent is
gone.

### Profiling

```bash
east-c run task.beast2 -i rows.beast2 --profile
```

prints every East function the run called, by self time, with its call
count, its total time, and where it is: the name of the Let it was bound to
when the IR has one, its definition site, and — when that differs — the
site of the first call that reached it, which is what tells apart helpers
the TypeScript builder inlined at their call sites. Off, profiling costs
one branch per call.

The `ir` toolbox (issue #627) works on IR files without running them:

```bash
# The canonical form of an IR file: loc_ids stripped, variables/labels renamed in
# the TypeScript lowering's order, captures recomputed, recursive type ids renumbered
east-c ir normalize program.json -o canonical.json

# Normalize two IR files and report the first structural difference (exit 1) or
# "identical" (exit 0); --raw compares as-is
east-c ir diff program.json rebuilt.beast2

# json <-> beast2 with the source map intact
east-c ir convert program.json -o program.beast2
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

Business Source License 1.1 — see [LICENSE.md](LICENSE.md). Same terms as `east-c` core.

<!-- Ecosystem — keep in sync with docs/snippets/ECOSYSTEM.md -->

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
  - [@elaraai/e3-ui-cli](https://www.npmjs.com/package/@elaraai/e3-ui-cli): Browse an e3 repository in the terminal (`e3-ui [repo]`), and render east-ui / e3-ui components to PNG (`e3-ui shot`)
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

- **Website**: https://elaraai.com/
- **Repository**: https://github.com/elaraai/east-workspace
- **Issues**: https://github.com/elaraai/east-workspace/issues
- **Email**: support@elara.ai

<!-- About Elara — keep in sync with docs/snippets/ABOUT_ELARA.md -->

## About Elara

East is developed by [Elara AI Pty Ltd](https://elaraai.com/), an AI-powered platform that creates economic digital twins of businesses that optimize performance. Elara combines business objectives, decisions and data to help organizations make data-driven decisions across operations, purchasing, sales and customer engagement, and project and investment planning. East powers the computational layer of Elara solutions, enabling the expression of complex business logic and data in a simple, type-safe and portable language.

---

*Developed by [Elara AI Pty Ltd](https://elaraai.com/).*
