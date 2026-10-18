# Allocation — design

The e3-ui `Allocation`: a day's arriving events booked into timed lane slots,
and each booked bin allocated to a resource that holds it for its hold. The
same plan is edited as a **Timeline** (lane grid · link channel · resource
timeline) or as a **Table** of slots, over the same drafts. It is laid out in
`BuilderFrame` as the Roster, the Calendar, Plan and the Sheet are, with
desktop drag and drop and explicit narrow actions, and its links are Plan's.

This document is the design the Allocation epic builds. `Allocation Spec.html`
beside it is the visual and interactive design: **its behaviour, its anatomy and
its drag grammar are the authority**, and this document transcribes all of them.
Only the rulings in §2 change what the mock does; §14 lists each change. Each
sub-issue copies the sections and rules it owns.

## 0. The files

| File | What it is |
|---|---|
| `Allocation Spec.html` | The interactive design: two live boards (01 Timeline, 02 Table) over one plan day, self-contained (React, Font Awesome and the fonts are inside the bundle). Its sample data is a timber drying yard, generated. |
| `Allocation Spec.png`, `Allocation Spec - timeline.png`, `- table.png`, `- dark.png` | Resting renders for people browsing the repo. They are generated from the mock and never read by an agent. |
| `Allocation Spec.md` | This design. |

**Opening the mock.** Open the file in a browser; both boards are live. Each
board is its own copy: drafts made in one don't show in the other. The plan day
is **Tue 11 May 2027**; the resource axis runs Fri 7 to Thu 20. An agent
measures the mock in a headless browser, through its DOM; nobody reads a
screenshot.

**The yard.** Three unloading bays (B-1 at :15, B-2 at :35, B-3 at :55 past each
hour; B-1 and B-2 in the North area, B-3 in the South); 33 kilns in six groups (Hall A K-101…K-110, Hall B K-201…K-209, Compact
K-301…K-305, Standard K-401…K-403, Large K-501…K-504, Bulk K-601…K-602); 26
bins in 18 slots (80 Table rows: 26 bins and 54 free slots); six loads still to
book (LD-2231…LD-2236); quantities in m³; holds (drying days) 6, 8 or 9 by grade
family (U, R, P). Every name and figure is generated.

**Worked facts, from the mock's own functions.** At open: K-207 is over max
(44 m³ · max 40 · 4 over); K-105 and K-301 hold into their next charge; K-503 and
K-504 are busy (until Fri 14, Sat 15). LD-2232 (30 m³), LD-2233 (26) and LD-2234
(18) each have one fit, K-601, under its 40 m³ minimum. LD-2235 (8 m³) fits
#1 K-305 and #2 K-601. LD-2236 (11 m³) fits K-107, K-103 and K-601, all under
min. LD-2231 (21 m³, overdue) fits #1 K-107 and #2 K-601. Bin 3113 (LD-2210,
32 m³ on K-108) fits K-103 and K-601; 30 kilns refuse it. The day's first free
slot is B-1 00:15.

## 1. Summary

- **What.** `<Allocation>` books arriving events into timed lane slots and
  allocates each bin to a resource with room and time for its hold.
- **Where.** The tag, its types and its pure functions in e3-ui
  (`libs/east-ui/packages/e3-ui/src/allocation/`); the renderer in
  e3-ui-components (`src/allocation/`). It binds records, so it is an e3
  component.
- **Slots.**
  - The plans: one record keyed by UTC day, in the component's own types,
    generic over the app's bin values (`Allocation.Types.Days(V)`), bound with
    its patch mutation.
  - Events and resources: the app's own keyed data, read through accessors.
  - The fit: the app's `e3.function`, bound with `Func.bind`.
- **Draws.** `BuilderFrame`: one toolbar; the Library (Events · Resources) in
  the start pane; the Timeline or the Table in main; the Inspector (Details ·
  Issues) in the end pane; a footer with only the layout's legend.
- **Built in.** Drag and drop of bins, connectors, links and library cards;
  the chooser; issues with their fixes; Find a fit; split loads; undo and
  redo, Save and Publish; the narrow layout. The app wires none of it.

## 2. Decisions

These are settled.

1. **`Allocation` is in e3-ui**, record-bound like the Roster, Studio, the
   query builder and the Calendar. BuilderFrame is internal to the renderer.
2. **The plans are one record keyed by UTC day**, `Allocation.Types.Days(V)`.
   A day is one entry, so one Save writes a day's bins, parts and status
   together. Each day keeps its own drafts while the viewer moves between days.
3. **Bins carry the app's own values**, `V`: a struct the app declares (the
   yard's booked and measured moisture and grade). The app shows them in a
   Table column and the inspector, and flags mismatches through `check`.
   *(Ruled 17 Oct.)*
4. **Events and resources are the app's keyed data**, read through accessors.
   The board never writes them. `resources` is complete: fits, checks and
   totals read all of it, whatever the narrowing hides.
5. **The fit is the app's.** `fit` is an `e3.function` bound with `Func.bind`
   that returns a verdict for every resource; the renderer computes no fit of
   its own. `Allocation.fit` and `Allocation.candidates` are pure East parts
   for that function. *(Ruled 17 Oct.)* The Roster's Find fixes move onto the
   same contract in this epic (§13). *(Ruled 17 Oct.)* A `take` also answers
   each event the plan has not booked, on its resource: the Table's event
   Chooser (A48) and a reservation's Book list (A61) are one question each.
   *(Ruled 17 Oct.)*
6. **Issues never block Save or Publish.** What the fit refuses never becomes
   a draft; everything else is a warning with its fix. *(Ruled 17 Oct.)*
7. **Publish** sets the day's status, as the Roster's Publish sets a week's; a
   published day is read-only. `publish={false}` removes the step. *(Ruled 17 Oct.)*
8. **One record Slice narrows the lanes and the resources**, in the Timeline and
   the Table alike, from one rail: `Slice.bindRecords` over the lanes' and the
   resources' records, each source named after what it narrows. The board reads
   the narrowing from the slice it is given; no prop repeats it (§9.15). *(Ruled
   17 Oct, superseding "the Table is never narrowed".)*
9. **Split loads.** A bin's quantity may be split across resources, each part
   with its quantity. *(Ruled 17 Oct.)*
10. **Find a fit** runs the app's fit for a bin's unallocated quantity and
    narrows the Library's Resources tab to the fits. *(Ruled 17 Oct.)*
11. **Links are Plan's** (`Plan links.html` with the user's overrides): they
    cross neighbouring cards, cased in paper, and end out of view in Plan's
    stub. *(Ruled 17 Oct.)*
12. **Under min warns, never blocks** (review 4.1). **Booking onto a resource
    takes the plan day's first free slot**, never the computer's clock (review
    4.2).
13. **No toasts, no dialogs.** Every picker, edit and confirmation is an
    anchored popover; Discard is the history item's.
14. **Times are UTC as stored**, as the Roster's, the Calendar's and Plan's are.
15. **Sample data is a timber drying yard**, generated; nothing names a real
    business, its trade or its people, in the mock, the examples, the showcase
    or the tests.
16. **Every component definition is inline in its example**, as the e3-ui
    guide requires.

## 3. The authoring surface

### 3.1 The records and the fit an app declares

Kilns and loads are the app's own, kept as its other systems keep them; the
board only reads them. The plans record takes the component's own type over the
app's bin values, as a Studio app's pages record takes `Studio.Types.Pages`. The
fit is an `e3.function`, so it runs on e3 (or e3-web in a browser), never in the
renderer.

```tsx
// kiln-yard.tsx — module-level e3 units, types and seeds; every UI definition stays inline in its example.
/** @jsxImportSource @elaraai/e3-ui */
import { ArrayType, DateTimeType, DictType, East, FloatType, OptionType, StringType, StructType, example, none, some, variant } from "@elaraai/east";
import { Box, Reactive, Slice, TimeStepType, UIComponentType } from "@elaraai/east-ui";
import { Allocation, Data, Func, Record } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";
import { yardArrivals, yardBayRows, yardKilns, yardPlans } from "./kiln-yard-data.js";

/** What each bin carries of the yard's own: the moisture target and grade booked, and as measured on arrival. */
export const BinValues = StructType({
    specBooked: StringType, specMeasured: StringType,
    gradeBooked: StringType, gradeMeasured: StringType,
    instruction: OptionType(StringType),
});
/** A drying kiln. */
export const Kiln = StructType({
    name: StringType, group: StringType, min: FloatType, max: FloatType,
    days: FloatType,                                 // the days it usually dries for: a reservation's hold
    note: OptionType(StringType),                    // a line about its next charge
    charges: ArrayType(Allocation.Types.Job),        // the charge drying now, and the next one planned
});
/** A load of sawn timber on its way from a mill. */
export const TimberLoad = StructType({
    code: StringType, mill: StringType, spec: StringType, grade: StringType,
    m3: FloatType, dryingDays: FloatType, due: DateTimeType, from: DateTimeType, to: DateTimeType,
    schedule: StringType,                            // the kiln schedule it dries on
    instruction: OptionType(StringType),             // its loading instruction
});

// The plans the board edits: one per UTC day, each patched as a whole.
export const kilnPlans = e3.record("kiln_plans", Allocation.Types.Days(BinValues), yardPlans);
export const kilnPlansPatch = e3.mutation.patch(kilnPlans);
// The kilns, indexed by group for the narrowing.
export const kilns = e3.record("kilns", DictType(StringType, Kiln), yardKilns);
export const kilnsByGroup = e3.recordIndex("kilns_by_group", kilns, { on: ["group"] });
// Every load the day may book: booked or not, the board tells them apart by the plan.
export const arrivals = e3.record("arrivals", DictType(StringType, TimberLoad), yardArrivals);
/** An unloading bay: its name, the yard area it stands in, and how far past each hour it takes its bin. */
export const Bay = StructType({ name: StringType, area: StringType, offset: TimeStepType });
// The unloading bays, by key: each takes one bin an hour, at its offset past the hour; indexed by area for the narrowing.
export const yardBays = e3.record("yard_bays", DictType(StringType, Bay), yardBayRows);
export const yardBaysByArea = e3.recordIndex("yard_bays_by_area", yardBays, { on: ["area"] });

// The yard's fit, on e3: the built-in rules (busy, gap too short, over max; under min warns),
// then a greedy look-ahead — a fit that leaves more of the day's unbooked loads with nowhere to go ranks lower.
export const yardFit = e3.function("yard_fit", East.function(
    [Allocation.Types.FitRequest(BinValues)], Allocation.Types.FitResult, ($, req) => {
        const answer = $.const(Allocation.answer(BinValues));
        const rule = $.const(Allocation.fit);
        const ahead = $.const(Allocation.lookahead(BinValues));
        return answer(req, East.function([Allocation.Types.Candidate], Allocation.Types.Fit, ($2, c) => ahead(req, c, rule)),
            "ranked by load, kind and spare days, and what it leaves for the day's other loads");
    }));
```

`Allocation.answer` builds the candidates for the request and maps a
per-candidate fit over them, with the app's words for how its fit ranks (the
answer's `basis`); `Allocation.fit` is the built-in rule set (§12);
`Allocation.lookahead` is a pure greedy best-fit-decreasing pass: it places the
candidate, then the day's unbooked events largest first, each on its best
fitting resource, and lowers the score by one for each event left with no fit,
adding `· leaves 1 load with no fit` to `why`. All three are ordinary East
functions an app may call, replace or ignore. Those over a plan take the plans'
bin values type, as `Editing.apply` takes its source type —
`Allocation.answer(BinValues)` is an East function over
`Allocation.Types.FitRequest(BinValues)` — because an East function has one
type; `Allocation.fit` reads one candidate and needs none.

### 3.2 The smallest board

