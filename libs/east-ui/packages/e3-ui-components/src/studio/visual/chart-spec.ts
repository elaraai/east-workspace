/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Studio chart's spec (#1671): its answers read into east-ui's `Chart.Spec`
 * nodes, which the chart's own renderer draws — a frame that fills its tile,
 * its series layers, its axes in its values' formats, a goal's dashed rule,
 * and a pie's slices.
 *
 * Colour is decided, never picked (TIL-4): series take the theme's `series`
 * tokens in the chart rules' order; a stacked split its first two and Other;
 * a value over another period is a dashed reference series; a goal a dashed
 * rule, and a point on its wrong side `--neg`. A category past its first N
 * folds into Other where the fold is exact (CHT-9); otherwise, and past the
 * groups a program answers, the model says what it holds of how many.
 *
 * It imports neither React nor the renderers.
 *
 * @packageDocumentation
 */

import { FloatType, SortedMap, SortedSet, compareFor, none, printFor, some, variant, type EastType, type ValueTypeOf } from "@elaraai/east";
import type { Chart } from "@elaraai/east-ui/internal";
import type { QueryWords } from "../../query/model/words.js";
import type { VisualAnswer } from "../../query/visual/ask.js";
import { visualValues, type VisualAsk, type VisualValue } from "../../query/visual/print.js";
import { firstKeys, foldRest, partsAt, readGroups, readTotal, type ReadGroup, type ReadGroups } from "../../query/visual/read.js";
import type { StudioMessages } from "../messages.js";
import { groupLabel, valueFieldFormat, valueName, wrongSideOfGoal, type VisualGroup, type VisualShown, type VisualSource, type VisualView } from "./values.js";

/** A chart spec node, decoded. */
export type ChartSpec = ValueTypeOf<typeof Chart.Spec.Types.Spec>;
/** One series, decoded. */
type ChartSeries = ValueTypeOf<typeof Chart.Spec.Types.Series>;
/** One point, decoded. */
type ChartPoint = ValueTypeOf<typeof Chart.Spec.Types.Point>;
/** A chart's view. */
export type ChartView = Extract<VisualView, { type: "chart" }>["value"];
/** A chart of series along one axis. */
type SeriesChart = Extract<ChartView, { type: "column" }>["value"];
/** A combo chart. */
type ComboChart = Extract<ChartView, { type: "combo" }>["value"];
/** A scatter chart. */
type ScatterChart = Extract<ChartView, { type: "scatter" }>["value"];
/** A pie chart. */
type PieChart = Extract<ChartView, { type: "pie" }>["value"];

/** The series colours, in the chart rules' order: `--brand-d`, teal, purple, blue, orange (TIL-4). */
export const SERIES_COLORS: readonly string[] = ["series.1", "series.2", "series.3", "series.4", "series.5"];
/** A stacked split's colours: `--brand-d`, `--brand`, then Other in `--ink-5` (TIL-4). */
export const STACK_COLORS: readonly string[] = ["series.stack.1", "series.stack.2"];
/** A stacked split's Other. */
const STACK_OTHER_COLOR = "series.stack.3";
/** A side-by-side split's Other, and a pie's. */
const OTHER_COLOR = "series.other";
/** A value over another period (TIL-4). */
export const REFERENCE_COLOR = "series.reference";
/** A goal's rule (CHT-4). */
export const GOAL_COLOR = "series.goal";
/** A point on its goal's wrong side (CHT-4). */
export const NEG_COLOR = "status.neg";
/** A reference series' and a goal's dash. */
const DASH = "4 3";
/** A frame height of 0: the chart fills its tile, never less than its natural height. */
const FILL = 0;
/** How many ticks a scatter's x axis asks its scale for. */
const SCATTER_TICKS = 4;

const printFloat = printFor(FloatType);

/**
 * A chart, read from its answers.
 *
 * @property spec - The chart, as east-ui-components' chart renderer draws it
 * @property shown - What it holds of how many groups, when it holds fewer (CHT-9); `undefined` when it holds them all
 */
export interface ChartModel {
    /** The chart, as east-ui-components' chart renderer draws it. */
    readonly spec: ChartSpec;
    /** What it holds of how many groups, when it holds fewer (CHT-9); `undefined` when it holds them all. */
    readonly shown: VisualShown | undefined;
}

/** What a chart model is made with. */
interface Made {
    readonly source: VisualSource;
    readonly words: QueryWords;
    readonly m: StudioMessages;
}

