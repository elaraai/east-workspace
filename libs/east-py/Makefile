# east-py — Python monorepo for the East language
# Python deps managed by uv. TS sub-package (east-py-datascience) uses pnpm from monorepo root.
#
# Native code is built by scikit-build-core when each package is installed.
# Each package's CMakeLists.txt locates the monorepo root via pnpm-workspace.yaml
# and add_subdirectory's east-c directly — no EAST_C_SOURCE_DIR env var needed.

# Build the native Cython extensions with the Ninja generator on every OS. On
# Windows this avoids scikit-build's default multi-config Visual Studio generator,
# whose deep TryCompile paths overflow MAX_PATH; ninja comes from build-deps (the
# pip 'ninja' package). Needs an MSVC environment on Windows (a Developer prompt).
export CMAKE_GENERATOR := Ninja

.PHONY: install install-cli test test-east-py test-east-py-std test-east-py-io test-east-py-datascience \
        reinstall-east-py reinstall-east-py-std reinstall-east-py-io reinstall-east-py-datascience build-deps \
        test-export lint lint-headers lint-headers-fix format typecheck check \
        vendor build-wheels clean build help

# ── Setup ─────────────────────────────────────────────────────────────

## Install Python dependencies. Two-step:
##   1. build-deps installs scikit-build-core/cython/numpy into .venv so the
##      no-build-isolation sync below can find them (uv sync would otherwise
##      remove them between steps because they're not in any dep list).
##   2. uv sync with --no-build-isolation + --reinstall-package forces every
##      native workspace package to actually run its build backend (uv treats
##      workspace members as up-to-date by default and skips rebuilds).
install: build-deps
	uv sync --all-extras --all-packages --no-build-isolation \
		--reinstall-package elaraai-east-py --refresh-package elaraai-east-py \
		--reinstall-package elaraai-east-py-std --refresh-package elaraai-east-py-std \
		--reinstall-package elaraai-east-py-io --refresh-package elaraai-east-py-io \
		--reinstall-package elaraai-east-py-datascience --refresh-package elaraai-east-py-datascience

## Build deps for the no-build-isolation flow. scikit-build-core is the build
## backend; cython + numpy are needed at build time by the CMakeLists.
## ninja is the CMake generator: under --no-build-isolation scikit-build-core
## won't auto-provision it, and with no system ninja it would otherwise cache an
## ephemeral build-env ninja path that breaks editable rebuilds.
## setuptools is for sloppy 3rd-party packages (e.g. access-parser) that need
## it at build time but don't declare it in their pyproject.toml.
BUILD_DEPS = scikit-build-core cython numpy setuptools ninja

build-deps:
	@test -d .venv || uv venv
	uv pip install $(BUILD_DEPS)

## Force-rebuild a single workspace package.
## Useful during native-build iteration. Equivalent to `install` but reinstalls
## only the named package (still runs the full workspace sync because uv won't
## install workspace members without --all-packages).
##
## --refresh-package: bust uv's source-tree fingerprint cache so a pyproject.toml
##   or CMakeLists.txt change actually triggers a rebuild.
reinstall-east-py: build-deps
	uv sync --all-extras --all-packages --reinstall-package elaraai-east-py --refresh-package elaraai-east-py --no-build-isolation

reinstall-east-py-std: build-deps
	uv sync --all-extras --all-packages --reinstall-package elaraai-east-py-std --refresh-package elaraai-east-py-std --no-build-isolation

reinstall-east-py-io: build-deps
	uv sync --all-extras --all-packages --reinstall-package elaraai-east-py-io --refresh-package elaraai-east-py-io --no-build-isolation

reinstall-east-py-datascience: build-deps
	uv sync --all-extras --all-packages --reinstall-package elaraai-east-py-datascience --refresh-package elaraai-east-py-datascience --no-build-isolation

