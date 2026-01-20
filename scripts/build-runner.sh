#!/bin/bash
#
# Build and push the Lambda runner container image to ECR
#
# Prerequisites:
# - AWS CLI configured with appropriate credentials
# - Docker installed and running
# - packages/runner must be built (npm run build)
#
# Usage:
#   ./scripts/build-runner.sh [--push]
#
# Options:
#   --push    Push the image to ECR (default: local build only)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Parse arguments
PUSH_IMAGE=false
for arg in "$@"; do
  case $arg in
    --push)
      PUSH_IMAGE=true
      shift
      ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: $0 [--push]"
      exit 1
      ;;
  esac
done

# Get AWS account and region
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=${AWS_REGION:-${AWS_DEFAULT_REGION:-us-west-2}}

# ECR repository name (matches CDK stack naming)
DEPLOYMENT_ID=${E3_DEPLOYMENT_ID:-dev}
ECR_REPO_NAME="e3-${DEPLOYMENT_ID}-runner"
ECR_REPO_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${ECR_REPO_NAME}"

echo "Building Lambda runner image..."
echo "  Project root: $PROJECT_ROOT"
echo "  ECR repo: $ECR_REPO_URI"
echo "  Push: $PUSH_IMAGE"

# Ensure runner package is built
if [ ! -d "$PROJECT_ROOT/packages/runner/dist" ]; then
  echo "Error: packages/runner/dist not found. Run 'npm run build' first."
  exit 1
fi

# Build the image
cd "$PROJECT_ROOT"
docker build \
  -f docker/Dockerfile.runner \
  -t "$ECR_REPO_NAME:latest" \
  -t "$ECR_REPO_URI:latest" \
  .

echo "Image built successfully: $ECR_REPO_NAME:latest"

if [ "$PUSH_IMAGE" = true ]; then
  echo "Logging in to ECR..."
  aws ecr get-login-password --region "$REGION" | \
    docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"

  echo "Pushing image to ECR..."
  docker push "$ECR_REPO_URI:latest"

  echo "Image pushed successfully: $ECR_REPO_URI:latest"
fi
