# Sheet Builder — design

The e3-ui `Sheet`: the planning spreadsheet moves from east-ui to e3-ui, and
is laid out in `BuilderFrame` as Studio's builder, the query builder, the
Calendar and the Roster are: one toolbar holding every control the sheet has,
the author's library (row templates, cards of their own to drag in, the
columns), the sheet in main, and an inspector for the selected row.

It is one component, `<Sheet>` (decision 16, #1216): it renders in its frame
wherever it is used, its library and inspector are optional props, and its
rows come from an e3 record bound with its patch mutation or are the host's
(`data`). The first design's two components, `<Sheet.View>` (the frameless
sheet) and `<Sheet.Builder>` (the sheet over a record, in its frame), are gone;
where a section below still says "the builder", it is `<Sheet>`.

This document is the design the Plan and Sheet builders' epic builds for the
Sheet; `Plan Builder Spec.md` beside it is the Plan's. Each sub-issue copies
the sections it owns.

## 0. The files

| File | What it is |
|---|---|
| `Sheet Builder Spec.md` | This design. |
| `Sheet Spec.md`, `Sheet Spec.html`, `Sheet Behaviour.html` | The sheet itself, unchanged: the grid, the column kinds, registers and the driver, the link cell, the copilot, the lens and the views. Its rules (`B§n`) still hold in `<Sheet>`. |
| `Calendar Spec.md`, `Calendar Spec.html` | The builder chrome this follows: the frame, the panes, the library's cards and the inspector's form. |

There is no hi-fi mock of the builder. The grid looks as `Sheet Spec.html`
has it, and the frame, library and inspector as the Calendar's mock. An agent
measures either in a headless browser, through its DOM, and never reads a
screenshot.

## 1. Summary

- **What.** `<Sheet>` is the planning spreadsheet in its frame: typed
  columns, registers and the driver, the link grammar, the copilot, groups,
  loose rows and sub rows, views and the lens, as the east-ui `<Sheet>` had
  them. Around it go a library and an inspector, each an optional prop, and
  drag and drop.
- **Where.** The Sheet moves to e3 whole. Its wire types, factories, JSX
  tag, examples and skill text go to e3-ui (`libs/east-ui/packages/e3-ui/src/sheet/`),
  on one carrier, `Sheet`. Its React renderer, with its DOM tests and test
  utilities, goes to e3-ui-components (`src/sheet/`), which registers it.
  Its slot recipe stays in east-ui-components' theme,
  as Studio's and the query builder's do, and the shared building blocks the
  renderer imports (the editing session, the toolbar, the slice rail, the
  paging primitives, the state runtime, …) reach e3-ui-components through
  `@elaraai/east-ui-components/internal`.
- **Rows.** `record={…}`, a `Record.bind` handle bound with its patch
  mutation. Its entries are the rows, in key order; or, with `entry`, one
  entry's Array field holds them, in their own order. A large record is read
  a window at a time (`window`). Or `data={…}`, the host's rows: an array, a
  bind handle or a paged source, edited through `onApply`, `onUpdate` and
  `onPatch` (#1216).
- **Draws.** `BuilderFrame`: one toolbar (the view tabs, the lens's context,
  the slice's rail, the history item with Save); the library, the tabs
  `library` lists (Rows, Columns and the author's own), in the start pane,
  and none when it lists none; the sheet and its strip in main; the inspector
  (Details · Issues) in the end pane when the sheet is given `inspector`, and
  none when it is not; the sheet's footer.
- **Built in.** Undo, redo and discard; Save as one checked commit through
  the record's patch mutation, or the host's `onApply`; drag and drop (templates and the author's
  cards into the sheet, rows and groups to new places); the inspector's form
  for every field, with or without a column. The app wires none of it.
- **Keeps.** Everything today's sheet does: the column kinds, registers, the
  driver, the link cell, copilot fills and proposed rows, readiness, groups,
  loose rows, sub rows, the lens, views, paging, key search, the clipboard,
  the keys, the grid's accessibility and its words.

## 2. Decisions

These are settled; the proposal was approved on 2026-10-04.

1. **The Sheet moves to e3 whole**: its wire types, factories, tags,
   examples, specs and skill text to e3-ui, and its React renderer with its
   tests to e3-ui-components, on a carrier (one, `Sheet`, since decision 16).
   east-ui and east-ui-components keep nothing of
   the Sheet: east-ui loses its arm, and east-ui-components keeps only the
   sheet's slot recipe in its theme (as it keeps Studio's) and the shared
   building blocks the renderer imports, exported through `/internal`.
   `Editing` stays in east-ui, shared.
2. **The builder edits an e3 record**, bound with its patch mutation. Its
   entries are the rows, or with `entry` one entry's Array field is. Every
   other source is `data`'s (decision 16).
3. **Over the entries the order is the keys'**, as a keyed paged sheet's is
   today: rows sit in key order, a new row's key is minted, and flat rows
   don't move. A sheet whose order the planner sets keeps its rows in one
   entry.
4. **One toolbar holds every control**: the view tabs, the context switch,
   the match count, the key search, the slice's rail as its toolbar items
   (folding first), the scope badge, and the history item with Apply at its
   end. Nothing draws a second row. The strip stays docked under the grid, in
   main.
5. **The session is today's**: the shared `Editing` contract, Apply one
   checked commit through `Record.onApply`. Conflicts, refusals and the
   out-of-date state are banners, and drafts last until applied or
   discarded, per entry.
   *Amended (2026-10-07, the user's ruling, #1260):* the commit decisions 4
   and 5 call Apply reads Save, as every builder's does. Apply stays the
   API's word: `onApply`, `Record.onApply`, `applyMode`, `Sheet.apply`.
6. **The library is the author's** (amended 2026-10-05, on the live
   showcase): `library` lists its tabs, in order, each a `Sheet.library.*`
   call — `rows()` (templates, and on a grouped sheet groups with their
   lines), `columns()` (show and hide) and `tab(data, { … })`, cards of the
   author's own, read as a register's members are, whose `drop` is the
   `Sheet.patch` a dropped card sets. Left out, there is no library pane.
   The first design's Registers tab is dropped: registers stay what the
   cells pick from.
7. **Templates are data**, declared on the builder as `Sheet.patch` values.
   A dropped one is `newRow`'s defaults with the template's fields over them.
8. **The inspector's form is `Fields`** (#1147), as the Calendar's is. A
   column's kind gives its field's editor, and a field with no column is
   shown and edited by its type. Link and set fields show resolved and are
   edited in the grid. Its second tab lists the batch's issues, as the
   Roster's inspector does.
9. **Hidden columns are per viewer**, not part of a view: a view stays a
   narrowing and its lens, so `Sheet.Types.View` doesn't change. Column order
   stays declared, and resizing stays out (`Sheet Spec.md` §10).
10. **`views` takes a bind handle**, kept where the app keeps it: per viewer
    in `State`, or shared in a dataset — on every sheet since decision 16,
    which takes `onViewsChange` away.
11. **Rows and groups move by dragging**, a new gesture for the capabilities
    `edits` already declares (`moveRows`, `moveGroups`).
12. **The sheet's name is `name`** (amended by decision 16; the first design
    named the builder `id`). `id` names the rows' identity field wherever rows
    need one: on `data`, and as `entry.id` does on a record's entry.
13. **No new hi-fi mock**: the grid follows `Sheet Spec.html`, and the
    frame, library and inspector follow the Calendar's spec.
14. **Sample data is a joinery workshop**: orders and their operations,
    panel saws, edge banders, CNC routers and a spray booth, with synthetic
    names. Nothing names a client or a client's trade, in the examples, the
    showcase or the tests.
15. **Every example uses bound sources** (§2a): the Sheet's examples, moved
    and new, bind e3 inputs and records, so each runs on e3-web in the
    showcase.
16. **One Sheet** (ruled 2026-10-05, #1216): `<Sheet>` is the only Sheet, and
    it renders in its `BuilderFrame` wherever it is used — in an app, in the
    showcase, in a test. Its library and inspector are optional props: no
    prop, no pane. Its rows are a record's (`record`, with `entry` or
    `window`) or the host's (`data`: an array, a bind handle or a paged
    source, edited through `onApply`, `onUpdate` and `onPatch`, and read only
    with none of them). `Sheet.View`, `Sheet.Builder`, the frameless layout,
    its own toolbar row and the unbounded in-flow mode go: a sheet fills the
    box it is given and scrolls its own rows. Every example renders `<Sheet>`,
    and between them they show each pane combination: none, a library, an
    inspector, and both.

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
rows, the templates and cards its library lists, an event or a row for the
inspector to show, and a draft its check flags for the Issues tab.

