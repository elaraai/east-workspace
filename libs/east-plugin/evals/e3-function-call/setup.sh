#!/usr/bin/env bash
# The published @elaraai packages (1.0.99), installed once outside the run.
set -euo pipefail
# A scaffold sees none of the shell's EVAL_* variables, so the packages are
# found where evals/README.md prepares them.
test -e /tmp/east-evals/node/node_modules || { echo "/tmp/east-evals/node/node_modules is missing: see evals/README.md" >&2; exit 1; }
cp -al /tmp/east-evals/node/node_modules node_modules   # hard links: the run sees nothing outside its workspace
echo '{"name":"work","version":"1.0.0","type":"module"}' > package.json
