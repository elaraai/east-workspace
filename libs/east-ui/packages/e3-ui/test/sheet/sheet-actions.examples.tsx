/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** @jsxImportSource @elaraai/east-ui */

/**
 * The Sheet's action column (#1474, `Sheet Actions - DX Proposal.md` §3): a
 * variant's state machine as a column. Each example is the proposal's, whole.
 */

import {
    ArrayType, BooleanType, DateTimeType, DictType, East, IntegerType, NullType, OptionType, StringType, StructType, VariantType,
    example, none, some, variant,
} from "@elaraai/east";
import { Box, Reactive, Slice, StatusValueType, UIComponentType } from "@elaraai/east-ui";
import { Data, Record, Sheet } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

// ============================================================================
// Example 1 — the least: two buttons
// ============================================================================

export const JobState = VariantType({ started: NullType, finished: NullType });
export const ActionJob = StructType({ task: StringType, state: OptionType(JobState) });
export const sheetActionJobs = e3.record("sheet_action_jobs", DictType(StringType, ActionJob), {
    initial: new Map([
        ["J-0001", { task: "Panel cutting", state: some(variant("finished", null)) }],
        ["J-0002", { task: "Edge banding", state: some(variant("started", null)) }],
        ["J-0003", { task: "CNC routing", state: none }],
    ]),
    mutations: (mutation) => ({
        // The jobs' patch door — every Save commits through it.
        patch: mutation.patch(),
    }),
});

export const sheetActionsBasic = example({
    keywords: ["Sheet", "Sheet.column.action", "action", "state machine", "variant", "start", "next", "button", "state"],
    description: "The least an action column takes: a variant of two NullType cases, each a state and the button into it — `start` what a job with nothing taken may do, `next` each state's way on, a case with no `next` final",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const jobs = $.let(Record.bind(sheetActionJobs));
            return (
                <Box height="320px">
                    <Sheet
                        record={jobs}
                        name="sheetActionsBasic"
                        columns={{
                            task: Sheet.column.text(ActionJob, { header: "Task", width: "240px" }),
                            state: Sheet.column.action(ActionJob, JobState, {
                                header: "State", width: "240px",
                                start: ["started"],
                                cases: {
                                    started: { label: "Start", state: "Started", tone: "info", icon: "play", next: ["finished"] },
                                    finished: { label: "Finish", state: "Finished", tone: "success", icon: "check" },
                                },
                            }),
                        }}
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// Example 2 — the mock: work orders, every kind, the order's status saved
// ============================================================================

export const HoldReason = VariantType({ awaiting_parts: NullType, machine_down: NullType, quality_hold: NullType });
export const StepAlert = StructType({ changes: StringType, severity: VariantType({ low: NullType, high: NullType }) });
export const StepAction = VariantType({
    started: NullType,
    completed: NullType,
    reported: IntegerType, // the good parts counted so far
    held: HoldReason,
    alerted: StepAlert,
    verified: NullType, // written upstream by QA; never offered here
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
            { op: "20", step: "Weld frame", plan: 24n, good: none, done: none, action: some(variant("started", null)) },
            { op: "30", step: "Grind welds", plan: 24n, good: none, done: none, action: none },
        ] }],
        ["WO-1043", { id: "WO-1043", name: "Bracket kit", status: "on_hold", steps: [
            { op: "10", step: "Laser cut", plan: 120n, good: none, done: none, action: some(variant("held", variant("machine_down", null))) },
            { op: "20", step: "Bend", plan: 120n, good: none, done: none, action: none },
        ] }],
        ["WO-1044", { id: "WO-1044", name: "Pump housing", status: "on_hold", steps: [
            { op: "10", step: "Turn blank", plan: 8n, good: some(8n), done: some(new Date("2026-11-02T11:05:00Z")), action: some(variant("verified", null)) },
            { op: "20", step: "Mill bore", plan: 8n, good: none, done: none,
                action: some(variant("alerted", { changes: "Bore gauge reads 0.04 mm over", severity: variant("high", null) })) },
        ] }],
    ]),
    indexes: (index) => ({
        // The orders by status: what the rail narrows them by.
        sheet_work_orders_by_status: index.on(["status"]),
    }),
    mutations: (mutation) => ({
        // The orders' patch door — every Save commits through it.
        patch: mutation.patch(),
    }),
});

