EAST_ROOT := $(realpath $(dir $(CURDIR)))
SCRIPTS   := $(CURDIR)/scripts

# Use nvm locally, skip in CI where node is already on PATH
ifdef NVM_DIR
NVM := . ${NVM_DIR}/nvm.sh && nvm use &&
endif

.PHONY: help install install-hooks \
        registry-up registry-down publish-local publish-status test-integration restore \
        services-up services-down services-status \
        build-all test-all test-export \
        test-export-east test-export-east-node test-export-east-py \
        test-east test-east-node test-east-c test-east-py test-e3 test-east-ui test-e3-cloud \
        build-east build-east-node build-east-c build-east-py build-e3 build-east-ui build-e3-cloud

# ── Setup ─────────────────────────────────────────────────────────────

## Install all repo dependencies and pre-commit hooks
install:
	cd $(EAST_ROOT)/east && make install
	cd $(EAST_ROOT)/east-node && make install
	cd $(EAST_ROOT)/east-c && make install
	cd $(EAST_ROOT)/east-py && make install
	cd $(EAST_ROOT)/e3 && make install
	cd $(EAST_ROOT)/east-ui && make install
	cd $(EAST_ROOT)/east-aws && make install
	$(SCRIPTS)/install-hooks.sh

## Install pre-commit hooks into all workspace repos
install-hooks:
	$(SCRIPTS)/install-hooks.sh

# ── Local Registry (Verdaccio) ────────────────────────────────────────

## Start local npm registry
registry-up:
	docker compose up -d
	@echo "Waiting for Verdaccio..." && sleep 2
	@curl -s http://localhost:4873 >/dev/null && echo "Verdaccio ready at http://localhost:4873"

## Stop local npm registry
registry-down:
	docker compose down

## Build all repos and publish to local registry (in dependency order)
publish-local: registry-up
	$(SCRIPTS)/publish-local.sh

## Show publish status: registry, packages, and dependency resolution
publish-status:
	$(SCRIPTS)/publish-status.sh

## Run tests across all repos (starts services, exports IR, runs tests, stops services)
test-all: services-up test-export
	@exit_code=0; \
	echo "=== east ===" && cd $(EAST_ROOT)/east && make test || exit_code=1; \
	echo "=== east-node ===" && cd $(EAST_ROOT)/east-node && make test || exit_code=1; \
	echo "=== east-c ===" && cd $(EAST_ROOT)/east-c && make test || exit_code=1; \
	echo "=== east-py ===" && cd $(EAST_ROOT)/east-py && make test || exit_code=1; \
	echo "=== e3 ===" && cd $(EAST_ROOT)/e3 && make test || exit_code=1; \
	echo "=== east-ui ===" && cd $(EAST_ROOT)/east-ui && make test || exit_code=1; \
	echo "=== e3-cloud ===" && cd $(EAST_ROOT)/east-aws && make test || exit_code=1; \
	$(MAKE) services-down; \
	exit $$exit_code

## Full integration: publish local + test all
test-integration: publish-local test-all
	@echo "✓ All repos pass against local packages"

## Remove .npmrc files and reinstall from npm registry
restore:
	$(SCRIPTS)/restore.sh

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

## Export test IR from east (writes to /tmp/east-test-ir)
test-export-east:
	cd $(EAST_ROOT)/east && make test-export

## Export test IR from east-node (writes to /tmp/east-node-std, /tmp/east-node-io)
test-export-east-node:
	cd $(EAST_ROOT)/east-node && make test-export

## Export test IR from east-py (writes to /tmp/east-py-datascience)
test-export-east-py:
	cd $(EAST_ROOT)/east-py && make test-export

## Export all test IR (required before test-east-py)
test-export: test-export-east test-export-east-node test-export-east-py

# ── Build ─────────────────────────────────────────────────────────────

build-east:
	cd $(EAST_ROOT)/east && make build

build-east-node:
	cd $(EAST_ROOT)/east-node && make build

build-east-c:
	cd $(EAST_ROOT)/east-c && make build

build-east-py:
	cd $(EAST_ROOT)/east-py && make build

build-e3:
	cd $(EAST_ROOT)/e3 && make build

build-east-ui:
	cd $(EAST_ROOT)/east-ui && make build

build-e3-cloud:
	cd $(EAST_ROOT)/east-aws && make build

build-all: build-east build-east-node build-east-c build-east-py build-e3 build-east-ui build-e3-cloud

# ── Test (individual) ────────────────────────────────────────────────

test-east:
	cd $(EAST_ROOT)/east && make test

test-east-node:
	cd $(EAST_ROOT)/east-node && make test

test-east-c:
	cd $(EAST_ROOT)/east-c && make test

test-east-py:
	cd $(EAST_ROOT)/east-py && make test

test-e3:
	cd $(EAST_ROOT)/e3 && make test

test-east-ui:
	cd $(EAST_ROOT)/east-ui && make test

test-e3-cloud:
	cd $(EAST_ROOT)/east-aws && make test

# ── Help ─────────────────────────────────────────────────────────────

help:
	@echo "east-workspace"
	@echo ""
	@echo "Setup:"
	@echo "  install          - Install all repo dependencies + pre-commit hooks"
	@echo "  install-hooks    - Install pre-commit hooks only"
	@echo ""
	@echo "Local registry (Verdaccio):"
	@echo "  registry-up      - Start local npm registry (Docker)"
	@echo "  registry-down    - Stop local npm registry"
	@echo "  publish-local    - Build and publish all packages to local registry"
	@echo "  publish-status   - Show registry, packages, and dep resolution status"
	@echo "  test-integration - publish-local + test all repos"
	@echo "  restore          - Remove .npmrc files, reinstall from npm registry"
	@echo ""
	@echo "Test services (Docker):"
	@echo "  services-up      - Start test services (Postgres, Redis, etc.)"
	@echo "  services-down    - Stop test services"
	@echo "  services-status  - Show test services status"
	@echo ""
	@echo "Test IR export (needed before test-east-py):"
	@echo "  test-export      - Export all test IR"
	@echo "  test-export-{east,east-node,east-py}"
	@echo ""
	@echo "Build/test individual repos:"
	@echo "  build-{east,east-node,east-c,east-py,e3,east-ui,e3-cloud}"
	@echo "  test-{east,east-node,east-c,east-py,e3,east-ui,e3-cloud}"
	@echo ""
	@echo "Aggregate:"
	@echo "  build-all        - Build all repos"
	@echo "  test-all         - Test all repos"
