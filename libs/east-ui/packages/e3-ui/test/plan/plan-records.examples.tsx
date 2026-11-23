/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
import {
    ArrayType, DateTimeType, DictType, East, FloatType, IntegerType, OptionType, StringType, StructType, example, none, some, variant,
} from "@elaraai/east";
import { Box, EventStateType, Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
import { Data, Plan, Record, Schedule } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";
import { IndexedWork, indexedWorkDue, indexedWorkJob, indexedWorkOrders, indexedWorkReference } from "../sheet/sheet-records.examples.js";

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
    initial: () => East.compile(generateOperations, [])(50000n),
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
        // The operations' totals a month, a quarter and a year (#1732): how many of them touch each, under no work order —
        // what the horizon's bars read at the period that fits the strip, never counting operations.
        plan_operations_month_totals: index.summary({ from: "start", to: "end", tile: "month" }),
        plan_operations_quarter_totals: index.summary({ from: "start", to: "end", tile: "quarter" }),
        plan_operations_year_totals: index.summary({ from: "start", to: "end", tile: "year" }),
    }),
    mutations: (mutation) => ({
        // The operations' patch door: a canvas's Save commits through it, by the operation's key.
        patch: mutation.patch(),
    }),
});

/**
 * The Sheet's 50,000 work orders on a Plan, a row each, and their operations
 * a record of their own placed on them (#1344, #1039, #1541). The work orders
 * are the canvas's rows, laid out by a `Plan.series.resources`, counted as
 * work orders, the Plan's word for its rows (`vocabulary`), and narrowed
 * through the rail's `rows` source over their indexes: by Status, Due, Job, Quantity,
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
        "Plan", "Schedule", "Plan.series.resources", "Schedule.events", "Slice", "Slice.bindRecords", "source", "rail", "narrow",
        "rows source", "paged", "Data.bindPaged", "index.on", "interval index", "series index", "summary index",
        "index.interval", "index.series", "index.summary", "cell", "window", "range", "large record",
        "million rows", "work orders", "operations", "Record.bind", "entries", "editing", "Save", "#1344", "#1039",
    ],
    description: "The Sheet's 50,000 work orders on a Plan — its rows, a Plan.series.resources over the rail's `rows` source, narrowed over their indexes: Status with a Due range, Job, Quantity, Urgent and Tag, the presets and the search, Due a field of the rail the viewer sets — and their operations a record of their own placed on them, read a cell at a time: the `operation` source lists their interval, series and summary indexes, its range the canvas's window, so the orders' rows stay as the dates move and only the cells around the rows in view are read; a moved operation is a draft of its kind's session, saved through the operations' patch door by its key",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const operations = $.let(Record.bind(planOperations));
            const operationEntries = $.let(Data.bindPaged(planOperations));
            // One rail. Its `rows` source narrows the work orders through their indexes, and the canvas pages the
            // narrowing's orders, its rows, their Due a field of the rail the viewer sets. Its `operation` source reads the
            // operations a cell at a time through their series and summary indexes, its range the canvas's window.
            const slice = $.let(Slice.bindRecords("ex.planRecordIndexes", {
                rows: {
                    source: Data.bindPaged(indexedWorkOrders, { indexes: ["by_status_due", "by_due", "by_job", "by_quantity", "by_urgent", "by_tag"] }),
                    label: "Work orders", icon: { prefix: "fas", name: "clipboard-list" },
                    fields: { status: { label: "Status", hints: ["Ready", "Scheduled", "Done"] }, due: { label: "Due" }, job: { label: "Job" }, quantity: { label: "Quantity" }, urgent: { label: "Urgent" }, tags: { label: "Tag", hints: ["Production", "Dispatch"] } },
                    search: ["job"], initial: { status: ["Ready"], due: { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-10-15T00:00:00Z") } },
                },
                operation: {
                    source: Data.bindPaged(planOperations, {
                        indexes: ["plan_operations_by_time", "plan_operations_by_work_week", "plan_operations_by_work_month"],
                        // The operations' totals, which the horizon's bars read (#1732).
                        totals: ["plan_operations_month_totals", "plan_operations_quarter_totals", "plan_operations_year_totals"],
                    }),
                    label: "Operations", fields: { start: { label: "Dates" } }, range: "start",
                },
            }, { presets: [{ id: "ready", name: "Ready", where: { rows: { status: ["Ready"] } } }, { id: "urgent", name: "Urgent", where: { rows: { urgent: [true] } } }] }));
            return <Box width="100%" height="760px"><Plan id="planRecordIndexes" slice={{ slice }}
                // Its rows are work orders, in the Plan's word for them: what the rail counts and the footer's line names.
                vocabulary={{ rows: { one: "Work order", other: "Work orders" } }}
                axis={Plan.axis({ window: { min: new Date("2026-10-01T00:00:00Z"), max: new Date("2026-10-15T00:00:00Z") }, resolution: "day", resolutions: ["month", "week", "day"] })}
                series={[Plan.series.resources(IndexedWork, { key: "orders", title: "Work orders", icon: "clipboard-list", label: (w) => w.reference, sub: (w) => some(w.status) })]}
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
 * work orders, its rows, narrowed through the same rail, on the toolbar's responsive
 * ladder, and the same operations read a cell at a time, their source holding
 * the canvas's window — the narrow layout's cards drawn from the same reads.
 */