## Install east-py command globally (also syncs local .venv)
install-cli:
	uv sync --all-extras --all-packages
	uv tool install --force --editable packages/east-py-cli \
		--with-editable ./packages/east-py \
		--with-editable ./packages/east-py-std \
		--with-editable ./packages/east-py-io \
		--with-editable "./packages/east-py-datascience[all]"

# ── Test IR Export ────────────────────────────────────────────────────

## Export test IR from TypeScript packages
test-export:
	@cd packages/east-py-datascience && pnpm run test:export

# ── Tests ─────────────────────────────────────────────────────────────

QUIET_FLAG = $(if $(EAST_QUIET),-q)

test-east-py:
	uv run --package elaraai-east-py python packages/east-py/tests/test_compliance.py $(QUIET_FLAG)
	cd packages/east-py && uv run pytest tests/serialization -q --no-cov

test-east-py-std:
	uv run --package elaraai-east-py-std python packages/east-py/tests/test_compliance.py --ir-dir /tmp/east-node-std -p east_py_std $(QUIET_FLAG)

test-east-py-io:
	uv run --package elaraai-east-py-io python packages/east-py/tests/test_compliance.py --ir-dir /tmp/east-node-io -p east_py_std -p east_py_io $(QUIET_FLAG)

test-east-py-datascience:
	@cd packages/east-py-datascience && pnpm run test:export
	uv run --package elaraai-east-py-datascience python packages/east-py/tests/test_compliance.py --ir-dir /tmp/east-py-datascience -p east_py_datascience $(QUIET_FLAG)

## Run all tests
test:
	@cd packages/east-py-datascience && pnpm run test:export
	@exit_code=0; \
	$(MAKE) test-east-py || exit_code=1; \
	$(MAKE) test-east-py-std || exit_code=1; \
	$(MAKE) test-east-py-io || exit_code=1; \
	$(MAKE) test-east-py-datascience || exit_code=1; \
	exit $$exit_code

# ── Code Quality ─────────────────────────────────────────────────────

## Run linter
lint: lint-headers
	uv run ruff check packages/
	cd packages/east-py-datascience && pnpm run lint

## Check license headers (fails if any files need updating)
lint-headers:
	uv run python scripts/check_headers.py

## Fix license headers
lint-headers-fix:
	uv run python scripts/check_headers.py --fix

## Format code
format:
	uv run ruff format packages/

## Type check
typecheck:
	cd packages/east-py && uv run mypy east
	cd packages/east-py-std && uv run mypy east_py_std
	cd packages/east-py-io && uv run mypy east_py_io
	cd packages/east-py-cli && uv run mypy east_py_cli
	cd packages/east-py-datascience && uv run mypy src/east_py_datascience

## Run all quality checks
check: lint typecheck test

# ── Build ─────────────────────────────────────────────────────────────

## Build packages
build:
	uv build --package elaraai-east-py
	uv build --package elaraai-east-py-std
	uv build --package elaraai-east-py-io
	uv build --package elaraai-east-py-cli
	cd packages/east-py-datascience && pnpm run build
	uv build --package elaraai-east-py-datascience

# ── Native wheel packaging (release-parity, local) ────────────────────

## Stage east-c (+ east-py .pxd) into each Cython package's _vendor/ so it
## builds without the monorepo — the same staging the release workflow does
## before cibuildwheel / sdist. A no-op for normal dev builds (the CMakeLists
## prefer the monorepo when present); _vendor/ is gitignored.
vendor:
	python3 scripts/vendor-native.py --package packages/east-py
	python3 scripts/vendor-native.py --package packages/east-py-datascience --with-east-py-pxd

