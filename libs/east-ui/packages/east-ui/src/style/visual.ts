/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, NullType, variant, VariantType, type ExprType } from "@elaraai/east";

// ============================================================================
// Border Width
// ============================================================================

/**
 * Border width variant type for controlling border thickness.
 *
 * @remarks
 * Create instances using the {@link BorderWidth} function.
 *
 * @property none - No border (0px)
 * @property thin - Thin border (1px)
 * @property medium - Medium border (2px)
 * @property thick - Thick border (4px)
 */
export const BorderWidthType = VariantType({
    none: NullType,
    thin: NullType,
    medium: NullType,
    thick: NullType,
});

/**
 * Type representing border width variant values.
 */
export type BorderWidthType = typeof BorderWidthType;

/**
 * String literal type for border width values.
 */
export type BorderWidthLiteral = "none" | "thin" | "medium" | "thick";

/**
 * Creates a border width variant expression.
 *
 * @param width - The border width value
 * @returns An East expression representing the border width
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * Style.BorderWidth("thin");
 * ```
 */
export function BorderWidth(width: "none" | "thin" | "medium" | "thick"): ExprType<BorderWidthType> {
    return East.value(variant(width, null), BorderWidthType);
}

// ============================================================================
// Border Style
// ============================================================================

/**
 * Border style variant type for controlling border appearance.
 *
 * @remarks
 * Create instances using the {@link BorderStyle} function.
 *
 * @property solid - Solid continuous line
 * @property dashed - Dashed line
 * @property dotted - Dotted line
 * @property double - Double line
 * @property none - No border
 */
export const BorderStyleType = VariantType({
    solid: NullType,
    dashed: NullType,
    dotted: NullType,
    double: NullType,
    none: NullType,
});

/**
 * Type representing border style variant values.
 */
export type BorderStyleType = typeof BorderStyleType;

/**
 * String literal type for border style values.
 */
export type BorderStyleLiteral = "solid" | "dashed" | "dotted" | "double" | "none";

/**
 * Creates a border style variant expression.
 *
 * @param style - The border style value
 * @returns An East expression representing the border style
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * Style.BorderStyle("solid");
 * ```
 */
export function BorderStyle(style: "solid" | "dashed" | "dotted" | "double" | "none"): ExprType<BorderStyleType> {
    return East.value(variant(style, null), BorderStyleType);
}

// ============================================================================
// Radius
// ============================================================================

/**
 * Radius variant type for Chakra border-radius tokens.
 *
 * @remarks
 * Create instances using the {@link Radius} function. Components accepting a
 * radius token accept either this variant *or* a raw string escape-hatch via
 * their `borderRadius` prop.
 *
 * @property none - Sharp corners (0)
 * @property xs - Extra-small radius
 * @property sm - Small radius
 * @property md - Medium radius
 * @property lg - Large radius
 * @property full - Fully rounded (pill / circle)
 */
export const RadiusType = VariantType({
    none: NullType,
    xs: NullType,
    sm: NullType,
    md: NullType,
    lg: NullType,
    full: NullType,
});

/**
 * Type representing radius variant values.
 */
export type RadiusType = typeof RadiusType;

/**
 * String literal type for radius values.
 */
export type RadiusLiteral = "none" | "xs" | "sm" | "md" | "lg" | "full";

/**
 * Creates a radius variant expression.
 *
 * @param radius - The radius token
 * @returns An East expression representing the radius
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * Style.Radius("full");
 * ```
 */
export function Radius(radius: RadiusLiteral): ExprType<RadiusType> {
    return East.value(variant(radius, null), RadiusType);
}

// ============================================================================
// Box Shadow
// ============================================================================

/**
 * Box shadow variant type for Chakra shadow-token selection.
 *
 * @remarks
 * Create instances using the {@link BoxShadow} function. Prefer the
 * higher-level {@link ElevationType} for card / overlay / modal surfaces;
 * `BoxShadowType` is the low-level token when pixel control is needed.
 *
 * @property none - No shadow
 * @property xs - Extra-small shadow
 * @property sm - Small shadow
 * @property md - Medium shadow
 * @property lg - Large shadow
 * @property xl - Extra-large shadow
 */
