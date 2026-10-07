# e3-ui-components

React Query hooks and preview React components for the e3 API.
Renderers specific to e3: `DataTaskPreview`, `TaskPreview`,
`DatasetPreview`, `EastValueViewer`, `InputPreview`,
`VirtualizedLogViewer`, the diff component family, the Plan's canvas
(`src/plan/`, #1177) and the Sheet (`src/sheet/`, #1179), each registered
against its e3-ui extension (`Plan`, `Sheet`) as the package
loads. Each renders in its `BuilderFrame` wherever it is used — the Plan's
(`src/plan/frame/`, #1193) around its canvas (`src/plan/canvas.tsx`, a hook
handing the frame main and its chrome's facts), the Sheet's
(`src/sheet/frame/`, #1216) around its grid: there is no frameless Plan or
Sheet. Both build on east-ui-components' shared parts through its
`./internal` entry, and their tests on `./testing`; their slot recipes
stay in east-ui-components' theme. The Flowchart's renderer
(`src/flowchart/`, #1243) registers against its `Flowchart` extension the
same way, renders in its `BuilderFrame` too (#1245) — its canvas
(`canvas.tsx`), its toolbar's items (`toolbar.tsx`), its footer
(`footer.tsx`) and find state (`find.ts`) laid out by `index.tsx`, and over
flows by name (#1246) its Flows tab (`flows.tsx`), the open flow, kept in
the UI store (`open-flow.ts`), as LR · TD is (`orientation.ts`), each flow's
editing session (`session.ts`) and its words (`messages.ts`) — builds on the
same parts, and keeps its slot recipe there too. The segment strip
and the one chip it folds into, which the Plan's and the Flowchart's
toolbars share, are `src/shared/seg.tsx`.
The time parts the Plan shares with the Calendar are in `src/shared/time/`
(#1148): the scale (its engine and
time arm), the move, draw and slot arithmetic, the now line, lane packing
and weekend and off-hours shading. The now line's look is one part of the
theme, merged into the recipe of each component that draws one
(`slot-recipes/time/now.ts`).

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
  The bundle keeps React, Chakra and react-aria's locale (`@react-aria/i18n`)
  external, as east-ui-components' does: each is a context the host shares
  with every renderer package, so one `I18nProvider` reaches them all
  (#1206, `src/locale.dom.test.tsx`, `test/one-locale.spec.ts`).
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
