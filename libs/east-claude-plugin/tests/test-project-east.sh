#!/usr/bin/env bash
# Test: east.sh project scaffolding
# Verifies: project generation, file structure, make install, make build
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEST_DIR=$(mktemp -d)
PROJECT_NAME="test-east-$$"

cleanup() {
    rm -rf "$TEST_DIR"
}
trap cleanup EXIT

echo "=== Testing east.sh ==="

# Test 1: Generate project
echo "[1/4] Generating project..."
cd "$TEST_DIR"
"$REPO_ROOT/scripts/project/east.sh" "$PROJECT_NAME"

# Test 2: Verify files exist
echo "[2/4] Verifying generated files..."
cd "$TEST_DIR/$PROJECT_NAME"
for f in package.json tsconfig.json src/index.ts Makefile .gitignore .nvmrc; do
    [ -f "$f" ] || { echo "FAIL: Missing $f"; exit 1; }
done

# Test 3: make install
echo "[3/4] Running make install..."
make install

# Test 4: make build
echo "[4/4] Running make build..."
make build

# Verify build output
[ -f "dist/index.js" ] || { echo "FAIL: Build output missing"; exit 1; }

echo "=== east.sh tests PASSED ==="
