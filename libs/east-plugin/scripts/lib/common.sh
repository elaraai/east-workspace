#!/usr/bin/env bash
# Shared utilities for East scripts
# Source this file: source "$(dirname "$0")/../lib/common.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1"; }

confirm() {
    if [ "${AUTO_YES:-false}" = true ]; then return 0; fi
    # Read from /dev/tty to work with curl | bash (stdin is the script)
    read -p "$1 [y/N] " -n 1 -r < /dev/tty
    echo
    # Use case instead of [[ =~ ]] for better compatibility
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

has_command() { command -v "$1" &> /dev/null; }
