/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    OptionType,
    StructType,
    FloatType,
    StringType,
    IntegerType,
    DateTimeType,
    BooleanType,
} from "@elaraai/east";

import { SizeType, ColorSchemeType } from "../../style.js";
import type { SizeLiteral, ColorSchemeLiteral } from "../../style.js";

// ============================================================================
// ProgressCircle Style Type — visual presentation only (§0.10)
// ============================================================================

/**
 * Visual-only style struct for ProgressCircle.
 *
 * @property colorPalette - Chakra palette
 * @property size - Size preset
 * @property thickness - Stroke width (e.g. "4px")
 * @property trackColor - Background ring colour
 * @property fillColor - Fill colour
 * @property labelColor - Center value text colour
 */
export const ProgressCircleStyleType = StructType({
    colorPalette: OptionType(ColorSchemeType),
    size: OptionType(SizeType),
    thickness: OptionType(StringType),
    trackColor: OptionType(StringType),
    fillColor: OptionType(StringType),
    labelColor: OptionType(StringType),
});

export type ProgressCircleStyleType = typeof ProgressCircleStyleType;

// ============================================================================
// ProgressCircle IR type
// ============================================================================

/**
 * ProgressCircle IR — mirrors Progress but renders as a ring.
 *
 * @property value - Current progress value (between min and max)
 * @property min - Minimum value (defaults to 0)
 * @property max - Maximum value (defaults to 100)
 * @property showValueText - Whether to render the value in the ring centre
 * @property indeterminate - Indeterminate mode (spins with no known %)
 * @property estimatedDuration - Expected duration in seconds (drives ETA label)
 * @property startedAt - Start timestamp (drives ETA label)
 * @property style - Optional visual-only style
 */
export const ProgressCircleType = StructType({
    value: FloatType,
    min: OptionType(FloatType),
    max: OptionType(FloatType),
    showValueText: OptionType(BooleanType),
    indeterminate: OptionType(BooleanType),
    estimatedDuration: OptionType(IntegerType),
    startedAt: OptionType(DateTimeType),
    style: OptionType(ProgressCircleStyleType),
});

export type ProgressCircleType = typeof ProgressCircleType;

// ============================================================================
// ProgressCircle Style (TS options bag)
// ============================================================================

/**
 * TypeScript options bag for ProgressCircle's `style` sub-struct — visual props only.
 */
export interface ProgressCircleStyle {
    /** Chakra palette */
    colorPalette?: SubtypeExprOrValue<ColorSchemeType> | ColorSchemeLiteral;
    /** Size preset */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /** Stroke width (e.g. "4px") */
    thickness?: SubtypeExprOrValue<StringType>;
    /** Background ring colour */
    trackColor?: SubtypeExprOrValue<StringType>;
    /** Fill colour */
    fillColor?: SubtypeExprOrValue<StringType>;
    /** Center value text colour */
    labelColor?: SubtypeExprOrValue<StringType>;
}
