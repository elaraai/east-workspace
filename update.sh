#!/usr/bin/env bash
set -euo pipefail

# East Workspace Update Script
# Updates all submodules to their latest tracked commits

echo "=== Updating East Workspace ==="
echo ""

# Pull latest changes in the meta repo
echo "Updating meta repository..."
git pull

echo ""
echo "Updating all submodules..."
git submodule update --remote --recursive

echo ""
echo "=== Update Complete ==="
echo ""
echo "To see what changed, run: ./status.sh"
echo ""
echo "Note: Submodules are now at their latest commits on their default branches."
echo "To lock specific versions, commit the submodule references in the meta repo."
echo ""
