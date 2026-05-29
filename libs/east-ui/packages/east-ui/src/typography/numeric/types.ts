/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    BooleanType,
    FloatType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
} from "@elaraai/east";

import { TextStyleType } from "../../style.js";
import type { TextStyleLiteral } from "../../style.js";
import { TickFormatType } from "../../format/types.js";

// ============================================================================
// Numeric Sentiment Variant
// ============================================================================

/**
 * Semantic classification for a numeric value — drives the default colour
 * tint at the renderer. Override via `style.color` for brand-specific
 * tinting.
 */
export const NumericSentimentType = VariantType({
    positive: NullType,
    negative: NullType,
    neutral: NullType,
});

export type NumericSentimentType = typeof NumericSentimentType;
export type NumericSentimentLiteral = "positive" | "negative" | "neutral";

// ============================================================================
// Numeric Visual Style Struct
// ============================================================================

/**
 * Visual-presentation struct for the Numeric component.
 *
 * Holds the typography preset (`textStyle` — defaults to inline 14px mono at the
 * renderer), colour (escape hatches for foreground, background, and the
 * leading sign glyph), and opacity. Consumed via `NumericType.style`.
 */
export const NumericVisualStyleType = StructType({
    // Typography preset (visual)
    textStyle: OptionType(TextStyleType),
    // Colour escape hatches
    color: OptionType(StringType),        // overrides sentiment-derived default
    background: OptionType(StringType),
    signColor: OptionType(StringType),    // distinct tint for leading +/−
    // Opacity
    opacity: OptionType(FloatType),
});

export type NumericVisualStyleType = typeof NumericVisualStyleType;

// ============================================================================
// Numeric Type
// ============================================================================

/**
 * The concrete East type for Numeric component data.
 *
 * @property value - The numeric value (FloatType — factory coerces integers)
 * @property format - Formatting preset (shared `Format` / tick vocabulary —
 *                    number / currency / percent / compact / unit / scientific /
 *                    engineering / date / time / datetime)
 * @property sentiment - Semantic classification (drives default colour tint)
 * @property showSign - Whether to show a leading `+` / `−` glyph
 * @property style - Visual-presentation sub-struct
 */
export const NumericType = StructType({
    value: FloatType,
    format: OptionType(TickFormatType),
    sentiment: OptionType(NumericSentimentType),
    showSign: OptionType(BooleanType),
    style: OptionType(NumericVisualStyleType),
});

export type NumericType = typeof NumericType;

// ============================================================================
// Numeric Style (TS interface)
// ============================================================================

/**
 * Style configuration for Numeric components.
 *
 * Flat at the factory boundary for ergonomics; the IR wraps visual fields
 * inside `NumericType.style`. `format`, `sentiment`, and `showSign` are
 * content/state — they land on the main struct.
 */
export type NumericStyle = {
    /** Formatting preset — a `Format.*` / tick value (number, currency,
     *  percent, compact, unit, scientific, engineering, date, time, datetime) */
    format?: SubtypeExprOrValue<TickFormatType>;
    /** Semantic sentiment classification */
    sentiment?: SubtypeExprOrValue<NumericSentimentType> | NumericSentimentLiteral;
    /** Whether to show a leading `+` / `−` glyph */
    showSign?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Typography preset (defaults to inline 14px mono at the renderer) */
    textStyle?: SubtypeExprOrValue<TextStyleType> | TextStyleLiteral;
    /** Foreground colour. Overrides the sentiment-derived default. */
    color?: SubtypeExprOrValue<StringType>;
    /** Background colour */
    background?: SubtypeExprOrValue<StringType>;
    /** Leading `+` / `−` glyph colour (when `showSign: true`) */
    signColor?: SubtypeExprOrValue<StringType>;
    /** CSS opacity (0-1) */
    opacity?: SubtypeExprOrValue<FloatType>;
};
