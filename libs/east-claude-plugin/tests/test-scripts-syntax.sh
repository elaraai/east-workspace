#!/usr/bin/env bash
# Test: Bash syntax validation for all scripts
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== Testing script syntax ==="

SCRIPTS=(
    scripts/lib/common.sh
    scripts/global/install.sh
    scripts/global/install-dev.sh
    scripts/global/update.sh
    scripts/global/update-dev.sh
    scripts/project/east.sh
    scripts/project/e3.sh
    docker/install-packages.sh
    docker/test-install.sh
)

FAILED=0
for script in "${SCRIPTS[@]}"; do
    if [ -f "$REPO_ROOT/$script" ]; then
        if bash -n "$REPO_ROOT/$script" 2>/dev/null; then
            echo "[OK] $script"
        else
            echo "[FAIL] $script"
            FAILED=$((FAILED + 1))
        fi
    else
        echo "[SKIP] $script (not found)"
    fi
done

if [ $FAILED -gt 0 ]; then
    echo "=== $FAILED script(s) failed syntax check ==="
    exit 1
fi

echo "=== All scripts passed syntax check ==="
