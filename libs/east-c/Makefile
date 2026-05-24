# east-c — C port of the East language runtime
# Native build via CMake.

.PHONY: build rebuild clean install-cli \
        test test-east-c test-east-c-std test-all \
        leak-check leak-check-std leak-check-all \
        help lint format ensure-clang-format

## Build native C libraries and tests
build:
	@mkdir -p build && cd build && cmake .. && cmake --build . -j$$(nproc)

## Clean and rebuild
rebuild: clean build

## Clean build artifacts
clean:
	@rm -rf build

## Install east-c CLI to ~/.local/bin
install-cli: build
	install -d $(HOME)/.local/bin
	install build/packages/east-c-cli/east-c $(HOME)/.local/bin/east-c
	@echo "Installed east-c to $(HOME)/.local/bin/east-c"

# ── Tests (compliance) ───────────────────────────────────────────────

test-east-c: build
	@./packages/east-c/scripts/run_compliance.sh

test-east-c-std: build
	@./packages/east-c-std/scripts/test_compliance.sh

## Run native tests (east-c + east-c-std)
test: test-east-c test-east-c-std

## Run all tests
test-all: test-east-c test-east-c-std

# ── Memory leak checks ──────────────────────────────────────────────

leak-check:
	@./packages/east-c/scripts/run_leak_check.sh

leak-check-std:
	@./packages/east-c/scripts/run_leak_check.sh /tmp/east-node-std packages/east-c-std/test_std_compliance

leak-check-all: leak-check leak-check-std

# ── Lint / Format (C) ───────────────────────────────────────────────
#
# Uses the LLVM clang-format binary, installed via `uv tool install
# clang-format` (a PyPI wrapper that ships the binary). Lives in uv's
# tool dir (~/.local/share/uv/tools/clang-format), separate from any
# project venv.
#
# CLANG_FORMAT_VERSION pins the binary across devs + CI. Bump to refresh.

CLANG_FORMAT_VERSION := 18.1.8

# Files to lint/format — all .c and .h under packages/, excluding build dirs
# and FetchContent-vendored deps.
C_SOURCES := $(shell find packages -type f \( -name '*.c' -o -name '*.h' \) \
	-not -path '*/build*/*' \
	-not -path '*/_deps/*' \
	-not -path '*/node_modules/*' 2>/dev/null)

ensure-clang-format:
	@if ! uv tool list 2>/dev/null | grep -q "^clang-format "; then \
		echo "Installing clang-format $(CLANG_FORMAT_VERSION) via uv tool..."; \
		uv tool install clang-format==$(CLANG_FORMAT_VERSION); \
	fi

## Lint C sources (non-modifying — fails if any file would be reformatted).
lint: ensure-clang-format
	@uv tool run clang-format --dry-run --Werror $(C_SOURCES)

## Apply clang-format in place to all C sources.
format: ensure-clang-format
	@uv tool run clang-format -i $(C_SOURCES)

## Show available targets
help:
	@echo "east-c (C runtime)"
	@echo ""
	@echo "  build          - Build native C libraries (cmake)"
	@echo "  rebuild        - Clean and rebuild"
	@echo "  clean          - Remove build directory"
	@echo "  install-cli    - Install east-c CLI to ~/.local/bin"
	@echo ""
	@echo "  test-east-c    - Run east-c compliance tests"
	@echo "  test-east-c-std - Run east-c-std compliance tests"
	@echo "  test-all       - Run all compliance tests"
	@echo ""
	@echo "  leak-check     - Run memory leak checks (east-c core)"
	@echo "  leak-check-std - Run std memory leak checks"
	@echo "  leak-check-all - Run all memory leak checks"
	@echo ""
	@echo "  lint           - clang-format --dry-run on all .c/.h sources"
	@echo "  format         - clang-format -i (modifies files in place)"
