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

        /* Valence palettes. The design system already names four valences
         * (`--pos` / `--neg` / `--warn` / `--info` in tokens/colors.css) and
         * exposes them as ink and surface tokens, but not as `colorPalette`s —
         * so anything reaching for a status colour through `colorPalette` had
         * to name a Chakra built-in (`"green"`, `"red"`, …) and got Tailwind's
         * saturated hues instead of the muted document-print ones. These four
         * close that gap: same values as `status.*`, same per-mode behaviour,
         * addressable as `colorPalette="success"` and friends.
         *
         * Deliberately built from existing tokens only — no new colour enters
         * the system here; `subtle`/`muted` are mixes of the same solid.
         *
         * They are NOT the `status.*Subtle` washes: those sit at 6-14% alpha
         * because they back full-width banners, and on a chip-sized element
         * (Avatar / Badge / Tag) every valence rendered as the same near-white.
         * The mixes below are opaque and chip-legible while still muted. */
        success: {
            solid:      { value: "{colors.status.pos}" },
            contrast:   { value: { base: "{colors.white}", _dark: "{colors.brand.900}" } },
            fg:         { value: "{colors.status.pos}" },
            muted:      { value: "color-mix(in srgb, {colors.status.pos} 22%, {colors.bg.surface})" },
            subtle:     { value: "color-mix(in srgb, {colors.status.pos} 12%, {colors.bg.surface})" },
            emphasized: { value: "{colors.status.pos}" },
            focusRing:  { value: "{colors.status.pos}" },
        },
        danger: {
            solid:      { value: "{colors.status.neg}" },
            contrast:   { value: { base: "{colors.white}", _dark: "{colors.brand.900}" } },
            fg:         { value: "{colors.status.neg}" },
            muted:      { value: "color-mix(in srgb, {colors.status.neg} 22%, {colors.bg.surface})" },
            subtle:     { value: "color-mix(in srgb, {colors.status.neg} 12%, {colors.bg.surface})" },
            emphasized: { value: "{colors.status.neg}" },
            focusRing:  { value: "{colors.status.neg}" },
        },
        warning: {
            solid:      { value: "{colors.status.warn}" },
            contrast:   { value: { base: "{colors.white}", _dark: "{colors.brand.900}" } },
            fg:         { value: "{colors.status.warn}" },
            muted:      { value: "color-mix(in srgb, {colors.status.warn} 22%, {colors.bg.surface})" },
            subtle:     { value: "color-mix(in srgb, {colors.status.warn} 12%, {colors.bg.surface})" },
            emphasized: { value: "{colors.status.warn}" },
            focusRing:  { value: "{colors.status.warn}" },
        },
        info: {
            solid:      { value: "{colors.status.info}" },
            contrast:   { value: { base: "{colors.white}", _dark: "{colors.brand.900}" } },
            fg:         { value: "{colors.status.info}" },
            muted:      { value: "color-mix(in srgb, {colors.status.info} 22%, {colors.bg.surface})" },
            subtle:     { value: "color-mix(in srgb, {colors.status.info} 12%, {colors.bg.surface})" },
            emphasized: { value: "{colors.status.info}" },
            focusRing:  { value: "{colors.status.info}" },
        },
        /* `neutral` — the "idle / inactive / unknown" valence named by
         * `ColorSchemeType`. Chakra has no built-in palette of this name, so
         * without this entry `colorPalette="neutral"` resolved to nothing.
         * Built on the East cool green-gray scale. */
        neutral: {
            solid:      { value: { base: "{colors.gray.500}", _dark: "{colors.gray.400}" } },
            contrast:   { value: { base: "{colors.white}",    _dark: "{colors.brand.900}" } },
            fg:         { value: { base: "{colors.gray.600}", _dark: "{colors.gray.400}" } },
            muted:      { value: { base: "{colors.gray.100}", _dark: "{colors.gray.700}" } },
            subtle:     { value: { base: "{colors.gray.50}",  _dark: "{colors.gray.800}" } },
            emphasized: { value: { base: "{colors.gray.700}", _dark: "{colors.gray.300}" } },
            focusRing:  { value: "{colors.brand.500}" },
        },

        /* ─── Mode-dependent scales (#362) ────────────────────
         *
         * These read like raw tokens (`{colors.brandTint}`,
         * `{colors.status.pos}`, `var(--chakra-colors-status-pos)`) but live
         * here because they carry a per-colour-mode value — raw tokens can't.
         * Every recipe / renderer reference flips with the mode for free.
         */

        /* Brand tint — selected rows, branded chips, brand banners, pulse
         * rings (per pattern_spec/spec.css `--brand-tint`). */
        brandTint: { value: { base: "#e8f6f7", _dark: "{colors.brand.800}" } },

        /* Brand heatmap scale — calendars, density heatmaps. Dark ramp runs
         * dim-surface → bright teal so intensity still reads as "more". */
        brandHeat: {
            "0": { value: { base: "#e8f0f0", _dark: "#223335" } },
            "1": { value: { base: "#c0dadc", _dark: "#2c4a50" } },
            "2": { value: { base: "#88b8bd", _dark: "#3d6e76" } },
            "3": { value: { base: "#4d8e95", _dark: "#579aa2" } },
            "4": { value: { base: "#2b4b55", _dark: "#83c7cc" } },
        },

        /* Overlay tints — semi-transparent ink for backdrops + scroll thumbs.
         * Light mode anchors to brand-900 (cool, never warm); dark mode flips
         * the thumb/track to white ink (dark ink is invisible on dark). */
        overlay: {
            backdrop:    { value: { base: "rgba(17, 27, 34, 0.40)",  _dark: "rgba(0, 0, 0, 0.60)" } },
            scrollThumb: { value: { base: "rgba(17, 27, 34, 0.30)",  _dark: "rgba(255, 255, 255, 0.28)" } },
            scrollTrack: { value: { base: "rgba(17, 27, 34, 0.06)",  _dark: "rgba(255, 255, 255, 0.07)" } },
            highlight:   { value: "rgba(255, 255, 255, 0.30)" },
        },

        /* Status — muted "document-print" hues per pattern_spec/spec.css.
         * (`--pos #2f7a5b, --neg #b85a4a, --warn #b8862d, --info #3a7780`.)
         * Dark variants lighten the same hues to hold AA on gray.800/900
         * surfaces; the `*Subtle` washes flip to lightened ink at a slightly
         * higher alpha (a 6% dark-hue wash vanishes on a dark surface).
         * Vibrant Tailwind hues kept under `*Bright` for chart-series use —
         * mid-vibrancy, mode-independent. */
        status: {
            pos:  { value: { base: "#2f7a5b", _dark: "#55a37f" } },
            neg:  { value: { base: "#b85a4a", _dark: "#d28a7b" } },
            warn: { value: { base: "#b8862d", _dark: "#d3a655" } },
            info: { value: { base: "#3a7780", _dark: "#62a6b0" } },
            posSubtle:  { value: { base: "rgba(47, 122, 91, 0.06)",  _dark: "rgba(85, 163, 127, 0.12)" } },
            negSubtle:  { value: { base: "rgba(184, 90, 74, 0.06)",  _dark: "rgba(210, 138, 123, 0.12)" } },
            warnSubtle: { value: { base: "rgba(184, 134, 45, 0.08)", _dark: "rgba(211, 166, 85, 0.14)" } },
            warnSubtleStrong: { value: { base: "rgba(184, 134, 45, 0.14)", _dark: "rgba(211, 166, 85, 0.22)" } },
            infoSubtle: { value: { base: "rgba(91, 110, 135, 0.08)", _dark: "rgba(98, 166, 176, 0.14)" } },
            successBright: { value: "#22c55e" },
            dangerBright:  { value: "#ef4444" },
            warningBright: { value: "#f97316" },
        },

        /* Breakdown/chart series accents — the default `by`-series cycle
         * (SLICE_SERIES_PALETTE) leads with a brand pair: mid teal + deep
         * teal ink. The deep ink vanishes on dark surfaces, so dark flips
         * both to the bright end of the same family — vivid vs pale keeps
         * the two series distinct in either mode (#362). */
        series: {
            brand:     { value: { base: "{colors.brand.600}", _dark: "{colors.brand.400}" } },
            brandDeep: { value: { base: "{colors.brand.800}", _dark: "#97dde2" } },
        },

        /* ─── Surfaces ───────────────────────────────────────── */
        bg: {
            /* Chakra's built-in `bg` DEFAULT is zinc-950 in dark mode — left
             * unoverridden it leaks near-black into every built-in recipe that
             * references plain `bg` (Chakra's own table paints rows with it).
             * Per the collision note below, the override MUST use `_light`. */
            DEFAULT:     { value: { _light: "{colors.white}",    _dark: "{colors.gray.800}" } },
            canvas:      { value: { base: "{colors.gray.50}",   _dark: "{colors.gray.900}" } },
            surface:     { value: { _light: "{colors.white}",    _dark: "{colors.gray.800}" } },
            inverse:     { value: { base: "{colors.brand.900}", _dark: "{colors.white}"     } },

            /* Surface roles referenced by Table / Plan / Matrix /
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
            /* Dark keeps a distinct third voice but lifts off gray.500, which
             * sits below AA (~3.1:1) on gray.800 surfaces (#362). Documented in
             * design/colors_and_type.css alongside the other dark mappings. */
            subtle:  { value: { _light: "{colors.gray.500}", _dark: "#8fa5a5" } },
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
        /* Dark variants deepen to true black at higher opacity — the light
         * cool-ink shadows read as mud on dark surfaces (#362). */
        xs: { value: { base: "0 1px 2px rgba(17, 27, 34, 0.05)", _dark: "0 1px 2px rgba(0, 0, 0, 0.40)" } },
        sm: { value: { base: "0 1px 2px rgba(17, 27, 34, 0.06), 0 1px 3px rgba(17, 27, 34, 0.08)", _dark: "0 1px 2px rgba(0, 0, 0, 0.45), 0 1px 3px rgba(0, 0, 0, 0.50)" } },
        md: { value: { base: "0 4px 6px -1px rgba(17, 27, 34, 0.08), 0 2px 4px -2px rgba(17, 27, 34, 0.06)", _dark: "0 4px 6px -1px rgba(0, 0, 0, 0.50), 0 2px 4px -2px rgba(0, 0, 0, 0.45)" } },
        lg: { value: { base: "0 10px 15px -3px rgba(17, 27, 34, 0.10), 0 4px 6px -4px rgba(17, 27, 34, 0.08)", _dark: "0 10px 15px -3px rgba(0, 0, 0, 0.55), 0 4px 6px -4px rgba(0, 0, 0, 0.50)" } },
        xl: { value: { base: "0 20px 25px -5px rgba(17, 27, 34, 0.12), 0 8px 10px -6px rgba(17, 27, 34, 0.10)", _dark: "0 20px 25px -5px rgba(0, 0, 0, 0.60), 0 8px 10px -6px rgba(0, 0, 0, 0.55)" } },
    },
});
