/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    OptionType,
    StructType,
    ArrayType,
    StringType,
    FloatType,
    VariantType,
    NullType,
} from "@elaraai/east";

import { NumberDomainType } from "../spec/types.js";
import type { NumberDomainInput } from "../spec/number-domain.js";

// ============================================================================
// Sparkline Chart Type
// ============================================================================

/**
 * Variant type for Sparkline chart appearance.
 *
 * @remarks
 * Determines how the sparkline data is visualized.
 *
 * @property line - Line chart connecting data points
 * @property area - Filled area chart below the line
 */
export const SparklineChartType = VariantType({
    line: NullType,
    area: NullType,
});

/**
 * Type representing sparkline chart variant values.
 */
export type SparklineChartType = typeof SparklineChartType;

/**
 * String literal type for sparkline chart values.
 */
export type SparklineChartLiteral = "line" | "area";

// ============================================================================
// Sparkline Type
// ============================================================================

// ============================================================================
// Sparkline Style
// ============================================================================

/**
 * Visual-only style struct for Sparkline.
 *
 * @property color - Line/fill colour (Chakra colour token or CSS colour)
 * @property height - Height of the sparkline (CSS length)
 * @property width - Width of the sparkline (CSS length)
 */
export const SparklineStyleType = StructType({
    color: OptionType(StringType),
    height: OptionType(StringType),
    width: OptionType(StringType),
});

/** Type alias for the Sparkline style struct. */
export type SparklineStyleType = typeof SparklineStyleType;

// ============================================================================
// Sparkline Type
// ============================================================================

/**
 * Type for Sparkline component data.
 *
 * @remarks
 * Sparkline is a compact inline chart for showing trends.
 * It displays an array of numeric values as a small visualization.
 *
 * @property data - Array of numeric values to plot
 * @property type - Chart type (line or area)
 * @property domain - One vertical scale, `[min, max]` (east-workspace#1729): each value drawn at its place in it, a value past either end at that end — so the lines of several sparklines on one domain compare; `none`, the line runs over its own min and max. A domain whose bounds are no finite numbers, or whose `max` is not past its `min`, places nothing on it: the line runs over its own
 * @property style - Optional visual-only style sub-struct
 */
export const SparklineType = StructType({
    data: ArrayType(FloatType),
    type: OptionType(SparklineChartType),
    domain: OptionType(NumberDomainType),
    style: OptionType(SparklineStyleType),
});

/**
 * Type representing the Sparkline structure.
 */
export type SparklineType = typeof SparklineType;

// ============================================================================
// Sparkline Style
// ============================================================================

/**
 * TypeScript interface for Sparkline style options.
 *
 * @property type - Chart type (line or area)
 * @property domain - One vertical scale, `[min, max]`, each bound a Float or an expression of one, as a Chart axis's `domain` is: several sparklines on one domain compare. Omit for the line's own min and max
 * @property color - Line/fill color (Chakra color token or CSS color)
 * @property height - Height of the sparkline
 * @property width - Width of the sparkline
 */
export interface SparklineStyle {
    /** Chart type (line or area) */
    type?: SubtypeExprOrValue<SparklineChartType> | SparklineChartLiteral;
    /** One vertical scale, `[min, max]`, as a Chart axis's `domain` is written; omit for the line's own min and max. */
    domain?: NumberDomainInput;
    /** Line/fill color (Chakra color token or CSS color) */
    color?: SubtypeExprOrValue<StringType>;
    /** Height of the sparkline */
    height?: SubtypeExprOrValue<StringType>;
    /** Width of the sparkline */
    width?: SubtypeExprOrValue<StringType>;
}
