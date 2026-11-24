/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Registers keyed by any type (east-workspace#1747), and the columns that hold
 * one member's key: the machines on their lines (`recordMachinesByLine`)
 * evaluate, read their registers' records and commit to the machines; a
 * register's members keyed by its Dict's own key, or by whatever type `key`
 * returns, each key crossing as its text; an enum, a reference, a person and a
 * cycle over an Integer field and over an Option of one — each cell its key's
 * text, read back at the field's type, a key no member has kept and a text no key
 * prints as kept unread; a patch, a fill provider and an options rule in the
 * key's type; a column from data over a register keyed by number, its functions
 * taking each member's key as one; the inspector's field at the field's own type;
 * a Sheet's columns and band cells; and the refusals — a field of another type
 * than the register's keys, a `concat` of registers keyed by two types, a key of
 * no type a Dict is keyed by, and an action's menu over a register keyed by
 * another type than String.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, SortedMap, StringType, StructType, VariantType,
    compareFor, decodeBeast2For, encodeBeast2For, equalFor, isTypeEqual, none, printFor, some, toEastTypeValue, variant, type ExprType, type ValueTypeOf,
} from "@elaraai/east";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import { FieldSpecType } from "@elaraai/east-ui/internal";
import { pathToString } from "@elaraai/e3-types";
import { Record, Sheet, SheetInspectorPaneType, buildInspectorPane, createSheetBuild, createSheetRootWith, deriveManifest } from "@elaraai/e3-ui/internal";
import * as ex from "./record-register-keys.examples.js";

// ── Fixtures: the lines, the operators and the shifts, each keyed by number ──

const Lines = DictType(IntegerType, ex.Line);
const LINES: ValueTypeOf<typeof Lines> = new Map([[1n, { name: "Assembly" }], [2n, { name: "Packing" }], [3n, { name: "Finishing" }]]);
const Operators = DictType(IntegerType, ex.Operator);
const OPERATORS: ValueTypeOf<typeof Operators> = new Map([[104n, { name: "A. Morgan" }], [117n, { name: "B. Ellis" }]]);
const Shifts = DictType(IntegerType, ex.Shift);
const SHIFTS: ValueTypeOf<typeof Shifts> = new Map([[1n, { name: "Early" }], [2n, { name: "Late" }]]);

/** A desk on a line, for the Sheet's own: its line by number. */
const Desk = StructType({ id: StringType, line: IntegerType });

/** A station: each kind holding a member's key, over an Integer field and an Option of one. */
const Station = StructType({
    id: StringType,
    line: IntegerType, spare: OptionType(IntegerType),
    near: IntegerType, beside: OptionType(IntegerType),
    lead: IntegerType, cover: OptionType(IntegerType),
    shift: IntegerType, relief: OptionType(IntegerType),
});
const STATIONS: ValueTypeOf<typeof Station>[] = [
    { id: "S-1", line: 2n, spare: some(3n), near: 1n, beside: none, lead: 104n, cover: some(117n), shift: 1n, relief: none },
    // Line 4 is a key no line has.
    { id: "S-2", line: 4n, spare: none, near: 3n, beside: some(2n), lead: 117n, cover: none, shift: 2n, relief: some(1n) },
];
const STATION_COLUMNS = {
    line:   Record.column.enum(Station, "lines", { header: "Line" }),
    spare:  Record.column.enum(Station, "lines", { header: "Spare" }),
    near:   Record.column.reference(Station, "lines", { header: "Near" }),
    beside: Record.column.reference(Station, "lines", { header: "Beside" }),
    lead:   Record.column.person(Station, "operators", { header: "Lead" }),
    cover:  Record.column.person(Station, "operators", { header: "Cover" }),
    shift:  Record.column.cycle(Station, "shifts", { header: "Shift" }),
    relief: Record.column.cycle(Station, "shifts", { header: "Relief" }),
};
const STATION_OPTIONS = {
    id: "id" as const,
    registers: {
        lines: Record.register.members(East.value(LINES, Lines), { kind: "line", key: (_l, n) => n, label: (l) => l.name }),
        operators: Record.register.members(East.value(OPERATORS, Operators), { kind: "operator", key: (_o, badge) => badge, label: (o) => o.name }),
        shifts: Record.register.members(East.value(SHIFTS, Shifts), { kind: "shift", key: (_s, n) => n, label: (s) => s.name }),
    },
};

