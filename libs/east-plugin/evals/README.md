# Plugin evals

Twenty tasks, five per skill (`east`, `east-py`, `e3`, `east-py-datascience`),
each asking an agent with the Claude plugin installed to write a program, run
it and show its result. A regex grader checks the trace for the expected
result; a second checks that the solution file exists. They measure whether a
change to the skills or the example index keeps agents accurate, and what a
task costs.

## Prepare

The cases run against the published packages, installed once outside the run.
Each case's `setup.sh` links them into its working folder from:

- `EVAL_NODE_ENV`: a folder whose `node_modules` holds `@elaraai/east`,
  `@elaraai/east-node-cli`, `@elaraai/east-node-std`, `@elaraai/e3`,
  `@elaraai/e3-cli`, `tsx` and `typescript`.
- `EVAL_PY_ENV`: a folder holding a Python 3.12 virtual environment at
  `pyvenv`, with `elaraai-east-py`, `elaraai-east-py-std` and
  `elaraai-east-py-datascience[xgboost,sklearn,scipy,google-or,simanneal]`.

Use a folder under `/tmp`: the run's sandbox hides your home directory.

Assemble the plugin the cases load (`make -C libs/east-plugin package`).

## Run

From `libs/east-plugin`:

```bash
EVAL_NODE_ENV=/tmp/east-evals/node EVAL_PY_ENV=/tmp/east-evals/py \
claude plugin eval . --eval-dir evals --trust-plugin --scaffold --ablation none \
  --runs 2 -j 2 --allow-real-servers --no-publish --threshold 0 --max-cost-usd 40 \
  --allow-tools Bash Write Edit "mcp__plugin_east_east__*" --json /tmp/east-evals/result.json
```

Results are written under `evals/results/`, which is not committed. A run
that fails with `apply-seccomp … Permission denied` never ran a command: the
sandbox could not start, and the run says nothing about the skills.
