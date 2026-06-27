/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    OptionType,
    StructType,
    VariantType,
    BooleanType,
    StringType,
    FunctionType,
    NullType,
} from "@elaraai/east";

import { SizeType, ColorSchemeType } from "../../style.js";
import type { SizeLiteral, ColorSchemeLiteral } from "../../style.js";

// ============================================================================
// IconButton attention animation
// ============================================================================

/**
 * Attention animation drawing the eye to an IconButton.
 *
 * @property none - No animation (default)
 * @property pulse - Pulses the badge (the count blinks for attention)
 * @property ring - An expanding "ping" ring around the button
 */
export const IconButtonAttentionType = VariantType({
    none: NullType,
    pulse: NullType,
    ring: NullType,
});

/** Type representing the IconButton attention-animation variant. */
export type IconButtonAttentionType = typeof IconButtonAttentionType;

/** String-literal shorthands for {@link IconButtonAttentionType}. */
export type IconButtonAttentionLiteral = "none" | "pulse" | "ring";
import { ButtonVariantType, type ButtonVariantLiteral } from "../button/types.js";
import { IconType } from "../../display/icon/types.js";
import type { IconPayload } from "../button/types.js";
import type { IconName, IconPrefix } from "@fortawesome/fontawesome-common-types";

// Re-export ButtonVariantType for convenience
export { ButtonVariantType, type ButtonVariantLiteral } from "../button/types.js";

// ============================================================================
// IconButton Style Type
// ============================================================================

/**
 * Visual-only style struct for IconButton. Content / state / behaviour live
 * on the main `IconButtonType` struct per the repo-wide Type-shape
 * convention.
 *
 * @remarks
 * Anything visual goes here: the Chakra preset triplet (`variant`,
 * `colorPalette`, `size`) plus per-instance colour escape hatches that
 * override the theme.
 *
 * @property variant - Button appearance variant (solid / subtle / outline / ghost / plain)
 * @property colorPalette - Colour scheme token (blue / red / green / teal / ...)
 * @property size - Size token (xs / sm / md / lg)
 * @property color - Icon tint — overrides palette-derived icon colour
 * @property background - Button background — overrides palette-derived fill
 * @property borderColor - Border tint — overrides palette-derived border
 * @property hoverBackground - Background applied on hover (`_hover={{ bg: ... }}`)
 */
export const IconButtonStyleType = StructType({
    variant: OptionType(ButtonVariantType),
    colorPalette: OptionType(ColorSchemeType),
    size: OptionType(SizeType),
    color: OptionType(StringType),
    background: OptionType(StringType),
    borderColor: OptionType(StringType),
    hoverBackground: OptionType(StringType),
});

/**
 * Type representing the IconButton visual-style structure.
 */
export type IconButtonStyleType = typeof IconButtonStyleType;

/**
 * TypeScript options bag for IconButton's `style` sub-struct — visual props only.
 *
 * @remarks
 * State (`loading` / `disabled`) and behaviour (`onClick`) live on the main
 * options object passed to `IconButton.Root`, not here.
 *
 * @property variant - Button appearance variant
 * @property colorPalette - Colour scheme for theming
 * @property size - Size of the button
 * @property color - Icon tint escape hatch
 * @property background - Background colour escape hatch
 * @property borderColor - Border colour escape hatch
 * @property hoverBackground - Hover-state background colour
 */
export interface IconButtonStyle {
    /** Button appearance variant (solid, subtle, outline, ghost, plain) */
    variant?: SubtypeExprOrValue<ButtonVariantType> | ButtonVariantLiteral;
    /** Color scheme for theming */
    colorPalette?: SubtypeExprOrValue<ColorSchemeType> | ColorSchemeLiteral;
    /** Size of the button */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /** Icon tint — overrides palette-derived default */
    color?: SubtypeExprOrValue<StringType>;
    /** Button background — overrides palette-derived default */
    background?: SubtypeExprOrValue<StringType>;
    /** Border colour — overrides palette-derived default */
    borderColor?: SubtypeExprOrValue<StringType>;
    /** Background applied on hover */
    hoverBackground?: SubtypeExprOrValue<StringType>;
}

