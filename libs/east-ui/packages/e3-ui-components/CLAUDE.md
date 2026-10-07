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
stay in east-ui-components' theme. The Flowchart's renderer
(`src/flowchart/`, #1243) registers against its `Flowchart` extension the
same way, builds on the same parts, and keeps its slot recipe there too.
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

Authors bind either local rows or a declared indexed record. Use
`useSliceToolbarItems` for the local carrier and `useRecordSliceToolbarItems`
for the record carrier. Both use the shared rail, editors, choice/search/range
parts and toolbar ladder in east-ui-components. Keep the old local wire intact;
record chrome is a separate appended payload. Honor affordances and persistence.
Inside the folded editor, field editors expand inline, with one popup and
normal keyboard focus return. Never copy another control family into a builder.

Trace every choice to the source. Plan/Sheet read the ordered Slice source,
Calendar event kinds read its interval queries, and Roster reads the selected
staff identities for visibility only. No filtering over resident record rows,
private Slice, full scan for options or user-facing index picker. The shared
summary is authoritative N of M original records; do not add a competing local
count. Search Records remains primary-key navigation, not Slice field search.

Calendar preserves overlap `[from, to)`, including carry-in events, whole-window
spans, overnight/multi-day events and instants at the lower boundary, once by
primary identity. Reuse Schedule's record-window adapter and declared interval
indexes. Do not replace overlap with a scalar start query or guessed lookback.
Precise query bounds and midnight-aligned day geometry are separate. Navigation,
shared range editors and brushes must write the same bound state.

On query replacement, retain the previous complete rows/membership and window
until the replacement lands, then swap atomically. Reset the new paging origin.
Pending is not empty; errors retain usable data and offer Retry. Mark retained
content busy and disable its editing gestures while pending. Keep toolbar
navigation and session Save usable. The shared BuilderFrame Skeleton owns cold
load; do not flash partial rows or cover usable data on every filter change.

Sessions/history use original record keys and stable source/view identities.
A query ID, index key or page offset must never become an edit identity. Retain
hidden drafts through filtering, paging and remount, and Save them through the
existing checked mutation. Confirm by primary reads outside the narrowing at
the committed revision; absence from the filtered result proves nothing about
Save. Roster still saves one complete active week and calculates over complete
staff, whatever people the indexed visibility query hides.

Keep page eviction enabled and independent of sessions. `PagedRuntime` retains
at most 24 decoded windows; record Slice retains 32 windows capped at 2,048 rows
each. Never raise those bounds or pin every page to make Save or a scan finish.
Use the shared session's bounded primary-read batches and retain only confirmed
facts at the committed revision. Save membership checks also accumulate facts
at one revision. Partial provider pages must resume within their bounded window.

For a complete active query, reuse `PagedScan`: retain its projected result and
next unread offset, discard progress on revision/query replacement, and release
obsolete results with their tracked reader. Schedule's internal scan operation
also lets gestures reuse an active result through weak references. Do not cache
historical query results or restart at zero after each asynchronous page. Test
scans and Save batches exceeding both cache capacities, and prove that an old
page is fetched again after eviction while its draft remains intact.

Use the shared session `prepare` seam with `prepareRecordSliceSave`, then render
`RecordSliceSaveNotice` in the host's existing footer. Capture exact membership
before sending the checked mutation and recheck after primary-key confirmation.
Use SDK-maintained keys and bounded index seeks, never local predicates or page
membership. Count only entries leaving this query and new entries saved outside
it; an already-hidden edit is not an exit. Query changes clear feedback. A failed
preparation sends no mutation and preserves drafts; a failed feedback read offers
a read retry, never another Save. An indexed source's `recordId` names the primary
record across all index lists and must back the shared editing identity.

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

The examples declare staff, configuration, forecasts and proposals as
`e3.record` definitions. `Data.bind(record)` provides reactive reads of a
record, just as it reads inputs and task outputs. `Record.bind(record,
mutations)` adds the mutation commands for a record the surface edits. The
binding name does not change the source's storage kind. Keep these declarations
visible alongside the examples so reference data is clearly record-backed.

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

Mobile day strips use the shared `Seg` component's `fullWidth` recipe
variant: all seven buttons fill the available content width equally, with no
unused tail or horizontal overflow. Picker rows have a neutral hover state,
a distinct selected state and the shared keyboard focus ring, all in slot
recipes. Verify their actual computed styles and geometry in both themes,
including a narrow container inside a wide viewport.

Group bands fill the complete scrolling grid width in both layouts. Make text
alignment explicit in slot recipes: Day shift details align left; compact Week
and People day labels center over their cells. Test band geometry at wide and
horizontally scrolled widths in both themes.

Date column captions use `timeHeaderText` from the shared `time/axis.ts`
recipe part, also used by Plan's band captions. Roster's Day shift labels,
Week dates and People dates all apply `shiftLabel`; never put bare text in a
header button and inherit body typography. Calendar's weekday and date number
use the same header part, with no title-sized numeral or independent font
size. Keep the complete label on one line. Compare computed family, size,
weight, line height, tracking, case and numeral settings across every view,
including all seven week dates and selected/current dates, in both themes.

Header geometry is a separate requirement from typography. Roster's one-line
Week date/shift and People column cells are 28px tall (plus the row rule).
Day uses a 44px header: shift name and time on one line, summary on the next.
Do not let three stacked text blocks determine its height.
Use `headerGutter` for their captions, never the padded body-row `rowHead` or
`peopleHead` slots. The Week gutter is one line too; it must not stretch an
otherwise compact band. Assert actual row heights as well as text properties.
Calendar's Day/Week date and event count share one 28px band, as do its Month
weekday captions. Resource headers use 44px for the named resource and its
metadata; Timeline has two 28px ruler bands plus the bottom rule. Its Resources
caption uses Plan's `brushCaption`, not the body `rowHead` slot. Resource column
names, month numbers and agenda dates use `timeHeaderText`; timeline resource
rows and metadata reuse Plan's `gutterName`/`gutterSub`. Keep unit labels visible
while scrolling. Test every period, resource headers, month cells and mobile
agenda dates, including geometry and the app's actual computed fonts.
Month headings and date cells must share the recipe's minimum track width;
assert their left edges and widths match before and after horizontal scrolling.

Audit renderer JSX as well as its recipe: fixed grid minima, track sizes,
column counts fixed by a layout, padding and spacing belong in the recipe.
Pass only data-dependent column counts and computed event/coverage positions
inline (CSS variables are suitable). Sizing logic must read the recipe's
computed padding, borders and gaps instead of repeating those values in JS;
Roster's responsive footer measures those styles before fitting legend items.

Calendar Timeline and Roster Shifts/People/narrow People cards reuse
`shared/schedule/group-heading.tsx` and the theme's `schedule-group.ts` recipe
part. One native disclosure button and persisted group-key fold state own
click/Enter/Space, chevrons and `aria-expanded`. The band fills the entire
scrolling canvas; its caption stays visible while panning. Fold the row list,
including agency requests, rather than hiding already-mounted content. Preserve
stable keys, selections, drafts and full-data calculations. Test identical
computed band/label/icon styles between both builders, pointer and keyboard
folding, view switches, resize and remount, including every group folded closed.

Inspector shift controls use shared `Seg fullWidth`: equal buttons fill the
strip, including its trailing edge. Schedule inspector marks sit beneath the
subtitle in the title's text column. Status badges reuse the shared draft-chip
geometry and type so paired badges align and wrap with a real gap. Verify both
marks together and the segment widths in both themes at desktop and phone widths.

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

### Shared time navigation

Plan, Calendar and Roster use the internal `TimeNavigator` in
`e3-ui-components/src/shared/time/navigation.tsx`; its static styling lives in
`east-ui-components/src/theme/slot-recipes/timeNavigator.ts`. Reuse it for
period navigation instead of copying another date picker. It composes the
shared Button, Seg and SliceEditPopover and uses the shared UTC calendar
arithmetic and app formatters. Keep BuilderFrame and this renderer detail out
of the public authoring API.

The full toolbar is previous / clickable current date or range / next.
Today belongs only in the date/week picker, including compact and combined
View forms; omit its duplicate from the toolbar and View menu. Arrows
step the effective view unit: Calendar Resources uses days, Roster People uses
weeks, and other layouts use their active period. Keep invalid period controls
absent. The picker's Days/Weeks choices select a date; they do not change the
main view's period. Month/year browsing changes only the open picker until a
period is selected. Week jumps preserve the selected weekday; month jumps
clamp to a shorter month's final day. All boundaries use UTC and the declared
Sunday/Monday week start.

Pass date changes through the host's existing window/Slice owner. Preserve
whole-week Roster reads and per-week drafts, and request status only for the
open picker's month. Cancel and browsing must not write the Slice. Calendar's
timeline labels the visible range and steps from its visible center; Today
recenters even if the persisted date was already today. Do not duplicate the
current date as detached toolbar text. Counts remain a separate folding item.

Test all three consumers at 1440/1024/768/390/360 and a 294px parent, in both themes:
popup Today, all valid units, keyboard selection/cancel, hover versus selected
styles, bounded reads, Slice writes, month/year boundaries and timeline
recentring. Rebuild and check the actual HTTPS showcase before reporting that
navigation changed.

Plan's time navigator uses its active scale unit (including hour, quarter and
year), preserves the visible bucket count and writes the same Slice range as
the horizon brush. Its Range panel embeds the shared `SliceRangeContent` or
`RecordSliceFieldEditor`; never create another input or filter implementation.
Date inputs reuse the existing React Aria compound date field. Retain UTC,
sub-day precision and validation of incomplete typed bounds. Numeric/ordinal
Plan axes keep their own appropriate controls.

