.PHONY: install build test test-integration lint lint-fix dev clean deploy link help

# Install dependencies
install:
	npm install

# Build all packages
build:
	npm run build

# Run all tests
test:
	npm run test

# Run integration tests
test-integration:
	npm run test:integration

# Run linter
lint:
	npm run lint

# Fix lint issues
lint-fix:
	npm run lint:fix

# Run frontend dev server
dev:
	npm run dev

# Clean build artifacts
clean:
	rm -rf node_modules
	find . -name "node_modules" -type d -prune -exec rm -rf {} + 2>/dev/null || true
	find . -name "dist" -type d -prune -exec rm -rf {} + 2>/dev/null || true
	find . -name "*.tsbuildinfo" -type f -delete 2>/dev/null || true

# Link CLI globally
link:
	npm run link

# Deploy platform (usage: make deploy CONFIG=elara-dev PROFILE=elaraai-dev-elara-e3)
deploy:
ifndef CONFIG
	$(error CONFIG is required. Usage: make deploy CONFIG=elara-dev PROFILE=elaraai-dev-elara-e3)
endif
ifndef PROFILE
	$(error PROFILE is required. Usage: make deploy CONFIG=elara-dev PROFILE=elaraai-dev-elara-e3)
endif
	cd cdk/platform && AWS_PROFILE=$(PROFILE) npx cdk deploy --context config=$(CONFIG) --require-approval never

# Help
help:
	@echo "install          - Install dependencies (npm install)"
	@echo "build            - Build all packages"
	@echo "test             - Run all tests"
	@echo "test-integration - Run integration tests"
	@echo "lint             - Run linter"
	@echo "lint-fix         - Fix lint issues"
	@echo "dev              - Run frontend dev server"
	@echo "clean            - Clean build artifacts and node_modules"
	@echo "link             - Link CLI globally"
	@echo "deploy           - Deploy platform (CONFIG=elara-dev PROFILE=elaraai-dev-elara-e3)"
