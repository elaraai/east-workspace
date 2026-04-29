/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    VariantType,
    OptionType,
    StructType,
    StringType,
    IntegerType,
    FloatType,
    DateTimeType,
    BooleanType,
    NullType,
    FunctionType,
    variant,
    ArrayType,
} from "@elaraai/east";
import {
  DateTimeFormatTokenType
} from "@elaraai/east/internal";

import { SizeType } from "../../style.js";
import type { SizeLiteral } from "../../style.js";

// ============================================================================
// Input Variant Type
// ============================================================================

/**
 * Variant type for Input appearance styles.
 *
 * @remarks
 * Create instances using the {@link InputVariant} function.
 *
 * @property outline - Outlined input with border (default)
 * @property subtle - Input with muted background
 * @property flushed - Underlined input without border
 */
export const InputVariantType = VariantType({
    outline: NullType,
    subtle: NullType,
    flushed: NullType,
});

/**
 * Type representing input variant values.
 */
export type InputVariantType = typeof InputVariantType;

/**
 * String literal type for input variant values.
 */
export type InputVariantLiteral = "outline" | "subtle" | "flushed";

/**
 * Creates an input variant expression.
 *
 * @param inputVariant - The input variant style
 * @returns An East expression representing the input variant
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Input, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Input.String("", {
 *         variant: Input.Variant("outline"),
 *     });
 * });
 * ```
 */
export function InputVariant(inputVariant: "outline" | "subtle" | "flushed"): ExprType<InputVariantType> {
    return East.value(variant(inputVariant, null), InputVariantType);
}

// ============================================================================
// Shared Input Style
// ============================================================================

/**
 * East StructType holding visual fields shared by every Input variant.
 *
 * @remarks
 * `StringInput`, `IntegerInput`, `FloatInput`, and `DateTimeInput`
 * all share this style. Numeric variants additionally honour
 * `stepperColor` (read from this struct via the same field name)
 * for the increment / decrement chevrons; DateTime variants honour
 * `calendarBackground` etc. when popovers ship.
 *
 * @property variant - Input appearance variant (`outline` / `subtle` / `flushed`)
 * @property size - Input size (`xs` / `sm` / `md` / `lg`)
 * @property color - Explicit text colour
 * @property background - Explicit background colour
 * @property borderColor - Explicit border colour
 * @property focusBorderColor - Explicit border colour while focused
 * @property placeholderColor - Explicit placeholder text colour
 */
export const InputStyleType = StructType({
    variant: OptionType(InputVariantType),
    size: OptionType(SizeType),
    color: OptionType(StringType),
    background: OptionType(StringType),
    borderColor: OptionType(StringType),
    focusBorderColor: OptionType(StringType),
    placeholderColor: OptionType(StringType),
});

/**
 * Type alias for the Input style struct.
 */
export type InputStyleType = typeof InputStyleType;

/**
 * TypeScript interface for the shared Input style options.
 *
 * @property variant - Input appearance variant
 * @property size - Input size
 * @property color - Explicit text colour
 * @property background - Explicit background colour
 * @property borderColor - Explicit border colour
 * @property focusBorderColor - Explicit border colour while focused
 * @property placeholderColor - Explicit placeholder text colour
 */
export interface InputStyle {
    /** Input appearance variant (outline / subtle / flushed). */
    variant?: SubtypeExprOrValue<InputVariantType> | InputVariantLiteral;
    /** Input size (xs / sm / md / lg). */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /** Explicit text colour. */
    color?: SubtypeExprOrValue<StringType>;
    /** Explicit background colour. */
    background?: SubtypeExprOrValue<StringType>;
    /** Explicit border colour. */
    borderColor?: SubtypeExprOrValue<StringType>;
    /** Explicit border colour while focused. */
    focusBorderColor?: SubtypeExprOrValue<StringType>;
    /** Explicit placeholder text colour. */
    placeholderColor?: SubtypeExprOrValue<StringType>;
}

// ============================================================================
// String Input Type
// ============================================================================

/**
 * East StructType for `StringInput` — single-line text input.
 *
 * @property value - The current string value
 * @property placeholder - Placeholder text when empty
 * @property maxLength - Maximum character count
 * @property pattern - Regex pattern for validation
 * @property disabled - Whether the input is disabled
 * @property onChange - Callback fired when value changes
 * @property onBlur - Callback fired when input loses focus
 * @property onFocus - Callback fired when input gains focus
 * @property style - Optional visual style sub-struct
 */
export const StringInputType = StructType({
    value: StringType,
    placeholder: OptionType(StringType),
    maxLength: OptionType(IntegerType),
    pattern: OptionType(StringType),
    disabled: OptionType(BooleanType),
    onChange: OptionType(FunctionType([StringType], NullType)),
    onBlur: OptionType(FunctionType([], NullType)),
    onFocus: OptionType(FunctionType([], NullType)),
    style: OptionType(InputStyleType),
});

