/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    StringType,
    IntegerType,
    FloatType,
    DateTimeType,
    BooleanType,
    variant,
    some,
    none,
    ArrayType,
} from "@elaraai/east";

import { SizeType } from "../../style.js";
import { UIComponentType } from "../../component.js";
import {
    InputVariantType,
    InputVariant,
    InputStyleType,
    StringInputType,
    IntegerInputType,
    FloatInputType,
    DateTimeInputType,
    type InputStyle,
    type StringInputStyle,
    type IntegerInputStyle,
    type FloatInputStyle,
    type DateTimeInputStyle,
    DateTimePrecisionType,
} from "./types.js";
import { DateTimeFormatTokenType, tokenizeDateTimeFormat } from "@elaraai/east/internal";

// Re-export types
export {
    InputVariantType,
    InputVariant,
    InputStyleType,
    StringInputType,
    IntegerInputType,
    FloatInputType,
    DateTimeInputType,
    type InputStyle,
    type StringInputStyle,
    type IntegerInputStyle,
    type FloatInputStyle,
    type DateTimeInputStyle,
    type InputVariantLiteral,
} from "./types.js";

// ============================================================================
// Shared style routing
// ============================================================================

function buildInputStyle(style: InputStyle | undefined): ExprType<InputStyleType> | undefined {
    const variantValue = style?.variant
        ? (typeof style.variant === "string"
            ? East.value(variant(style.variant, null), InputVariantType)
            : style.variant)
        : undefined;

    const sizeValue = style?.size
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), SizeType)
            : style.size)
        : undefined;

    const has = !!style && (
        variantValue !== undefined ||
        sizeValue !== undefined ||
        style.color !== undefined ||
        style.background !== undefined ||
        style.borderColor !== undefined ||
        style.focusBorderColor !== undefined ||
        style.placeholderColor !== undefined ||
        style.autoFocus !== undefined
    );

    if (!has) return undefined;

    return East.value({
        variant: variantValue ? some(variantValue) : none,
        size: sizeValue ? some(sizeValue) : none,
        color: style!.color !== undefined ? some(style!.color) : none,
        background: style!.background !== undefined ? some(style!.background) : none,
        borderColor: style!.borderColor !== undefined ? some(style!.borderColor) : none,
        focusBorderColor: style!.focusBorderColor !== undefined ? some(style!.focusBorderColor) : none,
        placeholderColor: style!.placeholderColor !== undefined ? some(style!.placeholderColor) : none,
        autoFocus: style!.autoFocus !== undefined ? some(style!.autoFocus) : none,
    }, InputStyleType);
}

// ============================================================================
// Input Functions
// ============================================================================

export function StringInput_(
    value: SubtypeExprOrValue<StringType>,
    style?: StringInputStyle,
): ExprType<StringInputType> {
    const styleValue = buildInputStyle(style);

    return East.value({
        value,
        placeholder: style?.placeholder ? some(style.placeholder) : none,
        maxLength: style?.maxLength !== undefined ? some(style.maxLength) : none,
        pattern: style?.pattern ? some(style.pattern) : none,
        disabled: style?.disabled !== undefined ? some(style.disabled) : none,
        onChange: style?.onChange ? some(style.onChange) : none,
        onBlur: style?.onBlur ? some(style.onBlur) : none,
        onFocus: style?.onFocus ? some(style.onFocus) : none,
        style: styleValue ? some(styleValue) : none,
    }, StringInputType);
}

function StringInput(
    value: SubtypeExprOrValue<StringType>,
    style?: StringInputStyle,
): ExprType<UIComponentType> {
    return East.value(variant("StringInput", StringInput_(value, style)), UIComponentType);
}

export function IntegerInput_(
    value: SubtypeExprOrValue<IntegerType>,
    style?: IntegerInputStyle,
): ExprType<IntegerInputType> {
    const styleValue = buildInputStyle(style);

    return East.value({
        value,
        min: style?.min !== undefined ? some(style.min) : none,
        max: style?.max !== undefined ? some(style.max) : none,
        step: style?.step !== undefined ? some(style.step) : none,
        disabled: style?.disabled !== undefined ? some(style.disabled) : none,
        onChange: style?.onChange ? some(style.onChange) : none,
        onBlur: style?.onBlur ? some(style.onBlur) : none,
        onFocus: style?.onFocus ? some(style.onFocus) : none,
        style: styleValue ? some(styleValue) : none,
    }, IntegerInputType);
}

function IntegerInput(
    value: SubtypeExprOrValue<IntegerType>,
    style?: IntegerInputStyle,
): ExprType<UIComponentType> {
    return East.value(variant("IntegerInput", IntegerInput_(value, style)), UIComponentType);
}


