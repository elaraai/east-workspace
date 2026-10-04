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

### Running a unit (`exec`)

`east-py exec <unit.beast2>` is the command e3 runs: the machine-facing twin
of `run`. The unit file names the work — a program to run over its inputs, or
the parts of an output to merge — with the platforms, the threads the runner
may use, the output's kind (a value the program returns, or an array, set,
dict or fold it emits into), and where to write the output and a typed
result: the outcome (`ok`, or `failed` with the message and its source
locations), the peak memory, and the time spent loading, compiling, executing
and writing. Paths in a unit may be relative to its file, so a unit and the
files it names replay wherever they are moved together. A run unit's `decode`
says how its inputs are read, as `run --decode` does (below). It exits 0 when
the outcome is `ok` and 1 when the result records a failure; `-v` prints how
each input was read, where the time went and the peak memory.

### How Inputs Are Read

A collection input opens lazily, whatever it weighs: an indexed beast2 file is
mapped, and a read decodes only the segments it reaches — its size, a keyed
read and the `$.for` loop decode a segment at a time, and an operation the
pager cannot serve decodes the input whole, once, when it first needs it. A
loop holds only the segment it walks. Keyed reads keep the segments they
decode, up to 256 MiB of decoded weight per input (`EAST_PAGED_CACHE_BYTES`;
`1` keeps one segment), and reads in key order keep about two.
`--decode whole` decodes every input before the program runs instead, which
suits a program that reads at random across more than that, or loops over an
input more than once: lazily, a read beyond the segments the pager keeps
decodes its segment again. `exec` reads the same choice from its unit's
`decode`, and east-c and east-node take the same flag.
A value that is not a collection, and a collection whose elements hold a Ref
or a function, is decoded whole either way.

```bash
east-py run task.beast2 -p east-py-std -i rows.beast2 --decode whole -o out.beast2
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

### Exiting with the Parent

With `--exit-with-parent` on its command line (`run` and `exec`) the runner
watches its stdin on a native thread — one that runs while the body holds the
GIL — and exits with status 1 as soon as a read returns end of file or fails.
A parent that spawns the runner with a stdin pipe it never writes to — as e3
does — takes the runner down with it when it dies, even while the body is
computing. Without the flag, stdin is left alone.

```bash
east-py run task.beast2 --exit-with-parent -p east-py-std -o out.beast2
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
  - [@elaraai/e3-cli](https://www.npmjs.com/package/@elaraai/e3-cli): `e3 repo`, `e3 package`, `e3 workspace`, `e3 dataflow run`, `e3 watch`, `e3 task logs` commands
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
