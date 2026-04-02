#!/usr/bin/env bash
# Pre-commit hook: prevent committing .npmrc files pointing to local Verdaccio.
# Installed by 'make install-hooks' in east-workspace.

set -euo pipefail

# Check for staged .npmrc files
npmrc_files=$(git diff --cached --name-only -- '*.npmrc' '.npmrc' || true)

if [ -n "$npmrc_files" ]; then
    for f in $npmrc_files; do
        if git show ":$f" 2>/dev/null | grep -q 'localhost:4873'; then
            echo ""
            echo "ERROR: Staged .npmrc points to local Verdaccio registry:"
            echo "  $f"
            echo ""
            echo "Run 'make restore' in east-workspace to remove it before committing."
            echo ""
            exit 1
        fi
    done
fi

# Also check for yalc references (legacy safety)
for f in $(git diff --cached --name-only -- '*.json' 2>/dev/null || true); do
    if git show ":$f" 2>/dev/null | grep -q 'file:\.yalc/'; then
        echo ""
        echo "ERROR: Yalc references found in: $f"
        echo "Run 'make restore' in east-workspace to clean up."
        echo ""
        exit 1
    fi
done
