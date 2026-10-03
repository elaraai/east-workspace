# east — core language package
# Dependencies are managed by pnpm from the monorepo root.

# The checkout's paths: where the corpora are exported (EAST_TEST_IR_DIR,
# EAST_EXAMPLES_IR_DIR), which the codegen spec reads back
include ../../paths.mk

.PHONY: build test test-export export-examples lint example clean help

## Build the package
build:
	pnpm run build

## Run tests (builds first)
test:
	pnpm run build && pnpm test

## Export test IR to EAST_TEST_IR_DIR (this checkout's tmp/east-test-ir)
test-export:
	pnpm run build && pnpm run test:export

## Export every example as IR to EAST_EXAMPLES_IR_DIR (this checkout's
## tmp/east-examples-ir)
export-examples:
	pnpm run export:examples

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
	@echo "  build           - Build the package"
	@echo "  test            - Run tests"
	@echo "  test-export     - Export test IR to this checkout's tmp/east-test-ir"
	@echo "  export-examples - Export every example as IR to this checkout's tmp/east-examples-ir"
	@echo "  lint            - Run linter"
	@echo "  example         - Run examples"
	@echo "  clean           - Clean build artifacts"
	@echo ""
	@echo "Dependencies are managed by pnpm from the monorepo root."
	@echo "Run 'pnpm install' from the workspace root to install deps."
