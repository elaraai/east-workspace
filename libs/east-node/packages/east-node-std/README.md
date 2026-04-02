# East Node

> Node platform functions for the East language

[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE.md)
[![Node Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org)

**East Node** provides Node.js platform integration for the [East language](https://github.com/elaraai/East). It enables East programs to interact with the Node.js runtime through platform functions for file system operations, console I/O, HTTP requests, cryptography, and more.

## Features

- **📁 File System** - Read/write files, manage directories
- **🖥️ Console I/O** - stdout/stderr output, stdin input
- **🌐 HTTP Client** - Modern Fetch API for HTTP requests
- **🔐 Cryptography** - Random bytes, SHA-256, UUID generation
- **🎲 Random** - Random number generation with 14 statistical distributions
- **⏱️ Time Operations** - Timestamps and sleep
- **🛤️ Path Utilities** - Cross-platform path manipulation
- **🧪 Test Framework** - Built-in testing utilities
- **🛡️ Type-Safe** - Full TypeScript support with EastError handling

## Installation

```bash
npm install @elaraai/east-node-std @elaraai/east
```

## Quick Start

```typescript
import { East, NullType, StringType } from "@elaraai/east";
import { NodePlatform, Console, FileSystem } from "@elaraai/east-node-std";

// Define an East function using platform functions
const processFile = East.function(
    [StringType],  // Input: file path
    NullType,      // Output: null
    ($, inputPath) => {
        const content = $.let(FileSystem.readFile(inputPath));
        $(Console.log(content));
        $(FileSystem.writeFile("output.txt", content));
    }
);

// Compile with Node.js platform and execute
const compiled = East.compile(processFile.toIR(), NodePlatform);
compiled("/path/to/input.txt");
```

## Platform Functions

East Node provides seven platform modules:

| Module | Functions | Description |
|--------|-----------|-------------|
| **Console** | `log`, `error`, `write` | Console I/O operations |
| **FileSystem** | `readFile`, `writeFile`, `exists`, `createDirectory`, etc. | File system operations (11 functions) |
| **Fetch** | `get`, `post`, `request` | HTTP client using Fetch API |
| **Crypto** | `randomBytes`, `hashSha256`, `uuid` | Cryptographic operations |
| **Time** | `now`, `sleep` | Time and delay operations |
| **Path** | `join`, `resolve`, `dirname`, `basename`, `extname` | Path manipulation |
| **Random** | `uniform`, `normal`, `range`, `exponential`, `bernoulli`, etc. | Random number generation with 14 distributions |

**Complete platform:**
```typescript
import { NodePlatform } from "@elaraai/east-node-std";
const compiled = East.compile(myFunction.toIR(), NodePlatform);
```

**Individual modules:**
```typescript
import { Console, FileSystem } from "@elaraai/east-node-std";
const compiled = East.compile(myFunction.toIR(), [...Console.Implementation, ...FileSystem.Implementation]);
```

## Documentation

- **[USAGE.md](USAGE.md)** - Comprehensive guide with examples for all platform functions
- **[East Documentation](https://github.com/elaraai/East)** - Core East language documentation

## Testing

East Node includes a test framework for East code:

```typescript
import { describeEast, Test } from "@elaraai/east-node-std";
import { East } from "@elaraai/east";

await describeEast("Math operations", (test) => {
    test("addition works", $ => {
        const result = $.let(East.value(1n).add(2n));
        $(Test.equal(result, 3n));
    });
});
```

Run tests:
```bash
npm test          # Run all tests
make test         # Alternative via Makefile
```

## Development

```bash
npm run build     # Compile TypeScript
npm run test      # Run test suite (requires build)
npm run lint      # Check code quality
```

## Security

Platform functions are intentionally limited for sandbox security:

- ❌ No process access (exit, environment variables, command-line arguments)
- ❌ No arbitrary command execution
- ✅ Controlled I/O operations only
- ✅ All operations are type-checked

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
