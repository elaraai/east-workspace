# east-py-datascience — hybrid TypeScript + Python package
# TS deps managed by pnpm from monorepo root. Python deps managed by uv from east-py root.

.PHONY: build test test-ts test-py lint clean help

## Build the TypeScript project
build:
	pnpm run build

## Run full test suite: export IR from TypeScript, then run Python compliance tests
test: build
	pnpm run test:export
	uv run pytest -v

## Run TypeScript tests only
test-ts:
	pnpm run test

## Run Python tests only (requires IR to be exported first)
test-py:
	uv run pytest

## Run linting
lint:
	pnpm run lint

## Clean build artifacts
clean:
	rm -rf dist *.tsbuildinfo __pycache__

## Show available targets
help:
	@echo "east-py-datascience (hybrid TS + Python)"
	@echo ""
	@echo "  build   - Build TypeScript"
	@echo "  test    - Export IR + run Python tests"
	@echo "  test-ts - Run TypeScript tests only"
	@echo "  test-py - Run Python tests only"
	@echo "  lint    - Run linter"
	@echo "  clean   - Clean build artifacts"
