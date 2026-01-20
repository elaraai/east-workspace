# e3 Demo Deployment
#
# Usage:
#   make deploy    - Build package and deploy to dev.e3.elaraai.com
#   make clean     - Remove built artifacts
#   make status    - Show workspace status
#   make results   - Show task outputs
#
# After deployment, explore with:
#   e3 list https://dev.e3.elaraai.com/repos/demo
#   e3 workspace status https://dev.e3.elaraai.com/repos/demo dev
#   e3 get https://dev.e3.elaraai.com/repos/demo dev.tasks.format.output

PLATFORM := https://dev.e3.elaraai.com
REPO := demo
REPO_URL := $(PLATFORM)/repos/$(REPO)
WORKSPACE := dev
PACKAGE := demo@1.0.0

.PHONY: deploy clean status results build

# Build the package zip
build:
	npm run build

# Deploy everything (idempotent - safe to run multiple times)
deploy: build
	@echo "=== Deploying to $(REPO_URL) ==="
	@echo ""
	@echo "Creating repo '$(REPO)' (if needed)..."
	-e3 repo create $(REPO_URL) 2>/dev/null || true
	@echo ""
	@echo "Importing package..."
	e3 package import $(REPO_URL) dist/demo-1.0.0.zip
	@echo ""
	@echo "Creating workspace '$(WORKSPACE)' (if needed)..."
	-e3 workspace create $(REPO_URL) $(WORKSPACE) 2>/dev/null || true
	@echo ""
	@echo "Deploying $(PACKAGE) to workspace..."
	e3 workspace deploy $(REPO_URL) $(WORKSPACE) $(PACKAGE)
	@echo ""
	@echo "Running dataflow..."
	e3 start $(REPO_URL) $(WORKSPACE)
	@echo ""
	@echo "=== Deployment complete! ==="
	@echo ""
	@echo "Explore with:"
	@echo "  e3 list $(REPO_URL)"
	@echo "  e3 workspace status $(REPO_URL) $(WORKSPACE)"
	@echo "  e3 get $(REPO_URL) $(WORKSPACE).tasks.format.output"

# Show workspace status
status:
	e3 workspace status $(REPO_URL) $(WORKSPACE)

# Show all task outputs
results:
	@echo "=== Demo Results ==="
	@echo ""
	@echo "Inputs:"
	@echo "  x = $$(e3 get $(REPO_URL) $(WORKSPACE).inputs.x)"
	@echo "  y = $$(e3 get $(REPO_URL) $(WORKSPACE).inputs.y)"
	@echo ""
	@echo "Tasks:"
	@echo "  add (x + y)     = $$(e3 get $(REPO_URL) $(WORKSPACE).tasks.add.output)"
	@echo "  mul (x * y)     = $$(e3 get $(REPO_URL) $(WORKSPACE).tasks.mul.output)"
	@echo "  combine (+ mul) = $$(e3 get $(REPO_URL) $(WORKSPACE).tasks.combine.output)"
	@echo "  format (string) = $$(e3 get $(REPO_URL) $(WORKSPACE).tasks.format.output)"

# Clean build artifacts
clean:
	rm -rf dist node_modules
