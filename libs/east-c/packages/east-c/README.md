# east-c

> C runtime for the East programming language — core types, IR interpreter, builtins, serialization

[![License](https://img.shields.io/badge/license-BUSL--1.1-orange.svg)](LICENSE.md)

**east-c** is the core C11 implementation of the East language runtime. It links into [`east-c-cli`](../east-c-cli) for command-line use and into [`east-c-std`](../east-c-std) for standard platform functions.

## Features

- **C11 standard** — portable across Linux, macOS, and other POSIX systems
- **Reference counting with cycle collector** — CPython-style trial-deletion GC for deterministic memory management
- **Tree-walking interpreter** — faithfully executes East IR without code generation
- **Full serialization** — Beast2, JSON, CSV, and East text formats
- **200+ builtins** — array, set, dict, string, datetime, blob, integer, float operations
- **Compliance suite** — passes the same IR test corpus as the TypeScript and Python reference runtimes

The TypeScript package `@elaraai/east` is the reference implementation; this package's `tests/compliance/` runs IR files exported from the TS side to confirm parity.

## Build

Requires CMake 3.16+ and a C11 compiler.

```bash
make build    # Build all packages (from libs/east-c/)
make test     # Run unit tests (ctest)
make clean    # Remove build directory
```

See [`docs/conventions/MAKEFILE_TARGETS.md`](../../../../docs/conventions/MAKEFILE_TARGETS.md) for the full target list.

## Compliance tests

IR JSON test files are exported from the TypeScript [east](https://github.com/elaraai/east-workspace/tree/main/libs/east) project:

```bash
# Export IR from TS side (workspace root)
make test-export

# Run compliance tests
make compliance        # east-c core
make compliance-std    # east-c-std (sibling package)
make compliance-all    # both

# Single compliance test
./build/packages/east-c/test_compliance /tmp/east-test-ir/Array.json
```

## Architecture

- `include/east/` — public headers
- `src/builtins/` — builtin operations (integer, float, string, array, set, dict, datetime, blob)
- `src/serialization/` — JSON, Beast2, CSV, East text
- `src/type_of_type.c` — IR JSON decoder
- `tests/` — unit tests + compliance runner
- `scripts/` — compliance runner, leak checker, profiler

## Reference implementations

- TypeScript: [`libs/east`](https://github.com/elaraai/east-workspace/tree/main/libs/east) (the canonical)
- Python: [`libs/east-py/packages/east-py`](https://github.com/elaraai/east-workspace/tree/main/libs/east-py/packages/east-py)
- Standard platform parity: [`libs/east-node/packages/east-node-std`](https://github.com/elaraai/east-workspace/tree/main/libs/east-node/packages/east-node-std)

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

Business Source License 1.1 — see [LICENSE.md](LICENSE.md). Free for non-production use; commercial license required for production by for-profit entities. Converts to AGPL-3.0 four years after each release.

Commercial licensing: support@elara.ai.

<!-- Ecosystem — keep in sync with docs/snippets/ECOSYSTEM.md -->

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

- **Website**: https://elaraai.com/
- **Repository**: https://github.com/elaraai/east-workspace
- **Issues**: https://github.com/elaraai/east-workspace/issues
- **Email**: support@elara.ai

<!-- About Elara — keep in sync with docs/snippets/ABOUT_ELARA.md -->

## About Elara

East is developed by [Elara AI Pty Ltd](https://elaraai.com/), an AI-powered platform that creates economic digital twins of businesses that optimize performance. Elara combines business objectives, decisions and data to help organizations make data-driven decisions across operations, purchasing, sales and customer engagement, and project and investment planning. East powers the computational layer of Elara solutions, enabling the expression of complex business logic and data in a simple, type-safe and portable language.

---

*Developed by [Elara AI Pty Ltd](https://elaraai.com/).*
