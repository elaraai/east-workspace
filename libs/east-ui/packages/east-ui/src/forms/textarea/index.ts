/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    variant,
    some,
    none,
    StringType,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { SizeType } from "../../style.js";
import {
    TextareaType,
    TextareaStyleType,
    TextareaResizeType,
    InputVariantType,
    type TextareaStyle,
} from "./types.js";

// Re-export types
export {
    TextareaType,
    TextareaStyleType,
    TextareaResizeType,
    InputVariantType,
    type TextareaStyle,
    type TextareaResizeLiteral,
    type InputVariantLiteral,
} from "./types.js";

// ============================================================================
// Textarea Factory
// ============================================================================

/**
 * Builds the inner `TextareaType` struct value (without the
 * UIComponent variant wrapper). Shared between the public `Root`
 * factory and the Field-control wrapper.
 *
 * @internal
 */
export function createTextarea_(
    value: SubtypeExprOrValue<typeof StringType>,
    style?: TextareaStyle,
): ExprType<TextareaType> {
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

    const resizeValue = style?.resize
        ? (typeof style.resize === "string"
            ? East.value(variant(style.resize, null), TextareaResizeType)
            : style.resize)
        : undefined;

    const rowsValue = style?.rows !== undefined
        ? (typeof style.rows === "number" ? BigInt(style.rows) : style.rows)
        : undefined;
    const maxLengthValue = style?.maxLength !== undefined
        ? (typeof style.maxLength === "number" ? BigInt(style.maxLength) : style.maxLength)
        : undefined;

    const hasStyle = !!style && (
        variantValue !== undefined ||
        sizeValue !== undefined ||
        resizeValue !== undefined ||
        style.color !== undefined ||
        style.background !== undefined ||
        style.borderColor !== undefined ||
        style.focusBorderColor !== undefined
    );

    const styleValue = hasStyle ? East.value({
        variant: variantValue ? some(variantValue) : none,
        size: sizeValue ? some(sizeValue) : none,
        resize: resizeValue ? some(resizeValue) : none,
        color: style!.color !== undefined ? some(style!.color) : none,
        background: style!.background !== undefined ? some(style!.background) : none,
        borderColor: style!.borderColor !== undefined ? some(style!.borderColor) : none,
        focusBorderColor: style!.focusBorderColor !== undefined ? some(style!.focusBorderColor) : none,
    }, TextareaStyleType) : undefined;

    return East.value({
        value,
        placeholder: style?.placeholder !== undefined ? some(style.placeholder) : none,
        rows: rowsValue !== undefined ? some(rowsValue) : none,
        maxLength: maxLengthValue !== undefined ? some(maxLengthValue) : none,
        autoresize: style?.autoresize !== undefined ? some(style.autoresize) : none,
        disabled: style?.disabled !== undefined ? some(style.disabled) : none,
        readOnly: style?.readOnly !== undefined ? some(style.readOnly) : none,
        required: style?.required !== undefined ? some(style.required) : none,
        invalid: style?.invalid !== undefined ? some(style.invalid) : none,
        onChange: style?.onChange !== undefined ? some(style.onChange) : none,
        onBlur: style?.onBlur !== undefined ? some(style.onBlur) : none,
        onFocus: style?.onFocus !== undefined ? some(style.onFocus) : none,
        onValidate: style?.onValidate !== undefined ? some(style.onValidate) : none,
        style: styleValue ? some(styleValue) : none,
    }, TextareaType);
}

/**
 * Creates a Textarea component.
 *
 * @param value - The current text value
 * @param style - Optional style + behaviour configuration
 * @returns An East expression representing the Textarea component
 *
 * @remarks
 * Multi-line text input. The factory accepts a flat options bag for
 * ergonomics; visual props (`variant` / `size` / `resize` / colour
 * overrides) are routed into the IR's `style` sub-struct.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Textarea, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Textarea.Root("", {
 *         placeholder: "Enter description...",
 *         rows: 4,
 *         maxLength: 500,
 *     });
 * });
 * ```
 */
function createTextarea(
    value: SubtypeExprOrValue<typeof StringType>,
    style?: TextareaStyle,
): ExprType<UIComponentType> {
    return East.value(variant("Textarea", createTextarea_(value, style)), UIComponentType);
}


// ============================================================================
// Textarea Namespace Export
// ============================================================================

interface TextareaNamespace {
    Root: typeof createTextarea;
    Types: {
        Textarea: typeof TextareaType;
        Style: typeof TextareaStyleType;
        Resize: typeof TextareaResizeType;
    };
}

/**
 * `Textarea` namespace — multi-line text input.
 *
 * @remarks
 * Use `Textarea.Root(value, options?)` to construct. Access IR types
 * via `Textarea.Types.Textarea` and `Textarea.Types.Style`.
 */
export const Textarea: TextareaNamespace = {
    /**
     * Creates a Textarea component. See {@link createTextarea} for
     * the factory signature.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Textarea, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return Textarea.Root("Hello world", {
     *         placeholder: "Enter description",
     *         rows: 4,
     *     });
     * });
     * ```
     */
    Root: createTextarea,
    Types: {
        /**
         * East StructType for `Textarea` — multi-line text input.
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
        Textarea: TextareaType,
        /**
         * East StructType holding visual fields for `Textarea`.
         *
         * @property variant - Visual style variant (`outline` / `subtle` / `flushed`)
         * @property size - Textarea size (`xs` / `sm` / `md` / `lg`)
         * @property resize - Resize-handle behaviour (`none` / `vertical` / `horizontal` / `both`)
         * @property color - Explicit text colour
         * @property background - Explicit background colour
         * @property borderColor - Explicit border colour
         * @property focusBorderColor - Explicit border colour while focused
         */
        Style: TextareaStyleType,
        /**
         * Resize behaviour variant for `Textarea`.
         *
         * @property none - No resizing allowed
         * @property vertical - Only vertical resizing
         * @property horizontal - Only horizontal resizing
         * @property both - Both directions allowed
         */
        Resize: TextareaResizeType,
    },
};
