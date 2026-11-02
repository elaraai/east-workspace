# Plugin evals

Thirty-one tasks, each asking an agent with the Claude plugin installed to
write a program, run it and show its result: five per skill for `east`,
`east-py`, `e3`, `east-py-datascience` and `east-ui`, and six for `e3-ui`. A
regex grader checks the trace for the expected result and a second that the
solution file exists; the UI cases add an `llm` grader that judges the
solution file against a rubric. They measure whether a change to the skills or
the example index keeps agents accurate, and what a task costs.

The UI cases cannot print a result of their own, so their `setup.sh` copies in
a checker the agent runs: `checks/check-ui.ts` prints the outline of the
component a `src/*.tsx` builds (each component with its scalar props, a
Table's columns and rows, a chart's scales and marks), and `checks/check-e3ui.ts`
prints what an e3 package declares, with each `ui()` task's manifest (the
datasets, records and paged sources it binds). Each case passes its graders
against a reference solution.

## Prepare

Every case grants Bash, which runs in Claude Code's OS sandbox: a run reads
its own workspace and the system, and nothing of your home directory or of
`/tmp` outside the workspace. On Linux that needs:

- `bubblewrap` and `socat`, and on Ubuntu 24.04 an AppArmor profile letting
  `/usr/bin/bwrap` create user namespaces (`userns,` under
  `profile bwrap /usr/bin/bwrap flags=(unconfined)` in `/etc/apparmor.d/bwrap`,
  loaded with `apparmor_parser -r`).
- Node 22 outside your home directory, such as the nodejs.org tarball unpacked
  into `/usr/local`: an nvm install under `~/.nvm` is unreadable to the run.
- No credential command the sandbox cannot resolve: a run is refused when, for
  one, an `~/.ssh/config` `ProxyCommand` calls the `aws` CLI through `$(…)`.

TypeScript runs as `node --import tsx` in the prompts, since the `tsx` CLI
opens an IPC socket the sandbox refuses.

The cases run against the published packages, installed once outside the run.
A scaffold sees none of the shell's environment but `PATH`, `HOME` and
`TMPDIR` (no `EVAL_*` variable reaches it), so each `setup.sh` copies them in,
as hard links, from fixed folders:

- `/tmp/east-evals/node`: a folder whose `node_modules` holds `@elaraai/east`,
  `@elaraai/east-node-cli`, `@elaraai/east-node-std`, `@elaraai/e3`,
  `@elaraai/e3-cli`, `@elaraai/east-ui`, `@elaraai/e3-ui`, `tsx` and
  `typescript`, with `checks/check-ui.ts` and `checks/check-e3ui.ts` copied beside
  it.
- `/tmp/east-evals/py`: a folder holding a Python 3.12 virtual environment at
  `pyvenv`, with `elaraai-east-py`, `elaraai-east-py-std` and
  `elaraai-east-py-datascience[xgboost,sklearn,scipy,google-or,simanneal]`.

The python cases still link their virtual environment from `/tmp`, which the
run cannot read, and wait on the same change.

```bash
mkdir -p /tmp/east-evals/node && cd /tmp/east-evals/node
echo '{"name":"eval-env","private":true,"type":"module"}' > package.json
npm install @elaraai/east @elaraai/east-node-cli @elaraai/east-node-std @elaraai/e3 \
  @elaraai/e3-cli @elaraai/east-ui @elaraai/e3-ui tsx typescript
cp <repo>/libs/east-plugin/evals/checks/check-*.ts .
```

Assemble the plugin the cases load (`make -C libs/east-plugin package`). It
must sit inside `libs/east-plugin` (`marketplace/east-claude-plugin`): the
runner loads no plugin from outside the folder it evaluates, through a symlink
neither.

## Run

From `libs/east-plugin`:

```bash
claude plugin eval . --eval-dir evals --trust-plugin --scaffold --ablation none \
  --runs 2 -j 4 --allow-real-servers --no-publish --threshold 0 --max-cost-usd 60 \
  --allow-tools Bash Write Edit "mcp__plugin_east_east__*" --json /tmp/east-evals/result.json
```

`--tag east-ui --tag e3-ui` (or any skill's tag) runs one skill's cases. To
compare two versions of the skills, run the same cases once against each
plugin and compare each case's score and the run's `costUsd`.

The regex graders are the measure of correctness. With the default judge
(haiku), every `rubric` miss in the first comparison was a correct solution,
so read the file it judged (`evidence` in the result JSON) before taking one
as a regression, or pass a stronger `--judge-model`.

Results are written under `evals/results/`, which is not committed. A run that
fails with `apply-seccomp … Permission denied` never ran a command: the
sandbox could not start, and the run says nothing about the skills. Neither
does one refused because a credentials file in the environment (an AWS or GCP
config, a kubeconfig, an Anthropic profile) runs a command the sandbox cannot
resolve: run the suite where no such file is configured, such as a container
or a CI runner.
