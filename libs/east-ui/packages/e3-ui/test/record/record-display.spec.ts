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
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, DictType, East, FloatType, NullType, OptionType, StringType, StructType, VariantType,
    decodeBeast2For, encodeBeast2For, equalFor, none, printFor, some, variant, type ExprType, type ValueTypeOf,
} from "@elaraai/east";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import { Data, Record, RecordPayloadType, Sheet, SheetInspectorPaneType, buildInspectorPane, createSheetBuild, createSheetRootWith, deriveManifest } from "@elaraai/e3-ui/internal";
import { refusingPlatform } from "../refusing-platform.js";
import * as ex from "./record-display.examples.js";

describeEast("Record — display cells (east-workspace#1726)", test => {
    Assert.examples(test, {
        recordTrace: ex.recordTrace,
        recordSparkline: ex.recordSparkline,
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
        for (const example of [ex.recordTrace, ex.recordSparkline]) {
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

    test("a domain whose max is not past its min", () => {
        assert.match(refusal({ load: Record.column.trace(Unit, { domain: [40, 0] }) }),
            /^Sheet: column "load" has the domain \[40, 0\] — one scale for every row runs from its min to a max past it$/);
        assert.match(refusal({ load: Record.column.trace(Unit, { domain: [10, 10] }) }), /has the domain \[10, 10\]/);
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
        })), /^Error: Record: column "load" has the domain \[5, 1\] — one scale for every row runs from its min to a max past it$/);
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
            /^Sheet: column "load" has the domain \[5, 5\] — one scale for every row runs from its min to a max past it$/);
        assert.match(refusal({ name: Record.column.sparkline(Unit) as never }),
            /^Sheet: sparkline column "name" must sit on an Array<Float> or Option<Array<Float>> field, or read one through `value` — got String$/);
        assert.throws(() => East.function([], Sheet.Types.Root, ($) => {
            const rows = $.const(UNITS, ArrayType(Unit));
            return Sheet.Root(rows, { name: Sheet.column.text(Unit), load: Record.column.sparkline(Unit) } as never, { id: "id" });
        }), /^Error: Sheet: column "load" is a sparkline column, which a Record draws and a Sheet does not — show a system of records' rows with <Record>$/);
    });
});
