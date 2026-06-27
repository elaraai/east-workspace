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
    ArrayType,
    VariantType,
    NullType,
    FunctionType,
} from "@elaraai/east";

import { SizeType } from "../../style.js";
import type { SizeLiteral } from "../../style.js";
import { ColorSchemeType } from "../../style.js";
import type { ColorSchemeLiteral } from "../../style.js";
import { InputVariantType } from "../input/types.js";
import type { InputVariantLiteral } from "../input/types.js";

// Re-export InputVariantType for convenience
export { InputVariantType, type InputVariantLiteral } from "../input/types.js";

// ============================================================================
// TagsInput Blur Behavior Type
// ============================================================================

/**
 * Blur behavior for TagsInput component.
 *
 * @remarks
 * Controls what happens when the input loses focus.
 *
 * @property clear - Clear the input on blur
 * @property add - Add the input text as a tag on blur
 */
export const TagsInputBlurBehaviorType = VariantType({
    clear: NullType,
    add: NullType,
});

/**
 * Type alias for the TagsInputBlurBehavior variant.
 */
export type TagsInputBlurBehaviorType = typeof TagsInputBlurBehaviorType;

/**
 * String literal type for blur behavior values.
 */
export type TagsInputBlurBehaviorLiteral = "clear" | "add";

// ============================================================================
// TagsInput Style
// ============================================================================

/**
 * East StructType holding visual fields for `TagsInput`.
 *
 * @remarks
 * Visual presets and explicit colour overrides — both for the
 * container and per-tag chip rendering.
 *
 * @property variant - Visual style variant (`outline` / `subtle` / `flushed`)
 * @property size - Input size (`xs` / `sm` / `md` / `lg`)
 * @property colorPalette - Chakra colour palette for the tag pills
 * @property color - Explicit text colour for the input
 * @property background - Explicit background colour for the container
 * @property borderColor - Explicit border colour for the container
 * @property tagBackground - Explicit per-tag fill colour
 * @property tagColor - Explicit per-tag text colour
 * @property tagBorderColor - Explicit per-tag border colour
 */
export const TagsInputStyleType = StructType({
    variant: OptionType(InputVariantType),
    size: OptionType(SizeType),
    colorPalette: OptionType(ColorSchemeType),
    color: OptionType(StringType),
    background: OptionType(StringType),
    borderColor: OptionType(StringType),
    tagBackground: OptionType(StringType),
    tagColor: OptionType(StringType),
    tagBorderColor: OptionType(StringType),
});

/**
 * Type alias for the TagsInput style struct.
 */
export type TagsInputStyleType = typeof TagsInputStyleType;

// ============================================================================
// TagsInput Type
// ============================================================================

/**
 * East StructType for `TagsInput` — multi-tag string input.
 *
 * @remarks
 * Content (`value` / `defaultValue` / `label` / `placeholder`) +
 * config (`max` / `maxLength` / `delimiter` / `addOnPaste` /
 * `blurBehavior` / `allowOverflow` / `editable`) + state (`disabled`
 * / `readOnly` / `invalid`) + behaviour (`onChange` /
 * `onInputChange` / `onHighlightChange`) on the main struct; visual
 * fields inside `style: OptionType(TagsInputStyleType)`.
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
 * @property blurBehavior - Action on blur (`clear` or `add`)
 * @property allowOverflow - Whether to allow exceeding `max`
 * @property label - Descriptive label
 * @property placeholder - Placeholder text for input
 * @property suggestions - Optional autocomplete suggestions surfaced as you type (free entry still allowed)
 * @property onChange - Callback fired when the tag list changes
 * @property onInputChange - Callback fired when the input text changes
 * @property onHighlightChange - Callback fired when the highlighted tag changes
 * @property style - Optional visual style sub-struct
 */
export const TagsInputRootType = StructType({
    value: ArrayType(StringType),
    defaultValue: OptionType(ArrayType(StringType)),
    suggestions: OptionType(ArrayType(StringType)),

    max: OptionType(IntegerType),
    maxLength: OptionType(IntegerType),

    disabled: OptionType(BooleanType),
    readOnly: OptionType(BooleanType),
    invalid: OptionType(BooleanType),

    editable: OptionType(BooleanType),
    delimiter: OptionType(StringType),
    addOnPaste: OptionType(BooleanType),
    blurBehavior: OptionType(TagsInputBlurBehaviorType),
    allowOverflow: OptionType(BooleanType),

    label: OptionType(StringType),
    placeholder: OptionType(StringType),

    onChange: OptionType(FunctionType([ArrayType(StringType)], NullType)),
    onInputChange: OptionType(FunctionType([StringType], NullType)),
    onHighlightChange: OptionType(FunctionType([OptionType(StringType)], NullType)),

    style: OptionType(TagsInputStyleType),
});