export type StringInputType = typeof StringInputType;

/**
 * TypeScript interface for `StringInput` factory options.
 *
 * @property placeholder - Placeholder text when empty
 * @property maxLength - Maximum character count
 * @property pattern - Regex pattern for validation
 * @property disabled - Whether the input is disabled
 * @property onChange - Callback fired when value changes
 * @property onBlur - Callback fired when input loses focus
 * @property onFocus - Callback fired when input gains focus
 */
export interface StringInputStyle extends InputStyle {
    /** Placeholder text when empty */
    placeholder?: SubtypeExprOrValue<StringType>;
    /** Maximum character count */
    maxLength?: SubtypeExprOrValue<IntegerType>;
    /** Regex pattern for validation */
    pattern?: SubtypeExprOrValue<StringType>;
    /** Whether the input is disabled */
    disabled?: SubtypeExprOrValue<BooleanType>;
    /** Callback triggered when value changes */
    onChange?: SubtypeExprOrValue<FunctionType<[StringType], NullType>>;
    /** Callback triggered when input loses focus */
    onBlur?: SubtypeExprOrValue<FunctionType<[], NullType>>;
    /** Callback triggered when input gains focus */
    onFocus?: SubtypeExprOrValue<FunctionType<[], NullType>>;
}

// ============================================================================
// Integer Input Type
// ============================================================================

/**
 * East StructType for `IntegerInput` — whole-number input with
 * optional min / max / step.
 *
 * @property value - The current integer value
 * @property min - Minimum allowed value
 * @property max - Maximum allowed value
 * @property step - Step increment for stepper controls
 * @property disabled - Whether the input is disabled
 * @property onChange - Callback fired when value changes
 * @property onBlur - Callback fired when input loses focus
 * @property onFocus - Callback fired when input gains focus
 * @property style - Optional visual style sub-struct
 */
export const IntegerInputType = StructType({
    value: IntegerType,
    min: OptionType(IntegerType),
    max: OptionType(IntegerType),
    step: OptionType(IntegerType),
    disabled: OptionType(BooleanType),
    onChange: OptionType(FunctionType([IntegerType], NullType)),
    onBlur: OptionType(FunctionType([], NullType)),
    onFocus: OptionType(FunctionType([], NullType)),
    style: OptionType(InputStyleType),
});

export type IntegerInputType = typeof IntegerInputType;

/**
 * TypeScript interface for `IntegerInput` factory options.
 *
 * @property min - Minimum allowed value
 * @property max - Maximum allowed value
 * @property step - Step increment for stepper controls
 * @property disabled - Whether the input is disabled
 * @property onChange - Callback fired when value changes
 * @property onBlur - Callback fired when input loses focus
 * @property onFocus - Callback fired when input gains focus
 */
export interface IntegerInputStyle extends InputStyle {
    /** Minimum allowed value */
    min?: SubtypeExprOrValue<IntegerType>;
    /** Maximum allowed value */
    max?: SubtypeExprOrValue<IntegerType>;
    /** Step increment for stepper controls */
    step?: SubtypeExprOrValue<IntegerType>;
    /** Whether the input is disabled */
    disabled?: SubtypeExprOrValue<BooleanType>;
    /** Callback triggered when value changes */
    onChange?: SubtypeExprOrValue<FunctionType<[IntegerType], NullType>>;
    /** Callback triggered when input loses focus */
    onBlur?: SubtypeExprOrValue<FunctionType<[], NullType>>;
    /** Callback triggered when input gains focus */
    onFocus?: SubtypeExprOrValue<FunctionType<[], NullType>>;
}

// ============================================================================
// Float Input Type
// ============================================================================

/**
 * East StructType for `FloatInput` — decimal-number input with
 * optional min / max / step / precision.
 *
 * @property value - The current float value
 * @property min - Minimum allowed value
 * @property max - Maximum allowed value
 * @property step - Step increment for stepper controls
 * @property precision - Number of decimal places
 * @property disabled - Whether the input is disabled
 * @property onChange - Callback fired when value changes
 * @property onBlur - Callback fired when input loses focus
 * @property onFocus - Callback fired when input gains focus
 * @property style - Optional visual style sub-struct
 */
export const FloatInputType = StructType({
    value: FloatType,
    min: OptionType(FloatType),
    max: OptionType(FloatType),
    step: OptionType(FloatType),
    precision: OptionType(IntegerType),
    disabled: OptionType(BooleanType),
    onChange: OptionType(FunctionType([FloatType], NullType)),
    onBlur: OptionType(FunctionType([], NullType)),
    onFocus: OptionType(FunctionType([], NullType)),
    style: OptionType(InputStyleType),
});

