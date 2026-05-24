# East Node IO

> I/O platform functions for the East language on Node.js

[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE.md)
[![Node Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org)

East Node IO provides type-safe I/O platform functions for [East](https://github.com/elaraai/east-workspace/tree/main/libs/east) programs running on Node.js, enabling database operations, cloud storage, file transfer, NoSQL operations, file format processing, and compression.

## Features

- **SQL Databases**: SQLite, PostgreSQL, MySQL with connection pooling, Microsoft Access (read-only)
- **Cloud Storage**: S3 and S3-compatible object storage (MinIO, etc.)
- **File Transfer**: FTP and SFTP for legacy system integration
- **NoSQL**: Redis caching and MongoDB document storage
- **File Formats**: XLSX (Excel), CSV, and XML parsing and serialization
- **Compression**: Gzip, Zip, and Tar compression and decompression
- **Type Safety**: Full East type system integration
- **Async I/O**: All operations use `implementAsync` for non-blocking I/O

## Installation

```bash
npm install @elaraai/east-node-io
```

## Quick Start

### SQL Database Query

```typescript
import { East, StringType, IntegerType, NullType } from "@elaraai/east";
import { SQL } from "@elaraai/east-node-io";

const getUserById = East.function([IntegerType], NullType, ($, userId) => {
    const config = $.let({
        host: "localhost",
        port: 5432n,
        database: "myapp",
        user: "postgres",
        password: "secret",
        ssl: East.variant('none', null),
        maxConnections: East.variant('none', null),
    });

    const conn = $.let(SQL.Postgres.connect(config));
    $(SQL.Postgres.query(
        conn,
        "SELECT name FROM users WHERE id = $1",
        [East.variant("Integer", userId)]
    ));
    $(SQL.Postgres.close(conn));

    return $.return(null);
});

const compiled = East.compileAsync(getUserById.toIR(), SQL.Postgres.Implementation);
await compiled(42n);
```

### S3 File Upload/Download

```typescript
import { Storage } from "@elaraai/east-node-io";
import { East, StringType, BlobType } from "@elaraai/east";

const uploadFile = East.function([StringType, BlobType], StringType, ($, filename, data) => {
    const config = $.let({
        region: "us-east-1",
        bucket: "my-bucket",
        accessKeyId: East.variant('none', null),
        secretAccessKey: East.variant('none', null),
        endpoint: East.variant('none', null),
    });

    $(Storage.S3.putObject(config, filename, data));
    return Storage.S3.presignUrl(config, filename, 3600n);
});

const compiled = East.compileAsync(uploadFile.toIR(), Storage.S3.Implementation);
const url = await compiled("report.pdf", pdfBlob);
```

### Redis Caching

```typescript
import { East, StringType, OptionType } from "@elaraai/east";
import { NoSQL } from "@elaraai/east-node-io";

const cacheGet = East.function([StringType], OptionType(StringType), ($, key) => {
    const config = $.let({
        host: "localhost",
        port: 6379n,
        password: East.variant('none', null),
        db: East.variant('none', null),
        keyPrefix: East.variant('none', null),
    });

    const conn = $.let(NoSQL.Redis.connect(config));
    const value = $.let(NoSQL.Redis.get(conn, key));
    $(NoSQL.Redis.close(conn));

    return $.return(value);
});

const compiled = East.compileAsync(cacheGet.toIR(), NoSQL.Redis.Implementation);
const cached = await compiled("user:42");  // some("...") or none
```

### File Format Processing

```typescript
import { Format } from "@elaraai/east-node-io";
import { East, BlobType, IntegerType } from "@elaraai/east";

// Read Excel files
const countRows = East.function([BlobType], IntegerType, ($, xlsxBlob) => {
    const options = $.let({
        sheetName: East.variant('none', null),
    });

    const sheet = $.let(Format.XLSX.read(xlsxBlob, options));
    return $.return(sheet.size());
});

const compiled = East.compile(countRows.toIR(), Format.XLSX.Implementation);
const rowCount = compiled(xlsxBlob);  // 100n
```

## Platform Functions

### SQL

- **SQLite**: `connect`, `query`, `select`, `close`
- **PostgreSQL**: `connect`, `query`, `select`, `close`
- **MySQL**: `connect`, `query`, `select`, `close`
- **Access**: `open`, `tables`, `query`, `close` (read-only, .mdb/.accdb)

### Storage

- **S3**: `putObject`, `getObject`, `deleteObject`, `listObjects`, `presignUrl`

### Transfer

- **FTP**: `connect`, `put`, `get`, `list`, `delete`, `close`
- **SFTP**: `connect`, `put`, `get`, `list`, `delete`, `close`

### NoSQL

- **Redis**: `connect`, `get`, `set`, `setex`, `del`, `close`
- **MongoDB**: `connect`, `insertOne`, `findOne`, `find`, `updateOne`, `deleteOne`, `close`

### Format

- **XLSX**: `read`, `write`, `info` - Excel spreadsheet processing
- **CSV**: `parse`, `serialize` - Comma-separated values with header support
- **XML**: `parse`, `serialize` - XML document tree processing

### Compression

- **Gzip**: `compress`, `decompress` - Gzip compression (RFC 1952)
- **Zip**: `compress`, `decompress` - ZIP archive creation and extraction
- **Tar**: `create`, `extract` - TAR archive creation and extraction

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests (requires Docker)
npm run test:integration

# Start Docker services for development
npm run dev:services

# Stop Docker services
npm run dev:services:down

# Lint code
npm run lint
```

## Testing

Integration tests require Docker for running real databases and services:

```bash
# Start all services (PostgreSQL, MySQL, MongoDB, Redis, MinIO, FTP, SFTP)
npm run dev:services

# Run full integration test suite
npm run test:integration

# Stop all services
npm run dev:services:down
```

## Documentation

- [Usage Guide](USAGE.md)
- [Development Standards](STANDARDS.md)
- [Contributing Guidelines](CONTRIBUTING.md)
- [License](LICENSE.md)

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

Copyright (c) 2025 Elara AI Pty Ltd

This project is licensed under the GNU Affero General Public License v3.0 - see the [LICENSE.md](LICENSE.md) file for details.

## Dependencies

- **SQL**: `better-sqlite3`, `pg`, `mysql2`, `mdb-reader`
- **Storage**: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`
- **Transfer**: `basic-ftp`, `ssh2-sftp-client`
- **NoSQL**: `ioredis`, `mongodb`
- **Format**: `xlsx` for Excel file processing


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
