/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Semantic tokens for the canonical Elara Chakra v3 system.
 *
 * Where {@link tokens} expose raw scale values (`brand.500`, `gray.200`),
 * these expose roles (`bg.surface`, `fg.muted`, `border.subtle`). Components
 * should consume the role tokens — that's what makes the theme swappable.
 *
 * @packageDocumentation
 */

import { defineSemanticTokens } from "@chakra-ui/react";

export const semanticTokens = defineSemanticTokens({
    colors: {
        /* ─── colorPalette virtual mappings ────────────────────
         *
         * Chakra v3 resolves `colorPalette.solid`, `colorPalette.contrast`,
         * `colorPalette.fg`, `colorPalette.muted`, `colorPalette.subtle`,
         * `colorPalette.emphasized`, `colorPalette.focusRing` against the
         * active `colorPalette` cascade by reading `<palette>.<role>` from
         * the colour tokens. Built-in palettes (red/green/blue/…) define
         * these in Chakra's default config; custom palettes (our `brand`)
         * must supply them or Chakra falls through to its "fallback dark"
         * (black) for `solid` — which is why brand-targeted radios /
         * checkboxes / sliders / switches were rendering ink-black instead
         * of teal.
         */
        brand: {
            solid:       { value: { base: "{colors.brand.600}", _dark: "{colors.brand.400}" } },
            contrast:    { value: { base: "{colors.white}",      _dark: "{colors.brand.900}" } },
            fg:          { value: { base: "{colors.brand.700}", _dark: "{colors.brand.300}" } },
            muted:       { value: { base: "{colors.brandTint}", _dark: "{colors.brand.800}" } },
            subtle:      { value: { base: "{colors.brand.50}",  _dark: "{colors.brand.900}" } },
            emphasized:  { value: { base: "{colors.brand.700}", _dark: "{colors.brand.300}" } },
            focusRing:   { value: "{colors.brand.500}" },
        },

        /* ─── Surfaces ───────────────────────────────────────── */
        bg: {
            canvas:      { value: { base: "{colors.gray.50}",   _dark: "{colors.gray.900}" } },
            surface:     { value: { base: "{colors.white}",      _dark: "{colors.gray.800}" } },
            muted:       { value: { base: "{colors.gray.100}",  _dark: "{colors.gray.700}" } },
            inverse:     { value: { base: "{colors.brand.900}", _dark: "{colors.white}"     } },

            /* Surface roles referenced by Table / Gantt / Planner / Matrix /
             * NavList / CommandPalette — previously fell through to Chakra
             * defaults, now anchored to the cool-gray ladder. */
            panel:       { value: { base: "{colors.gray.50}",   _dark: "{colors.gray.800}" } },
            subtle:      { value: { base: "{colors.gray.100}",  _dark: "{colors.gray.700}" } },
            emphasized:  { value: { base: "{colors.gray.200}",  _dark: "{colors.gray.600}" } },

            /* Brand-tinted surface — used for selected rows, branded chips,
             * brand banners, choice-card selected state. */
            "brand.subtle": { value: { base: "{colors.brandTint}", _dark: "{colors.brand.800}" } },

            /* Status-tinted surfaces — very-low-opacity overlays per spec
             * banner.* layer styles. Used directly via `bg="bg.success.subtle"`
             * etc. anywhere a soft status wash is needed. */
            "success.subtle": { value: "{colors.status.posSubtle}" },
            "danger.subtle":  { value: "{colors.status.negSubtle}" },
            "warning.subtle": { value: "{colors.status.warnSubtle}" },
            "warning.subtle.strong": { value: "{colors.status.warnSubtleStrong}" },
            "info.subtle":    { value: "{colors.status.infoSubtle}" },
        },

        /* ─── Foreground ────────────────────────────────────── */
        fg: {
            DEFAULT: { value: { base: "{colors.gray.900}", _dark: "{colors.gray.100}" } },
            muted:   { value: { base: "{colors.gray.600}", _dark: "{colors.gray.400}" } },
            subtle:  { value: { base: "{colors.gray.500}", _dark: "{colors.gray.500}" } },
            inverse: { value: { base: "{colors.white}",     _dark: "{colors.brand.900}" } },

            /* Alias for renderer code that uses `fg.default` semantically. */
            default: { value: { base: "{colors.gray.900}", _dark: "{colors.gray.100}" } },

            /* Status ink (muted document-print hues per spec). */
            success: { value: "{colors.status.pos}"  },
            danger:  { value: "{colors.status.neg}"  },
            warning: { value: "{colors.status.warn}" },
            info:    { value: "{colors.status.info}" },
        },

        /* ─── Borders ───────────────────────────────────────── */
        border: {
            subtle: { value: { base: "{colors.gray.200}", _dark: "{colors.gray.700}" } },
            strong: { value: { base: "{colors.gray.300}", _dark: "{colors.gray.600}" } },
            focus:  { value: "{colors.brand.500}" },

            /* Alias used by Card / chart axis / Note default. */
            muted:  { value: { base: "{colors.gray.200}", _dark: "{colors.gray.700}" } },

            /* Brand-tinted border for selected / emphasized branded surfaces. */
            brand:  { value: { base: "{colors.brand.500}", _dark: "{colors.brand.400}" } },
        },

        /* ─── Status ink (legible numerics on white) ──────────
         *
         *  - success — true positive / committed action.
         *  - caution — a flagged risk in body prose; the muted negative hue
         *              so it reads as caution, not destructive error.
         *  - danger  — destructive / blocking error UI.
         *  - warning — for "needs attention" (stale, drift, etc.)
         */
        ink: {
            success: { value: "{colors.status.pos}"  },
            caution: { value: { base: "{colors.status.neg}",  _dark: "{colors.brand.300}" } },
            danger:  { value: "{colors.status.neg}"  },
            warning: { value: "{colors.status.warn}" },
        },

        /* ─── Link ─────────────────────────────────────────── */
        link: {
            DEFAULT: { value: { base: "{colors.brand.600}", _dark: "{colors.brand.300}" } },
            hover:   { value: { base: "{colors.brand.700}", _dark: "{colors.brand.200}" } },
        },
    },
});
