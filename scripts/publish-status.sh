#!/usr/bin/env bash
set -euo pipefail

# Show the status of all @elaraai packages across workspace repos,
# including whether their @elaraai/* dependencies resolve to the
# local Verdaccio registry or the public npm registry.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE_DIR="$(dirname "$SCRIPT_DIR")"
EAST_ROOT="$(dirname "$WORKSPACE_DIR")"
REGISTRY="http://localhost:4873"
WORKSPACE_FILE="$WORKSPACE_DIR/east.code-workspace"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ── Check Verdaccio ──────────────────────────────────────────────

echo -e "${BOLD}Verdaccio Registry Status${NC}"
echo "─────────────────────────"

VERDACCIO_UP=false
VERDACCIO_PACKAGES=0

if curl -sf "$REGISTRY" >/dev/null 2>&1; then
    VERDACCIO_UP=true
    # Query Verdaccio for all @elaraai packages
    VERDACCIO_PACKAGES=$(curl -sf "$REGISTRY/-/v1/search?text=@elaraai&size=250" \
        | node -e "
            const chunks = [];
            process.stdin.on('data', c => chunks.push(c));
            process.stdin.on('end', () => {
                try {
                    const data = JSON.parse(Buffer.concat(chunks).toString());
                    const pkgs = (data.objects || []).map(o => o.package.name);
                    console.log(pkgs.length);
                    pkgs.sort().forEach(p => console.log(p));
                } catch(e) {
                    console.log('0');
                }
            });
        " 2>/dev/null) || VERDACCIO_PACKAGES="0"
    VERDACCIO_PKG_COUNT=$(echo "$VERDACCIO_PACKAGES" | head -1)
    VERDACCIO_PKG_LIST=$(echo "$VERDACCIO_PACKAGES" | tail -n +2)
    echo -e "  Registry: ${GREEN}UP${NC} ($REGISTRY)"
    echo -e "  Published @elaraai packages: ${GREEN}${VERDACCIO_PKG_COUNT}${NC}"
    if [ "$VERDACCIO_PKG_COUNT" -gt 0 ] 2>/dev/null; then
        echo "$VERDACCIO_PKG_LIST" | while read -r pkg; do
            [ -n "$pkg" ] && echo -e "    ${DIM}${pkg}${NC}"
        done
    fi
else
    VERDACCIO_PKG_COUNT=0
    VERDACCIO_PKG_LIST=""
    echo -e "  Registry: ${RED}DOWN${NC} ($REGISTRY)"
    echo -e "  ${DIM}Start with: make registry-up${NC}"
fi

echo ""
echo -e "${BOLD}Package Status${NC}"
echo "══════════════"

# ── Discover repos from workspace file ───────────────────────────

# Extract folder paths from workspace file, skip "east-workspace" (this repo)
REPOS=$(node -e "
    const fs = require('fs');
    const text = fs.readFileSync('$WORKSPACE_FILE', 'utf8');
    // Strip comments and trailing commas for JSON5/jsonc compat
    const clean = text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/,\s*([\]}])/g, '\$1');
    const ws = JSON.parse(clean);
    ws.folders.forEach(f => {
        if (f.path === '.') return;
        const dir = f.path.replace(/^\.\.\/?/, '');
        console.log(f.name + '|' + dir);
    });
")

# ── Helper: check if a dep resolves to Verdaccio ────────────────

