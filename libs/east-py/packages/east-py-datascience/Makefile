.PHONY: install build test test-ts test-py lint clean

# Install dependencies
install:
	. ${NVM_DIR}/nvm.sh && nvm use && npm ci
	uv sync

# Build the project
build:
	. ${NVM_DIR}/nvm.sh && nvm use && npm run build

# Run full test suite: export IR from TypeScript, then run Python compliance tests
test: build
	. ${NVM_DIR}/nvm.sh && nvm use && npm run test:export
	uv run pytest -v

# Run TypeScript tests only (compiles and runs with Node)
test-ts:
	. ${NVM_DIR}/nvm.sh && nvm use && npm run test

# Run Python tests only (requires IR to be exported first)
test-py:
	uv run pytest

# Run linting
lint:
	. ${NVM_DIR}/nvm.sh && nvm use && npm run lint

# Clean build artifacts
clean:
	rm -rf dist node_modules *.tsbuildinfo .venv uv.lock __pycache__
