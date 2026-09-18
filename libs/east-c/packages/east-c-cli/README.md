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

### Streaming outputs and inputs

A function whose trailing parameter is an emit capability writes its output
incrementally instead of returning it; a large collection input can be fed
lazily, one decoded segment at a time (`--stream` is repeatable):

```bash
# Emit a Dict (or array / set) through the trailing parameter, feeding
# inputs 0 and 1 lazily from indexed beast2 blobs
east-c run task.beast2 -i rows.beast2 -i more.beast2 --stream 0 --stream 1 \
    --emit dict -o out.beast2 -v
```

Dict and Set emissions must ascend in East order. The sink writes one pass,
segment by segment, with one open batch in memory whatever the size of the
output, and a key below the previous one is an error naming both:

```text
beast2 v5: Dict key emitted out of order: 1 after 2 — Set/Dict emissions must ascend in East order
```

Equal keys are an error too unless the sink folds them:

```bash
# Dict: fold the values of adjacent equal keys with an East function (K, V, V) -> V
east-c run task.beast2 --emit dict --merge merge.beast2 -o out.beast2

# Set: keep the first of adjacent equal elements
east-c run task.beast2 --emit set --union -o out.beast2
```

`--merge` takes an IR file in any format the program itself may use, compiled
with the run's `-p` platforms; its signature must match the emit parameter's
key and value types. Adjacent equal keys fold left in emission order,
`acc = merge(key, acc, value)`, and the output is byte-identical to what the
sink writes without the flag for the already-folded sequence.

### Merging blobs

`merge` combines sorted Set or Dict blobs of one type — the files `run --emit`
writes — into one, in a single pass over the inputs: every input is read
segment by segment, equal keys across inputs fold in input order (`--merge`
on Dict inputs, `--union` on Set inputs; without a fold an equal key is an
error), and the output is byte-identical to what `run --emit` writes for the
same entries emitted ascending. This is how e3 assembles a partitioned task's
keyed partials; all three runners write the same bytes.

```bash
# Dict partials: fold the values of equal keys, in input order
east-c merge --merge merge.beast2 -i part-0.beast2 -i part-1.beast2 -i part-2.beast2 -o out.beast2 -v

# Set partials: the first of equal elements stands
east-c merge --union -i part-0.beast2 -i part-1.beast2 -o out.beast2
```

An input of another type than the first, an Array input, an input whose keys
do not ascend, and a fold whose signature does not match the inputs are
refused, naming the input. With `-v` the merge prints its account:

```text
merge: 3 input(s), 31 entries, 13 fold(s)
```

### Exiting with the parent

With `--exit-with-parent` on its command line (any command, anywhere among
the arguments) the runner watches its stdin on a thread of its own and exits
with status 1 as soon as a read returns end of file or fails. A parent that
spawns the runner with a stdin pipe it never writes to — as e3 does — takes
the runner down with it when it dies, even while the body is computing.
Without the flag, stdin is left alone.

```bash
east-c run task.beast2 --exit-with-parent --emit dict -o out.beast2
```

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
  - [@elaraai/e3-cli](https://www.npmjs.com/package/@elaraai/e3-cli): `e3 repo`, `e3 package`, `e3 workspace`, `e3 start`, `e3 watch`, `e3 logs` commands
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