export const sheetActionsWorkOrders = example({
    keywords: ["Sheet", "Sheet.column.action", "action", "state machine", "variant", "start", "next", "blocked", "updates", "Sheet.patch",
        "Sheet.action.menu", "Sheet.action.form", "Sheet.field", "form", "menu", "button", "summary", "group", "band", "inspector", "Slice.bindRecords", "Record.onApply"],
    description: "Work orders whose steps are a state machine: Start, Complete, Report… (a number form), Hold ▾ (a menu of reasons) and Alert… (a struct form), each state's `next` its way on; a step blocked until the one before it is finished; each case's `updates` writing Good and Done on the step and the order's status on its band — saved with the order — as one step of history",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const orders = $.let(Record.bind(sheetWorkOrders));
            // One rail over the orders: its `rows` source narrows them.
            const slice = $.let(Slice.bindRecords("sheet.work.sheetActionsWorkOrders", {
                rows: {
                    source: Data.bindPaged(sheetWorkOrders, { indexes: ["sheet_work_orders_by_status"] }),
                    label: "Orders",
                    fields: { status: { label: "Status", hints: [{ value: "in_progress", label: "In progress" }, { value: "on_hold", label: "On hold" }, { value: "done", label: "Done" }] } },
                },
            }));
            const statuses = $.let([
                { word: "in_progress", label: "In progress", tone: variant("info", null) },
                { word: "on_hold", label: "On hold", tone: variant("warning", null) },
                { word: "done", label: "Done", tone: variant("success", null) },
            ], ArrayType(WorkStatus));
            // A step is finished once completed or verified.
            const finished = $.const(East.function([Step], BooleanType, (_$2, step) =>
                step.action.match({ some: (_$3, a) => a.hasTag("completed").or(() => a.hasTag("verified")) }, () => false)));
            return (
                <Box width="100%" height="560px">
                    <Sheet
                        slice={{ slice }}
                        name="sheetActionsWorkOrders"
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
                                name: s => East.str`step ${s.op}`,
                                title: s => s.step,
                                start: ["started"],
                                // A step waits until the step before it is finished.
                                blocked: (ctx) => ctx.index.equal(0n).ifElse(() => East.value(none, OptionType(StringType)), () =>
                                    ctx.rows.get(ctx.index.subtract(1n)).match({
                                        some: (_$2, before) => finished(before).ifElse(() => East.value(none, OptionType(StringType)), () => East.value(some(East.str`waits for ${before.op}`), OptionType(StringType))),
                                    }, () => East.value(some("waits for the step before"), OptionType(StringType)))),
                                cases: {
                                    started: {
                                        label: "Start", state: "Started", tone: "info", icon: "play",
                                        next: ["completed", "reported", "held", "alerted"],
                                        updates: () => ({ group: Sheet.patch(WorkOrder, { status: "in_progress" }) }),
                                    },
                                    completed: {
                                        label: "Complete", state: "Completed", tone: "success", icon: "check",
                                        summary: (_v, s) => s.good.match({ some: (_$2, g) => East.str`${g} good` }, () => ""),
                                        updates: (_v, ctx, at) => ({
                                            row: Sheet.patch(Step, { good: some(ctx.row.good.match({ some: (_$2, g) => g }, () => ctx.row.plan)), done: some(at) }),
                                            // The last step to finish finishes the order.
                                            group: Sheet.patch(WorkOrder, { status: ctx.rows.every((_$2, r, i) =>
                                                i.equal(ctx.index).or(() => r.match({ some: (_$3, s) => finished(s) }, () => false)))
                                                .ifElse(() => "done", () => "in_progress") }),
                                        }),
                                    },
                                    reported: {
                                        label: "Report", state: "Reported", tone: "info", icon: "hashtag",
                                        next: ["completed", "reported", "held", "alerted"],
                                        take: Sheet.action.form({
                                            fields: Sheet.field.number({ label: "Good parts", unit: "pcs", min: 0n }),
                                            initial: (ctx) => ctx.row.good.match({ some: (_$2, g) => g }, () => 0n),
                                        }),
                                        summary: (count) => East.str`${count} good`,
                                        updates: (count) => ({ row: Sheet.patch(Step, { good: some(count) }) }),
                                    },
                                    held: {
                                        label: "Hold", state: "Held", tone: "warning", icon: "pause",
                                        next: ["started"],
                                        take: Sheet.action.menu({ labels: { awaiting_parts: "Awaiting parts", machine_down: "Machine down", quality_hold: "Quality hold" } }),
                                        summary: (reason) => reason.match({ awaiting_parts: () => "Awaiting parts", machine_down: () => "Machine down", quality_hold: () => "Quality hold" }),
                                        updates: () => ({ group: Sheet.patch(WorkOrder, { status: "on_hold" }) }),
                                    },
                                    alerted: {
                                        label: "Alert", state: "Alerted", tone: "danger", icon: "flag",
                                        next: ["started", "completed"],
                                        take: Sheet.action.form({ fields: {
                                            changes: Sheet.field.text({ label: "What changed", help: "What the operator saw", placeholder: "What the operator saw" }),
                                            severity: Sheet.field.select({ help: "High puts the order on hold" }),
                                        } }),
                                        summary: (alert) => alert.changes,
                                        updates: (alert) => ({ group: Sheet.patch(WorkOrder, {
                                            status: alert.severity.hasTag("high").ifElse(() => "on_hold", () => "in_progress"),
                                        }) }),
                                    },
                                    verified: {
                                        label: "Verify", state: "Verified", tone: "success",
                                        summary: () => "by QA",
                                    },
                                },
                            }),
                            done: Sheet.column.date(Step, { header: "Done", width: "64px", level: () => "time", format: "HH:mm" }),
                        }}
                        inspector
                        onApply={Record.onApply(orders, { keyed: true })}
                        applyMode="batch"
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// Example 3 — a flat sheet: a date form and a register menu
// ============================================================================

