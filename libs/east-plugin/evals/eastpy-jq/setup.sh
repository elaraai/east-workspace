#!/usr/bin/env bash
# The published elaraai-east-py packages (1.0.99), installed once outside the run.
set -euo pipefail
# A scaffold sees none of the shell's EVAL_* variables, so the packages are
# found where evals/README.md prepares them.
test -e /tmp/east-evals/py/pyvenv || { echo "/tmp/east-evals/py/pyvenv is missing: see evals/README.md" >&2; exit 1; }
ln -s /tmp/east-evals/py/pyvenv .venv
