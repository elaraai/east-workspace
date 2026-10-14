.PHONY: build index package test help
build:
	pnpm run build
index:
	pnpm run generate-index
## Assemble both plugins as the hosts install them, under marketplace/ (a local
## marketplace): this package built first, since the hosts' bundles inline its dist
package:
	pnpm run build
	pnpm --filter @elaraai/east-claude-plugin run bundle
	pnpm --filter @elaraai/east-codex-plugin run bundle
	pnpm run package
test:
	pnpm test
help:
	@echo "Shared East plugin runtime: build, index, package (build, bundle both hosts, assemble both plugins under marketplace/), test"
