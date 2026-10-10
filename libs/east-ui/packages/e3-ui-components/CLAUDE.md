# e3-ui-components

React Query hooks and preview React components for the e3 API.
Renderers specific to e3: `DataTaskPreview`, `TaskPreview`,
`DatasetPreview`, `EastValueViewer`, `InputPreview`,
`VirtualizedLogViewer`, the diff component family, the Plan's canvas
(`src/plan/`, #1177), Sheet (`src/sheet/`, #1179) and Calendar
(`src/calendar/`, #1159) and Roster (`src/roster/`, #1174), each registered against its e3-ui extension as the package
loads. Each renders in its `BuilderFrame` wherever it is used — the Plan's
(`src/plan/frame/`, #1193) around its canvas (`src/plan/canvas.tsx`, a hook
handing the frame main and its chrome's facts), the Sheet's
(`src/sheet/frame/`, #1216) around its grid: there is no frameless Plan or
Sheet. Calendar also owns its frame. These builders use east-ui-components'
shared parts through its `./internal` entry, and their tests on `./testing`; their slot recipes
stay in east-ui-components' theme. The time parts the Plan shares with
the Calendar are in `src/shared/time/` (#1148): the scale (its engine and
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

## Developing a BuilderFrame component

Follow the canonical [UI standards](../east-ui/STANDARDS.md),
[prop patterns](../../../../docs/conventions/EAST_UI_PROP_PATTERNS.md),
the interactive-state rules above and the
[authoring guide](../e3-ui/CLAUDE.md). Read Plan, Studio and Query on the actual
dependency branch before designing another builder. A newly implemented
component is not automatically a correct reference for every shared behavior.

### Reuse actual implementations

| Concern | Starting point |
| --- | --- |
| Pane placement, overlay rails, focus and scrim | `east-ui-components/src/layout/builder-frame/` |
| Folding toolbar, overflow menus, history and key search | `east-ui-components/src/toolbar/`, shared BuilderFrame toolbar items; `src/plan/shell/Toolbar.tsx`, `src/query/toolbar.tsx` |
| Author-bound Slice and window | `src/plan/root/window.ts`, `src/plan/shell/Toolbar.tsx`; e3-ui's indexed `slicePlanChrome` and `planWindows` examples |
| Drafts, validation, Save, retry, undo/redo | Shared `EditSession`, `EditHistory`, `historyToolbarItem` and `SessionBanners`; `src/shared/schedule/editing.ts` where the domain is event records |
| Library cards/search/tabs and inspector fields | Shared Library, Fields and FieldForm; existing builder integrations |
| Drag targets, keyboard drag, ghosts and cancellation | `east-ui-components/src/dnd/` |
| Typography, icons and visual states | `east-ui-components/src/theme/text-styles.ts`, slot recipes, `theme/icon-size.ts` |

Use the shared internal entry rather than reaching into another package's
private files. Extract a missing common part into a neutral owner and move the
existing consumer onto it too. Do not copy markup/CSS into a new component's
recipe and call that reuse. Preserve the domain's data model: for example, a
weekly roster record need not become Schedule event records to share a frame.

### Slice controls and data have one declared owner

The author passes the bound Slice, as in Plan; the renderer mounts shared
`useSliceToolbarItems` controls and subscribes with `useSliceReactivity`.
Honor the declared affordances and the shared rail/fold behavior. Do not
construct a private Slice from projected renderer rows or keep parallel search,
filter, cohort or range state.

Trace an actual control change into the data path. Inline narrowing comes from
the shared Slice engine upstream. On indexed events, the bound range controls
the window that seeks/reads day keys. Navigation writes that same range. A
key search uses the source's seek path; it is not text filtering over a loaded
prefix. Preserve Plan's distinction and make partial scope/counts explicit.
Do not promise server-side arbitrary filtering that the paged API cannot do.
By-key selection, draft baselines and Save remain tied to the original record,
even when an event leaves the filtered view.

### Frame, editing and narrow content

Let BuilderFrame own pane placement, rails, responsive overlays and focus.
Supply its named regions; keep main's scrolling inside main. Compose one
folding Toolbar using shared item ranks and menus, with history folding last.
Use the established 44px row and coarse-pointer targets. Range/date and count
readouts share one baseline; do not introduce a stacked two-line toolbar label.

All edit routes—pointer, keyboard, explicit mobile actions and inspector—must
reach the same commands and shared sessions. Reuse the shared Save label,
banners, validation, conflict and unknown-outcome retry behavior. Keep domain
actions such as Publish separate from Save, following Studio/Query. Use shared
anchored forms/popovers; follow the library's prohibition on modal dialogs.

BuilderFrame collapsing its panes does not supply the main area's mobile UX.
Define narrow content using the available **main-panel width**, as Plan does;
test a narrow container inside a wide viewport. For Calendar's agreed narrow
contract, main below 480px becomes agenda cards with explicit actions and no
drag targets/handles. Specify the equivalent domain actions for other builders.
Resize without resetting the active view, filters, selection or drafts. Keep
essential actions accessible without hover and retain shared touch targets.

### Styling must agree in the browser

Put static appearance in slot recipes and select states with attributes.
Inline values are for computed geometry only. Reuse the app's named text styles
and existing recipe parts for toolbar, column headings, axis labels, rows,
cards, inspector, library and footer. Verify every role: font family, size,
weight, line height, tracking, case and tabular numerals. Merely loading the
same font family does not establish parity with Plan.

Use existing icons and the shared sizing helper where Font Awesome's stylesheet
would otherwise override recipe dimensions. Check the actual SVG dimensions
and baseline, not just the requested CSS. Reuse selected/draft/warning/focus
treatments and test combinations. Decorative grips are quiet until hover or
keyboard focus, following Plan and Library. A drag preview and its caption must
remain readable even when the source event is a very short timeline bar.

### Required evidence before reporting completion

- Run examples through the actual e3-ui dispatcher and e3-web bindings. Check
  platform registration/package entry behavior; a renderer-only fixture can
  hide missing runtime registration.
- Test Slice externally and through its toolbar: same narrowing, date window,
  index/page requests, stable keys, truthful counts and drafts that still Save.
  Confirm that a paged example does not read the complete event record.
- Test meaningful editing paths, failed/refused writes, unknown outcomes,
  read-only behavior and Save/remount persistence through the existing harnesses.
- Use responsive browser checks at 1440/1024/768/390/360, light/dark themes,
  narrow parent containers and state-preserving resize. Exercise explicit
  narrow actions, folded toolbar access and real drag previews. Verify computed
  CSS, element geometry, overflow and accessibility; follow the library's
  DOM-based verification guidance rather than screenshot inspection.
- Run affected shared-component regressions when extracting or changing shared
  behavior. Keep all component definitions inline in their examples as required
  by the [authoring guide](../e3-ui/CLAUDE.md#examples-show-the-complete-component-definition-inline).
- Rebuild the real showcase after its dependencies; verify the served build,
  working examples and displayed source. e3-web needs a secure context, so use
  HTTPS for a remote preview. Notify the user only after that build is served.

### Footer rails and drag previews are shared parts too

Use the same footer rail recipe as Plan, not just its text style. The shared
`builder-footer.ts` owns the panel background, top rule, 28px desktop rail,
spacing, status typography and narrow wrapping. Pass it through BuilderFrame's
footer region; keep the footer visually distinct from the body. Calendar and
Plan both consume this part. Browser tests must compare the actual rail and
item styles in both themes and check narrow overflow.

Use the shared move-preview component and `time/move-ghost.ts` recipe for event
dragging/resizing. The preview sizes to its content independently of the source
bar or edge handle. Test a short timeline event: its title must not wrap into
a few characters per line. Preserve the shared destination/refusal caption.

### Weekly records: Roster's reference case

Keep the domain's aggregate boundary. Roster stores one complete week per UTC
DateTime key. Each week owns a shared EditSession/history view; the record's
write gate is shared across weeks. Save patches only the active week, and
Publish patches its assignments, targets, dismissals and published status in
one request. Unconfirmed writes retain the draft and the same retry identity.
Switching weeks, filtering or resizing must not discard another week's draft.

Keep **visibility separate from calculation scope** when the domain requires
it. Roster's author binds staff with `Data.bind`/`Record.bind`, applies
`Slice.rows` over typed staff scope rows, and passes their original keys as
`visiblePeople`. The complete `people` value still drives coverage, cost,
rest, skills and lead/trainer checks. Never calculate a misleading surplus by
filtering people out of the roster's arithmetic. Hidden edits still Save.

The windowed example binds a separate week-key Slice range and
`Data.bindPaged` on the weeks record. The same range is read by the shared
range control and written by roster navigation. Seek the active week, the
previous Copy source and the open picker's month only; do not read the whole
record to build the picker. Test an external Slice write and reverse navigation.

Use the Library's facet engine for role/skill focus. A host may control those
facets, but must not create a second search/filter implementation. Keep typed
inspector callbacks on the same guarded commands as dragging and mobile
forms; they cannot replace assignment identity or bypass published/read-only
state. Pure coverage and rule functions live in e3-ui and are compiled for
the renderer, so a task and the screen use the same arithmetic.

At main width below 480px, both Shifts and People become explicit-action cards;
no drag source or target remains registered. Test both layouts, target editing,
proposal acceptance, restore and Save/remount. Test the final toolbar forms at
360px with every action present: date picking, view, history and Publish must
all remain reachable. Bound each footer item separately so the shared rail can
wrap on narrow screens. Use Font Awesome for agreement icons as for other
icons; avoid text glyph substitutes.

Test the actual contained width as well as viewport width: a 360px showcase
viewport leaves a 294px frame after padding. Combine week and view controls
in a final shared-toolbar fold before history, keeping date picking, navigation
and Publish reachable. Desktop proposals use the mock's single-line dashed chip
with quiet Font Awesome actions; mobile cards keep labelled Accept/Reject.

Keep the footer to the legend. Roster explains its six coverage marks and
Calendar its configured event kinds, using the existing marks/icons and the
shared footer rail. Do not repeat status, pending edits, counts, costs or hours
there: shared history/toolbar controls and the inspector already own them.
Keep legend items individually wrappable and measure narrow overflow. The
inspector retains complete coverage/cost totals and explains whole-staff scope
when Slice narrows visible people. A collapsed Library badge reports availability
for the day, while tab counts report the library's item count.

Only show controls that change the active layout. People has a fixed weekly
window, so omit Day/Week; Calendar Resources has a fixed daily window, so omit
Day/Week/Month. Omit them from every Toolbar form, including menus and the
narrow combined picker. Keep the inactive period preference so switching back
restores it. Test expanded, folded and phone forms and switching back.

Group bands fill the complete scrolling grid width in both layouts. Make text
alignment explicit in slot recipes: Day shift details align left; compact Week
and People day labels center over their cells. Test band geometry at wide and
horizontally scrolled widths in both themes.

Sharing the drag engine does not by itself make dragging responsive. Profile a
realistic populated week. Keep shared drag handles/targets, but isolate sensor
updates from heavy chip bodies and cache previews by drag and destination for
the current immutable data. Use the existing pure domain checker over the
complete dependency set for a candidate; never deep-copy and recheck the entire
week on each pointer move. Invalidate previews when records/configuration change
and revalidate the final drop through the normal command. Test warning parity,
repeated hover, source immutability and cache invalidation. A completed edit may
update selection, but must preserve collapsed panes and the active inspector
tab. Only an explicit inspection action opens Details.

Keep a proposal's compact placement and detailed explanation separate in the
existing regions: a dashed single-line chip in the desktop grid, the complete
reason and labelled actions in Details, and explicit-action cards on phones.
Test those states after selection, as well as their initial appearance.

Numeric-input integration tests must allow the shared input's animation-frame
write-back to settle between keystrokes, following its existing tests. Also
exercise real decimal typing in Chromium through Save/remount. Distinguish a
refreshed record's stale-draft banner from a conflict returned by a write that
races with Save; both retain the draft and protect the newer stored value.

### Loading and bounded rendering

Use the shared `useContainerBelow`/`useContainerBreakpoint` hooks, as Plan does.
Their ResizeObserver updates commit before paint; a private asynchronous width
hook can briefly render phone cards into a desktop main while BuilderFrame
settles its panes. Verify the cold load as well as settled resize behavior.
Show a loading state while the active record window is unresolved; do not
render a forecast-only empty roster as though it were loaded data.

Bound the work, not only the CSS scroll box. Use Library's existing virtualizer
for populated bounded panes; do not disable it in an adapter. People rows and
phone People cards use the shared `VirtualRows` from the internal entry with
stable person/group keys, measured heights and selection-driven reveal. Keep
coverage and validation over the complete data while only mounting visible
rows plus overscan. Test scrolling to the end, search for an initially unmounted
person, selection/drafts through resize, and real drops after scrolling.

Profile the actual showcase too. Mount examples demanded by its viewport plus
a small adjacent window so asynchronous height changes do not unmount a deep
link. Memoize stable example entries; excessive offscreen examples add
subscriptions and render work to every drag. Test deep links and scroll anchoring
after changing that window. Record mounted row/card counts
and before/after load/drag measurements. Do not claim responsiveness from a
unit test or a shared-engine import alone.

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
