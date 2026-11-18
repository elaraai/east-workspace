/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Configure tab's rules (#1672): each kind's editor, checked against its
 * kind's own type — every well a field of the kind's struct holding what the
 * well holds, every option a switch or a case of several; a well read and
 * written through its declaration for every kind; the pill a placed field
 * makes (MOD-6); the measures a field's value may take (EDT-4); what a change
 * of kind carries (EDT-8); the source a dropped visual reads (BLD-2); and what
 * an edit changed from what is saved (EDT-10).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    ArrayType, BooleanType, NullType, OptionType, StringType, equalFor, isTypeEqual, none, some, toEastTypeValue, variant,
    type EastType, type StructType, type ValueTypeOf, type VariantType,
} from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";

import { Studio } from "@elaraai/e3-ui";
import {
    StudioCellType, StudioFieldType, StudioSourceType, StudioViewType, changedParts, emptyView, fieldFits, fieldMeasures, kindEditor,
    kindOfView, mostUsedSource, movedInWell, optionSpecs, pillFields, placedFields, placedInWell, placedPill, removedFromWell, replacedInWell,
    savedKindFields, studioEditors, switchedView, wellMost, wellPills, withKindField, withWellPills, type StudioKindLiteral, type StudioWell,
} from "@elaraai/e3-ui/internal";
import * as ex from "./configure.examples.js";

const v = Studio.visual;
const viewEqual = equalFor(StudioViewType);
type View = ValueTypeOf<typeof StudioViewType>;
type Field = ValueTypeOf<typeof StudioFieldType>;

const month = v.group("ordered_at", { bucket: "month" });
const region = v.group("region");
const revenue = v.sum("revenue");
const units = v.sum("units");

/** A source's fields: a date, a text, two numbers, and a struct. */
const FIELDS: Field[] = [
    { id: "ordered_at", label: "Ordered", kind: variant("date", null), format: none },
    { id: "region", label: "Region", kind: variant("text", null), format: none },
    { id: "revenue", label: "Revenue", kind: variant("number", null), format: none },
    { id: "units", label: "Units", kind: variant("number", null), format: none },
    { id: "address", label: "Address", kind: variant("other", null), format: none },
];
const [ORDERED, REGION, REVENUE, , ADDRESS] = FIELDS as [Field, Field, Field, Field, Field];

/** Every kind, its wells full: what a well is read from and written back to. */
const FULL: { readonly [K in StudioKindLiteral]: View } = {
    kpi: v.kpi({ value: revenue, compare: v.sum("revenue", { period: "year_ago" }), trend: "ordered_at" }),
    column: v.column({ x: month, values: [revenue], split: "region", stack: "stacked" }),
    bar: v.bar({ x: region, values: [revenue, units] }),
    line: v.line({ x: month, values: [revenue], stack: "percent" }),
    area: v.area({ x: month, values: [revenue, units] }),
    combo: v.combo({ x: month, columns: [v.left(revenue)], lines: [v.right(v.count())] }),
    scatter: v.scatter({ point: "region", x: revenue, y: units, split: "region" }),
    pie: v.pie({ slice: region, value: revenue, donut: true }),
    records: v.records({ columns: ["ordered_at", "region", "revenue"], sort: "revenue", descending: true }),
    summary: v.summary({ rows: [region, month], values: [revenue, units], total: true }),
    pivot: v.pivot({ rows: region, columns: month, value: revenue, heat: true }),
    list: v.list({ item: v.group("region", { sort: "high", top: 5n }), caption: "ordered_at", values: [revenue, units], bar: true }),
};

/** A kind's well, by its field. */
function wellOf(kind: StudioKindLiteral, field: string): StudioWell {
    const editor = kindEditor(FULL[kind]);
    const found = editor?.wells.find((w) => w.field === field);
    if (found === undefined) assert.fail(`the ${kind} has no ${field} well`);
    return found;
}

