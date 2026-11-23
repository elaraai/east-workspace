/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Record's display cells (east-workspace#1726): the examples; a trace
 * column (east-workspace#1728) — its kind on the wire, Trace's own parts and
 * its words for no series; its cell a `Series` of the row's numbers, on the
 * field, derived through `value`, and on an Option of one; its field in
 * Details read only; an action's `updates` setting the series through its
 * cell, and the cell read back into the field; and every refusal, naming the
 * column — the Sheet's among them, which draws no trace. A sparkline column
 * (east-workspace#1729) the same: its kind, its cells, Details, its refusals.
 * A meter column (east-workspace#1730): its kind naming the cells its max and
 * tone are read into, those read at the day over a row's entry and its draft —
 * each meter apart, one whose max or tone throws holding why — its cells,
 * Details, and its refusals.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, DateTimeType, DictType, East, FloatType, NullType, OptionType, StringType, StructType, VariantType,
    decodeBeast2For, encodeBeast2For, equalFor, none, printFor, some, variant, type ExprType, type ValueTypeOf,
} from "@elaraai/east";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import { StatusValueType } from "@elaraai/east-ui";
import {
    Data, Record, RecordPayloadType, Sheet, SheetInspectorPaneType, SheetReadFromType, buildInspectorPane, createSheetBuild, createSheetRootWith, deriveManifest,
} from "@elaraai/e3-ui/internal";
import { refusingPlatform } from "../refusing-platform.js";
import * as ex from "./record-display.examples.js";

describeEast("Record — display cells (east-workspace#1726)", test => {
    Assert.examples(test, {
        recordTrace: ex.recordTrace,
        recordSparkline: ex.recordSparkline,
        recordMeter: ex.recordMeter,
    });
}, { platformFns: TestImpl });

// ── Fixtures: three units, a series each, keyed by their id ──

/** What a unit's plan is: planned, or planned again — whose action books a new load. */
const UnitPlan = VariantType({ planned: NullType, replanned: NullType });
const Unit = StructType({
    id: StringType, name: StringType, load: ArrayType(FloatType), weeks: ArrayType(ex.PlannedWeek), history: OptionType(ArrayType(FloatType)), plan: OptionType(UnitPlan),
});
type UnitValue = ValueTypeOf<typeof Unit>;
const UNITS: UnitValue[] = [
    { id: "U-1", name: "Lathe 1", load: [32, 34, 36], weeks: [{ week: "W41", hours: 24 }, { week: "W42", hours: 25.5 }], history: some([30, 31]), plan: none },
    { id: "U-2", name: "Lathe 2", load: [], weeks: [], history: none, plan: none },
    { id: "U-3", name: "Mill 1", load: [44, 40], weeks: [], history: some([]), plan: none },
];
const WEEKS = ["W41", "W42", "W43"];
/** The load a replan books. */
const REPLANNED = [8, 16, 24];

const COLUMNS = {
    name:    Record.column.title(Unit, { header: "Unit" }),
    load:    Record.column.trace(Unit, { header: "Load", now: 2n, axis: WEEKS, scale: "diverge", future: "hatch", domain: [0, 40] }),
    weeks:   Record.column.trace(Unit, { header: "Hours", value: (u) => u.weeks.map((_$, w) => w.hours) }),
    history: Record.column.trace(Unit, { header: "Last year", absent: "no history" }),
    plan:    Record.column.action(Unit, UnitPlan, {
        header: "Plan",
        cases: {
            planned: { label: "Plan", state: "Planned" },
            // A replan books a new load: its series, written through the trace's cell.
            replanned: { label: "Replan", state: "Replanned", updates: () => ({ row: Record.patch(Unit, { load: East.value(REPLANNED, ArrayType(FloatType)) }) }) },
        },
    }),
};

type Root = ValueTypeOf<typeof Sheet.Types.Root>;
type Cell = ValueTypeOf<typeof Sheet.Types.Cell>;
const Kind = Sheet.Types.ColumnKind;
const sameKind = equalFor(Kind);
const sameCell = equalFor(Sheet.Types.Cell);
const printKind = printFor(Kind);
const printCell = printFor(Sheet.Types.Cell);

/** The units' root, inline, with the Record's kinds. */
const ROOT: Root = East.compile(East.function([], Sheet.Types.Root, ($) => {
    const rows = $.const(UNITS, ArrayType(Unit));
    return createSheetRootWith(rows, COLUMNS, { id: "id" }, { recordKinds: true });
}), [])();

/** A column of the root, by its key. */
function columnOf(key: string): Root["columns"][number] {
    return ROOT.columns.find((c) => equalFor(StringType)(c.key, key)) ?? assert.fail(`no column ${key}`);
}

/** The root's inline rows. */
function rowsOf(): ValueTypeOf<typeof Sheet.Types.Rows> {
    if (ROOT.rows.type !== "inline") assert.fail(`expected inline rows, got ${ROOT.rows.type}`);
    return ROOT.rows.value;
}

/** A row's cell, by the row's id and the cell's key. */
function cellOf(id: string, key: string): Cell {
    const row = rowsOf().find((r) => equalFor(StringType)(r.id, id)) ?? assert.fail(`no row ${id}`);
    return row.cells.get(key) ?? variant("Null", null);
}

/** What building the units' root with these columns throws; `""` where it builds. */
function refusal(columns: Record<string, unknown>): string {
    try {
        East.function([], Sheet.Types.Root, ($) => {
            const rows = $.const(UNITS, ArrayType(Unit));
            return createSheetRootWith(rows, { name: COLUMNS.name, ...columns }, { id: "id" }, { recordKinds: true });
        });
        return "";
    } catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
}

describe("the display examples", () => {
    test("each declares the one record its Saves commit to: the machines'", () => {
        for (const example of [ex.recordTrace, ex.recordSparkline, ex.recordMeter]) {
            assert.deepEqual([...new Set(deriveManifest(example.fn).records)], [ex.recordDisplayMachines.name]);
        }
    });
});

describe("a trace column on the wire", () => {
    test("its kind carries Trace's own parts — now, axis, scale, future and the domain every row shares — and its words for no series", () => {
        const load = columnOf("load");
        assert.ok(sameKind(load.kind, variant("trace", {
            now: some(2n), axis: some(WEEKS), scale: variant("diverge", null), future: variant("hatch", null), domain: some({ min: 0, max: 40 }), absent: none,
        })), printKind(load.kind));
        // Given none of them: brand, ghosted, each row over its own range.
        const history = columnOf("history");
        assert.ok(sameKind(history.kind, variant("trace", {
            now: none, axis: none, scale: variant("brand", null), future: variant("ghost", null), domain: none, absent: some("no history"),
        })), printKind(history.kind));
    });

    test("is read only, whatever its field: the series, a `value`'s, an Option's", () => {
        for (const key of ["load", "weeks", "history"]) assert.equal(columnOf(key).editable, false, key);
    });

    test("its cell is a Series of the row's numbers — an empty one where it has none, and Null where its Option is none", () => {
        assert.ok(sameCell(cellOf("U-1", "load"), variant("Series", [32, 34, 36])), printCell(cellOf("U-1", "load")));
        assert.ok(sameCell(cellOf("U-2", "load"), variant("Series", [])), printCell(cellOf("U-2", "load")));
        assert.ok(sameCell(cellOf("U-1", "history"), variant("Series", [30, 31])), printCell(cellOf("U-1", "history")));
        assert.ok(sameCell(cellOf("U-2", "history"), variant("Null", null)), printCell(cellOf("U-2", "history")));
        assert.ok(sameCell(cellOf("U-3", "history"), variant("Series", [])), printCell(cellOf("U-3", "history")));
    });

    test("a `value` derives its series from another field: a unit's weeks, their hours", () => {
        assert.ok(sameCell(cellOf("U-1", "weeks"), variant("Series", [24, 25.5])), printCell(cellOf("U-1", "weeks")));
        assert.ok(sameCell(cellOf("U-2", "weeks"), variant("Series", [])), printCell(cellOf("U-2", "weeks")));
        // An Option it derives: none, the blank cell.
        const Maybe = StructType({ id: StringType, name: StringType, history: OptionType(ArrayType(FloatType)) });
        const root: Root = East.compile(East.function([], Sheet.Types.Root, ($) => {
            const rows = $.const([{ id: "A", name: "A", history: some([1, 2]) }, { id: "B", name: "B", history: none }], ArrayType(Maybe));
            return createSheetRootWith(rows, {
                name: Record.column.title(Maybe),
                history: Record.column.trace(Maybe, { value: (m) => m.history.match({
                    some: (_$, h) => East.value(some(h.map((_$2, v) => v.multiply(2.0))), OptionType(ArrayType(FloatType))),
                    none: () => East.value(none, OptionType(ArrayType(FloatType))),
                }) }),
            }, { id: "id" }, { recordKinds: true });
        }), [])();
        if (root.rows.type !== "inline") assert.fail(root.rows.type);
        const Cells = ArrayType(Sheet.Types.Cell);
        const cells = root.rows.value.map((r) => r.cells.get("history") ?? variant("Null", null));
        assert.ok(equalFor(Cells)(cells, [variant("Series", [2, 4]), variant("Null", null)]), printFor(Cells)(cells));
    });

    test("Details shows its field read only, through its column — the series' field and a `value`'s alike", () => {
        const pane = East.compile(East.function([], OptionType(SheetInspectorPaneType), ($) => {
            const rows = $.const(UNITS, ArrayType(Unit));
            const built = createSheetBuild(rows, COLUMNS, { id: "id" }, { recordKinds: true });
            return buildInspectorPane(true, built, { fields: undefined, groupFields: undefined, id: "id" });
        }), [])();
        if (pane.type !== "some") assert.fail("no inspector pane");
        const fields = pane.value.forms.row.fields;
        for (const key of ["load", "weeks", "history"]) {
            const field = fields.find((f) => equalFor(ArrayType(StringType))(f.spec.path, [key]));
            if (field === undefined) assert.fail(`no field ${key}`);
            assert.equal(field.spec.editor.type, "readonly", key);
            assert.ok(equalFor(OptionType(StringType))(field.column, some(key)), key);
        }
    });
});

describe("an action's updates set a trace's series through its cell (T9)", () => {
    test("Replan's updates land in the load's cell as a Series, and the cell reads back into the load", () => {
        const plan = columnOf("plan").kind;
        if (plan.type !== "action") assert.fail(plan.type);
        const replanned = plan.value.cases.find((c) => equalFor(StringType)(c.case, "replanned")) ?? assert.fail("no replanned case");
        const rows = rowsOf();
        const row = rows[0]!;
        const context = {
            drafts: new Map(), rowIndex: 0n, rowId: row.id, offset: 0n, line: none, row: row.cells, rows, rowsOffset: 0n, partial: false, driver: none,
            today: new Date("2026-11-23T00:00:00Z"),
        } as ValueTypeOf<typeof Sheet.Types.WireContext>;
        const out = replanned.updates.value!(encodeBeast2For(NullType)(null), context, new Date("2026-11-23T09:00:00Z"));
        const Cells = DictType(StringType, Sheet.Types.Cell);
        assert.ok(equalFor(Cells)(out.row, new Map([["load", variant("Series", REPLANNED)]]) as never), printFor(Cells)(out.row as never));
        // The cell the action wrote, read back into the row's draft: the load, the new series.
        const Draft = Sheet.Types.Draft(Unit);
        const wire = encodeBeast2For(Sheet.Types.Row)({ ...row, cells: new Map([...row.cells, ...out.row]) });
        const base = {
            id: variant("value", "U-1"), name: variant("value", "Lathe 1"), load: variant("value", [32, 34, 36]), weeks: variant("value", UNITS[0]!.weeks),
            history: variant("value", some([30, 31])), plan: variant("value", none),
        };
        const draft = decodeBeast2For(Draft)(ROOT.editing.decode(wire, some(encodeBeast2For(Draft)(base as never)), none, new Date("2026-11-23T00:00:00Z")));
        assert.ok(equalFor(Draft.fields.load)(draft.load, variant("value", REPLANNED)), printFor(Draft.fields.load)(draft.load));
    });
});

describe("refusals, each naming the column", () => {
    test("the columns as they stand build", () => {
        assert.equal(refusal({ load: COLUMNS.load, weeks: COLUMNS.weeks, history: COLUMNS.history }), "");
    });

    test("an edit of any kind: editable, a fill, options", () => {
        assert.match(refusal({ load: Record.column.trace(Unit, { editable: false } as never) }),
            /^Sheet: column "load" is a trace column, which shows its series and is read only — it takes no `editable`$/);
        assert.match(refusal({ load: Record.column.trace(Unit, { fill: [] } as never) }),
            /^Sheet: column "load" is a trace column, which shows its series and is read only — it takes no `fill`$/);
        assert.match(refusal({ load: Record.column.trace(Unit, { options: East.function([Sheet.Types.Context(Unit)], OptionType(ArrayType(StringType)), () => none) } as never) }),
            /^Sheet: column "load" is a trace column, which shows its series and is read only — it takes no `options`$/);
    });

    test("columns from data: a trace draws one row's series", () => {
        assert.match(refusal({ load: Record.column.trace(Unit, { each: { mon: "Mon" } } as never) }),
            /^Sheet: column "load" is a trace column, which draws one row's series — it makes no columns from data, so give it no `each`$/);
    });

    test("the categorical scale — its word or its case — which colours tracks apart, and a cell has one", () => {
        const refused = /^Sheet: trace column "load" is drawn `categorical`, which colours a Trace's tracks apart — a cell has one: give it "brand" or "diverge"$/;
        assert.match(refusal({ load: Record.column.trace(Unit, { scale: "categorical" } as never) }), refused);
        assert.match(refusal({ load: Record.column.trace(Unit, { scale: variant("categorical", null) }) }), refused);
    });

    test("a domain that draws no scale: its max not past its min, or a bound that is no finite number", () => {
        assert.match(refusal({ load: Record.column.trace(Unit, { domain: [40, 0] }) }),
            /^Sheet: column "load" has the domain \[40, 0\] — one scale for every row runs from its min to a max past it, both finite numbers$/);
        assert.match(refusal({ load: Record.column.trace(Unit, { domain: [10, 10] }) }), /has the domain \[10, 10\]/);
        // A bound no finite number draws no scale: NaN, which East's order stands past every number, and an infinity.
        assert.match(refusal({ load: Record.column.trace(Unit, { domain: [0, NaN] }) }), /^Sheet: column "load" has the domain \[0, NaN\] — .*, both finite numbers$/);
        assert.match(refusal({ load: Record.column.trace(Unit, { domain: [-Infinity, 40] }) }), /has the domain \[-Infinity, 40\]/);
        assert.match(refusal({ load: Record.column.trace(Unit, { domain: [0, Infinity] }) }), /has the domain \[0, Infinity\]/);
    });

    test("a field that holds no series, and a `value` that derives none", () => {
        assert.match(refusal({ name: Record.column.trace(Unit) as never }),
            /^Sheet: trace column "name" must sit on an Array<Float> or Option<Array<Float>> field, or read one through `value` — got String$/);
        assert.match(refusal({ weeks: Record.column.trace(Unit) as never }),
            /^Sheet: trace column "weeks" must sit on an Array<Float> or Option<Array<Float>> field, or read one through `value` — got Array<\{ week: String, hours: Float \}>$/);
        assert.match(refusal({ load: Record.column.trace(Unit, { value: (u: ExprType<typeof Unit>) => u.name } as never) }),
            /^Sheet: column "load" is a trace column whose `value` projection returns String — a trace column's projection must return Array<Float> or its Option$/);
    });

    test("an editor hint for its field in Details", () => {
        assert.throws(() => East.function([], OptionType(SheetInspectorPaneType), ($) => {
            const rows = $.const(UNITS, ArrayType(Unit));
            const built = createSheetBuild(rows, { name: COLUMNS.name, load: COLUMNS.load }, { id: "id" }, { recordKinds: true });
            return buildInspectorPane(true, built, { fields: { load: Record.field.text() }, groupFields: undefined, id: "id" });
        }), /^Error: Sheet: `fields\.load` gives its field an editor, but its column is a trace column, which shows its series — hint it Sheet\.field\.readonly\(\) or Sheet\.field\.hidden\(\), or give it a label or help alone$/);
    });

    test("the column on a Sheet, which draws no trace", () => {
        assert.throws(() => East.function([], Sheet.Types.Root, ($) => {
            const rows = $.const(UNITS, ArrayType(Unit));
            return Sheet.Root(rows, { name: Sheet.column.text(Unit), load: Record.column.trace(Unit) } as never, { id: "id" });
        }), /^Error: Sheet: column "load" is a trace column, which a Record draws and a Sheet does not — show a system of records' rows with <Record>$/);
    });

    test("on a Record, in the Record's words", () => {
        assert.throws(() => East.function([], RecordPayloadType, () => Record.Payload({
            record: Record.bind(ex.recordDisplayMachines), window: Data.bindPaged(ex.recordDisplayMachines), edits: { insertRows: false },
            columns: { name: Record.column.title(ex.Machine), load: Record.column.trace(ex.Machine, { domain: [5, 1] }) },
        })), /^Error: Record: column "load" has the domain \[5, 1\] — one scale for every row runs from its min to a max past it, both finite numbers$/);
    });

    test("a domain's bounds an expression gives are the renderer's to read: a max not past its min places nothing, each row over its own", () => {
        const built = East.compile(East.function([FloatType], Sheet.Types.Root, ($, top) => {
            const rows = $.const(UNITS, ArrayType(Unit));
            return createSheetRootWith(rows, { name: COLUMNS.name, load: Record.column.trace(Unit, { domain: [0, top] }) }, { id: "id" }, { recordKinds: true });
        }), refusingPlatform);
        const kind = (built(-1) as Root).columns.find((c) => equalFor(StringType)(c.key, "load"))!.kind;
        if (kind.type !== "trace") assert.fail(kind.type);
        assert.ok(equalFor(Sheet.Types.ColumnKind.cases.trace.fields.domain)(kind.value.domain, some({ min: 0, max: -1 })));
    });
});

// ── Sparkline (east-workspace#1729) ──

const SPARKLINES = {
    name:    COLUMNS.name,
    load:    Record.column.sparkline(Unit, { header: "Load", type: "area" }),
    weeks:   Record.column.sparkline(Unit, { header: "Hours", value: (u) => u.weeks.map((_$, w) => w.hours) }),
    history: Record.column.sparkline(Unit, { header: "Last year", domain: [0, 50], absent: "no history" }),
};

/** The units' root with the sparkline columns. */
const SPARKLINE_ROOT: Root = East.compile(East.function([], Sheet.Types.Root, ($) => {
    const rows = $.const(UNITS, ArrayType(Unit));
    return createSheetRootWith(rows, SPARKLINES, { id: "id" }, { recordKinds: true });
}), [])();

/** A sparkline column, by its key. */
const sparklineColumn = (key: string) => SPARKLINE_ROOT.columns.find((c) => equalFor(StringType)(c.key, key)) ?? assert.fail(`no column ${key}`);

/** A sparkline row's cell, by the row's id and the cell's key. */
function sparklineCell(id: string, key: string): Cell {
    if (SPARKLINE_ROOT.rows.type !== "inline") assert.fail(SPARKLINE_ROOT.rows.type);
    const row = SPARKLINE_ROOT.rows.value.find((r) => equalFor(StringType)(r.id, id)) ?? assert.fail(`no row ${id}`);
    return row.cells.get(key) ?? variant("Null", null);
}

describe("a sparkline column on the wire (east-workspace#1729)", () => {
    test("its kind carries Sparkline's own type and the one vertical scale every row shares, and its words for no series", () => {
        assert.ok(sameKind(sparklineColumn("load").kind, variant("sparkline", { type: variant("area", null), domain: none, absent: none })), printKind(sparklineColumn("load").kind));
        assert.ok(sameKind(sparklineColumn("history").kind, variant("sparkline", { type: variant("line", null), domain: some({ min: 0, max: 50 }), absent: some("no history") })),
            printKind(sparklineColumn("history").kind));
    });

    test("is read only, and its cell a Series: on the field, an Option's — none, the blank cell — and a `value`'s", () => {
        for (const key of ["load", "weeks", "history"]) assert.equal(sparklineColumn(key).editable, false, key);
        assert.ok(sameCell(sparklineCell("U-1", "load"), variant("Series", [32, 34, 36])), printCell(sparklineCell("U-1", "load")));
        assert.ok(sameCell(sparklineCell("U-2", "history"), variant("Null", null)), printCell(sparklineCell("U-2", "history")));
        assert.ok(sameCell(sparklineCell("U-1", "weeks"), variant("Series", [24, 25.5])), printCell(sparklineCell("U-1", "weeks")));
    });

    test("Details shows its field read only, through its column", () => {
        const pane = East.compile(East.function([], OptionType(SheetInspectorPaneType), ($) => {
            const rows = $.const(UNITS, ArrayType(Unit));
            const built = createSheetBuild(rows, SPARKLINES, { id: "id" }, { recordKinds: true });
            return buildInspectorPane(true, built, { fields: undefined, groupFields: undefined, id: "id" });
        }), [])();
        if (pane.type !== "some") assert.fail("no inspector pane");
        const field = pane.value.forms.row.fields.find((f) => equalFor(ArrayType(StringType))(f.spec.path, ["load"]));
        if (field === undefined) assert.fail("no load field");
        assert.equal(field.spec.editor.type, "readonly");
    });

    test("refused, naming the column: an edit, columns from data, a backward domain, a field that holds no series, and the column on a Sheet", () => {
        assert.match(refusal({ load: Record.column.sparkline(Unit, { editable: false } as never) }),
            /^Sheet: column "load" is a sparkline column, which shows its series and is read only — it takes no `editable`$/);
        assert.match(refusal({ load: Record.column.sparkline(Unit, { each: { mon: "Mon" } } as never) }),
            /^Sheet: column "load" is a sparkline column, which draws one row's series — it makes no columns from data, so give it no `each`$/);
        assert.match(refusal({ load: Record.column.sparkline(Unit, { domain: [5, 5] }) }),
            /^Sheet: column "load" has the domain \[5, 5\] — one scale for every row runs from its min to a max past it, both finite numbers$/);
        assert.match(refusal({ load: Record.column.sparkline(Unit, { domain: [NaN, 50] }) }), /has the domain \[NaN, 50\]/);
        assert.match(refusal({ name: Record.column.sparkline(Unit) as never }),
            /^Sheet: sparkline column "name" must sit on an Array<Float> or Option<Array<Float>> field, or read one through `value` — got String$/);
        assert.throws(() => East.function([], Sheet.Types.Root, ($) => {
            const rows = $.const(UNITS, ArrayType(Unit));
            return Sheet.Root(rows, { name: Sheet.column.text(Unit), load: Record.column.sparkline(Unit) } as never, { id: "id" });
        }), /^Error: Sheet: column "load" is a sparkline column, which a Record draws and a Sheet does not — show a system of records' rows with <Record>$/);
    });
});

// ── Meter (east-workspace#1730) ──

/** A bay of the floor: this week's hours booked and the hours it can run, how much of its time it ran, where it knows, and its good pieces of those made. */
const Bay = StructType({ id: StringType, name: StringType, booked: FloatType, capacity: FloatType, used: OptionType(FloatType), good: FloatType, made: FloatType });
type BayValue = ValueTypeOf<typeof Bay>;
const BAYS: BayValue[] = [
    { id: "B-1", name: "Bay 1", booked: 31.5, capacity: 40, used: some(92), good: 96, made: 100 },
    { id: "B-2", name: "Bay 2", booked: 44, capacity: 40, used: none, good: 45, made: 50 },
    { id: "B-3", name: "Bay 3", booked: 20, capacity: 0, used: some(30), good: 0, made: 10 },
];

const METERS = {
    name:   Record.column.title(Bay, { header: "Bay" }),
    // Against the max the row holds; booked past it, danger.
    booked: Record.column.meter(Bay, {
        header: "Booked", max: (b) => b.capacity,
        tone: (b) => b.booked.greater(b.capacity).ifElse((_$) => variant("danger", null), (_$) => variant("neutral", null)),
    }),
    // One max for every row, the default 100; no tone.
    used:   Record.column.meter(Bay, { header: "Used", absent: "not measured" }),
    // A share two fields make, through `value`, of one max for every row.
    good:   Record.column.meter(Bay, { header: "Yield", value: (b) => b.good.divide(b.made), max: 1 }),
};

/** The bays' root with the meter columns. */
const METER_ROOT: Root = East.compile(East.function([], Sheet.Types.Root, ($) => {
    const rows = $.const(BAYS, ArrayType(Bay));
    return createSheetRootWith(rows, METERS, { id: "id" }, { recordKinds: true });
}), [])();

/** A meter column, by its key. */
const meterColumn = (key: string) => METER_ROOT.columns.find((c) => equalFor(StringType)(c.key, key)) ?? assert.fail(`no column ${key}`);

/** A bay's own cell, by the bay's id and the cell's key. */
function bayCell(id: string, key: string): Cell {
    if (METER_ROOT.rows.type !== "inline") assert.fail(METER_ROOT.rows.type);
    const row = METER_ROOT.rows.value.find((r) => equalFor(StringType)(r.id, id)) ?? assert.fail(`no row ${id}`);
    return row.cells.get(key) ?? variant("Null", null);
}

const Cells = DictType(StringType, Sheet.Types.Cell);
const BayDraft = Sheet.Types.Draft(Bay);
const DAY = new Date("2026-11-23T00:00:00Z");

/** A bay's cells at the day, read over its entry or its draft, as the renderer reads them: what follows the draft. */
function cellsAtDay(from: ValueTypeOf<typeof SheetReadFromType>): ValueTypeOf<typeof Cells> {
    if (METER_ROOT.cellsAt.type !== "some") assert.fail("the root reads no cells at the day");
    return METER_ROOT.cellsAt.value(from, DAY);
}

/** A bay's draft: each field its value, `capacity` as given — or missing. */
function bayDraft(bay: BayValue, capacity: number | "missing"): Uint8Array {
    return encodeBeast2For(BayDraft)({
        id: variant("value", bay.id), name: variant("value", bay.name), booked: variant("value", bay.booked),
        capacity: capacity === "missing" ? variant("missing", null) : variant("value", capacity),
        used: variant("value", bay.used), good: variant("value", bay.good), made: variant("value", bay.made),
    } as never);
}

/** What building the bays' root with these columns throws; `""` where it builds. */
function bayRefusal(columns: Record<string, unknown>): string {
    try {
        East.function([], Sheet.Types.Root, ($) => {
            const rows = $.const(BAYS, ArrayType(Bay));
            return createSheetRootWith(rows, { name: METERS.name, ...columns }, { id: "id" }, { recordKinds: true });
        });
        return "";
    } catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
}

describe("a meter column on the wire (east-workspace#1730)", () => {
    test("its kind names the cells a row's max and its tone's name are read into — no tone, none — and its words for no value", () => {
        assert.ok(sameKind(meterColumn("booked").kind, variant("meter", { max: "$max:booked", tone: some("$tone:booked"), absent: none })), printKind(meterColumn("booked").kind));
        assert.ok(sameKind(meterColumn("used").kind, variant("meter", { max: "$max:used", tone: none, absent: some("not measured") })), printKind(meterColumn("used").kind));
    });

    test("is read only, and its cell the value's Float: on the field, an Option's none the blank cell, and a `value`'s", () => {
        for (const key of ["booked", "used", "good"]) assert.equal(meterColumn(key).editable, false, key);
        assert.ok(sameCell(bayCell("B-1", "booked"), variant("Float", 31.5)), printCell(bayCell("B-1", "booked")));
        assert.ok(sameCell(bayCell("B-2", "used"), variant("Null", null)), printCell(bayCell("B-2", "used")));
        assert.ok(sameCell(bayCell("B-1", "good"), variant("Float", 0.96)), printCell(bayCell("B-1", "good")));
    });

    test("a row's max and its tone are read at the day over its entry: the row's own, one for every row, or 100 — and no tone where the column has none", () => {
        const entry = (bay: BayValue) => cellsAtDay(variant("entry", encodeBeast2For(Bay)(bay)));
        const first = entry(BAYS[0]!);
        assert.ok(equalFor(Cells)(first, new Map<string, Cell>([
            ["$max:booked", variant("Float", 40)], ["$tone:booked", variant("String", "neutral")],
            ["$max:used", variant("Float", 100)], ["$max:good", variant("Float", 1)],
        ])), printFor(Cells)(first));
        // Booked past its capacity: danger.
        assert.ok(sameCell(entry(BAYS[1]!).get("$tone:booked")!, variant("String", "danger")));
    });

    test("they follow the row's draft (M9): its capacity edited, its booked max and tone are read over it — and over a draft not yet whole, not at all", () => {
        const drafted = cellsAtDay(variant("draft", bayDraft(BAYS[0]!, 30)));
        assert.ok(sameCell(drafted.get("$max:booked")!, variant("Float", 30)), printFor(Cells)(drafted));
        assert.ok(sameCell(drafted.get("$tone:booked")!, variant("String", "danger")), printFor(Cells)(drafted));
        const partial = cellsAtDay(variant("draft", bayDraft(BAYS[0]!, "missing")));
        assert.deepEqual([...partial.keys()], []);
    });

    test("each meter is read apart: one whose max or tone throws over a row holds the error's message under its max — the row's marks and its other meters read all the same", () => {
        // Each bay's limit and its yield's tone, by its id: Bay 3 has neither, and its reads of them throw.
        const LIMITS = new Map([["B-1", 40], ["B-2", 50]]);
        const TONES = new Map([["B-1", variant("info", null)], ["B-2", variant("info", null)]]);
        const root: Root = East.compile(East.function([], Sheet.Types.Root, ($) => {
            const rows = $.const(BAYS, ArrayType(Bay));
            return createSheetRootWith(rows, {
                name: Record.column.text(Bay, {
                    header: "Bay", mark: East.function([Bay, DateTimeType], OptionType(Record.Types.Mark), ($2) => $2.const(some(variant("note", "checked")), OptionType(Record.Types.Mark))),
                }),
                booked: METERS.booked,
                used: Record.column.meter(Bay, { header: "Used", max: (b) => East.value(LIMITS, DictType(StringType, FloatType)).get(b.id) }),
                good: Record.column.meter(Bay, {
                    header: "Yield", value: (b) => b.good.divide(b.made), max: 1, tone: (b) => East.value(TONES, DictType(StringType, StatusValueType)).get(b.id),
                }),
            }, { id: "id" }, { recordKinds: true });
        }), [])();
        if (root.cellsAt.type !== "some") assert.fail("the root reads no cells at the day");
        const read = (bay: BayValue) => root.cellsAt.type === "some" ? root.cellsAt.value(variant("entry", encodeBeast2For(Bay)(bay)), DAY) : assert.fail("no cellsAt");
        // Bay 3: its used's max throws, and its yield's tone — each holds why under its max, and no tone; its mark and
        // its booked meter read as they do anywhere.
        const third = read(BAYS[2]!);
        const missing = variant("String", 'Dict does not contain key "B-3"');
        assert.ok(equalFor(Cells)(third, new Map<string, Cell>([
            ["$mark:name", variant("String", "checked")], ["$lock:name", variant("Boolean", false)],
            ["$max:booked", variant("Float", 0)], ["$tone:booked", variant("String", "danger")],
            ["$max:used", missing], ["$max:good", missing],
        ])), printFor(Cells)(third));
        // Bay 1 has both: every meter read.
        const first = read(BAYS[0]!);
        assert.ok(equalFor(Cells)(first, new Map<string, Cell>([
            ["$mark:name", variant("String", "checked")], ["$lock:name", variant("Boolean", false)],
            ["$max:booked", variant("Float", 40)], ["$tone:booked", variant("String", "neutral")],
            ["$max:used", variant("Float", 40)], ["$max:good", variant("Float", 1)], ["$tone:good", variant("String", "info")],
        ])), printFor(Cells)(first));
    });

    test("Details shows its field read only, through its column", () => {
        const pane = East.compile(East.function([], OptionType(SheetInspectorPaneType), ($) => {
            const rows = $.const(BAYS, ArrayType(Bay));
            const built = createSheetBuild(rows, METERS, { id: "id" }, { recordKinds: true });
            return buildInspectorPane(true, built, { fields: undefined, groupFields: undefined, id: "id" });
        }), [])();
        if (pane.type !== "some") assert.fail("no inspector pane");
        const fields = pane.value.forms.row.fields;
        for (const key of ["booked", "used", "good"]) {
            const field = fields.find((f) => equalFor(ArrayType(StringType))(f.spec.path, [key]));
            if (field === undefined) assert.fail(`no field ${key}`);
            assert.equal(field.spec.editor.type, "readonly", key);
        }
    });

    test("refused, naming the column: an edit, columns from data, a field that holds no Float, a `value` that derives none, and the column on a Sheet", () => {
        assert.match(bayRefusal({ booked: Record.column.meter(Bay, { editable: false } as never) }),
            /^Sheet: column "booked" is a meter column, which shows its value against its max and is read only — it takes no `editable`$/);
        assert.match(bayRefusal({ booked: Record.column.meter(Bay, { fill: [] } as never) }), /it takes no `fill`$/);
        assert.match(bayRefusal({ booked: Record.column.meter(Bay, { each: { mon: "Mon" } } as never) }),
            /^Sheet: column "booked" is a meter column, which draws one row's value against its max — it makes no columns from data, so give it no `each`$/);
        assert.match(bayRefusal({ name: Record.column.meter(Bay) as never }),
            /^Sheet: meter column "name" must sit on a Float or Option<Float> field, or read one through `value` — got String$/);
        assert.match(bayRefusal({ booked: Record.column.meter(Bay, { value: (b: ExprType<typeof Bay>) => b.name } as never) }),
            /^Sheet: column "booked" is a meter column whose `value` projection returns String — a meter column's projection must return Float or its Option$/);
        assert.throws(() => East.function([], Sheet.Types.Root, ($) => {
            const rows = $.const(BAYS, ArrayType(Bay));
            return Sheet.Root(rows, { name: Sheet.column.text(Bay), booked: Record.column.meter(Bay) } as never, { id: "id" });
        }), /^Error: Sheet: column "booked" is a meter column, which a Record draws and a Sheet does not — show a system of records' rows with <Record>$/);
    });

    test("refused, naming the column: a max that is no Float, and a tone that is no status value or no function of the row", () => {
        assert.match(bayRefusal({ booked: Record.column.meter(Bay, { max: 40n } as never) }),
            /^Sheet: meter column "booked" has a `max` of Integer — it is what the bar is a share of: a Float for every row, or one over the row$/);
        assert.match(bayRefusal({ booked: Record.column.meter(Bay, { max: (b: ExprType<typeof Bay>) => b.name } as never) }), /has a `max` of String/);
        const toneRefused = /^Sheet: meter column "booked" has a `tone` returning (String|Variant) — a meter's tone is a status value: success, warning, danger, info or neutral, or a variant of some of them$/;
        assert.match(bayRefusal({ booked: Record.column.meter(Bay, { tone: (b: ExprType<typeof Bay>) => b.name } as never) }), toneRefused);
        assert.match(bayRefusal({ booked: Record.column.meter(Bay, { tone: () => variant("late", null) } as never) }), toneRefused);
        assert.match(bayRefusal({ booked: Record.column.meter(Bay, { tone: variant("danger", null) } as never) }),
            /^Sheet: meter column "booked" has a `tone` that is no function of the row — give it one returning a status value: \(row\) => …$/);
        // A tone of every case, or of some of them, builds.
        assert.equal(bayRefusal({ booked: Record.column.meter(Bay, { tone: () => East.value(variant("info", null), StatusValueType) }) }), "");
    });

    test("an editor hint for its field in Details", () => {
        assert.throws(() => East.function([], OptionType(SheetInspectorPaneType), ($) => {
            const rows = $.const(BAYS, ArrayType(Bay));
            const built = createSheetBuild(rows, { name: METERS.name, booked: METERS.booked }, { id: "id" }, { recordKinds: true });
            return buildInspectorPane(true, built, { fields: { booked: Record.field.text() }, groupFields: undefined, id: "id" });
        }), /^Error: Sheet: `fields\.booked` gives its field an editor, but its column is a meter column, which shows its value against its max — hint it Sheet\.field\.readonly\(\) or Sheet\.field\.hidden\(\), or give it a label or help alone$/);
    });
});
