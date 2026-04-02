# east-py-io — I/O platform functions for East
# Python deps managed by uv from east-py root.

.PHONY: test repl lint lint-fix format typecheck check clean build publish dev coverage test-verbose test-file help

## Run test suite
test:
	uv run pytest

## Start Python REPL with east_py_io loaded
repl:
	uv run python -i -c "from east_py_io import *; print('east-py-io REPL ready')"

## Run linter (ruff)
lint:
	uv run ruff check east_py_io tests

## Auto-fix linting issues
lint-fix:
	uv run ruff check --fix east_py_io tests

## Format code
format:
	uv run ruff format east_py_io tests

## Type check with mypy
typecheck:
	uv run mypy east_py_io

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

## Generate coverage report
coverage:
	uv run pytest --cov=east_py_io --cov-report=html
	@echo "Coverage report generated in htmlcov/index.html"

## Run tests with verbose output
test-verbose:
	uv run pytest -v

## Run specific test file
test-file:
	@test -n "$(FILE)" || (echo "Usage: make test-file FILE=tests/test_s3.py" && exit 1)
	uv run pytest $(FILE) -v

## Show available targets
help:
	@echo "east-py-io (I/O platform functions)"
	@echo ""
	@echo "  test       - Run tests"
	@echo "  lint       - Run linter"
	@echo "  format     - Format code"
	@echo "  typecheck  - Type check"
	@echo "  check      - lint + typecheck + test"
	@echo "  build      - Build distribution"
	@echo "  clean      - Clean artifacts"
