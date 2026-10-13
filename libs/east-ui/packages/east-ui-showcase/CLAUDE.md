# east-ui-showcase

Showcase + development app for East UI components: every east-ui and e3-ui
example, rendered live. The snapshot pipeline that turns each example into
standalone HTML / PNG (`make east-ui-examples-html-*`) is east-ui-components'
(`scripts/snapshot.ts`).

The app also showcases the **e3-ui** examples ("e3 Components" nav
section) against e3 itself, running in the page (#849, e3-web):
`showcase-e3.ts` starts it the first time an e3 example renders — the e3
worker (`e3.worker.ts`, repositories in memory) and its unit workers
(`unit.worker.ts`) — imports the showcase's e3 package (the zip at the URL
`virtual:e3-showcase-package` gives, below), deploys it to the workspace
`showcase` and runs its dataflow once. Edits staged against it are kept in
memory too, so a reload drops them with the e3.
`components/ShowcaseE3.tsx` mounts e3-ui-components' `E3Provider` and
`ReactiveDatasetProvider` over it, beside the app (their runtimes are
process-global), and gates each e3 example (`E3Gate`): it loads what the
example reads (its manifest's paths, as a UI task's preview does), polls
them while it shows, and renders the example — or the start's error, naming
its cause, in the example's place (`data-e3-start="failed"`), with a Retry
that starts e3 again. What loaded before renders at once, so a row the doc
list mounts again keeps its size. A page with no e3 example starts nothing.
The showcase's own error overlay says what it is (`data-showcase-error`).
`DocList` starts at a deep link before mounting the first window. Its
virtualizer is keyed by category so navigation cannot reuse another
category's measurements or pending scroll corrections. Overscan
rows keep their headings and source disclosures, while `PatternEntry`
defers IR compilation and e3 subscriptions until a preview intersects the
document viewport. Previously activated examples render immediately on
remount to preserve scroll anchoring. Responsive checks must bring a
preview into view and wait for `settled`; offscreen deferred previews do
not block readiness. Query changes can keep the old Calendar window
painted while `data-calendar-main` is `aria-busy`; wait for that state to
clear before asserting the new rows. Remount checks must explicitly
unmount and revisit a representative example per category, rather than
sweep a catalog whose scroll height grows as previews load. Relative date
preset tests use a fixed clock. Do not add retries, fixed sleeps or longer timeouts to
cover unnecessary startup work. Touch checks measure an input's own column
inside a compound field; toolbar fit calculations include its focus-ring
padding. Axis alignment uses DOM geometry and computed styles, not pixel
sampling.
The query builder's calls go to that e3 (#1132): `E3Gate` renders each e3
example under an `E3Provider` over it, so a run is a real one-shot call, or
a real split call that e3 cuts into pieces, and a run weighs its datasets by
their statuses there. The e3 worker cuts pieces at 64 KiB
(`showcase-pieces.ts`, through e3-core's `readTestPieceBytesFrom`, as
`E3_TEST_PIECE_BYTES` sets a local runner's), and `main.tsx`'s
`QueryPlanOptionsProvider` tells the planner that e3's smallest piece,
16 KiB: the fixture's datasets are one call, and the order history the
query examples' tasks generate when the dataflow runs (36,000 orders, the
accounts that place them and their credit limits) runs as a split call, a
re-keyed join and a join cut at the same keys.
`vite.config.ts` aliases `@elaraai/e3` to the e3-ui-components snapshot
harness's browser-safe shim: the examples only declare what they bind.
`@elaraai/e3-ui` is pre-bundled once when the dev server starts, so a change
to e3-ui's source needs `make showcase` again (it runs `vite --force`). In
dev, `@elaraai/e3-ui` (bare *and* `/internal`) and
`@elaraai/east-ui-components` (bare, `/fonts`, `/platform`) must all
resolve to source together — a split resolves East's reference-based
identities into two instances and `Data.bind` stops matching its
registered platform implementation.

Visual verification is the responsive suite (`tests/responsive/`): after
an east-ui example or component change, rebuild and run it, and land a
visual change with a visual invariant there — computed styles measured in
the page, in both themes. Never read a screenshot. The design system it
measures against is the read-only download in `../../app_design_system/`
(see [`../../CLAUDE.md`](../../CLAUDE.md) › Canonical design source).

## Keep responsive checks economical

CI builds the dependency chain and showcase once, then distributes the same
compiled workspace artifact to all test jobs, including up to 16 browser shards
and four e3 renderer Vitest shards. Renderer Node specs run once in `rest`.
Browser shards use one worker. Each page deploys an independent e3 workspace;
two concurrent browsers made cold starts exceed existing readiness deadlines
on hosted runners. Parallelize across jobs, not cold starts within a runner.
Each job installs its own dependencies; browser jobs install Chromium.
Keep every required runtime `dist` in that artifact;
do not make a shard silently rebuild it.

