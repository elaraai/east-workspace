# Plan Builder — design

The e3-ui `Plan`: the axis-aligned planning canvas moves from east-ui to
e3-ui, plans events of several kinds across resources on its one shared axis,
and is laid out in `BuilderFrame` as Studio's builder, the query builder, the
Calendar and the Roster are: one toolbar, a library holding every kind's
templates, the backlog and the series list, the canvas in main, and an
inspector. Resources and events are the Calendar's own, one shared contract,
`Schedule`, so the same records drive a Calendar and a Plan.

It is one component, `<Plan>` (decision 16, #1191): it renders in its frame
wherever it is used, its library and inspector are optional props, and its
rows come from event kinds over records, from `data` laid out by its series,
and from read-only `rows`. The first design's two components, `<Plan.View>`
(the canvas, as the east-ui `<Plan>` was) and `<Plan.Builder>` (event kinds in
the frame), are gone; where a section below still says "the builder", it is
`<Plan>`.

This document is the design the Plan and Sheet builders' epic builds for
Plan; `Sheet Builder Spec.md` beside it is the Sheet's. Each sub-issue copies
the sections it owns.

## 0. The files

| File | What it is |
|---|---|
| `Plan Builder Spec.md` | This design. |
| `Plan Spec.md`, `Plan Spec.html`, `Plan Spec v2.html`, `Plan Data Interface.md` | The canvas itself, unchanged: the axis, the eight row kinds, series, rollups, links, review, the horizon brush, paging. |
| `Calendar Spec.md`, `Calendar Spec.html` | The builder chrome this follows, and the event and resource kinds `Schedule` shares. |

There is no hi-fi mock of the builder. The canvas looks as `Plan Spec.html`
has it, and the frame, library and inspector as the Calendar's mock. An agent
measures either in a headless browser, through its DOM, and never reads a
screenshot.

## 1. Summary

- **What.** `<Plan>` places events (jobs, stops, shifts) on resources
  (presses, crews) across its axis, with every row kind the east-ui `<Plan>`
  drew beside them: rows over `data` and its series, measures, rollups, links
  and review.
- **Where.** Plan moves to e3 whole. Its wire types, factories, JSX tags,
  examples and skill text go to e3-ui (`libs/east-ui/packages/e3-ui/src/plan/`),
  on one carrier, `Plan`. Its React renderer, with its DOM tests and test
  utilities, goes to e3-ui-components (`src/plan/`), which registers it. Its slot recipes stay in east-ui-components' theme,
  as Studio's and the query builder's do, and the shared building blocks the
  renderer imports reach e3-ui-components through
  `@elaraai/east-ui-components/internal`.
- **Slots.** `resources={{ … }}`: one entry per resource kind, rows read
  through accessors. `events={{ … }}`: one entry per event kind, each its own
  record bound with its patch mutation. Both are `Schedule` values, the very
  ones a Calendar takes. Beside them, `data` and its `series` as the east-ui
  `<Plan>` took them, and `rows`, read only (#1191).
- **Draws.** `BuilderFrame`: one toolbar (the slice's rail, range and
  resolution, grain, overlaps, review, and the history item with Undo, Redo,
  Discard and Apply); the library (Events · Backlog · Series) in the start
  pane when the Plan is given `library`; the canvas in main; the inspector in
  the end pane when it is given `inspector`; the status footer.
- **Built in.** Drag and drop: templates and backlog rows onto rows, moving
  and resizing along and across resources, and back to the backlog. Undo and
  redo across kinds, Apply per kind, review verdicts on events, overlap
  warnings. The app wires none of it.
- **Keeps.** Everything Plan draws: span, buckets, cards and event rows,
  chart, heat and table rows, groups, rollups, links, the horizon brush, the
  now line, the cursor readout, grains, paging.

## 2. Decisions

These are settled; the proposal was approved on 2026-10-04.

1. **Plan moves to e3 whole**: its wire types, factories, tags, examples,
   specs and skill text to e3-ui, and its React renderer with its tests to
   e3-ui-components, on a carrier (one, `Plan`, since decision 16). east-ui
   and east-ui-components keep nothing of Plan: east-ui loses
   its arm, and east-ui-components keeps only Plan's slot recipes in its theme
   (as it keeps Studio's) and the shared building blocks the renderer imports,
   exported through `/internal`. The Calendar's shared time parts (#1148) are
   cut from Plan's renderer in e3-ui-components, where both renderers live.
2. **Resources and events are one shared contract, `Schedule`**, used by the
   Calendar and Plan, so the same records drive both. The Calendar's kinds
   (#1149) are built in that shape, and `Calendar.resources` and
   `Calendar.events` stay as aliases.
3. **The builder edits events that are rows of their own records**, one
   record per kind, as the Calendar does, never items inside another row's
   array.
4. **The east-ui `<Plan>`'s surface is kept**, its `data` + `series` and its
   in-entry editing included, so nothing written against it is lost — on
   `<Plan>` itself since decision 16.
5. **Each kind draws one way** (`draw`): bars, tiles, chips or marks. A
   resource shows one row per way its kinds draw, and kinds that draw alike
   share it.
6. **Measures are ordinary series, read only**: `Plan.series.heat`, `table` or
   `chart` over a resource kind's rows (`measures`), or any series over a
   dataset beside the resources (`rows`). No series type changes. A series
   that declares `edit` or `review` is refused there, since the builder's
   edits go through event records.
7. **Review is per event**: each reviewed kind names its verdict field, and a
   row's decision column, Approve all and Reject all act on its events.
8. **Overlaps** are per kind: `warn` by default, or `allow` for kinds that run
   in parallel; they never block Apply.
9. **The library pane** is three tabs: Events (every kind's templates, by
   kind), Backlog, and Series (today's Series popover moved into the pane,
   show and hide only). The builder's toolbar has no Series button.
10. **One toolbar holds every control**: the slice's rail as its toolbar items
    (folding first), the grain and resolution segments, the overlaps chip,
    Approve all and Reject all, and the history item with Undo, Redo, Discard
    and Apply at its end. Nothing draws a second row; the horizon brush stays
    in main.
11. **Links stay data**, read-only ribbons between events.
12. **Event kinds need a time axis**, as events' times are `DateTime`s. A
    Plan of `data` and `rows` alone takes any axis (decision 16).
13. **No new hi-fi mock**: the canvas follows `Plan Spec.html` and the chrome
    follows the Calendar's spec.
14. **Sample data is a print works** (presses in halls, print jobs, plate
    changes and services, crew shifts) with synthetic names. Nothing names a
    client or a client's trade, in the examples, the showcase or the tests.
15. **Every example uses bound sources** (§2a): Plan's examples, moved and
    new, bind e3 inputs and records, so each runs on e3-web in the
    showcase.
16. **One Plan** (ruled 2026-10-05, #1191): `<Plan>` is the only Plan, and it
    renders in its `BuilderFrame` wherever it is used — in an app, in the
    showcase, in a test. Its library and inspector are optional props: no
    prop, no pane. It takes what `Plan.View` took — rows of every kind over
    `data`, every axis, series over a dataset and in-entry editing (#880) —
    and the event kinds over records beside them. Nothing is refused for
    being `Plan.View`'s: a Plan with no event kinds is a Plan over its rows,
    and only a number or ordinal axis with event kinds is refused, naming
    both. `Plan.View` and `Plan.Builder` go, and one payload rides one
    carrier, `Plan`.

## 2a. Example data idiom

Every example binds its data from e3, so it runs on e3-web in the showcase:
`e3.input` and `e3.record` declarations at module scope, with small literal
defaults (`no-compile-time-seed-data`), bound in the East body with
`Data.bind`, `Data.bindPaged` or `Record.bind`. Writes go through a record's
patch mutation (`Record.onApply`). Never `State.bind` for data, and never an
inline collection as a component's data; `State` holds only a viewer's own
state (a picked entry, saved views kept per viewer).

Other values an example needs (registers' rows, a template's lines, a status
table) are East values bound once with `$.let(value, Type)` inside the East
body, and their variables reused; never a module-scope TypeScript constant,
and never a TypeScript helper that builds one (`no-host-in-east-block`,
`no-module-scope-east-macro`).

A builder's example seeds the records its panes read, so none is empty: the
rows, the members and templates its library lists, an event or a row for the
inspector to show, and a draft its check flags for the Issues tab.

## 3. The authoring surface

### 3.1 The records an app declares

Resources and events are the app's own records, as the Calendar's are:
nothing in them is a Plan type except the lifecycle and the verdict an event
may carry, which are east-ui's shared vocabulary.

```ts
// records.ts
import { ArrayType, DateTimeType, DictType, FloatType, NullType, OptionType, StringType, StructType, VariantType, variant } from "@elaraai/east";
import { ApprovalStateType, EventStateType } from "@elaraai/east-ui";
import e3 from "@elaraai/e3";
import { Plan } from "@elaraai/e3-ui";

// Resources: the canvas's rows. Read only.
export const PressType = StructType({ name: StringType, hall: StringType, sheets_per_hour: FloatType });
export const CrewType  = StructType({ name: StringType, hall: StringType });
export const presses = e3.record("presses", DictType(StringType, PressType), new Map());
export const crews   = e3.record("crews",   DictType(StringType, CrewType),  new Map());

// Events: one record per kind, each placed on a resource by a field.
export const JobType = StructType({
    title:    StringType,
    start:    OptionType(DateTimeType),     // none: not scheduled yet, so the job is in the backlog
    end:      OptionType(DateTimeType),
    press:    OptionType(StringType),       // a key of `presses`
    state:    EventStateType,               // estimated, proposed, confirmed, in progress, actual
    sheets:   FloatType,                    // the run's quantity
    verdict:  ApprovalStateType,            // what a review writes
    customer: StringType,
    stock:    VariantType({ coated: NullType, uncoated: NullType, board: NullType }),
    due:      OptionType(DateTimeType),
});
export const StopType  = StructType({ title: StringType, at: DateTimeType, press: StringType,
                                      kind: VariantType({ plate_change: NullType, service: NullType }) });
export const ShiftType = StructType({ title: StringType, start: DateTimeType, end: DateTimeType,
                                      crew: StringType, state: EventStateType });

export const jobs   = e3.record("jobs",   DictType(StringType, JobType),   new Map());
export const stops  = e3.record("stops",  DictType(StringType, StopType),  new Map());
export const shifts = e3.record("shifts", DictType(StringType, ShiftType), new Map());
export const jobsPatch   = e3.mutation.patch(jobs);
export const stopsPatch  = e3.mutation.patch(stops);
export const shiftsPatch = e3.mutation.patch(shifts);

// Measures: what the canvas shows beside the plan, from the app's dataflow. Read only.
export const utilisation = e3.input("utilisation", DictType(StringType, ArrayType(Plan.Types.HeatCell)), variant("value", new Map()));
export const output      = e3.input("output", ArrayType(StructType({ day: DateTimeType, sheets: FloatType })), variant("value", []));
```

### 3.2 The smallest Plan of event kinds

```tsx
// press-plan.tsx
import { East } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui";
import { Plan, Record, Schedule, ui } from "@elaraai/e3-ui";
import * as d from "./records.js";

export const pressPlan = ui("press_plan", [], East.function([], UIComponentType, _$ => (
    <Reactive>{$ => {
        const presses = $.let(Record.bind(d.presses, []));
        const jobs    = $.let(Record.bind(d.jobs, [d.jobsPatch]));
        const axis    = $.let(Plan.axis({
            window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-11-02T00:00:00Z") },
            resolution: "day",
        }));
        return (
            <Plan
                axis={axis}
                resources={{
                    presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: p => p.name }),
                }}
                events={{
                    job: Schedule.events(jobs, {
                        name: "Print job", icon: "file-lines",
                        title: "title", start: "start", end: "end",
                        resource: { field: "press", of: "presses" },
                    }),
                }}
            />
        );
    }}</Reactive>
)));
```

That is a working editor: a row per press, each job a bar on its press. Jobs
move and resize along a press and between presses, and Apply commits the
drafts as one patch through `jobsPatch`. It lists no `library` and is given
no `inspector`, so it has neither pane: the toolbar, the canvas and the
footer. Given them, its unscheduled jobs wait in the Backlog tab, and every
other field of a job shows in the inspector with the editor its East type
gives it. The two `Schedule` values are exactly what `<Calendar.Builder>`
takes.

### 3.3 The print works

Two resource kinds grouped by hall, three event kinds drawn three ways, review
on jobs, a utilisation heat row under each press, and a pinned output chart.

```tsx
// print-works.tsx
import { East, none, some, variant } from "@elaraai/east";
import { Chart, Reactive, UIComponentType } from "@elaraai/east-ui";
import { Data, Plan, Record, Schedule, ui } from "@elaraai/e3-ui";
import * as d from "./records.js";

export const printWorks = ui("print_works", [], East.function([], UIComponentType, _$ => (
    <Reactive>{$ => {
        const presses = $.let(Record.bind(d.presses, []));
        const crews   = $.let(Record.bind(d.crews, []));
        const jobs    = $.let(Record.bind(d.jobs, [d.jobsPatch]));
        const stops   = $.let(Record.bind(d.stops, [d.stopsPatch]));
        const shifts  = $.let(Record.bind(d.shifts, [d.shiftsPatch]));
        const util    = $.let(Data.bind(d.utilisation));
        const output  = $.let(Data.bind(d.output));
        const axis    = $.let(Plan.axis({
            window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-11-02T00:00:00Z") },
            resolution: "day", resolutions: ["week", "day"], now: new Date("2026-10-14T09:00:00Z"),
        }));
        return (
            <Plan
                axis={axis}
                resources={{
                    presses: Schedule.resources(presses.read(), {
                        name: "Presses", icon: "print",
                        label: p => p.name, group: p => p.hall,
                        sub: p => some(East.str`${p.sheets_per_hour.printFixed(0n)} sheets/h`),
                        // A row under each press, from the dataflow's utilisation: an ordinary
                        // heat series over the press rows, read only.
                        measures: [
                            Plan.series.heat(d.PressType, { key: "util", title: "Utilisation", label: () => "Utilisation",
                                cells: (_p, key) => Plan.heatCells(util.read().get(key), { min: 0, max: 100, warnAt: 95 }) }),
                        ],
                    }),
                    crews: Schedule.resources(crews.read(), { name: "Crews", icon: "user-group", label: c => c.name, group: c => c.hall }),
                }}
                events={{
                    job: Schedule.events(jobs, {
                        name: "Print job", icon: "file-lines", draw: "span",
                        title: "title", start: "start", end: "end",
                        resource: { field: "press", of: "presses" },
                        state: "state", review: "verdict",
                        quantity: { field: "sheets", unit: "sheets" },
                        backlog: { duration: j => variant("hours", j.sheets.divide(8000.0)), due: j => j.due },
                        fields: {
                            customer: Schedule.field.text({ label: "Customer" }),
                            stock:    Schedule.field.select({ labels: { coated: "Coated", uncoated: "Uncoated", board: "Board" } }),
                            sheets:   Schedule.field.number({ label: "Sheets", step: 1000.0, min: 0.0 }),
                        },
                        templates: [
                            { key: "brochure", name: "Brochure run", group: "Jobs", duration: variant("hours", 6.0),
                              values: { title: "Brochure run", state: variant("proposed", variant("added", null)), sheets: 40000.0,
                                        verdict: variant("pending", null), customer: "", stock: variant("coated", null), due: none } },
                        ],
                    }),
                    stop: Schedule.events(stops, {
                        name: "Stop", icon: "screwdriver-wrench", draw: "marks",
                        title: "title", at: "at",
                        resource: { field: "press", of: "presses" },
                        templates: [
                            { key: "plates", name: "Plate change", group: "Stops",
                              values: { title: "Plate change", kind: variant("plate_change", null) } },
                        ],
                    }),
                    shift: Schedule.events(shifts, {
                        name: "Crew shift", icon: "user-clock", draw: "cards",
                        title: "title", start: "start", end: "end",
                        resource: { field: "crew", of: "crews" }, state: "state",
                        templates: [
                            { key: "early", name: "Early shift", group: "Shifts", at: { hour: 6n, minute: 0n }, duration: variant("hours", 8.0),
                              values: { title: "Early", state: variant("confirmed", null) } },
                        ],
                    }),
                }}
                rows={[
                    Plan.chart({ key: "output", label: "SHEETS / DAY", id: true, pinned: true, height: "spark", expandable: true,
                                 layers: [Chart.Column(output.read(), { x: r => r.day, y: r => r.sheets })] }),
                ]}
                review={{ columnLabel: "Decision" }}
                grain="resource"
            />
        );
    }}</Reactive>
)));
```

## 4. The options

### 4.1 `Schedule.events(record, config)`: an event kind

`Schedule.events` is the Calendar's `Calendar.events` (`Calendar Spec.md`
§4.1), with Plan's options beside it. An option a builder has no use for is
accepted and ignored there.

| Option | Takes | Used by | What it does |
|---|---|---|---|
| `name`, `icon` | string | both | The kind's name and icon: its library cards, its elements and the inspector. |
| `title` | a `String` field | both | The event's label: a bar's, a tile's, a chip's or a mark's. |
| `start`, `end` | `DateTime` fields, or their `Option`s | both | When it runs. A move or a resize writes them; Options give the kind a backlog. |
| `at` | a `DateTime` field | Plan | One instant, in place of `start` and `end`, for a kind drawn as tiles or marks. |
| `resource` | `{ field, of }` | both | The resource it is on: a key field of one kind, or a variant field with a kind per case. A move across rows writes it. |
| `status` | `{ field, cases }` | both | A status variant with a label and a tone per case. On a Plan, a warning tone rings the element. |
| `draw` | `"span"`, `"buckets"`, `"cards"`, `"marks"` | Plan | How the kind draws: bars, tiles in bucket cells, chips spanning whole buckets, or marks at instants. `span` by default, `marks` for an `at` kind. |
| `state` | an `EventStateType` field | Plan | The lifecycle the element wears: estimated, proposed, confirmed, in progress, actual or rejected. Confirmed when omitted. |
| `quantity` | `{ field, unit?, format? }` | Plan | A `Float` field the bar prints and a parent's rollup sums, unit by unit. |
| `lane` | a `String` field | Plan | The lane a tile sits in (AM, PM), for `draw: "buckets"` with lanes. |
| `review` | an `ApprovalStateType` field | Plan | What Approve and Reject write; the row's decision column acts on its events' fields. |
| `overlaps` | `"warn"`, `"allow"` | both | Whether two events of the kind on one resource at once are a conflict. `warn` by default. |
| `backlog` | `{ duration, due? }` | both | For Option times: how long an unscheduled row takes, and when it is due. |
| `fields`, `templates`, `ready`, `window`, `backlogWindow` | as the Calendar's | both | The inspector's editors (`Schedule.field` is `Fields`, #1147), the library's presets, the app's check on a draft, and reads by day index. |

### 4.2 `Schedule.resources(rows, config)`: a resource kind

| Option | Takes | Used by | What it does |
|---|---|---|---|
| `name`, `icon`, `label`, `meta` | as the Calendar's | both | The kind and each resource's name and second line. |
| `group` | `(row, key) => String` | Plan | Groups the kind's rows under strips (a hall), which the grain folds to their summary. |
| `parent` | `(row, key) => Option<String>` | Plan | Nests a resource under another of its kind: a hall's presses under the hall, whose bar rolls theirs up. |
| `sub`, `value`, `status` | accessors returning `Option`s | Plan | The gutter's sub line, value slot and status dot. |
| `rollup`, `collapsed` | as `Plan.series.span`'s | Plan | How a parent's bands roll its children's events up, and whether it starts folded. |
| `measures` | `Plan.series.heat`, `table` or `chart` values over the resource's row type | Plan | Read-only rows under each resource, in order: ordinary series, laid out as `Plan.series.views` lays an entry out today. A series that declares `edit` or `review` is refused here. |
| `window` | `Data.bindPaged` over the resources' record | Plan | Pages the resource rows as today's paged canvas does (§9.11). |

### 4.3 `<Plan>`'s props

As built (#1191). A prop keeps one meaning: the first design's `view` and
`density` are the east-ui `<Plan>`'s `grain`, `date` and `style.density`.

| Prop | Takes | What it does |
|---|---|---|
| `axis` | `Plan.axis(…)`, `Plan.axis.number(…)` or `Plan.axis.ordinal(…)` | The shared axis, as today: a window, a resolution and its options, the now line. Event kinds need a time axis: with a number or ordinal one they are refused at build, naming the axis and the kinds; an axis held in a variable is refused in the same words as the Plan is evaluated. |
| `data`, `series`, `pick`, `editing`, `ui`, `popover`, `hover`, `expandRender`, `expandGutter`, `sources`, `onSelect`, `onElementClick`, `onGroupToggle`, `onGrainChange`, `footer`, `style` | as the east-ui `<Plan>`'s | Rows over `data`, laid out by its series and edited in their entries (#880), as `Plan Spec.md` has them. `data` is optional beside event kinds or `rows`; a Plan with no rows from any source is refused. |
| `resources` | `{ [kind]: Schedule.resources(…) }` | The rows events are placed on, kind by kind in this order, ahead of `data`'s. Refused without `events`. |
| `events` | `{ [kind]: Schedule.events(…) }` | The event kinds, at least one when given. |
| `rows` | hand-built rows, and `Plan.over(data, [series…])` | Rows beside the resources, as today's canvas builds them: a pinned KPI chart (`Plan.chart`), or a block of `Plan.series.*` over a dataset, read only. Pinned rows sit under the ruler; the rest follow the resources' rows and `data`'s. A series that declares `edit` or `review` is refused at build with a message naming `Schedule.events`. |
| `links` | `Array<Plan.Types.Link>` | Quantity ribbons, as today, each end a row and a run on it (`Plan.ref`), or an event, `Plan.eventRef("job", key)`, wherever it draws. A link naming a kind `events` has not is refused at build, or, when its kind is not known there, as the Plan is evaluated. |
| `review` | `{ columnLabel?, summary?, onRerun?, rerunLabel? }` | The decision column, and Approve all and Reject all in the toolbar. A verdict writes the kind's `review` field, or the reviewed series' field over `data`. |
| `applyMode` | `"batch"`, `"auto"` | When the event kinds' ready drafts go: on Apply (the default), or as each gesture lands, as the Sheet's does. `data`'s session takes `editing.mode`; `applyMode` with no event kinds is refused. |
| `slice` | `{ slice, affordances? }` | The bound slice. Its chrome (cohort, filter, search, range, resolution) folds into the one toolbar. |
| `grain`, `date` | `"group"` or `"resource"`; a `DateTime` | The first grain and the date brought into view. The viewer's own changes persist per Plan. |
| `canDrop` | `Fn(DragEvent) → Boolean`, or `Fn(Schedule.Types.Candidate) → Option<String>` | The drop veto, its arm read from its type: over a card or an element dragged onto `data`'s rows, or over an event kind's drop, its message on the ghost, as the Calendar's. A candidate's veto with no event kinds is refused. |
| `library`, `inspector` | the panes | Optional props (#1195, #1197): no prop, no pane. |
| `id` | string | Names the Plan when a surface holds two: its viewer state's storage key, its library's drag-source id and its drop target. |

## 5. The East types

### 5.1 What an app author meets

```ts
// Shared: Schedule.Types (the Calendar's, which keeps its names as aliases)
Schedule.Types.ResourceRef = StructType({ kind: StringType, key: StringType });   // a resource: its kind, its key's text
Schedule.Types.EventRef    = StructType({ kind: StringType, key: StringType });   // an event: its kind, its record key's text
Schedule.Types.Status      = StructType({ label: StringType, tone: StatusTokenType, ring: BooleanType });
Schedule.Types.StatusCases(V)                                                     // one Status per case of a status variant V
Schedule.Types.Clock       = StructType({ hour: IntegerType, minute: IntegerType });
Schedule.Types.Duration    = TimeStepType;
Schedule.Types.Candidate   = StructType({                                         // what canDrop is asked about
    kind: StringType,
    from: VariantType({ template: StringType, backlog: StringType, event: StringType }),
    start: DateTimeType, end: DateTimeType,
    resource: OptionType(ResourceRef),
});

// Plan's own, beside today's Plan.Types
Plan.Types.Draw = VariantType({ span: NullType, buckets: NullType, cards: NullType, marks: NullType });
// Every existing type stays, unchanged: Axis, Instant, Series(R, K), Row, RowKind, Blocks, Run, Chip, EventMark,
// HeatCell, Link, Review, UiState, … A resource kind's measures are Plan.Types.Series(R, K) values over its rows.
```

### 5.2 What the renderer receives: the payload

Each event kind is the Calendar's closed kind: its row type sits behind East
functions over beast2 bytes (`items`, `unscheduled`, `write`, the shared
editing session, `history`), so the payload is one type whatever the records
hold. The resources' rows are derived by one East function from the
resources, the events with their drafts in place, and the measures: the very
`Plan.Types.Blocks` the canvas draws.

The payload holds a whole `PlanRootType`, the root the canvas draws, rather
than a copy of its parts: a component made of parts reuses the parts'
interface types. Its axis, links, review, slice, grain, `id` and the rest ride
in it, with its rows over `data` and then `rows` as fixed blocks, which a
paged canvas serves with every window. As built (#1191):

```ts
PlanPayloadType = StructType({
    plan:      PlanRootType,                     // the canvas whole: the axis, the rows over `data` then `rows`, links, review, the slice, `data`'s session
    resources: ArrayType(PlanResourcesType),     // each kind: key, name, icon, and its rows resolved (label, group, parent, gutter)
    events:    ArrayType(PlanEventKindType),     // the Calendar's closed kind + draw and the state, quantity, lane and review roles
    blocks:    OptionType(FunctionType([DateTimeType, DateTimeType, DictType(StringType, DictType(StringType, BlobType))],
                                       OptionType(Plan.Types.Blocks))),   // the resources' rows over a window, every kind's drafts in place (#1192)
    canDrop:   OptionType(FunctionType([Schedule.Types.Candidate], OptionType(StringType))),   // the event kinds' drop veto
    settings:  PlanSettingsType,                 // the event kinds' apply mode, and the date brought into view first
});

PlanComponent = EastUI.component("Plan", PlanPayloadType, { optional: true });
```

## 6. What moves, and how the builder relates to the Calendar

| Today | After | Notes |
|---|---|---|
| east-ui `Plan`: the IR in `src/collections/plan/` | e3-ui `Plan` in `src/plan/` | The nine files move whole: `Plan.axis`, `Plan.series.*`, `Plan.run`, `Plan.pick`, `Plan.Types` and the rest keep their names and their types; none of the eleven series types changes. |
| `<Plan>`, the `Plan` arm of `UIComponentType` | e3-ui's `<Plan>`, in its frame, on an `EastUI.component` carrier, `Plan` (#1191) | The same canvas props over `data`, the event kinds and `rows` beside them, and the panes as optional props. An app changes its import. |
| east-ui-components `collections/plan/` (21,701 lines) and its DOM tests, registered for the arm | e3-ui-components `src/plan/`, registered for the carrier | The renderer moves whole. Its slot recipes stay in east-ui-components' theme. What it imports from east-ui-components is exported through `/internal`. The Calendar's shared time parts (#1148) are cut from it there. |
| east-ui's Plan specs and examples (4,083 lines of examples), the skill text | e3-ui's | They test and document the namespace, imported from `@elaraai/e3-ui`. The showcase's Plan pages and their responsive specs stay in the showcase, which already loads e3-ui's components. |

Nothing else in east-ui depends on Plan: Dock, the pick contract and
`shared/tree` only mention it in comments. The Sheet borrows one helper from
Plan's builders, `resolveTag`, which is generic: it moves to east-ui's
`shared/`.

| Part | Calendar (#1144) | `<Plan>` |
|---|---|---|
| Resource kinds | `Schedule.resources`, read only | The same, plus groups, nesting, the gutter, measures and paging |
| Event kinds | `Schedule.events`, a record each | The same, plus how each draws, its lifecycle, quantity, lane and verdict |
| Templates and backlog | Library tabs Templates · Backlog | Events (every kind's templates) · Backlog · Series |
| The inspector's form | `Fields` (#1147) | `Fields` |
| Editing | A session per kind, one history (#1151) | The same |
| The toolbar | The shared `Toolbar` and its history item | The same, with the slice's rail as its items |
| Time on screen | Day, week and month grids, resource columns, the timeline | Plan's canvas: any resolution, rows of eight kinds, the horizon brush |
| The time parts | Shared from Plan's renderer (#1148) | Their source |
| Large records | A day index per kind (`Calendar.days`) | The same index, and paged resources |

| A canvas that… | Uses |
|---|---|
| shows data, or reviews and edits the items inside its entries | `<Plan>` with `data` and `series` |
| plans events kept as records of their own | `<Plan>` with `resources` and `events` |
| offers templates, the backlog and the series to show, or shows what is selected | `<Plan>` with `library`, or `inspector` |
| shows the same events by day, week or month, or by resource column | `Calendar.Builder`, over the same `Schedule` values |

The Roster (#1160) stays its own builder: its slots are a day, a group and a
shift, not instants, and its record is the roster's own. It shares the frame,
`Fields`, the library parts and the editing session, not `Schedule`.

## 7. Layout in BuilderFrame

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│ Filter Search · Group Resource · Range · Week Day · 3 overlaps · ✓ all ↶ ↷ ✕ Apply│
├───────────────────────────────────────────────────────────────────────────────────┤
│ banners: an Apply's refusals and conflicts, by kind                               │
├──────────────┬────────────────────────────────────────────────┬───────────────────┤
│ LIBRARY      │ HORIZON  brush strip                           │ INSPECTOR         │
│ Events       │ RULER    W41  W42  W43  W44            NOW     │ one event: header,│
│ Backlog      │ pinned   SHEETS / DAY chart                    │  schedule, state, │
│ Series       │ Hall 1   ▸ Press A   [job][job]   ◆            │  fields, verdict  │
│ search       │            utilisation ▓▓▒▒░░                  │ several: bulk edit│
│ cards (drag) │ Crews    ▸ Crew 1    [early][late]             │ a row: its facts  │
├──────────────┴────────────────────────────────────────────────┴───────────────────┤
│ footer: 64 events · 9 in backlog · 4 pending · 2 to review · saved 14:02          │
└───────────────────────────────────────────────────────────────────────────────────┘
```

| Region | Holds |
|---|---|
| Toolbar | Every control Plan draws outside its canvas, as items of the shared `Toolbar` (§7.1). |
| Banners | An Apply's refusals and conflicts, by kind; a kind out of date; a write whose outcome is unknown. |
| Start pane "Library" | Tabs Events · Backlog · Series (§9.6), when the Plan is given `library`; none, no pane. |
| Main | The canvas, unchanged: the horizon brush, the ruler and now line, pinned rows, the gutter, every row kind, the cursor readout, links, virtualised and paged as today. |
| End pane "Inspector" | The selection (§9.8), when the Plan is given `inspector`; none, no pane. |
| Footer | `64 events · 9 in backlog · 4 pending · 2 to review · saved 14:02`. |

The panes are `BuilderFrame`'s: pinned beside main while main keeps 480px,
overlaid with a rail and a scrim at 560px and narrower, and slid off main
during a drag. Today's narrow layout (the tab strip) gives way to the
frame's. The builder fills its parent and draws no border of its own. Every
style is a slot recipe's.

### 7.1 The toolbar's items

| Item | Side | Under width pressure |
|---|---|---|
| The slice's narrowing: cohort · filter · search | start | Folds first, as every rail does: clause chips into `+M more`, the affordances into summary chips, one chip naming what is set, then the icon. Each opens the slice editor popover. |
| Scope badge: `loaded rows only`, while a paged canvas is narrowed | start | Shown while it applies |
| Key search, on a paged keyed source | start | Stays; it replaces the narrowing's search |
| Grain: Group · Resource | start | Its own steps, after the rail's |
| The slice's range | start | Folds with the rail |
| Resolution: Week · Day | start | Its own steps, after the rail's |
| Overlaps: `3 overlaps` | end | A click selects the first pair |
| Review: the summary, Approve all · Reject all | end | Moved here from the review foot |
| The history item: status line · issues · Undo · Redo · Discard · Apply | end | Folds last, to its buttons |

The rail's two clusters, the narrowing and the range, come from
`useSliceToolbarItems(slice, [{ key: "cluster", kinds }, { key: "range",
kinds: ["range"] }])`, the hook today's Plan toolbar already uses, between the
grain and resolution segments as today. `HOST_RANK` keeps every other item
folding after the rail. The history item is the shared `historyToolbarItem`
(#988). The Series button and its popover go, since the Series tab replaces
them.

## 8. Anatomy

- **The canvas** is `Plan Spec.md`'s, unchanged.
- **The frame, the panes, the library's cards and the inspector** are
  `Calendar Spec.md` §8's: the library 272px and the inspector 320px open,
  44px as rails, a pane's tab row 44px, the library's search band padding
  12px 14px on paper-2 around a 32px input; an Events card a grip, its kind's
  icon tile, its name and `Print job · 6 h · presses`; a Backlog card
  `6 h · Press A · due Fri 16`.
- **A Series row** is `Pick.Panel`'s: its kind's icon, its title and subtitle,
  an eye; a hidden row is dimmed.
- **An element of a drafted event** is tinted brand with a brand border, as
  the Calendar's blocks are; one in an overlap pair has a warn ring.

## 9. Behaviour

Every rule is numbered. Each sub-issue lists the rules it owns, and each rule
has a test there. `Plan Spec.md`'s own rules keep holding in the canvas.

### 9.1 The move to e3-ui (owner: Plan moves to e3-ui)

- **PB1.** The moved Plan takes every prop the east-ui `<Plan>` took and
  builds the same root, `PlanRootType`. Since #1191 that Plan is `<Plan>`
  itself: an app changes its import (`@elaraai/e3-ui`), and nothing else.
- **PB2.** east-ui's `Plan` arm leaves `UIComponentType`. The IR is e3-ui's,
  and the canvas renderer e3-ui-components', which registers it for the
  `Plan` carrier (#1191); east-ui and east-ui-components export nothing of Plan.
  `resolveTag` moves to east-ui's `shared/`.
- **PB3.** Every Plan test, example and responsive spec passes after the
  move with only its imports and tag changed, and the canvas keeps its
  editing (#880, #825). Since #1191 its tag is `<Plan>`, and its own toolbar,
  Series button and popover and review foot give way to the frame's
  (decision 16).

### 9.2 `Schedule` (owner: `Schedule`, shared with the Calendar)

- **PB4.** `Schedule.resources(rows, config)` and `Schedule.events(record,
  config)` are one e3-ui contract (`src/schedule/`), with `Schedule.field`
  (`Fields`), `Schedule.days` and `Schedule.unscheduled`. `Calendar.resources`,
  `Calendar.events`, `Calendar.field`, `Calendar.days` and the shared
  `Calendar.Types` are aliases of them.
- **PB5.** Plan's options (§4.1, §4.2) are accepted by `Schedule.events` and
  `Schedule.resources`; a builder ignores the ones it has no use for, and the
  Calendar draws exactly as it did.
- **PB6.** Every field name is checked against the record's row type at
  compile time where the type allows (`at` a `DateTime` field, `quantity.field`
  a `Float` field, `lane` a `String` field, `review` an `ApprovalStateType`
  field, `state` an `EventStateType` field), and at build time otherwise,
  naming itself.
- **PB7.** A `measures` series that declares `edit` or `review` is refused at
  build, naming `Schedule.events`.

### 9.3 Types and factories (owner: the Plan's types and factories)

- **PB8.** `<Plan>` takes the props of §4.3: everything the east-ui `<Plan>`
  took, and the event kinds. Only a number or ordinal `axis` with event kinds
  is refused, naming the axis and the kinds (decision 16), and so is a Plan
  with no rows from any source.
- **PB9.** `rows` takes hand-built rows and `Plan.over(data, [series…])`,
  read only; a series in it that declares `edit` or `review` is refused at
  build, naming `Schedule.events`. Pinned rows sit under the ruler, the rest
  after the resources' rows and `data`'s.
- **PB10.** `Plan.eventRef(kind, key)` names an event for a link's end; a
  link naming an unknown kind is refused at build, or, when its kind is not
  known there (a list held in a variable or built in East, an event end held
  in a variable), in the same words as the Plan is evaluated.
- **PB11.** The payload is `PlanPayloadType` (§5.2) on the `Plan`
  carrier. Each event kind's row type is closed behind East
  functions over beast2 bytes, so the payload is one type whatever the records
  hold.

### 9.4 Events into rows (owner: events into rows)

- **PB12.** A resource is a row block: one row per way its kinds draw, in the
  order span, buckets, cards, marks. Kinds that draw alike share the row, each
  element marked with its kind's icon.
- **PB13.** Its measures follow it in declared order, each the measure series
  applied to the resource's row; a measure row's id is its series' key and the
  resource's path.
- **PB14.** `group` gives group strips that the group grain folds to their
  summary. `parent` nests a resource under another of its kind, whose rows roll
  their children's events up: `×k` concurrency, quantities summed by unit, the
  least certain state.
- **PB15.** A row's id is `entry { series: "<kind>.<draw>", path: [group?,
  …parents, key] }`. Selection, collapse, links, focus and the drag grammar
  address rows by it.
- **PB16.** An event whose kind has no `resource`, or whose resource is none,
  draws on an Unassigned row of its kind at the end of the resources, one per
  draw style.
- **PB17.** The rows are derived with every kind's drafts in place, so a draft
  draws as Apply would leave it.
- **PB18.** A reviewed kind's rows carry the decision column, and an event's
  verdict shows on its element.

### 9.5 Frame and toolbar (owner: the Plan's frame and toolbar)

- **PB19.** The Plan is a `BuilderFrame` (toolbar, banners, the library as
  its start pane when it is given `library`, main, the inspector as its end
  pane when it is given `inspector`, the footer). It fills its parent and
  draws no border.
- **PB20.** The toolbar is one row of the shared `Toolbar`, its items in
  §7.1's order.
- **PB21.** Under width pressure the rail's clusters fold first, then the
  grain and resolution segments by their own steps, and the history item
  last, to its buttons. No item wraps or goes to a second row, and there is no
  Series button.
- **PB22.** Main is today's canvas, unchanged.
- **PB23.** The footer counts the events, the backlog, the pending changes and
  the events to review, and gives the last commit's time.
- **PB24.** The banners: an Apply's conflict by kind, naming its events and who
  changed the record last; a refusal, with its reason; an unknown outcome, with
  Retry; a kind out of date, with Discard. A banner leaves when what it reports
  does.
- **PB25.** The panes are `BuilderFrame`'s, and their open tab and collapsed
  state persist under the builder's `id`.

### 9.6 The library pane (owner: the library pane)

- **PB26.** The library has three tabs, Events, Backlog and Series, each with
  its count and a search. Collapsed, it is a rail with the backlog's count.
- **PB27.** Events holds every kind's templates, grouped under each kind's icon
  and name, then by a template's `group`. A kind with no templates has nothing
  to drop; its events still move and resize.
- **PB28.** Backlog holds every kind's unscheduled events (the kinds whose times
  are Options), grouped by due: Due this week, Due next week, Later, No date.
- **PB29.** Series lists each resource kind, event kind, measure and extra row,
  with its icon, title and an eye. Hiding an event kind hides its elements
  everywhere, a resource kind its rows, a measure or an extra row that row.
  The order on screen is the order declared, and what is hidden persists per
  viewer.
- **PB30.** An empty tab says so: `Backlog clear: every event is scheduled`, or
  `No matches: nothing matches "q"`.

### 9.7 Drag and drop (owner: drag and drop)

- **PB31.** A drag starts after 4px and snaps to the resolution, as today's
  moves do. A ghost says what lands where (`Brochure run · Press A · Mon 12
  Oct`) or, in red, why it can't (`Needs a press`, or `canDrop`'s message).
- **PB32.** A template card dropped on a resource's row creates an event of its
  kind at the bucket under the pointer, for its duration, selected, as one
  `drop` transaction. Refused when the row's resource is of a kind the event
  kind doesn't take, or `canDrop` refuses.
- **PB33.** A backlog card dropped on a row schedules it: its start, its end
  (from its duration) and its resource. The same refusals.
- **PB34.** A bar, tile, chip or mark moves along its row, or onto another
  resource's row, writing the resource field; moving a selected element moves
  the selection. Refused onto a resource of a kind it doesn't take.
- **PB35.** A bar's or a chip's edge resizes it, never shorter than one snap.
- **PB36.** An event dropped on the Backlog tab is unscheduled: its times are
  set to none. Refused when its kind's times are not Options.
- **PB37.** It runs on the drag grammar Plan uses today (`LibraryRef`,
  `CellRef` with the row id's text and the snapped instant) and the drag
  machine the Calendar shares with it (#1148). The panes slide off main during
  a drag.

### 9.8 The inspector (owner: the inspector)

- **PB38.** One event: its kind, title and state; its resource, its start and
  end (or its instant) and its lane; its quantity; the verdict with Approve and
  Reject when the kind is reviewed; overlaps as a banner; then the kind's
  fields through `Fields` (#1147); Duplicate and Delete.
- **PB39.** Several events: the list, and a bulk edit of the state, the
  resource, a shift in time (−1 d, −1 h, +1 h, +1 d) and the verdict.
- **PB40.** A row: the resource's name and meta, its events in the window
  (count, hours, quantity by unit), its measures at the selected bucket, and
  its overlaps.
- **PB41.** Nothing selected: the window's totals and three hints.
- **PB42.** A field the drafts changed is tinted against what the record holds,
  and an edit in the inspector is one transaction.

### 9.9 Editing, undo and Apply (owner: the Plan's editing)

- **PB43.** Each event kind is one session of the shared `Editing` contract
  (#879) over its record. Every gesture (a move, a resize, a drop, a schedule
  or an unschedule, a verdict, an inspector edit) is a draft and one undoable
  transaction.
- **PB44.** The history item holds one history across kinds (the Calendar's,
  #1151): its status line, the issues button, then Undo, Redo, Discard and
  Apply. Undo and Redo step through the gestures in the order they were made,
  whatever their kind, and Discard drops every kind's drafts. ⌘Z undoes, and
  ⇧⌘Z or ⌘Y redoes, never while typing.
- **PB45.** Apply is on when every kind's drafts pass its `ready` and there is
  a change. It commits each kind with drafts as one patch through its record's
  patch mutation (`Record.onApply(record, { keyed: true })`), checked against
  what its drafts began from.
- **PB46.** A kind whose record moved since is refused as a conflict: its
  drafts stay, a banner names its events and who changed the record last, and
  the other kinds commit. A refused write is a banner too.
- **PB47.** A write with no answer leaves that kind unknown: Apply turns into
  Retry for it, which resends the same request, its id unchanged.
- **PB48.** Drafts retire when the events read back as the commit left them. A
  record moving under a kind's pending drafts marks that kind out of date, and
  a banner offers Discard.
- **PB49.** Review is a gesture, as it is today: Approve or Reject on an event,
  a row's decision column over its events, or Approve all and Reject all over
  the window, each drafting the kinds' `review` fields as one transaction.
  Rerun stays a callback.
- **PB50.** `applyMode: "auto"` commits each ready gesture as it lands, through
  the same protocol; drafts outlive a remount, kept in the UI store per record.

### 9.10 Overlaps (owner: overlaps)

- **PB51.** Two events of a kind with `overlaps: "warn"` on one resource whose
  times overlap are an overlap pair; both are flagged with a warn ring.
- **PB52.** The toolbar's overlaps chip counts the pairs; a click selects the
  first pair, earliest first, and brings it into view.
- **PB53.** The inspector's banner lists what the selected event overlaps, and
  a click on one selects it. Overlaps never block Apply.

### 9.11 Windowed reads (owner: windowed reads)

- **PB54.** A kind with a `window` (a `Data.bindPaged` over its day index,
  `Schedule.days`) reads only the days in view, and with a `backlogWindow` its
  unscheduled rows, as the Calendar's do (#1156).
- **PB55.** A resource kind with a `window` pages its rows as today's paged
  canvas does: blocks come a window at a time as the canvas scrolls, and the
  key search seeks a resource by its key.

### 9.12 Showcase and docs (owner: the Plan builder's showcase and docs)

- **PB56.** The print works (§3.3) runs on e3-web in the showcase with its
  records seeded, and Apply commits to them.
- **PB57.** Responsive specs measure the frame, the toolbar's fold order at
  desktop and phone widths, both themes, the panes, a drop and a resize.
- **PB58.** The e3-ui skill documents `<Plan>` and `Schedule` with tested
  examples, and the plugin indexes are regenerated.

### 9.13 Examples on bound sources (owner: Plan's examples on bound sources)

- **PB59.** Every Plan example that shows data binds it from e3 (§2a): an
  `e3.input` or `e3.record` bound with `Data.bind`, `Data.bindPaged` or
  `Record.bind`, its writes (an editable series' Apply, a review's verdicts)
  through the record's patch mutation, and runs on e3-web in the showcase.

## 10. Drag and drop, as a table

| Drag | Onto | Does | Refused when |
|---|---|---|---|
| A template card | a resource's row | Creates an event of its kind at the bucket it lands in (PB32) | the row's resource is of a kind the event kind doesn't take, or `canDrop` refuses |
| A backlog card | a resource's row | Schedules the row: its start, end and resource (PB33) | as above |
| A bar, tile, chip or mark | along its row, or another resource's | Moves it; across rows it writes the resource field (PB34) | a resource of a kind it doesn't take |
| A bar's or a chip's edge | along the axis | Resizes it (PB35) | it would be shorter than one snap |
| An event | the Backlog tab | Unschedules it (PB36) | its kind's times are not Options |

## 11. What changes from today's Plan, and what is lost

| Today | `<Plan>` | Why, and what is lost |
|---|---|---|
| The canvas's own toolbar and review foot | The frame's one toolbar | A component has one toolbar. Nothing is lost. |
| The Series button and its popover | The Series tab | The pane holds it. A Plan with no library has no series to hide. |
| Cards reaching a Plan from a separate `<Library>` through `id`, `sources` and `edit.create` | The Events tab's templates | Data, declared with their kind. `data`'s series keep today's wiring. |
| Items inside each entry's array (`edit.items`) | Events as rows of their own records | `data`'s series keep in-entry editing. |
| Number and ordinal axes | A time axis, with event kinds | Events' times are `DateTime`s; a Plan of `data` and `rows` keeps the others. |
| The narrow tab strip | `BuilderFrame`'s panes | The frame's phone behaviour. |

## 12. Wires

- **UI.** east-ui's `Plan` arm leaves `UIComponentType`; packages are
  re-exported (`WIRE_MIGRATION.md`). `<Plan>` rides an `EastUI.component`
  carrier, `Plan` (#1191), as `StudioBuilder` does.
- **Stored state.** None new: the records are the app's own types, and Plan's
  stored `UiState` and picks don't change.

## 13. Plan's sub-issues, in landing order

1. The specs (this file and `Sheet Builder Spec.md`).
2. Plan moves to e3: its IR to e3-ui and its renderer to e3-ui-components.
3. Plan's examples on bound sources.
4. `Schedule`, shared with the Calendar (after the Calendar's kinds, #1149).
5. The Plan's types and factories: one `<Plan>` (#1191).
6. Events into rows.
7. The frame and the toolbar.
8. The library pane.
9. The inspector (after `Fields`, #1147, which the Sheet's builder lands first).
10. Editing, undo and Apply (after the Calendar's editing, #1151).
11. Drag and drop (after the Calendar's shared time parts, #1148).
12. Overlaps.
13. Windowed reads (after the Calendar's, #1156).
14. The showcase on e3-web, the skill and examples.

The frame, the library and the inspector are pushed together, so the builder
first appears with both panes full of the examples' seeded records.