```tsx
export const allocationMinimal = example({
    description: "The smallest board: one plan per day, the bays, the loads and the kilns, and the yard's fit on e3. No library and no inspector; every gesture is still a draft until Save.",
    keywords: ["Allocation", "Record.bind", "Func.bind", "e3.function", "fit", "BuilderFrame", "Save"], inputs: [],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const days = $.let(Record.bind(kilnPlans, [kilnPlansPatch]));
        const loads = $.let(Data.bind(arrivals));
        const yard = $.let(Data.bind(kilns));
        const bays = $.let(Data.bind(yardBays));
        const fit = $.let(Func.bind(yardFit));
        return <Box width="100%" height="760px"><Allocation id="allocationMinimal" days={days} fit={fit}
            lanes={Allocation.lanes(bays.read(), { label: b => b.name, offset: b => b.offset })}
            events={Allocation.events(loads.read(), { label: l => l.code, quantity: l => l.m3, hold: l => variant("days", l.dryingDays),
                values: l => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade.substring(0n, 1n), gradeMeasured: l.grade, instruction: l.instruction }) })}
            resources={Allocation.resources(yard.read(), { label: k => k.name, min: k => k.min, max: k => k.max, jobs: k => k.charges })}
            quantity={{ unit: "m³" }} view={{ date: new Date("2027-05-11T00:00:00Z") }} />
        </Box>;
    }}</Reactive>),
});
```

