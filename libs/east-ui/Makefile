# east-ui — UI packages and VS Code extension
# Dependencies are managed by pnpm from the monorepo root.

.PHONY: build test lint dev clean extension extension-install extension-uninstall help

## Build all packages (in dependency order)
build:
	pnpm run build

## Run tests for all packages
test:
	pnpm run test

## Run linting for all packages
lint:
	pnpm run lint

## Run the showcase dev server
dev:
	rm -rf ./packages/east-ui-showcase/node_modules/.vite && pnpm run dev

## Build and package the VSCode extension
extension:
	cd packages/east-ui-extension && pnpm run build && pnpm run package

## Package and install the VSCode extension
extension-install: extension
	code --install-extension packages/east-ui-extension/*.vsix

## Uninstall the VSCode extension
extension-uninstall:
	code --uninstall-extension elaraai.east-ui-preview || true

## Clean build artifacts
clean:
	rm -rf packages/*/dist packages/east-ui-extension/*.vsix

## Show available targets
help:
	@echo "east-ui (UI packages + VS Code extension)"
	@echo ""
	@echo "  build             - Build all packages"
	@echo "  test              - Run tests"
	@echo "  lint              - Run linters"
	@echo "  dev               - Run showcase dev server"
	@echo "  extension         - Build and package VS Code extension"
	@echo "  extension-install - Install VS Code extension"
	@echo "  extension-uninstall - Uninstall VS Code extension"
	@echo "  clean             - Clean build artifacts"
	@echo ""
	@echo "Dependencies are managed by pnpm from the monorepo root."
	@echo "Run 'pnpm install' from the workspace root to install deps."