## 3. The authoring surface

### 3.1 The records an app declares

The rows are the app's own record. Nothing in it is a Sheet type except a
link field's value, `Sheet.Types.Link`, which today's sheet already uses.
Registers are read-only data, as today.

```ts
// records.ts
import { ArrayType, DateTimeType, DictType, FloatType, IntegerType, OptionType, StringType, StructType, variant } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { Sheet } from "@elaraai/e3-ui";

// The vocabulary: read only.
export const ActivityType = StructType({ name: StringType, uom: StringType, days: IntegerType });
export const MachineType  = StructType({ family: StringType, bay: StringType });
export const activities   = e3.input("activities", ArrayType(ActivityType), variant("value", []));
export const machines     = e3.record("machines", DictType(StringType, MachineType), new Map());   // keyed by code: S101, E201, R301, F401

// The rows: orders, each with its operations.
export const OperationType = StructType({
    activity:   StringType,                    // the driver: an activity's name
    start:      OptionType(DateTimeType),
    end:        OptionType(DateTimeType),
    qty:        OptionType(FloatType),         // in the activity's unit
    machines:   Sheet.Types.Link,              // work centres, from → to
    notes:      StringType,
    created_by: StringType,                    // no column: the inspector shows it
});
export const OrderType = StructType({
    name:     StringType,                      // "WO-2207 · Kitchen, oak"
    customer: StringType,
    due:      OptionType(DateTimeType),
    status:   StringType,                      // a word of the statuses register
    ops:      ArrayType(OperationType),        // the order's operations, in order
});
export const orders      = e3.record("orders", DictType(StringType, OrderType), new Map());   // keyed by order number: WO-2207
export const ordersPatch = e3.mutation.patch(orders);

// The smallest builder's record: jobs, keyed J-0001, J-0002, …
export const JobType   = StructType({ task: StringType, start: OptionType(DateTimeType), qty: OptionType(FloatType) });
export const jobs      = e3.record("jobs", DictType(StringType, JobType), new Map());
export const jobsPatch = e3.mutation.patch(jobs);

// One plan per week, its rows in the planner's order (§3.4).
export const PlanRowType = StructType({ id: StringType, task: StringType, start: OptionType(DateTimeType), qty: OptionType(FloatType) });
export const WeekType    = StructType({ starts: DateTimeType, rows: ArrayType(PlanRowType) });
export const plans       = e3.record("plans", DictType(StringType, WeekType), new Map());   // keyed by week: 2026-W42
export const plansPatch  = e3.mutation.patch(plans);
```

### 3.2 The smallest sheet

```tsx
// job-sheet.tsx
import { East } from "@elaraai/east";
import { Box, Reactive, UIComponentType } from "@elaraai/east-ui";
import { Record, Sheet, ui } from "@elaraai/e3-ui";
import * as d from "./records.js";

export const jobSheet = ui("job_sheet", [], East.function([], UIComponentType, _$ => (
    <Reactive>{$ => {
        const jobs = $.let(Record.bind(d.jobs, [d.jobsPatch]));
        return (
            <Box height="560px">
                <Sheet
                    record={jobs}
                    columns={{
                        task:  Sheet.column.text(d.JobType, { header: "Task", width: "240px" }),
                        start: Sheet.column.date(d.JobType, { header: "Start", width: "96px" }),
                        qty:   Sheet.column.quantity(d.JobType, { header: "Qty", width: "96px" }),
                    }}
                />
            </Box>
        );
    }}</Reactive>
)));
```

That is a working editor. There is one row per job in key order, with a blank
tail for the next one. Every gesture is a draft the history item can undo,
and Save commits the drafts as one patch through `jobsPatch`. A new row's
key is minted unless `newRowId` names one. It lists no `library` and is given
no `inspector`, so it has neither pane: the toolbar, the grid and the footer.
It fills the box it is given, 560px here, and scrolls its own rows.

### 3.3 The workshop's orders

A grouped sheet: each order is a group, and its operations are its lines. It
has an activity driver, a machines register and a statuses register, a
copilot fill, a check on each order, templates for an order and for single
operations, a library of the templates, the statuses and the columns, the
slice's search and filter, and saved views.