# Check _resolved field in installed package, or .npmrc presence
check_dep_resolution() {
    local repo_dir="$1"
    local dep_name="$2"
    # Strip @elaraai/ scope for filesystem path
    local dep_short="${dep_name#@elaraai/}"

    # Look for _resolved in the installed package.json
    # In npm workspaces the node_modules may be at repo root
    local resolved=""

    # Try repo-level node_modules first, then pkg-level
    for search_dir in "$repo_dir" "$3"; do
        local installed="$search_dir/node_modules/$dep_name/package.json"
        if [ -f "$installed" ]; then
            resolved=$(node -e "
                try {
                    const p = require('$installed');
                    console.log(p._resolved || '');
                } catch(e) { console.log(''); }
            " 2>/dev/null) || resolved=""
            if [ -n "$resolved" ]; then
                break
            fi
        fi
    done

    if [ -z "$resolved" ]; then
        echo "missing"
    elif echo "$resolved" | grep -q "localhost:4873"; then
        echo "local"
    else
        echo "npm"
    fi
}

# Get installed version of a dep
get_installed_version() {
    local repo_dir="$1"
    local dep_name="$2"
    local pkg_dir="$3"

    for search_dir in "$repo_dir" "$pkg_dir"; do
        local installed="$search_dir/node_modules/$dep_name/package.json"
        if [ -f "$installed" ]; then
            node -e "
                try {
                    const p = require('$installed');
                    console.log(p.version || 'unknown');
                } catch(e) { console.log('unknown'); }
            " 2>/dev/null && return
        fi
    done
    echo "not installed"
}

# ── Process each repo ────────────────────────────────────────────

while IFS='|' read -r repo_name repo_dir; do
    repo_path="$EAST_ROOT/$repo_dir"

    if [ ! -d "$repo_path" ]; then
        echo ""
        echo -e "${BOLD}${repo_dir}/${NC} ${DIM}(not found)${NC}"
        continue
    fi

    # Find all package.json files (not in node_modules, not in dist, max depth 3)
    pkg_files=$(find "$repo_path" -maxdepth 3 -name package.json \
        -not -path "*/node_modules/*" \
        -not -path "*/dist/*" \
        -not -path "*/.yalc/*" \
        -not -path "*/build/*" \
        2>/dev/null | sort) || true

    if [ -z "$pkg_files" ]; then
        continue
    fi

    # Check for .npmrc in repo root
    has_npmrc=false
    npmrc_target=""
    if [ -f "$repo_path/.npmrc" ]; then
        has_npmrc=true
        npmrc_target=$(grep -o 'registry=.*' "$repo_path/.npmrc" 2>/dev/null | head -1) || true
    fi

    echo ""
    echo -e "${BOLD}${repo_dir}/${NC}"
    if $has_npmrc; then
        if echo "$npmrc_target" | grep -q "localhost:4873"; then
            echo -e "  ${DIM}.npmrc → ${GREEN}Verdaccio${NC}"
        else
            echo -e "  ${DIM}.npmrc → ${npmrc_target}${NC}"
        fi
    fi

    while IFS= read -r pkg_file; do
        [ -z "$pkg_file" ] && continue
        pkg_dir_path="$(dirname "$pkg_file")"

        # Get package info
        pkg_info=$(node -e "
            const p = require('$pkg_file');
            const name = p.name || '';
            const version = p.version || '0.0.0';
            // Collect all @elaraai deps from all dep types
            const deps = {};
            for (const key of ['dependencies', 'devDependencies', 'peerDependencies']) {
                if (p[key]) {
                    for (const [n, v] of Object.entries(p[key])) {
                        if (n.startsWith('@elaraai/')) {
                            deps[n] = { version: v, type: key.replace('Dependencies', '').replace('ependencies', '') };
                        }
                    }
                }
            }
            console.log(JSON.stringify({ name, version, deps }));
        " 2>/dev/null) || continue

        pkg_name=$(echo "$pkg_info" | node -e "process.stdin.on('data',d=>{console.log(JSON.parse(d).name)})")
        pkg_version=$(echo "$pkg_info" | node -e "process.stdin.on('data',d=>{console.log(JSON.parse(d).version)})")

        # Skip non-@elaraai packages and the root package.json of workspaces if it's private with no name
        if [ -z "$pkg_name" ]; then
            continue
        fi

        # Only show @elaraai packages or packages that have @elaraai deps
        dep_entries=$(echo "$pkg_info" | node -e "
            process.stdin.on('data', d => {
                const deps = JSON.parse(d).deps;
                const entries = Object.entries(deps);
                entries.sort((a,b) => a[0].localeCompare(b[0]));
                entries.forEach(([name, info]) => {
                    console.log(name + '|' + info.version + '|' + info.type);
                });
            });
        ")

        is_elaraai=false
        if echo "$pkg_name" | grep -q "^@elaraai/"; then
            is_elaraai=true
        fi

        # Skip packages that are not @elaraai and have no @elaraai deps
        if ! $is_elaraai && [ -z "$dep_entries" ]; then
            continue
        fi

        # Print package header
        if $is_elaraai; then
            echo -e "  ${CYAN}${pkg_name}${NC}@${pkg_version}"
        else
            echo -e "  ${pkg_name}@${pkg_version}"
        fi

        if [ -z "$dep_entries" ]; then
            echo -e "    ${DIM}(no @elaraai deps)${NC}"
        else
            while IFS='|' read -r dep_name dep_spec dep_type; do
                [ -z "$dep_name" ] && continue

                resolution=$(check_dep_resolution "$repo_path" "$dep_name" "$pkg_dir_path")
                installed_ver=$(get_installed_version "$repo_path" "$dep_name" "$pkg_dir_path")

                type_label=""
                if [ "$dep_type" = "dev" ]; then
                    type_label=" ${DIM}[dev]${NC}"
                elif [ "$dep_type" = "peer" ] || [ "$dep_type" = "peerD" ]; then
                    type_label=" ${DIM}[peer]${NC}"
                fi

                case "$resolution" in
                    local)
                        echo -e "    \xE2\x9C\x93 ${dep_name} \xe2\x86\x92 ${installed_ver} ${GREEN}(local)${NC}${type_label}"
                        ;;
                    npm)
                        echo -e "    \xE2\x9C\x97 ${dep_name} \xe2\x86\x92 ${installed_ver} ${RED}(npm)${NC}${type_label}"
                        ;;
                    missing)
                        echo -e "    \xE2\x9C\x97 ${dep_name} ${RED}(not installed)${NC}${type_label}"
                        ;;
                esac
            done <<< "$dep_entries"
        fi

    done <<< "$pkg_files"

done <<< "$REPOS"

echo ""
