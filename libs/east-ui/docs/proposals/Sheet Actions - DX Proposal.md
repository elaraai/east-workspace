# Sheet actions: DX proposal

Proposed and ruled 2 November 2026; epic #1480 (#1473–#1479). The visual contract is the designer's **Sheet Action Column** (`Sheet Action Column.dc.html`, beside this file); the interaction contract is [`Sheet Action Column - Behaviour Spec.md`](<Sheet Action Column - Behaviour Spec.md>), whose requirement ids (S1, P2, F9, …) this proposal cites. Neither says how an author declares the column. This does.

References: the Sheet's authoring layer in e3-ui (`packages/e3-ui/src/sheet/` — `columns.ts`, `fields.ts`, `group.ts`, `registers.ts`, `root.ts`, `types.ts`, `index.ts`), the fields contract (`packages/east-ui/src/contracts/fields.ts`, `Fields` / `Sheet.field`), the shared editing contract (`packages/east-ui/src/contracts/editing.ts`), [EAST_UI_PROP_PATTERNS](../../../../docs/conventions/EAST_UI_PROP_PATTERNS.md) and the [sub rows proposal](<Sheet Sub Rows - DX Proposal.md>), whose shape this one follows.

## Recommendation

**An action column is a state machine the author declares over a variant.** The field's type is a variant; each case is a state, and the action that gets a row there. For each case the author gives its words, the cases it may go to next, and what else it updates. The Sheet draws the rest — the state, the next step, the ▾ menu, the forms, the strip's preview, the transaction, the inspector's actions, the phone's action bar.

```tsx
export const StepAction = VariantType({
    started:   NullType,                                                         // nothing to ask: a button
    completed: NullType,
    reported:  IntegerType,                                                      // a number: a form
    held:      VariantType({ awaiting_parts: NullType, machine_down: NullType, quality_hold: NullType }), // every case NullType: a menu
    alerted:   StructType({ changes: StringType, severity: VariantType({ low: NullType, high: NullType }) }), // a struct: a form
});

action: Sheet.column.action(Step, StepAction, {
    start: ["started"],
    cases: {
        started:   { label: "Start",    state: "Started",   next: ["completed", "reported", "held", "alerted"] },
        completed: { label: "Complete", state: "Completed", updates: (_, ctx, at) => ({ row: Sheet.patch(Step, { done: some(at) }) }) },
        reported:  { label: "Report",   state: "Reported",  next: ["completed", "reported", "held", "alerted"],
                     updates: (count) => ({ row: Sheet.patch(Step, { good: some(count) }) }) },
        held:      { label: "Hold",     state: "Held",      next: ["started"] },
        alerted:   { label: "Alert",    state: "Alerted",   next: ["started", "completed"] },
    },
})
```

Why this shape:

- **The stored value is the whole truth, typed.** A step's `action` is `none` (not started), `completed`, `held(machine_down)` or `alerted({ changes, severity })`. Whatever reads the record — a task, a check, another UI — matches on it like any East variant. There is no parallel status string and no form data kept elsewhere.
- **The machine is a table, not code.** Each case lists the cases it may go to (`next`); `start` lists what a row with nothing taken may do. The compiler checks every name; the build checks the machine.
- **The case's type decides how it is asked.** `NullType` is a button; a variant whose every case is `NullType` is a menu of those cases; anything else is a form drawn with `Fields` — the same editors and hints the Plan, Sheet, Calendar and Schematic inspectors use.
- **Each case says what it updates, next to itself.** No function matches over every case; a case's `updates` receives its own value, already typed.
- **It is a column like every other.** It sits on a field, takes the row type first, and is checked against the field's type.

## 1. The state machine

The column sits on a field of type `V` or `Option<V>`, where `V` is a `VariantType`.

- **The states** are `V`'s cases, and `none` for an `Option<V>` field — the absent value, `not started` (S8). A plain `V` field is always in some state; `newRow` gives a new row its first.
- **The edges** are each case's `next`, and `start` for `none`. An edge into a case *is* that case's action: the edge into `held` is **Hold ▾**. A list's order is the order its actions are offered: the first is the next half, one click (I1); the rest are behind ▾ (M5).
- **A case with no `next` is final**: the state alone, `nothing further to take` (R3).
- **An action always lands in its own case.** Complete lands in `completed`, never elsewhere. That is what makes the stored value the history's last word. An action that may end in two places is two cases; one that also changes something else does it in `updates`.

For the work orders of Example 2:

```text
none      ─▶ started
started   ─▶ completed · reported · held · alerted
reported  ─▶ completed · reported · held · alerted
held      ─▶ started
alerted   ─▶ started · completed
completed    (final)
verified     (final; written upstream, never offered here)
```

