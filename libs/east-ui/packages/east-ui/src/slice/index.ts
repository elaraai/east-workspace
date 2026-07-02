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
import { SliceCohort, SlicePresets } from "./cohort/index.js";
import { SliceRail } from "./rail/index.js";

export { SliceSummaryType } from "./summary/types.js";
export { SliceRangePickerType } from "./range/types.js";
export { SliceFilterType } from "./filter/types.js";
export { SliceLegendType } from "./legend/types.js";
export { SliceBreakdownPickerType } from "./breakdown/types.js";
export { SliceSearchType, SliceSearchMatchType } from "./search/types.js";
export { SliceCohortModeType, SliceCohortPickerType } from "./cohort/types.js";

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
    /** Toggleable saved-segment chips + popover authoring. */
    Cohort: SliceCohort,
    /** Curated toggle-only preset bar — `Slice.Cohort` with `mode: "toggle"`. */
    Presets: SlicePresets,
    /** The slice affordance cluster as a standalone strip — place above components reading `slice.rows()`. */
    Rail: SliceRail,
} as const;
