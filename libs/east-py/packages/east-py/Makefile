.PHONY: install test repl lint format typecheck clean build publish pre-commit build-cython

# Install dependencies and pre-commit hooks
install:
	uv sync
	uv run pre-commit install

# Run test suite
test:
	uv run pytest --durations=0 -s

# Start Python REPL with east loaded
repl:
	uv run python -i -c "from east import *; print('East.py REPL ready')"

# Run linter (ruff)
lint:
	uv run ruff check east tests

# Auto-fix linting issues
lint-fix:
	uv run ruff check --fix east tests

# Format code
format:
	uv run ruff format east tests

# Type check with mypy
typecheck:
	uv run mypy east

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

# Build Cython acceleration modules in-place
build-cython:
	uv run python scripts/build_cython.py

# Run benchmarks (if implemented)
bench:
	uv run python -m pytest tests/bench --benchmark-only

# Generate coverage report
coverage:
	uv run pytest --cov=east --cov-report=html
	@echo "Coverage report generated in htmlcov/index.html"

# Run pre-commit hooks on all files
pre-commit:
	uv run pre-commit run --all-files

# Update pre-commit hook versions
pre-commit-update:
	uv run pre-commit autoupdate
