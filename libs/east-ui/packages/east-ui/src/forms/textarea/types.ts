/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    OptionType,
    StructType,
    StringType,
    IntegerType,
    BooleanType,
    VariantType,
    NullType,
    FunctionType,
} from "@elaraai/east";

import { SizeType } from "../../style.js";
import type { SizeLiteral } from "../../style.js";
import { InputVariantType } from "../input/types.js";
import type { InputVariantLiteral } from "../input/types.js";

// Re-export InputVariantType for convenience
export { InputVariantType, type InputVariantLiteral } from "../input/types.js";

// ============================================================================
// Textarea Resize Type
// ============================================================================

/**
 * Resize behavior for Textarea component.
 *
 * @remarks
 * Controls how the textarea can be resized by the user.
 *
 * @property none - Cannot be resized
 * @property vertical - Can only be resized vertically
 * @property horizontal - Can only be resized horizontally
 * @property both - Can be resized in both directions
 */
export const TextareaResizeType = VariantType({
    none: NullType,
    vertical: NullType,
    horizontal: NullType,
    both: NullType,
});

/**
 * Type alias for the TextareaResize variant.
 */
export type TextareaResizeType = typeof TextareaResizeType;

/**
 * String literal type for resize values.
 */
export type TextareaResizeLiteral = "none" | "vertical" | "horizontal" | "both";

// ============================================================================
// Textarea Style
// ============================================================================

/**
 * East StructType holding visual fields for `Textarea`.
 *
 * @remarks
 * Visual presets (`variant` / `size`) and the resize handle setting
 * live here, alongside explicit colour overrides for branded
 * surfaces. State (`disabled` / `readOnly` / `required` / `invalid`)
 * and content (`value` / `placeholder` / `rows` / `maxLength` /
 * `autoresize`) live on the main struct.
 *
 * @property variant - Visual style variant (`outline` / `subtle` / `flushed`)
 * @property size - Textarea size (`xs` / `sm` / `md` / `lg`)
 * @property resize - Resize-handle behaviour (`none` / `vertical` / `horizontal` / `both`)
 * @property color - Explicit text colour
 * @property background - Explicit background colour
 * @property borderColor - Explicit border colour
 * @property focusBorderColor - Explicit border colour while focused
 */
export const TextareaStyleType = StructType({
    variant: OptionType(InputVariantType),
    size: OptionType(SizeType),
    resize: OptionType(TextareaResizeType),
    color: OptionType(StringType),
    background: OptionType(StringType),
    borderColor: OptionType(StringType),
    focusBorderColor: OptionType(StringType),
});

/**
 * Type alias for the Textarea style struct.
 */
export type TextareaStyleType = typeof TextareaStyleType;

/**
 * TypeScript interface for `Textarea` style options.
 *
 * @property placeholder - Placeholder text when empty
 * @property rows - Number of visible text rows
 * @property maxLength - Maximum number of characters
 * @property autoresize - Whether to auto-resize based on content
 * @property disabled - Whether the textarea is disabled
 * @property readOnly - Whether the textarea is read-only
 * @property required - Whether the textarea is required
 * @property invalid - Whether the textarea is in an invalid state
 * @property onChange - Callback fired when value changes
 * @property onBlur - Callback fired when textarea loses focus
 * @property onFocus - Callback fired when textarea gains focus
 * @property onValidate - Callback fired for validation
 * @property variant - Visual style variant
 * @property size - Textarea size
 * @property resize - Resize-handle behaviour
 * @property color - Explicit text colour
 * @property background - Explicit background colour
 * @property borderColor - Explicit border colour
 * @property focusBorderColor - Explicit border colour while focused
 */
