/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    FloatType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    NullType,
    BooleanType,
} from "@elaraai/east";

import { OverflowType, TextDecorationType } from "../../style.js";
import type { OverflowLiteral, TextDecorationLiteral } from "../../style.js";
import { PaddingType, MarginType } from "../../layout/style.js";

// ============================================================================
// Link Variant Type
// ============================================================================

/**
 * Link variant type for different link styles.
 *
 * @property underline - Always show underline
 * @property plain - No underline by default
 */
export const LinkVariantType = VariantType({
    underline: NullType,
    plain: NullType,
});

export type LinkVariantType = typeof LinkVariantType;
export type LinkVariantLiteral = "underline" | "plain";

// ============================================================================
// Link Visual Style Struct
// ============================================================================

/**
 * Visual-presentation struct for the Link component.
 *
 * Holds visual presets (variant / colorPalette), typography, colour escape
 * hatches (including hover / visited states), layout / sizing, and opacity.
 * Consumed via `LinkType.style`.
 */
export const LinkVisualStyleType = StructType({
    // Visual presets
    variant: OptionType(LinkVariantType),
    colorPalette: OptionType(StringType),
    // Colour escape hatches
    color: OptionType(StringType),
    hoverColor: OptionType(StringType),
    visitedColor: OptionType(StringType),
    // Typography
    textDecoration: OptionType(TextDecorationType),
    lineHeight: OptionType(StringType),
    letterSpacing: OptionType(StringType),
    // Layout / sizing
    overflow: OptionType(OverflowType),
    overflowX: OptionType(OverflowType),
    overflowY: OptionType(OverflowType),
    width: OptionType(StringType),
    height: OptionType(StringType),
    minWidth: OptionType(StringType),
    minHeight: OptionType(StringType),
    maxWidth: OptionType(StringType),
    maxHeight: OptionType(StringType),
    padding: OptionType(PaddingType),
    margin: OptionType(MarginType),
    // Opacity
    opacity: OptionType(FloatType),
});

export type LinkVisualStyleType = typeof LinkVisualStyleType;

// ============================================================================
// Link Type
// ============================================================================

/**
 * The concrete East type for Link component data.
 *
 * @property value - The link text to display
 * @property href - URL the link points to
 * @property external - Whether to open in new tab (state)
 * @property style - Visual-presentation sub-struct
 */
export const LinkType = StructType({
    value: StringType,
    href: StringType,
    external: OptionType(BooleanType),
    style: OptionType(LinkVisualStyleType),
});

export type LinkType = typeof LinkType;

// ============================================================================
// Link Style (TS interface)
// ============================================================================

/**
 * Style configuration for Link components.
 *
 * Flat at the factory boundary for ergonomics; the IR wraps visual fields
 * inside `LinkType.style` (see `LinkVisualStyleType`). `href` is required and
 * `external` is state — both forwarded to the main struct.
 */
export type LinkStyle = {
    /** URL the link points to (required). */
    href: SubtypeExprOrValue<StringType>;
    /** Whether to open in new tab (state — not visual) */
    external?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Visual style variant */
    variant?: SubtypeExprOrValue<LinkVariantType> | LinkVariantLiteral;
    /** Color palette (e.g., "blue", "teal") */
    colorPalette?: SubtypeExprOrValue<StringType>;
    /** Link text colour. Overrides `colorPalette`. */
    color?: SubtypeExprOrValue<StringType>;
    /** Hover-state text colour. */
    hoverColor?: SubtypeExprOrValue<StringType>;
    /** Visited-state text colour. */
    visitedColor?: SubtypeExprOrValue<StringType>;
    /** Text decoration */
    textDecoration?: SubtypeExprOrValue<TextDecorationType> | TextDecorationLiteral;
    /** Line height */
    lineHeight?: SubtypeExprOrValue<StringType>;
    /** Letter spacing */
    letterSpacing?: SubtypeExprOrValue<StringType>;
    /** Overflow behavior */
    overflow?: SubtypeExprOrValue<OverflowType> | OverflowLiteral;
    /** Horizontal overflow behavior */
    overflowX?: SubtypeExprOrValue<OverflowType> | OverflowLiteral;
    /** Vertical overflow behavior */
    overflowY?: SubtypeExprOrValue<OverflowType> | OverflowLiteral;
    /** Width */
    width?: SubtypeExprOrValue<StringType>;
    /** Height */
    height?: SubtypeExprOrValue<StringType>;
    /** Min width */
    minWidth?: SubtypeExprOrValue<StringType>;
    /** Min height */
    minHeight?: SubtypeExprOrValue<StringType>;
    /** Max width */
    maxWidth?: SubtypeExprOrValue<StringType>;
    /** Max height */
    maxHeight?: SubtypeExprOrValue<StringType>;
    /** Padding configuration */
    padding?: SubtypeExprOrValue<PaddingType> | string;
    /** Margin configuration */
    margin?: SubtypeExprOrValue<MarginType> | string;
    /** CSS opacity (0-1) */
    opacity?: SubtypeExprOrValue<FloatType>;
};
