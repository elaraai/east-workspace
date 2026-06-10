# tsserver-plugin-east — East diagnostics as a TypeScript language service plugin
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
	@echo "tsserver-plugin-east"
	@echo ""
	@echo "  build  - bundle dist/index.cjs"
	@echo "  test   - build + smoke tests"
	@echo "  clean  - remove dist"