/**
 * Type alias for the TagsInputRoot struct.
 */
export type TagsInputRootType = typeof TagsInputRootType;

// ============================================================================
// TagsInput Style Interface
// ============================================================================

/**
 * TypeScript interface for `TagsInput` factory options.
 *
 * @property defaultValue - Initial tag values
 * @property max - Maximum number of tags allowed
 * @property maxLength - Maximum characters per tag
 * @property disabled - Whether the input is disabled
 * @property readOnly - Whether the input is read-only
 * @property invalid - Whether the input is in invalid state
 * @property editable - Whether existing tags can be edited
 * @property delimiter - Separator for parsing pasted text
 * @property addOnPaste - Whether to parse pasted text into tags
 * @property blurBehavior - Action on blur (`clear` or `add`)
 * @property allowOverflow - Whether to allow exceeding `max`
 * @property label - Descriptive label
 * @property placeholder - Placeholder text for input
 * @property size - Input size
 * @property variant - Visual style variant
 * @property colorPalette - Chakra colour palette for the tag pills
 * @property color - Explicit text colour
 * @property background - Explicit background colour
 * @property borderColor - Explicit border colour
 * @property tagBackground - Explicit per-tag fill colour
 * @property tagColor - Explicit per-tag text colour
 * @property tagBorderColor - Explicit per-tag border colour
 * @property onChange - Callback when the tag list changes
 * @property onInputChange - Callback when the input text changes
 * @property onHighlightChange - Callback when the highlighted tag changes
 */
export interface TagsInputStyle {
    /** Initial tag values. */
    defaultValue?: SubtypeExprOrValue<ArrayType<typeof StringType>> | string[];
    /** Autocomplete suggestions surfaced as you type (free entry still allowed). */
    suggestions?: SubtypeExprOrValue<ArrayType<typeof StringType>> | string[];
    /** Maximum number of tags allowed. */
    max?: SubtypeExprOrValue<IntegerType> | number;
    /** Maximum characters per tag. */
    maxLength?: SubtypeExprOrValue<IntegerType> | number;
    /** Whether the input is disabled. */
    disabled?: SubtypeExprOrValue<BooleanType>;
    /** Whether the input is read-only. */
    readOnly?: SubtypeExprOrValue<BooleanType>;
    /** Whether the input is in invalid state. */
    invalid?: SubtypeExprOrValue<BooleanType>;
    /** Whether existing tags can be edited. */
    editable?: SubtypeExprOrValue<BooleanType>;
    /** Separator for parsing pasted text. */
    delimiter?: SubtypeExprOrValue<StringType>;
    /** Whether to parse pasted text into tags. */
    addOnPaste?: SubtypeExprOrValue<BooleanType>;
    /** Action on blur (`clear` or `add`). */
    blurBehavior?: SubtypeExprOrValue<TagsInputBlurBehaviorType> | TagsInputBlurBehaviorLiteral;
    /** Whether to allow exceeding `max`. */
    allowOverflow?: SubtypeExprOrValue<BooleanType>;
    /** Descriptive label. */
    label?: SubtypeExprOrValue<StringType>;
    /** Placeholder text for input. */
    placeholder?: SubtypeExprOrValue<StringType>;
    /** Visual style variant (outline / subtle / flushed). */
    variant?: SubtypeExprOrValue<InputVariantType> | InputVariantLiteral;
    /** Input size. */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /** Chakra colour palette for the tag pills. */
    colorPalette?: SubtypeExprOrValue<ColorSchemeType> | ColorSchemeLiteral;
    /** Explicit text colour for the input. */
    color?: SubtypeExprOrValue<StringType>;
    /** Explicit background colour for the container. */
    background?: SubtypeExprOrValue<StringType>;
    /** Explicit border colour for the container. */
    borderColor?: SubtypeExprOrValue<StringType>;
    /** Explicit per-tag fill colour. */
    tagBackground?: SubtypeExprOrValue<StringType>;
    /** Explicit per-tag text colour. */
    tagColor?: SubtypeExprOrValue<StringType>;
    /** Explicit per-tag border colour. */
    tagBorderColor?: SubtypeExprOrValue<StringType>;
    /** Callback triggered when tags change. */
    onChange?: SubtypeExprOrValue<FunctionType<[ArrayType<typeof StringType>], NullType>>;
    /** Callback triggered when input text changes. */
    onInputChange?: SubtypeExprOrValue<FunctionType<[typeof StringType], NullType>>;
    /** Callback triggered when highlighted tag changes. */
    onHighlightChange?: SubtypeExprOrValue<FunctionType<[OptionType<typeof StringType>], NullType>>;
}
