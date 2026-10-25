/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
/**
 * The Sheet's optimiser (#1409, `Optimise Spec.md` §3): a shop's work orders in,
 * the work orders out — `Sheet.Types.OptimiseRequest(OptimiseWorkOrder)` to
 * `Sheet.Types.OptimiseResult(OptimiseWorkOrder)`, an `e3.function` — bound to
 * the Sheet's `optimise`, which the Elara eye calls once per run and whose
 * answer lands in the session as one edit, cell by cell.
 */
import { DateTimeType, DictType, East, IntegerType, OptionType, SortedMap, StringType, StructType, compareFor, example, none, some, type ValueTypeOf } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { Box, Reactive, UIComponentType } from "@elaraai/east-ui";
import { Func, Record, Sheet } from "@elaraai/e3-ui";

/** A work order of a small shop: its reference, its job, its status, when it is due — none until it is scheduled — and its quantity. */
export const OptimiseWorkOrder = StructType({ reference: StringType, job: StringType, status: StringType, due: OptionType(DateTimeType), quantity: IntegerType });
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
/** The work orders, the shop's own record, which the sheet writes through its patch door. */
export const optimiseWorkOrders = e3.record("optimise_work_orders", DictType(StringType, OptimiseWorkOrder), optimiseWorkOrderRows);
export const optimiseWorkOrdersPatch = e3.mutation.patch(optimiseWorkOrders);

/**
 * The shop's optimiser's body: every order with no due date is given one — the day after the latest due the orders hold,
 * then a day later for each in key order — and set Scheduled; every other order stays as it is.
 */
export const sheetOptimiseBody = East.function([Sheet.Types.OptimiseRequest(OptimiseWorkOrder)], Sheet.Types.OptimiseResult(OptimiseWorkOrder), ($, req) => {
    const rows = $.let(new Map(), DictType(StringType, OptimiseWorkOrder));
    // The latest due date the orders hold: the first order scheduled is due the day after it.
    const latest = $.let(new Date("2026-10-01T00:00:00Z"), DateTimeType);
    $.for(req.rows, ($2, order) => {
        $2.match(order.due, { some: ($3, due) => { $3.if(East.less(latest, due), ($4) => { $4.assign(latest, due); }); } });
    });
    $.for(req.rows, ($2, order, key) => {
        $2.match(order.due, {
            some: ($3) => { $3(rows.insert(key, order)); },
            none: ($3) => {
                $3.assign(latest, latest.addDays(1n));
                $3(rows.insert(key, { reference: order.reference, job: order.job, status: "Scheduled", due: some(latest), quantity: order.quantity }));
            },
        });
    });
    return { rows };
});
/** The shop's optimiser, on e3: every order with no due date given one, and set Scheduled. */
export const setDueDates = e3.function("sheet_set_due_dates", sheetOptimiseBody);

export const sheetOptimise = example({
    inputs: [],
    description: "A sheet of work orders with the Elara eye (#1409): `optimise` is Func.bind of the shop's optimiser on e3 — Sheet.Types.OptimiseRequest(OptimiseWorkOrder) in, the run number and the rows in view by key as the session holds them; Sheet.Types.OptimiseResult(OptimiseWorkOrder) out, the rows complete, each order with no due date given one and set Scheduled. A click on the eye runs it once; the result lands in the session as one edit, cell by cell, which one Undo reverts and Save commits with everything else.",
    keywords: ["Sheet", "optimise", "Optimise", "Elara", "OptimiseRequest", "OptimiseResult", "Func.bind", "e3.function", "one edit", "Undo", "Record.bind", "Sheet.column.date", "Sheet.column.integer"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const orders = $.let(Record.bind(optimiseWorkOrders, [optimiseWorkOrdersPatch]));
        // The app's optimiser: the eye calls it once per run over the rows in view, and its answer is one edit.
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
