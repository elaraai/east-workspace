/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    OptionType,
    StructType,
    FloatType,
    StringType,
    IntegerType,
    DateTimeType,
    BooleanType,
    NullType,
    VariantType,
    variant,
} from "@elaraai/east";

import { SizeType, ColorSchemeType } from "../../style.js";
import type { SizeLiteral, ColorSchemeLiteral } from "../../style.js";

// ============================================================================
// Progress Variant Type (visual preset — lives under style)
// ============================================================================

/**
 * Variant types for Progress visual style.
 *
 * @property outline - Progress bar with outlined track
 * @property subtle - Progress bar with subtle/filled track
 */
export const ProgressVariantType = VariantType({
    outline: NullType,
    subtle: NullType,
});

export type ProgressVariantType = typeof ProgressVariantType;

/** String literal type for progress variant values. */
export type ProgressVariantLiteral = "outline" | "subtle";

/** Helper to create progress variant values. */
export function ProgressVariant(v: ProgressVariantLiteral): ExprType<ProgressVariantType> {
    return East.value(variant(v, null), ProgressVariantType);
}

// ============================================================================
// Progress Style Type
// ============================================================================

/**
 * Visual-only style struct for Progress.
 *
 * @property variant - Visual preset (outline / subtle)
 * @property colorPalette - Chakra palette
 * @property size - Size preset
 * @property striped - Cosmetic stripes on the fill
 * @property animated - Animate the stripes
 * @property trackColor - Background track colour
 * @property fillColor - Fill colour
 * @property labelColor - Label text colour
 */
export const ProgressStyleType = StructType({
    variant: OptionType(ProgressVariantType),
    colorPalette: OptionType(ColorSchemeType),
    size: OptionType(SizeType),
    striped: OptionType(BooleanType),
    animated: OptionType(BooleanType),
    trackColor: OptionType(StringType),
    fillColor: OptionType(StringType),
    labelColor: OptionType(StringType),
});

export type ProgressStyleType = typeof ProgressStyleType;

// ============================================================================
// Progress IR type
// ============================================================================

/**
 * Progress IR — content + state on main, visuals in `style`.
 *
 * @property value - Current progress value (between min and max)
 * @property min - Minimum value (defaults to 0)
 * @property max - Maximum value (defaults to 100)
 * @property label - Optional label text
 * @property valueText - Optional text showing current value
 * @property indeterminate - Indeterminate mode (no known % complete)
 * @property showValue - Whether to render the computed value text
 * @property estimatedDuration - Expected duration in seconds (drives ETA display)
 * @property startedAt - Start timestamp (drives ETA display)
 * @property style - Optional visual-only style
 */
export const ProgressType = StructType({
    value: FloatType,
    min: OptionType(FloatType),
    max: OptionType(FloatType),
    label: OptionType(StringType),
    valueText: OptionType(StringType),
    indeterminate: OptionType(BooleanType),
    showValue: OptionType(BooleanType),
    estimatedDuration: OptionType(IntegerType),
    startedAt: OptionType(DateTimeType),
    style: OptionType(ProgressStyleType),
});

export type ProgressType = typeof ProgressType;

// ============================================================================
// Progress Style (TS options bag)
// ============================================================================

/**
 * TypeScript options bag for Progress's `style` sub-struct — visual props only.
 */
export interface ProgressStyle {
    /** Visual preset (outline / subtle) */
    variant?: SubtypeExprOrValue<ProgressVariantType> | ProgressVariantLiteral;
    /** Chakra palette */
    colorPalette?: SubtypeExprOrValue<ColorSchemeType> | ColorSchemeLiteral;
    /** Size preset */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /** Cosmetic stripes on the fill */
    striped?: SubtypeExprOrValue<BooleanType>;
    /** Animate the stripes */
    animated?: SubtypeExprOrValue<BooleanType>;
    /** Background track colour */
    trackColor?: SubtypeExprOrValue<StringType>;
    /** Fill colour */
    fillColor?: SubtypeExprOrValue<StringType>;
    /** Label text colour */
    labelColor?: SubtypeExprOrValue<StringType>;
}
