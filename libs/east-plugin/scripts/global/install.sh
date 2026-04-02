#!/usr/bin/env bash
# East CLI Installation Script
# Usage: curl -fsSL https://raw.githubusercontent.com/elaraai/east-plugin/main/scripts/global/install.sh | bash
#        curl -fsSL ... | bash -s -- -y   # Non-interactive mode
#
# Options:
#   -y, --yes    Assume yes to all prompts (non-interactive mode)
#
# This script installs the East CLIs for local use without cloning source repositories.
# For development/contributing, use install-dev.sh instead.

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

NODE_VERSION="22"

echo ""
echo "=========================================="
echo "  East CLI Installation"
echo "=========================================="
echo ""
echo "This will install:"
echo "  - nvm (Node Version Manager)"
echo "  - Node.js $NODE_VERSION"
echo "  - @elaraai/east-node-cli (East Node.js CLI)"
echo "  - @elaraai/e3-cli (East Execution Engine CLI)"
echo "  - uv (Python package manager)"
echo "  - east-py (East Python CLI)"
echo "  - east-c (East C CLI, built from source)"
echo ""

if ! confirm "Continue?"; then
    echo "Aborted."
    exit 0
fi

# Install nvm if not present
install_nvm() {
    if [ -s "$HOME/.nvm/nvm.sh" ]; then
        log_success "nvm already installed"
        return 0
    fi

    log_info "Installing nvm..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

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

# Install Node.js
install_node() {
    source_nvm

    if ! command -v nvm &> /dev/null; then
        log_error "nvm not found after installation"
        exit 1
    fi

    log_info "Installing Node.js $NODE_VERSION..."
    nvm install "$NODE_VERSION"
    nvm use "$NODE_VERSION"
    nvm alias default "$NODE_VERSION"
    log_success "Node.js $(node --version) installed and set as default"
}

# Install Node.js CLIs
install_node_clis() {
    source_nvm

    log_info "Installing @elaraai/east-node-cli@beta..."
    npm install -g @elaraai/east-node-cli@beta
    log_success "east-node CLI installed"

    log_info "Installing @elaraai/e3-cli@beta..."
    npm install -g @elaraai/e3-cli@beta
    log_success "e3-cli installed"
}

# Install Python CLI
install_python_cli() {
    if ! command -v uv &> /dev/null; then
        log_error "uv not found"
        return 1
    fi

    log_info "Installing east-py CLI..."

    # Install east-py-cli from the monorepo subdirectory
    uv tool install east-py-cli --from "git+https://github.com/elaraai/east-py.git#subdirectory=packages/east-py-cli"

    log_success "east-py CLI installed"
}

# Install east-c CLI (built from source)
install_east_c() {
    log_info "Installing east-c CLI (building from source)..."

    local tmpdir
    tmpdir=$(mktemp -d)

    git clone --depth 1 https://github.com/elaraai/east-c.git "$tmpdir/east-c"
    cd "$tmpdir/east-c"
    make build
    make install-cli

    cd /
    rm -rf "$tmpdir"

    log_success "east-c CLI installed"
}

# Verify installation
verify_installation() {
    echo ""
    log_info "Verifying installation..."

    local all_good=true

    source_nvm

    if command -v east-node &> /dev/null; then
        log_success "east-node: $(east-node --version 2>/dev/null || echo 'installed')"
    else
        log_warn "east-node not found in PATH"
        all_good=false
    fi

    if command -v e3 &> /dev/null; then
        log_success "e3: $(e3 --version 2>/dev/null || echo 'installed')"
    else
        log_warn "e3 not found in PATH"
        all_good=false
    fi

    if command -v east-py &> /dev/null; then
        log_success "east-py: $(east-py --version 2>/dev/null || echo 'installed')"
    else
        log_warn "east-py not found in PATH"
        all_good=false
    fi

    if command -v east-c &> /dev/null; then
        log_success "east-c: $(east-c version 2>/dev/null || echo 'installed')"
    else
        log_warn "east-c not found in PATH"
        all_good=false
    fi

    if [ "$all_good" = true ]; then
        return 0
    else
        return 1
    fi
}

# Print shell configuration instructions
print_shell_config() {
    echo ""
    echo "=========================================="
    echo "  Installation Complete!"
    echo "=========================================="
    echo ""
    echo "Add the following to your shell profile (~/.bashrc, ~/.zshrc, etc.):"
    echo ""
    echo '  # nvm'
    echo '  export NVM_DIR="$HOME/.nvm"'
    echo '  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"'
    echo ""
    echo '  # uv'
    echo '  export PATH="$HOME/.local/bin:$PATH"'
    echo ""
    echo "Then restart your shell or run:"
    echo '  source ~/.bashrc  # or ~/.zshrc'
    echo ""
    echo "Available commands:"
    echo "  east-node --help   East Node.js CLI"
    echo "  east-c --help      East C CLI"
    echo "  e3 --help          East Execution Engine"
    echo "  east-py --help     East Python CLI"
    echo ""
    echo "Quick start:"
    echo "  mkdir my-project && cd my-project"
    echo "  e3 init"
    echo "  e3 start"
    echo ""
    echo "Documentation: https://github.com/elaraai/east-plugin"
    echo ""
}

# Alternative: Docker installation
print_docker_alternative() {
    echo ""
    echo "=========================================="
    echo "  Alternative: Docker Installation"
    echo "=========================================="
    echo ""
    echo "If you prefer Docker, you can use our pre-built images:"
    echo ""
    echo "  docker pull ghcr.io/elaraai/e3"
    echo "  docker run --rm -v \$(pwd):/workspace ghcr.io/elaraai/e3 e3 --help"
    echo ""
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

    if ! command -v cmake &> /dev/null; then
        missing+=("cmake")
    fi

    if ! command -v gcc &> /dev/null; then
        missing+=("gcc")
    fi

    if [ ${#missing[@]} -eq 0 ]; then
        log_success "All required dependencies found (curl, git, cmake, gcc)"
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

    # Install nvm and Node.js
    install_nvm
    install_node

    # Install Node.js CLIs
    install_node_clis

    # Install uv and Python CLI
    install_uv
    install_python_cli || log_warn "Python CLI installation failed (optional)"

    # Install east-c CLI (built from source)
    install_east_c || log_warn "east-c CLI installation failed (optional)"

    # Verify and print instructions
    if verify_installation; then
        print_shell_config
    else
        log_warn "Some tools may not be in PATH until you restart your shell"
        print_shell_config
        print_docker_alternative
    fi
}

main "$@"
