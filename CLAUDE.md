# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## HARD RULE: read the whole file before editing it

Before editing ANY source file, you MUST have read that file **in its
entirety, recently** — meaning after its most recent change, including your
own earlier edits, merges, rebases, and formatter runs. Partial reads, grep
fragments, or a full read that predates a known change do not qualify. If a
file exceeds one Read call, read it in consecutive chunks until complete.
There is no "small edit" exception. When a tool result notes the file was
modified on disk since you last read it, that is a STOP: re-read the whole
file before the next edit to it.

## What this repo is

The **East monorepo** — a pnpm + uv + cmake workspace containing all
open-source East language packages. Formed by combining several previously
independent repos.

## Repo layout

All libraries live under `libs/`:

```
libs/
├── east/                # Core language — @elaraai/east
├── east-node/           # Node.js platform — east-node-std, east-node-io, east-node-cli
├── east-c/              # C runtime (CMake)
├── east-py/             # Python runtime + datascience + I/O (uv workspace)
├── e3/                  # Execution engine — e3-types, e3, e3-core, e3-api-client, e3-cli, e3-api-server, e3-api-tests
├── east-ui/             # UI components — east-ui, east-ui-components, e3-ui, e3-ui-components, e3-ui-cli, showcases, east-ui-extension (VS Code extension)
└── east-claude-plugin/  # Claude Code plugin — skills (symlinked from libs), hooks, MCP search server, project scaffold + install scripts
```

Top-level (non-`libs/`):
- `docker/` — `images/` (published `ghcr.io/elaraai/{e3,east-node}` runtime images), `services/` (test-backend compose), `tests/` (image validation)
- `scripts/` — monorepo release tooling (`publish-npm.mjs`, `set-*-version.mjs`, …)
- `.claude-plugin/marketplace.json` — marketplace root; lists the `east` plugin with `source: ./libs/east-claude-plugin`

Root config:
- `pnpm-workspace.yaml` — workspace package globs
- `package.json` — root scripts (`pnpm -r build/test/lint`)
- `.npmrc` — pnpm config
- `docker/services/docker-compose.yml` — test services (Postgres, MySQL, MongoDB, Redis, MinIO, FTP, SFTP, httpbin)
- `Makefile` — top-level orchestration
- `east.code-workspace` — VS Code multi-root workspace

`e3-cloud` (east-aws) is closed source — separate repo `elaraai/e3-cloud`.

## Commands

Always use `make` (not `npm run`). See
[`docs/conventions/MAKEFILE_TARGETS.md`](docs/conventions/MAKEFILE_TARGETS.md)
for the full target list. Quick reference:

```bash
make install            # one-shot setup
make build              # build all TS packages
make test               # run all TS tests
make lint               # lint all packages
make services-up        # Docker services for integration tests
make test-all           # services + test-export + all test suites
make clean
```

Each lib has its own `Makefile` mirroring these targets:

```bash
cd libs/east && make build
cd libs/e3 && make help
```

## Plugin skills (DO NOT EDIT WITHOUT INTENT)

The following `SKILL.md` files back Claude Code plugin skills
(`east:east`, `east:e3`, `east:e3-create`, `east:east-ui`, `east:e3-ui`,
`east:e3-ui-cli`, `east:east-node-std`, `east:east-node-io`, `east:east-py`,
`east:east-py-std`, `east:east-py-io`, `east:east-py-datascience`).
Editing them changes plugin behaviour — coordinate before touching. The
plugin (`libs/east-claude-plugin/skills/<name>/SKILL.md`) holds **symlinks**
to these files, so the lib copy is the single source of truth; the search
index (`libs/east-claude-plugin/index.json`) is regenerated from each lib's
`*.examples.ts` and must be re-run when these change (see the
`plugin-artifacts` workflow). `east:east-py`, `east:east-py-std`, and
`east:east-py-io` are **skill-file-only** for now — no `*.examples.py` are
indexed. `east:e3-ui-cli` and `east:e3-create` are indexed via hand-written
`index.static.json` stubs (the `e3` precedent) — their CLI surface is not
East-expression code, so they have no `*.examples.ts`.

- `libs/east/SKILL.md`
- `libs/e3/SKILL.md`
- `libs/create/SKILL.md` (`east:e3-create` — the `npm create @elaraai/{e3,east}` scaffolder)
- `libs/east-ui/packages/east-ui/SKILL.md`
- `libs/east-ui/packages/e3-ui/SKILL.md`
- `libs/east-ui/packages/e3-ui-cli/SKILL.md`
- `libs/east-node/packages/east-node-std/SKILL.md`
- `libs/east-node/packages/east-node-io/SKILL.md`
- `libs/east-py/packages/east-py/SKILL.md`
- `libs/east-py/packages/east-py-std/SKILL.md`
- `libs/east-py/packages/east-py-io/SKILL.md`
- `libs/east-py/packages/east-py-datascience/SKILL.md`

