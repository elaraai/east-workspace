/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { StructType } from "@elaraai/east";
import { SliceBindType } from "../../platform/slice/index.js";

/**
 * `Slice.Legend` data — a swatch / label / count / visibility-toggle rail over
 * the active breakdown series (`slice.groups()`).
 *
 * @property slice - Bound slice closure; toggles drive `state.visible` via
 *                   `setVisible`; series come from `slice.groups()`.
 */
export const SliceLegendType = StructType({
    slice: SliceBindType,
});
export type SliceLegendType = typeof SliceLegendType;
