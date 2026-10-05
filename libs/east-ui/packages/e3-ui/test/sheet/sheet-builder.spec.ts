/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Sheet.Builder` (#1183, `Sheet Builder Spec.md` §3–§5, SB7–SB12): its
 * examples (§3.2–§3.4), the payload — the sheet whole, the templates, the
 * library's tabs, the record's history — a template's seed, built by
 * `newRow`'s and `newGroup`'s own code, the library (#1186, SB59, SB60): its
 * tabs in order, an author's cards through their accessors and where a drop's
 * patch lands, `views` as a bind handle, and every refusal, each naming the
 * prop and the remedy. How the builder's payload meets a record runs in
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
    Data, Record, Sheet, SheetBuilderPayloadType, SheetLibraryTabType, SheetTemplateWireType, buildLibrary, buildTemplates, createSheetBuild, sheetKeys,
    type SheetLibraryTab,
} from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import * as ex from "./sheet-builder.examples.js";

describeEast("Sheet.Builder examples", (test) => {
    Assert.examples(test, {
        sheetBuilder: ex.sheetBuilder,
        sheetBuilderLibrary: ex.sheetBuilderLibrary,
        sheetBuilderWorkshop: ex.sheetBuilderWorkshop,
        sheetBuilderWeeks: ex.sheetBuilderWeeks,
        sheetBuilderBatches: ex.sheetBuilderBatches,
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

    test("the keys a builder keeps its viewer's state under, and its sheet's drop target, follow its name", () => {
        assert.deepEqual(sheetKeys(undefined), { frame: "sheet.builder.frame", columns: "sheet.builder.columns", library: "sheet.library", surface: "sheet.builder.sheet" });
        assert.deepEqual(sheetKeys("orders"), {
            frame: "sheet.builder.orders.frame", columns: "sheet.builder.orders.columns", library: "sheet.library.orders", surface: "sheet.builder.orders.sheet",
        });
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

// The library over the same flat and grouped sheets: an author's tab over
// activities, and one over statuses.
const ActivityRow = StructType({ name: StringType, uom: StringType, family: StringType });
const ACTIVITIES = [
    { name: "Panel cutting", uom: "panels", family: "Cutting" },
    { name: "Edge banding", uom: "metres", family: "Cutting" },
    { name: "Panel cutting", uom: "sheets", family: "Cutting" },
    { name: "Assembly", uom: "units", family: "Assembly" },
];
const STATUS_WORDS = new SortedMap([["p", "PLANNED"], ["r", "RELEASED"]], compareFor(StringType));
type Tab = ValueTypeOf<typeof SheetLibraryTabType>;

/** A flat sheet's library: the templates, the activities — dropped on a row, its activity and a field no column shows — and the columns. */
const flatLibrary = (tabs: ($: BlockBuilder<ArrayType<typeof SheetLibraryTabType>>) => readonly SheetLibraryTab[]) =>
    East.compile(East.function([], ArrayType(SheetLibraryTabType), ($) => {
        const ops = $.const(OPS, DictType(StringType, OpType));
        const build = createSheetBuild(ops, OP_COLUMNS, {}, { keyOrdered: true });
        return buildLibrary(tabs($), build.bridge);
    }), [])() as Tab[];
/** A grouped sheet's library: the statuses, dropped on an order's band, rename it. */
const groupedLibrary = (tabs: ($: BlockBuilder<ArrayType<typeof SheetLibraryTabType>>) => readonly SheetLibraryTab[]) =>
    East.compile(East.function([], ArrayType(SheetLibraryTabType), ($) => {
        const orders = $.const(ORDERS, DictType(StringType, OrderType));
        const build = createSheetBuild(orders, OP_COLUMNS, { group: Sheet.group(OrderType, "ops", { title: "name" }) }, { keyOrdered: true });
        return buildLibrary(tabs($), build.bridge);
    }), [])() as Tab[];

describe("the library (SB59, SB60)", () => {
    test("its tabs are the ones `library` lists, in that order; none listed, none", () => {
        const tabs = flatLibrary(() => [Sheet.library.columns(), Sheet.library.rows()]);
        assert.deepEqual(tabs, [variant("columns", null), variant("rows", null)]);
        assert.deepEqual(flatLibrary(() => []), []);
    });

    test("an author's tab: one card per row through its accessors, a key that repeats keeping its first card, grouped by `group`", () => {
        const [tab] = flatLibrary(($) => {
            const acts = $.const(ACTIVITIES, ArrayType(ActivityRow));
            return [Sheet.library.tab(acts, { name: "Activities", icon: "list",
                key: a => a.name, label: a => a.name, meta: a => some(a.uom), group: a => a.family })];
        });
        if (tab!.type !== "tab") assert.fail(`expected an author's tab, got ${tab!.type}`);
        assert.equal(tab!.value.name, "Activities");
        assert.deepEqual(tab!.value.icon, some("list"));
        assert.deepEqual(tab!.value.drop, none, "no `drop`: its cards land nowhere");
        assert.deepEqual(tab!.value.cards.map((c) => [c.key, c.label, c.meta, c.group, c.sets.size]), [
            ["Panel cutting", "Panel cutting", some("panels"), some("Cutting"), 0],
            ["Edge banding", "Edge banding", some("metres"), some("Cutting"), 0],
            ["Assembly", "Assembly", some("units"), some("Assembly"), 0],
        ]);
    });

    test("over a Dict, the accessors take each entry's key", () => {
        const [tab] = flatLibrary(($) => {
            const words = $.const(STATUS_WORDS, DictType(StringType, StringType));
            return [Sheet.library.tab(words, { name: "Words", key: (_w, k) => k, label: w => w })];
        });
        if (tab!.type !== "tab") assert.fail(`expected an author's tab, got ${tab!.type}`);
        assert.deepEqual(tab!.value.cards.map((c) => [c.key, c.label, c.meta, c.group]), [["p", "PLANNED", none, none], ["r", "RELEASED", none, none]]);
    });

    test("a drop patch over the row type lands on rows, and a card carries the cells it sets through the sheet's editable columns", () => {
        const [tab] = flatLibrary(($) => {
            const acts = $.const(ACTIVITIES, ArrayType(ActivityRow));
            return [Sheet.library.tab(acts, { name: "Activities", key: a => a.name, label: a => a.name,
                drop: a => Sheet.patch(OpType, { activity: a.name, created_by: "library" }) })];
        });
        if (tab!.type !== "tab") assert.fail(`expected an author's tab, got ${tab!.type}`);
        assert.deepEqual(tab!.value.drop, some(variant("row", null)));
        const first = tab!.value.cards[0]!;
        assert.deepEqual(first.sets.get("activity"), variant("String", "Panel cutting"));
        assert.equal(first.sets.has("created_by"), false, "a field no column shows is not a cell");
        assert.equal(first.sets.has("notes"), false, "a field the patch leaves unset is not a cell");
    });

    test("a drop patch over the group type lands on bands, its cells the band's", () => {
        const [tab] = groupedLibrary(($) => {
            const words = $.const(STATUS_WORDS, DictType(StringType, StringType));
            return [Sheet.library.tab(words, { name: "Names", key: (_w, k) => k, label: w => w,
                drop: w => Sheet.patch(OrderType, { name: w }) })];
        });
        if (tab!.type !== "tab") assert.fail(`expected an author's tab, got ${tab!.type}`);
        assert.deepEqual(tab!.value.drop, some(variant("group", null)));
        assert.deepEqual(tab!.value.cards[1]!.sets.get("$title"), variant("String", "RELEASED"));
    });

    test("a builder's payload carries its library; left out, it lists none", () => {
        inBlock(($) => {
            const jobs = $.let(Record.bind(ex.sheetBuilderJobs, [ex.sheetBuilderJobsPatch]));
            const payload = Sheet.BuilderPayload({ record: jobs, columns: JOB_COLUMNS, library: [Sheet.library.columns()] });
            assert.ok(isTypeEqual(typeOf(payload), SheetBuilderPayloadType));
        });
        const none_ = East.compile(East.function([], ArrayType(SheetLibraryTabType), ($) => {
            const ops = $.const(OPS, DictType(StringType, OpType));
            return buildLibrary(undefined, createSheetBuild(ops, OP_COLUMNS, {}, { keyOrdered: true }).bridge);
        }), []);
        assert.deepEqual(none_(), []);
    });

    test("refused, naming the tab: a tab listed twice, two author's tabs of one name, a drop over another type, and data neither an Array nor a Dict", () => {
        assert.throws(() => flatLibrary(() => [Sheet.library.rows(), Sheet.library.rows()]), /the library lists Sheet.library.rows\(\) twice/);
        assert.throws(() => flatLibrary(($) => {
            const acts = $.const(ACTIVITIES, ArrayType(ActivityRow));
            return [Sheet.library.tab(acts, { name: "A", key: a => a.name, label: a => a.name }), Sheet.library.tab(acts, { name: "A", key: a => a.uom, label: a => a.uom })];
        }), /two tabs named "A"/);
        assert.throws(() => flatLibrary(($) => {
            const acts = $.const(ACTIVITIES, ArrayType(ActivityRow));
            return [Sheet.library.tab(acts, { name: "Jobs", key: a => a.name, label: a => a.name, drop: a => Sheet.patch(ex.BuilderJob, { task: a.name }) })];
        }), /the "Jobs" tab's `drop` returns a patch over neither the row type nor the group type/);
        assert.throws(() => flatLibrary(($) => {
            const acts = $.const(ACTIVITIES, ArrayType(ActivityRow));
            return [Sheet.library.tab(acts, { name: "Orders", key: a => a.name, label: a => a.name, drop: a => Sheet.patch(OrderType, { name: a.name }) })];
        }), /neither the row type nor the group type — build it with Sheet.patch\(RowType, …\) over the sheet's row type/);
        assert.throws(() => flatLibrary(() => [Sheet.library.tab("PLANNED" as never, { name: "Words", key: () => "k", label: () => "l" })]),
            /the "Words" tab's data must be an Array or a Dict<String, T> — got a String/);
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
