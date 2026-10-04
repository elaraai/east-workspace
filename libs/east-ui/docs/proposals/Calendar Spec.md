# Calendar — design

The e3-ui `Calendar`: an editable calendar over e3 records. Events of several
kinds are scheduled across resources of several kinds; every kind, of either
sort, is its own record with its own row type. It is laid out in
`BuilderFrame` as Studio's builder and the query builder are, it has drag and
drop throughout, and it replaces east-ui's heatmap `Calendar`.

This document is the design the Calendar epic builds. Each sub-issue copies
the sections it owns. `Calendar Spec.html` beside it is the visual design.

## 0. The files

| File | What it is |
|---|---|
| `Calendar Spec.html` | The hi-fi mock: Claude Design's "Calendar Editor v2" export, its sample data moved to metal fabrication, self-contained but for React 18 (unpkg), Font Awesome (cdnjs) and the fonts (Google Fonts). |
| `Calendar Spec.png` and `Calendar Spec - <view>.png` | Resting renders of the week, month, resources, timeline and inspector views and the dark theme, for people browsing the repo. They are generated from the mock and never read by an agent. |
| `Calendar Spec.md` | This design. |

**Opening the mock.** Open the file in a browser. Every view and state is
reachable by URL parameter:

| Parameter | Values | Default |
|---|---|---|
| `layout` | `calendar`, `resource`, `timeline` | `calendar` |
| `span` | `day`, `week`, `month` (the product's `period`) | `week` |
| `theme` | `light`, `dark` | `light` |
| `density` | `compact`, `comfortable`, `spacious` | `comfortable` |
| `weekends` | `false` hides Saturday and Sunday | shown |
| `select` | event ids, comma-separated (`e12`, `e10,e11,e12`) | none |
| `left`, `right` | `0` collapses that pane to its rail | open |
| `tab` | `templates`, `backlog` | `templates` |
| `now` | `HH:MM` pins the clock the now line marks | the clock |

For example `Calendar Spec.html?layout=timeline&span=week&now=10:30`, or
`?select=e12` for the inspector on an event that overlaps another. The mock's
"today" is Thursday 1 October 2026. Opened from disk, the runtime's re-read of
its own page is refused by the browser's `file://` rule and logged as a console
error; the page works either way, and served by any static server it is not
logged. The mock is a desktop design: at phone width its panes stay open. The
product's phone behaviour is `BuilderFrame`'s (§7).

An agent measures the mock in a headless browser, through its DOM; nobody
reads a screenshot.

## 1. Summary

- **What.** `<Calendar.Builder>` plans events across resources and time.
  `<Calendar.View>` is the same calendar, read-only.
- **Where.** The interface is in e3-ui (`libs/east-ui/packages/e3-ui/src/calendar/`)
  and the renderer in e3-ui-components (`src/calendar/`), as Studio's and the
  query builder's are. It binds records, so it is an e3 component.
- **Slots.** One per record. `events={{ … }}` takes one entry per event kind: a
  record with its own row type, bound with its patch mutation.
  `resources={{ … }}` takes one entry per resource kind: rows of their own type,
  read only.
- **Draws.** `BuilderFrame`: one toolbar; the library (Templates · Backlog) in
  the start pane; the calendar, resource columns or timeline in main; the
  inspector in the end pane; a status footer.
- **Built in.** Drag and drop: templates and backlog rows onto the calendar,
  moving, resizing, drag-to-create, and back to the backlog. Undo and redo,
  Apply, and overlap warnings. The app wires none of it.
- **Replaces.** east-ui's `Calendar`, the day × week heatmap, which is removed.

## 2. Decisions

These are settled.

1. **`Calendar` is in e3-ui**, record-bound like Studio and the query builder.
   east-ui's heatmap `Calendar` is removed with its renderer, recipe, examples
   and showcase page; its job, intensity by day, is what Plan's heat rows do.
2. **A kind is a record.** One slot per event record and one per resource kind,
   each with its own row type.
3. **The backlog is a kind's unscheduled rows**: its start and end are `Option`
   fields, and none means not scheduled. A kind whose times are plain
   `DateTime` has no backlog.
4. **No type change.** The mock's Type select would move a row between records
   of different types, a delete and an insert in two commits. An event keeps
   its kind; delete it and drop a template instead.
5. **Field names for what gestures write** (`title`, `start`, `end`,
   `resource`, `status`), and accessors only for what is not a field (a
   resource's label and meta, a backlog row's duration and due).
6. **Templates are data**, declared with their kind: a value for every field
   but the start, end and resource fields. A template computed from its drop
   is out of scope.
7. **Times show as stored**, in UTC, as Plan's time axis does: no time-zone
   conversion.
8. **Overlaps** on one resource are the built-in conflict. They warn and never
   block Apply.
9. **Large records** are read through a record index on the days an event
   touches (`Calendar.days`); otherwise a record is read whole.
10. **The inspector's form is a shared part**, `Fields`, that any builder can
    use; `Calendar.field` is `Fields`.
11. **`period`** names Day · Week · Month, not `resolution`: it is the stretch
    shown, not the size of a column.
12. **Event kinds follow Plan's series conventions** (accessors, keys,
    `ready`, drops), with the three differences in §6, and the timeline shares
    Plan's time parts in the renderer.
13. **The mock's sample data is metal fabrication**: presses, lathes, brackets,
    housings, calibration and torque checks. Nothing names a client or
    winemaking, in the mock, the examples, the showcase or the tests.

## 2a. Example data idiom

Data an example or a test needs is an East value bound once with
`$.let(value, Type)` inside the East body, and its variable is reused; never a
module-scope TypeScript constant, and never a TypeScript helper that builds one
(`no-host-in-east-block`, `no-module-scope-east-macro`). Times are East values:
a time of day is `{ hour: 6n, minute: 0n }`, a duration `variant("hours", 8)`.

## 3. The authoring surface

### 3.1 The records an app declares

The calendar takes records as the app models them. Nothing in a record is a
calendar type. Of each event kind it needs a title, a start and an end, and
optionally the resource it is on, all named as fields of the app's row type.

