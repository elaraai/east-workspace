#!/bin/bash
#
# Build+push runner Docker image to ECR and update the Lambda function.
#
# Usage:
#   ./scripts/deploy-runner.sh <config-name> [aws-profile]
#
# Examples:
#   ./scripts/deploy-runner.sh elara-dev elaraai-dev-elara-e3
#   AWS_PROFILE=elaraai-dev-elara-e3 ./scripts/deploy-runner.sh elara-dev

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

CONFIG_NAME="${1:?Usage: $0 <config-name> [aws-profile]}"
PROFILE="${2:-${AWS_PROFILE:-}}"

CONFIG_FILE="$PROJECT_ROOT/cdk/platform/deployments/${CONFIG_NAME}.json"
if [ ! -f "$CONFIG_FILE" ]; then
  echo "Error: Config file not found: $CONFIG_FILE"
  exit 1
fi

DEPLOY_ID=$(jq -r '.deployment.id' "$CONFIG_FILE")
REGION=$(jq -r '.aws.region' "$CONFIG_FILE")
ACCOUNT_ID=$(jq -r '.aws.accountId' "$CONFIG_FILE")
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/e3-${DEPLOY_ID}-runner"

# Build and push the Docker image
AWS_PROFILE="$PROFILE" AWS_REGION="$REGION" E3_DEPLOYMENT_ID="$DEPLOY_ID" \
  "$SCRIPT_DIR/build-runner.sh" --push

# Update Lambda to use the new image
echo "Updating Lambda function e3-${DEPLOY_ID}-execute-task..."
AWS_PROFILE="$PROFILE" aws lambda update-function-code \
  --function-name "e3-${DEPLOY_ID}-execute-task" \
  --image-uri "${ECR_URI}:latest" \
  --region "$REGION"

echo "Runner deploy complete."
