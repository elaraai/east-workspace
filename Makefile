.PHONY: update build rebuild clean install install-cli test-east-c test-east-c-std test-east-c-wasm test-all leak-check leak-check-std leak-check-all services-up services-down setup-wasm wasm wasm-install wasm-ts wasm-clean link unlink

build:
	@mkdir -p build && cd build && cmake .. && cmake --build . -j$$(nproc)

rebuild: clean build

# Update @elaraai dependencies (including transitive)
update:
	@cd packages/east-c-wasm && $(NVM) npm update @elaraai/east @elaraai/east-node-std

clean:
	@rm -rf build

install: build
	@cd build && cmake --install .

install-cli: build
	install -d $(HOME)/.local/bin
	install build/packages/east-c-cli/east-c $(HOME)/.local/bin/east-c
	@echo "Installed east-c to $(HOME)/.local/bin/east-c"

# Tests (compliance)
test-east-c: build
	@./packages/east-c/scripts/run_compliance.sh

test-east-c-std: build
	@./packages/east-c-std/scripts/test_compliance.sh

test-east-c-wasm: wasm-ts
	@cd packages/east-c-wasm && npm run test:compliance

test-all: test-east-c test-east-c-std test-east-c-wasm

# Memory leak checks
leak-check:
	@./packages/east-c/scripts/run_leak_check.sh

leak-check-std:
	@./packages/east-c/scripts/run_leak_check.sh /tmp/east-node-std packages/east-c-std/test_std_compliance

leak-check-all: leak-check leak-check-std

# Docker services (httpbin for fetch tests)
services-up:
	docker compose up -d --wait

services-down:
	docker compose down -v

# ---- WebAssembly (east-c-wasm) ----

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

wasm-install:
	@cd packages/east-c-wasm && npm install

wasm-ts:
	@cd packages/east-c-wasm && npm run build

wasm-clean:
	@rm -rf build-wasm
	@rm -rf packages/east-c-wasm/dist/wasm

link:
	cd packages/east-c-wasm && npm link

unlink:
	cd packages/east-c-wasm && npm unlink
