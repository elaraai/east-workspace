/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Swatch colours for `Slice.Breakdown` / `Slice.Legend` series, assigned by
 * group position. Colour is a presentation concern (not platform state), so
 * the renderers cycle this palette rather than carry colours in the IR.
 */
export const SLICE_SERIES_PALETTE: readonly string[] = [
    "{colors.series.brand}",
    "{colors.series.brandDeep}",
    "{colors.status.warn}",
    "{colors.status.info}",
    "{colors.gray.500}",
    "{colors.gray.400}",
    "{colors.gray.300}",
];
