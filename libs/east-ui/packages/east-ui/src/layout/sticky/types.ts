/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
} from "@elaraai/east";

/**
 * Sticky boundary — whether the sticky content sticks relative to its
 * parent scroll container (default) or the viewport.
 *
 * @remarks
 * Use `parent` for sticky headers inside a card's scrollable body; use
 * `viewport` only for truly page-wide sticky regions (the host app usually
 * owns those and east-ui is embedded inside the host's content area).
 *
 * @property parent - Sticks relative to the nearest scroll ancestor (default)
 * @property viewport - Sticks relative to the viewport (uses `position: fixed`)
 */
export const StickyBoundaryType = VariantType({
    parent: NullType,
    viewport: NullType,
});

export type StickyBoundaryType = typeof StickyBoundaryType;
export type StickyBoundaryLiteral = "parent" | "viewport";

/**
 * Style configuration for Sticky components.
 *
 * @property background - Background colour applied when the region is stuck
 * @property borderColor - Bottom-border colour (typically for sticky headers)
 * @property shadowColor - Shadow colour applied when the region crosses its boundary
 */
export const StickyStyleType = StructType({
    background: OptionType(StringType),
    borderColor: OptionType(StringType),
    shadowColor: OptionType(StringType),
});

export type StickyStyleType = typeof StickyStyleType;

/**
 * TypeScript style interface.
 */
export interface StickyStyle {
    /** Background colour applied when the region is stuck. */
    background?: SubtypeExprOrValue<StringType>;
    /** Bottom-border colour (typically for sticky headers). */
    borderColor?: SubtypeExprOrValue<StringType>;
    /** Shadow colour applied when the region crosses its boundary. */
    shadowColor?: SubtypeExprOrValue<StringType>;
}

/**
 * Sticky options — passed to `Sticky.Root(content, opts)`.
 */
export interface StickyOptions {
    /** CSS length for the sticky offset (`"0"`, `"12px"`, `"var(--header-height)"`). Default `"0"`. */
    offset?: SubtypeExprOrValue<StringType>;
    /** Whether the region sticks to its parent scroll ancestor (default) or the viewport. */
    boundary?: SubtypeExprOrValue<StickyBoundaryType> | StickyBoundaryLiteral;
    /** Style escape hatches. */
    style?: StickyStyle;
}
