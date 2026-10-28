/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
import { DateTimeType, DictType, East, FloatType, IntegerType, OptionType, StringType, StructType, example, none, some, variant } from "@elaraai/east";
import { Box, Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
import { Data, Plan, Record, Schedule } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";
import { indexedWorkDue, indexedWorkJob, indexedWorkOrders, indexedWorkReference } from "../sheet/sheet-records.examples.js";

/** A job dropped on a press, under its id: a mark at the bucket it landed in. */
export const PlanPressJob = StructType({ at: Plan.Types.Instant });
/** A press: its name, the crew that runs it (none yet), and the jobs dropped on it, by their ids (#1436). */
export const PlanPress = StructType({ label: StringType, crew: OptionType(StringType), jobs: DictType(StringType, PlanPressJob) });
/** Three presses a Plan canvas takes dropped jobs on, a row each, read a window at a time: Press 2 has no crew yet. */
export const planPresses = e3.record("plan_presses", DictType(StringType, PlanPress), {
    initial: new Map([
        ["p1", { label: "Press 1", crew: some("Crew A"), jobs: new Map() }],
        ["p2", { label: "Press 2", crew: none, jobs: new Map() }],
        ["p3", { label: "Press 3", crew: some("Crew C"), jobs: new Map() }],
    ]),
    mutations: (mutation) => ({
        // The presses' patch door: a canvas's Save commits through it.
        patch: mutation.patch(),
    }),
});

/** A row a canvas narrows through its rail: when it falls, its owner and its hall. */
export const PlanDatedRow = StructType({ at: DateTimeType, owner: StringType, hall: StringType });
/** Rows a canvas's rail narrows, a quarter apart — Team A's in week 27, Team B's in week 39 — by owner and by hall, their dates the window's range: read through the indexes below, never whole. */
export const planDatedRows = e3.record("plan_dated_rows", DictType(StringType, PlanDatedRow), {
    initial: new Map([
        ["r1", { at: new Date("2026-06-29T00:00:00Z"), owner: "Team A", hall: "Hall 1" }],
        ["r2", { at: new Date("2026-09-21T00:00:00Z"), owner: "Team B", hall: "Hall 1" }],
    ]),
    indexes: (index) => ({
        // The rows by date: the window's index.
        plan_dated_rows_by_at: index.on(["at"]),
        // The rows by owner, then date: an owner chosen beside the window.
        plan_dated_rows_by_owner_at: index.on(["owner", "at"]),
        // The rows by hall, then date: a hall chosen beside the window.
        plan_dated_rows_by_hall_at: index.on(["hall", "at"]),
    }),
    mutations: (mutation) => ({
        // The rows' patch door: another session's rows go in through it.
        patch: mutation.patch(),
    }),
});

/** An order on a number axis: the day it is due. */
export const PlanDayOrder = StructType({ day: IntegerType });
/** Twelve orders, one a day from day 1 to day 12: a number axis's window is a range of their days. */
export const planDayOrders = e3.record("plan_day_orders", DictType(StringType, PlanDayOrder), {
    initial: new Map([
        ["o01", { day: 1n }], ["o02", { day: 2n }], ["o03", { day: 3n }], ["o04", { day: 4n }],
        ["o05", { day: 5n }], ["o06", { day: 6n }], ["o07", { day: 7n }], ["o08", { day: 8n }],
        ["o09", { day: 9n }], ["o10", { day: 10n }], ["o11", { day: 11n }], ["o12", { day: 12n }],
    ]),
    indexes: (index) => ({
        // The orders by day.
        plan_day_orders_by_day: index.on(["day"]),
    }),
});
/** A van's run on a number axis: the day it leaves, which may fall part way through one. */
export const PlanDayVan = StructType({ day: FloatType });
/** Two vans, leaving on day 1 and on day 12: a number axis's window is a range of their days. */
export const planDayVans = e3.record("plan_day_vans", DictType(StringType, PlanDayVan), {
    initial: new Map([
        ["v1", { day: 1.0 }], ["v2", { day: 12.0 }],
    ]),
    indexes: (index) => ({
        // The vans by day.
        plan_day_vans_by_day: index.on(["day"]),
    }),
});

/** An operation on a work order: the order it is on, by its key, the work it does, and when it runs. */
export const PlanOperation = StructType({ work: StringType, label: StringType, start: DateTimeType, end: DateTimeType });
const Operations = DictType(StringType, PlanOperation);

/**
 * The work orders' operations, from their count: each of the first `count` orders' run of its job on the day it is
 * due, 06:00 to 14:00, keyed by its order's reference and `-run`. The same pure generator seeds the record and runs as
 * an e3 task.
 */
const generateOperations = East.function([IntegerType], Operations, ($, count) => {
    const rows = $.let(new Map(), Operations);
    const referenceOf = $.const(indexedWorkReference);
    const jobOf = $.const(indexedWorkJob);
    const dueOf = $.const(indexedWorkDue);
    const i = $.let(0n);
    $.while(i.less(count), ($2) => {
        const work = $2.const(referenceOf(i));
        const due = $2.const(dueOf(i));
        $2(rows.insert(East.str`${work}-run`, { work, label: jobOf(i), start: due.addMilliseconds(21600000n), end: due.addMilliseconds(50400000n) }));
        $2.assign(i, i.add(1n));
    });
    return rows;
});

/** How many work orders' operations the task generates: the Sheet's 50,000 orders'. */
export const planOperationCount = e3.input("plan_operation_count", IntegerType, variant("value", 50000n));
/** The task that generates the operations from their count. */
export const planOperationsGenerated = e3.task("plan_operations_generated", [planOperationCount], generateOperations);
/** The 50,000 work orders' operations, one an order, keyed by the operation's key: read through the indexes below, never whole. */
export const planOperations = e3.record("plan_operations", Operations, {
    initial: East.compile(generateOperations, [])(50000n),
    indexes: (index) => ({
        // The operations over the interval each runs: the canvas's window, and the rail's exact count of the operations in it.
        plan_operations_by_time: index.interval({ from: "start", to: "end" }),
        // The operations by their work order and by time, each filed once at the level its length fits: a cell is fifty orders' operations over a level's run (#1433).
        plan_operations_by_work_week: index.series({
            key: "work", from: "start", to: "end", tile: "week",
        }),
        // How busy each work order is, a month at a time: what the canvas shades where the operations in view are too many to draw.
        plan_operations_by_work_month: index.summary({
            key: "work", from: "start", to: "end", tile: "month",
        }),
    }),
    mutations: (mutation) => ({
        // The operations' patch door: a canvas's Save commits through it, by the operation's key.
        patch: mutation.patch(),
    }),
});

/**
 * The Sheet's 50,000 work orders on a Plan, a row each, and their operations
 * a record of their own placed on them (#1344, #1039). The work orders are a
 * paged resource kind, narrowed through the rail's `orders` source — named
 * after the kind's slot — over their indexes: by Status, Due, Job, Quantity,
 * Urgent and Tag, with the presets and the search, opening on the orders Ready
 * and due in the first fortnight of October. The canvas pages the narrowing's
 * orders themselves, in its index's order, and the dates on screen never
 * decide which are listed: Due is a field of the rail the viewer sets. The
 * rail's `operation` source lists the operations' interval index, their series
 * index and their summary, its range their start, so it holds the canvas's
 * window: the canvas reads the operations of the orders in view a cell at a
 * time, a pan within the weeks it holds reads nothing, and the orders' rows
 * stay where they are as the dates move. Moving or resizing an operation
 * drafts it in the operations kind's session, whatever the rail shows, and
 * Save commits it through the operations' patch door by its key — so a
 * million work orders, each with a year of operations, read what is on screen.
 */
export const planRecordIndexes = example({
    keywords: [
        "Plan", "Schedule", "Schedule.resources", "Schedule.events", "Slice", "Slice.bindRecords", "source", "rail", "narrow",
        "resource kind", "paged", "Data.bindPaged", "index.on", "interval index", "series index", "summary index",
        "index.interval", "index.series", "index.summary", "cell", "window", "range", "large record",
        "million rows", "work orders", "operations", "Record.bind", "entries", "editing", "Save", "#1344", "#1039",
    ],
    description: "The Sheet's 50,000 work orders on a Plan — a paged resource kind narrowed through the rail's `orders` source over their indexes: Status with a Due range, Job, Quantity, Urgent and Tag, the presets and the search, Due a field of the rail the viewer sets — and their operations a record of their own placed on them, read a cell at a time: the `operation` source lists their interval, series and summary indexes, its range the canvas's window, so the orders' rows stay as the dates move and only the cells around the rows in view are read; a moved operation is a draft of its kind's session, saved through the operations' patch door by its key",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const orders = $.let(Data.bindPaged(indexedWorkOrders));
            const operations = $.let(Record.bind(planOperations));
            const operationEntries = $.let(Data.bindPaged(planOperations));
            // One rail. Its `orders` source narrows the paged work orders through their indexes, and the canvas pages the
            // narrowing's orders, their Due a field of the rail the viewer sets. Its `operation` source reads the
            // operations a cell at a time through their series and summary indexes, its range the canvas's window.
            const slice = $.let(Slice.bindRecords("ex.planRecordIndexes", {
                orders: {
                    source: Data.bindPaged(indexedWorkOrders, { indexes: ["by_status_due", "by_due", "by_job", "by_quantity", "by_urgent", "by_tag"] }),
                    label: "Work orders", icon: { prefix: "fas", name: "clipboard-list" },
                    fields: { status: { label: "Status", hints: ["Ready", "Scheduled", "Done"] }, due: { label: "Due" }, job: { label: "Job" }, quantity: { label: "Quantity" }, urgent: { label: "Urgent" }, tags: { label: "Tag", hints: ["Production", "Dispatch"] } },
                    search: ["job"], initial: { status: ["Ready"], due: { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-10-15T00:00:00Z") } },
                },
                operation: {
                    source: Data.bindPaged(planOperations, { indexes: ["plan_operations_by_time", "plan_operations_by_work_week", "plan_operations_by_work_month"] }),
                    label: "Operations", fields: { start: { label: "Dates" } }, range: "start",
                },
            }, { presets: [{ id: "ready", name: "Ready", where: { orders: { status: ["Ready"] } } }, { id: "urgent", name: "Urgent", where: { orders: { urgent: [true] } } }] }));
            return <Box width="100%" height="760px"><Plan id="planRecordIndexes" slice={{ slice }}
                axis={Plan.axis({ window: { min: new Date("2026-10-01T00:00:00Z"), max: new Date("2026-10-15T00:00:00Z") }, resolution: "day", resolutions: ["month", "week", "day"] })}
                resources={{
                    orders: Schedule.resources(orders, { name: "Work orders", icon: "clipboard-list", label: (w) => w.reference, sub: (w) => some(w.status) }),
                }}
                events={{
                    operation: Schedule.events(operations, {
                        name: "Operation", icon: "gears", title: "label", start: "start", end: "end",
                        resource: { field: "work", of: "orders" }, entries: operationEntries,
                    }),
                }}
                style={{ height: "fill" }} />
            </Box>;
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * The work orders Plan of `planRecordIndexes` in a phone-width frame: the same
 * paged work orders narrowed through the same rail, on the toolbar's responsive
 * ladder, and the same operations read a cell at a time, their source holding
 * the canvas's window — the narrow layout's cards drawn from the same reads.
 */
export const planRecordIndexesMobile = example({
    keywords: [
        "Plan", "Schedule", "Schedule.resources", "Schedule.events", "Slice", "Slice.bindRecords", "rail", "mobile", "narrow layout",
        "resource kind", "paged", "Data.bindPaged", "series index", "summary index", "cell", "work orders", "operations", "#1344", "#1039",
    ],
    description: "The work orders Plan of planRecordIndexes in a phone-width frame — the paged work orders narrowed through the same rail on the toolbar's responsive ladder, Due a field of it, and their operations read a cell at a time, their source holding the canvas's window, so the dates never narrow the orders",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const orders = $.let(Data.bindPaged(indexedWorkOrders));
            const operations = $.let(Record.bind(planOperations));
            const operationEntries = $.let(Data.bindPaged(planOperations));
            // The rail of planRecordIndexes: the paged work orders by their indexes, and the operations by cells, holding the window.
            const slice = $.let(Slice.bindRecords("ex.planRecordIndexesMobile", {
                orders: {
                    source: Data.bindPaged(indexedWorkOrders, { indexes: ["by_status_due", "by_due", "by_job", "by_quantity", "by_urgent", "by_tag"] }),
                    label: "Work orders", icon: { prefix: "fas", name: "clipboard-list" },
                    fields: { status: { label: "Status", hints: ["Ready", "Scheduled", "Done"] }, due: { label: "Due" }, job: { label: "Job" }, quantity: { label: "Quantity" }, urgent: { label: "Urgent" }, tags: { label: "Tag", hints: ["Production", "Dispatch"] } },
                    search: ["job"], initial: { status: ["Ready"], due: { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-10-15T00:00:00Z") } },
                },
                operation: {
                    source: Data.bindPaged(planOperations, { indexes: ["plan_operations_by_time", "plan_operations_by_work_week", "plan_operations_by_work_month"] }),
                    label: "Operations", fields: { start: { label: "Dates" } }, range: "start",
                },
            }, { presets: [{ id: "ready", name: "Ready", where: { orders: { status: ["Ready"] } } }, { id: "urgent", name: "Urgent", where: { orders: { urgent: [true] } } }] }));
            return <Box width="100%" maxWidth="390px" height="760px"><Plan id="planRecordIndexesMobile" slice={{ slice }}
                axis={Plan.axis({ window: { min: new Date("2026-10-01T00:00:00Z"), max: new Date("2026-10-15T00:00:00Z") }, resolution: "day", resolutions: ["month", "week", "day"] })}
                resources={{
                    orders: Schedule.resources(orders, { name: "Work orders", icon: "clipboard-list", label: (w) => w.reference, sub: (w) => some(w.status) }),
                }}
                events={{
                    operation: Schedule.events(operations, {
                        name: "Operation", icon: "gears", title: "label", start: "start", end: "end",
                        resource: { field: "work", of: "orders" }, entries: operationEntries,
                    }),
                }}
                style={{ height: "fill" }} />
            </Box>;
        }}</Reactive>
    )),
    inputs: [],
});
