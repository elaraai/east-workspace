# e3 — East Execution Engine
# Dependencies are managed by pnpm from the monorepo root.

.PHONY: all build build-integration test test-packages test-integration test-integration-shard lint clean dev link e2e-stack job-launcher install-job help

# Default target
all: build

## Build all packages (in dependency order)
build:
	@echo "Building all packages..."
	pnpm -r --filter='./packages/*' --filter='./test/*' run build

## Run all tests
# --workspace-concurrency=1 runs one package's test script at a time. The
# integration suite spawns many e3 / east-node subprocesses; running
# packages in parallel starves CPU on smaller CI runners (Windows
# especially), inflating wall-clock and causing nondeterministic timeouts.
# Serial execution trades a little speed for reproducible timing.
test: test-packages test-integration

## Run the unit tests of e3's packages
test-packages:
	@echo "Running package tests..."
	pnpm -r --workspace-concurrency=1 --filter='./packages/*' run test

## Run the integration tests
test-integration:
	@echo "Running integration tests..."
	pnpm -r --workspace-concurrency=1 --filter='./test/*' run test

## Compile the integration specs
build-integration:
	pnpm --filter e3-integration-tests run build

INTEGRATION := test/integration
# Every compiled integration spec, as the package's scripts name them.
# Expanded only in a recipe, once build-integration has compiled them.
INTEGRATION_SPECS = $(patsubst $(INTEGRATION)/%,%,$(wildcard $(INTEGRATION)/dist/*.spec.js $(INTEGRATION)/dist/*/*.spec.js))
# The shards CI runs side by side. Shards 1 and 2 name the longest-running
# specs; shard 3 runs every spec neither names, so a new spec lands there.
INTEGRATION_SHARD_1 := dist/api-compliance.spec.js dist/rekey-bound.spec.js
INTEGRATION_SHARD_2 := dist/partition-merge-parity.spec.js dist/e2e-workflow.spec.js dist/dataset-set.spec.js
INTEGRATION_SHARD_3 = $(filter-out $(INTEGRATION_SHARD_1) $(INTEGRATION_SHARD_2),$(INTEGRATION_SPECS))

ifneq ($(filter test-integration-shard,$(MAKECMDGOALS)),)
ifeq ($(filter 1 2 3,$(SHARD)),)
$(error test-integration-shard needs SHARD=1, 2 or 3)
endif
endif

## Run one shard of the integration tests, as a CI job does (SHARD=1, 2 or 3)
test-integration-shard: build-integration
	@echo "Running integration shard $(SHARD)..."
	pnpm --filter e3-integration-tests run test:specs $(INTEGRATION_SHARD_$(SHARD))

## Run all linters
lint:
	@echo "Linting all packages..."
	pnpm run lint

## Pre-build the local @elaraai stack the environment e2e materializes.
## Optional: test/integration/src/localStack.ts builds it on demand. Running it
## as its own step attributes a native-build failure to a named target instead
## of surfacing as an opaque skip, and keeps `make test` timing honest.
e2e-stack:
	@echo "Building local @elaraai python wheels for the environment e2e..."
	uv build --wheel --out-dir test/integration/.local-stack/pypi ../east-py/packages/east-py
	uv build --wheel --out-dir test/integration/.local-stack/pypi ../east-py/packages/east-py-std
	uv build --wheel --out-dir test/integration/.local-stack/pypi ../east-py/packages/east-py-cli

REPO_ROOT := $(abspath $(CURDIR)/../..)
JOB_SOURCE := native/e3-job
JOB_BUILD := $(JOB_SOURCE)/build
# Where e3-core finds the launcher in this checkout: the workspace
# node_modules, staged as the per-platform package a published install carries
# (release.yml's build-e3-job packs the same staging for npm).
JOB_PACKAGE := $(REPO_ROOT)/node_modules/@elaraai/e3-job-win32-x64

## Build the Windows job launcher, e3-job.exe (Windows, in an MSVC environment)
job-launcher:
ifeq ($(OS),Windows_NT)
	cmake -S $(JOB_SOURCE) -B $(JOB_BUILD) -G Ninja -DCMAKE_BUILD_TYPE=Release
	cmake --build $(JOB_BUILD)
else
	@echo "e3-job is a Windows program: there is nothing to build on this platform" >&2; exit 1
endif

## Install the job launcher where e3-core finds it in this checkout (Windows).
## Without it e3 on Windows runs runners outside a job object and warns
## (E3_NO_JOB_LAUNCHER); see native/e3-job/README.md.
install-job: job-launcher
	node $(REPO_ROOT)/scripts/stage-e3-job-package.mjs --exe $(JOB_BUILD)/e3-job.exe --out $(JOB_PACKAGE)

## Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	rm -rf packages/*/dist/
	rm -rf test/*/dist/
	rm -rf test/integration/.local-stack/
	rm -rf $(JOB_BUILD)/
	@echo "Clean complete"

## Development setup (build only — deps from monorepo root)
dev: build
	@echo ""
	@echo "Development environment ready!"
	@echo ""
	@echo "To run the CLI:"
	@echo "  cd packages/e3-cli && pnpm run dev"

## Link e3 CLI globally so 'e3' is available in PATH
link:
	cd packages/e3-cli && pnpm link --global

## Show available targets
help:
	@echo "e3 - East Execution Engine"
	@echo ""
	@echo "  build       - Build all packages"
	@echo "  test        - Run all tests"
	@echo "  test-packages - Run the unit tests of e3's packages"
	@echo "  test-integration - Run the integration tests"
	@echo "  test-integration-shard SHARD=n - Run one of CI's three integration shards"
	@echo "  build-integration - Compile the integration specs"
	@echo "  lint        - Run linters"
	@echo "  clean       - Clean build artifacts"
	@echo "  dev         - Build for development"
	@echo "  job-launcher - Build the Windows job launcher (Windows, MSVC environment)"
	@echo "  install-job - Build it and install it where e3-core finds it (Windows)"
	@echo ""
	@echo "Dependencies are managed by pnpm from the monorepo root."
	@echo "Run 'pnpm install' from the workspace root to install deps."
