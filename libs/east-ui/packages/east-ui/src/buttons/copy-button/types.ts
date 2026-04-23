/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    VariantType,
    OptionType,
    StructType,
    StringType,
    BooleanType,
    NullType,
} from "@elaraai/east";

import { SizeType, ColorSchemeType } from "../../style.js";
import type { SizeLiteral, ColorSchemeLiteral } from "../../style.js";

// ============================================================================
// CopyButton Variant Type
// ============================================================================

/**
 * Variant type for CopyButton appearance styles.
 *
 * @remarks
 * Create instances using string literals like "solid", "outline", etc.
 *
 * @property solid - Solid filled button (default)
 * @property subtle - Subtle/light background button
 * @property outline - Outlined button with border
 * @property ghost - Transparent button, visible on hover
 */
export const CopyButtonVariantType = VariantType({
    solid: NullType,
    subtle: NullType,
    outline: NullType,
    ghost: NullType,
});

/**
 * Type representing copy-button variant values.
 */
export type CopyButtonVariantType = typeof CopyButtonVariantType;

/**
 * String literal union of valid copy-button variant tags.
 */
export type CopyButtonVariantLiteral = "solid" | "subtle" | "outline" | "ghost";

// ============================================================================
// CopyButton Style Type — visual presentation only (§0.10)
// ============================================================================

/**
 * Visual-only style struct for CopyButton. Content + state + config (notably
 * `timeout` for the "Copied!" animation) live on the main `CopyButtonType`
 * struct per the Type-shape convention (§0.10).
 *
 * @remarks
 * Holds the Chakra preset triplet (`variant`, `colorPalette`, `size`) plus
 * colour escape hatches and the `successColor` applied to the "Copied!"
 * checkmark indicator.
 *
 * @property variant - Copy-button appearance variant
 * @property colorPalette - Colour scheme token
 * @property size - Size token (xs / sm / md / lg)
 * @property color - Label/icon tint — overrides palette-derived colour
 * @property background - Button background — overrides palette-derived fill
 * @property borderColor - Border tint — overrides palette-derived border
 * @property hoverBackground - Background applied on hover
 * @property successColor - Tint applied to the "Copied!" confirmation glyph
 */
export const CopyButtonStyleType = StructType({
    variant: OptionType(CopyButtonVariantType),
    colorPalette: OptionType(ColorSchemeType),
    size: OptionType(SizeType),
    color: OptionType(StringType),
    background: OptionType(StringType),
    borderColor: OptionType(StringType),
    hoverBackground: OptionType(StringType),
    successColor: OptionType(StringType),
});

/**
 * Type representing the CopyButton visual-style structure.
 */
export type CopyButtonStyleType = typeof CopyButtonStyleType;

/**
 * TypeScript options bag for CopyButton's `style` sub-struct — visual props only.
 *
 * @remarks
 * State (`disabled`) and config (`timeout`) live on the main options object
 * passed to `CopyButton.Root`, not here.
 *
 * @property variant - CopyButton appearance variant
 * @property colorPalette - Colour scheme for theming
 * @property size - Size of the button
 * @property color - Label/icon tint escape hatch
 * @property background - Background colour escape hatch
 * @property borderColor - Border colour escape hatch
 * @property hoverBackground - Hover-state background colour
 * @property successColor - Tint for the "Copied!" confirmation glyph
 */
export interface CopyButtonStyle {
    /** Button appearance variant (solid, subtle, outline, ghost) */
    variant?: SubtypeExprOrValue<CopyButtonVariantType> | CopyButtonVariantLiteral;
    /** Color scheme for theming */
    colorPalette?: SubtypeExprOrValue<ColorSchemeType> | ColorSchemeLiteral;
    /** Size of the button */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /** Label/icon tint escape hatch */
    color?: SubtypeExprOrValue<StringType>;
    /** Button background escape hatch */
    background?: SubtypeExprOrValue<StringType>;
    /** Border colour escape hatch */
    borderColor?: SubtypeExprOrValue<StringType>;
    /** Background applied on hover */
    hoverBackground?: SubtypeExprOrValue<StringType>;
    /** Tint applied to the "Copied!" confirmation glyph */
    successColor?: SubtypeExprOrValue<StringType>;
}

// ============================================================================
// CopyButton Type — main struct (content + config + state + behaviour)
// ============================================================================

/**
 * The concrete East type for CopyButton component data.
 *
 * @remarks
 * `value` is the string copied to the clipboard. `label` is the optional
 * button label (when absent the renderer emits an icon-only copy button).
 * `timeout` controls how long the "Copied!" state is shown (milliseconds,
 * stringified so it flows through the IR's string-shape convention). All
 * visual fields live in `style`.
 *
 * @property value - The text value to copy to clipboard (required)
 * @property label - Optional label text rendered next to the copy icon
 * @property timeout - Duration in ms that the "Copied!" state persists (default: "2000")
 * @property disabled - Disabled state — renderer blocks interaction
 * @property style - Optional visual-presentation sub-struct
 */
export const CopyButtonType = StructType({
    value: StringType,
    label: OptionType(StringType),
    timeout: OptionType(StringType),
    disabled: OptionType(BooleanType),
    style: OptionType(CopyButtonStyleType),
});

/**
 * Type representing the CopyButton component structure.
 */
export type CopyButtonType = typeof CopyButtonType;

/**
 * TypeScript options bag for `CopyButton.Root`.
 *
 * @remarks
 * Content (`label`), config (`timeout`), and state (`disabled`) live at the
 * top level. Visual presentation lives inside the nested `style` object.
 *
 * @property label - Optional label text rendered next to the copy icon
 * @property timeout - Duration in ms for the "Copied!" state (stringified)
 * @property disabled - Disabled state
 * @property style - Visual-presentation sub-struct
 */
export interface CopyButtonOptions {
    /** Optional label text rendered next to the copy icon */
    label?: SubtypeExprOrValue<StringType>;
    /** Duration in ms for the "Copied!" state (e.g. `"2000"`) */
    timeout?: SubtypeExprOrValue<StringType>;
    /** Disabled state — renderer blocks interaction */
    disabled?: SubtypeExprOrValue<BooleanType>;
    /** Visual-presentation sub-struct (presets + colour escape hatches) */
    style?: CopyButtonStyle;
}
