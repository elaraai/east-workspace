.PHONY: install update build test test-integration lint lint-fix dev clean deploy deploy-web deploy-runner link help

# Install dependencies
install:
	npm install

# Update @elaraai dependencies
update:
	$(NVM) npm update @elaraai/east @elaraai/east-node-std @elaraai/east-ui @elaraai/east-ui-components @elaraai/e3 @elaraai/e3-api-client @elaraai/e3-api-server @elaraai/e3-api-tests @elaraai/e3-core @elaraai/e3-types @elaraai/e3-ui-components

# Build all packages (lint first)
build: lint
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

# Deploy platform (full CDK deploy — infra + web + config.json)
# Usage: make deploy CONFIG=elara-dev PROFILE=elaraai-dev-elara-e3
deploy:
	cd cdk/platform && AWS_PROFILE=$(PROFILE) npx cdk deploy --context config=$(CONFIG) --require-approval never

# Fast UI-only deploy: sync web/dist to S3 + invalidate CloudFront
# Assumes config.json is already correct from a prior `make deploy`.
# Usage: make deploy-web CONFIG=elara-dev PROFILE=elaraai-dev-elara-e3
deploy-web:
	./scripts/deploy-web.sh $(CONFIG) $(PROFILE)

# Deploy runner: build+push Docker image to ECR and update Lambda
# Usage: make deploy-runner CONFIG=elara-dev PROFILE=elaraai-dev-elara-e3
# Transfer: make deploy-runner CONFIG=kpmg PROFILE=elaraai-prod-kpmg-e3 FROM=elara-dev
deploy-runner:
	./scripts/deploy-runner.sh $(CONFIG) $(PROFILE) $(if $(FROM),--from $(FROM))

# Help
help:
	@echo "install          - Install dependencies (npm install)"
	@echo "update           - Update all dependencies (npm update)"
	@echo "build            - Build all packages"
	@echo "test             - Run all tests"
	@echo "test-integration - Run integration tests"
	@echo "lint             - Run linter"
	@echo "lint-fix         - Fix lint issues"
	@echo "dev              - Run frontend dev server"
	@echo "clean            - Clean build artifacts and node_modules"
	@echo "link             - Link CLI globally"
	@echo "deploy           - Full platform deploy via CDK (CONFIG=... PROFILE=...)"
	@echo "deploy-web       - Fast UI-only deploy to S3 + CloudFront (CONFIG=... PROFILE=...)"
	@echo "deploy-runner    - Build+push runner image to ECR + update Lambda (CONFIG=... PROFILE=... [FROM=...])"
