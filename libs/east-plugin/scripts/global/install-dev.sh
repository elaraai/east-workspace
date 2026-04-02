#!/usr/bin/env bash
# East Development Environment Setup
# Usage: curl -fsSL https://raw.githubusercontent.com/elaraai/east-plugin/main/scripts/global/install-dev.sh | bash
#        curl -fsSL ... | bash -s -- -y   # Non-interactive mode
#
# Options:
#   -y, --yes    Assume yes to all prompts (non-interactive mode)
#
# This script sets up a complete local development environment for contributing
# to the East ecosystem. It clones all repositories and builds them from source.

set -e

# Parse arguments
AUTO_YES=false
for arg in "$@"; do
    case $arg in
        -y|--yes) AUTO_YES=true ;;
    esac
done

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
    confirm() {
        if [ "${AUTO_YES:-false}" = true ]; then return 0; fi
        read -p "$1 [y/N] " -n 1 -r < /dev/tty; echo
        case "$REPLY" in [Yy]) return 0 ;; *) return 1 ;; esac
    }
    run_as_root() {
        if [ "$(id -u)" -eq 0 ]; then "$@"
        elif command -v sudo &> /dev/null; then sudo "$@"
        else log_error "Need root but no sudo"; return 1; fi
    }
    source_nvm() {
        export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    }
fi

# Configuration
EAST_DIR="${EAST_DIR:-$HOME/east}"
REPOS=(east east-c east-node east-py east-ui e3)
NODE_VERSION="22"

echo ""
echo "=========================================="
echo "  East Development Environment Setup"
echo "=========================================="
echo ""
echo "This will:"
echo "  - Install nvm (Node Version Manager) if not present"
echo "  - Install uv (Python package manager) if not present"
echo "  - Clone all East repositories to $EAST_DIR"
echo "  - Build and test all repositories"
echo ""

if ! confirm "Continue?"; then
    echo "Aborted."
    exit 0
fi

# Create workspace directory
log_info "Creating workspace at $EAST_DIR"
mkdir -p "$EAST_DIR"
cd "$EAST_DIR"

# Install nvm if not present
install_nvm() {
    if [ -s "$HOME/.nvm/nvm.sh" ]; then
        log_success "nvm already installed"
        return 0
    fi

    log_info "Installing nvm..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

    # Source nvm for current session
    source_nvm

    log_success "nvm installed"
}

# Install uv if not present
install_uv() {
    if command -v uv &> /dev/null; then
        log_success "uv already installed"
        return 0
    fi

    log_info "Installing uv (Python package manager)..."
    curl -LsSf https://astral.sh/uv/install.sh | sh

    # Add to PATH for current session
    export PATH="$HOME/.local/bin:$PATH"

    log_success "uv installed"
}

# Clone a repository if not already present
clone_repo() {
    local repo=$1
    if [ -d "$repo" ]; then
        log_warn "$repo already exists, skipping clone"
    else
        log_info "Cloning $repo..."
        git clone "https://github.com/elaraai/$repo.git"
        log_success "Cloned $repo"
    fi
}

# Build a repository
build_repo() {
    local repo=$1
    log_info "Building $repo..."
    cd "$EAST_DIR/$repo"

    if [ -f "Makefile" ]; then
        make install
        make build
        log_success "Built $repo"
    else
        log_warn "No Makefile found in $repo"
    fi

    cd "$EAST_DIR"
}

# Test a repository
test_repo() {
    local repo=$1
    log_info "Testing $repo..."
    cd "$EAST_DIR/$repo"

    if [ -f "Makefile" ]; then
        if make test; then
            log_success "Tests passed for $repo"
        else
            log_warn "Tests failed for $repo (continuing anyway)"
        fi
    fi

    cd "$EAST_DIR"
}

