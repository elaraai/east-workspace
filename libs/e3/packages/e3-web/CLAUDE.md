# e3-web

e3 running entirely in a browser (epic #1019): a third e3 backend beside the
local one and e3-cloud, built by the rule in
[`docs/conventions/E3_BACKEND_SEAMS.md`](../../../../docs/conventions/E3_BACKEND_SEAMS.md).
A page connects to its e3 worker (`createWebE3`); the e3 worker
(`serveE3`) runs e3's storage, orchestrator, runner and transfers, and
answers e3's whole API with e3-api-server's own routes; its unit workers
(`serveUnits`) run every East program.

## Layout

- `src/worker.ts` — the `@elaraai/e3-web/worker` entry: `serveE3`, which
  boots, in order, `openWebStorage`, `WebStateStore`, a `UnitPool` and a
  `WebTaskRunner` per repository, `LocalOrchestrator` (its host's `owner` is
  the tab's session, so a split task's own execution is judged as every
  other), `WebTransferBackend` (and its `start`), and the app, and serves it
  through `serveBridge`. The pool's `connect` hands each unit worker a port
  the bridge serves the same app over, with no lifelines, and a handle the
  pool closes as it lets the worker go, which ends that bridge. Over a
  `MessagePort` the e3 closes once its page has gone: the page's `close`
  message, its lifeline freed, or the port's close event where one fires
  (Node's; a browser's port fires none). `identify` set, an unidentified
  request to a repository is answered 401, and `access` defaults to
  `oneShotAccessByRoles()`.
- `src/app.ts` — `createWebApp`: every route factory of
  `@elaraai/e3-api-server/portable`, mounted in multi-repository mode in the
  local server's order (`server.ts`), with an optional `identify` that sets
  the caller's identity where a server's auth does; a repository's name is
  its identifier (`checkName`).
- `src/transfer/` — `WebTransferBackend.ts`: `TransferBackend`'s seven
  stores over the storage's records and blobs; every job through e3-core's
  shared handlers, and every job and commit owned by the tab's session until
  it ends — what a closed tab left is recorded failed by `start`, never run
  again, and what a live tab runs is left to it; an export a round at a
  time, each round's blob kept, a workspace's holding its lock across them;
  retention while the tab lives. Its staging layout (`stagedKeys`) is
  `WebStorage.ts`'s, whose gc sweeps what no record names. `endpoints.ts`
  (`createWebDataEndpoints`): the byte endpoints its root-relative URLs name,
  as the local server's `routes/data.ts` answers its own.
- `src/bridge/` — `e3.fetch`, between a page and its e3 worker:
  `protocol.ts` (the messages each side posts — the page's `hello`, which the
  worker answers `ready` or `boot-error` however late it comes, `request`,
  `abort` and, over a port, `close` — `WEB_E3_ORIGIN`, and the lifelines each
  side holds and waits on, `holdLifeline` / `watchLifeline`), `page.ts`
  (`createWebE3`, the root entry's, and `connectWebE3`, which a unit worker's
  e3 platform functions connect with, holding no lifeline) and `worker.ts`
  (`serveBridge`, the worker's side, which `serveE3` serves through and its
  host may end; no package entry exports it). Over a dedicated worker or a
  `MessagePort`; `bridge.spec.ts` holds a `MessageChannel` to the contract
  in Node.
- `src/storage/WebStorage.ts` — `WebStorage implements StorageBackend` over
  the adapters, its record layout (`recordKeys`), and `openWebStorage`
  (`persist`, `name`). `WebStateStore.ts` — `ExecutionStateStore` over the
  same records. `stores.spec.ts` runs every e3-core contract suite over both
  in Node.
- `src/storage/adapters.ts` — the four adapters the stores run over: records
  (keyed, ordered, transactional), blobs, locks (with a session per tab) and
  files, each read in slices of the adapter's own read size
  (`FILE_READ_CHUNK`, 1 MiB, unless it is made with a `readChunk`).
- Their implementations: `indexeddb.ts`, `opfs.ts` and `web-locks.ts` in a
  browser; `memory.ts` for Node's test pass and `persist: false`; and
  `node-files.ts`, Node only — it is the `@elaraai/e3-web/node` entry, and
  nothing a browser bundle imports reaches it.
- `src/execution/WebTaskRunner.ts` — `WebTaskRunner implements TaskRunner`:
  every unit on a worker of a pool, through e3-core's shared logic (the
  cache probe, `ExecutionAttempt`'s records, the unit forms, the engine's
  `executeSplitTask`, `storeCollection`, `deliveryPiece`), never a copy of
  it. `pool.ts` — `UnitPool`: workers started from the app's factory, as wide
  as the cores; an abort or a timeout terminates a unit's worker, and a
  worker that stops on its own frees the lifeline it named in `ready`, which
  fails its unit; a worker let go has its `UnitConnection` closed.
  `protocol.ts` — the messages (`start`/`ready`, `run`, `log`, `done`,
  `broken`) and what a message moves (`transferOf`). `unit-server.ts` — a
  worker's side: east's `executeUnit` over `InMemoryUnitIO`, platform
  packages by name, `STANDARD_PLATFORMS` among them, each given the unit's
  console, port and stopping signal. `e3-platform.ts` — e3's own platform
  functions (`@elaraai/e3-api-client`'s `Platform`, under that name), bound
  to `connectWebE3` over the port the unit worker was handed. `in-process.ts`
  — workers in the e3 worker's own thread, over a `MessageChannel`, which
  Node's test pass runs units on; terminating one stops what its units left
  waiting, east-web-std's sleeps included.
- `src/units.ts` — the `@elaraai/e3-web/units` entry: `serveUnits()`, which
  a unit worker script calls. `src/index.spec.ts` bundles it, the root entry,
  the worker entry and the worker's side of `e3.fetch` for a browser: none
  reaches Node, e3-core's or e3-api-server's root entries, or e3's SDK.
- `src/testing/` — portable cases, run in Node and in a page, with the
  assertions they use (`assert.ts`): the adapters' contract
  (`adapter-contract.ts`); `e3.fetch`'s contract (`bridge-contract.ts`), run
  over a `MessageChannel` in Node and over a dedicated worker in a page,
  whose worker answers with a plain handler (`bridge-handler.ts`); and the
  runner's cases (`runner-cases.ts`: `runnerCases`, and `threadCases`, which
  only Web Workers pass, a worker that closes itself among them), over the
  specs' own platform package (`test-platform.ts`). `callers.ts` — the specs'
  admin and reader tokens,
  and the identity each names. `hold-platform.ts` — `test_hold`, which holds
  a unit worker of a page that holds. `runner-fixtures.ts` and
  `e3-fixtures.ts` are Node only: the fixture packages, written with e3's
  SDK — a dev dependency, reached by nothing a browser bundles — exported
  to the data a page is handed, or to the zips the specs import through
  e3's API.
