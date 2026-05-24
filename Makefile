# east-workspace — pnpm monorepo
# All npm deps managed by pnpm from root. pnpm -r runs workspace scripts in topological order.
#
# EAST_QUIET=1 — suppress passing test output (only show failures + summaries)
# Default: verbose in sub-lib targets, quiet in test-all

.PHONY: setup install build link test lint clean services-up services-down services-status test-all test-export help check-deps

# ── Setup (one-time) ─────────────────────────────────────────────────

## Verify required external tools are on PATH. Fails fast with install
## hints if anything's missing. Used as a prereq by install / build / lint
## so a fresh-clone dev gets a clear error rather than an opaque shell
## "command not found" several layers deep.
check-deps:
	@missing=0; \
	check() { \
		if ! command -v "$$1" >/dev/null 2>&1; then \
			echo "  ✗ $$1 — not found. Install: $$2"; \
			missing=1; \
		else \
			echo "  ✓ $$1 ($$( $$1 --version 2>&1 | head -n1 ))"; \
		fi; \
	}; \
	echo "Checking required tools..."; \
	check uv      "curl -LsSf https://astral.sh/uv/install.sh | sh"; \
	check pnpm    "npm install -g pnpm  (or: corepack enable && corepack prepare pnpm@latest --activate)"; \
	check node    "https://nodejs.org/  (>=22)"; \
	check cmake   "apt install cmake  /  brew install cmake"; \
	check cc      "apt install build-essential  /  xcode-select --install"; \
	check python3 "apt install python3  /  brew install python"; \
	check docker  "https://docs.docker.com/engine/install/  (only needed for make services-up / test-all)"; \
	if [ $$missing -ne 0 ]; then \
		echo ""; \
		echo "Missing tools above. Install them and re-run."; \
		exit 1; \
	fi

## One-time setup of build tools
setup: check-deps
	@echo "Setup complete."

# ── Install ──────────────────────────────────────────────────────────

## Install all dependencies (pnpm for TS, uv for Python)
install: check-deps
	pnpm install
	$(MAKE) -C $(CURDIR)/libs/east-py install

# ── Build ────────────────────────────────────────────────────────────

## Build everything: east-c native, east-py (incl. native Cython
## extensions built by scikit-build-core during install), all TS packages,
## then regenerate the Claude plugin search index + hook/MCP bundle (the
## committed artifacts CI verifies — keeps local search in sync with
## *.examples.ts).
build: check-deps
	$(MAKE) -C $(CURDIR)/libs/east-c build
	$(MAKE) -C $(CURDIR)/libs/east-py install
	pnpm build
	pnpm --filter '@elaraai/east-claude-plugin' run generate-index
	pnpm --filter '@elaraai/east-claude-plugin' run bundle

## Link all CLIs globally (e3, e3-api-server, east-node, east-py, east-c)
link:
	cd $(CURDIR)/libs/e3/packages/e3-cli && pnpm link --global
	cd $(CURDIR)/libs/e3/packages/e3-api-server && pnpm link --global
	cd $(CURDIR)/libs/east-node/packages/east-node-cli && pnpm link --global
	$(MAKE) -C $(CURDIR)/libs/east-c install-cli
	$(MAKE) -C $(CURDIR)/libs/east-py install-cli
	$(MAKE) -C $(CURDIR)/libs/east-ui extension-install
	@e3 completion install || echo "Note: run 'e3 completion install' manually to enable tab completion"

# ── Test / Lint (via Turbo) ──────────────────────────────────────────

## Run TS tests only (does not start services — use test-all for that)
test:
	pnpm test

## Lint all packages — TS via pnpm, Python via ruff + license headers,
## C via clang-format (installed automatically via uv tool).
lint: check-deps
	@echo "=== TypeScript ==="
	pnpm lint
	@echo ""
	@echo "=== Python (east-py) ==="
	$(MAKE) -C $(CURDIR)/libs/east-py lint
	@echo ""
	@echo "=== C (east-c) ==="
	$(MAKE) -C $(CURDIR)/libs/east-c lint

# ── Test Services (Docker) ───────────────────────────────────────────

## Start test services (Postgres, MySQL, MongoDB, Redis, MinIO, FTP, SFTP, httpbin)
services-up:
	@docker compose -f docker/services/docker-compose.yml --profile services up -d --wait 2>&1 | tail -1

## Stop test services
services-down:
	@docker compose -f docker/services/docker-compose.yml --profile services down -v 2>&1 | tail -1

## Show test services status
services-status:
	docker compose -f docker/services/docker-compose.yml --profile services ps

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
	EAST_QUIET=1 pnpm -r --no-bail run test > /tmp/east-ts-test.log 2>&1 || exit_code=1; \
	tail -12 /tmp/east-ts-test.log; \
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
	rm -rf libs/east-c/build
	cd libs/east-py && make clean
	rm -rf node_modules/.cache

# ── Help ─────────────────────────────────────────────────────────────

help:
	@echo "east-workspace (pnpm monorepo)"
	@echo ""
	@echo "First time:"
	@echo "  check-deps       - Verify required tools (uv, pnpm, cmake, cc, ...)"
	@echo "  setup            - Install emscripten SDK (one-time)"
	@echo "  install          - Install deps (pnpm + uv)"
	@echo "  build            - Build everything (east-c + WASM + east-py + TS)"
	@echo "  link             - Link CLIs globally"
	@echo ""
	@echo "Development:"
	@echo "  build            - Rebuild everything"
	@echo "  test             - Run TS tests (pnpm -r)"
	@echo "  lint             - Lint all (TS + Python + C)"
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