/** A value of a group, made of its parts; `undefined` for "no data". */
function valueAt(group: ReadGroup, index: number): number | undefined {
    return partsAt(group.parts, index);
}

/** A point at a category, its value; on its goal's wrong side, `--neg` (CHT-4). */
function pointAt(x: string, at: number, value: VisualValue): ChartPoint {
    return { x: variant("category", x), value: at, size: none, color: wrongSideOfGoal(value, at) ? some(NEG_COLOR) : none };
}

/** A group's category: its first key in words, or Other's for the rest of the first group. */
function categoryOf(group: ReadGroup, read: ReadGroups, x: VisualGroup, made: Made): string {
    const key = group.keys[0];
    return key === undefined ? made.m.other() : groupLabel(key, read.keyTypes[0]!, x, made.words, made.m);
}

/** How many different first keys some groups hold. */
function firstKeyCount(groups: readonly ReadGroup[], type: EastType | undefined): number {
    return type === undefined ? groups.length : new SortedSet(groups.filter(group => group.keys[0] !== undefined).map(group => group.keys[0]), compareFor(type)).size;
}

/**
 * A chart's groups past its category's first N folded into Other (CHT-9), and
 * what it holds of how many: the kept groups with the rest folded, where the
 * fold is exact; else the kept groups alone, which it says.
 */
function categoryGroups(read: ReadGroups, x: VisualGroup): { readonly groups: readonly ReadGroup[]; readonly shown: ChartModel["shown"]; readonly read: ReadGroups } {
    const cut = read.of > read.groups.length ? { shown: firstKeyCount(read.groups, read.keyTypes[0]), of: read.of } : undefined;
    if (x.top.type === "none") return { groups: read.groups, shown: cut, read };
    const folded = foldRest(read, 0, firstKeys(read, 0, Number(x.top.value)));
    const groups = folded.exact ? [...folded.kept, ...folded.other] : folded.kept;
    const kept = firstKeyCount(folded.kept, read.keyTypes[0]);
    const shown = folded.exact ? cut : { shown: kept, of: kept + folded.hidden };
    // The groups as read: the answer's own cut kept, so a second fold knows it.
    return { groups, shown, read: { ...read, groups, of: groups.length + Math.max(0, read.of - read.groups.length) } };
}

/** A frame around a chart's children. */
function frameOf(children: ChartSpec[], horizontal: boolean, legend: boolean, right: boolean): ChartSpec {
    return variant("frame", {
        height: FILL,
        width: none,
        // The chart rules' margins, each side as wide as its labels need: the renderer's.
        margin: none,
        xScale: variant(horizontal ? "linear" : "band", null),
        yScale: variant(horizontal ? "band" : "linear", null),
        yScale2: right ? some(variant("linear", null)) : none,
        tooltip: some({ cursor: none }),
        legend: legend ? some({ orientation: none, position: none }) : none,
        slice: none,
        children,
    });
}

/** An axis node of a chart's frame. */
function axisOf(side: "axisBottom" | "axisLeft" | "axisRight", label: string | undefined, format: ReturnType<typeof valueFieldFormat>, ticks?: number): ChartSpec {
    return variant(side, {
        label: label === undefined ? none : some(label),
        numTicks: ticks === undefined ? none : some(ticks), tickValues: none, hideTicks: none, hideLine: none, domain: none,
        tickFormat: format,
        tickStyle: none, titleStyle: none, titleGap: none,
    });
}

/** A series layer: one mark a series, on one axis, stacked or not. */
function layerOf(data: ChartSeries[], mark: "line" | "bar" | "area" | "scatter", options: { stack?: "stacked" | "percent"; right?: boolean; dash?: boolean } = {}): ChartSpec {
    return variant("series", {
        data,
        mark: variant(mark, null),
        curve: none,
        stackId: options.stack === undefined ? none : some("stack"),
        stackOffset: options.stack === "percent" ? some(variant("expand", null)) : none,
        axis: options.right === true ? some(variant("right", null)) : none,
        strokeWidth: none,
        dashArray: options.dash === true ? some(DASH) : none,
        dots: none,
        fillOpacity: none,
        radius: none,
        opacity: none,
        legend: none,
        tooltip: none,
    });
}

