/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Configure tab's rules, in East (#1672): what an edit of a visual makes
 * of it, by each kind's editor (`editors.ts`).
 *
 * - **The kind a view is** ({@link kindOfView}), and **a kind with nothing in
 *   its wells** ({@link emptyView}, MOD-4).
 * - **A placed field's pill** ({@link placedPill}, MOD-6): a number in a value
 *   well summed, any other field counted by its values; a date grouped by month
 *   in time order, any other group highest first.
 * - **The measures a field's value may take** ({@link fieldMeasures}, EDT-4).
 * - **A change of kind** ({@link switchedView}, EDT-8): within a view, every
 *   well that fits carries over; across views, the new kind starts empty.
 * - **The source a dropped visual reads** ({@link mostUsedSource}, BLD-2).
 *
 * The functions are compiled once in the renderer. A decoded view's fields
 * and wells are read and written in TypeScript beside them — `kind.ts`,
 * `wells.ts` — and what an edit changed from what is saved in `changed.ts`.
 *
 * @packageDocumentation
 */

import { ArrayType, East, OptionType, StringType, StructType, none, some, variant } from "@elaraai/east";
import { TimeResolutionType } from "@elaraai/east-ui";
import {
    StudioChartType,
    StudioGroupType,
    StudioLegendType,
    StudioMeasureType,
    StudioPieLegendType,
    StudioSeriesChartType,
    StudioSortType,
    StudioTableType,
    StudioValueType,
    StudioViewType,
    StudioVisuals,
    type StudioView,
} from "./content.js";
import { StudioKindType, StudioPillType, StudioWellType, type StudioKind, type StudioKindLiteral } from "./editors.js";
import { StudioCellType } from "./pages.js";
import { StudioFieldType, StudioSourceType } from "./source.js";
import { COUNT, EMPTY_GROUP } from "./wells.js";

/** Each kind with nothing in its wells: what a dropped visual, and a change of view, start from (MOD-4). */
const EMPTY_VIEWS: { readonly [K in StudioKindLiteral]: StudioView } = {
    kpi: StudioVisuals.kpi({ value: COUNT }),
    column: StudioVisuals.column({ x: EMPTY_GROUP, values: [] }),
    bar: StudioVisuals.bar({ x: EMPTY_GROUP, values: [] }),
    line: StudioVisuals.line({ x: EMPTY_GROUP, values: [] }),
    area: StudioVisuals.area({ x: EMPTY_GROUP, values: [] }),
    combo: StudioVisuals.combo({ x: EMPTY_GROUP, columns: [], lines: [] }),
    scatter: StudioVisuals.scatter({ point: "", x: COUNT, y: COUNT }),
    pie: StudioVisuals.pie({ slice: EMPTY_GROUP, value: COUNT }),
    records: StudioVisuals.records({ columns: [] }),
    summary: StudioVisuals.summary({ rows: [], values: [] }),
    pivot: StudioVisuals.pivot({ rows: EMPTY_GROUP, columns: EMPTY_GROUP, value: COUNT }),
    list: StudioVisuals.list({ item: EMPTY_GROUP, values: [] }),
};

/** Each kind, as the kind a view is. */
const HELD: { readonly [K in StudioKindLiteral]: StudioKind } = {
    kpi: variant("kpi", null),
    column: variant("column", null),
    bar: variant("bar", null),
    line: variant("line", null),
    area: variant("area", null),
    combo: variant("combo", null),
    scatter: variant("scatter", null),
    pie: variant("pie", null),
    records: variant("records", null),
    summary: variant("summary", null),
    pivot: variant("pivot", null),
    list: variant("list", null),
};

/** The kind a view is. */
export const kindOfView = East.function([StudioViewType], StudioKindType, (_$, view) => view.match({
    kpi: (_$2) => East.value(HELD.kpi, StudioKindType),
    chart: (_$2, chart) => chart.match({
        column: (_$3) => East.value(HELD.column, StudioKindType),
        bar: (_$3) => East.value(HELD.bar, StudioKindType),
        line: (_$3) => East.value(HELD.line, StudioKindType),
        area: (_$3) => East.value(HELD.area, StudioKindType),
        combo: (_$3) => East.value(HELD.combo, StudioKindType),
        scatter: (_$3) => East.value(HELD.scatter, StudioKindType),
        pie: (_$3) => East.value(HELD.pie, StudioKindType),
    }),
    table: (_$2, table) => table.match({
        records: (_$3) => East.value(HELD.records, StudioKindType),
        summary: (_$3) => East.value(HELD.summary, StudioKindType),
        pivot: (_$3) => East.value(HELD.pivot, StudioKindType),
    }),
    list: (_$2) => East.value(HELD.list, StudioKindType),
}));

