# e3 — East Execution Engine
# Dependencies are managed by pnpm from the monorepo root.

.PHONY: all build test lint clean dev link help

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

## Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	rm -rf packages/*/dist/
	rm -rf test/*/dist/
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
	@echo ""
	@echo "Dependencies are managed by pnpm from the monorepo root."
	@echo "Run 'pnpm install' from the workspace root to install deps."