```ts
// records.ts
import { ArrayType, BooleanType, DateTimeType, DictType, FloatType, IntegerType, NullType, OptionType, SetType, StringType, StructType, VariantType } from "@elaraai/east";
import e3 from "@elaraai/e3";

export const StatusType = VariantType({ tentative: NullType, confirmed: NullType, in_progress: NullType, done: NullType });
export const ChecklistType = ArrayType(StructType({ item: StringType, done: BooleanType }));

// Resources: one record per kind, each its own row type.
export const PersonType  = StructType({ name: StringType, role: StringType });
export const MachineType = StructType({ name: StringType, area: StringType });
export const SiteType    = StructType({ name: StringType, address: StringType });

export const people   = e3.record("people",   DictType(StringType, PersonType),  new Map());
export const machines = e3.record("machines", DictType(StringType, MachineType), new Map());
export const sites    = e3.record("sites",    DictType(StringType, SiteType),    new Map());

// Events: one record per kind, each its own row type.
export const ShiftType = StructType({
    title:     StringType,
    start:     DateTimeType,
    end:       DateTimeType,
    person:    OptionType(StringType),        // a key of `people`; none is unassigned
    status:    StatusType,
    role:      VariantType({ operator: NullType, technician: NullType, supervisor: NullType }),
    crew:      IntegerType,
    break_min: IntegerType,
    skills:    SetType(StringType),
    handover:  ChecklistType,
});

export const JobType = StructType({
    title:      StringType,
    start:      OptionType(DateTimeType),     // none: not scheduled yet, so the job is in the backlog
    end:        OptionType(DateTimeType),
    machine:    OptionType(StringType),       // a key of `machines`
    status:     StatusType,
    work_order: StringType,
    priority:   VariantType({ p1: NullType, p2: NullType, p3: NullType, p4: NullType }),
    technician: OptionType(StringType),       // a second key of `people`, edited in the inspector
    estimate_h: FloatType,                    // how long it takes, in hours, which sizes it when it is scheduled
    due:        OptionType(DateTimeType),
    parts:      SetType(StringType),
    procedure:  ChecklistType,
});

export const InspectionType = StructType({
    title:     StringType,
    start:     DateTimeType,
    end:       DateTimeType,
    target:    OptionType(VariantType({ site: StringType, machine: StringType })),  // a site or a machine
    status:    StatusType,
    inspector: OptionType(StringType),
    standard:  VariantType({ safety_walk: NullType, iso_9001: NullType, iso_45001: NullType }),
    checks:    ChecklistType,
});

export const shifts      = e3.record("shifts",      DictType(StringType, ShiftType),      new Map());
export const jobs        = e3.record("jobs",        DictType(StringType, JobType),        new Map());
export const inspections = e3.record("inspections", DictType(StringType, InspectionType), new Map());
export const shiftsPatch      = e3.mutation.patch(shifts);
export const jobsPatch        = e3.mutation.patch(jobs);
export const inspectionsPatch = e3.mutation.patch(inspections);
```

A job's start and end are `Option<DateTime>`: a job with neither is not
scheduled yet, which puts it in the backlog. An inspection's target is a
variant, a site or a machine, so one event kind can sit on resources of two
kinds.

### 3.2 The smallest builder

```tsx
// rota.tsx
import { East } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui";
import { Calendar, Record, ui } from "@elaraai/e3-ui";
import * as d from "./records.js";

export const rota = ui("rota", [], East.function([], UIComponentType, _$ => (
    <Reactive>{$ => {
        const people = $.let(Record.bind(d.people, []));
        const shifts = $.let(Record.bind(d.shifts, [d.shiftsPatch]));
        return (
            <Calendar.Builder
                resources={{
                    people: Calendar.resources(people.read(), { name: "People", icon: "user", label: p => p.name }),
                }}
                events={{
                    shift: Calendar.events(shifts, {
                        name: "Shift", icon: "user-clock",
                        title: "title", start: "start", end: "end",
                        resource: { field: "person", of: "people" },
                    }),
                }}
            />
        );
    }}</Reactive>
)));
```

That is a working editor. Every other field of a shift shows in the inspector
with the editor its East type gives it. Shifts drag, resize and move between
people. Every gesture is a draft the toolbar can undo, and Apply commits them
as one patch through `shiftsPatch`.

### 3.3 The operations calendar

The mock's surface: three event kinds on three resource kinds, with
templates, a backlog, statuses and field editors.

