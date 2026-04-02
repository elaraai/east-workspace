.PHONY: install install-cli test test-east-py test-east-py-std test-east-py-io test-east-py-datascience test-export lint lint-headers lint-headers-fix format typecheck check clean build build-cython build-eastc clean-cython clean-eastc link unlink services-up services-down help

# Install dependencies (force-reinstalls east-py to rebuild C extensions)
# Use EAST_C_SOURCE_DIR to build against a local east-c checkout:
#   make install EAST_C_SOURCE_DIR=/path/to/east-c
install:
	@cd packages/east-py-datascience && npm install
	uv sync --all-extras --all-packages
	uv pip install hatchling
	uv sync --all-extras --all-packages --reinstall-package east-py --reinstall-package east-py-std --reinstall-package east-py-io --reinstall-package east-py-datascience --no-build-isolation

# Update @elaraai dependencies (including transitive)
update:
	@cd packages/east-py-datascience && $(NVM) npm update @elaraai/east @elaraai/east-node-std

# Install east-py command globally (also syncs local .venv)
install-cli:
	uv sync --all-extras --all-packages
	uv tool install --force --editable packages/east-py-cli \
		--with-editable ./packages/east-py \
		--with-editable ./packages/east-py-std \
		--with-editable ./packages/east-py-io \
		--with-editable ./packages/east-py-datascience

# Export test IR from TypeScript packages
test-export:
	@cd packages/east-py-datascience && npm run test:export

# Run east-py compliance tests (parallel, east-c style output)
test-east-py:
	uv run --package east-py python packages/east-py/tests/test_compliance.py

test-east-py-std:
	uv run --package east-py-std python packages/east-py/tests/test_compliance.py --ir-dir /tmp/east-node-std -p east_py_std

test-east-py-io:
	uv run --package east-py-io python packages/east-py/tests/test_compliance.py --ir-dir /tmp/east-node-io -p east_py_std -p east_py_io

test-east-py-datascience:
	@cd packages/east-py-datascience && npm run test:export
	uv run --package east-py-datascience python packages/east-py/tests/test_compliance.py --ir-dir /tmp/east-py-datascience -p east_py_datascience

# Run all tests
test:
	@cd packages/east-py-datascience && npm run test:export
	@exit_code=0; \
	$(MAKE) test-east-py || exit_code=1; \
	$(MAKE) test-east-py-std || exit_code=1; \
	$(MAKE) test-east-py-io || exit_code=1; \
	$(MAKE) test-east-py-datascience || exit_code=1; \
	exit $$exit_code

# Run linter
lint: lint-headers
	uv run ruff check packages/
	cd packages/east-py-datascience && npm run lint

# Check license headers (fails if any files need updating)
lint-headers:
	uv run python scripts/check_headers.py

# Fix license headers
lint-headers-fix:
	uv run python scripts/check_headers.py --fix

# Format code
format:
	uv run ruff format packages/

# Type check
typecheck:
	cd packages/east-py && uv run mypy east
	cd packages/east-py-std && uv run mypy east_py_std
	cd packages/east-py-io && uv run mypy east_py_io
	cd packages/east-py-cli && uv run mypy east_py_cli
	cd packages/east-py-datascience && uv run mypy src/east_py_datascience

# Run all quality checks
check: lint typecheck test

# Clean build artifacts
clean:
	rm -rf .venv uv.lock build/ dist/ packages/east-py/build/eastc
	find packages -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
	find packages -name "*.egg-info" -type d -exec rm -rf {} + 2>/dev/null || true
	find packages -name ".pytest_cache" -type d -exec rm -rf {} + 2>/dev/null || true
	find packages -name ".mypy_cache" -type d -exec rm -rf {} + 2>/dev/null || true

# Build packages
build:
	uv build --package east-py
	uv build --package east-py-std
	uv build --package east-py-io
	uv build --package east-py-cli
	cd packages/east-py-datascience && npm run build
	uv build --package east-py-datascience

# Start Docker services (for integration tests)
services-up:
	docker-compose -f packages/east-py-io/docker-compose.yml up -d

# Stop Docker services
services-down:
	docker-compose -f packages/east-py-io/docker-compose.yml down -v

# Build Cython acceleration modules
build-cython:
	uv run --package east-py python packages/east-py/scripts/build_cython.py

# Build Cython extensions in-place (for development — avoids full reinstall)
# Use EAST_C_SOURCE_DIR for local east-c: make build-cython-inplace EAST_C_SOURCE_DIR=../east-c
build-cython-inplace:
	cd packages/east-py && uv run python setup.py build_ext --inplace

# Build east-c via CMake (called automatically by setup.py, but can be run standalone)
# Override branch: make build-eastc EAST_C_GIT_TAG=my-branch
# Use local checkout: make build-eastc EAST_C_SOURCE_DIR=/path/to/east-c
build-eastc:
	cd packages/east-py && cmake -B build/eastc -S cmake/ -DEAST_USE_MIMALLOC=OFF -DBUILD_TESTING=OFF -DCMAKE_POSITION_INDEPENDENT_CODE=ON $(if $(EAST_C_GIT_TAG),-DEAST_C_GIT_TAG=$(EAST_C_GIT_TAG),) $(if $(EAST_C_SOURCE_DIR),-DEAST_C_SOURCE_DIR=$(EAST_C_SOURCE_DIR),)
	cd packages/east-py && cmake --build build/eastc --parallel

# Clean Cython build artifacts (generated .c and .so files)
clean-cython:
	find packages/east-py/east -name "*.so" -delete
	find packages/east-py/east -name "*.c" -not -name "__pycache__" -delete
	rm -rf packages/east-py/build/temp.* packages/east-py/build/lib.*

# Clean east-c build artifacts
clean-eastc:
	rm -rf packages/east-py/build/eastc

# Link globally-registered @elaraai packages into local node_modules
# Run `make link` in sibling repos (east, east-node, etc.) first to register them
link:
	cd packages/east-py-datascience && npm link @elaraai/east @elaraai/east-node-std

# Unlink and restore published deps
unlink:
	cd packages/east-py-datascience && npm unlink --no-save @elaraai/east @elaraai/east-node-std && npm install

# Help
help:
	@echo "install           - Install dependencies (uv sync)"
	@echo "test              - Run all tests"
	@echo "test-east-py      - Run east-py compliance tests (parallel)"
	@echo "test-east-py-std  - Run east-py-std tests only"
	@echo "test-east-py-io   - Run east-py-io tests only"
	@echo "test-east-py-datascience - Run east-py-datascience tests (export IR + pytest)"
	@echo "test-export       - Export test IR from TypeScript packages"
	@echo "lint              - Run linter (includes license header check)"
	@echo "lint-headers      - Check license headers only"
	@echo "lint-headers-fix  - Add missing license headers"
	@echo "format            - Format code"
	@echo "typecheck         - Type check"
	@echo "check             - Run lint + typecheck + test"
	@echo "clean             - Clean build artifacts"
	@echo "build             - Build packages"
	@echo "build-eastc       - Build east-c native library via CMake"
	@echo "clean-eastc       - Clean east-c build artifacts"
	@echo "link              - Link sibling repos (@elaraai/east, east-node) for local dev"
	@echo "unlink            - Unlink and restore published deps"
	@echo "services-up       - Start Docker services"
	@echo "services-down     - Stop Docker services"
