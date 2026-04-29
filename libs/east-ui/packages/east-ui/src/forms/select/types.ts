/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    OptionType,
    StructType,
    StringType,
    BooleanType,
    ArrayType,
    NullType,
    FunctionType,
} from "@elaraai/east";

import { SizeType } from "../../style.js";
import type { SizeLiteral } from "../../style.js";

// ============================================================================
// Select Item Type
// ============================================================================

/**
 * East StructType for a Select item.
 *
 * @property value - The value submitted when this item is selected
 * @property label - The display text shown to the user
 * @property disabled - Whether this item is disabled
 */
export const SelectItemType = StructType({
    value: StringType,
    label: StringType,
    disabled: OptionType(BooleanType),
});

export type SelectItemType = typeof SelectItemType;

/**
 * TypeScript interface for Select item style options.
 *
 * @property disabled - Whether this item is disabled
 */
export interface SelectItemStyle {
    /** Whether this item is disabled */
    disabled?: SubtypeExprOrValue<BooleanType>;
}

// ============================================================================
// Select Style
// ============================================================================

/**
 * East StructType holding visual fields for `Select`.
 *
 * @property size - Control size (`xs` / `sm` / `md` / `lg`)
 * @property color - Explicit text colour for the trigger
 * @property background - Explicit background colour for the trigger
 * @property borderColor - Explicit border colour for the trigger
 */
export const SelectStyleType = StructType({
    size: OptionType(SizeType),
    color: OptionType(StringType),
    background: OptionType(StringType),
    borderColor: OptionType(StringType),
});

/**
 * Type alias for the Select style struct.
 */
export type SelectStyleType = typeof SelectStyleType;

// ============================================================================
// Select Root Type
// ============================================================================

/**
 * East StructType for `Select` — dropdown selection control.
 *
 * @remarks
 * Content (`value` / `items` / `placeholder`), config (`multiple`),
 * state (`disabled`), and behaviour (callbacks) live on main; visual
 * presets and colour overrides live in `style: OptionType(SelectStyleType)`.
 *
 * @property value - Currently selected value (none if nothing selected)
 * @property items - Array of selectable items
 * @property placeholder - Placeholder text when nothing is selected
 * @property multiple - Whether multiple selection is allowed
 * @property disabled - Whether the select is disabled
 * @property onChange - Callback fired when selection changes (single-select)
 * @property onChangeMultiple - Callback fired when selection changes (multi-select)
 * @property onOpenChange - Callback fired when dropdown opens/closes
 * @property style - Optional visual style sub-struct
 */
export const SelectRootType = StructType({
    value: OptionType(StringType),
    items: ArrayType(SelectItemType),
    placeholder: OptionType(StringType),
    multiple: OptionType(BooleanType),
    disabled: OptionType(BooleanType),
    onChange: OptionType(FunctionType([StringType], NullType)),
    onChangeMultiple: OptionType(FunctionType([ArrayType(StringType)], NullType)),
    onOpenChange: OptionType(FunctionType([BooleanType], NullType)),
    style: OptionType(SelectStyleType),
});

export type SelectRootType = typeof SelectRootType;

/**
 * TypeScript interface for `Select` factory options.
 *
 * @property placeholder - Placeholder text when nothing is selected
 * @property multiple - Whether multiple selection is allowed
 * @property disabled - Whether the select is disabled
 * @property size - Size of the select control
 * @property color - Explicit text colour
 * @property background - Explicit background colour
 * @property borderColor - Explicit border colour
 * @property onChange - Callback fired when selection changes (single-select)
 * @property onChangeMultiple - Callback fired when selection changes (multi-select)
 * @property onOpenChange - Callback fired when dropdown opens/closes
 */
export interface SelectStyle {
    /** Placeholder text when nothing is selected */
    placeholder?: SubtypeExprOrValue<StringType>;
    /** Whether multiple selection is allowed */
    multiple?: SubtypeExprOrValue<BooleanType>;
    /** Whether the select is disabled */
    disabled?: SubtypeExprOrValue<BooleanType>;
    /** Size of the select control (xs, sm, md, lg) */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /** Explicit text colour for the trigger. */
    color?: SubtypeExprOrValue<StringType>;
    /** Explicit background colour for the trigger. */
    background?: SubtypeExprOrValue<StringType>;
    /** Explicit border colour for the trigger. */
    borderColor?: SubtypeExprOrValue<StringType>;
    /** Callback fired when selection changes (single select) */
    onChange?: SubtypeExprOrValue<FunctionType<[StringType], NullType>>;
    /** Callback fired when selection changes (multi-select) */
    onChangeMultiple?: SubtypeExprOrValue<FunctionType<[ArrayType<StringType>], NullType>>;
    /** Callback fired when dropdown opens/closes */
    onOpenChange?: SubtypeExprOrValue<FunctionType<[BooleanType], NullType>>;
}