```tsx
// operations.tsx
import { East, none, some, variant } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui";
import { Calendar, Record, ui } from "@elaraai/e3-ui";
import * as d from "./records.js";

export const operations = ui("operations", [], East.function([], UIComponentType, _$ => (
    <Reactive>{$ => {
        const people      = $.let(Record.bind(d.people, []));
        const machines    = $.let(Record.bind(d.machines, []));
        const sites       = $.let(Record.bind(d.sites, []));
        const shifts      = $.let(Record.bind(d.shifts, [d.shiftsPatch]));
        const jobs        = $.let(Record.bind(d.jobs, [d.jobsPatch]));
        const inspections = $.let(Record.bind(d.inspections, [d.inspectionsPatch]));
        // How the status field's cases show: every kind shares StatusType, so it is bound once.
        const status = $.let({
            tentative:   { label: "Tentative",   tone: variant("neutral", null), ring: true },
            confirmed:   { label: "Confirmed",   tone: variant("success", null), ring: false },
            in_progress: { label: "In progress", tone: variant("info", null),    ring: false },
            done:        { label: "Done",        tone: variant("neutral", null), ring: false },
        }, Calendar.Types.StatusCases(d.StatusType));
        const handover = $.let([
            { item: "Line status logged", done: false },
            { item: "Open work orders reviewed", done: false },
            { item: "Area clean", done: false },
        ], d.ChecklistType);
        return (
            <Calendar.Builder
                resources={{
                    people:   Calendar.resources(people.read(),   { name: "People",   icon: "user",         label: p => p.name, meta: p => some(p.role) }),
                    machines: Calendar.resources(machines.read(), { name: "Machines", icon: "gears",        label: m => m.name, meta: m => some(m.area) }),
                    sites:    Calendar.resources(sites.read(),    { name: "Sites",    icon: "location-dot", label: s => s.name }),
                }}
                events={{
                    shift: Calendar.events(shifts, {
                        name: "Shift", icon: "user-clock",
                        title: "title", start: "start", end: "end",
                        resource: { field: "person", of: "people" },
                        status: { field: "status", cases: status },
                        fields: {
                            role:      Calendar.field.select({ labels: { operator: "Operator", technician: "Technician", supervisor: "Supervisor" } }),
                            crew:      Calendar.field.number({ label: "Crew size", unit: "people", min: 1n, max: 20n }),
                            break_min: Calendar.field.number({ label: "Break", unit: "min", step: 15n, min: 0n, max: 120n }),
                            skills:    Calendar.field.tags({ label: "Skills required", options: ["Forklift", "First aid", "Hot work", "Confined space"] }),
                            handover:  Calendar.field.checklist({ label: "Handover" }),
                        },
                        templates: [
                            { key: "day", name: "Day shift", group: "Operations", at: { hour: 6n, minute: 0n }, duration: variant("hours", 8),
                              values: { title: "Day shift", status: variant("tentative", null), role: variant("operator", null),
                                        crew: 1n, break_min: 30n, skills: new Set(), handover } },
                            { key: "night", name: "Night shift", group: "Operations", at: { hour: 22n, minute: 0n }, duration: variant("hours", 8),
                              values: { title: "Night shift", status: variant("tentative", null), role: variant("operator", null),
                                        crew: 1n, break_min: 30n, skills: new Set(), handover } },
                        ],
                    }),
                    job: Calendar.events(jobs, {
                        name: "Maintenance", icon: "screwdriver-wrench",
                        title: "title", start: "start", end: "end",   // Options, so unscheduled jobs are the backlog
                        resource: { field: "machine", of: "machines" },
                        status: { field: "status", cases: status },
                        backlog: { duration: job => variant("hours", job.estimate_h), due: job => job.due },
                        fields: {
                            work_order: Calendar.field.text({ label: "Work order", mono: true, placeholder: "WO-0000" }),
                            priority:   Calendar.field.select({ labels: { p1: "P1 · critical", p2: "P2 · high", p3: "P3 · normal", p4: "P4 · low" } }),
                            technician: Calendar.field.resource({ of: "people" }),
                            estimate_h: Calendar.field.number({ label: "Estimate", unit: "h", step: 0.5, min: 0 }),
                            parts:      Calendar.field.tags({ options: ["Bearing 6204", "V-belt A42", "Seal kit", "Air filter"] }),
                            procedure:  Calendar.field.checklist({}),
                        },
                        templates: [
                            { key: "pm", name: "Preventive maintenance", group: "Operations", at: { hour: 9n, minute: 0n }, duration: variant("hours", 2),
                              values: { title: "Preventive maintenance", status: variant("tentative", null), work_order: "",
                                        priority: variant("p3", null), technician: none, estimate_h: 2, due: none,
                                        parts: new Set(), procedure: [{ item: "Isolate and lock out", done: false }, { item: "Test run", done: false }] } },
                        ],
                    }),
                    inspection: Calendar.events(inspections, {
                        name: "Inspection", icon: "clipboard-check",
                        title: "title", start: "start", end: "end",
                        resource: { field: "target", of: { site: "sites", machine: "machines" } },   // a site or a machine
                        status: { field: "status", cases: status },
                        fields: {
                            inspector: Calendar.field.resource({ of: "people" }),
                            standard:  Calendar.field.select({ labels: { safety_walk: "Safety walk", iso_9001: "ISO 9001", iso_45001: "ISO 45001" } }),
                            checks:    Calendar.field.checklist({ label: "Checklist" }),
                        },
                        templates: [
                            { key: "walk", name: "Safety walk", group: "Operations", at: { hour: 11n, minute: 0n }, duration: variant("hours", 1),
                              values: { title: "Safety walk", status: variant("tentative", null), inspector: none,
                                        standard: variant("safety_walk", null), checks: [{ item: "Walkways clear", done: false }] } },
                        ],
                    }),
                }}
                view={{ layout: "calendar", period: "week" }}
                hours={{ from: 6n, to: 22n }}
            />
        );
    }}</Reactive>
)));
```

### 3.4 A large record, read by time window

By default a kind's record is read whole, as Studio's pages are. For a large
one, give it an index on the days each event touches and pass a paged read of
it as `window`. The calendar finds the first day in view and reads until it
passes the last, so it holds only what it shows. Apply still commits through
the record's patch mutation.

```ts
// records.ts — each shift appears once under every day it touches.
export const shiftsByDay = e3.recordIndex("shifts_by_day", shifts, {
    keys: East.function([StringType, ShiftType], SetType(DateTimeType), ($, _id, shift) => {
        const days = $.const(Calendar.days);
        return days(shift.start, shift.end);
    }),
});
```

```tsx
// operations.tsx
const shifts    = $.let(Record.bind(d.shifts, [d.shiftsPatch]));
const shiftDays = $.let(Data.bindPaged(d.shifts, { index: d.shiftsByDay, join: true }));
// …
shift: Calendar.events(shifts, { window: shiftDays, title: "title", start: "start", end: "end", /* … */ }),
```

`Calendar.days(start, end)` is an East function: the UTC midnights of every
day from the start's to the end's, leaving out an end that falls exactly on
midnight. A kind with a backlog reads its unscheduled rows through a second
index, keyed by `Calendar.unscheduled(start, due)` (the row's due date when it
has no start, nothing otherwise), passed as `backlogWindow`.

### 3.5 Refusing a drop, and the app's own check

```tsx
<Calendar.Builder
    // …
    canDrop={East.function([Calendar.Types.Candidate], OptionType(StringType), ($, drop) =>
        East.less(drop.start.getHour(), 6n).ifElse(
            () => some("Nothing starts before 06:00"),
            () => none,
        ))}
/>
```