export const BoxShadowType = VariantType({
    none: NullType,
    xs: NullType,
    sm: NullType,
    md: NullType,
    lg: NullType,
    xl: NullType,
});

/**
 * Type representing box shadow variant values.
 */
export type BoxShadowType = typeof BoxShadowType;

/**
 * String literal type for box shadow values.
 */
export type BoxShadowLiteral = "none" | "xs" | "sm" | "md" | "lg" | "xl";

/**
 * Creates a box shadow variant expression.
 *
 * @param shadow - The shadow token
 * @returns An East expression representing the box shadow
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * Style.BoxShadow("md");
 * ```
 */
export function BoxShadow(shadow: BoxShadowLiteral): ExprType<BoxShadowType> {
    return East.value(variant(shadow, null), BoxShadowType);
}

// ============================================================================
// Z-Index Token
// ============================================================================

/**
 * Z-index token variant type for named stacking layers.
 *
 * @remarks
 * Create instances using the {@link ZIndexToken} function. Exposed as an
 * escape hatch — prefer {@link ElevationType} when the intent is "this is an
 * overlay / modal / popover" rather than "this is at z-index 1400".
 *
 * @property base - Content plane
 * @property dropdown - Menus, select listboxes
 * @property sticky - Sticky headers, subnavs
 * @property banner - Region-top banners
 * @property overlay - Backdrop / dim layer
 * @property modal - Dialogs
 * @property popover - Popovers, hover-cards
 * @property toast - Toast notifications
 * @property tooltip - Tooltips (topmost)
 */
export const ZIndexTokenType = VariantType({
    base: NullType,
    dropdown: NullType,
    sticky: NullType,
    banner: NullType,
    overlay: NullType,
    modal: NullType,
    popover: NullType,
    toast: NullType,
    tooltip: NullType,
});

/**
 * Type representing z-index token values.
 */
export type ZIndexTokenType = typeof ZIndexTokenType;

/**
 * String literal type for z-index token values.
 */
export type ZIndexTokenLiteral =
    | "base" | "dropdown" | "sticky" | "banner" | "overlay"
    | "modal" | "popover" | "toast" | "tooltip";

/**
 * Creates a z-index token variant expression.
 *
 * @param token - The z-index token
 * @returns An East expression representing the z-index token
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * Style.ZIndexToken("sticky");
 * ```
 */
export function ZIndexToken(token: ZIndexTokenLiteral): ExprType<ZIndexTokenType> {
    return East.value(variant(token, null), ZIndexTokenType);
}

// ============================================================================
// Elevation (semantic)
// ============================================================================

/**
 * Elevation variant type for the surface-stacking semantic.
 *
 * @remarks
 * Create instances using the {@link Elevation} function. Resolves in the
 * consumer's theme to a `{ boxShadow, zIndex, background }` triple.
 * `Card.elevation`, `Popover`, `Dialog`, `Drawer` reference this token.
 *
 * @property flat - No shadow, no lift
 * @property raised - Card-on-page
 * @property overlay - Floating overlay (popover, menu)
 * @property floating - Pinned floating (toolbars)
 * @property modal - Top-most (dialogs / drawers)
 */
export const ElevationType = VariantType({
    flat: NullType,
    raised: NullType,
    overlay: NullType,
    floating: NullType,
    modal: NullType,
});

/**
 * Type representing elevation variant values.
 */
export type ElevationType = typeof ElevationType;

/**
 * String literal type for elevation values.
 */
export type ElevationLiteral = "flat" | "raised" | "overlay" | "floating" | "modal";

/**
 * Creates an elevation variant expression.
 *
 * @param elevation - The elevation token
 * @returns An East expression representing the elevation
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * Style.Elevation("overlay");
 * ```
 */
export function Elevation(elevation: ElevationLiteral): ExprType<ElevationType> {
    return East.value(variant(elevation, null), ElevationType);
}
