# east-workspace — pnpm + turborepo monorepo
# All npm deps managed by pnpm from root. Turbo orchestrates build/test/lint.
#
# EAST_QUIET=1 — suppress passing test output (only show failures + summaries)
# Default: verbose in sub-lib targets, quiet in test-all

.PHONY: setup install build link test lint clean services-up services-down services-status test-all test-export help

# ── Setup (one-time) ─────────────────────────────────────────────────

## One-time setup of build tools (emscripten SDK for WASM compilation)
setup:
	$(MAKE) -C $(CURDIR)/libs/east-c setup-wasm

# ── Install ──────────────────────────────────────────────────────────

## Install all dependencies (pnpm for TS, uv for Python)
install:
	pnpm install
	$(MAKE) -C $(CURDIR)/libs/east-py install

# ── Build ────────────────────────────────────────────────────────────

## Build everything: east-c native + WASM, east-py (Cython), all TS packages
build:
	$(MAKE) -C $(CURDIR)/libs/east-c build
	$(MAKE) -C $(CURDIR)/libs/east-c wasm wasm-ts
	$(MAKE) -C $(CURDIR)/libs/east-py build-eastc
	$(MAKE) -C $(CURDIR)/libs/east-py install
	pnpm build

## Link all CLIs globally (e3, e3-api-server, east-node, east-py, east-c)
link:
	cd $(CURDIR)/libs/e3/packages/e3-cli && pnpm link --global
	cd $(CURDIR)/libs/e3/packages/e3-api-server && pnpm link --global
	cd $(CURDIR)/libs/east-node/packages/east-node-cli && pnpm link --global
	$(MAKE) -C $(CURDIR)/libs/east-c install-cli
	$(MAKE) -C $(CURDIR)/libs/east-py install-cli
	$(MAKE) -C $(CURDIR)/libs/east-ui extension-install

# ── Test / Lint (via Turbo) ──────────────────────────────────────────

## Run TS tests only (does not start services — use test-all for that)
test:
	pnpm test

## Lint all packages
lint:
	pnpm lint

# ── Test Services (Docker) ───────────────────────────────────────────

## Start test services (Postgres, MySQL, MongoDB, Redis, MinIO, FTP, SFTP, httpbin)
services-up:
	@docker compose --profile services up -d --wait 2>&1 | tail -1

## Stop test services
services-down:
	@docker compose --profile services down -v 2>&1 | tail -1

## Show test services status
services-status:
	docker compose --profile services ps

# ── Test IR Export ────────────────────────────────────────────────────

## Export all test IR (required before east-py and east-c compliance tests)
test-export:
	@echo "Exporting test IR..."
	@EAST_QUIET=1 $(MAKE) --no-print-directory -C $(CURDIR)/libs/east test-export 2>&1 | tail -1
	@EAST_QUIET=1 $(MAKE) --no-print-directory -C $(CURDIR)/libs/east-node test-export 2>&1 | tail -1
	@EAST_QUIET=1 $(MAKE) --no-print-directory -C $(CURDIR)/libs/east-py test-export 2>&1 | tail -1

# ── Full Test Run ────────────────────────────────────────────────────

## Start services, run ALL tests (TS + C + WASM + Python), stop services
## Requires: make setup (one-time), make install, make build
## Sets EAST_QUIET=1 so each runner only outputs failures + summaries.
test-all: services-up test-export
	@exit_code=0; \
	echo ""; \
	echo "=== TypeScript ==="; \
	EAST_QUIET=1 pnpm turbo run test --output-logs=errors-only 2>&1 | tail -5 || exit_code=1; \
	echo ""; \
	echo "=== east-c ==="; \
	EAST_QUIET=1 $(MAKE) --no-print-directory -C $(CURDIR)/libs/east-c test-all || exit_code=1; \
	echo ""; \
	echo "=== east-py ==="; \
	EAST_QUIET=1 $(MAKE) --no-print-directory -C $(CURDIR)/libs/east-py test || exit_code=1; \
	echo ""; \
	$(MAKE) --no-print-directory services-down; \
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
	@echo "First time:"
	@echo "  setup            - Install emscripten SDK (one-time)"
	@echo "  install          - Install deps (pnpm + uv)"
	@echo "  build            - Build everything (east-c + WASM + east-py + TS)"
	@echo "  link             - Link CLIs globally"
	@echo ""
	@echo "Development:"
	@echo "  build            - Rebuild everything"
	@echo "  test             - Run TS tests (turbo)"
	@echo "  lint             - Lint all packages"
	@echo ""
	@echo "Test services (Docker):"
	@echo "  services-up      - Start test services (Postgres, Redis, etc.)"
	@echo "  services-down    - Stop test services"
	@echo "  services-status  - Show test services status"
	@echo ""
	@echo "Full test run:"
	@echo "  test-export      - Export all test IR"
	@echo "  test-all         - services + export + TS + C + Python (quiet mode)"
	@echo ""
	@echo "Environment:"
	@echo "  EAST_QUIET=1     - Only show failures + summaries (default in test-all)"
	@echo ""
	@echo "Maintenance:"
	@echo "  clean            - Remove all build artifacts"