/** A goal's dashed rule across the plot, with its label at the first category (CHT-4). */
function goalNodes(values: readonly VisualValue[], first: string | undefined, made: Made): ChartSpec[] {
    return values.flatMap((value): ChartSpec[] => {
        if (value.goal.type === "none") return [];
        const goal = value.goal.value;
        const rule: ChartSpec = variant("rule", { axis: variant("y", null), at: printFloat(goal), stroke: GOAL_COLOR, dashArray: some(DASH), label: none });
        if (first === undefined) return [rule];
        const label = made.m.goalOf({ goal: made.words.formatters.value(goal, undefined) });
        return [rule, variant("text", {
            point: { x: variant("category", first), value: goal, size: none, color: none },
            text: label, anchor: some(variant("start", null)), fill: some(GOAL_COLOR), fontSize: none, fontWeight: none,
        })];
    });
}

/**
 * A chart of series along one axis — columns, bars, lines or areas (CHT-1 to
 * CHT-4): each value a series, or with a split one series a split value of
 * the first; stacked as the chart says, which a line ignores.
 */
function seriesChart(kind: "column" | "bar" | "line" | "area", chart: SeriesChart, read: ReadGroups, made: Made): ChartModel {
    const values = chart.split.type === "some" ? chart.values.slice(0, 1) : chart.values;
    const { groups, shown, read: folded } = categoryGroups(read, chart.x);
    const horizontal = kind === "bar";
    const mark = kind === "column" || kind === "bar" ? "bar" : kind;
    const stack = kind === "line" || chart.stack.type === "none" ? undefined : chart.stack.type;
    const categories = [...new Set(groups.map(group => categoryOf(group, folded, chart.x, made)))];
    const layers: ChartSpec[] = [];
    let legend = false;
    if (chart.split.type === "some") {
        const value = values[0]!;
        const split = splitSeries(folded, groups, value, stack !== undefined, chart.x, made);
        layers.push(layerOf(split, mark, stack === undefined ? {} : { stack }));
        legend = true;
    } else {
        // Each value a series; one over another period a dashed reference series (TIL-4).
        const current = values.flatMap((value, i): ChartSeries[] => (value.period.type !== "current" ? [] : [{
            key: valueName(value, made.source, made.m),
            color: SERIES_COLORS[i % SERIES_COLORS.length]!,
            points: groups.flatMap(group => {
                const at = valueAt(group, i);
                return at === undefined ? [] : [pointAt(categoryOf(group, folded, chart.x, made), at, value)];
            }),
        }]));
        const reference = values.flatMap((value, i): ChartSeries[] => (value.period.type === "current" ? [] : [{
            key: valueName(value, made.source, made.m),
            color: REFERENCE_COLOR,
            points: groups.flatMap(group => {
                const at = valueAt(group, i);
                return at === undefined ? [] : [pointAt(categoryOf(group, folded, chart.x, made), at, value)];
            }),
        }]));
        if (current.length > 0) layers.push(layerOf(current, mark, stack === undefined ? {} : { stack }));
        if (reference.length > 0) layers.push(layerOf(reference, "line", { dash: true }));
        legend = current.length + reference.length > 1;
    }
    const format = stack === "percent" ? some(variant("percent", null)) : valueFieldFormat(values[0]!, made.source);
    const children: ChartSpec[] = [
        variant("gridRows", { numTicks: none, dashArray: none }),
        ...layers,
        ...goalNodes(stack === "percent" ? [] : values, categories[0], made),
        axisOf("axisBottom", undefined, horizontal ? format : none),
        axisOf("axisLeft", undefined, horizontal ? none : format),
    ];
    return { spec: frameOf(children, horizontal, legend, false), shown };
}

/**
 * A split's series: one a split value, of the chart's first value — the first
 * two by their total, stacked, and the first five side by side — then the
 * rest folded into Other at each category where the fold is exact.
 */
