/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { OptionType, BooleanType, StructType } from "@elaraai/east";
import { SliceBindType } from "../../platform/slice/index.js";

/**
 * `Slice.Range` data — a single time-range pill bound to a slice. Clicking the
 * pill opens the `Slice.Edit` picker (presets · compare · resolved window); the
 * pill itself shows the active window. Single density — the pill is the same at
 * every size; only the picker overlay differs.
 *
 * @property slice    - Bound slice closure (from `Slice.bind`); the renderer
 *                      reads `state.range` / `state.compare` and writes via
 *                      `setRange` / `setCompare`.
 * @property editOpen - Render the picker popover open on mount (for static snapshots).
 */
export const SliceRangePickerType = StructType({
    slice:    SliceBindType,
    editOpen: OptionType(BooleanType),
});
export type SliceRangePickerType = typeof SliceRangePickerType;
