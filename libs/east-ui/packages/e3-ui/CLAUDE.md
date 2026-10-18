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
list's source with `templatesSource` (#1340): each builder that has moved onto
them takes only `Slice.bindRecords`, its sources named after what they narrow —
the Allocation, the Roster, the Calendar and the Sheet so far, the others each
in their own child of #1340. Templates are records: each list names its source
of the one `Slice.bindRecords`, and a list written in the code is refused,
naming the change to make.

A function captures what it reads, so a builder binds what a function reads of
a source before the function reads it: `recordSources` pages each source's keys
through that source's own data, and `bindScheduleKindPart` binds what an event
kind's reads call. A function that read through the slice would capture every
source's methods, each of which holds its source, and the payload would encode
them, and its decode compile them, once for each such function (#1343: so an
eight-source Calendar once held 350 MB a mount).

A record a builder reads whole beside its pages — a templates list, the
resources a check reads — binds with `Data.bind`. A UI task's manifest preloads
a record `Data.bind` reads, but not one `Record.bind` reads beside
`Data.bindPaged`: its `read()` fails on the real e3 ("record state not
loaded"), though the in-memory test harness answers it (#1343). `Record.bind`
stays the mutation door a Save commits through.

The Sheet (#1345) takes `slice={{ slice: Slice.bindRecords(key, { rows, … })
}}`. Its `rows` source gives the rows, paged from it, edited through
`onApply={Record.onApply(record, { keyed: true })}`; a sheet over `record` or
`data` takes a slice of templates sources alone. Each list is
`Sheet.templates(templates.read(), { name, group?, values, source })`, its
record bound with `Data.bind`, a grouped sheet's row templates and group
templates two records and two sources. A saved view is a
`Sheet.Types.RecordView`, every source's narrowing by name. The lens is off
until #1349: the rail filters the rows.

Until a builder has moved:

Choose the Slice arm from the source, not from the builder:

- Rows held whole: `Slice.bind(key, rows, { fields, range, search, initial,
  presets })`, then `Slice.rows(slice)`. Keep `Slice.config` for pure
  `Slice.apply` calls; do not use the removed positional binding form.
- Indexed records: declare `e3.recordIndex(name, record, { on: [fields...] })`,
  bind with `Data.bindPaged(record, { indexes })`, then
  `Slice.bindRecord(key, binding, options)`. Pass `Slice.rows(slice)` as Plan
  data, and the same handle to `slice` chrome.
  Never turn the loaded page into another local Slice or implement a browser
  predicate. Typed controls and supported combinations come from declared indexes.

The Calendar has moved (#1343). Its `slice` is one `Slice.bindRecords`, a
source named after each event kind's slot, each resource kind's slot, and each
source a templates list or a tab names. An event kind's source reads its record
through an interval index, for example `e3.recordIndex("by_status_time", events,
{ on: ["status"], interval: { from: "start", to: "end" } })`, with `range:
"start"`, and the kind gives `Data.bindPaged(events)` as its `entries`; a kind
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
`Record.bind`, and bind its browse source with `Data.bindPaged(record,
{ indexes })` and `Slice.bindRecord`. Pass `window={Slice.rows(slice)}` and
`slice={{ slice }}` to Flowchart. The Flows tab pages that ordered query through
shared `PagedLibrary`/`VirtualRows`; never fetch every flow to render or search
its cards. Record Slice owns indexed field choices, prefix search and counts.
`Find state` searches the complete open graph by state key and label; it does
not search all flow records. Keep those purposes clear in labels and examples.

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
spacing, status typography and narrow wrapping. Pass it through BuilderFrame's
footer region; keep the footer visually distinct from the body. Calendar and
Plan both consume this part. Browser tests must compare the actual rail and
item styles in both themes and check narrow overflow.

Use the shared move-preview component and `time/move-ghost.ts` recipe for event
dragging/resizing. The preview sizes to its content independently of the source
bar or edge handle. Test a short timeline event: its title must not wrap into
a few characters per line. Preserve the shared destination/refusal caption.

### Weekly records: Roster's reference case

The examples declare staff, activities, configuration, forecasts and proposals
as `e3.record` definitions; a group's skills are the activities of that group. `Data.bind(record)` provides reactive reads of a
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
it. Roster takes complete `people` and `activities` (`Roster.activities` over a
keyed activities record, its optional `order` setting the order they show in)
for coverage, costs, rest and skill/lead/trainer checks. `slice={{ slice }}` takes `Slice.bindRecords(key, { people, activities
})` alone, and the Roster reads each source's keys itself (#1342); it refuses
`visiblePeople`, `duties` and groups that carry their skills, naming the change.
Indexed visibility pages only the chosen result,
retains the previous complete membership while pending and never changes the
weekly editing session. Hidden assignment edits still Save the original week.
The staff date fields are not the week-navigation state. Bounded complete staff
may be read for domain arithmetic; never read all history or staff merely to
make filter choices or pretend to implement an indexed predicate.

The windowed example binds `Data.bindPaged` on the weeks record; the week is
the Roster's own navigation and its picker, never a Slice (ruled 18 Oct, #1342).
Seek the active week, the previous Copy source and the open picker's month only;
do not read the whole record to build the picker. Test reverse navigation.

The People tab has no filter of its own: leads, trainers, agency and skill are
rail fields of the staff record (#1342). A Find fix's leads, trainers or skill
holders are a result in the People tab, with a chip that clears it; never a
second search/filter implementation. Keep typed
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

- [east-ui library guide](../../CLAUDE.md)
- [e3-ui React renderer guide](../e3-ui-components/CLAUDE.md)
- [Shared renderer and BuilderFrame guide](../east-ui-components/CLAUDE.md#builder-frame)
- [e3 guide](../../../e3/CLAUDE.md)
- [Base UI authoring guide](../east-ui/CLAUDE.md)
