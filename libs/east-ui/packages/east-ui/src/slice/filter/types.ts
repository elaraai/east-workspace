/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { OptionType, StringType, BooleanType, StructType } from "@elaraai/east";
import { SliceBindType, SliceDensityType } from "../../platform/slice/index.js";

/**
 * `Slice.Filter` data — faceted predicate chips bound to a slice.
 *
 * Chips render straight from `state.filters`; each predicate already carries
 * its `fieldId`, operator, and typed value, so no schema is embedded. The
 * `+ add filter` chip opens a built-in inline predicate builder (field /
 * operator / value, driven by `slice.fields()`) that calls `slice.addFilter`
 * — no host wiring.
 *
 * @property slice       - Bound slice closure; chips read `state.filters`,
 *                         remove via `removeFilter`, and the builder appends
 *                         via `addFilter`.
 * @property resultCount - Optional post-narrowing row count for the
 *                         `SHOWING N {unit}` footer.
 * @property unit        - Optional unit noun for the footer count
 *                         (e.g. `"events"` → `SHOWING 1,284 events`).
 * @property builderOpen - When true, the inline add-filter builder renders
 *                         expanded on mount (default collapsed).
 */
export const SliceFilterType = StructType({
    slice:       SliceBindType,
    unit:        OptionType(StringType),
    density:     OptionType(SliceDensityType),
    editOpen:    OptionType(BooleanType),
});
export type SliceFilterType = typeof SliceFilterType;