## Build manylinux wheels locally for the Cython packages (east-py,
## east-py-datascience) via cibuildwheel — the exact path the release runs on
## Linux, so isolation bugs surface here instead of in CI. Requires Docker.
## Override the target interpreter with e.g. CIBW_BUILD=cp312-manylinux_x86_64.
CIBW ?= uvx --from 'cibuildwheel<3' cibuildwheel
CIBW_BUILD ?= cp311-manylinux_x86_64
# Drop any in-tree .so from the container copy so the wheel only ships freshly
# built extensions (the host tree — and your editable install — is untouched).
export CIBW_BEFORE_BUILD = find {project} -name '*.cpython-*.so' -delete
export CIBW_SKIP = *-musllinux_*
build-wheels: vendor
	cd packages/east-py && CIBW_BUILD="$(CIBW_BUILD)" $(CIBW) --platform linux --output-dir "$(CURDIR)/dist-wheels"
	cd packages/east-py-datascience && CIBW_BUILD="$(CIBW_BUILD)" $(CIBW) --platform linux --output-dir "$(CURDIR)/dist-wheels"

# Native Cython extensions are built automatically by scikit-build-core when
# packages are installed (see each package's pyproject.toml +
# CMakeLists.txt). The standalone `build-cython*` and `build-eastc` targets
# from the setuptools era are no longer needed — `make install` or
# `make reinstall-east-py` handles everything via the build backend.

# ── Clean ─────────────────────────────────────────────────────────────

## Clean build artifacts (everything scikit-build-core or pytest generated)
clean:
	rm -rf .venv uv.lock dist/ dist-wheels/
	find packages -name "build" -type d -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null || true
	find packages -name "_vendor" -type d -exec rm -rf {} + 2>/dev/null || true
	find packages -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
	find packages -name "*.egg-info" -type d -exec rm -rf {} + 2>/dev/null || true
	find packages -name ".pytest_cache" -type d -exec rm -rf {} + 2>/dev/null || true
	find packages -name ".mypy_cache" -type d -exec rm -rf {} + 2>/dev/null || true
	# In-tree Cython artefacts alongside .pyx sources. Compiled .so files are
	# always safe to remove; .c files are only deleted when a matching .pyx
	# exists in the same directory so hand-written C is never touched.
	find packages -name "*.so" -delete 2>/dev/null || true
	find packages -name "*.pyx" -print0 2>/dev/null | xargs -0 -I{} sh -c 'rm -f "$${1%.pyx}.c"' _ {} 2>/dev/null || true

# ── Help ─────────────────────────────────────────────────────────────

help:
	@echo "east-py (Python monorepo)"
	@echo ""
	@echo "  install           - Install Python dependencies (uv sync)"
	@echo "  install-cli       - Install east-py CLI globally"
	@echo ""
	@echo "  test              - Run all tests"
	@echo "  test-east-py      - Run east-py compliance tests"
	@echo "  test-east-py-std  - Run east-py-std tests"
	@echo "  test-east-py-io   - Run east-py-io tests"
	@echo "  test-east-py-datascience - Run east-py-datascience tests"
	@echo "  test-export       - Export test IR from TypeScript packages"
	@echo ""
	@echo "  lint              - Run linter (includes license header check)"
	@echo "  lint-headers      - Check license headers only"
	@echo "  lint-headers-fix  - Add missing license headers"
	@echo "  format            - Format code"
	@echo "  typecheck         - Type check"
	@echo "  check             - Run lint + typecheck + test"
	@echo ""
	@echo "  build             - Build wheels for all packages"
	@echo "  vendor            - Stage east-c (+ east-py .pxd) into _vendor/ for packaged builds"
	@echo "  build-wheels      - Build manylinux wheels locally via cibuildwheel (needs Docker)"
	@echo "  reinstall-east-py - Force-rebuild east-py via scikit-build-core"
	@echo "  reinstall-east-py-std - Force-rebuild east-py-std"
	@echo "  reinstall-east-py-io - Force-rebuild east-py-io"
	@echo "  reinstall-east-py-datascience - Force-rebuild east-py-datascience"
	@echo ""
	@echo "  clean             - Clean build artifacts (.venv, build/, caches)"
