---
name: e3-ui-cli
description: "Browse an e3 repository in the terminal, and render east-ui / e3-ui components to PNG. Use when: (1) Opening an e3 repository interactively — `e3-ui [repo] [workspace]` (a local path, `https://host/repos/<repo>`, or a bare origin) shows a workspace dashboard (task / dataset status, the last or live dataflow run), task views (a lazily paged value tree of the output with /find and /goto, logs with tail-follow, the run history, a ui() task's manifest), editable inputs with a commit bar, and `/run` / `/stop`, all driven by a command box with completion, vim-style keys and the mouse, (2) Signing in to a remote e3 server for the terminal UI (`e3-ui auth login|logout|status|token|whoami` — the same device flow and store as `e3 auth`), (3) Screenshotting an east-ui component or e3-ui decision surface with `e3-ui shot` — from a .ts/.tsx source file, serialized .beast2/.json IR, or a live e3 task's computed output, (4) Rendering ONE example from a `*.examples.ts(x)` file (`--from-source <file> -e <exampleName>`) or EVERY renderable UI export in a project (`e3-ui shots`), (5) Setting up or troubleshooting the headless browser on a server or CI (`e3-ui install-browser`, `e3-ui doctor`), (6) Rendering PNGs from Node with renderToPng / renderTaskToPng / capture."
---

# e3-ui CLI (@elaraai/e3-ui-cli)

Two things in one command. With no subcommand, `e3-ui` is a full-screen
**terminal UI** over an e3 repository — local (an embedded
`@elaraai/e3-api-server`, exactly as `e3-ui shot --from-task` and the VS Code
extension already do) or remote (`https://host/repos/<repo>` with the token
`e3-ui auth login` saved). With `shot` / `shots` it is the **renderer** that
turns east-ui / e3-ui components — East functions returning a
`UIComponentType`, or e3 `ui()` tasks — into PNG images (and optionally
self-contained HTML) with headless Chromium. The East→React renderer is
pre-bundled; the only external runtime dependency is the browser binary,
which the CLI manages, and the terminal UI never needs it.

## Before writing code — search the example index

Every East API has a tested example in the plugin's index — the index IS the
API reference, printed from each example's IR in TypeScript or python. Before
writing or changing East code:

1. Call `mcp__plugin_east_east__search_east_examples` for each capability you
   are about to use — `language: "python"` for east-py, `"typescript"`
   otherwise. Summaries come back first: id, signature, the inputs and the
   expected result, a few hundred bytes each.
2. Fetch the one or two that match with `mcp__plugin_east_east__get_east_example`
   and pattern your code on them.
3. Do not read `node_modules/@elaraai/**` or `*.examples.ts` files wholesale,
   and do not reason from `.d.ts` signatures: the index holds the same
   programs, exact and far cheaper, and the signatures omit the runtime rules
   that make East code correct.

Nothing is injected for you; the search is the step.

## Quick Start

```bash
npm install -g @elaraai/e3-ui-cli   # small — downloads no browser

# The terminal UI (the default command) over a local repository:
e3-ui ./my-repo                          # → the workspace dashboard, or the workspaces list
e3-ui ./my-repo main --task forecast     # straight to a task; --input <name> opens an input
e3-ui https://e3.example.com/repos/demo  # remote — needs a saved token:
e3-ui auth login https://e3.example.com  # the same device flow + store (~/.e3/credentials.json) as `e3 auth`
e3-ui https://e3.example.com             # a bare origin → the repositories list

# Screenshots need the browser once per machine (add --with-deps on fresh Linux servers):
e3-ui install-browser
e3-ui shot --from-source ./dashboard.tsx -o dashboard.png
e3-ui shot --from-source test/collections/schematic.examples.tsx -e schematicNets -o nets.png
e3-ui shot --from-task main.dashboard --repo ./.repos -o dashboard.png
e3-ui shots src --out .shots --json      # EVERYTHING renderable under src/
```

```ts
import { renderToPng } from "@elaraai/e3-ui-cli";

await renderToPng({ input: { path: "./dashboard.tsx" }, output: "dashboard.png" });
```

## The terminal UI

`e3-ui [repo] [workspace]` — `repo` defaults to `$E3_REPO`, then `.`, and is
resolved with e3's own grammar: a local path, `https://host/repos/<repo>`,
or a bare `https://host` (the repositories list). The first view is the
workspace given, else the one remembered for that repository, else the only
one, else the workspaces list; `--task <name>` / `--input <name>` open a task
or an input straight away. Without a TTY on both ends (`e3-ui | cat`, CI) it
refuses on stderr with exit 1 and points at the scriptable commands — the UI
is never started and Ink is never loaded.