export function FloatInput_(
    value: SubtypeExprOrValue<FloatType>,
    style?: FloatInputStyle,
): ExprType<FloatInputType> {
    const styleValue = buildInputStyle(style);

    return East.value({
        value,
        min: style?.min !== undefined ? some(style.min) : none,
        max: style?.max !== undefined ? some(style.max) : none,
        step: style?.step !== undefined ? some(style.step) : none,
        precision: style?.precision !== undefined ? some(style.precision) : none,
        disabled: style?.disabled !== undefined ? some(style.disabled) : none,
        onChange: style?.onChange ? some(style.onChange) : none,
        onBlur: style?.onBlur ? some(style.onBlur) : none,
        onFocus: style?.onFocus ? some(style.onFocus) : none,
        style: styleValue ? some(styleValue) : none,
    }, FloatInputType);
}

function FloatInput(
    value: SubtypeExprOrValue<FloatType>,
    style?: FloatInputStyle,
): ExprType<UIComponentType> {
    return East.value(variant("FloatInput", FloatInput_(value, style)), UIComponentType);
}


export function DateTimeInput_(
    value: SubtypeExprOrValue<DateTimeType>,
    style?: DateTimeInputStyle,
): ExprType<DateTimeInputType> {
    const styleValue = buildInputStyle(style);

    const toBoolOption = (val: SubtypeExprOrValue<BooleanType> | boolean | undefined) => {
        if (val === undefined) return none;
        return some(val);
    };

    const precisionValue = style?.precision
        ? (typeof style.precision === "string"
            ? East.value(variant(style.precision, null), DateTimePrecisionType)
            : style.precision)
        : undefined;

    const formatValue = style?.format
        ? (typeof style.format === "string"
            ? East.value(tokenizeDateTimeFormat(style.format), ArrayType(DateTimeFormatTokenType))
            : style.format)
        : undefined;

    return East.value({
        value,
        min: style?.min !== undefined ? some(style.min) : none,
        max: style?.max !== undefined ? some(style.max) : none,
        precision: precisionValue ? some(precisionValue) : none,
        format: formatValue ? some(formatValue) : none,
        disabled: toBoolOption(style?.disabled),
        onChange: style?.onChange ? some(style.onChange) : none,
        onBlur: style?.onBlur ? some(style.onBlur) : none,
        onFocus: style?.onFocus ? some(style.onFocus) : none,
        style: styleValue ? some(styleValue) : none,
    }, DateTimeInputType);
}

function DateTimeInput(
    value: SubtypeExprOrValue<DateTimeType>,
    style?: DateTimeInputStyle,
): ExprType<UIComponentType> {
    return East.value(variant("DateTimeInput", DateTimeInput_(value, style)), UIComponentType);
}

/**
 * Input compound component for form data entry.
 *
 * @remarks
 * Input provides typed input components for different data types.
 * Each input type has specific validation and formatting options.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Input, UIComponentType } from "@elaraai/east-ui";
 *
 * // String input
 * const stringExample = East.function([], UIComponentType, $ => {
 *     return Input.String("John", {
 *         placeholder: "Enter name",
 *         variant: "outline",
 *     });
 * });
 *
 * // Integer input with constraints
 * const integerExample = East.function([], UIComponentType, $ => {
 *     return Input.Integer(25n, {
 *         min: 0n,
 *         max: 150n,
 *     });
 * });
 *
 * // Float input with precision
 * const floatExample = East.function([], UIComponentType, $ => {
 *     return Input.Float(19.99, {
 *         min: 0,
 *         precision: 2n,
 *     });
 * });
 *
 * // DateTime input
 * const dateExample = East.function([], UIComponentType, $ => {
 *     return Input.DateTime(new Date(), {
 *         precision: "datetime",
 *         format: "yyyy-MM-dd HH:mm",
 *     });
 * });
 * ```
 */
export const Input = {
    String: StringInput,
    Integer: IntegerInput,
    Float: FloatInput,
    DateTime: DateTimeInput,
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
    Variant: InputVariant,
    Types: {
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
        String: StringInputType,
        /**
         * East StructType for `IntegerInput`.
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
        Integer: IntegerInputType,
        /**
         * East StructType for `FloatInput`.
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
        Float: FloatInputType,
        /**
         * East StructType for `DateTimeInput`.
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
        DateTime: DateTimeInputType,
        /**
         * East StructType holding visual fields shared by all Input variants.
         *
         * @property variant - Input appearance variant
         * @property size - Input size
         * @property color - Explicit text colour
         * @property background - Explicit background colour
         * @property borderColor - Explicit border colour
         * @property focusBorderColor - Explicit border colour while focused
         * @property placeholderColor - Explicit placeholder text colour
         */
        Style: InputStyleType,
        /**
         * Variant type for DateTime precision options.
         *
         * @property date - Date only (no time)
         * @property time - Time only (no date)
         * @property datetime - Full date and time
         */
        DateTimePrecision: DateTimePrecisionType,
        /**
         * Variant type for Input appearance styles.
         *
         * @property outline - Outlined input with border (default)
         * @property subtle - Input with muted background
         * @property flushed - Underlined input without border
         */
        Variant: InputVariantType,
    },
} as const;