type Root = ValueTypeOf<typeof Sheet.Types.Root>;
type CellValue = ValueTypeOf<typeof Sheet.Types.Cell>;
const Members = Sheet.Types.Root.fields.registers.value.fields.members;
const Cells = DictType(StringType, Sheet.Types.Cell);
const ColumnType = Sheet.Types.Root.fields.columns.value;
const StationDraft = Record.Types.Draft(Station);
const Keys = ArrayType(StringType);

/** The stations' root, inline. */
const STATIONS_ROOT: Root = East.compile(East.function([], Sheet.Types.Root, ($) => {
    const rows = $.const(STATIONS, ArrayType(Station));
    return createSheetRootWith(rows, STATION_COLUMNS, STATION_OPTIONS, { recordKinds: true });
}), [])();

/** A station's cells, by its id. */
function cellsOf(root: Root, id: string): ValueTypeOf<typeof Cells> {
    if (root.rows.type !== "inline") assert.fail(`expected inline rows, got ${root.rows.type}`);
    const row = root.rows.value.find((r) => equalFor(StringType)(r.id, id));
    if (row === undefined) assert.fail(`no row ${id}`);
    return row.cells;
}

describeEast("Record — registers keyed by number", test => {
    Assert.examples(test, {
        recordMachinesByLine: ex.recordMachinesByLine,
    });

    test("a fill provider fills a member's key at the register's key type, and an options rule offers members by their keys at it; the cell takes each key's text", $ => {
        const rows = $.const([{ id: "a", line: 1n }], ArrayType(Desk));
        const lineRows = $.const(LINES, Lines);
        const Ctx = Sheet.Types.DraftContext(Desk);
        const fillLine = $.const(East.function([Ctx], OptionType(Sheet.Types.Fill(IntegerType)), () => some({ value: 3n, meta: "the finishing line" })));
        const offerLines = $.const(East.function([Ctx], OptionType(ArrayType(IntegerType)), () => some([2n, 1n])));
        const root = $.let(Sheet.Root(rows, {
            line: Sheet.column.enum(Desk, "lines", { header: "Line", fill: [fillLine], options: offerLines }),
        }, { id: "id", registers: { lines: Sheet.register.members(lineRows, { kind: "line", key: (_l, n) => n, label: (l) => l.name }) } }));
        const cells = $.const((new Map<string, unknown>([["line", variant("String", "1")]]) as never), DictType(StringType, Sheet.Types.Cell));
        const ctx = $.const({
            drafts: new Map(), rowIndex: 0n, rowId: "a", offset: 0n, line: none, row: cells,
            rows: [{ id: "a", owned: false, cells, lines: [], band: none, subRows: [] }], rowsOffset: 0n, partial: false, driver: none, today: new Date("2026-01-05T00:00:00Z"),
        }, Sheet.Types.WireContext);
        const fill = $.let(root.columns.get(0n).fill.get(0n).unwrap("sync"));
        $(Assert.equal(fill(ctx).unwrap("some").value.unwrap("String"), "3"));
        const offered = $.let(root.columns.get(0n).kind.unwrap("enum").options.unwrap("some"));
        $(Assert.equal(offered(ctx).unwrap("some").get(0n), "2"));
        $(Assert.equal(offered(ctx).unwrap("some").get(1n), "1"));
    });
}, { platformFns: TestImpl });

