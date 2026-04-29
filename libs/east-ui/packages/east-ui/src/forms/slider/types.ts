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
    StringType,
    FloatType,
    BooleanType,
    NullType,
    VariantType,
    FunctionType,
    variant,
} from "@elaraai/east";

import { SizeType, ColorSchemeType, OrientationType } from "../../style.js";
import type { SizeLiteral, ColorSchemeLiteral, OrientationLiteral } from "../../style.js";

// ============================================================================
// Slider Variant Type
// ============================================================================

/**
 * Variant types for Slider visual style.
 *
 * @property outline - Slider with outlined track
 * @property subtle - Slider with subtle/filled track
 */
export const SliderVariantType = VariantType({
    outline: NullType,
    subtle: NullType,
});

/**
 * Type alias for the SliderVariant variant.
 */
export type SliderVariantType = typeof SliderVariantType;

/**
 * String literal type for slider variant values.
 */
export type SliderVariantLiteral = "outline" | "subtle";

/**
 * Helper function to create slider variant values.
 *
 * @param v - The variant string ("outline" or "subtle")
 * @returns An East expression representing the slider variant
 */
export function SliderVariant(v: "outline" | "subtle"): ExprType<SliderVariantType> {
    return East.value(variant(v, null), SliderVariantType);
}

// ============================================================================
// Slider Style
// ============================================================================

/**
 * East StructType holding visual fields for `Slider`.
 *
 * @property orientation - Layout orientation (`horizontal` / `vertical`)
 * @property variant - Visual variant (`outline` / `subtle`)
 * @property colorPalette - Chakra colour palette
 * @property size - Slider size (`xs` / `sm` / `md` / `lg`)
 * @property trackColor - Explicit colour of the unfilled rail
 * @property fillColor - Explicit colour of the filled portion (start → thumb)
 * @property thumbColor - Explicit colour of the thumb knob
 * @property markColor - Explicit colour of tick / mark indicators
 */
export const SliderStyleType = StructType({
    orientation: OptionType(OrientationType),
    variant: OptionType(SliderVariantType),
    colorPalette: OptionType(ColorSchemeType),
    size: OptionType(SizeType),
    trackColor: OptionType(StringType),
    fillColor: OptionType(StringType),
    thumbColor: OptionType(StringType),
    markColor: OptionType(StringType),
});

/**
 * Type alias for the Slider style struct.
 */
export type SliderStyleType = typeof SliderStyleType;

// ============================================================================
// Slider Type
// ============================================================================

/**
 * East StructType for `Slider` — numeric range selector.
 *
 * @property value - Current slider value
 * @property min - Minimum value (defaults to 0)
 * @property max - Maximum value (defaults to 100)
 * @property step - Step increment for value changes
 * @property disabled - Whether the slider is disabled
 * @property onChange - Callback fired during drag
 * @property onChangeEnd - Callback fired when drag ends
 * @property style - Optional visual style sub-struct
 */
export const SliderType = StructType({
    value: FloatType,
    min: OptionType(FloatType),
    max: OptionType(FloatType),
    step: OptionType(FloatType),
    disabled: OptionType(BooleanType),
    onChange: OptionType(FunctionType([FloatType], NullType)),
    onChangeEnd: OptionType(FunctionType([FloatType], NullType)),
    style: OptionType(SliderStyleType),
});

/**
 * Type alias for the Slider struct.
 */
export type SliderType = typeof SliderType;

// ============================================================================
// Slider Style Interface
// ============================================================================

/**
 * TypeScript interface for `Slider` factory options.
 *
 * @property min - Minimum value (defaults to 0)
 * @property max - Maximum value (defaults to 100)
 * @property step - Step increment for value changes
 * @property orientation - Horizontal or vertical orientation
 * @property colorPalette - Color scheme for the slider
 * @property size - Size of the slider
 * @property variant - Visual variant
 * @property trackColor - Explicit colour of the unfilled rail
 * @property fillColor - Explicit colour of the filled portion
 * @property thumbColor - Explicit colour of the thumb knob
 * @property markColor - Explicit colour of tick / mark indicators
 * @property disabled - Whether the slider is disabled
 * @property onChange - Callback during drag
 * @property onChangeEnd - Callback when drag ends
 */
export interface SliderStyle {
    /** Minimum value (defaults to 0) */
    min?: SubtypeExprOrValue<FloatType>;
    /** Maximum value (defaults to 100) */
    max?: SubtypeExprOrValue<FloatType>;
    /** Step increment for value changes */
    step?: SubtypeExprOrValue<FloatType>;
    /** Horizontal or vertical orientation */
    orientation?: SubtypeExprOrValue<OrientationType> | OrientationLiteral;
    /** Color scheme for the slider */
    colorPalette?: SubtypeExprOrValue<ColorSchemeType> | ColorSchemeLiteral;
    /** Size of the slider */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /** Visual variant (outline or subtle) */
    variant?: SubtypeExprOrValue<SliderVariantType> | SliderVariantLiteral;
    /** Explicit colour of the unfilled rail. */
    trackColor?: SubtypeExprOrValue<StringType>;
    /** Explicit colour of the filled portion (start → thumb). */
    fillColor?: SubtypeExprOrValue<StringType>;
    /** Explicit colour of the thumb knob. */
    thumbColor?: SubtypeExprOrValue<StringType>;
    /** Explicit colour of tick / mark indicators. */
    markColor?: SubtypeExprOrValue<StringType>;
    /** Whether the slider is disabled */
    disabled?: SubtypeExprOrValue<BooleanType>;
    /** Callback triggered when value changes (during drag) */
    onChange?: SubtypeExprOrValue<FunctionType<[FloatType], NullType>>;
    /** Callback triggered when drag ends */
    onChangeEnd?: SubtypeExprOrValue<FunctionType<[FloatType], NullType>>;
}