The structural refusals are built in: a slot whose resource is a kind the
event kind doesn't take shows the red ghost "Needs people". `canDrop` adds the
app's own, its message on the ghost; it is asked while the drag rests on a slot
and once more at the drop. A kind's `ready` is the app's check on a drafted
event, as Plan's `editing.ready` is: a refusal blocks Apply and names the event
and the field.

```tsx
job: Calendar.events(jobs, {
    // …
    ready: (job, _key) => job.work_order.equal("").ifElse(
        () => variant("incomplete", [{ field: "work_order", message: "A scheduled job needs its work order" }]),
        () => variant("ready", null),
    ),
}),
```

## 4. The options

### 4.1 `Calendar.events(record, config)` — an event kind

The record comes first, as a `Record.bind` handle bound with its patch
mutation. The handle carries the row type, so every field name is checked
against it at compile time: `start: "title"` fails because `title` is not a
DateTime field. A name that only means something at build time fails there,
naming itself: `of: "peeple"` fails because no resource slot is called that. A
record may be keyed by any type: the calendar names an event by its key's text,
a String as itself and any other key as East prints it, as Plan and
`Record.onApply` do. Every accessor takes the row and its key,
`(row, key) => …`, and one that is optional returns an `Option`.

| Option | Takes | What it does |
|---|---|---|
| `name`, `icon` | string | The kind's name and Font Awesome icon, on its events, in the filter and the inspector. |
| `title` | a `String` field | The event's title, drawn on its block and edited in the inspector. |
| `start`, `end` | `DateTime` fields, or `Option<DateTime>` | When it runs. A move, a resize or a schedule writes them. Options give the kind a backlog. |
| `resource` | `{ field, of }` | The resource it is on. A `String` or `Option<String>` field holds keys of one resource kind (`of: "people"`). A variant field holds one kind per case (`of: { site: "sites", machine: "machines" }`). Omitted, the kind's events sit on no resource. |
| `status` | `{ field, cases }` | A variant field shown as the event's status: per case a label, a tone (`success`, `warning`, `danger`, `info`, `neutral`) and an open ring, as a `Calendar.Types.StatusCases(V)` value. Edited as a select in the Schedule section. |
| `backlog` | `{ duration, due? }` | For a kind whose times are Options: how long an unscheduled row takes (a `Calendar.Types.Duration`), which sizes it when it is dropped; and when it is due (`Option<DateTime>`), which groups the Backlog tab. Both accessors. |
| `fields` | `{ [field]: Calendar.field.* }` | Editors for the inspector's fields, in this order; the row's other fields follow in declared order with the editor their type gives. |
| `templates` | `CalendarTemplate[]` | Presets the Templates tab lists (§4.4). |
| `ready` | `(row, key) => Editing.Types.Readiness` | The app's check on a drafted event. A refusal blocks Apply and names the event and field. |
| `window`, `backlogWindow` | `Data.bindPaged` handles over a day index and an unscheduled index | Read the days in view, and the backlog, through record indexes instead of the whole record (§3.4). |

### 4.2 `Calendar.resources(rows, config)` — a resource kind

Rows are read from any `Dict<K, R>`, usually a record's `read()`. The calendar
never writes them; their keys are what an event's resource field holds.

| Option | Takes | What it does |
|---|---|---|
| `name`, `icon` | string | The kind's name and icon: column and row headers, the timeline's group, the filter. |
| `label` | `(row, key) => String` | A resource's name. |
| `meta` | `(row, key) => Option<String>` | Its second line. The calendar adds the hours booked in view. |

### 4.3 The inspector's fields: `Fields`, as `Calendar.field`

The inspector shows the selected event's Schedule section — resource, date,
start and end, status — and then its kind's other fields. Each field's editor
comes from its East type; a hint only adds what a type cannot say.

| Field type | Editor with no hint | Hint |
|---|---|---|
| `String` | Text | `text({ label?, placeholder?, mono? })` |
| `Integer`, `Float` | Number stepper (−/+, Shift for ×10) | `number({ label?, unit?, step?, min?, max? })`, bigints for an Integer field |
| `Boolean` | Checkbox | — |
| `DateTime` | Date and time | — |
| A variant of empty cases | Select; a case's name spelled out (`in_progress` → "In progress") | `select({ label?, labels? })` |
| `Set<String>`, `Array<String>` | Tags, typed freely | `tags({ label?, options?, free? })`: options as dashed `+ option` chips |
| `Array` of a struct with one String and one Boolean field | Checklist with its progress | `checklist({ label?, text?, done? })` names the fields when there are several |
| A key of a resource kind | Text: a String can't say whose key it is | `resource({ label?, of })`: a select of that kind's resources, "Unassigned" first for an Option |
| A struct | Its fields, grouped under its name | a hint per nested field, by path |
| `Option<T>` | T's editor, which can be cleared | T's hint |
| Anything else | Printed, read-only | `readonly()`; `hidden()` hides any field |

`Fields` lives in east-ui (`src/contracts/fields.ts`: the hints, the closed
`FieldSpecType`, and `fieldSpecs(R, hints)`, which resolves a struct's fields
and hints into specs) and draws in east-ui-components (`FieldForm`, over a
decoded struct value). Any builder's inspector can use it.

### 4.4 Templates

```ts
interface CalendarTemplate<R extends StructType> {
    key: string;                               // unique within the kind
    name: string;                              // the card's name
    group?: string;                            // the Templates tab's group
    at?: SubtypeExprOrValue<Clock>;            // when it starts if dropped on a whole day: { hour: 6n, minute: 0n }
    duration: SubtypeExprOrValue<Duration>;    // how long it runs: variant("hours", 8)
    values: SubtypeExprOrValue<ValuesOf<R>>;   // a value for every field but the start, end and resource fields
}
```

### 4.5 `Calendar.Builder` props

