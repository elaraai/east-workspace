# east-c — C port of the East language runtime
# Native build via CMake. WASM sub-package uses pnpm for TS deps.

.PHONY: build rebuild clean install-cli \
        test test-east-c test-east-c-std test-east-c-wasm test-all \
        leak-check leak-check-std leak-check-all \
        setup-wasm wasm wasm-ts wasm-clean help

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

test-east-c-wasm: wasm-ts
	@cd packages/east-c-wasm && pnpm run test:compliance

## Run all tests (alias for test-all)
test: test-all

test-all: test-east-c test-east-c-std test-east-c-wasm

# ── Memory leak checks ──────────────────────────────────────────────

leak-check:
	@./packages/east-c/scripts/run_leak_check.sh

leak-check-std:
	@./packages/east-c/scripts/run_leak_check.sh /tmp/east-node-std packages/east-c-std/test_std_compliance

leak-check-all: leak-check leak-check-std

# ── WebAssembly (east-c-wasm) ───────────────────────────────────────

EMSDK_DIR := tools/emsdk
EMSDK_VERSION := latest

setup-wasm:
	@if [ ! -d "$(EMSDK_DIR)" ]; then \
		echo "Cloning emsdk..."; \
		mkdir -p tools; \
		git clone https://github.com/emscripten-core/emsdk.git $(EMSDK_DIR); \
	fi
	@echo "Installing Emscripten $(EMSDK_VERSION)..."
	@cd $(EMSDK_DIR) && ./emsdk install $(EMSDK_VERSION)
	@cd $(EMSDK_DIR) && ./emsdk activate $(EMSDK_VERSION)
	@echo ""
	@echo "Emscripten installed. Run 'make wasm' to build."

EMCMAKE ?= $(EMSDK_DIR)/upstream/emscripten/emcmake

wasm:
	@if ! command -v emcmake >/dev/null 2>&1 && [ ! -f "$(EMCMAKE)" ]; then \
		echo "Error: emcmake not found. Run 'make setup-wasm' or install emsdk."; \
		exit 1; \
	fi
	@if command -v emcmake >/dev/null 2>&1; then \
		_EMCMAKE=emcmake; \
	else \
		export EMSDK=$(CURDIR)/$(EMSDK_DIR) && \
		export EM_CONFIG=$(CURDIR)/$(EMSDK_DIR)/.emscripten && \
		export PATH=$(CURDIR)/$(EMSDK_DIR)/upstream/emscripten:$(CURDIR)/$(EMSDK_DIR)/upstream/bin:$(CURDIR)/$(EMSDK_DIR)/node/22.16.0_64bit/bin:$$PATH; \
		_EMCMAKE=$(CURDIR)/$(EMCMAKE); \
	fi && \
	mkdir -p build-wasm && \
	cd build-wasm && \
	$$_EMCMAKE cmake .. -DCMAKE_BUILD_TYPE=Release && \
	cmake --build . -j$$(nproc)
	@mkdir -p packages/east-c-wasm/dist/wasm
	@cp build-wasm/packages/east-c-wasm/east-c.js packages/east-c-wasm/dist/wasm/
	@cp build-wasm/packages/east-c-wasm/east-c.wasm packages/east-c-wasm/dist/wasm/
	@echo '{ "type": "module" }' > packages/east-c-wasm/dist/wasm/package.json
	@echo ""
	@wasm_size=$$(wc -c < packages/east-c-wasm/dist/wasm/east-c.wasm); \
		echo "Built east-c.wasm ($$(( wasm_size / 1024 )) KB)"

wasm-ts:
	@cd packages/east-c-wasm && pnpm run build

wasm-clean:
	@rm -rf build-wasm
	@rm -rf packages/east-c-wasm/dist/wasm

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
	@echo "  test-east-c-wasm - Run east-c-wasm compliance tests"
	@echo "  test-all       - Run all compliance tests"
	@echo ""
	@echo "  leak-check     - Run memory leak checks"
	@echo "  leak-check-std - Run std memory leak checks"
	@echo "  leak-check-all - Run all memory leak checks"
	@echo ""
	@echo "  setup-wasm     - Install Emscripten SDK"
	@echo "  wasm           - Build WASM binary"
	@echo "  wasm-ts        - Build WASM TypeScript wrapper"
	@echo "  wasm-clean     - Clean WASM build artifacts"