describe("the example", () => {
    test("reads its machines and its three registers' records from e3, and declares the one record its Saves commit to", () => {
        const manifest = deriveManifest(ex.recordMachinesByLine.fn);
        assert.deepEqual(manifest.paths.map(pathToString).sort(),
            [ex.recordMachines, ex.recordLines, ex.recordOperators, ex.recordShifts].map((record) => pathToString(record.path)).sort());
        assert.deepEqual([...new Set(manifest.records)], [ex.recordMachines.name]);
    });
});

describe("a register keyed by any type", () => {
    test("over a Dict, its accessors take each entry's key at the Dict's own type, and the register is keyed by what `key` returns — each member's key its text, as East prints it, in the Dict's order", () => {
        const lines = STATIONS_ROOT.registers.get("lines")?.members ?? assert.fail("no lines register");
        assert.ok(equalFor(Members)(lines, [
            { key: "1", label: "Assembly", kind: "line", aliases: [], meta: none, parent: none, tone: none },
            { key: "2", label: "Packing", kind: "line", aliases: [], meta: none, parent: none, tone: none },
            { key: "3", label: "Finishing", kind: "line", aliases: [], meta: none, parent: none, tone: none },
        ]), printFor(Members)(lines));
        assert.ok(isTypeEqual(STATION_OPTIONS.registers.lines.keyType, IntegerType));
        // A day is a key as any other: as East prints it.
        const Days = DictType(DateTimeType, StringType);
        const MONDAY = new Date("2026-11-30T00:00:00Z");
        const days = new SortedMap<Date, string>([[MONDAY, "Monday"]], compareFor(DateTimeType));
        const byDay = Record.register.members(East.value(days, Days), { kind: "day", key: (_d, at) => at, label: (d) => d });
        assert.ok(isTypeEqual(byDay.keyType, DateTimeType));
        const dayMembers = East.compile(East.function([], Members, () => byDay.members), [])();
        assert.ok(equalFor(Keys)(dayMembers.map((m) => m.key), [printFor(DateTimeType)(MONDAY)]), printFor(Members)(dayMembers));
    });

    test("over an Array, its accessors take each row's index printed, and the register is keyed by what `key` returns — a String, or any other type", () => {
        const Bay = StructType({ number: IntegerType, name: StringType });
        const bays = East.value([{ number: 7n, name: "North" }, { number: 9n, name: "South" }], ArrayType(Bay));
        const byNumber = Record.register.members(bays, { kind: "bay", key: (b) => b.number, label: (b, at) => East.str`${b.name} (${at})` });
        assert.ok(isTypeEqual(byNumber.keyType, IntegerType));
        const members = East.compile(East.function([], Members, () => byNumber.members), [])();
        assert.ok(equalFor(Keys)(members.map((m) => m.key), ["7", "9"]), printFor(Members)(members));
        assert.ok(equalFor(Keys)(members.map((m) => m.label), ["North (0)", "South (1)"]), printFor(Members)(members));
        const byName = Record.register.members(bays, { kind: "bay", key: (b) => b.name, label: (b) => b.name });
        assert.ok(isTypeEqual(byName.keyType, StringType));
    });

    test("concat joins registers of one key type, keyed by it", () => {
        const more = Record.register.members(East.value(new Map([[8n, { name: "Spare" }]]), Lines), { kind: "spare", key: (_l, n) => n, label: (l) => l.name });
        const joined = Record.register.concat([STATION_OPTIONS.registers.lines, more]);
        assert.ok(isTypeEqual(joined.keyType, IntegerType));
        const members = East.compile(East.function([], Members, () => joined.members), [])();
        assert.ok(equalFor(Keys)(members.map((m) => m.key), ["1", "2", "3", "8"]), printFor(Members)(members));
    });
});