| Prop | Takes | What it does |
|---|---|---|
| `events` | `{ [kind]: Calendar.events(…) }` | The event kinds, at least one, in this order everywhere. |
| `resources` | `{ [kind]: Calendar.resources(…) }` | The resource kinds, in this order everywhere. |
| `view` | `{ layout?, period?, date? }` | The first view: `"calendar"` (default), `"resources"` or `"timeline"`; `"day"`, `"week"` (default) or `"month"`; the date shown (today by default). The viewer's own changes persist per builder after that. |
| `hours` | `{ from, to }` | Working hours, whole hours of the day; the rest is shaded. 06–22 by default. |
| `week` | `{ start?, weekends? }` | The first day of the week (`"monday"` by default) and whether Saturday and Sunday show. |
| `density` | `"compact"`, `"comfortable"`, `"spacious"` | The hour and lane heights (§8). |
| `now` | `DateTime` | The instant the now line marks; the clock when omitted. A test or a showcase pins it. |
| `canDrop` | `Fn(Calendar.Types.Candidate) → Option<String>` | The app's refusals, with their message. |
| `id` | string | Names the builder when a surface holds two: its view state's storage key and its library's drag-source ids. |

## 5. The East types

### 5.1 What an app author meets: `Calendar.Types`

```ts
Calendar.Types.Layout      = VariantType({ calendar: NullType, resources: NullType, timeline: NullType });
Calendar.Types.Period      = VariantType({ day: NullType, week: NullType, month: NullType });
Calendar.Types.View        = StructType({ layout: Layout, period: Period, date: DateTimeType });
Calendar.Types.ResourceRef = StructType({ kind: StringType, key: StringType });   // a resource: its kind's slot name, its key's text
Calendar.Types.EventRef    = StructType({ kind: StringType, key: StringType });   // an event: its kind's slot name, its record key's text
Calendar.Types.Status      = StructType({ label: StringType, tone: StatusTokenType, ring: BooleanType });
Calendar.Types.StatusCases(V)                                                     // one Status per case of a status variant V
Calendar.Types.Clock       = StructType({ hour: IntegerType, minute: IntegerType });   // a time of day
Calendar.Types.Duration    = TimeStepType;   // the time contract's: minutes, hours, days, weeks or months, as a Float
Calendar.Types.Candidate   = StructType({                                         // what canDrop is asked about
    kind:     StringType,
    from:     VariantType({ template: StringType, backlog: StringType, event: StringType }),
    start:    DateTimeType,
    end:      DateTimeType,
    resource: OptionType(ResourceRef),
});
```

### 5.2 What the renderer receives: the payload

Each kind's row type is closed behind East functions over beast2 bytes, so the
payload is one type whatever the records hold: Plan's editing wire uses the same
mechanism. The calendar depends on the shared contracts — `Editing`, the drag
grammar, the `Library` card types, `BuilderFrame` — never on Plan's or Sheet's
internals.

```ts
CalendarBuilderPayloadType = StructType({
    events:    ArrayType(CalendarKindType),        // the event kinds, in slot order
    resources: ArrayType(CalendarResourcesType),   // the resource kinds, their rows resolved: { key, name, icon, rows: [{ key, label, meta }] }
    settings:  CalendarSettingsType,               // the first view, week start, weekends, working hours, density, now
    canDrop:   OptionType(FunctionType([Candidate], OptionType(StringType))),
    id:        OptionType(StringType),
});

CalendarKindType = StructType({
    key: StringType, name: StringType, icon: StringType,
    takes:       ArrayType(StringType),            // the resource kinds its events may be on
    status:      ArrayType(StructType({ case: StringType, status: Status })),
    backlog:     BooleanType,                      // its rows with no time are its backlog
    templates:   ArrayType(CalendarTemplateType),  // each template's values as bytes
    fields:      ArrayType(FieldSpecType),         // the inspector's form (Fields)
    // The record, closed: every row crosses as bytes at the record's own entry type.
    items:       FunctionType([DateTimeType, DateTimeType, DictType(StringType, BlobType)], OptionType(ArrayType(CalendarItemType))),
    unscheduled: FunctionType([DictType(StringType, BlobType)], OptionType(ArrayType(CalendarItemType))),
    write:       FunctionType([ArrayType(CalendarWriteType)], ArrayType(OptionType(BlobType))),
    editing:     EditingType,                      // the shared session over the record: entry and key types, its patch door
    history:     FunctionType([], OptionType(ArrayType(RecordCommitInfoType))),
});

CalendarItemType = StructType({                    // one event, as every view draws it
    kind: StringType, key: StringType, title: StringType,
    start: OptionType(DateTimeType), end: OptionType(DateTimeType),   // none: in the backlog
    resource: OptionType(ResourceRef),
    status:   OptionType(Status),
    minutes:  IntegerType,                          // its length, or a backlog row's duration
    due:      OptionType(DateTimeType),
});

CalendarWriteType = StructType({                   // one gesture, written into one entry through the kind's fields
    id: StringType, entry: BlobType,
    gesture: VariantType({
        place:   StructType({ start: DateTimeType, end: DateTimeType, resource: OptionType(ResourceRef) }),   // move, resize, schedule
        unplace: NullType,                                                                                     // back to the backlog
        field:   StructType({ path: ArrayType(StringType), value: BlobType }),                                 // an inspector edit
        create:  StructType({ template: StringType, start: DateTimeType, end: DateTimeType, resource: OptionType(ResourceRef) }),
    }),
});
```

`items` takes the window and the drafts by id, and draws a draft exactly as
Apply would leave it. `write` turns a gesture into the entry's new bytes
through the kind's field names, so the renderer never needs the row type.

## 6. How it relates to Plan

An event kind is to the calendar what a series is to Plan: one kind of row,
declared over its data with accessors and with the field names a gesture
writes. The calendar follows Plan's series wherever the two mean the same
thing:

| The same as Plan's series | In the calendar |
|---|---|
| Accessors `(entry, key) => …`, an optional one returning an `Option` | A resource's `label` and `meta`; a backlog row's `duration` and `due` |
| Field names for what a gesture writes (`edit.start`, `edit.end`) | `start`, `end` and `resource` |
| Entries keyed by any type, named by their key's text | The same |
| `editing.ready` | `ready` on each kind |
| Drops from `Library` cards through the shared drag grammar; `canDrop` asked while resting and at the drop | The same |
| A closed payload: entries cross as bytes at their exact type; a draft drawn by deriving it as Apply would leave it | The same mechanism in `items` and `write` |

It differs in three places on purpose:

- **Each kind has its own record.** Plan's series all read one `data`; the
  calendar takes a record per kind, each its own type.
- **One field name both draws an event and takes its gesture.** Plan reads a
  row's items through accessors and names its write fields under `edit`,
  because its items live in an array inside an entry. A calendar row is one
  event.
- **A dropped card needs no function.** Plan's `edit.create(drop, entry, key)`
  builds an item; the calendar's cards are templates and backlog rows, whose
  values are data.

**Shared in the renderer.** The Timeline layout is a Plan canvas in shape. The
time scale (units, ticks, the panning window), lane packing, the drag machine
(snapping, ghosts, refusals), the now line and weekend and night shading become
React parts both renderers use, taken out of Plan's renderer once
(`east-ui-components/src/shared/time/`). The calendar never composes `<Plan>`
and its payload holds none of Plan's types. In the timeline, Day · Week · Month
set the zoom, which is Plan's `resolution`; in the calendar layout the same
control sets the stretch shown, hence `period`.