/**
 * A kind with nothing in its wells (MOD-4): its groups of no field, its
 * single values a count of the rows, its lists empty and its options their
 * defaults — what a dropped visual starts as, and a change of view resets to.
 */
export const emptyView = East.function([StudioKindType], StudioViewType, (_$, kind) => kind.match({
    kpi: (_$2) => East.value(EMPTY_VIEWS.kpi, StudioViewType),
    column: (_$2) => East.value(EMPTY_VIEWS.column, StudioViewType),
    bar: (_$2) => East.value(EMPTY_VIEWS.bar, StudioViewType),
    line: (_$2) => East.value(EMPTY_VIEWS.line, StudioViewType),
    area: (_$2) => East.value(EMPTY_VIEWS.area, StudioViewType),
    combo: (_$2) => East.value(EMPTY_VIEWS.combo, StudioViewType),
    scatter: (_$2) => East.value(EMPTY_VIEWS.scatter, StudioViewType),
    pie: (_$2) => East.value(EMPTY_VIEWS.pie, StudioViewType),
    records: (_$2) => East.value(EMPTY_VIEWS.records, StudioViewType),
    summary: (_$2) => East.value(EMPTY_VIEWS.summary, StudioViewType),
    pivot: (_$2) => East.value(EMPTY_VIEWS.pivot, StudioViewType),
    list: (_$2) => East.value(EMPTY_VIEWS.list, StudioViewType),
}));

/**
 * A field as a group (MOD-6): a date bucketed by month in time order, any
 * other field highest first; every group kept.
 */
export const fieldGroup = East.function([StudioFieldType], StudioGroupType, (_$, field) => East.value({
    field: field.id,
    bucket: field.kind.hasTag("date").ifElse(
        () => East.value(some(variant("month", null)), OptionType(TimeResolutionType)),
        () => East.value(none, OptionType(TimeResolutionType)),
    ),
    sort: field.kind.hasTag("date").ifElse(
        () => East.value(variant("natural", null), StudioSortType),
        () => East.value(variant("high", null), StudioSortType),
    ),
    top: none,
}, StudioGroupType));

/**
 * The pill a field makes placed in a well (MOD-6): in a value well a number
 * summed and any other field counted by its values, measured over the page's
 * range, higher the better; in a combo's well the same, against the left
 * axis; in a group well its group ({@link fieldGroup}); in a field's well, the
 * field.
 */
export const placedPill = East.function([StudioWellType, StudioFieldType], StudioPillType, ($, held, field) => {
    const value = $.let({
        measure: field.kind.hasTag("number").ifElse(
            () => East.value(variant("sum", field.id), StudioMeasureType),
            () => East.value(variant("distinct", field.id), StudioMeasureType),
        ),
        label: none,
        period: variant("current", null),
        goal: none,
        better: variant("higher", null),
        format: none,
    }, StudioValueType);
    return held.holds.match({
        value: (_$2) => East.value(variant("value", value), StudioPillType),
        axis: (_$2) => East.value(variant("axis", { value, right: false }), StudioPillType),
        group: (_$2) => East.value(variant("group", fieldGroup(field)), StudioPillType),
        field: (_$2) => East.value(variant("field", field.id), StudioPillType),
    });
});

/**
 * The measures a value of a field may take (EDT-4): a number's total, mean,
 * least, most and distinct values, and how many rows; any other field's
 * distinct values, and how many rows. A ratio of one number per another is
 * offered beside them.
 */
export const fieldMeasures = East.function([StudioFieldType], ArrayType(StudioMeasureType), (_$, field) => field.kind.hasTag("number").ifElse(
    () => East.value([
        variant("sum", field.id), variant("mean", field.id), variant("min", field.id), variant("max", field.id),
        variant("distinct", field.id), variant("count", null),
    ], ArrayType(StudioMeasureType)),
    () => East.value([variant("distinct", field.id), variant("count", null)], ArrayType(StudioMeasureType)),
));

/**
 * A field of a source, by its id, as a group: its kind's defaults
 * ({@link fieldGroup}), and in its own order where the source does not list it.
 */
const groupOfId = East.function([StringType, ArrayType(StudioFieldType)], StudioGroupType, ($, id, fields) => {
    const listed = $.let(fields.firstMap((_$2, field) => field.id.equal(id).ifElse(
        () => East.value(some(field), OptionType(StudioFieldType)),
        () => East.value(none, OptionType(StudioFieldType)),
    )));
    return listed.match({
        some: (_$2, field) => fieldGroup(field),
        none: (_$2) => East.value({ field: id, bucket: none, sort: variant("natural", null), top: none }, StudioGroupType),
    });
});

