# create — the npm create initializers (scaffold-core, create-east, create-e3)
# Dependencies are managed by pnpm from the monorepo root.

.PHONY: build test lint clean help

## Build every package, in dependency order
build:
	pnpm -r --filter='./packages/*' run build

## Run every package's tests (builds first)
test: build
	pnpm -r --filter='./packages/*' run test

## Run every package's linter (none defines one yet)
lint:
	pnpm -r --filter='./packages/*' run lint

## Clean build artifacts
clean:
	rm -rf packages/*/dist

## Show available targets
help:
	@echo "create (the npm create initializers)"
	@echo ""
	@echo "  build  - Build scaffold-core, create-east and create-e3"
	@echo "  test   - Run their tests (builds first)"
	@echo "  lint   - Run their linters"
	@echo "  clean  - Clean build artifacts"
	@echo ""
	@echo "Dependencies are managed by pnpm from the monorepo root."
	@echo "Run 'pnpm install' from the workspace root to install deps."
