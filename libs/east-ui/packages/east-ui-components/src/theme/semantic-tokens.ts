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
            surface:     { value: { _light: "{colors.white}",    _dark: "{colors.gray.800}" } },
            inverse:     { value: { base: "{colors.brand.900}", _dark: "{colors.white}"     } },

            /* Surface roles referenced by Table / Gantt / Planner / Matrix /
             * NavList / CommandPalette. These names collide with Chakra's
             * built-in `bg.*` semantic tokens, which define a `_light` value —
             * and `_light` beats a plain `base` at resolution in light mode, so
             * an override MUST use `_light` (not `base`) to actually win. */
            muted:       { value: { _light: "{colors.gray.100}", _dark: "{colors.gray.700}" } },
            panel:       { value: { _light: "{colors.gray.50}",  _dark: "{colors.gray.800}" } },
            subtle:      { value: { _light: "{colors.gray.100}", _dark: "{colors.gray.700}" } },
            emphasized:  { value: { _light: "{colors.gray.200}", _dark: "{colors.gray.600}" } },

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
        /* `fg` / `fg.muted` / `fg.subtle` / `fg.inverse` collide with
         * Chakra's built-ins, which define a `_light` value — the override
         * MUST use `_light` (not `base`) or Chakra's default wins (e.g.
         * titles rendered Chakra near-black instead of the brand ink). */
        fg: {
            DEFAULT: { value: { _light: "{colors.brand.900}", _dark: "{colors.gray.100}" } },
            muted:   { value: { _light: "{colors.gray.600}", _dark: "{colors.gray.400}" } },
            subtle:  { value: { _light: "{colors.gray.500}", _dark: "{colors.gray.500}" } },
            inverse: { value: { _light: "{colors.white}",     _dark: "{colors.brand.900}" } },

            /* Alias for renderer code that uses `fg.default` semantically. */
            default: { value: { base: "{colors.brand.900}", _dark: "{colors.gray.100}" } },

            /* Status ink (muted document-print hues per spec). */
            success: { value: "{colors.status.pos}"  },
            danger:  { value: "{colors.status.neg}"  },
            warning: { value: "{colors.status.warn}" },
            info:    { value: "{colors.status.info}" },
        },

        /* ─── Borders ───────────────────────────────────────── */
        /* `border.subtle` / `border.muted` collide with Chakra's built-in
         * border tokens (which define a `_light` value); like `bg.panel`, the
         * override MUST use `_light` (not `base`) or Chakra's default wins and
         * the rule renders near-invisible. */
        border: {
            subtle: { value: { _light: "{colors.gray.200}", _dark: "{colors.gray.700}" } },
            strong: { value: { base: "{colors.gray.300}", _dark: "{colors.gray.600}" } },
            focus:  { value: "{colors.brand.500}" },

            /* Alias used by Card / chart axis / Note default. */
            muted:  { value: { _light: "{colors.gray.200}", _dark: "{colors.gray.700}" } },

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

    /* ─── Shadows ─────────────────────────────────────────────
     *
     * Chakra defines its elevation scale as SEMANTIC tokens, which outrank
     * the plain `tokens.shadows` definitions — without these overrides every
     * `boxShadow: "md"` etc. resolves to Chakra's default shadows, not the
     * spec's cool-ink ones in `tokens.ts`. Must mirror that scale here. */
    shadows: {
        xs: { value: "0 1px 2px rgba(17, 27, 34, 0.05)" },
        sm: { value: "0 1px 2px rgba(17, 27, 34, 0.06), 0 1px 3px rgba(17, 27, 34, 0.08)" },
        md: { value: "0 4px 6px -1px rgba(17, 27, 34, 0.08), 0 2px 4px -2px rgba(17, 27, 34, 0.06)" },
        lg: { value: "0 10px 15px -3px rgba(17, 27, 34, 0.10), 0 4px 6px -4px rgba(17, 27, 34, 0.08)" },
        xl: { value: "0 20px 25px -5px rgba(17, 27, 34, 0.12), 0 8px 10px -6px rgba(17, 27, 34, 0.10)" },
    },
});