```tsx
// workshop.tsx
import { ArrayType, DateTimeType, East, OptionType, StringType, StructType, none, some, variant } from "@elaraai/east";
import { Reactive, Slice, State, StatusValueType, UIComponentType } from "@elaraai/east-ui";
import { Data, Record, Sheet, ui } from "@elaraai/e3-ui";
import * as d from "./records.js";

export const workshop = ui("workshop_orders", [], East.function([], UIComponentType, _$ => (
    <Reactive>{$ => {
        const orders     = $.let(Record.bind(d.orders, [d.ordersPatch]));
        const machines   = $.let(Record.bind(d.machines, []));
        const activities = $.let(Data.bind(d.activities));
        const views      = $.let(State.bind([ArrayType(Sheet.Types.View)], "workshop.views", []));
        const StatusRow  = StructType({ word: StringType, tone: StatusValueType });
        const statuses   = $.let([
            { word: "PLANNED",  tone: variant("neutral", null) },
            { word: "RELEASED", tone: variant("info", null) },
            { word: "ON HOLD",  tone: variant("warning", null) },
        ], ArrayType(StatusRow));
        // Every operation of every order: what the slice searches and filters.
        const operations = $.let(orders.read().toArray((_$, o) => o.ops).flatMap((_$, ops) => ops));
        const slice = $.let(Slice.bind([d.OperationType], "workshop.slice",
            Slice.config(d.OperationType, { fields: { activity: { label: "Activity" }, notes: { label: "Notes" } },
                                            searchFieldIds: ["activity", "notes"] }),
            Slice.state(), operations, none));
        // End = start + the activity's days: a fill the copilot offers.
        const DateFill = OptionType(Sheet.Types.Fill(DateTimeType));
        const endFromStart = $.const(East.function([Sheet.Types.DraftContext(d.OrderType, "ops", d.ActivityType)], DateFill, ($, ctx) => {
            const noFill = $.const(none, DateFill);
            return ctx.row.start.match({
                value: (_$, supplied) => supplied.match({
                    none: () => noFill,
                    some: (_$, start) => ctx.driver.match({
                        none: () => noFill,
                        some: (_$, a) => some({ value: start.addDays(a.days), meta: East.str`+${a.days}d · ${a.name}` }),
                    }),
                }),
            }, () => noFill);
        }));
        // The operations a kitchen order starts with: a group template's lines.
        const kitchen = $.let([
            { activity: "Panel cutting", start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
            { activity: "Edge banding",  start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
            { activity: "Assembly",      start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
            { activity: "Spray finish",  start: none, end: none, qty: none, machines: { from: [], to: [] }, notes: "", created_by: "" },
        ], ArrayType(d.OperationType));
        return (
            <Sheet
                record={orders}
                group={Sheet.group(d.OrderType, "ops", {
                    title: "name", sub: o => o.customer, noun: { singular: "order", plural: "orders" },
                    cells: { activity: Sheet.group.cell.enum(d.OrderType, "statuses", "status"),
                             end:      Sheet.group.cell.date(d.OrderType, "due") },
                })}
                driver={Sheet.driver("activity", activities.read(), { key: a => a.name, label: a => a.name, meta: a => some(a.uom) })}
                registers={{
                    machines: Sheet.register.concat([
                        Sheet.register.members(machines.read(), { kind: "machine", key: (_m, code) => code, label: (_m, code) => code,
                            meta: m => some(m.family), parent: m => some(m.bay) }),
                        Sheet.register.members(machines.read(), { kind: "family", key: m => m.family, label: m => m.family,
                            meta: _m => some("family") }),
                    ]),
                    statuses: Sheet.register.members(statuses, { kind: "status", key: s => s.word, label: s => s.word, tone: s => some(s.tone) }),
                }}
                columns={{
                    activity: Sheet.column.lookup(d.OperationType, { header: "Activity", width: "160px" }),
                    start:    Sheet.column.date(d.OperationType, { header: "Start", width: "96px" }),
                    end:      Sheet.column.date(d.OperationType, { header: "End", sub: "start + days", width: "96px",
                                  base: "start", fill: [endFromStart] }),
                    qty:      Sheet.column.quantity(d.OperationType, d.ActivityType, { header: "Qty", sub: "unit per activity",
                                  width: "104px", uom: a => a.uom }),
                    machines: Sheet.column.link(d.OperationType, d.ActivityType, "machines", {
                                  header: "Work centres", sub: "from → to · 2 x edge bander", width: "300px",
                                  members: [{ kind: "machine", identified: true }, { kind: "family", countable: true, resolvesTo: "machine" }] }),
                    notes:    Sheet.column.text(d.OperationType, { header: "Notes", width: "240px" }),
                }}
                inspector
                fields={{ created_by: Sheet.field.readonly() }}
                library={[
                    Sheet.library.rows(),
                    // The statuses an order takes: a card dropped on an order's band sets its status.
                    Sheet.library.tab(statuses, { name: "Statuses", icon: "flag",
                        key: s => s.word, label: s => s.word, drop: s => Sheet.patch(d.OrderType, { status: s.word }) }),
                    Sheet.library.columns(),
                ]}
                templates={{
                    groups: [{ key: "kitchen", name: "Kitchen order", group: "Orders",
                               values: Sheet.patch(d.OrderType, { status: "PLANNED", due: none, ops: kitchen }) }],
                    rows:   [{ key: "edge", name: "Edge banding", group: "Operations",
                               values: Sheet.patch(d.OperationType, { activity: "Edge banding",
                                   machines: { from: [], to: [variant("counted", { n: 1n, key: "edge bander" })] } }) },
                             { key: "spray", name: "Spray finish", group: "Operations",
                               values: Sheet.patch(d.OperationType, { activity: "Spray finish" }) }],
                }}
                newGroup={East.function([Sheet.Types.NewGroup], Sheet.Types.Patch(d.OrderType), () =>
                    Sheet.patch(d.OrderType, { status: "PLANNED", due: none, ops: [] }))}
                ready={{ group: East.function([Sheet.Types.DraftGroup(d.OrderType, "ops")], Sheet.Types.Readiness, ($, order) => {
                    $.if(order.customer.hasTag("value").and(() => order.customer.unwrap("value").length().equal(0n)), $ => {
                        $.return(East.value(variant("incomplete", [{ field: "customer", message: "Name the customer" }]), Sheet.Types.Readiness));
                    });
                    return East.value(variant("ready", null), Sheet.Types.Readiness);
                }) }}
                slice={slice} affordances={["search", "filter"]}
                views={views}
            />
        );
    }}</Reactive>
)));
```

Apart from `record`, `templates`, `library`, `inspector`, `fields` and `views`,
every prop is the east-ui `<Sheet>`'s declaration, unchanged. The orders sit in
key order, by order number, and an order's operations keep the order the
planner gives them.

### 3.4 One entry's rows, and a paged record

```tsx
// The week the viewer picked; each week keeps its own drafts until Save or Discard.
const plans = $.let(Record.bind(d.plans, [d.plansPatch]));
const week  = $.let(State.bind([StringType], "plans.week", "2026-W42"));
<Sheet record={plans} entry={{ key: week.read(), rows: "rows", id: "id" }} columns={{ /* … */ }} />

// A large record, paged in key order: key search over its keys, the lens over the loaded rows.
const jobs = $.let(Record.bind(d.jobs, [d.jobsPatch]));
const page = $.let(Data.bindPaged(d.jobs));
<Sheet record={jobs} window={page} columns={{ /* … */ }} />
```

| | The record's entries are the rows | One entry's rows |
|---|---|---|
| Declared | `record={jobs}` | `record={plans} entry={{ key, rows: "rows", id: "id" }}` |
| Order | The keys', as a keyed paged sheet is today | The array's: the planner's order |
| A row's identity | Its key | The `id` field |
| A new row | A minted key (`newRowId`), placed where its key sorts | At the seam it was made at |
| Moving rows | Flat: no. Grouped: lines move between groups, and groups keep key order | As `edits` allows: within, between groups, and groups too |
| Save | `Record.onApply(record, { keyed: true })`: each changed row an insert, update or delete by key, checked against what it was when the edit began | `Record.onApply(record, { entry, get, set, idField })`: one diff of that entry, reaching its rows and nothing else |
| A large record | `window={Data.bindPaged(d.jobs)}` reads it a window at a time | Read whole: an entry is one value |

Reading a whole record in key order is new. `data` refuses an inline `Dict`,
because a dictionary's rows sit in key order rather than the planner's. A
record is keyed by nature, so `record` accepts it, in the order a keyed paged
sheet already has.

## 4. The options

### 4.1 `<Sheet>`'s props

