/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** @jsxImportSource @elaraai/east-ui */

import { ArrayType, BooleanType, DateTimeType, DictType, East, IntegerType, SetType, StringType, StructType, example, variant } from "@elaraai/east";
import { Box, Reactive, Slice, State, UIComponentType } from "@elaraai/east-ui";
import { Data, Record, Sheet } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

/** The same work order can be edited as a Sheet row or scheduled on a Plan. */
export const IndexedOperation = StructType({ key: StringType, label: StringType, start: DateTimeType, end: DateTimeType });
/** Work orders retain their original String record keys through every index. */
export const IndexedWork = StructType({ reference: StringType, job: StringType, status: StringType, due: DateTimeType, quantity: IntegerType, urgent: BooleanType, tags: SetType(StringType), operations: ArrayType(IndexedOperation) });
const Work = DictType(StringType, IndexedWork);

/** The same pure generator seeds the example record and runs as an e3 task. */
const generateWork = East.function([IntegerType], Work, ($, count) => {
    const rows = $.let(new Map(), Work);
    const statuses = $.const(["Ready", "Scheduled", "Done"], ArrayType(StringType));
    const jobs = $.const(["Cut panels", "Edge band", "Inspect", "Pack"], ArrayType(StringType));
    const start = $.const(new Date("2026-10-01T00:00:00Z"));
    const i = $.let(0n);
    $.while(i.less(count), ($) => {
        const reference = $.const(East.str`JOB-${i.add(10000n)}`);
        const due = $.const(start.addMilliseconds(i.multiply(37n).remainder(90n).multiply(86400000n)));
        $(rows.insert(reference, {
            reference, job: jobs.get(i.remainder(4n)), status: statuses.get(i.remainder(3n)),
            due,
            quantity: i.remainder(24n).add(1n).multiply(100n), urgent: i.remainder(5n).equal(0n),
            tags: i.remainder(2n).equal(0n).ifElse(() => new Set(["Production"]), () => new Set(["Dispatch"])),
            operations: [{ key: East.str`${reference}-run`, label: jobs.get(i.remainder(4n)), start: due.addMilliseconds(21600000n), end: due.addMilliseconds(50400000n) }],
        }));
        $.assign(i, i.add(1n));
    });
    return rows;
});

export const indexedWorkCount = e3.input("indexed_work_count", IntegerType, variant("value", 50000n));
export const indexedWorkGenerated = e3.task("indexed_work_generated", [indexedWorkCount], generateWork);
export const indexedWorkOrders = e3.record("indexed_work_orders", Work, East.compile(generateWork, [])(50000n));
export const indexedWorkPatch = e3.mutation.patch(indexedWorkOrders);
export const indexedWorkByStatusDue = e3.recordIndex("by_status_due", indexedWorkOrders, { on: ["status", "due"] });
export const indexedWorkByDue = e3.recordIndex("by_due", indexedWorkOrders, { on: ["due"] });
export const indexedWorkByJob = e3.recordIndex("by_job", indexedWorkOrders, { on: ["job"] });
export const indexedWorkByQuantity = e3.recordIndex("by_quantity", indexedWorkOrders, { on: ["quantity"] });
export const indexedWorkByUrgent = e3.recordIndex("by_urgent", indexedWorkOrders, { on: ["urgent"] });
export const indexedWorkByTag = e3.recordIndex("by_tag", indexedWorkOrders, { on: ["tags"] });

/**
 * The lens's benchmark record (#1349): a row of a million, in one of ten
 * groups, and flagged or not. Empty here, so neither the showcase nor a test
 * deploys a million rows: e3-ui-components' lens benchmark (`E3_UI_PERF=1`)
 * fills it through its patch door, then draws two narrowings over it — the ten
 * rows flagged, and the three groups that hold three in ten.
 */
export const LensBenchRow = StructType({ group: IntegerType, flag: BooleanType });
export const lensBenchRows = e3.record("lens_bench_rows", DictType(StringType, LensBenchRow), new Map());
export const lensBenchPatch = e3.mutation.patch(lensBenchRows);
export const lensBenchByGroup = e3.recordIndex("lens_bench_by_group", lensBenchRows, { on: ["group"] });
export const lensBenchByFlag = e3.recordIndex("lens_bench_by_flag", lensBenchRows, { on: ["flag"] });

