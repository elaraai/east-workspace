#!/usr/bin/env bash
set -euo pipefail

# Install pre-commit hooks into all repos listed in the workspace file.
# Reads repo paths from east.code-workspace so we don't hardcode them.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE_DIR="$(dirname "$SCRIPT_DIR")"
HOOK_SOURCE="$SCRIPT_DIR/pre-commit-check.sh"
WORKSPACE_FILE="$WORKSPACE_DIR/east.code-workspace"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { echo -e "${GREEN}[hooks]${NC} $*"; }
warn() { echo -e "${YELLOW}[hooks]${NC} $*"; }

# Extract folder paths from workspace file (skip "." which is this repo)
repo_paths=$(node -e "
    const fs = require('fs');
    const raw = fs.readFileSync('$WORKSPACE_FILE', 'utf8');
    // Strip comments and trailing commas for JSON compatibility
    const clean = raw.replace(/\/\/.*$/gm, '').replace(/,\s*([\]}])/g, '\$1');
    const ws = JSON.parse(clean);
    ws.folders
        .map(f => f.path)
        .filter(p => p !== '.')
        .forEach(p => console.log(p));
")

for rel_path in $repo_paths; do
    repo_dir="$(cd "$WORKSPACE_DIR" && cd "$rel_path" 2>/dev/null && pwd)" || continue
    hooks_dir="$repo_dir/.git/hooks"

    if [ ! -d "$repo_dir/.git" ]; then
        warn "Skipping $(basename "$repo_dir") — not a git repo"
        continue
    fi

    mkdir -p "$hooks_dir"

    if [ -f "$hooks_dir/pre-commit" ] && [ ! -L "$hooks_dir/pre-commit" ]; then
        warn "$(basename "$repo_dir") already has a pre-commit hook, skipping"
        continue
    fi

    ln -sf "$HOOK_SOURCE" "$hooks_dir/pre-commit"
    info "Installed pre-commit hook in $(basename "$repo_dir")"
done
