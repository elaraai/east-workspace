/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, test as hostTest } from "node:test";
import assert from "node:assert/strict";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Sheet, Paged, UIComponentType } from "@elaraai/east-ui/internal";
import {
    East, ArrayType, BooleanType, DateTimeType, DictType, FloatType, IntegerType, NullType, OptionType, StringType, StructType,
    none, some, variant, type ExprType,
} from "@elaraai/east";
import * as ex from "./sheet.examples.js";

// ── The fixtures every test shares — declared at module scope so the tests
// read as the examples do; the East bodies below bind them with `$.const`.
const JobType = StructType({
    id:    StringType,
    start: OptionType(DateTimeType),
    task:  StringType,
    qty:   OptionType(FloatType),
    count: IntegerType,
    owner: StringType,
});
const ActivityType = StructType({ name: StringType, uom: StringType, days: IntegerType, sides: Sheet.Types.Sides });
const PlanRowType = StructType({
    id: StringType, start: OptionType(DateTimeType), activity: StringType, qty: OptionType(FloatType),
    stations: Sheet.Types.Link, fromStations: ArrayType(Sheet.Types.Member), toStations: ArrayType(Sheet.Types.Member),
    machines: StringType, status: StringType, note: StringType,
});
const JOBS = [
    { id: "a", start: some(new Date("2026-02-16T00:00:00Z")), task: "Machining", qty: some(1200.0), count: 2n, owner: "planner" },
    { id: "b", start: none, task: "", qty: none, count: 0n, owner: "erp" },
];
const ACTIVITIES = [
    { name: "Machining", uom: "pcs", days: 4n, sides: variant("both", null) },
    { name: "Inspection", uom: "lots", days: 1n, sides: variant("in", null) },
];
const MEMBERS = [
    { key: "M2140", label: "M2140", kind: "machine", aliases: [], meta: some("CNC lathe"), parent: some("Line 2"), tone: none },
    { key: "M2141", label: "M2141", kind: "machine", aliases: [], meta: some("CNC lathe"), parent: some("Line 2"), tone: none },
    { key: "Line 2", label: "Line 2", kind: "line", aliases: ["the line 2", "l2"], meta: none, parent: none, tone: none },
    { key: "CNC lathe", label: "CNC lathe", kind: "family", aliases: ["lathe"], meta: some("family"), parent: none, tone: none },
];

// ── Grouped rows (#740): the group is the row, its lines in one field.
const LineType = StructType({ start: OptionType(DateTimeType), task: StringType, qty: OptionType(FloatType), note: StringType });
const PlanType = StructType({ id: StringType, name: StringType, owner: StringType, status: StringType, total: FloatType, lines: ArrayType(LineType) });
const KeyedPlanType = StructType({ id: StringType, name: StringType, lines: DictType(StringType, LineType) });
const PLANS = [
    { id: "p1", name: "Line 2 week 8", owner: "planner", status: "PLANNED", total: 300.0, lines: [
        { start: some(new Date("2026-02-16T00:00:00Z")), task: "Machining", qty: some(120.0), note: "first" },
        { start: none, task: "Inspection", qty: none, note: "second" },
    ] },
    { id: "p2", name: "Line 3 week 8", owner: "erp", status: "COMPLETE", total: 0.0, lines: [] },
];
// Wire rows the edit and context tests send — a group row's band cells, its
// lines keyed by SOURCE index (a minted key for a line the source lacks).
// Plain host data, spelt out (no helper builds East values).
const LINE_0 = { key: "0", cells: new Map<string, unknown>([["start", variant("Null", null)], ["task", variant("String", "Machining")], ["qty", variant("Float", 120.0)], ["note", variant("String", "first")]]) as never };
const LINE_1 = { key: "1", cells: new Map<string, unknown>([["start", variant("Null", null)], ["task", variant("String", "Inspection")], ["qty", variant("Null", null)], ["note", variant("String", "second")]]) as never };
const LINE_1_PAINTED = { key: "1", cells: new Map<string, unknown>([["start", variant("Null", null)], ["task", variant("String", "Painting")], ["qty", variant("Null", null)], ["note", variant("String", "second")]]) as never };
const LINE_NEW = { key: "new", cells: new Map<string, unknown>([["start", variant("Null", null)], ["task", variant("String", "Between")], ["qty", variant("Null", null)], ["note", variant("String", "")]]) as never };
const P1_CELLS = new Map<string, unknown>([["$title", variant("String", "Line 2 week 8")], ["qty", variant("Float", 300.0)], ["note", variant("String", "PLANNED")]]) as never;
const BAND = some({ sub: "", folded: false });
const P1_ROW = { id: "p1", owned: false, cells: P1_CELLS, lines: [LINE_0, LINE_1], band: BAND };
const P1_PAINTED = { id: "p1", owned: false, cells: P1_CELLS, lines: [LINE_0, LINE_1_PAINTED], band: BAND };
const P1_INSERTED = { id: "p1", owned: false, cells: P1_CELLS, lines: [LINE_0, LINE_NEW, LINE_1], band: BAND };
const P1_REMOVED = { id: "p1", owned: false, cells: P1_CELLS, lines: [LINE_0], band: BAND };
const P1_RENAMED = { id: "p1", owned: false, cells: new Map<string, unknown>([["$title", variant("String", "Renamed")], ["qty", variant("Float", 999.0)], ["note", variant("String", "PLANNED")]]) as never, lines: [LINE_0, LINE_1], band: BAND };
const P2_ROW = { id: "p2", owned: false, cells: new Map<string, unknown>([["$title", variant("String", "Line 3 week 8")]]) as never, lines: [], band: BAND };
const P3_ROW = { id: "p3", owned: false, cells: new Map<string, unknown>([["$title", variant("String", "New plan")]]) as never, lines: [], band: BAND };
const EDITING_CELLS = new Map<string, unknown>([["task", variant("String", "Painting")]]) as never;

