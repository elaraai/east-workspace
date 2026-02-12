#!/bin/bash
#
# Wipe all data from the dev environment's S3 bucket and DynamoDB table.
# Hardcoded to only work on the dev environment (e3-dev-*).
#
# This removes all objects/rows but does NOT delete the infrastructure.
# Useful for resetting to a clean state after data corruption or schema changes.
#
# Prerequisites:
# - AWS CLI configured with appropriate credentials
# - AWS_PROFILE=elaraai-dev-elara-e3 (or equivalent)
#
# Usage:
#   AWS_PROFILE=elaraai-dev-elara-e3 ./scripts/wipe-dev-data.sh

set -euo pipefail

# Hardcoded dev environment resources
TABLE_NAME="e3-dev-data"
BUCKET_NAME="e3-dev-data-925445553972"
REGION="ap-southeast-2"

# Safety: verify we're targeting the right account
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null) || {
  echo "Error: Failed to get AWS identity. Are you logged in?"
  echo "  aws sso login --profile elaraai-dev-elara-e3"
  exit 1
}

if [ "$ACCOUNT_ID" != "925445553972" ]; then
  echo "Error: Wrong AWS account ($ACCOUNT_ID). This script only works on the dev account (925445553972)."
  exit 1
fi

echo "=== Wiping dev environment data ==="
echo "  Table:  $TABLE_NAME"
echo "  Bucket: $BUCKET_NAME"
echo "  Region: $REGION"
echo ""

# Confirm
read -p "This will DELETE ALL DATA in the dev environment. Type 'yes' to continue: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 1
fi

echo ""

# --- DynamoDB: Scan and batch-delete all items ---
echo "--- Wiping DynamoDB table: $TABLE_NAME ---"

DYNAMO_DELETED=0
SCAN_ARGS="--table-name $TABLE_NAME --projection-expression PK,SK --region $REGION"
HAS_MORE=true
START_KEY=""

while [ "$HAS_MORE" = "true" ]; do
  if [ -n "$START_KEY" ]; then
    RESPONSE=$(aws dynamodb scan $SCAN_ARGS --exclusive-start-key "$START_KEY" --output json)
  else
    RESPONSE=$(aws dynamodb scan $SCAN_ARGS --output json)
  fi

  ITEMS=$(echo "$RESPONSE" | jq -c '.Items[]?' 2>/dev/null)
  LAST_KEY=$(echo "$RESPONSE" | jq -c '.LastEvaluatedKey // empty' 2>/dev/null)

  if [ -n "$ITEMS" ]; then
    # Build batch delete requests in groups of 25
    BATCH=""
    COUNT=0

    while IFS= read -r ITEM; do
      PK=$(echo "$ITEM" | jq -c '.PK')
      SK=$(echo "$ITEM" | jq -c '.SK')
      REQUEST="{\"DeleteRequest\":{\"Key\":{\"PK\":$PK,\"SK\":$SK}}}"

      if [ -z "$BATCH" ]; then
        BATCH="$REQUEST"
      else
        BATCH="$BATCH,$REQUEST"
      fi
      COUNT=$((COUNT + 1))

      if [ "$COUNT" -eq 25 ]; then
        aws dynamodb batch-write-item \
          --region "$REGION" \
          --request-items "{\"$TABLE_NAME\":[$BATCH]}" \
          --output text > /dev/null
        DYNAMO_DELETED=$((DYNAMO_DELETED + COUNT))
        printf "\r  Deleted %d items..." "$DYNAMO_DELETED"
        BATCH=""
        COUNT=0
      fi
    done <<< "$ITEMS"

    # Flush remaining
    if [ "$COUNT" -gt 0 ]; then
      aws dynamodb batch-write-item \
        --region "$REGION" \
        --request-items "{\"$TABLE_NAME\":[$BATCH]}" \
        --output text > /dev/null
      DYNAMO_DELETED=$((DYNAMO_DELETED + COUNT))
      printf "\r  Deleted %d items..." "$DYNAMO_DELETED"
    fi
  fi

  if [ -n "$LAST_KEY" ]; then
    START_KEY="$LAST_KEY"
  else
    HAS_MORE=false
  fi
done

echo ""
echo "  DynamoDB: $DYNAMO_DELETED items deleted."
echo ""

# --- S3: Delete all objects (including versions and delete markers) ---
echo "--- Wiping S3 bucket: $BUCKET_NAME ---"

S3_DELETED=0
S3_TMPFILE=$(mktemp)
trap "rm -f $S3_TMPFILE" EXIT
HAS_MORE=true
KEY_MARKER=""
VERSION_MARKER=""

while [ "$HAS_MORE" = "true" ]; do
  if [ -n "$KEY_MARKER" ]; then
    RESPONSE=$(aws s3api list-object-versions --bucket "$BUCKET_NAME" --region "$REGION" --output json --key-marker "$KEY_MARKER" --version-id-marker "$VERSION_MARKER")
  else
    RESPONSE=$(aws s3api list-object-versions --bucket "$BUCKET_NAME" --region "$REGION" --output json)
  fi

  # Collect all versions and delete markers
  OBJECTS=$(echo "$RESPONSE" | jq -c '[
    (.Versions // [])[] | {Key: .Key, VersionId: .VersionId},
    (.DeleteMarkers // [])[] | {Key: .Key, VersionId: .VersionId}
  ]')

  OBJ_COUNT=$(echo "$OBJECTS" | jq 'length')

  if [ "$OBJ_COUNT" -eq 0 ]; then
    HAS_MORE=false
    continue
  fi

  # Write delete request to temp file to avoid argument length limits
  echo "$OBJECTS" | jq -c "{Objects: ., Quiet: true}" > "$S3_TMPFILE"

  aws s3api delete-objects \
    --bucket "$BUCKET_NAME" \
    --region "$REGION" \
    --delete "file://$S3_TMPFILE" \
    --output text > /dev/null

  S3_DELETED=$((S3_DELETED + OBJ_COUNT))
  printf "\r  Deleted %d objects..." "$S3_DELETED"

  IS_TRUNCATED=$(echo "$RESPONSE" | jq -r '.IsTruncated // false')
  if [ "$IS_TRUNCATED" = "true" ]; then
    KEY_MARKER=$(echo "$RESPONSE" | jq -r '.NextKeyMarker')
    VERSION_MARKER=$(echo "$RESPONSE" | jq -r '.NextVersionIdMarker')
  else
    HAS_MORE=false
  fi
done

echo ""
echo "  S3: $S3_DELETED objects/versions deleted."
echo ""

echo "=== Dev environment data wiped ==="
