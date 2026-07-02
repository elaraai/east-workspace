/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { StructType, OptionType, VariantType, NullType } from "@elaraai/east";
import { SliceBindType } from "../../platform/slice/index.js";

/**
 * Interaction mode for `Slice.Legend` (#188).
 *
 * @property filter     - The facet bar (default): items come from the
 *                        self-excluding `slice.facetGroups()` and a click
 *                        toggles the item in the field's `in`-set filter —
 *                        OR within the field, AND across fields. Options
 *                        never disappear while selected.
 * @property visibility - The chart-decluttering rail: items come from
 *                        `slice.groups()` and a click flips the series'
 *                        membership in `state.visible` (rows untouched).
 */
export const SliceLegendModeType = VariantType({
    filter: NullType,
    visibility: NullType,
});
export type SliceLegendModeType = typeof SliceLegendModeType;

/**
 * `Slice.Legend` data — a swatch / label / count rail over the active
 * breakdown series.
 *
 * @property slice - Bound slice closure; filter mode reads
 *                   `slice.facetGroups()` and writes the field's `in`-set
 *                   filter; visibility mode reads `slice.groups()` and
 *                   drives `state.visible` via `setVisible`.
 * @property mode  - `filter` (facet bar, default) or `visibility`
 *                   (chart-decluttering eye rail).
 */
export const SliceLegendType = StructType({
    slice: SliceBindType,
    mode:  OptionType(SliceLegendModeType),
});
export type SliceLegendType = typeof SliceLegendType;
