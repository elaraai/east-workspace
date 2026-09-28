# east — core language package
# Dependencies are managed by pnpm from the monorepo root.

.PHONY: build test test-export query-corpus query-bench lint example clean help

## Build the package
build:
	pnpm run build

## Run tests (builds first)
test:
	pnpm run build && pnpm test

## Export test IR to /tmp/east-test-ir
test-export:
	pnpm run build && pnpm run test:export

## Rewrite the query corpus and fixture (test/fixtures/query-*.beast2) (builds first)
query-corpus:
	pnpm run build && pnpm run query-corpus

## Time translated queries against jq 1.8.1, by hand and never in CI: east-c
## (eager and lazy), east-node, compiled TypeScript and jq over the fixture
## scaled to 100 000 orders. Prints devdocs/QUERY.md §16.4's table. Builds
## east-c's CLI in Release first: an -O0 build times the build, not the code.
query-bench:
	pnpm run build
	cmake -S ../east-c -B ../east-c/build-release -DCMAKE_BUILD_TYPE=Release > /dev/null
	cmake --build ../east-c/build-release -j$$(nproc) --target east-c-cli > /dev/null
	node dist/test/query-bench/bench.js

## Run linter (builds first)
lint:
	pnpm run build && pnpm run lint

## Run examples
example:
	pnpm run build && pnpm run example

## Clean build artifacts
clean:
	rm -rf ./dist

## Show available targets
help:
	@echo "east (core language)"
	@echo ""
	@echo "  build       - Build the package"
	@echo "  test        - Run tests"
	@echo "  test-export - Export test IR to /tmp/east-test-ir"
	@echo "  query-corpus - Rewrite test/fixtures/query-corpus.beast2 and query-fixture.beast2"
	@echo "  query-bench - Time translated queries against jq (by hand; prints QUERY.md §16.4's table)"
	@echo "  lint        - Run linter"
	@echo "  example     - Run examples"
	@echo "  clean       - Clean build artifacts"
	@echo ""
	@echo "Dependencies are managed by pnpm from the monorepo root."
	@echo "Run 'pnpm install' from the workspace root to install deps."
