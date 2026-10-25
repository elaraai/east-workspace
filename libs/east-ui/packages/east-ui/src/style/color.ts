/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, NullType, variant, VariantType, type ExprType } from "@elaraai/east";

// ============================================================================
// Color Token — a theme hue, and its shade (#1406)
// ============================================================================

/**
 * Color shade variant type — the steps of a theme palette, `50` to `900`.
 *
 * @remarks
 * One case per step of the design system's scales (`brand`, `gray`) and of
 * the stock Chakra palettes the theme carries for the other hues. A shade is
 * never used alone: it is the payload of a {@link ColorTokenType} hue case.
 *
 * @property 50 - The lightest step
 * @property 100 - A tint
 * @property 200 - A tint
 * @property 300 - A tint
 * @property 400 - The last step whose ink is the foreground
 * @property 500 - The hue's solid
 * @property 600 - A shade
 * @property 700 - A shade
 * @property 800 - A shade
 * @property 900 - The darkest step
 */
export const ColorShadeType = VariantType({
    "50": NullType,
    "100": NullType,
    "200": NullType,
    "300": NullType,
    "400": NullType,
    "500": NullType,
    "600": NullType,
    "700": NullType,
    "800": NullType,
    "900": NullType,
});

/**
 * Type representing color shade variant values.
 */
export type ColorShadeType = typeof ColorShadeType;

/**
 * String literal type for color shade values.
 */
export type ColorShadeLiteral = "50" | "100" | "200" | "300" | "400" | "500" | "600" | "700" | "800" | "900";

/**
 * Color token variant type — a theme hue holding its shade: the one typed
 * colour every component that takes a colour for a data fill takes.
 *
 * @remarks
 * Create instances using the {@link ColorToken} function. The hues are
 * {@link ColorSchemeType}'s hue cases — the theme's palettes: `brand` and
 * `gray` the design system's scales, the rest Chakra's stock — and the shade
 * is a {@link ColorShadeType}, so `variant("red", variant("100", null))` is
 * `Style.ColorToken("red", "100")`. A renderer resolves a token as
 * `{colors.<hue>.<shade>}`, the same in both colour modes, and draws the
 * words on it in the ink the shade takes (the foreground up to `400`, the
 * paper's from `500`). It is a colour the APP gives — a shift's, a series' —
 * never a state: a state's colour is a {@link StatusTokenType}.
 *
 * @property brand - The design system's primary scale
 * @property gray - The design system's gray scale
 * @property red - Red palette
 * @property orange - Orange palette
 * @property yellow - Yellow palette
 * @property green - Green palette
 * @property teal - Teal palette
 * @property blue - Blue palette
 * @property cyan - Cyan palette
 * @property purple - Purple palette
 * @property pink - Pink palette
 */
export const ColorTokenType = VariantType({
    brand: ColorShadeType,
    gray: ColorShadeType,
    red: ColorShadeType,
    orange: ColorShadeType,
    yellow: ColorShadeType,
    green: ColorShadeType,
    teal: ColorShadeType,
    blue: ColorShadeType,
    cyan: ColorShadeType,
    purple: ColorShadeType,
    pink: ColorShadeType,
});

/**
 * Type representing color token variant values.
 */
export type ColorTokenType = typeof ColorTokenType;

/**
 * String literal type for a color token's hue.
 */
export type ColorHueLiteral = "brand" | "gray" | "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "cyan" | "purple" | "pink";

/**
 * The hues of a color token, in the theme's order.
 */
export const COLOR_HUES: readonly ColorHueLiteral[] = ["brand", "gray", "red", "orange", "yellow", "green", "teal", "blue", "cyan", "purple", "pink"];

/**
 * The shades of a color token, lightest first.
 */
export const COLOR_SHADES: readonly ColorShadeLiteral[] = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900"];

/**
 * Creates a color token expression: a theme hue at a shade.
 *
 * @param hue - The theme hue
 * @param shade - The palette step, `"50"` to `"900"`
 * @returns An East expression representing the color token
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * Style.ColorToken("teal", "500");   // variant("teal", variant("500", null))
 * ```
 */
export function ColorToken(hue: ColorHueLiteral, shade: ColorShadeLiteral): ExprType<ColorTokenType> {
    return East.value(variant(hue, variant(shade, null)), ColorTokenType);
}
