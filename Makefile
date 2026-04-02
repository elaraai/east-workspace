# east-workspace — pnpm + turborepo monorepo
# All npm deps managed by pnpm from root. Turbo orchestrates build/test/lint.

.PHONY: install build test lint clean services-up services-down services-status test-all test-export help

# ── Setup ─────────────────────────────────────────────────────────────

## Install all dependencies (pnpm for TS, uv for Python, cmake for C)
install:
	pnpm install
	cd libs/east-py && make install
	cd libs/east-c && make build

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

## Start services, run all tests, stop services
test-all: services-up test-export
	@exit_code=0; \
	pnpm test || exit_code=1; \
	cd libs/east-c && make test-all || exit_code=1; \
	cd libs/east-py && make test || exit_code=1; \
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
	@echo "  install          - pnpm install + uv sync (east-py) + cmake (east-c)"
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
	@echo "  test-all         - services-up + test-export + test + services-down"
	@echo ""
	@echo "Maintenance:"
	@echo "  clean            - Remove all build artifacts"
