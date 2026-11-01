# e3 — East Execution Engine
# Dependencies are managed by pnpm from the monorepo root.

# The checkout's paths: its root, and where east-node-std's suites are
# (EAST_NODE_STD_IR), which e3-web's Chromium compliance spec runs
include ../../paths.mk

.PHONY: all build build-integration test test-packages test-packages-core test-packages-rest test-as-another-user test-integration test-integration-shard integration-shard-specs lint clean dev link e2e-stack job-launcher install-job help

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
# --no-bail runs every package's tests however many fail, and fails the target
# once all have run, naming each that failed: one run reports them all.
test-packages:
	@echo "Running package tests..."
	pnpm -r --workspace-concurrency=1 --no-bail --filter='./packages/*' run test

## Run e3-core's unit tests, the longest of the packages', which CI runs in a
## job of its own (#1466)
test-packages-core:
	pnpm --filter @elaraai/e3-core run test

## Run every other package's unit tests, as CI's packages job does
test-packages-rest:
	pnpm -r --workspace-concurrency=1 --no-bail --filter='./packages/*' --filter='!@elaraai/e3-core' run test

## Run e3-core's spec of a runner whose processes run as another user, which
## the package tests skip: switching users needs root, so it runs under sudo,
## as the user sudo names (SUDO_UID), once e3-core is built (POSIX)
test-as-another-user:
	cd packages/e3-core && E3_TEST_AS_ROOT=1 node --enable-source-maps --test-reporter=spec --test-timeout=480000 --test dist/src/execution/another-user.spec.js

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
# The shards CI runs side by side, each its share of a split of the specs by
# the times CI recorded (test/integration/integration.timings.json, #1466),
# longest first to the shard with the least so far; a new spec counts as the
# median until the times are refreshed.
INTEGRATION_SHARDS := 4
INTEGRATION_SHARD = $(shell cd $(INTEGRATION) && node dist/shard.js $(SHARD) $(INTEGRATION_SHARDS) $(INTEGRATION_SPECS))

ifneq ($(filter test-integration-shard integration-shard-specs,$(MAKECMDGOALS)),)
ifeq ($(filter 1 2 3 4,$(SHARD)),)
$(error $(MAKECMDGOALS) needs SHARD=1, 2, 3 or 4)
endif
endif

## Run one shard of the integration tests, as a CI job does (SHARD=1 to 4).
## REPORT=file writes each spec's time to it too (dist/file-times.js), the
## reports dist/integration-timings.js refreshes the times from.
test-integration-shard: build-integration
	@echo "Running integration shard $(SHARD) of $(INTEGRATION_SHARDS)..."
	pnpm --filter e3-integration-tests run test:specs \
		$(if $(REPORT),--test-reporter-destination=stdout --test-reporter=./dist/file-times.js --test-reporter-destination="$(REPORT)") \
		$(INTEGRATION_SHARD)

## Print the specs one integration shard runs (SHARD=1 to 4), once they are built
integration-shard-specs:
	@echo $(INTEGRATION_SHARD)

## Run all linters: every package's, and the integration specs'
lint:
	@echo "Linting all packages..."
	pnpm -r --filter='./packages/*' --filter='./test/*' run lint

## Pre-build the local @elaraai stack the environment e2e materializes.
## Optional: test/integration/src/localStack.ts builds it on demand. Running it
## as its own step attributes a native-build failure to a named target instead
## of surfacing as an opaque skip, and keeps `make test` timing honest.
e2e-stack:
	@echo "Building local @elaraai python wheels for the environment e2e..."
	uv build --wheel --out-dir test/integration/.local-stack/pypi ../east-py/packages/east-py
	uv build --wheel --out-dir test/integration/.local-stack/pypi ../east-py/packages/east-py-std
	uv build --wheel --out-dir test/integration/.local-stack/pypi ../east-py/packages/east-py-cli

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
	@echo "  test-packages-core - Run e3-core's unit tests, a CI job of their own"
	@echo "  test-packages-rest - Run every other package's unit tests, as CI's packages job does"
	@echo "  test-as-another-user - Run the spec of processes run as another user (sudo, POSIX)"
	@echo "  test-integration - Run the integration tests"
	@echo "  test-integration-shard SHARD=n - Run one of CI's four integration shards, split by recorded time (REPORT=file for its times)"
	@echo "  integration-shard-specs SHARD=n - Print the specs one integration shard runs"
	@echo "  build-integration - Compile the integration specs"
	@echo "  lint        - Run linters"
	@echo "  clean       - Clean build artifacts"
	@echo "  dev         - Build for development"
	@echo "  job-launcher - Build the Windows job launcher (Windows, MSVC environment)"
	@echo "  install-job - Build it and install it where e3-core finds it (Windows)"
	@echo ""
	@echo "Dependencies are managed by pnpm from the monorepo root."
	@echo "Run 'pnpm install' from the workspace root to install deps."