| Prop | Takes | What it does |
|---|---|---|
| `record` | `Record.bind(rec, [patch])` | The record the rows are read from and committed to. It must be a `Dict` bound with its patch mutation, as `Record.onApply` requires. A sheet takes its rows from `record` or from `data`, never both (#1216). |
| `data`, `id`, `onApply`, `onUpdate` | as the east-ui `<Sheet>`'s | The host's rows (#1216): an array, a bind handle or a paged source, `id` their String identity field, edited through `onApply` / `onUpdate` (and `onPatch`), read only with none. Over a record, `id`, `onApply` and `onUpdate` are refused: the record identifies and commits its rows. |
| `entry` | `{ key, rows, id }` | The rows are one entry's Array field (`rows`, a field name) with `id` their String identity field. `key` may be an expression, such as the entry the viewer picked. Omitted, the entries are the rows. |
| `window` | `Data.bindPaged(rec)` | Reads a large record a window at a time, in the entries form. |
| `columns`, `group`, `subRows`, `driver`, `registers`, `owned`, `suggest`, `ready`, `newRow`, `newGroup`, `newRowId`, `edits`, `applyMode`, `onPatch`, `slice`, `affordances`, `activeView`, `blanks`, `readOnly`, `density`, `footer` | as `<Sheet>`'s | Unchanged (`Sheet Spec.md` §3). The row type the columns are built over is the entries' (or, with `entry`, the rows field's element type); a grouped sheet's columns are over its line type, as today. |
| `views` | a bind handle of `Array<Sheet.Types.View>` | The saved views, read and written by the builder: a `State.bind` to keep them per viewer, or a `Data.bind` dataset to share them. |
| `templates` | `{ rows?, groups? }` | The Rows tab's cards (§4.2). |
| `library` | `Sheet.library.*` calls | The library's tabs, in order (§4.4); left out, or `[]`, no library pane. |
| `fields`, `groupFields` | `{ [field]: Sheet.field.* }` | Hints for the inspector's form: for a field with no column, or to override what a column's kind gives (§5.3). `Sheet.field` is `Fields` (#1147), as `Calendar.field` is; a `reference` hint names one of the sheet's registers (the driver's among them, under its column). Refused without `inspector`. |
| `inspector` | `true`, or `(row, update) => UIComponentType` | The inspector pane (#1216). Given alone (`inspector`), Details shows the selected row's form (§5.3). Given a function, the author's own Details for a row (SB58): an East function over the row — its own struct, a grouped sheet's line — and a writer of the edited row, passed through untouched. Left out, no inspector pane. |
| `name` | string | Names the sheet when a surface holds two: its viewer state's storage key, its library's drag-source id and its drop target (#1216; the first design's builder `id`). |

### 4.2 Templates

```ts
interface SheetTemplate<R extends StructType> {
    key: string;                                          // unique within its tab
    name: string;                                         // the card's name
    group?: string;                                       // the Rows tab's group
    values: SubtypeExprOrValue<Sheet.Types.Patch(R)>;     // the fields it sets: Sheet.patch(R, { … })
}
```

`templates.rows` are over the row type (a grouped sheet's line type), and
`templates.groups`, on a grouped sheet only, over the group type with its
lines. A dropped template's row takes `newRow`'s (or `newGroup`'s) defaults
with the template's set fields over them. A field that neither sets starts
missing, as a typed row's does, and readiness asks for it.

### 4.3 Build-time refusals

Each names the prop and the remedy:
- rows from both `record` and `data`, or from neither; `entry` or `window`
  without a record; `id`, `onApply` or `onUpdate` over a record; and
  `onViewsChange`, which `views` replaces (#1216);
- `record` is not a `Dict`, or is not bound with its patch mutation;
- `entry.rows` is not an Array field of the entry's type holding the columns'
  row type (or the groups, or `Sheet.Types.Entry` entries), or `entry.id` is
  not a String field of it;
- `window` pages another record, or is given with `entry`;
- a template is built over another row type, a template key repeats, or a
  group template is given on a flat sheet;
- the library lists a tab twice (an author's tab by its name), an author's
  tab's data is neither an Array nor a `Dict<String, T>`, or its `drop`
  returns a patch over neither the row type nor the group type;
- `fields` or `groupFields` names a field the type doesn't have, or one the
  inspector shows with another (a row's identity, a group's lines, a link's
  other half); gives a field an editor that doesn't fit its type, or a read-only
  column's field (stamped, a `value` projection, a set, link or custom column,
  `editable: false`) any editor at all; hints a column's field per nested
  field; names in a `reference` a register the sheet doesn't declare;
  `groupFields` is given on a flat sheet; or either is given without an
  `inspector` (#1216);
- `inspector` is not an East function `(Row, (Row) => Null) => UIComponentType`
  over the row type (a grouped sheet's line type).

Every refusal today's sheet makes still applies (`Sheet Spec.md` §3.12),
among them moving rows in a flat key-ordered sheet.

### 4.4 The library

```ts
library={[
    Sheet.library.rows(),                              // the templates, by their group
    Sheet.library.tab(crews.read(), {                  // the author's own cards
        name: "Crews", icon: "user-group",
        key: (_c, code) => code, label: c => c.name, meta: c => some(c.skill), group: c => c.team,
        drop: (_c, code) => Sheet.patch(OperationType, { crew: code }),   // what a dropped card sets
    }),
    Sheet.library.columns(),                           // each column with an eye, per viewer
]}
```

An author's tab reads its rows as `Sheet.register.members` reads a
register's: an `Array<T>` or a `Dict<String, T>`, with accessors
`(row, key) => …`, a key that repeats keeping its first card. Its `drop`
returns what a dropped card sets, as a template's `values` do: a
`Sheet.patch` over the row type (a grouped sheet's line type) lands on a
row, over the group type on a band. A drop sets fields; it cannot add to a
set or a link half, since the patch sees only the card.

## 5. The East types

### 5.1 What an app author meets

Every `Sheet.Types` member stays as it is. The builder adds the template
shape of §4.2, a TypeScript interface whose `values` is a `Sheet.Types.Patch`.

### 5.2 What the renderer receives: the payload

The payload holds a whole `SheetRootType`, the root the grid draws, rather
than a copy of its parts: a component made of parts reuses the parts'
interface types. Over a record, its rows are read from the record (whole, a
window, or one entry's field), and its editing session commits through
`Record.onApply`; over `data`, they are the host's, and the session commits
through the host's `onApply` or `onUpdate`. As built (#1216):

```ts
SheetPayloadType = StructType({
    sheet:     SheetRootType,                    // the grid, its rows and its session wired to its source
    templates: ArrayType(SheetTemplateWireType), // the Rows tab's cards
    library:   ArrayType(SheetLibraryTabType),   // the library's tabs, in order; none, no pane
    inspector: OptionType(StructType({           // the inspector pane; none, no pane
        forms:  SheetFormsType,                  //   its forms (Fields, #1147): a row's, and a group's
        custom: OptionType(SheetInspectorType),  //   the author's own Details for a complete row (SB58)
    })),
    history:   OptionType(FunctionType([], OptionType(ArrayType(RecordCommitInfoType)))),   // over a record, its commits: the last save, and who changed it; none over data
    missing:   OptionType(StringType),           // with `entry`, its key while the record does not hold it: the frame's banner (SB15, SB23)
    name:      OptionType(StringType),           // names the sheet when a surface holds two
});

SheetTemplateWireType = StructType({
    key: StringType, name: StringType, group: OptionType(StringType),
    cells: DictType(StringType, Sheet.Types.Cell),   // what the card shows, through the columns' projection
    seed:  VariantType({                             // the draft and its cells, as newRow's and newGroup's constructors make them
        row:   FunctionType([Sheet.Types.NewRow], SheetSeedType),
        group: FunctionType([Sheet.Types.NewGroup], SheetSeedType),
    }),
});

SheetLibraryTabType = VariantType({
    rows:    NullType,
    columns: NullType,
    tab:     StructType({
        name: StringType, icon: OptionType(StringType),
        drop: OptionType(VariantType({ row: NullType, group: NullType })),   // where its cards land: what the patch is over
        cards: ArrayType(StructType({
            key: StringType, label: StringType, meta: OptionType(StringType), group: OptionType(StringType),
            sets: DictType(StringType, Sheet.Types.Cell),   // the drop's patch, through the editable columns (or band cells)
        })),
    }),
});

SheetFormsType = StructType({ row: SheetFormType, group: OptionType(SheetFormType) });   // a group's on a grouped sheet
SheetFormType = StructType({
    type:     EastTypeType,                     // the struct the form edits: the row (a grouped sheet's line), or the group
    fields:   ArrayType(StructType({ spec: FieldSpecType, column: OptionType(StringType) })),   // each field, and the column (or band cell) it is read and written through
    columns:  ArrayType(StringType),            // the fields the editable columns write — a link's other half among them
    readonly: ArrayType(StringType),            // the fields under read-only columns, which a whole-row write leaves as they are
    encode:   FunctionType([BlobType], DictType(StringType, Sheet.Types.Cell)),   // a Sheet.Types.Patch of the struct, as bytes → the cells it sets
});
SheetInspectorType = FunctionType([BlobType, FunctionType([BlobType], NullType)], UIComponentType);   // the row as bytes, and the writer of the edited row as bytes

SheetComponent = EastUI.component("Sheet", SheetPayloadType, { optional: true });
```

The columns need nothing new: the Columns tab reads them from `sheet`. An
author's card crosses the closed payload as the cells its drop sets, as a
proposed row's patch does. The templates' seeds are built by the
code that builds `newRow`'s today (`seed-bridge.ts`), so a template's draft
and the cells it shows come from one call. A form's `encode` is the same
projection the copilot's proposals go through, so an inspector's write lands
on the cells as the grid would write them; the author's `inspector` is
checked against the row type and wrapped, so the row and the edited row cross
the closed payload as bytes.

### 5.3 The inspector's editors

| The field's column | Its editor in the inspector (`Fields` hint) |
|---|---|
| `text`, `custom` | Text; a custom column's text is read by its `parse` and shown by its `print` |
| `date` | The date field at the row's date level: a date alone at a week, a day or a range (and on a column with no `level` rule, read at a day, as the grid reads it); a date and its time at the time level |
| `quantity`, `integer` | The number field, a quantity in the driver's unit, in its help line |
| `lookup`, `reference`, `enum` | A select over the register's members as the column's `options` rule offers them at that row, each its label and meta (`Panel cutting · panels`) |
| `set`, `link` | The cell as the grid draws it — the members as chips, from → to, each resolved with its meta (`S101 beam saw`), a counted member its kind — and "Edit in sheet", which puts the ring on the cell; off, with its reason, while the column is hidden. Edited in the grid. |
| `stamped`, a `value` projection, `editable: false` | Read only, printed as the grid prints it, with the owner of a stamped code as its help line |
| No column | By its type (`Calendar Spec.md` §4.3), or the `fields` hint (`Sheet.field.readonly()`, `hidden()`, …) |

Each field is `FieldForm`'s (#1147): the shared `Field` — its label, its key,
its help line — around the shared input its East type takes. A column's
header and its second line are its label and help, unless a hint names its
own. As built, an enum member's tone is not shown in its select: the shared
`Select` draws no tone, and the member's label and meta are.

## 6. What moves

| Today | After | Notes |
|---|---|---|
| east-ui `Sheet`: the IR in `src/collections/sheet/` | e3-ui `Sheet` in `src/sheet/` | The sixteen files move whole. `Sheet.column.*`, `Sheet.register.*`, `Sheet.driver`, `Sheet.link.*`, `Sheet.patch`, `Sheet.group`, `Sheet.subRows`, `Sheet.apply` and `Sheet.Types` keep their names and their types. No column kind changes. |
| `<Sheet>`, the `Sheet` arm of `UIComponentType` | e3-ui's `<Sheet>`, in its frame, on an `EastUI.component` carrier, `Sheet` (#1216) | The same column, grid and session props over `data`, the record forms over `record`, and the panes as optional props. An app changes its import and gives the sheet a box of its own height. |
| east-ui-components `collections/sheet/` (14,373 lines) and its DOM tests, registered for the arm | e3-ui-components `src/sheet/`, registered for the carrier | The renderer moves whole, and splits into its parts: the toolbar's items, the grid with its strip, and the footer, which `src/sheet/frame/` lays out in `BuilderFrame` with the panes. Its slot recipe stays in east-ui-components' theme. What it imports from east-ui-components is exported through `/internal`. |
| east-ui's Sheet specs and examples (3,169 lines), the skill text | e3-ui's | They test and document the namespace, imported from `@elaraai/e3-ui`. The showcase's Sheet page and its responsive specs stay in the showcase, which already loads e3-ui's components. |
| `Editing` (`contracts/editing.ts`) | Stays in east-ui | Shared with Plan, the SnapGrid, the Calendar and the Roster. `Sheet.apply` and `Sheet.Types.ChangeSet` remain its values. |

Nothing else in east-ui depends on the Sheet. The one helper it borrows from
Plan's builders, `resolveTag`, moves to east-ui's `shared/` with Plan's move,
which lands first; the helper is generic.

| A sheet that… | Gives `<Sheet>` |
|---|---|
| edits an e3 record | `record` (with `entry` or `window`) |
| edits a `State`, an inline value or any source the app writes itself | `data` and `id`, with `onApply` or `onUpdate` |
| offers templates, its author's cards or the columns to show | `library` |
| shows the selected row's every field, and the batch's issues | `inspector` |

## 7. Layout in BuilderFrame

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ SHEET  KITCHENS  ON HOLD +1  ±0 ±1 ±3  12 matches   Filter Search   2 issues ↶ ↷ ✕ Save  │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ banners: a Save's conflicts and refusals · the record changed under your drafts          │
├──────────────┬──────────────────────────────────────────────────────────┬────────────────┤
│ LIBRARY      │ ACTIVITY      START   END     QTY   WORK CENTRES   NOTES │ INSPECTOR      │
│ Rows         │ ▾ WO-2207 · Kitchen, oak   PLANNED   due 23 Oct          │ Details·Issues │
│ Statuses     │  1 Panel cutting  12 Oct  13 Oct  48 panels  S101 > E201 │  one row: every│
│ Columns      │  2 Edge banding   14 Oct  …                              │  field (Fields)│
│ search       │ ▾ WO-2208 · Wardrobes, ash                               │ a group        │
│ cards (drag) │ strip: candidates · fills · what a cell accepts          │ several · none │
├──────────────┴──────────────────────────────────────────────────────────┴────────────────┤
│ footer: 3 orders · 14 operations · 2 pending · saved 14:02 · ⏎ edit · ⇥ take the fill    │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

| Region | Holds |
|---|---|
| Toolbar | Every control the sheet has, as items of the shared `Toolbar` (§7.1). |
| Banners | A Save's conflicts and refusals, naming the rows; the record changing under pending drafts; a write whose outcome is unknown; an `entry` the record doesn't hold. |
| Start pane "Library" | The tabs `library` lists (§9.7); none, no pane. |
| Main | The grid: its two-line header, rows, bands, seams, lens bands and proposed rows. The strip is docked under it, where candidates, fills and what a cell accepts show while a cell is edited (`Sheet Spec.md` B§9). Nothing floats over the grid but the editor overlay, as today. |
| End pane "Inspector" | Tabs Details · Issues (§9.9), when the sheet is given `inspector`; none, no pane. |
| Footer | The sheet's footer: its count line, the app's `footer` items, the paged transport line, the key hint and the live message, and the last save from the record's commits. |

The panes are `BuilderFrame`'s: pinned beside main while main keeps 480px,
overlaid with a rail and a scrim at 560px and narrower, and slid off main
during a drag so they never hide a drop target. On a phone the grid scrolls
sideways under its sticky gutter, as it does today. The sheet fills its
parent and draws no border of its own. Every style is a slot recipe's.

### 7.1 The toolbar's items

The east-ui sheet laid its chrome out as one row of the shared `Toolbar`,
folded on one ladder. In `<Sheet>` those items are `BuilderFrame`'s
`toolbar`, so the frame has one row and the grid none of its own. A sheet
with none of them — read only, with no slice and no key search — has no
toolbar.

| Item | Side | Under width pressure |
|---|---|---|
| View tabs: the whole sheet, each saved view, `+ TAB` | start | Trailing tabs fold into `+n` (the active one kept), then the names cap at 72px and `+ TAB` loses its label; last (#1221) the strip folds into one chip, the open view's tab, whose menu holds every view, `+ TAB` and the open view's close |
| Context switch: ±0 · ±1 · ±3 | start | Loses its label, then goes |
| Match count: `12 matches · 30 context` | start | Goes |
| Key search, on a paged keyed record | end | Folds to its icon, which opens the box in the edit popover with the focus in it — after the sheet's own steps, before the history item's (#1221). It replaces the rail's search, and keeps its form while a query is typed. |
| The slice's rail: filter · search · cohort | end | Folds first: clause chips into `+M more`, the affordances into summary chips, one chip naming what is set, then the icon. Each opens the slice editor popover. |
| Scope badge: `loaded rows only`, while a paged sheet is narrowed | end | Shown while it applies |
| The history item: status line · issues · Undo · Redo · Discard · Save | end | Folds last, to its buttons |

The rail's items come from `useSliceToolbarItems(slice, [{ key: "rail",
kinds, side: "end" }])`, the hook Plan's toolbar, the Sheet's and the
Library's use today, with `HOST_RANK` keeping every other item folding after
it. The history item is the shared `historyToolbarItem` (#988), and the key
search the shared `useKeySearchToolbarItem`, as the Plan's is (#1221).

On a touch screen every control in the row keeps its size and is a 44px tap
target by its box or by its halo (`coarseHitArea`, #346), never by growing the
row (#1221): the tabs, `+n`, `+ TAB`, the strip's one chip, the active tab's
×, the context switch's options — whose halos grow their height alone, as
they sit two pixels apart — the rail's chips and the key search's icon; a
search box is a 44px field, its input filling it. The × shows on the active or the focused tab alone there, so
its halo never takes a tap that switches tabs. ⌘F and ⌘/ in the grid reach the
key search in either form — its box, its text selected; folded, the box in its
popover — else the rail's search box.

## 8. Anatomy

- **The grid, the strip and the footer** are `Sheet Spec.md` §7's, unchanged.
- **The frame, the panes and the library's cards** are `Calendar Spec.md`
  §8's, drawn with the shared parts: the library 272px and the inspector
  320px open, 44px as rails, a pane's tab row 44px. A tab's name is mono caps
  10.5px with its count after it, weight 500, in the quiet ink (`ROWS 11`),
  the `DockPane` tab's `count`. Each tab is a `Library`: its search band is
  the Library's toolbar row, 44px, the search box 28px on the surface, with
  the grouping control beside it; its cards are the Library's compact card.
- **A Rows card**: a grip (the sheet takes drops, #1187), the
  template's name 13px 600, and under it what it sets in mono 10px, as the
  columns print it (`Edge banding · 1 × edge bander`), or a group template's
  band cells and lines (`PLANNED · 4 lines`). Cards group under their
  `group`'s head, mono caps 10px with its count.
- **An author's card**: the tab's icon in its tile, the card's label 13px
  600, and its meta under it in mono 10px; cards group under their `group`'s
  head, as the Rows tab's do.
- **A Columns card**: the column's header, its kind in mono 10px, an eye
  (an eye-slash while hidden); a hidden column's card is dimmed.
- **An empty tab** is the shared empty state: an empty box — Font Awesome's
  open box, never a text glyph (#1263) — its title (`No templates`, `Nothing
  in Crews`, `No matches`) and a line under it.
- **What the shared parts change from the Calendar mock**: the card's name is
  13px, not 12.5px, and its line mono 10px, not 10.5px; an author's card's
  label is the card's name, not a member's mono 11px; the search box is the Library's 28px box in
  its toolbar row, not a 32px input on a paper-2 band, and folds narrower in
  a narrow pane; the empty state's icon is 36px, not 26px. Nothing a card
  says is lost.
- **The inspector**: 320px open; sections padded 16px with a rule between —
  the head (what is selected in mono caps, its id, a Pending or New chip, the
  lock of an owned row), its issues, its fields, its sub rows, and its
  gestures. A field is `FieldForm`'s: the shared `Field`, its label and key
  over the input its type takes, its help line under it, a changed field
  tinted brand. **What the shared parts change from the Calendar mock**: the
  mock's 92px label column is the shared field's label over its input, so the
  inspector's form is every other builder's; nothing a field says is lost.

## 9. Behaviour

Every rule is numbered. Each sub-issue lists the rules it owns, and each rule
has a test there. `Sheet Spec.md`'s own rules (§5, B§1–B§13) keep holding in
the grid.

### 9.1 The move to e3-ui (owner: the Sheet moves to e3-ui)

- **SB1.** The moved sheet takes every prop the east-ui `<Sheet>` took and
  builds the same root, `SheetRootType`. Since #1216 that sheet is
  `<Sheet data>`, in its frame: an app changes its import (`@elaraai/e3-ui`)
  and gives the sheet a box of its own height.
- **SB2.** east-ui's `Sheet` arm leaves `UIComponentType`. The IR is
  e3-ui's, and the renderer e3-ui-components', which registers it for the
  `Sheet` carrier (#1216); east-ui and east-ui-components export nothing of the
  Sheet. `Editing` stays in east-ui; `Sheet.apply` and `Sheet.Types.ChangeSet`
  remain its values.
- **SB3.** Every Sheet spec, example, DOM test and responsive spec passes
  after the move — since #1216 over the sheet in its frame.

### 9.2 The renderer's parts (owner: the Sheet renderer's parts)

- **SB4.** The Sheet renderer is three parts over one shared state (the
  store, the session, the lens and the selection): the toolbar's items, the
  grid with its strip, and the footer. `<Sheet>` lays them out in its frame
  (#1216).
- **SB5.** A part placed in another region still drives the grid: a tab
  switched in the frame's toolbar narrows the grid, and the history item's
  Undo undoes the grid's last gesture.
- **SB6.** Retired (#1216): there is no frameless layout to keep unchanged;
  the DOM tests and responsive specs run over framed sheets.

### 9.3 Types and factories (owner: the builder's types and factories)

- **SB7.** `<Sheet>` takes `record` or `data` and the props of §4.1, and
  refuses at build each case of §4.3, naming the prop and the remedy.
- **SB8.** The columns' row type is the record's entry type, or with `entry`
  the element type of `entry.rows`; a grouped sheet's columns are over its
  line type and its `group` over the entry (or element) type, as today.
- **SB9.** A template's seed is built by `newRow`'s (or `newGroup`'s)
  constructor code: its defaults first, the template's set fields over them,
  the cells it shows from the same call.
- **SB10.** `fields` and `groupFields` resolve through `Fields` with each
  column's kind as its field's default hint (§5.3); an explicit hint wins.
- **SB11.** `views` takes a whole-value bind handle of
  `Array<Sheet.Types.View>`; the sheet reads it, and writes every change to
  the views to it.
- **SB12.** The payload is `SheetPayloadType` (§5.2) on the `Sheet` carrier
  (#1216), its `sheet` a whole `SheetRootType`.

### 9.4 Rows from a record (owner: rows from a record)

- **SB13.** Without `entry`, the record's entries are the rows, in key order,
  each row's id its key's text. Read whole, the record is an inline keyed
  source; with `window`, a paged keyed source, as `Data.bindPaged` gives
  today.
- **SB14.** A new row in the entries form takes its key from `newRowId`, or
  one the renderer mints, and sits where its key sorts; the seam it was made
  at does not place it.
- **SB15.** With `entry`, the rows are the `entry.rows` field of the entry at
  `entry.key`, in their order, identified by `entry.id`. An entry the record
  doesn't hold shows an empty, read-only sheet and a banner naming the key.
- **SB16.** Save over the entries is `Record.onApply(record, { keyed: true
  })`, taking the session's keyed batches as they are, read whole or paged:
  each changed row an insert, update or delete by key, checked against what
  it was when the edit began. Over one entry's rows it is `Record.onApply(record, {
  entry, get, set, idField })`, with `get` and `set` built from `entry.rows`:
  one diff of that entry, reaching its rows and nothing else.
- **SB17.** When `entry.key` changes the sheet shows that entry, and each
  entry keeps its own session (SB30).

### 9.5 Frame and toolbar (owner: the builder's frame and toolbar)

- **SB18.** The sheet is a `BuilderFrame` wherever it is used (#1216):
  toolbar, banners, the library as its start pane when `library` lists tabs,
  main, the inspector as its end pane when it is given `inspector`, the
  footer. It fills its parent and draws no border.
- **SB19.** The toolbar is one row of the shared `Toolbar`, its items in
  §7.1's order. The grid draws no toolbar of its own.
- **SB20.** Under width pressure the rail folds first (its ranks, through
  `useSliceToolbarItems`), then the sheet's own steps in `Sheet Spec.md`
  §6.3's order, then the key search to its icon and the view tabs into one
  chip (#1221), and the history item last, to its buttons. No item wraps,
  scrolls or moves to a second row.
- **SB21.** Main holds the grid and, docked under it, the strip.
- **SB22.** The footer is the sheet's footer, with, over a record, the last
  commit's time from the record's history (`saved 14:02`).
- **SB23.** The banners, in this order: a Save's conflict, naming its rows
  and who changed the record last; a refusal, with its reason; an unknown
  outcome, with Retry; a failed confirmation read, with Retry; the
  out-of-date notice, with Discard; an `entry` the record doesn't hold. A
  banner leaves when what it reports does.
- **SB24.** The panes are `BuilderFrame`'s, and their open tab and collapsed
  state persist under the sheet's `name`.

### 9.6 Editing, undo and Save (owner: the builder's editing)

- **SB25.** The sheet's session is the shared `Editing` session over its
  rows: every gesture (typing, a paste, a fill, a
  row fill, a proposal taken, an insert, a removal, a move, a library drop,
  an inspector edit) is one undoable transaction, reported to `onPatch`.
- **SB26.** The history item shows the session's status (saving,
  confirming, conflict, refused, unknown, out of date), the issue count, Undo,
  Redo, Discard and Save. ⌘Z undoes and ⇧⌘Z or ⌘Y redoes from anywhere in
  the frame — the grid, a pane, the toolbar — never while typing in an input
  outside the grid's editor: a field being typed into keeps its own undo.
- **SB27.** Save is on when the batch is structurally complete, `ready`
  passes and there is a change. It sends one request through the record's
  patch mutation (SB16), or, over `data`, the host's `onApply` or `onUpdate`.
- **SB28.** A conflict or a refusal keeps every draft and shows its banner. A
  write with no answer leaves the session unknown: Save turns into Retry,
  which resends the same request, its id unchanged, and never a new one.
- **SB29.** After a commit the drafts retire once the rows read back as the
  commit left them (on a paged record, at the committed revision); until then
  the status is confirming. The rows are the commit's own: another write to
  the record's other rows meanwhile changes nothing. A row reads back as the
  commit left it once the record holds it otherwise than the edit began, with
  what the commit set in it — a field another write set beside those is the
  record's, and the session's version of that row goes, with the history over
  it, so the next edit begins from the record's. The record changing under
  pending drafts makes the session out of date: Save is off, a banner offers
  Discard, and nothing is rebased.
- **SB30.** Sessions live in the UI store by source, so a remount finds the
  drafts; with `entry` each entry keeps its own until Save or Discard.
- **SB31.** `applyMode: "auto"` sends each ready gesture as it lands, through
  the same protocol; Undo then commits the inverse.

### 9.7 The library pane (owner: the library pane)

- **SB32.** The library holds the tabs `library` lists, in its order, each
  with its count and a search. Collapsed, it is a rail with the templates'
  count, or with the first tab's when Rows isn't listed.
- **SB33.** Rows lists the templates by `group`: a card shows its name and
  what it sets, the cells as the columns print them, or a group template's
  line count.
- **SB34, SB35.** Retired (2026-10-05): the Registers tab is dropped.
- **SB36.** Columns lists the columns in declared order with their kind and
  an eye. Hiding a column hides it and the band cells under it from the grid,
  never from the inspector or what the lens matches; a row the copilot
  proposes keeps its cells under a hidden column. The last column shown
  stays. What is hidden persists per viewer under the sheet's `name`, and a
  sheet whose library lists no Columns tab hides none.
- **SB37.** An empty tab says so, in the shared empty state: `No templates`,
  `Nothing in Crews` for an author's tab with no rows, or `No matches` over
  `Nothing matches "q".`
- **SB59.** `library` is optional: left out, or `[]`, the sheet draws no
  start pane. A tab listed twice is refused at build, naming it.
- **SB60.** `Sheet.library.tab(rows, { name, icon, key, label, meta?,
  group?, drop? })` lists one card per row: its label and meta, the tab's
  icon, grouped by `group`, searched by key, label and meta, and, when the
  tab declares a `drop`, each a drag source (#1187); a key that repeats keeps
  its first card, as a register's members do. A click selects the card, and a click on the selected card lets
  it go. `drop`'s patch is checked at build: over the row type it lands on
  rows, over the group type on bands, and over any other type the build
  fails, naming the tab.

### 9.8 Drag and drop (owner: drag and drop)

As built (#1187). A sheet takes drops on its surface; a read-only sheet
registers no drop target and its rows have no grips.

- **SB38.** A drag starts after 4px. The ghost is what was picked up: the
  card, or for a grip the row's name (`line 3 of Doors, oak`, a group's
  title). A caption under it says where the drop lands (`after row 3`,
  `before line 2 of WO-2201 · Kitchen, oak`, `at the start of order 2`,
  `at the end`, `→ row 3`), or in red why it can't (`No new lines here`). The
  caption belongs to the drag layer, and any surface can give one for its
  cells. No row lights as a candidate. Where a template or a moved row would
  land, the 2px brand insertion line runs along the seam from the gutter's
  edge. The row a card lands on takes the brand wash, and a row that refuses
  the drop takes the invalid wash. The row under a drag takes no hover. The
  drag layer announces each drop; the footer adds nothing.
- **SB39.** A row template dropped on a row inserts its row at the seam the
  pointer's half picks, or at the end when dropped on the blank tail. The new
  row is selected, with its editor closed, and the insert is one `drop`
  transaction (`Undo Drop`). On a grouped sheet the template becomes a line:
  - beside a line, in that line's group;
  - at a group's start when dropped on its band, whatever the half (beside
    loose rows, a band's top half takes a loose row before the group);
  - at the group's end when dropped on its blank line.
  
  On a keyed record a new entry sits where its key sorts: the caption says
  `a new row · in key order`, and no seam lights. The row starts as the
  template: `newRow`'s seed with the template's fields over it. Refused when
  `edits.insertRows` is off.
- **SB40.** A group template snaps to the seam between entries nearest where
  it rests, as the seam's group chip does:
  - a band's top half is the seam above its group, and so is its bottom half
    unless the group shows no lines (folded or empty);
  - on a line, the nearer end of its group;
  - on a blank line, the seam below its group.
  
  It inserts the group with its lines, seeded as `newGroup` with the template
  over it; on a keyed record the group sits where its key sorts. Refused when
  `edits.insertGroups` is off, and on a flat sheet.
- **SB41, SB42, SB43.** Retired (2026-10-05): the Registers tab is dropped;
  SB61 takes their place.
- **SB44.** A grip leads each row's actions column: a 14px `grip-vertical`
  in the faintest ink, shown on the row's hover and always where nothing
  hovers, with a 32px halo on a coarse pointer. Only rows a move can place
  have one:
  - a flat or loose row, while its source keeps no key order and
    `edits.moveRows` isn't `none`;
  - a line, while `edits.moveRows` isn't `none`;
  - a band, while `edits.moveGroups` is on (off by default on a keyed
    record).
  
  The row a grip lifts takes a 1px brand ring. Where each kind of row lands:
  - **A line** lands beside another line by the pointer's half, at a group's
    start on its band, or at its end on its blank line. Under `between` it
    can move into another group, where it takes a key of that group's and
    keeps its draft. Under `within`, another group's seams refuse it (`Lines
    move only within batch 1`). Nothing outside the groups takes a line
    (`A line stays in a batch`).
  - **A group or a loose row** snaps to the seam between entries nearest
    where it rests, as a group template does.
  - **A row dropped where it already stands** stays put, and no transaction
    is made.
  
  Each move is one `move` transaction (`Undo Move`). For an entry, the batch
  carries its placement, `ordered(before | after | end)`; for a line, the
  groups' lines are rewritten, wire and draft side by side. The moved row is
  selected. Grips take the pointer only and have no tab stop: from the
  keyboard a card can be dropped, but a row can't be moved.
- **SB45.** ⏎ on a library card does what a drop below the ring's row would:
  a row template inserts after that row, a group template after its group (or
  after the loose row the ring is on), and an author's card sets its fields
  on that row. On a card that drags, ⏎ is the host's, and Space still picks
  the card up. Where the drop would be refused, the footer says why (`Drop
  onto a band`; on a read-only sheet, `The sheet is read only`). A drop
  anywhere else does nothing.
- **SB61.** A card from an author's tab lands on the row itself, not on a
  seam. Dropped on a row, it sets the fields its `drop` patch sets on that
  row, as one `drop` transaction, the way a template's values set a new
  row's. A patch over the group type lands on a band the same way. The row is
  selected on the first column the card sets, and the copilot is asked again
  when that column is a trigger. The ghost carries the card, captioned
  `→ row 3`. Refused:
  - anywhere but a row: `Drop onto a row`, or on a grouped sheet `Drop onto
    a line`;
  - anywhere but a band, for a group patch: `Drop onto a band`;
  - where a cell the card sets is one the sheet doesn't write: `Machine is
    read only here`. This is a guard at the host's seam, since a sheet's
    cards only set what the editable columns write.

### 9.9 The inspector (owner: the inspector)

- **SB46.** The inspector has two tabs, Details and Issues, Issues with its
  count. Collapsed, it is a rail with its icon, the issue count and the
  selected row's number.
- **SB47.** Details for one row or line: its number and id, a Pending or New
  chip, a lock when the row is owned, its issues, every field of its type
  through `Fields` (§5.3), its sub rows read only, then Duplicate and Delete.
  A line's id is its own where it has one (beside loose rows), else its
  group's.
- **SB48.** A link or set field shows its members resolved, and "Edit in
  sheet" puts the ring on that cell.
- **SB49.** For a group's band: the group's own fields, its line count and
  its issues, then Add line, Duplicate (with its lines) and Delete.
- **SB50.** For several rows: their count and a bulk edit (set a column
  across them, clear it, duplicate, delete), each one transaction. The
  column is one the form edits — never a stamped, a set or a link column,
  which the grid edits — and a select offers its register's every member, as
  no one row narrows them.
- **SB51.** With nothing selected: the counts (rows, pending, issues), the
  last commit and who made it, and three hints.
- **SB52.** An edit in the inspector is one transaction, as typing in the
  cell; a field the drafts changed is tinted against what the record holds,
  and the copilot is asked again when its column is a trigger.
- **SB53.** Issues lists every issue of the batch by row (incomplete and
  invalid fields, `ready`'s, a Save's conflicts and refusals), and a click
  selects its cell, seeking it on a paged sheet.
- **SB58.** `inspector={(row, update) => …}` (ruled 2026-10-05): an East
  function over the row — its own struct, a grouped sheet's line — and a
  writer of the edited row, passed through untouched. Details for a row whose
  draft is complete shows what it returns in place of the form; a row still
  missing a field, or holding one unreadable, shows the form until it is
  complete. `update(edited)` is one transaction: the fields the editable
  columns write go through their cells, as the grid writes them; a read-only
  column's field is left as it is; a field with no column is set on the draft.
- **SB62.** Nothing the inspector shows is read from the source until Details
  asks: a sheet with no inspector reads what it read before, and a row's
  entry is read once while the resident rows stand.
- **SB63.** The inspector is optional (#1216): given alone (`inspector`),
  Details shows the selected row's form; given a function, SB58; left out,
  the sheet draws no end pane, and `fields` and `groupFields` are refused at
  build.

### 9.10 Showcase and docs (owner: the Sheet builder's showcase and docs)

- **SB54.** The workshop (§3.3) runs on e3-web in the showcase with its
  records seeded, and Save commits to them.
- **SB55.** Responsive specs measure the frame, the toolbar's fold order at
  desktop and phone widths, both themes, the panes, a drop and a move.
- **SB56.** The e3-ui skill documents `<Sheet>` with tested examples, and the
  plugin indexes are regenerated.

### 9.11 Examples on bound sources (owner: the Sheet's examples on bound sources)

- **SB57.** Every Sheet example that shows data binds it from e3 (§2a): an
  `e3.input` or `e3.record` bound with `Data.bind`, `Data.bindPaged` or
  `Record.bind`, its writes through the record's patch mutation, and runs on
  e3-web in the showcase.

## 10. Drag and drop, as a table

| Drag | Onto | Does | Refused when |
|---|---|---|---|
| A row template | a row's seam by the pointer's half, or the blank tail; on a grouped sheet a line's seam, a band (its group's start) or a blank line (its end) | Inserts its row there, seeded by the template; on a keyed record a new entry sits where its key sorts (SB39) | `edits.insertRows` is off |
| A group template | the seam between entries nearest where it rests | Inserts the group with its lines (SB40) | `edits.insertGroups` is off; a flat sheet |
| An author's card | the row itself: a row or a line, or a band for a group patch | Sets the fields its `drop` patch sets (SB61) | anywhere else; a cell the sheet does not write |
| A row's or a line's grip | a line's seam, a band (its group's start), a blank line (its end); a flat row's seam, or the tail | Moves the row or line there (SB44) | `edits.moveRows` is `none`; `within` and the seam is in another group; a line outside the groups |
| A band's grip, or a loose row's | the seam between entries nearest where it rests | Moves the group or the loose row (SB44) | `edits.moveGroups` is off, as it is on a keyed record |
| Anything moved | where it already stands | Nothing, and no transaction | — |

It runs on the shared drag grammar (`LibraryRef`, `CellRef`) that Studio's
canvas and the Calendar use. A sheet `CellRef`'s `row` names the row the drag
rests on, as `printFor(SheetDropRowType)` (`drop.ts`) prints it:
- `row`: a flat or loose row's id;
- `line`: a group's id and the line's key;
- `band`: a group's id;
- `groupEnd`: a group's blank line;
- `end`: the blank tail.

Its `slot` is the seam the pointer's half picks, `before` or `after`, or `""`
for an author's card, which lands on the row itself. Every drop is planned
from the rows as they stand (`planDrop`). The veto, the caption, the
announcement and the drop all read the same plan, and the plan is decided
before anything is drawn or written.

## 11. What changes from today's sheet, and what is lost

| Today | `<Sheet>` | Why, and what is lost |
|---|---|---|
| A sheet with no chrome around it | The sheet in its frame, its panes optional props (#1216) | A component has one form. A sheet with no pane is its toolbar, its grid and its footer. |
| A sheet that grows with its content (the in-flow mode, #856) | A sheet fills the box it is given and scrolls its own rows (#1216) | A host gives the sheet a box of its own height. |
| The sheet's own toolbar row | The frame's one toolbar | A component has one toolbar. Nothing is lost. |
| The history bar's error line under its buttons | A banner | The toolbar keeps one row. Nothing is lost. |
| Any source: an inline array, `State`, a paged source, a custom `onApply` | A record, or `data` (#1216) | Nothing is lost. |
| Rows in the planner's order over an inline array | Over a record, entries in key order, or one entry's rows | A record is keyed; `entry` keeps the planner's order, and `data` the host's. |
| `views` and `onViewsChange` | A bind handle | One prop, on every sheet (#1216). |
| Moves declared but no gesture | Drag to move | New. |
| No library, no inspector | The author's library (Rows, Columns and their own tabs); Details · Issues | New. |
| The first design's Registers tab: every register's members, a click narrowing the sheet | Dropped (2026-10-05) | Registers stay what the cells pick from. The slice's search narrows the sheet by a member, as it always could, and an author lists a register they want to drag from as a tab of their own. |

## 12. Wires

- **UI.** east-ui's `Sheet` arm leaves `UIComponentType`; packages are
  re-exported (`WIRE_MIGRATION.md`). `<Sheet>` rides one `EastUI.component`
  carrier, `Sheet` (#1216), as Studio's builder rides `StudioBuilder`.
- **Stored state.** None new: the records are the app's own types, and
  `Sheet.Types.View` and `Sheet.Types.Link` don't change.

## 13. The Sheet's sub-issues, in landing order

1. The specs (this file and `Plan Builder Spec.md`).
2. The Sheet moves to e3: its IR to e3-ui and its renderer to e3-ui-components.
3. The Sheet's examples on bound sources.
4. The Sheet renderer's parts.
5. Rows from a record.
6. The builder's types and factories.
7. The frame and the toolbar.
8. The library pane.
9. `Fields` (#1147, the Calendar's), built here first.
10. The inspector.
11. Editing, undo and Save.
12. Drag and drop.
13. The showcase on e3-web, the skill and examples.
14. One Sheet: `<Sheet>` in its frame, its panes optional props (#1216).

The frame, the library, `Fields` and the inspector are pushed together, so the
builder first appears with both panes full of the examples' seeded records.
