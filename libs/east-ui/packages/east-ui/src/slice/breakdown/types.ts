/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { StructType, OptionType } from "@elaraai/east";
import { SliceBindType, SliceDensityType } from "../../platform/slice/index.js";

/**
 * `Slice.Breakdown` data — split-by-dimension picker bound to a slice.
 * Dimensions come from `slice.dimensions()` and the resulting series from
 * `slice.groups()` (over the rows bound at `Slice.bind`).
 *
 * @property slice - Bound slice closure; the active dimension is
 *                   `state.breakdown` (set via `setBreakdown`).
 */
export const SliceBreakdownPickerType = StructType({
    slice:   SliceBindType,
    density: OptionType(SliceDensityType),
});
export type SliceBreakdownPickerType = typeof SliceBreakdownPickerType;
