#!/usr/bin/env bash
set -euo pipefail

# East Workspace Status Script
# Shows git status across all repositories

echo "=== East Workspace Status ==="
echo ""

# Function to print section header
print_header() {
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  $1"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# Meta repository status
print_header "Meta Repository (east-workspace)"
git status -s
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
CURRENT_COMMIT=$(git rev-parse --short HEAD)
echo "Branch: $CURRENT_BRANCH @ $CURRENT_COMMIT"
echo ""

# List of all submodules
SUBMODULES=(
    "east"
    "East.jl"
    "east-py"
    "east-node"
    "east-node-io"
    "east-py-io"
    "east-py-std"
    "east-mcp"
    "east-plugin"
)

# Check status of each submodule
for submodule in "${SUBMODULES[@]}"; do
    if [ -d "$submodule" ]; then
        print_header "$submodule"
        (
            cd "$submodule"
            git status -s
            CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
            CURRENT_COMMIT=$(git rev-parse --short HEAD)
            echo "Branch: $CURRENT_BRANCH @ $CURRENT_COMMIT"

            # Show if submodule has unpushed commits
            UNPUSHED=$(git log @{u}.. --oneline 2>/dev/null | wc -l || echo "0")
            if [ "$UNPUSHED" -gt 0 ]; then
                echo "⚠️  $UNPUSHED unpushed commit(s)"
            fi

            # Show if submodule is behind remote
            git fetch --quiet 2>/dev/null || true
            BEHIND=$(git log ..@{u} --oneline 2>/dev/null | wc -l || echo "0")
            if [ "$BEHIND" -gt 0 ]; then
                echo "⚠️  $BEHIND commit(s) behind remote"
            fi
        )
        echo ""
    fi
done

echo "=== Summary ==="
echo ""
echo "Run 'git submodule summary' to see changes in submodules"
echo "Run './update.sh' to update all submodules"
echo ""