A current week retains `aria-current`, but must not acquire a left accent rule
or inset shadow. Check a selected current week as well as a selected other week:
all examples share the same recipe and selected treatment.

Plan's toolbar offers Expand all / Collapse all over the existing per-row folds,
including nested parents. Apply the change atomically, preserve selection and
drafts, and retain overrides for evicted pages. Do not relabel the old
Group/Resource grain selector and leave its different behavior underneath.
An automatic chart maximum stays beside its heading at every chart height;
only declared axis ticks position against the plot. Test both collapsed and
expanded rows, including baseline alignment and containment.

### Loading and bounded rendering

Use the shared `useContainerBelow`/`useContainerBreakpoint` hooks, as Plan does.
Their ResizeObserver updates commit before paint; a private asynchronous width
hook can briefly render phone cards into a desktop main while BuilderFrame
settles its panes. Verify the cold load as well as settled resize behavior.
Show a loading state while the active record window is unresolved; do not
render a forecast-only empty roster as though it were loaded data.

Calendar and Roster pass their actual window-loading state to the internal
`BuilderFrame.loading` prop. The frame owns one Chakra Skeleton surface and
its loading slots in the `builderFrame` recipe. Keep its real regions mounted
and measured underneath, inert and hidden from assistive technology; cover the
whole frame rather than letting its toolbar, library and grid appear separately.
The first resolved window also waits for the mounted content's fonts after
layout measurement. Suppress initial pane-width transitions while covered.
Do not use a fixed timeout or a skeleton sized from partial content. Subsequent
loading keeps the frame, canvas, sessions and drafts mounted. Errors leave the
loading state and show the existing error treatment.
Keep the loading surface dense: body placeholders sit in fixed 40px rows with
24px-high blocks, all in the shared recipe. Never stretch a few thin text bars
through a tall host with `flex: 1` on each row. Spare body height stays empty;
short hosts clip the placeholder list. Assert row height and placeholder-to-row
height ratio at desktop and phone widths, not merely skeleton presence.

Calendar waits for every requested event source and configured backlog; Roster
waits for the active week's keyed result. An unresolved read is not an empty
week. Keep these states distinct from a confirmed absent record and from
background refreshes that still have usable data. Do not hide a missing read
behind forecast-only content or a zero-event count. Test deliberately delayed
pages and fonts, retained canvas identity, equal loading/loaded frame dimensions,
no accessible controls under the skeleton, and the first visible layout at
both desktop and phone widths in both themes.

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
