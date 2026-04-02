#!/bin/bash
#
# Deploy web assets to S3 and invalidate CloudFront.
# Assumes config.json is already correct from a prior `cdk deploy`.
#
# Usage:
#   ./scripts/deploy-web.sh <config-name> [aws-profile]
#
# Examples:
#   ./scripts/deploy-web.sh elara-dev elaraai-dev-elara-e3
#   AWS_PROFILE=elaraai-dev-elara-e3 ./scripts/deploy-web.sh elara-dev

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

CONFIG_NAME="${1:?Usage: $0 <config-name> [aws-profile]}"
PROFILE="${2:-${AWS_PROFILE:-}}"
PROFILE_FLAG=( ${PROFILE:+--profile "$PROFILE"} )

CONFIG_FILE="$PROJECT_ROOT/cdk/platform/deployments/${CONFIG_NAME}.json"
if [ ! -f "$CONFIG_FILE" ]; then
  echo "Error: Config file not found: $CONFIG_FILE"
  exit 1
fi

DEPLOY_ID=$(jq -r '.deployment.id' "$CONFIG_FILE")
STACK="E3Platform-${DEPLOY_ID}"

echo "Looking up stack outputs for $STACK..."
BUCKET=$(aws cloudformation describe-stacks --stack-name "$STACK" "${PROFILE_FLAG[@]}" \
  --query "Stacks[0].Outputs[?OutputKey=='AppsBucketName'].OutputValue" --output text)
DIST_ID=$(aws cloudformation describe-stacks --stack-name "$STACK" "${PROFILE_FLAG[@]}" \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" --output text)

echo "Syncing web/dist -> s3://${BUCKET} (preserving config.json)"
aws s3 sync "$PROJECT_ROOT/web/dist" "s3://${BUCKET}" --delete --exclude config.json "${PROFILE_FLAG[@]}"

echo "Invalidating CloudFront distribution ${DIST_ID}"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" "${PROFILE_FLAG[@]}" --output text

echo "UI deploy complete."
