/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Studio chart's spec (#1671): its answers read into east-ui's `Chart.Spec`
 * nodes, which the chart's own renderer draws, each kind as its mock draws it
 * — a frame that fills its tile; its series layers; a measure axis of three
 * ticks on a clean step (`chart-axis.ts`), its gridlines on them; short
 * labels along its categories, and a line or an area over dates running edge
 * to edge on a time axis; a bar chart's values at its bars' ends, with no
 * axis under them; a goal's dashed rule with its label; and a pie's slices,
 * its note and a donut's caption.
 *
 * Colour is decided, never picked (TIL-4): series take the theme's `series`
 * tokens in the chart rules' order; a stacked split its first two and Other;
 * a value over another period is a reference series, solid in `--ink-3`; a
 * goal a dashed rule, and a point on its wrong side `--neg`. A category past
 * its first N folds into Other where the fold is exact (CHT-9), named with
 * how many it holds; otherwise, and past the groups a program answers, the
 * model says what it holds of how many.
 *
 * It imports neither React nor the renderers.
 *
 * @packageDocumentation
 */

import { DateTimeType, FloatType, SortedMap, SortedSet, compareFor, none, printFor, some, variant, type EastType, type ValueTypeOf } from "@elaraai/east";
import type { Chart } from "@elaraai/east-ui/internal";
import type { ChartMark, ValueFormat } from "@elaraai/east-ui-components";
import type { QueryWords } from "../../query/model/words.js";
import type { VisualAnswer } from "../../query/visual/ask.js";
import type { ClickedGroup } from "../../query/visual/clicks.js";
import { visualValues, type VisualAsk, type VisualValue } from "../../query/visual/print.js";
import { bucketStart, firstKeys, foldRest, partsAt, readGroups, readTotal, type ReadGroup, type ReadGroups } from "../../query/visual/read.js";
import type { StudioMessages } from "../messages.js";
import { axisTicks, type AxisTicks } from "./chart-axis.js";
import {
    axisLabel, bucketSpan, groupLabel, midSentence, shortNumber, unitLabel, valueFieldFormat, valueName, wrongSideOfGoal,
    type BucketSpan, type VisualGroup, type VisualShown, type VisualSource, type VisualView,
} from "./values.js";

/** A chart spec node, decoded. */
export type ChartSpec = ValueTypeOf<typeof Chart.Spec.Types.Spec>;
/** One series, decoded. */
type ChartSeries = ValueTypeOf<typeof Chart.Spec.Types.Series>;
/** One point, decoded. */
type ChartPoint = ValueTypeOf<typeof Chart.Spec.Types.Point>;
/** A point's x, decoded. */
type ChartX = ChartPoint["x"];
/** An axis's text style, decoded. */
type AxisTextStyle = ValueTypeOf<typeof Chart.Spec.Types.AxisTextStyle>;
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
/** A date bucket's unit. */
type BucketUnit = Parameters<typeof bucketStart>[1];

/** The series colours, in the chart rules' order: `--brand-d`, teal, purple, blue, orange (TIL-4). */
export const SERIES_COLORS: readonly string[] = ["series.1", "series.2", "series.3", "series.4", "series.5"];
/** A stacked split's colours: `--brand-d`, `--brand`, then Other in `--ink-5` (TIL-4). */
export const STACK_COLORS: readonly string[] = ["series.stack.1", "series.stack.2"];
/** A stacked split's Other. */
const STACK_OTHER_COLOR = "series.stack.3";
/** Other, wherever it is a mark of its own: a side-by-side split's series, a category's bar, a pie's slice (`--ink-5`). */
export const OTHER_COLOR = "series.other";
/** A value over another period (TIL-4): the chart rules' reference series, `--ink-3`. */
export const REFERENCE_COLOR = "series.reference";
/** A reference series' line: the chart rules' 1.5px, solid — it is what was. */
export const REFERENCE_WIDTH = 1.5;
/** A goal's rule (CHT-4). */
export const GOAL_COLOR = "series.goal";
/** A point on its goal's wrong side (CHT-4). */
export const NEG_COLOR = "status.neg";
/** A goal's dash: it is what is not yet so. */
const DASH = "4 3";
/** A frame height of 0: the chart fills its tile, never less than its natural height. */
const FILL = 0;
/** A stack of shares: its axis from nothing to the whole. */
const SHARES: AxisTicks = { min: 0, max: 1, ticks: [0, 0.5, 1] };
/** How many slices a pie draws before Other when its slice names no number: the chart component's own. */
const PIE_TOP = 4;
/** A value at a bar's end: the chart rules' in-chart annotation, mono 10px. */
const END_LABEL_SIZE = 10;
/** A bar chart's category labels: mono 11 in `--ink`, as the chart rules' driver bars set them. */
const CATEGORY_STYLE: AxisTextStyle = {
    fontSize: some("11px"), fontFamily: some(variant("mono", null)), fontWeight: some(variant("normal", null)), color: some("fg"), letterSpacing: none,
};

