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
import {
    NumberFormatType,
    CurrencyFormatType,
    PercentFormatType,
    CompactFormatType,
    UnitFormatType,
} from "../../charts/types.js";

// ============================================================================
// Numeric Format Variant
// ============================================================================

/**
 * Numeric formatting variants. Each tag carries the format's configuration
 * struct from `charts/types.ts` — `Intl.NumberFormat` options at the renderer.
 *
 * @property Number - Plain number formatting (optionally fraction digits / sign)
 * @property Currency - Currency formatting (ISO 4217 code + display)
 * @property Percent - Percent formatting (fraction digits + sign)
 * @property Compact - Compact notation (1.24M, 384K, …)
 * @property Unit - Unit formatting (12 kg, 42.5 °C, …)
 */
export const NumericFormatType = VariantType({
    Number: NumberFormatType,
    Currency: CurrencyFormatType,
    Percent: PercentFormatType,
    Compact: CompactFormatType,
    Unit: UnitFormatType,
});

export type NumericFormatType = typeof NumericFormatType;

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
 * Holds the typography preset (`textStyle` — defaults to `mono-kpi` at the
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
 * @property format - Formatting preset (Number / Currency / Percent / Compact / Unit)
 * @property sentiment - Semantic classification (drives default colour tint)
 * @property showSign - Whether to show a leading `+` / `−` glyph
 * @property style - Visual-presentation sub-struct
 */
export const NumericType = StructType({
    value: FloatType,
    format: OptionType(NumericFormatType),
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
    /** Formatting preset (Number / Currency / Percent / Compact / Unit) */
    format?: SubtypeExprOrValue<NumericFormatType>;
    /** Semantic sentiment classification */
    sentiment?: SubtypeExprOrValue<NumericSentimentType> | NumericSentimentLiteral;
    /** Whether to show a leading `+` / `−` glyph */
    showSign?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Typography preset (defaults to `mono-kpi` at the renderer) */
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
