# east-py-io

[![License: BSL 1.1](https://img.shields.io/badge/License-BSL%201.1-orange.svg)](LICENSE.md)

I/O platform functions for the [East programming language](https://github.com/elaraai/East) in Python.

Python equivalent of [@elaraai/east-node-io](https://github.com/elaraai/east-node-io) - provides platform functions for S3 object storage and SQLite database operations.

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

## License

**BSL 1.1 (Business Source License):**
- Non-production use (evaluation, testing, development) is free
- Production use by or on behalf of for-profit entities requires a commercial license
- Code becomes AGPL-3.0 four years after each release

See [LICENSE.md](LICENSE.md) for full details.

**Commercial licensing:** support@elara.ai

### Ecosystem

- **[East Node](https://github.com/elaraai/east-node)**: Node.js platform functions for I/O, databases, and system operations. Connect East programs to filesystems, SQL/NoSQL databases, cloud storage, and network services.
  - [@elaraai/east-node-std](https://www.npmjs.com/package/@elaraai/east-node-std): Filesystem, console, HTTP fetch, crypto, random distributions, timestamps
  - [@elaraai/east-node-io](https://www.npmjs.com/package/@elaraai/east-node-io): SQLite, PostgreSQL, MySQL, MongoDB, S3, FTP, SFTP
  - [@elaraai/east-node-cli](https://www.npmjs.com/package/@elaraai/east-node-cli): CLI for running East IR programs in Node.js

- **[East Python](https://github.com/elaraai/east-py)**: Python runtime and platform functions for data science and machine learning. Execute East programs with access to optimization solvers, gradient boosting, neural networks, and model explainability.
  - [@elaraai/east-py-datascience](https://www.npmjs.com/package/@elaraai/east-py-datascience): TypeScript types for optimization, gradient boosting, neural networks, explainability

- **[East UI](https://github.com/elaraai/east-ui)**: East types and expressions for building dashboards and interactive layouts. Define UIs as data structures that render consistently across React, web, and other environments.
  - [@elaraai/east-ui](https://www.npmjs.com/package/@elaraai/east-ui): 50+ typed UI components for layouts, forms, charts, tables, dialogs
  - [@elaraai/east-ui-components](https://www.npmjs.com/package/@elaraai/east-ui-components): React renderer with Chakra UI styling

- **[e3 - East Execution Engine](https://github.com/elaraai/e3)**: Durable execution engine for running East pipelines at scale. Features Git-like content-addressable storage, automatic memoization, task queuing, and real-time monitoring.
  - [@elaraai/e3](https://www.npmjs.com/package/@elaraai/e3): SDK for authoring e3 packages with typed tasks and pipelines
  - [@elaraai/e3-core](https://www.npmjs.com/package/@elaraai/e3-core): Git-like object store, task queue, result caching
  - [@elaraai/e3-types](https://www.npmjs.com/package/@elaraai/e3-types): Shared type definitions for e3 packages
  - [@elaraai/e3-cli](https://www.npmjs.com/package/@elaraai/e3-cli): `e3 init`, `e3 run`, `e3 logs` commands for managing and monitoring tasks
  - [@elaraai/e3-api-client](https://www.npmjs.com/package/@elaraai/e3-api-client): HTTP client for remote e3 servers
  - [@elaraai/e3-api-server](https://www.npmjs.com/package/@elaraai/e3-api-server): REST API server for e3 repositories

## Links

- **Website**: [https://elaraai.com/](https://elaraai.com/)
- **East Repository**: [https://github.com/elaraai/East](https://github.com/elaraai/East)
- **Issues**: [https://github.com/elaraai/east-py/issues](https://github.com/elaraai/east-py/issues)
- **Email**: support@elara.ai

## About Elara

East is developed by [Elara AI Pty Ltd](https://elaraai.com/), an AI-powered platform that creates economic digital twins of businesses that optimize performance. Elara combines business objectives, decisions and data to help organizations make data-driven decisions across operations, purchasing, sales and customer engagement, and project and investment planning. East powers the computational layer of Elara solutions, enabling the expression of complex business logic and data in a simple, type-safe and portable language.

---

*Developed by [Elara AI Pty Ltd](https://elaraai.com/)*
