# __DISPLAY_NAME__

An e3 project (BSL-1.1) — typed East logic, durable dataflow execution.

East turns inputs and logic into **decisions**. This starter ships one: `reorder_qty`
in `src/index.ts` recommends how many units to reorder to bring stock (`on_hand`) up to
its target (`reorder_to`), never negative. Edit it, add inputs and tasks, and grow the
package from there.

## Setup

```bash
npm run setup     # install dependencies (npm install, plus `uv sync` if you kept the Python runner)
```

## Run

```bash
npm run start     # deploy from ./src/index.ts, then run the dataflow once
npm run watch     # re-deploy and re-run on every save
npm run deploy    # create the repo (if needed) and deploy without running
```

The package is the default export of `src/index.ts`; the e3 CLI deploys it straight from source.

## Test

```bash
npm run build     # compile TypeScript
npm run test      # build, export the IR, and run the tests
```

`npm run test` is present if you scaffolded with tests. With the Python (east-py) runner it also
runs the exported IR through the Python runtime; without it, tests run on Node only.

## Other

```bash
npm run lint      # lint sources
npm run clean     # remove build output, dependencies, and the local repo
```

If you scaffolded with UI, `src/ui/index.tsx` holds a decision surface — a `ui()` task an operator
uses to observe and act on the recommendation, registered in the package next to the decision.
Render it to a PNG with `npm run shot` (first time on a machine: `npx e3-ui install-browser`
downloads the headless Chromium it renders with; `npx e3-ui doctor` diagnoses browser problems).
`npm run shots:png` sweeps `src/` for EVERY renderable UI export (surfaces and `example()` defs
alike) into git-ignored `.shots/<path>/<export>.png` + a `manifest.json` of what rendered and why
anything was skipped; `npm run shots:html` adds a standalone HTML beside each PNG.

If you scaffolded with `--platform`, `src/platform/` holds project-owned TS-East platform functions
(exported via `./platform`) and `platform_module/` holds the Python ones — replace the generated
`example` functions with your own native code, called from tasks like any East function.
