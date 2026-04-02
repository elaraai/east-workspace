#!/usr/bin/env bash
set -euo pipefail

# Remove .npmrc files from all repos and reinstall from npm registry.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE_DIR="$(dirname "$SCRIPT_DIR")"
EAST_ROOT="$(dirname "$WORKSPACE_DIR")"
WORKSPACE_FILE="$WORKSPACE_DIR/east.code-workspace"

GREEN='\033[0;32m'
NC='\033[0m'
info() { echo -e "${GREEN}[local]${NC} $*"; }

# Get repo paths from workspace file
repo_paths=$(node -e "
    const fs = require('fs');
    const raw = fs.readFileSync('$WORKSPACE_FILE', 'utf8');
    const clean = raw.replace(/\/\/.*$/gm, '').replace(/,\s*([\]}])/g, '\$1');
    const ws = JSON.parse(clean);
    ws.folders.map(f => f.path).filter(p => p !== '.').forEach(p => console.log(p));
")

# Remove .npmrc files
for rel_path in $repo_paths; do
    repo_dir="$(cd "$WORKSPACE_DIR" && cd "$rel_path" 2>/dev/null && pwd)" || continue
    # Find and remove .npmrc files (root and sub-packages)
    find "$repo_dir" -name ".npmrc" -not -path "*/node_modules/*" -delete 2>/dev/null
done
info "Removed .npmrc files"

# Reinstall from npm registry
for rel_path in $repo_paths; do
    repo_dir="$(cd "$WORKSPACE_DIR" && cd "$rel_path" 2>/dev/null && pwd)" || continue
    if [ -f "$repo_dir/Makefile" ] && grep -q "^install:" "$repo_dir/Makefile"; then
        info "Reinstalling $(basename "$repo_dir")..."
        cd "$repo_dir" && make install
    fi
done

info "All repos restored to npm registry."