**What depends on other rows** — step 30 waits for step 20 — is the one thing a table cannot say. The column takes one optional function for it, `blocked` (§2).

## 2. The author's API

A sketch — proposed names, not code that compiles today.

### `Sheet.column.action(R, V, config)`

`R` is the type the columns are built over (a grouped sheet's line type, a flat sheet's row type), as for every column. `V` is the variant, passed as a type value the way `Sheet.column.quantity(R, D, …)` takes its driver's type; the column is accepted only on a field of `V` or `Option<V>`.

```ts
type CaseOf<V extends VariantType> = keyof V["cases"] & string;

export interface SheetActionConfig<R extends StructType, V extends VariantType> {
    /** Every column's: the header line, its second line, the width; `editable: false` shows the state alone (T9). */
    header?: SubtypeExprOrValue<StringType>;
    sub?: SubtypeExprOrValue<StringType>;
    width?: SubtypeExprOrValue<StringType>;
    editable?: boolean;

    /** What a row with nothing taken may do — an `Option<V>` field only. */
    start?: readonly CaseOf<V>[];
    /** One entry per case of V, every case and no other. */
    cases: { [C in CaseOf<V>]: SheetActionCase<R, V, V["cases"][C]> };
    /** Why this row cannot act now, over its context; `none` when it can. */
    blocked?: (ctx: ExprType<SheetActionContextOf<R>>) => SubtypeExprOrValue<OptionType<StringType>>;

    /** How menus, forms and the strip name the row — `"step 20"`. Default: `row 3`. */
    name?: (row: ExprType<R>) => SubtypeExprOrValue<StringType>;
    /** The row's words beside its name — `"Weld frame"`. Default: none. */
    title?: (row: ExprType<R>) => SubtypeExprOrValue<StringType>;
}
```

### One case

```ts
export interface SheetActionCase<R extends StructType, V extends VariantType, T extends EastType> {
    /** The verb on the control — "Complete". */
    label: SubtypeExprOrValue<StringType>;
    /** The word once taken — "Completed". */
    state: SubtypeExprOrValue<StringType>;
    /** The state's tone (S6). Default "neutral". */
    tone?: "success" | "warning" | "danger" | "info" | "neutral";
    /** A Font Awesome solid icon by name — "check" (S13). Default none. */
    icon?: string;
    /** The cases a row in this state may go to, in the order they are offered. Omitted: a final state. */
    next?: readonly CaseOf<V>[];
    /** How the case is asked for, where its type alone does not say. */
    take?: SheetActionTake<T>;
    /** What follows the state word (S7): over the case's value and the row. */
    summary?: (value: ExprType<T>, row: ExprType<R>) => SubtypeExprOrValue<StringType | OptionType<StringType>>;
    /** What else taking this case updates: the row, and on a grouped sheet its group. */
    updates?: (value: ExprType<T>, ctx: ExprType<SheetActionContextOf<R>>, at: ExprType<DateTimeType>) => SheetUpdatesInput<R>;
}
```

The callbacks are accessors, as a column's `detail` and a band cell's `value` are: the factory compiles each once into an East function and calls it (`EAST_UI_PROP_PATTERNS` §3). They capture data only.

### The context: `Sheet.Types.ActionContext`

`blocked` and `updates` see the row as plain values, not drafts. A row whose draft is incomplete never offers an action (T6), so the row is always complete; a neighbour may still be half typed, so neighbours are `Option`s.

```ts
Sheet.Types.ActionContext(WorkOrder, "steps") = StructType({
    row:   Step,                        // this step, as it stands before the action
    index: IntegerType,                 // its place among its order's steps
    rows:  ArrayType(OptionType(Step)), // its order's steps; none where a step's draft is incomplete
    group: OptionType(WorkOrder),       // its order; none while the order's own fields are incomplete
    today: DateTimeType,                // UTC midnight
})

Sheet.Types.ActionContext(Ticket) = StructType({ row: Ticket, index: IntegerType, rows: ArrayType(OptionType(Ticket)), today: DateTimeType })
```

### `updates`

