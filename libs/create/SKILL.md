---
name: e3-create
description: "Scaffold East / e3 projects with the `npm create @elaraai/e3` and `npm create @elaraai/east` initializers. Use when: (1) Creating a new project from scratch ('create an e3 project', 'set up an East project', 'new project called X'), (2) Choosing e3 (durable dataflow, Node+Python+C) vs east (Node-only), (3) Deciding CLI flags — --runners, --platform, --python-packages / --node-packages / --c-packages, --ui, --tests, --eslint, --install — and understanding exactly what each generates, (4) Splitting platform code into per-runtime workspace packages for per-package change detection. After scaffolding, the east-project skill drives the build/deploy/run/watch lifecycle."
---

# e3-create — scaffolding East / e3 projects

The `npm create @elaraai/{e3,east}` initializers (package `libs/create`:
`create-e3`, `create-east`, `scaffold-core`) turn an empty directory into a
buildable project. This skill is the **flag reference**: which initializer,
which flags, and exactly what each one generates. Implementing the logic and
running the lifecycle is the **east-project** skill; the SDK/API is **e3**.

## Decision tree

```
Scaffolding a project?
│
├─ Which initializer?
│   ├─ Durable dataflow, workspaces, Python+Node+C runners → npm create @elaraai/e3   <name>   (BSL-1.1)
│   └─ Plain East programs, Node platform fns only          → npm create @elaraai/east <name>   (AGPL-3.0)
│       └─ <name> = dir to create · `.` = current dir (default) · `-- --install` to install deps
│
├─ Which runtimes? (e3)         → --runners=east-node,east-py,east-c   (default: all three)
│
├─ Custom NATIVE functions?
│   ├─ One project-owned module        → --platform         (TS-East; + Python when east-py is on)
│   └─ Split into SEPARATE packages (per-package change detection — supersedes --platform):
│       ├─ Python (numpy/pandas/ML)    → --python-packages=pricing,forecasting  → packages/python/*  (uv members)
│       ├─ Node (TS/Node libs)         → --node-packages=api                     → packages/node/*    (npm members)
│       └─ C (native binary)           → --c-packages=solver                     → packages/native/*  (tools env)
│
├─ Extras (e3)                  → --ui (east-ui+e3-ui) · --tests (default on) · --eslint (on) · --editor-diagnostics (on)
│
└─ Then → cd <name> → npm run setup → npm run start   (lifecycle: east-project skill)
```

| Initializer | License | Stack | Default export |
|---|---|---|---|
| `npm create @elaraai/e3 <name>` | BSL-1.1 | Node + Python (+ C) | an `e3.package(...)` |
| `npm create @elaraai/east <name>` | AGPL-3.0 | Node-only | an East program |

## Invocation

```bash
npm create @elaraai/e3 my-app                 # interactive when a TTY (prompts for features)
npm create @elaraai/e3 my-app -- --no-ui --runners=east-node,east-py   # flags after `--`
npm create @elaraai/e3 .                       # scaffold into the CURRENT directory
create-e3 my-app --ui                          # the bin directly (no `npm create`, no `--`)
npm create @elaraai/e3 -- --help               # full flag list
```

- The **project name** is the first non-`-` argument; omit it (or pass `.`) to scaffold into the current directory.
- Under `npm create`, flags go **after `--`** (npm forwards them). The `create-e3` / `create-east` bins take flags directly.
- A run is **interactive** only when stdin+stdout are a TTY **and** no selection flag is passed; any selection flag (below) makes it non-interactive (safe for CI / pipes).

## CLI flags — and exactly what each does

**Both `e3` and `east`:**

| Flag | Default | Effect |
|---|---|---|
| `--install` / `--no-install` | install when TTY | Run `npm install` (+ `uv sync` for e3) after scaffolding. |
| `--eslint` / `--no-eslint` | on | Add ESLint wired with `@elaraai/eslint-plugin-east` (the East lint rules). |
| `--editor-diagnostics` / `--no-editor-diagnostics` | on | Add `@elaraai/tsserver-plugin-east` to `tsconfig.json` (editor squiggles for East idioms). |

**`e3` only:**

