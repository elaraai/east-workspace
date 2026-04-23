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
} from "@elaraai/east";

import {
    FontFamilyType,
    FontStyleType,
    FontWeightType,
    OverflowType,
    TextAlignType,
    TextDecorationType,
    TextStyleType,
} from "../../style.js";
import type {
    FontFamilyLiteral,
    FontStyleLiteral,
    FontWeightLiteral,
    OverflowLiteral,
    TextAlignLiteral,
    TextDecorationLiteral,
    TextStyleLiteral,
} from "../../style.js";
import { PaddingType, MarginType } from "../../layout/style.js";

// ============================================================================
// Heading As Type (semantic HTML level)
// ============================================================================

/**
 * Heading semantic level type.
 *
 * @property h1 - Level 1 heading (most important)
 * @property h2 - Level 2 heading
 * @property h3 - Level 3 heading
 * @property h4 - Level 4 heading
 * @property h5 - Level 5 heading
 * @property h6 - Level 6 heading (least important)
 */
export const HeadingAsType = VariantType({
    h1: NullType,
    h2: NullType,
    h3: NullType,
    h4: NullType,
    h5: NullType,
    h6: NullType,
});

export type HeadingAsType = typeof HeadingAsType;
export type HeadingAsLiteral = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

// ============================================================================
// Heading Visual Style Struct
// ============================================================================

/**
 * Visual-presentation struct for the Heading component.
 *
 * Holds the semantic typography scale (`textStyle` — restricted by JSDoc to
 * `display-*` / `heading-*` tokens), font controls, alignment / decoration,
 * colour (incl. background for hero-heading bands), layout / sizing and
 * opacity. Consumed via `HeadingType.style`.
 */
export const HeadingVisualStyleType = StructType({
    // Typography — semantic scale first; fallback font controls below
    textStyle: OptionType(TextStyleType),
    fontWeight: OptionType(FontWeightType),
    fontStyle: OptionType(FontStyleType),
    fontFamily: OptionType(FontFamilyType),
    textAlign: OptionType(TextAlignType),
    textDecoration: OptionType(TextDecorationType),
    lineHeight: OptionType(StringType),
    letterSpacing: OptionType(StringType),
    // Colour
    color: OptionType(StringType),
    background: OptionType(StringType),
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

export type HeadingVisualStyleType = typeof HeadingVisualStyleType;

// ============================================================================
// Heading Type
// ============================================================================

/**
 * The concrete East type for Heading component data.
 *
 * @property value - The heading text
 * @property as - Semantic HTML element (h1–h6)
 * @property style - Visual-presentation sub-struct
 */
export const HeadingType = StructType({
    value: StringType,
    as: OptionType(HeadingAsType),
    style: OptionType(HeadingVisualStyleType),
});

export type HeadingType = typeof HeadingType;

// ============================================================================
// Heading Style (TS interface)
// ============================================================================

/**
 * Style configuration for Heading components.
 *
 * `size` has been removed in favour of the semantic `textStyle` token.
 * Authors use `textStyle: "heading-lg"` / `"display-md"` etc. Migration map:
 *
 * | Old `size`  | New `textStyle`     |
 * |-------------|---------------------|
 * | `xs`        | `heading-xs`        |
 * | `sm`        | `heading-sm`        |
 * | `md`        | `heading-md`        |
 * | `lg`        | `heading-lg`        |
 * | `xl` / `2xl`| `heading-xl` → consolidated (prefer `heading-lg` or `display-sm`) |
 * | `3xl` / `4xl`| `display-sm` / `display-md` |
 * | `5xl` / `6xl`| `display-md` / `display-lg` |
 *
 * Flat at the factory boundary for ergonomics; the IR wraps every visual
 * field inside `HeadingType.style` (see `HeadingVisualStyleType`).
 */
export type HeadingStyle = {
    /** Semantic HTML element (h1–h6). Stays on the main struct — identity. */
    as?: SubtypeExprOrValue<HeadingAsType> | HeadingAsLiteral;
    /** Semantic typography scale. Restrict to display-* / heading-* tokens. */
    textStyle?: SubtypeExprOrValue<TextStyleType> | TextStyleLiteral;
    /** Font weight override */
    fontWeight?: SubtypeExprOrValue<FontWeightType> | FontWeightLiteral;
    /** Font style override */
    fontStyle?: SubtypeExprOrValue<FontStyleType> | FontStyleLiteral;
    /** Font family (sans / serif / mono) */
    fontFamily?: SubtypeExprOrValue<FontFamilyType> | FontFamilyLiteral;
    /** Text colour */
    color?: SubtypeExprOrValue<StringType>;
    /** Background colour (for hero-heading coloured bands) */
    background?: SubtypeExprOrValue<StringType>;
    /** Text alignment */
    textAlign?: SubtypeExprOrValue<TextAlignType> | TextAlignLiteral;
    /** Text decoration (none, underline, line-through, overline) */
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