A case's `updates(value, ctx, at)` says what else changes when it is taken. `value` is the case's value — what the user entered (`reported(12)`'s `12`); `ctx.row` is the row before; `at` is the moment. It returns patches built with `Sheet.patch`, as `newRow`, templates and library drops do; either may be left out, and a field a patch leaves out is left alone:

```ts
{ row?: Sheet.patch(Step, { … }), group?: Sheet.patch(WorkOrder, { … }) }   // a grouped sheet
{ row?: Sheet.patch(Ticket, { … }) }                                        // a flat sheet
```

The action writes its own field; `updates` never needs to. The field, the row patch and the group patch are one transaction (T1) and one step of ⌘Z. Each patch lands as the cells it sets, through their columns — read-only ones too, since the action writes them — so Good, Done and the order's band turn dirty as typed cells do (ST6). A field with no column, or under no band cell, is left as it is: give it a column to have an action write it. Before anything is taken, the strip runs `updates` dry to preview it (`Sets Good 24 · Done 14:02`, R5, R6), and a form's foot runs it over the values typed so far (F8).

### How a case is asked: `take`

| The case's type | Asked as | `take` may say |
|---|---|---|
| `NullType` | a **button**, taken on click (P2) | — |
| A variant whose every case is `NullType` | a **menu** of its cases (P3, M5), each case's name spelled out | `Sheet.action.menu({ labels })` — words for the cases, those labelled first, as `Fields.select` orders them |
| `String` | a **form** of one text field | `Sheet.action.menu({ of: "crews" })` — a menu of a register's members by label, as `Fields.reference({ of })` names one |
| Anything else — a struct, `Integer`, `Float`, `DateTime`, an `Option` | a **form**: `Fields.specs` over the value, a struct's field per field | `Sheet.action.form({ fields, initial })` |

```ts
Sheet.action.menu({ labels?: { [case]: string } })
Sheet.action.menu({ of: string })
Sheet.action.form({
    fields?: FieldHint<T> | FieldHints<T["fields"]>,                 // Sheet.field.* — one hint for a single value, one per field for a struct
    initial?: (ctx: ExprType<SheetActionContextOf<R>>) => SubtypeExprOrValue<T>,   // what the form opens with (F10)
})
```

`fields` is the inspectors' own vocabulary — `Sheet.field.text`, `.number`, `.select`, `.date`, `.reference`, `.tags`, `.readonly`, `.hidden` — checked against the value's type as an inspector's hints are. A form refuses to take while a field that is not an `Option` is empty (F9).

### The inspector

With `inspector` on, the selected row's action field is drawn as its state and summary with its offered actions under it. A button is taken there; a menu opens from its control; a form opens inline in the pane, never as a popover — as the phone's action bar opens it (X7). One form, drawn in two places, one transaction either way.

### What the compiler and the build catch

- The column on a field that is not `V` or `Option<V>`.
- `cases` missing a case of `V` or naming one it does not have; `start` or a `next` naming a case `V` does not have.
- A `take` that does not fit the case's type — `menu({ of })` on anything but a `String`, `menu({ labels })` on anything but a variant whose every case is `NullType`, a `fields` hint that does not fit.
- `updates` returning a group patch on a flat sheet — the return type is `SheetUpdatesInput<R>`.
- At build time, naming the column and the case: a register `menu({ of })` names that the sheet does not declare; `start` on a field that is not an `Option`; a case listed twice in one `next`; a `fill` or a `value` on the column. A case nothing reaches is allowed — `verified`, written upstream.

## 3. Worked examples

Each example is complete: the record, its binding, the sheet. All five go into `test/sheet/sheet-actions.examples.tsx`, wired into its spec per EXAMPLES_AUTHORING, and onto the Sheet's showcase page.

### Example 1 — the least: two buttons

A flat sheet of jobs, each started, then finished.

```tsx
/** @jsxImportSource @elaraai/e3-ui */
import { DictType, East, NullType, OptionType, StringType, StructType, VariantType, none, some, variant } from "@elaraai/east";
import { Box, Reactive, UIComponentType } from "@elaraai/east-ui";
import { Record, Sheet } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

export const JobState = VariantType({ started: NullType, finished: NullType });
export const ActionJob = StructType({ task: StringType, state: OptionType(JobState) });
export const sheetActionJobs = e3.record("sheet_action_jobs", DictType(StringType, ActionJob), {
    initial: new Map([
        ["J-0001", { task: "Panel cutting", state: some(variant("finished", null)) }],
        ["J-0002", { task: "Edge banding",  state: some(variant("started", null)) }],
        ["J-0003", { task: "CNC routing",   state: none }],
    ]),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

const sheet = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const jobs = $.let(Record.bind(sheetActionJobs));
        return (
            <Box height="320px">
                <Sheet
                    record={jobs}
                    columns={{
                        task:  Sheet.column.text(ActionJob, { header: "Task", width: "240px" }),
                        state: Sheet.column.action(ActionJob, JobState, {
                            header: "State", width: "240px",
                            start: ["started"],
                            cases: {
                                started:  { label: "Start",  state: "Started",  tone: "info",    icon: "play",  next: ["finished"] },
                                finished: { label: "Finish", state: "Finished", tone: "success", icon: "check" },
                            },
                        }),
                    }}
                />
            </Box>
        );
    }}</Reactive>
));
```

J-0003 reads `not started` with **▶ Start**; J-0002 reads `● STARTED` with **✓ Finish**; J-0001 reads `● FINISHED`, final, no controls. Taking one is a draft: the cell tints, Save commits through the record's patch door, ⌘Z takes it back.

### Example 2 — the mock: work orders, every kind, the order's status saved

The designer's sheet A: grouped work orders, each step started, completed, reported (a number), held (a reason), alerted (a form) or verified upstream. A step waits for the one before it. Completing fills Good from Plan when empty and stamps Done. Each state says what it does to the order's status, which is saved with the order.

```tsx
/** @jsxImportSource @elaraai/e3-ui */
import {
    ArrayType, BooleanType, DateTimeType, DictType, East, IntegerType, NullType, OptionType, StringType, StructType, VariantType, none, some, variant,
} from "@elaraai/east";
import { Box, Reactive, Slice, StatusValueType, UIComponentType } from "@elaraai/east-ui";
import { Data, Record, Sheet } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

export const HoldReason = VariantType({ awaiting_parts: NullType, machine_down: NullType, quality_hold: NullType });
export const StepAlert  = StructType({ changes: StringType, severity: VariantType({ low: NullType, high: NullType }) });
export const StepAction = VariantType({
    started:   NullType,
    completed: NullType,
    reported:  IntegerType,     // the good parts counted so far
    held:      HoldReason,
    alerted:   StepAlert,
    verified:  NullType,        // written upstream by QA; never offered here
});
export const Step = StructType({
    op: StringType, step: StringType, plan: IntegerType,
    good: OptionType(IntegerType), done: OptionType(DateTimeType),
    action: OptionType(StepAction),
});
export const WorkOrder = StructType({ id: StringType, name: StringType, status: StringType, steps: ArrayType(Step) });
export const WorkStatus = StructType({ word: StringType, label: StringType, tone: StatusValueType });

export const sheetWorkOrders = e3.record("sheet_work_orders", DictType(StringType, WorkOrder), {
    initial: new Map([
        ["WO-1042", { id: "WO-1042", name: "Frame assembly", status: "in_progress", steps: [
            { op: "10", step: "Cut tube stock", plan: 24n, good: some(24n), done: some(new Date("2026-11-02T08:42:00Z")), action: some(variant("completed", null)) },
            { op: "20", step: "Weld frame",     plan: 24n, good: none, done: none, action: some(variant("started", null)) },
            { op: "30", step: "Grind welds",    plan: 24n, good: none, done: none, action: none },
        ] }],
        ["WO-1043", { id: "WO-1043", name: "Bracket kit", status: "on_hold", steps: [
            { op: "10", step: "Laser cut", plan: 120n, good: none, done: none, action: some(variant("held", variant("machine_down", null))) },
            { op: "20", step: "Bend",      plan: 120n, good: none, done: none, action: none },
        ] }],
        ["WO-1044", { id: "WO-1044", name: "Pump housing", status: "on_hold", steps: [
            { op: "10", step: "Turn blank", plan: 8n, good: some(8n), done: some(new Date("2026-11-02T11:05:00Z")), action: some(variant("verified", null)) },
            { op: "20", step: "Mill bore",  plan: 8n, good: none, done: none,
              action: some(variant("alerted", { changes: "Bore gauge reads 0.04 mm over", severity: variant("high", null) })) },
        ] }],
    ]),
    indexes: (index) => ({ sheet_work_orders_by_status: index.on(["status"]) }),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

const sheet = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const orders = $.let(Record.bind(sheetWorkOrders));
        const slice = $.let(Slice.bindRecords("sheet.work", {
            rows: {
                source: Data.bindPaged(sheetWorkOrders, { indexes: ["sheet_work_orders_by_status"] }),
                label: "Orders",
                fields: { status: { label: "Status", hints: ["in_progress", "on_hold", "done"] } },
            },
        }));
        const statuses = $.let([
            { word: "in_progress", label: "In progress", tone: variant("info", null) },
            { word: "on_hold",     label: "On hold",     tone: variant("warning", null) },
            { word: "done",        label: "Done",        tone: variant("success", null) },
        ], ArrayType(WorkStatus));
        // A step is finished once completed or verified.
        const finished = $.const(East.function([Step], BooleanType, (_$, step) =>
            step.action.match({ some: (_$, a) => a.hasTag("completed").or(() => a.hasTag("verified")) }, () => false)));

        return (
            <Box height="560px">
                <Sheet
                    slice={{ slice }}
                    // The orders and their steps come from planning: this sheet takes their actions, and adds neither.
                    edits={{ insertRows: false, insertGroups: false }}
                    group={Sheet.group(WorkOrder, "steps", {
                        title: "name", sub: o => o.id, noun: { singular: "order", plural: "orders" },
                        // The order's status on its band, under the Action column; the actions write it.
                        cells: { action: Sheet.group.cell.enum(WorkOrder, "statuses", "status", { editable: false }) },
                    })}
                    registers={{
                        statuses: Sheet.register.members(statuses, { kind: "status", key: s => s.word, label: s => s.label, tone: s => some(s.tone) }),
                    }}
                    columns={{
                        step: Sheet.column.text(Step, { header: "Step", width: "158px", editable: false }),
                        good: Sheet.column.integer(Step, { header: "Good", width: "56px" }),
                        action: Sheet.column.action(Step, StepAction, {
                            header: "Action", width: "304px",
                            name:  s => East.str`step ${s.op}`,
                            title: s => s.step,
                            start: ["started"],
                            // A step waits until the step before it is finished.
                            blocked: (ctx) => ctx.index.equal(0n).ifElse(() => none, () =>
                                ctx.rows.get(ctx.index.subtract(1n)).match({
                                    some: (_$, before) => finished(before).ifElse(() => none, () => some(East.str`waits for ${before.op}`)),
                                }, () => some("waits for the step before"))),
                            cases: {
                                started:   { label: "Start", state: "Started", tone: "info", icon: "play",
                                             next: ["completed", "reported", "held", "alerted"],
                                             updates: () => ({ group: Sheet.patch(WorkOrder, { status: "in_progress" }) }) },
                                completed: { label: "Complete", state: "Completed", tone: "success", icon: "check",
                                             summary: (_, s) => s.good.match({ some: (_$, g) => East.str`${g} good` }, () => ""),
                                             updates: (_, ctx, at) => ({
                                                 row: Sheet.patch(Step, { good: some(ctx.row.good.match({ some: (_$, g) => g }, () => ctx.row.plan)), done: some(at) }),
                                                 // The last step to finish finishes the order.
                                                 group: Sheet.patch(WorkOrder, { status: ctx.rows.every((_$, r, i) =>
                                                     i.equal(ctx.index).or(() => r.match({ some: (_$, s) => finished(s) }, () => false)))
                                                     .ifElse(() => "done", () => "in_progress") }),
                                             }) },
                                reported:  { label: "Report", state: "Reported", tone: "info", icon: "hashtag",
                                             next: ["completed", "reported", "held", "alerted"],
                                             take: Sheet.action.form({
                                                 fields: Sheet.field.number({ label: "Good parts", unit: "pcs", min: 0n }),
                                                 initial: (ctx) => ctx.row.good.match({ some: (_$, g) => g }, () => 0n),
                                             }),
                                             summary: (count) => East.str`${count} good`,
                                             updates: (count) => ({ row: Sheet.patch(Step, { good: some(count) }) }) },
                                held:      { label: "Hold", state: "Held", tone: "warning", icon: "pause",
                                             next: ["started"],
                                             take: Sheet.action.menu({ labels: { awaiting_parts: "Awaiting parts", machine_down: "Machine down", quality_hold: "Quality hold" } }),
                                             summary: (reason) => reason.match({ awaiting_parts: () => "Awaiting parts", machine_down: () => "Machine down", quality_hold: () => "Quality hold" }),
                                             updates: () => ({ group: Sheet.patch(WorkOrder, { status: "on_hold" }) }) },
                                alerted:   { label: "Alert", state: "Alerted", tone: "danger", icon: "flag",
                                             next: ["started", "completed"],
                                             take: Sheet.action.form({ fields: {
                                                 changes:  Sheet.field.text({ label: "What changed", help: "What the operator saw", placeholder: "What the operator saw" }),
                                                 severity: Sheet.field.select({ help: "High puts the order on hold" }),
                                             } }),
                                             summary: (alert) => alert.changes,
                                             updates: (alert) => ({ group: Sheet.patch(WorkOrder, {
                                                 status: alert.severity.hasTag("high").ifElse(() => "on_hold", () => "in_progress"),
                                             }) }) },
                                verified:  { label: "Verify", state: "Verified", tone: "success",
                                             summary: () => "by QA" },
                            },
                        }),
                        done: Sheet.column.date(Step, { header: "Done", width: "64px", level: () => "time", format: "HH:mm" }),
                    }}
                    inspector
                    onApply={Record.onApply(orders, { keyed: true })}
                    name="work"
                />
            </Box>
        );
    }}</Reactive>
));
```

Walking the mock with this declaration:

| Row | Cell | Why |
|---|---|---|
| WO-1042 step 10 | `● COMPLETED 24 good`, no controls | `completed` is final |
| WO-1042 step 20 | `● STARTED` · **✓ Complete** · ▾ (Report…, Hold ▾, Alert…) | `started`'s `next`; the first is the next half |
| WO-1042 step 30 | `waits for 20`, no controls | nothing taken, and `blocked` says why |
| WO-1043 step 10 | `● HELD Machine down` · **▶ Start** | `held`'s `next` |
| WO-1044 step 10 | `● VERIFIED by QA`, no controls | `verified` is final |
| WO-1044 step 20 | `● ALERTED Bore gauge reads 0.04 mm over` · **▶ Start** · ▾ (Complete) | `alerted`'s `next` |

Taking **Complete** on WO-1042 step 20 at 14:02: its `updates` writes Good 24 (it was empty, so Plan) and Done 14:02 on the step, and `in_progress` on the order (step 30 is not finished). The strip previewed it as `Sets Good 24 · Done 14:02`. Step 30 now offers Start in the same frame (T2). ⌘Z takes all of it back. **Alert…** with High chosen previews `Sets WO-1042 On hold` in the form's foot (F8); ⏎ with What changed empty refuses (F9).

A step's name, read only here, and an order's status, which only the actions write, are planning's: no person can set them on a new step or order. The build would refuse Add with no `newRow` and `newGroup` to give them, so this sheet adds neither (`edits`).

### Example 3 — a flat sheet: a date form and a register menu

Maintenance tickets. A ticket is acknowledged, deferred until a date, handed over to another crew, or closed. Deferring moves the ticket's due date; handing over moves its crew.

```tsx
export const TicketAction = VariantType({
    acknowledged: NullType,
    deferred:     DateTimeType,      // until when: a form of one date field
    handed_over:  StringType,        // to which crew: a register's members
    closed:       NullType,
});
export const Ticket = StructType({ title: StringType, crew: StringType, due: OptionType(DateTimeType), action: OptionType(TicketAction) });
export const Crew = StructType({ name: StringType });
// sheetTickets: e3.record("sheet_tickets", DictType(StringType, Ticket), { …, mutations: (m) => ({ patch: m.patch() }) })
// sheetCrews:   e3.record("sheet_crews", DictType(StringType, Crew), { … })

const sheet = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const tickets = $.let(Record.bind(sheetTickets));
        const crews = $.let(Data.bind(sheetCrews));
        const open = ["acknowledged", "deferred", "handed_over", "closed"] as const;
        return (
            <Box height="420px">
                <Sheet
                    record={tickets}
                    // The tickets come from the maintenance log: this sheet takes their actions, and adds none.
                    edits={{ insertRows: false }}
                    registers={{ crews: Sheet.register.members(crews.read(), { kind: "crew", key: (_c, k) => k, label: c => c.name }) }}
                    columns={{
                        title:  Sheet.column.text(Ticket, { header: "Ticket", width: "220px" }),
                        crew:   Sheet.column.reference(Ticket, "crews", { header: "Crew", width: "120px", editable: false }),
                        due:    Sheet.column.date(Ticket, { header: "Due", width: "96px", editable: false }),
                        action: Sheet.column.action(Ticket, TicketAction, {
                            header: "Action", width: "304px",
                            name: t => t.title,
                            start: open,
                            cases: {
                                acknowledged: { label: "Acknowledge", state: "Acknowledged", tone: "info", icon: "eye", next: open },
                                deferred:     { label: "Defer", state: "Deferred", tone: "warning", icon: "clock", next: open,
                                                take: Sheet.action.form({ fields: Sheet.field.date({ label: "Until", precision: "date" }), initial: (ctx) => ctx.today.addDays(1n) }),
                                                summary: (until) => East.str`until ${until.printFormatted("DD MMM")}`,
                                                updates: (until) => ({ row: Sheet.patch(Ticket, { due: some(until) }) }) },
                                handed_over:  { label: "Hand over", state: "Handed over", icon: "right-left", next: open,
                                                take: Sheet.action.menu({ of: "crews" }),
                                                summary: (crew) => crew,
                                                updates: (crew) => ({ row: Sheet.patch(Ticket, { crew }) }) },
                                closed:       { label: "Close", state: "Closed", tone: "success", icon: "check" },
                            },
                        }),
                    }}
                    applyMode="auto"
                />
            </Box>
        );
    }}</Reactive>
));
```

**Defer…** opens a form with the date field `Until`, at tomorrow (F10); its foot reads `Sets Due 04 Nov 26`. **Hand over ▾** opens a menu titled `Hand over · crews` listing the crews by label. With `applyMode="auto"` each action saves as it is taken, its dot pulsing until the save lands (T5). The crew is set only by Hand over, so a new ticket would have none, and the sheet adds no tickets.

### Example 4 — read only

Example 1 with `readOnly` — or the column with `editable: false`, or rows the upstream owns (`owned`) — shows the state and summary alone: no controls, no keys hint (T9).

```tsx
<Sheet record={jobs} readOnly columns={{ task: …, state: Sheet.column.action(ActionJob, JobState, { …as Example 1… }) }} />
```

### Example 5 — a phone

Nothing in the declaration changes. Example 2's sheet in a 390-wide box shows each action cell as the state alone (X4); a tap on any cell of a row turns the docked strip into that row's action bar: **✓ Complete** full width, then **Report…**, **Hold ▾** and **Alert…** in one line, the first action's consequence under them (X5, X6). Alert… opens its form inside the bar, touch sized, with Cancel and Alert halves (X7). The example is `sheetActionsPhone`: Example 2's body in `<Box width="390px" height="620px">`, with `applyMode="auto"` (X12).

## 4. Wire

Additive; older payloads decode unchanged, since a sheet with no action column projects nothing new.

```text
Sheet.Types.Cell        gains  Action: { case: String, value: Blob }      // the case and its value, beast2; Null when an Option<V> field is none
Sheet.Types.ColumnKind  gains  action: {
    start:   Array<String>,
    cases:   Array<{ case, label, state, tone: Option<StatusValue>, icon: Option<String>, next: Array<String>,
                     take: Variant{ button: Null, menu: Array<Fields.Types.Option>, register: String, form: Array<Fields.Types.Spec> },
                     initial: Option<FunctionType([WireActionContext], Blob)>,
                     updates: Option<FunctionType([Blob, WireActionContext, DateTime], { row: Dict<String, Cell>, group: Dict<String, Cell> })> }>,
    blocked: Option<FunctionType([WireActionContext], Option<String>)>,
    stateSlot: String,                   // the widest state word, for S5's measure
    summary: String, name: Option<String>, title: Option<String>,   // the rule cells holding them
}
Editing.Types.Origin    gains  action: Null                               // the transaction's origin (T1)
Fields.Types.Editor     gains  date: { label, precision }                 // the date hint (below)
```

- **The cell.** The renderer needs the case to draw the state, and the value to seed a form (F10) and to pass `updates`, without the host's `V`. The value rides as beast2 of the case's type, which the column's case names — the inspector's `encode` precedent for a typed value crossing the closed wire.
- **The machine is data.** `start` and each case's `next` ride as names, so the renderer knows a row's offer without running East; only `blocked` runs per row.
- **The summary, name and title** are accessors over the row, projected into unrendered rule cells (`$summary:action`, `$name:action`, `$title:action`), as a date's `level` and a column's `detail` are.
- **`blocked`, `initial` and `updates`** are bridged over a wire action context — the row and its group decoded from the real rows with their drafts over them, as the bridge builds `DraftContext` today, then narrowed to complete values. `updates`' patches come back as the cells they set, through `encode`.
- **The band.** A band cell's payload must match the column it sits under. Under an action column, the rule admits an `enum`, `text` or `stamped` band cell — the group's status, which the actions write.
- **No e3 wire changes.** This is a UI task's payload, rebuilt when the package is.

## 5. Reuse

| Part | Where | Used for |
|---|---|---|
| `Fields` hints and `Fields.specs` | east-ui `contracts/fields.ts` (`Sheet.field`) | A form's fields (F5, F6) |
| `FieldForm` | east-ui-components `forms/field-form` | The form's body, in the popover, the inspector and the action bar |
| `RadioGroup`, `radioGroup` recipe | east-ui-components `forms/radio-group` | A variant of up to four `NullType` cases, in every form (F6) |
| The Menu card, `menu` recipe | east-ui-components | M1–M8 |
| The Popover card, `popover` recipe | east-ui-components | F1–F4, F8 |
| The Status part, `status` recipe | east-ui-components | S4, S6 |
| The Sheet's strip | e3-ui-components `sheet/Strip.tsx` | §7 |
| The Sheet's inspector | e3-ui-components `sheet/frame/inspector.tsx` | The actions in the pane |
| The editing session, history, `applyMode` | east-ui-components `editing`, the Sheet | §8 |
| BuilderFrame's banners | east-ui-components | T5's failed save |

## 6. Decisions

Ruled 2 November 2026:

1. **The definition is a variant and its state machine.** Each case is a state and the action into it; `start` and `next` are the adjacency lists; an action always lands in its own case.
2. **Rules over other rows are one function, `blocked`.** No per-edge guards, no offer function.
3. **`blocked` and `updates` see plain values** (`Sheet.Types.ActionContext`), not drafts.
4. **Each case's `updates` says what else it changes,** the row and its group; the group's status is saved, written by the states' definitions.
5. **A variant of up to four `NullType` cases is a radio group** in every form — the action forms and every inspector — and a Select past four.
6. **The inspector shows the actions too,** a form inline in the pane.
7. **`Fields` gains a date hint,** `Sheet.field.date({ label, help, precision })`, for every inspector as for the forms.
8. **The behaviour spec is built whole,** its not-in-the-prototype items too: a failed save (T5), an incomplete row (T6), a range of rows (T8).

## 7. Where this departs from the mock

Each as **mock** · **proposed** · **consequence**.

1. **An owned step inside an order that is not.** *Mock:* WO-1044 step 10 is owned and read only. *Proposed:* ownership stays the Sheet's `owned`, over the group on a grouped sheet; the step is `verified`, a final state. *Consequence:* the strip says `nothing further to take` there, not `owned upstream, read only`.
2. **The order's status after Start.** *Mock:* Start leaves an order on hold while another step is held. *Proposed:* Example 2's Start sets `in_progress`; an author who wants the mock's rule reads `ctx.rows` in `started`'s `updates`. *Consequence:* none to the API.
3. **The Step cell.** *Mock:* the op code before the step's name in one cell. *Proposed:* the example shows `step`, the op in the action column's `name`. *Consequence:* the Step column reads `Weld frame`.
4. **The band's Done count** (`1 of 3`). *Proposed:* left out of the example; Done is a date column and its band cell must be one.
5. **Report's bound.** *Mock:* the stepper stops at the step's Plan. *Proposed:* `Fields.number`'s bounds are constants. *Consequence:* the stepper does not stop at 24.
6. **The mock's other treatments** of the cell (a whole-cell menu; segmented controls), which its page no longer draws. *Proposed:* only the drawn one — the next half and ▾ — is built.
7. **The popover's arrow and flip** (F2, F3) become part of the shared Popover card.

## 8. Work breakdown

One epic, one branch, one PR.

**`east-ui` (shared contracts):**
- `contracts/editing.ts`: `Origin` gains `action`.
- `contracts/fields.ts`: `Fields.date`; `forms/field-form` draws a variant of up to four `NullType` cases as a radio group.

**`e3-ui` (authoring):**
- A new `sheet/actions.ts`: `Sheet.column.action`, `Sheet.action.{menu, form}`, `Sheet.Types.ActionContext`, and the `SheetActionCase` / `SheetActionTake` / `SheetUpdatesInput` typing.
- `types.ts`: the `Action` cell and the `action` column kind; `columns.ts`: the builder among the kinds.
- `bridge.ts` / `root.ts`: check the column and its machine against `V`; project the cell and its rule cells; bridge `blocked`, each `initial` and each `updates`; resolve each form's specs through `Fields.specs`; admit a status band cell under the column.
- `fields.ts`: the inspector's action field — its state, summary and actions.
- The namespace, the SKILL's Sheet section, `test/sheet/sheet-actions.examples.tsx` (Examples 1–5) wired into its spec, and the plugin index.

**`e3-ui-components` (the renderer):**
- The cell (§1–§4, §10, §11): anatomy, states, the ring as the cell's last child, pointer, keyboard.
- The menu and the popover form (§5, §6), anchored to the control, with the arrow and the flip.
- The strip's preview and the transaction (§7, §8): `updates` run dry, one step of history, auto mode's pulse, a failed save's banner, an incomplete row's disabled controls, a range of rows taken together.
- The inspector's actions, a form inline.
- The phone's action bar (§12).

**`east-ui-components` (shared parts):** the popover's arrow and flip, the radio group in `FieldForm`, the live pulse as a recipe part if it is not one.

**Verification:** each example on e3-web through Save and a remount; the responsive suite's invariants for S1–S14 and ST1–ST6 in both themes, measured; the menu's and the popover's placement and flip; the inspector's inline form; the phone's action bar at 390 and a 294 parent; ⌘Z restoring the field, the row patch and the group patch together.
