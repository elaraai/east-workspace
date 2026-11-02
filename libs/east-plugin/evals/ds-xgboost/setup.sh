#!/usr/bin/env bash
# The published elaraai-east-py packages (1.0.99), installed once outside the run.
set -euo pipefail
ln -s "${EVAL_PY_ENV:?set EVAL_PY_ENV: see evals/README.md}/pyvenv" .venv
