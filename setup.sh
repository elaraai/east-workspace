#!/usr/bin/env bash
set -euo pipefail

# East Workspace Setup Script
# This script clones the east-workspace repository and all submodules

REPO_URL="git@github.com:elaraai/east-workspace"

echo "=== East Workspace Setup ==="
echo ""

# Check if we're already in the workspace
if [ -f ".gitmodules" ] && [ -d ".git" ]; then
    echo "Already inside east-workspace directory."
    echo "Initializing and updating submodules..."
    git submodule update --init --recursive
    echo ""
    echo "✓ All submodules initialized and updated"
else
    echo "Cloning east-workspace repository..."
    git clone --recursive "$REPO_URL" east-workspace
    cd east-workspace
    echo ""
    echo "✓ Repository cloned with all submodules"
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Directory structure:"
echo "  east-workspace/"
echo "  ├── east/              (TypeScript core)"
echo "  ├── East.jl/           (Julia backend)"
echo "  ├── east-py/           (Python backend)"
echo "  ├── east-node/         (Node.js platform)"
echo "  ├── east-node-io/      (Node.js I/O bindings)"
echo "  ├── east-py-io/        (Python I/O bindings)"
echo "  ├── east-py-std/       (Python std bindings)"
echo "  ├── east-mcp/          (MCP integration)"
echo "  └── east-plugin/       (Claude Code plugin)"
echo ""
echo "Next steps:"
echo "  1. cd east-workspace"
echo "  2. Run './update.sh' to pull latest changes"
echo "  3. Run './status.sh' to check git status across all repos"
echo ""
