/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
import { East, example, some } from "@elaraai/east";
import { Box, Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
import { Data, Plan, Record } from "@elaraai/e3-ui";
import { IndexedWork, indexedWorkOrders, indexedWorkPatch, indexedWorkByStatusDue, indexedWorkByDue, indexedWorkByJob, indexedWorkByQuantity, indexedWorkByUrgent, indexedWorkByTag } from "../sheet/sheet-records.examples.js";

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
