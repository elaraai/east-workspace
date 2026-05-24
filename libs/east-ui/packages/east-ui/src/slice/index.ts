/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Slice` namespace — the platform (`bind` / `apply` / `config` / `state` /
 * `Types`) merged with the `Slice.*` UI component family. Consumers import a
 * single `Slice` from `@elaraai/east-ui`.
 *
 * @packageDocumentation
 */

import { Slice as SlicePlatform } from "../platform/slice/index.js";
import { SliceSummary } from "./summary/index.js";
import { SliceRange } from "./range/index.js";
import { SliceFilter } from "./filter/index.js";
import { SliceLegend } from "./legend/index.js";
import { SliceBreakdown } from "./breakdown/index.js";
import { SliceSearch } from "./search/index.js";
import { SliceCohort } from "./cohort/index.js";
import { SliceFrame } from "./frame/index.js";
import { SliceChart } from "./chart/index.js";

export { SliceSummaryType } from "./summary/types.js";
export { SliceRangePickerType } from "./range/types.js";
export { SliceFilterType } from "./filter/types.js";
export { SliceLegendType } from "./legend/types.js";
export { SliceBreakdownPickerType } from "./breakdown/types.js";
export { SliceSearchType, SliceSearchMatchType } from "./search/types.js";
export { SliceCohortPickerType } from "./cohort/types.js";

/** Combined `Slice` — platform state + UI components. */
export const Slice = {
    ...SlicePlatform,
    /** Result/filter-count status bar. */
    Summary: SliceSummary,
    /** Preset time-range picker. */
    Range: SliceRange,
    /** Faceted predicate chips. */
    Filter: SliceFilter,
    /** Series swatch / visibility rail. */
    Legend: SliceLegend,
    /** Split-by-dimension picker. */
    Breakdown: SliceBreakdown,
    /** Typeahead over a slice dimension. */
    Search: SliceSearch,
    /** Saved-segment chips + focused-cohort predicate detail. */
    Cohort: SliceCohort,
    /** Container that houses a slice consumer (Table / Chart) with eyebrow + derived footer. */
    Frame: SliceFrame,
    /** Slice-bound visx charts (Line / Bar / Area) split by the active breakdown. */
    Chart: SliceChart,
} as const;