Five props and the values an event gives a new bin make a working board:
`days`, `lanes`, `events`, `resources` and `fit`. `values` is reified at the
plans' bin values, so an event can only start a bin the plans hold; a
reservation's values are `V`'s default (East's `defaultValue`), as the mock's
reservations are blank. Cards drag between bay hours, the
connector links, every gesture is one undo step, and Save patches the open day.

### 3.3 The kiln yard

The mock's surface: the library and the inspector, the bays narrowed by area and
the kilns by group from one rail over both records, the bin values shown as the Table's Spec and Grade columns
and the inspector's rows, and the yard's check flagging a booked ≠ measured
mismatch, as the mock's Spec mismatch group does.

```tsx
export const allocationKilnYard = example({
    description: "The kiln yard's board: 33 kilns and the day's loads, the Events and Resources library, the inspector, the bays narrowed by area and the kilns by group from one rail over both records, the bin values as columns, a yard check, and the yard's greedy fit on e3.",
    keywords: ["Allocation", "Record.bind", "Data.bindPaged", "Slice.bindRecords", "Allocation.lanes", "Func.bind", "fit", "links", "Publish"], inputs: [],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const days = $.let(Record.bind(kilnPlans, [kilnPlansPatch]));
        const history = $.let(Data.bindPaged(kilnPlans));
        // Every bay and kiln is the calculation scope; the narrowing only chooses which show.
        const yard = $.let(Data.bind(kilns));
        const bayIndex = $.let(Data.bindPaged(yardBays, { indexes: [yardBaysByArea] }));
        const kilnIndex = $.let(Data.bindPaged(kilns, { indexes: [kilnsByGroup] }));
        const slice = $.let(Slice.bindRecords("ex.allocationKilnYard", {
            lanes: { source: bayIndex, fields: { area: { label: "Area", hints: ["North", "South"] } } },
            resources: { source: kilnIndex, fields: { group: { label: "Kiln group", hints: ["Hall A", "Hall B", "Compact", "Standard", "Large", "Bulk"] } } },
        }, {
            presets: [
                { id: "halls", name: "Halls", where: { resources: { group: ["Hall A", "Hall B"] } } },
                { id: "small", name: "Compact and standard", where: { resources: { group: ["Compact", "Standard"] } } },
                { id: "large", name: "Large and bulk", where: { resources: { group: ["Large", "Bulk"] } } },
                { id: "north", name: "North bays, halls", where: { lanes: { area: ["North"] }, resources: { group: ["Hall A", "Hall B"] } } },
            ],
        }));
        const loads = $.let(Data.bind(arrivals));
        const bays = $.let(Data.bind(yardBays));
        const fit = $.let(Func.bind(yardFit));
        // The yard's check: a bin measured off its booked moisture target is flagged, never refused.
        const check = $.const(East.function([Allocation.Types.CheckContext(BinValues)], ArrayType(Allocation.Types.Issue), ($2, cx) => {
            const issues = $2.let([], ArrayType(Allocation.Types.Issue));
            $2.for(cx.plan.bins, ($3, bin, id) => {
                $3.match(bin.event, { some: ($4, code) => {
                    $4.if(East.notEqual(bin.values.specBooked, bin.values.specMeasured), $5 => {
                        $5(issues.pushLast({ kind: variant("custom", "Spec mismatch"), tone: variant("neutral", null),
                            title: East.str`${code} · bin ${id}`,
                            detail: East.str`Spec booked ${bin.values.specBooked} · measured ${bin.values.specMeasured} · ${bin.lane} ${bin.at.printFormatted("HH:mm")}`,
                            bin: some(id), resource: none, flag: some("≠ spec"), fix: none }));
                    });
                } });
            });
            return issues;
        }));
        return <Box width="100%" height="900px"><Allocation id="allocationKilnYard" title="Kiln loading" days={days} window={history}
            lanes={Allocation.lanes(bays.read(), { label: b => b.name, offset: b => b.offset })} fit={fit} check={check}
            events={Allocation.events(loads.read(), {
                label: l => l.code, meta: l => some(East.str`${l.mill} · ${l.grade} · spec ${l.spec}`),
                quantity: l => l.m3, hold: l => variant("days", l.dryingDays), kind: l => some(l.spec),
                due: l => some(l.due), window: l => some({ from: l.from, to: l.to }),
                details: l => [{ label: "Settings", value: l.schedule }],
                values: l => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade.substring(0n, 1n), gradeMeasured: l.grade, instruction: l.instruction }),
            })}
            resources={Allocation.resources(yard.read(), {
                label: k => k.name, group: k => some(k.group), meta: k => some(East.str`${k.group} · ${East.Float.roundHalf(k.max)} m³`), note: k => k.note,
                min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges,
            })}
            columns={[
                { key: "spec", label: "Spec", text: v => East.equal(v.specBooked, v.specMeasured).ifElse(() => v.specMeasured, () => East.str`booked ${v.specBooked} · measured ${v.specMeasured}`),
                    tone: v => East.equal(v.specBooked, v.specMeasured).ifElse(() => none, () => some(variant("warning", null))) },
                { key: "grade", label: "Grade", text: v => v.gradeMeasured.startsWith(v.gradeBooked).ifElse(() => v.gradeMeasured, () => East.str`booked ${v.gradeBooked} · measured ${v.gradeMeasured}`), table: false },
                { key: "instruction", label: "Instruction", text: v => v.instruction.unwrap("some", () => "none"), table: false },
            ]}
            slice={{ slice }}
            quantity={{ unit: "m³" }}
            library={[Allocation.library.events(), Allocation.library.resources()]} inspector
            view={{ layout: "timeline", date: new Date("2027-05-11T00:00:00Z") }} />
        </Box>;
    }}</Reactive>),
});
```

### 3.4 The example set

As the Roster's: every example defines its board inline over the same module
records, and each is paired with its behavioural tests.

| Example | Shows |
|---|---|
| `allocationMinimal` | §3.2. |
| `allocationKilnYard` | §3.3, Timeline. |
| `allocationTable` | The same, `view={{ layout: "table" }}`. |
| `allocationPublished` | A published day (Tue 4 May): read-only; navigation, narrowing, focus, links and the inspector still work. |
| `allocationNoPublish` | `publish={false}`: no status chip, no Publish. |
| `allocationSplit` | A day with loads split across kilns (Wed 12 May): parts, an unallocated remainder, its issue and its links. |
| `allocationWindowed` | Two years of plans, `window={Data.bindPaged(plans)}`: navigation reads the active day and the open picker's month only. |
| `allocationMobile` | The kiln yard in a 390px container: explicit-action cards, no drag. |
| `allocationCustomBin` | `inspector={{ bin }}`: a typed bin form in place of the built-in quantity and values rows. |
| `allocationFitRule` | The ready-made fit with one yard rule over it, as an e3.function (a bulk kiln takes loads of 20 m³ and more). |

## 4. The options

### 4.1 `Allocation.events(rows, config)`, `Allocation.lanes(rows, config)` and `Allocation.resources(rows, config)`

Any `Dict<String, R>` of the app's, usually a record's `read()`, with accessors
that take the row and its key, `(row, key) => …`, reified once into one East
function, as `Roster.people` does.

| `events` accessor | Returns | What it gives the board |
|---|---|---|
| `label` | `String` | The event's code on cards, chips, captions and lists (`LD-2231`). Required. |
| `quantity` | `Float` | Its quantity, booked whole unless split. Required. |
| `hold` | `Duration` | How long a resource holds it (`variant("days", 8)`). Required. |
| `values` | `V` | What a new bin of it starts with. Required. |
| `kind` | `Option<String>` | What makes two events go together: a resource already holding the same kind ranks higher in `Allocation.fit` (+0.25), one holding only other kinds lower (−0.1). |
| `meta` | `Option<String>` | The card's second line and the Table chip's tail (`RDG · R2 · spec MC12`). |
| `due` | `Option<DateTime>` | Overdue when before the plan day (the Library's Overdue group, the warning on its ready line). |
| `window` | `Option<{ from, to }>` | Its ready window, on its card (`due Wed 12 · window Tue–Fri`). |
| `details` | `Array<{ label, value }>` | Read-only lines in a bin's inspector (Settings). |

| `lanes` accessor | Returns | What it gives the board |
|---|---|---|
| `label` | `String` | Its name in its head and every line that names it (`B-1`). Required. |
| `offset` | `Duration`, none by default | How far past each slot's start its bins are booked (`variant("minutes", 15)`). |

The lanes are the rows in key order, each keyed by its row's key: a
`Slice.bindRecords` source named `lanes` over the same record narrows them.

| `resources` accessor | Returns | What it gives the board |
|---|---|---|
| `label` | `String` | Its name (`K-203`). Required. |
| `min`, `max` | `Float` | Its range in the quantity's unit. Required. |
| `group` | `Option<String>` | Its group: its row's line, the Library, the narrowing's field when indexed. |
| `meta` | `Option<String>` | Its free line (`Hall B · 40 m³`). |
| `note` | `Option<String>` | A line about its next job, after the inspector's next fill (`the plan had this charge on Wed 12`). |
| `hold` | `Duration`, no time by default | How long a reservation on it is checked for, and how long it is held when it holds only reservations: the mock's kiln hold. |
| `jobs` | `Array<Job>` | Other work on it: a job covering the plan day's start makes it busy, until it ends; the first starting after the day's start is its next job, a short gap when a hold runs past it. |

### 4.2 `Allocation` props

| Prop | Takes | What it does |
|---|---|---|
| `days` | `Record.bind(plans, [plansPatch])` | What the board reads and saves through, a day an entry. |
| `window` | `Data.bindPaged(plans)` | Reads a day at a time by key seek, for a long history; it must page the same record with no index. |
| `lanes` | `Allocation.lanes(…)`, or `Array<Allocation.Types.Lane>` | The lanes, in order; nonempty, refused at build otherwise. |
| `every` | `Duration`, default `hours 1` | Slot spacing for every lane. |
| `events` | `Allocation.events(…)` | Every event the day may book. |
| `resources` | `Allocation.resources(…)` | Complete. |
| `fit` | `Func.bind(e3.function)` over `[Allocation.Types.FitRequest(V)] → Allocation.Types.FitResult` | The fit (§12). Required: the board has no fit of its own. |
| `check` | `Fn(Allocation.Types.CheckContext(V)) → Array<Issue>` | The app's issues, wherever issues show. |
| `columns` | `Array<{ key, label, text: Fn(V) → String, tone?: Fn(V) → Option<StatusToken>, table?: boolean }>` | The bin values as Table columns (after Quantity) and inspector rows (the Bin section); `table: false` shows a value in the inspector only. |
| `slice` | `{ slice: Slice.bindRecords(key, { lanes, resources }), affordances?, persist? }` | The narrowing: one rail over the lanes' and the resources' records, in both layouts. The board reads each source's narrowed keys itself (§9.15); its sources are named `lanes` and `resources`, and a bare `Slice.bindRecord` or a local Slice is refused at build. |
| `quantity` | `{ unit?: string }` | The unit everywhere a quantity shows. |
| `rules` | `{ under?: Boolean }` | Whether `Allocation.fit` and `Allocation.check` warn under min (true). |
| `library` | `[Allocation.library.events(), Allocation.library.resources()]` | Tabs, in order; omitted, no start pane. |
| `inspector` | `boolean` or `{ bin?: Fn(Bin(V), Fn(Bin(V)) → Null) → UI }` | The end pane; a typed bin form replaces the quantity field and the values rows. |
| `view` | `{ layout?: "timeline" \| "table"; date?: DateTime }` | The first view, then persisted under `id`. Today's date by default. |
| `horizon` | `{ before?: Duration; after?: Duration }`, default days 3 and 10 | The Timeline's resource axis around the day. |
| `title` | `string`, default `"Allocation"` | The summary's heading. |
| `publish` | `boolean`, default `true` | The status chip and Publish. |
| `readOnly` | `Boolean` | No edits; a published day is always read-only. |
| `id` | `string` | Storage keys and drag-source ids when a surface holds two. |

## 5. The East types

### 5.1 `Allocation.Types`

```ts
Allocation.Types.Lane         = StructType({ key: StringType, label: StringType, offset: TimeStepType });     // takes one bin each `every`, at `offset` past it
Allocation.Types.Bin(V)       = StructType({
    lane:     StringType,
    at:       DateTimeType,                                  // the bin time; a batch's bins follow one minute apart
    event:    OptionType(StringType),                        // none: a reservation
    quantity: FloatType,                                     // 0 for a reservation
    kind:     OptionType(StringType),                        // what it goes with: its event's kind when booked
    hold:     TimeStepType,                                  // how long a resource holds it: its event's hold when booked
    parts:    DictType(StringType, FloatType),               // the quantity on each resource, by key; empty: not linked
    values:   V,                                             // the app's; V's default for a reservation
});
Allocation.Types.Status       = VariantType({ draft: NullType, published: StructType({ at: DateTimeType }) });
Allocation.Types.Day(V)       = StructType({ status: Status, bins: DictType(StringType, Bin(V)) });
Allocation.Types.Days(V)      = DictType(DateTimeType, Day(V));                                               // keyed by UTC midnight

Allocation.Types.Job          = StructType({ label: StringType, start: DateTimeType, end: DateTimeType });
Allocation.Types.Event        = StructType({ key: StringType, label: StringType, meta: OptionType(StringType), quantity: FloatType, hold: TimeStepType, kind: OptionType(StringType),
                                             due: OptionType(DateTimeType), window: OptionType(StructType({ from: DateTimeType, to: DateTimeType })),
                                             details: ArrayType(StructType({ label: StringType, value: StringType })) });
Allocation.Types.Resource     = StructType({ key: StringType, label: StringType, group: OptionType(StringType), meta: OptionType(StringType),
                                             note: OptionType(StringType), min: FloatType, max: FloatType,
                                             hold: TimeStepType,     // a reservation's hold; a resource holding only reservations holds for it
                                             jobs: ArrayType(Job) });
Allocation.Types.Rules        = StructType({ under: BooleanType });
Allocation.Types.Context      = StructType({ lanes: ArrayType(Lane), every: TimeStepType, events: DictType(StringType, Event),
                                             resources: DictType(StringType, Resource), rules: Rules, unit: StringType });

Allocation.Types.Load         = StructType({ resource: StringType, fill: FloatType, bins: IntegerType,
                                             hold: OptionType(StructType({ from: DateTimeType, to: DateTimeType })),   // the day for its longest bin's hold
                                             state: VariantType({ free: NullType, loading: NullType, busy: NullType }) });
Allocation.Types.Candidate    = StructType({ day: DateTimeType, bin: OptionType(StringType), reserve: BooleanType, quantity: FloatType,
                                             event: OptionType(Event), kind: OptionType(StringType), resource: Resource, load: Load,
                                             after: FloatType, hold: StructType({ from: DateTimeType, to: DateTimeType }),
                                             spare: OptionType(FloatType), kindMates: BooleanType, otherMates: BooleanType,
                                             rules: Rules, unit: StringType });
// bin: the bin it is for (none for an event not yet booked, and a new reservation); reserve: it reserves a slot, checked
// with no quantity and refused when the resource is full; kind: its own; rules and unit: what the rules warn and write by
Allocation.Types.Refusal      = StructType({ group: StringType, reason: StringType,
                                             measure: VariantType({ none: NullType,
                                                 amount: StructType({ lead: StringType, value: FloatType }),
                                                 day: StructType({ lead: StringType, at: DateTimeType }) }) });
Allocation.Types.Fit          = Schedule.Types.Fit;          // fits { score, why, warn: Option<String> } | refused Refusal — shared with the Roster
Allocation.Types.FitAsk       = VariantType({
    place: StructType({ subject: VariantType({ bin: StringType, event: StringType }), quantity: FloatType }),   // → a verdict per resource
    take:  StructType({ resource: StringType }),                                                               // → a verdict per bin, and one to reserve
});
Allocation.Types.FitRequest(V) = StructType({ day: DateTimeType, plan: Day(V), ask: FitAsk, context: Context });
Allocation.Types.FitResult    = StructType({ ask: FitAsk, resources: DictType(StringType, Fit), bins: DictType(StringType, Fit),
                                             events: DictType(StringType, Fit),   // a take's: each event the plan has not booked, on its resource
                                             reserve: OptionType(Fit),
                                             basis: StringType });   // how the fits are ranked, in words: the drop list's meta (A34)

Allocation.Types.Issue        = StructType({
    kind:     VariantType({ unlinked: NullType, unallocated: NullType, over: NullType, under: NullType, overlap: NullType, custom: StringType }),
    tone:     StatusTokenType, title: StringType, detail: StringType,
    bin:      OptionType(StringType), resource: OptionType(StringType),
    flag:     OptionType(StringType),                        // the card's short mark
    fix:      OptionType(Fix),
});
Allocation.Types.Fix          = VariantType({ choose: NullType, move: StringType, find: NullType });
Allocation.Types.CheckContext(V) = StructType({ day: DateTimeType, plan: Day(V), context: Context, loads: DictType(StringType, Load) });
Allocation.Types.Slot         = StructType({ lane: StringType, at: DateTimeType, status: VariantType({ free: NullType, booked: NullType, reserved: NullType }),
                                             bins: ArrayType(StringType) });
Allocation.Types.Layout       = VariantType({ timeline: NullType, table: NullType });

// Each over a plan takes the plans' bin values type and returns its East function, as Editing.apply(Type) does:
Allocation.loads(V)      : (DateTime, Day(V), Context) → Dict<String, Load>
Allocation.candidates(V) : (FitRequest(V)) → Array<Candidate>      // place: one per resource; take: one per bin, one per event not booked, and one for an empty slot
Allocation.fit           : (Candidate) → Fit                       // the built-in rules (§12)
Allocation.answer(V)     : (FitRequest(V), Fn(Candidate) → Fit, String) → FitResult   // the String: the answer's basis, the app's words
Allocation.lookahead(V)  : (FitRequest(V), Candidate, Fn(Candidate) → Fit) → Fit
Allocation.check(V)      : (DateTime, Day(V), Context) → Array<Issue>
Allocation.slots(V)      : (DateTime, Day(V), Context) → Array<Slot>
```

A bin keeps what it was booked with: its kind and its hold come from its event
when it is booked, as its values do, and stay with it when it moves, as the
mock's bins carry theirs — so a delivery measured on arrival can differ from
its event, and the mock's committed bins, whose holds it seeds from their kiln,
keep exactly the holds the worked facts are figured from. `Allocation.events`
returns a declaration the tag resolves at the plans' `V`: a values literal
carries no East type of its own. `Allocation.place` is not built: a new bin of
an event needs the app's values, which a request does not carry, and the
look-ahead places onto loads alone.

A type constructor such as `Allocation.Types.Days(V)` returns the same East type
for the same `V` (`isTypeEqual`), so a record declared once matches the board's
props and the fit's request. A board whose `fit` was bound over a different
`V` than its `days` is refused at build, naming both types.

### 5.2 The payload

```ts
AllocationPayloadType = StructType({
    sourceId: StringType,
    read: FunctionType([], BlobType),                                               // the plans, as bytes at Days(V)
    apply: AsyncFunctionType([BlobType], Editing.Types.ApplyResult),               // a day's ChangeSet(Day(V), DateTime), as bytes
    window: OptionType(DataPagedHandleType(BlobType)), valuesType: EastTypeType,   // Data.bindPaged(plans), its windows as bytes at Days(V)
    lanes: ArrayType(Lane), every: TimeStepType, events: ArrayType(Event), resources: ArrayType(Resource), initial: FunctionType([StringType], BlobType),
    narrowed: StructType({ lanes: OptionType(RowSourceType(ArrayType(StringType))), resources: OptionType(RowSourceType(ArrayType(StringType))) }),   // each source's keys, from slice
    fit: FuncBindingType, check: OptionType(FunctionType([BlobType], ArrayType(Issue))),
    columns: ArrayType(StructType({ key: StringType, label: StringType, text: FunctionType([BlobType], StringType),
                                    tone: OptionType(FunctionType([BlobType], OptionType(StatusTokenType))), table: BooleanType })),
    rules: Rules, quantity: StructType({ unit: OptionType(StringType) }),
    library: ArrayType(AllocationLibraryTabType), inspector: OptionType(AllocationInspectorType),
    slice: OptionType(RecordSlicesChromeType),                                       // Slice.bindRecords' chrome: one rail over every source
    settings: StructType({ layout: Layout, date: OptionType(DateTimeType), horizon: StructType({ before: TimeStepType, after: TimeStepType }),
                           title: StringType, publish: BooleanType, readOnly: BooleanType }),
    id: OptionType(StringType),
});
AllocationComponent = EastUI.component("Allocation", AllocationPayloadType, { optional: true });
```

The app's `V` crosses the closed payload as beast2 bytes, as Schedule's event
kinds' rows do: `initial` encodes an event's starting values, and `check` and the
columns' accessors decode them. The tag only validates, reifies the accessors
once and assembles; it composes no East UI component and emits no layout,
session or gesture program. `apply` is `Record.onApply(days, { keyed: true })`.
The renderer calls the fit by name through the shared `Func` runtime
(`useFuncCall`, as Experiment does), and the pure functions compiled once.

## 6. Parts: what is reused, what is new

Each concern takes the part the Roster, Calendar or Plan already uses, through
`@elaraai/east-ui-components/internal` or e3-ui-components' `shared/`; nothing
is copied into a new recipe. Where a part is missing it is built once in a
neutral owner and its existing consumer moves onto it in the same change.

| Concern | Part | From |
|---|---|---|
| Frame, panes, rails, scrim, loading | `BuilderFrame` (`loading`, `storageKey`, `onKeyDown`, panes that slide off main during a drag) | `east-ui-components/src/layout/builder-frame/` |
| Toolbar | Toolbar items ranked around `HOST_RANK`, `ChipMenu`, `coarseHitArea` | `east-ui-components` toolbar, `./internal` |
| Date | `TimeNavigator` (`period="day"`, `initialPanel="day"`, `onWeeks`), plus a new `dayMarker` | `e3-ui-components/src/shared/time/navigation.tsx` |
| Segments | `Seg`, `Seg fullWidth` | `shared/schedule/segments.tsx` |
| Narrowing | `Slice.bindRecords` and `useRecordSlicesToolbarItems` (one rail over several records, each part the record Slice's own controls); each source's visibility through `useKeyVisibility`'s `PagedScan`, as the Roster's | `east-ui/src/platform/slice/`, `east-ui-components/src/slice/record/`, `shared/schedule/visibility.ts` |
| Session | `useEditHistory` keyed per day, `EditSession`, `historyToolbarItem`, `historyShortcut`, `typedInto`, `SessionBanners`, `BannerView` | `east-ui-components/src/editing/` |
| Record door | `Record.onApply(days, { keyed: true })`; the keyed day read (new shared day reader) | `e3-ui/src/bind/record.ts`; `roster/data.ts` → `shared/schedule/` |
| Fit call | `useFuncCall` and the shared `Func` runtime | `e3-ui-components/src/experiment/run-runtime.ts` → `shared/func/` |
| Library | `EastChakraLibrary` via `scheduleLibrary` / `scheduleLibraryCard`, groups, facets, DockPane tabs, counts, badge | `shared/schedule/library.ts` |
| Inspector | `ScheduleInspectorHead`, `planInspector` recipe, `FieldForm` + `Fields.specs`, `SliceEditPopover` | `shared/schedule/inspector-head.tsx` |
| Drag | `useDragTarget`, `useDropCell` (caption, onHover), `useDragEventChip`, `MoveGhost` and the `time/move-ghost` recipe | `east-ui-components` dnd; `shared/schedule/move-ghost.tsx` |
| Rows | `VirtualRows`; `GroupHeading`, `useGroupCollapse`, the `schedule-group` recipe (the Table's time bands) | `./internal`; `shared/schedule/group-heading.tsx` |
| Time | scale, now line, weekend shading, ruler | `shared/time/` |
| Links | `routeRibbon`, `ribbonWeight`, caption fit and de-overlap, casing, halo, stub heads, clip | `plan/shell/` → `shared/links/` |
| Footer | `builder-footer` rail; measured wrap | `slot-recipes/builder-footer.ts`; `roster/footer.tsx` |
| Breakpoints | `useContainerBelow`, `NARROW_WIDTH` 480 | `shared/schedule/window.ts` |
| The app's callbacks | `useTrackedEvaluation` for `check` and the columns | `east-ui-components` |

**New, in neutral owners:** `shared/links/` (Plan's link parts, plus a selected
link's × and the link-drag preview; Plan moves onto it unchanged); the
**Chooser** (east-ui-components `./internal`, `pick/chooser/`: a single-choice
list in sections with search, disabled options carrying their reason, ↑↓ Enter
Esc, inside `SliceEditPopover`); TimeNavigator's **`dayMarker`**; the **shared
day reader** (Roster's keyed week read, generalised to any keyed period, telling
loading from confirmed absent; Roster moves onto it); **`shared/func/`**
(`useFuncCall` moved out of Experiment, Experiment onto it); the
**`allocationBuilder`** slot recipe for the board's own slots only.

## 7. Layout in BuilderFrame

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ‹ Tue 11 May › · Timeline | Table · Draft · ⛓ K-203 × · Area ▾ Kiln group ▾ … 3 of 3 lanes · 21 of 33 resources · 3 issues │ ↶ ↷ ✕ ✓ · Publish │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ banners: session problems; published or not-started day; checks unavailable; fits unavailable; narrowing failed; nothing left to book │
├────────────┬───────────────────────────────────────────────────────────┬─────────────┤
│ LIBRARY    │ main: Timeline (lane grid · link channel · resources)     │ INSPECTOR   │
│ Events     │       or Table (slots in four time bands)                 │ Details     │
│ Resources  │       or, below 480px of main, explicit-action cards      │ Issues      │
├────────────┴───────────────────────────────────────────────────────────┴─────────────┤
│ footer: the layout's legend                                                          │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

| Item key | Side | Rank | Forms, wide to narrow | Notes |
|---|---|---|---|---|
| `allocation.navigation` | start | `HOST_RANK + 4` / `+ 6` | TimeNavigator full · compact · inside the combined View | Steps a day; Today in the picker; marks Published · Draft · Not started for the open month |
| `allocation.layout` | start | `HOST_RANK + 1` | Seg Table · Timeline (icons `table`, `chart-gantt`) · inside View | Order as the mock: Table, then Timeline |
| `allocation.status` | start | `HOST_RANK` | Not started · Draft · Publishing · Published · hidden | The day's stored status; absent with `publish={false}` |
| `allocation.focus` | start | `HOST_RANK + 2` | the focus chip · its icon | Timeline only, while a focus is set |
| the rail | start | the rail's own, folding first | a chip per source's field, in source order, then the presets · Filters › Narrowing | Both layouts (§9.15) |
| the rail's count | end | the rail's | `3 of 3 lanes · 21 of 33 resources` | One count per source; both layouts |
| `allocation.issues` | end | `HOST_RANK + 3` | warn chip `3 issues` · inside View | Opens Inspector › Issues |
| history | end | last | Undo · Redo · Discard · Save | `historyToolbarItem` |
| `allocation.publish` | end | `HOST_RANK + 5` | solid Publish · inside View | As the Roster's |

The panes are BuilderFrame's: the Library 264px and the Inspector 320px open,
rails when collapsed; pinned beside main while main keeps 480px, overlaid with
a rail and a scrim on a phone, and slid off main during a drag. The builder fills
its parent and draws no border.

## 8. Anatomy, from the mock

Sizes are the mock's; each owning sub-issue holds them with visual invariants
in the showcase's responsive suite, measured in both themes. Where the shared
part already has a size (the toolbar's rows, the panes, the inspector's fields),
the shared part's wins and the mock's is noted.

**Toolbar (mock).** 52px, padding 0 20px, gap 8: the date control 32px (32px
‹ and ›, the date mono 12px 600 with its ISO week.day `19.2` in ink-4); the
layout segments 32px, mono 11px 600 uppercase, tracking 0.16em, 14px icons;
the status chip 24px, an 8px dot; the focus chip 24px on brand-tint with its
16px ×; Filters 32px; the count mono 11px; the issues chip 24px warn; history
buttons 32 × 32. In the product the shared Toolbar's row and items.

**Timeline.**
- One header row, 48px over a 1px rule; every block inside it 47px, split 24 +
  23: the lane header (a 48px Lane / Hour column, then a 96px column per lane:
  `B-1` mono 10px 600, tracked 0.12em, with `at :15` in ink-4 over `7 bins · 131 m³`
  mono 9.5px), the 48px link channel (paper-2, a link mark on its lower row), the
  152px resource label column (Week / Resource), and the ruler: a 24px week row
  (`W18`, `W19 · May 10`, `W20 · May 17`, ink-4 600 uppercase) over a 23px day
  row (`Tu 11`; the plan day in a 16px brand-d badge; names shrink to `11` when a
  day is under 36px).
- The lane grid: hour rows 36px per bin in the hour's batch (one at least),
  each with its hour label (`06`) at the left; cards 88 × 28 at x 52 + 96 ×
  lane, y = the hour's top + 4 + 36 × its place in the batch; a card's two lines
  (code mono 10.5px 600 with its quantity in ink-2 500; `→ K-203` or `not linked` italic, mono 9.5px ink-4, with
  its marks) at 12px line height, padding 0 8px.
- The connector: a 22px target at right −12px, top 2px, above the link layer;
  inside it a 10px square, 1.5px border, a 1.5px paper ring; filled linked,
  hollow not linked, brand-tint while its link is dragged.
- The link channel: 48px, paper-2, from the header to the bottom.
- Resource rows 36px: the 152px label cell (sticky, padding 0 12px 0 20px: a
  16px rank badge when ranked, the name mono 11px 600 on a 14px line, the line mono 9.5px 500), and
  the plot: bars top 8px, 20px tall, radius sm — the prior job (paper-3,
  rule-strong border, its label), the next job (dashed ink-4, `planned`, 8 days
  wide), the day's load (brand-d; a draft dashed brand-d on brand-tint; over max
  a neg border; the focus a 2px ink outline offset 1; lit by a link a 1px ink-2
  outline offset 4), the overlap (warn 6% wash with warn side rules, the full row
  height), and a ranked fit's preview (dashed brand-d on brand-tint, `+11 m³ ·
  22 m³` in brand-dd); the reason label at right 22px, top 10px, padding 0 4px,
  mono 9.5px 600 on a 16px line on paper — ink-2 for a fit, warn-text after a ×
  for a refusal. The rank badge: 16px high, at least 16px wide, padding 0 4px,
  radius sm, brand-d with mono 10px 600 paper figures.
- The now line: at the plan day's start, the shared now line (1.5px of the brand; the mock's is 1px). Weekends paper-2; week
  rules at each Monday; the focus's hold banded brand-tint at 0.7.
- Refused runs (the default `recede` style): rows recede — the name ink-4; the
  load paper-3 on a rule-strong border, its figure ink-4; a prior job paper-2 on
  a rule border and a next job dashed rule-strong, both without their names —
  and what the refusal is about (the load over max, the job a day names) is
  outlined 1px warn, offset 2. One label per run at right 22px, centred on the
  run: 20px, padding 0 8px, gap 8, a warn border on paper, mono 10px 600
  warn-text, `✕ Over max · 3 resources · by 4–13 m³` with its count and range
  ink-3 500, hidden while the pointer is inside the run, its tooltip every row's
  reason. Under the pointer a refusing row is back in full ink on warn 6% over
  paper, its outline kept; its bins outline warn on the warn wash.
- A body's drag: every free lane hour shows a dashed rule-strong target 4px in,
  radius sm; the one under the pointer dashed brand-d on brand-tint.
- The fits marker: 28px, padding 0 12px, a dashed brand-d border radius md, mono
  10.5px 600 brand-dd, at the resource plot's left + 12px, 12px from the top or
  40px from the bottom.

**Table.** At least 900px wide; a 36px sticky header; columns `84px 64px
minmax(200px, 1.3fr) 64px` then one 72px column per `columns` entry shown in
the Table, then `minmax(176px, 1fr) 144px 128px` (Time · Lane · Event ·
Quantity · the app's columns · Resource · Load · Status); the heads mono 10px 600
uppercase, tracked 0.14em, ink-4. Time bands are the shared group band (§6):
chevron, `00:00–06:00`, a 16px count badge on paper-3, `5 bins · 1 reserved · 14
free · 96 m³` (no reservations said when there are none), `· collapsed`; rows
36px, the time mono 11px 500 (ink when it holds a bin, else ink-3), the lane
10.5px 500 ink-3; an event chip 28px on the rule-strong border, radius sm (grip,
code mono 11px 600, meta 10px ink-4, a 20px chevron, a 20px ×); a resource chip
28px (link mark, name, a 20px chevron, a 20px ×); a placeholder 28px dashed
rule-strong (`no event` / `no resource` italic 10.5px ink-4, or what a drop
does), a free row's event placeholder spanning the quantity and the app's
columns, its resource placeholder the load; the quantity 11px right-aligned; the
Load cell mono 10.5px 500 ink-2 with its marks; the Status cell an 8px dot and
the word, mono 10.5px 600 uppercase tracked 0.1em, ink-3.

**The Chooser.** Anchored under its cell or its field: at least 320px (the cell
less 24px), at most 360px tall (340 in the inspector): a 32px search, section
heads 24px (mono 10px 600 uppercase), options at least 40px on `14px 1fr auto` (a
check for Current, a × for Doesn't fit; the label mono 11px 600; the reason mono
9.5px, warn-text when refused; the range mono 10.5px), and a 32px foot `↑ ↓ move ·
Enter chooses · Esc closes` (mono 10px) — the mock's own label sizes, the design
system's `label.lg`, `label.xs`, `label.md` and `label.sm`. In a cell it is the
shared `SliceEditPopover`'s body (its width the popover's 320px); in the
inspector it is laid in the pane with its own border.

**Library.** Tabs 44px with counts; a search band padding 12px 20px on paper-2
round a 32px input; groups 16px apart, each head 16px (label mono 9.5px
uppercase, a count badge); cards padding 8px 12px 8px 8px, gap 8, a grip, the
code mono 13px 600 and the quantity, a meta line and a ready line mono 9.5px
(warn-text 600 when overdue or not linked); a 36px foot with the hint; the
action box (padding 12px 20px: its note, and a 32px button with an inbox icon).
Collapsed: the count, an overdue mark, the label vertical.

**Inspector.** Tabs 44px with the issues count; sections padding 16px 20px over
rules. The refusal note: a warn box, margin 12px 20px 0. The drop list during a
drag: dashed brand-d rows at least 48px with their rank badge and Book. A bin:
the eyebrow (`Bin 3113`, `New bin`) and its status, the title (DM Sans 17px
700), its meta, its actions (24px), a banner per issue, the Bin section (Lane
`Seg` 24px; Bin time a 32px stepper, 32px − and + round a 64px value, its help
`B-1 bins at :15 · ± 1 h, 00–23 on Tue 11`; the app's value rows on `88px 1fr`),
Assigned to (the resource field 32px with its chevron, the fill, the Chooser
inline, a 6px meter with a 1px ink min tick, the group line, Before · Hold ·
Next fill on `88px 1fr`, On this resource today as 28px rows on `44px 32px 1fr
auto`, the batch line), Other gaps that fit (36px rows with a rank badge and
Move or Link), the event's details, and the was line on paper-2 for a draft.

**Footer.** The shared rail with the layout's legend: Timeline — Bin, Draft,
Today's load, Prior job, Next job, Overlap, Link, Draft link (*ruled 17 Oct*:
the mock's `Link · width by share of the focus's largest load` is `Link`);
Table — Event or resource, Draft, `Empty · drop here`, Reserved, Free. 16 × 10
swatches, a 16 × 4 bar for a link.

**The drag caption.** The shared MoveGhost: 24px, a brand-d border, the label
(`LD-2231 · 21 m³`) and its target in brand-dd, or in warn-text after a ×.

## 9. Behaviour

Every interaction of the mock, numbered. Each sub-issue lists the rules it owns,
and each rule has a test there: `e3-ui` specs over the pure functions and the
fit (`test/allocation/*.spec.ts`), renderer DOM tests
(`e3-ui-components/src/allocation/*.dom.test.tsx`), and the showcase's
responsive suite (`tests/responsive/allocation-*.spec.ts`), measured in the DOM.
Rules marked *ruled* follow a decision of §2; *product* rules are not in the mock.

### 9.1 Toolbar and navigation (owner: frame)

- **A1.** One toolbar row (§7); nothing wraps; items fold by rank, history last.
  In a 294px frame the date, the layout, Filters, Save and Publish stay
  reachable through the combined View fold.
- **A2.** ‹ › and `[` `]` step one day; the date opens the picker (Today in it);
  the picker marks each day of its open month Published · Draft · Not started
  and reads only that month (`dayMarker`, the shared day reader). *Product: the
  mock loads one day.*
- **A3.** The status chip is the day's stored status. A day with no entry is Not
  started, under the banner `Day not started`; its first gesture makes its entry.
  *Ruled.*
- **A4.** Publish records `published { at }` with the drafts and applies them as
  one patch; a published day is read-only under `Published day · Read-only view
  of the published plan.`; a failed or unknown Publish stays unsaved with the
  shared Retry. *Ruled.*
- **A5.** Each day keeps its own drafts and history while the viewer moves
  between days (`useEditHistory` keyed `day.<key>`).
- **A6.** Keys, never while typing: ⌘Z, ⇧⌘Z, ⌘Y. Esc cancels a drag, else
  closes the narrowing popover, else closes the Chooser, else clears the pick,
  else clears the selection. Delete or Backspace unlinks the selected link,
  else removes the selected bin (not during a drag).
- **A7.** Switching Table ↔ Timeline keeps the drafts, the selection and the
  history, closes any popover and selected link, and is not a change.

### 9.2 Selection, picking and focus (owner: frame, timeline, table)

- **A8.** A click selects: a bin card (the bin); a resource row (the resource);
  a Table row (its bin, reservation or free slot); a link or its caption (its bin
  and the link); a connector (its bin, and opens its resource Chooser in the
  inspector, revealing the pane). An explicit inspection opens Details; a
  selection a command makes keeps the inspector's pane and tab.
- **A9.** A click on a library event card picks it (again: unpicks). A selected
  free slot or reservation stays selected, so the Library's foot offers its
  action. A click on a library resource card, with a free slot selected, picks
  it for that slot (Reserve); otherwise it selects (or unselects) the resource.
- **A10.** A click on an Allocated card selects that event's first bin; with
  more than one bin, every bin of the event is highlighted.
- **A11.** With an event picked: the Timeline marks free lane hours (dashed
  brand-d) and ranks resources as during a drag (A27–A30); a click on a free lane
  hour books it there; a click on a ranked resource books it onto that resource
  (A36); a click elsewhere clears the selection. In the Table only a highlighted
  event cell of a free or reserved row that fits reads `click to book LD-2235
  here`, and a click books it there; a click on a row's time selects the row and
  books nothing.
- **A12.** Selecting follows the selection: in the Timeline a bin scrolls the
  lane grid to show it (a third from the top) and scrolls the resource pane so
  its resource row sits level with it, snapped to 36px rows (without scrolling
  when the row is already in view after a drop); a resource scrolls its row into
  view; in the Table the row scrolls into view, a third from the top.
- **A13.** The focus: a selected bin's resource, or a selected resource. Every
  other card dims (rule border, ink-4 text) except the focus's bins and the
  hovered card; the focus's hold is banded across the plot; its day ticks go ink
  600; its links draw (§11); the toolbar's focus chip names it with `N bins ·
  Q m³`, adding `· hidden by Filters` when its row is narrowed out; × or Esc
  clears it.

### 9.3 The Timeline (owner: timeline)

- **A14.** The lane grid (§8): a card per bin at its lane and hour; an hour's
  batch stacks a 36px row per bin; free lane hours are drop targets.
- **A15.** The lane header: the lane, `at :15` (its tooltip, the mock's `Unloading
  bay B-1 takes one bin at :15 past each hour`, is the app's lane label and offset:
  `B-1 takes one bin at :15 past each hour`), and `N bins · Q m³` over the lane's
  bins, reservations not counted.
- **A16.** A card: border rule-strong on paper; a reservation dashed ink-4,
  `Reserved`, no quantity; a draft dashed brand-d on brand-tint, its code
  brand-dd; selected an ink border on paper-3 (dashed for a draft); while dragged
  dashed brand-d, no fill; hovered paper-2. Its second line `→ K-203`, or
  `not linked` italic after a link-slash. Its marks: the app's issue flags
  (`≠ spec`), ⚠ when its resource overlaps a next job, ● when its resource is over
  max, ↓ when under min (tooltip `K-601 is under its minimum: 21 m³ · min 40 ·
  19 short`). Its tooltip: `code · meta · Q m³ · B-1 06:15 on K-203` (or `· not
  linked`) `· drag to another lane hour to move it`.
- **A17.** Nothing that removes sits on a card (removal: A55).
- **A18.** Resource rows in one fixed order, the resources' key order, with no
  status groups; the narrowing hides rows but never reorders them; nothing hides,
  reorders or regroups during a drag or after a drop.
- **A19.** A row's line: loading — the load (`11 m³ · max 9 · 2 over`, `16 m³ ·
  min 40 · 24 short`, `45 m³ · takes 26–48`; `reserved · takes 26–48` with only a
  reservation) and `· 1 d into next job` when it overlaps; busy — `busy until Fri
  14`; free — its meta (or its group) and what it takes, `Hall B · 40 m³ · takes
  20–40 m³`. Neg-text 600 over max; warn-text 600
  overlapping or under min; ink-4 otherwise.
- **A20.** A row's plot (§8): the prior job, the next job (`planned`), the day's
  load for its hold (the longest of its bins' holds), the overlap wash.
- **A21.** The connector (§8) shows on the hovered or selected card only, centred
  where the link leaves, above the link layer. Dragged onto a resource it links
  the bin's unallocated quantity (all of it when the bin has no part); clicked, it
  selects the bin and opens its resource Chooser. Its tooltip: `Allocated to
  K-203 · drag the connector onto a resource to move it · click to choose
  another`, or `Drag the connector onto a resource to allocate LD-2231 · click to
  choose one`.

### 9.4 Fits during a drag or a pick (owner: drag, timeline, table)

- **A22.** A drag starts after 5px of travel. As it starts nothing above the
  board changes (no banner comes or goes, the inspector shows Details), so
  nothing moves under the pointer.
- **A23.** The board asks the fit for the drag's or the pick's subject before the
  drag needs it: on selection, on pick, on a connector's or a card's pointer-down,
  on the Chooser's opening and on Find (§12.2). Every verdict below is the fit's.
- **A24.** A card body drag only moves the bin; it ranks and marks no resources.
- **A25.** Pointer within 24px of a scrolling pane's top or bottom edge scrolls
  that pane one 36px row every eighth frame, snapped to rows.
- **A26.** The drop target is the element under the pointer: a lane hour, a
  card, a resource row, a Table event cell or resource cell, the fits marker, or a
  fit in the inspector's drop list.
- **A27.** From the drag's start, every resource that refuses recedes, with one
  label per run of contiguous refusing rows of one group (§8): `Busy · until Fri
  14 – Sat 15`, `Gap too short · 3 resources · next job Wed 19 – Thu 20`, `Over max ·
  by 4–13 m³`. A run's label hides while the pointer is inside it. Fitting rows
  keep full ink.
- **A28.** The three best fits (by score, the bin's current resource excepted)
  carry #1 #2 #3 and a dashed preview bar of the hold, `+Q m³ · after m³`.
- **A29.** The row under the pointer tints brand-tint when it fits, warn 6% when
  it refuses, and shows its reason (`0 d spare to Wed 19 · leaves 21 m³ · takes
  12–24`, or `✕ gap too short · next job Wed 19`); ranked and hovered rows show
  theirs too. Its bins outline ink-3 when the drop fits and warn when it refuses;
  never amber for a fit.
- **A30.** While an event is dragged over the lane grid, thin brand lines (1.5)
  run from the pointer to each of the three best fits, out of the drag point and
  into each row.
- **A31.** A fit out of view: one marker over the rows at the pane's edge, `2
  fits below · #1 K-103`, `↑` or `↓` by side, or `#1 K-601 is hidden by Filters ·
  drop here`; it pushes nothing, and a drop on it goes to the #1.
- **A32.** During a resource card's drag: every bin that refuses the resource
  outlines warn on a warn wash, the bin under the pointer brand-tint dashed;
  every free lane hour is a dashed target, warn when the resource refuses a
  reservation (`full · …`); in the Table each resource cell says what a drop does
  or why not.
- **A33.** The drag caption (MoveGhost) names the outcome: `to K-203 · #1 ·
  under min · B-1 00:15` onto a resource (the landing slot for an event, A36);
  `to B-2 06:35` onto a lane hour; `into the reservation on K-203`; `to B-1 06:15
  on K-203` onto a reserved row; `link LD-2231` or `move the reservation here` or
  `reserve B-1 06:15` for a resource card; `already on it`; or, after a ×, the
  refusal: `gap too short · next job Wed 19`, `lane hours only · drag its
  connector to change the resource`, `drop on the event cell`, `drop on a
  resource`. Brand-dd, or warn-text when refused or under min.
- **A34.** During a drag the inspector lists the fits as drop targets (§8): for an
  event or a link, `Gaps that fit · LD-2231 · 21 m³ · 8-day hold from Tue 11 ·
  ranked by load, kind and spare days` (the answer's `basis`, the app's own words:
  the yard's fit says `ranked by load, kind and spare days, and what it leaves for
  the day's other loads`), the three best with their reasons, `no
  resource has a gap that fits` when none, and the layout's hint (`Drop on a
  resource row or a lane hour, or on a resource here.`); for a card body, `Move
  bin · between lanes and hours · its resource stays K-203` (Table: `to a free
  row`); for a resource card, `Resource · K-203 · Hall B · 31 m³ today`. With a
  pick and no drag, the same list with a Book button per fit and the hint `Book
  puts it in the day's first free bay slot (B-1 00:15). Or click a free lane hour
  or a ranked resource, or drag it there. Esc clears.`
- **A35.** Hover previews are cached per subject and destination for the current
  drafts and fit answer, and the drop checks again through the command; pointer
  motion repaints no card body (Roster's `drag.ts` cache).

### 9.5 Drops (owner: commands, drag) — the table is §10

- **A36.** Booking onto a resource takes the plan day's first free slot, by time
  then lane order, from 00:00, never the computer's clock; the caption and the
  inspector's Book hint name it first; with none left, the banner `Not booked ·
  No free bin is left on Tue 11 for LD-2231.`
- **A37.** A bin dropped on a lane hour moves there at the slot's time; with bins
  already in the slot (within 10 minutes of its time) it follows the last of them
  by one minute; its resource never changes. Its own lane hour: nothing.
- **A38.** An event or a bin dropped on a reservation fills it: the bin takes the
  reservation's lane, time and resource, and the reservation goes. A refusal says
  why.
- **A39.** A connector or link dropped on a resource links (or re-links) the
  quantity it carries; its current resource: nothing.
- **A40.** A refused drop adds no banner and moves nothing; its reason stays at
  the top of the inspector until the next action (`Not booked · LD-2232 can't go
  into K-103: gap too short · next job Tue 18.`), and can be dismissed.

### 9.6 The Table (owner: table)

- **A41.** One 36px row per slot (lane × hour) and one per extra bin of a batch,
  ordered by time then lane, in four foldable bands 00–06 · 06–12 · 12–18 · 18–24
  (`GroupHeading`, fold state persisted); a row never moves when an allocation
  changes. The narrowing hides rows (A93), never reorders them. *Ruled.*
- **A42.** The band's head: `00:00–06:00`, its row count, `N bins · N reserved ·
  N free · Q m³`, and `· collapsed` when folded.
- **A43.** A row: Time (ink when it holds a bin), Lane, the event chip or its
  placeholder, Quantity, the app's columns (warn-text 600 with its tone), the
  resource chip or its placeholder, Load (the load line of A19 with ⚠ ● ↓), Status
  (`Free` ink-5, `Not linked` warn, `Check` warn — its resource over max or
  overlapping, `Draft` ink-4, `Reserved` brand, `Committed` pos).
- **A44.** A selected row is paper-3; selecting a resource marks every row of its
  bins; a hovered row paper-2.
- **A45.** An empty cell is a dashed placeholder: `no event` (`no event ·
  reserved` on a reservation) and `no resource`. During a drag or a pick it says
  what a drop does — `drop to book here`, `drop to move here`, `drop to link`,
  `drop to reserve`, `click to book LD-2235 here` — or, refused, `doesn't fit`
  with a × and its reason as tooltip (the reason itself while the pointer is on
  it).
- **A46.** A chip's × returns the event to Events (removes the bin), or unlinks
  the resource (removes the reservation on a reserved row).
- **A47.** An event chip drags onto another row's event cell to move the bin.
- **A48.** The chevron on a cell opens the Chooser anchored under it. An event
  cell: Current (a bin row's own event, checked), then `Fits K-203` (or `Replace
  with`, or `Book here` on a free row), then `Doesn't fit K-203` (disabled, each
  with its reason), then Allocated (every event already on the board, disabled,
  `in B-1 06:15 on K-203 · +1 more`). A resource cell: Current, then `Gaps that
  fit` (a bin) or `Can be reserved` (a free row) best first with their reasons,
  then `Doesn't fit`. Search filters by label and line; `no match`; ↑↓ move
  through the enabled options, Enter chooses, Esc closes; hovering sets the
  highlight.
- **A49.** Choosing an event for a bin row replaces it (the replaced event goes
  back to Events); for a reservation it fills it; for a free row it books it there.
  Choosing a resource re-links a bin or a reservation, or reserves a free row.

### 9.7 Library (owner: library)

- **A50.** Two tabs, Events and Resources, each with its count (every event the
  day can show; every resource), and a search (`Find an event or site`, `Find a
  resource or group`).
- **A51.** Events, grouped: Overdue (warn, its triangle), Ready around now,
  Removed from plan (dashed: the day's committed bins the drafts removed, `was
  B-1 06:15 on K-203`; dragging one books it again with its original bin), and
  Allocated (the day's booked events: `in B-1 06:15 on K-203`, or `N bins · …`;
  not linked in warn-text 600; a draft booking has a × that returns it). A card:
  grip, code, quantity, its meta and hold (`RDG · R2 · spec MC12 · 8 d`), its ready
  line (`was due Sun 9 · overdue`, `due Wed 12 · window Tue–Fri`).
- **A52.** Resources, grouped Free today · Loading today · Busy today (the day's
  states, as facets of the shared Library): name, range, group, and its line
  (`31 m³ today · to Tue 18`, `· 4 m³ over`, `· 1 d into next job`, `busy until
  Fri 14`, `free · next job Wed 19`, `free · no next job`); over neg-text,
  overlapping warn-text.
- **A53.** The foot's hint is the tab's and the layout's: `Drag onto a lane hour
  or a resource`, `Drag onto a bin or an empty lane hour`, `Drag onto a row's
  event cell`, `Drag onto a row's resource cell`; narrow, `Select an event, then
  Book`. Under it the picked card's action: with a free slot selected, `Book into
  B-1 06:15` (`LD-2235 · 8 m³ · then choose its resource`); with a reservation
  selected, `Book into B-1 06:15` checked against its resource (disabled, warn,
  `Doesn't fit K-203: …` when refused); with a resource picked for a free slot,
  `Reserve B-1 06:15 on K-203`; otherwise `Click a free lane hour or a ranked
  resource to book LD-2235 there, or select a free slot first.`
- **A54.** Collapsed, the pane is a rail: the events count, an overdue mark, the
  label. Empty: `No events match · Clear the search to see all 27 events.`

### 9.8 Inspector (owner: inspector)

- **A55.** Two tabs, Details and Issues (with its count); the rail's badge is the
  count. Details shows the drop list during a drag (A34), else the selection,
  else the summary.
- **A56.** A bin: the eyebrow `Bin 3113` (`New bin`), its status (`Committed`,
  `Check`, `Not linked`, `Added · unsaved`, `Moved · unsaved`, `Allocated ·
  unsaved`, `Unlinked · unsaved`, `Edited · unsaved`), the title `LD-2210 · 32 m³`,
  its meta, and its actions: Unlink (when linked), Revert (a changed committed
  bin), Back to Events. Then a banner per issue (`Over max · K-207 holds 44 m³
  against a 40 m³ max · 4 m³ over.`, `Under min · … Another load can top it up;
  Save still works.`, `Overlaps the next job · The 8-day hold on K-105 runs to
  Tue 18, 2 d into the job planned Mon 17.`, `Not linked · LD-2231 has no
  resource. Link it to a gap that fits, or it stays unplaced.`).
- **A57.** The Bin section: Lane (`Seg`; a change moves the bin to that lane's slot
  in the same hour), Bin time (− and + step one slot, 00 to 23; the value tinted
  when changed; `B-1 bins at :15 · ± 1 h, 00–23 on Tue 11`), then the app's
  values as rows (`Spec · booked MC12 · measured MC10` in warn-text 600).
- **A58.** Assigned to: the resource field (its name, or `+ Choose a resource` in
  warn), which opens the Chooser inline (A48), with `Open resource →`; the fill
  (A19) and its meter with the min tick; the group line; Before (`job C-3142 ·
  released Fri 7` or `empty in the plan`), Hold (`Tue 11 to Tue 18 · 8 d`), Next
  fill (`Mon 17 · hold overlaps it by 2 d`, `Wed 19 · 1 d spare`, `none planned to
  Thu 20`, and the resource's note); On this resource today (its bins: time, lane,
  code, quantity; the current one bold; a click selects); the batch line
  (`Batched · 3 bins · 31 m³`, `One bin fills it.`). Unlinked: the field and the
  hint `Or drag the bin's connector onto a resource row.` (Table: `Or use the
  chevron on its row in the table.`).
- **A59.** Other gaps that fit (`Gaps that fit` when unlinked): the three best
  other fits with rank and reason, Move or Link; `no other free gap is long
  enough`. Then the event's details (`Settings`), and the was line for a draft
  (`was K-108 · B-2 10:35`, `new booking · not in the plan yet`).
- **A60.** A free slot: `Slot · Free`, `B-1 · 00:15`, `Tue 11 May · no event · no
  resource`; Book an event (every bookable event, a Book each, the overdue reason in
  warn); Reserve a resource (the five best fits for a reservation, free ones first,
  `free · …` / `loading · …`, a Reserve each); `Or drag an event or a resource
  from the library onto this row.`
- **A61.** A reservation: `Reserved slot` (`New reservation`), its status, the lane
  and time, `Reserved on K-203 · no event yet`; Assigned to with Remove and Open
  resource; the fill and meter; Book an event (each event checked against the
  resource: Book disabled and `doesn't fit · …` in warn when refused); the was line
  and Revert for a draft.
- **A62.** A resource: `Resource` and its status (`Check`, `Loading`, `Busy`,
  `Free`), its name, `Hall B · min 20 m³ · max 40 m³`; its issue banners; Today's
  fill and meter; Before · Hold · Next fill; Bins on it today (`no bins today`);
  the hint (`Drag a bin's connector or an event onto this row to load it.`, Table
  `Choose it with the resource chevron on a row, or drag it from the Library onto a
  row.`, busy `Busy resources take no load until their current job is released.`).
- **A63.** Nothing selected: `Plan · Tue 11 May`, the title, `3 lanes · 33
  resources`; four stats — Bins (`26`, `556 m³ · 0 reserved`), Loading (`21 of
  33`, `10 free · 2 busy`), Issues (`3`, `2 overlaps · 1 over max`), Drafts (`0`,
  `all saved`, or `N`, `unsaved · Save is in the toolbar`); the narrowing note
  `21 of 33 kilns visible · fits, checks and totals include all`; three hints.
- **A64.** Issues: grouped Not linked (fix `Choose a resource`), Partly allocated
  (fix `Find a fit`), Overlaps the next job (fix `Move LD-2205…`, opening the last
  bin's Chooser), Over max (the same), Under minimum (the same), then the app's
  groups by their kind's name (`Spec mismatch`, no fix), each with its count. An
  issue: its title and `Show →` (selects its bin or resource), its detail, its fix.
  None: `No issues · Every load sits within its gap and its max.` The issues chip,
  the tab's count and the summary count warning and danger issues; neutral and
  info ones (the yard's Spec mismatch) are listed but not counted, as the mock
  does. Issues never block Save or Publish. *Ruled.*

### 9.9 Links (owner: links) — §11

- **A65.** Links draw only for the focus (A13), never at rest or on hover; during
  a drag, the dragged bin's resource's family (its own link the `was` line) and the
  target's family (ink-2 when it fits, warn when it refuses).
- **A66.** Route, weight, casing, captions, lit and off view are §11's, the shared
  link renderer's numbers. *Ruled: cross, cased; off view, Plan's stub.*
- **A67.** A link under the pointer (its line or its caption) lights ink-2, over the
  others, with a 1px ink-2 halo 4px outside its bin and its resource's load bar; its
  hit area is its stroke and 5px each side; its caption is its tooltip (`Link of
  LD-2210, 32 m³ · click to select`).
- **A68.** A click selects a link: its caption is outlined ink and carries a × in
  its own 16px target (pointer-down stopped, never a drag) that unlinks (`Unlink
  LD-2210 · Delete`); Delete unlinks too. A reservation's link has no caption, so
  Delete only. Dragging a link moves its part (A39).
- **A69.** A link drag: the bin's current link fades to a 1.5 ink-4 `was` line, and
  the new line (brand-d, 3) follows the pointer across the channel to the target row.

### 9.10 Split loads and Find a fit (owner: split) — *ruled, product*

- **A70.** A bin's quantity may be split across resources: each part carries its
  quantity, and what the parts leave is unallocated. The card's second line reads
  `→ K-203 + 1` with `4 m³ unallocated` in warn-text; Issues lists it as Partly
  allocated, a warning that never blocks.
- **A71.** Splitting: the inspector's `Split…` (an anchored popover: the resource
  through the Chooser, the quantity defaulting to the remainder) adds a part; each
  part's quantity is a field in Assigned to; Unlink removes one part. The connector
  links the remainder; dragging a link moves its part. The Table lists a bin's
  parts as resource chips with their quantities, and `+ resource` for a remainder.
- **A72.** Each part is its own link, weighted by its quantity within the family; a
  split bin in the focus shows a link to each of its resources.
- **A73.** The fit is always asked for the quantity being placed: the part's, or the
  remainder's.
- **A74.** Find a fit — a Partly allocated or Not linked issue's fix, and a bin's
  action — asks the fit for the bin's unallocated quantity and opens the Library's
  Resources tab narrowed to the fits, best first, each card carrying the fit's
  reason, with a chip in the tab that clears it.

### 9.11 Editing and Save (owner: editing)

- **A75.** One shared EditSession per day over the record, one transaction per
  gesture: a drop, a Chooser choice, a lane or time step, a quantity, a split, a
  fix, a Back to Events, a Revert.
- **A76.** Revert puts a committed bin back as the day holds it, or returns a new
  bin's event to Events. Removing a committed bin keeps it under Removed from plan
  until Save; removing a new one drops it.
- **A77.** Discard drops the day's drafts at once; Save applies the day as one
  checked patch. Conflicts, refusals, stale drafts and unknown outcomes are
  SessionBanners with Retry under the same write identity. There is no banner per
  action: a change shows on the board as a draft, in the inspector's status, and in
  the history item.

### 9.12 Narrow layout (owner: cards) — *product*

- **A78.** Below 480px of main (`useContainerBelow(main, NARROW_WIDTH)`), the
  Timeline is a card per resource (its load line, its bins with Unlink · Move ·
  Back to Events, and `Book an event…`), and the Table a card per slot (`Book…`,
  `Reserve…`, `Allocate…`, `Unlink`, `Back to Events`), each action an anchored
  popover running the same command. No drag source, target or handle is
  registered. Resizing keeps the layout, the selection and the drafts.

### 9.13 Footer and loading (owner: frame)

- **A79.** The footer is the shared builder-footer rail with the layout's legend
  only (§8), each item wrapping on its own; no counts, hints or status.
- **A80.** `BuilderFrame.loading` covers the frame until the active day resolves;
  an unresolved day is never drawn as empty; later loads keep the frame, the
  sessions and the drafts mounted.

### 9.14 Words: tooltips, labels, hints and refusals (owner: each part's sub-issue)

The mock's words, kept verbatim (`…` is the dynamic part). A shared part's own
words (TimeNavigator, the history item, the Slice rail, BuilderFrame's pane
controls) are the shared part's.

- **A81. Toolbar.** The focus chip's tooltip `The focus: its links are drawn · Esc
  returns to all`, its × `Show all · Esc`; the status chip's `Plan status`; the
  issues chip's tooltip `2 overlaps · 1 over max · show them` (with `· warnings
  only, Save still works` when only warnings), its label `3 issues, show them`.
- **A82. Timeline.** The lane header's meta `Bins booked in this lane today · m³`;
  the link channel's `Links run through this channel`; a reservation card's
  tooltip `Reserved · B-1 06:15 on K-203 · no event yet · drag to another lane
  hour to move it`; a link's `Link of LD-2210, 32 m³ · click to select` and
  aria `Link of LD-2210, 32 m³` (`Selected link of …`); its caption's `Click to
  select the link, then Delete · drag onto a resource row to move it`, selected
  `Selected · × or Delete removes the link`.
- **A83. Library cards.** An event: `Click to see where LD-2231 fits · drag it onto
  a lane hour or a resource` (Table: `… onto a free row`); an Allocated one:
  `Allocated · click to show its bin`, its × `Return LD-2231 to the list`; a plan
  event: `In the plan · click to highlight its 2 bins` (`its bin`); Removed from
  plan: `Click to see where it fits · drag LD-2210 back onto a lane hour or a
  resource`; a resource: `Click to highlight its bins · drag K-203 onto a bin or an
  empty lane hour` (Table: `onto a row's resource cell`). The rail's overdue mark
  `Overdue event`. Empty: `No events match` / `No resources match`, `Clear the search
  to see all 27 events.` / `… all 33 resources.`
- **A84. Table cells.** A placeholder's tooltip `Choose an event, or drag one here
  from Events` / `Choose a resource, or drag one here from Resources`; the
  chevrons `Replace LD-2210 with another event`, `Choose an event`, `Change the
  resource`, `Choose a resource`, `Reserve a resource`; the event chip's `LD-2210 ·
  RDG · 32 m³ · drag onto an empty row to move it`; its × `Remove LD-2210 from the
  plan · it moves to Events` (a draft: `Return LD-2210 to Events`); the resource
  chip's × `Unlink LD-2210 from K-108` (`Remove the reservation`); the Load cell's
  tooltip `<resource> · <its load line> · <N d into the next job>` (A19).
- **A85. Inspector.** The resource field's `Choose the resource · the same list as
  the Table's chevron`; the stepper's `One hour earlier` / `One hour later`; a
  reservation's Remove `Remove the reservation · the slot becomes free`; Revert's
  label `Return to Events` for a new bin; `no events to book`; `none planned to Thu
  20`; a reservation's list foot `Each event is checked against K-203. Book is off
  when it doesn't fit.`
- **A86. Drop-list hints.** A resource card: `Drop on a bin to link it, or on an
  empty lane hour to reserve that slot.` (Table `Drop on a row's resource cell. A bin
  is linked to it; an empty slot is reserved on it.`); a card body: `Drop on a lane
  hour. To change its resource, drag its connector instead.` (Table `Drop on a free
  row's event cell. To change its resource, use the chevron on its row.`); a link:
  `Drop on a resource row, or on a resource here.`; an event: `Drop on a resource row
  or a lane hour, or on a resource here.` (Table `Drop on a free row's event cell,
  or on a resource here to book its next free bin.`); a pick in the Table: `Book puts
  it in the day's first free bay slot (B-1 00:15). Or click a highlighted event
  cell, or drag it onto a free row. Esc clears.`
- **A87. Library foot, Table.** `Click a highlighted event cell to book LD-2235
  there, or select a free slot first.`
- **A88. Refusal words.** `Not booked`, `Not allocated`, `Not moved`, `Not reserved`,
  each before its sentence (A40).
- **A89. Summary hints.** `Select a bin or a resource to inspect it.` · `Use the
  Library to book events and reserve resources.` · `Every change is a draft until
  Save. Undo and Redo are in the toolbar.`
- **A90. Marks.** The app's flag's tooltip is its issue's title; ⚠ `Overlaps the
  next job`; ● `Over max`; ↓ `Under minimum`; a check `Current` and a ×
  `Doesn't fit` in the Chooser.

### 9.15 The narrowing (owner: narrowing, #1336) — *ruled*

- **A91.** `slice` is one `Slice.bindRecords` whose sources are named after what
  they narrow, `lanes` and `resources`, each a record bound through its indexes.
  The board reads each source's narrowed keys itself, by the lane's and the
  resource's key; a source with nothing chosen hides nothing and reads no key.
- **A92.** The Timeline: a lane narrowing hides lane columns, with their cards and
  lane hours, a card standing in its lane's column among those shown; a resource
  narrowing hides resource rows (A18). A link to a hidden card or row is not
  drawn; the focus stays.
- **A93.** The Table: a row shows when its lane shows and it holds no resource (a
  free slot, a bin not yet allocated) or has a part on a shown resource. Each band
  counts the rows it shows (A42); a band the narrowing empties has no head.
- **A94.** The resource Chooser offers the shown resources and Current; a drop
  lands only on what shows. Fits, loads, checks, issues and totals read every lane
  and resource.
- **A95.** One rail in both layouts: each source's field chips in source order, the
  presets over both, one Clear all, and one summary counting each source (`2 of 3
  lanes · 21 of 33 resources`), each exact and pending on its own. A preset over
  both sources narrows each in one gesture; a later choice in either deactivates
  it.
- **A96.** While a narrowing resolves, the last complete membership shows, main
  busy and taking no gesture; a failed read shows `Lane results unavailable` or
  `Resource results unavailable` with Retry, which asks that source again at once.
  When the narrowing leaves nothing: `No rows match the filters`, with Clear
  filters.

## 10. Drag and drop, as a table

| Drag | Onto | Does | Refused or warned |
|---|---|---|---|
| A bin card (body) | a lane hour | Moves the bin there at the slot's time, after any bins in the slot (A37) | Its own lane hour: nothing. |
| A bin card (body) | a reservation (card or reserved row) | Fills the reservation (A38) | The fit's refusal on the reservation's resource. |
| A bin card (body) | a resource row | — | `lane hours only · drag its connector to change the resource` (`Not moved`). |
| A bin card (body) | a Table event cell of a free row | Moves the bin to that row's lane and time | — |
| A connector or a link | a resource row, the fits marker, a fit in the drop list | Links its quantity there (A39) | The fit's refusal (`Not allocated`); its own resource: nothing. |
| A connector or a link | a lane hour or a Table event cell | — | `drop on a resource` (`Not allocated · To allocate LD-2231, drop its link on a resource row.`). |
| A library event | a lane hour, a Table event cell of a free row | Books it there | — |
| A library event | a reservation | Fills it | The fit's refusal. |
| A library event | a resource row, the fits marker, a fit in the drop list | Books it onto the resource at the day's first free slot (A36) | The fit's refusal (`Not booked`); none free: the banner (A36). Warned: `under min`. |
| A library event | a Table resource cell | — | `drop on the event cell` (`Not booked`). |
| A Removed from plan card | as a library event | Books it again with its original bin | As a library event. |
| A library resource | a bin (card or Table resource cell) | Links the bin to it | The fit's refusal for that bin; already on it: nothing. |
| A library resource | a reservation | Moves the reservation to it | `full · …` or the fit's refusal. |
| A library resource | a free lane hour, a free row's resource cell | Reserves that slot on it | `full · …` or the fit's refusal. |
| A Table event chip | another row's event cell | Moves the bin (into a reservation when the row is reserved) | As a bin card. |

All of it runs on the shared drag grammar (`LibraryRef`, `CellRef`,
`DragEvent`) through the one command object (A23, A35): a lane hour's `CellRef`
is the lane and the hour, a card's names its bin, a resource row's its resource,
a Table cell's its lane, time and side.

## 11. Links: Plan's, reused

The board does not author links: a link is a bin's part on a resource. It reuses
Plan's renderer, which follows `Plan links.html` with the user's two overrides
(controls shown at rest; nothing crosses into the first column), moved into
`e3-ui-components/src/shared/links/` with Plan onto it and its tests unchanged:
`routeRibbon` and its case table, `ribbonWeight`, caption placement inside the
bounds and the 60 × 12 de-overlap, the casing, the knockout fitted after fonts
load, the lit link drawn last with its halo, the stroke + 5 hit path, stub heads
and the clip. The mock's own route already matches `routeRibbon`'s metro-S
number for number: the riser at `approachX − rad`, 27px before the destination;
head 8; run-outs 11; corner 8.

| | Plan | Allocation |
|---|---|---|
| Source end | The run's drawn end | The bin card's right edge (its drawn 88 × 28 rect), centred on its height |
| Destination start | The run's start | The resource row's leading edge (the link channel's right edge), centred on the 36px row |
| Bounds nothing crosses | The gutter to the plot's end | The lane grid's card columns to the resource row's leading edge |
| Route | Metro-S when forward, else the loopback | Always forward: the S, its riser in the 48px link channel |
| Crossing | Over bars, cased in paper | Over neighbouring cards of the same hour, cased. *Ruled: the mock's detour to the hour's edge goes.* |
| Weight | 2 / 4 / 8 by thirds of the family's largest quantity; 1.5 with none | The same, by each part's quantity; a reservation draws 1.5 with no caption |
| Caption | Mono 10/500 ink-3 on a 12px paper knockout on the riser; within 60 × 12 of another it steps down 12 | The same |
| Lit | Ink-2, drawn over the others; a 1px halo 4px outside both ends; hit stroke + 5 | The same; the halo rings the bin card and the resource's load bar |
| Out of view | A stub at the view's edge pointing toward the row | The same. *Ruled: the mock's edge caps go.* |
| When drawn | Only inside a links focus | Only for the focus (A65) |

The board adds, in `shared/links/` (Plan unaffected unless it opts in): a
selected link with its caption's × (A68), and the link-drag preview (A69).

## 12. The fit

### 12.1 The contract

`fit` is a `Func.bind` handle over the app's `e3.function` from
`Allocation.Types.FitRequest(V)` to `Allocation.Types.FitResult`. One call
answers one question about the drafted plan:

- **place** a subject (a bin, or an event) with a quantity: a verdict for every
  resource (`resources`);
- **take** a resource (a dragged resource card, a Table row's event Chooser, a
  reservation's Book list): a verdict for every bin (`bins`), one for booking
  each event the plan has not booked onto it (`events`), and one for reserving
  an empty slot on it (`reserve`). Asked of the day without a row's bin, its
  event is one to book: the Chooser's `Replace with`. *(Ruled 17 Oct.)*

The result echoes its `ask`, so the board matches each answer to its question:
`Func.bind` calls are latest-wins on one channel per function.

### 12.2 How the board asks (owner: fit)

- **F1.** The board asks for its active subject: the selected bin, the picked
  event, the card or connector under a pointer-down, the bin a Chooser or Find is
  for, the resource card being dragged. It asks again when the drafts change.
  Answers are cached by question and drafts version; one question is in flight at
  a time.
- **F2.** While an answer is pending, rows and cells show no verdict, the caption
  reads `checking fits…`, and a drop waits: the ghost stays at the drop until the
  answer lands, then the command runs or refuses.
- **F3.** A failed call shows the banner `Fits couldn't be checked` with the
  function's message and Retry; drops are refused with `fits unavailable`.
- **F4.** The renderer computes no fit of its own; every rank, refusal, reason,
  Chooser section, drop-list row and Find result comes from the answer.

### 12.3 The built-in rules: `Allocation.fit`

The rules the mock runs, as one pure East function over a candidate (its
quantity on one resource, against the drafted plan):

1. **Busy:** a job covers the plan day's start → refused, group `Busy`, reason
   `busy until Fri 14`, measure the day (`until`).
2. **Gap too short:** the hold — the longer of the candidate's and the
   resource's other bins' holds, from the plan day — runs past a job's start →
   refused, `Gap too short`, `gap too short · next job Wed 19`, measure the day
   (`next job`).
3. **Over max:** fill + quantity over max → refused, `Over max`, `over max by
   4 m³`, measure the amount (`by`).
4. **Reserving** (a take's `reserve`, and a bin with no event): the same with
   quantity 0 and the resource's hold, then refused, group `Full`, `full · 40 m³ ·
   takes 20–40`, when the resource's fill is at its max.
5. **Fits:** score = after ÷ max + 0.25 when a bin of the same kind is already on
   the resource − 0.1 when it holds other bins, none of the kind − 0.5 when under
   min − 0.04 × min(spare days, 6), a resource with no next job counting six;
   why = `open gap` or `3 d spare to Wed 19`, then `· leaves` and the load line
   (A19); warn `under min` when after < min and `rules.under`. The terms are added
   in that order, as the mock adds them, so equal fits tie exactly.

`Allocation.check` reports, over committed and drafted bins alike: Not linked,
Partly allocated, Over max, Under minimum (when `rules.under`), Overlaps the next
job — then the app's `check`.

### 12.4 The yard's greedy fit, and how it is tested

`yardFit` (§3.1) runs the built-in rules, then a greedy best-fit-decreasing
look-ahead (`Allocation.lookahead`): it places the candidate, then each of the
day's unbooked events, largest first, on its best fitting resource, and lowers the
score by one for each event left with no fit, adding `· leaves 1 load with no
fit`. In the yard, LD-2231 (21 m³) fits K-107 and K-601; the look-ahead ranks
K-107 first, because K-601 is the only fit for LD-2232, LD-2233 and LD-2234.
LD-2236 (11 m³), which the built-in rules rank K-107, K-103, K-601, the look-ahead
reorders K-103, K-601, K-107: on K-107 it leaves LD-2231 nowhere but K-601, and
two loads with no fit.

- **e3-ui specs** (`test/allocation/fit.spec.ts`) compile `Allocation.fit`,
  `Allocation.answer`, `Allocation.lookahead` and the yard's function body, and
  assert §0's worked facts exactly: each library load's fits and their order,
  each refusal's group, reason and measure, bin 3113's two fits and thirty
  refusals, and the look-ahead's reordering.
- **Renderer tests** drive the board over the shared record-backed builder
  harness with the yard's function served through the harness's `Func` runtime
  (extended to serve `e3.function`s if it does not), and assert that every rank,
  refusal, Chooser section and Find result is the function's — including a fit
  that refuses what the built-in rules would accept.
- **The showcase** runs the kiln yard on e3-web, where `yard_fit` executes in the
  page's e3.

## 13. The Roster's fit (owner: roster) — *ruled*

Today the Roster's Find fixes (find a lead, find a trainer, find skilled staff)
set the People tab's facet filters in renderer code (`roster/library.tsx`, from
`Fix.find`). They move onto the same contract: the app's `e3.function` decides
who fits and why; the renderer only asks and shows.

```ts
Schedule.Types.Fit       = VariantType({ fits: StructType({ score: FloatType, why: StringType, warn: OptionType(StringType) }), refused: Allocation.Types.Refusal });
Roster.Types.Need        = VariantType({ leads: NullType, trainers: NullType, skill: StringType });   // today's Fix.find payload
Roster.Types.FitRequest  = StructType({ need: Need, slot: Slot, start: DateTimeType, week: Week, context: Context, coverage: DictType(Slot, Coverage) });
Roster.Types.FitResult   = StructType({ need: Need, slot: Slot, people: DictType(StringType, Fit) });
Roster.fit               : (FitRequest, Person) → Fit      // ready-made: the need held, not rostered that day, rest kept; prefers the slot's group, then spare contract hours
Roster.answer            : (FitRequest, Fn(FitRequest, Person) → Fit) → FitResult

// The prop, beside check. Omitted: no Find fix is offered.
const staffFit = $.let(Func.bind(rosterStaffFit));      // e3.function("roster_staff_fit", …)
<Roster … fit={staffFit} />
```

- **R1.** A find fix asks the app's fit for the issue's slot and need over the
  complete staff, and narrows the People tab to the fits, best first, each card
  carrying the fit's reason, with a chip in the tab that clears it. It replaces the
  facet filters `find` sets today.
- **R2.** Without `fit`, no find fix is offered: `Roster.check` still reports the
  issue, and the renderer drops the Find button.
- **R3.** Unchanged: the People tab's All · Leads · Trainers · Off segment filters
  on each person's own fields, and a chip's `5/6` counts held skills. Neither is a
  fit.
- **R4.** While pending, the fix's button reads `Finding…`; a failure is a warning
  banner with Retry.
- **R5.** Examples: `rosterWarehouse` and `rosterRecordIndexes` pass
  `fit={staffFit}`, a greedy e3.function over `Roster.fit` (prefer people off that
  day with the most spare contract hours); specs assert its ranking; the e3-ui
  skill and the plugin indexes follow.

## 14. Where the product differs from the mock

Only the rulings of §2 change the mock's behaviour.

| The mock | The product | Why |
|---|---|---|
| One plan day loaded; the date arrows disabled | Days navigate (A2); each is a record entry | The record holds every day. |
| The status chip reads Draft or Committed from pending edits | The day's stored status, Not started · Draft · Published, and Publish (A3, A4) | *Ruled.* Pending edits are the history item's. |
| Not linked, overlaps and over max block Save | Nothing blocks Save or Publish (A64) | *Ruled.* |
| The Table narrowed by committed status and lane, apart from the Timeline's Filters | One rail narrows the lanes and the resources, in the Timeline and the Table alike (A91–A96) | *Ruled 17 Oct.* |
| One resource per bin | Split loads (A70–A73) | *Ruled.* |
| The ranking and the rules inside the board | The app's `fit` on e3; `Allocation.fit` its building block (§12) | *Ruled.* |
| No Find fix | Find a fit (A74) | *Ruled.* |
| A link to a far lane detours to the hour's edge round the cards between | It crosses them, cased (§11) | *Ruled.* |
| Links out of view end in a cap at the pane's edge | Plan's stub (§11) | *Ruled.* |
| Spec and grade, booked and measured, are built into the bin | The app's bin values `V`, shown through `columns`, flagged through `check` (§3.3) | *Ruled.* The mock's views are kept. |
| Its own toolbar row, popover and history buttons, drawn to look like e3's | The shared Toolbar, Slice rail, history item and BuilderFrame | The shared parts. Nothing is lost. |
| No narrow form | Explicit-action cards below 480px of main (A78) | Every builder has one. |
| Spec booked / measured: `S1`…, grades `A3`…; the hold from a grade code | The app's values; the hold an event accessor | The board names no domain. |

## 15. Wires

- **UI.** A new carrier, `Allocation`, as `Roster` and `StudioBuilder` are; no
  existing wire changes. The Roster's payload gains an optional `fit` binding.
  Packages are re-exported (`WIRE_MIGRATION.md`).
- **Stored state.** A new record type, `Allocation.Types.Days(V)`; no existing
  stored form changes, so no repository upgrade step. Once released, a change to it
  ships one.

## 16. The sub-issues, in landing order

1. The spec and the mock: this file, `Allocation Spec.html` on the yard's data, its
   renders.
2. Shared links: Plan's link parts into `shared/links/`, Plan onto them, its tests
   unchanged; then a selected link's × and the link-drag preview.
3. The shared Chooser.
4. The shared day reader, TimeNavigator's `dayMarker`, and `shared/func/`; Roster
   and Experiment onto them.
5. e3-ui: the types, adapters, pure functions (`loads`, `candidates`, `fit`,
   `answer`, `lookahead`, `check`, `slots`), the tag, payload and
   carrier; the yard's records and fit; examples and specs.
6. The frame, the toolbar, the session and Publish (A1–A7, A75–A77, A79, A80).
7. The Timeline: lane grid, link channel, resource rows, focus (A8–A21).
8. Links on the Timeline (A65–A69).
9. Fits and drops: the fit calls, ranks, refusals, captions, drop list (A22–A40,
   F1–F4).
10. The Table and the Chooser in it (A41–A49).
11. One record Slice over the lanes and the resources (A91–A96): `Slice.bindRecords`,
    its rail, `Allocation.lanes`.
12. The Library (A50–A54).
13. The Inspector and Issues (A55–A64).
14. Split loads and Find a fit (A70–A74).
15. The narrow layout (A78).
16. The Roster's fit (R1–R5).
17. The kiln yard in the showcase on e3-web, its responsive specs, the e3-ui skill
    and the plugin indexes.