const printFloat = printFor(FloatType);
const printInstant = printFor(DateTimeType);

/**
 * A chart, read from its answers.
 *
 * @property spec - The chart, as east-ui-components' chart renderer draws it
 * @property shown - What it holds of how many groups, when it holds fewer (CHT-9); `undefined` when it holds them all
 * @property caption - A line over the plot that says what its axes are — a scatter's `x units · y revenue per unit, AUD/unit`; `undefined` for none
 * @property numbers - How its renderer's numbers read: an axis's `ticks`, with no zeros ending their decimals, or a pie's `values`, each to three figures
 * @property clicked - The groups a mark stands for (CHT-8): what a click on it is made on
 */
export interface ChartModel {
    /** The chart, as east-ui-components' chart renderer draws it. */
    readonly spec: ChartSpec;
    /** What it holds of how many groups, when it holds fewer (CHT-9); `undefined` when it holds them all. */
    readonly shown: VisualShown | undefined;
    /** A line over the plot that says what its axes are; `undefined` for none. */
    readonly caption: string | undefined;
    /** How its renderer's numbers read: an axis's ticks, or a pie's values. */
    readonly numbers: "ticks" | "values";
    /**
     * The groups a mark stands for (CHT-8): a column's category, and its
     * split's; a legend row's split value; a slice's group; a point's.
     * `undefined` for a mark of no one group — Other's, and a legend row that
     * names a value.
     */
    readonly clicked: (mark: ChartMark) => readonly ClickedGroup[] | undefined;
}

/**
 * What a chart's marks stand for, by their x's key and their series' key.
 *
 * @param xs - Each place's group, by its x's key; Other's place is in none
 * @param series - Each series' group, by its key, where a series is a group — a split's; `undefined` where a series is a value
 * @returns The groups of a mark
 */
function clickedBy(xs: ReadonlyMap<string, ClickedGroup>, series?: ReadonlyMap<string, ClickedGroup>): ChartModel["clicked"] {
    return (mark) => {
        if (mark.other) return undefined;
        const groups: ClickedGroup[] = [];
        if (mark.x !== undefined) {
            const at = xs.get(xKey(mark.x));
            if (at === undefined) return undefined;
            groups.push(at);
        }
        if (series !== undefined && mark.series !== undefined) {
            const of = series.get(mark.series);
            if (of === undefined) return undefined;
            groups.push(of);
        }
        return groups.length === 0 ? undefined : groups;
    };
}

