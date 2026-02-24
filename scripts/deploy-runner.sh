#!/bin/bash
#
# Build+push runner Docker image to ECR and update the Lambda function.
# Supports building from source or transferring from another environment.
#
# Usage:
#   ./scripts/deploy-runner.sh <config-name> [aws-profile] [--from <source-config>]
#
# Examples:
#   # Build from source
#   ./scripts/deploy-runner.sh elara-dev elaraai-dev-elara-e3
#   AWS_PROFILE=elaraai-dev-elara-e3 ./scripts/deploy-runner.sh elara-dev
#
#   # Transfer from another environment (no rebuild)
#   ./scripts/deploy-runner.sh kpmg elaraai-prod-kpmg-e3 --from elara-dev
#   ./scripts/deploy-runner.sh kpmg --from elara-dev

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Parse all arguments: extract --from first, then assign positionals
SOURCE_CONFIG=""
POSITIONAL_ARGS=()
while [[ $# -gt 0 ]]; do
  case $1 in
    --from)
      SOURCE_CONFIG="${2:?--from requires a source config name}"
      shift 2
      ;;
    *)
      POSITIONAL_ARGS+=("$1")
      shift
      ;;
  esac
done

CONFIG_NAME="${POSITIONAL_ARGS[0]:?Usage: $0 <config-name> [aws-profile] [--from <source-config>]}"
PROFILE="${POSITIONAL_ARGS[1]:-${AWS_PROFILE:-}}"

# Read target config
CONFIG_FILE="$PROJECT_ROOT/cdk/platform/deployments/${CONFIG_NAME}.json"
if [ ! -f "$CONFIG_FILE" ]; then
  echo "Error: Config file not found: $CONFIG_FILE"
  exit 1
fi

DEPLOY_ID=$(jq -r '.deployment.id' "$CONFIG_FILE")
REGION=$(jq -r '.aws.region' "$CONFIG_FILE")
ACCOUNT_ID=$(jq -r '.aws.accountId' "$CONFIG_FILE")
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/e3-${DEPLOY_ID}-runner"

if [ -n "$SOURCE_CONFIG" ]; then
  # --- Transfer mode: pull from source, push to target ---
  SOURCE_FILE="$PROJECT_ROOT/cdk/platform/deployments/${SOURCE_CONFIG}.json"
  if [ ! -f "$SOURCE_FILE" ]; then
    echo "Error: Source config file not found: $SOURCE_FILE"
    exit 1
  fi

  if [ "$SOURCE_CONFIG" = "$CONFIG_NAME" ]; then
    echo "Error: source and target environments must be different"
    exit 1
  fi

  SOURCE_DEPLOY_ID=$(jq -r '.deployment.id' "$SOURCE_FILE")
  SOURCE_REGION=$(jq -r '.aws.region' "$SOURCE_FILE")
  SOURCE_ACCOUNT_ID=$(jq -r '.aws.accountId' "$SOURCE_FILE")
  # Profile name comes from the source deployment config JSON (aws.profile).
  # Your local ~/.aws/config must have a profile with this exact name.
  # If auth fails here, run: aws sso login --profile <name-below>
  SOURCE_PROFILE=$(jq -r '.aws.profile' "$SOURCE_FILE")
  SOURCE_ECR_URI="${SOURCE_ACCOUNT_ID}.dkr.ecr.${SOURCE_REGION}.amazonaws.com/e3-${SOURCE_DEPLOY_ID}-runner"

  echo "Transferring runner image: ${SOURCE_CONFIG} → ${CONFIG_NAME}"
  echo "  Source: $SOURCE_ECR_URI"
  echo "  Target: $ECR_URI"

  # Login to source ECR and pull
  echo "Pulling image from source ECR..."
  AWS_PROFILE="$SOURCE_PROFILE" aws ecr get-login-password --region "$SOURCE_REGION" | \
    docker login --username AWS --password-stdin "${SOURCE_ACCOUNT_ID}.dkr.ecr.${SOURCE_REGION}.amazonaws.com"
  docker pull "${SOURCE_ECR_URI}:latest"

  # Login to target ECR and push
  echo "Pushing image to target ECR..."
  AWS_PROFILE="$PROFILE" aws ecr get-login-password --region "$REGION" | \
    docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
  docker tag "${SOURCE_ECR_URI}:latest" "${ECR_URI}:latest"
  docker push "${ECR_URI}:latest"
else
  # --- Build mode: build from source and push ---
  AWS_PROFILE="$PROFILE" AWS_REGION="$REGION" E3_DEPLOYMENT_ID="$DEPLOY_ID" \
    "$SCRIPT_DIR/build-runner.sh" --push
fi

# Update Lambda to use the new image
echo "Updating Lambda function e3-${DEPLOY_ID}-execute-task..."
AWS_PROFILE="$PROFILE" aws lambda update-function-code \
  --function-name "e3-${DEPLOY_ID}-execute-task" \
  --image-uri "${ECR_URI}:latest" \
  --region "$REGION"

echo "Runner deploy complete."