`scripts/responsive-impact.ts` selects from the complete PR diff (the checked-out
merge's first parent to the merge), or a push's `before` commit to its head.
Do not select from just the latest PR commit: earlier changes still need their
checks. Missing comparison history and manual workflow runs select everything.
Documentation, unit specs and known CLI/native-only changes skip the
browser jobs. A changed responsive spec selects all its applicable projects.
Known e3 component renderer directories select their suites plus every shared
suite; unclassified/new suites remain shared. IR, example data, shared components,
themes, runtime, dependency and tooling changes select the full suite. Examples
share records and task definitions across families, so do not infer isolation
from their directory names. `e3-api-server` stays shared because e3-web imports
its portable routes. New dependencies must broaden this mapping first.

The build records the selected tests and reason in its job summary and build
artifact. `make select-responsive BASE=<ref> OUTPUT_DIR=<dir>` reproduces the
selection locally. `make test-responsive TEST_LIST=<dir>/responsive-tests.txt`
runs it. The job count follows the selection (at most 16); a documentation-only
change starts no browser runners. Package checks still run. Workflow dispatch
is the explicit full-suite escape hatch.

`make test-responsive SHARD=n/total` uses `scripts/responsive-shards.ts` to
interleave Playwright's discovered, project-filtered tests across the jobs.
The public `--test-list` interface selects them. Do not replace this with
contiguous `playwright --shard`: that concentrates adjacent expensive builder
cases in one job. A Node check asks Playwright to rediscover all 16 lists
and verifies that every test runs exactly once; another check resolves the
focused lists and their smaller shard sets through Playwright. Both compare
tests by `testIdentity` (project, file and title path, all a list line is
matched on), never by the position Playwright prints, which can be the
transformed file's. A process's listings keep Playwright's transformed files
in a directory of their own (`listingTransformCache`): Playwright writes the
cache every process shares in place, so two listings at once, as the tooling
specs run, could read a half-written file and fail on a module missing its
exports. Keep workflows independent
under `fullyParallel`; dependent steps belong inside one test.

Batch related read-only catalog routes in one browser context and use hash
navigation so e3 starts once per batch. Use named `test.step` blocks for every
route and retain its full error/containment assertions. Keep mutation workflows
isolated. Test geometry at several widths on one mounted example instead of
repeating a cold e3 deployment for each width. Group inspector selections and
read-only frame checks on one mounted example, closing touch overlays between
steps. A sweep that explicitly sets its viewport and checks both 390px and
360px runs once per pointer mode; do not tag it for a third identical sweep.
Keep explicit remount tests where remount is the behavior under test. Tag desktop-only and mobile-only groups so
project selection excludes them before sharding. Do not trade coverage for
speed with retries, longer timeouts or fewer supported widths/themes.

A stable row layout does not mean a rotating caret has finished: await its
actual animations before comparing bounding boxes. Before a drag driven by
raw mouse coordinates, use locator actionability to bring its card into view
and establish a stable hit target; a previous drop or tab change can scroll it.

## Key scripts

- `scripts/discover-example-files.ts` — finds every `*.examples.ts`
  across east-ui packages.
- `scripts/snapshot-chrome.ts` — boots the dev server and screenshots the
  showcase's own chrome, for a quick look at `App.tsx`.
- `scripts/vite-plugin-example-sources.ts` — exposes example source
  files to the dev server via a virtual module.
- `scripts/e3-showcase-package.ts` — the showcase's e3 package (#849):
  every e3 definition the e3-ui example modules export (inputs, records
  with their mutations and indexes, tasks, functions), packaged with the
  real SDK and written as a zip (`tsx scripts/e3-showcase-package.ts
  <zip>`). Two modules declaring one dataset, task or function fail it.
- `scripts/vite-plugin-e3-showcase.ts` — runs that step in a node process
  of its own: the dev server serves the zip at `/e3-showcase.zip` (built
  again, and the page reloaded to start its e3 over it, after e3-ui's
  `dist/` or `test/` changes — rebuild e3-ui for an edit to reach the
  package), and `vite build` emits it named by its content
  (`dist/assets/e3-showcase-<hash>.zip`); the page imports its URL from
  `virtual:e3-showcase-package`, either way.
  `tests/e3-package/` imports it into an in-memory e3 (`pnpm run test`).
- `scripts/example-renderings.ts` — joins every Code Reference example
  with the Claude plugin's example index (`libs/east-claude-plugin/index.json`)
  by id, for its python rendering (#655): the index stores each program
  example as IR with the TypeScript and python printed from it. A Code
  Reference example missing from the index fails the build naming it —
  regenerate with `cd libs/east-claude-plugin && make index`. The
  TypeScript / Python selector on each Code Reference entry is that
  example's own choice (`code-language.ts`, session-persisted so a row
  keeps it across virtualizer remounts; `?lang=python` opens every example
  in python); Components are JSX and never get the selector.

## Make targets

(Run from `libs/east-ui/`.)

| Target | What it does |
|---|---|
| `make east-ui-examples-html-all` | Snapshots every example to standalone HTML. |
| `make east-ui-examples-html-<pathKey>` | Snapshots one example (e.g. `disclosure/tabs`). |
| `make design` | Serves the design system's download (`app_design_system/`, read-only) on :5174. |
| `make test-responsive` | The Playwright suite in `tests/responsive/` (DOM specs over every catalog page, the shell, the code reference, the Plan's geometry, the Sheet's ring under the keyboard, the load, and the e3 the page runs, at desktop + mobile) against the built showcase, exactly as CI runs it; `SHARD=n/total` runs one shard, with an optional `TEST_LIST` from `select-responsive`. Each spec waits for the page to be at rest (`settle.ts`: no e3 example still starting, the layout still), never for a fixed time, and nothing retries. |

## See also

- [`../../CLAUDE.md`](../../CLAUDE.md) — lib-level overview.
- [`../east-ui/test/CLAUDE.md`](../east-ui/test/CLAUDE.md) — example
  authoring rules; every example here is reachable from a `.examples.ts`
  file in east-ui's test suite.
- [`../../../e3/packages/e3-web/README.md`](../../../e3/packages/e3-web/README.md)
  — e3 in a browser: `createWebE3`, `serveE3`, `serveUnits`.
