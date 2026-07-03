---
name: e3-ui-cli
description: "Render east-ui / e3-ui components to PNG (and standalone HTML) from the command line or programmatically, using a managed headless Chromium. Use when: (1) Screenshotting an east-ui component or e3-ui decision surface with `e3-ui shot` — from a .ts/.tsx source file, serialized .beast2/.json IR, or a live e3 task's computed output, (2) Rendering ONE example from a `*.examples.ts(x)` file (`--from-source <file> -e <exampleName>` — example() defs are unwrapped to their fn), or EVERY renderable UI export in a project (`e3-ui shots` — sweeps sources into a structured, git-ignored `.shots/` dir with typed skip reasons), (3) Rendering a create-e3 --ui scaffold's src/ui/index.tsx (a ui() task) to an image, (4) Setting up or troubleshooting the headless browser on a server or CI (`e3-ui install-browser`, `e3-ui doctor`, PLAYWRIGHT_BROWSERS_PATH, snap-chromium problems), (5) Rendering PNGs from Node with renderToPng / renderTaskToPng / capture."
---

# e3-ui CLI (@elaraai/e3-ui-cli)

Render east-ui / e3-ui components — East functions returning a
`UIComponentType`, or e3 `ui()` tasks — to PNG images (and optionally
self-contained HTML) with headless Chromium. The East→React renderer is
pre-bundled into the package; the component is injected as data, so the only
external runtime dependency is the browser binary, which the CLI manages.

## Quick Start

```bash
npm install -g @elaraai/e3-ui-cli   # small — downloads no browser
e3-ui install-browser               # one-time per machine (add --with-deps on fresh Linux servers)

# A .tsx exporting an East function returning UIComponentType (or a ui() task):
e3-ui shot --from-source ./dashboard.tsx -o dashboard.png

# ONE example from an examples file — example() defs are unwrapped to their fn.
# -e is effectively required: examples files export many.
e3-ui shot --from-source test/collections/schematic.examples.tsx -e schematicNets -o nets.png

# A live e3 UI task's output with real workspace data (dataflow must have run):
e3-ui shot --from-task main.dashboard --repo ./.repos -o dashboard.png

# EVERYTHING renderable under src/ → .shots/<relative-path>/<export>.png
# (one shared browser; skips carry typed reasons; exit 1 on render failures):
e3-ui shots src --out .shots --json
```

```ts
import { renderToPng } from "@elaraai/e3-ui-cli";

await renderToPng({ input: { path: "./dashboard.tsx" }, output: "dashboard.png" });
```

## Decision Tree

```
Render a component to an image
├─ EVERYTHING in a project (audit the renderable surface)
│                                             → e3-ui shots [paths…] --out .shots [--html] [--json]
│                                                every export is classified at the IR level (output type
│                                                vs UIComponentType, zero inputs, platform calls) — skips
│                                                are listed with reasons, never silently dropped
├─ From TypeScript source (.ts/.tsx)          → e3-ui shot --from-source <file> [-e <export>]
│   ├─ exports an East fn → UIComponentType   → rendered directly
│   ├─ exports example() defs (*.examples.*)  → -e <exampleName> per shot (the def's fn is unwrapped;
│   │                                            without -e the file must have a SOLE renderable export)
│   ├─ exports an e3 ui() task (zero inputs)  → unwrapped and rendered (create-e3 --ui scaffold: npm run shot)
│   └─ ui() task WITH compute-time inputs     → not standalone-renderable → use --from-task
├─ From serialized IR (.beast2/.json, stdin)  → e3-ui shot --from-ir <file|->
├─ From a deployed e3 workspace task          → e3-ui shot --from-task <ws.task> --repo <path>
└─ From Node code                             → renderToPng / renderTaskToPng

What KIND of component is it?
├─ Self-sized (cards, stacks, forms, charts…) → shot renders true to layout
├─ Width-flexible (Schematic, Gantt, Table…)  → pass --frame-width full (the `shots` sweep DEFAULT) to
│                                                mount the frame at viewport width; the default single-shot
│                                                frame is shrink-to-fit and collapses these
├─ Reads e3 data (Data.bind / Decision.bind)  → a standalone shot has NO workspace: use --from-task
│                                                against a deployed repo, or (monorepo) the seeded
│                                                harness: make e3-ui-examples-html-<key>
└─ Browser-local State.bind only              → renders standalone (initial state)

Browser setup / problems
├─ Fresh machine or CI                        → e3-ui install-browser [--with-deps]
├─ "Could not launch" / anything unclear      → e3-ui doctor
├─ Fleet-shared cache                         → PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers (install + shot)
├─ Force a specific binary                    → E3_UI_CHROMIUM_PATH=/path/to/chrome
└─ Ubuntu snap chromium                       → never used (auto-skipped); install-browser or Chrome .deb
```

