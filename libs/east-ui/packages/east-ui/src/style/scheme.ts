/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, NullType, variant, VariantType, type ExprType } from "@elaraai/east";

// ============================================================================
// Size
// ============================================================================
//
// Note: a prior `TableVariantType(simple|striped|unstyled)` lived here and
// clashed with the canonical `TableVariantType(line|outline)` in
// `collections/table/types.ts`. The style.ts version was deleted; the
// canonical type is the one referenced by Table, Planner, and Gantt.

/**
 * Size variant type for controlling component sizing.
 *
 * @remarks
 * Create instances using the {@link Size} function.
 *
 * @property xs - Extra small size
 * @property sm - Small size with compact spacing
 * @property md - Medium size (default)
 * @property lg - Large size with generous spacing
 */
export const SizeType = VariantType({
    xs: NullType,
    sm: NullType,
    md: NullType,
    lg: NullType,
});

/**
 * Type representing size variant values.
 */
export type SizeType = typeof SizeType;

/**
 * String literal type for size values.
 */
export type SizeLiteral = "xs" | "sm" | "md" | "lg";

/**
 * Creates a size variant expression.
 *
 * @param size - The size value
 * @returns An East expression representing the size
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * Style.Size("md");
 * ```
 */
export function Size(size: "xs" | "sm" | "md" | "lg"): ExprType<SizeType> {
    return East.value(variant(size, null), SizeType);
}

// ============================================================================
// Color Scheme
// ============================================================================

/**
 * Color scheme variant type for Chakra UI theming.
 *
 * @remarks
 * Create instances using the {@link ColorScheme} function.
 *
 * Carries two kinds of tokens:
 * - **Hue tokens** (`gray`…`pink`) — raw Chakra hues. Prefer semantic tokens for
 *   state-meaning surfaces (Alert, DeltaPill, FreshnessChip, …); hue tokens
 *   remain valid for non-semantic decoration.
 * - **Semantic tokens** (`success`…`neutral`) — bind to meaning, not hue. The
 *   consumer's Chakra theme resolves `colorPalette="success"` etc. to the
 *   dichromacy-safe palette of the design system (see contract).
 *
 * @property brand - Semantic: the design system's primary (deep teal). The
 *                   default for non-semantic emphasis — prefer it over a hue
 *                   token, which resolves to a stock Chakra palette that is
 *                   not part of the East palette.
 * @property gray - Gray color scheme
 * @property red - Red color scheme
 * @property orange - Orange color scheme
 * @property yellow - Yellow color scheme
 * @property green - Green color scheme
 * @property teal - Teal color scheme
 * @property blue - Blue color scheme
 * @property cyan - Cyan color scheme
 * @property purple - Purple color scheme
 * @property pink - Pink color scheme
 * @property success - Semantic: "on-track / passed / ok"
 * @property warning - Semantic: "at-risk / needs attention"
 * @property danger - Semantic: "off-spec / failed / blocked"
 * @property info - Semantic: "informational / neutral callout"
 * @property neutral - Semantic: "idle / inactive / unknown"
 */
export const ColorSchemeType = VariantType({
    brand: NullType,
    gray: NullType,
    red: NullType,
    orange: NullType,
    yellow: NullType,
    green: NullType,
    teal: NullType,
    blue: NullType,
    cyan: NullType,
    purple: NullType,
    pink: NullType,
    success: NullType,
    warning: NullType,
    danger: NullType,
    info: NullType,
    neutral: NullType,
});

/**
 * Type representing color scheme variant values.
 */
export type ColorSchemeType = typeof ColorSchemeType;

/**
 * String literal type for color scheme values.
 */
export type ColorSchemeLiteral =
    | "brand"
    | "gray" | "red" | "orange" | "yellow" | "green"
    | "teal" | "blue" | "cyan" | "purple" | "pink"
    | "success" | "warning" | "danger" | "info" | "neutral";

/**
 * Creates a color scheme variant expression for Chakra UI theming.
 *
 * @param scheme - The color scheme name (hue or semantic token)
 * @returns An East expression representing the color scheme
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * // Hue token — raw visual choice
 * Style.ColorScheme("blue");
 *
 * // Semantic token — bound to meaning; theme owns the value
 * Style.ColorScheme("success");
 * ```
 */
export function ColorScheme(scheme: ColorSchemeLiteral): ExprType<ColorSchemeType> {
    return East.value(variant(scheme, null), ColorSchemeType);
}

// ============================================================================
// Badge Variants (Style Variant)
// ============================================================================

/**
 * Badge variant type for different badge styles.
 *
 * @remarks
 * Create instances using the {@link StyleVariant} function.
 *
 * @property subtle - Subtle background with colored text
 * @property solid - Solid colored background with contrast text
 * @property outline - Transparent background with colored border
 */
export const StyleVariantType = VariantType({
    subtle: NullType,
    solid: NullType,
    outline: NullType,
    brand: NullType,
    ok: NullType,
    warn: NullType,
    danger: NullType,
    dashed: NullType,
    plain: NullType,
    count: NullType,
    callout: NullType,
});

/**
 * Type representing badge variant values.
 */
export type StyleVariantType = typeof StyleVariantType;

/**
 * String literal type for style variant values.
 */
export type StyleVariantLiteral =
    | "subtle"
    | "solid"
    | "outline"
    | "brand"
    | "ok"
    | "warn"
    | "danger"
    | "dashed"
    | "plain"
    | "count"
    | "callout";

/**
 * Creates a badge variant expression.
 *
 * @param variant_ - The badge variant style
 * @returns An East expression representing the badge variant
 *
 * @example
 * ```ts
 * import { variant } from "@elaraai/east-ui";
 *
 * const subtle = variant("subtle", null);
 * ```
 */
export function StyleVariant(variant_: StyleVariantLiteral): ExprType<StyleVariantType> {
    return East.value(variant(variant_, null), StyleVariantType);
}
