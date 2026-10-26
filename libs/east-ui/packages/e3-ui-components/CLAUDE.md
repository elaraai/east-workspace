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
same way, renders in its `BuilderFrame` too (#1245) — its canvas
(`canvas.tsx`), its toolbar's items (`toolbar.tsx`), its footer
(`footer.tsx`) and find state (`find.ts`) laid out by `index.tsx`, and over
flows by name (#1246) its Flows tab (`flows.tsx`), the open flow, kept in
the UI store (`open-flow.ts`), as LR · TD is (`orientation.ts`), each flow's
editing session (`session.ts`) — every canvas gesture one transaction of it,
each gesture's flow `edits.ts`'s (#1247) — its library pane (`library.tsx`,
#1248: the tabs `library` lists, each data tab a `Library` of its own rows'
cards), its drops (#1249: `drop.ts` plans what a card does where it lands,
pure; `use-drop.ts` is the drop target, each drop and each card's ⏎ one
transaction), its inspector (#1250: `inspector.tsx`, the end pane on by
default — Details through `FieldForm`, or a state's or a transition's own,
and Issues; what is selected, per open flow, `selection.ts`; the open flow's
issues, `issues.ts`, pure) and its words (`messages.ts`) — builds on the same
parts, and
keeps its slot recipes there too, the canvas's and the inspector's. The
Schematic's renderer (`src/schematic/`, #1384) registers against its
`Schematic` extension the same way, its slot recipe in the theme too, and
renders in its `BuilderFrame` (#1387): its frame (`index.tsx`) over its reads
of the app's records, in a component of their own (`data.ts`, #1386), which
hands the frame what it read in a task of its own — a kind read by area's
rows each made once by its `rowsOf`, and a budget's worth a read, the rest a
task later, so a window of thousands of rows landing never stutters the page
(`made-rows.ts`, #1393) — its toolbar's items (`toolbar.tsx`: the rail, the tools, held under its `id` in
`tools.ts`, the zoom and Fit, Find in `find.ts` — every item kind's record
sought by key, one read through its source through e3, never what the canvas
draws (#1404), a pick shown in the box by its key, asked again only as what
its lines say moves — and the steps), its footer (`footer.tsx`: only what is live,
ruled 23 Oct 2026 — a kind drawn as its density, a refused gesture's words,
each Save's notice and where Find's pick landed off the canvas) and its words
(`messages.ts`) — and its canvas (`canvas/`: the canvas itself,
`view.tsx`, and what it draws, the camera, the painter, the selection, the
model, the layers, the colours and the theme bridge), whose invariants are
`canvas/CLAUDE.md`'s. Every gesture that writes is one step of one history
over a session per record it writes (`editing.ts`, #1388), as the Roster's
and the Allocation's are: what each gesture writes is pure in `edits.ts`,
written through each kind's own `write` and `create` — an existing row
rewritten from the row as its session finds it (`ScheduleChange`'s
`rewrite`) — and the drafts are drawn over the stored rows (`drafted.ts`). Its
library (`library.tsx`, #1389) is the start pane: every kind's templates,
following their records' sources, and the item kinds' backlog (`backlog.ts`)
as Libraries — beside a kind read by area one paged list (`backlog-pages.ts`,
D51), each such kind's rows paged through its area index's unplaced clause, a
row its page read the original a drop rewrites; the zones' Index (`index-tab.tsx` over `index-tree.ts`), one
focusable tree around the shared virtual rows, marking the zone the viewport
is in — a kind read by area's items read by the tab itself (`index-area.ts`,
D52), an open zone's by its box and the search's through the kind's source; the Layers (`layers-tab.tsx`), the viewer's choices an East value in
the UI store under the `id` (`layers-view.ts`), which the canvas obeys — a
locked layer's entities select by no path; and an author's tabs, each
following its source. Its cards drop on the canvas (#1390): `drop.ts` plans
what a card does where it lands, pure — a template adds an item at the point,
written at the screen's resolution, or gives a link or a net of its kind its
values; a backlog row is placed; an author's card sets its `Schematic.patch`
through the kind's `set` — and `use-drop.ts` is the drop target, the canvas
its one cell, each drop and each card's ⏎ (a touch screen's tap on the
selected card) one step of the history; the canvas paints where a card lands,
and takes none of the shared stage's frame or wash. Its inspector
(`inspector.tsx`, #1391) is the end pane, given `inspector`: Details — what is
selected (`inspect.ts`), its rows read in a component of their own
(`inspector-rows.ts`), each field through `FieldForm` by its kind's form over
the fields no role writes, or its kind's own `inspector` in its place, its
details record's beside it, an item's position, a link's ends as Choosers, a
net's sides as tags, several by kind and, with nothing selected, the
drawing's counts and saves — and Issues (`issues.ts`, pure), each selecting
what it names; every edit there is one step of the history. Its narrowing
(#1392) is pure in `narrowing.ts`: each kind's source of the rail, its shown
keys read through `FollowSources` while the narrowing dims or looks at its
matches. Hidden, a kind reads only its narrowing, and a link or a net whose
ends it hides leaves the lists; dimmed, what it leaves out draws as context —
faded, greyed or a bare marker, by the recipe and the painter — and is selected
by no path. The Index, the Backlog, the inspector's Choosers, what an item is
joined to and the drawing's counts show only what it leaves in, and the matches
take the emphasis, the frame and the fit. Find lists what it leaves out too,
marked: a pick on it flies to where it stands, selects nothing, and the footer
says why, with Clear filters (#1404). Below 480px of main (#1394, D15) its
canvas pans, pinches and selects and nothing drags — no Move or Connect, no
card dragged, no drop cell or link handle — and Details takes the gestures'
place: an item's Connect to…, and the Backlog's card picked as an item with no
position, its Place, beside its Move fields, ends, sides and Delete, every
route that connects held to the host's veto (`edits.ts`' `connectVeto`). The
Allocation's renderer (`src/allocation/`, #1319) registers against its
`Allocation` tag and renders in its `BuilderFrame` the same way: its frame and
toolbar (`index.tsx`, `toolbar.tsx`); one history over a session per record it
writes, the bins' and the days' (`editing.ts`, #1372); the day's reads in a
component of their own (`data.ts`), and the day assembled from the bins the
kind's `rows` read, drafts in place (`model.ts`); the
Timeline (`timeline.tsx`) and the Table (`table.tsx`) over one drag grammar
and verdict (`drag.ts`), the app's fit called by name through the shared fit
(`fit.ts` over `shared/func/use-fit.ts`, as the Roster's), its
commands (`actions.ts`: each records the bins it changes as one step, a
changed bin's row through the bin kind's `write`, a new one's through `create`
with its arrival's `values`), its Library (`library.tsx`) and its Inspector
(`inspector.tsx`, #1331) — the end pane: Details (a refused drop's note, the
drop list while a drag or a pick is under way, else the selection, else the
summary) and Issues, on the shared inspector's head and sections, `FieldForm`
(the lane's segments and the time's stepper drawn through `renderControl`),
the Chooser laid in the pane and the meter, its words and figures pure in
`inspector-model.ts`. Every edit there is one of the board's commands, a draft
of the bins' session until Save — the bin kind's form over the fields no role
writes, or its own `inspector`, writing the row; an explicit inspection opens
Details, and a
selection a command makes keeps the tab. A drop a cell's veto refuses never
reaches a drag target's `onDrag`: its `onRefuse` hears it, which is how the
refusal's note reaches the inspector (A40). A bin split across resources
(#1332) is its parts and what they leave: Assigned to holds each part's
quantity as a field of the shared form, keyed by its resource, its Clear the
part's Unlink, the remainder in warn, and `Split…` (`split.tsx`), an anchored
popover that puts the remainder — or, on a bin wholly on its resources, a
quantity off its largest part, half of it by default (#1362) — on another
resource through the Chooser; the Table lists the parts as chips across its
Resource and Load columns with `+ resource` for the remainder, and a card's
line says what is left. Every one of them asks
the fit for the quantity it places — a part's, or the remainder's (A73) — and
each edit is one of the board's commands (`split`, `setPart`, `link`,
`unlink`). Find a fit (A74) asks the fit to place a bin's remainder and shows
the answer in the Library's Resources tab — the fits among what the rail
shows, best first, each card's reason the fit's — under a chip that clears
it, as the Roster's Find fixes do: the tab's, never a filter. Below 480px of
main (#1333, A78) the Timeline is a card per resource the rail shows — its
load line, its bins with Unlink, Move (the part, to another resource),
`Split…` (off the part there) and Back to Arrivals, and `Book an arrival…` —
and the Table a card per row in its bands, with `Book…`, `Reserve…`,
`Allocate…`, a whole bin's `Split…`, `Unlink` and `Back to Arrivals`
(`cards.tsx`): a choice is the Table's Chooser in its anchored popover
(`ChoiceCell`), `Split…` the Inspector's popover, Unlink and Back to Arrivals
act at once, every action one
of the board's commands, and nothing registers a drag source, a drop target or
a handle. The cards' looks are the shared agenda part
(`slot-recipes/schedule-agenda.ts`) the Roster's and the Calendar's cards are
on too. The segment strip
and the one chip it folds into, which the Plan's and the Flowchart's
toolbars share, are `src/shared/schedule/segments.tsx`.
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
| Author-bound Slice and window | `src/plan/root/sources.ts`, `src/plan/root/window.ts`, `src/plan/shell/Toolbar.tsx`; e3-ui's `slicePlanChrome`, `planWindows` and `planPrintWorks` examples |
| Drafts, validation, Save, retry, undo/redo | Shared `EditSession`, `EditHistory`, `historyToolbarItem` and `SessionBanners`; `src/shared/schedule/editing.ts` where the domain is event records; `src/shared/schedule/records.ts` for a builder over the app's own records (a minted key, a window kept at its revision, Publish after Save) |
| Library cards/search/tabs and inspector fields | Shared Library, Fields and FieldForm; existing builder integrations |
| Drag targets, keyboard drag, ghosts and cancellation | `east-ui-components/src/dnd/` |
| Typography, icons and visual states | `east-ui-components/src/theme/text-styles.ts`, slot recipes, `theme/icon-size.ts` |

Use the shared internal entry rather than reaching into another package's
private files. Extract a missing common part into a neutral owner and move the
existing consumer onto it too. Do not copy markup/CSS into a new component's
recipe and call that reuse. Preserve the app's data model: a builder takes the
app's own records through Schedule's kinds and writes only the fields its
roles map — the Roster's duties and the Allocation's bins are the app's rows,
never a shape of the builder's (#1365).

### Slice controls and data have one declared owner

A builder binds one `Slice.bindRecords` (#1340): its rail is
`useRecordSlicesToolbarItems`, over the shared rail, editors, choice/search/range
parts and toolbar ladder in east-ui-components; east-ui's own collections keep
the local carrier (`useSliceToolbarItems`). Honor affordances and persistence.
Its tag in e3-ui reads each source only through `recordSources(…).bind($)`,
which binds each source once in the payload, so no function the renderer
decodes carries the whole slice — every source's methods (#1356).
A builder bound to `Slice.bindRecords` reads each source's shown keys through
`shared/schedule/visibility.ts`'s `useSourceVisibility`, and every place the
source's rows appear — main, its Choosers and its Library's tabs — narrows by
those keys. While a new narrowing resolves, the last complete membership stands
in as it showed — every row, while nothing narrowed — never the keys read of
no row, so a first choice empties nothing before its own rows land (#1398). A tab over a source is `shared/schedule/source-tab.ts`' `sourceTab`,
its source read through `useSourceShown`: the cards it shows, its count (`10 of
33`), its narrowed empty state with that source's Clear filters, and its busy
pane; it has no filter of its own (#1339, #1341). A source may name itself and carry an icon: folded,
the rail heads its fields with them. A builder whose tabs follow several sources
reads each through `shared/schedule/follow-sources.tsx`' `FollowSources`, one
component a source so each one's hooks keep their order, and the builder gives
its own words for a narrowing that failed; a tab over several sources — the
Sheet's Rows tab over its templates lists, the Calendar's templates — is
`sourcesTab`, each card following its own source (#1343, #1345). A read that
lands in many settles — a window over several sources' interval indexes, each
some fifty-five key searches, which a record Slice asks as one batched request
a source (`seekAll`, #1351) — runs in a component of its own that hands the
frame what it read only when that moves, as the Calendar's
`CalendarDataReader` does: a tracked read in the frame re-renders the whole
frame at every settle (#1343). A batch re-fires its readers once, as it lands;
single searches of one source's rows launched in one turn are a burst, whose
answers the paging runtime applies as they land, re-firing the burst's readers
once its last member is done (#1360). Windows are applied to their readers once
a frame (#1398, CL9): each lands in its channel at once, and those landing
before the next frame — a fling coming to rest, the windows read ahead either
side — re-fire their readers together, so a reader draws once for them, never
once a window; jsdom draws no frame a test waits on, so the mount harness
applies them as the turn they land in ends (`setPagedLandingFrame`), and a
test's `act` sees what it read land. The Calendar reads
one date window across its event sources (#1343): the first event source holding
a range leads, its range editor the time navigator's Range panel and every event
source's range out of the rail; navigation writes the window into each, and a
range written to one is written to the others. A source still holding its seed
— the slice's `initial`, which nothing has written over (`recordSliceSeeded`) —
leads nothing: the view decides the window, the viewer's own when a reload
restores it, so a reload keeps the period the viewer left rather than the
slice's start. The view — its layout, period and date — is the page's own, held
beside the window for as long as the page's UI store holds that window
(`calendar/view.ts`, over `shared/schedule/page-view.ts`' `usePageView`, which
the Roster's week and the Allocation's day keep too, #1398): a step writes the two together, so no render reads
one without the other, and storage keeps the view for a reload alone, read once
as the page's first Calendar under its key mounts and never followed. Followed,
a second tab's step moved this page's date without its window, which put the
date back at its first day, and the timeline, centred there, re-centred a window
back, which the other tab heard in turn: both ran back a window at a time. A
narrowed kind's backlog is paged by the Backlog tab itself (#1424,
`calendar/backlog-pages.ts`), as the Schematic's is: the events in hand first —
every other kind's, read apart, and a paged kind's drafted events with no start
no page lists, each told by the row its session began from — then each such
kind's through its source with its start Unset, its choices but its window, a
page a request with the shared `PagedLibrary`, counted from the index. Nothing
reads every unscheduled event: the kind's window reads its window's rows alone
(e3-ui's `build` reads a narrowed kind's backlog with none of its seams but
`unscheduled`, which the Calendar never asks), and a draft draws where it
places its event — the shared cells reader leaving out the drafts of events
the kind's narrowing, but its window, does not hold (`windowField`, as it
leaves out a cells kind's), so a backlog event a gesture scheduled draws where
it lands and another narrowing's draft draws nowhere. A gesture placing a
paged card finds the original it rewrites in the page that listed it, at the
revision the page read it at (the editing's `reads`, `servedRow`), as the
Schematic's does. No step of the dates reads the Backlog again, so it never
blinks (ruled 25 Oct 2026); a new narrowing keeps its cards standing, retained
(CL8), until its count and first rows land (`PagedLibrary`), and its tab's
count is handed on with the list's first page, so a count is never shown
against another read's cards. Every other kind's backlog, read whole or through its backlog
index, follows no window: the Calendar reads it apart from the window, once,
and no date change empties it or reads it again (`calendar/data.ts`, #1398);
its resident Library stays mounted throughout, so its search box keeps its
query and its focus (east-ui-components' `EastChakraLibrary`'s `pending`); the
paged one has no search of its own, the rail's choices narrowing it. Its
Backlog tab counts `N of M`, what its kinds' narrowing shows beside the stored
events their choices hide — `…` until every count it says is read, never a
bare `Backlog` (CL13) — and its Clear filters keeps each window
(`shared/schedule/backlog.ts`, the Calendar's and the Plan's). The Plan's
Backlog holds its cards and their count as one too (`plan/frame/counts.ts`'
`PlanKindsReader`): retained while a narrowing's, a window's or a revision's
read of either is in flight, swapped whole once both have landed, and every
figure of the backlog — the tab's, the rail's badge, the footer's and the
inspector's — is the held read's. The Plan's
window is its sources' one range too (#1344, `src/plan/root/window.ts`): every
source holding a range of the axis's arm holds it — an event kind's, a tab's —
the first leading, and the date navigator, the horizon brush, the keys and the
resolution write each of them (`writePlanWindow`); a source that holds none
takes it unless that would replace a choice of its own
(`recordSliceWindowFits`). The canvas's rows never follow the dates: the
`rows` source and each resource kind's hold no window (`planRowSources`), so a
pan reads no row and the rows in view stay where they are; a canvas whose
slice has no source holding the window holds its own (`PlanWindowHold`), which
the same controls move, the brush's horizon the axis's stated window and the
window shown, as long again either side, so its lens slides either way. It is
kept under the canvas's storage key as its folds are
(`persisted.ts`, #813), and a remount draws it from its first frame while the
axis still allows it (`restoredWindow`), else the axis's stated window. A
record's resolution
only re-buckets, and the brush commits once a gesture, with no histogram. The
Plan reads its event kinds' rows, counts and backlog and the selected events in
components of their own (`PlanEventsReader`, `PlanKindsReader`,
`PlanSelectionReader`). An event kind placed on a paged resource kind, whose
source lists a series and a summary index (#1039) — the only form the Plan
takes there — is read a cell at a time by the shared schedule reader
(`shared/schedule/cells.ts`' `useScheduleCells`, which holds no Plan type, so
the Calendar reads through it next) through the Plan's adapter (`root/cells.ts`'
`usePlanCells`: the payload's paged seam, its links, its rows' ids and the span
store), inside `PlanEventsReader`: the blocks of fifty paged resources around
the rows in view — the canvas writes them to a span store as its scroll rests,
rendering nothing for it: the rows `VirtualRows` says its view shows (`shown`),
never the overscan mounted beside them, the span standing while the view shows
only rows not read (`shownCellSpan`) — by the tiles its read range touches,
every cell's searches in one request and the missing cells' entries in one
more, kept per revision while wanted; past 10,000 entries it reads the
summary's cells and shades, and the reader takes the root's own links, never
the ones named where the events draw. A window of the paged kind whose read
failed — the paging runtime throws its `PagedReadError`
(`platform/paged-read-error.ts`) — gives the reader no block: its band says so,
with Retry; anything else a window's read throws is thrown on
(`scheduleWindowKeys`). Every other kind the same reader counts before one of
its events is read (the kind's `count`, which every kind has): through
its source's interval index over the range the canvas reads — the count its
window's read asks first — through its day index by the days its events run
on, in the search its read asks first (an upper bound, never their number:
`countExact` false), or in memory, its record read whole. Past 10,000 none
is read or drawn, and the reader names it among the kinds past the cap
(`capped`): its rows shade from its source's summary, else they are hatched
and the banner says how many events there are — or, for a day index's count,
that they are not counted; the payload's window answers none past the cap too,
so no read of a range past it reads a page. The footer's counts and the
inspector's row facts, in components of their own, read such a kind over the
window only once its count over the range the canvas reads is within the cap
(`scheduleWithinCap`), never by what the reader last decided, which a new
narrowing outruns. A row's facts count none of a kind past the cap and say it
is not counted, never 0, and the footer names a day index's kind past the cap
as not counted (`13 events, print jobs not counted`); with nothing selected,
the inspector counts the events of a kind past the cap whose count is exact,
never its hours: the hours are those of the kinds read — none where no kind's
are — and one line names what it does not count (`Print jobs and Press check
hours not counted: too many to draw at this resolution`). A kind hidden in the
Series tab is in none of these figures, read by its cells or counted, and
nothing says so (`frame/hidden.ts`' `hides`); its backlog is the Backlog
tab's still. A selected row of the paged kind whose cells the reader does not
hold — scrolled out of the blocks read, or before the first read lands: not
in the reader's `drawn` — draws its facts as the shared placeholders
(`PlaceholderShape`), never 0, until they land, and the counts wait for a
kind's cells to land once before they count its hours. The selected events of
a kind given cells are read again as its cells move. A
paged resource kind its source narrows (#1344) pages that source's
narrowed rows themselves, in its index's order: the canvas's source over the
payload's `paged` is a live one, so a choice is a new result, the last view
standing in, retained, until its first window lands; the frame follows no such
source (`planFollowedSources`), so none of its keys is scanned; and the span
store names the narrowing the rows in view were drawn under, so a choice reads
no cell until its own rows are reported. Inside the folded editor, field editors expand inline,
with one popup and normal keyboard focus return. Never copy another control
family into a builder.

Trace every choice to the source. Plan pages its `rows` source and reads each
event kind through its own (#1344), the Sheet draws its `rows` source's
narrowing over the record's rows as the lens (#1349: e3 places the narrowing's
rows from the index, `recordSlicePlace`, and the lens reads the segments that
hold them near the view, a page and one `recordSliceWithinAt` each, never a
segment with no match) and the Flowchart pages
its `flows` source (#1346), Calendar event kinds read its interval queries, the
Roster and the Allocation read their period's events through their kind's
source, the period their navigation writes into it
(`shared/schedule/source-window.ts`), and the Roster reads the selected staff
identities for visibility only. No filtering
over resident record rows, private Slice, full scan for options or user-facing
index picker. The shared summary is authoritative N of M original records; do
not add a competing local count. It names only the sources a narrowing hides
rows of, and the Filters editor counts each source in its heading (#1358).
Search Records remains primary-key navigation, not Slice field search: the
Sheet's and the Plan's over their sources' keys, the Roster's over its staff,
the Calendar's over each event kind's record and the Allocation's over its
bins' (each one's `find.ts`, #1398, CL10). It lists the rows a query finds
wherever they are — read through the source by their place, never only what is
drawn — and the Roster's marks a row the rail's narrowing hides `· hidden by
the filters`. The Sheet's names the choices of its `rows` source that hide it,
as the rail words them — `· hidden by Status: Ready — picking it clears that
filter` — asked of e3 through the record's indexes (`sheet/hidden.ts`): each
choice alone where an index serves it, else with the choices before it on the
narrowing's index, as the rail plans them, one request a choice for the hidden
rows the box lists and no others, kept by the revision and the narrowing, the
box listing its rows again as the answer lands (the shared box's `relist`).
Until it lands the line says `· hidden by the filters`. A pick of such a row —
and Go to issue on an issue of one — clears just those choices, every choice
while e3 has not said, a write of the rail like a chip's, and goes to the row
once the narrowing they leave draws it. Its count shows and Enter jumps once
the query is found, the lines following. A pick — a match chosen from the list,
or Enter in the box — hands the keyboard to the builder's view, where the
selection's ring lands, once the match is drawn and the box has let it go, and
a step leaves it in the box (east-ui-components' `usePickHandOff`): the Sheet's
grid, its focus on the ring's cell — a hidden pick's once the narrowing it
leaves draws the row — the Plan's row, the Roster's person's name in People,
their row's or their card's, and the Allocation's bin, its Timeline card, its
Table row (focusable for it, no tab stop) or its narrow card
(`allocation/bin-focus.ts`). Where the view draws no element for the match — a
person in Shifts, one the rail hides — or the viewer has moved on, the keyboard
stays where it is. In the Roster's, the Calendar's and the
Allocation's rows its box is the first thing the row folds, to its icon,
before every step of the rail and of the builder's own items, so a row short
of room keeps the rail's chips and the period's steps live; its icon goes into
the View with the period's controls at the row's last step
(`shared/schedule/search-rank.ts`, ruled 25 Oct 2026). Elsewhere it folds
after the rail, as every host item does.

Calendar preserves overlap `[from, to)`, including carry-in events, whole-window
spans, overnight/multi-day events and instants at the lower boundary, once by
primary identity. Reuse Schedule's record-window adapter and declared interval
indexes. Do not replace overlap with a scalar start query or guessed lookback.
Precise query bounds and midnight-aligned day geometry are separate. Navigation,
shared range editors and brushes must write the same bound state.

On query replacement, retain the previous complete rows/membership and window
until the replacement lands, then swap atomically. Reset the new paging origin.
A rail's source keeps its id under every narrowing and names the narrowing it
serves (`query()`, a live source, #1354): a reader keys what it keeps by it as
by the revision (`snapshotOf`), the Plan's driver taking a new narrowing as a
new result — the last view standing in until the new one's first window lands,
whatever window read ahead lands first — the Sheet's lens keeping what it read by the revision and the
narrowing — a new choice keeps the rows and asks again which it holds — and its
key search starting afresh with each narrowing, and the visibility scan
starting again. Editing keeps the
revision alone, so a Save confirms against the record's state whatever the
narrowing.
Pending is not empty; errors retain usable data and offer Retry. Retained
content — what stands in while a narrowing, a period or a revision is read — is
`aria-disabled` in an `aria-busy` region, never `inert` (#1398, CL8, the
design system's `parts-loading-stale.html`): it stays readable and focusable
and keeps its selection, and its editing gestures are refused in code — the
shared drag sensors and drop targets and the Library's ⏎, × and add refuse
inside it (east-ui-components' `dnd/retained.ts`), and each builder's commands
refuse a write while it stands in. Keep toolbar
navigation and session Save usable. The shared BuilderFrame Skeleton owns cold
load; do not flash partial rows or cover usable data on every filter change.

Sessions/history use original record keys and stable source/view identities.
A query ID, index key or page offset must never become an edit identity. Retain
hidden drafts through filtering, paging and remount, and Save them through the
existing checked mutation. Confirm by primary reads outside the narrowing at
the committed revision; absence from the filtered result proves nothing about
Save. The Roster and the Allocation save each record's drafts by their own
keys and calculate over every person, resource and event of the period,
whatever the indexed visibility query hides.

Keep page eviction enabled and independent of sessions. `PagedRuntime` retains
at most 24 decoded windows; record Slice retains 32 windows capped at 2,048 rows
each, and the bounds of at most 1,024 landed searches a revision, so a read
again asks only the searches still pending (#1360); it keeps the counts of at
most 1,024 cells a revision, and a cell or a run a request in flight asks
waits on it — at most 32 of them — rather than being asked again (#1039). The Sheet's lens has at
most 16 pages in flight (`LENS_BUDGET`), reading the segments a view wants a
turn at a time and keeping only what that view wants (#1349). The Schematic
keeps what a kind read by area's `rowsOf` made of its rows — and its details'
— for as many as a window reads (`MAX_MADE_ROWS`, 20,000), past which the rows
a read does not ask for go (#1393). Never raise those
bounds or pin every page to make Save or a scan finish.
A read no reader waits on any longer is aborted on its way to e3 (#1398, CL6):
the paging runtime aborts a request once no channel it answers has a
subscriber, a microtask after the last one leaves, so a read the next render
asks again keeps its request. A period builder's reader reads its period's
neighbours ahead once its period has landed (`shared/schedule/read-ahead.ts`,
CL7) — the Roster's weeks, the Allocation's days, the Calendar's days, weeks
and months (`calendarAhead`) — and the Calendar's timeline the next window of
its grid the way its view last moved, as its scroll travels or as a step of
its dates went — Prev/Next, Today, a date picked, a pick of Search Records
(`timeline.ts`' `timelineAhead`, #1398, ruled 25 Oct 2026) — none before the
view has moved, and none after a layout or a period: a step or a re-centre to
one shows it at once, and the reads of the periods moved away from are
aborted.
It reads them in a tracked read of their own beside the period's
(`useReadAhead`, called after the period's read in the same reader): a page
of theirs landing re-runs that read alone, never the period's, which would
hand the frame a new read of a period that has not moved, once a page.
Use the shared session's bounded primary-read batches and retain only confirmed
facts at the committed revision. Save membership checks also accumulate facts
at one revision. Partial provider pages must resume within their bounded window.

For a complete active query, reuse `PagedScan`: retain its projected result and
next unread offset, its pages asked concurrently once its count is known, at
most four in flight (#1398, CL7), discard progress on revision/query
replacement, and release obsolete results with their tracked reader. Schedule's internal scan operation
also lets gestures reuse an active result through weak references. Do not cache
historical query results or restart at zero after each asynchronous page. Test
scans and Save batches exceeding both cache capacities, and prove that an old
page is fetched again after eviction while its draft remains intact.

Use the shared session `prepare` seam with `prepareRecordSliceSave`, then render
`RecordSliceSaveNotice` in the host's existing footer. Capture exact membership
before sending the checked mutation and recheck after primary-key confirmation.
Use SDK-maintained keys and bounded index seeks, never local predicates or page
membership. Each check takes the rows the session holds at the revision it
checks — what the request began from, at its base, and what its confirmation
read back exactly, at the revision committed — and seeks their maintained keys
(`containsRow`), reading by its key only an entry they do not hold: a Save of a
copied week's 316 duties reads none of them again. Count only entries
leaving this query and new entries saved outside it; an already-hidden edit is
not an exit. Query changes clear feedback. A failed
preparation sends no mutation and preserves drafts; a failed feedback read offers
a read retry, never another Save. An indexed source's `recordId` names the primary
record across all index lists and must back the shared editing identity.

### Flowchart records and indexed Flows lists

One flow is one complete record entry. Bind the mutation door with
`Record.bind`, and narrow the flows through the `flows` source of the one
`Slice.bindRecords`: `Data.bindPaged(record, { indexes })` over the same record,
passed as `slice={{ slice }}` (#1346). The Flows tab pages that source through
shared `PagedLibrary`/`VirtualRows` and counts what it shows (`Flows 683 of
2,048`), the count read in a component of its own (`FlowsCountReader`); never
fetch every flow to render or search its cards. Record Slice owns indexed field
choices, prefix search and counts; the Flows tab's own search (`PagedLibrary`'s
`search`) pages the narrowing and the search's prefix through the source's
`pageWhere`, never writing the rail (#1340, ruling 11). Each templates list and
each tab that names a source follows it through `FollowSources`, as `sourceTab`
draws it. `Find state` searches the complete open graph by state key and label;
it does not search all flow records. Keep those purposes clear in labels and
examples.

Computed filters use the index's own key type, including values derived from
nested graph data. Scalar keys use the index name; Struct keys expose their
named components. Never require a second field-type declaration or evaluate
index functions over every record in the browser. Keep one-field fan-out
filters to exact single-value membership so a flow with repeated nested values
appears and counts once. Composite single-key indexes support combined choices;
unsupported combinations must be explained by shared Slice, never approximated
with loaded-page filtering. The example must cover a computed key changing on
Save through real e3, in addition to primary-key draft retention.

The open graph is read separately by its original primary key. Filtering the
list must not close it, split its states across pages, or discard its drafts.
Sessions use the primary record identity and original flow name, independent
of the browse query. A save that moves the flow outside the narrowing still
confirms through primary reads and reports the shared Save notice. Keep a
pending session's confirmation subscribed when the user opens another flow.
New-flow, rename and duplicate checks must look up the destination primary key,
including names outside every loaded page and active filter.

Use shared cards and card-sized recipe skeletons for pending rows. Do not wrap
loaded cards in a text-line Skeleton: its fixed height breaks virtualization
and makes cards overlap. Assert adjacent card bounds and bounded mounted counts.
At phone widths, bundle orientation and Find state into the shared search
popover's final View form before history folds; Filters and Save must remain
inside the toolbar and clickable. Exercise indexed search, far scrolling,
Save leaving a filter and draft retention in one real e3 workflow per device.

### Schematic windows, drafts and the narrow layout

A kind read by area (#1393) is read through its window (`schematic/area.ts`):
the viewport the canvas writes to a store of its own, padded by the largest
card's half, planned by e3-ui's `schematicWindowPlan` — the area index the
rail's exact choices lead, else the one led by none, the rest asked in one
`within` — every cell not yet found in one request, and past 5,000 rows in
view the index's density raster (`schematicRaster`). `made-rows.ts` makes a
window's rows a budget a read, a frame drawing between, and keeps at most
`MAX_MADE_ROWS`. The Backlog pages the index's unplaced clause
(`backlog-pages.ts`) and the Index reads a zone's items by its box
(`index-area.ts`). Never read the record whole for any of them, and keep the
record slice's bounds on landed searches.

Every gesture writes through `editing.ts`' sessions, one a record, by original
key, and `drafted.ts` draws the drafts over the stored rows: a drafted row no
window holds draws where its draft places it, so Find's pick flies to it
there; a row Find finds that nothing draws is flown to where its record
stands, and selected once it draws.

Below 480px of main (`useContainerBelow` on the canvas's element, committed
before paint, #1394) the canvas registers no drag: the tools in force drop
Move and Connect (the stored tool is kept), library cards don't drag, and the
drop cell and the link handles go. Details carries the gestures —
`inspector.tsx`'s `ConnectTo` and the Backlog card's `UnplacedView`, its
Place — through the same edits, each held to the host's veto (`edits.ts`'
`connectVeto`, a verdict kept per pair). On a phone the View bundles the
tools, the zoom, Fit and the steps; the steps join it as a selection appears,
folded even while Find's query holds the View (the shared toolbar's held
bundles keep a joining member at the bundle's form). Test the narrow flow in
a real browser at 390 and 360px and in a 294px parent — tap, Connect to…,
Place, Find, Save and a remount — with Save reachable while a rack is
selected (`schematic-phone.spec.ts`, `schematic-records.spec.ts`).

### Frame, editing and narrow content

Let BuilderFrame own pane placement, rails, responsive overlays and focus.
Supply its named regions; keep main's scrolling inside main. Compose one
folding Toolbar using shared item ranks and menus, with history folding last.
A row with nothing left to fold bundles host controls into the shared key
search's compact popover, one move, as the Flowchart's orientation and the
Sheet's views do (#1345); a control there that moves the focus away closes it.
The Plan, which has no key search over a rail, bundles its fold toggle, its
resolution and its overlaps chip into the date navigator's View, one move
(#1344): a phone's row holds the rail's icon, the View and the history item.
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

What scrolls under a sticky column or head passes under it. A plot or grid that
a scroll takes under sticky parts is a stacking context of its own (`isolation:
isolate` in its slot), so what it raises over itself — the shared now line
(z 7), a drop's ghost, a dragged event — never paints over a resource's name,
an hour or a head; and nothing it draws reaches past its edge onto a sticky
part beside it, so the time grid's today dot sits wholly inside its day column
(ruled 20 Oct). A part raised above the board's other layers (a selected
Allocation card over the links) stays under the sticky heads' z. The
Allocation's resource rows and lane pane, and the Calendar's day columns,
month and timeline rows, are held to it in both themes by paint-order checks
(`elementFromPoint`, the probed layer taking the pointer) in the responsive
suite.

### Tests run on e3 itself

A renderer test that reads, pages, saves or calls does so on e3 itself, never
a stand-in that answers at once and says what the test wrote (#1375). Each test
file starts e3-web in its own process (`src/e3-web.test-utils.ts`). It deploys
the package of the e3-ui example modules the file names, made by e3-ui's
examples' package step (`@elaraai/e3-ui/examples-package`, as the showcase's
packages are, one a showcase area), and each test gets a workspace copied
from it.
`src/e3-web-mount.test-utils.tsx` mounts an example as the showcase does:
`E3Provider` over the test's workspace, `ReactiveDatasetProvider`, and the
example's reads loaded first and polled while it shows.

- **Counting.** What a test counts it reads from the request log (`h.requests`), and what e3 answered from a tap of its answers (`h.e3.answers`).
- **Faults.** A held or failed request is a fault at the harness's fetch (`h.e3.hold`, `h.e3.fail`): e3's own failure, `network`, `lost` (committed, its answer never arriving) or `untagged` (its answer's tags dropped). An answer slow on its way back is `h.e3.holdAnswers`, and a unit e3 runs, held before it starts, `h.e3.holdUnits`.
- **Another session.** Another session's change is a real commit through the record's patch door (`h.patch`), a write (`h.write`) or a run (`h.run`); a Save it overtakes is `h.race`. A workspace deployed and not run is the node harness's `h.unrun`.
- **Waiting.** `settle()` waits until no request is in flight and React has flushed. It waits on real time, so a test's fake clock stands still meanwhile. e3's client retries a lost answer under the same idempotency key, and a backoff between its tries is a timer `settle()` cannot see, so a test waits for what the user sees then.
- **Mounting.** `h.mount` settles once what the example reads has loaded, it has rendered and a first poll has told it e3's status, so the run that status brings lands before the test begins. It takes a counted `program`, a `view` the test renders itself under the example's reads, a `wrap` around the page (a locale), a `host` inside e3's providers (calls or plan options of its own) and a `token`. `h.install` installs the runtimes alone, for a program or a hook outside a mount, and `E3Surface` renders a component of the test's own over the file's e3. A builder's fit is asked through `fitCalls` (`shared/func/fit-calls.test-utils.ts`), and a Plan canvas's rail is bound through `bindRail` (`plan/rail.test-utils.ts`).

A runtime spec under `node --test` (`test/*.spec.ts`) takes the same e3
through `test/fixtures/e3.ts`: `e3Spec(modules)` deploys the modules once for
the file and gives each test a workspace of its own. A runtime reads e3
through its default API over the harness's fetch (`h.cache`, `h.bindRecord`),
and an e3-ui East function — a tag's payload, a Schedule kind — compiles
against the platform its UI task's preview gives it (`h.platform`): its
manifest derived, what it reads whole loaded and polled, each runtime scoped
to the manifest. A read answers `none` until what it waits on lands:
`h.ready` reads it until it does, and `h.inFlight` until a hold holds what it
waits on. e3-ui's own specs keep what reads no e3 — a payload's build, a
refusal, a type — compiled against a platform whose every handle refuses
(e3-ui's `test/refusing-platform.ts`).

A jsdom test runs under `vitest.setup.ts`, which gives bytes one realm, as a
browser page has, and refuses the global `fetch`: a test whose request does
not go through the harness's fails, naming it (`test/fetch-guard.spec.ts`).
The package's lint refuses a stand-in in a test or a test's helper — the
in-memory record and function APIs, a mock of e3's client, a stub of the
global fetch — naming the harness (`test/stand-in-lint.spec.ts`).
e3-ui-components declares no e3 SDK. A definition a test
needs, such as a patch door another session writes through or a checked door
that refuses, goes into the e3-ui example module it belongs to.

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

### Links that are drag grips, and lines that follow the pointer

The links' look is one look on two surfaces (#1403): its measures — the
casing, the round corner, the head, the hit reach, the caption's knockout and
the lit link's ring — are `src/shared/links/look.ts`'s, which the SVG layer
draws with, and the Canvas2D painter beside it (`canvas.ts`) draws the same
look for a host whose links are painted: the Schematic's links and nets, their
ends on their items' edges, in the colours and the caption's font its theme
probe reads from the theme's `linkRibbons` part, as the Plan's are drawn in.
The routes stay each host's own.

The shared links layer (`src/shared/links/layer.tsx`) draws only what a host
opts into beyond Plan's links, and Plan opts into none of it: a `grip`, the
host's component drawn in each link's line and in each caption that takes the
pointer, spreading the host's drag handle on them (the shared drag engine
takes an SVG element as a draggable); `guides`, thin lines from the pointer
into rows; `lights={false}`, nothing lit while a drag is under way; and a link
drag's `preview`, its `was` line and the new line. The preview and the guides
follow the pointer past the bounds' clip: the host's box cuts them, and they
draw over the captions. The Allocation's Timeline uses them all (#1328): every
link of the day is numbered once (`links.ts`' `linkIds`), so the grip a drag
starts on outlives the families the drag draws in the focus's place
(`dragFamilies`, A65). What follows the pointer (`PointerLines`) is the only
part drawn again as the pointer moves, its point read from the page's pointer
moves while a button is held, so a keyboard's drag draws no new line; each
link's words are made once for the day as drafted (A35). Where a drag rests is
the board's `DragRestStore` (`drag.ts`), which each drop target's
`dropTarget(drag, target)` sets as the drag rests on it and lets go through
the engine's `onLeave` as the drag leaves it; the marks on the cards and on the
runs' labels (A29) and the links read it outside React's renders. A new drop
target of the board's, such as a fit in the inspector's drop list (A26, A34),
is `dropTarget(drag, { kind: "resource", resource })` at
`rowCoord(drag.surface, resource)`, as a resource row is.

### Footer rails and drag previews are shared parts too

Use the same footer rail recipe as Plan, not just its text style. The shared
`builder-footer.ts` owns the panel background, top rule, 28px desktop rail,
spacing, status typography and the one loading line (#1398, CL3):
east-ui-components' `LoadingLine` in a slot of its own at the rail's trailing
end, on the builder's one reveal clock (`LoadingReveal` around its frame, read
where it shows with `useRevealed`, so its flips render the line and the
placeholders and never the frame: shown after 150 ms, held at least 300 ms; a
failure at once), its words the builder's — over a paged
source `pagedLoadingLine`, over a period `periodLoading` and
`periodLoadingLine` (`shared/loading.ts`), in the record's noun
(`recordSliceNoun`) and the builder's message table. A rail carrying the line
never wraps and never cuts a word: each legend item is a unit of its fit
(`data-footer-unit`, `data-footer-cut` from `useFooterFit`), `FooterMore` ends
a cut legend, and the fit keeps the legend whole and in place as the line
comes and goes, the line in its full text, its short form or its dot alone.
An item the flex layout shrinks — the Sheet's message, which ellipsizes —
takes the rail's slack and is marked so (`data-footer-slack`): the fit weighs
it at no width, never at a width that moves with its own choice, which looped
it on a phone.
Pass it through BuilderFrame's footer region with `liveFooter`, so the line
and its Retry stay live under the cold-load cover; keep the footer visually
distinct from the body. Plan, Sheet, Roster, Calendar, Allocation and the
Schematic all consume this part. Browser tests must compare the actual rail and item styles
in both themes and check that the rail stays one line at narrow widths, no
word cut.

Use the shared move-preview component and `time/move-ghost.ts` recipe for event
dragging/resizing. The preview sizes to its content independently of the source
bar or edge handle. Test a short timeline event: its title must not wrap into
a few characters per line. Preserve the shared destination/refusal caption.

### The app's own records: sessions per record

The Roster and the Allocation write the app's own records (#1365): the
Roster's duties, weeks and targets, the Allocation's bins and days. Each record
is a session of its own under one history (`roster/editing.ts`,
`allocation/editing.ts`, over `shared/schedule/editing.ts`'
`useScheduleEditing`, as the Calendar's kinds are): a gesture that changes rows
of several records — accepting a proposal writes a duty and the week's
dismissal — is one step, Save sends each record's changes as its own request
through its patch door, and a conflict or refusal keeps that record's drafts
and leaves the others' commits standing. Unconfirmed writes keep the draft and
the same retry identity. Each draft is decoded once: a session keeps an
entry's version the same object until a gesture replaces it. Drafts of every
week or day stay in their sessions, so navigating, the rail and a remount
keep them, and Save includes them. The Schematic writes each of its kinds and
their details so (#1388), a whole row at a time through the kind's own
functions, a draft the rail narrows out waiting in its session. The period's
own reads of each record — its events' window, its own row, the Roster's
targets — are what a gesture's
original and a Save's confirmation read, each kept at the revision it was read
at (`shared/schedule/records.ts`' `keptAtRevision`, `heldInWindow`,
`periodRowRead`); a row they do not hold is read by its key. A Save confirms
every row they hold in one pass (`EditHistoryPaged.held`), and reads only the
rest by key, a bounded batch at a time.

The period is assembled from the app's rows, never stored. A reader of its own
(`RosterDataReader`, `AllocationDataReader`, as the Calendar's is, #1343) reads
the period's events through the kind's `rows` — each stored row's roles beside
its bytes, in one pass — the period's own row through the periods' `rows`, the
open picker's month through the same as one span, and the Roster's targets
through theirs. It keeps what it read by its bytes, so a row read again as it
was keeps its decoded row, and hands the frame what it read only when that
moves; a period it has not read is never drawn as empty. The model places
each row with the drafts in place (`roster/model.ts`' `placeStored` and
`placeDrafted`, the Allocation's `binOf`), its domain compiled once per row
type, East deciding which types are the same. Each command works out the
period as it leaves it, then records the rows it changed: a changed row
through the kind's `write`, every field no role maps as it was; a new one
through `create` — a booked bin's with its arrival's `values` — under a key
minted unique among every key the builder holds (`mintKey`,
`crypto.randomUUID()`). Publish saves first, and only once every record reads
back as saved writes the period's status and saves the periods
(`publishPeriod`): a failed save leaves the period a draft, its drafts kept.
The builder writes its period into its kind's source of the slice
(`shared/schedule/source-window.ts`), so the rail's summary counts the
period's events and a Save's notice reads the window it reads.

The Roster's pay is asked a person at a time (`roster/model.ts`'
`RosterPayCache`, B17): once per person with duties in the week and once per
agency with requests, each answer kept by the bytes of that person's duties,
so a change asks again only for the people it touched; a new context or week
asks everyone again. A call that throws is a banner naming the person, whose
duties show no cost. Coverage, the inspector's totals and the app's check are
given the answers.

Keep **visibility separate from calculation scope** when the domain requires
it. Roster's author binds staff and activities with `Data.bind`/`Record.bind`
for its calculations, and narrows them through `Slice.bindRecords(key, {
<duty slot>, targets, people, activities })`, which the Roster reads itself
(#1342). The complete `people` and `activities` values still drive coverage,
pay, rest, skills and lead/trainer checks. Never calculate a misleading
surplus by filtering people out of the roster's arithmetic. Hidden edits still
Save.

The week is the Roster's own navigation and its picker, never a Slice chip
(ruled 18 Oct, #1342), as the day is the Allocation's. Each builder's view is
the page's own, as the Calendar's is (`roster/window.ts` and
`allocation/window.ts` over `shared/schedule/page-view.ts`, #1398): held beside
the window it writes into its source, storage keeping it for a reload alone,
so another tab keeping a view moves neither the period nor its window.
Followed, a second tab's step moved this page's week or day under the viewer,
its window after it, with what Publish and the history act on. Read the period's
window; the Roster's week before only while the week holds no duty of its own,
Copy's source; and the open picker's month. Do not read a whole record to
build the picker. Test reverse navigation.

The People tab has no filter of its own: leads, trainers, agency and skill are
rail fields of the staff record (#1342). A Find fix asks the app's fit
(`roster/fit.ts`, #1334) through the shared fit (`shared/func/use-fit.ts`), as
the Allocation's board asks its own (`allocation/fit.ts`): one question in
flight, the latest asked first, answers kept by question, drafts and context,
asked again when the drafts or the context change. `ask` is theirs: an effect
that asks, listing it, asks again then; one that asks through something else —
the Allocation's Library foot, through a drop's verdict — lists the context
itself, since a record committed under a builder changes its context and keeps
its drafts. The People tab shows the answer — the fits among what the rail
shows, best first in the fit's order, each card's reason the shared Library's
note line — with a chip that clears it. While its answer for the drafts as
they are is on its way the tab shows no verdict, only what the rail shows,
busy (F2), and the fix reads `Finding…`; a failure is a warning banner with
Retry. Never a second search/filter implementation, and no local
predicate decides who fits. Without the payload's `fit`, no Find button. Keep a
kind's own inspector and the targets' own form on the same guarded commands as
dragging and mobile forms; they cannot replace a duty's person or bypass
published/read-only state. Pure coverage and rule functions live in e3-ui and
are compiled once per row type for the renderer, so a task and the screen use
the same arithmetic.

At main width below 480px, both Shifts and People become explicit-action cards;
no drag source or target remains registered. Test both layouts, target editing,
proposal acceptance, restore and Save/remount. Test the final toolbar forms at
360px with every action present: date picking, view, history and Publish must
all remain reachable. Mark each legend item a unit of the footer's fit, so a
rail too narrow for the legend ends it at a whole item, then "…", and never
wraps. Use Font Awesome for every mark, as for other icons; avoid text glyph
substitutes.

Test the actual contained width as well as viewport width: a 360px showcase
viewport leaves a 294px frame after padding. Combine week and view controls
in a final shared-toolbar fold before history, keeping date picking, navigation
and Publish reachable. Desktop proposals use the mock's single-line dashed chip
with quiet Font Awesome actions; mobile cards keep labelled Accept/Reject.

Keep the footer to the legend and the one shared loading line (ruled 22 Oct
2026, #1398). Roster explains its five coverage marks —
permanent, agency staff, requested, open and hours needed (`roster/footer.tsx`;
overtime is the app's pay's to say) — Calendar its configured event kinds
(`calendar/footer.tsx`) and Allocation its layout's marks (`allocation/footer.tsx`),
using the existing marks/icons and the
shared footer rail; the line says the period being read (`Loading 12–18 Mar`),
a source's new narrowing (`Filtering people…`; the Allocation's, whichever
source it narrows, `Filtering bins…`: the board waits for which of its bins
show) or a read that failed, with Retry, and nothing while nothing is in
flight. Do not repeat status, pending
edits, counts, costs or hours there: shared history/toolbar controls and the
inspector already own them. The legend stays whole and in place as the line
comes and goes; measure that it stays one line at narrow widths. (The Sheet's
and the Plan's footers also carry their counts, pending changes and saved
times. The Schematic's holds only what is live, ruled 23 Oct 2026: a kind drawn
as its density, how many rows it shades in the view — `Density: 20,000 racks —
zoom in to draw them` — a refused gesture's words, each Save's notice and where
Find's pick landed off the canvas; its counts and saves are the inspector's,
its changes waiting the history's. Its notices are one item of its rail
(`data-footer-slack`) beside the shared line — `Loading racks in view`,
`Loading counts`, `Loading details for 12 racks`, `Filtering racks…`,
`Couldn't read racks in view` — which wraps within itself where main is
narrow, an item wider than it wrapping its own words, so the rail itself never
wraps.) The inspector retains complete coverage/cost totals and explains
whole-staff scope when Slice narrows visible people. A collapsed Library badge reports availability
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
the footer's fit (`useFooterFit`) measures those styles before fitting legend
items and the loading line.

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
whole-week Roster reads and every week's drafts, and request status only for
the open picker's month. Cancel and browsing must not write the Slice. Calendar's
timeline labels the visible range and steps from its visible center; Today
recenters even if the persisted date was already today. Do not duplicate the
current date as detached toolbar text. Counts remain a separate folding item.

Test all three consumers at 1440/1024/768/390/360 and a 294px parent, in both themes:
popup Today, all valid units, keyboard selection/cancel, hover versus selected
styles, bounded reads, Slice writes, month/year boundaries and timeline
recentring. Rebuild and check the actual HTTPS showcase before reporting that
navigation changed.

Plan's time navigator uses its active scale unit (including hour, quarter and
year), preserves the visible bucket count and writes the window into every
source holding it — or, while none holds it, into the canvas's own — as the
horizon brush does (#1344). Its Range panel embeds the leading source's
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
render a targets-only empty roster as though it were loaded data.

`BuilderFrame.loading` is for cold load only (#1398, CL5): a builder's first
read, before anything it shows has landed — the Sheet's and the Plan's paged
rows too. A period step, a narrowing or a new revision never covers: it keeps
the toolbar, panes, selection and Save live, and passes `BuilderFrame.busy`,
which puts `aria-busy` on main while the footer's loading line says what is
read. The frame owns one Chakra Skeleton surface and
its loading slots in the `builderFrame` recipe. Keep its real regions mounted
and measured underneath, inert and hidden from assistive technology; cover the
whole frame rather than letting its toolbar, library and grid appear separately
— all but a `liveFooter`, whose loading line carries the pulse.
The first resolved window also waits for the mounted content's fonts after
layout measurement. Suppress initial pane-width transitions while covered.
Do not use a fixed timeout or a skeleton sized from partial content. Subsequent
loading keeps the frame, canvas, sessions and drafts mounted. Errors leave the
loading state and show the existing error treatment.
Keep the loading surface dense: body placeholders sit at the component's own
row pitch (`BuilderFrame.loadingPitch` — the Sheet's density's, the Plan's row
geometry, the Allocation's 36px rows, the Calendar's hour), each a 12px bar,
all in the shared recipe, so the skeleton matches what it covers.

The Sheet and the Plan draw the rows they have not read as the shared
unloaded run (east-ui-components' `UnloadedRun`, #1398, CL2; `SheetRunRow`,
`PlanRunRow`): rows at the rows' own pitch where the run meets the view — the
Sheet's with its gutter, its columns' rules and a flat sheet's real row
numbers, each cell its column kind's shape; the Plan's with its label bars and
its plot washed under its grid and now line — one item of the virtualizer
however long the run, and to the grid one row, its one cell across it, busy
while its windows are read. The Sheet keys a run by the elements it stands for
(`band:<at>:<from>-<to>`), so a run that comes to stand for others — a window
landing beside it, or leaving it — is another item and never keeps the height
the frame measured for the last: on a fractional device pixel ratio a run
measures off its estimate, the virtualizer keeps that height by its key, and
keyed by its side alone a far drag's rows landed a window away from where
their placeholders stood (`sheet-far-moves.spec.ts`). On the Plan and a flat sheet that row sits at its
first row's place and counts as the rows it stands for, so the grid's
`aria-rowcount` is every row, read or not (CL12; the Plan's `gridPlaces`). A
failed window is said once, in its run's first
row in view, with Retry (CL11). No caption sits in a gap. They read on intent
(CL6): the window under the view once the view has dwelt 100 ms over a run or
slowed below a viewport per 200 ms — by how far it travelled, never where it
ended, so a view sent far and straight back is still on its way
(`VirtualRows` reports such a scroll at rest) — two windows ahead the way it
travels and one behind (`travelOf`). Both drivers, the Sheet's
(`sheet/paging.ts`) and the Plan's (`plan/controller/paging.ts`), do it through
one windowed part (`shared/windowed.ts`): the windows read once each, their
failures and the revision's stand-in, the run around the view and the bands
either side of it, the element a band's report names, a failed window's span,
the demand at rest, the first window, a jump's pin and Retry. The
footer's line and the frame's `busy` follow the windows the view shows, never
those read ahead of it. An empty message, a zero count, `No rows`, `Backlog
clear` or the Sheet's insert strip shows only once a completed read says so
(CL13): until then its slot holds a placeholder — the Plan's narrow tail its
placeholder cards, its Backlog `…` over placeholder cards. A Backlog tab's count
says `…` while what a narrowing hides of it is still counted, too — a cold load
with a narrowing restored draws `Backlog …`, then `Backlog 1 of 8`, never a bare
`Backlog` between (#1424; the Plan's and the Calendar's, each tested by every
state its tab is drawn in).

A period builder — the Roster, the Calendar, the Allocation — draws its
period through one read state (`shared/loading.ts`' `periodRead`, #1398):
the period as read; a period not read yet — its geometry and what is known
without its read at once (the Roster's people and dates, the Allocation's
lanes, slots and resources, the Calendar's own grid, never the old period's
events under its labels), a placeholder where its content goes, unseen at its
footprint until the frame's one reveal clock says so (`LoadingReveal`), which
the footer's line keeps too, and a region whose items have no known place
washed (`LoadingWash`); or one whose
read failed — its geometry, its cells blank, the failure said once, as a line
in its first row in view (`LoadingFailedLine`: the Roster's first person's
days, the Allocation's lane cells or Table row, the Calendar's timeline row
and agenda) or, where no row can hold one, a box at the grid's top-left in
view (`LoadingFailedBox`: the Calendar's time and month grids), and on the
footer's line — never a "… unavailable" status over the grid. A period not
read gives no issue and counts nothing (`…`); a true empty is said once, only
after its read (the Allocation's `No bins on …`, `LoadingEmptyLine`). The
toolbar's status, issues, history and Publish hold their slots from cold load
(`heldToolbarSlot`): unread, the status and the issues are placeholders, the
history as the last period read had it, and Publish in its slot, off,
wherever it cannot publish; the rail's summary keeps a narrowed source's place
while its count is read.

The Calendar's timeline continues what it shows (#1398): the timeline draws a
bounded window of days on a fixed grid — 15 on Day, 56 on Week, 154 on
Month, each starting a whole number of half windows (7, 28 and 77 days) from
the epoch (`calendar/timeline.ts`) — and as the view comes within 240px of an
end of it, the window moves on to the grid's next one that way, the scroll by
as much, every instant where it was on screen; the view's date becomes the
day under its middle, so a reload opens that window again where the view was.
Every route that moves the timeline's dates behaves as its scroll does (ruled
25 Oct 2026): a re-centre, Prev/Next from the view's middle, Today, a date
picked, a pick of Search Records and a period changed on the timeline. Until
the window it goes to lands, the held read stands in — the frame's
`continuing`, while the held read was drawn on the timeline: its events at
their real dates, wherever they cover the instants on screen, in the lanes the
period they were drawn at gave them (the views' `lanesPeriod`) — every row
its height, so the scroll keeps its offset — its booked hours, its overlaps
and its Backlog, stale and retained (CL5, CL8), and no commit marks it unread.
Beyond the held read, placeholders only: the days of the window it does not
cover are washed (the views' `covered`), and a figure over the days shown says
`…` only where the view has passed beyond it. Landed, the rows take the new
lanes with the row in view anchored, and the next window the way the view
moved is read ahead. The grids keep their own rule: a step of a time or month
grid, or of the agenda, to a period not read yet — or a layout changed, into
the timeline too — holds none of the old period's events, whose columns are
another period's days.

The Schematic (#1398) keeps what it drew while a read is in flight: its last
complete drawing, and once it has settled once, a kind's rows as they land,
before their details — each a row drawn before keeping the details it had,
each new one carrying the card roles its details give (`drawn.ts`' `pending`,
from its kind's `roles`). It washes what of the view a kind read by area has
not drawn (`LoadingWash`): each such kind's window whose rows or cells' counts
are in flight, less the reach its drawing holds (`area.ts`' `unreadArea`), in
a layer under the grid, the paint and the cards that follows the camera's
variables (`boxCss`), so what is drawn shows over it. A card draws a
placeholder in each role its details give until they land (the shared `fill`
shape in its dot and its meter's track), the painter a marker whose status is
unread so (`statusUnread`) — hearing the reveal clock through a ref, never a
render of the canvas — and the inspector the fields of a row it has not read
(`Form`'s `pending`). A kind's failed read is said once on the canvas — a
`LoadingFailedBox` with Retry at the top-left of the area it could not read
in view, or the canvas's for a kind read whole — and on the line, never in a
banner; a followed source's failure and a session's keep their banners, as
every builder's do. While a new narrowing is read — a kind's rows, or the keys
a source the frame follows shows — what the canvas drew under the last stands
in (CL8, the loading design's retained card): kept (`data-schematic-stale`),
its grid's rules dashed in the strong rule and its words, the cards' and the
painter's, in the third ink, every item's edge, dot and bar as it was; and
retained, as long as a followed source's new narrowing could not be read too:
`aria-disabled` but while a failure is said on the canvas, panning and
selecting, and taking no edit by any route — no Move, Connect or re-target
starts, no drop lands, and the editing's `available` and `record` refuse Del,
a card's ⏎ and Details — until it lands, the look lifting in the commit that
lands it.

Never stretch a few thin text bars
through a tall host with `flex: 1` on each row. Spare body height stays empty;
short hosts clip the placeholder list. Assert row height and placeholder-to-row
height ratio at desktop and phone widths, not merely skeleton presence.

Calendar waits for every requested event source and configured backlog; Roster
waits for the week's reads — its duties, its own row and its targets — and the
Allocation for the day's (`RosterDataReader`, `AllocationDataReader`). An
unresolved read is not an empty week. Keep these states distinct from a
confirmed absent record and from background refreshes that still have usable
data. Do not hide a missing read behind targets-only content or a zero-event
count. Test deliberately delayed
pages and fonts, retained canvas identity, equal loading/loaded frame dimensions,
no accessible controls under the skeleton, and the first visible layout at
both desktop and phone widths in both themes.

Calendar tracks page arrivals in its window reader, a component of its own
outside the frame (`CalendarDataReader`, #1343). Keep the displayed window
stable while partial results arrive: the reader must keep advancing without
rebuilding the toolbar, library and canvas for every page, and it hands the
frame its read only when what the frame shows moves. Loading, errors and the
next complete window still update the frame immediately. It reads in two
tracked reads (#1398): the window — every kind's events, a kind narrowed
through its source its window's rows alone (#1424) — and the backlog of every
kind no source narrows, apart, asked over no window; its first read lands
whole, the frame hearing of neither until both have. The drafts every kind's
seams are given are the shared reader's (`cells.drafts`). Every kind is counted before one of its
events is read (#1424), by the shared schedule reader through the Calendar's
adapter (`calendar/cells.ts`), in the same component: within
`SCHEDULE_EVENT_CAP` over the window the window's read reads it — once its
count there says so (`scheduleWithinCap`), never by what the reader last
decided — and past it none is read or drawn but its drafts. A view that lays
its resources out — the timeline's rows by its period, the Resources view's
columns by the day — shades each resource of a kind such a kind is placed on
from the kind's source's summary, the Plan's booked-vs-free bar along each
period (`calendarBuckets` cuts the window into whole periods as e3 tiles
them), or hatches it where no summary divides the period; the banner says how
many events there are and where they show; and every figure that would count
them — the toolbar's count, a day's, a resource's booked hours — says they are
not counted (`shared/schedule/words.ts`' `eventsNotCounted`, the Plan's footer
words too), never 0. What the reader read is held with the window's read
(`CalendarData.cells`), so the frame hears of it only as it hears of the
window, whole.

A resource kind may be paged (#1424, `Calendar.resources(Data.bindPaged(…))`):
its resources come a window of 200 at a time (`calendar/pages.ts`), read in a
component of their own (`CalendarPagesReader`, over `shared/windowed.ts`'
store) around the places the views report they show — the timeline's rows by
`VirtualRows`' `shown`, the Resources view's columns by a range of its own
(`COLUMN_OVERSCAN`, a 100 ms dwell) — to a store only that reader and the
window's read hear (`createPagedDemand`), so a scroll renders no frame. A
place not read yet is the shared unread row (`TimelineUnreadRow`) or an empty
column track; a window whose read failed is said in its first row in view, or
a box at the grid's top-left, with Retry; and the footer's line reads the
kind's windows (`pagedLoadingLine`, `Loading presses 401–600`). An event kind
placed on it is read a cell at a time where the view lays its resources out,
by the shared reader through the Calendar's adapter (`calendarCellsPaged`,
`calendarCellSpan`: the first and the last held row among the places shown,
standing while the view shows only places not read): the blocks of fifty
around them by the tiles the window touches, every cell's searches in one
request and the missing cells' entries in one more; a row whose cells have not
landed draws the wash, busy, and its booked hours a placeholder
(`drawnRows`). The time grids and the agenda count such a kind over the window
first, as any other. e3-ui refuses such a kind read any other way, naming the
series and the summary index to declare. A source of the slice named after the
paged kind's slot narrows its windows themselves: a new narrowing is a new
result, the last view standing in, retained, until its windows land, and the
frame follows no such source (`followedSources`). The inspector's resource
Chooser over the kind is the shared key search (`calendar/chooser.tsx`'s
`PagedChooser`, through `FieldForm`'s `renderControl`): it seeks the kind
through its paged read by key and lists the windows it lands in, each line the
resource's name and its meta; an event names its resource by the windows held,
else by its key.

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

### Keeping place, seeking and drawing only what moves (#1398)

A collection keeps where its view rests by its top row's key and the px into
it — never a pixel offset of the whole — saved as its scroll settles and brought
back once its rows are laid out (`shared/schedule/row-anchor.ts`' `useRowAnchor`
over `VirtualRows`' `onAnchorChange` and `restoreAnchor`): the Roster's People
rows and cards, the Calendar's timeline and the Allocation's Table, as the
Sheet's and the Plan's are kept. A narrowing keeps the Sheet's anchor row by its
key where the narrowing holds it — drawn already, or sought where it is as a key
search's jump is, and put back once drawn — and else starts at the top; the
Allocation's Table keeps the line its view rested on so too, once the
narrowing's rows are in (`useRowAnchor`'s `narrowing`: the board's narrowing as
text, the bins' own choices and its lanes', resources' and arrivals'). A
bounded Plan keeps the row at the top of its view across a new narrowing of its
paged rows — the `rows` source's or a paged resource kind's (#1344) — by its key
and the px into it where the new rows' first windows draw it, and else starts
at the top, telling the paging driver nothing of where the view rested
meanwhile; it seeks none, a narrowing's searches running in its index's order. The
Calendar's time grid keeps the hour at its top across a step, a layout and a
remount (`gridHour`), never back to the morning, and Today brings the now line
into view a third of the way down, on today too. The People rows' estimates are
their kinds' real rows, measured from the first mounted (`useRowFloors`, on the
device-pixel grid, `devicePixels`), and every row anchors, so a jump past rows
not drawn stays where it was put as they mount — never pulled back.

PageUp and PageDown cross a run not read in the Sheet and the Plan: fetch, then
move — the window a page on asked for and the ring, or the focus, landing a page
on once it is in (the Sheet's `seek.step` with its `page`, the Plan's `page`
intent), never at the loaded edge — as Home and End do for the source's first
and last rows. In the Plan the focus waits on the row it set out from, never on
the run, and the view where it is (`root/keyboard.ts`' `fetch` and `edge`
moves), ↑ and ↓ past the rows read the same; Home and End read the far window
where the view is, pinned as a key search's jump is (the controller's
`jumpToEdge`). A run that holds the focus — a click into it — hands it, as its
rows land, to the first of them the view shows whole, and a key pressed on it
waits for them and goes on from there (`wait`); an item a landing takes off the
canvas leaves the focus on the canvas's surface, never the page's body, until a
row takes it. ↑ and ↓ on a person's name in the
People grid step to the next person or the one before, past the groups' bands
and their agency requests, selecting them and focusing their name, its ring
drawn.

A scroll draws only what it brings into view: `VirtualRows` draws a mounted row
again only as its index or `renderRow` moves, so a builder keeps `renderRow` the
same function while what its rows show holds, and a row drawn again only as what
it shows changes is a memo whose props hold — the People grid's rows and days,
its week's duties indexed once by person and day, its Library's cards made once.
The Calendar's timeline virtualises its resources' rows in their groups, and
their events by what the view shows of the period, one view either side; its
scroll publishes the days it shows to a store only what says them reads
(`calendar/visible.ts`: the navigator's date and label, the count, each row's
hours, the overlaps chip and the inspector's overlaps), so a scroll draws
nothing else, and a day crossed only those. The overlaps chip counts the
overlaps in the days shown (`shared/schedule/overlaps.ts`'
`scheduleOverlapsIn`, #1398), so it moves as days come into view and never as
the window re-centres; the frame hears only whether there is one to show. Its
scroll, and a step of its dates, publish which way it travels to a store of its
own, which the window's read alone reads, to read ahead the next window of its
grid that way.

A kind read by its cells (#1039) over a paged kind says which resources' rows
draw what is known of them (the shared reader's `drawn`, through `usePlanCells`;
its `reading` only there, where rows wait on it): a row whose cells never
landed — before the first read, or scrolled into view — or are on their way over
a range they were not read over, a window moved, draws the shared wash under what
it holds, busy, on the Plan's one reveal clock, and the footer's line reads the
kind (`Loading print job events…`); a read again over the same range, a commit's
or another narrowing's, leaves the cells standing in, retained. A window the view
shows and then its rows' cells are one wait: what the view showed at its last rest
that is not read yet — a run on its way, rows whose cells have not landed — keeps
the line and main busy between the two reads (the canvas's `viewAwaits`), which
the cells are asked only once the view has said which rows it shows, so the
reveal clock never sees two waits each too short to say.

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
