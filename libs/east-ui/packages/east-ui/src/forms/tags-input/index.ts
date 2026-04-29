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
    ArrayType,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { SizeType, ColorSchemeType } from "../../style.js";
import {
    TagsInputRootType,
    TagsInputStyleType,
    TagsInputBlurBehaviorType,
    InputVariantType,
    type TagsInputStyle,
} from "./types.js";

// Re-export types
export {
    TagsInputRootType,
    TagsInputStyleType,
    TagsInputBlurBehaviorType,
    InputVariantType,
    type TagsInputStyle,
    type TagsInputBlurBehaviorLiteral,
    type InputVariantLiteral,
} from "./types.js";

// ============================================================================
// TagsInput Factory
// ============================================================================

/**
 * Creates a TagsInput component.
 *
 * @param value - Array of current tag values
 * @param style - Optional style + behaviour configuration
 * @returns An East expression representing the TagsInput component
 *
 * @remarks
 * Multi-tag input control. Visual props (`variant` / `size` /
 * `colorPalette` / colour overrides) are routed into the IR's
 * `style` sub-struct.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { TagsInput, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return TagsInput.Root(["React", "TypeScript"], {
 *         placeholder: "Add tag...",
 *         max: 5,
 *         colorPalette: "blue",
 *     });
 * });
 * ```
 */
export function createTagsInput_(
    value: SubtypeExprOrValue<ArrayType<typeof StringType>>,
    style?: TagsInputStyle,
): ExprType<TagsInputRootType> {
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

    const colorPaletteValue = style?.colorPalette
        ? (typeof style.colorPalette === "string"
            ? East.value(variant(style.colorPalette, null), ColorSchemeType)
            : style.colorPalette)
        : undefined;

    const blurBehaviorValue = style?.blurBehavior
        ? (typeof style.blurBehavior === "string"
            ? East.value(variant(style.blurBehavior, null), TagsInputBlurBehaviorType)
            : style.blurBehavior)
        : undefined;

    const maxValue = style?.max !== undefined
        ? (typeof style.max === "number" ? BigInt(style.max) : style.max)
        : undefined;
    const maxLengthValue = style?.maxLength !== undefined
        ? (typeof style.maxLength === "number" ? BigInt(style.maxLength) : style.maxLength)
        : undefined;

    const hasStyle = !!style && (
        variantValue !== undefined ||
        sizeValue !== undefined ||
        colorPaletteValue !== undefined ||
        style.color !== undefined ||
        style.background !== undefined ||
        style.borderColor !== undefined ||
        style.tagBackground !== undefined ||
        style.tagColor !== undefined ||
        style.tagBorderColor !== undefined
    );

    const styleValue = hasStyle ? East.value({
        variant: variantValue ? some(variantValue) : none,
        size: sizeValue ? some(sizeValue) : none,
        colorPalette: colorPaletteValue ? some(colorPaletteValue) : none,
        color: style!.color !== undefined ? some(style!.color) : none,
        background: style!.background !== undefined ? some(style!.background) : none,
        borderColor: style!.borderColor !== undefined ? some(style!.borderColor) : none,
        tagBackground: style!.tagBackground !== undefined ? some(style!.tagBackground) : none,
        tagColor: style!.tagColor !== undefined ? some(style!.tagColor) : none,
        tagBorderColor: style!.tagBorderColor !== undefined ? some(style!.tagBorderColor) : none,
    }, TagsInputStyleType) : undefined;

    return East.value({
        value,
        defaultValue: style?.defaultValue !== undefined ? some(style.defaultValue) : none,
        max: maxValue !== undefined ? some(maxValue) : none,
        maxLength: maxLengthValue !== undefined ? some(maxLengthValue) : none,
        disabled: style?.disabled !== undefined ? some(style.disabled) : none,
        readOnly: style?.readOnly !== undefined ? some(style.readOnly) : none,
        invalid: style?.invalid !== undefined ? some(style.invalid) : none,
        editable: style?.editable !== undefined ? some(style.editable) : none,
        delimiter: style?.delimiter !== undefined ? some(style.delimiter) : none,
        addOnPaste: style?.addOnPaste !== undefined ? some(style.addOnPaste) : none,
        blurBehavior: blurBehaviorValue ? some(blurBehaviorValue) : none,
        allowOverflow: style?.allowOverflow !== undefined ? some(style.allowOverflow) : none,
        label: style?.label !== undefined ? some(style.label) : none,
        placeholder: style?.placeholder !== undefined ? some(style.placeholder) : none,
        onChange: style?.onChange !== undefined ? some(style.onChange) : none,
        onInputChange: style?.onInputChange !== undefined ? some(style.onInputChange) : none,
        onHighlightChange: style?.onHighlightChange !== undefined ? some(style.onHighlightChange) : none,
        style: styleValue ? some(styleValue) : none,
    }, TagsInputRootType);
}

