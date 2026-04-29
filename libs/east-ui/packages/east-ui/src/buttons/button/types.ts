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
    NullType,
} from "@elaraai/east";

import { SizeType, ColorSchemeType } from "../../style.js";
import type { SizeLiteral, ColorSchemeLiteral } from "../../style.js";
import { IconType } from "../../display/icon/types.js";

// ============================================================================
// Button Variant Type
// ============================================================================

/**
 * Variant type for Button appearance styles.
 *
 * @remarks
 * Create instances using string literals like "solid", "outline", etc.
 *
 * @property solid - Solid filled button (default primary action)
 * @property subtle - Subtle/light background button
 * @property outline - Outlined button with border
 * @property ghost - Transparent button, visible on hover
 * @property plain - Unadorned pressable text — no background, no border
 */
export const ButtonVariantType = VariantType({
    solid: NullType,
    subtle: NullType,
    outline: NullType,
    ghost: NullType,
    plain: NullType,
});

/**
 * Type representing button variant values.
 */
export type ButtonVariantType = typeof ButtonVariantType;

/**
 * String literal union of valid button variant tags.
 */
export type ButtonVariantLiteral = "solid" | "subtle" | "outline" | "ghost" | "plain";

// ============================================================================
// Button Style Type
// ============================================================================

/**
 * Visual-only style struct for Button. Content, state, and behaviour live on
 * the main `ButtonType` struct — NOT in this sub-struct — per the repo-wide
 * Type-shape convention.
 *
 * @remarks
 * Anything visual goes here: the Chakra preset triplet (`variant`,
 * `colorPalette`, `size`) plus per-instance colour escape hatches that
 * override the theme.
 *
 * @property variant - Button appearance variant (solid / subtle / outline / ghost / plain)
 * @property colorPalette - Colour scheme token (blue / red / green / teal / ...)
 * @property size - Size token (xs / sm / md / lg)
 * @property color - Label + icon tint — overrides palette-derived text colour
 * @property background - Button background — overrides palette-derived fill
 * @property borderColor - Border tint — overrides palette-derived border
 * @property hoverBackground - Background applied on hover (`_hover={{ bg: ... }}`)
 */
export const ButtonStyleType = StructType({
    variant: OptionType(ButtonVariantType),
    colorPalette: OptionType(ColorSchemeType),
    size: OptionType(SizeType),
    color: OptionType(StringType),
    background: OptionType(StringType),
    borderColor: OptionType(StringType),
    hoverBackground: OptionType(StringType),
});

/**
 * Type representing the Button visual-style structure.
 */
export type ButtonStyleType = typeof ButtonStyleType;

/**
 * TypeScript options bag for Button's `style` sub-struct — visual props only.
 *
 * @remarks
 * State (`loading` / `disabled`) and behaviour (`onClick`) live on the main
 * options object passed to `Button.Root`, not here.
 *
 * @property variant - Button appearance variant
 * @property colorPalette - Colour scheme for theming
 * @property size - Size of the button
 * @property color - Label + icon tint escape hatch
 * @property background - Background colour escape hatch
 * @property borderColor - Border colour escape hatch
 * @property hoverBackground - Hover-state background colour
 */
export interface ButtonStyle {
    /** Button appearance variant (solid, subtle, outline, ghost, plain) */
    variant?: SubtypeExprOrValue<ButtonVariantType> | ButtonVariantLiteral;
    /** Color scheme for theming */
    colorPalette?: SubtypeExprOrValue<ColorSchemeType> | ColorSchemeLiteral;
    /** Size of the button */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /** Label + icon tint — overrides palette-derived default */
    color?: SubtypeExprOrValue<StringType>;
    /** Button background — overrides palette-derived default */
    background?: SubtypeExprOrValue<StringType>;
    /** Border colour — overrides palette-derived default */
    borderColor?: SubtypeExprOrValue<StringType>;
    /** Background applied on hover */
    hoverBackground?: SubtypeExprOrValue<StringType>;
}

// ============================================================================
// IconPayload — shorthand for factory icon slots
// ============================================================================

/**
 * Minimal icon input accepted by button icon slots (`startIcon`, `endIcon`,
 * `loadingIcon`).
 *
 * @remarks
 * The factory wraps this into a full `IconType` value with an empty inner
 * style, so callers only need to supply the Font Awesome `prefix` + `name`.
 * Callers that want to tint / resize the icon independently can pass a
 * pre-built `Icon.Root(...)` expression instead — the factory accepts either
 * shape.
 *
 * @property prefix - Font Awesome prefix (`fas` / `far` / `fab`)
 * @property name - Font Awesome icon name (`save` / `spinner` / `arrow-right` / ...)
 */
export interface IconPayload {
    prefix: string;
    name: string;
}

// ============================================================================
// Re-export IconType — used as the IR-level slot type for icon fields
// ============================================================================

export { IconType };
