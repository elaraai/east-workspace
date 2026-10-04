# e3-ui-components

React Query hooks and preview React components for the e3 API.
Renderers specific to e3: `DataTaskPreview`, `TaskPreview`,
`DatasetPreview`, `EastValueViewer`, `InputPreview`,
`VirtualizedLogViewer`, the diff component family, and the Plan's canvas
(`src/plan/`, #1177), registered against e3-ui's `PlanView` extension as
the package loads. The Plan builds on east-ui-components' shared parts
through its `./internal` entry, and its tests on `./testing`; its slot
recipes stay in east-ui-components' theme.

## HARD RULE: East values through East

An East value is printed, read, compared, ordered, collected and typed
through East's utilities — never a JavaScript stand-in — and tested over
real, decoded East values. `make lint` runs `east/east-rules` (the
host-value rules) over source and tests and fails on a JavaScript stand-in;
[`EAST_TS_INTEROP.md`](../../../../docs/conventions/EAST_TS_INTEROP.md)
§7–§11 names each utility and the rule that enforces it.

## Architecture

- Two entries (`vite.config.ts`): the package's, which needs a DOM as it
  loads (its renderers), and `./query` (`src/query/calls.ts`) — a query's
  calls without the builder: the root, the one-shot call, the plan and its
  split call, the calls in memory — which loads no React and no renderer,
  so a host in Node uses it (`test/query/node-safe.spec.ts` guards that).
- React Query (TanStack Query 5.x) hooks live alongside the
  components. They wrap `@elaraai/e3-api-client` calls.
- Renderers follow the same patterns as `east-ui-components` —
  `memo` + `equivalentFor`, the MANDATORY interactive-state pattern with
  `useState` + a data-gated `useValueSync` / `useDataStable` re-sync +
  `queueMicrotask` for callbacks.
- East value previews (`EastValueViewer`) use `isValueOf` for runtime
  type dispatch — see the HARD RULE above.
- A builder-style renderer — Studio's builder, the query builder, and any
  new one like them — is laid out with east-ui-components' `BuilderFrame`,
  never by hand. Its anatomy, props and pane modes are in
  [`../east-ui-components/CLAUDE.md`](../east-ui-components/CLAUDE.md) ›
  Builder frame.

## See also

- [`../../CLAUDE.md`](../../CLAUDE.md) — east-ui lib-level overview.
- [`../east-ui-components/CLAUDE.md`](../east-ui-components/CLAUDE.md)
  — general renderer patterns (memo, useMemo, interactive-state).
  **All of those rules apply here.**
- [`../e3-ui/CLAUDE.md`](../e3-ui/CLAUDE.md) — the IR types this
  renders.
- [`../../../../docs/conventions/EAST_TS_INTEROP.md`](../../../../docs/conventions/EAST_TS_INTEROP.md)
  — `isValueOf`, `compareFor`, `variant` rules for the East-value
  preview path.
