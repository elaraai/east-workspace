/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Pure lookup — `FocusStyleLiteral` → CSS values for the focus ring
 * (`outlineWidth`, `outlineOffset`, `outlineColor`).
 *
 * Values come from Chakra theme token references so per-app theming works.
 * The returned shape maps directly onto the CSS properties applied via
 * Chakra's `css={{ "&:focus-visible": { ... } }}` sub-selector.
 *
 * Enforcement:
 *   - Token set: IR (`east-ui/src/style/interaction.ts`)
 *   - Values: consumer Chakra theme (see `docs/THEME-CONTRACT.md`)
 */

export type FocusStyleToken = "default" | "emphasis" | "subtle" | "none";

export interface FocusRingProps {
    /** CSS `outline-width` — Chakra `borders.*` or raw CSS length. */
    readonly outlineWidth: string;
    /** CSS `outline-offset` — raw CSS length. */
    readonly outlineOffset: string;
    /** CSS `outline-color` — Chakra `colors.*` token path or raw CSS colour. */
    readonly outlineColor: string;
    /** CSS `outline-style` — typically `"solid"` except for `"none"`. */
    readonly outlineStyle: string;
}

const NONE: FocusRingProps = {
    outlineWidth: "0",
    outlineOffset: "0",
    outlineColor: "transparent",
    outlineStyle: "none",
};

/**
 * Resolve a `FocusStyleType` token to the CSS property bundle.
 *
 * @remarks
 * - `default` — 2px solid ring, 2px offset, `colors.focus.ring` (theme).
 * - `emphasis` — 3px solid ring, 2px offset, `colors.focus.emphasis` (brand).
 * - `subtle` — 1px solid ring, 1px offset, `colors.focus.subtle`.
 * - `none` — no ring; only valid for non-keyboard-reachable surfaces.
 */
export function toFocusRingProps(token: FocusStyleToken): FocusRingProps {
    switch (token) {
        case "default":
            return {
                outlineWidth: "2px",
                outlineOffset: "2px",
                outlineColor: "colors.focus.ring",
                outlineStyle: "solid",
            };
        case "emphasis":
            return {
                outlineWidth: "3px",
                outlineOffset: "2px",
                outlineColor: "colors.focus.emphasis",
                outlineStyle: "solid",
            };
        case "subtle":
            return {
                outlineWidth: "1px",
                outlineOffset: "1px",
                outlineColor: "colors.focus.subtle",
                outlineStyle: "solid",
            };
        case "none":
            return NONE;
    }
}