/**
 * A chart's wells as the four series kinds hold them — what a change of chart
 * kind carries: a combo's columns then its lines as the values; a scatter's
 * point as the axis and its two values; a pie's slices as the axis and its
 * value. Its legend stays hidden where it was, and is drawn where it was.
 */
const chartWells = East.function([StudioChartType], StudioSeriesChartType, (_$, chart) => chart.match({
    column: (_$2, series) => series,
    bar: (_$2, series) => series,
    line: (_$2, series) => series,
    area: (_$2, series) => series,
    combo: (_$2, combo) => East.value({
        x: combo.x,
        values: combo.columns.map((_$3, axis) => axis.value).concat(combo.lines.map((_$3, axis) => axis.value)),
        split: none,
        stack: combo.stack,
        legend: combo.legend,
    }, StudioSeriesChartType),
    scatter: (_$2, scatter) => East.value({
        x: { field: scatter.point, bucket: none, sort: variant("natural", null), top: none },
        values: [scatter.x, scatter.y],
        split: scatter.split,
        stack: variant("none", null),
        legend: scatter.legend,
    }, StudioSeriesChartType),
    pie: (_$2, pie) => East.value({
        x: pie.slice,
        values: [pie.value],
        split: none,
        stack: variant("none", null),
        legend: pie.legend.hasTag("hidden").ifElse(
            () => East.value(variant("hidden", null), StudioLegendType),
            () => East.value(variant("auto", null), StudioLegendType),
        ),
    }, StudioSeriesChartType),
}));

/**
 * A chart kind made from a series' wells (the Chart chapter): the four series
 * kinds keep them all, a line its stack too; a combo takes the values as its
 * columns, against the left axis; a scatter takes the axis's field as its
 * point and the first two values as its X and Y; a pie takes the axis as its
 * slices and the first value, its legend each slice's value and share unless
 * the series' was hidden. `none` for a kind that is no chart.
 */
const chartOfKind = East.function([StudioKindType, StudioSeriesChartType], OptionType(StudioChartType), (_$, kind, series) => kind.match({
    column: (_$2) => East.value(some(variant("column", series)), OptionType(StudioChartType)),
    bar: (_$2) => East.value(some(variant("bar", series)), OptionType(StudioChartType)),
    line: (_$2) => East.value(some(variant("line", series)), OptionType(StudioChartType)),
    area: (_$2) => East.value(some(variant("area", series)), OptionType(StudioChartType)),
    combo: (_$2) => East.value(some(variant("combo", {
        x: series.x,
        columns: series.values.map((_$3, value) => ({ value, right: false })),
        lines: [],
        stack: series.stack,
        legend: series.legend,
    })), OptionType(StudioChartType)),
    scatter: (_$2) => East.value(some(variant("scatter", {
        point: series.x.field,
        x: series.values.get(0n, (_$3) => COUNT),
        y: series.values.get(1n, (_$3) => COUNT),
        split: series.split,
        legend: series.legend,
    })), OptionType(StudioChartType)),
    pie: (_$2) => East.value(some(variant("pie", {
        slice: series.x,
        value: series.values.get(0n, (_$3) => COUNT),
        donut: false,
        legend: series.legend.hasTag("hidden").ifElse(
            () => East.value(variant("hidden", null), StudioPieLegendType),
            () => East.value(variant("values", null), StudioPieLegendType),
        ),
    })), OptionType(StudioChartType)),
}, (_$2) => East.value(none, OptionType(StudioChartType))));

/** A table's wells in one shape: its groups, its values, and the fields a records table shows. */
const TableWellsType = StructType({
    rows: ArrayType(StudioGroupType),
    values: ArrayType(StudioValueType),
    columns: ArrayType(StringType),
});

/** The fields of some groups, each once, in order: what a records table shows of a summary's or a pivot's groups. */
const groupFields = East.function([ArrayType(StudioGroupType)], ArrayType(StringType), ($, groups) => {
    const fields = $.let([], ArrayType(StringType));
    $.for(groups, ($2, group) => {
        $2.if(group.field.notEqual("").and(() => fields.some((_$3, field) => field.equal(group.field)).not()), ($3) => {
            $3(fields.pushLast(group.field));
        });
    });
    return fields;
});

/**
 * A table's wells in one shape — what a change of table kind carries: a
 * records table's first two columns as groups; a summary's groups and values;
 * a pivot's rows and columns as groups, and its value.
 */
