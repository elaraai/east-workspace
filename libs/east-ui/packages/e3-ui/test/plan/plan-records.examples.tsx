/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
import { ArrayType, DateTimeType, DictType, East, FloatType, IntegerType, OptionType, StringType, StructType, example, none, some } from "@elaraai/east";
import { Box, Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
import { Data, Plan, Record } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";
import { IndexedWork, indexedWorkOrders, indexedWorkPatch, indexedWorkByStatusDue, indexedWorkByDue, indexedWorkByJob, indexedWorkByQuantity, indexedWorkByUrgent, indexedWorkByTag } from "../sheet/sheet-records.examples.js";

/** A job dropped on a press: a decision at the bucket it landed in. */
export const PlanPressJob = StructType({ key: StringType, at: Plan.Types.Instant });
/** A press: its name, the crew that runs it (none yet), and the jobs dropped on it. */
export const PlanPress = StructType({ label: StringType, crew: OptionType(StringType), jobs: ArrayType(PlanPressJob) });
/** Three presses a Plan canvas takes dropped jobs on, a row each, read a window at a time: Press 2 has no crew yet. */
export const planPresses = e3.record("plan_presses", DictType(StringType, PlanPress), new Map([
    ["p1", { label: "Press 1", crew: some("Crew A"), jobs: [] }],
    ["p2", { label: "Press 2", crew: none, jobs: [] }],
    ["p3", { label: "Press 3", crew: some("Crew C"), jobs: [] }],
]));
/** The presses' patch door: a canvas's Save commits through it. */
export const planPressesPatch = e3.mutation.patch(planPresses);

/** A row a canvas narrows through its rail: when it falls, its owner and its hall. */
export const PlanDatedRow = StructType({ at: DateTimeType, owner: StringType, hall: StringType });
/** Rows a canvas's rail narrows, a quarter apart — Team A's in week 27, Team B's in week 39 — by owner and by hall, their dates the window's range: read through the indexes below, never whole. */
export const planDatedRows = e3.record("plan_dated_rows", DictType(StringType, PlanDatedRow), new Map([
    ["r1", { at: new Date("2026-06-29T00:00:00Z"), owner: "Team A", hall: "Hall 1" }],
    ["r2", { at: new Date("2026-09-21T00:00:00Z"), owner: "Team B", hall: "Hall 1" }],
]));
/** The rows' patch door: another session's rows go in through it. */
export const planDatedRowsPatch = e3.mutation.patch(planDatedRows);
/** The rows by date: the window's index. */
export const planDatedRowsByAt = e3.recordIndex("plan_dated_rows_by_at", planDatedRows, { on: ["at"] });
/** The rows by owner, then date: an owner chosen beside the window. */
export const planDatedRowsByOwnerAt = e3.recordIndex("plan_dated_rows_by_owner_at", planDatedRows, { on: ["owner", "at"] });
/** The rows by hall, then date: a hall chosen beside the window. */
export const planDatedRowsByHallAt = e3.recordIndex("plan_dated_rows_by_hall_at", planDatedRows, { on: ["hall", "at"] });

/** An order on a number axis: the day it is due. */
export const PlanDayOrder = StructType({ day: IntegerType });
/** Twelve orders, one a day from day 1 to day 12: a number axis's window is a range of their days. */
export const planDayOrders = e3.record("plan_day_orders", DictType(StringType, PlanDayOrder), new Map([
    ["o01", { day: 1n }], ["o02", { day: 2n }], ["o03", { day: 3n }], ["o04", { day: 4n }],
    ["o05", { day: 5n }], ["o06", { day: 6n }], ["o07", { day: 7n }], ["o08", { day: 8n }],
    ["o09", { day: 9n }], ["o10", { day: 10n }], ["o11", { day: 11n }], ["o12", { day: 12n }],
]));
/** The orders by day. */
export const planDayOrdersByDay = e3.recordIndex("plan_day_orders_by_day", planDayOrders, { on: ["day"] });
/** A van's run on a number axis: the day it leaves, which may fall part way through one. */
export const PlanDayVan = StructType({ day: FloatType });
/** Two vans, leaving on day 1 and on day 12: a number axis's window is a range of their days. */
export const planDayVans = e3.record("plan_day_vans", DictType(StringType, PlanDayVan), new Map([
    ["v1", { day: 1.0 }], ["v2", { day: 12.0 }],
]));
/** The vans by day. */
export const planDayVansByDay = e3.recordIndex("plan_day_vans_by_day", planDayVans, { on: ["day"] });

export const planRecordIndexes = example({
    description: "The Sheet's 50,000 bound work orders on a Plan, narrowed through one rail: the slice's `rows` source (`Slice.bindRecords`) gives the canvas its rows, paged from it. Multiple statuses combine with the Due range through the status/due index, and the Due range is the canvas's window — the toolbar's dates, its range and the horizon brush write it. Operations remain nested under their original work-order keys when moved and saved.",
    keywords: ["Plan", "Slice", "bindRecords", "rows", "indexes", "paging", "Record", "editing", "range", "brush", "window"], inputs: [],
    fn: East.function([], UIComponentType, _$ => (
        <Reactive>{$ => {
        const record = $.let(Record.bind(indexedWorkOrders, [indexedWorkPatch]));
        // One rail, its `rows` source the canvas's rows: the orders it narrows to, paged in its index's order.
        const slice = $.let(Slice.bindRecords("ex.planRecordIndexes", {
            rows: {
                source: Data.bindPaged(indexedWorkOrders, { indexes: [indexedWorkByStatusDue, indexedWorkByDue, indexedWorkByJob, indexedWorkByQuantity, indexedWorkByUrgent, indexedWorkByTag] }),
                label: "Work orders",
                fields: { status: { label: "Status", hints: ["Ready", "Scheduled", "Done"] }, due: { label: "Due" }, job: { label: "Job" }, quantity: { label: "Quantity" }, urgent: { label: "Urgent" }, tags: { label: "Tag", hints: ["Production", "Dispatch"] } },
                range: "due", search: ["job"], initial: { status: ["Ready"], due: { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-10-15T00:00:00Z") } },
            },
        }, { presets: [{ id: "ready", name: "Ready", where: { rows: { status: ["Ready"] } } }, { id: "urgent", name: "Urgent", where: { rows: { urgent: [true] } } }] }));
        return <Box width="100%" height="760px"><Plan id="planRecordIndexes" slice={{ slice }}
            axis={Plan.axis({ window: { min: new Date("2026-10-01T00:00:00Z"), max: new Date("2026-12-30T00:00:00Z") }, resolution: "day", resolutions: ["month", "week", "day"] })}
            series={[Plan.series.span(IndexedWork, { key: "work", title: "Work orders", label: row => row.reference, id: true, sub: row => some(row.status),
                runs: row => row.operations.map((_$2, operation) => Plan.run({ key: operation.key, label: operation.label, start: operation.start, end: operation.end, state: "confirmed" })),
                edit: { items: "operations", key: "key", start: "start", end: "end" },
            })]}
            editing={{ onApply: Record.onApply(record, { keyed: true }) }} style={{ height: "fill" }} />
        </Box>;
        }}</Reactive>
    )),
});

export const planRecordIndexesMobile = example({
    description: "A phone-width Plan over the same indexed work orders, narrowed through the same one rail — its `rows` source the canvas's rows — sharing the responsive Slice controls and date window.",
    keywords: ["Plan", "Slice", "bindRecords", "rows", "mobile", "indexes", "paging"], inputs: [],
    fn: East.function([], UIComponentType, _$ => (
        <Reactive>{$ => {
        const record = $.let(Record.bind(indexedWorkOrders, [indexedWorkPatch]));
        const slice = $.let(Slice.bindRecords("ex.planRecordIndexesMobile", {
            rows: {
                source: Data.bindPaged(indexedWorkOrders, { indexes: [indexedWorkByStatusDue, indexedWorkByDue, indexedWorkByJob, indexedWorkByQuantity, indexedWorkByUrgent, indexedWorkByTag] }),
                label: "Work orders",
                fields: { status: { label: "Status", hints: ["Ready", "Scheduled", "Done"] }, due: { label: "Due" }, job: { label: "Job" }, quantity: { label: "Quantity" }, urgent: { label: "Urgent" }, tags: { label: "Tag", hints: ["Production", "Dispatch"] } },
                range: "due", search: ["job"], initial: { status: ["Ready"], due: { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-10-15T00:00:00Z") } },
            },
        }, { presets: [{ id: "ready", name: "Ready", where: { rows: { status: ["Ready"] } } }, { id: "urgent", name: "Urgent", where: { rows: { urgent: [true] } } }] }));
        return <Box width="100%" maxWidth="390px" height="760px"><Plan id="planRecordIndexesMobile" slice={{ slice }}
            axis={Plan.axis({ window: { min: new Date("2026-10-01T00:00:00Z"), max: new Date("2026-12-30T00:00:00Z") }, resolution: "day", resolutions: ["month", "week", "day"] })}
            series={[Plan.series.span(IndexedWork, { key: "work", title: "Work orders", label: row => row.reference, id: true, sub: row => some(row.status),
                runs: row => row.operations.map((_$2, operation) => Plan.run({ key: operation.key, label: operation.label, start: operation.start, end: operation.end, state: "confirmed" })),
                edit: { items: "operations", key: "key", start: "start", end: "end" },
            })]}
            editing={{ onApply: Record.onApply(record, { keyed: true }) }} style={{ height: "fill" }} />
        </Box>;
        }}</Reactive>
    )),
});
