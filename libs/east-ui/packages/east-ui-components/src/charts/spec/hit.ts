/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Which mark of a chart a point of its plot falls on (#1671, CHT-8): the x
 * nearest it along the domain axis, then — the layers drawn last first — the
 * series whose mark there holds the point: a grouped bar's slot, a stacked
 * bar's or area's segment, or a line's or a scatter's point within reach.
 * A point on no mark is the x alone: every series there.
 *
 * It draws nothing: the renderer (`index.tsx`) hands it the plot's geometry,
 * as its scales make it, and tells the host what it found.
 *
 * @packageDocumentation
 */

import { getSomeorUndefined } from "../../utils";
import type { ValueTypeOf } from "@elaraai/east";
import { Chart } from "@elaraai/east-ui/internal";
import { barSlots } from "./bars.js";
import { stackBoundsOf, type SeriesLayer } from "./stack.js";

/** An x coordinate of a chart, decoded. */
type XCoord = ValueTypeOf<typeof Chart.Spec.Types.XCoord>;

/** How near a line's or a scatter's point a click must fall to be that point's, in px. */
export const POINT_REACH = 12;

/** A plot's geometry, as its scales make it. */
export interface PlotGeometry {
    /** The x keys along the domain axis, in their order. */
    readonly keys: readonly string[];
    /** A key's centre along the domain axis. */
    readonly centre: (key: string) => number;
    /** A band's width along the domain axis: the room the bars at an x have (`bars.ts`). */
    readonly bandWidth: number;
    /** Whether the domain runs along y: a horizontal bar chart. */
    readonly horizontal: boolean;
    /** A value's position along the measure axis, on a layer's side. */
    readonly measure: (side: "left" | "right") => (value: number) => number;
    /** Where an unstacked bar starts along the measure axis: the plot's bottom, or its left edge when horizontal. */
    readonly baseline: number;
    /** An x coordinate's key, as the plot keys its domain. */
    readonly keyOf: (x: XCoord) => string;
}

/** What a point of the plot falls on: an x, and the series whose mark there holds it. */
export interface PlotHit {
    /** The x's key. */
    readonly key: string;
    /** The series, by its key; `undefined` when the point is on no mark: every series at the x. */
    readonly series: string | undefined;
}

/** Whether a position is between two others, either way round. */
function between(at: number, a: number, b: number): boolean {
    return at >= Math.min(a, b) && at <= Math.max(a, b);
}

/** Which side a layer reads against. */
function sideOf(layer: SeriesLayer): "left" | "right" {
    const side = getSomeorUndefined(layer.axis);
    return side?.type === "right" ? "right" : "left";
}

/** A stacked layer's segments at a key, in draw order: each series' `[lo, hi]` along the measure, as the renderer draws them. */
function segmentsAt(layer: SeriesLayer, key: string, g: PlotGeometry): { series: string; lo: number; hi: number }[] {
    const bounds = stackBoundsOf(layer, g.keyOf);
    return layer.data.flatMap((s, index) => {
        const point = s.points.find((p) => g.keyOf(p.x) === key);
        if (point === undefined) return [];
        const [lo, hi] = bounds(index, key, point.value);
        return [{ series: s.key, lo, hi }];
    });
}

/** The series of one layer whose mark at a key holds the point: `along` is its position on the domain axis, `across` on the measure axis. */
function layerHit(layer: SeriesLayer, key: string, along: number, across: number, g: PlotGeometry): string | undefined {
    const at = g.measure(sideOf(layer));
    const stacked = getSomeorUndefined(layer.stackId) !== undefined;
    const pointAt = (s: SeriesLayer["data"][number]) => s.points.find((p) => g.keyOf(p.x) === key);
    switch (layer.mark.type) {
        case "bar": {
            // The bars at the x, as they are drawn: a stack is one bar, grouped series side by side.
            const bars = barSlots(g.bandWidth, stacked ? 1 : layer.data.length, g.horizontal);
            const from = along - (g.centre(key) + bars.start);
            const index = Math.floor(from / bars.slot);
            // Beside the bars, or in the hairline between two, is on none.
            if (from < 0 || from - index * bars.slot > bars.size) return undefined;
            if (stacked) return index === 0 ? segmentsAt(layer, key, g).find((seg) => between(across, at(seg.lo), at(seg.hi)))?.series : undefined;
            const series = layer.data[index];
            const point = series === undefined ? undefined : pointAt(series);
            if (series === undefined || point === undefined) return undefined;
            return between(across, g.baseline, at(point.value)) ? series.key : undefined;
        }
        case "area": {
            if (stacked) return segmentsAt(layer, key, g).find((seg) => between(across, at(seg.lo), at(seg.hi)))?.series;
            return nearest(layer, key, across, g);
        }
        case "line": case "scatter":
            return nearest(layer, key, across, g);
    }
}

/** The series whose point at a key is nearest the point along the measure axis, within reach. */
function nearest(layer: SeriesLayer, key: string, across: number, g: PlotGeometry): string | undefined {
    const at = g.measure(sideOf(layer));
    let best: string | undefined;
    let distance = POINT_REACH;
    for (const s of layer.data) {
        const point = s.points.find((p) => g.keyOf(p.x) === key);
        if (point === undefined) continue;
        const d = Math.abs(at(point.value) - across);
        if (d <= distance) { distance = d; best = s.key; }
    }
    return best;
}

export type { SeriesLayer };

/**
 * The mark a point of the plot falls on.
 *
 * @param layers - The chart's `series` layers, in draw order
 * @param g - The plot's geometry
 * @param px - The point's x in the plot, in px from its left edge
 * @param py - The point's y in the plot, in px from its top
 * @returns The x nearest the point and the series whose mark there holds it; `undefined` for a plot with no x
 */
export function markAt(layers: readonly SeriesLayer[], g: PlotGeometry, px: number, py: number): PlotHit | undefined {
    const along = g.horizontal ? py : px;
    const across = g.horizontal ? px : py;
    let key: string | undefined;
    let best = Infinity;
    for (const k of g.keys) {
        const d = Math.abs(g.centre(k) - along);
        if (d < best) { best = d; key = k; }
    }
    if (key === undefined) return undefined;
    // The layer drawn last is on top: it is asked first.
    for (let i = layers.length - 1; i >= 0; i--) {
        const series = layerHit(layers[i]!, key, along, across, g);
        if (series !== undefined) return { key, series };
    }
    return { key, series: undefined };
}
