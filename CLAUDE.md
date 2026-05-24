# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

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
├── east-ui/             # UI components — east-ui, east-ui-components, e3-ui, e3-ui-components, showcases, east-ui-extension (VS Code extension)
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
(`east:east`, `east:e3`, `east:east-ui`, `east:e3-ui`,
`east:east-node-std`, `east:east-node-io`, `east:east-py-datascience`).
Editing them changes plugin behaviour — coordinate before touching. The
plugin (`libs/east-claude-plugin/skills/<name>/SKILL.md`) holds **symlinks**
to these files, so the lib copy is the single source of truth; the search
index (`libs/east-claude-plugin/index.json`) is regenerated from each lib's
`*.examples.ts` and must be re-run when these change (see the
`plugin-artifacts` workflow).

- `libs/east/SKILL.md`
- `libs/e3/SKILL.md`
- `libs/east-ui/packages/east-ui/SKILL.md`
- `libs/east-ui/packages/e3-ui/SKILL.md`
- `libs/east-node/packages/east-node-std/SKILL.md`
- `libs/east-node/packages/east-node-io/SKILL.md`
- `libs/east-py/packages/east-py-datascience/SKILL.md`

One further skill, `east:east-project`, is **plugin-native** (not a lib API):
its `SKILL.md` lives in the plugin at
`libs/east-claude-plugin/skills/east-project/SKILL.md` and covers project
scaffolding + lifecycle. It invokes the bundled scaffolders via the
`east-scaffold` command (the plugin's `bin/` is added to `PATH` on install).

## Workspace conventions

These docs hold rules that apply across multiple libs. Per the project
naming convention, they use `SCREAMING_SNAKE_CASE.md` to signal
"system-type, don't delete".

- [`docs/conventions/EAST_TS_INTEROP.md`](docs/conventions/EAST_TS_INTEROP.md)
  — `isValueOf`, `compareFor`, `variant()`, `$.let`/`$.const` rules.
- [`docs/conventions/EXAMPLES_AUTHORING.md`](docs/conventions/EXAMPLES_AUTHORING.md)
  — the `*.spec.ts` ↔ `*.examples.ts` pattern.
- [`docs/conventions/PYTHON_OPTIONAL_DEPS.md`](docs/conventions/PYTHON_OPTIONAL_DEPS.md)
  — `find_spec` + lazy import guard pattern.
- [`docs/conventions/MAKEFILE_TARGETS.md`](docs/conventions/MAKEFILE_TARGETS.md)
  — canonical `make` targets.
- [`docs/conventions/SKILLS_STANDARD.md`](docs/conventions/SKILLS_STANDARD.md)
  — mandatory structure for `SKILL.md` + reference/example files.

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
