# e3 — East Execution Engine
# Dependencies are managed by pnpm from the monorepo root.

.PHONY: all build test lint clean dev link e2e-stack job-launcher install-job help

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
test:
	@echo "Running tests..."
	pnpm -r --workspace-concurrency=1 --filter='./packages/*' run test
	pnpm -r --workspace-concurrency=1 --filter='./test/*' run test

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
	@echo "  lint        - Run linters"
	@echo "  clean       - Clean build artifacts"
	@echo "  dev         - Build for development"
	@echo "  job-launcher - Build the Windows job launcher (Windows, MSVC environment)"
	@echo "  install-job - Build it and install it where e3-core finds it (Windows)"
	@echo ""
	@echo "Dependencies are managed by pnpm from the monorepo root."
	@echo "Run 'pnpm install' from the workspace root to install deps."
