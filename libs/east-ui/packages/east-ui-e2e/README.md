# east-ui-e2e

e3-ui surfaces end to end over a real e3: a repository on disk, served by
e3's own server (`e3-api-server`), drawn by a page as an app draws a deployed
`ui()` task (`E3Provider`, `ReactiveDatasetProvider`, `UITaskPreview`). Every
read a surface makes is a request to the server, answered from files, so what
the harness measures is what a deployment does.

It is no part of the showcase or its GitHub Pages build. CI type-checks and
lints it; nothing here runs in CI.

## The plan-steps lab

One Plan over a print works far larger than the showcase's: 4,000 machines in
forty halls — in each, 70 presses, 20 crews and 10 bays — and as many steps of
work on them over five years (2022 to 2026) as you ask for. The halls are a
record made as the package is exported, the canvas's rows, each hall a group
with its machines beneath it drawn as what they are, narrowed by the rail by
name and site. The steps are one record of every kind of step, seeded from a
generated file, each a row keyed by a variant: a press's runs and the setups
before them, a crew's shifts, a bay's deliveries. A kind of event per kind of
step draws each its own way on the machines of its kind
(`Schedule.events.kinds`) — the runs as bars and the setups as marks on the
presses, the shifts as chips on the crews, the deliveries as tiles on the
bays — every kind read a cell at a time through the rail's one source of the
steps and its one series index, in time order under the hall. Nothing reads
the steps whole: the window and its count are their interval index's, the
shading zoomed out a machine's summary a month, and the horizon's bars the
record's totals.

## Running it

```bash
cd libs/east-ui/packages/east-ui-e2e
make plan-steps STEPS=5000000 WS=steps-5m    # generate, deploy, seed, run
make plan-steps STEPS=10000000 WS=steps-10m
make page                                     # build the page
make serve-api                                # e3's server on :3300 (leave running)
make serve-page                               # the page on :4300 (leave running)
```

Then open `http://<host>:4300/#steps-5m`. The bar over the Plan lists every
workspace in the repository.

The repository, the generated files and the built page live under
`LAB_DIR` (`~/.cache/east-ui-e2e` unless given). Five million steps is a
94 MB file, a workspace of them made in under three minutes; ten million,
twice that.

## Adding a lab

A lab is a directory holding an e3 package whose `ui()` task the page draws
(`?task=<name>`), and whatever generates its data. Give it a target in the
Makefile that deploys the package and fills its records.
