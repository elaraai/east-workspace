---
name: east-project
description: "Create, initialise, and manage East / e3 projects end-to-end. Use when: (1) Scaffolding a new project ('create an e3 project called X', 'set up an East project', 'new East project'), (2) Choosing between an e3 project (BSL-1.1, Node + Python, durable execution) and an East project (AGPL-3.0, Node-only), (3) Driving the project lifecycle — install, build, deploy, run, watch, test — with the e3 CLI ('how do I run / deploy / watch / test this'), (4) Going from an empty directory to a running dataflow, (5) Splitting platform code into per-runtime workspace packages (--python-packages / --node-packages / --c-packages) for per-package change detection across Python, Node and C runners."
---

# East / e3 Project Lifecycle

Scaffold and run East projects. This skill creates the skeleton, then you implement the logic using the **e3**, **east**, **east-ui**, and **east-py-datascience** skills.

## Decision tree

```
Scaffolding an East project?
│
├─ Which kind?
│   ├─ Durable dataflow, workspaces, Python+Node+C  → npm create @elaraai/e3   <name>   (BSL-1.1)
│   └─ Plain East, Node platform fns only           → npm create @elaraai/east <name>   (AGPL-3.0)
│       └─ pass '.' for the current dir · add `-- --install` to install deps
│
├─ Need custom NATIVE functions?
│   ├─ One project-owned module (quick)   → add `--platform`  (TS-East; + Python via `--runners=east-node,east-py`)
│   └─ Split into SEPARATE packages, each its own change-detection boundary:
│       ├─ Python (numpy / pandas / ML)   → `--python-packages=pricing,forecasting`  → packages/python/*
│       ├─ Node (TS / Node libraries)     → `--node-packages=api`                     → packages/node/*
│       └─ C (native binary)              → `--c-packages=solver`                     → packages/native/*
│
└─ Run it → npm run setup → npm run start (deploy + dataflow run; add `-v` for runner timing) → npm run watch
```

| Kind | Command | License | Stack |
|---|---|---|---|
| **e3** | `npm create @elaraai/e3 <name>` | BSL-1.1 | Node + Python (+ C) |
| **East** | `npm create @elaraai/east <name>` | AGPL-3.0 | Node-only |

## Scaffold

Use the cross-platform `npm create` initializers (no plugin/PATH dependency, works on Windows/macOS/Linux):

```bash
npm create @elaraai/e3   my-project    # BSL-1.1, Node + Python, durable execution
npm create @elaraai/east my-project    # AGPL-3.0, Node-only
# pass '.' instead of a name to scaffold into the current directory
# add `-- --install` to install dependencies as part of scaffolding
```

You get: `package.json`, `tsconfig.json`, `pyproject.toml` (e3 only), `src/index.ts` (a sample `e3.input` + `e3.task`, with the package as the default export), `src/index.spec.ts`, tests, and cross-platform npm scripts. Dependencies are pinned to the matching `@elaraai/*` release.

## Implement the logic

After scaffolding, edit `src/index.ts` to build the user's actual logic:
- Inputs and tasks → **e3** skill (`e3.input`, `e3.task`, `e3.package`, `e3.export`).
- East functions inside tasks → **east** skill.
- Decision surfaces / UI tasks → **east-ui** + **e3-ui** skills (`ui()`, `Data.bind`); screenshot them with **e3-ui-cli** (`npm run shot` in `--ui` scaffolds).
- ML / optimisation tasks → **east-py-datascience** skill.

## Project-owned platform modules (`--platform`)

When the project needs **its own** native functions, scaffold with `--platform`
(e3 only, opt-in). It **adapts to the chosen runners**: it always adds a TS-East
(east-node) platform module, and *additionally* a Python one when the east-py
runner is also selected — so a fresh project is ready to go with custom platforms
in whatever runtime(s) it has.

```bash
npm create @elaraai/e3 my-project -- --platform                       # TS-East only
npm create @elaraai/e3 my-project -- --platform --runners=east-node,east-py   # + Python
```

**TS-East half (always, runnable after `npm install`):** a `src/platform/`
directory whose `index.ts` barrel is the package's **scoped** `./platform`
subpath export (a `PlatformFunction[]`).
- `src/platform/example.ts` — an example fn with declaration **and**
  `.implement(...)` co-located. The example task runs it on
  `{ runtime: "east-node", platforms: [{ custom: "@elaraai/<project>" }] }` — the
  custom name is the package's full scoped name so east-node-cli self-resolves
  the `./platform` export.
- **Add another:** drop `src/platform/<fn>.ts` (exporting its declaration +
  `<fn>Impl`), then in `src/platform/index.ts` import `<fn>Impl`, re-export the
  `<fn>` declaration, and add `<fn>Impl` to the default-exported array.

