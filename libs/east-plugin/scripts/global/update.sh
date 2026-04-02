#!/usr/bin/env bash
# East CLI Update Script
# Usage: curl -fsSL https://raw.githubusercontent.com/elaraai/east-plugin/main/scripts/global/update.sh | bash
#
# Updates all East CLIs to their latest versions from npm/PyPI.

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

echo ""
echo "=========================================="
echo "  East CLI Update"
echo "=========================================="
echo ""

# Source nvm if available
source_nvm

# Check for npm
if ! command -v npm &> /dev/null; then
    log_error "npm not found. Run install.sh first."
    exit 1
fi

# Update e3 CLI
log_info "Updating Node.js packages..."
npm install -g @elaraai/e3-cli@beta && log_success "e3-cli updated" || log_warn "Failed to update e3-cli"

# Update all @elaraai packages found in local package.json files
log_info "Updating @elaraai packages..."
npm update $(grep -roh '"@elaraai/[^"]*"' --include='package.json' . | tr -d '"' | sort -u | tr '\n' ' ') && log_success "@elaraai packages updated" || log_warn "Failed to update @elaraai packages"

# Update Python CLI if uv is available
if command -v uv &> /dev/null; then
    log_info "Updating Python packages..."
    uv tool upgrade east-py && log_success "east-py updated" || log_warn "Failed to update east-py"
else
    log_warn "uv not found, skipping Python CLI update"
fi

# Update east-c CLI (rebuild from source)
if command -v east-c &> /dev/null && command -v cmake &> /dev/null; then
    log_info "Updating east-c CLI (rebuilding from source)..."
    tmpdir=$(mktemp -d)
    git clone --depth 1 https://github.com/elaraai/east-c.git "$tmpdir/east-c" && \
        cd "$tmpdir/east-c" && make build && make install-cli && \
        log_success "east-c updated" || log_warn "Failed to update east-c"
    cd /
    rm -rf "$tmpdir"
else
    log_warn "east-c or cmake not found, skipping east-c update"
fi

# Show versions
echo ""
log_info "Current versions:"
echo ""

if command -v east-node &> /dev/null; then
    echo "  east-node: $(east-node --version 2>/dev/null || echo 'unknown')"
fi

if command -v e3 &> /dev/null; then
    echo "  e3: $(e3 --version 2>/dev/null || echo 'unknown')"
fi

if command -v east-py &> /dev/null; then
    echo "  east-py: $(east-py --version 2>/dev/null || echo 'unknown')"
fi

if command -v east-c &> /dev/null; then
    echo "  east-c: $(east-c version 2>/dev/null || echo 'unknown')"
fi

echo ""
log_success "Update complete!"