/** The wells the East rules are read through. */
const KPI_VALUE = wellOf("kpi", "value");
const BAR_VALUES = wellOf("bar", "values");
const COMBO_COLUMNS = wellOf("combo", "columns");
const COLUMN_X = wellOf("column", "x");
const COLUMN_SPLIT = wellOf("column", "split");
const PIE_SLICE = wellOf("pie", "slice");

/** The struct a kind's wells edit, by its view's case and its own. */
function structOf(view: string, kind: string): StructType {
    const viewType = (Studio.Types.View.cases as Record<string, EastType>)[view]!;
    const held = view === "chart" || view === "table" ? ((viewType as VariantType).cases as Record<string, EastType>)[kind]! : viewType;
    if (held.type !== "Struct") assert.fail(`${view} ${kind} is no struct`);
    return held;
}

describe("Each kind's editor (#1672, EDT-2)", () => {
    test("every kind a visual may be has one editor, in its view's segment, at its span: a KPI 3, the rest 6", () => {
        const kinds = studioEditors.flatMap((viewEditor) => viewEditor.kinds.map((editor) => [viewEditor.view, editor.kind.type, Number(editor.span)]));
        assert.deepEqual(kinds, [
            ["kpi", "kpi", 3], ["chart", "column", 6], ["chart", "bar", 6], ["chart", "line", 6], ["chart", "area", 6], ["chart", "combo", 6],
            ["chart", "scatter", 6], ["chart", "pie", 6], ["table", "records", 6], ["table", "summary", 6], ["table", "pivot", 6], ["list", "list", 6],
        ]);
    });

    test("every well is a field of its kind's struct, holding what the well holds: one, an Option of one, or a list", () => {
        const comboStruct = structOf("chart", "combo");
        const axis = (comboStruct.fields as Record<string, EastType>)["columns"]!;
        if (axis.type !== "Array") assert.fail("a combo's columns are a list");
        const PAYLOAD: Record<string, EastType> = { value: Studio.Types.Value, axis: axis.value, group: Studio.Types.Group, field: StringType };
        for (const viewEditor of studioEditors) {
            for (const editor of viewEditor.kinds) {
                const struct = structOf(viewEditor.view, editor.kind.type);
                for (const held of editor.wells) {
                    const payload = PAYLOAD[held.holds.type]!;
                    const expected = held.list ? ArrayType(payload) : held.optional ? OptionType(payload) : payload;
                    const actual = (struct.fields as Record<string, EastType>)[held.field];
                    assert.ok(actual !== undefined && isTypeEqual(actual, expected), `${editor.kind.type}.${held.field} holds ${held.holds.type}`);
                }
            }
        }
    });

    test("every option is a switch or a case of several, three at most; a line takes no stack, and every chart says of its legend", () => {
        for (const viewEditor of studioEditors) {
            for (const editor of viewEditor.kinds) {
                assert.ok(editor.options.length <= 3, `${editor.kind.type} has at most three options`);
                const struct = structOf(viewEditor.view, editor.kind.type);
                for (const option of editor.options) {
                    const type = (struct.fields as Record<string, EastType>)[option.field];
                    const cases = type?.type === "Variant" ? Object.values(type.cases as Record<string, EastType>) : [];
                    assert.ok(type !== undefined && (isTypeEqual(type, BooleanType) || (cases.length > 0 && cases.every((c) => isTypeEqual(c, NullType)))),
                        `${editor.kind.type}.${option.field} is a switch or a case of several`);
                }
            }
        }
        assert.deepEqual(kindEditor(FULL.line)?.options.map((o) => o.field), ["legend"]);
        assert.deepEqual(kindEditor(FULL.column)?.options.map((o) => o.field), ["stack", "legend"]);
        for (const kind of ["column", "bar", "line", "area", "combo", "scatter", "pie"] as const) {
            assert.ok(kindEditor(FULL[kind])?.options.some((o) => o.field === "legend"), `${kind} says whether it draws its legend`);
        }
        assert.equal(kindEditor(v.slicer(["range"])), undefined);
    });

    test("a kind's options are the form's fields, by their declared labels: a choice its cases in their words, a yes or no a box", () => {
        const fields = (kind: StudioKindLiteral) => optionSpecs(kindEditor(FULL[kind])!).map((spec) => [spec.path.join("."), spec.label, spec.editor.type]);
        assert.deepEqual(fields("column"), [["stack", "Stack", "select"], ["legend", "Legend", "select"]]);
        const stack = optionSpecs(kindEditor(FULL.column)!)[0]!.editor;
        assert.deepEqual(stack.type === "select" ? stack.value : [], [
            { case: "none", label: "Clustered" }, { case: "stacked", label: "Stacked" }, { case: "percent", label: "Percent" },
        ]);
        assert.deepEqual(fields("summary"), [["total", "Total row", "checkbox"]]);
        assert.deepEqual(fields("line"), [["legend", "Legend", "select"]]);
        // A chart's legend is drawn where it names more than one series, or never; a pie's shows its values, its names or nothing.
        const legendOf = (kind: StudioKindLiteral) => {
            const editor = optionSpecs(kindEditor(FULL[kind])!).find((spec) => spec.path.join(".") === "legend")!.editor;
            return editor.type === "select" ? editor.value : [];
        };
        assert.deepEqual(legendOf("column"), [{ case: "auto", label: "Auto" }, { case: "hidden", label: "Hidden" }]);
        assert.deepEqual(fields("pie"), [["donut", "Donut", "checkbox"], ["legend", "Legend", "select"]]);
        assert.deepEqual(legendOf("pie"), [{ case: "values", label: "Values" }, { case: "names", label: "Names" }, { case: "hidden", label: "Hidden" }]);
        // An option a declaration adds is drawn from it alone: a line's stack.
        const line = { ...kindEditor(FULL.line)!, options: [...kindEditor(FULL.column)!.options] };
        assert.deepEqual(optionSpecs(line).map((spec) => [spec.path.join("."), spec.label]), [["stack", "Stack"], ["legend", "Legend"]]);
    });

    test("a well takes the kinds of field it accepts: a trend a date, a records table's columns any field, a value no struct (EDT-4)", () => {
        assert.deepEqual([fieldFits(wellOf("kpi", "trend"), ORDERED), fieldFits(wellOf("kpi", "trend"), REVENUE)], [true, false]);
        assert.deepEqual([fieldFits(wellOf("records", "columns"), ADDRESS), fieldFits(wellOf("list", "caption"), ADDRESS)], [true, true]);
        assert.deepEqual([fieldFits(wellOf("kpi", "value"), REGION), fieldFits(wellOf("kpi", "value"), ADDRESS)], [true, false]);
        assert.equal(fieldFits(wellOf("column", "x"), ADDRESS), false);
    });
});

