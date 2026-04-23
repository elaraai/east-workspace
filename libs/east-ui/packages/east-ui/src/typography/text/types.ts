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
} from "@elaraai/east";

import {
    BorderStyleType,
    BorderWidthType,
    FontFamilyType,
    FontStyleType,
    FontVariantNumericType,
    FontWeightType,
    OverflowType,
    TextAlignType,
    TextDecorationType,
    TextOverflowType,
    TextStyleType,
    TextTransformType,
    WhiteSpaceType,
} from "../../style.js";
import type {
    BorderStyleLiteral,
    BorderWidthLiteral,
    FontFamilyLiteral,
    FontStyleLiteral,
    FontVariantNumericLiteral,
    FontWeightLiteral,
    OverflowLiteral,
    TextAlignLiteral,
    TextDecorationLiteral,
    TextOverflowLiteral,
    TextStyleLiteral,
    TextTransformLiteral,
    WhiteSpaceLiteral,
} from "../../style.js";
import { PaddingType, MarginType } from "../../layout/style.js";

// ============================================================================
// Text Visual Style Struct
// ============================================================================

/**
 * Visual-presentation struct for the Text component.
 *
 * Holds the full set of visual fields for a run of text: typography scale
 * (`textStyle`) and fallback font controls, typography decoration / alignment /
 * wrapping / spacing, colour escape hatches, border, layout / sizing, and
 * opacity. Consumed via `TextType.style`.
 */
export const TextVisualStyleType = StructType({
    // Typography — semantic scale is the primary API; fallback controls below
    textStyle: OptionType(TextStyleType),
    fontWeight: OptionType(FontWeightType),
    fontStyle: OptionType(FontStyleType),
    fontFamily: OptionType(FontFamilyType),
    fontVariantNumeric: OptionType(FontVariantNumericType),
    textAlign: OptionType(TextAlignType),
    textDecoration: OptionType(TextDecorationType),
    textTransform: OptionType(TextTransformType),
    textOverflow: OptionType(TextOverflowType),
    whiteSpace: OptionType(WhiteSpaceType),
    lineHeight: OptionType(StringType),
    letterSpacing: OptionType(StringType),
    // Colour
    color: OptionType(StringType),
    background: OptionType(StringType),
    // Border
    borderWidth: OptionType(BorderWidthType),
    borderStyle: OptionType(BorderStyleType),
    borderColor: OptionType(StringType),
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

export type TextVisualStyleType = typeof TextVisualStyleType;

// ============================================================================
// Text Type
// ============================================================================

/**
 * The concrete East type for Text component data.
 *
 * @property value - The text value
 * @property style - Visual-presentation sub-struct
 */
export const TextType = StructType({
    value: StringType,
    style: OptionType(TextVisualStyleType),
});

export type TextType = typeof TextType;

// ============================================================================
// Text Style (TS interface)
// ============================================================================

/**
 * Style configuration for Text components.
 *
 * Flat at the factory boundary for ergonomics; the IR wraps every visual
 * field inside `TextType.style` (see `TextVisualStyleType`).
 *
 * @remarks
 * Raw `fontSize` has been removed as a public prop — use the semantic
 * `textStyle` (e.g. `"body-md"`, `"mono-kpi"`, `"heading-lg"`) instead.
 * Consuming apps migrate via:
 *
 * | Old `fontSize` | New `textStyle` |
 * |---|---|
 * | `xs`           | `caption`       |
 * | `sm`           | `body-sm`       |
 * | `md`           | `body-md`       |
 * | `lg`           | `body-lg`       |
 *
 * For pixel-level raw sizing, use `Box.Root([Text.Root(...)], { fontSize: "…" })`
 * — `Box.style.fontSize` remains as a raw escape hatch.
 */
export type TextStyle = {
    /** Semantic type-scale preset (display / heading / body / label / caption / code / mono-kpi). */
    textStyle?: SubtypeExprOrValue<TextStyleType> | TextStyleLiteral;
    /** Font weight variant */
    fontWeight?: SubtypeExprOrValue<FontWeightType> | FontWeightLiteral;
    /** Font style variant */
    fontStyle?: SubtypeExprOrValue<FontStyleType> | FontStyleLiteral;
    /** Font family (sans / serif / mono). Inherits to children. */
    fontFamily?: SubtypeExprOrValue<FontFamilyType> | FontFamilyLiteral;
    /** Numeric glyph variant (tabular-nums / oldstyle-nums / slashed-zero / normal). */
    fontVariantNumeric?: SubtypeExprOrValue<FontVariantNumericType> | FontVariantNumericLiteral;
    /** Horizontal text alignment */
    textAlign?: SubtypeExprOrValue<TextAlignType> | TextAlignLiteral;
    /** Text decoration (none, underline, line-through, overline) */
    textDecoration?: SubtypeExprOrValue<TextDecorationType> | TextDecorationLiteral;
    /** Text transform variant */
    textTransform?: SubtypeExprOrValue<TextTransformType> | TextTransformLiteral;
    /** Text overflow behavior (clip or ellipsis) */
    textOverflow?: SubtypeExprOrValue<TextOverflowType> | TextOverflowLiteral;
    /** White space handling (normal, nowrap, pre, etc.) */
    whiteSpace?: SubtypeExprOrValue<WhiteSpaceType> | WhiteSpaceLiteral;
    /** Line height (Chakra token or CSS value, e.g., "tall", "1.5") */
    lineHeight?: SubtypeExprOrValue<StringType>;
    /** Letter spacing (Chakra token or CSS value, e.g., "tight", "wide") */
    letterSpacing?: SubtypeExprOrValue<StringType>;
    /** Text colour (Chakra UI color token or CSS color) */
    color?: SubtypeExprOrValue<StringType>;
    /** Background colour */
    background?: SubtypeExprOrValue<StringType>;
    /** Border width for all sides */
    borderWidth?: SubtypeExprOrValue<BorderWidthType> | BorderWidthLiteral;
    /** Border style for all sides */
    borderStyle?: SubtypeExprOrValue<BorderStyleType> | BorderStyleLiteral;
    /** Border color for all sides (Chakra UI color token or CSS color) */
    borderColor?: SubtypeExprOrValue<StringType>;
    /** Overflow behavior (visible, hidden, scroll, auto) */
    overflow?: SubtypeExprOrValue<OverflowType> | OverflowLiteral;
    /** Horizontal overflow behavior */
    overflowX?: SubtypeExprOrValue<OverflowType> | OverflowLiteral;
    /** Vertical overflow behavior */
    overflowY?: SubtypeExprOrValue<OverflowType> | OverflowLiteral;
    /** Width (Chakra UI size token or CSS value) */
    width?: SubtypeExprOrValue<StringType>;
    /** Height (Chakra UI size token or CSS value) */
    height?: SubtypeExprOrValue<StringType>;
    /** Min width */
    minWidth?: SubtypeExprOrValue<StringType>;
    /** Min height */
    minHeight?: SubtypeExprOrValue<StringType>;
    /** Max width */
    maxWidth?: SubtypeExprOrValue<StringType>;
    /** Max height */
    maxHeight?: SubtypeExprOrValue<StringType>;
    /** Padding configuration — use Padding() helper or string for uniform */
    padding?: SubtypeExprOrValue<PaddingType> | string;
    /** Margin configuration — use Margin() helper or string for uniform */
    margin?: SubtypeExprOrValue<MarginType> | string;
    /** CSS opacity (0-1) */
    opacity?: SubtypeExprOrValue<FloatType>;
};
