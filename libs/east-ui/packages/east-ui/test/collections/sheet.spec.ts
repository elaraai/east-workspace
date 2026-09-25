/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, test as hostTest } from "node:test";
import assert from "node:assert/strict";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Sheet, Paged, UIComponentType } from "@elaraai/east-ui/internal";
import {
    East, ArrayType, DateTimeType, DictType, FloatType, IntegerType, NullType, OptionType, StringType, StructType, VariantType,
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
const LINE_0 = { key: "0", cells: new Map<string, unknown>([["start", variant("Null", null)], ["task", variant("String", "Machining")], ["qty", variant("Float", 120.0)], ["note", variant("String", "first")]]) as never, subRows: [] };
const LINE_1 = { key: "1", cells: new Map<string, unknown>([["start", variant("Null", null)], ["task", variant("String", "Inspection")], ["qty", variant("Null", null)], ["note", variant("String", "second")]]) as never, subRows: [] };
const LINE_1_PAINTED = { key: "1", cells: new Map<string, unknown>([["start", variant("Null", null)], ["task", variant("String", "Painting")], ["qty", variant("Null", null)], ["note", variant("String", "second")]]) as never, subRows: [] };
const LINE_NEW = { key: "new", cells: new Map<string, unknown>([["start", variant("Null", null)], ["task", variant("String", "Between")], ["qty", variant("Null", null)], ["note", variant("String", "")]]) as never, subRows: [] };
const P1_CELLS = new Map<string, unknown>([["$title", variant("String", "Line 2 week 8")], ["qty", variant("Float", 300.0)], ["note", variant("String", "PLANNED")]]) as never;
const BAND = some({ sub: "", folded: false });
const P1_ROW = { id: "p1", owned: false, cells: P1_CELLS, lines: [LINE_0, LINE_1], band: BAND, subRows: [] };
const P1_PAINTED = { id: "p1", owned: false, cells: P1_CELLS, lines: [LINE_0, LINE_1_PAINTED], band: BAND, subRows: [] };
const P1_INSERTED = { id: "p1", owned: false, cells: P1_CELLS, lines: [LINE_0, LINE_NEW, LINE_1], band: BAND, subRows: [] };
const P1_REMOVED = { id: "p1", owned: false, cells: P1_CELLS, lines: [LINE_0], band: BAND, subRows: [] };
const P1_RENAMED = { id: "p1", owned: false, cells: new Map<string, unknown>([["$title", variant("String", "Renamed")], ["qty", variant("Float", 999.0)], ["note", variant("String", "PLANNED")]]) as never, lines: [LINE_0, LINE_1], band: BAND, subRows: [] };
const P2_ROW = { id: "p2", owned: false, cells: new Map<string, unknown>([["$title", variant("String", "Line 3 week 8")]]) as never, lines: [], band: BAND, subRows: [] };
const P3_ROW = { id: "p3", owned: false, cells: new Map<string, unknown>([["$title", variant("String", "New plan")]]) as never, lines: [], band: BAND, subRows: [] };
const EDITING_CELLS = new Map<string, unknown>([["task", variant("String", "Painting")]]) as never;

// ── Sub rows and column rules (#844).
const OpType = StructType({ id: StringType, code: StringType, name: StringType, materials: ArrayType(StringType), station: OptionType(StringType) });
const BookingType = VariantType({ labour: StructType({ team: StringType, people: IntegerType }), equipment: StructType({ resource: StringType }) });
const WorkType = StructType({ task: StringType, ops: ArrayType(OpType), bookings: ArrayType(BookingType) });
const OrderType = StructType({ id: StringType, name: StringType, work: ArrayType(WorkType) });
const ORDERS = [
    { id: "o1", name: "Frames", work: [
        { task: "Assemble", ops: [
            { id: "o1-1", code: "CUT", name: "Cut rails", materials: ["Rail × 8"], station: some("Saw 2") },
            { id: "o1-2", code: "", name: "Fit", materials: [], station: none },
        ], bookings: [variant("labour", { team: "Assembly", people: 2n }), variant("equipment", { resource: "Driver" })] },
        { task: "Inspect", ops: [], bookings: [] },
    ] },
];
const FlatWorkType = StructType({ id: StringType, task: StringType, ops: ArrayType(OpType) });
const RuleRowType = StructType({
    id: StringType, start: OptionType(DateTimeType), level: Sheet.Types.DateLevel, started: OptionType(DateTimeType),
    status: StringType, code: StringType, activity: StringType, stations: Sheet.Types.Link,
});
const RULE_ROWS = [
    { id: "r1", start: some(new Date("2026-02-16T00:00:00Z")), level: variant("week", null), started: some(new Date("2026-02-17T07:30:00Z")), status: "PLANNED", code: "WO-1", activity: "Machining", stations: { from: [], to: [] } },
    { id: "r2", start: none, level: variant("time", null), started: none, status: "RELEASED", code: "", activity: "Machining", stations: { from: [], to: [] } },
];

describeEast("Sheet", (test) => {
    Assert.examples(test, {
        sheetBasic: ex.sheetBasic,
        sheetVariants: ex.sheetVariants,
        sheetPlan: ex.sheetPlan,
        sheetCopilot: ex.sheetCopilot,
        sheetLens: ex.sheetLens,
        sheetWriteBack: ex.sheetWriteBack,
        sheetGrouped: ex.sheetGrouped,
        sheetReadiness: ex.sheetReadiness,
        sheetInsertion: ex.sheetInsertion,
        sheetPaged: ex.sheetPaged,
        sheetSubRows: ex.sheetSubRows,
        sheetRules: ex.sheetRules,
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
        const canonical = $.let(Sheet.Root(rows, {
            machines: Sheet.column.set(PlanRowType, "stations", { header: "Machines", store: "canonical" }),
        }, { id: "id", registers: { stations: labelled } }));
        const asTyped = $.let(Sheet.Root(rows, {
            machines: Sheet.column.set(PlanRowType, "stations", { header: "Machines" }),
        }, { id: "id", registers: { stations: labelled } }));
        const row = $.const({
            id: "1", owned: false,
            cells: new Map([["machines", variant("Link", { from: [variant("identified", { key: "M2140" })], to: [variant("counted", { n: 4n, key: "CNC lathe" })] })]]),
            lines: [], band: none, subRows: [],
        }, Sheet.Types.Row);
        const bytes = $.const(East.Blob.encodeBeast(row, "v2"));
        const canonicalDraft = $.const(canonical.unwrap().unwrap("Sheet").editing.decode(bytes, none, none).decodeBeast(Sheet.Types.Draft(PlanRowType), "v2"));
        const typedDraft = $.const(asTyped.unwrap().unwrap("Sheet").editing.decode(bytes, none, none).decodeBeast(Sheet.Types.Draft(PlanRowType), "v2"));
        $(Assert.equal(canonicalDraft.machines.unwrap("value"), "Lathe 2140 > 4 x CNC lathe"));
        $(Assert.equal(typedDraft.machines.unwrap("value"), "M2140 > 4 x CNC lathe"));
        $(Assert.equal(typedDraft.status.hasTag("missing"), true));
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
        const Ctx = Sheet.Types.DraftContext(JobType);
        const Fill = OptionType(Sheet.Types.Fill(FloatType));
        // `owner` has no column and still reads its true value inside the rule.
        const byOwner = $.const(East.function([Ctx], Fill, ($, ctx) =>
            ctx.row.owner.hasTag("value").and(() => ctx.row.count.hasTag("value")).ifElse(() => ctx.row.owner.unwrap("value").equal("planner"), () => East.value(false)).ifElse(
                (_$) => East.value(some({ value: ctx.row.count.unwrap("value").toFloat().multiply(1000.0), meta: East.str`row ${ctx.rowIndex} of ${ctx.rows.length()}` }), Fill),
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
            drafts: new Map(), rowIndex: 0n, rowId: "a", offset: 0n, line: none, row: cells,
            rows: [{ id: "a", owned: false, cells, lines: [], band: none, subRows: [] }], rowsOffset: 0n, partial: false, driver: none, today: new Date("2026-01-05T00:00:00Z"),
        }, Sheet.Types.WireContext);
        const fill = $.let(wire(ctx).unwrap("some"));
        $(Assert.equal(fill.value.unwrap("Float"), 2000.0));
        $(Assert.equal(fill.meta, "row 0 of 1"));
    });

    test("proposers bridge patches to cells — a set field crosses, an omitted field does not", $ => {
        const rows = $.const(JOBS, ArrayType(JobType));
        const Ctx = Sheet.Types.DraftContext(JobType);
        const Proposals = ArrayType(Sheet.Types.Proposal(JobType));
        const followUp = $.const(East.function([Ctx], Proposals, ($, ctx) => $.const([
            { patch: Sheet.patch(JobType, { task: East.str`after ${ctx.row.task.unwrap("value")}`, count: 5n }), meta: "pattern" },
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
            drafts: new Map(), rowIndex: 0n, rowId: "a", offset: 0n, line: none, row: cells,
            rows: [{ id: "a", owned: false, cells, lines: [], band: none, subRows: [] }], rowsOffset: 0n, partial: false, driver: none, today: new Date("2026-01-05T00:00:00Z"),
        }, Sheet.Types.WireContext);
        const proposals = $.let(wire(ctx));
        $(Assert.equal(proposals.size(), 1n));
        $(Assert.equal(proposals.get(0n).meta, "pattern"));
        $(Assert.equal(proposals.get(0n).cells.get("task").unwrap("String"), "after Machining"));
        $(Assert.equal(proposals.get(0n).cells.get("count").unwrap("Integer"), 5n));
        $(Assert.equal(proposals.get(0n).cells.has("qty"), false));
    });

    test("onPatch transports one typed draft event without authorizing writes", $ => {
        const rows = $.const(JOBS, ArrayType(JobType));
        const Event = Sheet.Types.PatchEvent(JobType);
        const observed = $.const(East.function([Event], NullType, ($, event) => {
            $(Assert.equal(event.transactionId, "gesture-1"));
            $(Assert.equal(event.origin.hasTag("undo"), true));
            $(Assert.equal(event.domainChanges.hasTag("none"), true));
            $(Assert.equal(event.readiness.unwrap("incomplete").get(0n).field.unwrap("some"), "owner"));
        }));
        const root = $.const(Sheet.Root(rows, { task: Sheet.column.text(JobType) }, { id: "id", onPatch: observed }).unwrap().unwrap("Sheet"));
        $(Assert.equal(root.editing.onApply.hasTag("none"), true));
        const event = $.const({ transactionId: "gesture-1", origin: variant("undo", null), label: "Undo task", draftChanges: [], domainChanges: none,
            readiness: variant("incomplete", [{ entry: "c", row: none, field: some("owner"), message: "Owner required" }]),
        }, Event);
        $(root.editing.onPatch.unwrap("some")(East.Blob.encodeBeast(event, "v2")));
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
            selection: some({ rowId: some("a"), line: none, key: some("task") }),
            views: [{ id: "v1", name: "ALL", narrowing: { range: none, compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(), breakdown: none, search: none, visible: none, selectedIndex: none, resolution: none }, context: 1n, reveals: [], folds: new Map() }],
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
        const sel = $.const({ rowId: none, line: none, key: none }, Sheet.Types.Selection);
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

    test("group draft decoding preserves hidden fields while children insert, move, remove and edit", $ => {
        const plans = $.const(PLANS, ArrayType(PlanType));
        const Draft = Sheet.Types.DraftGroup(PlanType, "lines");
        const original = $.const(plans.get(0n));
        const base = $.const({
            id: variant("value", original.id), name: variant("value", original.name),
            owner: variant("value", original.owner), status: variant("value", original.status), total: variant("value", original.total),
            lines: original.lines.map((_$, row) => East.value({ start: variant("value", row.start), task: variant("value", row.task), qty: variant("value", row.qty), note: variant("value", row.note) }, Sheet.Types.Draft(LineType))),
        }, Draft);
        const root = $.const(Sheet.Root(plans, {
            task: Sheet.column.text(LineType), qty: Sheet.column.quantity(LineType), note: Sheet.column.text(LineType),
        }, { id: "id", group: Sheet.group(PlanType, "lines", { title: "name", cells: { qty: Sheet.group.cell.quantity(PlanType, "total", { editable: false }) } }) }).unwrap().unwrap("Sheet"));
        const previous = $.const(P1_ROW, Sheet.Types.Row);
        const baseBytes = $.const(some(East.Blob.encodeBeast(base, "v2")));
        const previousBytes = $.const(some(East.Blob.encodeBeast(previous, "v2")));
        const insertedWire = $.const(P1_INSERTED, Sheet.Types.Row);
        const inserted = $.const(root.editing.decode(East.Blob.encodeBeast(insertedWire, "v2"), baseBytes, previousBytes).decodeBeast(Draft, "v2"));
        $(Assert.equal(inserted.lines.size(), 3n));
        $(Assert.equal(inserted.lines.get(1n).task.unwrap("value"), "Between"));
        $(Assert.equal(inserted.lines.get(2n).note.unwrap("value"), "second"));
        $(Assert.equal(inserted.owner.unwrap("value"), "planner"));
        const paintedWire = $.const(P1_PAINTED, Sheet.Types.Row);
        const painted = $.const(root.editing.decode(East.Blob.encodeBeast(paintedWire, "v2"), baseBytes, previousBytes).decodeBeast(Draft, "v2"));
        $(Assert.equal(painted.lines.get(1n).task.unwrap("value"), "Painting"));
        const renamedWire = $.const(P1_RENAMED, Sheet.Types.Row);
        const renamed = $.const(root.editing.decode(East.Blob.encodeBeast(renamedWire, "v2"), baseBytes, previousBytes).decodeBeast(Draft, "v2"));
        $(Assert.equal(renamed.name.unwrap("value"), "Renamed"));
        $(Assert.equal(renamed.total.unwrap("value"), 300.0));
        const removedWire = $.const(P1_REMOVED, Sheet.Types.Row);
        const removed = $.const(root.editing.decode(East.Blob.encodeBeast(removedWire, "v2"), baseBytes, previousBytes).decodeBeast(Draft, "v2"));
        $(Assert.equal(removed.lines.size(), 1n));
        $(Assert.equal(removed.lines.get(0n).task.unwrap("value"), "Machining"));
        const freshWire = $.const(P3_ROW, Sheet.Types.Row);
        const fresh = $.const(root.editing.decode(East.Blob.encodeBeast(freshWire, "v2"), none, none).decodeBeast(Draft, "v2"));
        $(Assert.equal(fresh.owner.hasTag("missing"), true));
        $(Assert.equal(fresh.total.hasTag("missing"), true));
        $(Assert.equal(fresh.name.unwrap("value"), "New plan"));
    });

    test("a grouped provider sees the line as it would be, its group's lines, the group and the resident groups", $ => {
        const plans = $.const(PLANS, ArrayType(PlanType));
        const Ctx = Sheet.Types.DraftContext(PlanType, "lines");
        const Fill = OptionType(Sheet.Types.Fill(StringType));
        const fromGroup = $.const(East.function([Ctx], Fill, (_$, ctx) =>
            East.value(some({
                value: East.str`${ctx.group.unwrap("some").name.unwrap("value")} · line ${ctx.rowIndex} ${ctx.row.task.unwrap("value")} · ${ctx.rows.length()} lines · ${ctx.groups.length()} plans · ${ctx.row.note.match({ value: (_$, value) => value, missing: () => East.value("missing"), invalid: () => East.value("invalid") })}`,
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
            drafts: new Map(), rowIndex: 1n, rowId: "p1", offset: 0n, line: some("1"), row: editing,
            rows: [P1_ROW, P2_ROW], rowsOffset: 0n, partial: false, driver: none, today: new Date("2026-01-05T00:00:00Z"),
        }, Sheet.Types.WireContext);
        $(Assert.equal(wire(ctx).unwrap("some").value.unwrap("String"), "Line 2 week 8 · line 1 Painting · 2 lines · 2 plans · second"));
        // A line the group does not hold yet (the blank line): retained as an incomplete draft, appended to the group's lines.
        const fresh = $.const({
            drafts: new Map(), rowIndex: 2n, rowId: "p1", offset: 0n, line: some("new"), row: editing,
            rows: [P1_ROW, P2_ROW], rowsOffset: 0n, partial: false, driver: none, today: new Date("2026-01-05T00:00:00Z"),
        }, Sheet.Types.WireContext);
        $(Assert.equal(wire(fresh).unwrap("some").value.unwrap("String"), "Line 2 week 8 · line 2 Painting · 3 lines · 2 plans · missing"));
    });

    // =========================================================================
    // Sub rows and column rules (#844)
    // =========================================================================

    test("sub rows: each source maps its array in declaration order onto the line, blanks filled and none facets dropped", $ => {
        const orders = $.const(ORDERS, ArrayType(OrderType));
        const sheet = $.let(Sheet.Root(orders, { task: Sheet.column.text(WorkType) }, {
            id: "id",
            group: Sheet.group(OrderType, "work", { title: "name", noun: { singular: "order", plural: "orders" } }),
            subRows: Sheet.subRows(WorkType, {
                ops: (op, row) => Sheet.subRow({ code: op.code, name: East.str`${op.name} · ${row.task}`, chips: op.materials, facets: { station: op.station, kind: "op" }, id: some(op.id) }),
                bookings: (b) => b.match({
                    labour:    (_$, l) => Sheet.subRow({ code: "LABOUR", name: East.str`${l.team} · ${l.people} people` }),
                    equipment: (_$, e) => Sheet.subRow({ code: "EQUIPMENT", name: e.resource, id: none }),
                }),
            }),
        }));
        const root = $.let(sheet.unwrap().unwrap("Sheet"));
        const group = $.let(root.rows.unwrap("inline").get(0n));
        $(Assert.equal(group.subRows.size(), 0n));
        const first = $.let(group.lines.get(0n).subRows);
        $(Assert.equal(first.size(), 4n));
        $(Assert.equal(first.get(0n).code, "CUT"));
        $(Assert.equal(first.get(0n).name, "Cut rails · Assemble"));
        $(Assert.equal(first.get(0n).chips.get(0n), "Rail × 8"));
        $(Assert.equal(first.get(0n).facets.size(), 2n));
        $(Assert.equal(first.get(0n).facets.get(0n).label, "station"));
        $(Assert.equal(first.get(0n).facets.get(0n).value, "Saw 2"));
        $(Assert.equal(first.get(0n).facets.get(1n).value, "op"));
        $(Assert.equal(first.get(0n).id, "o1-1"));
        // A none facet drops out; an empty code stays empty.
        $(Assert.equal(first.get(1n).facets.size(), 1n));
        $(Assert.equal(first.get(1n).code, ""));
        // The variant source follows, after every op.
        $(Assert.equal(first.get(2n).code, "LABOUR"));
        $(Assert.equal(first.get(2n).name, "Assembly · 2 people"));
        $(Assert.equal(first.get(2n).chips.size(), 0n));
        $(Assert.equal(first.get(2n).id, ""));
        $(Assert.equal(first.get(3n).name, "Driver"));
        $(Assert.equal(group.lines.get(1n).subRows.size(), 0n));
        // The group's noun rides on the declaration; with none the wire carries
        // none, and the renderer says its own word in the viewer's language (#861).
        $(Assert.equal(root.group.unwrap("some").noun.unwrap("some").singular, "order"));
        $(Assert.equal(root.group.unwrap("some").noun.unwrap("some").plural, "orders"));
        const plain = $.let(Sheet.Root(orders, { task: Sheet.column.text(WorkType) }, { id: "id", group: Sheet.group(OrderType, "work", { title: "name" }) }).unwrap().unwrap("Sheet"));
        $(Assert.equal(plain.group.unwrap("some").noun.hasTag("none"), true));
        $(Assert.equal(plain.rows.unwrap("inline").get(0n).lines.get(0n).subRows.size(), 0n));
    });

    test("sub rows on a flat sheet ride on the row", $ => {
        const rows = $.const([{ id: "w1", task: "Assemble", ops: [{ id: "x", code: "ASM", name: "Assemble", materials: [], station: none }] }], ArrayType(FlatWorkType));
        const root = $.let(Sheet.Root(rows, { task: Sheet.column.text(FlatWorkType) }, {
            id: "id", subRows: Sheet.subRows(FlatWorkType, { ops: (op) => Sheet.subRow({ code: op.code, name: op.name, id: op.id }) }),
        }).unwrap().unwrap("Sheet"));
        const row = $.let(root.rows.unwrap("inline").get(0n));
        $(Assert.equal(row.subRows.size(), 1n));
        $(Assert.equal(row.subRows.get(0n).code, "ASM"));
        $(Assert.equal(row.subRows.get(0n).facets.size(), 0n));
    });

    test("a date's level and actual and a column's detail project into unrendered cells the wire names", $ => {
        const rows = $.const(RULE_ROWS, ArrayType(RuleRowType));
        const root = $.let(Sheet.Root(rows, {
            start:  Sheet.column.date(RuleRowType, { header: "Start", level: r => r.level, actual: r => r.started }),
            status: Sheet.column.text(RuleRowType, { header: "Status", detail: r => r.code }),
            code:   Sheet.column.text(RuleRowType, { header: "Code", detail: r => r.code.length().equal(0n).ifElse(() => East.value(none, OptionType(StringType)), () => East.value(some(East.str`order ${r.code}`), OptionType(StringType))) }),
        }, { id: "id" }).unwrap().unwrap("Sheet"));
        const date = $.let(root.columns.get(0n).kind.unwrap("date"));
        $(Assert.equal(date.level.unwrap("some"), "$level:start"));
        $(Assert.equal(date.actual.unwrap("some"), "$actual:start"));
        $(Assert.equal(root.columns.get(0n).detailCell.hasTag("none"), true));
        $(Assert.equal(root.columns.get(1n).detailCell.unwrap("some"), "$detail:status"));
        const r1 = $.let(root.rows.unwrap("inline").get(0n).cells);
        $(Assert.equal(r1.get("$level:start").unwrap("String"), "week"));
        $(Assert.equal(r1.get("$actual:start").hasTag("DateTime"), true));
        $(Assert.equal(r1.get("$detail:status").unwrap("String"), "WO-1"));
        $(Assert.equal(r1.get("$detail:code").unwrap("String"), "order WO-1"));
        const r2 = $.let(root.rows.unwrap("inline").get(1n).cells);
        $(Assert.equal(r2.get("$level:start").unwrap("String"), "time"));
        $(Assert.equal(r2.get("$actual:start").hasTag("Null"), true));
        $(Assert.equal(r2.get("$detail:code").hasTag("Null"), true));
        // Without the rules nothing extra crosses.
        const plain = $.let(Sheet.Root(rows, { start: Sheet.column.date(RuleRowType) }, { id: "id" }).unwrap().unwrap("Sheet"));
        $(Assert.equal(plain.columns.get(0n).kind.unwrap("date").level.hasTag("none"), true));
        $(Assert.equal(plain.rows.unwrap("inline").get(0n).cells.size(), 1n));
    });

    test("options rules bridge onto enum, lookup and link kinds and run over the wire context; ranged kinds round-trip", $ => {
        const rows = $.const(RULE_ROWS, ArrayType(RuleRowType));
        const activities = $.const(ACTIVITIES, ArrayType(ActivityType));
        const Ctx = Sheet.Types.DraftContext(RuleRowType, ActivityType);
        const Keys = OptionType(ArrayType(StringType));
        const byCode = $.const(East.function([Ctx], Keys, ($, ctx) => {
            const whole = $.const(none, Keys);
            return ctx.row.code.match({ value: (_$, code) => code.length().equal(0n).ifElse(() => East.value(some(["PLANNED"]), Keys), () => whole) }, () => whole);
        }));
        const root = $.let(Sheet.Root(rows, {
            activity: Sheet.column.lookup(RuleRowType, { options: byCode }),
            status:   Sheet.column.enum(RuleRowType, "statuses", { options: byCode }),
            stations: Sheet.column.link(RuleRowType, ActivityType, "stations", { options: byCode, members: [{ kind: "machine", identified: true, ranged: true }, { kind: "line" }] }),
            code:     Sheet.column.text(RuleRowType),
        }, {
            id: "id",
            driver: Sheet.driver("activity", activities, { key: a => a.name, label: a => a.name }),
            registers: { statuses: Sheet.register.members(East.value(["PLANNED", "RELEASED"], ArrayType(StringType)), { kind: "status", key: s => s, label: s => s }), stations: East.value(MEMBERS, Sheet.Types.RegisterMembers) },
        }).unwrap().unwrap("Sheet"));
        $(Assert.equal(root.columns.get(0n).kind.unwrap("lookup").options.hasTag("some"), true));
        const link = $.let(root.columns.get(2n).kind.unwrap("link"));
        $(Assert.equal(link.members.get(0n).ranged, true));
        $(Assert.equal(link.members.get(1n).ranged, false));
        const rule = $.let(root.columns.get(1n).kind.unwrap("enum").options.unwrap("some"));
        const cells = $.const((new Map<string, unknown>([["code", variant("String", "")]]) as never), DictType(StringType, Sheet.Types.Cell));
        const ctx = $.const({
            drafts: new Map(), rowIndex: 1n, rowId: "r2", offset: 1n, line: none, row: cells,
            rows: [], rowsOffset: 0n, partial: false, driver: none, today: new Date("2026-01-05T00:00:00Z"),
        }, Sheet.Types.WireContext);
        $(Assert.equal(rule(ctx).unwrap("some").get(0n), "PLANNED"));
        const coded = $.const((new Map<string, unknown>([["code", variant("String", "WO-9")]]) as never), DictType(StringType, Sheet.Types.Cell));
        $(Assert.equal(rule($.const({
            drafts: new Map(), rowIndex: 1n, rowId: "r2", offset: 1n, line: none, row: coded,
            rows: [], rowsOffset: 0n, partial: false, driver: none, today: new Date("2026-01-05T00:00:00Z"),
        }, Sheet.Types.WireContext)).hasTag("none"), true));
        // Without a rule the kinds carry none.
        const plain = $.let(Sheet.Root(rows, { status: Sheet.column.enum(RuleRowType, "s") }, { id: "id", registers: { s: East.value(MEMBERS, Sheet.Types.RegisterMembers) } }).unwrap().unwrap("Sheet"));
        $(Assert.equal(plain.columns.get(0n).kind.unwrap("enum").options.hasTag("none"), true));
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
    hostTest("onUpdate needs a live handle, not a captured Array snapshot", () => {
        assert.throws(() => Sheet.Root(rows, { task: Sheet.column.text(JobType) }, { id: "id", onUpdate: noop }), /data=\{liveHandle\}/);
    });
    hostTest("Dict children cannot establish an ordered group draft", () => {
        const keyed = East.value([{ id: "k", name: "Keyed", lines: new Map() }], ArrayType(KeyedPlanType));
        assert.throws(() => Sheet.Root(keyed as never, { task: Sheet.column.text(LineType) } as never, { id: "id", group: Sheet.group(KeyedPlanType, "lines" as never, { title: "name" }) } as never), /Array of row structs/);
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
        const foreign = East.function([Sheet.Types.DraftContext(Other)], OptionType(Sheet.Types.Fill(StringType)), (_$, _ctx) => East.value(none, OptionType(Sheet.Types.Fill(StringType))));
        assert.throws(() => Sheet.Root(rows, { task: Sheet.column.text(JobType, { fill: [foreign as never] }) }, { id: "id" }), /fill provider #1/);
    });
    hostTest("a provider with the wrong payload is refused", () => {
        const wrongPayload = East.function([Sheet.Types.DraftContext(JobType)], OptionType(Sheet.Types.Fill(FloatType)), (_$, _ctx) => East.value(none, OptionType(Sheet.Types.Fill(FloatType))));
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
    hostTest("a lines field that is not an Array of structs is refused", () => {
        assert.throws(() => Sheet.Root(plans, lineColumns, { id: "id", group: Sheet.group(PlanType, "owner" as never, { title: "name" }) } as never), /Array of row structs/);
        assert.throws(() => Sheet.Root(plans, lineColumns, { id: "id", group: Sheet.group(PlanType, "nope" as never, { title: "name" }) } as never), /not a field of the row type/);
    });
    hostTest("a group built over another row type is refused", () => {
        assert.throws(() => Sheet.Root(plans, lineColumns, { id: "id", group: Sheet.group(StructType({ id: StringType, name: StringType, lines: ArrayType(LineType) }), "lines", { title: "name" }) } as never), /different row type/);
    });
    hostTest("a title that is not a String field is refused", () => {
        assert.throws(() => Sheet.Root(plans, lineColumns, { id: "id", group: Sheet.group(PlanType, "lines", { title: "total" as never }) }), /`group.title` must name a String field/);
    });
    hostTest("a band cell under an undeclared column, or with another payload than its column, is refused", () => {
        assert.throws(() => Sheet.Root(plans, lineColumns, { id: "id", group: Sheet.group(PlanType, "lines", { title: "name", cells: { owner: Sheet.group.cell.text(PlanType, "owner") } as never }) }), /band cell "owner" is not a declared column/);
        assert.throws(() => Sheet.Root(plans, lineColumns, { id: "id", group: Sheet.group(PlanType, "lines", { title: "name", cells: { task: Sheet.group.cell.quantity(PlanType, "total") } }) }), /band cell "task" is a quantity cell/);
        assert.throws(() => Sheet.Root(plans, lineColumns, { id: "id", group: Sheet.group(PlanType, "lines", { title: "name", cells: { task: Sheet.group.cell.date(PlanType, "owner" as never) } }) }), /band cell "task" — date column "owner"/);
    });
    // Sub rows and column rules (#844).
    hostTest("sub rows built over another type, or naming a field that is not an array, are refused", () => {
        const orders = East.value(ORDERS, ArrayType(OrderType));
        const group = Sheet.group(OrderType, "work", { title: "name" });
        assert.throws(() => Sheet.Root(orders, { task: Sheet.column.text(WorkType) }, { id: "id", group, subRows: Sheet.subRows(OrderType, { work: (w) => Sheet.subRow({ name: w.task }) }) as never }), /`subRows` was built over a different type/);
        assert.throws(() => Sheet.Root(orders, { task: Sheet.column.text(WorkType) }, { id: "id", group, subRows: Sheet.subRows(WorkType, { task: ((t: never) => Sheet.subRow({ name: t })) } as never) }), /`subRows` names "task", which is a String field/);
    });
    hostTest("level and actual on a non-date column, and options on a kind without members, are refused", () => {
        const ruleRows = East.value(RULE_ROWS, ArrayType(RuleRowType));
        assert.throws(() => Sheet.Root(ruleRows, { code: Sheet.column.text(RuleRowType, { level: (() => "day") } as never) }, { id: "id" }), /`level` and `actual` are date-column rules/);
        const keys = East.function([Sheet.Types.DraftContext(RuleRowType)], OptionType(ArrayType(StringType)), () => East.value(none, OptionType(ArrayType(StringType))));
        assert.throws(() => Sheet.Root(ruleRows, { code: Sheet.column.text(RuleRowType, { options: keys } as never) }, { id: "id" }), /an `options` rule narrows an enum, lookup or link column/);
        const asyncKeys = East.asyncFunction([Sheet.Types.DraftContext(RuleRowType)], OptionType(ArrayType(StringType)), () => East.value(none, OptionType(ArrayType(StringType))));
        assert.throws(() => Sheet.Root(ruleRows, { status: Sheet.column.enum(RuleRowType, "s", { options: asyncKeys as never }) }, { id: "id", registers: { s: East.value(MEMBERS, Sheet.Types.RegisterMembers) } }), /options rule must be synchronous/);
        assert.throws(() => Sheet.Root(ruleRows, { start: Sheet.column.date(RuleRowType, { actual: ((r: ExprType<typeof RuleRowType>) => r.code) as never }) }, { id: "id" }), /`actual` rule returning String/);
    });
    hostTest("a grouped provider must take the grouped context", () => {
        const flat = East.function([Sheet.Types.DraftContext(LineType)], OptionType(Sheet.Types.Fill(StringType)), (_$, _ctx) => East.value(none, OptionType(Sheet.Types.Fill(StringType))));
        assert.throws(() => Sheet.Root(plans, { task: Sheet.column.text(LineType, { fill: [flat] }) }, { id: "id", group: Sheet.group(PlanType, "lines", { title: "name" }) }), /Sheet\.Types\.DraftContext\(GroupType, "lines"\)/);
    });
});

describe("Sheet structure declarations", () => {
    for (const option of ["insertGroups", "moveGroups", "removeGroups"] as const) {
        hostTest(`refuses edits.${option} on a flat sheet`, () => {
            assert.throws(() => East.function([], UIComponentType, ($) => Sheet.Root($.const(JOBS, ArrayType(JobType)), {
                task: Sheet.column.text(JobType),
            }, { id: "id", edits: { [option]: true } })), new RegExp(`edits.${option} requires a group declaration`));
        });
    }
    hostTest("refuses top-level movement on a key-ordered flat source", () => {
        assert.throws(() => East.function([], UIComponentType, ($) => Sheet.Root(Paged.of("keyed-edits", $.const(new Map([["a", JOBS[0]!]]), DictType(StringType, JobType))), {
            task: Sheet.column.text(JobType),
        }, { edits: { moveRows: "within" } })), /edits.moveRows cannot reorder a flat key-ordered source/);
    });
    hostTest("refuses group movement on a key-ordered source while retaining child ordering", () => {
        assert.throws(() => East.function([], UIComponentType, ($) => Sheet.Root(Paged.of("keyed-group-edits", $.const(new Map([["p1", PLANS[0]!]]), DictType(StringType, PlanType))), {
            task: Sheet.column.text(LineType),
        }, { group: Sheet.group(PlanType, "lines", { title: "name" }), edits: { moveGroups: true } })), /edits.moveGroups cannot reorder a key-ordered source/);
        const value = East.function([], UIComponentType, ($) => Sheet.Root(Paged.of("keyed-child-edits", $.const(new Map([["p1", PLANS[0]!]]), DictType(StringType, PlanType))), {
            task: Sheet.column.text(LineType),
        }, { group: Sheet.group(PlanType, "lines", { title: "name" }), edits: { moveRows: "within" } })).toIR().compile([])();
        assert.equal(value.type, "Sheet");
        if (value.type !== "Sheet") return;
        assert.equal(value.value.editing.edits.moveRows.type, "within");
        assert.equal(value.value.editing.edits.moveGroups, false);
    });
});
