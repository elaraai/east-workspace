/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Pure lookup — `TextStyleLiteral` → Chakra `textStyle` prop value.
 *
 * The actual typographic resolution (fontFamily, fontSize, fontWeight, …)
 * lives in the consumer's Chakra theme under `theme.textStyles`. This module
 * only maps token names to Chakra textStyle keys.
 *
 * Enforcement:
 *   - Token set: IR (`east-ui/src/style/typography.ts`)
 *   - Values: consumer Chakra theme (see `docs/THEME-CONTRACT.md`)
 */

export type TextStyleToken =
    | "display-lg" | "display-md" | "display-sm"
    | "heading-lg" | "heading-md" | "heading-sm" | "heading-xs"
    | "body-lg" | "body-md" | "body-sm"
    | "label-md" | "label-sm"
    | "caption" | "overline"
    | "code-sm" | "code-md"
    | "mono-kpi";

/**
 * The ordered list of every `TextStyleType` token.
 *
 * @remarks
 * Consumed by showcase / theme-coverage tooling to iterate every text style.
 */
export const TEXT_STYLE_ORDER: readonly TextStyleToken[] = [
    "display-lg", "display-md", "display-sm",
    "heading-lg", "heading-md", "heading-sm", "heading-xs",
    "body-lg", "body-md", "body-sm",
    "label-md", "label-sm",
    "caption", "overline",
    "code-sm", "code-md",
    "mono-kpi",
] as const;

/**
 * Resolve a `TextStyleType` token to a Chakra `textStyle` prop value.
 *
 * @remarks
 * Identity map today — Chakra v3 accepts dot-path tokens (e.g.
 * `textStyle="mono-kpi"`) and resolves them against `theme.textStyles` at
 * render time. Kept as a function (not a raw identity) so we can add
 * aliasing / deprecation fallbacks without churning every renderer.
 *
 * @param token - A `TextStyleLiteral` value
 * @returns The corresponding Chakra `textStyle` prop value
 */
export function toChakraTextStyle(token: TextStyleToken): string {
    return token;
}