export const TicketAction = VariantType({
    acknowledged: NullType,
    deferred: DateTimeType, // until when: a form of one date field
    handed_over: StringType, // to which crew: a register's members
    closed: NullType,
});
export const Ticket = StructType({ title: StringType, crew: StringType, due: OptionType(DateTimeType), action: OptionType(TicketAction) });
export const Crew = StructType({ name: StringType });
export const sheetTickets = e3.record("sheet_tickets", DictType(StringType, Ticket), {
    initial: new Map([
        ["T-301", { title: "Spindle noise", crew: "day", due: some(new Date("2026-11-03T00:00:00Z")), action: none }],
        ["T-302", { title: "Coolant leak", crew: "swing", due: some(new Date("2026-11-04T00:00:00Z")), action: some(variant("acknowledged", null)) }],
        ["T-303", { title: "Guard latch", crew: "night", due: none, action: some(variant("closed", null)) }],
    ]),
    mutations: (mutation) => ({
        // The tickets' patch door — every Save commits through it.
        patch: mutation.patch(),
    }),
});
export const sheetCrews = e3.record("sheet_crews", DictType(StringType, Crew), {
    initial: new Map([["day", { name: "Day crew" }], ["swing", { name: "Swing crew" }], ["night", { name: "Night crew" }]]),
});

