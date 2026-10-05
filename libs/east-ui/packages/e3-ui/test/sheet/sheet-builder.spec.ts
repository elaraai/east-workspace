/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Sheet.Builder` (#1183, `Sheet Builder Spec.md` §3–§5, SB7–SB12): its
 * examples (§3.2–§3.4), the payload — the sheet whole, the templates, the
 * record's history — a template's seed, built by `newRow`'s and `newGroup`'s
 * own code, `views` as a bind handle, and every refusal, each naming the prop
 * and the remedy. How the builder's payload meets a record runs in
 * e3-ui-components' `sheet-builder-payload` spec, against the record runtime.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, DictType, East, Expr, FloatType, IntegerType, NullType, OptionType, SortedMap, StringType, StructType,
    compareFor, decodeBeast2For, isTypeEqual, none, some, variant,
    type BlockBuilder, type EastType, type ValueTypeOf,
} from "@elaraai/east";
import { Assert, describeEast, TestImpl } from "@elaraai/east-node-std";
import { State } from "@elaraai/east-ui/internal";
import {
    Data, Record, Sheet, SheetBuilderPayloadType, SheetTemplateWireType, buildTemplates, createSheetBuild, sheetKeys,
} from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import * as ex from "./sheet-builder.examples.js";

describeEast("Sheet.Builder examples", (test) => {
    Assert.examples(test, {
        sheetBuilder: ex.sheetBuilder,
        sheetBuilderWorkshop: ex.sheetBuilderWorkshop,
        sheetBuilderWeeks: ex.sheetBuilderWeeks,
        sheetBuilderPaged: ex.sheetBuilderPaged,
    });
}, { platformFns: TestImpl });

/** Run `build` inside a block, as a builder's factory runs. */
function inBlock<T>(build: ($: BlockBuilder<NullType>) => T): T {
    let out: T | undefined;
    East.function([], NullType, ($) => { out = build($); });
    return out!;
}
const typeOf = (e: unknown): EastType => Expr.type(e as Expr) as EastType;

const JOB_COLUMNS = {
    task:  Sheet.column.text(ex.BuilderJob, { header: "Task" }),
    start: Sheet.column.date(ex.BuilderJob, { header: "Start" }),
    qty:   Sheet.column.quantity(ex.BuilderJob, { header: "Qty" }),
};

describe("the payload (SB12)", () => {
    test("the smallest builder's payload is SheetBuilderPayloadType: the sheet whole, its templates, the record's history", () => {
        inBlock(($) => {
            const jobs = $.let(Record.bind(ex.sheetBuilderJobs, [ex.sheetBuilderJobsPatch]));
            const payload = Sheet.BuilderPayload({ record: jobs, columns: JOB_COLUMNS });
            assert.ok(isTypeEqual(typeOf(payload), SheetBuilderPayloadType));
        });
    });

    test("the keys a builder keeps its viewer's state under follow its name", () => {
        assert.deepEqual(sheetKeys(undefined), { frame: "sheet.builder.frame", columns: "sheet.builder.columns", library: "sheet.library" });
        assert.deepEqual(sheetKeys("orders"), { frame: "sheet.builder.orders.frame", columns: "sheet.builder.orders.columns", library: "sheet.library.orders" });
    });

    test("a column built over another type than the record's entries fails to compile (SB8)", () => {
        // Type-level: the build never runs. An overload that accepted these would fail the build on its unused directive.
        const never = (): void => {
            inBlock(($) => {
                const jobs = $.let(Record.bind(ex.sheetBuilderJobs, [ex.sheetBuilderJobsPatch]));
                // @ts-expect-error — the columns are over the plan row, and the record holds jobs
                return Sheet.Builder({ record: jobs, columns: { task: Sheet.column.text(ex.BuilderPlanRow, { header: "Task" }) } });
            });
        };
        assert.equal(typeof never, "function");
    });
});

// A flat sheet over operations, and a grouped one over orders: what the
// templates' seeds are built over, read whole from plain Dicts.
const OpType = StructType({ activity: StringType, qty: OptionType(FloatType), notes: StringType, created_by: StringType });
const OrderType = StructType({ name: StringType, customer: StringType, status: StringType, ops: ArrayType(OpType) });
/** Fixtures at MODULE scope: East bodies never call host helpers. */
const OPS = new SortedMap([["o1", { activity: "Panel cutting", qty: some(48.0), notes: "", created_by: "planner" }]], compareFor(StringType));
const ORDERS = new SortedMap([["WO-1", { name: "WO-1 · Kitchen", customer: "Tallowmere Homes", status: "PLANNED", ops: [] }]], compareFor(StringType));
const TWO_OPS = [
    { activity: "Panel cutting", qty: none, notes: "", created_by: "" },
    { activity: "Assembly", qty: none, notes: "", created_by: "" },
];
const OP_COLUMNS = {
    activity: Sheet.column.text(OpType, { header: "Activity" }),
    qty:      Sheet.column.quantity(OpType, { header: "Qty" }),
    notes:    Sheet.column.text(OpType, { header: "Notes" }),
};
type Wire = ValueTypeOf<typeof SheetTemplateWireType>;

/** The templates of a flat sheet over the operations, `newRow` setting `notes` and `created_by`. */
const rowTemplates = East.compile(East.function([], ArrayType(SheetTemplateWireType), ($) => {
    const ops = $.const(OPS, DictType(StringType, OpType));
    const newRow = $.const(East.function([Sheet.Types.NewRow], Sheet.Types.Patch(OpType), () => Sheet.patch(OpType, { notes: "", created_by: "planner" })));
    const build = createSheetBuild(ops, OP_COLUMNS, { newRow }, { keyOrdered: true });
    return buildTemplates({ rows: [
        { key: "edge", name: "Edge banding", group: "Operations", values: Sheet.patch(OpType, { activity: "Edge banding", notes: "Band the long edges" }) },
        { key: "sand", name: "Sanding", values: Sheet.patch(OpType, { activity: "Sanding" }) },
    ] }, build.bridge, { newRow });
}), []);
/** The templates of a grouped sheet over the orders, `newGroup` setting `customer`. */
const groupTemplates = East.compile(East.function([], ArrayType(SheetTemplateWireType), ($) => {
    const orders = $.const(ORDERS, DictType(StringType, OrderType));
    const lines = $.const(TWO_OPS, ArrayType(OpType));
    const newGroup = $.const(East.function([Sheet.Types.NewGroup], Sheet.Types.Patch(OrderType), () => Sheet.patch(OrderType, { customer: "" })));
    const build = createSheetBuild(orders, OP_COLUMNS, { group: Sheet.group(OrderType, "ops", { title: "name" }), newGroup }, { keyOrdered: true });
    return buildTemplates({ groups: [
        { key: "kitchen", name: "Kitchen order", group: "Orders", values: Sheet.patch(OrderType, { status: "PLANNED", ops: lines }) },
    ] }, build.bridge, { newGroup });
}), []);

const NEW_ROW = { destination: variant("entry", variant("keyOrder", null)) };
const NEW_GROUP = { place: variant("keyOrder", null) };

describe("templates (SB9)", () => {
    test("a row template's seed is newRow's defaults with the template's fields over them; a field neither sets starts missing", () => {
        const [edge, sand] = rowTemplates() as Wire[];
        assert.equal(edge!.key, "edge");
        assert.equal(edge!.name, "Edge banding");
        assert.deepEqual(edge!.group, some("Operations"));
        assert.deepEqual(sand!.group, none);
        if (edge!.seed.type !== "row") assert.fail(`expected a row template, got ${edge!.seed.type}`);
        const seed = edge!.seed.value(NEW_ROW as never);
        const draft = decodeBeast2For(Sheet.Types.Draft(OpType))(seed.draft);
        assert.deepEqual(draft.activity, variant("value", "Edge banding"));
        assert.deepEqual(draft.notes, variant("value", "Band the long edges"), "the template's field over newRow's");
        assert.deepEqual(draft.created_by, variant("value", "planner"), "newRow's default where the template sets nothing");
        assert.deepEqual(draft.qty, variant("missing", null), "neither sets it: it starts missing");
    });

    test("a card shows the template's own fields, through the columns' projection", () => {
        const [edge] = rowTemplates() as Wire[];
        assert.deepEqual(edge!.cells.get("activity"), variant("String", "Edge banding"));
        assert.deepEqual(edge!.cells.get("notes"), variant("String", "Band the long edges"));
        assert.equal(edge!.cells.has("qty"), false, "a field the template leaves unset shows nothing");
    });

    test("a group template's seed is the group with its lines, newGroup's defaults under the template's fields", () => {
        const [kitchen] = groupTemplates() as Wire[];
        if (kitchen!.seed.type !== "group") assert.fail(`expected a group template, got ${kitchen!.seed.type}`);
        const seed = kitchen!.seed.value(NEW_GROUP as never);
        const draft = decodeBeast2For(Sheet.Types.DraftGroup(OrderType, "ops"))(seed.draft);
        assert.deepEqual(draft.status, variant("value", "PLANNED"));
        assert.deepEqual(draft.customer, variant("value", ""), "newGroup's default");
        assert.deepEqual(draft.name, variant("missing", null));
        assert.equal(draft.ops.length, 2, "the template's lines");
        const row = decodeBeast2For(Sheet.Types.Row)(seed.row);
        assert.equal(row.lines.length, 2, "the card's line count");
    });
});

describe("refusals (SB7), each naming the prop and the remedy", () => {
    const counter = e3.record("sheet_builder_spec_counter", IntegerType, 0n);
    const bump = e3.mutation.reduce("bump", counter, East.function([IntegerType], IntegerType, (_$, n) => n.add(1n)));
    const builder = (props: Record<string, unknown>) => (Sheet.Builder as unknown as (p: Record<string, unknown>) => unknown)(props);

    test("a record that is not a Dict, and one bound without its patch door", () => {
        assert.throws(() => inBlock(($) => builder({ record: $.let(Record.bind(counter, [bump])), columns: JOB_COLUMNS })),
            /`record` must be a Dict — its entries, or one entry's rows, are the sheet's rows/);
        assert.throws(() => inBlock(($) => builder({ record: $.let(Record.bind(ex.sheetBuilderJobs, [])), columns: JOB_COLUMNS })),
            /"patch" is not bound as this record's patch door/);
    });

    test("`window` with `entry`, and a window over another record's collection", () => {
        assert.throws(() => inBlock(($) => builder({
            record: $.let(Record.bind(ex.sheetBuilderPlans, [ex.sheetBuilderPlansPatch])),
            entry: { key: "2026-W42", rows: "rows", id: "id" }, window: $.let(Data.bindPaged(ex.sheetBuilderPlans)),
            columns: { task: Sheet.column.text(ex.BuilderPlanRow, { header: "Task" }) },
        })), /`window` pages the record's entries, and with `entry` the rows are one entry's field, read whole/);
        assert.throws(() => inBlock(($) => builder({
            record: $.let(Record.bind(ex.sheetBuilderJobs, [ex.sheetBuilderJobsPatch])), window: $.let(Data.bindPaged(ex.sheetBuilderPlans)), columns: JOB_COLUMNS,
        })), /`window` must page the record's entries — Data.bindPaged\(record\) over the same record/);
    });

    test("a template over another type, a key that repeats, and a group template on a flat sheet", () => {
        const jobsBuilder = (templates: unknown) => inBlock(($) => builder({
            record: $.let(Record.bind(ex.sheetBuilderJobs, [ex.sheetBuilderJobsPatch])), columns: JOB_COLUMNS, templates,
        }));
        assert.throws(() => jobsBuilder({ rows: [{ key: "x", name: "X", values: Sheet.patch(ex.BuilderPlanRow, { task: "X" }) }] }),
            /row template "x" was built over another type — build its values with Sheet.patch\(RowType, …\)/);
        assert.throws(() => jobsBuilder({ rows: [
            { key: "a", name: "A", values: Sheet.patch(ex.BuilderJob, { task: "A" }) },
            { key: "a", name: "Again", values: Sheet.patch(ex.BuilderJob, { task: "Again" }) },
        ] }), /template key "a" repeats/);
        assert.throws(() => jobsBuilder({ groups: [{ key: "g", name: "G", values: Sheet.patch(ex.BuilderJob, { task: "G" }) }] }),
            /`templates.groups` needs a grouped sheet/);
    });

    test("a views handle of anything but Array<Sheet.Types.View>, and Sheet.View's own props", () => {
        assert.throws(() => inBlock(($) => builder({
            record: $.let(Record.bind(ex.sheetBuilderJobs, [ex.sheetBuilderJobsPatch])), columns: JOB_COLUMNS,
            views: $.let(State.bind([StringType], "sheet.builder.spec.views", "")),
        })), /`views` must be a bind handle of Array<Sheet.Types.View>/);
        inBlock(($) => builder({
            record: $.let(Record.bind(ex.sheetBuilderJobs, [ex.sheetBuilderJobsPatch])), columns: JOB_COLUMNS,
            views: $.let(State.bind([ArrayType(Sheet.Types.View)], "sheet.builder.spec.views", [])),
        }));
        for (const prop of ["data", "onApply", "onUpdate", "onViewsChange"]) {
            assert.throws(() => inBlock(($) => builder({
                record: $.let(Record.bind(ex.sheetBuilderJobs, [ex.sheetBuilderJobsPatch])), columns: JOB_COLUMNS, [prop]: none,
            })), new RegExp(`\`${prop}\` is Sheet.View's`));
        }
    });
});
