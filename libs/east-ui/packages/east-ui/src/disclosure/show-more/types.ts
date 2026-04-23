/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    OptionType,
    StructType,
    StringType,
    IntegerType,
} from "@elaraai/east";

// ============================================================================
// Disclosure Style Type — visual presentation only (§0.10)
// ============================================================================

/**
 * Visual-only style struct for Disclosure (show-more text truncation).
 * Content (`text`), config (`lines` / `moreLabel` / `lessLabel`) live on
 * the main `Disclosure` variant (inline in `component.ts`) per the
 * Type-shape convention (§0.10).
 *
 * @property color - Body text colour
 * @property triggerColor - "show more" / "show less" trigger link colour
 */
export const DisclosureStyleType = StructType({
    color: OptionType(StringType),
    triggerColor: OptionType(StringType),
});

/**
 * Type representing the Disclosure visual-style structure.
 */
export type DisclosureStyleType = typeof DisclosureStyleType;

/**
 * TypeScript options bag for Disclosure's `style` sub-struct — visual props only.
 */
export interface DisclosureStyle {
    /** Body text colour */
    color?: SubtypeExprOrValue<StringType>;
    /** Show more / show less trigger colour */
    triggerColor?: SubtypeExprOrValue<StringType>;
}

/**
 * TypeScript options bag for `Disclosure.Root`.
 *
 * @property lines - Number of visible lines before the toggle (default: 3)
 * @property moreLabel - Label for the expand trigger (default: "show more")
 * @property lessLabel - Label for the collapse trigger (default: "show less")
 * @property style - Visual-presentation sub-struct
 */
export interface DisclosureOptions {
    /** Number of visible lines before truncation */
    lines?: SubtypeExprOrValue<IntegerType>;
    /** Label for the expand trigger */
    moreLabel?: SubtypeExprOrValue<StringType>;
    /** Label for the collapse trigger */
    lessLabel?: SubtypeExprOrValue<StringType>;
    /** Visual-presentation sub-struct */
    style?: DisclosureStyle;
}
