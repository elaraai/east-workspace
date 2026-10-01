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
The query builder's one-shot calls are answered in the browser (#940):
`main.tsx` runs each over the e3 example modules' `e3.input` defaults
(`createInMemoryQueryCall` through a `QueryCallProvider`), each run planned
over the same inputs' statuses (`createInMemorySourceStatus` through a
`QuerySourceStatusProvider`, #941) — tiny, so every run is one call.
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
| `make test-responsive` | The Playwright suite in `tests/responsive/` (DOM specs over every catalog page, the shell, the code reference, the Plan's geometry, the Sheet's ring under the keyboard, the load, and the e3 the page runs, at desktop + mobile) against the built showcase, exactly as CI runs it; `SHARD=n/8` runs one CI shard. Each spec waits for the page to be at rest (`settle.ts`: no e3 example still starting, the layout still), never for a fixed time, and nothing retries. |

## See also

- [`../../CLAUDE.md`](../../CLAUDE.md) — lib-level overview.
- [`../east-ui/test/CLAUDE.md`](../east-ui/test/CLAUDE.md) — example
  authoring rules; every example here is reachable from a `.examples.ts`
  file in east-ui's test suite.
- [`../../../e3/packages/e3-web/README.md`](../../../e3/packages/e3-web/README.md)
  — e3 in a browser: `createWebE3`, `serveE3`, `serveUnits`.
