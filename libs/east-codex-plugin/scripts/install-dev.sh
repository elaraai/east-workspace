#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
if [ -f "$SCRIPT_DIR/../../east-plugin/scripts/install-dev.sh" ]; then
  exec bash "$SCRIPT_DIR/../../east-plugin/scripts/install-dev.sh" "$@"
fi
curl -fsSL https://raw.githubusercontent.com/elaraai/east-workspace/main/libs/east-plugin/scripts/install-dev.sh | bash -s -- "$@"
