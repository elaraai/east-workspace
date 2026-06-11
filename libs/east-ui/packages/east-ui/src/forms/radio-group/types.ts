/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    ArrayType,
    OptionType,
    StructType,
    StringType,
    BooleanType,
    NullType,
    FunctionType,
} from "@elaraai/east";

import { SizeType, ColorSchemeType } from "../../style.js";
import type { SizeLiteral, ColorSchemeLiteral } from "../../style.js";

// ============================================================================
// RadioGroup Item
// ============================================================================

/**
 * East StructType for an individual radio item inside a `RadioGroup`.
 *
 * @remarks
 * Each item carries a `value` (the canonical key written back to
 * `onChange` when selected) and an optional rich `label` (defaults to
 * `value` when absent). `disabled` opts a single item out of selection
 * without affecting the rest of the group.
 *
 * @property value - Canonical value written to `onChange` on selection
 * @property label - Optional label text (defaults to `value` when absent)
 * @property disabled - Optional per-item disabled flag
 */
export const RadioItemType = StructType({
    value: StringType,
    label: OptionType(StringType),
    disabled: OptionType(BooleanType),
});

export type RadioItemType = typeof RadioItemType;

/**
 * TypeScript shape for a single radio item passed to the factory.
 *
 * @property value - Canonical value written to `onChange` on selection
 * @property label - Optional display label (defaults to `value` when absent)
 * @property disabled - Optional per-item disabled flag
 */
export interface RadioItemInput {
    /** Canonical value emitted on selection. */
    value: SubtypeExprOrValue<StringType>;
    /** Optional display label (defaults to `value`). */
    label?: SubtypeExprOrValue<StringType>;
    /** Optional per-item disabled flag. */
    disabled?: SubtypeExprOrValue<BooleanType>;
}

// ============================================================================
// RadioGroup Orientation
// ============================================================================

import { VariantType } from "@elaraai/east";

/**
 * Orientation variant for `RadioGroup` layout.
 *
 * @property horizontal - Items laid out in a row
 * @property vertical - Items laid out in a column (default)
 */
export const RadioGroupOrientationType = VariantType({
    horizontal: NullType,
    vertical: NullType,
});

export type RadioGroupOrientationType = typeof RadioGroupOrientationType;
export type RadioGroupOrientationLiteral = "horizontal" | "vertical";

// ============================================================================
// RadioGroup Style
// ============================================================================

/**
 * East StructType for visual style on a `RadioGroup`.
 *
 * @remarks
 * Visual-only fields live here — colour palette, size, orientation,
 * and explicit colour overrides. Selection state and the `onChange`
 * callback are on the main struct.
 *
 * @property colorPalette - Chakra colour palette for the radio fill
 * @property size - Radio size (`sm` / `md` / `lg`)
 * @property orientation - Layout orientation (`horizontal` / `vertical`)
 * @property color - Explicit text colour for item labels
 * @property fillColor - Explicit fill colour for the selected radio
 * @property borderColor - Explicit border colour for unselected radios
 */
export const RadioGroupStyleType = StructType({
    colorPalette: OptionType(ColorSchemeType),
    size: OptionType(SizeType),
    orientation: OptionType(RadioGroupOrientationType),
    color: OptionType(StringType),
    fillColor: OptionType(StringType),
    borderColor: OptionType(StringType),
});

export type RadioGroupStyleType = typeof RadioGroupStyleType;

/**
 * TypeScript interface for `RadioGroup` style options.
 *
 * @property colorPalette - Chakra colour palette for the radio fill
 * @property size - Radio size (`sm` / `md` / `lg`)
 * @property orientation - Layout orientation (`horizontal` / `vertical`)
 * @property color - Explicit text colour override for item labels
 * @property fillColor - Explicit fill colour override for the selected radio
 * @property borderColor - Explicit border colour override for unselected radios
 */
export interface RadioGroupStyle {
    /** Currently selected item value (empty string when none) — required. */
    value: SubtypeExprOrValue<StringType>;
    /**
     * Array of items — required. Either a plain array of `{ value, label?,
     * disabled? }` inputs, or an East expression of `ArrayType(RadioItemType)`
     * (e.g. a `.map(...)` over bound data, with each element built via
     * `East.value({...}, RadioGroup.Types.Item)`).
     */
    items: RadioItemInput[] | ExprType<ArrayType<RadioItemType>>;
    /** Optional form-control name (groups radios in the same form). */
    name?: SubtypeExprOrValue<StringType>;
    /** Whether the entire group is disabled. */
    disabled?: SubtypeExprOrValue<BooleanType>;
    /** Whether a selection is required for form submission. */
    required?: SubtypeExprOrValue<BooleanType>;
    /** Callback fired with the new selected value. */
    onChange?: SubtypeExprOrValue<FunctionType<[StringType], NullType>>;
    /** Chakra colour palette for the radio fill. */
    colorPalette?: SubtypeExprOrValue<ColorSchemeType> | ColorSchemeLiteral;
    /** Radio size (`sm` / `md` / `lg`). */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /** Layout orientation. */
    orientation?: SubtypeExprOrValue<RadioGroupOrientationType> | RadioGroupOrientationLiteral;
    /** Explicit text colour override for item labels. */
    color?: SubtypeExprOrValue<StringType>;
    /** Explicit fill colour override for the selected radio. */
    fillColor?: SubtypeExprOrValue<StringType>;
    /** Explicit border colour override for unselected radios. */
    borderColor?: SubtypeExprOrValue<StringType>;
}

// ============================================================================
// RadioGroup Root
// ============================================================================

/**
 * East StructType for a `RadioGroup` — single-select radio list.
 *
 * @remarks
 * `value` is the currently-selected item's `value` (empty string when
 * nothing is selected). `items` is the radio set. `onChange` is fired
 * with the newly-selected item's `value` whenever the user picks a
 * different option. Visual concerns live on `style`.
 *
 * @property value - Currently selected item value (empty string when nothing selected)
 * @property items - Array of {@link RadioItemType} items
 * @property name - Optional radio-group name (used for keyboard / form submission)
 * @property disabled - Optional group-wide disabled flag
 * @property required - Optional `required` form-attribute
 * @property onChange - Callback fired with the newly-selected `value`
 * @property style - Optional visual style sub-struct
 */
export const RadioGroupType = StructType({
    value: StringType,
    items: ArrayType(RadioItemType),
    name: OptionType(StringType),
    disabled: OptionType(BooleanType),
    required: OptionType(BooleanType),
    onChange: OptionType(FunctionType([StringType], NullType)),
    style: OptionType(RadioGroupStyleType),
});

export type RadioGroupType = typeof RadioGroupType;