describe("the columns holding a member's key", () => {
    test("each cell holds its key's text — a number as East prints it, one no member has kept, an Option's none the blank cell", () => {
        const s1 = cellsOf(STATIONS_ROOT, "S-1");
        assert.ok(equalFor(Cells)(s1, new Map<string, CellValue>([
            ["beside", variant("Null", null)], ["cover", variant("String", "117")], ["lead", variant("String", "104")], ["line", variant("String", "2")],
            ["near", variant("String", "1")], ["relief", variant("Null", null)], ["shift", variant("String", "1")], ["spare", variant("String", "3")],
        ])), printFor(Cells)(s1));
        const s2 = cellsOf(STATIONS_ROOT, "S-2");
        assert.ok(equalFor(Cells)(s2, new Map<string, CellValue>([
            ["beside", variant("String", "2")], ["cover", variant("Null", null)], ["lead", variant("String", "117")], ["line", variant("String", "4")],
            ["near", variant("String", "3")], ["relief", variant("String", "1")], ["shift", variant("String", "2")], ["spare", variant("Null", null)],
        ])), printFor(Cells)(s2));
    });

    test("each names its register, holds its key's text as a String payload, and carries its field's own type", () => {
        const column = (key: string) => STATIONS_ROOT.columns.find((c) => equalFor(StringType)(c.key, key)) ?? assert.fail(`no column ${key}`);
        const Kind = ColumnType.fields.kind;
        assert.ok(equalFor(Kind)(column("line").kind, variant("enum", { register: "lines", options: none })), printFor(Kind)(column("line").kind));
        assert.ok(equalFor(Kind)(column("near").kind, variant("reference", { register: "lines" })), printFor(Kind)(column("near").kind));
        assert.ok(equalFor(Kind)(column("cover").kind, variant("person", { register: "operators", unassigned: none })), printFor(Kind)(column("cover").kind));
        assert.ok(equalFor(Kind)(column("shift").kind, variant("cycle", { register: "shifts", scale: false, look: variant("chip", null) })), printFor(Kind)(column("shift").kind));
        for (const [key, type] of [["line", IntegerType], ["spare", OptionType(IntegerType)], ["cover", OptionType(IntegerType)], ["relief", OptionType(IntegerType)]] as const) {
            assert.ok(equalFor(ColumnType.fields.dataType)(column(key).dataType, toEastTypeValue(type)), `${key}: ${printFor(ColumnType.fields.dataType)(column(key).dataType)}`);
            assert.ok(equalFor(ColumnType.fields.payloadType)(column(key).payloadType, toEastTypeValue(StringType)), `${key}: ${printFor(ColumnType.fields.payloadType)(column(key).payloadType)}`);
        }
    });

    test("a cell's text is read back at its field's type — a member's key, a key no member has, an Option's — and a text no key prints as is kept unread", () => {
        const decode = East.compile(East.function([Cells], undefined, ($, cells) => {
            const rows = $.const(STATIONS, ArrayType(Station));
            const built = createSheetBuild(rows, STATION_COLUMNS, STATION_OPTIONS, { recordKinds: true });
            const draftRow = $.const(built.bridge.draftRow);
            return draftRow("S-1", cells, none);
        }), []);
        const draft = decode(new Map<string, CellValue>([
            ["line", variant("String", "3")], ["spare", variant("String", "4")], ["near", variant("String", "Finishing")], ["beside", variant("String", "2")],
            ["lead", variant("String", "117")], ["cover", variant("String", "104")], ["shift", variant("String", "2")], ["relief", variant("String", "1")],
        ])) as ValueTypeOf<typeof StationDraft>;
        assert.ok(equalFor(StationDraft)(draft, {
            id: variant("value", "S-1"),
            line: variant("value", 3n), spare: variant("value", some(4n)),
            // Text no Integer prints as — a label typed past the menu — kept unread.
            near: variant("invalid", "Finishing"), beside: variant("value", some(2n)),
            lead: variant("value", 117n), cover: variant("value", some(104n)),
            shift: variant("value", 2n), relief: variant("value", some(1n)),
        }), printFor(StationDraft)(draft));
    });

    test("a patch of the row — a proposal's, a template's, a new row's — sets each cell to its key's text, a none the blank cell", () => {
        const encode = East.compile(East.function([], Cells, ($) => {
            const rows = $.const(STATIONS, ArrayType(Station));
            const built = createSheetBuild(rows, STATION_COLUMNS, STATION_OPTIONS, { recordKinds: true });
            const encodePatch = $.const(built.bridge.encodePatch);
            return encodePatch(Record.patch(Station, { line: 3n, cover: some(104n), relief: none }));
        }), []);
        const cells = encode();
        assert.ok(equalFor(Cells)(cells, new Map<string, CellValue>([["cover", variant("String", "104")], ["line", variant("String", "3")], ["relief", variant("Null", null)]])), printFor(Cells)(cells));
    });

    test("the inspector shows each one's field at the field's own type, a select over its register", () => {
        const pane = East.compile(East.function([], OptionType(SheetInspectorPaneType), ($) => {
            const rows = $.const(STATIONS, ArrayType(Station));
            const built = createSheetBuild(rows, STATION_COLUMNS, STATION_OPTIONS, { recordKinds: true });
            return buildInspectorPane(true, built, { fields: undefined, groupFields: undefined, id: "id" });
        }), [])();
        if (pane.type !== "some") assert.fail("no inspector pane");
        const spec = (path: string) => pane.value.forms.row.fields.find((f) => equalFor(StringType)(f.spec.path.join("."), path))?.spec ?? assert.fail(`no ${path} field`);
        for (const [path, type, register] of [["line", IntegerType, "lines"], ["cover", OptionType(IntegerType), "operators"], ["shift", IntegerType, "shifts"]] as const) {
            assert.ok(equalFor(FieldSpecType.fields.type)(spec(path).type, toEastTypeValue(type)), `${path}: ${printFor(FieldSpecType.fields.type)(spec(path).type)}`);
            assert.ok(equalFor(FieldSpecType.fields.editor)(spec(path).editor, variant("reference", { of: register })), `${path}: ${printFor(FieldSpecType.fields.editor)(spec(path).editor)}`);
        }
    });
});