# Check and install required dependencies
check_dependencies() {
    local missing=()

    if ! command -v curl &> /dev/null; then
        missing+=("curl")
    fi

    if ! command -v git &> /dev/null; then
        missing+=("git")
    fi

    if ! command -v make &> /dev/null; then
        missing+=("make")
    fi

    if ! command -v cmake &> /dev/null; then
        missing+=("cmake")
    fi

    if ! command -v gcc &> /dev/null; then
        missing+=("gcc")
    fi

    if [ ${#missing[@]} -eq 0 ]; then
        log_success "All required dependencies found (curl, git, make, cmake, gcc)"
        return 0
    fi

    log_warn "Missing dependencies: ${missing[*]}"
    echo ""

    # Detect package manager and offer to install
    if command -v apt-get &> /dev/null; then
        if confirm "Install missing dependencies using apt-get?"; then
            log_info "Installing ${missing[*]}..."
            run_as_root apt-get update -qq && run_as_root apt-get install -y "${missing[@]}" || {
                log_error "Failed to install dependencies"
                exit 1
            }
            log_success "Dependencies installed"
        else
            log_error "Cannot continue without: ${missing[*]}"
            exit 1
        fi
    elif command -v brew &> /dev/null; then
        if confirm "Install missing dependencies using brew?"; then
            log_info "Installing ${missing[*]}..."
            brew install "${missing[@]}" || {
                log_error "Failed to install dependencies"
                exit 1
            }
            log_success "Dependencies installed"
        else
            log_error "Cannot continue without: ${missing[*]}"
            exit 1
        fi
    else
        log_error "No supported package manager found (apt-get or brew)"
        echo ""
        echo "Please install manually: ${missing[*]}"
        exit 1
    fi
}

# Main installation
main() {
    # Check dependencies first
    check_dependencies

    # Install dependencies
    install_nvm
    source_nvm
    install_uv

    # Install Node.js
    log_info "Installing Node.js $NODE_VERSION..."
    nvm install "$NODE_VERSION"
    nvm use "$NODE_VERSION"
    log_success "Node.js $(node --version) installed"

    # Clone all repositories
    echo ""
    log_info "Cloning repositories..."
    for repo in "${REPOS[@]}"; do
        clone_repo "$repo"
    done

    # Build repositories in dependency order
    echo ""
    log_info "Building repositories..."

    # east first (no deps)
    build_repo "east"

    # east-c (no deps, C runtime)
    build_repo "east-c"

    # east-node depends on east
    build_repo "east-node"

    # east-py depends on east-node (for test IR)
    build_repo "east-py"

    # east-ui depends on east
    build_repo "east-ui"

    # e3 depends on east, east-node, east-py
    build_repo "e3"

    # Run tests
    echo ""
    log_info "Running tests..."
    for repo in "${REPOS[@]}"; do
        test_repo "$repo"
    done

    # Link CLIs for local development
    echo ""
    log_info "Linking CLIs for local development..."

    cd "$EAST_DIR/east-node"
    if make link-cli 2>/dev/null; then
        log_success "east-node CLI linked"
    fi

    cd "$EAST_DIR/e3"
    if make link 2>/dev/null; then
        log_success "e3 CLI linked"
    fi

    cd "$EAST_DIR/east-py"
    if make install-cli 2>/dev/null; then
        log_success "east-py CLI installed"
    fi

    cd "$EAST_DIR/east-c"
    if make install-cli 2>/dev/null; then
        log_success "east-c CLI installed"
    fi

    # Done
    echo ""
    echo "=========================================="
    echo "  Setup Complete!"
    echo "=========================================="
    echo ""
    echo "Repositories cloned to: $EAST_DIR"
    echo ""
    echo "Available commands:"
    echo "  east-node   - East Node.js CLI"
    echo "  east-c      - East C CLI"
    echo "  e3          - East Execution Engine CLI"
    echo "  east-py     - East Python CLI"
    echo ""
    echo "To start developing:"
    echo "  cd $EAST_DIR/<repo>"
    echo "  make build"
    echo "  make test"
    echo ""
    echo "Remember to source nvm in new shells:"
    echo "  source ~/.nvm/nvm.sh"
    echo ""
}

main "$@"
