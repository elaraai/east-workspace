# east-py-datascience — hybrid TypeScript + Python package
# TS deps managed by pnpm from monorepo root. Python deps managed by uv from east-py root.

.PHONY: build test test-export test-ts test-py lint typecheck clean help

## Build the TypeScript project
build:
	pnpm run build

## Export the spec IR to /tmp/east-py-datascience (the Python side replays it)
test-export:
	pnpm run test:export

## Full test suite: export IR from the TypeScript specs, then replay it with pytest
test: test-export
	uv run pytest -v

## Run the TypeScript specs as node tests (they are export-only: no assertions run here)
test-ts:
	pnpm run test

## Replay already-exported IR (EAST_DATASCIENCE_IR_DIR, default /tmp/east-py-datascience)
test-py:
	uv run pytest

## Lint: eslint on the TypeScript side, ruff on the Python side
lint:
	pnpm run lint
	uv run ruff check src/east_py_datascience tests

## Type-check the Python side
typecheck:
	uv run mypy src/east_py_datascience

## Clean build artifacts
clean:
	rm -rf dist *.tsbuildinfo __pycache__

## Show available targets
help:
	@echo "east-py-datascience (hybrid TS + Python)"
	@echo ""
	@echo "  build       - Build TypeScript"
	@echo "  test        - Export spec IR + replay it with pytest"
	@echo "  test-export - Export spec IR to /tmp/east-py-datascience"
	@echo "  test-ts     - Run the TypeScript specs as node tests (export-only)"
	@echo "  test-py     - Replay already-exported IR with pytest"
	@echo "  lint        - eslint + ruff"
	@echo "  typecheck   - mypy over the Python package"
	@echo "  clean       - Clean build artifacts"
