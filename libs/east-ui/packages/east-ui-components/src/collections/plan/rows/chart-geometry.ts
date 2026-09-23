/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A chart row's geometry as numbers (#743) — the columns' stacked extents,
 * the value domain each axis side spans, the points a continuous series
 * draws, and each layer's value per bucket. The marks, the gutter ticks and
 * the crosshair readout all read it, so an axis can never label a scale the
 * marks do not use.
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

import { scaleLinear } from "@visx/scale";
import type { ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";
import { tickFormatter } from "../../../charts/spec/index.js";
import type { PlanInstantValue } from "../instant.js";
import type { PlanScale } from "../scale.js";

/** A decoded chart row kind. */
export type ChartKindValue = Extract<ValueTypeOf<typeof Plan.Types.Row>["kind"], { type: "chart" }>["value"];
/** A decoded chart layer. */
export type ChartLayerValue = ValueTypeOf<typeof Plan.Types.ChartLayer>;
/** A decoded `{t, y}` chart point. */
export type ChartPointValue = ValueTypeOf<typeof Plan.Types.ChartPoint>;
/** A decoded `{t, lo, hi}` band point — the band arm's own point type. */
export type ChartBandPointValue = Extract<ChartLayerValue, { type: "band" }>["value"]["points"][number];
/** A decoded value-axis declaration. */
export type ChartAxisValue = ValueTypeOf<typeof Plan.Types.ChartAxis>;
/** A decoded breach threshold. */
export type PlanBreachValue = ValueTypeOf<typeof Plan.Types.Breach>;
/** Which value axis a layer scales against. */
export type ChartSide = ValueTypeOf<typeof Plan.Types.AxisSide>["type"];

/** A value axis's scale — data value → plot px. */
export type ValueScale = ReturnType<typeof scaleLinear<number>>;

/** Px of air above and below the marks. */
export const PAD_Y = 4;
/** A column's inset within its bucket, as a share of the bucket's width. */
const COLUMN_INSET = 0.18;

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
    /** Left / right edges as window fractions (inset within the bucket). */
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
    /** After the now instant. */
    planned: boolean;
    /** Its stack series' first-appearance index (0 for an unstacked column). */
    seriesIndex: number;
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

/** The chart's column geometry: what is drawn, and every column's extent. */
export interface ColumnLayout {
    /** The columns inside the render bounds, in layer then point order. */
    drawn: ColumnGeometry[];
    /** Every column's span per side — drawn or not — for the value domain. */
    extents: { left: number[]; right: number[] };
}

/**
 * Lay out a chart's columns.
 *
 * @remarks
 * A column with a `series` stacks on its SIDE's stack at its bucket; one
 * without starts at the baseline. Stacks are kept per value-axis side, so a
 * left-axis column never becomes the base of a right-axis one (#743 item 4),
 * and per sign, so positive parts climb from 0 and negative parts descend from
 * it. A column outside the render bounds is not drawn, but it still stacks —
 * by its period — so the domain it contributes is the same wherever the
 * window sits. A gap draws nothing.
 *
 * @param layers - The chart's layers
 * @param scale - The shared scale
 * @returns The drawn columns and every column's extent
 */
export function layoutColumns(layers: readonly ChartLayerValue[], scale: PlanScale): ColumnLayout {
    const stacks: Record<ChartSide, SideStacks> = {
        left: { drawn: new Map(), undrawn: new Map() },
        right: { drawn: new Map(), undrawn: new Map() },
    };
    const drawn: ColumnGeometry[] = [];
    const extents: ColumnLayout["extents"] = { left: [], right: [] };
    const seriesIds: string[] = [];
    for (const layer of layers) {
        if (layer.type !== "column") continue;
        const { points, axis, series, breach } = layer.value;
        const side = axis.type;
        const stackId = series.type === "some" ? series.value : undefined;
        let seriesIndex = 0;
        if (stackId !== undefined) {
            const at = seriesIds.indexOf(stackId);
            seriesIndex = at >= 0 ? at : seriesIds.push(stackId) - 1;
        }
        const threshold = breach.type === "some" ? breach.value : undefined;
        for (const p of points) {
            const v = p.y;
            if (!Number.isFinite(v)) continue;
            // RENDER bucketing (#619): a column in the overscan is drawn,
            // clipped at rest.
            const bucket = scale.renderBucketOf(p.t);
            let lo = Math.min(0, v);
            let hi = Math.max(0, v);
            if (stackId !== undefined) {
                const key = bucket !== undefined ? bucket.index : scale.toNumber(scale.floor(p.t));
                if (!Number.isFinite(key)) continue;
                const byKey = bucket !== undefined ? stacks[side].drawn : stacks[side].undrawn;
                let ends = byKey.get(key);
                if (ends === undefined) {
                    ends = { up: 0, down: 0 };
                    byKey.set(key, ends);
                }
                if (v >= 0) {
                    lo = ends.up;
                    hi = ends.up + v;
                    ends.up = hi;
                } else {
                    hi = ends.down;
                    lo = ends.down + v;
                    ends.down = lo;
                }
            }
            extents[side].push(lo, hi);
            if (bucket === undefined) continue;
            const inset = COLUMN_INSET * (bucket.x1 - bucket.x0);
            drawn.push({
                x0: bucket.x0 + inset,
                x1: bucket.x1 - inset,
                lo, hi, value: v, side,
                warn: breached(v, threshold),
                planned: scale.nowFrac !== undefined && scale.fracOf(p.t) > scale.nowFrac,
                seriesIndex,
            });
        }
    }
    return { drawn, extents };
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
 * values AND its baseline (0); a band's bounds; reference lines and dots; and
 * each column's span — its baseline and, stacked, its stack's ends (#743 item
 * 2). Explicit tick positions are inside it too. A declared domain wins over
 * the derived one. No data spans `[0, 1]`, and an empty span opens to one
 * unit.
 *
 * @param kind - The chart row
 * @param columns - Its column layout ({@link layoutColumns})
 * @returns The left and right domains
 */
export function chartDomains(kind: ChartKindValue, columns: ColumnLayout): { left: ValueDomain; right: ValueDomain } {
    const values: Record<ChartSide, number[]> = { left: [], right: [] };
    for (const layer of kind.layers) {
        switch (layer.type) {
            case "line": case "scatter":
                for (const p of layer.value.points) values[layer.value.axis.type].push(p.y);
                break;
            case "area":
                values[layer.value.axis.type].push(0);
                for (const p of layer.value.points) values[layer.value.axis.type].push(p.y);
                break;
            case "band":
                for (const p of layer.value.points) values[layer.value.axis.type].push(p.lo, p.hi);
                break;
            case "refLine": case "refDot":
                values[layer.value.axis.type].push(layer.value.y);
                break;
            case "column": case "refBand":
                break;
        }
    }
    const left = kind.left.type === "some" ? kind.left.value : undefined;
    const right = kind.right.type === "some" ? kind.right.value : undefined;
    return {
        left: domainOf(left, values.left, columns.extents.left),
        right: domainOf(right, values.right, columns.extents.right),
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
 * `max` at the top, inside {@link PAD_Y} of air.
 *
 * @param domain - The axis's domain
 * @param height - The plot's height (px)
 * @returns The scale
 */
export function valueScale(domain: ValueDomain, height: number): ValueScale {
    return scaleLinear<number>({ domain: [domain.min, domain.max], range: [height - PAD_Y, PAD_Y] });
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
 * terse bare-number default of the spec ruler.
 *
 * @param axis - The axis declaration
 * @returns The formatter
 */
export function axisFormatter(axis: ChartAxisValue | undefined): (v: number) => string {
    const fmt = axis !== undefined && axis.format.type === "some" ? axis.format.value : undefined;
    if (fmt === undefined) return (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
    const f = tickFormatter(fmt, "linear");
    return (v) => f(v);
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

/**
 * Each readout layer's value at each bucket, formatted by its axis — the
 * crosshair's text (#743). A layer's value at a bucket is its LAST value in
 * the bucket (a band's `lo–hi`) — a gap is no value; a layer with none there
 * reads `—`. Buckets where no layer has a value are absent.
 *
 * @param kind - The chart row
 * @param scale - The shared scale
 * @returns Bucket index → one text per {@link readoutLayers} entry
 */
export function readoutTable(kind: ChartKindValue, scale: PlanScale): Map<number, string[]> {
    const layers = readoutLayers(kind);
    const format: Record<ChartSide, (v: number) => string> = {
        left: axisFormatter(kind.left.type === "some" ? kind.left.value : undefined),
        right: axisFormatter(kind.right.type === "some" ? kind.right.value : undefined),
    };
    const table = new Map<number, string[]>();
    const cell = (bucket: number, slot: number, text: string) => {
        let row = table.get(bucket);
        if (row === undefined) {
            row = layers.map(() => "—");
            table.set(bucket, row);
        }
        row[slot] = text;
    };
    layers.forEach(({ index }, slot) => {
        const layer = kind.layers[index]!;
        switch (layer.type) {
            case "line": case "area": case "column": case "scatter": {
                const fmt = format[layer.value.axis.type];
                for (const p of layer.value.points) {
                    const bi = scale.bucketOf(p.t);
                    if (bi >= 0 && Number.isFinite(p.y)) cell(bi, slot, fmt(p.y));
                }
                break;
            }
            case "band": {
                const fmt = format[layer.value.axis.type];
                for (const p of layer.value.points) {
                    const bi = scale.bucketOf(p.t);
                    if (bi >= 0 && Number.isFinite(p.lo) && Number.isFinite(p.hi)) cell(bi, slot, `${fmt(p.lo)}–${fmt(p.hi)}`);
                }
                break;
            }
            case "refLine": case "refBand": case "refDot":
                break;
        }
    });
    return table;
}