describe("A well, read and written by its declaration (#1672)", () => {
    test("every well of every kind reads its pills and writes them back as they were", () => {
        for (const [kind, view] of Object.entries(FULL) as [StudioKindLiteral, View][]) {
            const editor = kindEditor(view);
            if (editor === undefined) assert.fail(`no editor for ${kind}`);
            for (const held of editor.wells) {
                const pills = wellPills(view, held);
                assert.ok(viewEqual(withWellPills(view, held, pills), view), `${kind}.${held.field} round-trips`);
            }
        }
    });

    test("a list's pills in order; an Option's one or none; a single well's one, or none while it is empty", () => {
        assert.deepEqual(wellPills(FULL.bar, wellOf("bar", "values")), [variant("value", revenue), variant("value", units)]);
        assert.deepEqual(wellPills(FULL.column, wellOf("column", "split")), [variant("field", "region")]);
        assert.deepEqual(wellPills(FULL.bar, wellOf("bar", "split")), []);
        assert.deepEqual(wellPills(FULL.pie, wellOf("pie", "slice")), [variant("group", region)]);
        assert.deepEqual(wellPills(v.column({ x: v.group(""), values: [] }), wellOf("column", "x")), []);
        assert.deepEqual(wellPills(v.scatter({ point: "", x: revenue, y: units }), wellOf("scatter", "point")), []);
    });

    test("a pill taken out leaves an Option none, a group of no field, a count of the rows, or no field", () => {
        assert.ok(viewEqual(withWellPills(FULL.column, wellOf("column", "split"), []), v.column({ x: month, values: [revenue], stack: "stacked" })));
        assert.ok(viewEqual(withWellPills(FULL.pie, wellOf("pie", "slice"), []), v.pie({ slice: v.group(""), value: revenue, donut: true })));
        assert.ok(viewEqual(withWellPills(FULL.pie, wellOf("pie", "value"), []), v.pie({ slice: region, value: v.count(), donut: true })));
        assert.ok(viewEqual(withWellPills(FULL.scatter, wellOf("scatter", "point"), []), v.scatter({ point: "", x: revenue, y: units, split: "region" })));
    });

    test("a pill of another kind than the well holds is refused, naming the well", () => {
        assert.throws(() => withWellPills(FULL.bar, wellOf("bar", "values"), [variant("group", region)]), /Values well takes value pills/);
    });

    test("an option is a field of the kind's struct, set by its value; one that does not fit is refused", () => {
        assert.ok(viewEqual(withKindField(FULL.pie, "donut", false), v.pie({ slice: region, value: revenue })));
        assert.throws(() => withKindField(FULL.pie, "donut", "yes"), /does not take that value/);
        assert.throws(() => withKindField(FULL.pie, "heat", true), /no field/);
    });

    test("a chart's values hold one pill while it is split (CHT-2); a summary's rows two; a list's values two", () => {
        assert.equal(wellMost(FULL.column, wellOf("column", "values")), 1);
        assert.equal(wellMost(FULL.bar, wellOf("bar", "values")), undefined);
        assert.equal(wellMost(FULL.summary, wellOf("summary", "rows")), 2);
        assert.equal(wellMost(FULL.list, wellOf("list", "values")), 2);
    });
});