Further skills are **plugin-native** (not a lib API), with `SKILL.md`
files living in the plugin under `libs/east-claude-plugin/skills/`:

- `east:east-project` (`skills/east-project/SKILL.md`) — project scaffolding
  + lifecycle, via the published initializers `npm create @elaraai/e3` /
  `npm create @elaraai/east` (see `libs/create`).
- `east:east-design` (`skills/east-design/SKILL.md`) — solution architecture
  *before* coding: discovery questions, capability→skill mapping, example
  searches, and a design doc that hands off to `east-project` + the
  per-package skills.
- `east:east-ontology` (`skills/east-ontology/SKILL.md`) — build an Economic
  Ontology of a business (resources/activities/KPIs/decisions/objectives/
  policies) and render it with the e3-ui `Ontology` editor: elicitation
  methodology, the node/link model, and `OntologyType` encoding.
- `east:east-contribute` (`skills/east-contribute/SKILL.md`) — contribute a
  change to *this monorepo* from a GitHub issue (elaraai/east-workspace):
  triage → lib(s)/skills, anti-duplication "feature register" discovery,
  ensure East diagnostics/`tsserver-plugin-east` are live (the real gate is
  `make lint`), the examples↔tests East-code contract, the full
  build/test/lint loop + CI gates, and issue → branch → PR conventions.

## Workspace conventions

These docs hold rules that apply across multiple libs. Per the project
naming convention, they use `SCREAMING_SNAKE_CASE.md` to signal
"system-type, don't delete".

- [`docs/conventions/EAST_TS_INTEROP.md`](docs/conventions/EAST_TS_INTEROP.md)
  — `isValueOf`, `compareFor`, `variant()`, `$.let`/`$.const` rules.
- [`docs/conventions/EAST_PY_INTEROP.md`](docs/conventions/EAST_PY_INTEROP.md)
  — Python sibling: `compare_for`/`equal_for`, `variant()`/`some`/`none`, eager
  methods delegate to east-c, `coerce_to`/`assert_value_of` at the boundary.
- [`docs/conventions/EXAMPLES_AUTHORING.md`](docs/conventions/EXAMPLES_AUTHORING.md)
  — the `*.spec.ts` ↔ `*.examples.ts` pattern.
- [`docs/conventions/PYTHON_OPTIONAL_DEPS.md`](docs/conventions/PYTHON_OPTIONAL_DEPS.md)
  — `find_spec` + lazy import guard pattern.
- [`docs/conventions/MAKEFILE_TARGETS.md`](docs/conventions/MAKEFILE_TARGETS.md)
  — canonical `make` targets.
- [`docs/conventions/BEAST2_WIRE_VERSION.md`](docs/conventions/BEAST2_WIRE_VERSION.md)
  — where the beast2 container version is declared, what it guarantees
  (readers accept every released version; writers are lockstep), and why the
  environment e2e uses a local stand-in registry rather than the last release.
- [`docs/conventions/SKILLS_STANDARD.md`](docs/conventions/SKILLS_STANDARD.md)
  — mandatory structure for `SKILL.md` + reference/example files.
- [`docs/conventions/EAST_UI_PROP_PATTERNS.md`](docs/conventions/EAST_UI_PROP_PATTERNS.md)
  — east-ui data-vs-behavior prop rule: behavior props are pass-through
  `FunctionType` (never invoked at build time; capture only data +
  bind-handles); factories reify mapper callbacks via `shared/reify.ts`,
  never splice.

## Dependency management

- **TypeScript packages**: pnpm workspaces with `workspace:*`. Cross-package
  deps are local symlinks — no registry needed for development. pnpm
  rewrites `workspace:*` to actual versions at publish time.
- **Python packages** (east-py): uv workspace, self-contained under
  `libs/east-py/`.
- **C packages** (east-c): CMake, self-contained under `libs/east-c/`.

## Dependency order

pnpm topologically orders workspace scripts automatically. For reference:

1. **east** — core, no `@elaraai` deps
2. **east-node** — depends on east
3. **east-c** — no `@elaraai` deps
4. **east-py** — east-py-datascience depends on east, east-node-std
5. **e3** — depends on east, east-node-std
6. **east-ui** — depends on east, east-node-std, e3-*

## Standards

Each lib has its own `STANDARDS.md` for mandatory dev standards (TypeDoc,
testing, code quality). CLAUDE.md files MUST reference STANDARDS.md, not
duplicate it.

## Key conventions

- Node 22 (`.nvmrc`), pnpm 10.x (`packageManager` in package.json)
- `make build` / `make test` / `make lint` work in every lib directory
- `@elaraai/*` packages use `"beta"` dist-tag for pre-releases,
  `"latest"` for stable
- Per-lib CLAUDE.md has package-specific orientation; package-level
  CLAUDE.md is stub-or-detailed depending on whether unique guidance
  exists
- GitHub Actions: per-lib test workflows with `paths` filters; single
  publish workflow