export interface TextareaStyle {
    /** Placeholder text when empty. */
    placeholder?: SubtypeExprOrValue<StringType>;
    /** Number of visible text rows. */
    rows?: SubtypeExprOrValue<IntegerType> | number;
    /** Maximum number of characters. */
    maxLength?: SubtypeExprOrValue<IntegerType> | number;
    /** Whether to auto-resize based on content. */
    autoresize?: SubtypeExprOrValue<BooleanType>;
    /** Whether the textarea is disabled. */
    disabled?: SubtypeExprOrValue<BooleanType>;
    /** Whether the textarea is read-only. */
    readOnly?: SubtypeExprOrValue<BooleanType>;
    /** Whether the textarea is required. */
    required?: SubtypeExprOrValue<BooleanType>;
    /** Whether the textarea is in an invalid state. */
    invalid?: SubtypeExprOrValue<BooleanType>;
    /** Callback fired when value changes. */
    onChange?: SubtypeExprOrValue<FunctionType<[StringType], NullType>>;
    /** Callback fired when textarea loses focus. */
    onBlur?: SubtypeExprOrValue<FunctionType<[], NullType>>;
    /** Callback fired when textarea gains focus. */
    onFocus?: SubtypeExprOrValue<FunctionType<[], NullType>>;
    /** Callback fired for validation. */
    onValidate?: SubtypeExprOrValue<FunctionType<[StringType], NullType>>;
    /** Visual style variant (outline, subtle, flushed). */
    variant?: SubtypeExprOrValue<InputVariantType> | InputVariantLiteral;
    /** Textarea size (xs, sm, md, lg). */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /** Resize-handle behaviour. */
    resize?: SubtypeExprOrValue<TextareaResizeType> | TextareaResizeLiteral;
    /** Explicit text colour. */
    color?: SubtypeExprOrValue<StringType>;
    /** Explicit background colour. */
    background?: SubtypeExprOrValue<StringType>;
    /** Explicit border colour. */
    borderColor?: SubtypeExprOrValue<StringType>;
    /** Explicit border colour while focused. */
    focusBorderColor?: SubtypeExprOrValue<StringType>;
}

// ============================================================================
// Textarea Type
// ============================================================================

/**
 * East StructType for `Textarea` — multi-line text input.
 *
 * @remarks
 * Content (`value` / `placeholder`), config (`rows` / `maxLength` /
 * `autoresize`), state (`disabled` / `readOnly` / `required` /
 * `invalid`), and behaviour (`onChange` / `onBlur` / `onFocus` /
 * `onValidate`) live on main; visual fields live inside
 * `style: OptionType(TextareaStyleType)`.
 *
 * @property value - Current text value
 * @property placeholder - Placeholder text when empty
 * @property rows - Number of visible text rows
 * @property maxLength - Maximum number of characters
 * @property autoresize - Whether to auto-resize based on content
 * @property disabled - Whether the textarea is disabled
 * @property readOnly - Whether the textarea is read-only
 * @property required - Whether the textarea is required
 * @property invalid - Whether the textarea is in an invalid state
 * @property onChange - Callback fired when value changes
 * @property onBlur - Callback fired when textarea loses focus
 * @property onFocus - Callback fired when textarea gains focus
 * @property onValidate - Callback fired for validation
 * @property style - Optional visual style sub-struct
 */
export const TextareaType = StructType({
    value: StringType,
    placeholder: OptionType(StringType),
    rows: OptionType(IntegerType),
    maxLength: OptionType(IntegerType),
    autoresize: OptionType(BooleanType),
    disabled: OptionType(BooleanType),
    readOnly: OptionType(BooleanType),
    required: OptionType(BooleanType),
    invalid: OptionType(BooleanType),
    onChange: OptionType(FunctionType([StringType], NullType)),
    onBlur: OptionType(FunctionType([], NullType)),
    onFocus: OptionType(FunctionType([], NullType)),
    onValidate: OptionType(FunctionType([StringType], NullType)),
    style: OptionType(TextareaStyleType),
});

/**
 * Type alias for the Textarea struct.
 */
export type TextareaType = typeof TextareaType;
