#!/usr/bin/env bash
# East Development Environment Update Script (monorepo)
# Usage: curl -fsSL https://raw.githubusercontent.com/elaraai/east-workspace/main/libs/east-claude-plugin/scripts/update-dev.sh | bash
#
# Pulls the latest east-workspace and rebuilds + relinks all CLIs.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
if [ -f "$SCRIPT_DIR/lib/common.sh" ]; then
    source "$SCRIPT_DIR/lib/common.sh"
else
    RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
    log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
    log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
    log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
    log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
fi

WORKSPACE_DIR="${EAST_WORKSPACE_DIR:-$HOME/east-workspace}"

echo ""
echo "=========================================="
echo "  East Workspace Update"
echo "=========================================="
echo ""

if [ ! -d "$WORKSPACE_DIR/.git" ]; then
    log_error "Workspace not found at $WORKSPACE_DIR. Run install-dev.sh first."
    exit 1
fi

cd "$WORKSPACE_DIR"

if ! git diff --quiet || ! git diff --staged --quiet; then
    log_warn "Uncommitted changes present — skipping pull, rebuilding current tree"
else
    log_info "Pulling latest"
    git pull --ff-only
fi

log_info "make build"
make build

log_info "make link"
make link

echo ""
log_success "Update complete ($(git rev-parse --abbrev-ref HEAD) @ $(git rev-parse --short HEAD))"
