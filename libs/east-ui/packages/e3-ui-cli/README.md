# e3-ui CLI

> Render east-ui / e3-ui components to PNG from the command line.

[![License](https://img.shields.io/badge/license-AGPL--3.0%20%2F%20Commercial-blue.svg)](LICENSE.md)
[![Node Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org)

**e3-ui CLI** renders [East UI](https://github.com/elaraai/east-workspace/tree/main/libs/east-ui) components — East functions returning a `UIComponentType` — to PNG images using headless Chromium, for automating UI/UX reviews and generating screenshots. The East→React renderer is pre-bundled into the package; the component is injected as data at runtime, so the only runtime dependency is the browser engine.

## Features

- **Component screenshots**: render a `.ts`/`.tsx` source (`--from-source`) or serialized `.beast2`/`.json` IR (`--from-ir`) to a PNG.
- **Live task screenshots**: render a deployed e3 UI task's output with real, already-computed workspace data (`--from-task`).
- **Self-contained**: the renderer (React + Chakra UI v3 + the full component set) is pre-bundled; no app server or build step at use time.
- **Consistent with e3-cli**: extension-based format detection with a `--from` override, `-o/--output`, and esbuild TypeScript loading.

## Installation

```bash
npm install -g @elaraai/e3-ui-cli   # small — downloads no browser
e3-ui install-browser               # one-time: fetch the version-matched headless Chromium
```

The CLI depends on `playwright-core` (no install-time browser download). `e3-ui install-browser` fetches the `chromium-headless-shell` build (~100 MB lighter than full Chromium, no X11/D-Bus libraries) into the shared playwright cache, version-matched to the CLI. On a **fresh Linux server**, add the OS libraries in the same step:

```bash
sudo e3-ui install-browser --with-deps   # Linux only; Windows/macOS need no system libraries
```

If the CLI already finds a system-installed Chrome/Chromium/Edge, `install-browser` is optional — the launch order is:

1. `E3_UI_CHROMIUM_PATH` (or `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`) — an explicit executable wins.
2. The playwright-managed cache (what `install-browser` fills; honors `PLAYWRIGHT_BROWSERS_PATH`).
3. A system Chrome / Chromium / Edge at the standard per-OS locations. **Ubuntu's snap chromium is detected and skipped** — its confinement breaks automation; use Google Chrome's `.deb` or `install-browser` instead.

Under the hood the CLI starts a throwaway local web server for its prebuilt renderer, launches headless Chromium at it, injects your component, and screenshots the result. Chromium runs sandbox-off (playwright's default) — appropriate for rendering trusted local components, and why running as root on a server just works.

### Headless servers & CI

```bash
e3-ui doctor   # diagnoses the browser setup: env overrides, launch cascade, remediation
```

- Share one browser cache across users/agents with `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` (set it for both `install-browser` and `shot`).
- Reinstalling/upgrading the CLI can move to a new browser revision — if `shot` reports a missing executable, re-run `e3-ui install-browser`.
- Docker: `mcr.microsoft.com/playwright` images work out of the box, or add `e3-ui install-browser --with-deps` to your own image.

## Quick Start

```bash
# A .tsx exporting an East function returning a UIComponentType:
e3-ui shot --from-source ./dashboard.tsx -o dashboard.png

# Pick one export, set a viewport, also emit standalone HTML:
e3-ui shot --from-source ./widgets.tsx --export statCard --viewport 800x600 --html

# Serialized component IR (e.g. produced by an e3 export):
e3-ui shot --from-ir ./component.beast2 -o component.png

# A live e3 UI task's rendered output (dataflow must have already run):
e3-ui shot --from-task main.dashboard --repo ./my-repo -o dashboard.png
```

## Sources

One screenshot verb, one source per run (mirroring e3-cli's `--from-zip` / `--from-source`):

| Source | Description |
|---|---|
| `--from-source <file>` | A `.ts`/`.tsx` component source. Static and `State`-only components render with no backend. **Runs the file and its imports as Node code** (like ts-node) — only point it at code you trust. |
| `--from-ir <file>` | Serialized component IR (`.beast2`/`.json`); `-` reads from stdin. |
| `--from-task <ws.task> --repo <repo>` | A live e3 UI task's output with real bound data (via `@elaraai/e3-api-client`). The workspace dataflow must have already produced the task output. |

`e3-ui shot --help` lists all flags (`--export`, `--output`, `--html`, `--viewport`, `--dpr`, `--full-page`, `--element`, `--wait`, `--timeout`, `--storage-key`).

`--from-source` also accepts a file exporting an e3 `ui()` task (e.g. a create-e3 `--ui` scaffold's `src/ui/index.tsx`) — the task's stored component function is rendered. Tasks with compute-time inputs can't render standalone; use `--from-task` against a deployed workspace for those.

## Programmatic API

```ts
import { renderToPng } from "@elaraai/e3-ui-cli";

await renderToPng({
    input: { path: "./dashboard.tsx" },
    output: "dashboard.png",
});
```

## Development

`make build`, `make test`, `make lint` from this directory. See [`MAKEFILE_TARGETS.md`](../../../../docs/conventions/MAKEFILE_TARGETS.md) for the full target list. The browser app under `app/` is bundled into `dist/app` by `scripts/build-app.mjs` as the second half of `make build`.

## Documentation

- [CONTRIBUTING.md](CONTRIBUTING.md) — contributing + CLA
- [LICENSE.md](LICENSE.md) — license

## License

Dual-licensed under AGPL-3.0 and a commercial license. See [LICENSE.md](LICENSE.md).

<!-- Ecosystem block — keep in sync with docs/snippets/ECOSYSTEM.md -->

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
  - [@elaraai/e3-ui-cli](https://www.npmjs.com/package/@elaraai/e3-ui-cli): Render east-ui / e3-ui components to PNG from the command line (`e3-ui shot`)
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