describe("A well's pills, edited (#1672, EDT-3, EDT-5)", () => {
    const values = wellOf("bar", "values");
    const pill = (value: ValueTypeOf<typeof Studio.Types.Value>) => variant("value", value);

    test("a pill placed in a single well replaces its pill; in a list well it is appended, or put where it is dropped", () => {
        assert.ok(viewEqual(placedInWell(FULL.pie, wellOf("pie", "slice"), variant("group", month))!, v.pie({ slice: month, value: revenue, donut: true })));
        assert.ok(viewEqual(placedInWell(FULL.bar, values, pill(v.count()))!, v.bar({ x: region, values: [revenue, units, v.count()] })));
        assert.ok(viewEqual(placedInWell(FULL.bar, values, pill(v.count()), 0)!, v.bar({ x: region, values: [v.count(), revenue, units] })));
        assert.ok(viewEqual(placedInWell(FULL.bar, values, pill(v.count()), 9)!, v.bar({ x: region, values: [revenue, units, v.count()] })));
    });

    test("a full list well takes no more: a split chart's values one, a summary's rows two", () => {
        assert.equal(placedInWell(FULL.column, wellOf("column", "values"), pill(units)), undefined);
        assert.equal(placedInWell(FULL.summary, wellOf("summary", "rows"), variant("group", region)), undefined);
    });

    test("a list well's pill moves up and down its list; a move to where it is, or off the list, changes nothing", () => {
        const three = v.bar({ x: region, values: [revenue, units, v.count()] });
        assert.ok(viewEqual(movedInWell(three, values, 2, 0), v.bar({ x: region, values: [v.count(), revenue, units] })));
        assert.ok(viewEqual(movedInWell(three, values, 0, 1), v.bar({ x: region, values: [units, revenue, v.count()] })));
        assert.ok(viewEqual(movedInWell(three, values, 1, 1), three));
        assert.ok(viewEqual(movedInWell(three, values, 0, 3), three));
        assert.ok(viewEqual(movedInWell(three, values, 5, 0), three));
    });

    test("a pill taken out leaves a single well empty; one replaced is its menu's edit; neither touches a place with no pill", () => {
        assert.ok(viewEqual(removedFromWell(FULL.bar, values, 0), v.bar({ x: region, values: [units] })));
        assert.ok(viewEqual(removedFromWell(FULL.column, wellOf("column", "split"), 0), v.column({ x: month, values: [revenue], stack: "stacked" })));
        assert.ok(viewEqual(removedFromWell(FULL.bar, values, 2), FULL.bar));
        const mean = pill(v.mean("revenue"));
        assert.ok(viewEqual(replacedInWell(FULL.bar, values, 1, mean), v.bar({ x: region, values: [revenue, v.mean("revenue")] })));
        assert.ok(viewEqual(replacedInWell(FULL.bar, values, 2, mean), FULL.bar));
    });

    test("the fields a pill reads — a ratio's two, a count's none, an empty group's none — and a view's, each once, for the Fields list's checks", () => {
        assert.deepEqual(pillFields(pill(v.ratio("revenue", "units"))), ["revenue", "units"]);
        assert.deepEqual(pillFields(pill(v.count())), []);
        assert.deepEqual(pillFields(variant("axis", v.right(v.sum("units")))), ["units"]);
        assert.deepEqual([pillFields(variant("group", v.group(""))), pillFields(variant("field", ""))], [[], []]);
        assert.deepEqual(placedFields(FULL.column, kindEditor(FULL.column)!), ["ordered_at", "revenue", "region"]);
        assert.deepEqual(placedFields(FULL.records, kindEditor(FULL.records)!), ["ordered_at", "region", "revenue"]);
        assert.deepEqual(placedFields(v.column({ x: v.group(""), values: [] }), kindEditor(FULL.column)!), []);
    });
});

