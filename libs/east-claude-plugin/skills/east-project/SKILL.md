---
name: east-project
description: "Create, initialise, and manage East / e3 projects end-to-end. Use when: (1) Scaffolding a new project ('create an e3 project called X', 'set up an East project', 'new East project'), (2) Choosing between an e3 project (BSL-1.1, Node + Python, durable execution) and an East project (AGPL-3.0, Node-only), (3) Driving the project lifecycle — install, build, deploy, run, watch, test — with the e3 CLI, (4) Going from an empty directory to a running dataflow."
---

# East / e3 Project Lifecycle

Scaffold and run East projects. This skill creates the skeleton, then you implement the logic using the **e3**, **east**, **east-ui**, and **east-py-datascience** skills.

## Decision: which project?

| Want | Use | License | Stack |
|---|---|---|---|
| Durable dataflow, workspaces, multi-runtime | **e3 project** | BSL-1.1 | Node + Python |
| Plain East programs, Node platform fns only | **East project** | AGPL-3.0 | Node-only |

## Scaffold

The plugin ships the scaffolders on `PATH` as `east-scaffold` (Claude Code adds the plugin's `bin/` to `PATH` on install):

```bash
east-scaffold e3   my-project     # or '.' for the current directory
east-scaffold east my-project
```

If `east-scaffold` isn't found (plugin not installed in this environment), fall back to the curl bootstrap:

```bash
curl -fsSL https://raw.githubusercontent.com/elaraai/east-workspace/main/libs/east-claude-plugin/scripts/scaffold/e3.sh | bash -s -- my-project
```

Either way you get: `package.json`, `tsconfig.json`, `pyproject.toml` (e3 only), `src/index.ts` (a sample `e3.input` + `e3.task`), `src/main.ts` (package export), tests, and a `Makefile`.

## Implement the logic

After scaffolding, edit `src/index.ts` to build the user's actual logic:
- Inputs and tasks → **e3** skill (`e3.input`, `e3.task`, `e3.package`, `e3.export`).
- East functions inside tasks → **east** skill.
- Dashboards / UI tasks → **east-ui** + **e3-ui** skills (`ui()`, `Data.bind`).
- ML / optimisation tasks → **east-py-datascience** skill.

## Lifecycle (generated Makefile)

```bash
make install     # npm install + uv sync
make build       # tsc
make test        # export IR from TS, run Python compliance tests
make start       # build → e3 repo create → workspace deploy --from-zip → dataflow run
make watch       # e3 watch ./src/index.ts .repos <ws> --start  (live reload)
```

Under the hood `make start` uses the current e3 CLI:

```bash
e3 repo create .repos
e3 workspace deploy .repos <ws> --from-zip /tmp/pkg.zip   # imports + creates ws + deploys
e3 dataflow run .repos <ws>
e3 dataset get .repos <ws>.<name>                          # read a result (flat path)
```

## Typical flow for "create an e3 project called X that does Y"

1. `east-scaffold e3 X`
2. `cd X`
3. Edit `src/index.ts`: define inputs + tasks implementing **Y** (use the e3/east skills).
4. `make install && make start` (or `make watch` for iteration).
5. `e3 dataset get .repos <ws>.<task>` to read outputs.

## Related skills

- **e3** — the SDK + CLI this builds on.
- **east** — the language for task bodies.
- **east-ui** / **e3-ui** — dashboards.
- **east-py-datascience** — ML/optimisation tasks.