## CLI Reference

### `e3-ui shot`

Exactly one `--from-*` source per run.

| Flag | Description |
|---|---|
| `--from-source <file>` | Render a `.ts`/`.tsx` source. **Runs the file and its imports as Node code** — only point it at code you trust. |
| `--from-ir <file>` | Render serialized component IR (`.beast2`/`.json`); `-` reads stdin. |
| `--from-task <ws.task>` | Render a live e3 task's computed output (requires `--repo`). |
| `--repo <path>` | Local e3 repository path for `--from-task`. |
| `-e, --export <name>` | Which export to render (default: the `default` export, then the SOLE renderable export). Required in practice for `*.examples.*` files — they export many; an `example()` def is unwrapped to its `fn`. |
| `-o, --output <path>` | Output PNG path (default: derived from the source / task name). |
| `--html` | Also write a self-contained HTML (fonts inlined, no scripts) next to the PNG. |
| `--viewport <WxH>` | Chromium viewport (default 1280x900). |
| `--dpr <n>` | Device scale factor (default 2). |
| `--full-page` | Capture the whole page instead of the component frame. |
| `--element <selector>` | Capture a specific CSS selector. |
| `--wait <ms>` | Extra settle time after fonts/skeletons clear (default 300). |
| `--timeout <ms>` | Max wait for the render (default 30000); raise for slow live tasks. |
| `--frame-width <w>` | Mount the component frame at a definite width — `full` (viewport) or a CSS width (`900px`). Width-flexible components (Schematic/Gantt/Table) collapse in the default shrink-to-fit frame. |

### `e3-ui shots [paths…]`

Sweep files/directories (default `src`; directories recurse, `*.spec.*` and `*.d.ts` excluded) for EVERY renderable UI export — bare East fns, `example()` defs, zero-input `ui()` tasks — and render each to `<out>/<relative-path>/<export>.png` through ONE shared browser. Renderability is decided from the IR (east's own `isSubtypeValue` against the project's `UIComponentType`; `walkIR` for platform calls), so every skip carries its typed reason: wrong output type, takes inputs, parameterized ui() task, workspace-bound (`data_*`/`func_*`/`record_*` reads → use `--from-task`), or failed to load. Render failures exit non-zero.

| Flag | Description |
|---|---|
| `--out <dir>` | Output directory (default `.shots` — git-ignore it). |
| `--html` | Also write a standalone HTML beside each PNG. |
| `--json` | Also write `<out>/manifest.json` (rendered / skipped / failed, with reasons). |
| `--frame-width <w>` | `full` (default — faithful width), a CSS width, or `none` for the shrink-to-fit crop. |
| `--viewport`, `--dpr`, `--wait`, `--timeout` | As for `shot`. |

### `e3-ui install-browser [--with-deps]`

Downloads the version-matched `chromium-headless-shell` into the
playwright-managed cache (honors `PLAYWRIGHT_BROWSERS_PATH`). ~100 MB lighter
than full Chromium. `--with-deps` also installs OS libraries (Linux only —
skipped with a note on Windows/macOS). Re-run after upgrading the CLI if
`shot` reports a missing executable.

