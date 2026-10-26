# e3-ui

The author-facing bridge between e3 and east-ui. `ui()` declares a UI task;
`Data`, `Record` and `Func` bind workspace data and operations into its
reactive UI. Component tags and their typed payloads live here. React
renderers live in `e3-ui-components`.

Follow [STANDARDS.md](STANDARDS.md), the canonical
[UI prop patterns](../../../../docs/conventions/EAST_UI_PROP_PATTERNS.md)
and [East interop conventions](../../../../docs/conventions/EAST_TS_INTEROP.md).
This guide adds builder-specific decisions; it does not replace those standards.

## Developing a component that uses BuilderFrame

### Establish the API and reuse before implementation

Read Plan, Studio and Query on the actual dependency branch. Search the tested
example index for the intended capabilities, then inspect the matching example
and implementation. A mock is evidence for domain layout and workflow; it is
not the authority for shared component behavior or typography. Do not treat
another unfinished component, including Calendar, as the standard merely
because it is the most recent implementation.

Before building a new API, present a concrete minimal example and a full bound
example, including Slice, editing and the narrow layout. List the existing
components, hooks and recipes to reuse. Record mock conflicts as mock behavior,
existing behavior, proposed behavior and consequence. Resolve domain choices
with the user, and update the issue/spec with accepted decisions.

| Concern | Owner |
| --- | --- |
| Public JSX tag, domain types, validation and accessor adaptation | This package |
| Internal frame composition, interaction and rendering | `e3-ui-components` |
| BuilderFrame, Toolbar, Slice controls, editing, Library, FieldForm and theme recipes | `east-ui-components` and its shared contracts |
| Pure domain calculations used in tasks and UI | Reusable, tested East functions |

**BuilderFrame is hidden from application developers.** The public component
owns its frame; authors supply domain data and configuration. Do not expose
frame assembly or invent parallel framed/frameless APIs without a requirement.
Keep tag factories to validation, typed accessor adapters and payload assembly.
Do not emit an East program implementing layout, sessions or gestures there.

### Bind data and Slice as Plan does

Bind editable records with their mutation doors inside `Reactive`. Resources,
templates, backlog and configuration accept reactive records, inputs or tasks;
backlog remains part of the authoritative event record.

A builder's tag checks its `slice` with `utils/record-sources.ts`'
`recordSources`, a Library tab's `source` with `tabSource`, and a templates
list's source with `templatesSource` (#1340): every builder takes only
`Slice.bindRecords`, its sources named after what they narrow — the
Allocation, the Roster, the Calendar, the Plan, the Sheet, the Flowchart and
the Schematic.
Templates are records: each list names its source of the one
`Slice.bindRecords`, and a list written in the code is refused, naming the
change to make.

