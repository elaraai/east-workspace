#!/usr/bin/env bash
# Core package installation for East ecosystem
# Used by both Dockerfiles and local install scripts
#
# Environment variables for version pinning (optional, defaults to "latest"):
#   EAST_VERSION, EAST_NODE_STD_VERSION, EAST_NODE_IO_VERSION,
#   EAST_NODE_CLI_VERSION, EAST_UI_VERSION, E3_VERSION, etc.
#
# Flags (each selects one image's package set; default = the e3 everything image):
#   --node-only    Node.js packages only (east-node image: no Python, no east-c)
#   --py-only      Python packages minus datascience (east-py image: no Node
#                  East packages, no east-c; datascience is the
#                  east-py-datascience image's own FROM-layer)
#   --c-only       east-c binary only (east-c image)
#   --skip-verify  Skip verification step

set -e

# Parse arguments
INSTALL_NODE=true
INSTALL_PYTHON=true
INSTALL_DATASCIENCE=true
INSTALL_EAST_C=true
VERIFY=true

for arg in "$@"; do
    case $arg in
        # --node-only = the minimal AGPL east-node image: Node packages only,
        # no Python and no native east-c runtime.
        --node-only) INSTALL_PYTHON=false; INSTALL_DATASCIENCE=false; INSTALL_EAST_C=false ;;
        # --py-only = the slim BUSL east-py image: python runtime without the
        # multi-GB datascience stack (elaraai/east-workspace#299).
        --py-only) INSTALL_NODE=false; INSTALL_DATASCIENCE=false; INSTALL_EAST_C=false ;;
        # --c-only = the tiny BUSL east-c image: just the prebuilt evaluator.
        --c-only) INSTALL_NODE=false; INSTALL_PYTHON=false; INSTALL_DATASCIENCE=false ;;
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
# Native east-c (npm) + Python east-py (PyPI) — pinned to the lockstep release
# like the Node packages above, not built from `main` / installed unpinned.
EAST_C_CLI_VERSION="${EAST_C_CLI_VERSION:-latest}"
EAST_PY_VERSION="${EAST_PY_VERSION:-latest}"

echo "Installing East packages..."

if [ "$INSTALL_NODE" = true ]; then
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
fi

# Install native east-c from the published npm package (same artifact `npm
# create` projects use). The @elaraai/east-c-cli meta-package pulls the
# matching prebuilt binary via a per-platform optional dependency
# (east-c-cli-<platform>/east-c, which declares bin: east-c). npm doesn't link
# a transitive dep's bin onto PATH, so symlink it to /usr/local/bin/east-c.
# Skipped for --node-only (the minimal east-node image carries no east-c).
if [ "$INSTALL_EAST_C" = true ]; then
    echo "Installing east-c..."
    npm install -g "@elaraai/east-c-cli@${EAST_C_CLI_VERSION}"
    # The prebuilt binary lives in the per-platform optional dep
    # (@elaraai/east-c-cli-<arch>/east-c). npm nests it under east-c-cli for a
    # -g install but hoists it for a local install, and the <arch> suffix
    # varies — so locate it with `find` rather than a hardcoded path.
    EAST_C_BIN="$(find "$(npm root -g)" -type f -name east-c -path '*@elaraai/east-c-cli-*' 2>/dev/null | head -1)"
    if [ -z "$EAST_C_BIN" ]; then
        echo "east-c binary not found after installing @elaraai/east-c-cli@${EAST_C_CLI_VERSION}" >&2
        echo "Contents of $(npm root -g)/@elaraai:" >&2
        ls -la "$(npm root -g)/@elaraai/" >&2 || true
        exit 1
    fi
    chmod +x "$EAST_C_BIN"
    ln -sf "$EAST_C_BIN" /usr/local/bin/east-c
fi

# Deduplicate @elaraai packages to a SINGLE instance each.
#
# `npm install -g` nests a private copy of every shared @elaraai dependency
# (e.g. @elaraai/east, @elaraai/e3-types) under each package that depends on it,
# rather than hoisting to one. beast2's value/type tables dedup by CONSTRUCTOR
# IDENTITY, so two east/e3-types module instances make equal composite types
# compare unequal — on deploy the encoder mis-resolves a nested struct type onto
# an outer ref value and every `e3 workspace deploy` fails with
# "value is not iterable". pnpm hoists to one instance (dev works); npm -g does
# not. All @elaraai packages are the same lockstep version, so collapse every
# nested copy to a symlink to its top-level copy → exactly one instance of each.
NM="$(npm root -g)"
if [ -d "$NM/@elaraai" ]; then
echo "Deduplicating @elaraai packages under ${NM}..."
for top in "$NM"/@elaraai/*; do
    [ -d "$top" ] || continue
    canon="$(readlink -f "$top")"
    for nested in $(find "$NM" -type d -path "*/node_modules/@elaraai/$(basename "$top")" 2>/dev/null); do
        [ "$(readlink -f "$nested")" = "$canon" ] && continue
        rm -rf "$nested"
        ln -sfn "$canon" "$nested"
    done
done
fi

# Install Python packages if requested
if [ "$INSTALL_PYTHON" = true ]; then
    if command -v uv &> /dev/null; then
        echo "Installing Python packages..."
        # Pin numba/llvmlite for compatibility; pin east-py to the lockstep
        # release (==${EAST_PY_VERSION}) — unpinned installs pulled whatever
        # was newest on PyPI, drifting the runtime out of lockstep with the IR.
        # "latest" means no constraint (dev/local convenience).
        if [ "$EAST_PY_VERSION" = "latest" ]; then EAST_PY_PIN=""; else EAST_PY_PIN="==${EAST_PY_VERSION}"; fi
        uv pip install \
            "numba>=0.58.0" \
            "llvmlite>=0.41.0" \
            "elaraai-east-py${EAST_PY_PIN}" \
            "elaraai-east-py-std${EAST_PY_PIN}" \
            "elaraai-east-py-io[all]${EAST_PY_PIN}" \
            "elaraai-east-py-cli${EAST_PY_PIN}"
        # The datascience stack (torch, sklearn, pymc, …) is what makes an
        # image multi-GB — the slim east-py image skips it; the
        # east-py-datascience image adds it as its own FROM-layer.
        if [ "$INSTALL_DATASCIENCE" = true ]; then
            uv pip install "elaraai-east-py-datascience[all]${EAST_PY_PIN}"
        fi
    else
        echo "Warning: uv not found, skipping Python packages"
    fi
fi

# Verify installations
if [ "$VERIFY" = true ]; then
    echo "Verifying installations..."
    if [ "$INSTALL_NODE" = true ]; then
        npx @elaraai/east-node-cli --version || echo "east-node-cli installed"
        e3 --version || echo "e3-cli installed"
    fi
    if [ "$INSTALL_EAST_C" = true ]; then
        east-c --help >/dev/null 2>&1 && echo "east-c installed" || echo "east-c NOT installed"
    fi
    if [ "$INSTALL_PYTHON" = true ] && command -v python3 &> /dev/null; then
        python3 -c "import east; print('east-py installed')" || true
    fi
fi

echo "East packages installed successfully"