describe("What an edit changed from what is saved (#1672, EDT-10)", () => {
    test("a visual's own parts, and by its kind's struct each well and option, that differ", () => {
        const saved = v.of("orders", FULL.column);
        assert.deepEqual([...changedParts(saved, saved)], []);
        assert.deepEqual([...changedParts(saved, v.of("orders", v.column({ x: month, values: [revenue], split: "region" })))], ["stack"]);
        assert.deepEqual([...changedParts(saved, v.of("assets", FULL.column, { click: variant("none", null) }))], ["source", "click"]);
    });

    test("another kind is the kind, and each well and option the saved kind held otherwise or not at all; another view the view too", () => {
        // A bar switched to a column keeps every well and its stack: its kind is all that changed.
        assert.deepEqual([...changedParts(v.of("orders", FULL.bar), v.of("orders", v.column({ x: region, values: [revenue, units] })))], ["kind"]);
        assert.deepEqual([...changedParts(v.of("orders", FULL.column), v.of("orders", FULL.line))].sort(), ["kind", "split", "stack"]);
        assert.deepEqual([...changedParts(v.of("orders", FULL.kpi), v.of("orders", FULL.list))].sort(),
            ["bar", "caption", "click", "item", "kind", "values", "view"]);
    });

    test("what a view held saved of each field its kind has now: a field of the same name at the same type, and none of any other", () => {
        assert.deepEqual(Object.keys(savedKindFields(FULL.bar, FULL.column)), ["x", "values", "split", "stack", "legend"]);
        assert.ok(viewEqual(withKindField(FULL.column, "values", savedKindFields(FULL.bar, FULL.column)["values"]), v.column({
            x: month, values: [revenue, units], split: "region", stack: "stacked",
        })));
        // A combo's columns are axis values, never a records table's fields: no field of the same name and type.
        assert.deepEqual(Object.keys(savedKindFields(FULL.records, FULL.combo)), []);
        assert.deepEqual(Object.keys(savedKindFields(FULL.kpi, FULL.list)), []);
        assert.deepEqual(savedKindFields(undefined, FULL.pie), {});
        assert.deepEqual(savedKindFields(v.slicer(["range"]), FULL.pie), {});
    });

    test("a text block's heading and body; content not saved, every part; a component's, none", () => {
        assert.deepEqual([...changedParts(v.text("Figures are to last night.", "About"), v.text("Figures are to this morning.", "About"))], ["body"]);
        assert.deepEqual([...changedParts(undefined, v.text("Note"))], ["heading", "body"]);
        assert.deepEqual([...changedParts(undefined, v.of("orders", FULL.pie))].sort(),
            ["click", "donut", "follow", "kind", "legend", "slice", "source", "value", "view", "where"]);
        assert.deepEqual([...changedParts(v.component("rail"), v.component("trend"))], []);
    });
});