function createTagsInput(
    value: SubtypeExprOrValue<ArrayType<typeof StringType>>,
    style?: TagsInputStyle,
): ExprType<UIComponentType> {
    return East.value(variant("TagsInput", createTagsInput_(value, style)), UIComponentType);
}

// ============================================================================
// TagsInput Namespace Export
// ============================================================================

interface TagsInputNamespace {
    Root: typeof createTagsInput;
    Types: {
        Root: typeof TagsInputRootType;
        Style: typeof TagsInputStyleType;
        BlurBehavior: typeof TagsInputBlurBehaviorType;
    };
}

/**
 * `TagsInput` namespace — multi-tag string input.
 *
 * @remarks
 * Use `TagsInput.Root(value, options?)` to construct. Access IR types
 * via `TagsInput.Types.Root` and `TagsInput.Types.Style`.
 */
export const TagsInput: TagsInputNamespace = {
    /**
     * Creates a TagsInput component. See {@link createTagsInput_} for
     * the factory signature.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { TagsInput, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return TagsInput.Root(["React", "TypeScript"], {
     *         placeholder: "Add tag...",
     *         max: 5,
     *     });
     * });
     * ```
     */
    Root: createTagsInput,
    Types: {
        /**
         * East StructType for the `TagsInput` value.
         *
         * @property value - Array of current tag values
         * @property defaultValue - Initial tag values
         * @property max - Maximum number of tags allowed
         * @property maxLength - Maximum characters per tag
         * @property disabled - Whether the input is disabled
         * @property readOnly - Whether the input is read-only
         * @property invalid - Whether the input is in invalid state
         * @property editable - Whether existing tags can be edited
         * @property delimiter - Separator for parsing pasted text
         * @property addOnPaste - Whether to parse pasted text into tags
         * @property blurBehavior - Action on blur
         * @property allowOverflow - Whether to allow exceeding `max`
         * @property label - Descriptive label
         * @property placeholder - Placeholder text for input
         * @property onChange - Callback fired when tags change
         * @property onInputChange - Callback fired when input text changes
         * @property onHighlightChange - Callback fired when the highlighted tag changes
         * @property style - Optional visual style sub-struct
         */
        Root: TagsInputRootType,
        /**
         * East StructType holding visual fields for `TagsInput`.
         *
         * @property variant - Visual style variant (`outline` / `subtle` / `flushed`)
         * @property size - Input size
         * @property colorPalette - Chakra colour palette for the tag pills
         * @property color - Explicit text colour for the input
         * @property background - Explicit background colour for the container
         * @property borderColor - Explicit border colour for the container
         * @property tagBackground - Explicit per-tag fill colour
         * @property tagColor - Explicit per-tag text colour
         * @property tagBorderColor - Explicit per-tag border colour
         */
        Style: TagsInputStyleType,
        /**
         * Blur-behaviour variant for `TagsInput`.
         *
         * @property add - Add current input as tag on blur
         * @property clear - Clear current input on blur
         */
        BlurBehavior: TagsInputBlurBehaviorType,
    },
};
