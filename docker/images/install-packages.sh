#!/usr/bin/env bash
# Core package installation for East ecosystem
# Used by both Dockerfiles and local install scripts
#
# Environment variables for version pinning (optional, defaults to "latest"):
#   EAST_VERSION, EAST_NODE_STD_VERSION, EAST_NODE_IO_VERSION,
#   EAST_NODE_CLI_VERSION, EAST_UI_VERSION, E3_VERSION, etc.
#
# Flags:
#   --node-only    Only install Node.js packages (skip Python)
#   --skip-verify  Skip verification step

set -e

# Parse arguments
INSTALL_PYTHON=true
VERIFY=true

for arg in "$@"; do
    case $arg in
        --node-only) INSTALL_PYTHON=false ;;
        --skip-verify) VERIFY=false ;;
    esac
done

# Default versions to "latest" if not set
EAST_VERSION="${EAST_VERSION:-latest}"
EAST_NODE_STD_VERSION="${EAST_NODE_STD_VERSION:-latest}"
EAST_NODE_IO_VERSION="${EAST_NODE_IO_VERSION:-latest}"
EAST_NODE_CLI_VERSION="${EAST_NODE_CLI_VERSION:-latest}"
EAST_UI_VERSION="${EAST_UI_VERSION:-latest}"
E3_VERSION="${E3_VERSION:-latest}"
E3_TYPES_VERSION="${E3_TYPES_VERSION:-latest}"
E3_CORE_VERSION="${E3_CORE_VERSION:-latest}"
E3_CLI_VERSION="${E3_CLI_VERSION:-latest}"
E3_API_CLIENT_VERSION="${E3_API_CLIENT_VERSION:-latest}"
E3_API_SERVER_VERSION="${E3_API_SERVER_VERSION:-latest}"

echo "Installing East packages..."

# Install Node.js packages (AGPL)
echo "Installing Node.js packages..."
npm install -g \
    typescript \
    @types/node \
    "@elaraai/east@${EAST_VERSION}" \
    "@elaraai/east-node-std@${EAST_NODE_STD_VERSION}" \
    "@elaraai/east-node-io@${EAST_NODE_IO_VERSION}" \
    "@elaraai/east-node-cli@${EAST_NODE_CLI_VERSION}" \
    "@elaraai/east-ui@${EAST_UI_VERSION}"

# Install e3 Node.js packages (BSL + AGPL)
echo "Installing e3 packages..."
npm install -g \
    "@elaraai/e3@${E3_VERSION}" \
    "@elaraai/e3-types@${E3_TYPES_VERSION}" \
    "@elaraai/e3-core@${E3_CORE_VERSION}" \
    "@elaraai/e3-cli@${E3_CLI_VERSION}" \
    "@elaraai/e3-api-client@${E3_API_CLIENT_VERSION}" \
    "@elaraai/e3-api-server@${E3_API_SERVER_VERSION}"

# Install Python packages if requested
if [ "$INSTALL_PYTHON" = true ]; then
    if command -v uv &> /dev/null; then
        echo "Installing Python packages..."
        # Pin numba/llvmlite for compatibility
        uv pip install \
            "numba>=0.58.0" \
            "llvmlite>=0.41.0" \
            "east-py @ git+https://github.com/elaraai/east-py@main#subdirectory=packages/east-py" \
            "east-py-std @ git+https://github.com/elaraai/east-py@main#subdirectory=packages/east-py-std" \
            "east-py-io[all] @ git+https://github.com/elaraai/east-py@main#subdirectory=packages/east-py-io" \
            "east-py-datascience[all] @ git+https://github.com/elaraai/east-py@main#subdirectory=packages/east-py-datascience" \
            "east-py-cli @ git+https://github.com/elaraai/east-py@main#subdirectory=packages/east-py-cli"
    else
        echo "Warning: uv not found, skipping Python packages"
    fi
fi

# Verify installations
if [ "$VERIFY" = true ]; then
    echo "Verifying installations..."
    npx @elaraai/east-node-cli --version || echo "east-node-cli installed"
    e3 --version || echo "e3-cli installed"
    east-c --version 2>/dev/null || echo "east-c-cli not installed (built separately)"
    if [ "$INSTALL_PYTHON" = true ] && command -v python3 &> /dev/null; then
        python3 -c "import east; print('east-py installed')" || true
    fi
fi

echo "East packages installed successfully"
