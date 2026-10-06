/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Sheet>`'s payload (#1216; `Sheet Builder Spec.md` §3–§5, SB7–SB12): its
 * two sources — a record's entries, one entry's rows, its groups, groups with
 * loose rows between them, a window of a large one; and the host's rows, an
 * array, a bind handle or a paged source — its panes, each an optional prop,
 * absent and present, a template's seed, built by `newRow`'s and `newGroup`'s
 * own code, the library (#1186, SB59, SB60): its tabs in order, an author's
 * cards through their accessors and where a drop's patch lands, `views` as a
 * bind handle, and every refusal, each naming the prop and the remedy. How
 * the payload meets a record runs in e3-ui-components' `sheet-payload` spec,
 * against the record runtime.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, DictType, East, Expr, FloatType, FunctionType, IntegerType, NullType, OptionType, SortedMap, StringType, StructType,
    compareFor, decodeBeast2For, isTypeEqual, none, some, variant,
    type BlockBuilder, type EastType, type ValueTypeOf,
} from "@elaraai/east";
import { Paged, UIComponentType } from "@elaraai/east-ui";
import { State, Text } from "@elaraai/east-ui/internal";
import {
    Data, Record, Sheet, SheetLibraryTabType, SheetPayloadType, SheetTemplateWireType, buildLibrary, buildTemplates, createSheetBuild, sheetKeys,
    type SheetLibraryTab,
} from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import * as ex from "./sheet.examples.js";

/** Run `build` inside a block, as a sheet's factory runs. */
function inBlock<T>(build: ($: BlockBuilder<NullType>) => T): T {
    let out: T | undefined;
    East.function([], NullType, ($) => { out = build($); });
    return out!;
}
const typeOf = (e: unknown): EastType => Expr.type(e as Expr) as EastType;

const JOB_COLUMNS = {
    task:  Sheet.column.text(ex.SheetJob, { header: "Task" }),
    start: Sheet.column.date(ex.SheetJob, { header: "Start" }),
    qty:   Sheet.column.quantity(ex.SheetJob, { header: "Qty" }),
};

describe("the payload (SB12)", () => {
    test("the smallest sheet's payload is SheetPayloadType: the sheet whole, its templates, its panes, the record's history", () => {
        inBlock(($) => {
            const jobs = $.let(Record.bind(ex.sheetJobs, [ex.sheetJobsPatch]));
            const payload = Sheet.Payload({ record: jobs, columns: JOB_COLUMNS });
            assert.ok(isTypeEqual(typeOf(payload), SheetPayloadType));
        });
    });

    test("the keys a sheet keeps its viewer's state under, and its drop target, follow its name", () => {
        assert.deepEqual(sheetKeys(undefined), { frame: "sheet.frame", columns: "sheet.columns", library: "sheet.library", surface: "sheet.surface" });
        assert.deepEqual(sheetKeys("orders"), {
            frame: "sheet.orders.frame", columns: "sheet.orders.columns", library: "sheet.library.orders", surface: "sheet.orders.surface",
        });
    });

    test("a column built over another type than the record's entries fails to compile (SB8)", () => {
        // Type-level: the build never runs. An overload that accepted these would fail the build on its unused directive.
        const never = (): void => {
            inBlock(($) => {
                const jobs = $.let(Record.bind(ex.sheetJobs, [ex.sheetJobsPatch]));
                // @ts-expect-error — the columns are over the week's row, and the record holds jobs
                return Sheet({ record: jobs, columns: { task: Sheet.column.text(ex.WeekRow, { header: "Task" }) } });
            });
        };
        assert.equal(typeof never, "function");
    });
});

// The host's rows: a flat sheet over a few jobs, as an array, and as a paged
// source built by hand to the row-source contract.
const Job = StructType({ id: StringType, task: StringType, qty: OptionType(FloatType) });
const Jobs = ArrayType(Job);
/** Fixtures at MODULE scope: East bodies never call host helpers. */
const JOBS = [
    { id: "j1", task: "Panel cutting", qty: some(48.0) },
    { id: "j2", task: "Edge banding", qty: none },
];
const JOBS_PAGE = East.function([IntegerType, IntegerType], OptionType(Jobs), ($, offset, limit) => {
    const all = $.const(JOBS, Jobs);
    const n = $.let(all.size());
    const start = $.let(offset.less(n).ifElse(() => offset, () => n));
    const end = $.let(start.add(limit).less(n).ifElse(() => start.add(limit), () => n));
    return some(all.slice(start, end));
});
const JOBS_TOTAL = East.function([], OptionType(IntegerType), ($) => {
    const all = $.const(JOBS, Jobs);
    return some(all.size());
});
const JOBS_SOURCE = { id: "jobs", page: JOBS_PAGE, total: JOBS_TOTAL, seek: none };
const DATA_COLUMNS = {
    task: Sheet.column.text(Job, { header: "Task" }),
    qty:  Sheet.column.quantity(Job, { header: "Qty" }),
};
// A views handle built by hand, as `State.bind` and `Data.bind` hand one: a read and a write.
const ViewsHandle = StructType({ read: FunctionType([], ArrayType(Sheet.Types.View)), write: FunctionType([ArrayType(Sheet.Types.View)], NullType) });
const VIEWS = [{
    id: "v1", name: "ALL", context: 1n, reveals: [], folds: new Map(),
    narrowing: { range: none, compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(), breakdown: none, search: none, visible: none, selectedIndex: none, resolution: none },
}];

type Payload = ValueTypeOf<typeof SheetPayloadType>;
/** A sheet over the jobs as an array, with the props given beside its rows and columns, compiled and run. */
const overJobs = (props: ($: BlockBuilder<typeof SheetPayloadType>) => Record<string, unknown>): Payload =>
    East.compile(East.function([], SheetPayloadType, ($) => {
        const rows = $.const(JOBS, Jobs);
        return Sheet.Payload({ data: rows, id: "id", columns: DATA_COLUMNS, ...props($) });
    }), [])() as Payload;

describe("its rows' two sources (#1216)", () => {
    test("over a record: its entries, a window of them, one entry's rows, its groups, and groups with loose rows between them", () => {
        inBlock(($) => {
            const jobs = $.let(Record.bind(ex.sheetJobs, [ex.sheetJobsPatch]));
            assert.ok(isTypeEqual(typeOf(Sheet.Payload({ record: jobs, columns: JOB_COLUMNS })), SheetPayloadType), "the entries");
            const page = $.let(Data.bindPaged(ex.sheetJobs));
            assert.ok(isTypeEqual(typeOf(Sheet.Payload({ record: jobs, window: page, columns: JOB_COLUMNS })), SheetPayloadType), "a window of them");
            const plans = $.let(Record.bind(ex.sheetWeekPlans, [ex.sheetWeekPlansPatch]));
            assert.ok(isTypeEqual(typeOf(Sheet.Payload({
                record: plans, entry: { key: "2026-W42", rows: "rows", id: "id" }, columns: { task: Sheet.column.text(ex.WeekRow, { header: "Task" }) },
            })), SheetPayloadType), "one entry's rows");
            const days = $.let(Record.bind(ex.sheetBatchDays, [ex.sheetBatchDaysPatch]));
            assert.ok(isTypeEqual(typeOf(Sheet.Payload({
                record: days, entry: { key: "2026-10-12", rows: "batches", id: "id" },
                group: Sheet.group(ex.Batch, "steps", { title: "name" }), columns: { task: Sheet.column.text(ex.BatchStep, { header: "Step" }) },
            })), SheetPayloadType), "one entry's groups");
            const work = $.let(Record.bind(ex.sheetLooseWork, [ex.sheetLooseWorkPatch]));
            assert.ok(isTypeEqual(typeOf(Sheet.Payload({
                record: work, entry: { key: "2026-W42", rows: "entries", id: "id" },
                group: Sheet.group(ex.LoosePackage, "tasks", { title: "name" }), columns: { task: Sheet.column.text(ex.LooseTask, { header: "Task" }) },
            })), SheetPayloadType), "groups with loose rows between them");
        });
    });

    test("over a record's entries as groups: the record's entries are the groups, in key order", () => {
        inBlock(($) => {
            const orders = $.let(Record.bind(ex.sheetWorkshopOrders, [ex.sheetWorkshopOrdersPatch]));
            assert.ok(isTypeEqual(typeOf(Sheet.Payload({
                record: orders, group: Sheet.group(ex.WorkshopOrder, "ops", { title: "name" }),
                columns: { notes: Sheet.column.text(ex.WorkshopOperation, { header: "Notes" }) },
            })), SheetPayloadType));
        });
    });

    test("over data — an array, a bind handle, a paged source: the rows its own, no record's history and no missing entry", () => {
        const payload = overJobs(() => ({}));
        assert.equal(payload.sheet.rows.type, "inline");
        if (payload.sheet.rows.type !== "inline") assert.fail("an array's rows arrive inline");
        assert.deepEqual(payload.sheet.rows.value.map((row) => row.id), ["j1", "j2"]);
        assert.deepEqual(payload.history, none, "no record: no commits to read a last save from");
        assert.deepEqual(payload.missing, none);
        assert.deepEqual(payload.name, none);
        inBlock(($) => {
            const bound = $.let(State.bind([Jobs], "sheet.payload.spec.jobs", JOBS));
            assert.ok(isTypeEqual(typeOf(Sheet.Payload({ data: bound, id: "id", columns: DATA_COLUMNS, onUpdate: bound.write })), SheetPayloadType), "a bind handle");
        });
        const paged = East.compile(East.function([], SheetPayloadType, ($) => {
            const source = $.const(JOBS_SOURCE, Paged.Types.Source(Jobs));
            return Sheet.Payload({ data: source, id: "id", columns: DATA_COLUMNS });
        }), [])() as Payload;
        assert.equal(paged.sheet.rows.type, "paged", "a paged source's rows arrive a window at a time");
        assert.deepEqual(paged.history, none);
    });
});

describe("its panes, each an optional prop (#1216)", () => {
    test("no `library`, no library tab; no `inspector`, no inspector pane", () => {
        const payload = overJobs(() => ({}));
        assert.deepEqual(payload.library, []);
        assert.deepEqual(payload.inspector, none);
    });

    test("`library` lists the library pane's tabs, in order", () => {
        const payload = overJobs(() => ({ library: [Sheet.library.columns(), Sheet.library.rows()] }));
        assert.deepEqual(payload.library, [variant("columns", null), variant("rows", null)]);
    });

    test("`inspector` alone: the pane, its Details the selected row's form, every field of the row but its identity", () => {
        const payload = overJobs(() => ({ inspector: true }));
        if (payload.inspector.type !== "some") assert.fail("given, the payload carries the pane");
        assert.deepEqual(payload.inspector.value.custom, none, "no Details of the author's own: the form");
        assert.deepEqual(payload.inspector.value.forms.row.fields.map((f) => f.spec.path.join(".")), ["task", "qty"]);
        assert.deepEqual(payload.inspector.value.forms.group, none, "a flat sheet has no group form");
    });

    test("`inspector` given a function: the pane, with the author's own Details beside the form an incomplete row shows", () => {
        const payload = overJobs(($) => ({
            inspector: $.const(East.function([Job, FunctionType([Job], NullType)], UIComponentType, (_$2, row) => Text.Root(row.task))),
        }));
        if (payload.inspector.type !== "some") assert.fail("given, the payload carries the pane");
        assert.equal(payload.inspector.value.custom.type, "some");
        assert.deepEqual(payload.inspector.value.forms.row.fields.map((f) => f.spec.path.join(".")), ["task", "qty"]);
    });

    test("`views` is a bind handle: its read the sheet's views, its write their write-back", () => {
        const payload = overJobs(($) => ({
            views: $.const({
                read: East.function([], ArrayType(Sheet.Types.View), () => VIEWS),
                write: East.function([ArrayType(Sheet.Types.View)], NullType, () => null),
            }, ViewsHandle),
            activeView: some("v1"),
        }));
        assert.deepEqual(payload.sheet.views.map((v) => [v.id, v.name, v.context]), [["v1", "ALL", 1n]]);
        assert.equal(payload.sheet.onViewsChange.type, "some");
        assert.deepEqual(payload.sheet.activeView, some("v1"));
    });

    test("`name` names the sheet", () => {
        assert.deepEqual(overJobs(() => ({ name: "jobs" })).name, some("jobs"));
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

    test("refused, naming the tab: a tab listed twice, two author's tabs of one name, a drop over another type, and data neither an Array nor a Dict", () => {
        assert.throws(() => flatLibrary(() => [Sheet.library.rows(), Sheet.library.rows()]), /the library lists Sheet.library.rows\(\) twice/);
        assert.throws(() => flatLibrary(($) => {
            const acts = $.const(ACTIVITIES, ArrayType(ActivityRow));
            return [Sheet.library.tab(acts, { name: "A", key: a => a.name, label: a => a.name }), Sheet.library.tab(acts, { name: "A", key: a => a.uom, label: a => a.uom })];
        }), /two tabs named "A"/);
        assert.throws(() => flatLibrary(($) => {
            const acts = $.const(ACTIVITIES, ArrayType(ActivityRow));
            return [Sheet.library.tab(acts, { name: "Jobs", key: a => a.name, label: a => a.name, drop: a => Sheet.patch(ex.SheetJob, { task: a.name }) })];
        }), /the "Jobs" tab's `drop` returns a patch over neither the row type nor the group type/);
        assert.throws(() => flatLibrary(($) => {
            const acts = $.const(ACTIVITIES, ArrayType(ActivityRow));
            return [Sheet.library.tab(acts, { name: "Orders", key: a => a.name, label: a => a.name, drop: a => Sheet.patch(OrderType, { name: a.name }) })];
        }), /neither the row type nor the group type — build it with Sheet.patch\(RowType, …\) over the sheet's row type/);
        assert.throws(() => flatLibrary(() => [Sheet.library.tab("PLANNED" as never, { name: "Words", key: () => "k", label: () => "l" })]),
            /the "Words" tab's data must be an Array or a Dict<String, T> — got a String/);
    });
});

// A grouped sheet whose lines carry a link: what a member check and an arity
// rule over the line are written against (#1214).
const MachineOp = StructType({ activity: StringType, qty: OptionType(FloatType), machines: Sheet.Types.Link });
const MachineOrder = StructType({ name: StringType, ops: ArrayType(MachineOp) });
const MachineActivity = StructType({ name: StringType, family: StringType });
const MACHINE_ORDERS = new SortedMap([["WO-1", { name: "WO-1 · Kitchen", ops: [
    { activity: "Panel cutting", qty: some(48.0), machines: { from: [], to: [] } },
] }]], compareFor(StringType));
const MACHINE_ACTIVITIES = [{ name: "Panel cutting", family: "beam saw" }];
type Column = ValueTypeOf<typeof Sheet.Types.Column>;

// One entry's groups with loose rows between them, as a record holds them (#1214).
const LooseTask = StructType({ id: StringType, task: StringType });
const LoosePackage = StructType({ id: StringType, name: StringType, tasks: ArrayType(LooseTask) });
const LooseWeek = StructType({ entries: ArrayType(Sheet.Types.Entry(LoosePackage, "tasks")) });
const looseWork = e3.record("sheet_spec_loose", DictType(StringType, LooseWeek), new Map([
    ["w", { entries: [
        variant("row", { id: "brief", task: "Check the drawings" }),
        variant("group", { id: "doors", name: "Kitchen doors", tasks: [{ id: "doors-1", task: "Cut door blanks" }] }),
    ] }],
]));
const looseWorkPatch = e3.mutation.patch(looseWork);

describe("grouped checks and loose rows (#1214)", () => {
    test("a grouped sheet's member check reads its line's fields, typed, on a link column beside an arity rule over the line", () => {
        const columns = East.compile(East.function([], ArrayType(Sheet.Types.Column), ($) => {
            const orders = $.const(MACHINE_ORDERS, DictType(StringType, MachineOrder));
            const activities = $.const(MACHINE_ACTIVITIES, ArrayType(MachineActivity));
            // The line's own activity, read typed: `CheckContext(P, "lines")` types its row as the line's draft.
            const named = $.const(East.function([Sheet.Types.CheckContext(MachineOrder, "ops")], OptionType(StringType), (_$2, c) =>
                c.row.activity.match({
                    value: (_$3, activity) => East.value(some(East.str`${activity} names no machine`), OptionType(StringType)),
                }, (_$3) => East.value(none, OptionType(StringType)))));
            const one = $.const(East.function([Sheet.Types.Context(MachineOrder, "ops", MachineActivity)], OptionType(Sheet.Types.Counted), (_$2, ctx) =>
                ctx.driver.match({
                    some: (_$3, a) => East.value(some({ n: 1n, key: a.family }), OptionType(Sheet.Types.Counted)),
                    none: (_$3) => East.value(none, OptionType(Sheet.Types.Counted)),
                })));
            const build = createSheetBuild(orders, {
                activity: Sheet.column.lookup(MachineOp, { header: "Activity" }),
                // The check beside the arity: the column's row type stays the line, so both are taken.
                machines: Sheet.column.link(MachineOp, MachineActivity, "machines", {
                    header: "Machines", arity: Sheet.link.arity("from", one), check: [Sheet.link.check.exists(), named],
                }),
            }, {
                group: Sheet.group(MachineOrder, "ops", { title: "name" }),
                driver: Sheet.driver("activity", activities, { key: (a) => a.name, label: (a) => a.name }),
                registers: { machines: Sheet.register.members(activities, { kind: "family", key: (a) => a.family, label: (a) => a.family }) },
            }, { keyOrdered: true });
            return build.root.columns;
        }), []);
        const [, machines] = columns() as Column[];
        if (machines!.kind.type !== "link") assert.fail(`expected a link column, got ${machines!.kind.type}`);
        assert.deepEqual(machines!.kind.value.check.map((c) => c.type), ["exists", "custom"]);
        assert.equal(machines!.kind.value.arity.type, "some");
    });

    test("a sheet takes one entry's groups with loose rows between them, Sheet.Types.Entry(P, \"lines\"): the tag types the form, and its payload builds", () => {
        inBlock(($) => {
            const work = $.let(Record.bind(looseWork, [looseWorkPatch]));
            // Through the tag, typed: the entry's rows hold groups and loose rows, its id a field of both.
            Sheet({
                record: work, entry: { key: "w", rows: "entries", id: "id" },
                group: Sheet.group(LoosePackage, "tasks", { title: "name" }),
                columns: { task: Sheet.column.text(LooseTask, { header: "Task" }) },
            });
            const payload = Sheet.Payload({
                record: work, entry: { key: "w", rows: "entries", id: "id" },
                group: Sheet.group(LoosePackage, "tasks", { title: "name" }),
                columns: { task: Sheet.column.text(LooseTask, { header: "Task" }) },
            });
            assert.ok(isTypeEqual(typeOf(payload), SheetPayloadType));
        });
    });
});

describe("refusals (SB7), each naming the prop and the remedy", () => {
    const counter = e3.record("sheet_spec_counter", IntegerType, 0n);
    const bump = e3.mutation.reduce("bump", counter, East.function([IntegerType], IntegerType, (_$, n) => n.add(1n)));
    const sheet = (props: Record<string, unknown>) => (Sheet as unknown as (p: Record<string, unknown>) => unknown)(props);

    test("rows from both `record` and `data`, from neither, and `entry` or `window` without a record", () => {
        assert.throws(() => inBlock(($) => sheet({
            record: $.let(Record.bind(ex.sheetJobs, [ex.sheetJobsPatch])), data: $.const(JOBS, Jobs), columns: JOB_COLUMNS,
        })), /takes its rows from `record` or from `data`, never both/);
        assert.throws(() => sheet({ columns: DATA_COLUMNS }), /needs its rows — `record`, an e3 record bound with its patch mutation, or `data`/);
        assert.throws(() => inBlock(($) => sheet({ data: $.const(JOBS, Jobs), id: "id", entry: { key: "w", rows: "rows", id: "id" }, columns: DATA_COLUMNS })),
            /`entry` reads a record — pass `record` for it, or leave it out with `data`/);
        assert.throws(() => inBlock(($) => sheet({ data: $.const(JOBS, Jobs), id: "id", window: $.let(Data.bindPaged(ex.sheetJobs)), columns: DATA_COLUMNS })),
            /`window` reads a record/);
    });

    test("a record that is not a Dict, and one bound without its patch door", () => {
        assert.throws(() => inBlock(($) => sheet({ record: $.let(Record.bind(counter, [bump])), columns: JOB_COLUMNS })),
            /`record` must be a Dict — its entries, or one entry's rows, are the sheet's rows/);
        assert.throws(() => inBlock(($) => sheet({ record: $.let(Record.bind(ex.sheetJobs, [])), columns: JOB_COLUMNS })),
            /"patch" is not bound as this record's patch door/);
    });

    test("`window` with `entry`, and a window over another record's collection", () => {
        assert.throws(() => inBlock(($) => sheet({
            record: $.let(Record.bind(ex.sheetWeekPlans, [ex.sheetWeekPlansPatch])),
            entry: { key: "2026-W42", rows: "rows", id: "id" }, window: $.let(Data.bindPaged(ex.sheetWeekPlans)),
            columns: { task: Sheet.column.text(ex.WeekRow, { header: "Task" }) },
        })), /`window` pages the record's entries, and with `entry` the rows are one entry's field, read whole/);
        assert.throws(() => inBlock(($) => sheet({
            record: $.let(Record.bind(ex.sheetJobs, [ex.sheetJobsPatch])), window: $.let(Data.bindPaged(ex.sheetWeekPlans)), columns: JOB_COLUMNS,
        })), /`window` must page the record's entries — Data.bindPaged\(record\) over the same record/);
    });

    test("a record's own Apply, identity and name: `onApply` and `onUpdate` write data back, and `id` names data's identity — `name` names the sheet", () => {
        for (const prop of ["onApply", "onUpdate"]) {
            assert.throws(() => inBlock(($) => sheet({
                record: $.let(Record.bind(ex.sheetJobs, [ex.sheetJobsPatch])), columns: JOB_COLUMNS, [prop]: none,
            })), new RegExp(`\`${prop}\` writes \`data\` back — a sheet over \`record\` commits through the record's patch mutation`));
        }
        assert.throws(() => inBlock(($) => sheet({
            record: $.let(Record.bind(ex.sheetJobs, [ex.sheetJobsPatch])), columns: JOB_COLUMNS, id: "jobs",
        })), /`id` names the identity field of `data`'s rows — a record's rows are identified by their key, or by `entry.id`; to name the sheet, pass `name`/);
    });

    test("hints with no inspector to take them", () => {
        assert.throws(() => overJobs(() => ({ fields: { task: Sheet.field.readonly() } })),
            /`fields` hints the inspector's form, and this sheet has no inspector — pass `inspector` to show the pane, or leave `fields` out/);
        assert.throws(() => overJobs(() => ({ groupFields: { name: Sheet.field.readonly() } })),
            /`groupFields` hints the inspector's form, and this sheet has no inspector/);
    });

    test("a template over another type, a key that repeats, and a group template on a flat sheet", () => {
        const jobsSheet = (templates: unknown) => inBlock(($) => sheet({
            record: $.let(Record.bind(ex.sheetJobs, [ex.sheetJobsPatch])), columns: JOB_COLUMNS, templates,
        }));
        assert.throws(() => jobsSheet({ rows: [{ key: "x", name: "X", values: Sheet.patch(ex.WeekRow, { task: "X" }) }] }),
            /row template "x" was built over another type — build its values with Sheet.patch\(RowType, …\)/);
        assert.throws(() => jobsSheet({ rows: [
            { key: "a", name: "A", values: Sheet.patch(ex.SheetJob, { task: "A" }) },
            { key: "a", name: "Again", values: Sheet.patch(ex.SheetJob, { task: "Again" }) },
        ] }), /template key "a" repeats/);
        assert.throws(() => jobsSheet({ groups: [{ key: "g", name: "G", values: Sheet.patch(ex.SheetJob, { task: "G" }) }] }),
            /`templates.groups` needs a grouped sheet/);
    });

    test("a views handle of anything but Array<Sheet.Types.View>, and `onViewsChange`, which the handle replaces", () => {
        assert.throws(() => inBlock(($) => sheet({
            record: $.let(Record.bind(ex.sheetJobs, [ex.sheetJobsPatch])), columns: JOB_COLUMNS,
            views: $.let(State.bind([StringType], "sheet.spec.views", "")),
        })), /`views` must be a bind handle of Array<Sheet.Types.View>/);
        inBlock(($) => sheet({
            record: $.let(Record.bind(ex.sheetJobs, [ex.sheetJobsPatch])), columns: JOB_COLUMNS,
            views: $.let(State.bind([ArrayType(Sheet.Types.View)], "sheet.spec.views", [])),
        }));
        assert.throws(() => overJobs(() => ({ onViewsChange: none })), /`views` is a bind handle .* it takes no `onViewsChange`/);
    });
});
