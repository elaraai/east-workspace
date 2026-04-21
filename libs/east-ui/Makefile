# east-ui — UI packages and VS Code extension
# Dependencies are managed by pnpm from the monorepo root.

.PHONY: build test lint dev clean extension extension-install extension-uninstall examples help

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

## Rebuild only the example-source packages (east-ui + e3-ui)
examples:
	pnpm --filter @elaraai/east-ui --filter @elaraai/e3-ui run build

## Build and package the VSCode extension
extension:
	rm -f packages/east-ui-extension/*.vsix
	cd packages/east-ui-extension && pnpm run build && pnpm run package

## Package and install the VSCode extension.
##
## The `code` CLI under Remote-SSH needs VSCODE_IPC_HOOK_CLI to point at a
## live Unix socket. If the current value is stale (e.g. inherited from a
## prior session), we fall back to the newest socket under /run/user/$UID.
extension-install: extension
	@$(MAKE) --no-print-directory _code-run ARGS="--install-extension packages/east-ui-extension/*.vsix"

## Uninstall the VSCode extension
extension-uninstall:
	@$(MAKE) --no-print-directory _code-run ARGS="--uninstall-extension elaraai.east-ui-preview" || true

## Internal: run `code` with a valid VSCODE_IPC_HOOK_CLI socket
_code-run:
	@sock="$$VSCODE_IPC_HOOK_CLI"; \
	if [ -z "$$sock" ] || [ ! -S "$$sock" ]; then \
		sock=$$(ls -t /run/user/$$(id -u)/vscode-ipc-*.sock 2>/dev/null | head -1); \
	fi; \
	if [ -z "$$sock" ] || [ ! -S "$$sock" ]; then \
		echo "error: no live VS Code IPC socket found; open a VS Code terminal and retry" >&2; \
		exit 1; \
	fi; \
	VSCODE_IPC_HOOK_CLI="$$sock" code $(ARGS)

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
	@echo "  examples          - Rebuild east-ui + e3-ui (example sources)"
	@echo "  extension         - Build and package VS Code extension"
	@echo "  extension-install - Install VS Code extension"
	@echo "  extension-uninstall - Uninstall VS Code extension"
	@echo "  clean             - Clean build artifacts"
	@echo ""
	@echo "Dependencies are managed by pnpm from the monorepo root."
	@echo "Run 'pnpm install' from the workspace root to install deps."
