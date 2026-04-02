#!/usr/bin/env bash
set -euo pipefail

# Build and publish all @elaraai packages to local Verdaccio registry
# in dependency order, then install from it in downstream repos.
#
# Dependency order:
#   1. east                (base — no @elaraai deps)
#   2. east-node           (depends on east)
#   3. east-c              (east-c-wasm depends on east)
#   4. east-py             (datascience depends on east, east-node-std)
#   5. e3                  (depends on east, east-node-std)
#   6. east-ui             (depends on east, east-node-std, e3-*)
#   7. e3-cloud            (depends on e3-api-client, e3-api-server, e3-api-tests)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE_DIR="$(dirname "$SCRIPT_DIR")"
EAST_ROOT="$(dirname "$WORKSPACE_DIR")"
REGISTRY="http://localhost:4873"

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[local]${NC} $*"; }
error() { echo -e "${RED}[local]${NC} $*" >&2; }

# Check Verdaccio is running
if ! curl -s "$REGISTRY" >/dev/null 2>&1; then
    error "Verdaccio is not running. Start it with: make registry-up"
    exit 1
fi

# Publish a package to local Verdaccio
local_publish() {
    local pkg_dir="$1"
    local pkg_name
    pkg_name=$(node -p "require('${pkg_dir}/package.json').name")
    local pkg_version
    pkg_version=$(node -p "require('${pkg_dir}/package.json').version")

    info "Publishing ${pkg_name}@${pkg_version}"
    cd "$pkg_dir"

    # Unpublish first if it exists (ignore errors)
    npm unpublish "${pkg_name}@${pkg_version}" --registry "$REGISTRY" 2>/dev/null || true
    npm publish --registry "$REGISTRY" --tag local --no-git-tag-version 2>&1 | grep -v "npm warn" || true
}

# Add .npmrc to a repo so make install resolves @elaraai/* from Verdaccio
inject_npmrc() {
    local repo_dir="$1"
    echo "@elaraai:registry=${REGISTRY}" > "$repo_dir/.npmrc"
    info "  .npmrc → $(basename "$repo_dir")"
}

# ── Phase 1: east ──────────────────────────────────────────────
info "═══ Phase 1: east ═══"
cd "$EAST_ROOT/east"
make install
make build
local_publish "$EAST_ROOT/east"

# ── Phase 2: east-node ─────────────────────────────────────────
info "═══ Phase 2: east-node ═══"
cd "$EAST_ROOT/east-node"
inject_npmrc "$EAST_ROOT/east-node"
make install
make build
local_publish "$EAST_ROOT/east-node/packages/east-node-std"
local_publish "$EAST_ROOT/east-node/packages/east-node-io"
local_publish "$EAST_ROOT/east-node/packages/east-node-cli"

# ── Phase 3: east-c ───────────────────────────────────────────
info "═══ Phase 3: east-c ═══"
inject_npmrc "$EAST_ROOT/east-c/packages/east-c-wasm"
cd "$EAST_ROOT/east-c/packages/east-c-wasm"
npm install
npm run build
local_publish "$EAST_ROOT/east-c/packages/east-c-wasm"

# ── Phase 4: east-py ──────────────────────────────────────────
info "═══ Phase 4: east-py ═══"
cd "$EAST_ROOT/east-py"
inject_npmrc "$EAST_ROOT/east-py/packages/east-py-datascience"
make install
make build
local_publish "$EAST_ROOT/east-py/packages/east-py-datascience"

# ── Phase 5: e3 ───────────────────────────────────────────────
info "═══ Phase 5: e3 ═══"
cd "$EAST_ROOT/e3"
inject_npmrc "$EAST_ROOT/e3"
make install
make build
local_publish "$EAST_ROOT/e3/packages/e3-types"
local_publish "$EAST_ROOT/e3/packages/e3"
local_publish "$EAST_ROOT/e3/packages/e3-core"
local_publish "$EAST_ROOT/e3/packages/e3-api-client"
local_publish "$EAST_ROOT/e3/packages/e3-cli"
local_publish "$EAST_ROOT/e3/packages/e3-api-server"

# ── Phase 6: east-ui ──────────────────────────────────────────
info "═══ Phase 6: east-ui ═══"
cd "$EAST_ROOT/east-ui"
inject_npmrc "$EAST_ROOT/east-ui"
make install
make build

# ── Phase 7: e3-cloud ────────────────────────────────────────
info "═══ Phase 7: e3-cloud ═══"
cd "$EAST_ROOT/east-aws"
inject_npmrc "$EAST_ROOT/east-aws"
make install
make build

info "═══ All packages published to local registry ═══"
