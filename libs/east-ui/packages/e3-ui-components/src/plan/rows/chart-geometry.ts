/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A chart row's geometry as numbers (#743) — its stacks: each column's place
 * in its bucket and its extent, and each stacked area's; the value domain each
 * axis side spans, the points a continuous series draws, a bubble's radius,
 * each layer's value per bucket, and the series its legend lists. The marks,
 * the gutter ticks, the legend and the crosshair readout all read it, so an
 * axis can never label a scale the marks do not use.
 *
 * Everything here is in DATA units and window FRACTIONS — the row maps them
 * into its viewBox. Positions are the scale's UNCLAMPED `fracOf`: clamping a
 * vertex to the window edge moves the data (a line then meets the edge at the
 * wrong value), where clipping the drawn segment does not.
 *
 * A point whose `y` is not finite (`NaN`) is a GAP: lines and areas break
 * there instead of interpolating across it, and it counts toward no domain.
 *
 * @packageDocumentation
 */

import { scaleLinear, scaleSqrt } from "@visx/scale";
import type { ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/e3-ui/internal";
import { tickFormatter } from "@elaraai/east-ui-components/internal";
import { formatters } from "@elaraai/east-ui-components";
import type { PlanInstantValue } from "../instant.js";
import type { PlanScale } from "../scale.js";
import type { PlanWords } from "../words.js";

/** A decoded chart row kind. */
export type ChartKindValue = Extract<ValueTypeOf<typeof Plan.Types.Row>["kind"], { type: "chart" }>["value"];
/** A decoded chart layer. */
export type ChartLayerValue = ValueTypeOf<typeof Plan.Types.ChartLayer>;
/** A decoded data layer's styling — how it draws (#1753). */
export type ChartStyleValue = ValueTypeOf<typeof Plan.Types.ChartStyle>;
/** A decoded `{t, y}` chart point. */
export type ChartPointValue = ValueTypeOf<typeof Plan.Types.ChartPoint>;
/** A decoded `{t, lo, hi}` band point — the band arm's own point type. */
export type ChartBandPointValue = Extract<ChartLayerValue, { type: "band" }>["value"]["points"][number];
/** A decoded `{t, y, size}` scatter point — a point with a size a bubble (#1753). */
export type ChartScatterPointValue = ValueTypeOf<typeof Plan.Types.ChartScatterPoint>;
/** A decoded value-axis declaration. */
export type ChartAxisValue = ValueTypeOf<typeof Plan.Types.ChartAxis>;
/** A decoded breach threshold. */
export type PlanBreachValue = ValueTypeOf<typeof Plan.Types.Breach>;
/** Which value axis a layer scales against. */
export type ChartSide = ValueTypeOf<typeof Plan.Types.AxisSide>["type"];

/** A value axis's scale — data value → plot px. */
export type ValueScale = ReturnType<typeof scaleLinear<number>>;

/** Px of air above and below the marks of a chart at a row's own height — a spark. */
export const PAD_Y = 4;

/**
 * The least plot height, in px, at which a chart reads its scale by its numbers as well as its gridlines (#1750), and
 * labels its reference lines. A chart at a row's own height — a spark, of one line or two — is shorter: its numbers
 * would stand against the row's edges, and alone on its first line read as the row's value.
 */
export const CHART_TALL_PX = 48;

/**
 * The air between a plot's edges and the values it scales (#1750), in px. A plot of {@link CHART_TALL_PX} or more
 * keeps the spec's, its top and its bottom value each on the middle of the pixel the spec draws that gridline on — so
 * a number at either end stands clear of the row's edges, its marks with it. A shorter one keeps {@link PAD_Y}, its
 * marks all the rest of its few pixels.
 *
 * @param height - The plot's height (px)
 * @returns The air above its top value and below its bottom one
 */
function chartAir(height: number): { top: number; bottom: number } {
    return height >= CHART_TALL_PX ? { top: 12.5, bottom: 10.5 } : { top: PAD_Y, bottom: PAD_Y };
}
/** A column's inset within its bucket, as a share of the bucket's width. */
const COLUMN_INSET = 0.18;
/** The air between columns side by side in a bucket, as a share of a column's place — a plot's width is a share of
 *  its own, so a share keeps it in proportion to the columns at any width. */
const COLUMN_GAP = 0.15;
/** The largest a bubble's radius is drawn, px — the chart rules' (#1753). */
const BUBBLE_MAX = 16;
/** The smallest a bubble's radius is drawn, px, so the least of a row's bubbles still reads. */
const BUBBLE_MIN = 3;

/**
 * Whether a value breaches a layer's threshold. The layer's own decoded
 * variant is read as it is — never rebuilt (#743 item 6).
 *
 * @param v - The value
 * @param breach - The layer's threshold, when it declares one
 * @returns `true` beyond the threshold; `false` for a gap
 */
export function breached(v: number, breach: PlanBreachValue | undefined): boolean {
    if (breach === undefined || !Number.isFinite(v)) return false;
    switch (breach.type) {
        case "above": return v > breach.value;
        case "below": return v < breach.value;
    }
}

/** One drawn column, in data units and window fractions. */
export interface ColumnGeometry {
    /** Left / right edges as window fractions — inset within its bucket, at its place among the columns side by side there. */
    x0: number;
    x1: number;
    /** The span it covers on its axis — `lo` ≤ `hi`; a stack's part sits on the parts before it. */
    lo: number;
    hi: number;
    /** The column's own value. */
    value: number;
    side: ChartSide;
    /** Beyond its layer's breach threshold. */
    warn: boolean;
    /** At or after the now instant — a column that starts at now is the
     *  period in progress, drawn to the right of the now line (#949). */
    planned: boolean;
    /** Its layer's index in the chart's layers — the layer whose look it draws in (#1753). */
    layer: number;
}

/** A stack's running ends at one bucket: positive parts climb from 0, negative parts descend. */
interface StackEnds {
    up: number;
    down: number;
}

/** One side's stacks — the drawn ones by render bucket, the undrawn by period. */
interface SideStacks {
    drawn: Map<number, StackEnds>;
    undrawn: Map<number, StackEnds>;
}

/** A chart's stacks, by side and then by the name its layers give them. */
type Stacks = Record<ChartSide, Map<string, SideStacks>>;

/**
 * A stack by its name on a side — begun the first time a layer names it.
 *
 * @param stacks - The chart's stacks of one mark
 * @param side - The value axis the layer stacks on
 * @param name - The stack's name
 * @returns The stack
 */
function stackNamed(stacks: Stacks, side: ChartSide, name: string): SideStacks {
    let pile = stacks[side].get(name);
    if (pile === undefined) {
        pile = { drawn: new Map(), undrawn: new Map() };
        stacks[side].set(name, pile);
    }
    return pile;
}

/**
 * Where a value sits on its stack at one bucket: on the end of its sign's
 * side — positive parts climb from 0, negative parts descend from it — which
 * it then extends.
 *
 * @param pile - The stack
 * @param drawn - Whether its bucket is a render bucket, `key` its index; else `key` is its period's
 * @param key - The bucket's key
 * @param v - The value
 * @returns The span it covers
 */
function pileOn(pile: SideStacks, drawn: boolean, key: number, v: number): { lo: number; hi: number } {
    const byKey = drawn ? pile.drawn : pile.undrawn;
    let ends = byKey.get(key);
    if (ends === undefined) {
        ends = { up: 0, down: 0 };
        byKey.set(key, ends);
    }
    if (v >= 0) {
        const lo = ends.up;
        ends.up += v;
        return { lo, hi: ends.up };
    }
    const hi = ends.down;
    ends.down += v;
    return { lo: ends.down, hi };
}

/**
 * Each column layer's place among the columns side by side in a bucket
 * (#1753): the layers of one stack share one, and every other column layer has
 * its own, in the order they first appear — the same place in every bucket.
 *
 * @param layers - The chart's layers
 * @returns Each column layer's place, by its index, and how many places there are
 */
function columnPlaces(layers: readonly ChartLayerValue[]): { of: Map<number, number>; count: number } {
    const byStack: Record<ChartSide, Map<string, number>> = { left: new Map(), right: new Map() };
    const of = new Map<number, number>();
    let count = 0;
    layers.forEach((layer, li) => {
        if (layer.type !== "column") return;
        const { axis, style } = layer.value;
        if (style.stack.type === "some") {
            const taken = byStack[axis.type].get(style.stack.value);
            if (taken !== undefined) {
                of.set(li, taken);
                return;
            }
            byStack[axis.type].set(style.stack.value, count);
        }
        of.set(li, count++);
    });
    return { of, count };
}

/** A chart's stacked geometry: its columns, its stacked areas, and every extent they reach. */
export interface StackLayout {
    /** The columns inside the render bounds, in layer then point order. */
    columns: ColumnGeometry[];
    /** Each stacked area's points, by its layer's index: its fill from `lo` to `hi` at each instant — a gap where it
     *  has no value. An area on no stack is not here: it fills from the baseline. */
    areas: Map<number, ChartBandPointValue[]>;
    /** Every column's span per side, and every stacked area point's — drawn or not — for the value domain. */
    extents: { left: number[]; right: number[] };
}

/**
 * Lay out a chart's stacks — its columns, and its areas that share a stack.
 *
 * @remarks
 * Columns that share a `stack` pile up at their bucket (#1753), and so do
 * areas; a column with no stack starts at the baseline. Columns and areas
 * stack apart, and stacks are kept per value-axis side, so a left-axis column
 * never becomes the base of a right-axis one (#743 item 4), and per sign, so
 * positive parts climb from 0 and negative parts descend from it. A point
 * outside the render bounds is not drawn, but it still stacks — by its period —
 * so the domain it contributes is the same wherever the window sits. A gap
 * draws nothing, and adds nothing to its stack.
 *
 * The columns of a bucket stand side by side in it, each at its place
 * ({@link columnPlaces}) — a stack's columns in one — with a little air
 * between them.
 *
 * @param layers - The chart's layers
 * @param scale - The shared scale
 * @returns The drawn columns, the stacked areas and every extent
 */
export function layoutStacks(layers: readonly ChartLayerValue[], scale: PlanScale): StackLayout {
    const columnStacks: Stacks = { left: new Map(), right: new Map() };
    const areaStacks: Stacks = { left: new Map(), right: new Map() };
    const places = columnPlaces(layers);
    const columns: ColumnGeometry[] = [];
    const areas = new Map<number, ChartBandPointValue[]>();
    const extents: StackLayout["extents"] = { left: [], right: [] };
    layers.forEach((layer, li) => {
        if (layer.type === "area") {
            const { points, axis, style } = layer.value;
            // An area on no stack fills from the baseline, as the row draws it.
            if (style.stack.type === "none") return;
            const pile = stackNamed(areaStacks, axis.type, style.stack.value);
            areas.set(li, points.map((p) => {
                const bucket = scale.renderBucketOf(p.t);
                const key = bucket !== undefined ? bucket.index : scale.toNumber(scale.floor(p.t));
                if (!Number.isFinite(p.y) || !Number.isFinite(key)) return { t: p.t, lo: Number.NaN, hi: Number.NaN };
                const { lo, hi } = pileOn(pile, bucket !== undefined, key, p.y);
                extents[axis.type].push(lo, hi);
                return { t: p.t, lo, hi };
            }));
            return;
        }
        if (layer.type !== "column") return;
        const { points, axis, style, breach } = layer.value;
        const side = axis.type;
        const pile = style.stack.type === "some" ? stackNamed(columnStacks, side, style.stack.value) : undefined;
        const place = places.of.get(li) ?? 0;
        const threshold = breach.type === "some" ? breach.value : undefined;
        for (const p of points) {
            const v = p.y;
            if (!Number.isFinite(v)) continue;
            // RENDER bucketing (#619): a column in the overscan is drawn,
            // clipped at rest.
            const bucket = scale.renderBucketOf(p.t);
            let lo = Math.min(0, v);
            let hi = Math.max(0, v);
            if (pile !== undefined) {
                const key = bucket !== undefined ? bucket.index : scale.toNumber(scale.floor(p.t));
                if (!Number.isFinite(key)) continue;
                ({ lo, hi } = pileOn(pile, bucket !== undefined, key, v));
            }
            extents[side].push(lo, hi);
            if (bucket === undefined) continue;
            const inset = COLUMN_INSET * (bucket.x1 - bucket.x0);
            const slot = (bucket.x1 - bucket.x0 - 2 * inset) / places.count;
            const gap = places.count > 1 ? COLUMN_GAP * slot : 0;
            const x0 = bucket.x0 + inset + place * slot + gap / 2;
            columns.push({
                x0, x1: x0 + slot - gap,
                lo, hi, value: v, side,
                warn: breached(v, threshold),
                planned: scale.nowFrac !== undefined && scale.fracOf(p.t) >= scale.nowFrac,
                layer: li,
            });
        }
    });
    return { columns, areas, extents };
}

/**
 * A chart row's bubble radius (#1753): a scatter point with a size draws a
 * bubble whose area is in proportion to it — its radius to the size's square
 * root — against the greatest size among the row's scatter points, which draws
 * at the chart rules' 16px, or a quarter of the plot's height where that is
 * less, so a bubble fits its row. The least is drawn at 3px, so it still reads.
 *
 * @param kind - The chart row
 * @param height - The plot's height, px
 * @returns A size's radius, px — none where no point of the row has a size
 */
export function bubbleRadius(kind: ChartKindValue, height: number): ((size: number) => number) | undefined {
    let most = 0;
    for (const layer of kind.layers) {
        if (layer.type !== "scatter") continue;
        for (const p of layer.value.points) {
            if (p.size.type === "some" && p.size.value > most) most = p.size.value;
        }
    }
    if (!(most > 0) || !Number.isFinite(most)) return undefined;
    const radius = scaleSqrt<number>({ domain: [0, most], range: [0, Math.min(BUBBLE_MAX, height / 4)] });
    return (size) => Math.max(BUBBLE_MIN, Number.isFinite(size) && size > 0 ? radius(size) : 0);
}

/**
 * A layer's styling — a data layer's; a reference layer has none.
 *
 * @param layer - The layer
 * @returns Its style, when it is a data layer
 */
export function styleOf(layer: ChartLayerValue): ChartStyleValue | undefined {
    switch (layer.type) {
        case "line": case "area": case "column": case "scatter": case "band":
            return layer.value.style;
        case "refLine": case "refBand": case "refDot":
            return undefined;
    }
}

/**
 * How a layer's marks are coloured (#1753): the colour its author chose, or
 * the chart rules' series colour its name takes — or neither, its mark's own ink.
 */
export interface ChartInk {
    /** Its place among the chart's series colours: the order its name first appears among the named layers given no colour. */
    series?: number;
    /** The colour its author chose — a theme token or a CSS colour, as given. */
    color?: string;
}

/**
 * Each layer's ink (#1753).
 *
 * @remarks
 * A layer given a colour draws in it. A named one given none takes the next
 * of the chart's series colours, in the order its name first appears; layers
 * of one name are one series, so a later one takes the first's ink — its
 * colour, where the first was given one. An unnamed one given none keeps its
 * mark's own ink.
 *
 * @param kind - The chart row
 * @returns One per layer, in layer order — none for a reference layer
 */
export function chartInks(kind: ChartKindValue): (ChartInk | undefined)[] {
    const byName = new Map<string, ChartInk>();
    let next = 0;
    return kind.layers.map((layer) => {
        const style = styleOf(layer);
        if (style === undefined) return undefined;
        const own: ChartInk | undefined = style.color.type === "some" ? { color: style.color.value } : undefined;
        if (style.label.type === "none") return own ?? {};
        const named = byName.get(style.label.value);
        if (named !== undefined) return own ?? named;
        const ink = own ?? { series: next++ };
        byName.set(style.label.value, ink);
        return ink;
    });
}

/**
 * The order a chart draws its layers in (#1753): by each one's `order`, the
 * lower first, and as they are declared where two tie — a reference layer's
 * is 0.
 *
 * @param kind - The chart row
 * @returns The layers' indices, in drawing order
 */
export function drawOrder(kind: ChartKindValue): number[] {
    const orderOf = (layer: ChartLayerValue) => {
        const style = styleOf(layer);
        return style !== undefined && style.order.type === "some" ? style.order.value : 0;
    };
    const orders = kind.layers.map(orderOf);
    return kind.layers.map((_, i) => i).sort((a, b) => orders[a]! - orders[b]! || a - b);
}

/** A legend's line (#1750): the spec's 24px of room. */
export const LEGEND_LINE_PX = 24;

/** One line of a chart row's legend (#1750): a named series. */
export interface ChartLegendEntry {
    /** Its name — the `label` its layers give. */
    name: string;
    /** Its ink, which its stroke draws in ({@link chartInks}). */
    ink: ChartInk;
    /** The value axis it scales against — its first layer's. */
    side: ChartSide;
    /** Its unit: its axis's `label`, where the axis names one. */
    unit: string | undefined;
}

/** A chart row's legend (#1750). */
export interface ChartLegend {
    /** Its lines, a named series each, in the order the series are declared. */
    entries: ChartLegendEntry[];
    /** Whether the chart draws data on both its axes — only then does a line name its series' axis. */
    bothAxes: boolean;
}

/**
 * A chart row's legend (#1750): a line a named data series.
 *
 * @remarks
 * The series are listed in the order they are declared — not the order they
 * draw in, which a layer's `order` changes. Layers of one name are one series,
 * as they share one ink: a line on the axis of the first of them. An unnamed
 * layer has no line, nor has a reference layer; a layer whose `legend` is off
 * is left out, and a row whose `legend` is off lists none.
 *
 * @param kind - The chart row
 * @returns Its lines, and whether its chart draws on both axes
 */
export function chartLegend(kind: ChartKindValue): ChartLegend {
    const inks = chartInks(kind);
    const entries: ChartLegendEntry[] = [];
    const listed = new Set<string>();
    const drawsOn = { left: false, right: false };
    kind.layers.forEach((layer, li) => {
        switch (layer.type) {
            case "line": case "area": case "column": case "scatter": case "band": {
                const { axis, style } = layer.value;
                drawsOn[axis.type] = true;
                if (!kind.legend || !style.legend || style.label.type === "none" || listed.has(style.label.value)) return;
                listed.add(style.label.value);
                const declared = axis.type === "left" ? kind.left : kind.right;
                entries.push({
                    name: style.label.value,
                    ink: inks[li] ?? {},
                    side: axis.type,
                    unit: declared.type === "some" && declared.value.label.type === "some" ? declared.value.label.value : undefined,
                });
                return;
            }
            case "refLine": case "refBand": case "refDot":
                return;
        }
    });
    return { entries, bothAxes: drawsOn.left && drawsOn.right };
}

/**
 * How much of a legend a room holds (#1750): every line, where it has room
 * for them all; else every line it has room for but the last, which says how
 * many more there are; none where it has room for no line.
 *
 * @param lines - The legend's lines
 * @param room - Its room, in px
 * @returns The lines drawn, and how many series the last line stands for — none where every line is drawn
 */
export function legendFit(lines: number, room: number): { shown: number; more: number } {
    const fits = Math.max(0, Math.floor(room / LEGEND_LINE_PX));
    if (lines <= fits) return { shown: lines, more: 0 };
    if (fits === 0) return { shown: 0, more: 0 };
    return { shown: fits - 1, more: lines - (fits - 1) };
}

/**
 * Whether a point of a line or an area is one no stroke can draw (#1753): it
 * has a value, and the points either side of it have none or are not there —
 * so a dot draws it, and a sparse series loses no reading.
 *
 * @param points - The series' points, in draw order
 * @param i - The point's index
 * @returns `true` for a point with no neighbour to join
 */
export function lonePoint(points: readonly ChartPointValue[], i: number): boolean {
    const valued = (p: ChartPointValue | undefined) => p !== undefined && Number.isFinite(p.y);
    return valued(points[i]) && !valued(points[i - 1]) && !valued(points[i + 1]);
}

/** A value axis's extent. */
export interface ValueDomain {
    min: number;
    max: number;
}

/** The number-arm bounds of an axis's `ChartDomainType` declaration (a Plan
 *  value axis never carries the time arm — the factory guards it). */
function declaredDomain(axis: ChartAxisValue | undefined): { min: number | undefined; max: number | undefined } {
    const d = axis !== undefined && axis.domain.type === "some" && axis.domain.value.type === "number"
        ? axis.domain.value.value
        : undefined;
    return { min: d?.min, max: d?.max };
}

/**
 * The explicit tick positions of an axis (its `ChartTickValuesType` number arm).
 *
 * @param axis - The axis declaration
 * @returns The positions; empty when none are declared
 */
export function axisTicks(axis: ChartAxisValue | undefined): readonly number[] {
    return axis !== undefined && axis.tickValues.type === "some" && axis.tickValues.value.type === "number"
        ? axis.tickValues.value.value
        : [];
}

/**
 * The domain each value axis spans.
 *
 * @remarks
 * Derived from the geometry the row draws: line and scatter values; an area's
 * values AND its baseline (0) — a stacked area's, its stack's ends; a band's
 * bounds; reference lines and dots, and a target zone's range of values
 * (#1753); and each column's span — its baseline and, stacked, its stack's
 * ends (#743 item 2). Explicit tick positions are inside it too. A declared
 * domain wins over the derived one. No data spans `[0, 1]`, and an empty span
 * opens to one unit.
 *
 * @param kind - The chart row
 * @param stacks - Its stack layout ({@link layoutStacks}), whose extents carry its columns and stacked areas
 * @returns The left and right domains
 */
export function chartDomains(kind: ChartKindValue, stacks: StackLayout): { left: ValueDomain; right: ValueDomain } {
    const values: Record<ChartSide, number[]> = { left: [], right: [] };
    kind.layers.forEach((layer, li) => {
        switch (layer.type) {
            case "line": case "scatter":
                for (const p of layer.value.points) values[layer.value.axis.type].push(p.y);
                break;
            case "area":
                if (stacks.areas.has(li)) break;
                values[layer.value.axis.type].push(0);
                for (const p of layer.value.points) values[layer.value.axis.type].push(p.y);
                break;
            case "band":
                for (const p of layer.value.points) values[layer.value.axis.type].push(p.lo, p.hi);
                break;
            case "refLine": case "refDot":
                values[layer.value.axis.type].push(layer.value.y);
                break;
            case "refBand":
                if (layer.value.y.type === "some") values[layer.value.axis.type].push(layer.value.y.value.lo, layer.value.y.value.hi);
                break;
            case "column":
                break;
        }
    });
    const left = kind.left.type === "some" ? kind.left.value : undefined;
    const right = kind.right.type === "some" ? kind.right.value : undefined;
    return {
        left: domainOf(left, values.left, stacks.extents.left),
        right: domainOf(right, values.right, stacks.extents.right),
    };
}

function domainOf(axis: ChartAxisValue | undefined, values: readonly number[], spans: readonly number[]): ValueDomain {
    let lo = Infinity;
    let hi = -Infinity;
    const take = (v: number) => {
        if (!Number.isFinite(v)) return;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
    };
    for (const v of values) take(v);
    for (const v of spans) take(v);
    for (const v of axisTicks(axis)) take(v);
    const declared = declaredDomain(axis);
    let min = declared.min ?? (lo === Infinity ? 0 : lo);
    let max = declared.max ?? (hi === -Infinity ? 1 : hi);
    if (!(max > min)) max = min + 1;
    return { min, max };
}

/**
 * A value axis's scale over a plot `height` px tall — `min` at the bottom and
 * `max` at the top, inside the plot's air ({@link chartAir}).
 *
 * @param domain - The axis's domain
 * @param height - The plot's height (px), as it is drawn
 * @returns The scale
 */
export function valueScale(domain: ValueDomain, height: number): ValueScale {
    const air = chartAir(height);
    return scaleLinear<number>({ domain: [domain.min, domain.max], range: [height - air.bottom, air.top] });
}

/** A point of a continuous series, at its unclamped window fraction. */
export interface Placed<P> {
    p: P;
    /** The point's window fraction — below 0 before the window, above 1 past it. */
    f: number;
}

/**
 * The points of a continuous series (line / area / band) the row draws, at
 * their TRUE fractions (#743 item 3).
 *
 * @remarks
 * A point is kept when it lies inside the render bounds or when its segment to
 * either neighbour reaches them — the segment that crosses a window edge then
 * keeps its real slope, and the plot clips it. A point is dropped only when
 * both its segments lie wholly to one side, which puts its neighbours on that
 * side too, so the segment now joining them is never drawn in view either. A
 * point the axis cannot place (`NaN` fraction) is kept as a gap.
 *
 * @param points - The series' points, in draw order
 * @param scale - The shared scale
 * @returns The points worth drawing, placed
 */
export function drawnPoints<P extends { t: PlanInstantValue }>(points: readonly P[], scale: PlanScale): Placed<P>[] {
    const lo = scale.renderMin;
    const hi = scale.renderMax;
    const f = points.map((p) => scale.fracOf(p.t));
    const reaches = (a: number | undefined, b: number | undefined) => a !== undefined && b !== undefined
        && Number.isFinite(a) && Number.isFinite(b) && Math.max(a, b) >= lo && Math.min(a, b) <= hi;
    const out: Placed<P>[] = [];
    for (let i = 0; i < points.length; i++) {
        const fi = f[i]!;
        const keep = !Number.isFinite(fi) || (fi >= lo && fi <= hi) || reaches(f[i - 1], fi) || reaches(fi, f[i + 1]);
        if (keep) out.push({ p: points[i]!, f: fi });
    }
    return out;
}

/**
 * Split a line's placed points at the now instant — solid up to it, dashed
 * after, the dashed run starting from the last observed point so the two
 * meet.
 *
 * @param placed - The line's drawn points
 * @param nowFrac - The now instant's fraction, when it is in the window
 * @returns The observed and planned runs
 */
export function splitAtNow<P>(placed: readonly Placed<P>[], nowFrac: number | undefined): { before: Placed<P>[]; after: Placed<P>[] } {
    if (nowFrac === undefined) return { before: [...placed], after: [] };
    const before: Placed<P>[] = [];
    const after: Placed<P>[] = [];
    for (const q of placed) (q.f <= nowFrac ? before : after).push(q);
    if (after.length > 0 && before.length > 0) after.unshift(before[before.length - 1]!);
    return { before, after };
}

/**
 * A value axis's tick formatter — the declared `Chart.format.*` spec through
 * the shared chart-axis `tickFormatter` (#190); an undeclared axis keeps the
 * terse bare-number default of the spec ruler (the shared module's `tick`
 * arm, #850): a whole number, else one decimal, never grouped. Both speak the
 * canvas's locale (#820) — `2.5` is `2,5` in `de-DE`.
 *
 * @param axis - The axis declaration
 * @param locale - The BCP 47 locale the numbers format in
 * @returns The formatter
 */
export function axisFormatter(axis: ChartAxisValue | undefined, locale: string): (v: number) => string {
    const fmt = axis !== undefined && axis.format.type === "some" ? axis.format.value : undefined;
    if (fmt === undefined) return formatters(locale).tick;
    const f = tickFormatter(fmt, "linear", locale);
    return (v) => f(v);
}

/** One tick of a chart row — a gridline across its plot, and what each value axis reads there. */
export interface ChartTick {
    /** Where it stands down the plot, in the px the row's value scales map to. */
    y: number;
    /** What the left axis reads there; none where it labels nothing. */
    left: string | undefined;
    /** What the right axis reads there; none where it labels nothing. */
    right: string | undefined;
}

/**
 * Where an axis places its ticks: the positions it declares, or — where it
 * declares none — about `numTicks` round values across its domain (#1753),
 * which they never move; none where it asks for neither.
 *
 * @param axis - The axis declaration
 * @param scale - Its value scale, whose domain round values are found across
 * @returns The positions, in data units
 */
function placedTicks(axis: ChartAxisValue | undefined, scale: ValueScale): readonly number[] {
    const declared = axisTicks(axis);
    if (declared.length > 0) return declared;
    const count = axis !== undefined && axis.numTicks.type === "some" ? axis.numTicks.value : undefined;
    return count !== undefined && Number.isFinite(count) && count > 0 ? scale.ticks(count) : [];
}

/**
 * A chart row's ticks — ONE set, which its gridlines and both its axes read.
 *
 * @remarks
 * The left axis's tick positions place them — those it declares, or about
 * `numTicks` round values across its domain (#1753) — and a declared right
 * axis reads its own value at each: the two share one set of gridlines, so a
 * right axis whose domain is the left's scaled — 0–40 beside 0–16 — reads round
 * numbers at the left's ticks, and the positions it asks for place nothing.
 * Where the left places none, it still labels its top when the row draws
 * columns on it (#949) — a bar's height reads against its scale's max, and
 * without one it cannot be read at all — and the right axis keeps the ticks it
 * places.
 *
 * @param kind - The chart row
 * @param scales - Its two value scales, at the plot's height ({@link valueScale})
 * @param w - The canvas's words — the locale its numbers format in (#820)
 * @returns The ticks, in the order their axis places them
 */
export function chartTicks(kind: ChartKindValue, scales: { left: ValueScale; right: ValueScale }, w: PlanWords): ChartTick[] {
    const left = kind.left.type === "some" ? kind.left.value : undefined;
    const right = kind.right.type === "some" ? kind.right.value : undefined;
    const leftText = axisFormatter(left, w.locale);
    const rightText = axisFormatter(right, w.locale);
    const declared = placedTicks(left, scales.left);
    if (declared.length > 0) {
        return declared.map((v) => {
            const y = scales.left(v);
            // The right axis's own value at the left's tick, less the float noise two scales leave on a round number.
            const there = right === undefined ? undefined : Number(scales.right.invert(y).toPrecision(12));
            return { y, left: leftText(v), right: there === undefined ? undefined : rightText(there) };
        });
    }
    const ticks: ChartTick[] = [];
    if (kind.layers.some((l) => l.type === "column" && l.value.axis.type === "left")) {
        const top = (scales.left.domain() as [number, number])[1];
        ticks.push({ y: scales.left(top), left: left?.format.type === "some" ? leftText(top) : w.number(top), right: undefined });
    }
    for (const v of placedTicks(right, scales.right)) {
        const y = scales.right(v);
        // One gridline where the two axes' ticks fall on the same pixel.
        const shared = ticks.find((t) => Math.abs(t.y - y) < 0.5);
        if (shared !== undefined) shared.right = rightText(v);
        else ticks.push({ y, left: undefined, right: rightText(v) });
    }
    return ticks;
}

/** A layer the crosshair reads a value from. */
export interface ReadoutLayer {
    /** Its index in `kind.layers`. */
    index: number;
    kind: "line" | "area" | "column" | "scatter" | "band";
}

/**
 * The layers with a value to read at a bucket — every data layer; reference
 * marks are not measures.
 *
 * @param kind - The chart row
 * @returns The layers, in layer order
 */
export function readoutLayers(kind: ChartKindValue): ReadoutLayer[] {
    const out: ReadoutLayer[] = [];
    kind.layers.forEach((layer, index) => {
        switch (layer.type) {
            case "line": case "area": case "column": case "scatter": case "band":
                out.push({ index, kind: layer.type });
                break;
            case "refLine": case "refBand": case "refDot":
                break;
        }
    });
    return out;
}

/** One line of a chart row's readout (#1753): a series, or a layer that names none. */
export interface ReadoutLine {
    /** Its name — the series' `label`; none for a layer that gives none, which reads its stroke and its value alone. */
    name: string | undefined;
    /** Its ink, which its stroke draws in ({@link chartInks}). */
    ink: ChartInk;
    /** Its first layer's mark — the ink a stroke draws in where its layer has none of its own. */
    kind: "line" | "area" | "column" | "scatter" | "band";
    /** Its unit: its first layer's axis's `label`, where the axis names one. */
    unit: string | undefined;
    /** Its layers' indices, in the order they are declared. */
    layers: number[];
}

/**
 * What a chart row's readout reads at a bucket (#1753): a line a series — the
 * layers of one name read together — and a line a layer that gives no name.
 *
 * @remarks
 * The lines are in the order their series are declared, the legend's order —
 * never the order they draw in, which a layer's `order` changes. A reference
 * layer reads nothing. Where the row's hover reads them, a layer whose
 * `tooltip` is off is left out, and a row whose `tooltip` is off reads none;
 * the inspector reads every series, whatever its hover shows.
 *
 * @param kind - The chart row
 * @param hover - The lines are the hover's, which the `tooltip` switches leave layers out of
 * @returns Its lines
 */
export function readoutLines(kind: ChartKindValue, hover: boolean): ReadoutLine[] {
    if (hover && !kind.tooltip) return [];
    const inks = chartInks(kind);
    const lines: ReadoutLine[] = [];
    const byName = new Map<string, ReadoutLine>();
    kind.layers.forEach((layer, li) => {
        switch (layer.type) {
            case "line": case "area": case "column": case "scatter": case "band": {
                const { axis, style } = layer.value;
                if (hover && !style.tooltip) return;
                const named = style.label.type === "some" ? byName.get(style.label.value) : undefined;
                if (named !== undefined) {
                    named.layers.push(li);
                    return;
                }
                const declared = axis.type === "left" ? kind.left : kind.right;
                const line: ReadoutLine = {
                    name: style.label.type === "some" ? style.label.value : undefined,
                    ink: inks[li] ?? {},
                    kind: layer.type,
                    unit: declared.type === "some" && declared.value.label.type === "some" ? declared.value.label.value : undefined,
                    layers: [li],
                };
                if (line.name !== undefined) byName.set(line.name, line);
                lines.push(line);
                return;
            }
            case "refLine": case "refBand": case "refDot":
                return;
        }
    });
    return lines;
}

/**
 * What each line of a chart row's readout reads at each bucket, formatted by
 * its axis (#743, #1753).
 *
 * @remarks
 * A layer's value at a bucket is its LAST value there — a gap is no value. A
 * line reads the value of the first of its layers that has one there, and the
 * range of the first of its bands that has one, beside it — a line and its
 * band read `42 (38–46)` — then, where it is read in full, its unit. A line
 * with nothing there reads `—`, so no line moves as the pointer does. A bucket
 * where no line reads anything is absent.
 *
 * @param kind - The chart row
 * @param scale - The shared scale
 * @param w - The canvas's words — the locale values format in, and how a reading reads (#820)
 * @param read - How it is read: `hover`, the row's hover, whose lines the `tooltip` switches leave out
 *   ({@link readoutLines}); `units`, each reading ends in its unit — the hover's box and the inspector's do, the values a
 *   row reads beside a bucket stand bare
 * @returns Bucket index → one text per {@link readoutLines} entry
 */
export function readoutTable(kind: ChartKindValue, scale: PlanScale, w: PlanWords, read: { hover: boolean; units: boolean }): Map<number, string[]> {
    const lines = readoutLines(kind, read.hover);
    const units = read.units;
    const format: Record<ChartSide, (v: number) => string> = {
        left: axisFormatter(kind.left.type === "some" ? kind.left.value : undefined, w.locale),
        right: axisFormatter(kind.right.type === "some" ? kind.right.value : undefined, w.locale),
    };
    // Each line's value and range at each bucket — a layer's last in the bucket, its line's first such layer's.
    const found = new Map<number, { value: (string | undefined)[]; range: (string | undefined)[] }>();
    const at = (bucket: number) => {
        let held = found.get(bucket);
        if (held === undefined) {
            held = { value: lines.map(() => undefined), range: lines.map(() => undefined) };
            found.set(bucket, held);
        }
        return held;
    };
    lines.forEach((line, slot) => {
        const firstValue = new Map<number, number>();
        const firstRange = new Map<number, number>();
        line.layers.forEach((li, order) => {
            const layer = kind.layers[li]!;
            switch (layer.type) {
                case "line": case "area": case "column": case "scatter": {
                    const fmt = format[layer.value.axis.type];
                    for (const p of layer.value.points) {
                        const bi = scale.bucketOf(p.t);
                        if (bi < 0 || !Number.isFinite(p.y) || (firstValue.get(bi) ?? order) < order) continue;
                        firstValue.set(bi, order);
                        at(bi).value[slot] = fmt(p.y);
                    }
                    break;
                }
                case "band": {
                    const fmt = format[layer.value.axis.type];
                    for (const p of layer.value.points) {
                        const bi = scale.bucketOf(p.t);
                        if (bi < 0 || !Number.isFinite(p.lo) || !Number.isFinite(p.hi) || (firstRange.get(bi) ?? order) < order) continue;
                        firstRange.set(bi, order);
                        at(bi).range[slot] = w.m.valueRange({ from: fmt(p.lo), to: fmt(p.hi) });
                    }
                    break;
                }
                case "refLine": case "refBand": case "refDot":
                    break;
            }
        });
    });
    const table = new Map<number, string[]>();
    for (const [bucket, held] of found) {
        table.set(bucket, lines.map((line, slot) => {
            const value = held.value[slot];
            const range = held.range[slot];
            return value === undefined && range === undefined ? "—" : w.m.chartReading({ value, range, unit: units ? line.unit : undefined });
        }));
    }
    return table;
}
