# e3-web

e3 running entirely in a browser (epic #1019): a third e3 backend beside the
local one and e3-cloud, built by the rule in
[`docs/conventions/E3_BACKEND_SEAMS.md`](../../../../docs/conventions/E3_BACKEND_SEAMS.md).
So far it holds its storage backend and the four storage adapters it runs
over; its runner and the in-page e3 land on them.

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
  nothing a browser bundle imports reaches it (`src/index.spec.ts` bundles
  the root entry for a browser to hold that line).
- `src/testing/` — the adapters' contract (`adapter-contract.ts`): portable
  cases that run in Node over the in-memory adapters and in a page over the
  browser ones, with the assertions they use (`assert.ts`).
- `src/browser/` — the Chromium harness: `harness.ts` (Node side: esbuild
  bundles, a loopback server, playwright-core, the bridge), `page.ts` (page
  side), test pages (`*.page.ts`: `storage.page.ts` for the adapters,
  `repository.page.ts` for the stores) and Chromium specs (`*.spec.ts`).

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
