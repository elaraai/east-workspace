/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Configure tab's rules (#1672) — what the builder's inspector edits a
 * visual by: the pill a placed field makes, the measures its value may take,
 * the kind a view is, a kind with nothing in its wells, what a change of kind
 * carries, and the source a dropped visual reads.
 */

import { ArrayType, East, OptionType, StringType, example, none, some, variant } from "@elaraai/east";
import {
    Studio, StudioCellType, StudioFieldType, StudioKindType, StudioPillType, StudioSourceType, StudioViewType, StudioWellType,
    emptyView, fieldGroup, fieldMeasures, kindOfView, mostUsedSource, placedPill, switchedView,
} from "@elaraai/e3-ui/internal";

export const studioPlacedPill = example({
    keywords: ["Studio", "Configure", "inspector", "placedPill", "well", "pill", "field", "value", "sum", "default", "MOD-6"],
    description: "The pill a field makes placed in a well: a number in a value well is summed, over the page's range, higher the better",
    fn: East.function([], StudioPillType, ($) => {
        const well = $.const({
            field: "value", label: "Value", holds: variant("value", null), list: false, optional: false, most: none, one: none, accepts: [],
        }, StudioWellType);
        const revenue = $.const({ id: "revenue", label: "Revenue", kind: variant("number", null), format: none }, StudioFieldType);
        return placedPill(well, revenue);
    }),
    inputs: [],
    returns: variant("value", {
        measure: variant("sum", "revenue"), label: none, period: variant("current", null), goal: none, better: variant("higher", null), format: none,
    }),
});

export const studioFieldGroup = example({
    keywords: ["Studio", "Configure", "fieldGroup", "group", "bucket", "month", "date", "sort", "natural", "default", "MOD-6"],
    description: "A field as a group: a date bucketed by month in time order; any other field would sort highest first",
    fn: East.function([], StudioPillType, ($) => {
        const ordered = $.const({ id: "ordered_at", label: "Ordered", kind: variant("date", null), format: none }, StudioFieldType);
        return variant("group", fieldGroup(ordered));
    }),
    inputs: [],
    returns: variant("group", { field: "ordered_at", bucket: some(variant("month", null)), sort: variant("natural", null), top: none }),
});

export const studioFieldMeasures = example({
    keywords: ["Studio", "Configure", "fieldMeasures", "measure", "aggregate", "sum", "mean", "min", "max", "distinct", "count", "EDT-4"],
    description: "The measures a value of a number may take — its total, mean, least, most, distinct values and the rows; text or a date takes distinct and count only",
    fn: East.function([], ArrayType(Studio.Types.Measure), ($) => {
        const units = $.const({ id: "units", label: "Units", kind: variant("number", null), format: none }, StudioFieldType);
        return fieldMeasures(units);
    }),
    inputs: [],
    returns: [
        variant("sum", "units"), variant("mean", "units"), variant("min", "units"), variant("max", "units"),
        variant("distinct", "units"), variant("count", null),
    ],
});

export const studioKindOfView = example({
    keywords: ["Studio", "Configure", "kindOfView", "kind", "view", "chart", "column", "segments"],
    description: "The kind a visual's view is — the segment the Configure tab marks: a column chart's is column",
    fn: East.function([], StudioKindType, ($) => {
        const view = $.const(variant("chart", variant("column", {
            x: { field: "region", bucket: none, sort: variant("high", null), top: none },
            values: [],
            split: none,
            stack: variant("none", null),
            legend: variant("auto", null),
        })), StudioViewType);
        return kindOfView(view);
    }),
    inputs: [],
    returns: variant("column", null),
});

export const studioEmptyView = example({
    keywords: ["Studio", "Configure", "emptyView", "kind", "empty", "wells", "pie", "dropped visual", "MOD-4"],
    description: "A kind with nothing in its wells — what a dropped visual starts as: a pie's slices group no field, and its value counts the rows",
    fn: East.function([], StudioViewType, ($) => {
        const pie = $.const(variant("pie", null), StudioKindType);
        return emptyView(pie);
    }),
    inputs: [],
    returns: variant("chart", variant("pie", {
        slice: { field: "", bucket: none, sort: variant("natural", null), top: none },
        value: { measure: variant("count", null), label: none, period: variant("current", null), goal: none, better: variant("higher", null), format: none },
        donut: false,
        legend: variant("values", null),
    })),
});

export const studioSwitchedView = example({
    keywords: ["Studio", "Configure", "switchedView", "switch kind", "carry over", "column", "line", "stack", "EDT-8", "CHT-1"],
    description: "A change of kind keeps every well that fits: a column chart switched to a line keeps its axis, its values, its split and its stack",
    fn: East.function([], StudioViewType, ($) => {
        const column = $.const(variant("chart", variant("column", {
            x: { field: "region", bucket: none, sort: variant("high", null), top: none },
            values: [{ measure: variant("sum", "revenue"), label: none, period: variant("current", null), goal: none, better: variant("higher", null), format: none }],
            split: some("channel"),
            stack: variant("stacked", null),
            legend: variant("auto", null),
        })), StudioViewType);
        const line = $.const(variant("line", null), StudioKindType);
        return switchedView(column, line, []);
    }),
    inputs: [],
    returns: variant("chart", variant("line", {
        x: { field: "region", bucket: none, sort: variant("high", null), top: none },
        values: [{ measure: variant("sum", "revenue"), label: none, period: variant("current", null), goal: none, better: variant("higher", null), format: none }],
        split: some("channel"),
        stack: variant("stacked", null),
        legend: variant("auto", null),
    })),
});

export const studioMostUsedSource = example({
    keywords: ["Studio", "Configure", "mostUsedSource", "source", "palette", "drop", "most used", "BLD-2"],
    description: "The source a dropped visual reads: the one the page's visuals read most — here the assets, which two of three read",
    fn: East.function([], OptionType(StringType), ($) => {
        const sources = $.const([
            {
                key: "orders", name: "Orders", icon: "receipt", description: none,
                binding: { name: "orders", source: variant("value", [variant("field", "inputs"), variant("field", "orders")]), type: variant("Array", variant("String", null)) },
                fields: [], range: none,
            },
            {
                key: "assets", name: "Assets", icon: "gears", description: none,
                binding: { name: "assets", source: variant("value", [variant("field", "inputs"), variant("field", "assets")]), type: variant("Array", variant("String", null)) },
                fields: [], range: none,
            },
        ], ArrayType(StudioSourceType));
        const count = $.const({
            measure: variant("count", null), label: none, period: variant("current", null), goal: none, better: variant("higher", null), format: none,
        }, Studio.Types.Value);
        const cells = $.const([
            {
                key: "c-assets", row: "r1", span: 3n, height: none, align: variant("top", null), title: none,
                content: variant("visual", { source: "assets", where: none, view: variant("kpi", { value: count, compare: none, trend: none }), click: variant("filter", null), follow: none }),
            },
            {
                key: "c-orders", row: "r1", span: 3n, height: none, align: variant("top", null), title: none,
                content: variant("visual", { source: "orders", where: none, view: variant("kpi", { value: count, compare: none, trend: none }), click: variant("filter", null), follow: none }),
            },
            {
                key: "c-assets-2", row: "r1", span: 3n, height: none, align: variant("top", null), title: none,
                content: variant("visual", { source: "assets", where: none, view: variant("kpi", { value: count, compare: none, trend: none }), click: variant("filter", null), follow: none }),
            },
        ], ArrayType(StudioCellType));
        return mostUsedSource(cells, sources);
    }),
    inputs: [],
    returns: some("assets"),
});
