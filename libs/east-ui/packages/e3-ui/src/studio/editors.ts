/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Each kind's editor, as data (#1672, EDT-2): what the Configure tab draws a
 * visual's editor from.
 *
 * The views and their kinds ({@link studioEditors}), and each kind's wells in
 * order — each a field of the kind's struct, holding one pill or a list of
 * them, and the kinds of field it takes — and its options. The inspector
 * draws every editor from these, so a kind added here writes no editor UI.
 *
 * The rules that edit by them are beside it: `configure.ts` (in East),
 * `kind.ts` and `wells.ts` (a decoded view's fields and wells) and
 * `changed.ts` (what an edit changed from what is saved).
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    BooleanType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    none,
    some,
    variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { Fields } from "@elaraai/east-ui";
import { StudioAxisValueType, StudioGroupType, StudioValueType } from "./content.js";
import { StudioFieldKindType } from "./source.js";

// ============================================================================
// Types
// ============================================================================

/**
 * A kind a visual may be, as the inspector offers it: each view's kinds — a
 * KPI and a list are each their view's one kind.
 */
export const StudioKindType = VariantType({
    kpi: NullType,
    column: NullType,
    bar: NullType,
    line: NullType,
    area: NullType,
    combo: NullType,
    scatter: NullType,
    pie: NullType,
    records: NullType,
    summary: NullType,
    pivot: NullType,
    list: NullType,
});

/** Type representing a kind a visual may be. */
export type StudioKindType = typeof StudioKindType;

/**
 * What a well's pills are.
 *
 * @property value - A value: a measure of a field, its period, goal and label
 * @property axis - A combo chart's value, with the axis it reads against
 * @property group - A group: a field, its bucket, its order and how many it keeps
 * @property field - A field alone
 */
export const StudioWellHoldsType = VariantType({ value: NullType, axis: NullType, group: NullType, field: NullType });

/** Type representing what a well's pills are. */
export type StudioWellHoldsType = typeof StudioWellHoldsType;

/**
 * One well of a kind's editor: a field of the kind's struct.
 *
 * @property field - The field of the kind's struct it edits
 * @property label - Its name in the editor — "X axis"
 * @property holds - What its pills are
 * @property list - Whether it holds several pills, in order; else one
 * @property optional - Whether a well of one pill may be empty: an Option field
 * @property most - The most pills a list takes; `none` takes any number
 * @property one - A field of the kind that, while set, holds the list to one
 *   pill — a chart's values while it is split (CHT-2); `none` for none
 * @property accepts - The kinds of field it takes; empty takes every kind
 */
export const StudioWellType = StructType({
    field: StringType,
    label: StringType,
    holds: StudioWellHoldsType,
    list: BooleanType,
    optional: BooleanType,
    most: OptionType(IntegerType),
    one: OptionType(StringType),
    accepts: ArrayType(StudioFieldKindType),
});

/** Type representing one well of a kind's editor. */
export type StudioWellType = typeof StudioWellType;

/**
 * One option of a kind's editor: a field of the kind's struct, drawn by its
 * East type — a case of several as a choice, a yes or no as a box
 * (`optionSpecs`).
 *
 * @property field - The field of the kind's struct it sets
 * @property label - Its name in the editor
 * @property cases - A choice's words for its cases, in the order offered; empty for a yes or no, or a choice whose names spelled out will do
 */
export const StudioKindOptionType = StructType({ field: StringType, label: StringType, cases: ArrayType(Fields.Types.Option) });

/** Type representing one option of a kind's editor. */
export type StudioKindOptionType = typeof StudioKindOptionType;

/**
 * A kind's editor: what the Configure tab draws for a visual of the kind.
 *
 * @property kind - The kind
 * @property label - Its name in the kind's segments — "Column"
 * @property icon - A Font Awesome solid icon name — its palette card's
 * @property span - The span a visual of it is placed at (BLD-2)
 * @property wells - Its wells, in order
 * @property options - Its options, three at most
 */
export const StudioKindEditorType = StructType({
    kind: StudioKindType,
    label: StringType,
    icon: StringType,
    span: IntegerType,
    wells: ArrayType(StudioWellType),
    options: ArrayType(StudioKindOptionType),
});

/** Type representing a kind's editor. */
export type StudioKindEditorType = typeof StudioKindEditorType;

/**
 * A view's editors: the view, then its kinds — the Configure tab's two rows
 * of segments.
 *
 * @property view - The view's case of a visual's view — `chart`
 * @property label - Its name in the view's segments — "Chart"
 * @property icon - A Font Awesome solid icon name — its segment's, where the views are more than three
 * @property kinds - Its kinds' editors, in order
 */
export const StudioViewEditorType = StructType({
    view: StringType,
    label: StringType,
    icon: StringType,
    kinds: ArrayType(StudioKindEditorType),
});

/** Type representing a view's editors. */
export type StudioViewEditorType = typeof StudioViewEditorType;

/**
 * One pill of a well: what it holds ({@link StudioWellHoldsType}).
 *
 * @property value - A value
 * @property axis - A combo chart's value, with its axis
 * @property group - A group
 * @property field - A field
 */
export const StudioPillType = VariantType({
    value: StudioValueType,
    axis: StudioAxisValueType,
    group: StudioGroupType,
    field: StringType,
});

/** Type representing one pill of a well. */
export type StudioPillType = typeof StudioPillType;

/** A kind's case name: `column`. */
export type StudioKindLiteral = keyof (typeof StudioKindType)["cases"];
/** A kind, decoded. */
export type StudioKind = ValueTypeOf<typeof StudioKindType>;
/** A well, decoded. */
export type StudioWell = ValueTypeOf<typeof StudioWellType>;
/** A kind's editor, decoded. */
export type StudioKindEditor = ValueTypeOf<typeof StudioKindEditorType>;
/** A view's editors, decoded. */
export type StudioViewEditor = ValueTypeOf<typeof StudioViewEditorType>;
/** A pill, decoded. */
export type StudioPill = ValueTypeOf<typeof StudioPillType>;

/** A field's kind, decoded. */
type FieldKind = ValueTypeOf<typeof StudioFieldKindType>;

// ============================================================================
// Each kind's editor
// ============================================================================

const DATE: FieldKind = variant("date", null);
const TEXT: FieldKind = variant("text", null);
const NUMBER: FieldKind = variant("number", null);
const BOOLEAN: FieldKind = variant("boolean", null);
/** What a group, a value, a split and a point take: every kind of field but a struct, a list or a case of several (EDT-4). */
const GROUPABLE: readonly FieldKind[] = [DATE, TEXT, NUMBER, BOOLEAN];
/** What a trend takes: a date. */
const DATES: readonly FieldKind[] = [DATE];
/** What a records table's column and a list's caption take: any field, shown as its value. */
const ANY: readonly FieldKind[] = [];

/** One well, with its defaults: one pill, required, of every groupable kind of field. */
function well(field: string, label: string, holds: StudioWell["holds"]["type"], shape: {
    list?: boolean; optional?: boolean; most?: bigint; one?: string; accepts?: readonly FieldKind[];
} = {}): StudioWell {
    return {
        field,
        label,
        holds: variant(holds, null),
        list: shape.list ?? false,
        optional: shape.optional ?? false,
        most: shape.most === undefined ? none : some(shape.most),
        one: shape.one === undefined ? none : some(shape.one),
        accepts: [...(shape.accepts ?? GROUPABLE)],
    };
}

/** A chart of series' wells: its axis, its values — one while it is split (CHT-2) — and its split. */
const SERIES_WELLS: readonly StudioWell[] = [
    well("x", "X axis", "group"),
    well("values", "Values", "value", { list: true, one: "split" }),
    well("split", "Split by", "field", { optional: true }),
];
/** A yes or no option. */
function yesNo(field: string, label: string): StudioKindEditor["options"][number] {
    return { field, label, cases: [] };
}
const STACK: StudioKindEditor["options"][number] = {
    field: "stack", label: "Stack",
    cases: [{ case: "none", label: "Clustered" }, { case: "stacked", label: "Stacked" }, { case: "percent", label: "Percent" }],
};
/** Whether a chart draws its legend: where it has more than one series to name, or never. */
const LEGEND: StudioKindEditor["options"][number] = {
    field: "legend", label: "Legend",
    cases: [{ case: "auto", label: "Auto" }, { case: "hidden", label: "Hidden" }],
};
/** What a pie's legend shows: each slice's value and share, its name alone, or no legend. */
const PIE_LEGEND: StudioKindEditor["options"][number] = {
    field: "legend", label: "Legend",
    cases: [{ case: "values", label: "Values" }, { case: "names", label: "Names" }, { case: "hidden", label: "Hidden" }],
};

/**
 * Each view's editors, in the Configure tab's order: the KPI, the seven
 * charts, the three tables and the list (EDT-2, BLD-1). A KPI is placed at
 * span 3, the rest at 6 (BLD-2). A line takes no stack, and keeps the one it
 * has for when it switches back (CHT-1). Every chart says whether it draws its
 * legend, and a pie what its legend shows.
 */
export const studioEditors: readonly StudioViewEditor[] = [
    {
        view: "kpi", label: "KPI", icon: "gauge-high", kinds: [{
            kind: variant("kpi", null), label: "KPI", icon: "gauge-high", span: 3n,
            wells: [
                well("value", "Value", "value"),
                well("compare", "Compare with", "value", { optional: true }),
                well("trend", "Trend", "field", { optional: true, accepts: DATES }),
            ],
            options: [],
        }],
    },
    {
        view: "chart", label: "Chart", icon: "chart-column", kinds: [
            { kind: variant("column", null), label: "Column", icon: "chart-column", span: 6n, wells: [...SERIES_WELLS], options: [STACK, LEGEND] },
            { kind: variant("bar", null), label: "Bar", icon: "chart-bar", span: 6n, wells: [...SERIES_WELLS], options: [STACK, LEGEND] },
            { kind: variant("line", null), label: "Line", icon: "chart-line", span: 6n, wells: [...SERIES_WELLS], options: [LEGEND] },
            { kind: variant("area", null), label: "Area", icon: "chart-area", span: 6n, wells: [...SERIES_WELLS], options: [STACK, LEGEND] },
            {
                kind: variant("combo", null), label: "Combo", icon: "chart-simple", span: 6n,
                wells: [well("x", "X axis", "group"), well("columns", "Columns", "axis", { list: true }), well("lines", "Lines", "axis", { list: true })],
                options: [STACK, LEGEND],
            },
            {
                kind: variant("scatter", null), label: "Scatter", icon: "braille", span: 6n,
                wells: [well("point", "Point", "field"), well("x", "X", "value"), well("y", "Y", "value"), well("split", "Colour by", "field", { optional: true })],
                options: [LEGEND],
            },
            {
                kind: variant("pie", null), label: "Pie", icon: "chart-pie", span: 6n,
                wells: [well("slice", "Slices", "group"), well("value", "Value", "value")],
                options: [yesNo("donut", "Donut"), PIE_LEGEND],
            },
        ],
    },
    {
        view: "table", label: "Table", icon: "table", kinds: [
            {
                kind: variant("records", null), label: "Records", icon: "table-list", span: 6n,
                wells: [well("columns", "Columns", "field", { list: true, accepts: ANY }), well("sort", "Sort by", "field", { optional: true })],
                options: [yesNo("descending", "Descending")],
            },
            {
                kind: variant("summary", null), label: "Summary", icon: "table", span: 6n,
                wells: [well("rows", "Rows", "group", { list: true, most: 2n }), well("values", "Values", "value", { list: true })],
                options: [yesNo("total", "Total row")],
            },
            {
                kind: variant("pivot", null), label: "Pivot", icon: "table-cells", span: 6n,
                wells: [well("rows", "Rows", "group"), well("columns", "Columns", "group"), well("value", "Value", "value")],
                options: [yesNo("heat", "Heat map")],
            },
        ],
    },
    {
        view: "list", label: "List", icon: "list", kinds: [{
            kind: variant("list", null), label: "List", icon: "list", span: 6n,
            wells: [
                well("item", "Item", "group"),
                well("caption", "Caption", "field", { optional: true, accepts: ANY }),
                well("values", "Values", "value", { list: true, most: 2n }),
            ],
            options: [yesNo("bar", "Ranking bar")],
        }],
    },
];
