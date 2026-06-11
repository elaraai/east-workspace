/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    ArrayType,
    OptionType,
    StructType,
    StringType,
    BooleanType,
    NullType,
    FunctionType,
    VariantType,
} from "@elaraai/east";

import { SizeType, ColorSchemeType } from "../../style.js";
import type { SizeLiteral, ColorSchemeLiteral } from "../../style.js";

// ============================================================================
// RadioCardGroup Item
// ============================================================================

/**
 * East StructType for an individual card inside a `RadioCardGroup`.
 *
 * @remarks
 * Each card carries a `value` (canonical key emitted on selection), a
 * required `label`, and optional `description` for the secondary line.
 *
 * @property value - Canonical value emitted on selection
 * @property label - Primary label text
 * @property description - Optional secondary description text
 * @property disabled - Optional per-item disabled flag
 */
export const RadioCardItemType = StructType({
    value: StringType,
    label: StringType,
    description: OptionType(StringType),
    disabled: OptionType(BooleanType),
});

export type RadioCardItemType = typeof RadioCardItemType;

/**
 * TypeScript shape for a card item passed to the factory.
 *
 * @property value - Canonical value emitted on selection
 * @property label - Primary label text
 * @property description - Optional secondary description text
 * @property disabled - Optional per-item disabled flag
 */
export interface RadioCardItemInput {
    /** Canonical value emitted on selection. */
    value: SubtypeExprOrValue<StringType>;
    /** Primary label. */
    label: SubtypeExprOrValue<StringType>;
    /** Optional secondary description. */
    description?: SubtypeExprOrValue<StringType>;
    /** Optional per-item disabled flag. */
    disabled?: SubtypeExprOrValue<BooleanType>;
}

// ============================================================================
// RadioCardGroup Orientation
// ============================================================================

/**
 * Orientation variant for `RadioCardGroup` layout.
 *
 * @property horizontal - Cards laid out in a row
 * @property vertical - Cards laid out in a column (default)
 */
export const RadioCardGroupOrientationType = VariantType({
    horizontal: NullType,
    vertical: NullType,
});

export type RadioCardGroupOrientationType = typeof RadioCardGroupOrientationType;
export type RadioCardGroupOrientationLiteral = "horizontal" | "vertical";

// ============================================================================
// RadioCardGroup Style
// ============================================================================

/**
 * East StructType for visual style on a `RadioCardGroup`.
 *
 * @property colorPalette - Chakra colour palette for selected card border / fill
 * @property size - Card size (`sm` / `md` / `lg`)
 * @property orientation - Layout orientation (`horizontal` / `vertical`)
 * @property color - Explicit text colour for primary labels
 * @property descriptionColor - Explicit colour for the description line
 * @property cardBackground - Explicit background for unselected cards
 * @property selectedCardBackground - Explicit background for selected cards
 * @property selectedBorderColor - Explicit border colour for selected cards
 */
export const RadioCardGroupStyleType = StructType({
    colorPalette: OptionType(ColorSchemeType),
    size: OptionType(SizeType),
    orientation: OptionType(RadioCardGroupOrientationType),
    color: OptionType(StringType),
    descriptionColor: OptionType(StringType),
    cardBackground: OptionType(StringType),
    selectedCardBackground: OptionType(StringType),
    selectedBorderColor: OptionType(StringType),
});

export type RadioCardGroupStyleType = typeof RadioCardGroupStyleType;

/**
 * TypeScript interface for `RadioCardGroup` style options.
 *
 * @property colorPalette - Chakra colour palette for selected card border / fill
 * @property size - Card size (`sm` / `md` / `lg`)
 * @property orientation - Layout orientation (`horizontal` / `vertical`)
 * @property color - Explicit text colour override for primary labels
 * @property descriptionColor - Explicit colour for the description line
 * @property cardBackground - Explicit background for unselected cards
 * @property selectedCardBackground - Explicit background for selected cards
 * @property selectedBorderColor - Explicit border colour for selected cards
 */
export interface RadioCardGroupStyle {
    /** Currently selected card value (empty string when none) — required. */
    value: SubtypeExprOrValue<StringType>;
    /** Array of card entries `{ value, label, description?, disabled? }` — required. */
    items: RadioCardItemInput[];
    /** Optional form-control name (groups radios in the same form). */
    name?: SubtypeExprOrValue<StringType>;
    /** Whether the entire group is disabled. */
    disabled?: SubtypeExprOrValue<BooleanType>;
    /** Whether a selection is required for form submission. */
    required?: SubtypeExprOrValue<BooleanType>;
    /** Callback fired with the new selected value. */
    onChange?: SubtypeExprOrValue<FunctionType<[StringType], NullType>>;
    /** Chakra colour palette for selected card border / fill. */
    colorPalette?: SubtypeExprOrValue<ColorSchemeType> | ColorSchemeLiteral;
    /** Card size (`sm` / `md` / `lg`). */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /** Layout orientation. */
    orientation?: SubtypeExprOrValue<RadioCardGroupOrientationType> | RadioCardGroupOrientationLiteral;
    /** Explicit text colour for primary labels. */
    color?: SubtypeExprOrValue<StringType>;
    /** Explicit colour for the description line. */
    descriptionColor?: SubtypeExprOrValue<StringType>;
    /** Explicit background for unselected cards. */
    cardBackground?: SubtypeExprOrValue<StringType>;
    /** Explicit background for selected cards. */
    selectedCardBackground?: SubtypeExprOrValue<StringType>;
    /** Explicit border colour for selected cards. */
    selectedBorderColor?: SubtypeExprOrValue<StringType>;
}

// ============================================================================
// RadioCardGroup Root
// ============================================================================

/**
 * East StructType for a `RadioCardGroup` — single-select card list.
 *
 * @remarks
 * Card-styled radio variant with required label + optional description
 * per card. Otherwise behaves like {@link RadioGroup}: `value` is the
 * selected card's value, `onChange` fires with the new value.
 *
 * @property value - Currently selected card value (empty string when nothing selected)
 * @property items - Array of {@link RadioCardItemType} cards
 * @property name - Optional radio-group name (form-submission)
 * @property disabled - Optional group-wide disabled flag
 * @property required - Optional `required` form-attribute
 * @property onChange - Callback fired with the newly-selected `value`
 * @property style - Optional visual style sub-struct
 */
export const RadioCardGroupType = StructType({
    value: StringType,
    items: ArrayType(RadioCardItemType),
    name: OptionType(StringType),
    disabled: OptionType(BooleanType),
    required: OptionType(BooleanType),
    onChange: OptionType(FunctionType([StringType], NullType)),
    style: OptionType(RadioCardGroupStyleType),
});

export type RadioCardGroupType = typeof RadioCardGroupType;
