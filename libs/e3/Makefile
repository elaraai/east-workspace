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

CORE := packages/e3-core
# e3-core's specs in shards, split as the integration specs are by their own
# recorded times (packages/e3-core/spec.timings.json, #1466), and found as its
# test script finds them: two shards, or SHARDS=n of them.
CORE_SHARDS := $(or $(SHARDS),2)
CORE_SHARD = $(shell cd $(CORE) && node ../../test/integration/dist/shard.js --timings=spec.timings.json --glob='dist/src/**/*.spec.js' $(SHARD) $(CORE_SHARDS))

## Run e3-core's unit tests, the longest of the packages', which CI runs in
## jobs of their own (#1466): every spec, or SHARD=n's of two (or of SHARDS).
## REPORT=file writes each spec's time to it too (the integration package's
## dist/file-times.js), the reports its dist/spec-timings.js refreshes the
## times from. A shard holding no spec fails rather than runs nothing.
test-packages-core:
	pnpm --filter @elaraai/e3-core --filter e3-integration-tests run build
	$(if $(SHARD),$(if $(strip $(CORE_SHARD)),,$(error e3-core shard $(SHARD) of $(CORE_SHARDS) holds no spec)))
	pnpm --filter @elaraai/e3-core run test:specs \
		$(if $(REPORT),--test-reporter-destination=stdout --test-reporter=../../test/integration/dist/file-times.js --test-reporter-destination="$(REPORT)") \
		$(if $(SHARD),$(CORE_SHARD),'dist/src/**/*.spec.js')

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
# The shards CI runs side by side, each its share of a split of the specs by
# the times CI recorded (test/integration/integration.timings.json, #1466),
# longest first to the shard with the least so far; a new spec counts as the
# median until the times are refreshed. Four shards, or SHARDS=n of them, as
# CI's macOS jobs run two: its runners are few.
INTEGRATION_SHARDS := $(or $(SHARDS),4)
INTEGRATION_SHARD = $(shell cd $(INTEGRATION) && node dist/shard.js --glob='dist/**/*.spec.js' $(SHARD) $(INTEGRATION_SHARDS))

ifneq ($(filter test-integration-shard integration-shard-specs,$(MAKECMDGOALS)),)
ifeq ($(filter $(SHARD),$(wordlist 1,$(INTEGRATION_SHARDS),1 2 3 4 5 6 7 8)),)
$(error $(MAKECMDGOALS) needs SHARD=1 to $(INTEGRATION_SHARDS), and SHARDS at most 8)
endif
endif

ifneq ($(and $(filter test-packages-core,$(MAKECMDGOALS)),$(SHARD)),)
ifeq ($(filter $(SHARD),$(wordlist 1,$(CORE_SHARDS),1 2 3 4 5 6 7 8)),)
$(error test-packages-core needs SHARD=1 to $(CORE_SHARDS), and SHARDS at most 8)
endif
endif

## Run one shard of the integration tests, as a CI job does (SHARD=1 to 4, or
## to SHARDS). REPORT=file writes each spec's time to it too
## (dist/file-times.js), the reports dist/spec-timings.js refreshes the
## times from. A shard holding no spec fails rather than runs nothing.
test-integration-shard: build-integration
	@echo "Running integration shard $(SHARD) of $(INTEGRATION_SHARDS)..."
	$(if $(strip $(INTEGRATION_SHARD)),,$(error integration shard $(SHARD) of $(INTEGRATION_SHARDS) holds no spec))
	pnpm --filter e3-integration-tests run test:specs \
		$(if $(REPORT),--test-reporter-destination=stdout --test-reporter=./dist/file-times.js --test-reporter-destination="$(REPORT)") \
		$(INTEGRATION_SHARD)

## Print the specs one integration shard runs (SHARD=1 to 4, or to SHARDS),
## once they are built
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
# On macOS the wheels are built to run from the macOS version the release
# builds east-py for, as localStack.ts builds them (MACOS_DEPLOYMENT_TARGET
# there says why): left alone, east-py's wheel is tagged for the build
# machine's own macOS, which an install for the platform a rack reports does
# not take. Other systems ignore it.
e2e-stack: export MACOSX_DEPLOYMENT_TARGET ?= 11.0
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
	@echo "  test-packages-core - Run e3-core's unit tests, or SHARD=n's of two CI shards split by recorded time (REPORT=file for its times)"
	@echo "  test-packages-rest - Run every other package's unit tests, as CI's packages job does"
	@echo "  test-as-another-user - Run the spec of processes run as another user (sudo, POSIX)"
	@echo "  test-integration - Run the integration tests"
	@echo "  test-integration-shard SHARD=n - Run one of CI's four integration shards, split by recorded time (SHARDS=n for another count, REPORT=file for its times)"
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
