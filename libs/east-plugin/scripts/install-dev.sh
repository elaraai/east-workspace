#!/usr/bin/env bash
# East Development Environment Setup (monorepo)
# Usage: curl -fsSL https://raw.githubusercontent.com/elaraai/east-workspace/main/libs/east-claude-plugin/scripts/install-dev.sh | bash
#        curl -fsSL ... | bash -s -- -y   # Non-interactive mode
#
# Options:
#   -y, --yes    Assume yes to all prompts (non-interactive mode)
#
# Clones the east-workspace monorepo and builds + links all CLIs from source.
# (The pre-monorepo version cloned six separate repos; pnpm now handles the
# dependency-ordered build, so this is a single clone + three make targets.)

set -e

AUTO_YES=false
for arg in "$@"; do
    case $arg in
        -y|--yes) AUTO_YES=true ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
if [ -f "$SCRIPT_DIR/lib/common.sh" ]; then
    source "$SCRIPT_DIR/lib/common.sh"
else
    # Fallback for curl | bash
    RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
    log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
    log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
    log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
    log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
    confirm() {
        if [ "${AUTO_YES:-false}" = true ]; then return 0; fi
        read -p "$1 [y/N] " -n 1 -r < /dev/tty; echo
        case "$REPLY" in [Yy]) return 0 ;; *) return 1 ;; esac
    }
fi

WORKSPACE_DIR="${EAST_WORKSPACE_DIR:-$HOME/east-workspace}"
REPO_URL="https://github.com/elaraai/east-workspace.git"

echo ""
echo "=========================================="
echo "  East Workspace Development Setup"
echo "=========================================="
echo ""
echo "This will:"
echo "  - Clone east-workspace to $WORKSPACE_DIR"
echo "  - make install   (pnpm + uv + cmake)"
echo "  - make build     (all packages, dependency-ordered)"
echo "  - make link      (e3, east-node, east-py, east-c CLIs + tab completion)"
echo ""
echo "Required tools: git, make, node>=22, pnpm, uv, cmake, gcc"
echo "(make install will check and report anything missing.)"
echo ""

if ! confirm "Continue?"; then
    echo "Aborted."
    exit 0
fi

if [ -d "$WORKSPACE_DIR/.git" ]; then
    log_info "Workspace already present at $WORKSPACE_DIR — pulling latest"
    git -C "$WORKSPACE_DIR" pull --ff-only
else
    log_info "Cloning east-workspace to $WORKSPACE_DIR"
    git clone "$REPO_URL" "$WORKSPACE_DIR"
fi

cd "$WORKSPACE_DIR"

log_info "make install"
make install

log_info "make build"
make build

log_info "make link"
make link

echo ""
echo "=========================================="
echo "  Setup Complete!"
echo "=========================================="
echo ""
echo "Workspace: $WORKSPACE_DIR"
echo ""
echo "CLIs linked globally: e3, east-node, east-py, east-c"
echo "Tab completion: e3 completion install"
echo ""
echo "Develop:"
echo "  cd $WORKSPACE_DIR"
echo "  make build   # rebuild after changes"
echo "  make test    # run tests"
echo ""
