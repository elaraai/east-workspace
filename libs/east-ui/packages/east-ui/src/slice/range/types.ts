/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { ArrayType, OptionType, BooleanType, StructType } from "@elaraai/east";
import { SliceBindType } from "../../platform/slice/index.js";
import { TimeResolutionType } from "../../contracts/time.js";

/**
 * `Slice.Range` data — a single time-range pill bound to a slice. Clicking the
 * pill opens the `Slice.Edit` picker (presets · compare · resolved window); the
 * pill itself shows the active window. Single density — the pill is the same at
 * every size; only the picker overlay differs.
 *
 * @property slice       - Bound slice closure (from `Slice.bind`); the renderer
 *                         reads `state.range` / `state.compare` and writes via
 *                         `setRange` / `setCompare`.
 * @property editOpen    - Render the picker popover open on mount (for static snapshots).
 * @property resolutions - Optional bucket-unit options (e.g. `[week, day]`) —
 *                         when non-empty the pill gains the resolution segment
 *                         beside it, reading `state.resolution` and writing via
 *                         `setResolution` so every bound time-bucketed surface
 *                         re-buckets together. `none` / `[]` ⇒ no segment.
 */
export const SliceRangePickerType = StructType({
    slice:    SliceBindType,
    editOpen: OptionType(BooleanType),
    resolutions: OptionType(ArrayType(TimeResolutionType)),
});
export type SliceRangePickerType = typeof SliceRangePickerType;
