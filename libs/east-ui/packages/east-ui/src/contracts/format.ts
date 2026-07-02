/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { VariantType, NullType, StringType, BooleanType, StructType } from "@elaraai/east";

// ============================================================================
// Value display format — the shared "how to render this scalar" vocabulary
// ============================================================================

/**
 * Display format for a scalar value — the vocabulary chart axis ticks have
 * always used (`Chart.format.*`), promoted to a cross-cutting contract (#190)
 * so slice fields can declare the same formats (`Slice.config` field
 * `format`, formatting the rail brush axis, the Range pill, and predicate
 * chips consistently).
 *
 * @remarks
 * Built with the `Chart.format.*` helpers or the `Slice.config` field
 * shorthand. `date` / `time` / `datetime` carry a format pattern;
 * `currency` carries its code and a compact flag; the rest are flag-only.
 *
 * @property number   - Plain number formatting
 * @property currency - Currency formatting (`code` + `compact`)
 * @property percent  - Percentage formatting
 * @property compact  - Compact magnitude formatting (e.g. 1.2k)
 * @property date     - Date pattern (e.g. `"MMM YYYY"`)
 * @property time     - Time pattern
 * @property datetime - Datetime pattern
 */
export const ValueFormatType = VariantType({
    number:   NullType,
    currency: StructType({ code: StringType, compact: BooleanType }),
    percent:  NullType,
    compact:  NullType,
    date:     StringType,
    time:     StringType,
    datetime: StringType,
});
export type ValueFormatType = typeof ValueFormatType;
