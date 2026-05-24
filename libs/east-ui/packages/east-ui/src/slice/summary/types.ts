/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { StructType } from "@elaraai/east";
import { SliceBindType } from "../../platform/slice/index.js";

/**
 * `Slice.Summary` data — a compact result/filter-count bar bound to a slice.
 * The result count comes from `slice.resultCount()` (over the bound rows) and
 * the active-narrowing count from `slice.activeCount()`; `clear all` calls
 * `slice.clearFilters()`.
 *
 * @property slice - The bound slice closure (from `Slice.bind`).
 */
export const SliceSummaryType = StructType({
    slice: SliceBindType,
});
export type SliceSummaryType = typeof SliceSummaryType;
