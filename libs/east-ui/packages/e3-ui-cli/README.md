# e3-ui CLI

> Browse an e3 repository in the terminal, and render east-ui / e3-ui components to PNG.

[![License](https://img.shields.io/badge/license-AGPL--3.0%20%2F%20Commercial-blue.svg)](LICENSE.md)
[![Node Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org)

**e3-ui CLI** is two things in one command. With no subcommand it is a full-screen **terminal UI** over an [e3](https://github.com/elaraai/east-workspace/tree/main/libs/e3) repository — local or remote — showing a workspace's task and dataset status, its dataflow runs (start and cancel them), every task's output as a lazily paged value tree, its logs and run history, and editable inputs. With `shot` / `shots` it renders [East UI](https://github.com/elaraai/east-workspace/tree/main/libs/east-ui) components — East functions returning a `UIComponentType` — to PNG images using headless Chromium, for automating UI/UX reviews and generating screenshots. The East→React renderer is pre-bundled into the package; the component is injected as data at runtime, so the only runtime dependency of the screenshots is the browser engine, and the terminal UI never needs one.

## Features

- **Terminal UI** (`e3-ui [repo] [workspace]`): the workspace dashboard, `/run` and `/stop` with a live event feed, task views (a paged value tree with `/find` and `/goto`, logs with tail-follow, the run history, a `ui()` task's manifest), editable inputs with a commit bar and conflict detection, a command box with completion, vim-style keys and the mouse, remote repositories over the same credentials as `e3 auth`.
- **Component screenshots**: render a `.ts`/`.tsx` source (`--from-source`) or serialized `.beast2`/`.json` IR (`--from-ir`) to a PNG.
- **Live task screenshots**: render a deployed e3 UI task's output with real, already-computed workspace data (`--from-task`).
- **Self-contained**: the renderer (React + Chakra UI v3 + the full component set) is pre-bundled; no app server or build step at use time.
- **Consistent with e3-cli**: extension-based format detection with a `--from` override, `-o/--output`, and esbuild TypeScript loading.

## Installation

```bash
npm install -g @elaraai/e3-ui-cli   # small — downloads no browser
e3-ui ./my-repo                     # the terminal UI needs nothing else
e3-ui install-browser               # for screenshots: fetch the version-matched headless Chromium once
```

## Terminal UI

```bash
e3-ui                                    # $E3_REPO, then the current directory
e3-ui ./my-repo main                     # a workspace's dashboard
e3-ui ./my-repo main --task forecast     # straight to a task (--input <name> for an input)
e3-ui https://e3.example.com/repos/demo  # remote — after: e3-ui auth login https://e3.example.com
e3-ui https://e3.example.com             # a bare origin: the repositories list
e3-ui --no-mouse --ascii ./my-repo       # keyboard only, box-drawing off (also E3_UI_ASCII=1)
```

A local repository is served by an embedded `@elaraai/e3-api-server` for the session; a remote one is reached with the token `e3-ui auth login` saved (the same device flow and `~/.e3/credentials.json` store as `e3 auth`, so either login serves both). Everything is one screen at a time — repositories, workspaces, a workspace's dashboard, a task (`1 Output · 2 Logs · 3 Runs`, plus `4 Reads` for a `ui()` task), an input — with a **command box** along the bottom:

| Type | Effect |
|---|---|
| `/task <name>` · `/input <name>` · `/workspace <name>` · `/repo <path\|url>` | open things; plain text without `/` fuzzy-jumps to any of them |
| `/run [--force] [--filter <glob>] [--concurrency <n>]` · `/stop` | start / cancel the dataflow (`r` / `x` prefill them); the header pill and the execution panel follow it live |
| `/find <key>` · `/goto <row\|N%>` · `/save [file]` | in a value tree: exact `"key"`, prefix, or struct-key fields `a\|b`; jump; write the `.beast2` bytes |
| `e` `a` `x` `t` · `⏎ APPLY` · `esc DISCARD` | in an input: edit a leaf, add, remove, tag / set; the commit bar sums the pending changes |
| `?` | help for the page you are on; `q` quits, `esc` goes back |

Keys are vim-friendly (`j k h l`, `gg G`, `^u ^d`), the mouse scrolls, selects and drags the scrollbar, and the terminal is restored on every exit path. Without a TTY on both ends (`e3-ui | cat`, CI) the UI refuses with exit 1 and points at `e3 workspace status` / `e3 dataset get` instead. State (the last repository and workspace, each value tree's expand-set) lives in `$XDG_STATE_HOME/e3-ui/state.json` (`E3_UI_STATE` overrides; mode 0600); `E3_UI_DEBUG=1` writes a `debug.log` beside it. Below 60×16 the app refuses; narrower terminals get tighter tables. The design and its mocks are in [`docs/tui/DESIGN_TUI.md`](docs/tui/DESIGN_TUI.md).

## Screenshots

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

`make build`, `make test`, `make lint` from this directory. See [`MAKEFILE_TARGETS.md`](../../../../docs/conventions/MAKEFILE_TARGETS.md) for the full target list. The browser app under `app/` is bundled into `dist/app` by `scripts/build-app.mjs` as the second half of `make build`. The terminal UI lives under `src/tui/` (an Ink app over a reducer store; every view has a frame spec against an in-memory API fake); `E3_UI_INTEGRATION=1 make test` also runs the integration smoke over a real embedded server and a repository seeded at test time.

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
  - [@elaraai/e3-ui-cli](https://www.npmjs.com/package/@elaraai/e3-ui-cli): Browse an e3 repository in the terminal (`e3-ui [repo]`), and render east-ui / e3-ui components to PNG (`e3-ui shot`)
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
