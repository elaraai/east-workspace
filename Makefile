.PHONY: install build test test-integration lint lint-fix dev clean deploy deploy-web link help

# Install dependencies
install:
	npm install

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

# Deploy platform (usage: make deploy CONFIG=elara-dev PROFILE=elaraai-dev-elara-e3)
deploy:
ifndef CONFIG
	$(error CONFIG is required. Usage: make deploy CONFIG=elara-dev PROFILE=elaraai-dev-elara-e3)
endif
ifndef PROFILE
	$(error PROFILE is required. Usage: make deploy CONFIG=elara-dev PROFILE=elaraai-dev-elara-e3)
endif
	cd cdk/platform && AWS_PROFILE=$(PROFILE) npx cdk deploy --context config=$(CONFIG) --require-approval never

# Fast UI-only deploy: sync web/dist to S3 + invalidate CloudFront (skips full CDK)
# Usage: make deploy-web CONFIG=elara-dev PROFILE=elaraai-dev-elara-e3
deploy-web:
ifndef CONFIG
	$(error CONFIG is required. Usage: make deploy-web CONFIG=elara-dev PROFILE=elaraai-dev-elara-e3)
endif
ifndef PROFILE
	$(error PROFILE is required. Usage: make deploy-web CONFIG=elara-dev PROFILE=elaraai-dev-elara-e3)
endif
	$(eval DEPLOY_ID := $(shell jq -r '.deployment.id' cdk/platform/deployments/$(CONFIG).json))
	$(eval STACK_NAME := E3Platform-$(DEPLOY_ID))
	$(eval BUCKET := $(shell AWS_PROFILE=$(PROFILE) aws cloudformation describe-stacks --stack-name $(STACK_NAME) --query "Stacks[0].Outputs[?OutputKey=='AppsBucketName'].OutputValue" --output text))
	$(eval DIST_ID := $(shell AWS_PROFILE=$(PROFILE) aws cloudformation describe-stacks --stack-name $(STACK_NAME) --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" --output text))
	@echo "Syncing web/dist -> s3://$(BUCKET)"
	AWS_PROFILE=$(PROFILE) aws s3 sync web/dist "s3://$(BUCKET)" --delete --exclude "config.json"
	@echo "Invalidating CloudFront distribution $(DIST_ID)"
	AWS_PROFILE=$(PROFILE) aws cloudfront create-invalidation --distribution-id $(DIST_ID) --paths "/*" --output text
	@echo "UI deploy complete."

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
	@echo "deploy-web       - Fast UI-only deploy to S3 + CloudFront invalidation"
