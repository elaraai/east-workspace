#!/usr/bin/env bash
# The published @elaraai packages (1.0.99), installed once outside the run.
set -euo pipefail
ln -s "${EVAL_NODE_ENV:?set EVAL_NODE_ENV: see evals/README.md}/node_modules" node_modules
echo '{"name":"work","version":"1.0.0","type":"module"}' > package.json
