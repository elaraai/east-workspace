# east — core language package
# Dependencies are managed by pnpm from the monorepo root.

.PHONY: build test test-export lint example clean help

## Build the package
build:
	pnpm run build

## Run tests (builds first)
test:
	pnpm run build && pnpm test

## Export test IR to /tmp/east-test-ir
test-export:
	pnpm run build && pnpm run test:export

## Run linter (builds first)
lint:
	pnpm run build && pnpm run lint

## Run examples
example:
	pnpm run build && pnpm run example

## Clean build artifacts
clean:
	rm -rf ./dist

## Show available targets
help:
	@echo "east (core language)"
	@echo ""
	@echo "  build       - Build the package"
	@echo "  test        - Run tests"
	@echo "  test-export - Export test IR to /tmp/east-test-ir"
	@echo "  lint        - Run linter"
	@echo "  example     - Run examples"
	@echo "  clean       - Clean build artifacts"
	@echo ""
	@echo "Dependencies are managed by pnpm from the monorepo root."
	@echo "Run 'pnpm install' from the workspace root to install deps."