/** Each place's group along a chart's categories, by its x's key: what a mark there stands for. */
function placesClicked(groups: readonly ReadGroup[], read: ReadGroups, x: VisualGroup, place: (group: ReadGroup) => Place): Map<string, ClickedGroup> {
    const xs = new Map<string, ClickedGroup>();
    const type = read.keyTypes[0];
    if (type === undefined) return xs;
    for (const group of groups) {
        const at = place(group);
        if (!at.other && group.keys[0] !== undefined) xs.set(xKey(at.x), { group: x, key: group.keys[0], type });
    }
    return xs;
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

/** A value's declared format, as an axis node and a short number take it. */
function formatOf(value: VisualValue | undefined, made: Made): ValueFormat | undefined {
    const declared = value === undefined ? none : valueFieldFormat(value, made.source);
    return declared.type === "some" ? declared.value : undefined;
}

/** An x as a key: what two points at one place share. */
function xKey(x: ChartX): string {
    switch (x.type) {
        case "category": return x.value;
        case "number": return printFloat(x.value);
        case "time": return printInstant(x.value);
    }
}

/** How many different first keys some groups hold. */
function firstKeyCount(groups: readonly ReadGroup[], type: EastType | undefined): number {
    return type === undefined ? groups.length : new SortedSet(groups.filter(group => group.keys[0] !== undefined).map(group => group.keys[0]), compareFor(type)).size;
}

/**
 * A chart's groups past its category's first N folded into Other (CHT-9), and
 * what it holds of how many: the kept groups with the rest folded, where the
 * fold is exact, and how many keys Other holds; else the kept groups alone,
 * which it says.
 */
function categoryGroups(read: ReadGroups, x: VisualGroup): { readonly groups: readonly ReadGroup[]; readonly shown: ChartModel["shown"]; readonly read: ReadGroups; readonly folded: number } {
    const cut = read.of > read.groups.length ? { shown: firstKeyCount(read.groups, read.keyTypes[0]), of: read.of } : undefined;
    if (x.top.type === "none") return { groups: read.groups, shown: cut, read, folded: 0 };
    const folded = foldRest(read, 0, firstKeys(read, 0, Number(x.top.value)));
    const groups = folded.exact ? [...folded.kept, ...folded.other] : folded.kept;
    const kept = firstKeyCount(folded.kept, read.keyTypes[0]);
    const shown = folded.exact ? cut : { shown: kept, of: kept + folded.hidden };
    // The groups as read: the answer's own cut kept, so a second fold knows it.
    return { groups, shown, read: { ...read, groups, of: groups.length + Math.max(0, read.of - read.groups.length) }, folded: folded.exact ? folded.hidden : 0 };
}

/** Where a group stands along a chart's categories: its x, and whether it is Other. */
interface Place {
    readonly x: ChartX;
    readonly other: boolean;
}

/** A time axis: its span, first bucket to last, and the pattern its ticks print by. */
interface TimeAxis {
    readonly span: readonly [Date, Date];
    readonly pattern: string;
}

/** The East date pattern a time axis's ticks print by: short, leaving out what every bucket shares. */
function datePattern(unit: Exclude<BucketUnit, "quarter">, span: BucketSpan): string {
    switch (unit) {
        case "hour": return span.oneDay ? "HH:mm" : "MMM DD HH:mm";
        case "day": case "week": return "MMM DD";
        case "year": return "YYYY";
        case "month": case "auto": return span.oneYear ? "MMM" : "MMM YYYY";
    }
}

/**
 * Where each group of a chart stands along its categories: on a time axis, at
 * its bucket's first instant, when the chart's marks run edge to edge over
 * dates; else at its category, labelled short ({@link axisLabel}) — Other with
 * how many it holds.
 *
 * @param groups - The chart's groups
 * @param read - The groups as read: their keys' types
 * @param x - What the chart groups by
 * @param folded - How many keys Other holds; 0 when it says no number
 * @param timed - Whether the chart's marks run over dates: a line's and an area's
 * @param made - The source, the words and the Studio's words
 * @returns Each group's place, and the time axis when the chart has one
 */
function placesOf(groups: readonly ReadGroup[], read: ReadGroups, x: VisualGroup, folded: number, timed: boolean, made: Made): { readonly place: (group: ReadGroup) => Place; readonly time: TimeAxis | undefined } {
    const unit = x.bucket.type === "some" ? x.bucket.value.type : undefined;
    const keyed = groups.filter(group => group.keys[0] !== undefined);
    const starts = unit === undefined ? [] : keyed.map(group => bucketStart(group.keys[0] as bigint, unit));
    const span = bucketSpan(starts, made.words.formatters);
    const other = folded > 0 ? made.m.otherCount({ n: made.words.formatters.number(folded) }) : made.m.other();
    // A time axis holds dates alone: every group a bucket, more than one of them, and no quarter, which no date pattern says.
    if (timed && unit !== undefined && unit !== "quarter" && keyed.length === groups.length && starts.length > 1) {
        const sorted = [...starts].sort((a, b) => a.getTime() - b.getTime());
        return {
            place: group => ({ x: variant("time", bucketStart(group.keys[0] as bigint, unit)), other: false }),
            time: { span: [sorted[0]!, sorted[sorted.length - 1]!], pattern: datePattern(unit, span) },
        };
    }
    return {
        place: (group) => {
            const key = group.keys[0];
            return key === undefined
                ? { x: variant("category", other), other: true }
                : { x: variant("category", axisLabel(key, read.keyTypes[0]!, x, span, made.words, made.m)), other: false };
        },
        time: undefined,
    };
}

/** A point at a place, its value: on its goal's wrong side `--neg` (CHT-4); Other's own mark `--ink-5`. */
function pointAt(place: Place, at: number, value: VisualValue, own: boolean): ChartPoint {
    const color = wrongSideOfGoal(value, at) ? some(NEG_COLOR) : place.other && own ? some(OTHER_COLOR) : none;
    return { x: place.x, value: at, size: none, color };
}

/** A frame around a chart's children. */
function frameOf(children: ChartSpec[], scales: { readonly x: "band" | "linear" | "time"; readonly y: "band" | "linear" }, legend: boolean, right: boolean): ChartSpec {
    return variant("frame", {
        height: FILL,
        width: none,
        // The chart rules' margins, each side as wide as its labels need: the renderer's.
        margin: none,
        xScale: variant(scales.x, null),
        yScale: variant(scales.y, null),
        yScale2: right ? some(variant("linear", null)) : none,
        tooltip: some({ cursor: none }),
        legend: legend ? some({ orientation: none, position: none }) : none,
        slice: none,
        children,
    });
}

/** What an axis node is given. None draws a title: a chart's eyebrow and its legend name what it measures. */
interface AxisOptions {
    /** The format its ticks declare, which the tile's short numbers print by. */
    readonly format?: ValueFormat | undefined;
    /** A measure's ticks, and the domain they span. */
    readonly ticks?: AxisTicks | undefined;
    /** A time axis: its span, so the plot runs edge to edge, and its tick pattern. */
    readonly time?: TimeAxis | undefined;
    /** Its labels' type. */
    readonly style?: AxisTextStyle | undefined;
}

/** An axis node of a chart's frame. */
function axisOf(side: "axisBottom" | "axisLeft" | "axisRight", options: AxisOptions = {}): ChartSpec {
    const { format, ticks, time, style } = options;
    return variant(side, {
        label: none,
        numTicks: none,
        tickValues: ticks === undefined ? none : some(variant("number", [...ticks.ticks])),
        hideTicks: none, hideLine: none,
        domain: ticks !== undefined ? some(variant("number", { min: ticks.min, max: ticks.max }))
            : time !== undefined ? some(variant("time", { min: time.span[0], max: time.span[1] })) : none,
        tickFormat: time !== undefined ? some(variant("date", time.pattern)) : format === undefined ? none : some(format),
        tickStyle: style === undefined ? none : some(style),
        titleStyle: none, titleGap: none,
    });
}

/** A grid node: solid lines at the matching axis's ticks. */
function gridOf(tag: "gridRows" | "gridColumns"): ChartSpec {
    return variant(tag, { numTicks: none, dashArray: none });
}

/** A series layer: one mark a series, on one axis, stacked or not. */
function layerOf(data: ChartSeries[], mark: "line" | "bar" | "area" | "scatter", options: { stack?: "stacked" | "percent"; right?: boolean; dots?: boolean; width?: number } = {}): ChartSpec {
    return variant("series", {
        data,
        mark: variant(mark, null),
        curve: none,
        stackId: options.stack === undefined ? none : some("stack"),
        stackOffset: options.stack === "percent" ? some(variant("expand", null)) : none,
        axis: options.right === true ? some(variant("right", null)) : none,
        strokeWidth: options.width === undefined ? none : some(options.width),
        dashArray: none,
        // A line draws no markers unless its chart says so: a combo's line marks its columns' categories.
        dots: mark === "line" ? some(options.dots === true) : none,
        fillOpacity: none,
        radius: none,
        opacity: none,
        legend: none,
        tooltip: none,
    });
}

/** What some series draw along a measure: each point's value, or each place's sum where they stack. */
function drawn(data: readonly ChartSeries[], stacked: boolean): number[] {
    if (!stacked) return data.flatMap(series => series.points.map(point => point.value));
    const totals = new Map<string, number>();
    for (const series of data) for (const point of series.points) totals.set(xKey(point.x), (totals.get(xKey(point.x)) ?? 0) + point.value);
    return [...totals.values()];
}

/** A measure's ticks over what is drawn on it; `undefined` when nothing is. */
function ticksOver(values: readonly number[], zero: boolean, intervals = 2): AxisTicks | undefined {
    return values.length === 0 ? undefined : axisTicks(Math.min(...values), Math.max(...values), zero, intervals);
}

/** Each value's goal, for the axis to hold. */
function goalsOf(values: readonly VisualValue[]): number[] {
    return values.flatMap(value => (value.goal.type === "some" ? [value.goal.value] : []));
}

/** A goal's dashed rule across the plot, its label inside the plot over it — `goal 450k`, at the axis's scale (CHT-4). */
function goalNodes(values: readonly VisualValue[], axis: AxisTicks | undefined, made: Made): ChartSpec[] {
    return values.flatMap((value): ChartSpec[] => {
        if (value.goal.type === "none") return [];
        const goal = value.goal.value;
        const label = made.m.goalLabel({ goal: shortNumber(goal, formatOf(value, made), made.words.formatters, axis?.max, true) });
        return [variant("rule", { axis: variant("y", null), at: printFloat(goal), stroke: GOAL_COLOR, dashArray: some(DASH), label: some(label) })];
    });
}

/**
 * A chart of series along one axis — columns, bars, lines or areas (CHT-1 to
 * CHT-4): each value a series, or with a split one series a split value of
 * the first; stacked as the chart says, which a line ignores.
 */
function seriesChart(kind: "column" | "bar" | "line" | "area", chart: SeriesChart, read: ReadGroups, made: Made): ChartModel {
    const values = chart.split.type === "some" ? chart.values.slice(0, 1) : chart.values;
    const { groups, shown, read: folded, folded: hidden } = categoryGroups(read, chart.x);
    const horizontal = kind === "bar";
    const mark = kind === "column" || kind === "bar" ? "bar" : kind;
    const stack = kind === "line" || chart.stack.type === "none" ? undefined : chart.stack.type;
    // A line or an area over dates runs edge to edge on a time axis; columns and bars stand in bands.
    const { place, time } = placesOf(groups, folded, chart.x, hidden, kind === "line" || kind === "area", made);
    // One series alone owns its marks' colours: its Other bar is `--ink-5`.
    const alone = chart.split.type === "none" && values.length === 1;
    const seriesOf = (i: number, value: VisualValue, color: string): ChartSeries => ({
        key: valueName(value, made.source, made.m),
        color,
        points: groups.flatMap((group) => {
            const at = valueAt(group, i);
            return at === undefined ? [] : [pointAt(place(group), at, value, alone)];
        }),
    });
    // Each value a series, or a split's; one over another period a reference series (TIL-4).
    const current = chart.split.type === "some"
        ? splitSeries(folded, groups, values[0]!, stack !== undefined, place, made)
        : values.flatMap((value, i) => (value.period.type === "current" ? [seriesOf(i, value, SERIES_COLORS[i % SERIES_COLORS.length]!)] : []));
    const reference = chart.split.type === "some" ? [] : values.flatMap((value, i) => (value.period.type === "current" ? [] : [seriesOf(i, value, REFERENCE_COLOR)]));
    // Its legend names more than one series, unless the chart hides it.
    const legend = chart.legend.type !== "hidden" && (chart.split.type === "some" || current.length + reference.length > 1);
    const layers: ChartSpec[] = [
        ...(current.length > 0 ? [layerOf(current, mark, stack === undefined ? {} : { stack })] : []),
        ...(reference.length > 0 ? [layerOf(reference, "line", { width: REFERENCE_WIDTH })] : []),
    ];
    // A mark stands for its category, and for its split's value where the chart splits.
    const splitType = folded.keyTypes[1];
    const splitField = chart.split.type === "some" ? chart.split.value : undefined;
    const splits = splitField === undefined || splitType === undefined ? undefined : new Map(groups.flatMap((group): [string, ClickedGroup][] => (
        group.keys[1] === undefined ? [] : [[groupLabel(group.keys[1], splitType, undefined, made.words, made.m), { group: { field: splitField, bucket: none }, key: group.keys[1], type: splitType }]]
    )));
    const clicked = clickedBy(placesClicked(groups, folded, chart.x, place), splits);
    const percent = stack === "percent";
    const format: ValueFormat | undefined = percent ? variant("percent", null) : formatOf(values[0], made);
    // The measure's ticks: over every value drawn and each goal, from zero for a mark filled from it.
    const axis = percent ? SHARES : ticksOver([...drawn(current, stack !== undefined), ...drawn(reference, false), ...goalsOf(values)], kind !== "line");
    const goals = goalNodes(percent ? [] : values, axis, made);
    if (horizontal) {
        const [only] = current;
        // One series of bars says each value at its bar's end, and draws no axis under them (the chart rules' driver bars).
        if (alone && only !== undefined && reference.length === 0 && stack === undefined) {
            // Each end's number at the scale of the largest bar that is no Other: `1210k` beside `612k`.
            const largest = groups.reduce((most, group) => {
                const at = valueAt(group, 0);
                return at === undefined || place(group).other ? most : Math.max(most, Math.abs(at));
            }, 0);
            const ends = only.points.map((point): ChartSpec => variant("text", {
                point: { x: point.x, value: point.value, size: none, color: none },
                text: shortNumber(point.value, format, made.words.formatters, largest === 0 ? undefined : largest),
                anchor: none, fill: none, fontSize: some(END_LABEL_SIZE), fontWeight: none,
            }));
            return { spec: frameOf([...layers, ...goals, ...ends, axisOf("axisLeft", { style: CATEGORY_STYLE })], { x: "linear", y: "band" }, legend, false), shown, caption: undefined, numbers: "ticks", clicked };
        }
        const children = [gridOf("gridColumns"), ...layers, ...goals, axisOf("axisBottom", { format, ticks: axis }), axisOf("axisLeft", { style: CATEGORY_STYLE })];
        return { spec: frameOf(children, { x: "linear", y: "band" }, legend, false), shown, caption: undefined, numbers: "ticks", clicked };
    }
    const children: ChartSpec[] = [
        gridOf("gridRows"),
        ...layers,
        ...goals,
        axisOf("axisBottom", { time }),
        axisOf("axisLeft", { format, ticks: axis }),
    ];
    return { spec: frameOf(children, { x: time === undefined ? "band" : "time", y: "linear" }, legend, false), shown, caption: undefined, numbers: "ticks", clicked };
}

/**
 * A split's series: one a split value, of the chart's first value — the first
 * two by their total, stacked, and the first five side by side — then the
 * rest folded into Other at each category where the fold is exact.
 */
function splitSeries(read: ReadGroups, groups: readonly ReadGroup[], value: VisualValue, stacked: boolean, place: (group: ReadGroup) => Place, made: Made): ChartSeries[] {
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
    const pointsOf = (among: readonly ReadGroup[]) => among.flatMap((group) => {
        const at = valueAt(group, 0);
        return at === undefined ? [] : [pointAt(place(group), at, value, false)];
    });
    const series = ranked.filter(key => kept.has(key)).map((key, rank): ChartSeries => ({
        key: groupLabel(key, type, undefined, made.words, made.m),
        color: palette[rank]!,
        points: pointsOf(folded.kept.filter(group => compare(group.keys[1], key) === 0)),
    }));
    if (folded.other.length === 0) return series;
    return [...series, { key: made.m.other(), color: stacked ? STACK_OTHER_COLOR : OTHER_COLOR, points: pointsOf(folded.other) }];
}

/**
 * A combo chart (CHT-5): its columns and lines on one category axis, each
 * value against the left or the right axis. Neither axis draws a title: the
 * legend names each series, one read against the right axis saying so.
 */
function comboChart(chart: ComboChart, read: ReadGroups, made: Made): ChartModel {
    const { groups, shown, read: folded, folded: hidden } = categoryGroups(read, chart.x);
    const { place } = placesOf(groups, folded, chart.x, hidden, false, made);
    const axes = [...chart.columns.map(axis => ({ axis, mark: "bar" as const })), ...chart.lines.map(axis => ({ axis, mark: "line" as const }))];
    const seriesOf = (i: number, value: VisualValue, right: boolean): ChartSeries => {
        const name = valueName(value, made.source, made.m);
        return {
            key: right ? made.m.rightAxis({ name }) : name,
            color: value.period.type === "current" ? SERIES_COLORS[i % SERIES_COLORS.length]! : REFERENCE_COLOR,
            points: groups.flatMap((group) => {
                const at = valueAt(group, i);
                return at === undefined ? [] : [pointAt(place(group), at, value, false)];
            }),
        };
    };
    const stack = chart.stack.type === "none" ? undefined : chart.stack.type;
    const layers: ChartSpec[] = [];
    // What each side draws, and whether a mark filled from zero is on it.
    const sides = { left: { values: [] as number[], zero: false }, right: { values: [] as number[], zero: false } };
    for (const mark of ["bar", "line"] as const) {
        for (const right of [false, true]) {
            const data = axes.flatMap(({ axis, mark: drew }, i) => (drew === mark && axis.right === right ? [seriesOf(i, axis.value, right)] : []));
            if (data.length === 0) continue;
            const stacked = mark === "bar" && stack !== undefined;
            layers.push(layerOf(data, mark, { ...(stacked ? { stack } : {}), right, dots: true }));
            const side = right ? sides.right : sides.left;
            side.values.push(...(stacked && stack === "percent" ? [0, 1] : drawn(data, stacked)));
            side.zero ||= mark === "bar";
        }
    }
    const valuesOn = (right: boolean) => axes.filter(({ axis }) => axis.right === right).map(({ axis }) => axis.value);
    const left = valuesOn(false);
    const right = valuesOn(true);
    const leftTicks = ticksOver([...sides.left.values, ...goalsOf(left)], sides.left.zero);
    const children: ChartSpec[] = [
        gridOf("gridRows"),
        ...layers,
        ...goalNodes(left, leftTicks, made),
        axisOf("axisBottom"),
        axisOf("axisLeft", { format: formatOf(left[0], made), ticks: leftTicks }),
        ...(right.length > 0 ? [axisOf("axisRight", { format: formatOf(right[0], made), ticks: ticksOver(sides.right.values, sides.right.zero) })] : []),
    ];
    return {
        spec: frameOf(children, { x: "band", y: "linear" }, chart.legend.type !== "hidden" && axes.length > 1, right.length > 0), shown, caption: undefined, numbers: "ticks",
        clicked: clickedBy(placesClicked(groups, folded, chart.x, place)),
    };
}

/**
 * A scatter chart (CHT-6): one point a group, at its two values; its split
 * colours the points, the first five then Other. Its axes draw no titles: a
 * line over the plot says what x and y are.
 */
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
    const every = data.flatMap(series => series.points);
    const children: ChartSpec[] = [
        gridOf("gridRows"),
        layerOf(data, "scatter"),
        // Four ticks across and three up, each axis over its own values.
        axisOf("axisBottom", { format: formatOf(chart.x, made), ticks: ticksOver(every.flatMap(point => (point.x.type === "number" ? [point.x.value] : [])), false, 3) }),
        axisOf("axisLeft", { format: formatOf(chart.y, made), ticks: ticksOver(every.map(point => point.value), false) }),
    ];
    const caption = made.m.scatterCaption({
        x: midSentence(valueName(chart.x, made.source, made.m)), xUnit: unitLabel(chart.x, made.source, made.m),
        y: midSentence(valueName(chart.y, made.source, made.m)), yUnit: unitLabel(chart.y, made.source, made.m),
    });
    // A point stands for its group, where it alone is at its x: two at one x are no one group's.
    const pointType = read.keyTypes[0];
    const xs = new Map<string, ClickedGroup>();
    const twice = new Set<string>();
    for (const group of read.groups) {
        const x = valueAt(group, 0);
        if (pointType === undefined || x === undefined || valueAt(group, 1) === undefined || group.keys[0] === undefined) continue;
        const key = xKey(variant("number", x));
        if (xs.has(key)) twice.add(key);
        xs.set(key, { group: { field: chart.point, bucket: none }, key: group.keys[0], type: pointType });
    }
    for (const key of twice) xs.delete(key);
    return { spec: frameOf(children, { x: "linear", y: "linear" }, chart.legend.type !== "hidden" && data.length > 1, false), shown, caption, numbers: "ticks", clicked: clickedBy(xs) };
}

