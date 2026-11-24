# Plan — DX proposal

**Status:** built. The Plan's proposal (epic #1544: #1540, #1541, #1542, #1543) landed as six pull requests, each on
the one before it (*How it landed*, below). Composite records follow it, in their own pull request, and U6 with them.

**How to read it.** The examples are the specification. Each requirement below names the example that shows it and
the spec that holds it; §3 is the worked example, written as it was built
(`planPrintWorksRecords`, `planPressTasks`, `planOnePress`, in e3-ui's `test/plan/plan-events.examples.tsx`).
Sections keep the numbers they had across the epic and its issues: §1, §2, §6, §9 and §10 were the epic's, §3 to §5
and §8 the props issue's, §7 the examples issue's. Where a line cites a file and a line number, it is the tree's the
proposal was reviewed against, and is read again before it is relied on.

## Requirements

| # | Requirement | Item | Examples | Specs |
|---|---|---|---|---|
| R1 | The rows are the resources: `Plan.series.resources`, and an event kind's `resource: { field, of }` naming a resources series or a `kinds` case | U1 | `planEvents`, `planPrintWorks`, `planWindows`, `planRecordIndexes` | e3-ui `test/plan/plan-resources.spec.ts`, `test/plan/plan-event-rows.spec.ts`, `test/schedule/plan.spec.ts`; showcase `plan-landings.spec.ts` |
| R2 | Every event kind over paged rows is read a cell at a time, through its own source of the rail | U1 | `planWindows`, `planSeriesByHall`, `planPrintWorksRecords` | e3-ui-components `src/plan/frame/plan-builder-paged.dom.test.tsx`, `src/plan/root/cells.test.ts` |
| R3 | A kind lands a step beneath its resource (`child: { field, of }`), in a lane for each case of a variant `lane` | U1 | `planPressTasks` | e3-ui `test/plan/plan-resources.spec.ts`; e3-ui-components `src/plan/frame/plan-builder-dnd.dom.test.tsx`, `src/plan/frame/plan-press-examples.dom.test.tsx`; showcase `plan-press.spec.ts` |
| R4 | A library tab's cards make events (`create`) | U1 | `planEvents`, `planPrintWorksRecords` | e3-ui-components `src/plan/frame/plan-builder-dnd.dom.test.tsx` |
| R5 | A variant's cases as series: `Plan.series.kinds`, a series' `case`, a case's `children`, and `row: false` | U2 | `planPrintWorks`, `planTargetState`, `planPressTasks`, `planOnePress` | e3-ui `test/plan/plan-case.spec.ts`, `test/plan/plan-resources.spec.ts`; e3-ui-components `src/plan/frame/plan-press-examples.dom.test.tsx`; showcase `plan-landings.spec.ts`, `plan-press.spec.ts` |
| R6 | `hidden`, and the series pickable where the library lists them | U3 | `planNestedAll`, `planTargetState` | e3-ui `test/plan/plan-hidden.spec.ts`; e3-ui-components `src/plan/frame/plan-nested-examples.dom.test.tsx` |
| R7 | `record`, the Plan's one save door, with `onPatch` and `ready` | U4 | `planRowDrop`, `planNestedAll`, `planConflictsTable`, `planPrintWorksRecords` | e3-ui `test/plan/plan-events.spec.ts`; e3-ui-components `src/plan/frame/plan-nested-examples.dom.test.tsx`, `src/plan/frame/plan-builder-dnd.dom.test.tsx` |
| R8 | The inspector over the record's rows, the refusals holding Save, and the optimiser by the builders' one contract | U5 | `planOptimise`, `planPrintWorksRecords` | e3-ui-components `src/plan/frame/plan-frame-inspector.dom.test.tsx`, `src/plan/optimise.dom.test.tsx` |
| R9 | One `canDrop`, over `Plan.Types.Candidate` | U7 | `planRowDrop`, `planPrintWorks` | e3-ui-components `src/plan/edit/candidate.dom.test.ts`, `src/plan/frame/plan-frame-panel-drop.dom.test.tsx` |
| R10 | An item's status: `Plan.status(words, tone, { ring? })` | U8 | `planTargetState` | e3-ui `test/plan/plan-status.spec.ts`; e3-ui-components `src/plan/plan-status.dom.test.tsx`; showcase `plan-status.spec.ts` |
| R11 | A lock on one event or item (`locked`) | U9 | `planPrintWorks`, `planPrintWorksRecords` | e3-ui-components `src/plan/plan-move.dom.test.tsx`, `src/plan/frame/plan-builder-dnd.dom.test.tsx`; showcase `plan-locks.spec.ts` |
| R12 | Links kept in a record (`Plan.links`), drawn with the Connect tool, held to `canConnect` | U10 | `planEventLinks`, `planConnect`, `planPrintWorksRecords` | e3-ui `test/plan/plan-link-kinds.spec.ts`; e3-ui-components `src/plan/links/connect.dom.test.ts`, `src/plan/frame/plan-builder-dnd.dom.test.tsx`, `src/plan/frame/plan-frame-inspector.dom.test.tsx`; showcase `plan-builder-dnd.spec.ts` |
| R13 | A rail source's `scope`: the narrowing a page holds | U11 | `calendarScoped`, `planOnePress` | e3-ui `test/bind/data/data.spec.ts`; e3-ui-components `src/plan/frame/plan-rows-find.dom.test.tsx`, `src/plan/frame/plan-press-examples.dom.test.tsx` |
| R14 | Child rows from a list of the app's own: `Plan.children.of`, read only | U12 | `planPressKinds` | e3-ui `test/plan/plan-resources.spec.ts`; e3-ui-components `src/plan/frame/plan-press-examples.dom.test.tsx` |
| R15 | e3: a nested series index's child rows and items keyed by any type | E1 | `planPressTasks`, `planPrintWorksRecords` | e3 `src/record-nested.spec.ts`, `src/index-read.spec.ts`; e3-core `src/record-nested.spec.ts` (east-node, east-c and east-py), `src/index-readers.spec.ts` |
| R16 | An event kind whose record is keyed by any type: drawn, dragged, saved, joined and optimised by its typed key | Acceptance | `planTypedKeys` | e3-ui-components `src/plan/frame/plan-builder-dnd.dom.test.tsx` |
| R17 | One templates record for every kind: `Schedule.templates`' `case` | §9, 1 | `planPrintWorksRecords` | e3-ui `test/schedule/builders.spec.ts` |
| R18 | The worked example: the print works over plain records | §3 | `planPrintWorksRecords` | e3-ui `test/plan/plan-events.spec.ts`; e3-ui-components `src/plan/frame/plan-builder-dnd.dom.test.tsx`; showcase `plan-works.spec.ts` |

U6, the Plan over a composite record, is not this proposal's to build: it lands with composite records, after it (§3.8).

## What the build changed

Where the code written in the proposal met the build, the build's answer stands, and §3 is written as built.

| Where | As first written | As built | Why |
|---|---|---|---|
| e3, child rows (§3.7) | `kinds: index.nestedSeries.rows({})`, which e3 refused | e3 takes `rows({})`: child rows that nest nothing in time, named among the index's ids, nothing filed of them | the Plan asks for the rows declared, and these hold no collection of their own |
| e3, a nested index's keys (E1) | a child row's key in its own type | so, as the index's ids: one variant, a case for each collection of child rows and of items, named by its place. A reader's `path` is `[variant('units', key)]` | every nested series index's stored form changes: a package is re-exported and its nested indexes are built again at deploy |
| The works' nested index (§3.1) | `tile: "week"` | `tile: "day"` | a crew's hours are subtotalled at the day the axis zooms to, and the build refuses a coarser tile |
| The works' index of resources (§3.1) | `index.keys` of a set of Strings | of `{ code }` structs | the rail offers a field only where the index names one |
| The optimiser (§3.1) | `Plan.Types.OptimiseResult({ job })`, changing nothing | a patch of every record the Plan edits, and a working placement | the builders' one contract answers each record a builder edits |
| The rail (§3.3) | seven sources | eight: one more for every kind's templates | beside a rail a kind's templates name a source |
| A library tab (§3.4, §4) | `key: "orders"`, `.tab(rows, { key?, … })` | a tab takes no `key` | nothing reads one: dropped from the proposal on 17 November 2026 |
| The press tasks' record (§3.7) | four indexes | seven: one on the press alone, and two interval indexes | the scope's search reads through the first; the footer's count of the tasks through an interval index |
| A kind with `child` (U1) | unsaid | it lands only on the rows `child.of` names; a carry by keyboard keeps the event's lane | its resource's own row draws none of its events |
| Templates' `case` (§9, 1) | "the kind's case of `values`" | `case: [field, tag]`, as a series' `case` is written | one spelling for a case of a variant field, wherever it is named |

Three faults in the renderer were found by the examples and fixed with them: a kind read a cell at a time was read by its resource's own row alone, so a page drawing none read no events; a pinned row's nested series were never read; and a link kind over kinds read a cell at a time rendered without end.

## 1. Why

Today a Plan gets its rows in three ways. Each way has its own reads,
narrowing and saving:

| Way | Rows from | Items from | Saves through | Examples |
|---|---|---|---|---|
| Data series | `data`, or the rail's `rows` source | the row's own collections (`Plan.items`, `Plan.values`) | `editing.onApply` (`Record.onApply(record, { keyed: true })`) | planTargetState, planVariants, planMeasures, planRowDrop, planNumberAxis, planOrdinalAxis, slicePlanChrome, planNestedAll, planConflictsTable, dataBindPagedPlan, dataBindPagedBlocks |
| Event kinds | `resources`: a dataset per resource kind (`Schedule.resources`), most of them records | `events`: a record per event kind (`Schedule.events`), each event placed on a resource by a field | each kind's record, by its patch mutation | planEvents, planPrintWorks, planEventLinks, planConflicts, planWording, planWindows, planSeriesByHall, planRecordIndexes, planRecordIndexesMobile, planOptimise |
| Read-only rows | `rows`: `Plan.chart({ … })`, `Plan.over(data, [series])` | the dataset | nothing | planPrintWorks, planEventLinks |

This costs four things:

1. **A record per kind.** planPrintWorks binds 23 datasets (20 records and
   3 inputs), and its rail has 10 sources. It has six resource kinds, six
   event kinds, and a templates record for each event kind.
2. **Each way has features the other lacks.** Only event kinds have these:
   - the inspector, which `plan.ts` documents as needing `events`;
   - item forms (`fields`), the backlog and templates;
   - the optimiser, which `plan.ts` refuses on a Plan with no event kinds
     ("declare `events`");
   - links into marks, chips and tiles. A data series' link ends at runs
     only (`builders.ts:1189-1217`, main at 425a000).

   Only data series have these:
   - nested rows, with rollups and subtotals that e3 keeps;
   - nested tables;
   - paging rows and time together through one nested series index.

   An app that needs features from both lists can't have them.
3. **Rows of mixed kinds are filtered and unwrapped by hand.**
   planTargetState's one source holds nine kinds of row in a `kind`
   variant. Eighteen series filter it with
   `match: r => r.kind.hasTag(…)`, eleven of them unwrapping the case to
   test its value too, and `kind.unwrap(…)` is called 46 times in all.
4. **Two props say the same thing, twice over.** The first pair is `series`
   and `pick` (`Plan.pick(key, list, { hidden })`). The second is
   `editing={{ onApply: Record.onApply(record, { keyed: true }) }}`, which
   sits beside the `Record.bind` it wraps.

## 2. The proposal in one page

- **Rows: one record.** A Plan draws one record's rows: the resources and
  the groups they are in, with what belongs to them:
  - readings are a row's value collections (`index.nestedSeries.values`);
  - a resource's parts, or a crew's roles, are child rows
    (`index.nestedSeries.rows`), and parts of parts a tree (`recursive`);
  - a row's kind is a variant field.

  Several outside systems can feed that one record as a composite record
  (#1465, which follows this epic).
- **Events: `Schedule.events`, as today.** Each kind is a record of its own,
  placed on a row by a field, `resource: { field, of }`, as Calendar, Roster
  and Allocation place theirs. `of` names a resources series
  (`Plan.series.resources`) or a `kinds` case of the rows by its key, where
  today it names a dataset of resources (U1): the rows are the resources.
  `child: { field, of }` lands the event on a child row beneath that
  resource, one step down (U1).
- **Links: a kind per record too.** Each link is a row of the app's record,
  its `from` and `to` fields holding the keys of the events it joins, typed
  by their kinds, as the Schematic's links name their items by fields
  (U10). The Plan draws a link kind as it draws today's links and reads it
  as it reads an event kind, and a drag from one event to another makes one.
  Today's list of links stays.
- **Both page in two dimensions.** The rows page through the record's nested
  series index: a page of rows, each collection a week at a time. Each event
  kind pages through its series and summary indexes, keyed by its resource
  field: the events on the rows in view in the weeks in view, and totals
  where they are too many to draw.
- **One rail.** `Slice.bindRecords` has a `rows` source,
  `Data.bindPaged(record, { indexes })`, a source per event kind, and the
  library tabs' sources. Over paged rows every event kind has its source
  and is read a cell at a time through it: none is read whole there, as
  today (U1).
- **A page of one resource.** A source of the rail takes `scope`: a
  narrowing the page holds, typed and checked as a narrowing is, each value
  an East expression so a page's parameter goes in, never the viewer's to
  clear (U11). A `kinds` case with `row: false` isn't drawn itself, and its
  series and children stand at its level: one press's page is the works'
  page scoped, its rows at the root (#1541 §3.7).
- **One Plan, both feature sets.** The event kinds keep the inspector, forms,
  templates, the optimiser, links into marks, chips and tiles, and status.
  The rows keep nested tables, rollups, subtotals and trees. Today a Plan
  has one set or the other.
- **Cleaner props.** `series` is pickable where the library lists
  `Plan.library.series()`, and `pick` goes. `record`
  replaces `editing`. One `canDrop` checks every drop. `Plan.series.kinds`
  and a series' `case` map a variant's cases to series. A library tab's cards
  can make events as templates do, so a solution's own list of work not yet
  planned is a tab; the built-in backlog stays, for events with no start.

Nested tables, groups, sections, views, rollups and subtotals work exactly as
they do today (§6).

## 3. The five layers, for a print works

A print works plans the jobs on its presses and bindery lines, its crews'
shifts and hours, and the deliveries from its bays and vans. Its works are
one record: each hall with its presses and its crews, the bindery with its
lines, and dispatch with its bays and vans, with each press's utilisation
and each crew's hours by role. Its jobs, stops, bindery jobs, shifts and
deliveries are a record each, and so are the feeds that link them: a job's
sheets to a bindery job, a bindery job's books to a delivery.

Every record here is a plain `e3.record`: this is what the Plan's pull
requests build. §3.8 is the same works once composite records are built
(#1465), the ERP's groups and jobs beside the planner's own.

Every type the example uses is defined in §3.1. The rest is e3's, e3-ui's
and east-ui's own API.

### 3.1 The records

```ts
import { DateTimeType, DictType, East, FloatType, NullType, SetType, StringType, StructType, VariantType }
  from "@elaraai/east";
import { EventStateType } from "@elaraai/east-ui";   // a run's lifecycle: actual, confirmed, proposed, …
import * as e3 from "@elaraai/e3";
import { Plan } from "@elaraai/e3-ui";               // the optimiser's request and answer types (U5)

/** What a resource is. */
export const ResourceKindType = VariantType({ bay: NullType, crew: NullType, line: NullType, press: NullType, van: NullType });

/** A role in a crew: the key of a crew's hours. */
export const RoleType = VariantType({ assistant: NullType, operator: NullType });

/** A role's planned hours in its crew, a value a week. */
export const RoleHoursType = StructType({ hours: DictType(DateTimeType, FloatType) });

/** A resource and what belongs to it over time, each collection empty on the kinds without it: a press fills
 *  `utilisation`, a crew `hours`. */
export const ResourceRowType = StructType({
  name: StringType,
  what: ResourceKindType,
  utilisation: DictType(DateTimeType, FloatType),   // the share of each day it is busy, in %
  hours: DictType(RoleType, RoleHoursType),
});

/** A group: a hall's presses, a hall's crews, the bindery or dispatch, and its resources by their code. */
export const GroupRowType = StructType({
  name: StringType,
  resources: DictType(StringType, ResourceRowType),
});

export const works = e3.record("works", DictType(StringType, GroupRowType), {
  initial: new Map(),
  indexes: (index) => ({
    // The rail's order and its search.
    works_by_name: index.on(["name"]),
    // A group under each of its resources' codes, a field of the rail's (`code`), so the rail finds a press by its code.
    works_by_resource: index.keys(East.function([StringType, GroupRowType], SetType(StructType({ code: StringType })),
      ($, _key, group) => {
        const codes = $.let(new Set<{ code: string }>(), SetType(StructType({ code: StringType })));
        $.for(group.resources, ($2, _resource, code) => { $2(codes.insert({ code })); });
        return codes;
      })),
    // What belongs to the resources, a day at a time, its totals by the month: the finest the Plan's axis zooms to.
    works_in_time: index.nestedSeries({
      collections: {
        resources: index.nestedSeries.rows({
          utilisation: index.nestedSeries.values(),
          hours: index.nestedSeries.rows({ hours: index.nestedSeries.values({ rollup: "sum" }) }),
        }),
      },
      tile: "day",
      summary: "month",
    }),
  }),
  mutations: (mutation) => ({
    // The Plan's and the Sheet's save door for the rows, by a group's key.
    patch: mutation.patch(),
  }),
});

/** A print job on a press: what it is, for whom, when it runs, its sheets and its lifecycle. */
export const JobType = StructType({
  title: StringType,
  customer: StringType,
  press: StringType,
  start: DateTimeType,
  end: DateTimeType,
  sheets: FloatType,
  state: EventStateType,
});

export const JobsType = DictType(StringType, JobType);
export const jobs = e3.record("jobs", JobsType, {
  initial: new Map(),
  indexes: (index) => ({
    // The rail's window: each job overlapping it, read once.
    jobs_by_time: index.interval({ from: "start", to: "end" }),
    // The jobs by the press each is on and by time: a press's jobs over any span are one contiguous range, so the
    // presses in view are read a cell at a time.
    jobs_by_press_week: index.flatSeries({ key: "press", from: "start", to: "end", tile: "week" }),
    // How busy each press is, a month at a time: what the Plan shades where the jobs in view are too many to draw.
    jobs_by_press_month: index.summary({ key: "press", from: "start", to: "end", tile: "month" }),
  }),
  mutations: (mutation) => ({
    // The Plan's save door for the jobs.
    patch: mutation.patch(),
  }),
});

/** A stop on a press at an instant: a plate change or a service. */
export const StopType = StructType({
  title: StringType,
  press: StringType,
  at: DateTimeType,
  kind: VariantType({ plate_change: NullType, service: NullType }),
});

/** A bindery job on a line. */
export const BindingType = StructType({
  title: StringType,
  line: StringType,
  start: DateTimeType,
  end: DateTimeType,
  state: EventStateType,
});

/** A crew's shift. */
export const ShiftType = StructType({
  title: StringType,
  crew: StringType,
  start: DateTimeType,
  end: DateTimeType,
  state: EventStateType,
});

/** A delivery: what it carries, the bay or van it leaves from, its slot, the lane it loads in ("AM" or "PM"), its
 *  pallets and how far it has got. */
export const DeliveryType = StructType({
  title: StringType,
  location: VariantType({ bay: StringType, van: StringType }),
  at: DateTimeType,
  lane: StringType,
  pallets: FloatType,
  status: VariantType({ dispatched: NullType, queued: NullType, ready: NullType }),
});

/** The stops, bindery jobs, shifts and deliveries: a record each, as planPrintWorks keeps them. The works' rows are
 *  paged, so each kind has the jobs' three indexes (U1): its window, its rows in view a cell at a time, and their months. */
export const stops = e3.record("stops", DictType(StringType, StopType), {
  initial: new Map(),
  indexes: (index) => ({
    // A stop is an instant: its end is its start.
    stops_by_time: index.interval({ from: "at", to: "at" }),
    stops_by_press_week: index.flatSeries({ key: "press", from: "at", to: "at", tile: "week" }),
    stops_by_press_month: index.summary({ key: "press", from: "at", to: "at", tile: "month" }),
  }),
  mutations: (mutation) => ({ patch: mutation.patch() }),
});
export const bindings = e3.record("bindings", DictType(StringType, BindingType), {
  initial: new Map(),
  indexes: (index) => ({
    bindings_by_time: index.interval({ from: "start", to: "end" }),
    bindings_by_line_week: index.flatSeries({ key: "line", from: "start", to: "end", tile: "week" }),
    bindings_by_line_month: index.summary({ key: "line", from: "start", to: "end", tile: "month" }),
  }),
  mutations: (mutation) => ({ patch: mutation.patch() }),
});
export const shifts = e3.record("shifts", DictType(StringType, ShiftType), {
  initial: new Map(),
  indexes: (index) => ({
    shifts_by_time: index.interval({ from: "start", to: "end" }),
    shifts_by_crew_week: index.flatSeries({ key: "crew", from: "start", to: "end", tile: "week" }),
    shifts_by_crew_month: index.summary({ key: "crew", from: "start", to: "end", tile: "month" }),
  }),
  mutations: (mutation) => ({ patch: mutation.patch() }),
});
export const deliveries = e3.record("deliveries", DictType(StringType, DeliveryType), {
  initial: new Map(),
  indexes: (index) => ({
    deliveries_by_time: index.interval({ from: "at", to: "at" }),
    // Filed by the bay or the van itself: the key field is the variant, so a row's cells are asked by its key in its case.
    deliveries_by_location_week: index.flatSeries({ key: "location", from: "at", to: "at", tile: "week" }),
    deliveries_by_location_month: index.summary({ key: "location", from: "at", to: "at", tile: "month" }),
  }),
  mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** A feed: the sheets a job or a bindery job passes on to a bindery job or a delivery. Each end holds the key of the
 *  event it joins, in its kind's own key type. */
export const FeedType = StructType({
  from: VariantType({ binding: StringType, job: StringType }),
  to: VariantType({ binding: StringType, delivery: StringType }),
  sheets: FloatType,
});
/** The planner's feeds: a record of links (U10), saved through its patch door as the events are. */
export const feeds = e3.record("feeds", DictType(StringType, FeedType), {
  initial: new Map(),
  mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** A customer, for the library's Customers tab: a record of its own. */
export const CustomerType = StructType({ name: StringType, district: StringType });
export const customers = e3.record("customers", DictType(StringType, CustomerType), {
  initial: new Map(),
  indexes: (index) => ({ customers_by_district: index.on(["district"]) }),
});

/** An order not yet planned, for the library's Orders tab. The list is the solution's own, kept as it chooses: a record
 *  here, or a task's output of the orders no job names. */
export const OrderType = StructType({ title: StringType, customer: StringType, sheets: FloatType, due: DateTimeType });
export const orders = e3.record("orders", DictType(StringType, OrderType), { initial: new Map() });

/** The works' optimiser, on e3, by the builders' one contract (#1622). Its request is `{ from, to, run, slice }`: the
 *  dates in view, the run's number and the rail's narrowing. No row is sent. The Plan's unsaved jobs are laid over the
 *  record as drafts, and the function reads the rest itself: each press's jobs for the dates through the series index,
 *  the presses from the works' rows and the orders to place from their record. Its answer is a patch of each record the
 *  Plan edits: of the jobs an insert for each order placed, under the order's key, and of every other kind no change.
 *  The example's places each order no job stands under on the press free soonest (`planPrintWorksRecords`). */
export const placeJobs = e3.function("place_jobs", {
  inputs: [e3.index(jobs.indexes.jobs_by_press_week), jobs, orders, works],
  drafts: [jobs],                                   // the Plan's unsaved edits of jobs are laid over it
  args: [Plan.Types.OptimiseRequest],
  output: Plan.Types.OptimiseResult({ binding: BindingsType, delivery: DeliveriesType, job: JobsType, shift: ShiftsType, stop: StopsType }),
}, ($, jobsByPress, jobs, orders, works, request) => {
  const before = $.let(new Map(), JobsType);
  const after = $.let(new Map(), JobsType);
  // … each order no job stands under, placed on the press free soonest: `planPrintWorksRecords` has it whole
  return { events: {
    job: East.diff(before, after),
    binding: East.value(variant("unchanged", null), PatchType(BindingsType)),
    delivery: East.value(variant("unchanged", null), PatchType(DeliveriesType)),
    shift: East.value(variant("unchanged", null), PatchType(ShiftsType)),
    stop: East.value(variant("unchanged", null), PatchType(StopsType)),
  } };
});
```

- **Rows and events.** The works' rows are the resources and their groups,
  with what belongs to them. The jobs, stops, bindery jobs, shifts and
  deliveries are records of their own, each naming the resource it is on by
  a field, as planPrintWorks' are today.
- **Links.** The feeds are a record of their own too, each naming the two
  events it joins by fields, typed by each kind's own key type (U10).
- **Both page in two dimensions.** The works' nested series index pages the
  rows a page at a time and each collection a week at a time, with the
  months' totals. A crew's row draws the sum of its roles' hours as e3 keeps
  it (`values({ rollup: "sum" })`), as planNestedAll's works draw their
  crews'. The jobs' series index files each job by its press and its weeks,
  so the presses in view are read a cell at a time, and its summary shades
  the view zoomed out, as planWindows reads 2,000 presses today. Every
  other event kind has the same three indexes and is read the same way:
  over paged rows no kind is read whole (U1).
- **What e3 lacked for it (§8): E1,** a crew's hours keyed by `RoleType`. e3
  took child rows only as `Dict<String, Struct>`; it now takes a Dict keyed
  by any type but a DateTime (§8, E1).
- **A press found by its code.** `works_by_resource` files each group under
  its resources' codes with `index.keys`. The entries index
  (`index.entries("resources")`, #1521, on main) would file each resource
  itself, but e3 takes no entries index beside a nested series index
  (`record-builders.ts:329`), and the works have one.

### 3.2 The bound records

§3.2 to §3.6 run inside a UI task's `<Reactive>{$ => …}</Reactive>` body,
with these imports beside §3.1's:

```ts
import { some, variant } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui";
import { Data, Func, Plan, Record, Schedule, Sheet } from "@elaraai/e3-ui";
```

```ts
// The rows' save door: the groups and the resources, their own fields and values, by a group's key.
const record = $.let(Record.bind(works, ["patch"]));
// Each event kind's record and save door, as today, and its entries, which read one event by its key: every kind
// here is read a cell at a time (U1).
const jobRecord = $.let(Record.bind(jobs, ["patch"]));
const jobEntries = $.let(Data.bindPaged(jobs));
const stopRecord = $.let(Record.bind(stops, ["patch"]));
const stopEntries = $.let(Data.bindPaged(stops));
const bindingRecord = $.let(Record.bind(bindings, ["patch"]));
const bindingEntries = $.let(Data.bindPaged(bindings));
const shiftRecord = $.let(Record.bind(shifts, ["patch"]));
const shiftEntries = $.let(Data.bindPaged(shifts));
const deliveryRecord = $.let(Record.bind(deliveries, ["patch"]));
const deliveryEntries = $.let(Data.bindPaged(deliveries));
// The link kind's record and save door (U10), read whole.
const feedRecord = $.let(Record.bind(feeds, ["patch"]));
```

- **One handle for the rows.** The Plan takes the works' handle as `record`,
  as the Sheet already does. Today a Plan over data rows wants
  `editing={{ onApply: Record.onApply(record, { keyed: true }) }}`, keyed as
  planNestedAll saves its works: by the row's key and each item's.
- **A record per event kind, as today, and per link kind (U10).** One Save
  commits every record the session changed, the rows', the events' and the
  links', each through its patch door.
- **A lock is the solution's own rule (U9).** A job under way is locked by
  its kind's `locked` (§3.5). Over a composite record an external source's
  jobs are locked too, by their key (U6, §3.8).

### 3.3 The slice

```ts
const slice = $.let(Slice.bindRecords("works", {
  rows: {
    // The groups a page at a time, by name, beside their nested series index: read without their collections,
    // each collection a week at a time.
    source: Data.bindPaged(works, { indexes: ["works_by_name", "works_by_resource", "works_in_time"] }),
    label: "Works", icon: { prefix: "fas", name: "industry" },
    // The rail narrows the groups by name, and to the group holding a resource by the resource's code.
    fields: { name: { label: "Group" }, code: { label: "Resource" } },
    search: ["name", "code"],
  },
  // The jobs on the rows in view, a cell at a time: the presses in view by the weeks in view, and each press's months
  // where the jobs are too many to draw. Its range is the window the rows share.
  job: {
    source: Data.bindPaged(jobs, { indexes: ["jobs_by_time", "jobs_by_press_week", "jobs_by_press_month"] }),
    label: "Print jobs", icon: { prefix: "fas", name: "file-lines" },
    fields: { start: { label: "Dates" } }, range: "start",
  },
  shift: {
    source: Data.bindPaged(shifts, { indexes: ["shifts_by_time", "shifts_by_crew_week", "shifts_by_crew_month"] }),
    label: "Shifts", icon: { prefix: "fas", name: "user-clock" },
    fields: { start: { label: "Dates" } }, range: "start",
  },
  // The stops, the bindery jobs and the deliveries the same way: the rows are paged, so no kind is read whole (U1).
  stop: {
    source: Data.bindPaged(stops, { indexes: ["stops_by_time", "stops_by_press_week", "stops_by_press_month"] }),
    label: "Stops", icon: { prefix: "fas", name: "screwdriver-wrench" },
    fields: { at: { label: "Dates" } }, range: "at",
  },
  binding: {
    source: Data.bindPaged(bindings, { indexes: ["bindings_by_time", "bindings_by_line_week", "bindings_by_line_month"] }),
    label: "Bindery jobs", icon: { prefix: "fas", name: "book-open" },
    fields: { start: { label: "Dates" } }, range: "start",
  },
  delivery: {
    source: Data.bindPaged(deliveries, {
      indexes: ["deliveries_by_time", "deliveries_by_location_week", "deliveries_by_location_month"],
    }),
    label: "Deliveries", icon: { prefix: "fas", name: "truck" },
    fields: { at: { label: "Dates" } }, range: "at",
  },
  // A library tab's source: it narrows the Customers tab by district.
  customers: {
    source: Data.bindPaged(customers, { indexes: ["customers_by_district"] }),
    icon: { prefix: "fas", name: "building" },
    fields: { district: { label: "District" } },
  },
  // Every kind's templates, one record and one source (§9, question 1): each kind's cards are its case of them.
  templates: {
    source: Data.bindPaged(presets, { indexes: ["presets_by_name"] }),
    icon: { prefix: "fas", name: "layer-group" },
    fields: { name: { label: "Template" } },
  },
}));
```

- **The API is unchanged.** The `rows` source is planNestedAll's, each event
  kind's source planWindows' (a paged kind's three indexes), and the
  `customers` source planPrintWorks'. Every event kind has its source: the
  rows are paged, so each kind is read a cell at a time and none whole (U1).
- **Rows and events page together.** The `rows` source pages the groups,
  and through the nested series index what belongs to them a week at a time.
  The `job` source pages the jobs on the presses in view through
  `jobs_by_press_week`, and shades the view zoomed out from
  `jobs_by_press_month`. Each other kind's source does the same for its own
  rows. All keep to the one window (`range`).
- **Other sources narrow library tabs:** the customers here, and the
  templates, deliveries, weeks and orders tabs of planPrintWorks,
  planTargetState, planMeasures and planNumberAxis.
- **Search Records** (#1513, PR #1481) finds a group in the whole record,
  names what hides it, and a pick clears those choices and goes to its row.
- **The nested resources' page.** A group's resources come with its page,
  carried lean (`plan/root.ts:109-111`), and nothing pages inside a group:
  a hall that may hold more than a page of presses keeps them as rows of
  their own, grouped by an index, as planSeriesByHall does (the epic's §6).
- **Confirmed in the build:**
  - the rail finds a press by its code through the `index.keys` index once
    the index files the codes under a named field (`{ code }`): the rail
    offers no field for a set of plain Strings. Narrowed to a code, the works
    are the group holding that resource. The toolbar's Search Records box
    finds a group by its name, and does not look inside one for a press;
  - the deliveries' series and summary indexes filed by a variant field
    (`location`), their cells asked by a bay's or a van's key in its case;
  - the stops' and the deliveries' series and summary indexes over one
    instant field (`from` and `to` both `at`).

### 3.4 The Plan

```tsx
const customerRows = $.let(Data.bind(customers));
// The solution's own orders to plan (§3.1): the Orders tab's cards.
const orderRows = $.let(Data.bind(orders));
// The solution's optimiser (§3.1): the Elara eye in the toolbar calls it once a run.
const optimise = $.let(Func.bind(placeJobs));
return (
  <Plan
    id="works"
    slice={{ slice }}
    record={record}
    axis={Plan.axis({
      window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-11-02T00:00:00Z") },
      resolution: "day",
      resolutions: ["day", "week", "month", "quarter"],
    })}
    series={series}   // §3.5: the rows
    events={events}   // §3.5: the event kinds, on the rows
    links={links}     // §3.5: the link kinds, joining the events (U10)
    hidden={["utilisation"]}
    optimise={optimise}
    library={[
      Plan.library.events(),   // every kind's templates, each kind's under its name
      Plan.library.series(),
      Plan.library.tab(orderRows.read(), {
        name: "Orders", icon: "inbox", label: (o) => o.title, group: (o) => o.customer,
        // A card dropped on a press makes a job there, as a template does (U1): as long as its sheets take at 8,000
        // an hour, as planOptimise times a job.
        create: {
          kind: "job",
          duration: (o) => variant("hours", o.sheets.divide(8000.0)),
          values: (o) => ({
            title: o.title, customer: o.customer, sheets: o.sheets, state: variant("proposed", variant("added", null)),
          }),
        },
      }),
      Plan.library.tab(customerRows.read(), {
        name: "Customers", icon: "building", label: (c) => c.name, group: (c) => c.district,
        drop: (c) => Schedule.patch(JobType, { customer: c.name }),
        source: "customers",
      }),
    ]}
    inspector
    style={{ height: "fill" }}
  />
);
```

- **Picking (U3):** the library lists `Plan.library.series()`, so every
  series can be switched on and off in the Series tab, kept under the Plan's
  `id`; `hidden` names the ones off to start. `Plan.pick` goes.
- **The library (U1):** the Orders tab lists the solution's own orders. A
  card dropped on a press makes a job there, as a template does: the Plan
  sets its press, its start where it lands and its end by `duration`, and
  `values` give the rest. The Plan writes only its records, so a placed
  order leaves the list
  when the solution's own data says so: a list made by a task, of the orders
  no job names, drops it at the next run. A customer dropped on a job sets
  its customer, as planPrintWorks' tab does. The built-in backlog stays, for
  a kind whose record holds events with no start yet (its `backlog`,
  `Plan.library.backlog()`), with the words `vocabulary` gives it (#1516).
- **The inspector (U5):** the selected job's form (`fields`), as today. A
  selected row, a press or a crew, shows its own fields, as a resource's row
  does today.
- **The links (U10):** each feed draws from its `from` event to its `to`
  event, its sheets weighing the ribbon, in the links focus as today's links
  do. The Connect tool offers the feeds' kind for a drag from a job or a
  bindery job to a bindery job or a delivery, and the feed it makes saves
  with the session's other drafts. A selected feed shows its form in the
  inspector.
- **The optimiser (U5):** the Elara eye in the toolbar, as today, by the
  builders' one contract (#1622). A run sends the dates in view, the run's
  number and the rail's narrowing, and the Plan's unsaved jobs as drafts:
  no row, and nothing of the Orders tab. `placeJobs` (§3.1) reads each
  press's jobs through their series index, the drafts laid over them, and
  the orders from their record. Its answer is a patch of the jobs, landed
  as one edit, which one Undo reverts and Save commits:
  - an insert adds a job, under the key the optimiser gave it;
  - an update changes one, and moves it where its press changed;
  - a delete removes one.

  An order the optimiser places is an insert. A job the patch does not
  name stays as it is. An answer that changes a locked job is refused,
  naming it (U9; over a composite record, U6).

### 3.5 The series and the events

```tsx
// The rows: the groups, each resource drawn by its kind with what belongs to it.
const series = [
  Plan.series.group(GroupRowType, {
    key: "groups", title: "Works", label: (group) => group.name,
    children: Plan.children("resources", [
      // Each resource by its kind (U2): a case of `what` per entry, each case a resources series (U1), its key the
      // case's name. A case draws each row of its case, and the event kinds whose `of` names the case land on it; its
      // `series` are rows beneath it, as a resource's `measures` are today.
      Plan.series.kinds(ResourceRowType, "what", {
        press: {
          title: "Presses", icon: "print", label: (press) => press.name,
          series: [
            Plan.series.heat(ResourceRowType, {
              key: "utilisation", title: "Utilisation",
              cells: Plan.heatCells(Plan.values("utilisation", (pct) => ({ value: some(pct) })),
                { min: 0, max: 100, warnAt: 95 }),
            }),
          ],
        },
        line: { title: "Bindery lines", icon: "book-open", label: (line) => line.name },
        crew: {
          title: "Crews", icon: "users", label: (crew) => crew.name,
          series: [
            // The nested table: the crew's planned hours each week, the sum e3 keeps of its roles', each role beneath
            // it, typed into a week at a time, as planNestedAll's crews are.
            Plan.series.table(ResourceRowType, {
              key: "hours", title: "Hours", aggregate: "sum", collapsed: true,
              children: Plan.children("hours", [Plan.series.table(RoleHoursType, {
                key: "role", title: "Role", keyType: RoleType, edit: true,
                label: (_hours, role) => role.match({ assistant: () => "Assistant", operator: () => "Operator" }),
                cells: Plan.tableCells(Plan.values("hours", (h) => ({ value: some(h) }))),
              })]),
            }),
          ],
        },
        bay: { title: "Bays", icon: "warehouse", label: (bay) => bay.name },
        van: { title: "Vans", icon: "truck", label: (van) => van.name },
      }),
    ]),
  }),
];

// The events: a kind per record, each on the rows its `of` names, every option as planPrintWorks writes it today.
const events = {
  job: Schedule.events(jobRecord, {
    name: "Print job", icon: "file-lines", draw: "span",
    title: "title", start: "start", end: "end",
    resource: { field: "press", of: "press" },   // a press's row (U1)
    state: "state", quantity: { field: "sheets", unit: "sheets" },
    // A job under way is locked, by the solution's own rule (U9).
    locked: (job) => job.state.hasTag("in-progress"),
    fields: {
      customer: Schedule.field.text({ label: "Customer" }),
      sheets: Schedule.field.number({ label: "Sheets", step: 1000.0, min: 0.0 }),
    },
    entries: jobEntries,
  }),
  stop: Schedule.events(stopRecord, {
    name: "Stop", icon: "screwdriver-wrench", draw: "marks",
    title: "title", at: "at", resource: { field: "press", of: "press" },
    entries: stopEntries,
  }),
  binding: Schedule.events(bindingRecord, {
    name: "Bindery job", icon: "book-open", draw: "cards",
    title: "title", start: "start", end: "end", resource: { field: "line", of: "line" },
    state: "state", overlaps: "allow", entries: bindingEntries,
  }),
  shift: Schedule.events(shiftRecord, {
    name: "Crew shift", icon: "user-clock", draw: "cards",
    title: "title", start: "start", end: "end", resource: { field: "crew", of: "crew" },
    state: "state", entries: shiftEntries,
  }),
  // A bay's and a van's deliveries, drawn alike: tiles at their slot in AM and PM lanes, a queued one ringed.
  delivery: Schedule.events(deliveryRecord, {
    name: "Delivery", icon: "truck", draw: "buckets", title: "title", at: "at",
    resource: { field: "location", of: { bay: "bay", van: "van" } }, lane: "lane",
    status: { field: "status", cases: {
      queued: { label: "Queued", tone: variant("warning", null), ring: true },
      ready: { label: "Ready", tone: variant("info", null), ring: false },
      dispatched: { label: "Dispatched", tone: variant("success", null), ring: false },
    } },
    ready: (d) => d.pallets.lessEqual(0.0).ifElse(
      () => variant("invalid", [{ field: "pallets", message: "Pallets must be positive" }]),
      () => variant("ready", null)),
    fields: { pallets: Schedule.field.number({ label: "Pallets", min: 0.0, step: 1.0 }) },
    entries: deliveryEntries,
  }),
};

// The links: a kind per record (U10), each link joining two events, each end a case per event kind it may name.
const links = {
  feed: Plan.links(feedRecord, {
    name: "Feed", icon: "arrow-right-long",
    from: { field: "from", of: { binding: "binding", job: "job" } },
    to: { field: "to", of: { binding: "binding", delivery: "delivery" } },
    quantity: { field: "sheets", unit: "sheets" },
    fields: { sheets: Schedule.field.number({ label: "Sheets", step: 1000.0, min: 0.0 }) },
  }),
};
```

Each kind's templates are its case of the one presets record (§9, question 1):

```ts
// presets: Dict<String, { name, hours, values: Variant<{ job: …, stop: …, binding: …, shift: …, delivery: … }> }>
templates: Schedule.templates(presets.read(), {
  case: ["values", "job"], name: (preset) => preset.name,
  duration: (preset) => variant("hours", preset.hours), values: (_preset, _key, job) => job, source: "templates",
}),
```

`Schedule.events`, `Schedule.field.*`, `Schedule.patch` and every option the
kinds use here are today's, as planPrintWorks writes them. Three things are
new: `of` names a resources series or a `kinds` case of the rows by its key,
where today it names a `resources` slot (U1); `locked` (U9); and
`Plan.links` (U10), a link kind over a record, its ends named by fields as
an event's resource is, `of` naming event kinds. `keyType` is today's
option: a series' key type where it is no String, as the roles are.

`Plan.series.resources(Row, { key, title, icon, label, … })` (U1) is the
one series an event kind lands on, and a `kinds` case is one. A Plan over
one kind of row names it outright, as planEvents' presses are:
`Plan.series.resources(PrintPress, { key: "presses", title: "Presses",
icon: "print", label: (p) => p.name })`.

`Plan.series.kinds(Row, field, cases)` (U2) is one block. Its rules:

- **What it draws.** Each case is a resources series (U1), its key the
  case's name unless it gives `key`. Each row whose `field` holds the case,
  in the source's order, is drawn as the case's row, the event kinds whose
  `of` names the case are drawn on it, then its `series`, then its
  `children` (§3.7), as a resource kind draws today.
- **Every case, or `false`.** The cases are exhaustive, as an East `match`
  is: a case not drawn says `false`, its rows left out, and a case the
  variant gains later fails to compile until it is listed.
- **`row: false`.** The case's own row isn't drawn; its `series` and
  `children` stand at its level (U2; §3.7's press page).
- **Labels.** A case's `label`, `sub`, `value`, `status` and `expand` are
  the row's, given once for all its series (`plan/series.ts:674-710`). A
  `views` member writes its label again in each series.
- **Callbacks.** Every callback inside a case takes the case's value after
  the row and its key: `(row, key, value)`.
- **Keys.** Every key is unique across the tree, a case's included, as a
  series' is today (`plan/series.ts:337-349`). `of`
  and `hidden` name a resources series or a case by that one key; a name
  that is neither is refused at build. The Series tab lists each case under
  its title.
- **One case only.** `case: [field, tag]` on a single series does the same for
  one series. For example, over planTargetState's rows (`TargetOpsRow`,
  whose `kind` variant has a `kpi` case):
  `Plan.series.chart(TargetOpsRow, { case: ["kind", "kpi"], label: (r, k, kpi) => kpi.name, … })`.
- **`match` stays,** for a predicate that isn't a variant case: a String
  field, or the row's key. Inside a case it is handed the case's value too,
  for a test of it, as planTargetState's van blocks test the van's region:
  `match: (r, k, van) => van.region.equal("local")`.

What a resource kind gives today, the record's rows give (U1):

| `Schedule.resources(rows, { … })` | On the record's rows |
|---|---|
| a dataset per kind, under its slot in `resources` | the record's rows: a resources series (`Plan.series.resources`), or a `kinds` case per kind (U1, U2) |
| `name`, `icon` | the series' or the case's `title` and `icon` |
| `label`, `sub`, `meta`, `value` | the series' or the case's `label`, `sub` and `value`; `meta` goes in `sub` |
| `group` | a group row the resources nest in: `Plan.series.group` with `children` |
| `parent`, `rollup`, `collapsed` | a tree: `children: "field"` with `rollup: "union"`, and `collapsed` |
| `measures: [series]` | the case's `series`, over the row's own collections, read a cell at a time |
| its lanes, from the events | the series' `lanes`; a variant `lane` draws every case in that order (U1) |
| an event's `resource: { field, of }`, `of` a slot | the same, `of` a resources series or a `kinds` case, or a case for each case of a variant field (`{ bay: "bay", van: "van" }`); `child: { field, of }` one step beneath (U1) |

### 3.6 The Sheet

```tsx
// The Sheet's own rail: the works' `rows` source, as §3.3's is. The Plan's rail is not handed to it: a Sheet refuses
// a source nothing of it names, and the event kinds' sources are the Plan's.
const sheetSlice = $.let(Slice.bindRecords("works-sheet", {
  rows: {
    source: Data.bindPaged(works, { indexes: ["works_by_name"] }),
    label: "Works", icon: { prefix: "fas", name: "industry" },
    fields: { name: { label: "Group" } },
    search: ["name"],
  },
}));

<Sheet slice={{ slice: sheetSlice }} onApply={Record.onApply(record, { keyed: true })}
  columns={{ /* the groups' and resources' own fields: §9 */ }} />
```

The Sheet already reads a record's rows through a rail's `rows` source, and
saves them to the record through `Record.onApply`. Beside a rail it is not
given `record`: that names the rows a second time, and is refused (e3-ui
`sheet/sheet.ts`). It edits the same record the Plan does. The jobs open in
a Sheet of their own the same way.

### 3.7 One press, and every press

A press takes tasks of a few kinds (blanket washes, ink fills, plate checks,
roller washes), each in the morning or the afternoon of a day. Two pages
draw them from one record of tasks: the works' page, every machine with its
rows beneath it; and a press's own page, the works' page scoped to it with
its own row not drawn, so its rows stand at the root. The types are defined
here; the imports are §3.2's with `East`.

```ts
import { DateTimeType, DictType, FloatType, NullType, StringType, StructType, VariantType } from "@elaraai/east";
import { EventStateType } from "@elaraai/east-ui";
import * as e3 from "@elaraai/e3";

/** What a machine is. */
export const MachineKindType = VariantType({ folder: NullType, press: NullType });

/** A kind of task on a press. */
export const TaskKindType = VariantType({
  blanket_wash: NullType, ink_fill: NullType, plate_check: NullType, roller_wash: NullType,
});

/** The half of a day a task is done in: its lane. */
export const HalfType = VariantType({ am: NullType, pm: NullType });

/** A kind of task as the works names it: a child row of its press. */
export const TaskKindRowType = StructType({ name: StringType });

/** A machine, keyed by its code: a press fills `temperature` and `kinds`, a folder `utilisation`. */
export const MachineRowType = StructType({
  name: StringType,
  what: MachineKindType,
  temperature: DictType(DateTimeType, FloatType),     // its ink's temperature at each reading, in °C
  utilisation: DictType(DateTimeType, FloatType),     // the share of each day it is busy, in %
  kinds: DictType(TaskKindType, TaskKindRowType),     // the kinds of task it takes: its child rows (E1)
});

export const machines = e3.record("machines", DictType(StringType, MachineRowType), {
  initial: new Map(),
  indexes: (index) => ({
    // The key itself, for a page's scope (U11): `index.key(fn)` files a key the row computes.
    machines_by_code: index.key(East.function([StringType, MachineRowType], StructType({ code: StringType }),
      (_$, code) => ({ code }))),
    machines_by_name: index.on(["name"]),             // the rail's order and its search
    machines_in_time: index.nestedSeries({
      collections: {
        temperature: index.nestedSeries.values(),
        utilisation: index.nestedSeries.values(),
        kinds: index.nestedSeries.rows({}),                 // child rows keyed by a variant: E1 (#1540)
      },
      tile: "day",
      summary: "month",
    }),
  }),
});

/** A task on a press: its kind, the day and the half it is done in, and its lifecycle. */
export const PressTaskType = StructType({
  title: StringType,
  press: StringType,
  kind: TaskKindType,
  day: DateTimeType,
  half: HalfType,
  state: EventStateType,
});

export const pressTasks = e3.record("press_tasks", DictType(StringType, PressTaskType), {
  initial: new Map(),
  indexes: (index) => ({
    // The works' rail: the tasks by their day, and the days a window holds, which the footer's count reads through.
    press_tasks_by_day: index.on(["day"]),
    press_tasks_by_time: index.interval({ from: "day", to: "day" }),
    // A press's page: its scope's press alone, which its search reads through; then its rail's days, and a window's (U11).
    press_tasks_by_press: index.on(["press"]),
    press_tasks_by_press_day: index.on(["press", "day"]),
    press_tasks_by_press_time: index.interval({ on: ["press"], from: "day", to: "day" }),
    // A paged kind's series and summary indexes, as the jobs' (§3.1); each task is an instant (its end is its start).
    press_tasks_by_press_week: index.flatSeries({ key: "press", from: "day", to: "day", tile: "week" }),
    press_tasks_by_press_month: index.summary({ key: "press", from: "day", to: "day", tile: "month" }),
  }),
  mutations: (mutation) => ({ patch: mutation.patch() }),
});
```

Both pages share the tasks, the axis, the series and the event kind:

```tsx
const taskRecord = $.let(Record.bind(pressTasks, ["patch"]));
const taskEntries = $.let(Data.bindPaged(pressTasks));
const axis = Plan.axis({
  window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-11-02T00:00:00Z") },
  resolution: "day",
  resolutions: ["day", "week", "month"],
});

// A row per kind of task, each day in AM and PM lanes, in this order: the rows the tasks land on (U1).
const kindRows = Plan.series.resources(TaskKindRowType, {
  key: "kinds", title: "Tasks", icon: "list-check", keyType: TaskKindType,
  label: (kind) => kind.name,
  lanes: () => [Plan.lane({ key: "am", label: "AM" }), Plan.lane({ key: "pm", label: "PM" })],
});
// The press's ink temperature, a chart of its own readings; pinned under the ruler on the press's own page.
const temperature = Plan.series.chart(MachineRowType, {
  key: "temperature", title: "Ink temperature", label: () => "Ink °C",
  layers: [Plan.line(Plan.values("temperature", (t) => ({ y: t })))],
});
const pinnedTemperature = Plan.series.chart(MachineRowType, {
  key: "temperature", title: "Ink temperature", label: () => "Ink °C", pinned: () => true,
  layers: [Plan.line(Plan.values("temperature", (t) => ({ y: t })))],
});

// The one event kind, on both pages: on its press's row, then its kind's row beneath it (`child`), in its half's lane (U1).
const events = {
  task: Schedule.events(taskRecord, {
    name: "Press task", icon: "list-check", draw: "buckets", title: "title", at: "day", state: "state",
    resource: { field: "press", of: "press" },
    child: { field: "kind", of: "kinds" },
    lane: "half",
    entries: taskEntries,
  }),
};
```

The works' page, each machine's rows beneath it:

```tsx
const slice = $.let(Slice.bindRecords("machines", {
  rows: {
    source: Data.bindPaged(machines, { indexes: ["machines_by_name", "machines_in_time"] }),
    label: "Machines", icon: { prefix: "fas", name: "print" }, search: ["name"],
  },
  task: {
    source: Data.bindPaged(pressTasks, {
      indexes: ["press_tasks_by_day", "press_tasks_by_time", "press_tasks_by_press_week", "press_tasks_by_press_month"],
    }),
    label: "Press tasks", icon: { prefix: "fas", name: "list-check" }, fields: { day: { label: "Days" } }, range: "day",
  },
}));

const series = [
  Plan.series.kinds(MachineRowType, "what", {
    press: {
      title: "Presses", icon: "print", label: (press) => press.name,
      series: [temperature],
      // Beneath the press, after its series (U2): the kinds it takes, its own child rows.
      children: Plan.children("kinds", [kindRows]),
    },
    folder: {
      title: "Folders", icon: "layer-group", label: (folder) => folder.name,
      series: [Plan.series.heat(MachineRowType, {
        key: "utilisation", title: "Utilisation",
        cells: Plan.heatCells(Plan.values("utilisation", (pct) => ({ value: some(pct) })), { min: 0, max: 100, warnAt: 95 }),
      })],
    },
  }),
];

return (
  <Plan id="machines" slice={{ slice }} axis={axis} series={series} events={events}
    library={[Plan.library.series()]} inspector />
);
```

A press's page, `press` its code, a value the page holds: the works' page
scoped on the rail (U11), its own row not drawn (`row: false`, U2), so its
rows stand at the root:

```tsx
const slice = $.let(Slice.bindRecords(East.str`press.${press}`, {
  rows: {
    source: Data.bindPaged(machines, { indexes: ["machines_by_code", "machines_in_time"] }),
    scope: { code: [press] },
  },
  task: {
    source: Data.bindPaged(pressTasks, {
      indexes: ["press_tasks_by_press", "press_tasks_by_press_day", "press_tasks_by_press_time",
        "press_tasks_by_press_week", "press_tasks_by_press_month"],
    }),
    scope: { press: [press] },
    label: "Tasks", icon: { prefix: "fas", name: "list-check" }, fields: { day: { label: "Days" } }, range: "day",
  },
}));

const series = [
  Plan.series.kinds(MachineRowType, "what", {
    press: { title: "Press", row: false, series: [pinnedTemperature], children: Plan.children("kinds", [kindRows]) },
    folder: false,   // not drawn: the scope holds a press alone
  }),
];

return (
  <Plan id="press" slice={{ slice }} axis={axis} series={series} events={events}
    library={[Plan.library.series()]} inspector />
);
```

- **Where a task lands.** On both pages, on its press's row (`resource`),
  then on the row of its kind beneath it (`child`), in its half's lane. A
  drop on another kind's row writes its `kind`, on another press's row (the
  works' page) its `press`, on the other lane its `half`; `canDrop` is told
  each (U7). A task made on a press's page takes its press from the scope
  (U11) and its kind from the row it lands on.
- **The kinds' rows.** One resources series on both pages: the press's own
  child rows, keyed by a variant (`keyType`, E1), read lean with the press's
  page (§3.3). Both lanes are drawn, task or none, in the order `lanes` lists
  them (U1). The same kinds under every press, from a list of the works'
  own, would be `Plan.children.of` (U12).
- **The scope.** `machines_by_code` answers the rows' scope and
  `press_tasks_by_press_day` the tasks' with the rail's days (U11); the rail
  shows no control for either, and nothing the viewer does clears them.

### 3.8 Then, over composite records (U6)

Built after this issue's pull requests, with composite records (#1465), in
their pull request (#1468). The print works' ERP delivers the works, each
hall with its presses, the bindery with its lines, and dispatch with its
bays and vans, with each press's utilisation; and it delivers the jobs it
has scheduled. The planner keeps rows of its own, each hall's crews with
their hours by role, and adds and moves jobs of its own beside the ERP's.

Two records become composite, and a feed's job end takes their key. The
rest of §3.1 stands.

```ts
import { PatchType } from "@elaraai/east";   // beside §3.1's imports

/** Which source an entry comes from, and its id there: the ERP's, which its load writes, or the planner's own, which
 *  the Plan and the Sheet write. A composite record's key, as e3 builds it from the sources (#1468). */
export const SourceKeyType = VariantType({ erp: StringType, own: StringType });

/** The works' load (#1468): the ERP's latest groups, against the source's entries as they stand, to the patch that
 *  makes them the delivery. `erpWorks`, its feed, is a task of the solution's that turns the ERP's export into rows. */
export const loadWorks = East.function(
  [DictType(StringType, GroupRowType), DictType(StringType, GroupRowType)],
  PatchType(DictType(StringType, GroupRowType)),
  ($, delivery, current) => East.diff(current, delivery),
);

export const works = e3.recordComposite("works", GroupRowType, {
  sources: (source) => ({
    erp: source.load(StringType, erpWorks, loadWorks),  // loaded by the dataflow each time erp_works' output changes
    own: source.mutations(StringType),                  // the planner's own groups: each hall's crews
  }),
  initial: { own: new Map() },
  indexes: (index, { key }) => ({
    // The rail's order and its search.
    works_by_name: index.on(["name"]),
    // A group under each of its resources' codes, so the rail finds a press by its code.
    works_by_resource: index.keys(East.function([key, GroupRowType], SetType(StringType),
      ($, _key, group) => group.resources.keys())),
    // What belongs to the resources, a week at a time, its totals by the month.
    works_in_time: index.nestedSeries({
      collections: {
        resources: index.nestedSeries.rows({
          utilisation: index.nestedSeries.values(),
          hours: index.nestedSeries.rows({ hours: index.nestedSeries.values({ rollup: "sum" }) }),
        }),
      },
      tile: "day",
      summary: "month",
    }),
  }),
  mutations: (mutation) => ({
    // The Plan's and the Sheet's save door for the rows, by a group's key.
    patch: mutation.patch(),
  }),
});
// works' type, as #1468 builds it: Dict<SourceKeyType, GroupRowType>

/** The jobs' load: the ERP's latest scheduled jobs, as the works' load. `erpJobs` is its feed. */
export const loadJobs = East.function(
  [DictType(StringType, JobType), DictType(StringType, JobType)],
  PatchType(DictType(StringType, JobType)),
  ($, delivery, current) => East.diff(current, delivery),
);

export const jobs = e3.recordComposite("jobs", JobType, {
  sources: (source) => ({
    erp: source.load(StringType, erpJobs, loadJobs),   // the jobs the ERP has scheduled: locked in the Plan (U6)
    own: source.mutations(StringType),                 // the planner's own: made from the Orders tab, moved, removed
  }),
  initial: { own: new Map() },
  indexes: (index) => ({
    // The rail's window: each job overlapping it, read once.
    jobs_by_time: index.interval({ from: "start", to: "end" }),
    // The jobs by the press each is on and by time: a press's jobs over any span are one contiguous range, so the
    // presses in view are read a cell at a time.
    jobs_by_press_week: index.flatSeries({ key: "press", from: "start", to: "end", tile: "week" }),
    // How busy each press is, a month at a time: what the Plan shades where the jobs in view are too many to draw.
    jobs_by_press_month: index.summary({ key: "press", from: "start", to: "end", tile: "month" }),
  }),
  mutations: (mutation) => ({
    // The Plan's save door for the jobs.
    patch: mutation.patch(),
  }),
});
// jobs' type, as #1468 builds it: Dict<SourceKeyType, JobType>
export const JobsType = DictType(SourceKeyType, JobType);

/** A feed's job end then holds the jobs' composite key. */
export const FeedType = StructType({
  from: VariantType({ binding: StringType, job: SourceKeyType }),
  to: VariantType({ binding: StringType, delivery: StringType }),
  sheets: FloatType,
});
```

- **The jobs come from two sources.** The ERP's scheduled jobs and the
  planner's own are one composite record (#1468), keyed by `SourceKeyType`.
  e3 refuses any write to the ERP's, and a new job goes in under the
  planner's source. Nothing of the planner's sits in the ERP's rows, so each
  load is the delivery itself.
- **The ERP's jobs are locked by their source (U6).** #1468 has
  `Record.onApply` refuse a change to an external entry, and the Sheet draw
  an external row locked (its tasks G2 and G3). The Plan draws the ERP's jobs
  locked the same way, and the planner's move. `locked` adds a rule of the
  solution's own (U9).
- **What changes on the page.** The groups' series names its key type
  (`keyType: SourceKeyType`). A job made from the Orders tab goes in under
  the planner's own source (U6). The optimiser's answer is a patch of the
  composite `JobsType`, and an order it places is a job of the planner's
  own, under a new key of the `own` case. Nothing else of §3.2 to §3.5
  changes.
- **The Sheet.** Over a composite record, #1468 has it key a new row to the
  solution's own source and draw an external row locked (its tasks G3 and
  G4). The jobs, a composite record too, open in a Sheet of their own the
  same way.
- **To confirm in a build:** the jobs' interval, series and summary indexes
  on a composite record (#1465).

## 4. Plan props, today and proposed

| Prop | Today | Proposed |
|---|---|---|
| `axis`, `date`, `id`, `style`, `footer`, `grain`, `ui`, `expandRender`, `expandGutter`, `popover`, `hover`, `onSelect`, `onElementClick`, `onGroupToggle`, `onGrainChange`, `sources`, `rows`, `vocabulary` (PR #1481, #1516) | as documented | unchanged |
| `data` | the rows' source with no rail: a value, a whole-value handle or a paged handle | unchanged |
| `slice` | the rail. Its `rows` source gives the rows, and a source named after an event or resource kind narrows that kind | the rail. Its `rows` source gives the rows, an event kind's source narrows and pages that kind's events on them, its other sources narrow library tabs, and any source may carry `scope`, a narrowing the page holds (U11) |
| `series`, `pick` | exclusive; `pick` is `Plan.pick(key, list, { hidden })` | `series` alone, pickable where `library` lists `Plan.library.series()`, kept under `id`; `hidden` lists the series off to start, or not drawn where nothing picks (U3) |
| `editing` | `{ onApply, onUpdate, onPatch, ready, mode }`; `mode` is gone on the record branch (#1536) | `record`, the handle a record's rows save through: the Plan's one save door, so a Plan over `data` that is no record does not edit; `onPatch` and `ready` become props of their own (U4) |
| `events`, `applyMode` | the event kinds, on `resources`; `applyMode` is gone on the record branch (#1536), where every edit waits for Save and `autosave` is the Plan's one switch | `events` unchanged; the kinds land on a resources series or a `kinds` case by `of`, and on a child row beneath their resource by `child` (U1) |
| `resources` | a dataset per resource kind | goes: the rows are the resources (U1) |
| `links` | a list of `Plan.link` values, each end at a run (`Plan.ref` + `fromRun`/`toRun`), or at an event (`Plan.eventRef`, its key as text) | link kinds by slot, each over a record (`Plan.links(record, { from, to, … })`), its ends typed; today's list stays, as it is or as one slot's value (U10) |
| `library` | `Plan.library.series()`, `.events()`, `.backlog()`, `.tab(rows, { … })` | `.series()`, `.events()`, `.backlog()` and `.tab(rows, { drop? \| create?, … })`: a tab's cards may `create` events, as templates do, so a solution's own list of work not yet planned is a tab (U1) |
| `inspector` | event kinds only: their events, and the resources' rows | the event kinds' events, and the record's rows, with or without event kinds (U5); a link kind's links (U10) |
| `canDrop` | `Fn(DragEvent) → Boolean` over data rows, or `Fn(Schedule.Types.Candidate) → Option<String>` over an event kind | `Fn(Plan.Types.Candidate) → Option<String>`, its message on the ghost: one check, told what either is told today (U7) |
| `canConnect` | none: no gesture draws a link | `Fn(Plan.Types.ConnectCandidate) → Option<String>`, its message on the ghost, as the Schematic's: told the link kind and the two events (U10) |
| `optimise` | event kinds only: `Plan.Types.OptimiseRequest(events, resources)` to `Plan.Types.OptimiseResult(events)` | event kinds, as today, by the builders' one contract (#1622), which lands first and which this proposal does not change: `Plan.Types.OptimiseRequest`, the dates in view, the run's number and the rail's narrowing, with the Plan's unsaved edits passed as drafts, to `Plan.Types.OptimiseResult(events)`, a patch of each kind's record. No row and no tab is sent: the function reads them (§3.4, U5) |

## 5. Series, today and proposed

| Today | Used by (§7 numbers) | Proposed |
|---|---|---|
| `Plan.series.span`, `buckets`, `events`, `cards`, `chart`, `heat`, `table` and their draw options | all data-series examples | unchanged |
| `Plan.items(collection, times, map)`, `Plan.values(collection, map)`, a run built from the row's fields (`runs: (r, k) => [Plan.run({ … })]`) | all; built runs in 7, 19, 20 | unchanged |
| `Plan.heatCells`, `weightCells`, `segmentCells`, `tableCells`, `tableSeries`; `Plan.line`, `area`, `column`, `scatter`, `band`; `Chart.refLine`, `refBand`, `refDot` | 1–6, 8, 9, 15, 16, 19 | unchanged |
| `children: Plan.children(field, [series])`, `children: "field"` (recursive), `rollup: "union" \| "byStatus"`, `aggregate`, `summaryAggregate`, `collapsed` | 1, 3, 4, 8, 9, 19 | unchanged; `Plan.children.of(fn, [series])` adds read-only child rows from a list (U12), and a `kinds` case takes `children` (U2) |
| `Plan.series.group`, `section`, `views` | 1–6, 8, 19 | unchanged; a `views` over one kind can be a `kinds` case |
| `Plan.series.rows` with `Plan.span` and `Plan.run` (literal rows) | 1 | unchanged |
| `match: r => r.kind.hasTag(tag)` with `r.kind.unwrap(tag)` in the callbacks | 1 (18 matches, 46 unwraps) | `Plan.series.kinds`, or `case: [field, tag]` (U2): 7 matches go; 11 keep their test of the case's value, on the value they are handed; every unwrap goes |
| `match` on a String field | 2 (8), 3 (19), 4 (8), 5 (7), 6 (7) | unchanged; or the field made a variant and the matches a `kinds` |
| `match` on the row's key | 19 (2) | unchanged |
| `edit: true`, `edit: { create }` | 4, 8, 9 | unchanged |
| a run map's `status`, a tile map's `tone` | 1 | the map's `status: Plan.status(words, tone, { ring? })` (U8) |
| `Schedule.resources(rows, { … })` | 10–18, 21 | `Plan.series.resources(Row, { … })`, or a `kinds` case per kind (U1, U2; §3.5's table) |
| a resource kind's `measures` | 15 | a `kinds` case's `series` (§3.5) |
| the event kinds' options | 10–18, 21 | unchanged; the kinds land on the record's rows (U1) |

## 6. What doesn't change

- **Paging in two regions.** The rows page through the record's nested
  series index as they do today: the rows in view by the time in view, each
  collection a cell at a time, its months' totals from e3. Each event kind
  pages through its series and summary indexes, keyed by its resource field:
  the resources in view by the weeks in view, as planWindows reads them.
  Over paged rows that is every kind: one with no source of the rail, or
  whose source lists no series index, is refused at build, naming the
  indexes to declare, as it is over a paged resource kind today (e3-ui
  `schedule/cell-checks.ts`). Over rows read whole, a kind with no source
  is read whole, counted first and drawn within `SCHEDULE_EVENT_CAP`
  (10,000 events, e3-ui `schedule/record-window.ts:35`), as today (U1).
  Resources nested in the group rows in view come
  with their group's page, so the kinds' cells need no read before them, and
  a resource with nothing in view keeps its row; a page is 200 groups with
  every resource in them, so a group that may hold more than a page of
  resources keeps them as rows of their own, grouped by an index (§3.3).
  Over top-level rows nothing differs.
- **Drafts in place.** The Plan derives its canvas with the drafts in their
  entries' place, inline the whole canvas and paged each window
  (e3-ui-components `plan/use-plan-editing.ts`), so a typed cell moves its
  parent's subtotal and every rollup above it before Save. `record` (U4)
  names the save door that `editing.onApply` names today; the drafting and
  the derivation are unchanged.
- **Nested tables.** planNestedAll's and planConflictsTable's crews keep the
  form they have:
  - A parent `table` with `aggregate: "sum"` draws the subtotals e3 keeps of
    `values({ rollup: "sum" })`.
  - Each child `table` row, under `children: Plan.children("crews", [...])`,
    is typed into a week at a time, and the parent's sum moves at once.
  - planMeasures' measures keep recursive `children: "children"` with
    `aggregate: "sum"`: a hall holds its presses, a top its contracts, a
    contract its orders.
  - Their `tableSeries` positions keep `rollup: true`, `strong`, `tone` and
    a signed format.
  - The `split` and gutter combinations stay.
- **Groups.**
  - `Plan.series.group` keeps `collapsed`, `summaryAggregate` and
    `children`: planTargetState's halls, dataBindPagedPlan's vans,
    planNestedAll's parts.
  - Trees keep `children: "field"` with `rollup: "union"` over
    `items(…, { rollup: true })`.
- **Sections, views, literal rows, every axis (time, number, ordinal), links
  from run to run with their quantities, expand in place, popover, hover, the
  ui state, the footer and the library's tabs.**
- **Mapping functions.** Every item and value reaches the canvas through
  the author's map. That map can build a run's label, its quantity, or two
  runs from one flat row (dataBindPagedPlan). Nothing assumes the data
  already has the drawn shape.

## 7. Every example, mapped

| # | Example | Today | Proposed | Needs |
|---|---|---|---|---|
| 1 | planTargetState (`plan.examples.tsx`) | Data series over one input (`plan_target_ops`, read whole, grouped by hall in a data step), and a deliveries record for a library tab. Rail: 1 source (`range: "at"`, 2 presets). 28 series calls: a pinned KPI chart; 6 sections; 2 buckets (raw drops with markers; stored tiles in lanes); a group of halls (one collapsed by its key, `summaryAggregate: "mean"`, `children: Plan.children("members", [span, heat])`); 5 spans (flavours; detail; a rollup, `children: "presses"` with `rollup: "union"`; deliveries; contracts, `rollup: "byStatus"`); a heat; 2 cards; 2 events; a table; a `views` (span, chart, table); literal rows. 18 `match` on `kind`, 11 of them testing the case's value too (the five press blocks `series`, a String; the two van blocks `region`; the two crew blocks `pool`; the two stream blocks `cadence`); 46 `kind.unwrap`. `pick` (Programs hidden), 7 links by `Plan.ref` with `fromRun`/`toRun`, the series and deliveries tabs, a bound ui state, expand, popover, hover, four callbacks, a footer | The same series, each naming its case (`case: ["kind", tag]`), or a block over one kind a `kinds` case. 7 matches go whole (the KPI, the halls, the halls' presses, the two loads, the tally, the finishers); the 11 others keep their test of the case's value, written on the value they are handed. Every unwrap goes. Its runs' `status: job.alert` and its regional tiles' `tone` become the map's `status: Plan.status(…)`, given words (U8). `series` with `hidden: ["programs"]` replaces `pick`. Everything else is unchanged | U2, U3, U8 |
| 2 | planVariants | Data series over one input. 9 series calls: chart, span, heat, buckets, a table with 2 `tableSeries` and `split: "vertical"`, cards, events, and a section around a span. 8 `match` on a String `series`. Four callbacks; the axis and the style (density, gutter) chosen in a Configurator | Unchanged, or `series` made a variant and its 8 matches a `kinds` | — |
| 3 | planMeasures | Data series over one recursive input (`Measure`, its `children`), and a weeks record. Rail: 1 source (`range: "week"`). 24 series calls: 5 sections; 6 charts (a line with its breach, an area with `fold: "last"`, columns stacked by `series`, a scatter, the refs, a dual axis with `Plan.fixed`, `left`/`right` and swatches); 4 heats (`children: "children"` with `aggregate: "mean"` and `scale`, `fold: "max"`, `weightCells`, `segmentCells`); 9 tables (three nested by `children: "children"` with `aggregate: "sum"`, two of them with positions; `emphasis: "footer"`; `tableSeries` with `rollup: true`, `strong`, `tone` and a signed format; splits vertical and horizontal; `fold: "last"`). 19 `match` on a String. A weeks tab | Unchanged: every nested table, subtotal and fold stays as it is | — |
| 4 | planRowDrop | Data series over a record, paged (`Data.bindPaged(planDropOps)`), with `Record.bind`. 10 series calls: chart, span (`edit.create`), heat, buckets (`edit.create`), table, cards (`edit.create`), events (`edit.create`), and a section around a span of halls (`runs: _r => []`, `rollup: "union"`, `children: Plan.children("presses", [span with edit.create])`). 8 `match` on a String. A palette tab, `canDrop` (`DragEvent → Boolean`), `editing: { onApply: Record.onApply(record, { keyed: true }), onPatch, ready }`, a footer | `record={record}`, `onPatch` and `ready` as props; `canDrop` reads the candidate (U7) in place of the drag event's cells, and returns its message; series unchanged | U4, U7 |
| 5 | planNumberAxis | Data series over one input, and an orders record. Rail: 1 source (`range: "day"`, an integer). `Plan.axis.number`. 8 series calls: a section around buckets (`lanes`, `Plan.items(…, { at: "day" })`), span, heat, a chart of columns, table, cards, events. 7 `match` on a String. An orders tab, a footer | Unchanged | — |
| 6 | planOrdinalAxis | Data series over one input. `Plan.axis.ordinal`. 8 series calls: a section around a span over phase names, buckets, heat, a chart, table, cards, events. 7 `match` on a String. A footer | Unchanged | — |
| 7 | slicePlanChrome | The rail's `rows` source over a record's interval indexes gives the rows. One span whose runs are built from the row's own fields (`runs: (r, k) => [Plan.run({ … })]`). `affordances: ["fields", "brush"]` | Unchanged | — |
| 8 | planNestedAll (`plan-nested.examples.tsx`) | The rail's `rows` source over one record with a nested series index. 10 series calls: a span (jobs as runs, alarms as decisions, `edit`); a heat; a table (`aggregate: "sum"`, `collapsed`, `children: Plan.children("crews", [table, cells, edit])`); a group (`children: Plan.children("parts", [span, children: "parts", rollup: "union"])`); and, hidden to start, a chart, events, cards and buckets. `pick` with `hidden`, `editing.onApply` | `series` with `hidden`; `record`. Every series is unchanged, including the nested table and the parts tree | U3, U4 |
| 9 | planConflictsTable | The rail's `rows` source over a record with a nested series index. One nested table (`aggregate: "sum"`, `children: Plan.children("crews", [table, cells, edit])`). `editing.onApply`, and a second binding of the record for someone else's mutation | `record`; the nested table unchanged | U4 |
| 10, 11 | planRecordIndexes, planRecordIndexesMobile (`plan-records.examples.tsx`) | Event kinds. `resources.orders` over the work orders, paged (`Schedule.resources(Data.bindPaged(indexedWorkOrders), { label, sub })`). `events.operation` over an operations record (`Record.bind`, `entries`). Two records. Rail: 2 sources (orders over 6 indexes, with fields, search and an initial narrowing; operation over interval, series and summary indexes, `range: "start"`), 2 presets. On PR #1481 planRecordIndexesMobile also has the Series tab and the inspector | The work orders become the record's rows, drawn by a `Plan.series.resources` over the rail's `rows` source (paged, their six indexes), `label` and `sub` the series'. The operations kind is unchanged, on those rows by its field (`of` the series' key), paged by its interval, series and summary indexes as today. Still two records | U1 |
| 12, 13 | planWindows, planSeriesByHall (`plan-windows.examples.tsx`) | Event kinds. Presses paged: a task's output, or in planSeriesByHall a record narrowed by hall. Jobs a record (`backlog`, `quantity`, `entries`). Rail: the job source (interval, series and summary indexes, `range: "start"`), plus presses by hall. A backlog tab | The presses become the record's rows, a `Plan.series.resources` over the rail's `rows` source (paged; in planSeriesByHall over `index.on(["hall"])`), the record made by the presses' generator as planSeriesPresses' is. The jobs kind is unchanged: its series and summary indexes read the presses in view by the weeks in view, as today. The backlog tab stays | U1 |
| 14 | planEvents (`plan-events.examples.tsx`) | Event kinds. Presses (`Record.bind`, read whole); jobs (`backlog`, `fields` for customer and stock). Backlog and customers tabs (`drop: c => Schedule.patch(PrintJob, { customer: c.name })`), the inspector. 3 datasets | The presses become the record's rows, a `Plan.series.resources` over `data` (read whole). The jobs kind is unchanged, read whole with its unassigned row, with its `fields` and its backlog. The backlog and customers tabs (`drop`) and the inspector as today | U1 |
| 15 | planPrintWorks | 23 datasets (20 records, 3 inputs). Rail: 10 sources. 6 resource kinds: presses grouped by hall, with a `measures` heat from an input; crews grouped by hall; setters; bindery lines nested under a parent with `rollup: "union"`; bays; vans. 6 event kinds: job (span, quantity, backlog, 3 fields, entries, templates); stop (marks, `at`, its own inspector, templates); shift (cards, entries, templates at an hour); plate (templates); binding (cards, `overlaps: "allow"`, templates); delivery (buckets, a variant resource of a bay or a van, lanes, `status` cases, `ready`, a field, templates). `rows`: a pinned chart (`Plan.chart`) over an input, and a stock table (`Plan.over`). 4 links by `Plan.eventRef`, their ends a mark, a span, chips and a tile. `grain`, `date`, `canDrop` (a candidate to a message). Events, backlog, series and customers tabs (`drop` patch), the inspector | §3's records, with the plate room added. The works' rows are the groups the resources are drawn in today (each hall's presses, each hall's crews, the plate room, the bindery, the dispatch bays and the vans), each holding its resources, a `what` variant saying which kind each is, and a press's utilisation a collection of its row. The six event kinds are unchanged, each on its rows by `of` naming a `kinds` case: jobs and stops on presses, shifts on crews, plates on setters, bindings on lines, and deliveries on a bay or a van; the rows are paged, so each of the six kinds has its rail source, with its interval, series and summary indexes, and is read a cell at a time: the job and shift kinds keep their sources and gain the two indexes, and the other four gain a source (U1). One templates record, each template naming the kind it makes (§9, question 1); the backlog and the customers tab as today. The chart and the stock table stay `rows`, and the links are unchanged. 23 datasets become 12 (the works, the six event records, the templates, the customers, and the utilisation, output and stock inputs), or 11 with the utilisation a collection of the works, as §3's is; 10 rail sources become 9 (rows, the six kinds', customers, templates) | U1, U2, U5, U7 |
| 16 | planEventLinks | Event kinds: 4 resource kinds (setters, presses grouped by hall, lines, bays) and 4 event kinds (plates `at`; jobs, a span with quantity; bindings, cards; deliveries, buckets). A stock table (`Plan.over`). 17 links by `Plan.eventRef`: S's, loopbacks, a feed, the runoff, slots past the window, and ends at a mark, chips and a tile. 9 datasets (8 records, an input) | One record of rows, over `data` and read whole: setters, presses, lines and bays as `kinds` cases. The four event kinds are unchanged, read whole, on those rows. The 17 links become one link kind over a record of their own, read whole, each a row whose ends hold the plates', jobs', bindings' and deliveries' keys (U10). The stock table is unchanged | U1, U2, U10 |
| 17 | planConflicts | Presses (read whole); jobs (`Record.bind(…, ["patch"])`, `fields`); a second binding for someone else's mutation; the inspector | The presses become the record's rows, a `Plan.series.resources` over `data`. The jobs kind is unchanged, read whole, with its `fields`, the inspector over the selected job, and the conflicts as today | U1 |
| 18 | planOptimise (`optimise.examples.tsx`) | Presses; jobs (backlog, fields); customers tab (`drop` patch); the inspector; `optimise: Func.bind(placeJobs)` over `Plan.Types.OptimiseRequest({ job: PrintJob }, { presses: PrintPress })` | The presses become the record's rows, a `Plan.series.resources` over `data`; the jobs kind is unchanged, read whole, with its backlog. Its optimiser is #1622's by then and is not changed: the request carries no row, and its function reads the presses' record as before | U1 |
| 19 | dataBindPagedPlan (`data.examples.tsx`) | Data series over a paged input grouped by hall where it is made. A span of halls (`match` on the key, `runs: _l => []`, `rollup: "union"`, `children: Plan.children("presses", [a span with two runs built from flat fields])`). A group of vans (`match` on the key, `collapsed`, `summaryAggregate: "mean"`, children a heat with cells generated from one figure) | Unchanged: its `match` is on the row's key, not a variant | — |
| 20 | dataBindPagedBlocks | Data series over a paged task output: two spans, each a block, their runs built from the row's fields | Unchanged | — |
| 21 | planWording (`plan-events.examples.tsx`, PR #1481) | Event kinds: presses (`Record.bind`, read whole) and jobs (`state`, `backlog` with `duration` and `due`, `fields` for customer and stock). `vocabulary` names the unassigned row, the backlog, the Series tab, the phone's nouns, the backlog's groups and a job's states. Backlog, series and customers tabs (`drop` patch), the inspector. 3 datasets | The presses become the record's rows, a `Plan.series.resources` over `data`. The jobs kind is unchanged, read whole, with its backlog; `vocabulary`, the tabs and the inspector as today | U1 |

Out of scope: `data.examples.tsx`'s other examples (a Table, a Sheet and the
data bindings), which draw no Plan.

## 8. What it needs upstream: e3-ui

- **U1. Event kinds on the record's rows.** `Schedule.events` stays, with
  every option it has today. `resources` goes from the Plan: the rows are
  the resources, and the rows' series draw what `Schedule.resources` drew
  (§3.5's table). A Plan takes rows and event kinds together. Calendar,
  Roster and Allocation keep `Schedule.resources`.
  - **The landing series.** `Plan.series.resources(Row, { key, title, icon,
    label, sub?, value?, status?, expand?, series?, children?, lanes? })` is
    the one series an event kind lands on, and a `kinds` case is one, case
    by case (U2). It has no items of its own: for each row it draws a row
    for each way the kinds landing on it draw, then its `series`, then its
    `children`, as a resource kind does today (`plan/event-rows.ts:11-21`).
    A kind never lands on a `views`, a `span`, a `buckets` or a `chart`.
  - **`resource: { field, of }`.** `of` names a resources series or a case
    by its one key (U2), or a case for each case of a variant field
    (`{ bay: "bay", van: "van" }`); today it names a `resources` slot. A
    name that is neither is refused at build. With `of` a name, the field
    holds the row's key in the series' key type, its Option taken off; with
    `of` a name per case, the field is a variant, each case holding the key
    of the series its case names. A field of another type is refused at
    build, naming the field and both types. The change is e3-ui's alone
    (`schedule/events.ts:150-154`, `plan/plan.ts:484-485`): e3's series and
    summary indexes already file a key field of any type but a Set
    (`record-series.ts:90-94`).
  - **`child: { field, of }`,** one step beneath: `of` names a resources
    series among the resource's `children`, and the field holds the child
    row's key in that series' key type, checked as `resource`'s is. A second
    step beneath is not in this proposal. `resource` stays the family's
    field, which Calendar, Roster and Allocation read
    (`schedule/events.ts:30-32`) and a kind's indexes file by; `child` is
    the Plan's alone, placed among events already read.
  - **How a kind is read.** Over paged rows every kind is read a cell at a
    time: it has a source of the rail that lists a series and a summary
    index filed by its resource field, and it gives `entries`. One with no
    source, or with its interval index alone, is refused at build, naming
    the two indexes to declare, as today
    (`schedule/cell-checks.ts:83-113`). No kind is read whole over paged
    rows. It reads the events on the rows in view, now over the resources
    nested in the groups in view (§3.3); with `of` a name per case, a row's
    cells are asked by the field's own value, the row's key in its case. A
    kind read a cell at a time has no unassigned row, as today
    (`plan/event-rows.ts:49-53`). Over rows read whole nothing changes: a
    kind with no source is read whole, counted first and drawn within
    `SCHEDULE_EVENT_CAP` (10,000, `schedule/record-window.ts:35`), and an
    event whose resource is `none` draws on the unassigned row.
  - **Lanes.** `lane` takes a variant field beside a String. A variant
    `lane` draws a lane for every case, empty or not, in the order the
    landing series' `lanes` lists them (`Plan.lane({ key, label })`, `key`
    the case's name), else by case name; a String `lane` draws the lanes
    its series lists, then any other an event names, as today
    (`plan/event-rows.ts:329-335`).
  - **A drop writes what places it:** the resource's field, the child's and
    the lane's; the candidate is told the row and the lane (U7).
  - **The library.** A tab's cards may make events of a kind as templates
    do, with `create: { kind, duration | at, values }` (§3.4), `values` the
    new event's own fields, as #1526 names them for the other builders. A
    tab with `drop` patches the event a card lands on, as today. A tab
    takes no `key`: nothing reads one (ruled 17 November 2026). The
    built-in backlog stays, with the words `vocabulary` gives it (#1516).
- **U2. Map a variant's cases to series.** This is
  `Plan.series.kinds(Row, field, cases)` and a series' `case: [field, tag]`,
  under §3.5's rules: each case a resources series' config (U1), its key
  the case's name unless it gives `key`, its rows the rows its event kinds
  land on; the cases exhaustive, a case not drawn saying `false`;
  `row: false` leaving the case's own row undrawn, its `series` and
  `children` at its level, a kind landing on the row itself refused, and
  the row unselectable, so its fields aren't in the inspector
  (`plan/plan.ts:292-294`) and a page that edits them draws the row; a
  case's callbacks handed the case's value, `match` too; every key unique
  across the tree.
- **U3. `series` pickable, with `hidden` replacing `pick`.** The series are
  pickable where `library` lists `Plan.library.series()`, kept under the
  Plan's `id` (a pick is state: `plan/root.ts:236-238`). A Plan without it binds no state,
  and `hidden` then names the series it doesn't draw. The Series tab lists
  each member of a `views` and each `kinds` case, each switched on and off
  alone, by its one key.
- **U4. `record`,** a `Record.bind` handle a record's rows' drafts save
  through by key, with `onPatch` and `ready` as props, in place of
  `editing`. `record` is the Plan's one save door: `onApply` and
  `onUpdate` go, so a Plan over `data` that is no record does not edit
  (ruled by the product owner on 14 November 2026: the e3-ui builders are
  for records only). `editing` is refused at
  build, naming the prop that replaces each of its parts. `applyMode` and
  `editing.mode` are gone on the record branch (#1536): every edit waits
  for Save, and `autosave` is the Plan's one switch.
- **U5. The inspector and the optimiser over the record's rows.** `plan.ts`
  documents the inspector as showing "the event kinds' events and the
  resources' rows, so it needs `events`". It shows a selected event's form,
  as today, and a selected row's own fields, as a resource's row today, with
  or without event kinds, and over either the refusals that hold Save, each
  naming its field, as #1525 asks of the Plan's panel. The optimiser keeps
  its eye, its landing as one edit and its need for event kinds. The rest
  of it is the builders' one contract (#1622), which lands ahead of this
  proposal: the request carries the dates in view, the run's number and
  the rail's narrowing (`Plan.Types.OptimiseRequest`), the call carries
  the Plan's unsaved edits as drafts, and the answer is a patch of each
  kind's record (`Plan.Types.OptimiseResult(events)`). No row is sent, so
  nothing of it changes when the resources become rows: the function reads
  the rows' record itself, through its indexes (§3.1, §3.4).
- **U6. Event kinds over a composite record** (#1465; its design PR #1468).
  Built after this issue's pull requests, in the composite's, and tracked
  there (its tasks L1 to L3, and M3 for §3.8). Keys are the record's key
  type wherever the Plan names an event: its drafts, a link kind's ends
  (U10) and the optimiser's patch. That much is the Plan's own, for a
  record keyed by any type, and is built and tested here on a plain record
  keyed by a variant (Acceptance), so a composite's key needs nothing more.
  The drop and connect checks print them, as today's checks do (§9,
  question 4), and so does `Plan.eventRef` in today's list of links. What
  the composite adds: an external source's events are drawn locked and
  refuse a move, a resize, a removal, a form's edit and an optimiser's
  change, as e3 refuses the write: one lock with U9's, by the kind's
  `locked` or by the key's case in the binding's sources. A new event goes
  in under the solution's source (`variant("own", <id>)` in §3.8), its key
  made by the edit session, as a new event's is on the record branch; with
  several solution sources the kind's `source` names the one, as the
  Sheet's does (#1468's design §7.15, its tasks G3 and G4).
- **U7. One `canDrop`:** `Fn(Plan.Types.Candidate) → Option<String>`, its
  message on the ghost, as the event kinds' check has today. The candidate
  is told everything either of today's checks is told, so no rule written
  today is lost:
  - from the event kinds' candidate (`Schedule.Types.Candidate`): the kind,
    what is dropped, and the start, end and resource it would have, now its
    row;
  - from the data rows' drag event (`DragEventType`, east-ui
    `contracts/drag.ts`): the gesture, a library tab's card, what it lands
    on, an alt-drag copy, and where a removed one goes.

  ```ts
  // e3-ui, proposed. Keys are printed, as both of today's checks print them (§9, question 4).
  /** An event: its kind, and its key there. */
  export const PlanEventRefType = StructType({ kind: StringType, key: StringType });
  /** A data series' item: the row it is in, and its key there. */
  export const PlanItemRefType = StructType({ row: StringType, key: StringType });
  /** What a drop would do: `Plan.Types.Candidate`. */
  export const PlanCandidateType = StructType({
    gesture: VariantType({
      add: StructType({ duplicate: BooleanType }),   // onto the canvas; `duplicate`, an alt-drag copy
      move: NullType,
      remove: DragSinkType,                          // off the canvas: to the trash, or back to its library
      resize: DragEdgeType,                          // which end moved
    }),
    // the event kind or data series it lands in or leaves: today's `kind`
    into: VariantType({ kind: StringType, series: StringType }),
    // what is dragged: a template, a library tab's card, a backlog event, an event, or a data series' item
    from: VariantType({ template: StringType, card: LibraryRefType, backlog: PlanEventRefType, event: PlanEventRefType, item: PlanItemRefType }),
    onto: OptionType(VariantType({ event: PlanEventRefType, item: PlanItemRefType })),   // what it lands on
    row: OptionType(PlanRowIdType),                  // the row it would land on, its series and its path; none for a remove
    lane: OptionType(StringType),                    // the lane it would sit in, where its row has lanes (U1)
    start: OptionType(PlanInstantType),              // when it would start there, on any axis; none for a remove
    end: OptionType(PlanInstantType),                // when it would end there; none for a remove
  });
  ```

  `LibraryRefType`, `DragSinkType` and `DragEdgeType` are east-ui's
  (`contracts/drag.ts`); `PlanRowIdType` (a row's series and path,
  `plan/types.ts:922-925`), `PlanInstantType` (`plan/types.ts:117`) and the
  `backlog` case (`schedule/types.ts:113-119`) are e3-ui's today.
  planRowDrop's check over the drag event's cells and planPrintWorks' over
  the event kinds' candidate both become one over this.
- **U8. A data series item's status from its map.**
  `Plan.status(words, tone, { ring? })`, the tone one of success, warning,
  danger, info or neutral, returned as `status` by the map of any data
  series item: a run, a tile, a mark or a chip. It gives an item what an
  event kind's status case gives an event (`status: { field, cases }`,
  unchanged), in place of a tile map's `tone` and a run map's `status`. What
  it draws:
  - its tone on the item, and a warning case's ring, as a warning status
    draws today on bars, tiles and marks (`event-rows.ts:250-318`); chips,
    which draw no status today, take it too;
  - with `ring: true`, the item as an open ring, as the Schematic draws a
    tentative status.
- **U9. A lock on one event or item.** `locked`, an event kind's option (a
  function of the event and its key, beside `ready`) and a field of a data
  series item's map. A locked one draws with a lock and can't be moved,
  resized or removed, its form in the inspector is read only, and an
  optimiser's answer that changes it is refused. Today a whole kind is
  editable or not by its record's binding, and a whole data series by its
  `edit`. As an option of `Schedule.events`, it is there for Calendar,
  Roster and Allocation to take too.
- **U10. Link kinds over records.** `links` takes link kinds by slot, as
  the Schematic's does: `Plan.links(record, { name, icon, from, to,
  quantity?, templates?, fields? })`, each link a row of the app's
  record, its key the link's identity. An end is `{ field, of }`. With `of`
  an event kind, the field holds a key of that kind in its own key type, a
  composite record's variant included (U6); with `of` a kind per case, the
  field is a variant, each case holding a key of the kind it names (§3.5's
  feeds). The Schematic's ends hold String keys until #1549 gives them any
  key type; the Plan's hold each kind's own.
  - **Drawn** as a link of today's list is: from its `from` event to its
    `to` event, wherever they draw, in the links focus, its quantity
    weighing the ribbon and printing its caption
    (`quantity: { field, unit }`, as an event kind's).
  - **Read** whole, counted first and drawn within `SCHEDULE_EVENT_CAP`, as
    a kind with no source is over rows read whole. A link has no times, and its ends are variants
    holding keys, which the rail can't narrow by (east-ui
    `platform/slice/record.ts:116`): a rail source for a link kind is not in
    this proposal. When the links focus
    opens, an end whose event the cells read don't hold is read by its key
    through its kind's `entries`, every far end of the family in one
    request, as the Plan reads a run link's far end (#1438) and the
    Schematic a link's (#1393).
  - **Made by hand.** A Connect tool offers the link kinds whose ends take
    the two events a drag joins. The drag makes a draft link, its ends their
    keys and its other fields blank or a template's, saved through the
    record's patch door with the session's other drafts, and undone by Undo.
    A selected link shows its form in the inspector and is removed as an
    event is.
  - **`canConnect`,** `Fn(Plan.Types.ConnectCandidate) → Option<String>`,
    vetoes a pair, its message on the ghost, as the Schematic's does. The
    candidate is the link kind and the two events, each a `PlanEventRefType`
    (U7).
  - **Today's list stays,** for links built in code and for links from run
    to run: `links` takes it as today, or as one slot's value beside the
    kinds.
- **U11. A source's scope.** Built by #1621, ahead of this proposal, for
  every builder; this is its specification. A source of `Slice.bindRecords` takes `scope`
  beside `initial`: a narrowing the page holds, typed as `initial` is
  (east-ui `platform/slice/record.ts:78`), exact values only, each an East
  expression, so a page's parameter goes in: `scope: { press: [press] }`
  (§3.7). Every read of the source carries it: pages, counts, seeks and
  Search Records. The rail shows no control for a scoped field; Clear all
  and a preset leave it. Each field the rail offers, its `range` and its
  `search` must be answered by one listed index together with the scope,
  the scope's fields first, or the build refuses naming the index to
  declare, as a narrowing is checked today (`record.ts:301`). A list written
  in the code is never empty (`record.ts:288`); one that is an East
  expression may be, and the source then reads no rows. A value's type is
  its field's (`record.ts:103-122`). An event made on the page takes the
  scope's value for each scoped field with one value; a draft that leaves
  the scope stays and saves, as today (`schedule/events.ts:50-51`). A scope
  is no access rule: e3 serves the record's other rows to whoever may read
  it. It lives on the rail, whose narrowing it is, not on `Data.bindPaged`,
  an authoring adapter (e3-ui `bind/data-indexed.ts:288-290`).
- **U12. Child rows from a list.** `Plan.children.of(fn, [series])` draws
  the child rows of the collection `fn` returns from the row and its key,
  beside `Plan.children(field, [series])` for a row's own collection: the
  same kinds under every press is `Plan.children.of(() => kinds.read(),
  [kindRows])`, `kinds` a record of the works' kinds bound whole (§3.7),
  on the step-down the Plan has for the event kinds' rows
  (`plan/series.ts:425-441`). Its rows are
  read with their parent, not through the nested series index; an event
  kind's `child` (U1) lands on them. They are read only (a series under it
  declares no `edit`), e3 keeps no rollup of them, so a parent's `aggregate`
  doesn't count them, and `fn` reads the row and what the page binds whole.
  Child rows that are many, or that change over time, belong in the record
  as `index.nestedSeries.rows`.

### What it needs upstream: e3 (E1)


`index.nestedSeries({ collections })` takes a row's child rows (`index.nestedSeries.rows`) and items (`index.nestedSeries.items`) only from a `Dict<String, Struct>` field. A record's own rows take any key type. The nested series index's entry key already carries the row's key whatever its type (`NestedEntryKeyType(rowKey)`, `e3-types/src/record.ts`). Child rows should take any key type too.

#### Motivation

A closed set of child rows keyed by a variant, such as a crew's planned hours by role, must today be keyed by strings: each key a case's name written into a string.
- The Plan already reads such keys, through a series' `keyType`.
- e3 already files a Dict field keyed by any type in another index: the entries index (`index.entries(field)`, #1521, on main since PR #1481 merged on 6 November 2026). A record can't have one beside a nested series index (`record-builders.ts:329`), so it doesn't serve rows that have one.
- The Plan proposal's worked examples both need it: a crew's hours by role (#1541 §3), and a press's kinds of task, `Dict<TaskKindType, TaskKindRowType>`, child rows an event kind lands on (#1541 §3.7).

#### Today

`libs/e3/packages/e3/src/record-nested.ts`, `SeriesCollectionFor`, sorts a field by its Dict's key:
- `Dict<DateTime, V>` is a values collection;
- `Dict<String, I>` is items or rows;
- any other key is refused: "'F' is not a Dict: a collection is a Dict<String, Item> keyed by an id, or a Dict<DateTime, V> keyed by its instant".

#### Proposed

`index.nestedSeries.rows(...)` and `index.nestedSeries.items(...)` take a `Dict<K, Struct>` field for any key type `K` a Dict takes. The child's key is carried as its type, as the row's key is. A Dict keyed by DateTime stays a values collection, whatever it holds; `rows` and `items` take any other key type.

```ts
import { DateTimeType, DictType, FloatType, NullType, StringType, StructType, VariantType } from "@elaraai/east";
import * as e3 from "@elaraai/e3";

/** A role in a crew. */
const RoleType = VariantType({ assistant: NullType, operator: NullType });
/** A role's planned hours, a value a week. */
const RoleHoursType = StructType({ hours: DictType(DateTimeType, FloatType) });
/** A crew and its hours by role. */
const CrewType = StructType({ name: StringType, hours: DictType(RoleType, RoleHoursType) });

const crews = e3.record("crews", DictType(StringType, CrewType), {
  initial: new Map(),
  indexes: (index) => ({
    // Each crew's hours by role, a week at a time, the roles summed per crew.
    crews_in_time: index.nestedSeries({
      collections: { hours: index.nestedSeries.rows({ hours: index.nestedSeries.values({ rollup: "sum" }) }) },
      tile: "week",
      summary: "month",
    }),
  }),
  mutations: (mutation) => ({ patch: mutation.patch() }),
});
```

**Acceptance.**


- **The index.** The record above builds. The index files each role's hours under the role, as a `RoleType` value, and its rollup sums a crew's roles.
- **Reading.** A Plan's nested series reads the children with their keys typed, through the series' `keyType`, and writes them back by those keys.
- **Every runner.** The same on east-node, east-c and east-py.
- **The wire.** The PR says which wire this changes, as `docs/conventions/WIRE_MIGRATION.md` defines them, or that it changes none.
- **Where it lands.** In the Plan's pull request for child rows and the press pages, the fourth of the epic's *How it lands*, ahead of composite records: it changes e3 alone.




=====COMMENTS=====

### What it needs of the renderer

#### The canvas

- **U1, events on the record's rows.** Each event kind lands on the rows of the resources series or `kinds` case its `of` names, or one case for each case of a variant field, by the key its field holds in that series' key type; with `child`, on the child row beneath its resource whose key its `child` field holds. The `resources` path goes. A resources series draws, for each row, a row per way the kinds landing on it draw, then its series, then its children. A variant `lane` draws every case in the series' `lanes` order, empty lanes too. A drop on another row or lane writes the fields that place it into the draft: the resource's, the child's and the lane's. The unassigned row stays, in `vocabulary`'s word, for a kind read whole whose event names no resource; a kind read a cell at a time has none.
- **Paging (§6).** Over paged rows every kind is read a cell at a time, through its source: the events on the rows in view by the weeks in view, as it reads them on paged resources today. Its summary shades the view zoomed out, as today. No kind is read whole there. The resources may be nested in the group rows in view: they come with their group's page, so the keys it asks for are the codes of the resources in those groups, read before no cell, and over a large record it reads no other key's cells. A kind landing on a case for each case of a variant field asks by the field's own value, a row's key in its case. Over rows read whole, a kind with no source is read whole, counted first and drawn within `SCHEDULE_EVENT_CAP`, as today.
- **U2, `kinds` and `case`.** A `kinds` block draws each row of a case, in the source's order, as the case's row, with the case's series beneath it and its children after them; collapsing the row folds both. A case that says `false` draws nothing. With `row: false` the case's own row isn't drawn, and its series and children stand at its level; the row can't be selected, and the inspector shows the window's totals while nothing is. Every key is unique across the tree.
- **U8, status.** A data series item's `status` draws as an event's status case does: its tone, a warning's ring, and an open ring with `ring: true`. Chips, which draw no status today, take it too.
- **U9, lock.** A locked event or item draws with a lock, and can't be moved, resized or removed.
- **U10, link kinds.** A link kind's links draw as today's list does: from the `from` event to the `to` event wherever they draw, in the links focus, the quantity weighing the ribbon. When the focus opens, a far end the cells read don't hold is read by its key through its kind's `entries`, every far end of the family in one request, as a run link's far end is read today (#1438).
- **Drafts (§6).** The canvas is still derived with the drafts in place (`plan/use-plan-editing.ts`), so a typed cell moves its parent's subtotals before Save, the rows and the events alike.
- **U11, the scope.** Built by #1621, ahead of this epic. Every read of a scoped rail source carries the scope through its index: its pages, its counts, its seeks and Search Records. The rail draws no control for a scoped field, and Clear all and a preset leave it. A new event takes the scope's value for each scoped field with one value; a draft that leaves the scope stays and saves.
- **U12, children from a list.** Drawn beneath each row from the list its function returns, read with the row, read only; a parent's aggregate doesn't count them. An event's `child` lands on them as on a collection's child rows.

#### The panes

- **U3, the Series tab.** Where the library lists `Plan.library.series()`, every series is pickable, kept under the Plan's `id`, with `hidden` off to start; a `views` member and each `kinds` case are switched on and off alone, by their one key. Without it nothing is bound, and a `hidden` series is simply not drawn.
- **U1, the library.** A tab with `create` makes an event of its kind where its card lands, as a template does:
  - the row is where the card lands;
  - the start is where it lands, and the end by `duration`, or the instant by `at`;
  - `values` give the rest.

  The backlog stays, and so does a tab's `drop` patch.
- **U5, the inspector.** It shows a selected event's form, as today, and a selected row's own fields, with or without event kinds. Over either it shows the refusals holding Save, each naming its field (#1525).
- **U10, a link in the inspector.** A selected link shows its form, and is removed as an event is.
- **U5, the optimiser.** The run is the builders' one (#1622), which lands ahead of this epic: the eye sends the dates in view, the run's number and the rail's narrowing, with the sessions' unsaved edits as drafts, and lands the answer's patches as one edit, which one Undo reverts. No row is sent, so nothing of the run changes when the resources become rows. An answer that changes a locked event is refused, naming it (U9; over a composite record, U6).

#### The drop, the Connect tool and the composite record

- **U7, one `canDrop`.** Every drop, on rows or events, builds one `Plan.Types.Candidate`, and its message shows on the ghost.
- **U10, the Connect tool.** It offers the link kinds whose ends take the two events a drag joins. The drag makes a draft link, its ends their keys, saved with the session's other drafts and undone by Undo. `canConnect` is handed a `Plan.Types.ConnectCandidate`, and its message shows on the ghost.
- **U6, composite records (#1465, built in #1468).** Built after this issue's pull requests, with the composite's UI group. An external source's events are drawn locked by their key's case, one lock with U9's: a move, a resize, a removal, a form's edit and an optimiser's change are refused, and a Plan's rows of an external entry lock their editable cells. A new event is keyed to the solution's own source, `variant("own", <id>)`, the one its kind's `source` names where there are several, as the Sheet's rows are (#1468's tasks G3 and G4).

#### Acceptance

- **The showcase.** The print works of #1541 §3 is drawn there:
  - each event kind on its rows;
  - a crew's nested table typed into, its sums moving before Save;
  - a locked job;
  - an Orders card making a job;
  - a feed drawn with the Connect tool.
- **The press pages.** #1541 §3.7's two pages, drawn in the showcase: every machine with its kinds' rows beneath it; one press, the works' page scoped, its own row not drawn and its rows at the root; both lanes drawn; a task moved to its other half's lane and to another kind's row, each a draft.
- **Paging.** A group's resources come with its page; a works whose group may hold more than a page of resources keeps them as rows of their own, grouped by an index, as planSeriesByHall does. Paging over nested resources reads only the cells in view; no kind is read whole over paged rows, and one with no source there is refused at build; a scoped source reads only its scope's pages (U11); and opening the links focus reads each far event end by its key, in one request.
- **Tests.** Each U item has its renderer tests, and a responsive spec with a visual invariant, as east-ui's `STANDARDS.md` asks.




=====COMMENTS=====

## 9. Open questions, each decided on 10 November 2026

1. **Templates.** Should templates be one record, each template naming the
   event kind it makes and its `values` a variant with a case per kind, or a
   record per kind, as today? Decided: one record, one source on the rail
   and one place an app keeps its presets. `Schedule.templates(rows, { …,
   case })` gains `case`, the kind's case of `values`: its list is the rows
   of that case, and its `values` accessor is handed the case's value
   (`schedule/templates.ts:29-49` takes every row it is given today). The
   library's Events tab groups the templates by kind.
2. **Read-only extras.** These are planPrintWorks' daily output chart and the
   paper stock table, and planEventLinks' stock table. Should they stay
   `rows` (`Plan.chart`, `Plan.over`), or become rows of the record?
   Decided: they stay `rows`, and the rule is stated: `rows` is for data
   that isn't the record's; the record's own collections are its rows'
   series, a press's ink temperature among them (#1541 §3.7).
3. **The Sheet's columns over a nested record.** Beside the rows' own
   fields, which of their collections should the Sheet list when it edits
   the record the Plan draws, and how? Decided: none in this proposal. The
   Sheet lists the rows' own fields; its `entry` takes an Array field
   (e3-ui `sheet/record.ts:53-60`), not a Dict of child rows, so a
   collection is edited on the Plan until `entry` takes one.
4. **Typed keys in the drop and connect checks.** U7's candidate prints an
   event's and an item's keys into strings, as today's two checks do, and
   U10's prints the two events' keys. Over a composite record an event's key
   is a variant (#1541 §3.8's `SourceKeyType`, U6), and a printed key is a structure
   written into a string. Should the candidates carry keys typed, as each
   record's key type and each series' `keyType` declare them? Decided: an
   event's and an item's key stay printed, as East's text of the key, which
   parses back (`plan/root.ts:645-650`, `schedule/events.ts:90-91`); the
   candidate is never stored, and a typed one would have to be built per
   Plan from its kinds, as the optimiser's result type is. The row is carried
   typed, as `PlanRowIdType` (U7). The typed keys that matter are in the
   records and the build checks: a link's ends (U10) and a kind's
   `resource` and `child` fields (U1).
5. **`hidden` inside a `kinds` block.** Decided: the question goes. Every
   key is unique across the tree, a case's included (U2), so `hidden` names
   a series or a case by its one key (U3).
6. **Run ends in a link kind.** A link kind's ends name events (U10).
   Should an end also name a data series' run, by its row's key and its
   item's key, typed, so links from run to run can be a record too?
   Decided: not in this proposal; today's list keeps them.

## 10. The Plan beside the other builders

e3-ui's builders share one contract (the e3-ui skill, "The builders"): each
maps roles onto the solution's own records, every gesture is a draft saved
through a record's patch door, one rail narrows it, and the solution's
optimiser answers a patch of each record it changes (#1622). Calendar, Roster and Allocation
take kinds of events and resources by slot (`Schedule.events`,
`Schedule.resources`), the skill's "shared vocabulary for kinds of events and
resources (Plan, Calendar, Roster, Allocation)"; the Schematic takes kinds of
items by slot (`Schematic.items`). On main since PR #1481 merged (6
November 2026) the Flowchart is in the contract (#1498): its kinds of
states, transitions, lanes and decisions
are each a record of the app's. The table reads each from its smallest
example: `calendarMinimal`, `rosterMinimal`, `allocationMinimal` and
`schematicFloor`.

| Builder | Its content | Where an item lives | The row or resource it is on | Its look | Rail sources | A large record |
|---|---|---|---|---|---|---|
| Calendar | `events` and `resources` by slot: `Calendar.events(record, { title: "title", start: "start", end: "end", resource: { field: "machine", of: "machines" }, backlog })` | a record per event kind | a field of the item | the events' roles by field name; a resource's label and a backlog item's duration and due by functions (`label: (row) => row.name`) | one per event kind (`range: "start"`), the resources', the templates' | each kind's interval index, and `entries` |
| Roster | `events={{ duty: Schedule.events(record, { start, end, resource, shift, group }) }}`, `resources`, and its own lists (`Roster.shifts`, `groups`, `targets`, …) | a record of duties | a field (`resource: { field: "person", of: "people" }`) | the duties' roles by field name; the people, shifts and teams by functions (`label: (w) => w.name`) | the duties' (`range: "start"`), targets, people, activities, patterns | the duties' interval index |
| Allocation | `events={{ bin: Schedule.events(record, { at, resource, arrival, quantity, parts, hold }) }}`, lanes and resources, `arrivals` | a record of bins | fields (`resource`, `parts`) | the bins' roles by field name; the lanes, resources and arrivals by functions | the bins' (`range: "at"`), the lanes', the resources', the arrivals' | the bins' interval index |
| Schematic | `items`, `zones`, `links` and `nets` by slot: `Schematic.items(record, { x: "x", y: "y", label: "name", sublabel: (r) => r.model, meter: (r) => … })` | a record per kind | its coordinates, fields of the item | field names, and functions where a look is worked out (`sublabel`, `meter`, `footprint`) | one per kind | `index.area`, a window at a time |
| Plan, today | `series` over `data` or the rail's rows; `events` and `resources` by slot, as Calendar's | a data series': the row's own collections; an event kind's: a record of its own | a data series': the row it is in; an event kind's: a field | a data series': map functions; an event kind's: field names | `rows`, and one per kind | the nested series index; each kind's interval, series and summary indexes |
| Plan, proposed | `series` over one record's rows, `events` by slot (`Schedule.events`) placed on them, and `links` by slot (`Plan.links`) joining the events | an event or a link: a record per kind; a value or a child row: its row | an event: a field (`resource: { field, of }`, `of` a resources series or a `kinds` case, and `child` a row beneath it); a link: its ends' fields (`from`, `to`, `of` an event kind) | the events' and links' roles by field name; the rows' series by map functions | `rows`, one per event kind, and the library tabs' | the rows' nested series index; each kind's interval, series and summary indexes |

Shared with the others, and kept: `Schedule.events` itself, so one record of
jobs can feed a Calendar and a Plan alike (one value builds for both,
`schedule/events.ts:527-541`; a kind shared between them names its `kinds`
case as the Calendar's `resources` slot, so its `of` reads on either); the
patch door and the one
editing session (Undo, Save); the rail (`Slice.bindRecords`); an optimiser
bound with `Func.bind`, by the builders' one contract (#1622);
`Schedule.field.*` forms and `Schedule.patch` drops (the Schematic's
`Schematic.patch`); a veto returning its message (the Plan's `canDrop`, the
Schematic's `canConnect`); the library and inspector panes; and
`vocabulary`, the app's own words for what each builder draws (#1516). New
to the Plan, and the Schematic's way: link kinds over records, their ends
named by fields (`Plan.links`, as `Schematic.links`), with a connect veto
(`canConnect`, U10).

Where the proposal departs from them:

- **Its resources are rows.** A Plan's resources are one record's rows,
  drawn by series, grouped, nested into trees, with values of their own.
  `of` names a resources series or a `kinds` case, where the others name a
  `resources` slot, and `child` a row beneath it, which no other builder
  has.
- **A tab's cards make events.** A Plan's library tab may `create` events
  of a kind (§3.4), which no other builder's tab does. Its backlog stays, as
  Calendar keeps an event kind's `backlog` (items with no start) and the
  Schematic `Schematic.library.backlog()`.
- **Status and lock.** The event kinds keep `status: { field, cases }`, as
  the others have it. `locked` is new on `Schedule.events` (U9), there for
  the others to take too. The Schematic is editable or read only by its
  record's binding (`Record.bind` or `Data.bind`), a whole kind at a time.
- **Typed link ends.** A Plan link kind's end holds an event's key in its
  kind's own key type, where the Schematic's holds a String key or a variant
  of String cases until #1549 gives it any key type: a Plan's events may be
  keyed by any key type, a composite record's among them (U6, U10).

Why the events aren't nested in the rows: an event that names its resource
by a field is the family's way. One jobs record then feeds a Calendar and a
Plan alike, a move writes one field, a job's key names it wherever it moves,
and a composite record's sources lock the ERP's jobs and take the planner's
with nothing more from e3.

What only the Plan has: a row's values, child rows and trees, with the
rollups and subtotals e3 keeps of them, read a cell at a time through the
nested series index. None of the others draws them, so there the proposal
departs from nothing.





=====COMMENTS=====

## Backward compatibility

Three props leave the Plan, each refused at build with its replacement named, as #1344 refused the bare slice handle:
- `resources`: the rows are the resources, a resources series or a `kinds` case (U1);
- `pick`: `series` is pickable where the library lists `Plan.library.series()`, with `hidden` (U3);
- `editing`: the save door is `record`, with `onPatch` and `ready` as props of their own; `onApply` and `onUpdate` go, so a Plan over data that is no record does not edit; the refusal names the prop that replaces each part (U4).

Two map fields go the same way, refused naming `Plan.status`: a run map's `status` and a tile map's `tone` (U8, §5).

`canDrop` takes one type (U7): a check written against either of today's two candidates is rewritten against `Plan.Types.Candidate`, which is told everything either was. `links` takes today's list as it is; link kinds and `canConnect` are new (U10). New too, and nothing today changes without them: `Plan.series.resources`, `child`, a case's `children` and `row: false`, a variant `lane`, a source's `scope` and `Plan.children.of` (U1, U2, U11, U12). Everything §6 lists is unchanged.

## Acceptance


- **Authoring, wire and bridge.** Each U item is built across all three, with TypeDoc, a spec test and an `example()` for every public method touched.
- **The worked example.** The print works of §3 builds and draws, over plain records: one record of rows; the five event kinds on them by `of`, each read a cell at a time through its own source; one rail of seven sources; the Orders tab making jobs; the backlog as today; the feeds joining their events, and a feed made with the Connect tool. Its composite form (§3.8) is built by the composite's pull request, with U6.
- **The press pages (§3.7).** Both build and draw, with E1 (#1540): every machine with its temperature and its kinds' rows beneath it; one press, the works' page scoped, its own row undrawn and its rows at the root; each task on its kind's row in its half's lane, both lanes drawn; a task moved to the other lane and to another kind's row, each a draft writing the field that places it.
- **Landing (U1).** A `resource` or `child` field whose type isn't its series' key type, or a case's that of the series it names, is refused at build, naming the field and both types; so is an `of` that names no resources series or case, and a kind landing on a `row: false` case with no `child`. Over paged rows a kind with no source of the rail, or one whose source lists no series index or no summary index, is refused, naming the indexes to declare, as today. Over rows read whole a kind with no source is read whole within `SCHEDULE_EVENT_CAP`, as today.
- **The scope (U11),** built and tested by #1621. A scoped field no listed index answers with the rail's fields, a value of another type than its field's, and a list written empty are refused at build, naming the field and the types. An empty scope reads no rows. An event made on a scoped page carries the scope's values.
- **Link ends (U10).** An end whose field doesn't hold its kind's key type, or a case's that of the kind it names, is refused at build, naming the field and both types.
- **Any key type.** An event kind whose record is keyed by a variant, on a plain record: its events draw, are dragged, drafted and saved, and are named by a link's end and by an optimiser's patch, by their typed key. A composite record's key then needs nothing more of the Plan (U6).
- **The refusals.** The removed props refuse at build, naming the replacement.
- **The skill.** The e3-ui skill's Plan section and its builders contract say what changed.





=====COMMENTS=====

## How it landed


Plan first, then composite records: settled on 12 and 13 November 2026, in place of the order of 10 November.

The Plan lands as six pull requests, each on the one before it, each small enough to judge alone. Each carries:
- its part of e3-ui and of the renderer;
- the examples its change reaches, and a responsive spec with a visual invariant for what it draws;
- the skill's lines for what it changes, and the example index regenerated;
- an entry in `WIRE_MIGRATION.md` where it changes the Plan's payload.

Each ticks its tasks here with its commit, and carries the same list in its own description. The first needs nothing of the functions epic, and can be built while that stack is reviewed. The rest start once the optimiser's contract (#1622) has landed.

**1. Saving, picking and status (U3, U4, U8)**
- U4: `record`, the Plan's one save door; `onPatch` and `ready` as props; `onApply` and `onUpdate` go, so a Plan over data that is no record does not edit (ruled 14 November 2026); `editing` refused naming each part's replacement. **Done when** the three examples that edit rows save through `record`, and planRowDrop's `onPatch` and `ready` hold.
- U3: `hidden`; the series pickable where the library lists `Plan.library.series()`, each member of a `views` switched alone; `pick` refused. **Done when** the refusal names `hidden`, and a Plan without the Series tab binds no state.
- U8: `Plan.status(words, tone, { ring? })`, drawn on runs, tiles, marks and chips; a run map's `status` and a tile map's `tone` refused naming it. **Done when** planTargetState's runs and tiles build with it.
- Examples 1 (its `pick` and its statuses), 4, 8 and 9.

**2. The rows are the resources (U1, U2, U5)**
- U1: `Plan.series.resources`; `resource: { field, of }` over a resources series or a `kinds` case, or a case for each case of a variant field, the field checked against the series' key type; `resources` refused naming its replacement.
- U1: how a kind is read. Over paged rows every kind is read a cell at a time through its source of the rail, over the resources nested in the groups in view; one with no source, or with no series or summary index, is refused at build, as today. Over rows read whole, nothing changes.
- U2: `Plan.series.kinds`, a resources series' config for each case, exhaustive with `false`; `case: [field, tag]`; every key unique across the tree; the Series tab listing each case.
- U5: the inspector over the record's rows, with or without event kinds, and the refusals holding Save.
- The renderer: events on a resources series or a case; the canvas derived with the drafts in place, rows and events alike.
- Examples 10 to 18 and 21, whose `resources` become rows, and 1's eighteen matches.

**Done when** #1541's Landing acceptance holds, §3.5's series build, an unlisted case fails to compile, and every example that named `resources` draws its events on the record's rows.

**3. Drops and locks (U7, U9, and U1's library)**
- U7: one `canDrop` over `Plan.Types.Candidate`, with its `backlog` case, a `PlanRowIdType` row, `lane`, and `PlanInstantType` ends, its message on the ghost. **Done when** planRowDrop's and planPrintWorks' checks are one over it, and one candidate is built for every drop.
- U9: `locked` on `Schedule.events` and on a data series item's map. A locked one draws with a lock, is not moved, resized or removed, shows its form read only, and an optimiser's answer that changes it is refused (#1622, a row the viewer may not change). It is one rule, to which a composite record later adds a second reason (U6). **Done when** §3.5's `locked` builds and each gesture's refusal holds in the renderer's tests.
- U1: a tab's `create: { kind, duration | at, values }`, beside a tab's `drop`. **Done when** §3.4's Orders card makes a job where it lands.

**4. Child rows and the press pages (E1; U1's `child` and lanes; U2's `row: false`; U12).** It needs the rail's `scope` (#1621).
- #1540, E1: `index.nestedSeries.rows` and `index.nestedSeries.items` over a `Dict<K, Struct>` field for any key type. **Done when** #1540's acceptance holds, on east-node, east-c and east-py.
- U1: `child: { field, of }`; a variant `lane`, every case drawn in the series' `lanes` order; a drop writing the resource's field, the child's and the lane's.
- U2: a case's `children`, and `row: false`. **Done when** a kind landing on a `row: false` case with no `child` is refused.
- U12: `Plan.children.of(fn, [series])`, read only. **Done when** its rows draw beneath each row and a series under it with `edit` is refused.
- planPressTasks and planOnePress (#1541 §3.7). **Done when** both build and draw as #1541's press pages acceptance says.

**5. Link kinds (U10)**
- `Plan.links(record, { from, to, … })`, its typed ends checked at build; today's list kept.
- The renderer: a link kind drawn as today's links are, a far end read by its key, a link in the inspector, the Connect tool, and `canConnect` over `Plan.Types.ConnectCandidate`.
- Example 16, its 17 links one link kind.

**Done when** §3.5's feeds build, a feed is drawn with the Connect tool, and #1541's Link ends acceptance holds.

**6. The print works, and the close (#1543)**
- The print works of #1541 §3, over plain records, as an example of its own, with one templates record (`case`, §9 question 1) and its optimiser by #1622's contract. **Done when** it builds and draws as #1541's worked example acceptance says.
- An event kind keyed by a variant, on a plain record: drawn, dragged, saved, and named by a link's end, by its typed key (#1541's Any key type acceptance). A composite record's key then needs nothing more of the Plan.
- The showcase's Plan pages follow the examples, each changed one with its responsive spec.
- The e3-ui skill's Plan section and its builders contract, as #1543 lists them.
- The proposal as `libs/east-ui/docs/proposals/Plan - DX Proposal.md`: examples as the specification, its requirements numbered, each naming its example and its spec.

Pull request 4 closes #1540. Pull request 6 closes #1541, #1542, #1543 and this epic.

**After it: composite records (#1465), in #1468.** Its own groups A to H, and with its UI group the Plan over a composite record (U6: #1468's tasks L1 to L3) and the print works in its composite form (#1541 §3.8: its task M3). The Plan leaves U6 two things to add: the lock's second reason, an event's key being an external source's, and a new event's key under the solution's own source.
