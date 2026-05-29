/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useCallback } from "react";
import { type ValueTypeOf, some, none, variant, match } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui";
import { EastVisxChart } from "../../charts/spec";
import { getSomeorUndefined } from "../../utils";
import { useSliceReactivity } from "../use-slice-reactivity";

/** East `Slice.Chart` (brush-bearing) value type. */
export type SliceChartValue = ValueTypeOf<typeof Slice.Chart.Types.Chart>;

export interface EastSliceChartProps {
    value: SliceChartValue;
}

/**
 * Renders a brush-bearing `Slice.Chart` — the visx chart plus a horizontal
 * drag-to-select brush. A selection writes the slice's range (`setRange`) as a
 * `datetime` / `float` `SliceRange` (per the chart's x scale); clearing the
 * brush resets the range to `none`. `useSliceReactivity` keeps it in sync with
 * every other slice control.
 */
export const EastSliceChart = memo(function EastSliceChart({ value }: EastSliceChartProps) {
    const { slice, spec, rangeKind } = value;
    useSliceReactivity(slice.key);

    const onBrushEnd = useCallback((range: { from: number; to: number } | null) => {
        if (range === null) { slice.setRange(none); return; }
        const r = match(rangeKind, {
            datetime: () => variant("datetime", { from: new Date(range.from), to: new Date(range.to) }),
            float:    () => variant("float", { from: range.from, to: range.to }),
        });
        slice.setRange(some(r));
    }, [slice, rangeKind]);

    // Remount the brush whenever the applied range changes: visx Brush holds its
    // selection in pixel state, which goes stale once the new range re-narrows
    // the data + x-scale. A fresh key clears the lingering rectangle.
    const rangeVal = getSomeorUndefined(slice.read().range);
    const brushKey = rangeVal === undefined
        ? "none"
        : JSON.stringify(rangeVal, (_k, v) => typeof v === "bigint" ? v.toString() : v instanceof Date ? v.toISOString() : v);

    return <EastVisxChart value={spec} brush brushKey={brushKey} onBrushEnd={onBrushEnd} />;
});
