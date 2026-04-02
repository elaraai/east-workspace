#!/usr/bin/env bash
# Test: Docker image builds
# Verifies: Dockerfile.east-node and Dockerfile.e3 build successfully
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

echo "=== Testing Docker builds ==="

# Test 1: east-node image
echo "[1/2] Building Dockerfile.east-node..."
docker build -f docker/Dockerfile.east-node -t test-east-node-$$ . --quiet
docker rmi test-east-node-$$ > /dev/null
echo "[OK] Dockerfile.east-node"

# Test 2: e3 image
echo "[2/2] Building Dockerfile.e3..."
docker build -f docker/Dockerfile.e3 -t test-e3-$$ . --quiet
docker rmi test-e3-$$ > /dev/null
echo "[OK] Dockerfile.e3"

echo "=== Docker builds PASSED ==="