/** A source over the orders: what a dropped visual reads. */
const PATH = [variant("field", "inputs"), variant("field", "orders")];
function sourceOf(key: string): ValueTypeOf<typeof StudioSourceType> {
    return {
        key, name: key, icon: "receipt", description: none,
        binding: { name: key, source: variant("value", PATH), type: toEastTypeValue(ArrayType(StringType)) },
        fields: [], range: none, search: [], split: [],
    };
}
/** A placement holding content. */
function cellOf(key: string, content: ValueTypeOf<typeof StudioCellType>["content"]): ValueTypeOf<typeof StudioCellType> {
    return { key, row: "r1", span: 6n, height: none, align: variant("top", null), title: none, content };
}

/** The values the East rules are checked against, made before the East blocks that read them. */
const EXPECTED = {
    distinctRegion: variant("value", v.distinct("region")),
    leftRevenue: variant("axis", v.left(revenue)),
    regionHighest: variant("group", v.group("region", { sort: "high" })),
    views: Object.values(FULL),
    kinds: Object.keys(FULL),
    slicer: v.slicer(["range"]),
    emptyColumn: v.column({ x: v.group(""), values: [] }),
    countKpi: v.kpi({ value: v.count() }),
    emptyPivot: v.pivot({ rows: v.group(""), columns: v.group(""), value: v.count() }),
    emptyList: v.list({ item: v.group(""), values: [] }),
    columnAsLine: v.line({ x: month, values: [revenue], split: "region", stack: "stacked" }),
    lineAsArea: v.area({ x: month, values: [revenue], stack: "percent" }),
    areaAsCombo: v.combo({ x: month, columns: [v.left(revenue), v.left(units)], lines: [] }),
    comboAsColumn: v.column({ x: month, values: [revenue, v.count()] }),
    barAsScatter: v.scatter({ point: "region", x: revenue, y: units }),
    columnAsScatter: v.scatter({ point: "ordered_at", x: revenue, y: v.count(), split: "region" }),
    barAsPie: v.pie({ slice: region, value: revenue }),
    pieAsBar: v.bar({ x: region, values: [revenue] }),
    summaryAsPivot: v.pivot({ rows: region, columns: month, value: revenue }),
    pivotAsSummary: v.summary({ rows: [region, month], values: [revenue] }),
    recordsAsSummary: v.summary({ rows: [month, v.group("region", { sort: "high" })], values: [] }),
    storeRecords: v.records({ columns: ["store"] }),
    storeAsPivot: v.pivot({ rows: v.group("store"), columns: v.group(""), value: v.count() }),
    summaryAsRecords: v.records({ columns: ["region", "ordered_at"] }),
    emptyRecords: v.records({ columns: [] }),
    hiddenColumn: v.column({ x: region, values: [revenue], legend: "hidden" }),
    hiddenPie: v.pie({ slice: region, value: revenue, legend: "hidden" }),
    namesPie: v.pie({ slice: region, value: revenue, legend: "names" }),
    hiddenCombo: v.combo({ x: region, columns: [v.left(revenue)], lines: [], legend: "hidden" }),
    sources: [sourceOf("orders"), sourceOf("assets")],
    assetsTwice: [cellOf("c1", v.of("assets", FULL.kpi)), cellOf("c2", v.of("orders", FULL.bar)), cellOf("c3", v.of("assets", FULL.pie)), cellOf("c4", v.text("Note"))],
    tie: [cellOf("c1", v.of("assets", FULL.kpi)), cellOf("c2", v.of("orders", FULL.bar))],
    componentOnly: [cellOf("c1", v.component("rail"))],
};

