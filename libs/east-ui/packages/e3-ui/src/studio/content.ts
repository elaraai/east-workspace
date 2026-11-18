/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a placement holds (#1669): a developer's component, by its key; a
 * visual an operator builds — a KPI, a chart, a table or a list over a source
 * the surface lists; or a text block.
 *
 * A visual is data: the source it reads, a filter of its own, its view — what
 * it measures, groups by and draws — what a click on it does, and the visual
 * it follows. Every option has a default, so a visual is valid as soon as its
 * view and its source are set. A field is named by its jq path in the source's
 * row (`revenue`, `status.value.date`).
 *
 * `Studio.visual` builds each as plain values with their defaults, for a
 * record's seeds and for tests.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    BooleanType,
    DictType,
    East,
    FloatType,
    IntegerType,
    JqType,
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
import { TimeResolutionType, type TimeResolutionLiteral } from "@elaraai/east-ui";
import { ValueFormatType, toValueFormat, type SliceFieldFormat } from "@elaraai/east-ui/internal";
import { StudioKeyType } from "./key.js";
import { sourceName } from "./source.js";

// ============================================================================
// Values and groups
// ============================================================================

/**
 * What a value measures over the rows of its group.
 *
 * @property count - How many rows
 * @property sum - The total of a field
 * @property mean - The mean of a field
 * @property min - The least of a field
 * @property max - The most of a field
 * @property distinct - How many different values a field has
 * @property ratio - One field's total over another's — revenue per unit
 */
export const StudioMeasureType = VariantType({
    count: NullType,
    sum: StringType,
    mean: StringType,
    min: StringType,
    max: StringType,
    distinct: StringType,
    ratio: StructType({ of: StringType, per: StringType }),
});

/** Type representing what a value measures. */
export type StudioMeasureType = typeof StudioMeasureType;

/**
 * Which period a value is measured over, of the page's range.
 *
 * @property current - The page's range
 * @property previous - The range of the same length before it
 * @property year_ago - The same range a year before
 */
export const StudioPeriodType = VariantType({ current: NullType, previous: NullType, year_ago: NullType });

/** Type representing a value's period. */
export type StudioPeriodType = typeof StudioPeriodType;

/**
 * Which way a value is better: what a change's colour says.
 *
 * @property higher - More is better
 * @property lower - Less is better
 */
export const StudioBetterType = VariantType({ higher: NullType, lower: NullType });

/** Type representing which way a value is better. */
export type StudioBetterType = typeof StudioBetterType;

const StudioValueTypeImpl = StructType({
    measure: StudioMeasureType,
    label: OptionType(StringType),
    period: StudioPeriodType,
    goal: OptionType(FloatType),
    better: StudioBetterType,
    format: OptionType(ValueFormatType),
});
type StudioValueTypeImpl = typeof StudioValueTypeImpl;

/**
 * Type representing one value of a visual.
 *
 * @remarks
 * An interface, so a type that mentions it — a placement, a page, the pages
 * record — refers to it by name in declaration output rather than spelling
 * out its every case, which is past the length TypeScript will serialize
 * (TS7056).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the empty interface is the point: it attaches a symbol the declaration emitter can reference by name
export interface StudioValueType extends StudioValueTypeImpl {}

/**
 * One value of a visual: a measure, and how it reads.
 *
 * @property measure - What it measures ({@link StudioMeasureType})
 * @property label - Its name; `none` is one made from its measure
 * @property period - The period it is measured over
 * @property goal - A goal to draw against; `none` draws none
 * @property better - Which way is better
 * @property format - How its numbers are shown; `none` shows them as its field's format says
 */
export const StudioValueType: StudioValueType = StudioValueTypeImpl;

/**
 * How a group's values are ordered.
 *
 * @property natural - The field's own order: time for a date, the value's order otherwise
 * @property high - The first value, highest first
 * @property low - The first value, lowest first
 * @property label - By the group's label
 */
export const StudioSortType = VariantType({ natural: NullType, high: NullType, low: NullType, label: NullType });

/** Type representing how a group's values are ordered. */
export type StudioSortType = typeof StudioSortType;

const StudioGroupTypeImpl = StructType({
    field: StringType,
    bucket: OptionType(TimeResolutionType),
    sort: StudioSortType,
    top: OptionType(IntegerType),
});
type StudioGroupTypeImpl = typeof StudioGroupTypeImpl;

/**
 * Type representing what a visual groups its rows by.
 *
 * @remarks
 * An interface, so a type that mentions it — a placement, a page, the pages
 * record — refers to it by name in declaration output rather than spelling
 * out its every case, which is past the length TypeScript will serialize
 * (TS7056).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the empty interface is the point: it attaches a symbol the declaration emitter can reference by name
export interface StudioGroupType extends StudioGroupTypeImpl {}

/**
 * What a visual groups its rows by.
 *
 * @property field - The field
 * @property bucket - For a date, the unit it is bucketed by; `none` groups by the value itself
 * @property sort - The groups' order
 * @property top - Keep the first N groups, the rest as Other; `none` keeps every group
 */
export const StudioGroupType: StudioGroupType = StudioGroupTypeImpl;

/**
 * How a chart's series stack.
 *
 * @property none - Side by side
 * @property stacked - On one another
 * @property percent - On one another, as shares of each group's total
 */
export const StudioStackType = VariantType({ none: NullType, stacked: NullType, percent: NullType });

/** Type representing how a chart's series stack. */
export type StudioStackType = typeof StudioStackType;

/**
 * Whether a chart draws its legend.
 *
 * @property auto - Where it has more than one series to name
 * @property hidden - Never
 */
export const StudioLegendType = VariantType({ auto: NullType, hidden: NullType });

/** Type representing whether a chart draws its legend. */
export type StudioLegendType = typeof StudioLegendType;

/**
 * What a pie's legend shows.
 *
 * @property values - Each slice's name, its value and its share
 * @property names - Each slice's name alone
 * @property hidden - No legend: the pie alone
 */
export const StudioPieLegendType = VariantType({ values: NullType, names: NullType, hidden: NullType });

/** Type representing what a pie's legend shows. */
export type StudioPieLegendType = typeof StudioPieLegendType;

// ============================================================================
// Views
// ============================================================================

/**
 * A KPI: one number, and how it stands.
 *
 * @property value - The number
 * @property compare - A value to compare it with — the same measure a period before, say; `none` draws no change
 * @property trend - A date field to draw its trend along; `none` draws none
 */
export const StudioKpiType = StructType({
    value: StudioValueType,
    compare: OptionType(StudioValueType),
    trend: OptionType(StringType),
});

/** Type representing a KPI. */
export type StudioKpiType = typeof StudioKpiType;

/**
 * A chart of series along one axis: columns, bars, lines or areas.
 *
 * @property x - What the axis groups by
 * @property values - The series: one a value, or one a value of `split`
 * @property split - A field to split the first value by; `none` draws each value as a series
 * @property stack - How the series stack
 * @property legend - Whether it draws its legend
 */
export const StudioSeriesChartType = StructType({
    x: StudioGroupType,
    values: ArrayType(StudioValueType),
    split: OptionType(StringType),
    stack: StudioStackType,
    legend: StudioLegendType,
});

/** Type representing a chart of series along one axis. */
export type StudioSeriesChartType = typeof StudioSeriesChartType;

/**
 * A value of a combo chart, and the axis it reads against.
 *
 * @property value - The value
 * @property right - Whether it reads against the right axis
 */
export const StudioAxisValueType = StructType({ value: StudioValueType, right: BooleanType });

/** Type representing a value of a combo chart. */
export type StudioAxisValueType = typeof StudioAxisValueType;

/**
 * A combo chart: columns and lines on one axis, each against the left or the right.
 *
 * @property x - What the axis groups by
 * @property columns - The values drawn as columns
 * @property lines - The values drawn as lines
 * @property stack - How the columns stack
 * @property legend - Whether it draws its legend
 */
export const StudioComboChartType = StructType({
    x: StudioGroupType,
    columns: ArrayType(StudioAxisValueType),
    lines: ArrayType(StudioAxisValueType),
    stack: StudioStackType,
    legend: StudioLegendType,
});

/** Type representing a combo chart. */
export type StudioComboChartType = typeof StudioComboChartType;

/**
 * A scatter chart: one point for each value of a field, placed by two values.
 *
 * @property point - The field a point stands for
 * @property x - Its place along the axis
 * @property y - Its height
 * @property split - A field to colour the points by; `none` draws them alike
 * @property legend - Whether it draws its legend
 */
export const StudioScatterChartType = StructType({
    point: StringType,
    x: StudioValueType,
    y: StudioValueType,
    split: OptionType(StringType),
    legend: StudioLegendType,
});

/** Type representing a scatter chart. */
export type StudioScatterChartType = typeof StudioScatterChartType;

/**
 * A pie chart: shares of one total.
 *
 * @property slice - What a slice stands for
 * @property value - The value shared out
 * @property donut - Drawn as a ring, its total in the middle
 * @property legend - What its legend shows
 */
export const StudioPieChartType = StructType({ slice: StudioGroupType, value: StudioValueType, donut: BooleanType, legend: StudioPieLegendType });

/** Type representing a pie chart. */
export type StudioPieChartType = typeof StudioPieChartType;

/**
 * A chart, by its kind.
 *
 * @property column - Upright columns
 * @property bar - Bars lying along the axis
 * @property line - Lines
 * @property area - Filled areas
 * @property combo - Columns and lines together
 * @property scatter - Points placed by two values
 * @property pie - Shares of one total
 */
export const StudioChartType = VariantType({
    column: StudioSeriesChartType,
    bar: StudioSeriesChartType,
    line: StudioSeriesChartType,
    area: StudioSeriesChartType,
    combo: StudioComboChartType,
    scatter: StudioScatterChartType,
    pie: StudioPieChartType,
});

/** Type representing a chart. */
export type StudioChartType = typeof StudioChartType;

/**
 * A table, by its kind.
 *
 * @property records - The source's rows as they are: the fields shown, in order, and the one they are sorted by
 * @property summary - One row a group, a second group nested in the first, each with its values; and a total row
 * @property pivot - One value where a row group meets a column group; as a heat map when asked
 */
export const StudioTableType = VariantType({
    records: StructType({ columns: ArrayType(StringType), sort: OptionType(StringType), descending: BooleanType }),
    summary: StructType({ rows: ArrayType(StudioGroupType), values: ArrayType(StudioValueType), total: BooleanType }),
    pivot: StructType({ rows: StudioGroupType, columns: StudioGroupType, value: StudioValueType, heat: BooleanType }),
});

/** Type representing a table. */
export type StudioTableType = typeof StudioTableType;

/**
 * A list: one row an item, with a caption and up to two values.
 *
 * @property item - What a row stands for
 * @property caption - A field shown under the item's name; `none` shows none
 * @property values - The values at the row's end
 * @property bar - Whether a bar ranks the first value against the largest
 */
export const StudioListType = StructType({
    item: StudioGroupType,
    caption: OptionType(StringType),
    values: ArrayType(StudioValueType),
    bar: BooleanType,
});

/** Type representing a list. */
export type StudioListType = typeof StudioListType;

const StudioViewTypeImpl = VariantType({
    kpi: StudioKpiType,
    chart: StudioChartType,
    table: StudioTableType,
    list: StudioListType,
});
type StudioViewTypeImpl = typeof StudioViewTypeImpl;

/**
 * Type representing what a visual draws.
 *
 * @remarks
 * An interface, so a type that mentions it — a placement, a page, the pages
 * record — refers to it by name in declaration output rather than spelling
 * out its every case, which is past the length TypeScript will serialize
 * (TS7056).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the empty interface is the point: it attaches a symbol the declaration emitter can reference by name
export interface StudioViewType extends StudioViewTypeImpl {}

/**
 * What a visual draws.
 *
 * @property kpi - One number, and how it stands
 * @property chart - A chart, by its kind
 * @property table - A table, by its kind
 * @property list - A list of items with their values
 */
export const StudioViewType: StudioViewType = StudioViewTypeImpl;

// ============================================================================
// A visual, a text block, and a placement's content
// ============================================================================

/**
 * What a click on a visual's mark, row or cell does.
 *
 * @property select - It is the visual's selection, which a visual that follows it reads
 * @property filter - It narrows the page: every visual of the source
 * @property open - It opens a page, narrowed to what was clicked
 * @property none - Nothing
 */
export const StudioClickType = VariantType({ select: NullType, filter: NullType, open: StudioKeyType, none: NullType });

/** Type representing what a click on a visual does. */
export type StudioClickType = typeof StudioClickType;

/**
 * The visual a visual follows: it shows the rows that match its leader's selection.
 *
 * @property leader - The key of the placement it follows
 * @property from - The leader's field its selection is read from
 * @property to - This visual's field that matches it
 * @property empty - What it shows while its leader has nothing selected: everything, or a prompt
 */
export const StudioFollowType = StructType({
    leader: StringType,
    from: StringType,
    to: StringType,
    empty: VariantType({ all: NullType, prompt: NullType }),
});

/** Type representing the visual a visual follows. */
export type StudioFollowType = typeof StudioFollowType;

const StudioVisualTypeImpl = StructType({
    source: StringType,
    where: OptionType(JqType),
    view: StudioViewType,
    click: StudioClickType,
    follow: OptionType(StudioFollowType),
});
type StudioVisualTypeImpl = typeof StudioVisualTypeImpl;

/**
 * Type representing a visual.
 *
 * @remarks
 * An interface, so a type that mentions it — a placement, a page, the pages
 * record — refers to it by name in declaration output rather than spelling
 * out its every case, which is past the length TypeScript will serialize
 * (TS7056).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the empty interface is the point: it attaches a symbol the declaration emitter can reference by name
export interface StudioVisualType extends StudioVisualTypeImpl {}

/**
 * A visual: what an operator builds over a source the surface lists.
 *
 * @property source - The key of a listed source: the root field its query reads
 * @property where - Its own filter: a jq condition over one row; `none` keeps every row
 * @property view - What it draws ({@link StudioViewType})
 * @property click - What a click on it does
 * @property follow - The visual it follows; `none` follows none
 */
export const StudioVisualType: StudioVisualType = StudioVisualTypeImpl;

/**
 * A text block: a heading over plain paragraphs, drawn with no frame.
 *
 * @property heading - Its heading; `none` draws none
 * @property body - Its text: a blank line starts a new paragraph
 */
export const StudioTextType = StructType({ heading: OptionType(StringType), body: StringType });

/** Type representing a text block. */
export type StudioTextType = typeof StudioTextType;

const StudioContentTypeImpl = VariantType({
    component: StringType,
    visual: StudioVisualType,
    text: StudioTextType,
});
type StudioContentTypeImpl = typeof StudioContentTypeImpl;

/**
 * Type representing what a placement holds.
 *
 * @remarks
 * An interface, so a type that mentions it — a placement, a page, the pages
 * record — refers to it by name in declaration output rather than spelling
 * out its every case, which is past the length TypeScript will serialize
 * (TS7056).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the empty interface is the point: it attaches a symbol the declaration emitter can reference by name
export interface StudioContentType extends StudioContentTypeImpl {}

/**
 * What a placement holds.
 *
 * @property component - A developer's component, by its key
 * @property visual - A visual an operator builds
 * @property text - A text block
 */
export const StudioContentType: StudioContentType = StudioContentTypeImpl;

// ============================================================================
// A placement's content, in words
// ============================================================================

/** A view, in words: "KPI", "Column chart", "Summary table". */
export const viewWords = East.function([StudioViewType], StringType, (_$, view) => view.match({
    kpi: (_$2) => East.value("KPI"),
    chart: (_$2, chart) => chart.match({
        column: (_$3) => East.value("Column chart"),
        bar: (_$3) => East.value("Bar chart"),
        line: (_$3) => East.value("Line chart"),
        area: (_$3) => East.value("Area chart"),
        combo: (_$3) => East.value("Combo chart"),
        scatter: (_$3) => East.value("Scatter chart"),
        pie: (_$3, pie) => pie.donut.ifElse(() => "Donut chart", () => "Pie chart"),
    }),
    table: (_$2, table) => table.match({
        records: (_$3) => East.value("Records table"),
        summary: (_$3) => East.value("Summary table"),
        pivot: (_$3) => East.value("Pivot table"),
    }),
    list: (_$2) => East.value("List"),
}));

/** A view's icon: a Font Awesome solid icon name. */
export const viewIcon = East.function([StudioViewType], StringType, (_$, view) => view.match({
    kpi: (_$2) => East.value("gauge-high"),
    chart: (_$2, chart) => chart.match({
        column: (_$3) => East.value("chart-column"),
        bar: (_$3) => East.value("chart-bar"),
        line: (_$3) => East.value("chart-line"),
        area: (_$3) => East.value("chart-area"),
        combo: (_$3) => East.value("chart-simple"),
        scatter: (_$3) => East.value("braille"),
        pie: (_$3) => East.value("chart-pie"),
    }),
    table: (_$2, table) => table.match({
        records: (_$3) => East.value("table-list"),
        summary: (_$3) => East.value("table"),
        pivot: (_$3) => East.value("table-cells"),
    }),
    list: (_$2) => East.value("list"),
}));

/**
 * What a view holds that a change counts, and what it is called: the values a
 * view measures — a KPI's, a chart's, a summary's — or, for a view that
 * measures none, what it holds in their place: a records table's columns.
 */
const ViewCountType = StructType({ noun: StringType, count: IntegerType });

/** How many of them a view holds ({@link ViewCountType}): what a change of them counts. */
const viewCount = East.function([StudioViewType], ViewCountType, (_$, view) => view.match({
    kpi: (_$2, kpi) => East.value({ noun: "values", count: kpi.compare.hasTag("some").ifElse(() => 2n, () => 1n) }, ViewCountType),
    chart: (_$2, chart) => East.value({
        noun: "values",
        count: chart.match({
            column: (_$3, series) => series.values.size(),
            bar: (_$3, series) => series.values.size(),
            line: (_$3, series) => series.values.size(),
            area: (_$3, series) => series.values.size(),
            combo: (_$3, combo) => combo.columns.size().add(combo.lines.size()),
            scatter: (_$3) => East.value(2n),
            pie: (_$3) => East.value(1n),
        }),
    }, ViewCountType),
    table: (_$2, table) => table.match({
        records: (_$3, records) => East.value({ noun: "columns", count: records.columns.size() }, ViewCountType),
        summary: (_$3, summary) => East.value({ noun: "values", count: summary.values.size() }, ViewCountType),
        pivot: (_$3) => East.value({ noun: "values", count: 1n }, ViewCountType),
    }),
    list: (_$2, list) => East.value({ noun: "values", count: list.values.size() }, ViewCountType),
}));

/** What a click does, in words: "select", "filter", "none", or the page it opens — "open Ops / Weekly". */
const clickWords = East.function([StudioClickType], StringType, (_$, click) => click.match({
    select: (_$2) => East.value("select"),
    filter: (_$2) => East.value("filter"),
    open: (_$2, page) => East.str`open ${page.project} / ${page.page}`,
    none: (_$2) => East.value("none"),
}));

/**
 * A visual, in words: its view and its source's name — "Column chart ·
 * Orders", its source's key where the surface lists none of that key.
 *
 * @remarks
 * `sources` is each listed source's name, by its key (`sourceNames`).
 */
export const visualWords = East.function(
    [StudioVisualType, DictType(StringType, StringType)],
    StringType,
    (_$, visual, sources) => East.str`${viewWords(visual.view)} · ${sourceName(visual.source, sources)}`,
);

/**
 * What a placement holds, in words: a component by its name, its key where
 * the surface lists none of that key; a visual by its view and its source
 * ({@link visualWords}); a text block as "Text".
 *
 * @remarks
 * `sources` is each listed source's name, by its key (`sourceNames`), and
 * `components` each listed component's (`componentNames`).
 */
export const contentWords = East.function(
    [StudioContentType, DictType(StringType, StringType), DictType(StringType, StringType)],
    StringType,
    (_$, content, sources, components) => content.match({
        component: (_$2, key) => components.tryGet(key).match({
            some: (_$3, name) => name,
            none: (_$3) => key,
        }),
        visual: (_$2, visual) => visualWords(visual, sources),
        text: (_$2) => East.value("Text"),
    }),
);

/**
 * What changed between two contents of one placement, in words, as the
 * publish preview's change list says it: a visual's source ("source Orders →
 * Assets"), its view ("view Column chart → Line chart"), how many values it
 * holds ("values 1 → 2") — a records table's columns by their own name
 * ("columns 3 → 4"), and nothing where the view changed to
 * one that holds another — its filter, what a click does ("click filter →
 * open Ops / Weekly") and what it follows, joined with ` · `; "options
 * changed" for a visual changed in none of those; a text block's as "text
 * edited"; and a placement now holding another kind of content, or another
 * component, as what it held and what it holds ({@link contentWords}).
 *
 * @remarks
 * `sources` is each listed source's name, by its key (`sourceNames`), and
 * `components` each listed component's (`componentNames`).
 */
export const contentChange = East.function(
    [StudioContentType, StudioContentType, DictType(StringType, StringType), DictType(StringType, StringType)],
    StringType,
    ($, old, now, sources, components) => {
        const parts = $.let([], ArrayType(StringType));
        $.match(now, {
            text: ($2) => {
                $2.if(old.hasTag("text"), ($3) => {
                    $3(parts.pushLast("text edited"));
                });
            },
            visual: ($2, visual) => {
                $2.match(old, {
                    visual: ($3, was) => {
                        $3.if(East.notEqual(was.source, visual.source), ($4) => {
                            $4(parts.pushLast(East.str`source ${sourceName(was.source, sources)} → ${sourceName(visual.source, sources)}`));
                        });
                        const wasView = $3.let(viewWords(was.view));
                        const nowView = $3.let(viewWords(visual.view));
                        $3.if(East.notEqual(wasView, nowView), ($4) => {
                            $4(parts.pushLast(East.str`view ${wasView} → ${nowView}`));
                        });
                        // A count is said under its own name, where both views hold the same thing.
                        const wasCount = $3.let(viewCount(was.view));
                        const nowCount = $3.let(viewCount(visual.view));
                        $3.if(wasCount.noun.equal(nowCount.noun).and(() => wasCount.count.notEqual(nowCount.count)), ($4) => {
                            $4(parts.pushLast(East.str`${nowCount.noun} ${East.print(wasCount.count)} → ${East.print(nowCount.count)}`));
                        });
                        $3.if(East.notEqual(was.where, visual.where), ($4) => {
                            $4(parts.pushLast("filter changed"));
                        });
                        $3.if(East.notEqual(was.click, visual.click), ($4) => {
                            $4(parts.pushLast(East.str`click ${clickWords(was.click)} → ${clickWords(visual.click)}`));
                        });
                        $3.if(East.notEqual(was.follow, visual.follow), ($4) => {
                            $4(parts.pushLast("link changed"));
                        });
                        $3.if(parts.size().equal(0n), ($4) => {
                            $4(parts.pushLast("options changed"));
                        });
                    },
                });
            },
        });
        // Another kind of content, or another component: what it held, and what it holds.
        return parts.size().equal(0n).ifElse(
            () => East.str`${contentWords(old, sources, components)} → ${contentWords(now, sources, components)}`,
            () => parts.stringJoin(" · "),
        );
    },
);

/**
 * A text block's paragraphs, as it draws them: its text cut at each blank
 * line — a line that is empty or only spaces — each paragraph trimmed, and
 * none empty. A line break inside a paragraph is kept.
 */
export const textParagraphs = East.function([StringType], ArrayType(StringType), (_$, body) =>
    body.replace(/\r\n?/g, "\n").replace(/\n\s*\n/g, "\n\n").split("\n\n")
        .map((_$2, paragraph) => paragraph.trim())
        .filter((_$2, paragraph) => paragraph.length().greater(0n)));

// ============================================================================
// Building them, with their defaults
// ============================================================================

/** A value, decoded. */
export type StudioValue = ValueTypeOf<StudioValueType>;
/** A group, decoded. */
export type StudioGroup = ValueTypeOf<StudioGroupType>;
/** A combo chart's value, decoded. */
export type StudioAxisValue = ValueTypeOf<StudioAxisValueType>;
/** A view, decoded. */
export type StudioView = ValueTypeOf<StudioViewType>;
/** A visual, decoded. */
export type StudioVisual = ValueTypeOf<StudioVisualType>;
/** A placement's content, decoded. */
export type StudioContent = ValueTypeOf<StudioContentType>;

/** How a value reads, beside its measure: each has a default. */
export interface StudioValueOptions {
    /** Its name; one made from its measure unless given. */
    label?: string;
    /** The period it is measured over; the page's range unless given. */
    period?: "current" | "previous" | "year_ago";
    /** A goal to draw against; none unless given. */
    goal?: number;
    /** Which way is better; higher unless given. */
    better?: "higher" | "lower";
    /** How its numbers are shown — `"number"`, `"percent"`, `{ currency: { code: "AUD" } }`; as its field's format says unless given. */
    format?: SliceFieldFormat;
}

/** How a group is cut and ordered: each has a default. */
export interface StudioGroupOptions {
    /** For a date, the unit it is bucketed by; the value itself unless given. */
    bucket?: Exclude<TimeResolutionLiteral, "auto">;
    /** The groups' order; the field's own unless given. */
    sort?: "natural" | "high" | "low" | "label";
    /** Keep the first N groups, the rest as Other; every group unless given. */
    top?: bigint;
}

/** What a visual has beside its view: each has a default. */
export interface StudioVisualOptions {
    /** Its own filter: a checked jq condition over one row; every row unless given. */
    where?: ValueTypeOf<typeof JqType>;
    /** What a click does; its view's default unless given — select for a table or a list, filter for a chart or a KPI. */
    click?: ValueTypeOf<StudioClickType>;
    /** The visual it follows; none unless given. */
    follow?: ValueTypeOf<StudioFollowType>;
}

/** A value of a measure, with its defaults. */
function valueOf(measure: ValueTypeOf<StudioMeasureType>, options: StudioValueOptions = {}): StudioValue {
    return {
        measure,
        label: options.label === undefined ? none : some(options.label),
        period: variant(options.period ?? "current", null),
        goal: options.goal === undefined ? none : some(options.goal),
        better: variant(options.better ?? "higher", null),
        format: options.format === undefined ? none : some(toValueFormat(options.format)),
    };
}

/**
 * What a group is, with its defaults.
 *
 * @param field - The field
 * @param options - Its bucket, its order and how many groups it keeps
 * @returns The group
 */
function groupOf(field: string, options: StudioGroupOptions = {}): StudioGroup {
    return {
        field,
        bucket: options.bucket === undefined ? none : some(variant(options.bucket, null)),
        sort: variant(options.sort ?? "natural", null),
        top: options.top === undefined ? none : some(options.top),
    };
}

/** The click a view takes unless one is given: select for a table or a list, filter for a chart or a KPI. */
function defaultClick(view: StudioView): ValueTypeOf<StudioClickType> {
    switch (view.type) {
        case "table": case "list": return variant("select", null);
        case "chart": case "kpi": return variant("filter", null);
    }
}

/**
 * A visual over a source, as a placement's content.
 *
 * @param source - The key of a listed source
 * @param view - What it draws
 * @param options - Its own filter, what a click does and the visual it follows
 * @returns The content
 */
function visualOf(source: string, view: StudioView, options: StudioVisualOptions = {}): StudioContent {
    return variant("visual", {
        source,
        where: options.where === undefined ? none : some(options.where),
        view,
        click: options.click ?? defaultClick(view),
        follow: options.follow === undefined ? none : some(options.follow),
    });
}

/** A chart of series along one axis, as a view. */
function seriesOf(kind: "column" | "bar" | "line" | "area", chart: {
    x: StudioGroup; values: readonly StudioValue[]; split?: string; stack?: "none" | "stacked" | "percent"; legend?: "auto" | "hidden";
}): StudioView {
    return variant("chart", variant(kind, {
        x: chart.x,
        values: [...chart.values],
        split: chart.split === undefined ? none : some(chart.split),
        stack: variant(chart.stack ?? "none", null),
        legend: variant(chart.legend ?? "auto", null),
    }));
}

/**
 * Builds a placement's content and a visual's parts, each with its defaults —
 * plain values, for a pages record's seeds and for tests.
 *
 * @example
 * ```ts
 * // A stacked column of revenue by month, split by region, over the orders source.
 * const revenue = Studio.visual.of("orders", Studio.visual.column({
 *     x: Studio.visual.group("ordered_at", { bucket: "month" }),
 *     values: [Studio.visual.sum("revenue")],
 *     split: "region",
 *     stack: "stacked",
 * }));
 * const cell = { key: "c-revenue", row: "r1", span: 6n, height: none, align: variant("top", null), title: none, content: revenue };
 * ```
 */
export const StudioVisuals = {
    /** A developer's component, by its key, as a placement's content. */
    component: (key: string): StudioContent => variant("component", key),
    /** A text block as a placement's content: its text, and a heading when given. */
    text: (body: string, heading?: string): StudioContent => variant("text", { heading: heading === undefined ? none : some(heading), body }),
    /** A visual over a source as a placement's content ({@link visualOf}). */
    of: visualOf,

    /** What a visual groups by ({@link groupOf}). */
    group: groupOf,
    /** How many rows. */
    count: (options?: StudioValueOptions): StudioValue => valueOf(variant("count", null), options),
    /** The total of a field. */
    sum: (field: string, options?: StudioValueOptions): StudioValue => valueOf(variant("sum", field), options),
    /** The mean of a field. */
    mean: (field: string, options?: StudioValueOptions): StudioValue => valueOf(variant("mean", field), options),
    /** The least of a field. */
    min: (field: string, options?: StudioValueOptions): StudioValue => valueOf(variant("min", field), options),
    /** The most of a field. */
    max: (field: string, options?: StudioValueOptions): StudioValue => valueOf(variant("max", field), options),
    /** How many different values a field has. */
    distinct: (field: string, options?: StudioValueOptions): StudioValue => valueOf(variant("distinct", field), options),
    /** One field's total over another's. */
    ratio: (of: string, per: string, options?: StudioValueOptions): StudioValue => valueOf(variant("ratio", { of, per }), options),

    /** A KPI: its value, a value to compare it with and a date field for its trend. */
    kpi: (kpi: { value: StudioValue; compare?: StudioValue; trend?: string }): StudioView => variant("kpi", {
        value: kpi.value,
        compare: kpi.compare === undefined ? none : some(kpi.compare),
        trend: kpi.trend === undefined ? none : some(kpi.trend),
    }),
    /** A column chart. */
    column: (chart: Parameters<typeof seriesOf>[1]): StudioView => seriesOf("column", chart),
    /** A bar chart. */
    bar: (chart: Parameters<typeof seriesOf>[1]): StudioView => seriesOf("bar", chart),
    /** A line chart. */
    line: (chart: Parameters<typeof seriesOf>[1]): StudioView => seriesOf("line", chart),
    /** An area chart. */
    area: (chart: Parameters<typeof seriesOf>[1]): StudioView => seriesOf("area", chart),
    /** A value of a combo chart read against the left axis. */
    left: (value: StudioValue): StudioAxisValue => ({ value, right: false }),
    /** A value of a combo chart read against the right axis. */
    right: (value: StudioValue): StudioAxisValue => ({ value, right: true }),
    /** A combo chart: columns and lines on one axis, each made with `left` or `right` for the axis it reads against. */
    combo: (chart: {
        x: StudioGroup; columns: readonly StudioAxisValue[]; lines: readonly StudioAxisValue[]; stack?: "none" | "stacked" | "percent"; legend?: "auto" | "hidden";
    }): StudioView => variant("chart", variant("combo", {
        x: chart.x,
        columns: [...chart.columns],
        lines: [...chart.lines],
        stack: variant(chart.stack ?? "none", null),
        legend: variant(chart.legend ?? "auto", null),
    })),
    /** A scatter chart: a point for each value of a field, placed by two values. */
    scatter: (chart: { point: string; x: StudioValue; y: StudioValue; split?: string; legend?: "auto" | "hidden" }): StudioView => variant("chart", variant("scatter", {
        point: chart.point, x: chart.x, y: chart.y, split: chart.split === undefined ? none : some(chart.split),
        legend: variant(chart.legend ?? "auto", null),
    })),
    /** A pie chart, or a donut: its legend each slice's value and share unless it shows their names alone, or is hidden. */
    pie: (chart: { slice: StudioGroup; value: StudioValue; donut?: boolean; legend?: "values" | "names" | "hidden" }): StudioView => variant("chart", variant("pie", {
        slice: chart.slice, value: chart.value, donut: chart.donut ?? false, legend: variant(chart.legend ?? "values", null),
    })),
    /** A table of the source's rows: the fields shown, and the one they are sorted by. */
    records: (table: { columns: readonly string[]; sort?: string; descending?: boolean }): StudioView => variant("table", variant("records", {
        columns: [...table.columns], sort: table.sort === undefined ? none : some(table.sort), descending: table.descending ?? false,
    })),
    /** A summary table: a row a group, with its values, and a total row when asked. */
    summary: (table: { rows: readonly StudioGroup[]; values: readonly StudioValue[]; total?: boolean }): StudioView => variant("table", variant("summary", {
        rows: [...table.rows], values: [...table.values], total: table.total ?? false,
    })),
    /** A pivot table: one value where a row group meets a column group. */
    pivot: (table: { rows: StudioGroup; columns: StudioGroup; value: StudioValue; heat?: boolean }): StudioView => variant("table", variant("pivot", {
        rows: table.rows, columns: table.columns, value: table.value, heat: table.heat ?? false,
    })),
    /** A list: a row an item, with a caption, its values, and a ranking bar when asked. */
    list: (list: { item: StudioGroup; caption?: string; values: readonly StudioValue[]; bar?: boolean }): StudioView => variant("list", {
        item: list.item, caption: list.caption === undefined ? none : some(list.caption), values: [...list.values], bar: list.bar ?? false,
    }),
};