### `e3-ui doctor`

Prints the env-override state, runs the real launch cascade against
`about:blank`, and reports what worked — or the exact remediation.

### Browser launch order (all platforms)

1. `E3_UI_CHROMIUM_PATH` / `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` env override.
2. The playwright-managed cache (what `install-browser` fills).
3. A system Chrome / Chromium / Edge at standard per-OS locations — Ubuntu
   snap shims are detected and skipped (snap confinement breaks automation).

Chromium runs sandbox-off (playwright's default) — appropriate for rendering
trusted local components; running as root on a server just works.

## Programmatic API

| Signature | Description |
|---|---|
| `renderToPng(opts)` | Full pipeline for source/IR inputs: load → encode payload → capture PNG (+ optional HTML). |
| `renderTaskToPng(opts)` | Start a local e3 API server over `repo`, render the task's computed output. |
| `capture(opts)` | Low-level: serve the prebuilt app, launch the browser, inject a `ShotPayload`, screenshot. |
| `buildPayload(input)` | Turn a source/IR input into the base64 payload `capture` consumes. |
| `loadComponentFromSource(file, exportName?)` | esbuild-load a `.ts`/`.tsx` in memory; returns the East function (unwraps `example()` defs to their `fn`, and zero-input `ui()` tasks). ❗ throws for parameterized ui() tasks |
| `sweep(opts)` | The `shots` sweep: discover → classify (IR-level) → render through one `CaptureSession`; returns `{ rendered, skipped, failed }`. |
| `classifyExports(exports, ctx)` / `detectContextFor(file)` | IR-level renderability detection — output type vs the PROJECT's `UIComponentType`, zero-input check, `walkIR` platform classification. |
| `openCaptureSession(appDir)` | One served app + one browser for many `captureOne(...)` calls (what `sweep` uses). |
| `launchBrowser(env?)` | The acquisition cascade; returns `{ browser, source }`. ❗ throws with remediation when no browser |
| `installBrowser({ withDeps? })` | Programmatic `install-browser`. |
| `doctor(env?)` | Programmatic `doctor`; returns a process exit code. |
| `startRepoServer(opts)` | Spin up the local e3 API server used by `--from-task`. |

## Key Patterns

```bash
# create-e3 --ui scaffold: the generated shot script renders the surface
npm run shot        # = e3-ui shot --from-source src/ui/index.tsx --export surface -o surface.png

# One example() from an examples file (self-sized component) — name the export
e3-ui shot --from-source test/display/combine.examples.tsx -e combineDensities -o combine.png

# Width-flexible component (Schematic/Gantt/Table) — mount the frame at viewport width
e3-ui shot --from-source test/collections/schematic.examples.tsx -e schematicStress --frame-width full -o stress.png

# Sweep a whole project (the --ui scaffold wires this as `npm run shots`):
e3-ui shots src --out .shots            # PNGs, faithful width, typed skip reasons
e3-ui shots src --out .shots --html     # + standalone HTML pairs

# Data-bound e3-ui example (Data.bind / Decision.bind) — the sweep SKIPS these as
# workspace-bound; render from a deployed repo (or, in the east monorepo, the
# seeded harness: make e3-ui-examples-html-decision/queue):
e3-ui shot --from-task main.queue --repo ./.repos -o queue.png

# CI / server bootstrap (one-time, cache shared across runs)
export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
sudo -E e3-ui install-browser --with-deps
e3-ui doctor

# Pipe IR produced elsewhere
some-tool --emit-ir | e3-ui shot --from-ir - -o out.png
```

## Related skills

- **east-ui** — authoring the components this CLI renders (JSX tags, `UIComponentType`).
- **e3-ui** — `ui()` tasks, `Data.bind`, decision surfaces; `--from-task` renders their computed output.
- **e3** — repositories, workspaces, dataflow; produce the task outputs `--from-task` consumes.
- **east-project** — scaffolding a project whose `--ui` option wires `npm run shot`.
