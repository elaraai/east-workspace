#!/usr/bin/env bash
# Test: Docker image builds
# Verifies: every published image Dockerfile builds successfully
# (east-node, east-c, east-py, east-py-datascience FROM-chained, e3)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$REPO_ROOT"

echo "=== Testing Docker builds ==="

# Test 1: east-node image
echo "[1/5] Building Dockerfile.east-node..."
docker build -f docker/images/Dockerfile.east-node -t test-east-node-$$ . --quiet
docker rmi test-east-node-$$ > /dev/null
echo "[OK] Dockerfile.east-node"

# Test 2: east-c image (tiny — just the prebuilt evaluator)
echo "[2/5] Building Dockerfile.east-c..."
docker build -f docker/images/Dockerfile.east-c -t test-east-c-$$ . --quiet
docker rmi test-east-c-$$ > /dev/null
echo "[OK] Dockerfile.east-c"

# Test 3: east-py image (python runtime, no datascience). Kept for test 4's
# FROM chain, removed after.
echo "[3/5] Building Dockerfile.east-py..."
docker build -f docker/images/Dockerfile.east-py -t test-east-py-$$ . --quiet
echo "[OK] Dockerfile.east-py"

# Test 4: east-py-datascience FROM the image test 3 just built (BASE_IMAGE
# override — the ghcr base doesn't exist for unpublished versions). Proves
# the FROM chain and the single-layer datascience delta.
echo "[4/5] Building Dockerfile.east-py-datascience (FROM local east-py)..."
docker build -f docker/images/Dockerfile.east-py-datascience \
    --build-arg BASE_IMAGE=test-east-py-$$ \
    -t test-east-py-ds-$$ . --quiet
docker rmi test-east-py-ds-$$ test-east-py-$$ > /dev/null
echo "[OK] Dockerfile.east-py-datascience"

# Test 5: e3 image (the everything / local-dev image)
echo "[5/5] Building Dockerfile.e3..."
docker build -f docker/images/Dockerfile.e3 -t test-e3-$$ . --quiet
docker rmi test-e3-$$ > /dev/null
echo "[OK] Dockerfile.e3"

echo "=== Docker builds PASSED ==="
