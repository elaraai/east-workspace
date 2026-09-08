#!/bin/sh
# A stand-in `east-py` for the python launcher tests. Two personalities, chosen
# by FAKE_EAST_PY_MODE:
#   lsp-ok    `lsp` runs the stand-in LSP server (fake-east-py-lsp.py); `lint` answers with findings
#   lsp-dead  `lsp` says what the real one says without pygls and exits 1; `lint` still answers
# `lint` prints the findings JSON beside this script and exits 1, as the real
# `east-py lint --format json` does when there are findings.
here="$(dirname "$0")"
case "$1" in
  lsp)
    if [ "${FAKE_EAST_PY_MODE:-lsp-ok}" = "lsp-dead" ]; then
      echo "east-py lsp needs pygls — install it with \`pip install pygls\`" >&2
      exit 1
    fi
    exec python3 "$here/fake-east-py-lsp.py"
    ;;
  lint)
    cat "$here/fake-findings.json"
    exit 1
    ;;
  *)
    echo "fake east-py: unknown command $1" >&2
    exit 2
    ;;
esac