export const planRecordIndexesMobile = example({
    keywords: [
        "Plan", "Schedule", "Plan.series.resources", "Schedule.events", "Slice", "Slice.bindRecords", "rail", "mobile", "narrow layout",
        "rows source", "paged", "Data.bindPaged", "series index", "summary index", "cell", "work orders", "operations", "#1344", "#1039",
    ],
    description: "The work orders Plan of planRecordIndexes in a phone-width frame — the work orders, its rows, narrowed through the same rail on the toolbar's responsive ladder, Due a field of it, and their operations read a cell at a time, their source holding the canvas's window, so the dates never narrow the orders",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const operations = $.let(Record.bind(planOperations));
            const operationEntries = $.let(Data.bindPaged(planOperations));
            // The rail of planRecordIndexes: the work orders by their indexes, its rows, and the operations by cells, holding the window.
            const slice = $.let(Slice.bindRecords("ex.planRecordIndexesMobile", {
                rows: {
                    source: Data.bindPaged(indexedWorkOrders, { indexes: ["by_status_due", "by_due", "by_job", "by_quantity", "by_urgent", "by_tag"] }),
                    label: "Work orders", icon: { prefix: "fas", name: "clipboard-list" },
                    fields: { status: { label: "Status", hints: ["Ready", "Scheduled", "Done"] }, due: { label: "Due" }, job: { label: "Job" }, quantity: { label: "Quantity" }, urgent: { label: "Urgent" }, tags: { label: "Tag", hints: ["Production", "Dispatch"] } },
                    search: ["job"], initial: { status: ["Ready"], due: { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-10-15T00:00:00Z") } },
                },
                operation: {
                    source: Data.bindPaged(planOperations, {
                        indexes: ["plan_operations_by_time", "plan_operations_by_work_week", "plan_operations_by_work_month"],
                        // The operations' totals, which the horizon's bars read (#1732).
                        totals: ["plan_operations_month_totals", "plan_operations_quarter_totals", "plan_operations_year_totals"],
                    }),
                    label: "Operations", fields: { start: { label: "Dates" } }, range: "start",
                },
            }, { presets: [{ id: "ready", name: "Ready", where: { rows: { status: ["Ready"] } } }, { id: "urgent", name: "Urgent", where: { rows: { urgent: [true] } } }] }));
            return <Box width="100%" maxWidth="390px" height="760px"><Plan id="planRecordIndexesMobile" slice={{ slice }}
                vocabulary={{ rows: { one: "Work order", other: "Work orders" } }}
                library={[Plan.library.series()]}
                inspector
                axis={Plan.axis({ window: { min: new Date("2026-10-01T00:00:00Z"), max: new Date("2026-10-15T00:00:00Z") }, resolution: "day", resolutions: ["month", "week", "day"] })}
                series={[Plan.series.resources(IndexedWork, { key: "orders", title: "Work orders", icon: "clipboard-list", label: (w) => w.reference, sub: (w) => some(w.status) })]}
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

/** A job on a press: what it makes, when it runs, and its state. */
export const PlanHallJob = StructType({ product: StringType, start: DateTimeType, end: DateTimeType, state: EventStateType });
/** A press of a hall: its name, and its jobs by key. */
export const PlanHallPress = StructType({ label: StringType, jobs: DictType(StringType, PlanHallJob) });
/** A hall: its name, and its presses by key. */
export const PlanHall = StructType({ name: StringType, presses: DictType(StringType, PlanHallPress) });
/** The halls, by key. */
export const PlanHalls = DictType(StringType, PlanHall);

/**
 * `halls` halls of `presses` presses each, keyed `H-101` on and each press `P-101` on within its hall, so their keys
 * hold their order: a press's two jobs a week apart in October 2026, a day and two days long, each press at its own
 * offset so no two presses' jobs line up. A function of the counts alone.
 */
export const generatePlanHalls = East.function([IntegerType, IntegerType], PlanHalls, ($, halls, presses) => {
    const start = $.const(new Date("2026-10-05T00:00:00Z"));
    const products = $.const(["cap", "lid", "tub", "jar"], ArrayType(StringType));
    const confirmed = $.const(variant("confirmed", null), EventStateType);
    return East.Array.range(0n, halls).toDict(
        (_$2, h) => East.str`H-${h.add(101n)}`,
        (_$2, h) => ({
            name: East.str`Hall ${h.add(1n)}`,
            presses: East.Array.range(0n, presses).toDict(
                (_$3, p) => East.str`P-${p.add(101n)}`,
                ($3, p) => {
                    const offset = $3.const(h.multiply(7n).add(p).remainder(10n));
                    return {
                        label: East.str`Press ${p.add(1n)}`,
                        jobs: East.Array.range(0n, 2n).toDict(
                            (_$4, j) => East.str`J-${j.add(1n)}`,
                            ($4, j) => {
                                const begins = $4.const(start.addDays(offset.add(j.multiply(7n))));
                                return { product: products.get(h.add(p).add(j).remainder(4n)), start: begins, end: begins.addDays(j.add(1n)), state: confirmed };
                            },
                        ),
                    };
                },
            ),
        }),
    );
});

/** Forty halls of 75 presses each, 3,000 presses: read a hall at a time, never whole. */
export const planHalls = e3.record("plan_halls", PlanHalls, {
    initial: () => East.compile(generatePlanHalls, [])(40n, 75n),
});

/**
 * Forty halls of 75 presses each on a Plan, a group each with its presses'
 * rows beneath it, read a hall at a time (#1714). A window of the rows is 200
 * of their entries unless the Plan says otherwise, and under
 * `Plan.series.group` an entry is a group with every row it nests: these forty
 * would be one window, and the canvas would make all 3,000 presses' rows as it
 * opened. `paging={{ entries: 1 }}` makes a window one hall: the canvas reads
 * and makes the halls near the view, and every other hall stands as a band of
 * its height until the view nears it.
 */
export const planGroupWindows = example({
    keywords: [
        "Plan", "Plan.series.group", "Plan.children", "Plan.series.span", "groups", "paging", "entries", "window", "windows",
        "paged", "Data.bindPaged", "large groups", "rows near the view", "bands", "#1714",
    ],
    description: "Forty halls of 75 presses each on a Plan, a group each with its presses' rows beneath it, read a hall at a time: paging={{ entries: 1 }} makes a window of the rows one of their entries, so the canvas makes rows only for the halls near the view, every other hall a band of its height until the view nears it, where a window of 200 entries would make all 3,000 presses' rows as it opened",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const halls = $.let(Data.bindPaged(planHalls));
            return <Box width="100%" height="760px"><Plan id="planGroupWindows" data={halls}
                // A window of the rows is one hall: the canvas makes the rows of the halls near the view alone.
                paging={{ entries: 1 }}
                axis={Plan.axis({ window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-10-26T00:00:00Z") }, resolution: "day", resolutions: ["week", "day"] })}
                series={[Plan.series.group(PlanHall, {
                    key: "halls", title: "Halls", label: (hall) => hall.name,
                    children: Plan.children("presses", [Plan.series.span(PlanHallPress, {
                        key: "presses", title: "Press", label: (press) => press.label,
                        runs: Plan.items("jobs", { from: "start", to: "end" }, (job) => ({ label: job.product, state: job.state })),
                    })]),
                })]}
                style={{ height: "fill" }} />
            </Box>;
        }}</Reactive>
    )),
    inputs: [],
});
