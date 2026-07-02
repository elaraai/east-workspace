#!/usr/bin/env bash
# East monorepo — Ubuntu / WSL developer environment bootstrap.
#
# Installs the full toolchain (make, Node, pnpm) and the workspace deps so
# `make build` / `make test` work from a clean machine. Run it once:
#
#     bash scripts/ubuntu-dev-env.sh
#
# Then open a new shell (or `source ~/.bashrc`) so nvm/Node are on PATH.
#
# Idempotent and guarded: each step is a no-op if its tool is already
# present, so it is safe to re-run. Ubuntu/Debian (apt) only.
set -euo pipefail

# --- Locate repo root (this script lives in <root>/scripts) ---------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Versions come from the repo so this never drifts from CI.
NODE_VERSION="$(cat "$REPO_ROOT/.nvmrc" 2>/dev/null | tr -d '[:space:]')"
NODE_VERSION="${NODE_VERSION:-22}"
# packageManager: "pnpm@10.8.1" -> pnpm@10.8.1
PNPM_SPEC="$(grep -oE '"packageManager"[[:space:]]*:[[:space:]]*"[^"]+"' "$REPO_ROOT/package.json" \
  | sed -E 's/.*"(pnpm@[^"]+)".*/\1/')"
PNPM_SPEC="${PNPM_SPEC:-pnpm@latest}"

log() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }

# --- Linux / apt only -----------------------------------------------------
if [ "$(uname -s)" != "Linux" ] || ! command -v apt-get >/dev/null 2>&1; then
  echo "This script targets Ubuntu/Debian (apt). For Windows use scripts/windows-dev-env.sh." >&2
  exit 1
fi

# --- 1. Build essentials (make, gcc) --------------------------------------
if command -v make >/dev/null 2>&1; then
  log "make already installed ($(make --version | head -1))"
else
  log "Installing build-essential (make, gcc) via apt — sudo required"
  sudo apt-get update
  sudo apt-get install -y build-essential curl
fi

# --- 2. nvm + Node --------------------------------------------------------
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  log "Installing nvm into $NVM_DIR"
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
fi
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"

if nvm ls "$NODE_VERSION" >/dev/null 2>&1; then
  log "Node $NODE_VERSION already installed"
else
  log "Installing Node $NODE_VERSION"
  nvm install "$NODE_VERSION"
fi
nvm use "$NODE_VERSION"
nvm alias default "$NODE_VERSION" >/dev/null 2>&1 || true

# --- 3. pnpm via corepack -------------------------------------------------
log "Enabling corepack and activating $PNPM_SPEC"
corepack enable
corepack prepare "$PNPM_SPEC" --activate

# --- 4. Workspace install -------------------------------------------------
log "Installing workspace dependencies (make install)"
make -C "$REPO_ROOT" install

# --- 5. Headless Chromium for `e3-ui shot` (showcase PNG capture) ----------
# The e3-ui CLI renders east-ui / e3-ui components to PNG via a headless
# Chromium. Install the chromium-headless-shell build (version-matched to the
# CLI's playwright-core, incl. the OS libraries it needs) so capture works out
# of the box. Idempotent — an already-present browser is skipped. Non-fatal:
# the CLI also finds a system Chrome/Chromium (never Ubuntu's snap shim), or
# set E3_UI_CHROMIUM_PATH; `e3-ui doctor` diagnoses a broken setup.
log "Installing headless Chromium for 'e3-ui shot' (showcase PNG capture)"
if PLAYWRIGHT_WITH_DEPS=1 make -C "$REPO_ROOT" setup-browser; then
  log "Chromium ready"
else
  echo "  ! Chromium install failed — diagnose with 'e3-ui doctor', or set E3_UI_CHROMIUM_PATH to a Chrome/Chromium binary." >&2
fi

log "Done. Open a new shell (or 'source ~/.bashrc'), then: cd libs/east-ui && make build-showcase"
