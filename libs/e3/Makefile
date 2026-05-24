# e3 — East Execution Engine
# Dependencies are managed by pnpm from the monorepo root.

.PHONY: all build test lint clean dev link fuzz fuzz-quick fuzz-stress fuzz-build help

# Default target
all: build

## Build all packages (in dependency order)
build:
	@echo "Building all packages..."
	pnpm -r --filter='./packages/*' --filter='./test/*' run build

## Run all tests
test:
	@echo "Running tests..."
	pnpm -r --filter='./packages/*' --filter='./test/*' run test

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

## Build fuzz tests
fuzz-build:
	@echo "Building fuzz tests..."
	pnpm --filter=e3-fuzz run build

## Run fuzz tests (100 iterations)
fuzz: fuzz-build
	@echo "Running fuzz tests..."
	pnpm --filter=e3-fuzz run fuzz

## Run quick fuzz tests (10 iterations)
fuzz-quick: fuzz-build
	@echo "Running quick fuzz tests..."
	pnpm --filter=e3-fuzz run fuzz:quick

## Run stress fuzz tests (1000 iterations)
fuzz-stress: fuzz-build
	@echo "Running stress fuzz tests..."
	pnpm --filter=e3-fuzz run fuzz:stress

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
	@echo "  fuzz        - Run fuzz tests (100 iterations)"
	@echo "  fuzz-quick  - Run quick fuzz tests (10 iterations)"
	@echo "  fuzz-stress - Run stress fuzz tests (1000 iterations)"
	@echo ""
	@echo "Dependencies are managed by pnpm from the monorepo root."
	@echo "Run 'pnpm install' from the workspace root to install deps."