describeEast("The Configure tab's rules (#1672)", (test) => {
    Assert.examples(test, {
        studioPlacedPill: ex.studioPlacedPill,
        studioFieldGroup: ex.studioFieldGroup,
        studioFieldMeasures: ex.studioFieldMeasures,
        studioKindOfView: ex.studioKindOfView,
        studioEmptyView: ex.studioEmptyView,
        studioSwitchedView: ex.studioSwitchedView,
        studioMostUsedSource: ex.studioMostUsedSource,
    });

    test("a placed field's pill: a number in a value well summed, any other field counted by its values (MOD-6)", $ => {
        $(Assert.equal(placedPill(KPI_VALUE, REVENUE), variant("value", revenue)));
        $(Assert.equal(placedPill(BAR_VALUES, REGION), EXPECTED.distinctRegion));
        $(Assert.equal(placedPill(COMBO_COLUMNS, REVENUE), EXPECTED.leftRevenue));
    });

    test("a placed field's pill: a date grouped by month in time order, any other group highest first; a field's well the field (MOD-6)", $ => {
        $(Assert.equal(placedPill(COLUMN_X, ORDERED), variant("group", month)));
        $(Assert.equal(placedPill(PIE_SLICE, REGION), EXPECTED.regionHighest));
        $(Assert.equal(placedPill(COLUMN_SPLIT, REGION), variant("field", "region")));
    });

    test("a number's value may be its total, mean, least, most, distinct values or the rows; any other field's its distinct values or the rows (EDT-4)", $ => {
        $(Assert.equal(fieldMeasures(REVENUE), [
            variant("sum", "revenue"), variant("mean", "revenue"), variant("min", "revenue"), variant("max", "revenue"),
            variant("distinct", "revenue"), variant("count", null),
        ]));
        $(Assert.equal(fieldMeasures(ORDERED), [variant("distinct", "ordered_at"), variant("count", null)]));
    });

    test("each view is its kind; a slicer none", $ => {
        const views = $.const(EXPECTED.views, ArrayType(StudioViewType));
        $(Assert.equal(views.map((_$2, view) => kindOfView(view).unwrap("some").getTag()), EXPECTED.kinds));
        $(Assert.equal(kindOfView(EXPECTED.slicer).hasTag("none"), true));
    });

    test("a kind with nothing in its wells: groups of no field, a single value the rows' count, lists empty (MOD-4)", $ => {
        $(Assert.equal(emptyView(variant("column", null)), EXPECTED.emptyColumn));
        $(Assert.equal(emptyView(variant("kpi", null)), EXPECTED.countKpi));
        $(Assert.equal(emptyView(variant("pivot", null)), EXPECTED.emptyPivot));
        $(Assert.equal(emptyView(variant("list", null)), EXPECTED.emptyList));
    });

    test("between the four series kinds, x, values, split and stack carry over — a line keeps its stack for when it switches back (CHT-1)", $ => {
        $(Assert.equal(switchedView(FULL.column, variant("line", null), FIELDS), EXPECTED.columnAsLine));
        $(Assert.equal(switchedView(FULL.line, variant("area", null), FIELDS), EXPECTED.lineAsArea));
    });

    test("a combo takes the values as its columns, and gives its columns then its lines back as values", $ => {
        $(Assert.equal(switchedView(FULL.area, variant("combo", null), FIELDS), EXPECTED.areaAsCombo));
        $(Assert.equal(switchedView(FULL.combo, variant("column", null), FIELDS), EXPECTED.comboAsColumn));
    });

    test("a scatter keeps the first two values as its X and Y, its point the axis's field; a pie takes the axis as its slices and the first value", $ => {
        $(Assert.equal(switchedView(FULL.bar, variant("scatter", null), FIELDS), EXPECTED.barAsScatter));
        $(Assert.equal(switchedView(FULL.column, variant("scatter", null), FIELDS), EXPECTED.columnAsScatter));
        $(Assert.equal(switchedView(FULL.bar, variant("pie", null), FIELDS), EXPECTED.barAsPie));
        $(Assert.equal(switchedView(FULL.pie, variant("bar", null), FIELDS), EXPECTED.pieAsBar));
    });

    test("a chart's legend stays hidden across a change of kind, and is drawn where it was: a pie's names are a legend drawn", $ => {
        $(Assert.equal(switchedView(EXPECTED.hiddenColumn, variant("pie", null), FIELDS), EXPECTED.hiddenPie));
        $(Assert.equal(switchedView(EXPECTED.hiddenPie, variant("combo", null), FIELDS), EXPECTED.hiddenCombo));
        $(Assert.equal(switchedView(EXPECTED.namesPie, variant("bar", null), FIELDS), EXPECTED.pieAsBar));
    });

    test("a summary's groups become a pivot's rows and columns, its first value the pivot's value — and back", $ => {
        $(Assert.equal(switchedView(FULL.summary, variant("pivot", null), FIELDS), EXPECTED.summaryAsPivot));
        $(Assert.equal(switchedView(FULL.pivot, variant("summary", null), FIELDS), EXPECTED.pivotAsSummary));
    });

    test("a records table's first two columns become groups by their kind's defaults; a summary's groups its columns", $ => {
        $(Assert.equal(switchedView(FULL.records, variant("summary", null), FIELDS), EXPECTED.recordsAsSummary));
        $(Assert.equal(switchedView(EXPECTED.storeRecords, variant("pivot", null), FIELDS), EXPECTED.storeAsPivot));
        $(Assert.equal(switchedView(FULL.summary, variant("records", null), FIELDS), EXPECTED.summaryAsRecords));
    });

    test("the same kind keeps its view as it is; another view starts its kind empty (EDT-8)", $ => {
        $(Assert.equal(switchedView(FULL.combo, variant("combo", null), FIELDS), FULL.combo));
        $(Assert.equal(switchedView(FULL.column, variant("records", null), FIELDS), EXPECTED.emptyRecords));
        $(Assert.equal(switchedView(FULL.kpi, variant("list", null), FIELDS), EXPECTED.emptyList));
    });

    test("a dropped visual reads the source the page's visuals read most, the first listed of a tie, the first listed when none is read (BLD-2)", $ => {
        const sources = $.const(EXPECTED.sources, ArrayType(StudioSourceType));
        const assetsTwice = $.const(EXPECTED.assetsTwice, ArrayType(StudioCellType));
        $(Assert.equal(mostUsedSource(assetsTwice, sources), some("assets")));
        const tie = $.const(EXPECTED.tie, ArrayType(StudioCellType));
        $(Assert.equal(mostUsedSource(tie, sources), some("orders")));
        $(Assert.equal(mostUsedSource(EXPECTED.componentOnly, sources), some("orders")));
        $(Assert.equal(mostUsedSource([], []), none));
    });
}, { platformFns: TestImpl });