A builder reads its sources only through `recordSources(…).bind($)` (#1356),
the first thing its payload's block does: it binds each source's part, its
narrowed data and its keys once. A function captures what it reads, so one
reading a source through what `bind` returns holds that source alone; one that
read through the slice would capture every source's methods, and beast2 writes
a captured value wherever a function holding it is written (#1343: an
eight-source Calendar once held 350 MB a mount). An event kind reads its
part's members inside its own functions. `test/utils/record-sources-captures.spec.ts`
holds every example to it: no function captures the whole slice.

A source's narrowing is read where its rows are read, never where the builder
is built (#1354). The bind reads no state and returns one handle per binding,
whatever its narrowing: its narrowed data is a live source
(`Paged.Types.LiveSource`), whose id names the source alone and whose reads
read the narrowing when they run, `query()` naming it. A choice re-renders the
readers of the source — its rows, counts, tabs and the rail — and builds no
builder again: the payload is not encoded, decoded or compiled again. A
builder's payload block never reads a source's state (`read()`): that read
would build it again at every choice. Each builder's narrowing spec holds it
(`a filter change rebuilds no builder`): a choice runs the builder's body no
more and decodes no payload.

A record a builder reads whole beside its pages — a templates list, the
resources a check reads — binds with `Data.bind`. A UI task's manifest preloads
a record `Data.bind` reads, but not one `Record.bind` reads beside
`Data.bindPaged`: its `read()` fails on the real e3 ("record state not
loaded"), though the in-memory test harness answers it (#1343). `Record.bind`
stays the mutation door a Save commits through.

The Sheet (#1345) takes `slice={{ slice: Slice.bindRecords(key, { rows, … })
}}`. Its `rows` source gives the record's rows, every one in the record's
order, paged from it, edited through `onApply={Record.onApply(record, { keyed:
true })}`, and its narrowing is drawn over them as the lens (#1349), a filtered
spreadsheet: only the rows the narrowing keeps, one after another, each at its
row number, e3 placing the narrowing's rows from the source's index alone and
the renderer reading only the segments that hold them near the view. A sheet
over `record` or `data` takes a slice of templates sources alone. Each list is
`Sheet.templates(templates.read(), { name, group?, values, source })`, its
record bound with `Data.bind`, a grouped sheet's row templates and group
templates two records and two sources. A saved view is a
`Sheet.Types.RecordView`, every source's narrowing by name and the folds left
on it.

The Flowchart (#1346) takes `slice={{ slice: Slice.bindRecords(key, { flows, …
}) }}`. Over `record`, its `flows` source — `Data.bindPaged(record, { indexes
})` over the same record — narrows the Flows tab, which pages and counts it;
without one the Flows tab lists the record read whole. `window` is refused.
Over `data`, the host's flows or the flow `Flowchart.over` builds from the
host's tables, nothing narrows the flows: the slice holds only the sources its
templates lists and tabs name. Each list is `Flowchart.library.states(
templates.read(), { …, source })` (or `transitions`) over a keyed record bound
with `Data.bind`, each card keyed by the record's key, so a list takes no
`key`; an app's tab that names a `source` follows it by the key its `key` gives.

The Plan (#1344) takes `slice={{ slice: Slice.bindRecords(key, { … }) }}`. Its
`rows` source gives the canvas its rows, paged from it in its index's order —
`data` is left out — edited through `editing.onApply` (`Record.onApply(record,
{ keyed: true })`). A source named after an event kind's slot reads that kind's
events and its backlog through its interval index, as the Calendar's sources
do; one named after a resource kind's slot narrows that kind's rows — of
resources read whole and keyed by String, the rows and the bulk edit's Chooser
its keys show; of a paged kind (`Schedule.resources(Data.bindPaged(record),
…)`), the canvas's windows, paged from the narrowing's rows themselves in the
source's index's order (`Data.bindPaged(record, { indexes })` over the kind's
own record), never a window of every resource filtered by key, so a choice
reads the narrowed resources in view and their cells alone
(`planSeriesByHall`, `planRecordIndexes`, #1344). Every source holding a `range` of the axis's arm
— an event kind's, a tab's that lists what is in the dates on screen — holds
the window with the others: the date navigator, the horizon brush, the keys
and the resolution write each of them. The canvas's rows never follow the
dates on screen: the `rows` source and a resource kind's take no `range` — the
tag refuses one as the Plan is evaluated, naming the change — and a date field
there is a field of the rail the viewer sets. A slice with no source holding
the window leaves the canvas its own, which the same controls move, reading no
row; a reload opens on it, kept for the viewer as the canvas's folds are. Each
templates list is `Schedule.templates(templates.read(), { …,
source })` over a record bound with `Data.bind`, an instant kind's giving no
`duration`, and each tab that names a `source` follows it. An event kind
placed on a paged resource kind is read a cell at a time (#1039): its source,
named after its slot, lists a series index and a summary index beside its
interval index, and it shades from the summary zoomed out (`planWindows`,
`planRecordIndexes`); read any other way — no source, its record whole or the
days in view through a day index, a source listing its interval index alone
or a summary and no series, or placed beside another resource kind — it is
refused, naming both declarations over the kind's own fields. Every other kind
is counted before one of its events is read — through its source's interval
index; through its day index, by the days its events run on (an event once a
day, so an upper bound, never their number: `countExact` false); or in
memory, its record read whole — and past 10,000 in the range the canvas reads
none is read or drawn: its rows shade from its source's summary, else they
are hatched and the banner says how many events there are, or, for a day
index's count, that they are not counted. A resource's row in the inspector
counts none of a kind past the cap, and says so, never 0; with nothing
selected the inspector counts such a kind's events where its count is exact,
never its hours — the hours those of the kinds read — and names it, one line
for all it does not count. A kind hidden in the Series tab is in none of the
footer's or the inspector's figures, and nothing says so.

The Schematic (#1386) takes `slice={{ slice: Slice.bindRecords(key, { … })
}}`. Each of its kinds — `Schematic.items`, `zones`, `links` and `nets`, keyed
by its slot — is bound as it is read. Read whole, an editable kind binds
`Record.bind(record, [e3.mutation.patch(record)])` and a read-only one
`Data.bind(record)`. A source of the slice named after the kind's slot reads
it complete through that source instead, the kind giving `entries:
Data.bindPaged(record)` beside its `Record.bind`, or bound
`Data.bindPaged(record)` alone, read only. An indexed read is the source,
never the kind's record. Hidden — the default — a narrowed-out row is never
read; under `narrowed="dim"` (#1392) the kind reads every row through its
source, never its narrowing, so a choice reads no row again, and the renderer
draws what the narrowing leaves out as context, from the source's shown keys. A kind's details (`Schematic.details`) are bound as
their kind is read: whole beside a kind read whole, by key beside one read
through its source. Each templates list is `Schematic.templates(
templates.read(), { name, group?, values, source })` over a record bound with
`Data.bind`, and its layers are the app's rows too — `Schematic.layers(
systems.read(), { label, order?, tone?, color?, … })` over a record bound with
`Data.bind`, as the Roster's lists are (#1401). Its shapes are accessors over
the row's own fields (`footprint: (u) => some(Schematic.circle(u.radius))`),
so no record of the app's holds a type of the Schematic's. Its props are the
Plan's: `id`, an `inspector` opted into (a kind's own Details its kind's
`inspector`), `onSelect` over the whole selection and `canConnect` answering
a candidate with the refusal's words. The inspector (#1391) edits each kind's
fields no role writes — its `fields`, the `Fields` hints over its row — and
its details record's, bound with its patch door beside the kind, and a kind's
`ready` checks a drafted row; `fields`, `ready` and `inspector` are typed over
the kind's own row (`RecordSide<R>`). The library's tabs are
`Schematic.library`'s, each over every kind as the Calendar's are:
`templates()`, `backlog()` (every item kind's rows with no position), the
zones' `index()` and the `layers()`, drawn in the frame's start pane
(#1389), each card tab following its source of the rail; the Layers tab's
choices are the viewer's, kept under the `id`. Its cards drop on the canvas
(#1390): a template's `values` give a new item every field but its centre,
and a link or a net of its kind every field but its ends or sides; a backlog
row is placed; an author's tab's `drop`, a `Schematic.patch(R, { … })`, sets
those fields on an entity of `R`'s kind through the kind's `set`, a wire
function over the row's field setters — `schedule/fields.ts`' `fieldSetters`,
which the Schedule kinds' `field` gesture writes through too. Every gesture is one step of one history
over a session per record it writes (#1388): Move writes an item's centre,
Connect a new link under a key minted unique, a Shift session the net it grows
into, Retarget and Extend a link's end and a net's side, and Del the rows it
deletes — every link and net leg naming a deleted item among them — each
through its kind's own write, so only its roles' fields move; Save sends each
record's changes through its patch door as a request of its own. A kind bound
read only takes no gesture.

A builder takes neither `Slice.bind` nor a single `Slice.bindRecord`; east-ui's
own collections — a Table, a Library, a Deck — keep their own Slice
(`Slice.bind(key, rows, { … })` over rows held whole, read through
`Slice.rows(slice)`). An indexed record narrows a builder as a source of its
one `Slice.bindRecords`: declare `e3.recordIndex(name, record, { on: [fields...]
})` and bind `Data.bindPaged(record, { indexes })`. Never turn the loaded page
into another local Slice or implement a browser predicate. Typed controls and
supported combinations come from declared indexes.

The Calendar's `slice` (#1343) is one `Slice.bindRecords`, a
source named after each event kind's slot, each resource kind's slot, and each
source a templates list or a tab names. An event kind's source reads its record
through an interval index, for example `e3.recordIndex.interval("by_status_time",
events, { on: ["status"], from: "start", to: "end" })`, with `range: "start"`,
and the kind gives `Data.bindPaged(events)` as its `entries`; a kind
takes no `slice`, `filter`, `window` or `backlogWindow` beside its source. The
Calendar's navigation writes its window into every event source's range, and
the leading source's range is the time navigator's Range panel, never a chip of
the rail. A resource kind's source narrows its columns, rows and Choosers; a
templates list (`Calendar.templates(rows, { …, source })`) and an app's tab
(`source`) each follow the source they name. Templates are records: a list
written in the code is refused. Overlaps, checks and commands read every event.
Existing day-index consumers remain supported separately.

Calendar means overlap with `[from, to)`: preserve carry-in, whole-window,
overnight and multi-day events once by original primary key. An instant at
`from` is included; one at `to` is excluded. A missing end on a scheduled
optional event projects as an instant, without changing its stored row.
Never substitute a scalar start range, guessed lookback, loaded-page filter or
whole-record scan. Interval indexes add at most three entries per event and
exact prefix, independent of duration. Queries use one start range plus at
most 54 disjoint carry-in ranges; counts sum bounds without fetching rows.
Keep Set-field narrowing single-member so duplicate fan-out cannot inflate counts.

The controls alone are not integration. Trace toolbar changes into the source;
record ranges are half-open while the existing local wire stays inclusive.
Preserve supplied UTC precision in state and queries. Day-column layout may
align to midnight without rewriting those bounds. Navigation and brushes write
the same range; test external Slice writes in the other direction.

Sessions retain drafts/history by original primary key independently of queries,
index keys, pages and view membership. Save includes hidden entries and confirms
through primary reads at the committed revision. A filtered-out row is neither
a deletion nor evidence that a mutation completed. New unsaved rows are a
separate draft layer; do not append existing hidden drafts to another narrowing.
Existing Search Records remains primary-key navigation, separate from field search.

Page eviction must never evict session drafts or history. Keep the existing
bounded page caches: saving more entries than a cache holds must still finish.
Accumulate confirmation and filter-membership facts by original identity at one
revision, independently of cached rows. Do not require every edited page to be
resident simultaneously. Verify hidden edits, eviction, Undo/Redo, remount and
checked Save together with a batch larger than the cache capacity.

After confirmed Save, shared `RecordSliceSaveNotice` reports rows that actually
left the active narrowing. Use `prepareRecordSliceSave` through the shared
session lifecycle; capture membership before the mutation and resolve it again
after primary-key confirmation. Reuse the SDK's maintained index-key functions
and bounded seeks, never a browser predicate or loaded-page membership. Existing
hidden edits do not count as exits; new records outside the narrowing do. Clear
the notice when the query changes. A feedback retry never resubmits a mutation.
The indexed binding's `recordId`, unlike its query/source ID, is independent of
which index declarations a view lists and is the shared editing identity.

### Flowchart records and indexed Flows lists

One flow is one complete record entry. Bind the mutation door with
`Record.bind`, and narrow the flows through the `flows` source of the one
`Slice.bindRecords`: `Data.bindPaged(record, { indexes })` over the same record.
Pass `slice={{ slice }}` to Flowchart. The Flows tab pages that source through
shared `PagedLibrary`/`VirtualRows` and counts what it shows (`Flows 683 of
2,048`); never fetch every flow to render or search its cards. Record Slice owns
indexed field choices, prefix search and counts; the Flows tab's own search
finds within the narrowing by the source's `search` fields through its
`pageWhere`, never writing the rail (#1340, ruling 11). `Find state` searches
the complete open graph by state key and label; it does not search all flow
records. Keep those purposes clear in labels and examples.

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

### Schematic records, windows by area and the narrow layout

Each kind is one of the app's records, keyed by String, its fields mapped to
the Schematic's roles (#1386), and the tag refuses any other binding, naming
the one to use: editable `Record.bind(record, [e3.mutation.patch(record)])`,
read only `Data.bind(record)`, and beside a kind read through its source of
the one `Slice.bindRecords`, `entries: Data.bindPaged(record)`. A kind whose
source lists an area index (`e3.recordIndex.area` over the kind's own box —
its `x`, `y`, `width` and `height`, `at: "centre"`) is read by area (#1393), a
window at a time from the index alone: list one led by no field, which a
window reads through whatever the rail chooses, and ones led by the rail's
fields beside it. Never read such a record whole — not to draw, not to fill
the Backlog (the index's unplaced clause) or the Index (a zone's items by its
box), not to save (a Save confirms by key). Past 5,000 rows in view the kind
draws the index's density; never a mark per row past it. Its details record
is keyed as the kind is, read by key beside a kind read through its source
and by the window's runs of the index beside one read by area.

Drafts are kept by each row's original key in its kind's session, whatever
the window, the narrowing or a remount: a row moved off the window it was read
in draws where its draft places it, Save writes it through the patch door, and
a window there reads it back once the index has moved it. Test it on e3: a
move, the view taken to the floor's far end and back, Save, and a remount
reading it back — by the mouse on a desktop and through Find and Details on a
phone (the showcase's `schematic-records.spec.ts`).

Below 480px of main nothing drags (#1394): no Move or Connect among the
View's tools, no draggable card, no drop cell and no link handle. The
inspector carries the gestures — an item's Connect to… and a Backlog card's
Place, beside its position, a link's ends, a net's sides and Delete — each
through the same edits as the canvas's, and every route that connects held to
`canConnect`. Include the phone-width frame with its inspector
(`schematicRecordIndexesMobile`) and an editable frame with no pane
(`schematicHandover`), and on a phone test Save reachable with a rack
selected and Find's query standing, as well as with nothing selected.

### Examples show the complete component definition inline

Each example's `fn: East.function(...)` must show its own `Reactive` bindings,
component JSX, Slice wiring, configuration and custom UI callbacks. Do not hide
the UI in another exported function and show only `surface(true)` inside a Box.
An example is the public DX, the displayed showcase source and a tested program.
Its reader should be able to see how to build that component without chasing
an implementation helper.

Shared module-level types, records, mutations, indexes and seeded data are
appropriate: they identify the e3 units an example binds. Define UI composition
and custom inspector callbacks within the example. Reuse implementation in
the library; do not obscure example authoring to remove a few repeated lines.

Include runnable examples for the minimal API, a full bound surface, read-only
behavior, windowed data and a phone-width container. Use real e3-web sources
and mutation paths, not renderer-only fixtures. A mobile example must demonstrate
its useful content and actions, not merely a collapsed desktop pane.

### Verify the first complete workflow early

Before multiplying views, demonstrate one bound edit through Save and remount,
with shared toolbar/library/inspector, desktop and narrow content, and correct
computed text/icon styles. Use the [renderer guide](../e3-ui-components/CLAUDE.md)
for the interaction, styling and browser checks. Cover Slice-driven page reads,
filter changes and original-key writes, not just filter-chip appearance.

Run the applicable build, test and lint gates from the standards. Keep examples
and their behavioral tests paired. Update API documentation and this package's
canonical [SKILL.md](SKILL.md) when the authoring surface changes, then regenerate
and commit plugin indexes/materialized assets. Rebuild the actual showcase and
verify its examples and displayed code before saying the preview is updated.

### Footer rails and drag previews are shared parts too

Use the same footer rail recipe as Plan, not just its text style. The shared
`builder-footer.ts` owns the panel background, top rule, 28px desktop rail,
spacing, status typography and the one loading line (#1398): what the builder
reads, in its record's noun, or why it could not, with Retry — never a count
of what has landed. A rail carrying the line never wraps and never cuts a
word: its legend's items are units of its fit, cut whole, "…" ending a cut
legend. Pass it through BuilderFrame's footer region with `liveFooter`; keep
the footer visually distinct from the body. Plan, Sheet, Roster, Calendar,
Allocation and the Schematic all consume this part. Browser tests must compare the actual rail
and item styles in both themes and check that the rail stays one line at
narrow widths, no word cut. The renderer guide has the parts' names.

Use the shared move-preview component and `time/move-ghost.ts` recipe for event
dragging/resizing. The preview sizes to its content independently of the source
bar or edge handle. Test a short timeline event: its title must not wrap into
a few characters per line. Preserve the shared destination/refusal caption.

### The app's own records: the Roster's reference case

A builder stores nothing in a shape of its own (#1365, `Builder Interfaces
Spec.md`). The Roster writes the app's duties, the weeks of its rota and its
cover targets — each an `e3.record` of the app's, bound with
`Record.bind(record, [e3.mutation.patch(record)])` — and reads its staff,
agencies, shift times, teams, positions, activities and suggestions with
`Data.bind(record)`, as it reads inputs and task outputs; the binding name does
not change the source's storage kind. The tag declares them through Schedule's
kinds and the Roster's own accessors: `Schedule.events` for the duties (the
roles `start`, `end`, `resource`, `shift`, `group`, `position`, `activity` and
`hours`), `Schedule.resources` for the people and the agencies,
`Schedule.periods` for the weeks, `Roster.targets` for the cover, and
`Roster.shifts`, `groups`, `positions`, `activities` and `proposals` for the
lists. Keep these declarations visible alongside the examples so reference
data is clearly record-backed. The Allocation is the same over its bins, its
days, its lanes and resources and its arrivals.

The week is assembled from the app's rows, never stored. The renderer reads
the week's duties through the duty kind's `rows` — each stored duty's roles
beside its bytes, in one pass — the week's own row through the periods' `rows`
and its targets through theirs, and places each duty in its slot, its day the
UTC day whose shift start is nearest its start, with the drafts in place. A
duty whose shift or group isn't configured, or that names no one, is listed in
Issues and kept as stored. Coverage, checks and the views read that week, and
each assignment carries its duty's own row, untouched, for the app's
functions.

One history spans the records: each is a session of its own, and a gesture
across them — accepting a proposal records the duty and the week's dismissal —
is one step. Save sends each record's changes as its own request through its
patch door; a conflict or a refusal keeps that record's drafts and leaves the
others' commits standing, and an unconfirmed write keeps its draft and the
same retry identity. Drafts of every week stay in their sessions: switching
weeks, filtering or resizing discards none, and Save includes them. Publish
saves first, and only once every record reads back as saved writes the week's
status — the periods' published case, with the time when it holds one — and
saves the periods, so a published week never sits over unsaved rows. A new
duty's or target's key is minted unique among every key the Roster has read
and drafted (`crypto.randomUUID()`).

Pay is the app's, asked a person at a time (§5.6): the app's East function
over one person's duties for the week, or one agency's requests, answers each
duty's cost by its own pay codes. The renderer asks it again only for the
people whose duties, or whose duties' rows, changed; totals the answers by
duty, slot, day, week, person and code; and gives them to the app's check. A
call that throws is a warning naming the person, whose duties show no cost.
The Roster knows no pay code in advance and works out no cost of its own.

Keep **visibility separate from calculation scope** when the domain requires
it. Roster takes complete `people` and `activities` (`Roster.activities` over a
keyed activities record, its optional `order` setting the order they show in)
for coverage, pay, rest and skill/lead/trainer checks. `slice={{ slice }}`
takes `Slice.bindRecords(key, { <duty slot>, targets, people, activities })`
alone, and the Roster reads each source's keys itself (#1342); it refuses
`visiblePeople`, `duties` and groups that carry their skills, naming the change.
Indexed visibility pages only the chosen result, retains the previous complete
membership while pending and never changes the editing sessions. Hidden duty
edits still Save by their own keys. The staff date fields are not the
week-navigation state. Bounded complete staff may be read for domain
arithmetic; never read all history or staff merely to make filter choices or
pretend to implement an indexed predicate.

The week is the Roster's own navigation and its picker, never a Slice chip
(ruled 18 Oct, #1342): it writes the week's window into the duty kind's source
of the slice — an interval index from `start` to `end`, `range: "start"` — so
the rail's counts and a Save's notice read the window the Roster reads, and
the weeks are read by key through the periods' `entries`. Read the week, with
the twelve hours either side a duty's start may stand from its shift's; the
week before only while the week holds no duty of its own, Copy's source; and
the open picker's month. Do not read a whole record to build the picker. Test
reverse navigation.

The People tab has no filter of its own: leads, trainers, agency and skill are
rail fields of the staff record (#1342). A Find fix asks the app's fit (#1334):
`fit` is `Func.bind` of an `e3.function` from `Roster.Types.FitRequest(R)` to
`Roster.Types.FitResult`, `R` the duty row type — the Allocation's contract —
its issue's need and slot over the drafted week and the complete staff,
whatever the rail shows. Its answer is a result in the People tab — the fits
among what the rail shows, best first in the fit's order, each card with the
fit's reason — with a chip that clears it; never a second search/filter
implementation, and the renderer decides no one itself. Without `fit` no Find
fix is offered. `Roster.fit(R)` (the need held, not rostered that day, rest
kept; the slot's group, then spare contract hours) and `Roster.answer(R)` are
the ready-made East parts. Keep the duty kind's own inspector and the targets'
own form on the same guarded commands as dragging and mobile forms; they
cannot replace a duty's person or bypass published/read-only state. Pure
coverage and rule functions live in e3-ui and are compiled once per duty row
type for the renderer, so a task and the screen use the same arithmetic.

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
2026, #1398). Roster explains its five coverage marks — permanent, agency
staff, requested, open and hours needed; overtime is the app's pay's to say —
Calendar its configured event kinds and Allocation its layout's marks, using
the existing marks/icons and the shared footer rail; the line says the period
being read (`Loading 12–18 Mar`), a source's new narrowing (`Filtering
people…`) or a read that failed, with Retry, and nothing while nothing is in
flight. Do not repeat status, pending edits, counts, costs or hours there:
shared history/toolbar controls and the inspector already own them. The legend
stays whole and in place as the line comes and goes; measure that it stays one
line at narrow widths. The Schematic's footer holds only what is live (ruled 23
Oct 2026): a kind drawn as its density, how many rows it shades in the view, a
refused gesture's words, each Save's notice and where Find's pick landed off
the canvas — its counts and saves are the inspector's, its changes waiting the
history's — and the shared loading line beside them, in a kind's noun: what
is read (`Loading racks in view`, `Loading counts`, `Loading details for 12
racks`), a source's new narrowing (`Filtering racks…`) or a read that failed,
with Retry. A kind's failed read is said on the canvas too, never in a banner.
The inspector retains complete coverage/cost totals and
explains whole-staff scope when Slice narrows visible people. A collapsed
Library badge reports availability for the day, while tab counts report the
library's item count.

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

`BuilderFrame.loading` is for cold load only (#1398): a builder's first read,
before anything it shows has landed. A period step, a narrowing or a new
revision never covers: it keeps the toolbar, panes, selection and Save live,
and passes `BuilderFrame.busy`, which puts `aria-busy` on main while the
footer's loading line says what is read. The frame owns one Chakra Skeleton
surface and its loading slots in the `builderFrame` recipe. Keep its real
regions mounted and measured underneath, inert and hidden from assistive
technology; cover the whole frame rather than letting its toolbar, library and
grid appear separately — all but a `liveFooter`, whose loading line carries
the pulse. The first resolved window also waits for the mounted content's
fonts after layout measurement. Suppress initial pane-width transitions while
covered. Do not use a fixed timeout or a skeleton sized from partial content.
Subsequent loading keeps the frame, canvas, sessions and drafts mounted.
Errors leave the loading state and show the existing error treatment.
Keep the loading surface dense: body placeholders sit at the component's own
row pitch (`BuilderFrame.loadingPitch` — the Sheet's density's, the Plan's row
geometry, the Allocation's 36px rows, the Calendar's hour), each a 12px bar,
all in the shared recipe. The Sheet and the Plan draw rows not read as the
shared unloaded run — the builder's own rows at their pitch where the run
meets the view, never a caption in the gap — read the window under the view on
intent, ahead the way it travels, and say a failed window once in its run's
first row in view. A period builder draws a period not read yet with
its geometry at once — never the old period's content under its labels — and
placeholders where its content goes, says a failed read once in place (a line
in its first row in view, or a box at a grid's top-left where no row can hold
one), says a true empty only after its read, and holds its toolbar's status,
issues, history and Publish in their slots from cold load. The Schematic keeps
what it drew while a read is in flight and washes what of the view a kind read
by area has not drawn; a card draws a placeholder where its details go until
they land, as the inspector's fields do, and a failed read is said once, in a
box at the top-left of the area it could not read. The renderer guide names
the parts. Never stretch a few thin text bars
through a tall host with `flex: 1` on each row. Spare body height stays empty;
short hosts clip the placeholder list. Assert row height and placeholder-to-row
height ratio at desktop and phone widths, not merely skeleton presence.

Calendar waits for every requested event source and configured backlog; Roster
waits for the week's reads — its duties, its own row and its targets — and the
Allocation for the day's. An unresolved read is not an empty week. Keep these
states distinct from a confirmed absent record and from background refreshes
that still have usable data. Do not hide a missing read behind targets-only
content or a zero-event count. Test deliberately delayed
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

- [east-ui library guide](../../CLAUDE.md)
- [e3-ui React renderer guide](../e3-ui-components/CLAUDE.md)
- [Shared renderer and BuilderFrame guide](../east-ui-components/CLAUDE.md#builder-frame)
- [e3 guide](../../../e3/CLAUDE.md)
- [Base UI authoring guide](../east-ui/CLAUDE.md)
