# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repo Is

This is the **East monorepo** — a pnpm workspace containing all open-source East language packages. It replaces the previous multi-repo setup.

## Repo Layout

All libraries live under `libs/`:

```
libs/
├── east/          # Core language — @elaraai/east
├── east-node/     # Node.js platform — east-node-std, east-node-io, east-node-cli
├── east-c/        # C runtime (CMake)
├── east-py/       # Python runtime + datascience types (uv workspace)
├── e3/            # Execution engine — e3-types, e3, e3-core, e3-api-client, e3-cli, e3-api-server
├── east-ui/       # UI components — east-ui, east-ui-components, e3-ui-components
└── east-plugin/   # VS Code extension
```

Root config files:
- `pnpm-workspace.yaml` — defines all workspace packages
- `package.json` — root scripts (pnpm -r build/test/lint across workspaces)
- `.npmrc` — pnpm config (auto-install-peers, public-hoist-pattern)
- `docker-compose.yml` — test services (Postgres, MySQL, MongoDB, Redis, MinIO, FTP, SFTP, httpbin)
- `Makefile` — top-level orchestration
- `east.code-workspace` — VS Code multi-root workspace

**e3-cloud** (east-aws) is closed source and lives in a separate repo (`elaraai/e3-cloud`).

## Commands

All operations use `make` from the root, or `pnpm` directly.

```bash
# Setup
make install            # pnpm install + uv sync (east-py) + cmake (east-c)

# Build / Test / Lint (pnpm runs workspace scripts in topological order)
make build              # Build all TS packages
make test               # Run all TS tests
make lint               # Lint all packages

# Docker services (needed for east-node and east-py integration tests)
make services-up        # Start Postgres, Redis, etc.
make services-down      # Stop services
make services-status    # Show service status

# Test IR export (needed before east-py compliance tests)
make test-export        # Export IR from east, east-node, east-py

# Full test run
make test-all           # services-up + test-export + test + east-c tests + east-py tests + services-down

# Clean
make clean              # Remove all build artifacts
```

Each lib also has its own Makefile for working within that directory:

```bash
cd libs/east && make build     # Build just east
cd libs/east && make test      # Test just east
cd libs/e3 && make help        # Show available targets
```

## Dependency Management

- **TypeScript packages**: pnpm workspaces with `workspace:*` protocol. Cross-package deps are local symlinks — no registry needed for development.
- **Python packages** (east-py): uv workspace, self-contained under `libs/east-py/`
- **C packages** (east-c): CMake, self-contained under `libs/east-c/`

When publishing to npm, pnpm automatically replaces `workspace:*` with the actual version.

## Dependency Order

pnpm's `-r run <script>` runs workspace packages in topological order (deps before dependents) automatically, but for reference:

1. **east** — core language, no `@elaraai` deps
2. **east-node** — depends on east
3. **east-c** — no `@elaraai` deps
4. **east-py** — east-py-datascience depends on east, east-node-std
5. **e3** — depends on east, east-node-std
6. **east-ui** — depends on east, east-node-std, e3-*

## Key Conventions

- Node 22 (`.nvmrc`), pnpm 10.x (`packageManager` in package.json)
- `make build`, `make test`, `make lint` work in every lib directory
- `@elaraai/*` packages use `"beta"` dist-tag for pre-releases, `"latest"` for stable
- Per-lib CLAUDE.md files have package-specific instructions
- GitHub Actions: per-lib test workflows with `paths` filters, single publish workflow
