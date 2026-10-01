# e3-web

e3 running entirely in a browser (epic #1019): a third e3 backend beside the
local one and e3-cloud, built by the rule in
[`docs/conventions/E3_BACKEND_SEAMS.md`](../../../../docs/conventions/E3_BACKEND_SEAMS.md).
So far it holds its storage backend, the four storage adapters it runs over,
and its runner; the in-page e3 lands on them.

## Layout

- `src/storage/WebStorage.ts` — `WebStorage implements StorageBackend` over
  the adapters, its record layout (`recordKeys`), and `openWebStorage`
  (`persist`, `name`). `WebStateStore.ts` — `ExecutionStateStore` over the
  same records. `stores.spec.ts` runs every e3-core contract suite over both
  in Node.
- `src/storage/adapters.ts` — the four adapters the stores run over: records
  (keyed, ordered, transactional), blobs, locks (with a session per tab) and
  files.
- Their implementations: `indexeddb.ts`, `opfs.ts` and `web-locks.ts` in a
  browser; `memory.ts` for Node's test pass and `persist: false`; and
  `node-files.ts`, Node only — it is the `@elaraai/e3-web/node` entry, and
  nothing a browser bundle imports reaches it.
- `src/execution/WebTaskRunner.ts` — `WebTaskRunner implements TaskRunner`:
  every unit on a worker of a pool, through e3-core's shared logic (the
  cache probe, `ExecutionAttempt`'s records, the unit forms, the engine's
  `executeSplitTask`, `storeCollection`, `deliveryPiece`), never a copy of
  it. `pool.ts` — `UnitPool`: workers started from the app's factory, as wide
  as the cores; an abort or a timeout terminates a unit's worker.
  `protocol.ts` — the messages (`start`/`ready`, `run`, `log`, `done`,
  `broken`) and what a message moves (`transferOf`). `unit-server.ts` — a
  worker's side: east's `executeUnit` over `InMemoryUnitIO`, platform
  packages by name. `in-process.ts` — workers in the e3 worker's own thread,
  over a `MessageChannel`, which Node's test pass runs units on.
- `src/units.ts` — the `@elaraai/e3-web/units` entry: `serveUnits()`, which
  a unit worker script calls. `src/index.spec.ts` bundles it and the root
  entry for a browser: neither reaches Node, e3-core's root entry or e3's
  SDK.
- `src/testing/` — portable cases, run in Node and in a page, with the
  assertions they use (`assert.ts`): the adapters' contract
  (`adapter-contract.ts`), and the runner's cases (`runner-cases.ts`:
  `runnerCases`, and `threadCases`, which only Web Workers pass), over the
  specs' own platform package (`test-platform.ts`). `runner-fixtures.ts` is
  Node only: the fixture package, written with e3's SDK — a dev dependency,
  reached by nothing a browser bundles — and exported to the data a page is
  handed.
- `src/browser/` — the Chromium harness: `harness.ts` (Node side: esbuild
  bundles, a loopback server, playwright-core, the bridge), `page.ts` (page
  side), test pages (`*.page.ts`: `storage.page.ts` for the adapters,
  `repository.page.ts` for the stores, `runner.page.ts` for the runner, whose
  unit workers run `unit.worker.ts`) and Chromium specs (`*.spec.ts`).

## Tests

`make test` runs every `dist/src/**/*.spec.js`, the Chromium specs among
them. A Chromium spec never skips: when Chromium cannot launch, its `before`
hook fails with the remediation. It launches `E3_UI_CHROMIUM_PATH` (or
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`) when set, and Playwright's managed
Chromium otherwise — installed by
`pnpm --filter @elaraai/e3-web exec playwright-core install --only-shell chromium`,
as e3's CI does.

## See also

- [`../../CLAUDE.md`](../../CLAUDE.md) — e3 lib-level overview.
- [`../../STANDARDS.md`](../../STANDARDS.md) — the standards every e3
  package follows, which apply here.
- [`../e3-core/CLAUDE.md`](../e3-core/CLAUDE.md) — the seams this backend
  implements, and the contract suites it runs.