describeEast("Sheet", (test) => {
    Assert.examples(test, {
        sheetBasic: ex.sheetBasic,
        sheetVariants: ex.sheetVariants,
        sheetPlan: ex.sheetPlan,
        sheetCopilot: ex.sheetCopilot,
        sheetLens: ex.sheetLens,
        sheetWriteBack: ex.sheetWriteBack,
        sheetPaged: ex.sheetPaged,
        sheetStress: ex.sheetStress,
    });

    test("the examples evaluate to a Sheet under a Reactive root", $ => {
        const basic = $.const(ex.sheetBasic.fn() as ExprType<UIComponentType>);
        $(Assert.equal(basic.unwrap().hasTag("ReactiveComponent"), true));
        const plan = $.const(ex.sheetPlan.fn() as ExprType<UIComponentType>);
        $(Assert.equal(plan.unwrap().hasTag("ReactiveComponent"), true));
    });

    // =========================================================================
    // Rows — the inline arm projects every column into a closed cell
    // =========================================================================

    test("inline rows project each column kind into its cell, blanks as Null, the id and owned stamped", $ => {
        const rows = $.const(JOBS, ArrayType(JobType));
        const sheet = $.let(Sheet.Root(rows, {
            start: Sheet.column.date(JobType, { header: "Start" }),
            task:  Sheet.column.text(JobType, { header: "Task" }),
            qty:   Sheet.column.quantity(JobType, { header: "Qty" }),
            count: Sheet.column.integer(JobType, { header: "Count" }),
        }, { id: "id", owned: r => r.owner.equal("erp") }));
        const root = $.let(sheet.unwrap().unwrap("Sheet"));
        const inline = $.let(root.rows.unwrap("inline"));
        $(Assert.equal(inline.size(), 2n));
        $(Assert.equal(inline.get(0n).id, "a"));
        $(Assert.equal(inline.get(0n).owned, false));
        $(Assert.equal(inline.get(1n).owned, true));
        $(Assert.equal(inline.get(0n).cells.get("start").hasTag("DateTime"), true));
        $(Assert.equal(inline.get(0n).cells.get("task").unwrap("String"), "Machining"));
        $(Assert.equal(inline.get(0n).cells.get("qty").unwrap("Float"), 1200.0));
        $(Assert.equal(inline.get(0n).cells.get("count").unwrap("Integer"), 2n));
        // Blanks: a `none` field and a non-Option Integer both cross as their cells.
        $(Assert.equal(inline.get(1n).cells.get("start").hasTag("Null"), true));
        $(Assert.equal(inline.get(1n).cells.get("qty").hasTag("Null"), true));
        $(Assert.equal(inline.get(1n).cells.get("count").unwrap("Integer"), 0n));
        // The columns carry their static types and editability.
        $(Assert.equal(root.columns.size(), 4n));
        $(Assert.equal(root.columns.get(0n).key, "start"));
        $(Assert.equal(root.columns.get(0n).header, "Start"));
        $(Assert.equal(root.columns.get(0n).editable, true));
        $(Assert.equal(root.columns.get(0n).kind.hasTag("date"), true));
        $(Assert.equal(root.columns.get(2n).kind.hasTag("quantity"), true));
    });

    test("a derived read projects the value and is read-only; a stamped column is never editable", $ => {
        const rows = $.const(JOBS, ArrayType(JobType));
        const sheet = $.let(Sheet.Root(rows, {
            task:  Sheet.column.text(JobType, { header: "Task" }),
            count: Sheet.column.integer(JobType, { header: "Twice", value: r => r.count.multiply(2n) }),
            owner: Sheet.column.stamped(JobType, { header: "Owner", owner: "ERP" }),
        }, { id: "id" }));
        const root = $.let(sheet.unwrap().unwrap("Sheet"));
        $(Assert.equal(root.rows.unwrap("inline").get(0n).cells.get("count").unwrap("Integer"), 4n));
        $(Assert.equal(root.columns.get(1n).editable, false));
        $(Assert.equal(root.columns.get(2n).editable, false));
        $(Assert.equal(root.columns.get(2n).kind.unwrap("stamped").owner.unwrap("some"), "ERP"));
    });

    test("the paged arm projects a window exactly as the inline arm projects the whole collection", $ => {
        const rows = $.const(JOBS, ArrayType(JobType));
        const source = $.const(Paged.of("jobs", rows, { key: r => r.id }));
        const sheet = $.let(Sheet.Root(source, {
            task: Sheet.column.text(JobType, { header: "Task" }),
        }, { id: "id" }));
        const paged = $.let(sheet.unwrap().unwrap("Sheet").rows.unwrap("paged"));
        $(Assert.equal(paged.id, "jobs"));
        const win = $.let(paged.page(0n, 10n).unwrap("some"));
        $(Assert.equal(win.size(), 2n));
        $(Assert.equal(win.get(1n).id, "b"));
        $(Assert.equal(win.get(1n).cells.get("task").unwrap("String"), ""));
        $(Assert.equal(paged.total().unwrap("some"), 2n));
        $(Assert.equal(paged.seek.hasTag("some"), true));
    });

    test("a keyed paged source needs no id — the key is the row id", $ => {
        const keyed = $.const(new Map([
            ["J10", { start: none, task: "Machining", qty: none, count: 1n, owner: "planner" }],
            ["J2",  { start: none, task: "Painting", qty: none, count: 1n, owner: "planner" }],
        ]), DictType(StringType, StructType({ start: OptionType(DateTimeType), task: StringType, qty: OptionType(FloatType), count: IntegerType, owner: StringType })));
        const source = $.const(Paged.of("keyed", keyed));
        const sheet = $.let(Sheet.Root(source, {
            task: Sheet.column.text(StructType({ start: OptionType(DateTimeType), task: StringType, qty: OptionType(FloatType), count: IntegerType, owner: StringType }), { header: "Task" }),
        }));
        const win = $.let(sheet.unwrap().unwrap("Sheet").rows.unwrap("paged").page(0n, 10n).unwrap("some"));
        // Canonical key order — the order a keyed dataset's windows arrive in.
        $(Assert.equal(win.get(0n).id, "J10"));
        $(Assert.equal(win.get(1n).id, "J2"));
    });

    // =========================================================================
    // Registers and the driver
    // =========================================================================

    test("registers project rows through accessors, fold duplicate keys, concat kinds, and the driver's members ride under its column", $ => {
        const activities = $.const(ACTIVITIES, ArrayType(ActivityType));
        const machines = $.const([
            { code: "M2140", family: "CNC lathe", line: "Line 2" },
            { code: "M2141", family: "CNC lathe", line: "Line 2" },
            { code: "M3210", family: "5-axis mill", line: "Line 3" },
        ], ArrayType(StructType({ code: StringType, family: StringType, line: StringType })));
        const statuses = $.const(new Map([["PLANNED", { tone: variant("neutral", null) }], ["COMPLETE", { tone: variant("success", null) }]]),
            DictType(StringType, StructType({ tone: Sheet.Types.RegisterMember.fields.tone.cases.some })));
        const rows = $.const([{ id: "1", start: none, activity: "Machining", qty: some(2.0), stations: { from: [], to: [] }, fromStations: [], toStations: [], machines: "", status: "PLANNED", note: "" }], ArrayType(PlanRowType));
        const sheet = $.let(Sheet.Root(rows, {
            activity: Sheet.column.lookup(PlanRowType, { header: "Activity" }),
            status:   Sheet.column.enum(PlanRowType, "statuses", { header: "Status" }),
            stations: Sheet.column.link(PlanRowType, ActivityType, "stations", { header: "Work centres" }),
        }, {
            id: "id",
            driver: Sheet.driver("activity", activities, { key: a => a.name, label: a => a.name }),
            registers: {
                stations: Sheet.register.concat([
                    Sheet.register.members(machines, { kind: "machine", key: m => m.code, label: m => m.code, meta: m => some(m.family), parent: m => some(m.line) }),
                    Sheet.register.members(machines, { kind: "family", key: m => m.family, label: m => m.family }),
                ]),
                statuses: Sheet.register.members(statuses, { kind: "status", key: (_s, k) => k, label: (_s, k) => k, tone: s => some(s.tone) }),
            },
        }));
        const root = $.let(sheet.unwrap().unwrap("Sheet"));
        const stations = $.let(root.registers.get("stations").members);
        // Three machines + two distinct families (the lathes fold).
        $(Assert.equal(stations.size(), 5n));
        $(Assert.equal(stations.get(0n).key, "M2140"));
        $(Assert.equal(stations.get(0n).meta.unwrap("some"), "CNC lathe"));
        $(Assert.equal(stations.get(0n).parent.unwrap("some"), "Line 2"));
        $(Assert.equal(stations.get(3n).kind, "family"));
        $(Assert.equal(stations.get(3n).key, "CNC lathe"));
        $(Assert.equal(stations.get(4n).key, "5-axis mill"));
        // A keyed register reads its key as the accessors' second argument.
        const st = $.let(root.registers.get("statuses").members);
        $(Assert.equal(st.get(0n).key, "COMPLETE"));
        $(Assert.equal(st.get(0n).tone.unwrap("some").hasTag("success"), true));
        // The driver.
        const driver = $.let(root.driver.unwrap("some"));
        $(Assert.equal(driver.column, "activity"));
        $(Assert.equal(driver.members.size(), 2n));
        $(Assert.equal(driver.members.get(1n).key, "Inspection"));
        $(Assert.equal(root.registers.get("activity").members.size(), 2n));
        $(Assert.equal(root.columns.get(0n).kind.unwrap("lookup").register, "activity"));
    });

    test("uom and sides accessors are reified against the driver row and land as per-driver-key dictionaries", $ => {
        const activities = $.const(ACTIVITIES, ArrayType(ActivityType));
        const rows = $.const([{ id: "1", start: none, activity: "Machining", qty: some(2.0), stations: { from: [], to: [] }, fromStations: [], toStations: [], machines: "", status: "", note: "" }], ArrayType(PlanRowType));
        const sheet = $.let(Sheet.Root(rows, {
            activity: Sheet.column.lookup(PlanRowType, { header: "Activity" }),
            qty:      Sheet.column.quantity(PlanRowType, ActivityType, { header: "Qty", uom: d => d.uom }),
            stations: Sheet.column.link(PlanRowType, ActivityType, "stations", {
                header: "Work centres",
                sides: { value: d => d.sides, locks: { from: { to: "external", in: "in place" }, to: { from: "external" } } },
            }),
        }, {
            id: "id",
            driver: Sheet.driver("activity", activities, { key: a => a.name, label: a => a.name }),
            registers: { stations: Sheet.register.members(East.value([], ArrayType(StringType)), { kind: "machine", key: s => s, label: s => s }) },
        }));
        const root = $.let(sheet.unwrap().unwrap("Sheet"));
        const uom = $.let(root.columns.get(1n).kind.unwrap("quantity").uom.unwrap("some"));
        $(Assert.equal(uom.get("Machining"), "pcs"));
        $(Assert.equal(uom.get("Inspection"), "lots"));
        const sides = $.let(root.columns.get(2n).kind.unwrap("link").sides.unwrap("some"));
        $(Assert.equal(sides.byDriver.get("Machining").hasTag("both"), true));
        $(Assert.equal(sides.byDriver.get("Inspection").hasTag("in"), true));
        $(Assert.equal(sides.locks.size(), 3n));
        $(Assert.equal(sides.locks.get(0n).half.hasTag("from"), true));
        $(Assert.equal(sides.locks.get(0n).when.hasTag("to"), true));
        $(Assert.equal(sides.locks.get(0n).label, "external"));
    });

    // =========================================================================
    // Links — the three storage forms and the grammar
    // =========================================================================

    test("a link column reads a Link field, two member-array fields, or a String field the grammar parses", $ => {
        const activities = $.const(ACTIVITIES, ArrayType(ActivityType));
        const members = $.const(MEMBERS, Sheet.Types.RegisterMembers);
        const rows = $.const([{
            id: "1", start: none, activity: "Machining", qty: none,
            stations: { from: [variant("identified", { key: "M2140" })], to: [variant("counted", { n: 4n, key: "CNC lathe" })] },
            fromStations: [variant("identified", { key: "M2141" })], toStations: [variant("placeholder", null)],
            machines: "m2140, the line 2 > 4 x lathe, M2140-45, TBC, mystery", status: "", note: "",
        }], ArrayType(PlanRowType));
        const sheet = $.let(Sheet.Root(rows, {
            activity:     Sheet.column.lookup(PlanRowType, { header: "Activity" }),
            stations:     Sheet.column.link(PlanRowType, ActivityType, "stations", { header: "Link field" }),
            fromStations: Sheet.column.link(PlanRowType, ActivityType, "stations", { header: "Two arrays", to: "toStations" }),
            machines:     Sheet.column.set(PlanRowType, "stations", { header: "String field" }),
        }, {
            id: "id",
            driver: Sheet.driver("activity", activities, { key: a => a.name, label: a => a.name }),
            registers: { stations: members },
        }));
        const cells = $.let(sheet.unwrap().unwrap("Sheet").rows.unwrap("inline").get(0n).cells);
        const direct = $.let(cells.get("stations").unwrap("Link"));
        $(Assert.equal(direct.from.get(0n).unwrap("identified").key, "M2140"));
        $(Assert.equal(direct.to.get(0n).unwrap("counted").n, 4n));
        const composed = $.let(cells.get("fromStations").unwrap("Link"));
        $(Assert.equal(composed.from.get(0n).unwrap("identified").key, "M2141"));
        $(Assert.equal(composed.to.get(0n).hasTag("placeholder"), true));
        const parsed = $.let(cells.get("machines").unwrap("Link"));
        // `m2140` resolves case-insensitively; `the line 2` through an alias; `4 x lathe` through the family's.
        $(Assert.equal(parsed.from.size(), 2n));
        $(Assert.equal(parsed.from.get(0n).unwrap("identified").key, "M2140"));
        $(Assert.equal(parsed.from.get(1n).unwrap("identified").key, "Line 2"));
        $(Assert.equal(parsed.to.size(), 4n));
        $(Assert.equal(parsed.to.get(0n).unwrap("counted").key, "CNC lathe"));
        $(Assert.equal(parsed.to.get(1n).unwrap("range").to, "M2145"));
        $(Assert.equal(parsed.to.get(2n).hasTag("placeholder"), true));
        $(Assert.equal(parsed.to.get(3n).unwrap("text"), "mystery"));
    });

    test("a String-backed link writes the keys as typed, or the register's labels under store canonical", $ => {
        const labelled = $.const([
            { key: "M2140", label: "Lathe 2140", kind: "machine", aliases: [], meta: none, parent: none, tone: none },
            { key: "CNC lathe", label: "CNC lathe", kind: "family", aliases: [], meta: none, parent: none, tone: none },
        ], Sheet.Types.RegisterMembers);
        const rows = $.const([{ id: "1", start: none, activity: "", qty: none, stations: { from: [], to: [] }, fromStations: [], toStations: [], machines: "", status: "", note: "" }], ArrayType(PlanRowType));
        const seen = $.const(East.function([ArrayType(PlanRowType)], NullType, ($2, next) => {
            $2(Assert.equal(next.get(0n).machines, "Lathe 2140 > 4 x CNC lathe"));
        }));
        const seenTyped = $.const(East.function([ArrayType(PlanRowType)], NullType, ($2, next) => {
            $2(Assert.equal(next.get(0n).machines, "M2140 > 4 x CNC lathe"));
        }));
        const canonical = $.let(Sheet.Root(rows, {
            machines: Sheet.column.set(PlanRowType, "stations", { header: "Machines", store: "canonical" }),
        }, { id: "id", registers: { stations: labelled }, onUpdate: seen }));
        const asTyped = $.let(Sheet.Root(rows, {
            machines: Sheet.column.set(PlanRowType, "stations", { header: "Machines" }),
        }, { id: "id", registers: { stations: labelled }, onUpdate: seenTyped }));
        const edit = $.const(East.value(variant("commit", {
            rowId: "1", offset: 0n, key: "machines", source: variant("typed", null),
            row: { id: "1", owned: false, cells: (new Map<string, unknown>([["machines", variant("Link", { from: [variant("identified", { key: "M2140" })], to: [variant("counted", { n: 4n, key: "CNC lathe" })] })]]) as never), lines: [], band: none },
        }) as never, Sheet.Types.WireEdit));
        $(canonical.unwrap().unwrap("Sheet").onEdit.unwrap("some")(edit));
        $(asTyped.unwrap().unwrap("Sheet").onEdit.unwrap("some")(edit));
    });

    test("Sheet.link.print and Sheet.link.parse round-trip the planner's text", $ => {
        const members = $.const(MEMBERS, Sheet.Types.RegisterMembers);
        const parse = $.const(Sheet.link.parse);
        const print = $.const(Sheet.link.print);
        const both = $.let(parse("M2140, Line 2 > 4 x CNC lathe", members));
        $(Assert.equal(print(both), "M2140, Line 2 > 4 x CNC lathe"));
        const destination = $.let(parse("CNC lathe x 3, tbc", members));
        $(Assert.equal(destination.from.size(), 0n));
        $(Assert.equal(destination.to.get(0n).unwrap("counted").n, 3n));
        $(Assert.equal(print(destination), "3 x CNC lathe, TBC"));
        const sourceOnly = $.let(parse("M2141 >", members));
        $(Assert.equal(sourceOnly.to.size(), 0n));
        $(Assert.equal(print(sourceOnly), "M2141 >"));
        $(Assert.equal(print(parse("", members)), ""));
    });

    // =========================================================================
    // The copilot — bridged providers and proposers
    // =========================================================================

    test("fill providers bridge by the function's type — sync and async — and see the real row", $ => {
        const rows = $.const(JOBS, ArrayType(JobType));
        const Ctx = Sheet.Types.Context(JobType);
        const Fill = OptionType(Sheet.Types.Fill(FloatType));
        // `owner` has no column and still reads its true value inside the rule.
        const byOwner = $.const(East.function([Ctx], Fill, ($, ctx) =>
            ctx.row.owner.equal("planner").ifElse(
                (_$) => East.value(some({ value: ctx.row.count.toFloat().multiply(1000.0), meta: East.str`row ${ctx.rowIndex} of ${ctx.rows.length()}` }), Fill),
                (_$) => East.value(none, Fill))));
        const remote = $.const(East.asyncFunction([Ctx], Fill, (_$, _ctx) => East.value(none, Fill)));
        const sheet = $.let(Sheet.Root(rows, {
            task: Sheet.column.text(JobType, { header: "Task" }),
            qty:  Sheet.column.quantity(JobType, { header: "Qty", fill: [byOwner, remote] }),
        }, { id: "id" }));
        const fills = $.let(sheet.unwrap().unwrap("Sheet").columns.get(1n).fill);
        $(Assert.equal(fills.size(), 2n));
        $(Assert.equal(fills.get(0n).hasTag("sync"), true));
        $(Assert.equal(fills.get(1n).hasTag("async"), true));
        // Run the wire provider against a wire context: the bridge decodes the
        // real row `a` (owner "planner", count 2) behind the cells.
        const wire = $.let(fills.get(0n).unwrap("sync"));
        const cells = $.const((new Map<string, unknown>([["task", variant("String", "Machining")], ["qty", variant("Null", null)]]) as never), DictType(StringType, Sheet.Types.Cell));
        const ctx = $.const({
            rowIndex: 0n, rowId: "a", offset: 0n, line: none, row: cells,
            rows: [{ id: "a", owned: false, cells, lines: [], band: none }], rowsOffset: 0n, partial: false, driver: none, today: new Date("2026-01-05T00:00:00Z"),
        }, Sheet.Types.WireContext);
        const fill = $.let(wire(ctx).unwrap("some"));
        $(Assert.equal(fill.value.unwrap("Float"), 2000.0));
        $(Assert.equal(fill.meta, "row 0 of 1"));
    });

    test("proposers bridge patches to cells — a set field crosses, an omitted field does not", $ => {
        const rows = $.const(JOBS, ArrayType(JobType));
        const Ctx = Sheet.Types.Context(JobType);
        const Proposals = ArrayType(Sheet.Types.Proposal(JobType));
        const followUp = $.const(East.function([Ctx], Proposals, ($, ctx) => $.const([
            { patch: Sheet.patch(JobType, { task: East.str`after ${ctx.row.task}`, count: 5n }), meta: "pattern" },
        ], Proposals)));
        const sheet = $.let(Sheet.Root(rows, {
            task:  Sheet.column.text(JobType, { header: "Task" }),
            qty:   Sheet.column.quantity(JobType, { header: "Qty" }),
            count: Sheet.column.integer(JobType, { header: "Count" }),
        }, { id: "id", suggest: { ahead: 1, triggers: ["task"], propose: [followUp] } }));
        const suggest = $.let(sheet.unwrap().unwrap("Sheet").suggest.unwrap("some"));
        $(Assert.equal(suggest.ahead, 1n));
        $(Assert.equal(suggest.triggers.get(0n), "task"));
        $(Assert.equal(suggest.ghost, true));
        const wire = $.let(suggest.propose.get(0n).unwrap("sync"));
        const cells = $.const((new Map<string, unknown>([["task", variant("String", "Machining")], ["qty", variant("Float", 1.0)], ["count", variant("Integer", 2n)]]) as never), DictType(StringType, Sheet.Types.Cell));
        const ctx = $.const({
            rowIndex: 0n, rowId: "a", offset: 0n, line: none, row: cells,
            rows: [{ id: "a", owned: false, cells, lines: [], band: none }], rowsOffset: 0n, partial: false, driver: none, today: new Date("2026-01-05T00:00:00Z"),
        }, Sheet.Types.WireContext);
        const proposals = $.let(wire(ctx));
        $(Assert.equal(proposals.size(), 1n));
        $(Assert.equal(proposals.get(0n).meta, "pattern"));
        $(Assert.equal(proposals.get(0n).cells.get("task").unwrap("String"), "after Machining"));
        $(Assert.equal(proposals.get(0n).cells.get("count").unwrap("Integer"), 5n));
        $(Assert.equal(proposals.get(0n).cells.has("qty"), false));
    });

    // =========================================================================
    // Write-back — the onUpdate rebuild and the typed onEdit
    // =========================================================================

    test("onUpdate compiles to the edit channel: a commit rewrites one field, an insert appends, a remove filters", $ => {
        const rows = $.const(JOBS, ArrayType(JobType));
        const seen = $.const(East.function([ArrayType(JobType)], NullType, ($, next) => {
            // Three edits arrive in order: commit (2 rows, a's task changed, owner kept),
            // insert (3 rows), remove (1 row).
            $.if(next.size().equal(2n), ($2) => {
                $2(Assert.equal(next.get(0n).task, "Painting"));
                $2(Assert.equal(next.get(0n).owner, "planner"));
                $2(Assert.equal(next.get(0n).qty.unwrap("some"), 1200.0));
            });
            $.if(next.size().equal(3n), ($2) => {
                $2(Assert.equal(next.get(1n).id, "c"));
                $2(Assert.equal(next.get(1n).task, "new"));
                $2(Assert.equal(next.get(1n).count, 0n));
                $2(Assert.equal(next.get(2n).id, "b"));
            });
            $.if(next.size().equal(1n), ($2) => {
                $2(Assert.equal(next.get(0n).id, "b"));
            });
        }));
        const sheet = $.let(Sheet.Root(rows, {
            task: Sheet.column.text(JobType, { header: "Task" }),
            qty:  Sheet.column.quantity(JobType, { header: "Qty" }),
        }, { id: "id", onUpdate: seen }));
        const handler = $.let(sheet.unwrap().unwrap("Sheet").onEdit.unwrap("some"));
        const typed = $.const(variant("typed", null), Sheet.Types.Source);
        $(handler(East.value(variant("commit", {
            rowId: "a", offset: 0n, key: "task", source: typed,
            row: { id: "a", owned: false, cells: (new Map<string, unknown>([["task", variant("String", "Painting")], ["qty", variant("Float", 1200.0)]]) as never), lines: [], band: none },
        }) as never, Sheet.Types.WireEdit)));
        $(handler(East.value(variant("insert", {
            afterRowId: some("a"), source: typed,
            row: { id: "c", owned: false, cells: (new Map<string, unknown>([["task", variant("String", "new")], ["qty", variant("Null", null)]]) as never), lines: [], band: none },
        }) as never, Sheet.Types.WireEdit)));
        $(handler(East.value(variant("remove", { rowIds: ["a"] }) as never, Sheet.Types.WireEdit)));
    });

    test("a typed onEdit receives the row decoded over the real row; with onUpdate too, it observes first", $ => {
        const rows = $.const(JOBS, ArrayType(JobType));
        const observed = $.const(East.function([Sheet.Types.Edit(JobType)], NullType, ($, e) => {
            $(e.match({
                commit: (_$, c) => Assert.equal(East.str`${c.rowId}·${c.key}·${c.row.task}·${c.row.owner}`, "a·task·Packaging·planner"),
                insert: (_$, i) => Assert.equal(i.row.id, "never"),
                remove: (_$, r) => Assert.equal(r.rowIds.size(), 99n),
            }));
        }));
        const written = $.const(East.function([ArrayType(JobType)], NullType, ($, next) => {
            $(Assert.equal(next.get(0n).task, "Packaging"));
        }));
        const sheet = $.let(Sheet.Root(rows, {
            task: Sheet.column.text(JobType, { header: "Task" }),
        }, { id: "id", onEdit: observed, onUpdate: written }));
        const handler = $.let(sheet.unwrap().unwrap("Sheet").onEdit.unwrap("some"));
        $(handler(East.value(variant("commit", {
            rowId: "a", offset: 0n, key: "task", source: variant("fill", null),
            row: { id: "a", owned: false, cells: (new Map<string, unknown>([["task", variant("String", "Packaging")]]) as never), lines: [], band: none },
        }) as never, Sheet.Types.WireEdit)));
    });

    // =========================================================================
    // Options round-trip
    // =========================================================================

    test("selection, views, footer, blanks, density, readOnly and style round-trip", $ => {
        const rows = $.const(JOBS, ArrayType(JobType));
        const onSelect = East.function([Sheet.Types.Selection], NullType, (_$, _s) => null);
        const sheet = $.let(Sheet.Root(rows, {
            task: Sheet.column.text(JobType, { header: "Task", sub: "free text", width: "200px" }),
        }, {
            id: "id",
            onSelect,
            selection: some({ rowId: some("a"), key: some("task") }),
            views: [{ id: "v1", name: "ALL", narrowing: { range: none, compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(), breakdown: none, search: none, visible: none, selectedIndex: none, resolution: none }, context: 1n, reveals: [] }],
            activeView: some("v1"),
            footer: [{ text: "2 planned", tone: "info" }],
            blanks: 6,
            density: "compact",
            readOnly: true,
            style: { height: "fill", gutterWidth: "64px" },
        }));
        const root = $.let(sheet.unwrap().unwrap("Sheet"));
        $(Assert.equal(root.columns.get(0n).sub.unwrap("some"), "free text"));
        $(Assert.equal(root.columns.get(0n).width.unwrap("some"), "200px"));
        $(Assert.equal(root.onSelect.hasTag("some"), true));
        $(Assert.equal(root.selection.unwrap("some").rowId.unwrap("some"), "a"));
        $(Assert.equal(root.views.size(), 1n));
        $(Assert.equal(root.views.get(0n).context, 1n));
        $(Assert.equal(root.activeView.unwrap("some"), "v1"));
        $(Assert.equal(root.footer.get(0n).text, "2 planned"));
        $(Assert.equal(root.footer.get(0n).tone.unwrap("some").hasTag("info"), true));
        $(Assert.equal(root.blanks.unwrap("some"), 6n));
        $(Assert.equal(root.density.unwrap("some").hasTag("compact"), true));
        $(Assert.equal(root.readOnly.unwrap("some"), true));
        $(Assert.equal(root.style.unwrap("some").height.unwrap("some"), "fill"));
        $(Assert.equal(root.style.unwrap("some").gutterWidth.unwrap("some"), "64px"));
        $(Assert.equal(root.slice.hasTag("none"), true));
        $(Assert.equal(root.suggest.hasTag("none"), true));
    });

    // =========================================================================
    // Build-time refusals (§3.12) — every one names the column and the remedy
    // =========================================================================

    test("Sheet.Types are accessible", $ => {
        const link = $.const({ from: [], to: [variant("placeholder", null)] }, Sheet.Types.Link);
        $(Assert.equal(link.to.size(), 1n));
        const sel = $.const({ rowId: none, key: none }, Sheet.Types.Selection);
        $(Assert.equal(sel.rowId.hasTag("none"), true));
        const patch = $.const(Sheet.patch(JobType, { task: "x" }));
        $(Assert.equal(patch.task.unwrap("some"), "x"));
        $(Assert.equal(patch.qty.hasTag("none"), true));
        // A flat row carries no lines and no band.
        const jobs = $.const(JOBS, ArrayType(JobType));
        const flat = $.let(Sheet.Root(jobs, { task: Sheet.column.text(JobType) }, { id: "id" }).unwrap().unwrap("Sheet"));
        $(Assert.equal(flat.rows.unwrap("inline").get(0n).lines.size(), 0n));
        $(Assert.equal(flat.rows.unwrap("inline").get(0n).band.hasTag("none"), true));
        $(Assert.equal(flat.group.hasTag("none"), true));
    });

    // =========================================================================
    // Grouped rows (#740) — the group is the row, its lines in one field
    // =========================================================================

    test("grouped rows: a group row carries the band's cells under the line columns, its lines keyed by index, and the band", $ => {
        const plans = $.const(PLANS, ArrayType(PlanType));
        const sheet = $.let(Sheet.Root(plans, {
            start: Sheet.column.date(LineType, { header: "Start" }),
            task:  Sheet.column.text(LineType, { header: "Task" }),
            qty:   Sheet.column.quantity(LineType, { header: "Qty" }),
            note:  Sheet.column.text(LineType, { header: "Note" }),
        }, {
            id: "id",
            owned: p => p.owner.equal("erp"),
            group: Sheet.group(PlanType, "lines", {
                title: "name",
                sub:   p => East.str`${p.owner} · ${p.status}`,
                cells: {
                    qty:  Sheet.group.cell.quantity(PlanType, "total", { editable: false }),
                    note: Sheet.group.cell.text(PlanType, "status"),
                    task: Sheet.group.cell.text(PlanType, "id", { value: p => East.str`${p.lines.length()} lines` }),
                },
                folded: p => p.status.equal("COMPLETE"),
            }),
        }));
        const root = $.let(sheet.unwrap().unwrap("Sheet"));
        const inline = $.let(root.rows.unwrap("inline"));
        $(Assert.equal(inline.size(), 2n));
        const p1 = $.let(inline.get(0n));
        $(Assert.equal(p1.id, "p1"));
        $(Assert.equal(p1.owned, false));
        $(Assert.equal(inline.get(1n).owned, true));
        // The band's cells: the title under `$title`, each declared cell under its line column, nothing under the rest.
        $(Assert.equal(p1.cells.get("$title").unwrap("String"), "Line 2 week 8"));
        $(Assert.equal(p1.cells.get("qty").unwrap("Float"), 300.0));
        $(Assert.equal(p1.cells.get("note").unwrap("String"), "PLANNED"));
        $(Assert.equal(p1.cells.get("task").unwrap("String"), "2 lines"));
        $(Assert.equal(p1.cells.has("start"), false));
        // The lines: keyed by index, each the line columns' projection.
        $(Assert.equal(p1.lines.size(), 2n));
        $(Assert.equal(p1.lines.get(0n).key, "0"));
        $(Assert.equal(p1.lines.get(1n).key, "1"));
        $(Assert.equal(p1.lines.get(0n).cells.get("task").unwrap("String"), "Machining"));
        $(Assert.equal(p1.lines.get(0n).cells.get("qty").unwrap("Float"), 120.0));
        $(Assert.equal(p1.lines.get(0n).cells.get("start").hasTag("DateTime"), true));
        $(Assert.equal(p1.lines.get(1n).cells.get("qty").hasTag("Null"), true));
        $(Assert.equal(inline.get(1n).lines.size(), 0n));
        // The band.
        $(Assert.equal(p1.band.unwrap("some").sub, "planner · PLANNED"));
        $(Assert.equal(p1.band.unwrap("some").folded, false));
        $(Assert.equal(inline.get(1n).band.unwrap("some").folded, true));
        // The declaration on the wire: the title first, then the cells in declaration order.
        const group = $.let(root.group.unwrap("some"));
        $(Assert.equal(group.lines, "lines"));
        $(Assert.equal(group.keyed, false));
        $(Assert.equal(group.cells.size(), 4n));
        $(Assert.equal(group.cells.get(0n).key, "$title"));
        $(Assert.equal(group.cells.get(0n).field, "name"));
        $(Assert.equal(group.cells.get(0n).kind.hasTag("text"), true));
        $(Assert.equal(group.cells.get(0n).editable, true));
        $(Assert.equal(group.cells.get(1n).key, "qty"));
        $(Assert.equal(group.cells.get(1n).field, "total"));
        $(Assert.equal(group.cells.get(1n).kind.hasTag("quantity"), true));
        $(Assert.equal(group.cells.get(1n).editable, false));
        $(Assert.equal(group.cells.get(2n).editable, true));
        $(Assert.equal(group.cells.get(3n).editable, false));
        // The columns are the LINE columns.
        $(Assert.equal(root.columns.size(), 4n));
        $(Assert.equal(root.columns.get(0n).key, "start"));
        $(Assert.equal(root.newLineKey.hasTag("none"), true));
    });

    test("grouped rows over Dict lines key each line by its dictionary key, in key order", $ => {
        const plans = $.const([{ id: "k1", name: "Keyed", lines: new Map([
            ["b", { start: none, task: "Second", qty: none, note: "" }],
            ["a", { start: none, task: "First", qty: none, note: "" }],
        ]) }], ArrayType(KeyedPlanType));
        const mint = East.function([], StringType, (_$) => "minted");
        const sheet = $.let(Sheet.Root(plans, {
            task: Sheet.column.text(LineType, { header: "Task" }),
        }, { id: "id", group: Sheet.group(KeyedPlanType, "lines", { title: "name" }), newLineKey: mint }));
        const root = $.let(sheet.unwrap().unwrap("Sheet"));
        const row = $.let(root.rows.unwrap("inline").get(0n));
        $(Assert.equal(root.group.unwrap("some").keyed, true));
        $(Assert.equal(row.lines.size(), 2n));
        $(Assert.equal(row.lines.get(0n).key, "a"));
        $(Assert.equal(row.lines.get(0n).cells.get("task").unwrap("String"), "First"));
        $(Assert.equal(row.lines.get(1n).key, "b"));
        $(Assert.equal(row.band.unwrap("some").sub, ""));
        $(Assert.equal(root.newLineKey.unwrap("some")(), "minted"));
    });

    test("grouped onUpdate rebuilds the groups: the line arms rewrite one group through its lines, the row arms are the group's", $ => {
        const plans = $.const(PLANS, ArrayType(PlanType));
        const seen = $.const(East.function([ArrayType(PlanType)], NullType, ($2, next) => {
            const p1 = $2.let(next.get(0n), PlanType);
            const two = $2.let(next.size().equal(2n), BooleanType);
            // lineCommit: line 1's task changed; its note (no cell sent for it? — sent) and the group's owner (no cell) keep their values.
            $2.if(two.and(() => p1.lines.size().equal(2n)).and(() => p1.name.equal("Renamed").not()), ($3) => {
                $3(Assert.equal(p1.lines.get(1n).task, "Painting"));
                $3(Assert.equal(p1.lines.get(1n).note, "second"));
                $3(Assert.equal(p1.lines.get(0n).qty.unwrap("some"), 120.0));
                $3(Assert.equal(p1.owner, "planner"));
                $3(Assert.equal(p1.total, 300.0));
            });
            // lineInsert: the new line sits at position 1; the line that moved to position 2 keeps its base (key "1").
            $2.if(two.and(() => p1.lines.size().equal(3n)), ($3) => {
                $3(Assert.equal(p1.lines.get(1n).task, "Between"));
                $3(Assert.equal(p1.lines.get(1n).note, ""));
                $3(Assert.equal(p1.lines.get(2n).task, "Inspection"));
                $3(Assert.equal(p1.lines.get(2n).note, "second"));
            });
            // lineRemove: one line left.
            $2.if(two.and(() => p1.lines.size().equal(1n)), ($3) => {
                $3(Assert.equal(p1.lines.get(0n).task, "Machining"));
            });
            // A band commit: the title renamed; the read-only quantity cell ignored; the lines kept.
            $2.if(two.and(() => p1.name.equal("Renamed")), ($3) => {
                $3(Assert.equal(p1.total, 300.0));
                $3(Assert.equal(p1.status, "PLANNED"));
                $3(Assert.equal(p1.lines.size(), 2n));
            });
            // A group inserted at the end, with no lines and default fields.
            $2.if(next.size().equal(3n), ($3) => {
                $3(Assert.equal(next.get(2n).id, "p3"));
                $3(Assert.equal(next.get(2n).name, "New plan"));
                $3(Assert.equal(next.get(2n).lines.size(), 0n));
                $3(Assert.equal(next.get(2n).owner, ""));
            });
            $2.if(next.size().equal(1n), ($3) => {
                $3(Assert.equal(next.get(0n).id, "p2"));
            });
        }));
        const sheet = $.let(Sheet.Root(plans, {
            task: Sheet.column.text(LineType, { header: "Task" }),
            qty:  Sheet.column.quantity(LineType, { header: "Qty" }),
            note: Sheet.column.text(LineType, { header: "Note" }),
        }, {
            id: "id",
            group: Sheet.group(PlanType, "lines", {
                title: "name",
                cells: { qty: Sheet.group.cell.quantity(PlanType, "total", { editable: false }), note: Sheet.group.cell.text(PlanType, "status") },
            }),
            onUpdate: seen,
        }));
        const handler = $.let(sheet.unwrap().unwrap("Sheet").onEdit.unwrap("some"));
        const typed = $.const(variant("typed", null), Sheet.Types.Source);
        $(handler(East.value(variant("lineCommit", { rowId: "p1", offset: 0n, line: "1", key: "task", source: typed, row: P1_PAINTED }) as never, Sheet.Types.WireEdit)));
        $(handler(East.value(variant("lineInsert", { rowId: "p1", offset: 0n, after: some("0"), line: "1", source: typed, row: P1_INSERTED }) as never, Sheet.Types.WireEdit)));
        $(handler(East.value(variant("lineRemove", { rowId: "p1", offset: 0n, lines: ["1"], row: P1_REMOVED }) as never, Sheet.Types.WireEdit)));
        $(handler(East.value(variant("commit", { rowId: "p1", offset: 0n, key: "$title", source: typed, row: P1_RENAMED }) as never, Sheet.Types.WireEdit)));
        $(handler(East.value(variant("insert", { afterRowId: none, source: typed, row: P3_ROW }) as never, Sheet.Types.WireEdit)));
        $(handler(East.value(variant("remove", { rowIds: ["p1"] }) as never, Sheet.Types.WireEdit)));
    });

    test("a grouped onEdit receives the line's address as an index and the group decoded over the source", $ => {
        const plans = $.const(PLANS, ArrayType(PlanType));
        const observed = $.const(East.function([Sheet.Types.Edit(PlanType, "lines")], NullType, ($2, e) => {
            $2(e.match({
                commit:      (_$, c) => Assert.equal(East.str`${c.rowId}·${c.line}·${c.key}·${c.row.lines.get(c.line).task}·${c.row.owner}`, "p1·1·task·Painting·planner"),
                insert:      (_$, i) => Assert.equal(East.str`${i.after.unwrap("some")}·${i.line}·${i.row.lines.size()}`, "0·1·3"),
                remove:      (_$, r) => Assert.equal(r.lines.get(0n), 1n),
                groupCommit: (_$, g) => Assert.equal(East.str`${g.key}·${g.row.name}·${g.row.total}`, "$title·Renamed·300.0"),
                groupInsert: (_$, g) => Assert.equal(East.str`${g.row.id}·${g.row.lines.size()}`, "p3·0"),
                groupRemove: (_$, g) => Assert.equal(g.rowIds.get(0n), "p1"),
            }));
        }));
        const sheet = $.let(Sheet.Root(plans, {
            task: Sheet.column.text(LineType, { header: "Task" }),
            qty:  Sheet.column.quantity(LineType, { header: "Qty" }),
        }, {
            id: "id",
            group: Sheet.group(PlanType, "lines", { title: "name", cells: { qty: Sheet.group.cell.quantity(PlanType, "total", { editable: false }) } }),
            onEdit: observed,
        }));
        const handler = $.let(sheet.unwrap().unwrap("Sheet").onEdit.unwrap("some"));
        const typed = $.const(variant("typed", null), Sheet.Types.Source);
        $(handler(East.value(variant("lineCommit", { rowId: "p1", offset: 0n, line: "1", key: "task", source: typed, row: P1_PAINTED }) as never, Sheet.Types.WireEdit)));
        $(handler(East.value(variant("lineInsert", { rowId: "p1", offset: 0n, after: some("0"), line: "1", source: typed, row: P1_INSERTED }) as never, Sheet.Types.WireEdit)));
        $(handler(East.value(variant("lineRemove", { rowId: "p1", offset: 0n, lines: ["1"], row: P1_REMOVED }) as never, Sheet.Types.WireEdit)));
        $(handler(East.value(variant("commit", { rowId: "p1", offset: 0n, key: "$title", source: typed, row: P1_RENAMED }) as never, Sheet.Types.WireEdit)));
        $(handler(East.value(variant("insert", { afterRowId: none, source: typed, row: P3_ROW }) as never, Sheet.Types.WireEdit)));
        $(handler(East.value(variant("remove", { rowIds: ["p1"] }) as never, Sheet.Types.WireEdit)));
    });

    test("a grouped provider sees the line as it would be, its group's lines, the group and the resident groups", $ => {
        const plans = $.const(PLANS, ArrayType(PlanType));
        const Ctx = Sheet.Types.Context(PlanType, "lines");
        const Fill = OptionType(Sheet.Types.Fill(StringType));
        const fromGroup = $.const(East.function([Ctx], Fill, (_$, ctx) =>
            East.value(some({
                value: East.str`${ctx.group.name} · line ${ctx.rowIndex} ${ctx.row.task} · ${ctx.rows.length()} lines · ${ctx.groups.length()} plans · ${ctx.row.note}`,
                meta: "group",
            }), Fill)));
        const sheet = $.let(Sheet.Root(plans, {
            task: Sheet.column.text(LineType, { header: "Task" }),
            note: Sheet.column.text(LineType, { header: "Note", fill: [fromGroup] }),
        }, { id: "id", group: Sheet.group(PlanType, "lines", { title: "name" }) }));
        const wire = $.let(sheet.unwrap().unwrap("Sheet").columns.get(1n).fill.get(0n).unwrap("sync"));
        // The editor on p1's line 1 typed "Painting"; `note` (this column) sends no cell, so the source line's note comes through the base.
        const editing = $.const(EDITING_CELLS, DictType(StringType, Sheet.Types.Cell));
        const ctx = $.const({
            rowIndex: 1n, rowId: "p1", offset: 0n, line: some("1"), row: editing,
            rows: [P1_ROW, P2_ROW], rowsOffset: 0n, partial: false, driver: none, today: new Date("2026-01-05T00:00:00Z"),
        }, Sheet.Types.WireContext);
        $(Assert.equal(wire(ctx).unwrap("some").value.unwrap("String"), "Line 2 week 8 · line 1 Painting · 2 lines · 2 plans · second"));
        // A line the group does not hold yet (the blank line): decoded over the default line, appended to the group's lines.
        const fresh = $.const({
            rowIndex: 2n, rowId: "p1", offset: 0n, line: some("new"), row: editing,
            rows: [P1_ROW, P2_ROW], rowsOffset: 0n, partial: false, driver: none, today: new Date("2026-01-05T00:00:00Z"),
        }, Sheet.Types.WireContext);
        $(Assert.equal(wire(fresh).unwrap("some").value.unwrap("String"), "Line 2 week 8 · line 2 Painting · 3 lines · 2 plans · "));
    });
}, { platformFns: TestImpl });