describe("a Sheet over a register keyed by number", () => {
    test("its enum and reference columns, and a band cell over a group's field, hold their keys' text", () => {
        const Task = StructType({ title: StringType, line: IntegerType, near: OptionType(IntegerType) });
        const Plan = StructType({ id: StringType, name: StringType, line: IntegerType, tasks: ArrayType(Task) });
        const root: Root = East.compile(East.function([], Sheet.Types.Root, ($) => {
            const plans = $.const([{ id: "P-1", name: "Week 48", line: 2n, tasks: [{ title: "Set up", line: 1n, near: some(3n) }] }], ArrayType(Plan));
            const lineRows = $.const(LINES, Lines);
            return Sheet.Root(plans, {
                title: Sheet.column.text(Task, { header: "Task" }),
                line: Sheet.column.enum(Task, "lines", { header: "Line" }),
                near: Sheet.column.reference(Task, "lines", { header: "Near" }),
            }, {
                id: "id",
                group: Sheet.group(Plan, "tasks", { title: "name", cells: { line: Sheet.group.cell.enum(Plan, "lines", "line") } }),
                registers: { lines: Sheet.register.members(lineRows, { kind: "line", key: (_l, n) => n, label: (l) => l.name }) },
            });
        }), [])();
        if (root.rows.type !== "inline") assert.fail(`expected inline rows, got ${root.rows.type}`);
        const plan = root.rows.value[0] ?? assert.fail("no plan");
        assert.ok(equalFor(Sheet.Types.Cell)(plan.cells.get("line") ?? variant("Null", null), variant("String", "2")), printFor(Cells)(plan.cells));
        const task = plan.lines[0]?.cells ?? assert.fail("no task");
        assert.ok(equalFor(Cells)(task, new Map<string, CellValue>([["line", variant("String", "1")], ["near", variant("String", "3")], ["title", variant("String", "Set up")]])), printFor(Cells)(task));
    });
});

