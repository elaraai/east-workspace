# east-diagnostics — East-aware diagnostic rules
# Dependencies are managed by pnpm from the monorepo root.

.PHONY: build test clean help

## Build the package
build:
	pnpm run build

## Run tests (builds first)
test:
	pnpm run test

## Clean build artifacts
clean:
	rm -rf ./dist

## Show available targets
help:
	@echo "east-diagnostics"
	@echo ""
	@echo "  build  - Build the package"
	@echo "  test   - Run tests"
	@echo "  clean  - Clean build artifacts"
