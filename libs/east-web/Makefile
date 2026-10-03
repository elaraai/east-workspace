# east-web — the browser's platform packages
# Dependencies are managed by pnpm from the monorepo root.

# The checkout's paths: where east-node-std's suites are (EAST_NODE_STD_IR)
include ../../paths.mk

.PHONY: build test test-compliance lint clean help

## Build the project: every package, in dependency order
build:
	pnpm -r --filter='./packages/*' run build

## Run all tests (builds first): the specs, then east-node-std's compliance
## suite over east-web-std, exported afresh from east-node-std. The Fetch
## suite needs httpbin on :8085 (the root's `make services-up`).
test:
	pnpm -r --filter='./packages/*' run build
	pnpm -r --filter='./packages/*' run test
	$(MAKE) --no-print-directory -C $(CURDIR)/../east-node test-export-std
	pnpm --filter @elaraai/east-web-std run test:compliance

## Run east-node-std's exported compliance suite over east-web-std, from
## EAST_NODE_STD_IR, this checkout's tmp/east-node-std
## (`make -C ../east-node test-export-std`, or the root's `make test-export`,
## writes it)
test-compliance:
	pnpm --filter @elaraai/east-web-std run test:compliance

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
	@echo "east-web (the browser's platform packages)"
	@echo ""
	@echo "  build           - Build the project"
	@echo "  test            - Run all tests: the specs, then east-node-std's compliance suite (exported first)"
	@echo "  test-compliance - Run east-node-std's exported compliance suite over east-web-std"
	@echo "  lint            - Run linter"
	@echo "  clean           - Clean build artifacts"
	@echo ""
	@echo "Dependencies are managed by pnpm from the monorepo root."
	@echo "Run 'pnpm install' from the workspace root to install deps."
