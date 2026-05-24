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

import { OverflowType, TextDecorationType } from "../../style.js";
import type { OverflowLiteral, TextDecorationLiteral } from "../../style.js";
import { PaddingType, MarginType } from "../../layout/style.js";

// ============================================================================
// Mark Variant Type
// ============================================================================

/**
 * Mark variant type for different highlight styles.
 *
 * @property subtle - Subtle highlight effect
 * @property solid - Solid colored highlight
 * @property text - Text-color only highlight
 * @property plain - Plain mark styling
 */
export const MarkVariantType = VariantType({
    subtle: NullType,
    solid: NullType,
    text: NullType,
    plain: NullType,
});

export type MarkVariantType = typeof MarkVariantType;
export type MarkVariantLiteral = "subtle" | "solid" | "text" | "plain";

// ============================================================================
// Mark Visual Style Struct
// ============================================================================

/**
 * Visual-presentation struct for the Mark component.
 *
 * Holds visual presets (variant / colorPalette), typography, colour escape
 * hatches, layout / sizing, and opacity. Consumed via `MarkType.style`.
 */
export const MarkVisualStyleType = StructType({
    // Visual presets
    variant: OptionType(MarkVariantType),
    colorPalette: OptionType(StringType),
    // Colour
    color: OptionType(StringType),
    background: OptionType(StringType),
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

export type MarkVisualStyleType = typeof MarkVisualStyleType;

// ============================================================================
// Mark Type
// ============================================================================

/**
 * The concrete East type for Mark component data.
 *
 * @property value - The text to mark/highlight
 * @property style - Visual-presentation sub-struct
 */
export const MarkType = StructType({
    value: StringType,
    style: OptionType(MarkVisualStyleType),
});

export type MarkType = typeof MarkType;

// ============================================================================
// Mark Style (TS interface)
// ============================================================================

/**
 * Style configuration for Mark components.
 *
 * Flat at the factory boundary for ergonomics; the IR wraps these fields
 * inside `MarkType.style` (see `MarkVisualStyleType`).
 */
export type MarkStyle = {
    /** Visual style variant */
    variant?: SubtypeExprOrValue<MarkVariantType> | MarkVariantLiteral;
    /** Color palette (e.g., "yellow", "green") */
    colorPalette?: SubtypeExprOrValue<StringType>;
    /** Foreground text colour. Overrides `colorPalette`. */
    color?: SubtypeExprOrValue<StringType>;
    /** Background fill colour. Overrides `colorPalette`. */
    background?: SubtypeExprOrValue<StringType>;
    /** Text decoration */
    textDecoration?: SubtypeExprOrValue<TextDecorationType> | TextDecorationLiteral;
    /** Line height */
    lineHeight?: SubtypeExprOrValue<StringType>;
    /** Letter spacing */
    letterSpacing?: SubtypeExprOrValue<StringType>;
    /** Overflow behavior */
    overflow?: SubtypeExprOrValue<OverflowType> | OverflowLiteral;
    /** Horizontal overflow */
    overflowX?: SubtypeExprOrValue<OverflowType> | OverflowLiteral;
    /** Vertical overflow */
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