/**
 * A pie (CHT-7): one slice a group, largest first; its first N — 4 unless its
 * slice says — then Other, the total less the slices drawn, which only a
 * count or a sum makes: a pie of any other value draws every slice, and says
 * what it holds of how many past the groups its program answered. Under its
 * legend, what its values are and the total they are shares of; a donut's
 * total stands over what it is, and its legend says so only where its hole
 * cannot hold that (#1692).
 */
function pieChart(chart: PieChart, read: ReadGroups, total: number | undefined, made: Made): ChartModel {
    const additive = chart.value.measure.type === "count" || chart.value.measure.type === "sum";
    const f = made.words.formatters;
    const format = formatOf(chart.value, made);
    const data = read.groups.flatMap((group) => {
        const at = valueAt(group, 0);
        return at === undefined ? [] : [{ key: groupLabel(group.keys[0], read.keyTypes[0]!, chart.slice, made.words, made.m), value: at, color: none }];
    });
    const whole = additive && total !== undefined;
    const cut = read.of > read.groups.length && !whole;
    // Other holds every group past the first ones: how many, where the pie's total makes it.
    const top = chart.slice.top.type === "some" ? Number(chart.slice.top.value) : PIE_TOP;
    const rest = whole ? Math.max(0, read.of - top) : 0;
    const unit = unitLabel(chart.value, made.source, made.m);
    const sum = whole ? total : data.reduce((held, slice) => held + slice.value, 0);
    const pie: ChartSpec = variant("pie", {
        data,
        top: additive ? (chart.slice.top.type === "some" ? some(chart.slice.top.value) : none) : some(BigInt(data.length)),
        total: whole ? some(total) : none,
        other: some(rest > 0 ? made.m.otherCount({ n: f.number(rest) }) : made.m.other()),
        donut: chart.donut,
        format: format === undefined ? none : some(format),
        // A donut's total says what it is under it; a pie's legend says what its values are shares of — and a donut's,
        // where its hole cannot hold its caption (#1692): the chart draws one or the other.
        caption: chart.donut ? some(made.m.pieCaption({ unit: unit ?? midSentence(valueName(chart.value, made.source, made.m)) })) : none,
        note: some(made.m.pieNote({ unit, total: shortNumber(sum, format, f) })),
        // What its legend shows: each slice's value and share, its name alone, or nothing — as the pie says.
        legend: some(chart.legend),
    });
    const spec: ChartSpec = variant("frame", {
        height: FILL, width: none, margin: none, xScale: variant("band", null), yScale: variant("linear", null), yScale2: none,
        tooltip: none, legend: none, slice: none, children: [pie],
    });
    // A slice stands for its group: its key is its label.
    const sliceType = read.keyTypes[0]!;
    const slices = new Map(read.groups.flatMap((group): [string, ClickedGroup][] => (
        group.keys[0] === undefined ? [] : [[groupLabel(group.keys[0], sliceType, chart.slice, made.words, made.m), { group: chart.slice, key: group.keys[0], type: sliceType }]]
    )));
    return { spec, shown: cut ? { shown: read.groups.length, of: read.of } : undefined, caption: undefined, numbers: "values", clicked: clickedBy(slices) };
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