| Screen | What it shows · what `⏎` does |
|---|---|
| **Repositories** (bare origin) | NAME · WORKSPACES · PACKAGES · OBJECTS · LAST DEPLOY; `⏎` binds one |
| **Workspaces** | NAME · STATE · PACKAGE · TASKS (`● 4  ◐ 1  ✗ 1`) · LAST RUN; `⏎` opens the dashboard |
| **Dashboard** | TASKS / DATASETS counts + the accounted bar, the last execution (its failures) or the live event feed, the tasks and inputs tables; `⏎` opens the task / input / a failed task's logs |
| **Task** `1 Output · 2 Stdout · 3 Stderr · 4 Runs (· 5 Reads)` | the output as a value tree (paged in 500-row windows for collections, whole ≤ 200 KB otherwise, with the *no output* / *too large* / *not indexed* states), each log stream with tail-follow (the Stderr tab shows its line count), the run history, a `ui()` task's manifest |
| **Input** | the same tree, editable: `e` edit a leaf, `a` add, `x` remove, `t` tag / set; the commit bar sums the pending ops, `⏎ APPLY` writes them, `esc DISCARD`; a value changed on the server while editing raises a banner (`⏎` reloads and re-applies) |
| **Help** `?` | a tab per page — only the commands and keys that work where you are |

### The command box

`/` opens it; `Tab` completes; `⏎` runs; `esc` cancels. Plain text without
`/` fuzzy-jumps to any workspace, task, input or dataset. Every command shows
its consequence before `⏎` (`run 6 tasks in main, ignoring the cache ·
concurrency 4`); a confirmation is the same command re-run with `--force`.

| Command | Effect |
|---|---|
| `/task <name>` · `/input <name>` · `/dataset <path>` | open a task / input / dataset (`.inputs.x`, `.tasks.x.output`) |
| `/workspace <name>` · `/workspaces` · `/repos` · `/repo <path\|url>` | switch workspace · the lists · open another repository |
| `/run [--force] [--filter <glob>] [--concurrency <n>]` · `/stop` | start / cancel the dataflow (`r` / `x` prefill them) |
| `/logs <task> [stderr]` · `/runs <task>` | a task's stdout (or stderr) / run history |
| `/find <key>` · `/goto <row\|N%>` · `/save [file] [--force]` | in a value tree: exact `"key"`, prefix, or struct-key fields `a\|b`; jump by row or percent; write the `.beast2` bytes (`.log` for logs) |
| `/tag <name>` · `/add [key]` · `/remove [--force]` · `/apply` · `/discard [--then "<cmd>"]` · `/reload` | editing an input |
| `/login <url>` · `/refresh` · `/help` · `/about` · `/quit [--force]` | the device-flow login · poll every feed now · … |

### Keys

| Where | Keys |
|---|---|
| everywhere | `?` help · `q` `^c` quit · `esc` `⌫` back · `/` a command · `1 2 3 …` tabs · `R` refresh · `tab` next pane |
| lists | `↑↓ j k` move · `pgup pgdn ^u ^d` page · `gg G` top / bottom · `⏎ →` open · `r` `/run` · `x` `/stop` · `w` workspaces |
| value tree | `→ l` expand or next · `← h` collapse or parent · `⏎ space` toggle · `⇧←` collapse deep · `n N` next / prev match · `s` save |
| stdout / stderr | `↑↓` scroll (pauses follow) · `G` end · `F` follow · `2` `3` the other stream · `s` save · `c` copy (OSC 52) · `n N` matches |
| inputs | `e` edit · `a` add · `x` remove · `t` tag / set · `⏎` apply all · `esc` discard · in an editor: `⏎` commit · `esc` cancel · `space` toggles a boolean |
| mouse | wheel scrolls the pane under the cursor · click selects (on `▸` toggles) · drag the scrollbar thumb · click tabs, crumbs, pills, completion rows · `--no-mouse` |

### Environment and files

