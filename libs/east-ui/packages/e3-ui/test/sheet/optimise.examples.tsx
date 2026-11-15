/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
/**
 * The Sheet's optimiser (#1409, east-workspace#1622): the run in, a patch of
 * the work orders out — `Sheet.Types.OptimiseRequest()` to
 * `Sheet.Types.OptimiseResult(OptimiseWorkOrders)`, an `e3.function` that
 * reads the orders through their record's status index, the sheet's unsaved
 * edits laid over them — bound to the Sheet's `optimise`, which the Elara eye
 * calls once per run and whose answer lands in the session as one edit, cell
 * by cell.
 */
import { DateTimeType, DictType, East, IntegerType, OptionType, SortedMap, StringType, StructType, compareFor, example, none, some, type ValueTypeOf } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { Box, Reactive, UIComponentType } from "@elaraai/east-ui";
import { Func, Record, Sheet } from "@elaraai/e3-ui";

/** A work order of a small shop: its reference, its job, its status, when it is due — none until it is scheduled — and its quantity. */
export const OptimiseWorkOrder = StructType({ reference: StringType, job: StringType, status: StringType, due: OptionType(DateTimeType), quantity: IntegerType });
/** The work orders' record type: the orders by their reference. */
export const OptimiseWorkOrders = DictType(StringType, OptimiseWorkOrder);
/** Eight work orders: five with a due date, three ready and with none. */
export const optimiseWorkOrderRows: SortedMap<string, ValueTypeOf<typeof OptimiseWorkOrder>> = new SortedMap<string, ValueTypeOf<typeof OptimiseWorkOrder>>([
    ["WO-1001", { reference: "WO-1001", job: "Cut panels", status: "Scheduled", due: some(new Date("2026-10-06T00:00:00Z")), quantity: 400n }],
    ["WO-1002", { reference: "WO-1002", job: "Edge band", status: "Scheduled", due: some(new Date("2026-10-07T00:00:00Z")), quantity: 1200n }],
    ["WO-1003", { reference: "WO-1003", job: "Inspect", status: "Done", due: some(new Date("2026-10-02T00:00:00Z")), quantity: 300n }],
    ["WO-1004", { reference: "WO-1004", job: "Pack", status: "Scheduled", due: some(new Date("2026-10-08T00:00:00Z")), quantity: 150n }],
    ["WO-1005", { reference: "WO-1005", job: "Cut panels", status: "Ready", due: none, quantity: 800n }],
    ["WO-1006", { reference: "WO-1006", job: "Edge band", status: "Scheduled", due: some(new Date("2026-10-09T00:00:00Z")), quantity: 600n }],
    ["WO-1007", { reference: "WO-1007", job: "Inspect", status: "Ready", due: none, quantity: 200n }],
    ["WO-1008", { reference: "WO-1008", job: "Pack", status: "Ready", due: none, quantity: 500n }],
], compareFor(StringType));
/** The work orders, the shop's own record, which the sheet writes through its patch door, read by status through its index. */
export const optimiseWorkOrders = e3.record("optimise_work_orders", OptimiseWorkOrders, {
    initial: optimiseWorkOrderRows,
    indexes: (index) => ({
        // The orders by their status: what the shop's optimiser reads the scheduled and the ready orders through.
        optimise_work_orders_by_status: index.on(["status"]),
    }),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

/**
 * The shop's optimiser, on e3: every Ready order with no due date is given one — the day after the latest due of the
 * Scheduled orders, then a day later for each in key order — and set Scheduled. It reads the Scheduled and the Ready
 * orders through the status index and each order by its key, never the record whole, with the sheet's unsaved edits laid
 * over them; the answer is the Ready orders' change alone.
 */
export const setDueDates = e3.function("sheet_set_due_dates", {
    inputs: [e3.index(optimiseWorkOrders.indexes.optimise_work_orders_by_status), optimiseWorkOrders],
    // The sheet's unsaved edits of the orders are laid over them, and over their index
    drafts: [optimiseWorkOrders],
    args: [Sheet.Types.OptimiseRequest()],
    output: Sheet.Types.OptimiseResult(OptimiseWorkOrders),
}, ($, byStatus, orders, _request) => {
    // The latest due date of the Scheduled orders: the first order scheduled is due the day after it.
    const latest = $.let(new Date("2026-10-01T00:00:00Z"), DateTimeType);
    byStatus.of("Scheduled").each($, ($2, _carried, key) => {
        $2.match(orders.get(key).due, { some: ($3, due) => { $3.if(East.less(latest, due), ($4) => { $4.assign(latest, due); }); } });
    });
    const before = $.let(new Map(), OptimiseWorkOrders);
    const after = $.let(new Map(), OptimiseWorkOrders);
    $.for(byStatus.of("Ready").collect($), ($2, _carried, key) => {
        const order = $2.const(orders.get(key));
        $2.match(order.due, {
            none: ($3) => {
                $3.assign(latest, latest.addDays(1n));
                $3(before.insert(key, order));
                $3(after.insert(key, { reference: order.reference, job: order.job, status: "Scheduled", due: some(latest), quantity: order.quantity }));
            },
        });
    });
    return { rows: East.diff(before, after) };
});

export const sheetOptimise = example({
    inputs: [],
    description: "A sheet of work orders with the Elara eye (#1409, #1622): `optimise` is Func.bind of the shop's optimiser on e3 — Sheet.Types.OptimiseRequest() in, the run number and the rail's narrowing and no row; Sheet.Types.OptimiseResult(OptimiseWorkOrders) out, a patch of the orders' record. The function reads the Scheduled and the Ready orders through the record's status index and each by its key, the sheet's unsaved edits laid over them (drafts: [optimiseWorkOrders]), and gives each Ready order with no due date one, set Scheduled. A click on the eye runs it once; its patch lands in the session as one edit, cell by cell, which one Undo reverts and Save commits with everything else.",
    keywords: ["Sheet", "optimise", "Optimise", "Elara", "OptimiseRequest", "OptimiseResult", "Func.bind", "e3.function", "e3.index", "drafts", "East.diff", "patch", "one edit", "Undo", "Record.bind", "Sheet.column.date", "Sheet.column.integer"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const orders = $.let(Record.bind(optimiseWorkOrders));
        // The app's optimiser: the eye calls it once per run, with the orders' unsaved edits as drafts.
        const optimise = $.let(Func.bind(setDueDates));
        return <Box height="560px">
            <Sheet record={orders} name="sheetOptimise" optimise={optimise}
                columns={{
                    reference: Sheet.column.text(OptimiseWorkOrder, { header: "Reference", width: "136px" }),
                    job: Sheet.column.text(OptimiseWorkOrder, { header: "Job", width: "180px" }),
                    status: Sheet.column.text(OptimiseWorkOrder, { header: "Status", width: "120px" }),
                    due: Sheet.column.date(OptimiseWorkOrder, { header: "Due", width: "144px" }),
                    quantity: Sheet.column.integer(OptimiseWorkOrder, { header: "Quantity", width: "112px" }),
                }} />
        </Box>;
    }}</Reactive>),
});
