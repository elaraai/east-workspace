# east-web — the browser's platform packages
# Dependencies are managed by pnpm from the monorepo root.

.PHONY: build test test-compliance lint clean help

## Build the project
build:
	pnpm run build

## Run all tests (builds first): the specs, then east-node-std's compliance
## suite over east-web-std, exported afresh from east-node-std. The Fetch
## suite needs httpbin on :8085 (the root's `make services-up`).
test:
	pnpm run build && pnpm test
	$(MAKE) --no-print-directory -C $(CURDIR)/../east-node test-export-std
	pnpm run test:compliance

## Run east-node-std's exported compliance suite over east-web-std, from
## /tmp/east-node-std (`make -C ../east-node test-export-std`, or the root's
## `make test-export`, writes it)
test-compliance:
	pnpm run test:compliance

## Run linter (builds first)
lint:
	pnpm run build && pnpm run lint

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
