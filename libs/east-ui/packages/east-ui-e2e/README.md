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
ask for. The presses are a record made as the package is exported, the
canvas's rows, narrowed by the rail: by hall, status and when each was last
serviced, model, colour units, perfecting and shift, a search of their names,
and two presets. The jobs are a record seeded from a generated file and read
only through its indexes — an interval index, a flat series index by press
and week, a summary by press and month, and totals by day, week, month,
quarter and year.

## The plan-nested lab

Every series kind a Plan reads a cell at a time, over as many works as you
ask for and five years: each works holds its jobs, alarms, load, crews and a
tree of parts, some 1,600 items, read through the record's nested series
index. A section a kind — the load as a line chart, the jobs as runs with the
alarms as decisions, the load as a heat strip, the crews' hours as a table
with each crew a child row, the parts as a tree of child rows, the alarms as
marks, the jobs as chips and the alarms as tiles — each switched on and off
from the library's Series tab, and the works narrowed by site and status.

## Running them

```bash
cd libs/east-ui/packages/east-ui-e2e
make plan-scale JOBS=1000000 WS=jobs-1m    # generate, deploy, seed, run
make plan-scale JOBS=5000000 WS=jobs-5m
make plan-nested WORKS=1000 WS=nested-1k
make page                                   # build the page
make serve-api                              # e3's server on :3300 (leave running)
make serve-page                             # the page on :4300 (leave running)
```

Then open `http://<host>:4300/#jobs-1m`. The bar over the Plan lists every
workspace in the repository.

The repository, the generated files and the built page live under
`LAB_DIR` (`~/.cache/east-ui-e2e` unless given). A million jobs is a 31 MB
file, seeded in about 40 s; five million, 147 MB in about 80 s. A thousand
works, 1.6 million items, is a 13 MB file, seeded in about 110 s.

## Adding a lab

A lab is a directory holding an e3 package whose `ui()` task the page draws
(`?task=<name>`), and whatever generates its data. Give it a target in the
Makefile that deploys the package and fills its records.
