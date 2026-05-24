#!/usr/bin/env bash
# Test: e3.sh project scaffolding
# Verifies: project generation, make install, make build
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEST_DIR=$(mktemp -d)
PROJECT_NAME="test-e3-$$"

cleanup() {
    rm -rf "$TEST_DIR"
}
trap cleanup EXIT

echo "=== Testing e3.sh ==="

# Test 1: Generate project
echo "[1/5] Generating project..."
cd "$TEST_DIR"
"$REPO_ROOT/scripts/project/e3.sh" "$PROJECT_NAME"

# Test 2: Verify files exist
echo "[2/5] Verifying generated files..."
cd "$TEST_DIR/$PROJECT_NAME"
for f in package.json tsconfig.json pyproject.toml src/index.ts src/main.ts Makefile .gitignore .nvmrc .python-version; do
    [ -f "$f" ] || { echo "FAIL: Missing $f"; exit 1; }
done

# Test 3: make install
echo "[3/5] Running make install..."
make install

# Test 4: make build
echo "[4/5] Running make build..."
make build

# Verify build output
[ -f "dist/index.js" ] || { echo "FAIL: Build output missing"; exit 1; }
[ -f "dist/main.js" ] || { echo "FAIL: main.js missing"; exit 1; }

# Test 5: npm run main (exports e3 package, tests task compiles)
echo "[5/5] Running npm run main..."
rm -f /tmp/pkg.zip  # Clean up any previous export
npm run main

# Verify package was exported
[ -f "/tmp/pkg.zip" ] || { echo "FAIL: e3 package export missing"; exit 1; }
rm -f /tmp/pkg.zip  # Clean up

echo "=== e3.sh tests PASSED ==="
