# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repo Is

This is the **east-workspace** meta repository — it orchestrates development across all East language repos. It does not contain application code itself. Its purpose is cross-repo building, testing, and local integration via a local npm registry (Verdaccio).

## Repo Layout

All repos live as siblings in the parent directory (`../`). The workspace file `east.code-workspace` is the source of truth for which repos are included. Local directory names may differ from display names (e.g. `../east-aws` is displayed as `e3-cloud`).

Key files in this repo:
- `Makefile` — all commands are run via make
- `east.code-workspace` — VS Code multi-root workspace config; also used by scripts to discover repos
- `docker-compose.yml` + `verdaccio/config.yaml` — local Verdaccio npm registry
- `scripts/` — publish, restore, hooks, and hook installer

## Commands

All operations use `make`. Each repo also has its own `Makefile` with `install`, `build`, `test`, `lint` targets.

```bash
make install            # Install deps in all repos + install pre-commit hooks
make install-hooks      # Install pre-commit hooks only (reads from workspace file)

make build-east         # Build a single repo (also: east-node, east-c, east-py, e3, east-ui, e3-cloud)
make test-east          # Test a single repo
make build-all          # Build all repos
make test-all           # Test all repos

# Local integration testing with Verdaccio
make registry-up        # Start Verdaccio (Docker)
make registry-down      # Stop Verdaccio
make publish-local      # Build all repos in dependency order, publish @elaraai/* to local Verdaccio
make test-integration   # publish-local + test-all
make restore            # Remove .npmrc files, reinstall from npm registry
```

## Dependency Order

Packages must be built and published in this order (each depends on the ones above it):

1. **east** — core language, no `@elaraai` deps
2. **east-node** — depends on `@elaraai/east`; publishes `east-node-std`, `east-node-io`, `east-node-cli`
3. **east-c** — `east-c-wasm` depends on `@elaraai/east`
4. **east-py** — `east-py-datascience` (npm) depends on `@elaraai/east`, `@elaraai/east-node-std`
5. **e3** — depends on `@elaraai/east`; publishes `e3-types`, `e3`, `e3-core`, `e3-api-client`, `e3-cli`, `e3-api-server`
6. **east-ui** — depends on `@elaraai/east`, `@elaraai/east-node-std`, various `@elaraai/e3-*`
7. **e3-cloud** (dir: `../east-aws`) — depends on `@elaraai/e3-api-client`, `e3-api-server`, `e3-api-tests`

## How Local Integration Testing Works (Verdaccio)

The problem: testing cross-repo changes requires publishing to npm, which risks breaking downstream consumers.

The solution: `make publish-local` starts a local Verdaccio registry (Docker on port 4873), builds each repo in dependency order, publishes `@elaraai/*` packages to it, and injects a scoped `.npmrc` (`@elaraai:registry=http://localhost:4873`) into downstream repos so `make install` resolves from Verdaccio. Non-`@elaraai` packages proxy through to the real npm registry.

After testing, `make restore` removes all `.npmrc` files and reinstalls from the real npm registry.

## Pre-commit Hooks

A pre-commit hook (`scripts/pre-commit-check.sh`) is symlinked into every repo's `.git/hooks/` by `make install-hooks`. It prevents committing `.npmrc` files that point to `localhost:4873` (Verdaccio) and `file:.yalc/` references.

The hook script lives in this repo. The installer reads `east.code-workspace` to discover repos — adding a new repo to the workspace file automatically includes it.

## Adding a New Repo

1. Add a folder entry in `east.code-workspace`
2. Add `make install/build/test` targets in `Makefile`
3. Add the appropriate phase in `scripts/publish-local.sh` (respecting dependency order)
4. Add `.npmrc` to the repo's `.gitignore`
5. Run `make install-hooks` to install the pre-commit hook

## Key Conventions

- Every repo uses `make install`, `make build`, `make test` — the workspace always delegates to these
- TypeScript repos use nvm (`.nvmrc` = node 22) and npm workspaces internally
- Python repos (east-py) use `uv` for dependency management
- east-c is a C/CMake project with a wasm npm sub-package
- `@elaraai/*` packages use `"beta"` as the npm dist-tag for pre-releases and `"latest"` for stable
- Peer deps use `"beta"` as the version specifier (npm-specific, not valid in pnpm)
