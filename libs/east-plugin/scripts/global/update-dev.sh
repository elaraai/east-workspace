#!/usr/bin/env bash
# East Development Environment Update Script
# Usage: curl -fsSL https://raw.githubusercontent.com/elaraai/east-plugin/main/scripts/global/update-dev.sh | bash
#
# Pulls latest changes and rebuilds all East repositories.

set -e

# Source shared utilities (works both locally and via curl | bash)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
if [ -f "$SCRIPT_DIR/../lib/common.sh" ]; then
    source "$SCRIPT_DIR/../lib/common.sh"
else
    # Fallback for curl | bash - define inline
    RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
    log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
    log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
    log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
    log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
    source_nvm() {
        export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    }
fi

# Configuration
EAST_DIR="${EAST_DIR:-$HOME/east}"
REPOS=(east east-c east-node east-py east-ui e3)

echo ""
echo "=========================================="
echo "  East Development Environment Update"
echo "=========================================="
echo ""

# Check if EAST_DIR exists
if [ ! -d "$EAST_DIR" ]; then
    log_error "East directory not found: $EAST_DIR"
    echo "Run install-dev.sh first to set up the development environment."
    exit 1
fi

cd "$EAST_DIR"

# Source nvm
source_nvm
if ! command -v nvm &> /dev/null; then
    log_error "nvm not found. Run install-dev.sh first."
    exit 1
fi

# Check for required tools
for cmd in git make; do
    if ! command -v $cmd &> /dev/null; then
        log_error "$cmd not found"
        exit 1
    fi
done

# Pull and rebuild a repository
update_repo() {
    local repo=$1

    if [ ! -d "$EAST_DIR/$repo" ]; then
        log_warn "$repo not found, skipping"
        return 1
    fi

    log_info "Updating $repo..."
    cd "$EAST_DIR/$repo"

    # Check for uncommitted changes
    if ! git diff --quiet || ! git diff --staged --quiet; then
        log_warn "$repo has uncommitted changes, skipping pull"
    else
        # Pull latest
        git fetch origin
        local branch=$(git rev-parse --abbrev-ref HEAD)
        git pull origin "$branch" --ff-only || {
            log_warn "Could not fast-forward $repo, skipping pull"
        }
    fi

    # Update @elaraai packages and rebuild
    npm update $(grep -roh '"@elaraai/[^"]*"' --include='package.json' . | tr -d '"' | sort -u | tr '\n' ' ') 2>/dev/null || true
    if [ -f "Makefile" ]; then
        make build && log_success "Built $repo" || {
            log_warn "Build failed for $repo"
            cd "$EAST_DIR"
            return 1
        }
    fi

    cd "$EAST_DIR"
    return 0
}

# Update repositories in dependency order
log_info "Updating repositories..."
echo ""

# east first (no deps)
update_repo "east"

# east-c (no deps, C runtime)
update_repo "east-c"

# east-node depends on east
update_repo "east-node"

# east-py depends on east-node (for test IR)
update_repo "east-py"

# east-ui depends on east
update_repo "east-ui"

# e3 depends on east, east-node, east-py
update_repo "e3"

# Re-link CLIs
echo ""
log_info "Re-linking CLIs..."

cd "$EAST_DIR/east-node"
make link-cli 2>/dev/null && log_success "east-node CLI linked" || true

cd "$EAST_DIR/e3"
make link 2>/dev/null && log_success "e3 CLI linked" || true

cd "$EAST_DIR/east-py"
make install-cli 2>/dev/null && log_success "east-py CLI installed" || true

cd "$EAST_DIR/east-c"
make install-cli 2>/dev/null && log_success "east-c CLI installed" || true

# Show status
echo ""
log_info "Repository status:"
echo ""

for repo in "${REPOS[@]}"; do
    if [ -d "$EAST_DIR/$repo" ]; then
        cd "$EAST_DIR/$repo"
        local_commit=$(git rev-parse --short HEAD)
        branch=$(git rev-parse --abbrev-ref HEAD)
        echo "  $repo: $branch @ $local_commit"
    fi
done

echo ""
log_success "Update complete!"
