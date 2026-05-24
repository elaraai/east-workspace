#!/usr/bin/env bash
# Test installation scripts in a fresh Ubuntu container
# Usage: ./test-install.sh [install|install-dev] [-y]
#
# Examples:
#   ./test-install.sh install        # Test install.sh interactively
#   ./test-install.sh install -y     # Test install.sh non-interactively
#   ./test-install.sh install-dev    # Test install-dev.sh interactively
#   ./test-install.sh install-dev -y # Test install-dev.sh non-interactively

set -e

SCRIPT="${1:-install}"
YES_FLAG=""

# Check for -y flag
for arg in "$@"; do
    case $arg in
        -y|--yes) YES_FLAG="-y" ;;
    esac
done

echo "Testing scripts/global/$SCRIPT.sh in fresh Ubuntu container..."
[ -n "$YES_FLAG" ] && echo "  (non-interactive mode)"
echo ""

# For local testing, mount the current directory
if [ -f "scripts/global/$SCRIPT.sh" ]; then
    echo "Using local script from ./scripts/global/$SCRIPT.sh"
    docker run -it --rm \
        -v "$(pwd)/scripts:/scripts:ro" \
        ubuntu:24.04 \
        bash -c "bash /scripts/global/$SCRIPT.sh $YES_FLAG"
else
    echo "Local script not found. Run from repo root."
    exit 1
fi
