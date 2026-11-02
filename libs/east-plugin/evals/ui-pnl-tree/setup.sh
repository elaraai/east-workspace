#!/usr/bin/env bash
# The published @elaraai packages (1.0.100), installed once outside the run, and
# the checker that prints what the solution builds (see evals/README.md).
set -euo pipefail
# A scaffold sees none of the shell's EVAL_* variables, so the packages are
# found where evals/README.md prepares them.
test -e /tmp/east-evals/node/node_modules || { echo "/tmp/east-evals/node/node_modules is missing: see evals/README.md" >&2; exit 1; }
cp -al /tmp/east-evals/node/node_modules node_modules   # hard links: the run sees nothing outside its workspace
echo '{"name":"work","version":"1.0.0","type":"module"}' > package.json
echo '{"compilerOptions":{"jsx":"react-jsx","module":"esnext","moduleResolution":"bundler","target":"es2022","strict":true,"skipLibCheck":true}}' > tsconfig.json
cp /tmp/east-evals/node/check-ui.ts check.ts