describe("a column from data over a register keyed by number", () => {
    /** A desk's planned hours, by line number. */
    const Hours = DictType(IntegerType, FloatType);
    const Booked = StructType({ id: StringType, hours: Hours });
    const BOOKED: ValueTypeOf<typeof Booked>[] = [{ id: "D-1", hours: new Map([[1n, 6.0], [3n, 2.0]]) }];
    const BookedDraft = Record.Types.Draft(Booked);
    const OPTIONS = { id: "id" as const, registers: { lines: STATION_OPTIONS.registers.lines } };
    const MONDAY = new Date("2026-11-30T00:00:00Z");
    const hoursRoot: Root = East.compile(East.function([], Sheet.Types.Root, ($) => {
        const rows = $.const(BOOKED, ArrayType(Booked));
        return createSheetRootWith(rows, { hours: Record.column.quantity(Booked, { each: "lines", unit: "hrs" }) }, OPTIONS, { recordKinds: true });
    }), [])();

    test("its columns are the members, each keyed by its key's text; a Dict keyed by the member reads its entry by the member's key, at its type", () => {
        const keys = hoursRoot.columns.map((c) => c.key);
        assert.ok(equalFor(Keys)(keys, ["hours:1", "hours:2", "hours:3"]), printFor(Keys)(keys));
        const headers = hoursRoot.columns.map((c) => c.header);
        assert.ok(equalFor(Keys)(headers, ["Assembly", "Packing", "Finishing"]), printFor(Keys)(headers));
        if (hoursRoot.cellsAt.type !== "some") assert.fail("the root reads no cells at a day");
        const shown = hoursRoot.cellsAt.value(variant("entry", encodeBeast2For(Booked)(BOOKED[0]!)), MONDAY);
        assert.ok(equalFor(Cells)(shown, new Map<string, CellValue>([["hours:1", variant("Float", 6.0)], ["hours:2", variant("Null", null)], ["hours:3", variant("Float", 2.0)]])), printFor(Cells)(shown));
    });

    test("an edit of a member's cell writes its entry by the member's key at its type, and a clear removes it", () => {
        const base: ValueTypeOf<typeof BookedDraft> = { id: variant("value", "D-1"), hours: variant("value", new Map([[1n, 6.0], [3n, 2.0]])) };
        const cells = new Map<string, CellValue>([["hours:1", variant("Float", 6.0)], ["hours:2", variant("Float", 4.0)], ["hours:3", variant("Null", null)]]);
        const row = encodeBeast2For(Sheet.Types.Row)({ id: "D-1", owned: false, cells, lines: [], band: none, subRows: [] });
        const written = decodeBeast2For(BookedDraft)(hoursRoot.editing.decode(row, some(encodeBeast2For(BookedDraft)(base)), none, MONDAY));
        assert.ok(equalFor(BookedDraft)(written, { id: variant("value", "D-1"), hours: variant("value", new Map([[1n, 6.0], [2n, 4.0]])) }), printFor(BookedDraft)(written));
    });

    test("its own functions take the member's key at the register's type, and are refused over a String", () => {
        const rows = East.value(BOOKED, ArrayType(Booked));
        const read = East.function([Hours, IntegerType, DateTimeType], OptionType(FloatType), (_$, hours, line) => hours.tryGet(line));
        const write = East.function([Hours, IntegerType, OptionType(FloatType), DateTimeType], Hours, (_$, hours) => hours);
        assert.doesNotThrow(() => createSheetRootWith(rows, { hours: Record.column.quantity(Booked, { each: "lines", read, write }) }, OPTIONS, { recordKinds: true }));
        const byText = East.function([Hours, StringType, DateTimeType], OptionType(FloatType), () => none);
        assert.throws(() => createSheetRootWith(rows, { hours: Record.column.quantity(Booked, { each: "lines", read: byText, write }) }, OPTIONS, { recordKinds: true }),
            /^Error: Sheet: column "hours" has a `read` over \(Dict, String, DateTime\) — it reads its field "hours" \(Dict\), the member's key \(Integer\) and the day \(DateTime\)$/);
    });
});

describe("a register keyed by any type refuses", () => {
    const rows = East.value(STATIONS, ArrayType(Station));

    test("a column holding its key on a field of another type, or a projection returning another, naming the column, the register's key type and what holds the value", () => {
        const Labelled = StructType({ id: StringType, label: StringType });
        assert.throws(() => createSheetRootWith(East.value([], ArrayType(Labelled)), { label: Record.column.enum(Labelled, "lines") }, STATION_OPTIONS, { recordKinds: true }),
            /^Error: Sheet: enum column "label" holds a key of the register "lines", keyed by Integer — it sits on a field of that type, or its Option, and "label" holds String$/);
        const byId = { value: (s: ExprType<typeof Station>) => s.id } as never;
        assert.throws(() => createSheetRootWith(rows, { line: Record.column.reference(Station, "lines", byId) }, STATION_OPTIONS, { recordKinds: true }),
            /^Error: Sheet: reference column "line" holds a key of the register "lines", keyed by Integer — its `value` projection returns one of that type, or its Option, and it returns String$/);
    });

    test("a fill provider or an options rule in another type than the register's keys", () => {
        const Ctx = Sheet.Types.DraftContext(Station);
        const byText = East.function([Ctx], OptionType(Sheet.Types.Fill(StringType)), () => none);
        assert.throws(() => createSheetRootWith(rows, { line: Record.column.enum(Station, "lines", { fill: [byText] }) }, STATION_OPTIONS, { recordKinds: true }),
            /column "line" fill provider #1 returns the wrong type — it must return Option<\{ value: Integer, meta: String \}>/);
        const textKeys = East.function([Ctx], OptionType(ArrayType(StringType)), () => none);
        assert.throws(() => createSheetRootWith(rows, { line: Record.column.enum(Station, "lines", { options: textKeys }) }, STATION_OPTIONS, { recordKinds: true }),
            /column "line" options rule returns the wrong type — it must return Option<Array<Integer>>/);
    });

    test("a concat of registers keyed by two types, naming both", () => {
        const byName = Record.register.members(East.value(["Spare"], ArrayType(StringType)), { kind: "spare", key: (s) => s, label: (s) => s });
        assert.throws(() => Record.register.concat([STATION_OPTIONS.registers.lines, byName]),
            /^Error: Sheet\.register\.concat: register 1 is keyed by \.Integer and register 2 by \.String — the members of one register share one key type, which a column over it holds$/);
    });

    test("a `key` of no type a Dict is keyed by", () => {
        const Crew = StructType({ names: ArrayType(StringType) });
        assert.throws(() => Record.register.members(East.value([{ names: ["A"] }], ArrayType(Crew)), { kind: "crew", key: (c) => c.names, label: () => "" }),
            /^Error: Sheet\.register\.members: "crew"'s `key` returns \.Array .* — a member's key is of a type a Dict may be keyed by$/);
    });

    test("an action's menu over a register keyed by another type than String — a form's reference asks for one", () => {
        const Move = VariantType({ moved: StringType, kept: NullType });
        const Job = StructType({ id: StringType, move: OptionType(Move) });
        const moves = Sheet.column.action(Job, Move, {
            cases: { moved: { label: "Move", state: "Moved", take: Sheet.action.menu({ of: "lines" }) }, kept: { label: "Keep", state: "Kept" } },
        });
        assert.throws(() => Sheet.Root(East.value([], ArrayType(Job)), { move: moves }, { id: "id", registers: { lines: STATION_OPTIONS.registers.lines } }),
            /case "moved"'s menu names register "lines", keyed by Integer — Sheet\.action\.menu\(\{ of \}\) chooses a member of a register keyed by String; ask a case holding another key with a form: Sheet\.action\.form\(\{ fields: Sheet\.field\.reference\(\{ of: "lines" \}\) \}\)$/);
    });
});
