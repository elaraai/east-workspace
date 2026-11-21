/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Where a `series` layer's marks sit along the measure axis: from zero to the
 * value, or — a layer with a stack id — on the series before it at the same
 * x, as a share of that x's total when it stacks to 100%. What the renderer
 * draws a bar or an area between, and what a click is read against
 * (`hit.ts`).
 *
 * @packageDocumentation
 */

import type { ValueTypeOf } from "@elaraai/east";
import { Chart } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";

/** A `series` node of a chart, decoded. */
export type SeriesLayer = ValueTypeOf<typeof Chart.Spec.Types.SeriesMark>;

/** An x coordinate of a chart, decoded. */
type XCoord = ValueTypeOf<typeof Chart.Spec.Types.XCoord>;

/** A mark's bounds along the measure: `[lo, hi]`. */
export type StackBounds = (index: number, key: string, value: number) => readonly [number, number];

/**
 * A layer's bounds, by series and x.
 *
 * @param layer - The layer
 * @param keyOf - An x coordinate's key, as the plot keys its domain
 * @returns The bounds of the series at an index, at an x's key, of its value there
 */
export function stackBoundsOf(layer: SeriesLayer, keyOf: (x: XCoord) => string): StackBounds {
    if (getSomeorUndefined(layer.stackId) === undefined) return (_index, _key, value) => [0, value];
    const expand = getSomeorUndefined(layer.stackOffset)?.type === "expand";
    // Each series' value at each x, and each x's total.
    const values = layer.data.map((s) => new Map(s.points.map((p) => [keyOf(p.x), p.value] as const)));
    const totals = new Map<string, number>();
    for (const byKey of values) for (const [key, value] of byKey) totals.set(key, (totals.get(key) ?? 0) + value);
    return (index, key, value) => {
        let base = 0;
        for (let j = 0; j < index; j++) base += values[j]!.get(key) ?? 0;
        let lo = base;
        let hi = base + value;
        const total = totals.get(key) ?? 0;
        if (expand && total > 0) { lo /= total; hi /= total; }
        return [lo, hi];
    };
}
