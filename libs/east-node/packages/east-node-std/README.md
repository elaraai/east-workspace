# East Node

> Node platform functions for the East language

[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE.md)
[![Node Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org)

**East Node** provides Node.js platform integration for the [East language](https://github.com/elaraai/east-workspace/tree/main/libs/east). It enables East programs to interact with the Node.js runtime through platform functions for file system operations, console I/O, HTTP requests, cryptography, and more.

## Features

- **File System** - Read/write files, manage directories, open huge beast2 collection files lazily
- **Console I/O** - stdout/stderr output, stdin input
- **HTTP Client** - Modern Fetch API for HTTP requests
- **Cryptography** - Random bytes, SHA-256, UUID generation
- **Random** - Random number generation with statistical distributions
- **Time Operations** - Timestamps and sleep
- **Path Utilities** - Cross-platform path manipulation
- **Test Framework** - Built-in testing utilities
- **Type-Safe** - Full TypeScript support with EastError handling

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

East Node provides these platform modules:

| Module | Functions | Description |
|--------|-----------|-------------|
| **Console** | `log`, `error`, `write` | Console I/O operations |
| **FileSystem** | `readFile`, `writeFile`, `exists`, `createDirectory`, `openBeast`, etc. | File system operations, including lazily paged beast2 collection files |
| **Fetch** | `get`, `post`, `request` | HTTP client using Fetch API |
| **Crypto** | `randomBytes`, `hashSha256`, `uuid` | Cryptographic operations |
| **Time** | `now`, `sleep` | Time and delay operations |
| **Path** | `join`, `resolve`, `dirname`, `basename`, `extname` | Path manipulation |
| **Random** | `uniform`, `normal`, `range`, `exponential`, `bernoulli`, etc. | Random number generation with statistical distributions |

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
- **[East Documentation](https://github.com/elaraai/east-workspace/tree/main/libs/east)** - Core East language documentation

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
- Controlled I/O operations only
- All operations are type-checked

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

Dual-licensed:
- **Open Source**: [AGPL-3.0](LICENSE.md) - Free for open source use
- **Commercial**: Available for proprietary use - contact support@elara.ai


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