function splitSeries(read: ReadGroups, groups: readonly ReadGroup[], value: VisualValue, stacked: boolean, x: VisualGroup, made: Made): ChartSeries[] {
    const type = read.keyTypes[1];
    if (type === undefined) return [];
    const compare = compareFor(type);
    // Each split value's total of the first value: what ranks it.
    const totals = new SortedMap<unknown, number>([], compare);
    for (const group of groups) {
        const key = group.keys[1];
        if (key === undefined) continue;
        totals.set(key, (totals.get(key) ?? 0) + (valueAt(group, 0) ?? 0));
    }
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
    const palette = stacked ? STACK_COLORS : SERIES_COLORS;
    const kept = new SortedSet(ranked.slice(0, palette.length), compare);
    const folded = foldRest({ ...read, groups }, 1, key => kept.has(key));
    const series = ranked.filter(key => kept.has(key)).map((key, rank): ChartSeries => ({
        key: groupLabel(key, type, undefined, made.words, made.m),
        color: palette[rank]!,
        points: folded.kept.flatMap(group => {
            if (compare(group.keys[1], key) !== 0) return [];
            const at = valueAt(group, 0);
            return at === undefined ? [] : [pointAt(categoryOf(group, read, x, made), at, value)];
        }),
    }));
    if (folded.other.length === 0) return series;
    return [...series, {
        key: made.m.other(),
        color: stacked ? STACK_OTHER_COLOR : OTHER_COLOR,
        points: folded.other.flatMap(group => {
            const at = valueAt(group, 0);
            return at === undefined ? [] : [pointAt(categoryOf(group, read, x, made), at, value)];
        }),
    }];
}

/**
 * A combo chart (CHT-5): its columns and lines on one category axis, each
 * value against the left or the right axis; each side labelled with its
 * values' names and formatted as its first.
 */
function comboChart(chart: ComboChart, read: ReadGroups, made: Made): ChartModel {
    const { groups, shown, read: folded } = categoryGroups(read, chart.x);
    const axes = [...chart.columns.map(axis => ({ axis, mark: "bar" as const })), ...chart.lines.map(axis => ({ axis, mark: "line" as const }))];
    const seriesOf = (i: number, value: VisualValue): ChartSeries => ({
        key: valueName(value, made.source, made.m),
        color: value.period.type === "current" ? SERIES_COLORS[i % SERIES_COLORS.length]! : REFERENCE_COLOR,
        points: groups.flatMap(group => {
            const at = valueAt(group, i);
            return at === undefined ? [] : [pointAt(categoryOf(group, folded, chart.x, made), at, value)];
        }),
    });
    const stack = chart.stack.type === "none" ? undefined : chart.stack.type;
    const layers: ChartSpec[] = [];
    for (const mark of ["bar", "line"] as const) {
        for (const right of [false, true]) {
            const data = axes.flatMap(({ axis, mark: drawn }, i) => (drawn === mark && axis.right === right ? [seriesOf(i, axis.value)] : []));
            if (data.length > 0) layers.push(layerOf(data, mark, { ...(mark === "bar" && stack !== undefined ? { stack } : {}), right }));
        }
    }
    const side = (right: boolean) => axes.filter(({ axis }) => axis.right === right).map(({ axis }) => axis.value);
    const label = (values: readonly VisualValue[]) => (values.length === 0 ? undefined : values.map(value => valueName(value, made.source, made.m)).join(" · "));
    const left = side(false);
    const right = side(true);
    const categories = [...new Set(groups.map(group => categoryOf(group, folded, chart.x, made)))];
    const children: ChartSpec[] = [
        variant("gridRows", { numTicks: none, dashArray: none }),
        ...layers,
        ...goalNodes(left, categories[0], made),
        axisOf("axisBottom", undefined, none),
        axisOf("axisLeft", label(left), left[0] === undefined ? none : valueFieldFormat(left[0], made.source)),
        ...(right.length > 0 ? [axisOf("axisRight", label(right), valueFieldFormat(right[0]!, made.source))] : []),
    ];
    return { spec: frameOf(children, false, axes.length > 1, right.length > 0), shown };
}