## 7. Layout in BuilderFrame

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│ History · Calendar Resources Timeline · Day Week Month · <Today> · Filter · Apply │
│          28 Sep - 4 Oct 2026                           2 conflicts (a warn chip)  │
├───────────────────────────────────────────────────────────────────────────────────┤
│ banners: an Apply's refusals and conflicts, by kind                               │
├──────────────┬────────────────────────────────────────────────┬───────────────────┤
│ LIBRARY      │ main: the view                                 │ INSPECTOR         │
│ Templates    │  Calendar   time grid (day, week) or month     │ one event: header,│
│ Backlog      │  Resources  a column per resource, one day     │  Schedule, fields │
│ search       │  Timeline   a row per resource, pans in time   │ several: bulk edit│
│ cards (drag) │                                                │ none: hints       │
├──────────────┴────────────────────────────────────────────────┴───────────────────┤
│ footer: 42 events · 6 in backlog · 3 pending · saved 14:02                        │
└───────────────────────────────────────────────────────────────────────────────────┘
```

| Region | Holds |
|---|---|
| Toolbar | The history item (undo · redo · discard), Calendar · Resources · Timeline, Day · Week · Month, ‹ Today ›, the range and its week, the resource-kind filter, the conflicts chip, Apply. The shared `Toolbar` folds what doesn't fit. |
| Banners | An Apply's refusals and conflicts, by kind. |
| Start pane "Library" | Tabs Templates · Backlog, each a `Library` (§9.4). |
| Main | The view (§8). |
| End pane "Inspector" | The selection (§9.5). |
| Footer | `42 events · 6 in backlog · 3 pending · saved 14:02`. |

The panes are `BuilderFrame`'s: pinned beside main while main keeps 480px,
overlaid with a rail and a scrim on a phone (560px and narrower), and slid off
main during a drag so they never hide a drop target. The builder fills its
parent and draws no border of its own. The mock's two control rows fold into
the one toolbar, and its read-outs move to the footer. Every style is a slot
recipe's: renderers set data attributes and geometry only.

## 8. The views — anatomy, from the mock

Sizes are the mock's (`comfortable` unless said). Each view's sub-issue holds
these with visual invariants in the showcase's responsive suite.

**Toolbar (mock).** At least 60px tall, padding 12px 20px. History buttons
32×32. Segments 30px tall in mono 10.5px uppercase. In the product the toolbar
is the shared `Toolbar`.

**Panes (mock).** Library 272px and Inspector 320px open, 44px as rails; the
column change animates over `--dur-base` on `--ease-out`. A pane's tab row is
44px. The Library's search band is padding 12px 14px on paper-2, around a 32px
input.

**Navigation (mock's band, the product's toolbar).** Prev · Today · Next in a
28px group; the range label in DM Sans 15px 700; under it, in mono 10.5px, the
ISO week and the events in view (`W40 · 42 events`); the kind filter in 26px
buttons.

**Time grid** (Day, Week, Resources):
- a sticky header 52px tall over a 56px hour gutter; hour labels mono 10px;
- an hour is 48px (36 compact, 64 spacious); hour lines in the rule colour,
  and half-hour lines at 45% of it when an hour is 48px or more;
- outside working hours (06–22 by default) shaded paper-2, and weekend columns
  paper-2;
- a day column's header: weekday mono 10px, date mono 16px (today 700 in the
  brand), and `N events` mono 9.5px. A resource column's: its kind's icon, its
  name 12.5px 600, its meta and hours booked that day mono 9.5px;
- columns at least 112px (Week), 240px (Day) or 104px (Resources) wide, past
  which main scrolls sideways;
- an event block: radius 4, a 1px border, inset 2px left and 4px narrower than
  its lane, at least 16px tall. Narrow (lane < 56px): icon only, with the
  overlap mark. Short (< 36px tall): icon, title 11.5px 600, overlap mark. Long:
  a row of icon, time mono 10px and overlap mark, then the title 12px 600
  (wrapping when the lane is ≥ 110px), then a sub-line 11px (its resource, or
  its kind in Resources) when ≥ 64px tall and the lane ≥ 90px. A block
  continuing from the day before shows `↳` before its time;
- 6px resize handles at its top and bottom edges, where it starts or ends that
  day; selected, an 18×4px brand tab at each;
- the now line: 1.5px brand across today's column, a 7px dot at its start,
  and the time in the gutter on a brand chip, mono 9.5px.

**Month grid:** a 30px weekday row in mono 10px; cells padded 6px, their date
mono 11px (`1 Oct` on the first; today 700 in the brand, with a `TODAY` tag);
days outside the month on paper-2; event chips 21px tall, padding 0 6px — icon
8.5px, the start time mono 10px when a column is ≥ 120px wide, title 11.5px
600, overlap mark — as many as fit, then `+N more`.

**Timeline:**
- a 52px header: a 24px units row (`Thu 1 Oct 2026`, `W40 · 28 Sep – 4 Oct`,
  `October 2026`) over a 27px ticks row (hours, `Thu 1`, dates);
- a 184px sticky resource column: name 12.5px 600 and meta with the hours
  booked in view, mono 9.5px;
- rows grouped by resource kind under 28px group strips (icon, name, count);
- a row is its lanes × the lane height (32px; 26 compact, 40 spacious; at
  least 30 at Month) plus 9px; a bar sits 4px down its lane, the lane height
  less 4px tall, 1px in from its ends, radius 4 (2 under 8px wide);
- a bar shows its title from 36px wide, its icon from 56px, its time from
  110px, nothing under 16px; at Month bars span whole days with no handles;
  6px start and end handles where the bar's edge is in the window;
- zoom: 1920px a day at Day (15 days loaded), 216px at Week (56 days), 40px
  at Month (154 days). Weekends shaded; at Day, nights shaded too.

**Inspector:**
- sections padded 16px with a rule between.
- **One event:**
  - header: a 22px icon tile, the kind's name as an eyebrow, a Pending or New
    chip, the title in DM Sans 17px 700, `Thu 1 Oct · 06:00–14:00 · Fox, A.`
    mono 10.5px, and the status;
  - the overlaps banner (`Banner`, guard), listing each overlapping event's
    time and title;
  - Schedule: rows of a 92px label column (label 12.5px over its key mono
    10px) and a 32px input; Time is two 15-minute-step inputs with the length
    under them (`8 h · ends next day`);
  - the fields: a section headed `<Kind> fields` with `🔒 defined by type`,
    each field as §4.3;
  - Duplicate and Delete (danger) at the end.
- **Several:** `N events` in DM Sans 17px, the kinds counted, each event in a
  32px row with its time and a remove button, then Bulk edit:
  - Status, `Mixed` when they differ, offered only when every kind shares one
    status type;
  - Resource, offered over the kinds every one of them takes;
  - Shift −1 d · −1 h · +1 h · +1 d;
  - Delete N events.
- **None:** `Nothing selected` and three hints.
- The pane's footer, mono 10px: `Fields from Shift · 5 fields`,
  `Bulk edit · 3 events`, or `Fields render from the event type`.

## 9. Behaviour

Every interaction of the mock, numbered. Each sub-issue lists the rules it
owns, and each rule has a test there. Rules marked *product* are not in the
mock.

### 9.1 Toolbar and navigation (owner: frame and views)

- **B1.** Calendar · Resources · Timeline switch the layout and keep the day
  in the middle of the view in view.
- **B2.** Day · Week · Month switch the period, keeping the instant in the
  middle of the view. In Resources only Day is offered; Week and Month are
  disabled, their tooltip "Resource columns show one day. Use Timeline for
  longer ranges."
- **B3.** ‹ and › move by the period: a day, a week, or to the first of the
  next or previous month. Today returns to today.
- **B4.** The range label and its line under it:
  - Day: `Thu 1 Oct 2026`, `W40 · today` when it is today;
  - Week: `28 Sep – 4 Oct 2026`, `W40`;
  - Month: `October 2026`, `W40–44`;
  - Timeline: the visible span.

  Each ends `· N events` in view.
- **B5.** The filter (All, then each resource kind) shows only events on
  resources of that kind, and only that kind's columns and rows.
- **B6.** The view, period and date persist per builder for the viewer.
- **B7.** The footer counts the events, the backlog, the pending changes and
  the last Apply's time.

### 9.2 The views (owner: frame and views)

- **B8.** The time grid scrolls to 05:30 when its view changes.
- **B9.** Overlapping events in a column share it in lanes: a cluster of
  events that overlap one another takes as many lanes as it needs, and an event
  spans every free lane to its right.
- **B10.** A block's look: drafted, tinted brand with a brand border; selected,
  a 1.5px brand outline; overlapping, a warn border and ⚠; being dragged, a
  shadow and above the rest.
- **B11.** Clicking a day's header in Week opens that day.
- **B12.** In the month grid a day shows the events that start on it, earliest
  first, as many as fit; `+N more` opens that day.
- **B13.** The timeline pans without end: near either edge of its loaded
  window it moves the window, keeping what is under the viewer's eye still.
- **B14.** With weekends off, Saturday and Sunday leave the week and the month
  grid.

### 9.3 Selection and keys (owner: frame and views)

- **B15.** A click selects one event; Shift, ⌘ or Ctrl adds or removes one; a
  click on empty grid clears; Esc clears.
- **B16.** Delete or Backspace deletes the selection; ⌘Z undoes; ⇧⌘Z or ⌘Y
  redoes — never while typing in an input.

### 9.4 The library pane (owner: library pane)

- **B17.** Tabs Templates and Backlog, each with its count; a search filters
  the tab by name, kind and resource.
- **B18.** Templates group by their `group`; each card shows a grip, its
  kind's icon tile, its name and `Maintenance · 2 h · machines`.
- **B19.** Clicking a template makes it the active one, tinted and marked; the
  pane's footer says `Drag-create · <name>`. The first template is active to
  begin with.
- **B20.** The backlog groups by due: Due this week, Due next week, Later, No
  date. Each card shows `2 h · Press 1 · due Fri 2`.
- **B21.** Empty, a tab says `Backlog clear: every backlog item is on the
  calendar` or `No matches: nothing matches "q"`.
- **B22.** Collapsed, the pane is a rail: its icon, the backlog's count, and
  `Library` set vertically.

### 9.5 The inspector (owner: inspector)

- **B23.** Nothing selected: the three hints.
- **B24.** One event: the header, the overlaps banner when it has any (a click
  on one selects it), Schedule, the fields, Duplicate and Delete.
- **B25.** Changing the date moves the event, keeping its times; changing the
  start keeps its length; an end before the start is the next day.
- **B26.** A field the drafts changed is tinted, against what the record
  holds.
- **B27.** Several events: the list, a remove-from-selection on each, and Bulk
  edit: status, resource, shift, delete.
- **B28.** Duplicate puts a copy right after the event, its status the status
  variant's first case, and selects it.
- **B29.** Collapsed, the pane is a rail: its icon, the selection's count, and
  `Inspector` and the selected event's title set vertically.

### 9.6 Drag and drop (owner: drag and drop)

- **B30.** A move starts after 4px. It snaps to 15 minutes in the time grid;
  in the timeline to 15 minutes at Day, an hour at Week and a day at Month; the
  month grid moves by days.
- **B31.** Moving a selected event moves the whole selection. One event alone
  can move onto another resource in Resources and Timeline, and only to a
  resource of a kind its event kind takes; otherwise it keeps its resource.
- **B32.** A resize drags an edge; an event is at least 15 minutes long.
- **B33.** Dragging across empty time creates an event from the active
  template — or, when that template's kind doesn't take the column's resource
  kind, the first template that does. A ghost says
  `Day shift · 06:00–14:00`; on release the event is created and selected. Not
  at the timeline's Month zoom.
- **B34.** A template card dropped on a slot creates its event there: at the
  slot's time (in the month grid, on that day at the template's `at`), for its
  `duration`.
- **B35.** A backlog card dropped on a slot schedules the row: its start, end
  and resource are written; it leaves the backlog.
- **B36.** *Product.* An event dragged onto the Backlog tab unschedules it, for
  a kind with a backlog.
- **B37.** A created or scheduled event goes on the slot's resource when its
  kind takes that resource's kind; otherwise on the first resource of a kind it
  takes that is free then; otherwise on the first resource of such a kind.
- **B38.** While dragging, a dashed ghost shows where the event lands and when;
  on a slot it can't take, the ghost is red and says why: `Needs people`, or
  `canDrop`'s message (*product*).

### 9.7 Editing and Apply (owner: editing)

- **B39.** Each kind is one session of the shared `Editing` contract over its
  record; every gesture is a draft and one undoable transaction. Typing into a
  title or a number joins the last transaction when it is under 1.5 seconds old.
- **B40.** The history item undoes, redoes and discards across kinds, in the
  order the gestures were made.
- **B41.** Apply commits each kind with drafts as one patch through its
  record's patch mutation, checked against what its drafts began from. A kind
  whose record moved since is refused as a conflict: its drafts stay, and a
  banner names them. The other kinds commit.
- **B42.** A kind's `ready` refusing a drafted event blocks Apply and names the
  event and field (*product*).

### 9.8 Overlaps (owner: overlaps)

- **B43.** Two events on one resource whose times overlap are an overlap pair;
  both are flagged (B10).
- **B44.** The conflicts chip counts the pairs. A click selects the first pair,
  earliest first, opens the inspector and brings it into view (from the month
  grid, to Resources on its day).
- **B45.** The inspector's banner lists what the selected event overlaps.

## 10. Drag and drop, as a table

| Drag | Onto | Does | Refused when |
|---|---|---|---|
| A template card | a slot | Creates an event of its kind there (B34, B37) | the slot's resource is of a kind the event kind doesn't take, or `canDrop` refuses |
| A backlog card | a slot | Schedules the row (B35) | as above |
| An event | another slot | Moves it, and the selection with it (B31) | the new resource is of a kind it doesn't take |
| An event's edge | along its axis | Resizes it (B32) | it would be shorter than 15 minutes |
| An event | the Backlog tab | Unschedules it (B36) | its kind's times are not Options |
| Across empty time | — | Creates from the active template (B33) | as for a template |

All of it runs on the shared drag grammar (`LibraryRef`, `CellRef`,
`DragEvent`), as Studio's canvas does. A calendar `CellRef`'s `row` is the
resource's ref text (`East.print` of `Calendar.Types.ResourceRef`), or `""`
where the view has no resources, and its `slot` the snapped start instant as
East prints a `DateTime`.

## 11. Where the product differs from the mock

| The mock | The product | Why, and what is lost |
|---|---|---|
| Two control rows: the toolbar, and a band over the view | One toolbar, folding; counts in the footer | A component has one toolbar. Nothing is lost. |
| Apply moves pending changes into an applied layer; Save persists | Apply commits; Discard sits in the history item | One editing session: drafts, then Apply. The applied-but-unsaved layer is lost. |
| A Type select changes an event's type | No type change | Decision 4. |
| Backlog items are their own list | A kind's rows with no time | Scheduling is one write to one record. |
| Status levels `ring`, `ok`, `live`, `low` | The `Status` tones and an open ring | East's status vocabulary. |
| Event types and resource kinds are constants in the page | Records, one per kind | Decision 2. |
| No way back to the backlog | B36 | The drag grammar's return-to-source drop. |
| A mock-only `location` field kind | A struct's fields, grouped (§4.3) | Generic: any nested struct. |
| Panes stay open at phone width | `BuilderFrame` overlays them | The frame's phone behaviour. |

## 12. Wires

- **UI.** east-ui's `Calendar` arm leaves `UIComponentType`; packages are
  re-exported (`WIRE_MIGRATION.md`). The builder rides an `EastUI.component`
  carrier, `CalendarBuilder`, as `StudioBuilder` does.
- **Stored state.** None: the records are the app's own types.

## 13. The sub-issues, in landing order

1. The spec and the hi-fi mock (this file, the mock, its renders).
2. Remove the heatmap `Calendar`.
3. `Fields`: the typed field form.
4. Shared time parts, out of Plan's renderer.
5. The types and factories (e3-ui).
6. The frame and the views.
7. Editing and Apply.
8. The library pane.
9. Drag and drop.
10. The inspector.
11. Overlaps.
12. Windowed reads.
13. The showcase on e3-web, its responsive specs, the skill and examples.
14. `Calendar.View`, read-only.
