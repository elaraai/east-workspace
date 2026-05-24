# east-claude-plugin — Claude Code plugin (hooks, MCP search, diagnostics daemon)
# Dependencies are managed by pnpm from the monorepo root.

.PHONY: build index test clean help

## Build the shipped artifacts: tsc (dist/) + esbuild bundle (.build/)
build:
	pnpm run build && pnpm run bundle

## Regenerate the example search index (index.json)
index:
	pnpm run generate-index

## Build + bundle, then run the integration tests (incl. the diagnose pipeline)
test:
	pnpm run test

## Clean tsc output (leaves the committed .build bundle)
clean:
	rm -rf ./dist

## Show available targets
help:
	@echo "east-claude-plugin"
	@echo ""
	@echo "  build  - tsc (dist/) + esbuild bundle (.build/)"
	@echo "  index  - regenerate the example search index (index.json)"
	@echo "  test   - build + bundle + run integration tests"
	@echo "  clean  - remove tsc output"
