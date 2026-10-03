# east-node — Node.js platform packages
# Dependencies are managed by pnpm from the monorepo root.

# The checkout's paths: where the suites are exported (EAST_NODE_STD_IR,
# EAST_NODE_IO_IR)
include ../../paths.mk

.PHONY: build test test-export test-export-std test-export-io lint clean help

## Build the project: every package, in dependency order
build:
	pnpm -r --filter='./packages/*' run build

## Run all tests (builds first), one package at a time
test:
	pnpm -r --filter='./packages/*' run build
	pnpm -r --workspace-concurrency=1 --filter='./packages/*' run test

## Export test IR from packages that support it
test-export:
	pnpm --filter @elaraai/east-node-std run test:export
	pnpm --filter @elaraai/east-node-io run test:export

## Export test IR from east-node-std only (no Docker services needed), into
## EAST_NODE_STD_IR (this checkout's tmp/east-node-std)
test-export-std:
	pnpm --filter @elaraai/east-node-std run test:export

## Export test IR from east-node-io only (requires Docker services), into
## EAST_NODE_IO_IR (this checkout's tmp/east-node-io)
test-export-io:
	pnpm --filter @elaraai/east-node-io run test:export

## Run linter (builds first)
lint:
	pnpm -r --filter='./packages/*' run build
	pnpm -r --filter='./packages/*' run lint

## Clean build artifacts
clean:
	rm -rf packages/*/dist/
	rm -rf packages/*/.package/

## Show available targets
help:
	@echo "east-node (Node.js platform packages)"
	@echo ""
	@echo "  build       - Build the project"
	@echo "  test        - Run all tests"
	@echo "  test-export - Export test IR from all packages"
	@echo "  lint        - Run linter"
	@echo "  clean       - Clean build artifacts"
	@echo ""
	@echo "Dependencies are managed by pnpm from the monorepo root."
	@echo "Run 'pnpm install' from the workspace root to install deps."
