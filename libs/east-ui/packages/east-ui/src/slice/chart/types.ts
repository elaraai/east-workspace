/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { StructType, VariantType, NullType } from "@elaraai/east";
import { SliceBindType } from "../../platform/slice/index.js";
import { ChartSpecType } from "../../charts/spec/index.js";

/**
 * Which `SliceRange` arm a brushed x-window writes — fixed by the chart's x
 * scale: a `time` x drives a `datetime` range, a `linear` x a `float` range.
 * (Band x has no continuous range and never produces a {@link SliceChartType}.)
 *
 * @property datetime - Brush writes a `datetime` `SliceRange` (time x)
 * @property float    - Brush writes a `float` `SliceRange` (linear x)
 */
export const SliceChartRangeKindType = VariantType({
    datetime: NullType,
    float:    NullType,
});
export type SliceChartRangeKindType = typeof SliceChartRangeKindType;

/**
 * `Slice.Chart` with a brush affordance — a slice-bound chart whose plot can be
 * dragged to select an x-window, writing the slice's range (`setRange`) so the
 * whole slice re-narrows. Emitted only when `brush` is set on a time / linear
 * chart; plain slice charts stay a bare `VisxChart`.
 *
 * @property slice     - Bound slice closure; the brush calls `setRange` on it
 * @property spec      - The visx `ChartSpec` to render (the chart itself)
 * @property rangeKind - The `SliceRange` arm the brush writes (see {@link SliceChartRangeKindType})
 */
export const SliceChartType = StructType({
    slice:     SliceBindType,
    spec:      ChartSpecType,
    rangeKind: SliceChartRangeKindType,
});
export type SliceChartType = typeof SliceChartType;
