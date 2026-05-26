---
name: east-project
description: "Create, initialise, and manage East / e3 projects end-to-end. Use when: (1) Scaffolding a new project ('create an e3 project called X', 'set up an East project', 'new East project'), (2) Choosing between an e3 project (BSL-1.1, Node + Python, durable execution) and an East project (AGPL-3.0, Node-only), (3) Driving the project lifecycle — install, build, deploy, run, watch, test — with the e3 CLI ('how do I run / deploy / watch / test this'), (4) Going from an empty directory to a running dataflow."
---

# East / e3 Project Lifecycle

Scaffold and run East projects. This skill creates the skeleton, then you implement the logic using the **e3**, **east**, **east-ui**, and **east-py-datascience** skills.

## Decision: which project?

| Want | Use | License | Stack |
|---|---|---|---|
| Durable dataflow, workspaces, multi-runtime | **e3 project** | BSL-1.1 | Node + Python |
| Plain East programs, Node platform fns only | **East project** | AGPL-3.0 | Node-only |

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
- Dashboards / UI tasks → **east-ui** + **e3-ui** skills (`ui()`, `Data.bind`).
- ML / optimisation tasks → **east-py-datascience** skill.

## Lifecycle (generated npm scripts)

```bash
npm run setup     # npm install + uv sync (e3); npm install (east)
npm run build     # tsc
npm run test      # e3: build + export IR + TS & Python tests; east: build + TS tests
npm run deploy    # e3: repo create (--exist-ok) + workspace deploy --from-source
npm run start     # e3: deploy, then dataflow run
npm run watch     # e3: e3 watch ./src/index.ts .repos <ws> --start  (live reload)
```

Under the hood the e3 scripts use the e3 CLI's source-deploy:

```bash
e3 repo create .repos --exist-ok
e3 workspace deploy .repos <ws> --from-source ./src/index.ts   # bundle + import + create ws + deploy
e3 dataflow run .repos <ws>
e3 dataset get .repos <ws>.<name>                              # read a result (flat path)
```

## Typical flow for "create an e3 project called X that does Y"

1. `npm create @elaraai/e3 X`
2. `cd X`
3. Edit `src/index.ts`: define inputs + tasks implementing **Y** (use the e3/east skills).
4. `npm run setup && npm run start` (or `npm run watch` for iteration).
5. `e3 dataset get .repos <ws>.<task>` to read outputs.

## Related skills

- **e3** — the SDK + CLI this builds on.
- **east** — the language for task bodies.
- **east-ui** / **e3-ui** — dashboards.
- **east-py-datascience** — ML/optimisation tasks.