const tableWells = East.function([StudioTableType, ArrayType(StudioFieldType)], TableWellsType, ($, table, fields) => table.match({
    records: (_$2, records) => East.value({
        rows: records.columns.filter((_$3, _id, at) => at.less(2n)).map((_$3, id) => groupOfId(id, fields)),
        values: [],
        columns: records.columns,
    }, TableWellsType),
    summary: (_$2, summary) => East.value({ rows: summary.rows, values: summary.values, columns: groupFields(summary.rows) }, TableWellsType),
    pivot: ($2, pivot) => {
        const rows = $2.let(East.value([pivot.rows, pivot.columns], ArrayType(StudioGroupType)).filter((_$3, group) => group.field.notEqual("")));
        const wells = $2.let({ rows, values: [pivot.value], columns: groupFields(rows) }, TableWellsType);
        return wells;
    },
}));

/**
 * A table kind made from a table's wells (the Table chapter): a records
 * table shows the groups' fields; a summary groups by the first two groups
 * with every value; a pivot's rows and columns are the first two groups and
 * its value the first value. `none` for a kind that is no table.
 */
const tableOfKind = East.function([StudioKindType, TableWellsType], OptionType(StudioTableType), (_$, kind, wells) => kind.match({
    records: (_$2) => East.value(some(variant("records", { columns: wells.columns, sort: none, descending: false })), OptionType(StudioTableType)),
    summary: (_$2) => East.value(some(variant("summary", {
        rows: wells.rows.filter((_$3, _group, at) => at.less(2n)),
        values: wells.values,
        total: false,
    })), OptionType(StudioTableType)),
    pivot: (_$2) => East.value(some(variant("pivot", {
        rows: wells.rows.get(0n, (_$3) => EMPTY_GROUP),
        columns: wells.rows.get(1n, (_$3) => EMPTY_GROUP),
        value: wells.values.get(0n, (_$3) => COUNT),
        heat: false,
    })), OptionType(StudioTableType)),
}, (_$2) => East.value(none, OptionType(StudioTableType))));

/**
 * A view switched to another kind (EDT-8, CHT-1). Within a view every well
 * that fits carries over: x, values, split and stack between the four series
 * kinds; the values as a combo's columns; the first two values as a scatter's
 * X and Y; the axis as a pie's slices with the first value; a summary's
 * groups as a pivot's rows and columns, its values as the pivot's value; a
 * records table's first two columns as groups, and the groups' fields as its
 * columns. A switch to another view starts the kind empty ({@link emptyView});
 * the same kind keeps the view as it is.
 *
 * @remarks
 * `fields` are the source's: a records table's column becomes a group by its
 * kind's defaults ({@link fieldGroup}).
 */
export const switchedView = East.function(
    [StudioViewType, StudioKindType, ArrayType(StudioFieldType)],
    StudioViewType,
    ($, view, kind, fields) => {
        const same = $.let(kindOfView(view).getTag().equal(kind.getTag()));
        $.if(same, ($2) => {
            $2.return(view);
        });
        const carried = $.let(view.match({
            chart: (_$2, chart) => chartOfKind(kind, chartWells(chart)).match({
                some: (_$3, next) => East.value(some(variant("chart", next)), OptionType(StudioViewType)),
                none: (_$3) => East.value(none, OptionType(StudioViewType)),
            }),
            table: (_$2, table) => tableOfKind(kind, tableWells(table, fields)).match({
                some: (_$3, next) => East.value(some(variant("table", next)), OptionType(StudioViewType)),
                none: (_$3) => East.value(none, OptionType(StudioViewType)),
            }),
        }, (_$2) => East.value(none, OptionType(StudioViewType))));
        return carried.match({
            some: (_$2, next) => next,
            none: (_$2) => emptyView(kind),
        });
    },
);

/**
 * The source a dropped visual reads (BLD-2): the one the page's visuals read
 * most, the first listed of those read as often; the first listed when no
 * visual reads one. `none` when the surface lists no source.
 */
export const mostUsedSource = East.function(
    [ArrayType(StudioCellType), ArrayType(StudioSourceType)],
    OptionType(StringType),
    ($, cells, sources) => {
        const best = $.let(none, OptionType(StringType));
        const most = $.let(-1n);
        $.for(sources, ($2, source) => {
            const uses = $2.let(cells.filter((_$3, cell) => cell.content.match({
                visual: (_$4, visual) => visual.source.equal(source.key),
            }, (_$4) => false)).size());
            $2.if(uses.greater(most), ($3) => {
                $3.assign(most, uses);
                $3.assign(best, East.value(some(source.key), OptionType(StringType)));
            });
        });
        return best;
    },
);
