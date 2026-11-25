# east-ui-e2e

e3-ui surfaces end to end over a real e3: a repository on disk, served by
e3's own server (`e3-api-server`), drawn by a page as an app draws a deployed
`ui()` task (`E3Provider`, `ReactiveDatasetProvider`, `UITaskPreview`). Every
read a surface makes is a request to the server, answered from files, so what
the harness measures is what a deployment does.

It is no part of the showcase or its GitHub Pages build. CI type-checks and
lints it; nothing here runs in CI.

## The plan-scale lab

One Plan over a print works far larger than the showcase's: 4,000 presses in
forty halls, and as many jobs on them over five years (2022 to 2026) as you
ask for. The presses are a task's output, paged into the canvas's rows; the
jobs are a record seeded from a generated file and read only through its
indexes — an interval index, a flat series index by press and week, a summary
by press and month, and totals by day, week, month, quarter and year.

```bash
cd libs/east-ui/packages/east-ui-e2e
make plan-scale JOBS=1000000 WS=jobs-1m    # generate, deploy, seed, run
make plan-scale JOBS=5000000 WS=jobs-5m
make page                                   # build the page
make serve-api                              # e3's server on :3300 (leave running)
make serve-page                             # the page on :4300 (leave running)
```

Then open `http://<host>:4300/#jobs-1m`. The bar over the Plan lists every
workspace in the repository.

The repository, the generated files and the built page live under
`LAB_DIR` (`~/.cache/east-ui-e2e` unless given): a million jobs is a 31 MB
file and about 130 MB of repository.

## Adding a lab

A lab is a directory holding an e3 package whose `ui()` task the page draws
(`?task=<name>`), and whatever generates its data. Give it a target in the
Makefile that deploys the package and fills its records.