// ============================================================================
// IconButton Type — label REQUIRED (aria-label)
// ============================================================================

/**
 * The concrete East type for IconButton component data.
 *
 * @remarks
 * `label` is REQUIRED — the renderer emits it verbatim as the button's
 * `aria-label`. Omitting it at the factory layer is a TypeScript compile
 * error (the positional `label` argument enforces this).
 *
 * @property prefix - Font Awesome prefix (`fas` / `far` / `fab`)
 * @property name - Font Awesome icon name (`xmark` / `bars` / `save` / ...)
 * @property label - Required aria-label for screen readers
 * @property loadingIcon - Icon swapped in when `loading` is true (e.g. a spinner)
 * @property loading - Loading state — renderer shows a spinner and blocks interaction
 * @property disabled - Disabled state — renderer greys out and blocks interaction
 * @property onClick - Click-handler callback (zero-arg East function)
 * @property badge - Optional superscript badge text/count (`""` ⇒ dot-only); absent ⇒ no badge
 * @property badgeColorPalette - Colour scheme for the badge bubble (default `red`)
 * @property attention - Optional attention animation (`none` / `pulse` / `ring`)
 * @property style - Optional visual-presentation sub-struct
 */
export const IconButtonType = StructType({
    prefix: StringType,
    name: StringType,
    /** REQUIRED — used verbatim as the button's `aria-label` at render time. */
    label: StringType,
    loadingIcon: OptionType(IconType),
    loading: OptionType(BooleanType),
    disabled: OptionType(BooleanType),
    onClick: OptionType(FunctionType([], NullType)),
    badge: OptionType(StringType),
    badgeColorPalette: OptionType(ColorSchemeType),
    attention: OptionType(IconButtonAttentionType),
    style: OptionType(IconButtonStyleType),
});

/**
 * Type representing the IconButton component structure.
 */
export type IconButtonType = typeof IconButtonType;

/**
 * TypeScript options bag for `IconButton.Root`.
 *
 * @remarks
 * A single flat bag. `prefix` / `name` (the icon identity) and `label` (the
 * a11y label) are required; content (`loadingIcon`), state (`loading`,
 * `disabled`), behaviour (`onClick`) and the visual fields (from
 * {@link IconButtonStyle}) all sit flat. The factory composes the visual fields
 * into the nested IR `style` struct internally.
 *
 * @property prefix - Font Awesome icon prefix (`"fas"`, `"far"`, …) — required
 * @property name - Font Awesome icon name — required
 * @property label - Accessible label (aria-label) — required
 * @property loadingIcon - Icon shown in place of the main icon when `loading` is true
 * @property loading - Loading state
 * @property disabled - Disabled state
 * @property onClick - Click-handler callback
 */
export interface IconButtonOptions extends IconButtonStyle {
    /** Font Awesome icon prefix (`"fas"`, `"far"`, …) — required. */
    prefix: IconPrefix;
    /** Font Awesome icon name — required. */
    name: IconName;
    /** Accessible label (aria-label) — required. */
    label: string;
    /** Icon swapped in when `loading` is true (e.g. a spinner) */
    loadingIcon?: IconPayload | SubtypeExprOrValue<IconType>;
    /** Loading state — renderer shows a spinner and blocks interaction */
    loading?: SubtypeExprOrValue<BooleanType>;
    /** Disabled state — renderer greys out and blocks interaction */
    disabled?: SubtypeExprOrValue<BooleanType>;
    /** Click-handler callback (zero-arg East function) */
    onClick?: SubtypeExprOrValue<FunctionType<[], NullType>>;
    /** Superscript badge text/count (a number, `"99+"`, or `""` for a dot-only indicator); absent ⇒ no badge. */
    badge?: SubtypeExprOrValue<StringType>;
    /** Colour scheme for the badge bubble. Default `"red"`. */
    badgeColorPalette?: SubtypeExprOrValue<ColorSchemeType> | ColorSchemeLiteral;
    /** Attention animation — `"pulse"` blinks the badge, `"ring"` rings the button. */
    attention?: SubtypeExprOrValue<IconButtonAttentionType> | IconButtonAttentionLiteral;
}