**Python half (added only when east-py is on, runnable after `uv sync`):** a
`platform_module/` package whose `__init__.py` is a thin **aggregator**.
- `platform_module/example.py` — an example `@platform_function` ending with
  `<name>_impl = platform_functions(__name__)`; `__init__.py` spreads it into the
  top-level `platform` list `east-py run -p platform_module` loads. This mirrors
  the first-party east-py-std / east-py-datascience packages. A setuptools
  `[build-system]` block plus `[tool.setuptools] packages = ["platform_module"]`
  makes the package importable from the project's `.venv` (re-run `uv sync` after
  adding native deps like numpy to `pyproject.toml`).
- `src/platform_module.ts` — a hand-written `East.platform(name, inputs, output)`
  **declaration** mirroring the Python signature (no codegen — keep the two in
  lockstep). The example task runs it on
  `{ runtime: "east-py", platforms: [{ custom: "platform_module" }, "east-py-std"] }`.
- **Add another:** drop `platform_module/<fn>.py` (ending `<fn>_impl =
  platform_functions(__name__)`), import + spread it in `__init__.py`, and add the
  matching `East.platform(...)` declaration to `src/platform_module.ts`.

Conventions: platform-function names are **dotted `"<project>.<fn>"`** (an opaque
binding string, frozen into the content-addressed `taskHash` on publish — so it
must be the scaffold default). The bare typed runner resolves the runner binary
from the project's own `.venv` / `node_modules` — **no `uv run` wrapper, no
`project` field**. The scaffolded example functions are named generically
(`example_python`, `exampleNode`) — replace them with your own.

**Adding this to an EXISTING project** (no `--platform` scaffold): create
`src/platform/index.ts` (default-export the `PlatformFunction[]`); add the
subpath to `package.json` `exports` — `"./platform": "./dist/platform/index.js"`
(keep `"."` too); the e3 task's `{ custom: "@elaraai/<name>" }` must equal the
package.json `name` exactly; and ensure the project is **built** before
`e3 dataflow run` (the scaffold's `start` runs `npm run build` first). For the
Python half, add the setuptools `[build-system]` + `[tool.setuptools] packages`
to `pyproject.toml` and `uv sync`.

## Multi-package projects (per-runner change granularity)

Split platform code into separate workspace packages — each its own captured
execution environment, so editing one re-runs only its tasks (the rest stay
cached, even across a redeploy). Scaffold with `--python-packages` /
`--node-packages` / `--c-packages`; the **e3-create** skill is the full
reference — every flag, the generated layout, and the per-runtime task wiring
(python & node auto-derive the environment from `{ custom }`; C attaches a
prebuilt binary via `environment: { tools }`).


## Lifecycle (generated npm scripts)

```bash
npm run setup     # npm install + uv sync (e3); npm install (east)
npm run build     # tsc
npm run test      # e3: build + export IR + TS & Python tests; east: build + TS tests
npm run deploy    # e3: repo create (--exist-ok) + workspace deploy --from-source
npm run start     # e3: deploy, then dataflow run
npm run watch     # e3: e3 watch ./src/index.ts .repos <ws> --start  (live reload)
npm run shot      # e3 --ui scaffolds: render src/ui/index.tsx to surface.png (e3-ui-cli)
```

Under the hood the e3 scripts use the e3 CLI's source-deploy:

```bash
e3 repo create .repos --exist-ok
e3 workspace deploy .repos <ws> --from-source ./src/index.ts   # bundle + import + create ws + deploy
e3 dataflow run .repos <ws>                                   # add -v for per-runner timing/perf (in `e3 task logs`)
e3 dataset get .repos <ws>.<name>                              # read a result (flat path)
```

## Typical flow for "create an e3 project called X that does Y"

1. `npm create @elaraai/e3 X`
2. `cd X`
3. Edit `src/index.ts`: define inputs + tasks implementing **Y** (use the e3/east skills).
4. `npm run setup && npm run start` (or `npm run watch` for iteration).
5. `e3 dataset get .repos <ws>.<task>` to read outputs.

## Related skills

- **e3-create** — the full `npm create @elaraai/{e3,east}` flag reference (every option + its effect, single vs multi-package layouts). This skill picks up *after* scaffolding.
- **e3** — the SDK + CLI this builds on.
- **east** — the language for task bodies.
- **east-ui** / **e3-ui** — decision surfaces.
- **e3-ui-cli** — screenshot a scaffolded surface (`npm run shot`, `e3-ui doctor`).
- **east-py-datascience** — ML/optimisation tasks.
