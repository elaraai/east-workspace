# East Python

> Python runtime and platform functions for the East language

[![Python Version](https://img.shields.io/badge/python-%3E%3D3.11-brightgreen.svg)](https://python.org)
[![uv](https://img.shields.io/badge/uv-package%20manager-blueviolet.svg)](https://docs.astral.sh/uv/)
[![License: BSL 1.1](https://img.shields.io/badge/License-BSL%201.1-orange.svg)](LICENSE.md)

**East Python** provides the Python runtime for executing [East language](https://github.com/elaraai/east-workspace/tree/main/libs/east) programs, including the core compiler, 200+ builtins, and platform functions for I/O, data science, and machine learning.

## Packages

### Python Runtime

| Package | Description |
|---------|-------------|
| [east-py](packages/east-py/) | Core runtime - type system, IR compiler, 200+ builtins, serialization |
| [east-py-std](packages/east-py-std/) | Standard platform functions - console, crypto, fetch, fs, path, random, time |
| [east-py-io](packages/east-py-io/) | I/O platform functions - S3, databases, file formats, compression |
| [east-py-datascience](packages/east-py-datascience/) | Data science & ML - optimization, gradient boosting, neural networks, explainability |
| [east-py-cli](packages/east-py-cli/) | CLI for running East IR programs |

### TypeScript Type Definitions

| Package | Description | npm | License |
|---------|-------------|-----|---------|
| [@elaraai/east-py-datascience](packages/east-py-datascience/) | TypeScript types for data science platform functions | [![npm](https://img.shields.io/npm/v/@elaraai/east-py-datascience)](https://www.npmjs.com/package/@elaraai/east-py-datascience) | [![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](packages/east-py-datascience/LICENSE.md) |

## Features

### Core Runtime (east-py)
- **Type System** - Full East type support including primitives, structs, variants, arrays, sets, maps
- **IR Compiler** - Compiles and executes East IR with platform function dispatch
- **200+ Builtins** - Math, strings, collections, dates, JSON, regex, and more
- **Serialization** - MessagePack-based binary format for efficient data transfer

### Platform Functions
- **Standard** - Console I/O, cryptography, HTTP fetch, filesystem, paths, random, time
- **I/O** - S3, PostgreSQL, MongoDB, Redis, Parquet, CSV, Excel, compression
- **Data Science** - MADS, Optuna, SimAnneal, XGBoost, LightGBM, NGBoost, PyTorch, GP, SHAP

## Quick Start

```bash
# Create a new project
uv init myproject && cd myproject

# Install packages
uv add git+https://github.com/elaraai/east-workspace/tree/main/libs/east-py#subdirectory=packages/east-py
uv add git+https://github.com/elaraai/east-workspace/tree/main/libs/east-py#subdirectory=packages/east-py-std
uv add git+https://github.com/elaraai/east-workspace/tree/main/libs/east-py#subdirectory=packages/east-py-io
uv add git+https://github.com/elaraai/east-workspace/tree/main/libs/east-py#subdirectory=packages/east-py-datascience
```

## Development

### Prerequisites

- Python 3.11+
- [uv](https://docs.astral.sh/uv/) package manager
- Docker (for east-py-io integration tests)

### Setup

```bash
make install      # Install dependencies
make install-cli  # Install east-py command globally
```

### Commands

```bash
make test         # Run all tests
make lint         # Run linter
make typecheck    # Run type checker
make check        # Run lint + typecheck + test
make help         # Show all available commands
```

### Docker Services

east-py-io requires Docker for integration tests:

```bash
make services-up    # Start Docker services
make services-down  # Stop Docker services
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

This project uses multiple licenses:

| Package | License |
|---------|---------|
| `east-py` | BSL 1.1 |
| `east-py-std` | BSL 1.1 |
| `east-py-io` | BSL 1.1 |
| `east-py-datascience` (Python) | BSL 1.1 |
| `east-py-datascience` (TypeScript) | Dual AGPL-3.0 / Commercial |
| `east-py-cli` | BSL 1.1 |

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
