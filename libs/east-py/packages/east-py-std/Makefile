.PHONY: install test repl lint format typecheck clean build publish check

# Install dependencies and sync environment
install:
	uv sync

# Run test suite
test:
	uv run pytest

# Start Python REPL with east_py_std loaded
repl:
	uv run python -i -c "from east_py_std import *; print('east-py-std REPL ready')"

# Run linter (ruff)
lint:
	uv run ruff check east_py_std tests

# Auto-fix linting issues
lint-fix:
	uv run ruff check --fix east_py_std tests

# Format code
format:
	uv run ruff format east_py_std tests

# Type check with mypy
typecheck:
	uv run mypy east_py_std

# Run all quality checks (lint + typecheck + test)
check: lint typecheck test

# Clean build artifacts and cache
clean:
	rm -rf build/ dist/ *.egg-info
	rm -rf .pytest_cache .mypy_cache .ruff_cache
	find . -type d -name __pycache__ -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete

# Build distribution packages
build: clean
	uv build

# Publish to PyPI (requires authentication)
publish: build
	uv publish

# Install in development mode (editable install)
dev:
	uv pip install -e ".[dev]"

# Generate coverage report
coverage:
	uv run pytest --cov=east_py_std --cov-report=html
	@echo "Coverage report generated in htmlcov/index.html"

# Run tests with verbose output
test-verbose:
	uv run pytest -v

# Run specific test file
test-file:
	@test -n "$(FILE)" || (echo "Usage: make test-file FILE=tests/test_console.py" && exit 1)
	uv run pytest $(FILE) -v
