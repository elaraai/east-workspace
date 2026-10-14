# east-claude-plugin — Claude Code plugin (hooks, MCP search, diagnostics daemon)
# Dependencies are managed by pnpm from the monorepo root.

.PHONY: build index test clean help

## Build the shipped plugin: tsc (dist/) + esbuild bundle (.build/) + the
## assembled plugin under ../east-plugin/marketplace/east-claude-plugin (a local marketplace)
build:
	pnpm run build && pnpm run bundle && pnpm run package

## Regenerate the example search index (../east-plugin/index.json)
index:
	$(MAKE) -C ../east-plugin index

## Build + bundle + assemble, then run the integration tests over the assembled plugin
test:
	pnpm run test

## Clean tsc output and the bundle
clean:
	rm -rf ./dist ./.build

## Show available targets
help:
	@echo "east-claude-plugin"
	@echo ""
	@echo "  build  - tsc (dist/) + esbuild bundle (.build/) + assemble the plugin under ../east-plugin/marketplace/"
	@echo "  index  - regenerate the example search index (../east-plugin/index.json)"
	@echo "  test   - build + bundle + assemble + run integration tests"
	@echo "  clean  - remove tsc output and the bundle"
