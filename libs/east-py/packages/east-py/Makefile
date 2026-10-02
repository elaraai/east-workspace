# east-py — Core Python runtime for East
# Python deps managed by uv from east-py root.

# The checkout's paths: the exported corpora the compliance and conformance
# suites read (EAST_TEST_IR_DIR, EAST_EXAMPLES_IR_DIR), and the checkout's
# east-node CLI the three-way sweep runs (EAST_NODE_CLI)
include ../../../../paths.mk

.PHONY: test test-file repl lint lint-fix format typecheck check clean build publish dev build-cython bench coverage pre-commit pre-commit-update help

## Run test suite
test:
	uv run pytest --durations=0 -s

## Run specific test file (or any pytest arguments) against the checkout's corpora
test-file:
	@test -n "$(FILE)" || (echo "Usage: make test-file FILE=tests/test_compliance.py" && exit 1)
	uv run pytest $(FILE) -q --no-cov

## Start Python REPL with east loaded
repl:
	uv run python -i -c "from east import *; print('East.py REPL ready')"

## Run linter (ruff)
lint:
	uv run ruff check east tests

## Auto-fix linting issues
lint-fix:
	uv run ruff check --fix east tests

## Format code
format:
	uv run ruff format east tests

## Type check with mypy
typecheck:
	uv run mypy east

## Run all quality checks (lint + typecheck + test)
check: lint typecheck test

## Clean build artifacts and cache
clean:
	rm -rf build/ dist/ *.egg-info
	rm -rf .pytest_cache .mypy_cache .ruff_cache
	find . -type d -name __pycache__ -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete

## Build distribution packages
build: clean
	uv build

## Publish to PyPI (requires authentication)
publish: build
	uv publish

## Build Cython acceleration modules in-place
build-cython:
	uv run python scripts/build_cython.py

## Run the wall-clock benchmarks — the `perf`-marked tests, skipped by
## `make test` and by CI (tests/conftest.py: a clock is not a mechanism)
bench:
	EAST_PERF=1 uv run pytest tests -m perf -q --no-cov -p no:cacheprovider

## Generate coverage report
coverage:
	uv run pytest --cov=east --cov-report=html
	@echo "Coverage report generated in htmlcov/index.html"

## Run pre-commit hooks on all files
pre-commit:
	uv run pre-commit run --all-files

## Update pre-commit hook versions
pre-commit-update:
	uv run pre-commit autoupdate

## Show available targets
help:
	@echo "east-py (core Python runtime)"
	@echo ""
	@echo "  test          - Run tests"
	@echo "  test-file     - Run one test file: make test-file FILE=tests/test_compliance.py"
	@echo "  lint          - Run linter"
	@echo "  format        - Format code"
	@echo "  typecheck     - Type check"
	@echo "  check         - lint + typecheck + test"
	@echo "  bench         - Run the perf-marked wall-clock benchmarks (EAST_PERF=1)"
	@echo "  build         - Build distribution"
	@echo "  build-cython  - Build Cython modules"
	@echo "  clean         - Clean artifacts"
