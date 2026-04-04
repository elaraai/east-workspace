# east-workspace — pnpm + turborepo monorepo
# All npm deps managed by pnpm from root. Turbo orchestrates build/test/lint.

.PHONY: setup install link build test lint clean services-up services-down services-status test-all test-export help

# ── Setup ─────────────────────────────────────────────────────────────

## Full first-time setup (install deps + build toolchains + native extensions + link CLIs)
setup: install
	$(MAKE) -C $(CURDIR)/libs/east-c setup-wasm
	$(MAKE) -C $(CURDIR)/libs/east-c build
	$(MAKE) -C $(CURDIR)/libs/east-c wasm wasm-ts
	$(MAKE) -C $(CURDIR)/libs/east-py build-eastc
	$(MAKE) -C $(CURDIR)/libs/east-py install
	$(MAKE) build
	$(MAKE) link

## Install dependencies (pnpm for TS, uv for Python, cmake for C)
install:
	pnpm install
	$(MAKE) -C $(CURDIR)/libs/east-py install
	$(MAKE) -C $(CURDIR)/libs/east-c build

## Link all CLIs globally (e3, e3-api-server, east-node, east-py, east-c)
link:
	cd $(CURDIR)/libs/e3/packages/e3-cli && pnpm link --global
	cd $(CURDIR)/libs/e3/packages/e3-api-server && pnpm link --global
	cd $(CURDIR)/libs/east-node/packages/east-node-cli && pnpm link --global
	$(MAKE) -C $(CURDIR)/libs/east-c install-cli
	$(MAKE) -C $(CURDIR)/libs/east-py install-cli

# ── Build / Test / Lint (via Turbo) ──────────────────────────────────

## Build all packages
build:
	pnpm build

## Run all tests (does not start services — use test-all for that)
test:
	pnpm test

## Lint all packages
lint:
	pnpm lint

# ── Test Services (Docker) ───────────────────────────────────────────

## Start test services (Postgres, MySQL, MongoDB, Redis, MinIO, FTP, SFTP, httpbin)
services-up:
	docker compose --profile services up -d --wait

## Stop test services
services-down:
	docker compose --profile services down -v

## Show test services status
services-status:
	docker compose --profile services ps

# ── Test IR Export ────────────────────────────────────────────────────

## Export all test IR (required before east-py and east-c compliance tests)
test-export:
	cd libs/east && make test-export
	cd libs/east-node && make test-export
	cd libs/east-py && make test-export

# ── Full Test Run ────────────────────────────────────────────────────

## Start services, run ALL tests (TS + C + WASM + Python), stop services
## Requires: make setup (one-time), make services-up (docker)
## Output: only errors and summaries (set EAST_VERBOSE=1 for full output)
test-all: services-up test-export
	@exit_code=0; \
	EAST_QUIET=1 pnpm turbo run test --output-logs=errors-only || exit_code=1; \
	EAST_QUIET=1 $(MAKE) -C $(CURDIR)/libs/east-c test-all || exit_code=1; \
	EAST_QUIET=1 $(MAKE) -C $(CURDIR)/libs/east-py test || exit_code=1; \
	$(MAKE) services-down; \
	exit $$exit_code

# ── Clean ────────────────────────────────────────────────────────────

## Remove all build artifacts
clean:
	rm -rf libs/east/dist
	rm -rf libs/east-node/packages/*/dist
	rm -rf libs/e3/packages/*/dist libs/e3/test/*/dist
	rm -rf libs/east-ui/packages/*/dist
	rm -rf libs/east-c/build libs/east-c/build-wasm
	cd libs/east-py && make clean
	rm -rf node_modules/.cache

# ── Help ─────────────────────────────────────────────────────────────

help:
	@echo "east-workspace (pnpm + turborepo)"
	@echo ""
	@echo "Setup:"
	@echo "  setup            - Full first-time setup (install + emscripten + cython + wasm)"
	@echo "  install          - Install deps (pnpm + uv + cmake)"
	@echo "  link             - Link CLIs globally (e3, east-node, east-py, east-c)"
	@echo ""
	@echo "Build / Test / Lint (turbo):"
	@echo "  build            - Build all packages"
	@echo "  test             - Run all tests"
	@echo "  lint             - Lint all packages"
	@echo ""
	@echo "Test services (Docker):"
	@echo "  services-up      - Start test services (Postgres, Redis, etc.)"
	@echo "  services-down    - Stop test services"
	@echo "  services-status  - Show test services status"
	@echo ""
	@echo "Test IR export:"
	@echo "  test-export      - Export all test IR"
	@echo ""
	@echo "Full test run:"
	@echo "  test-all         - services-up + test-export + test + services-down (quiet)"
	@echo "                     Set EAST_QUIET= to see full output"
	@echo ""
	@echo "Maintenance:"
	@echo "  clean            - Remove all build artifacts"
