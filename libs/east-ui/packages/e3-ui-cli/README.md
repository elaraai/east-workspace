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
npm install -g @elaraai/e3-ui-cli
```

Installing pulls in Playwright, whose postinstall downloads a headless Chromium to the shared Playwright cache. If that download was skipped (e.g. `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`), fetch it once with:

```bash
npx playwright install chromium          # the browser binary
npx playwright install --with-deps chromium   # CI/Docker: also installs the OS libraries Chromium needs
```

That is the entire setup — no environment variables required. Under the hood the CLI starts a throwaway local web server for its prebuilt renderer, launches headless Chromium at it, injects your component, and screenshots the result.

### Environment overrides (optional)

For locked-down or containerized environments only:

| Variable | Effect |
|---|---|
| `E3_UI_CHROMIUM_PATH` | Use a specific Chromium/Chrome executable instead of Playwright's managed download. |
| `E3_UI_NO_SANDBOX=1` | Launch Chromium with `--no-sandbox` (needed in many Docker/CI sandboxes). |

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

- **[East UI](https://github.com/elaraai/east-workspace/tree/main/libs/east-ui)**: Typed UI component definitions and React renderer, plus VS Code preview.
  - [@elaraai/east-ui](https://www.npmjs.com/package/@elaraai/east-ui): 50+ typed UI components for layouts, forms, charts, tables, dialogs
  - [@elaraai/east-ui-components](https://www.npmjs.com/package/@elaraai/east-ui-components): React renderer with Chakra UI v3 styling
  - [@elaraai/e3-ui](https://www.npmjs.com/package/@elaraai/e3-ui): e3 + UI bridge — Data bindings, `e3.ui()` task, manifest
  - [@elaraai/e3-ui-components](https://www.npmjs.com/package/@elaraai/e3-ui-components): React Query hooks and preview components for the e3 API
  - [@elaraai/e3-ui-cli](https://www.npmjs.com/package/@elaraai/e3-ui-cli): Render east-ui / e3-ui components to PNG from the command line (`e3-ui shot`)
  - [east-ui-preview](https://marketplace.visualstudio.com/items?itemName=ElaraAI.east-ui-preview): VS Code extension for live East UI component preview

- **[e3 — East Execution Engine](https://github.com/elaraai/east-workspace/tree/main/libs/e3)**: Durable execution engine for running East pipelines at scale.
  - [@elaraai/e3-cli](https://www.npmjs.com/package/@elaraai/e3-cli): `e3 repo`, `e3 package`, `e3 workspace`, `e3 start`, `e3 watch`, `e3 logs` commands

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
