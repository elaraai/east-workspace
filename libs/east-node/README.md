# East Node

> Node.js platform integration for the East language

[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE.md)
[![Node Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org)

**East Node** provides Node.js platform functions for the [East language](https://github.com/elaraai/East). It enables East programs to interact with the filesystem, network, databases, and other I/O operations in Node.js environments.

## Packages

| Package | Description | npm |
|---------|-------------|-----|
| [@elaraai/east-node-std](./packages/east-node-std) | Core platform functions (filesystem, console, fetch, crypto, etc.) | [![npm](https://img.shields.io/npm/v/@elaraai/east-node-std)](https://www.npmjs.com/package/@elaraai/east-node-std) |
| [@elaraai/east-node-io](./packages/east-node-io) | I/O platform functions (SQL, NoSQL, S3, FTP, etc.) | [![npm](https://img.shields.io/npm/v/@elaraai/east-node-io)](https://www.npmjs.com/package/@elaraai/east-node-io) |

## Features

**east-node-std:**
- **FileSystem** - Read/write files, manage directories
- **Console** - stdout/stderr output, stdin input
- **Fetch** - HTTP requests with modern Fetch API
- **Crypto** - Random bytes, SHA-256, UUID generation
- **Random** - 14 statistical distributions (uniform, normal, poisson, etc.)
- **Time** - Timestamps and sleep
- **Path** - Cross-platform path manipulation
- **Test** - Built-in testing utilities

**east-node-io:**
- **SQL** - SQLite, PostgreSQL, MySQL
- **NoSQL** - MongoDB, Redis
- **Storage** - S3 and S3-compatible object storage
- **Transfer** - FTP and SFTP file transfers
- **Formats** - CSV, XML, XLSX parsing

## Quick Start

```bash
npm install @elaraai/east-node-std @elaraai/east
```

```typescript
import { East } from "@elaraai/east";
import { Console, FileSystem, NodePlatform } from "@elaraai/east-node-std";

const MyProgram = East.function([], NullType, ($) => {
    // Write to console
    $(Console.log("Hello from East!"));

    // Read a file
    const content = $.let(FileSystem.readFile("./data.txt"));
    $(Console.log(content));
});

// Execute the program
await NodePlatform(MyProgram, []);
```

## Development

```bash
npm install        # Install all workspace dependencies
npm run build      # Build all packages
npm run test       # Run tests for all packages
npm run lint       # Lint all packages
```

## License

Dual-licensed:
- **Open Source**: [AGPL-3.0](LICENSE.md) - Free for open source use
- **Commercial**: Available for proprietary use - contact support@elara.ai

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
- **Issues**: [https://github.com/elaraai/east-node/issues](https://github.com/elaraai/east-node/issues)
- **Email**: support@elara.ai

## About Elara

East is developed by [Elara AI Pty Ltd](https://elaraai.com/), an AI-powered platform that creates economic digital twins of businesses that optimize performance. Elara combines business objectives, decisions and data to help organizations make data-driven decisions across operations, purchasing, sales and customer engagement, and project and investment planning. East powers the computational layer of Elara solutions, enabling the expression of complex business logic and data in a simple, type-safe and portable language.

---

*Developed by [Elara AI Pty Ltd](https://elaraai.com/)*