/** A scatter chart (CHT-6): one point a group, at its two values; its split colours the points, the first five then Other. */
function scatterChart(chart: ScatterChart, read: ReadGroups, made: Made): ChartModel {
    const shown = read.of > read.groups.length ? { shown: read.groups.length, of: read.of } : undefined;
    const splitType = read.extraTypes.get("s");
    const points = (groups: readonly ReadGroup[]) => groups.flatMap((group): ChartPoint[] => {
        const x = valueAt(group, 0);
        const y = valueAt(group, 1);
        return x === undefined || y === undefined ? [] : [{ x: variant("number", x), value: y, size: none, color: none }];
    });
    let data: ChartSeries[];
    if (splitType === undefined) {
        data = [{ key: valueName(chart.y, made.source, made.m), color: SERIES_COLORS[0]!, points: points(read.groups) }];
    } else {
        // The split's values in the order they first come, the first five a colour each and the rest Other.
        const compare = compareFor(splitType);
        const order = new SortedMap<unknown, ReadGroup[]>([], compare);
        const first: unknown[] = [];
        for (const group of read.groups) {
            const key = group.extras.get("s");
            const held = order.get(key);
            if (held === undefined) {
                order.set(key, [group]);
                first.push(key);
            } else held.push(group);
        }
        const kept = first.slice(0, SERIES_COLORS.length);
        const rest = first.slice(SERIES_COLORS.length).flatMap(key => order.get(key) ?? []);
        data = [
            ...kept.map((key, rank): ChartSeries => ({ key: groupLabel(key, splitType, undefined, made.words, made.m), color: SERIES_COLORS[rank]!, points: points(order.get(key) ?? []) })),
            ...(rest.length === 0 ? [] : [{ key: made.m.other(), color: OTHER_COLOR, points: points(rest) }]),
        ];
    }
    const children: ChartSpec[] = [
        variant("gridRows", { numTicks: none, dashArray: none }),
        layerOf(data, "scatter"),
        // Even ticks across: a scatter's x is a measure, not its points' own positions.
        axisOf("axisBottom", valueName(chart.x, made.source, made.m), valueFieldFormat(chart.x, made.source), SCATTER_TICKS),
        axisOf("axisLeft", valueName(chart.y, made.source, made.m), valueFieldFormat(chart.y, made.source)),
    ];
    const spec: ChartSpec = variant("frame", {
        height: FILL, width: none, margin: none,
        xScale: variant("linear", null), yScale: variant("linear", null), yScale2: none,
        tooltip: some({ cursor: none }), legend: data.length > 1 ? some({ orientation: none, position: none }) : none,
        slice: none, children,
    });
    return { spec, shown };
}

/**
 * A pie (CHT-7): one slice a group, largest first; its first N — 4 unless its
 * slice says — then Other, the total less the slices drawn, which only a
 * count or a sum makes: a pie of any other value draws every slice, and says
 * what it holds of how many past the groups its program answered.
 */
function pieChart(chart: PieChart, read: ReadGroups, total: number | undefined, made: Made): ChartModel {
    const additive = chart.value.measure.type === "count" || chart.value.measure.type === "sum";
    const data = read.groups.flatMap(group => {
        const at = valueAt(group, 0);
        return at === undefined ? [] : [{ key: groupLabel(group.keys[0], read.keyTypes[0]!, chart.slice, made.words, made.m), value: at, color: none }];
    });
    const cut = read.of > read.groups.length && !(additive && total !== undefined);
    const pie: ChartSpec = variant("pie", {
        data,
        top: additive ? (chart.slice.top.type === "some" ? some(chart.slice.top.value) : none) : some(BigInt(data.length)),
        total: additive && total !== undefined ? some(total) : none,
        other: some(made.m.other()),
        donut: chart.donut,
        format: valueFieldFormat(chart.value, made.source),
        caption: none,
        note: none,
    });
    const spec: ChartSpec = variant("frame", {
        height: FILL, width: none, margin: none, xScale: variant("band", null), yScale: variant("linear", null), yScale2: none,
        tooltip: none, legend: none, slice: none, children: [pie],
    });
    return { spec, shown: cut ? { shown: read.groups.length, of: read.of } : undefined };
}

/**
 * A chart visual's spec, read from its answers.
 *
 * @param chart - The chart
 * @param asks - Its asks, as the printer gave them
 * @param answers - Their answers
 * @param source - Its source
 * @param words - The words and formatters
 * @param m - The Studio's words
 * @returns The chart and what it holds; `undefined` when its groups' program did not answer
 */
export function chartModel(chart: ChartView, asks: readonly VisualAsk[], answers: readonly VisualAnswer[], source: VisualSource, words: QueryWords, m: StudioMessages): ChartModel | undefined {
    const values = visualValues(variant("chart", chart));
    const read = readGroups(asks, answers, values, "groups");
    if (read === undefined) return undefined;
    const made: Made = { source, words, m };
    switch (chart.type) {
        case "column": case "bar": case "line": case "area": return seriesChart(chart.type, chart.value, read, made);
        case "combo": return comboChart(chart.value, read, made);
        case "scatter": return scatterChart(chart.value, read, made);
        case "pie": {
            const total = readTotal(asks, answers, values);
            return pieChart(chart.value, read, total === undefined ? undefined : partsAt(total.parts, 0), made);
        }
    }
}
