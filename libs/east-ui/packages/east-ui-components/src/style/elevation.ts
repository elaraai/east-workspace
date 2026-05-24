/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Pure lookup — `ElevationLiteral` → Chakra theme token references for
 * `{ boxShadow, zIndex, background }`.
 *
 * The returned strings are token-paths (e.g. `"shadows.overlay"`), not
 * resolved values. Chakra's style engine resolves them against the consumer
 * theme at render time, so changing a theme doesn't require re-releasing
 * east-ui-components.
 *
 * Enforcement:
 *   - Token set: IR (`east-ui/src/style/visual.ts`)
 *   - Values: consumer Chakra theme (see `docs/THEME-CONTRACT.md`)
 */

export type ElevationToken = "flat" | "raised" | "overlay" | "floating" | "modal";

export interface ElevationProps {
    /** Chakra `shadows.*` token path. */
    readonly boxShadow: string;
    /** Chakra `zIndex.*` token path. */
    readonly zIndex: string;
    /** Chakra `colors.bg.*` token path (surface background). */
    readonly background: string;
}

/**
 * Resolve an `ElevationType` token to the `{ boxShadow, zIndex, background }`
 * triple of Chakra theme token paths.
 *
 * @remarks
 * - `flat` — no shadow, content plane, surface background.
 * - `raised` — subtle lift (card on page).
 * - `overlay` — floating overlay (popover / menu).
 * - `floating` — pinned floating (toolbars).
 * - `modal` — top-most (dialog / drawer).
 *
 * @param token - An `ElevationLiteral` value
 * @returns A `{ boxShadow, zIndex, background }` triple of theme token paths
 */
export function toElevationProps(token: ElevationToken): ElevationProps {
    switch (token) {
        case "flat":
            return { boxShadow: "none", zIndex: "base", background: "bg.surface" };
        case "raised":
            return { boxShadow: "shadows.raised", zIndex: "base", background: "bg.raised" };
        case "overlay":
            return { boxShadow: "shadows.overlay", zIndex: "overlay", background: "bg.overlay" };
        case "floating":
            return { boxShadow: "shadows.floating", zIndex: "popover", background: "bg.floating" };
        case "modal":
            return { boxShadow: "shadows.modal", zIndex: "modal", background: "bg.modal" };
    }
}
