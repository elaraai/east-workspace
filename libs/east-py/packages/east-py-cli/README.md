# east-py-cli

[![License: BSL 1.1](https://img.shields.io/badge/License-BSL%201.1-orange.svg)](LICENSE.md)

Command-line interface for running East IR programs with Python platform functions.

## Installation

```bash
uv add east-py-cli

# Platform packages are installed separately as needed
uv add east-py-std          # console, crypto, fetch, fs, path, random, time
uv add east-py-io           # s3, sqlite, postgres, mysql, redis, mongodb, xlsx, xml, gzip, tar, zip, ftp, sftp
uv add east-py-datascience  # sklearn, scipy, xgboost, lightgbm, ngboost, torch, shap, optuna, simanneal, mads
```

## Usage

### Running Programs

```bash
# Run with platform packages
east-py run program.beast2 -p east-py-std

# Run with multiple platforms
east-py run program.json -p east-py-std -p east-py-io -p east-py-datascience

# With input and output files
east-py run program.beast2 \
  -p east-py-std \
  --input data.beast2 \
  --input config.json \
  --output result.beast2

# Verbose output
east-py run program.beast2 -p east-py-std -v
```

### Streaming Outputs

A function whose trailing parameter is an emit capability writes its output
incrementally instead of returning it; a large collection input can be fed
lazily, one decoded segment at a time (`--stream` is repeatable):

```bash
# Emit a Dict (or array / set) through the trailing parameter, feeding
# inputs 0 and 1 lazily from indexed beast2 blobs
east-py run task.beast2 -p east-py-std \
  -i rows.beast2 -i more.beast2 --stream 0 --stream 1 \
  --emit dict -o out.beast2 -v
```

The sink is east-c's, so it writes the same bytes as `east-c run`. Dict and Set emissions must ascend in East order. The sink writes one pass,
segment by segment, with one open batch in memory whatever the size of the
output, and a key below the previous one is an error naming both:

```text
beast2 v5: Dict key emitted out of order: 1 after 2 — Set/Dict emissions must ascend in East order
```

Equal keys are an error too unless the sink folds them:

```bash
# Dict: fold the values of adjacent equal keys with an East function (K, V, V) -> V
east-py run task.beast2 -p east-py-std --emit dict --merge merge.beast2 -o out.beast2

# Set: keep the first of adjacent equal elements
east-py run task.beast2 -p east-py-std --emit set --union -o out.beast2
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
east-py merge --merge merge.beast2 -i part-0.beast2 -i part-1.beast2 -i part-2.beast2 -o out.beast2 -v

# Set partials: the first of equal elements stands
east-py merge --union -i part-0.beast2 -i part-1.beast2 -o out.beast2

# Only the keys in [from, to): range.beast2 holds a Struct{from: Option<K>,
# to: Option<K>} over the inputs' key type, an absent bound open
east-py merge --merge merge.beast2 --range range.beast2 -i part-0.beast2 -i part-1.beast2 -o out.beast2
```

With `--range` every input is sought to the segment owning `from` through its
fences and read up to the first key at or past `to`, so a merge over one key
range of large partials reads that range's share of each, plus at most one
segment — how e3 merges a large output in parallel, one range per unit.

An input of another type than the first, an Array input, an input whose keys
do not ascend, a fold whose signature does not match the inputs, and bounds of
another type than the inputs' key are refused, naming the input. With `-v` the
merge prints its account:

```text
merge: 3 input(s), 31 entries, 13 fold(s)
```

### Exiting with the Parent

With `--exit-with-parent` on its command line (`run` and `merge`) the runner
watches its stdin on a native thread — one that runs while the body holds the
GIL — and exits with status 1 as soon as a read returns end of file or fails.
A parent that spawns the runner with a stdin pipe it never writes to — as e3
does — takes the runner down with it when it dies, even while the body is
computing. Without the flag, stdin is left alone.

```bash
east-py run task.beast2 --exit-with-parent -p east-py-std --emit dict -o out.beast2
```

On Windows the watcher (east-c's) reads a synchronous pipe or an overlapped
one. Hand it an overlapped pipe — `FILE_FLAG_OVERLAPPED`, or Node's stdio
`'overlapped'`, as e3 does: a read pending on a synchronous pipe holds the
pipe's file-object lock, so any other use of stdin in the runner — a
`sys.stdin.isatty()` in a platform package, say — would wait until the
parent is gone.

### Version and Platform Info

```bash
# Show CLI version
east-py version

# Show version with platform info
east-py version -p east-py-std -p east-py-io
```

Example output:
```
east-py-cli 0.1.0
east-py 0.1.0

Platforms:
  east-py-std 0.1.0 (47 platform functions)
  east-py-io 0.1.0 (59 platform functions)
```

### Transpiling and Exporting Functions

```bash
# Print an IR program (from any runtime) as python East.function source
east-py transpile program.beast2 -o program.py --name main

# Write a module's `east_functions` dict as a function manifest that a
# TypeScript e3 task imports with East.importFunction (or python with
# East.import_function); -p names the platform packages implementing any
# platform calls the functions make
east-py export-functions pricing.functions -o pricing.functions.beast2 -p east-py-std

# Only the functions an importer uses (--only, repeatable): a sibling function's
# platform call then needs no -p package
east-py export-functions pricing.functions -o pricing.functions.beast2 --only score
```

### Linting East bodies

The build refuses python that has no East form — `x // 2` on an expression,
an f-string over one, `if` on one, a callback reaching for `np` — and says
what to write instead. `east-py lint` says the same thing at edit time, in
the same words, over every `.py` file that imports `east`:

```bash
east-py lint src/                       # one `file:line:col: category [rule] message` per finding; exit 1 on any
east-py lint src/ --format json         # the findings as records
east-py lint src/ --disable no-deprecated-alias
east-py lint --list-rules               # EAS001 body-takes-block-first … EAS009 no-discarded-expression
```

A line ending in `# noqa` (or `# noqa: EAS002`) is skipped, as under ruff.
The same rules run inside flake8 once east-py-cli is installed (`flake8
--select EAS`), and `east-py lsp` serves them to any editor over the
Language Server Protocol (`pip install 'east-py-cli[lsp]'` for pygls).

## File Formats

IR and data files are auto-detected by extension:

| Extension | Format |
|-----------|--------|
| `.beast2`, `.beast` | Binary East v2 |
| `.east` | East text format |
| `.json` | JSON |

## Creating Platform Packages

Platform packages must export a `platform` attribute containing a list of platform functions:

```python
# my_platform/__init__.py
from east import East, IntegerType, StringType

@East.platform_function(inputs=[StringType], output=IntegerType, name="my_func")   # paired by name with
def my_func(s):                                                                   # East.platform("my_func", …)
    return len(s)

platform = East.platform_functions(__name__)
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

**BSL 1.1 (Business Source License):**
- Non-production use (evaluation, testing, development) is free
- Production use by or on behalf of for-profit entities requires a commercial license
- Code becomes AGPL-3.0 four years after each release

See [LICENSE.md](LICENSE.md) for full details.

**Commercial licensing:** support@elara.ai

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
