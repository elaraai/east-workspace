# east — core language package
# Dependencies are managed by pnpm from the monorepo root.

# The checkout's paths: where the corpora are exported (EAST_TEST_IR_DIR,
# EAST_EXAMPLES_IR_DIR), which the codegen spec reads back
include ../../paths.mk

.PHONY: build test test-export export-examples query-corpus query-types query-types-tables query-bench paged-weights lint example clean help

## Build the package
build:
	pnpm run build

## Run tests (builds first)
test:
	pnpm run build && pnpm test

## Export test IR to EAST_TEST_IR_DIR (this checkout's tmp/east-test-ir)
test-export:
	pnpm run build && pnpm run test:export

## Export every example as IR to EAST_EXAMPLES_IR_DIR (this checkout's
## tmp/east-examples-ir)
export-examples:
	pnpm run export:examples

## Rewrite the query corpus and fixture (test/fixtures/query-*.beast2) (builds first)
query-corpus:
	pnpm run build && pnpm run query-corpus

## Rewrite test/fixtures/query-types.json: the type matrix's cases (#987) run
## through jq 1.8.1, which must be on the PATH, then devdocs/QUERY.md §16.5's
## tables (builds first). By hand, never in CI; the matrix's spec fails while a
## case's recorded run is not current. `make query-types-tables` rewrites the
## tables alone, from the checked-in fixture, without jq.
query-types:
	pnpm run build && pnpm run query-types

query-types-tables:
	pnpm run build && node --enable-source-maps scripts/query-types.mjs --tables

## Time translated queries against jq 1.8.1, by hand and never in CI: east-c
## (eager and lazy), east-node, compiled TypeScript and jq over the fixture
## scaled to 100 000 orders. Prints devdocs/QUERY.md §16.4's table. Builds
## east-c's CLI in Release first: an -O0 build times the build, not the code.
query-bench:
	pnpm run build
	cmake -S ../east-c -B ../east-c/build-release -DCMAKE_BUILD_TYPE=Release > /dev/null
	cmake --build ../east-c/build-release -j$$(nproc) --target east-c-cli > /dev/null
	node dist/test/query-bench/bench.js

## Rewrite test/fixtures/paged-weights.beast2, the decoded weights every
## runtime's pager cache is held to (#1129), from test/paged-weights.fixture.ts
## (builds first); its spec fails while the file is not current.
paged-weights:
	pnpm run build && pnpm run paged-weights

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
	@echo "  build              - Build the package"
	@echo "  test               - Run tests"
	@echo "  test-export        - Export test IR to this checkout's tmp/east-test-ir"
	@echo "  export-examples    - Export every example as IR to this checkout's tmp/east-examples-ir"
	@echo "  query-corpus       - Rewrite test/fixtures/query-corpus.beast2 and query-fixture.beast2"
	@echo "  query-types        - Rewrite test/fixtures/query-types.json with jq 1.8.1's runs of the type matrix, and QUERY.md §16.5's tables"
	@echo "  query-types-tables - Rewrite QUERY.md §16.5's tables alone, from the checked-in runs (no jq)"
	@echo "  query-bench        - Time translated queries against jq (by hand; prints QUERY.md §16.4's table)"
	@echo "  paged-weights      - Rewrite test/fixtures/paged-weights.beast2, the decoded weights every runtime's pager cache is held to"
	@echo "  lint               - Run linter"
	@echo "  example            - Run examples"
	@echo "  clean              - Clean build artifacts"
	@echo ""
	@echo "Dependencies are managed by pnpm from the monorepo root."
	@echo "Run 'pnpm install' from the workspace root to install deps."