| Variable / file | Effect |
|---|---|
| `E3_REPO` | the default repository argument |
| `~/.e3/credentials.json` (`E3_CREDENTIALS_PATH`) | the token store, shared with `e3 auth` |
| `$XDG_STATE_HOME/e3-ui/state.json` (`E3_UI_STATE`) | the last repository, each repository's last workspace and view, every value tree's expand-set and top row (0600, atomic) |
| `E3_UI_DEBUG=1` | appends a `debug.log` beside the state file (never to the screen) |
| `E3_UI_ASCII=1` / `--ascii` · `TERM=linux` · a non-UTF-8 locale | the ASCII glyph set |
| `NO_COLOR` / `FORCE_COLOR` | colour off / on (else the terminal's depth) |
| `--no-mouse` · `TERM=dumb` · a non-TTY | mouse reporting off (keyboard only) |

Terminals: works over SSH and in tmux (`set -g mouse on` for the wheel and
drag there); in Kitty, iTerm2, WezTerm, Ghostty, GNOME Terminal, Windows
Terminal and the VS Code terminal the mouse just works; elsewhere the wheel
still scrolls because terminals turn it into arrow keys on the alternate
screen. Below 60×16 the app refuses; 80–99 columns tightens the tables,
60–79 drops their secondary columns.

## Decision Tree

```
Look at / operate a repository
├─ Interactively (status, runs, outputs, logs, inputs) → e3-ui [repo] [workspace]   (the terminal UI)
│   ├─ a remote server                                  → e3-ui auth login <url>, then e3-ui https://host/repos/<repo>
│   ├─ a specific task or input                         → --task <name> / --input <name>
│   └─ no TTY (a script, CI)                            → e3 workspace status · e3 dataset get (the UI refuses)
└─ As an image of a UI component                        → e3-ui shot / shots (below)

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
├─ Width-flexible (Schematic, Plan, Table…)   → pass --frame-width full (the `shots` sweep DEFAULT) to
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

### `e3-ui [repo] [workspace]`

The terminal UI (the default command).

| Argument / flag | Description |
|---|---|
| `[repo]` | A local path · `https://host/repos/<repo>` · `https://host` (the repositories list). Default: `$E3_REPO`, then `.`. |
| `[workspace]` | The workspace to open (else the one remembered for the repository, the only one, or the list). |
| `-t, --task <name>` | Open a task on start. |
| `-i, --input <name>` | Open an input on start (exclusive with `--task`). |
| `--no-mouse` | Disable mouse reporting. |
| `--ascii` | Box-drawing off (also `E3_UI_ASCII=1`). |

### `e3-ui auth login|logout|status|token|whoami [url]`

The same commands, device flow and credential store (`~/.e3/credentials.json`)
as `e3 auth`, so a token saved by either is used by both.

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
| `--frame-width <w>` | Mount the component frame at a definite width — `full` (viewport) or a CSS width (`900px`). Width-flexible components (Schematic/Plan/Table) collapse in the default shrink-to-fit frame. |

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
`shot` reports a missing executable. The terminal UI never needs a browser.

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
| `startRepoServer(opts)` | Spin up the local e3 API server used by `--from-task` and by the terminal UI over a local repository. |

The terminal UI itself has no programmatic entry point: it is a process that
owns the terminal. Scripts use `e3 workspace status`, `e3 dataset get` and
`@elaraai/e3-api-client` instead.

## Key Patterns

```bash
# Watch a workspace while its dataflow runs — the pill counts events, the panel streams them:
e3-ui ./repo main        # then r ⏎ (or /run --force ⏎); x ⏎ cancels
# Look at a task's output, then its logs, then its runs:
e3-ui ./repo main --task forecast     # 1 Output · 2 Stdout · 3 Stderr · 4 Runs; /find k015 · /goto 50% · s save
# Fix an input value in place:
e3-ui ./repo main --input params      # e → type → ⏎ → ⏎ APPLY (the commit bar) ; esc discards
# A remote repository:
e3-ui auth login https://e3.example.com && e3-ui https://e3.example.com/repos/demo
# Keyboard only, box-drawing off, no state file (a locked-down host):
E3_UI_STATE=/dev/null e3-ui --no-mouse --ascii ./repo

# create-e3 --ui scaffold: the generated shot script renders the surface
npm run shot        # = e3-ui shot --from-source src/ui/index.tsx --export surface -o surface.png

# One example() from an examples file (self-sized component) — name the export
e3-ui shot --from-source test/display/combine.examples.tsx -e combineDensities -o combine.png

# Width-flexible component (Schematic/Plan/Table) — mount the frame at viewport width
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

- **e3** — repositories, workspaces, dataflow, `e3 auth`; the scriptable counterpart of the terminal UI, and what produces the task outputs `--from-task` consumes.
- **east-ui** — authoring the components this CLI renders (JSX tags, `UIComponentType`); the value tree the terminal shows is its row model.
- **e3-ui** — `ui()` tasks, `Data.bind`, decision surfaces; `--from-task` renders their computed output, the terminal UI shows their manifest.
- **east-project** — scaffolding a project whose `--ui` option wires `npm run shot`.
- **e3-create** — the `npm create @elaraai/e3 -- --ui` flag (and every other scaffold option) that generates the `src/ui/index.tsx` surface this screenshots.