export const sheetActionsTickets = example({
    keywords: ["Sheet", "Sheet.column.action", "action", "flat", "DateTime", "Sheet.field.date", "form", "initial", "register", "Sheet.action.menu", "of", "updates", "applyMode", "auto"],
    description: "Maintenance tickets on a flat sheet: Acknowledge, Defer… (a form of one date field, opening on tomorrow, that moves the ticket's due date), Hand over ▾ (a menu of the crews register, that moves its crew) and Close, a final state — each action saved as it is taken",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const tickets = $.let(Record.bind(sheetTickets));
            const crews = $.let(Data.bind(sheetCrews));
            const crewList = $.let(crews.read());
            const open = ["acknowledged", "deferred", "handed_over", "closed"] as const;
            return (
                <Box height="420px">
                    <Sheet
                        record={tickets}
                        name="sheetActionsTickets"
                        // The tickets come from the maintenance log: this sheet takes their actions, and adds none.
                        edits={{ insertRows: false }}
                        registers={{ crews: Sheet.register.members(crewList, { kind: "crew", key: (_c, k) => k, label: c => c.name }) }}
                        columns={{
                            title: Sheet.column.text(Ticket, { header: "Ticket", width: "220px" }),
                            crew: Sheet.column.reference(Ticket, "crews", { header: "Crew", width: "120px", editable: false }),
                            due: Sheet.column.date(Ticket, { header: "Due", width: "96px", editable: false }),
                            action: Sheet.column.action(Ticket, TicketAction, {
                                header: "Action", width: "304px",
                                name: t => t.title,
                                start: open,
                                cases: {
                                    acknowledged: { label: "Acknowledge", state: "Acknowledged", tone: "info", icon: "eye", next: open },
                                    deferred: {
                                        label: "Defer", state: "Deferred", tone: "warning", icon: "clock", next: open,
                                        take: Sheet.action.form({ fields: Sheet.field.date({ label: "Until", precision: "date" }), initial: (ctx) => ctx.today.addDays(1n) }),
                                        summary: (until) => East.str`until ${until.printFormatted("DD MMM")}`,
                                        updates: (until) => ({ row: Sheet.patch(Ticket, { due: some(until) }) }),
                                    },
                                    handed_over: {
                                        label: "Hand over", state: "Handed over", icon: "right-left", next: open,
                                        take: Sheet.action.menu({ of: "crews" }),
                                        // The crew by its name, as the Crew column shows it: the value is its key.
                                        summary: (crew) => crewList.get(crew, (_$2, key) => ({ name: key })).name,
                                        updates: (crew) => ({ row: Sheet.patch(Ticket, { crew }) }),
                                    },
                                    closed: { label: "Close", state: "Closed", tone: "success", icon: "check" },
                                },
                            }),
                        }}
                        applyMode="auto"
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// Example 4 — read only
// ============================================================================

export const sheetActionsReadOnly = example({
    keywords: ["Sheet", "Sheet.column.action", "action", "readOnly", "state", "read only"],
    description: "Example 1's jobs read only: each action cell shows its state and summary alone, with no control to take",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const jobs = $.let(Record.bind(sheetActionJobs));
            return (
                <Box height="320px">
                    <Sheet
                        record={jobs}
                        name="sheetActionsReadOnly"
                        readOnly
                        columns={{
                            task: Sheet.column.text(ActionJob, { header: "Task", width: "240px" }),
                            state: Sheet.column.action(ActionJob, JobState, {
                                header: "State", width: "240px",
                                start: ["started"],
                                cases: {
                                    started: { label: "Start", state: "Started", tone: "info", icon: "play", next: ["finished"] },
                                    finished: { label: "Finish", state: "Finished", tone: "success", icon: "check" },
                                },
                            }),
                        }}
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// Example 5 — a phone
// ============================================================================

export const sheetActionsPhone = example({
    keywords: ["Sheet", "Sheet.column.action", "action", "phone", "mobile", "touch", "action bar", "cell editor", "Sheet.field.number", "applyMode", "auto"],
    description: "Example 2's work orders in a phone's box, 390 wide or the screen's width: each action cell shows its state alone, and a tap on an Action cell turns the docked strip into its action bar — the first action full width, the rest in one line, a menu or a form opening inside the bar — while a tap on Good or Done edits it there, the inspector's field at touch size; each change saved as it is made",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const orders = $.let(Record.bind(sheetWorkOrders));
            // One rail over the orders: its `rows` source narrows them.
            const slice = $.let(Slice.bindRecords("sheet.work.sheetActionsPhone", {
                rows: {
                    source: Data.bindPaged(sheetWorkOrders, { indexes: ["sheet_work_orders_by_status"] }),
                    label: "Orders",
                    fields: { status: { label: "Status", hints: [{ value: "in_progress", label: "In progress" }, { value: "on_hold", label: "On hold" }, { value: "done", label: "Done" }] } },
                },
            }));
            const statuses = $.let([
                { word: "in_progress", label: "In progress", tone: variant("info", null) },
                { word: "on_hold", label: "On hold", tone: variant("warning", null) },
                { word: "done", label: "Done", tone: variant("success", null) },
            ], ArrayType(WorkStatus));
            // A step is finished once completed or verified.
            const finished = $.const(East.function([Step], BooleanType, (_$2, step) =>
                step.action.match({ some: (_$3, a) => a.hasTag("completed").or(() => a.hasTag("verified")) }, () => false)));
            return (
                <Box width="390px" maxWidth="100%" height="620px">
                    <Sheet
                        slice={{ slice }}
                        name="sheetActionsPhone"
                        // The orders and their steps come from planning: this sheet takes their actions, and adds neither.
                        edits={{ insertRows: false, insertGroups: false }}
                        group={Sheet.group(WorkOrder, "steps", {
                            title: "name", sub: o => o.id, noun: { singular: "order", plural: "orders" },
                            // The order's status on its band, under the Action column; the actions write it, and a status card sets it.
                            cells: { action: Sheet.group.cell.enum(WorkOrder, "statuses", "status") },
                        })}
                        registers={{
                            statuses: Sheet.register.members(statuses, { kind: "status", key: s => s.word, label: s => s.label, tone: s => some(s.tone) }),
                        }}
                        columns={{
                            step: Sheet.column.text(Step, { header: "Step", width: "158px", editable: false }),
                            good: Sheet.column.integer(Step, { header: "Good", width: "56px" }),
                            action: Sheet.column.action(Step, StepAction, {
                                header: "Action", width: "304px",
                                name: s => East.str`step ${s.op}`,
                                title: s => s.step,
                                start: ["started"],
                                // A step waits until the step before it is finished.
                                blocked: (ctx) => ctx.index.equal(0n).ifElse(() => East.value(none, OptionType(StringType)), () =>
                                    ctx.rows.get(ctx.index.subtract(1n)).match({
                                        some: (_$2, before) => finished(before).ifElse(() => East.value(none, OptionType(StringType)), () => East.value(some(East.str`waits for ${before.op}`), OptionType(StringType))),
                                    }, () => East.value(some("waits for the step before"), OptionType(StringType)))),
                                cases: {
                                    started: {
                                        label: "Start", state: "Started", tone: "info", icon: "play",
                                        next: ["completed", "reported", "held", "alerted"],
                                        updates: () => ({ group: Sheet.patch(WorkOrder, { status: "in_progress" }) }),
                                    },
                                    completed: {
                                        label: "Complete", state: "Completed", tone: "success", icon: "check",
                                        summary: (_v, s) => s.good.match({ some: (_$2, g) => East.str`${g} good` }, () => ""),
                                        updates: (_v, ctx, at) => ({
                                            row: Sheet.patch(Step, { good: some(ctx.row.good.match({ some: (_$2, g) => g }, () => ctx.row.plan)), done: some(at) }),
                                            // The last step to finish finishes the order.
                                            group: Sheet.patch(WorkOrder, { status: ctx.rows.every((_$2, r, i) =>
                                                i.equal(ctx.index).or(() => r.match({ some: (_$3, s) => finished(s) }, () => false)))
                                                .ifElse(() => "done", () => "in_progress") }),
                                        }),
                                    },
                                    reported: {
                                        label: "Report", state: "Reported", tone: "info", icon: "hashtag",
                                        next: ["completed", "reported", "held", "alerted"],
                                        take: Sheet.action.form({
                                            fields: Sheet.field.number({ label: "Good parts", unit: "pcs", min: 0n }),
                                            initial: (ctx) => ctx.row.good.match({ some: (_$2, g) => g }, () => 0n),
                                        }),
                                        summary: (count) => East.str`${count} good`,
                                        updates: (count) => ({ row: Sheet.patch(Step, { good: some(count) }) }),
                                    },
                                    held: {
                                        label: "Hold", state: "Held", tone: "warning", icon: "pause",
                                        next: ["started"],
                                        take: Sheet.action.menu({ labels: { awaiting_parts: "Awaiting parts", machine_down: "Machine down", quality_hold: "Quality hold" } }),
                                        summary: (reason) => reason.match({ awaiting_parts: () => "Awaiting parts", machine_down: () => "Machine down", quality_hold: () => "Quality hold" }),
                                        updates: () => ({ group: Sheet.patch(WorkOrder, { status: "on_hold" }) }),
                                    },
                                    alerted: {
                                        label: "Alert", state: "Alerted", tone: "danger", icon: "flag",
                                        next: ["started", "completed"],
                                        take: Sheet.action.form({ fields: {
                                            changes: Sheet.field.text({ label: "What changed", help: "What the operator saw", placeholder: "What the operator saw" }),
                                            severity: Sheet.field.select({ help: "High puts the order on hold" }),
                                        } }),
                                        summary: (alert) => alert.changes,
                                        updates: (alert) => ({ group: Sheet.patch(WorkOrder, {
                                            status: alert.severity.hasTag("high").ifElse(() => "on_hold", () => "in_progress"),
                                        }) }),
                                    },
                                    verified: {
                                        label: "Verify", state: "Verified", tone: "success",
                                        summary: () => "by QA",
                                    },
                                },
                            }),
                            done: Sheet.column.date(Step, { header: "Done", width: "64px", level: () => "time", format: "HH:mm" }),
                        }}
                        library={[
                            // The statuses an order takes: a tap sets one on the selected order, as a drop on its band does on a wider frame.
                            Sheet.library.tab(statuses, { name: "Statuses", key: s => s.word, label: s => s.label, drop: s => Sheet.patch(WorkOrder, { status: s.word }) }),
                            Sheet.library.columns(),
                        ]}
                        inspector
                        // Good's field, as a tap on its cell edits it under the grid: counted in parts, never below none.
                        fields={{ good: Sheet.field.number({ unit: "pcs", min: 0n, help: "empty until reported" }) }}
                        onApply={Record.onApply(orders, { keyed: true })}
                        applyMode="auto"
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const sheetActionsPinned = example({
    keywords: ["Sheet", "narrow", "pin", "columns", "phone", "mobile", "pinned column", "pager", "Row number"],
    description: "Example 3's tickets in a phone's box, their title pinned at the left beside a window of one column the pager pages: `narrow` says which column stays and how many others show, and says nothing wider than 560px",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const tickets = $.let(Record.bind(sheetTickets));
            const crews = $.let(Data.bind(sheetCrews));
            const crewList = $.let(crews.read());
            return (
                <Box width="390px" maxWidth="100%" height="420px">
                    <Sheet
                        record={tickets}
                        name="sheetActionsPinned"
                        // The tickets come from the maintenance log: this sheet adds none.
                        edits={{ insertRows: false }}
                        narrow={{ pin: "title", columns: 1 }}
                        registers={{ crews: Sheet.register.members(crewList, { kind: "crew", key: (_c, k) => k, label: c => c.name }) }}
                        columns={{
                            title: Sheet.column.text(Ticket, { header: "Ticket", width: "220px" }),
                            crew: Sheet.column.reference(Ticket, "crews", { header: "Crew", width: "120px", editable: false }),
                            due: Sheet.column.date(Ticket, { header: "Due", width: "96px", editable: false }),
                        }}
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

