# east-py-io

[![License: BSL 1.1](https://img.shields.io/badge/License-BSL%201.1-orange.svg)](LICENSE.md)

I/O platform functions for the [East programming language](https://github.com/elaraai/east-workspace/tree/main/libs/east) in Python.

Python equivalent of [@elaraai/east-node-io](https://github.com/elaraai/east-workspace/tree/main/libs/east-node-io) - provides platform functions for S3 object storage and SQLite database operations.

## Installation

```bash
pip install east-py-io
```

## Quick Start

```python
import asyncio
from east.runtime.compiler import compile_async
from east_py_io import python_io_platform

# Assuming you have East IR from the TypeScript compiler
# compiled_fn = compile_async(ir, python_io_platform)
# await compiled_fn()
```

## Platform Functions

### S3 Operations (`s3_impl`)

6 functions for AWS S3 and S3-compatible object storage (MinIO, Backblaze, etc.):

- `s3_put_object(config: S3Config, key: String, data: Blob) -> Null` - Upload object (async)
- `s3_get_object(config: S3Config, key: String) -> Blob` - Download object (async)
- `s3_head_object(config: S3Config, key: String) -> S3ObjectMetadata` - Get metadata without downloading (async)
- `s3_delete_object(config: S3Config, key: String) -> Null` - Delete object, idempotent (async)
- `s3_list_objects(config: S3Config, prefix: String, maxKeys: Integer) -> S3ListResult` - List with pagination (async)
- `s3_presign_url(config: S3Config, key: String, expiresIn: Integer) -> String` - Generate presigned URL (async)

**S3Config structure:**
```typescript
{
  region: String,
  bucket: String,
  accessKeyId: Option<String>,
  secretAccessKey: Option<String>,
  endpoint: Option<String>  // For S3-compatible services
}
```

**S3ObjectMetadata structure:**
```typescript
{
  key: String,
  size: Integer,
  lastModified: DateTime,
  contentType: Option<String>,
  etag: Option<String>
}
```

**S3ListResult structure:**
```typescript
{
  objects: Array<S3ObjectMetadata>,
  isTruncated: Boolean,
  continuationToken: Option<String>
}
```

### SQLite Database (`sqlite_impl`)

4 functions for SQLite database operations with connection pooling:

- `sqlite_connect(config: SqliteConfig) -> ConnectionHandle` - Connect to database, returns handle (async)
- `sqlite_query(handle: ConnectionHandle, sql: String, params: Array<SqlParameter>) -> SqlResult` - Execute parameterized query (async)
- `sqlite_close(handle: ConnectionHandle) -> Null` - Close connection (async)
- `sqlite_close_all() -> Null` - Close all connections, useful for cleanup (async)

**SqliteConfig structure:**
```typescript
{
  path: String,
  readOnly: Option<Boolean>,
  memory: Option<Boolean>
}
```

**SqlParameter variant:**
```typescript
String(String) | Integer(Integer) | Float(Float) | Boolean(Boolean) |
Null(Null) | Blob(Blob) | DateTime(DateTime)
```

**SqlResult variant:**
```typescript
select({ rows: Array<Dict<String, SqlParameter>> }) |
insert({ rowsAffected: Integer, lastInsertId: Option<Integer> }) |
update({ rowsAffected: Integer }) |
delete({ rowsAffected: Integer })
```

## Usage

### Full Platform (Async)

```python
from east_py_io import python_io_platform
from east.runtime.compiler import compile_async

# Use all I/O platform functions (all are async)
compiled_fn = compile_async(ir, python_io_platform)
await compiled_fn()
```

### Individual Modules

```python
from east_py_io import s3_impl, sqlite_impl

# Use specific platform function groups
platform = [*s3_impl, *sqlite_impl]
compiled_fn = compile_async(ir, platform)

# Or just one module
platform = [*sqlite_impl]
compiled_fn = compile_async(ir, platform)
```

### Type Definitions

```python
from east_py_io import (
    S3ConfigType,
    S3ObjectMetadataType,
    S3ListResultType,
    SqliteConfigType,
    SqlParameterType,
    SqlResultType,
)

# Use type definitions in your platform functions
```

## Development

```bash
# First-time setup (installs dependencies)
make install

# Development workflow
make test          # Run test suite (17 tests)
make lint          # Run linter (ruff)
make lint-fix      # Auto-fix linting issues
make typecheck     # Type check with mypy
make check         # Run all checks (lint + typecheck + test)

# Other useful commands
make coverage      # Generate HTML coverage report
make clean         # Clean build artifacts
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