export type FloatInputType = typeof FloatInputType;

/**
 * TypeScript interface for `FloatInput` factory options.
 *
 * @property min - Minimum allowed value
 * @property max - Maximum allowed value
 * @property step - Step increment for stepper controls
 * @property precision - Number of decimal places
 * @property disabled - Whether the input is disabled
 * @property onChange - Callback fired when value changes
 * @property onBlur - Callback fired when input loses focus
 * @property onFocus - Callback fired when input gains focus
 */
export interface FloatInputStyle extends InputStyle {
    /** Minimum allowed value */
    min?: SubtypeExprOrValue<FloatType>;
    /** Maximum allowed value */
    max?: SubtypeExprOrValue<FloatType>;
    /** Step increment for stepper controls */
    step?: SubtypeExprOrValue<FloatType>;
    /** Number of decimal places */
    precision?: SubtypeExprOrValue<IntegerType>;
    /** Whether the input is disabled */
    disabled?: SubtypeExprOrValue<BooleanType>;
    /** Callback triggered when value changes */
    onChange?: SubtypeExprOrValue<FunctionType<[FloatType], NullType>>;
    /** Callback triggered when input loses focus */
    onBlur?: SubtypeExprOrValue<FunctionType<[], NullType>>;
    /** Callback triggered when input gains focus */
    onFocus?: SubtypeExprOrValue<FunctionType<[], NullType>>;
}

// ============================================================================
// DateTime Input Type
// ============================================================================

/**
 * Variant type for DateTime precision options.
 *
 * @property date - Date-only mode (no time)
 * @property time - Time-only mode (no date)
 * @property datetime - Combined date and time
 */
export const DateTimePrecisionType = VariantType({
    date: NullType,
    time: NullType,
    datetime: NullType,
});
/** Variant type alias for DateTime precision. */
export type DateTimePrecisionType = typeof DateTimePrecisionType;
/** String literal type for DateTime precision options. */
export type DateTimePrecisionLiteral = "date" | "time" | "datetime";

/**
 * East StructType for `DateTimeInput` — date / time / datetime input.
 *
 * @property value - The current DateTime value
 * @property min - Minimum allowed date/time
 * @property max - Maximum allowed date/time
 * @property precision - Picker precision (`date` / `time` / `datetime`)
 * @property format - Display format token list
 * @property disabled - Whether the input is disabled
 * @property onChange - Callback fired when value changes
 * @property onBlur - Callback fired when input loses focus
 * @property onFocus - Callback fired when input gains focus
 * @property style - Optional visual style sub-struct
 */
export const DateTimeInputType = StructType({
    value: DateTimeType,
    min: OptionType(DateTimeType),
    max: OptionType(DateTimeType),
    precision: OptionType(DateTimePrecisionType),
    format: OptionType(ArrayType(DateTimeFormatTokenType)),
    disabled: OptionType(BooleanType),
    onChange: OptionType(FunctionType([DateTimeType], NullType)),
    onBlur: OptionType(FunctionType([], NullType)),
    onFocus: OptionType(FunctionType([], NullType)),
    style: OptionType(InputStyleType),
});

export type DateTimeInputType = typeof DateTimeInputType;

/**
 * TypeScript interface for `DateTimeInput` factory options.
 *
 * @property min - Minimum allowed date/time
 * @property max - Maximum allowed date/time
 * @property precision - Picker precision
 * @property format - Display format token list
 * @property disabled - Whether the input is disabled
 * @property onChange - Callback fired when value changes
 * @property onBlur - Callback fired when input loses focus
 * @property onFocus - Callback fired when input gains focus
 */
export interface DateTimeInputStyle extends InputStyle {
    /** Minimum allowed date/time */
    min?: SubtypeExprOrValue<DateTimeType>;
    /** Maximum allowed date/time */
    max?: SubtypeExprOrValue<DateTimeType>;
    /** Picker precision (date / time / datetime) */
    precision?: SubtypeExprOrValue<typeof DateTimePrecisionType> | DateTimePrecisionLiteral;
    /** Display format token list */
    format?: SubtypeExprOrValue<ArrayType<typeof DateTimeFormatTokenType>> | string;
    /** Whether the input is disabled */
    disabled?: SubtypeExprOrValue<BooleanType>;
    /** Callback triggered when value changes */
    onChange?: SubtypeExprOrValue<FunctionType<[DateTimeType], NullType>>;
    /** Callback triggered when input loses focus */
    onBlur?: SubtypeExprOrValue<FunctionType<[], NullType>>;
    /** Callback triggered when input gains focus */
    onFocus?: SubtypeExprOrValue<FunctionType<[], NullType>>;
}