- `src/browser/` — the Chromium harness: `harness.ts` (Node side: esbuild
  bundles, a loopback server that also serves the directories a spec names,
  playwright-core, the bridge), `page.ts` (page side), test pages
  (`*.page.ts`: `storage.page.ts` for the adapters, `repository.page.ts` for
  the stores, `runner.page.ts` for the runner, whose unit workers run
  `unit.worker.ts`, `bridge.page.ts` for `e3.fetch`, `compliance.page.ts` for
  east-node-std's compliance suite over east-web-std, with `compliance.ts`,
  what it and its spec share, and `e3.page.ts`, a page of an app running the
  whole e3: its e3 worker `e3.worker.ts` calls `serveE3`, its unit workers
  run `e3-unit.worker.ts`, and it serves e3 over a port from
  `e3-port.worker.ts`, to itself or to `e3-client.worker.ts`, a page's
  stand-in it can stop), the workers they start (entries the harness bundles
  as it bundles a page's), the Node-side fetch that forwards a request into
  `e3.page.ts` (`e3-forward.ts`, over `e3-wire.ts`, its edges held in Node by
  `e3-forward.spec.ts`) and Chromium specs (`*.spec.ts`). The harness keeps
  every error a page raised (`raisedErrors`), and each case asserts it
  raised none; `tell` calls a page's function whose answer nothing reads.

## Tests

`make test` runs every `dist/src/**/*.spec.js`, the Chromium specs among
them. Run locally, it needs what e3's CI sets up before the package tests
(`.github/workflows/test-e3.yml`, its packages shard):

- Chromium: the executable `E3_UI_CHROMIUM_PATH` (or
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`) names, or Playwright's managed
  headless shell, installed by
  `pnpm --filter @elaraai/e3-web exec playwright-core install --only-shell chromium`;
- east-node-std's compliance suite, exported by
  `make -C libs/east-node test-export-std` (from the workspace root) to
  `EAST_NODE_STD_IR`, or to `/tmp/east-node-std` when that is unset;
- httpbin on `:8085`: the workspace root's `make services-up`.

A Chromium spec never skips: when Chromium cannot launch, its `before`
hook fails with the remediation.

`e3-api.ts` runs every API suite of `@elaraai/e3-api-tests`
(`apiTestSuites`) in Node, each request forwarded into `e3.page.ts`, with
the admin's and the reader's tokens of `callers.ts` and `commands: false`;
the global `fetch` refuses every request for the run. It runs them in parts
(`API_SUITE_PARTS`), a spec file each (`e3-api-1.spec.ts` …), each with its
own browser, so no file nears the eight minutes a test file is given on
CI's slowest runner; a part's file passes its own URL, and its name names
its part (`apiSuitePartOf`). `e3-api-parts.spec.ts` checks the parts name
every suite once, that each has its file, and that a file runs the part its
name names. `index.spec.ts` checks every module the browser bundles take in
names none of Node's globals free, and that they bundle with no warning. The same suites run against
`serveE3` in Node, over a `MessageChannel` with in-process units, in
`libs/e3/test/integration`'s `web-compliance.spec.ts`. `e3.spec.ts` runs
e3's own platform functions from a unit worker, a dataflow interrupted by
closing its page, the Web Locks held across runs whose unit workers are
terminated, a one-shot given up with the unit that asked for it, and an e3
served over a port closed by its page's word or by its page going.

`compliance.spec.ts` runs east-node-std's exported compliance suite over
east-web-std in Chromium: the Chromium leg of east-web-std's own
`compliance.spec.ts`. It reads the export named above, and fails naming the
command that writes it when there is none; its Fetch tests call httpbin, and
fail naming `make services-up` when it does not answer.

## See also

- [`../../CLAUDE.md`](../../CLAUDE.md) — e3 lib-level overview.
- [`../../STANDARDS.md`](../../STANDARDS.md) — the standards every e3
  package follows, which apply here.
- [`../e3-core/CLAUDE.md`](../e3-core/CLAUDE.md) — the seams this backend
  implements, and the contract suites it runs.