// ============================================================================
// Build-time refusals (§3.12) — authoring-time throws, asserted as plain host
// tests: every one names the column and the remedy.
// ============================================================================

describe("Sheet refusals", () => {
    const rows = East.value(JOBS, ArrayType(JobType));
    const noop = East.function([ArrayType(JobType)], NullType, () => null);

    hostTest("a Dict inline is refused — rows would sit in key order", () => {
        const keyed = East.value(new Map([["a", JOBS[0]!]]), DictType(StringType, JobType));
        assert.throws(() => Sheet.Root(keyed as never, { task: Sheet.column.text(JobType) } as never, { id: "id" } as never), /key order/);
    });
    hostTest("a kind under the wrong field names the column", () => {
        assert.throws(() => Sheet.Root(rows, { task: Sheet.column.date(JobType) as never }, { id: "id" }), /date column "task"/);
    });
    hostTest("onUpdate on a paged source is refused", () => {
        assert.throws(() => Sheet.Root(Paged.of("p", rows, { key: r => r.id }), { task: Sheet.column.text(JobType) }, { id: "id", onUpdate: noop }), /onUpdate/);
    });
    hostTest("an undeclared register is refused", () => {
        assert.throws(() => Sheet.Root(rows, { task: Sheet.column.reference(JobType, "sites") }, { id: "id" }), /register "sites"/);
    });
    hostTest("a lookup column that is not the driver is refused", () => {
        assert.throws(() => Sheet.Root(rows, { task: Sheet.column.lookup(JobType) }, { id: "id" }), /driver column/);
    });
    hostTest("an axis affordance is refused", () => {
        assert.throws(() => Sheet.Root(rows, { task: Sheet.column.text(JobType) }, { id: "id", affordances: ["brush"] }), /brush/);
    });
    hostTest("a provider over another row type is refused by its East input type", () => {
        const Other = StructType({ id: StringType, task: StringType });
        const foreign = East.function([Sheet.Types.Context(Other)], OptionType(Sheet.Types.Fill(StringType)), (_$, _ctx) => East.value(none, OptionType(Sheet.Types.Fill(StringType))));
        assert.throws(() => Sheet.Root(rows, { task: Sheet.column.text(JobType, { fill: [foreign as never] }) }, { id: "id" }), /fill provider #1/);
    });
    hostTest("a provider with the wrong payload is refused", () => {
        const wrongPayload = East.function([Sheet.Types.Context(JobType)], OptionType(Sheet.Types.Fill(FloatType)), (_$, _ctx) => East.value(none, OptionType(Sheet.Types.Fill(FloatType))));
        assert.throws(() => Sheet.Root(rows, { task: Sheet.column.text(JobType, { fill: [wrongPayload as never] }) }, { id: "id" }), /wrong type/);
    });
    hostTest("a positional source without an id is refused", () => {
        assert.throws(() => Sheet.Root(rows, { task: Sheet.column.text(JobType) }, {} as never), /`id` is required/);
    });
    hostTest("a column built over another row type is refused", () => {
        const Other = StructType({ id: StringType, task: StringType });
        assert.throws(() => Sheet.Root(rows, { task: Sheet.column.text(Other) as never }, { id: "id" }), /different row type/);
    });

    // Grouped rows (#740).
    const plans = East.value(PLANS, ArrayType(PlanType));
    const lineColumns = { task: Sheet.column.text(LineType) };
    hostTest("columns over the group's row type are refused — columns are declared over the line type", () => {
        assert.throws(() => Sheet.Root(plans, { name: Sheet.column.text(PlanType) } as never, { id: "id", group: Sheet.group(PlanType, "lines", { title: "name" }) } as never), /declared over the line type `lines` holds/);
    });
    hostTest("a lines field that is not an Array or Dict of structs is refused", () => {
        assert.throws(() => Sheet.Root(plans, lineColumns, { id: "id", group: Sheet.group(PlanType, "owner" as never, { title: "name" }) } as never), /Array<Line> or a Dict<String, Line>/);
        assert.throws(() => Sheet.Root(plans, lineColumns, { id: "id", group: Sheet.group(PlanType, "nope" as never, { title: "name" }) } as never), /not a field of the row type/);
    });
    hostTest("a group built over another row type is refused", () => {
        assert.throws(() => Sheet.Root(plans, lineColumns, { id: "id", group: Sheet.group(KeyedPlanType, "lines", { title: "name" }) } as never), /different row type/);
    });
    hostTest("a title that is not a String field is refused", () => {
        assert.throws(() => Sheet.Root(plans, lineColumns, { id: "id", group: Sheet.group(PlanType, "lines", { title: "total" as never }) }), /`group.title` must name a String field/);
    });
    hostTest("a band cell under an undeclared column, or with another payload than its column, is refused", () => {
        assert.throws(() => Sheet.Root(plans, lineColumns, { id: "id", group: Sheet.group(PlanType, "lines", { title: "name", cells: { owner: Sheet.group.cell.text(PlanType, "owner") } as never }) }), /band cell "owner" is not a declared column/);
        assert.throws(() => Sheet.Root(plans, lineColumns, { id: "id", group: Sheet.group(PlanType, "lines", { title: "name", cells: { task: Sheet.group.cell.quantity(PlanType, "total") } }) }), /band cell "task" is a quantity cell/);
        assert.throws(() => Sheet.Root(plans, lineColumns, { id: "id", group: Sheet.group(PlanType, "lines", { title: "name", cells: { task: Sheet.group.cell.date(PlanType, "owner" as never) } }) }), /band cell "task" — date column "owner"/);
    });
    hostTest("a grouped provider must take the grouped context", () => {
        const flat = East.function([Sheet.Types.Context(LineType)], OptionType(Sheet.Types.Fill(StringType)), (_$, _ctx) => East.value(none, OptionType(Sheet.Types.Fill(StringType))));
        assert.throws(() => Sheet.Root(plans, { task: Sheet.column.text(LineType, { fill: [flat] }) }, { id: "id", group: Sheet.group(PlanType, "lines", { title: "name" }) }), /Sheet\.Types\.Context\(GroupType, "lines"\)/);
    });
});
