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

import { OverflowType, SizeType, TextDecorationType } from "../../style.js";
import type { OverflowLiteral, SizeLiteral, TextDecorationLiteral } from "../../style.js";
import { PaddingType, MarginType } from "../../layout/style.js";

// ============================================================================
// Code Variant Type
// ============================================================================

/**
 * Code variant type for different code display styles.
 *
 * @property subtle - Subtle background with colored text
 * @property surface - Surface-level styling
 * @property outline - Transparent background with colored border
 */
export const CodeVariantType = VariantType({
    subtle: NullType,
    surface: NullType,
    outline: NullType,
});

export type CodeVariantType = typeof CodeVariantType;
export type CodeVariantLiteral = "subtle" | "surface" | "outline";

// ============================================================================
// Code Visual Style Struct
// ============================================================================

/**
 * Visual-presentation struct for the Code component.
 *
 * Holds visual presets (variant / colorPalette / size), typography,
 * colour escape hatches, layout / sizing, and opacity. Consumed via
 * `CodeType.style`.
 */
export const CodeVisualStyleType = StructType({
    // Visual presets
    variant: OptionType(CodeVariantType),
    colorPalette: OptionType(StringType),
    size: OptionType(SizeType),
    // Colour escape hatches
    color: OptionType(StringType),
    background: OptionType(StringType),
    borderColor: OptionType(StringType),
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

export type CodeVisualStyleType = typeof CodeVisualStyleType;

// ============================================================================
// Code Type
// ============================================================================

/**
 * The concrete East type for Code component data.
 *
 * @property value - The code text to display
 * @property style - Visual-presentation sub-struct
 */
export const CodeType = StructType({
    value: StringType,
    style: OptionType(CodeVisualStyleType),
});

export type CodeType = typeof CodeType;

// ============================================================================
// Code Style (TS interface)
// ============================================================================

/**
 * Style configuration for Code components.
 *
 * Flat at the factory boundary for ergonomics; the IR wraps these fields
 * inside `CodeType.style` (see `CodeVisualStyleType`).
 */
export type CodeStyle = {
    /** Visual style variant */
    variant?: SubtypeExprOrValue<CodeVariantType> | CodeVariantLiteral;
    /** Color palette (e.g., "gray", "blue") */
    colorPalette?: SubtypeExprOrValue<StringType>;
    /** Size of the code text */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /** Foreground text colour. Overrides `colorPalette`. */
    color?: SubtypeExprOrValue<StringType>;
    /** Background colour. Overrides `colorPalette`. */
    background?: SubtypeExprOrValue<StringType>;
    /** Border colour (used with `variant: "outline"`). */
    borderColor?: SubtypeExprOrValue<StringType>;
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
