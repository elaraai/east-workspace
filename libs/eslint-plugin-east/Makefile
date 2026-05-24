# eslint-plugin-east — East idiom diagnostics for ESLint (editor + CI)
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
	@echo "eslint-plugin-east"
	@echo ""
	@echo "  build  - Build the package"
	@echo "  test   - Run tests"
	@echo "  clean  - Clean build artifacts"