| Flag | Default | Effect |
|---|---|---|
| `--runners=<list>` | all | Comma list of `east-node,east-py,east-c` to include. Prunes the unused runtimes' setup (e.g. drop `pyproject.toml` when east-py is off). |
| `--tests` / `--no-tests` | on | Emit `src/index.spec.ts` (+ Python tests when east-py is on). |
| `--ui` / `--no-ui` | off | Add `east-ui` + `e3-ui`, a `src/ui/index.tsx` surface, and the `npm run shot` screenshot wiring (e3-ui-cli). |
| `--platform` / `--no-platform` | off | Add ONE project-owned platform module (see below). Ignored when any `--*-packages` is given. |
| `--python-packages=<list>` | — | uv workspace members under `packages/python/*`. Implies `--runners` east-py. |
| `--node-packages=<list>` | — | npm workspace members under `packages/node/*`. Implies east-node. |
| `--c-packages=<list>` | — | Native binaries under `packages/native/*`, wired via a `tools` env. Implies east-c. |

**Interactions to know:**
- Each `--<runtime>-packages` **implies its runner** (a package can't run without it), applied *after* `--runners=` so a contradictory `--runners` can't disable a needed runtime.
- Any `--<runtime>-packages` sets `--platform` **off** — the generated packages ARE the platform path (they replace the single-file demo).
- Package names must be **unique across all runtimes** (each becomes a distinct `src/packages/<name>.ts` task); a name that collides with a real registry package should be renamed.

## What you get (single project, no package flags)

```
my-app/
├── package.json            # @elaraai/* pinned; cross-platform npm scripts (setup/build/test/deploy/start/watch)
├── tsconfig.json           # + tsserver-plugin-east (unless --no-editor-diagnostics)
├── pyproject.toml          # e3 + east-py runner only
├── eslint.config.js        # unless --no-eslint
└── src/
    ├── index.ts            # a sample e3.input + e3.task; the e3.package is the default export
    └── index.spec.ts       # unless --no-tests
```

`--ui` adds `src/ui/index.tsx` (an `e3.ui()` surface) + `npm run shot`.

## Custom platform functions

**`--platform` (one project-owned module).** Adds a TS-East platform module
(`src/platform/`, exported as the package's `./platform` subpath) and — when
east-py is also selected — a Python one (`platform_module/` + a mirrored
`East.platform(...)` declaration in `src/platform_module.ts`). The example task
runs on `{ runtime: "east-node", platforms: [{ custom: "@elaraai/<project>" }] }`
(or the east-py equivalent). Good for a single project-local native function.

**`--python-packages` / `--node-packages` / `--c-packages` (multi-package).**
Split platform code into **separate workspace packages, each its own captured
execution environment** — so editing one package re-runs only its tasks, the
rest stay cached (even across a redeploy). The package boundary *is* the
change-detection granularity. Mix runtimes freely:

```bash
npm create @elaraai/e3 my-app -- \
  --python-packages=pricing --node-packages=api --c-packages=solver
```

```
my-app/
├── package.json                       # npm workspace root: workspaces ["packages/node/*"], private
├── pyproject.toml                     # uv workspace root: members ["packages/python/*"]
├── tsconfig.json                      # excludes "packages" (members compile themselves)
├── src/
│   ├── index.ts                       # e3.package("my-app", "1.0.0", ...packageTasks)
│   └── packages/
│       ├── index.ts                   # barrel: export const packageTasks = [pricing_task, api_task, solver_task]
│       └── pricing.ts · api.ts · solver.ts   # one example task per package (below)
└── packages/
    ├── python/pricing/                # uv member — pyproject.toml (hatchling) + src/pricing/{__init__,example}.py
    ├── node/api/                      # npm member — package.json (@my-app/api, ./platform export) + src/platform.ts
    └── native/solver/                 # native — Makefile + src/solver.c → build/solver
```

**The task wiring differs by runtime — python & node AUTO-DERIVE the environment
from the `{ custom }` platform reference; C attaches a prebuilt binary
explicitly:**

```typescript
// Three separate files under src/packages/. Each begins with:
//   import e3 from "@elaraai/e3";
//   import { East, ArrayType, FloatType, IntegerType } from "@elaraai/east";

// ── src/packages/pricing.ts — PYTHON (env AUTO-DERIVED from { custom: "pricing" }) ──
const example = East.platform("pricing.example", [ArrayType(FloatType)], FloatType);
const values = e3.input("pricing_values", ArrayType(FloatType), [1.0, 2.0, 3.0]);
export const pricing_task = e3.task("pricing_example", [values],
  East.function([ArrayType(FloatType)], FloatType, ($, v) => { $.return(example(v)); }),
  { runner: { runtime: "east-py", platforms: [{ custom: "pricing" }, "east-py-std"] } });
  // no `environment:` — export captures packages/python/pricing's uv closure

// ── src/packages/api.ts — NODE (env AUTO-DERIVED from { custom: "@my-app/api" }, SCOPED name) ──
const example = East.platform("api.example", [IntegerType, FloatType], IntegerType);
const value = e3.input("api_value", IntegerType, 21n);
const factor = e3.input("api_factor", FloatType, 2.0);
export const api_task = e3.task("api_example", [value, factor],
  East.function([IntegerType, FloatType], IntegerType, ($, v, f) => { $.return(example(v, f)); }),
  { runner: { runtime: "east-node", platforms: [{ custom: "@my-app/api" }] } });
  // no `environment:` — export captures packages/node/api's npm closure

// ── src/packages/solver.ts — C (NOT auto-derived; attach the built binary via tools) ──
const solverValues = e3.input("solver_values", ArrayType(FloatType), [1.0, 2.0, 3.0]);
export const solver_task = e3.customTask("solver_tool", [solverValues], ArrayType(FloatType),
  (_$, inputs, output) => East.str`solver ${inputs.get(0n)} ${output}`,
  { environment: { tools: { files: ["packages/native/solver/build/solver"] } } });
  // build the C binary first: `make -C packages/native/solver` — a rebuild re-runs only this task
```

The member side holds the impl, keyed to the same dotted `"<pkg>.example"` name:
`packages/python/pricing/src/pricing/example.py` is an `@platform_function`;
`packages/node/api/src/platform.ts` is `East.platform(...).implement(...)`
default-exported as a `PlatformFunction[]`. Keep the member impl and the app-side
`East.platform(...)` declaration in lockstep (same name + signature).

**Build order / semantics.** Python members install the workspace's full locked
third-party set (union-scoped); node members must be `tsc`-built before export
(the root `build` runs `--workspaces` first); C tools must be `make`-built before
`npm run start`. Add more packages later with the same flags — each new one is
captured independently.

## Worked examples

```bash
# Node + Python, no UI, install now
npm create @elaraai/e3 planner -- --runners=east-node,east-py --no-ui --install

# Python-only ML project, one python package for the model
npm create @elaraai/e3 forecaster -- --runners=east-py --python-packages=model

# Everything: three runtimes, one package each, UI on
npm create @elaraai/e3 demo -- --python-packages=pricing --node-packages=api --c-packages=solver --ui

# A plain East (Node-only) library with lint but no tests
npm create @elaraai/east mylib -- --no-tests
```

## After scaffolding

The generated `npm` scripts (`setup`, `build`, `test`, `deploy`, `start`,
`watch`, `shot`) and the deploy/run flow are the **east-project** skill. Add
`-v` to `npm run start`'s dataflow run for per-runner timing in the task logs.

## Related skills

- **east-project** — the lifecycle after scaffolding: implement, build, deploy, run, watch, test.
- **e3** — the SDK (`e3.input` / `e3.task` / `e3.package` / `e3.export`) + CLI the generated code uses; per-package environment auto-derivation.
- **east** — the language for task bodies and `East.platform(...)` declarations.
- **east-py** — author the `@platform_function` a `--python-packages` member exports; **east-node-std** — the east-node platform fn a `--node-packages` member exports.
- **east-ui** / **e3-ui** / **e3-ui-cli** — the `--ui` surface and screenshotting it (`npm run shot`).
- **east-design** — start here when you have a goal but no architecture yet.
