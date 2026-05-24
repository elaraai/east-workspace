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
    ArrayType,
} from "@elaraai/east";

import { OverflowType, TextDecorationType } from "../../style.js";
import type { OverflowLiteral, TextDecorationLiteral } from "../../style.js";
import { PaddingType, MarginType } from "../../layout/style.js";

// ============================================================================
// Highlight Visual Style Struct
// ============================================================================

/**
 * Visual-presentation struct for the Highlight component.
 *
 * Holds every visual field: colour escape hatches, typography,
 * layout / sizing, and opacity. Consumed via `HighlightType.style`.
 */
export const HighlightVisualStyleType = StructType({
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

export type HighlightVisualStyleType = typeof HighlightVisualStyleType;

// ============================================================================
// Highlight Type
// ============================================================================

/**
 * The concrete East type for Highlight component data.
 *
 * @property value - The text containing content to highlight
 * @property query - Array of strings to highlight within the text
 * @property style - Visual-presentation sub-struct
 */
export const HighlightType = StructType({
    value: StringType,
    query: ArrayType(StringType),
    style: OptionType(HighlightVisualStyleType),
});

export type HighlightType = typeof HighlightType;

// ============================================================================
// Highlight Style (TS interface)
// ============================================================================

/**
 * Style configuration for Highlight components.
 *
 * Flat at the factory boundary for ergonomics; the IR wraps these fields
 * inside `HighlightType.style` (see `HighlightVisualStyleType`).
 */
export type HighlightStyle = {
    /** Foreground text colour for the highlighted portions */
    color?: SubtypeExprOrValue<StringType>;
    /** Background colour for highlighted portions (the highlight fill) */
    background?: SubtypeExprOrValue<StringType>;
    /** Text decoration */
    textDecoration?: SubtypeExprOrValue<TextDecorationType> | TextDecorationLiteral;
    /** Line height */
    lineHeight?: SubtypeExprOrValue<StringType>;
    /** Letter spacing */
    letterSpacing?: SubtypeExprOrValue<StringType>;
    /** Overflow behaviour */
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
