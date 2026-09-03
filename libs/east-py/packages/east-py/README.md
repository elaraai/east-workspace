# East.py

[![License: BSL 1.1](https://img.shields.io/badge/License-BSL%201.1-orange.svg)](LICENSE.md)

Python runtime for the [East programming language](https://github.com/elaraai/east-workspace/tree/main/libs/east).

## Overview

East.py is a Python backend that enables East IR to be compiled and executed in Python environments. It is a Cython bridge to the native [east-c](https://github.com/elaraai/east-workspace/tree/main/libs/east-c) runtime — IR compilation, the builtin library, execution, and serialization all run in east-c. It provides:

- **Complete type system** - Full representation of all East types (primitives, containers, structs, variants, functions)
- **East values as Python data** - Use East values as ordinary Python objects with eager methods that delegate to the east-c builtins, plus runtime validation/coercion at the Python↔East boundary
- **Full builtin library** - Array, Set, Dict, String, DateTime, Blob, Integer, Float operations, exposed eagerly
- **Serialization** - East text format, JSON, and BEAST (Binary East) support
- **DateTime formatting** - Custom datetime parsing and printing with format strings
- **Platform integration** - Expose Python functions to East with the `@East.platform_function` decorator

## Using East values from Python

East runtime values are usable as ordinary Python data. Containers carry their
East element types and expose **eager methods that run immediately by delegating
to the east-c builtins** (no IR, no rewrite); chained collection results stay
backed by east-c.

```python
from east import (EastArray, StringType, FloatType, StructType, VectorType,
                  East, array, coerce_to)

# Construct + validate from native Python (dicts are coerced to the struct type)
LineItem = StructType([("name", StringType), ("price", FloatType)])
items = array(LineItem, [{"name": "a", "price": 1}, {"name": "b", "price": 2.0}])

# Eager methods execute now and chain
cheap = items.filter(lambda b, r: r["price"] < 2.0).sort(lambda b, r: r["price"])

# Primitive builtins live on the East.<Type> namespaces (you can't add methods
# to Python's float/str/int) — they delegate to east-c too
East.Float.sqrt(2.0)
East.String.upper_case("hi")
East.less(StringType, "a", "b")

# ... alongside the East standard library, name for name with TypeScript
East.Integer.print_compact(1234567)        # "1.23M"
East.Float.print_currency(1234.567)        # "$1,234.57"
East.DateTime.round_down_week(dt, 1)       # the Monday on or before dt
East.str("total: ", 3, " items")           # "total: 3 items"

# Validate / coerce at a boundary; a mismatch raises a path-pinpointed EastTypeError
coerce_to([1, 2, 3], VectorType(FloatType))   # -> Vector<Float>
```

### Platform functions

Expose a Python function to East with the `@East.platform_function` decorator
(`from east import platform_function` is the same object). It infers sync/async,
validates the result against the declared output (a named `EastTypeError`
instead of silent corruption), and auto-collects the function. An implementation
is paired with the `East.platform(name, …)` declaration an East body calls **by
name** — the `def`'s, or `name=`:

```python
from east import East, struct, FloatType, ArrayType

@East.platform_function(inputs=[FloatType, ArrayType(LineItem)], output=ArrayType(LineItem))
def convert_prices(fx_rate, items):
    return items.map(lambda b, r: struct({"name": r["name"], "price": r["price"] * fx_rate}, LineItem))

platform = East.platform_functions(__name__)   # pass to East.compile(fn, platform=…)
```

For NumPy/torch interop, `EastVector.data` / `EastMatrix.data` are the contiguous
NumPy buffers — `torch.from_numpy(m.data)` and `EastMatrix(FloatType, tensor.numpy())`
need no manual dtype juggling (the bridge canonicalizes at the east-c boundary).

## Current Status

Fully implemented: the East type system, the full builtin library (exposed both
through IR compilation and the eager value methods), serialization (East text,
JSON, BEAST2, CSV), DateTime formatting, runtime validation/coercion, and the
platform-function integration API. The compliance suite (shared across the
TypeScript, C, and Python runtimes) passes in full.

## Installation

```bash
# Install from source
git clone https://github.com/elaraai/east-workspace/tree/main/libs/east-py
cd east-py
pip install -e .
```

## Quick Start

Here's a complete example showing how to load, compile, and execute East IR with platform functions:

```python
import asyncio
from east.runtime.compiler import compile_from_json
from east.runtime.platform import PlatformFunction
from east.types.types import IntegerType, NullType, StringType

# Load IR JSON exported by the East TypeScript compiler (raw bytes).
# In this example the IR is a function that logs a message, fetches an HTTP
# status (async), and logs the response.
with open("fetch_status.ir.json", "rb") as f:
    ir_json = f.read()

# Define platform function implementations
def log_impl(message: str) -> None:
    """Sync platform function: log a message."""
    print(message)

async def fetch_status_impl(url: str) -> str:
    """Async platform function: fetch HTTP status from URL."""
    import urllib.request
    loop = asyncio.get_event_loop()
    response = await loop.run_in_executor(None, urllib.request.urlopen, url)
    return f"{response.status} ({response.msg})"

def time_ns_impl() -> int:
    """Sync platform function: get current time in nanoseconds."""
    import time
    return time.time_ns()

# Register platform functions with type signatures
platform = [
    PlatformFunction(
        name="log",
        inputs=[StringType],
        output=NullType,
        type="sync",
        fn=log_impl
    ),
    PlatformFunction(
        name="fetch_status",
        inputs=[StringType],
        output=StringType,
        type="async",
        fn=fetch_status_impl
    ),
    PlatformFunction(
        name="time_ns",
        inputs=[],
        output=IntegerType,
        type="sync",
        fn=time_ns_impl
    ),
]

# Compile the IR to a Python callable (is_async=True: a platform fn is async)
fetch_status = compile_from_json(ir_json, platform, is_async=True)

# Execute the compiled function
async def main():
    await fetch_status("https://www.google.com")
    # Output:
    # Fetching URL: https://www.google.com
    # Response status: 200 (OK) - fetched in 123.45 ms

if __name__ == "__main__":
    asyncio.run(main())
```

## Development

```bash
# First-time setup (installs dependencies and pre-commit hooks)
make install

# Development workflow
make test          # Run test suite
make lint          # Run linter (ruff)
make format        # Format code
make typecheck     # Type check with mypy
make check         # Run all checks (lint + typecheck + test)

# Other useful commands
make repl          # Start Python REPL with east loaded
make coverage      # Generate HTML coverage report
make lint-fix      # Auto-fix linting issues
make clean         # Clean build artifacts

# Run the compliance suite directly (executes the IR corpus through the bridge)
uv run pytest tests/test_compliance.py -v
```

The native extensions (the east-c bridge and the Cython hot paths) are compiled
at install time. After editing a `.pyx`/`.pxd` or the linked east-c sources,
rebuild with `make install` (from the `libs/east-py` lib root) to recompile them.

### Native build

The package compiles the native **east-c** runtime into a Cython extension (the
`_eastc` bridge) at install time — this is **required**: IR compilation,
execution, the builtin library, and the eager value methods all run through it.
A few hot paths (struct/variant construction, BEAST2/CSV decoding, ordering) have
additional Cython acceleration with a pure-Python fallback, but the core bridge
is not optional.

Building requires a C compiler and `python3-dev` (Linux) or Xcode CLI tools
(macOS); extensions compile automatically during `pip install` / `uv sync` /
`make install`.

## Architecture

The builtin library, IR compiler, execution, and serialization live in the
native [east-c](https://github.com/elaraai/east-workspace/tree/main/libs/east-c)
runtime; this package is the Python type system plus a Cython bridge to it.

### Module Structure

- `east/types/` - Type system + value representation
  - `types.py` - Type constructors, guards, comparison/unification
  - `values.py` - Value classes (`EastArray`/`Set`/`Dict`/`Vector`/`Matrix`/`Struct`/`Variant`/`Ref`/`Blob`), their eager methods, `is_value_of`/`type_of`
  - `coercion.py` - `coerce_to` / `assert_value_of` / `explain_value_of` / `EastTypeError`
  - `construct.py` - Ergonomic constructors (`variant`/`some`/`none`/`match`/`struct`/`array`)
  - `type_of_type.py` - Homoiconic type encoding (types are East values)

- `east/namespace.py` - The `East` object: the `East.<Type>` builtin namespaces (Float/Integer/String/DateTime/Boolean/Blob + Array/Set/Dict/Vector/Matrix constructors, compare/equal/less), the standard library attached to them, and the authoring entry points (`East.function`/`platform`/`compile`, `East.str`/`min`/`max`/`clamp`)
- `east/expression/` - The strict expression builder: `expr/` — one `Expression` class per East type mirroring `libs/east/src/expr/*.ts` (the TypeScript method names, snake_cased), `libs/` — the standard library ported from `expr/libs/*.ts`, `statements.py` — the block (`b`, the `$` twin), `function.py` — `East.function`, `finalize.py` — trace-time CSE and the homoiconic IR
- `east/codegen/` - IR → python: the printer and the builtin spelling table the eager compliance replay shares
- `east/datetime_format.py` - Format-string tokenizer for the DateTime print/parse builtins

- `east/runtime/` - Execution engine
  - `compiler.py` / `_compiler_eastc.pyx` - Bridge to east-c: compile IR, `east_call`, the eager `call_builtin` shim, and the Python-callback invoke hook
  - `platform.py` - `PlatformFunction` + the `@East.platform_function` on-ramp
  - `errors.py` - `EastError`

- `east/serialization/` - East text, JSON, BEAST2, CSV (thin wrappers over the east-c encoders/decoders)
- `east/utils/ordering.py` - East total order (`compare_for`/`equal_for`/`less_for`/`make_east_key`)
- `east/_eastc_bridge.pyx`, `east/_eastc.pxd` - The Cython ↔ east-c value/type marshalling layer


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
  - [east-py](https://pypi.org/project/east-py/): Core Python runtime — type system, Cython bridge to the east-c runtime (compiler, builtins, serialization), eager value methods
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