export const sheetRecordIndexes = example({
    keywords: ["Sheet", "Slice.bindRecords", "rows", "Data.bindPaged", "Record", "Record.onApply", "recordIndex", "lens", "saved views", "RecordView", "paging", "primary key", "filter"],
    description: "50,000 work orders in the record's order, the rail's rows source narrowing them through maintained record indexes and the sheet drawing the narrowing over them as the lens, a filtered spreadsheet: only the rows it keeps, one after another, each at its row number. Choose Ready and Scheduled together, then a Due range: e3 places their rows from the indexes alone, and the sheet reads only the segments near the view. Save retains original keys and hidden drafts; saved tabs retain every source's narrowing.",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{($) => {
            const record = $.let(Record.bind(indexedWorkOrders, [indexedWorkPatch]));
            // One rail over the work orders: its `rows` source narrows them, and the sheet draws the narrowing over the record's rows.
            const slice = $.let(Slice.bindRecords("ex.sheetRecordIndexes", {
                rows: {
                    source: Data.bindPaged(indexedWorkOrders, { indexes: [indexedWorkByStatusDue, indexedWorkByDue, indexedWorkByJob, indexedWorkByQuantity, indexedWorkByUrgent, indexedWorkByTag] }),
                    fields: { status: { label: "Status", hints: ["Ready", "Scheduled", "Done"] }, due: { label: "Due" }, job: { label: "Job" }, quantity: { label: "Quantity" }, urgent: { label: "Urgent" }, tags: { label: "Tag", hints: ["Production", "Dispatch"] } },
                    range: "due", search: ["job"], initial: { status: ["Ready"] },
                },
            }, { presets: [{ id: "ready", name: "Ready", where: { rows: { status: ["Ready"] } } }, { id: "urgent", name: "Urgent", where: { rows: { urgent: [true] } } }] }));
            const views = $.let(State.bind([ArrayType(Sheet.Types.RecordView)], "ex.sheetRecordIndexes.views", []));
            return <Box width="100%" height="760px">
                <Sheet name="sheetRecordIndexes" slice={{ slice }} views={views}
                    columns={{ reference: Sheet.column.text(IndexedWork, { header: "Reference", width: "136px" }), job: Sheet.column.text(IndexedWork, { header: "Job", width: "180px" }), status: Sheet.column.text(IndexedWork, { header: "Status", width: "120px" }), due: Sheet.column.date(IndexedWork, { header: "Due", width: "144px" }), quantity: Sheet.column.integer(IndexedWork, { header: "Quantity", width: "112px" }) }}
                    onApply={Record.onApply(record, { keyed: true })} edits={{ insertRows: false }} />
            </Box>;
        }}</Reactive>
    )),
    inputs: [],
});

export const sheetRecordIndexesMobile = example({
    keywords: ["Sheet", "Slice.bindRecords", "rows", "mobile", "record", "filters", "lens", "saved views", "RecordView"],
    description: "The same indexed work orders and their lens in a phone-width frame, with the rail's shared Slice controls on the toolbar's responsive ladder.",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{($) => {
            const record = $.let(Record.bind(indexedWorkOrders, [indexedWorkPatch]));
            // One rail over the work orders: its `rows` source narrows them, and the sheet draws the narrowing over the record's rows.
            const slice = $.let(Slice.bindRecords("ex.sheetRecordIndexesMobile", {
                rows: {
                    source: Data.bindPaged(indexedWorkOrders, { indexes: [indexedWorkByStatusDue, indexedWorkByDue, indexedWorkByJob, indexedWorkByQuantity, indexedWorkByUrgent, indexedWorkByTag] }),
                    fields: { status: { label: "Status", hints: ["Ready", "Scheduled", "Done"] }, due: { label: "Due" }, job: { label: "Job" }, quantity: { label: "Quantity" }, urgent: { label: "Urgent" }, tags: { label: "Tag", hints: ["Production", "Dispatch"] } },
                    range: "due", search: ["job"], initial: { status: ["Ready"] },
                },
            }, { presets: [{ id: "ready", name: "Ready", where: { rows: { status: ["Ready"] } } }, { id: "urgent", name: "Urgent", where: { rows: { urgent: [true] } } }] }));
            const views = $.let(State.bind([ArrayType(Sheet.Types.RecordView)], "ex.sheetRecordIndexesMobile.views", []));
            return <Box width="390px" maxWidth="100%" height="760px">
                <Sheet name="sheetRecordIndexesMobile" slice={{ slice }} views={views}
                    columns={{ reference: Sheet.column.text(IndexedWork, { header: "Reference", width: "136px" }), job: Sheet.column.text(IndexedWork, { header: "Job", width: "180px" }), status: Sheet.column.text(IndexedWork, { header: "Status", width: "120px" }), due: Sheet.column.date(IndexedWork, { header: "Due", width: "144px" }), quantity: Sheet.column.integer(IndexedWork, { header: "Quantity", width: "112px" }) }}
                    onApply={Record.onApply(record, { keyed: true })} edits={{ insertRows: false }} />
            </Box>;
        }}</Reactive>
    )),
    inputs: [],
});
