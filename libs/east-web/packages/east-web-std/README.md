# East Web

> Standard platform functions for East programs in a browser

[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE.md)

**East Web** provides the standard platform functions of the [East language](https://github.com/elaraai/east-workspace/tree/main/libs/east) for East programs running in a browser: console output, the clock, random numbers, cryptography, HTTP requests and path manipulation. Each one has the name and East types of its [East Node](https://github.com/elaraai/east-workspace/tree/main/libs/east-node) twin, so a program written for Node — or run on East's C and Python runtimes — runs in a browser unchanged. It uses web-standard globals only and loads no Node module.

## Features

- **Console I/O** - stdout/stderr output, to a sink the host gives
- **Time Operations** - Timestamps, sleep and timezone offsets
- **Random** - Random number generation with statistical distributions; a seed gives East Node's stream, bit for bit
- **Cryptography** - Random bytes, SHA-256, UUID generation
- **HTTP Client** - The browser's Fetch API
- **Path Utilities** - POSIX path manipulation
- **Test Functions** - The functions East test suites call, run through a host
- **Type-Safe** - Full TypeScript support with EastError handling

## Installation

```bash
npm install @elaraai/east-web-std @elaraai/east
```

## Quick Start

```typescript
import { East, NullType } from "@elaraai/east";
import { Console, Crypto, createWebPlatform } from "@elaraai/east-web-std";

// Define an East function using platform functions
const greet = East.asyncFunction([], NullType, $ => {
    const id = $.let(Crypto.uuid());
    $(Console.log(id));
});

// Compile it on a browser platform whose console output the page keeps
let output = "";
const platform = createWebPlatform({
    console: {
        stdout: text => { output += text; },
        stderr: text => { output += text; },
    },
});
await greet.toIR().compile(platform)();
```

## Platform Functions

| Module | Functions | Description |
|--------|-----------|-------------|
| **Console** | `log`, `error`, `write` | Console output, to the host's sink |
| **Time** | `now`, `sleep`, `getTimezoneOffset` | Time, delay and timezone operations |
| **Random** | `uniform`, `normal`, `range`, `exponential`, `bernoulli`, `seed`, etc. | Random number generation with statistical distributions |
| **Crypto** | `randomBytes`, `hashSha256`, `hashSha256Bytes`, `uuid` | Cryptographic operations |
| **Fetch** | `get`, `getBytes`, `post`, `request` | HTTP client using the browser's Fetch API |
| **Path** | `join`, `resolve`, `dirname`, `basename`, `extname` | POSIX path manipulation |

**Complete platform:**
```typescript
import { WebPlatform } from "@elaraai/east-web-std";
const compiled = myFunction.toIR().compile(WebPlatform);
```

**A platform of the program's own** — its console sink, its test host, and a
Random generator no other program shares:
```typescript
import { createWebPlatform } from "@elaraai/east-web-std";
const compiled = myFunction.toIR().compile(createWebPlatform({ console: sink }));
```

**Individual modules:**
```typescript
import { Path, Crypto } from "@elaraai/east-web-std";
const compiled = East.compile(myFunction, [...Path.Implementation, ...Crypto.Implementation]);
```

## In a browser

- **Console** has no standard streams to write to: the host gives a
  `ConsoleSink` with `stdout` and `stderr`, and receives exactly the text the
  program wrote. `WebPlatform` writes to the page's `console`.
- **Path.resolve** resolves a relative path against `/`: a browser has no
  working directory.
- **Fetch** is subject to the browser's rules: a cross-origin request needs the
  server's CORS consent, and some request and response headers are hidden.
- **Crypto.uuid** needs a secure context (a page served over HTTPS, or from
  localhost).
- **Random** starts unseeded with a cryptographic generator; each
  `createWebPlatform()` has its own.

## What is not provided

FileSystem, Env and the large-JSON reader have no meaning in a browser and are
not provided. A program that calls one of them fails to compile, naming the
platform function it called — as East fails any program that calls a platform
function it was not given.

## Development

```bash
make build    # Compile TypeScript
make test     # Run the specs, then East Node's compliance suite over this package
make lint     # Check code quality
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

Dual-licensed:
- **Open Source**: [AGPL-3.0](LICENSE.md) - Free for open source use
- **Commercial**: Available for proprietary use - contact support@elara.ai

Includes code from third-party open source projects under the MIT License — see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

### Ecosystem

- **[East](https://github.com/elaraai/east-workspace/tree/main/libs/east)**: Statically typed, expression-based language with serializable IR. Run portable logic across TypeScript, Python, C, and other runtimes.
  - [@elaraai/east](https://www.npmjs.com/package/@elaraai/east): Core language SDK with type system, expressions, and reference JS compiler

- **[East Node](https://github.com/elaraai/east-workspace/tree/main/libs/east-node)**: Node.js platform functions for I/O, databases, and system operations.
  - [@elaraai/east-node-std](https://www.npmjs.com/package/@elaraai/east-node-std): Console, FileSystem, Fetch, Crypto, Time, Path, Random
  - [@elaraai/east-node-io](https://www.npmjs.com/package/@elaraai/east-node-io): SQLite, PostgreSQL, MySQL, MongoDB, Redis, S3, FTP, SFTP, XLSX, XML, compression
  - [@elaraai/east-node-cli](https://www.npmjs.com/package/@elaraai/east-node-cli): CLI for running East IR programs in Node.js

- **[East Web](https://github.com/elaraai/east-workspace/tree/main/libs/east-web)**: Platform functions for East programs in a browser.
  - [@elaraai/east-web-std](https://www.npmjs.com/package/@elaraai/east-web-std): Console, Fetch, Crypto, Time, Path, Random

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
