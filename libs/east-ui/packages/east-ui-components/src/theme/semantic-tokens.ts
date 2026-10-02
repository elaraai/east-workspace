/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Semantic tokens for the canonical Elara Chakra v3 system.
 *
 * The design system (`libs/east-ui/app_design_system/`, a read-only download of
 * claude.ai/design's "East Design System") names its colours in
 * `tokens/colors.css`: `--ink` … `--ink-5`, `--paper` … `--paper-3`, `--rule`,
 * `--rule-strong`, `--brand`, `--brand-d`, `--brand-dd`, `--brand-tint`, the
 * valence bases `--pos` / `--neg` / `--warn` / `--info` and their `-text` steps,
 * the heat ramp `--heat-1` … `--heat-5`, and `--bg-inverse` / `--fg-inverse`.
 * Each has exactly ONE token here holding its value in both colour modes (the
 * first block below); `design-system.test.ts` reads the download and fails,
 * naming the token, the moment a value here drifts from it.
 *
 * Every other colour name is an ALIAS of one of those roles — Chakra's own
 * built-in roles (`bg`, `bg.panel`, `fg.error`, …) included, so its default
 * recipes paint with the design system too — or a derived value the design
 * system prescribes as a rule rather than a token (the 6% valence washes, the
 * heat ramp's value ink).
 *
 * Two Chakra merge rules shape how a value is written:
 *  - A mode-dependent value is `{ _light, _dark }`, never `{ base, _dark }`:
 *    Chakra's own semantic colours define `_light`, which outranks `base` in
 *    light mode, so a `base` override of a built-in name silently loses.
 *  - An alias is a plain string. A plain value replaces Chakra's conditions
 *    whole and is declared at the variables' root, where `var()` resolves in
 *    the active mode (dark mode is the `dark` class on `<html>`).
 *
 * @packageDocumentation
 */

import { defineSemanticTokens } from "@chakra-ui/react";

/** A value for each colour mode. */
const modes = (light: string, dark: string) => ({ value: { _light: light, _dark: dark } });

/** Another token's value, in whichever mode is active. */
const alias = (ref: string) => ({ value: ref });

/** The design system's valence wash: 6% of the base over whatever lies under it
 *  (`component-rules.md` §1), in both themes. */
const wash = (base: string) => ({ value: `color-mix(in oklch, ${base} 6%, transparent)` });

/** The heat ramp's mixed steps: `--brand-d` into `--paper` (`tokens/colors.css`). */
const heatMix = (percent: number) => ({ value: `color-mix(in oklch, {colors.brand.solid} ${percent}%, {colors.bg.surface})` });

/** A palette's solid fill at 90% — the hover Chakra's own theme gives a solid
 *  part, for the palettes the design system leaves to Chakra. */
const stockSolidHover = (palette: string) =>
    ({ value: `color-mix(in srgb, {colors.${palette}.solid} 90%, transparent)` });

export const semanticTokens = defineSemanticTokens({
    colors: {
        /* ─── The design system's colours: one token each ────────────────
         *
         * Values as `tokens/colors.css` declares them, light then dark. */

        /* Ink — text. Readable text is `fg.subtle` (`--ink-4`) or darker:
         * at least 4.5:1 on every paper and on `brandTint`, in both themes.
         * `fg.faint` (`--ink-5`) is never readable text: disabled text and
         * icons, and muted marks. */
        fg: {
            DEFAULT: modes("#111b22", "#f1f5f5"),                // --ink
            strong:  modes("#2b4b55", "#cfd9d9"),                // --ink-2 · strong secondary text
            muted:   modes("#4a5f5f", "#aec3c3"),                // --ink-3 · secondary text, ledes
            subtle:  modes("#5d7171", "#96acac"),                // --ink-4 · labels, captions, placeholders
            faint:   modes("#9bb0b0", "#4a5f5f"),                // --ink-5 · disabled, muted marks
            inverse: modes("#ffffff", "{colors.brand.900}"),     // --fg-inverse · the Stamp and the Tooltip

            /* Valence set as text — the text steps: at least 4.5:1 on every
             * paper, on `brandTint`, and on the valence's own wash over each. */
            success: modes("#2a7557", "#67bf9c"),                // --pos-text
            danger:  modes("#a94c3e", "#eb9b8c"),                // --neg-text
            warning: modes("#8f6100", "#d7aa52"),                // --warn-text
            info:    modes("{colors.status.info}", "#87b3eb"),   // --info-text

            /* Aliases. */
            default:  alias("{colors.fg}"),
            inverted: alias("{colors.fg.inverse}"),   // Chakra's name
            error:    alias("{colors.fg.danger}"),    // Chakra's name
        },

        /* Paper — surfaces. `bg.surface` frames, rows, controls and overlays;
         * `bg.canvas` the page, bands, the sidebar and the rail; `bg.subtle`
         * wells, count chips and selected rows and cells. Hover steps one paper
         * darker. */
        bg: {
            surface: modes("#ffffff", "#1a2626"),                // --paper
            canvas:  modes("#f8fafa", "#253333"),                // --paper-2
            subtle:  modes("#f1f5f5", "#2e3f3f"),                // --paper-3
            inverse: modes("{colors.brand.900}", "#ffffff"),     // --bg-inverse · the Stamp and the Tooltip

            /* Aliases — Chakra's built-in surface roles, each on the design
             * system's paper for that role. The design system has three papers;
             * `muted` and `emphasized` are the darkest of them. */
            DEFAULT:    alias("{colors.bg.surface}"),
            panel:      alias("{colors.bg.canvas}"),
            muted:      alias("{colors.bg.subtle}"),
            emphasized: alias("{colors.bg.subtle}"),
            inverted:   alias("{colors.bg.inverse}"),
            "brand.subtle": alias("{colors.brandTint}"),

            /* The valence washes (flat keys: Chakra's `bg.success` etc. are
             * themselves tokens, so a nested `success.subtle` would never be
             * read). */
            error:   alias("{colors.status.negSubtle}"),
            warning: alias("{colors.status.warnSubtle}"),
            success: alias("{colors.status.posSubtle}"),
            info:    alias("{colors.status.infoSubtle}"),
            "success.subtle": alias("{colors.status.posSubtle}"),
            "danger.subtle":  alias("{colors.status.negSubtle}"),
            "warning.subtle": alias("{colors.status.warnSubtle}"),
            "info.subtle":    alias("{colors.status.infoSubtle}"),
        },

        /* Rules — structure. `border.subtle` divides inside a frame;
         * `border.strong` is a frame's edge, an input's and an overlay's. */
        border: {
            subtle: modes("#e2e8e8", "#374848"),                 // --rule
            strong: modes("#cbd5d5", "#4a5f5f"),                 // --rule-strong

            /* Aliases. */
            DEFAULT:    alias("{colors.border.subtle}"),   // Chakra's name
            muted:      alias("{colors.border.subtle}"),
            emphasized: alias("{colors.border.strong}"),   // Chakra's name
            /* Every brand edge the design system draws is `--brand-d`. */
            brand:      alias("{colors.brand.solid}"),
            /* An outline drawn for focus — the focus ring's own hue. */
            focus:      alias("{colors.brandMark}"),
            error:      alias("{colors.status.neg}"),
            warning:    alias("{colors.status.warn}"),
            success:    alias("{colors.status.pos}"),
            info:       alias("{colors.status.info}"),
        },

        /* Brand — deep teal. `brandMark` marks and dots; `brand.solid`
         * (`--brand-d`) is interactive: Primary, links, checks, with `--paper`
         * text and ticks on it; `brandPressed` (`--brand-dd`) hover, pressed and
         * an active control's text; `brandTint` the only tinted background: an
         * active control or a dirty value. The `brand` group is also Chakra's
         * `colorPalette="brand"`: each role it reads names one of these.
         *
         * `brand` is the default palette (`html` in `global-css.ts`), so its
         * solid roles are the design system's Primary (#1091): `solid` is
         * `--brand-d`, `contrast` is `--paper`, the label and ticks on it, and
         * `solidHover` is `--brand-dd`, its hover and pressed fill.
         * `solidHover` is a role of our own, so EVERY palette carries it
         * (below): a palette's roles are CSS variables, and one a palette
         * lacks is inherited from the nearest element whose palette has it —
         * a red button would hover in the default palette's brand. */
        brandMark:    modes("#488e97", "#488e97"),               // --brand
        brandPressed: modes("#2b4b55", "#81ccd5"),               // --brand-dd
        brandTint:    modes("#e8f6f7", "#1f363d"),               // --brand-tint
        brand: {
            solid:      modes("#3a7780", "#65b2bd"),             // --brand-d
            solidHover: alias("{colors.brandPressed}"),          // --brand-dd, the Primary's hover
            contrast:   alias("{colors.bg.surface}"),
            fg:         alias("{colors.brandPressed}"),
            muted:      alias("{colors.brandTint}"),
            subtle:     alias("{colors.brandTint}"),
            emphasized: alias("{colors.brandPressed}"),
            border:     alias("{colors.brand.solid}"),
            focusRing:  alias("{colors.brandMark}"),
        },

        /* Valence — muted, never saturated. The bases mark: dots, marks and
         * the washes, at least 3:1 on every paper. Set as text, a valence takes
         * its text step (`fg.success` …). */
        status: {
            pos:  modes("#2f7a5b", "#4da583"),                   // --pos
            neg:  modes("#b85a4a", "#d98a7c"),                   // --neg
            warn: modes("#b6842b", "#d4a74f"),                   // --warn
            info: modes("#416b9f", "#7ca7df"),                   // --info · its own blue, never --brand-d

            /* The 6% washes, `color-mix(in oklch, var(--pos) 6%, transparent)`. */
            posSubtle:  wash("{colors.status.pos}"),
            negSubtle:  wash("{colors.status.neg}"),
            warnSubtle: wash("{colors.status.warn}"),
            infoSubtle: wash("{colors.status.info}"),
        },

        /* The sequential ramp — heat cells and map areas, one measure's
         * magnitude: `--brand-d` mixed into `--paper` at 12 / 32 / 56%, then
         * `--brand-d`, then `--brand-dd`, each in the active theme. A value on
         * steps 1–3 is `fg`; on 4–5, `bg.surface`. */
        heat: {
            "1": heatMix(12),                                    // --heat-1
            "2": heatMix(32),                                    // --heat-2
            "3": heatMix(56),                                    // --heat-3
            "4": alias("{colors.brand.solid}"),                  // --heat-4
            "5": alias("{colors.brandPressed}"),                 // --heat-5
        },

        /* ─── Aliases with a design-system role ──────────────────────────── */

        /* Links — `--brand-d`, hover `--brand-dd`. */
        link: {
            DEFAULT: alias("{colors.brand.solid}"),
            hover:   alias("{colors.brandPressed}"),
        },

        /* Chart series — series 1 is `--brand-d`; the next comparison takes the
         * first accent in the design system's order (teal). */
        series: {
            brand:     alias("{colors.brand.solid}"),
            brandDeep: alias("{colors.accent.teal}"),
        },

        /* Valence palettes — `colorPalette="success"` and friends, so a
         * component reaching for a valence through `colorPalette` paints with
         * the design system's valences rather than Chakra's saturated hues.
         * Each role names one design-system value: the base marks, the text
         * step is the palette's ink, the 6% wash is its only fill. */
        success: {
            solid:      alias("{colors.status.pos}"),
            solidHover: stockSolidHover("success"),
            contrast:   alias("{colors.bg.surface}"),
            fg:         alias("{colors.fg.success}"),
            muted:      alias("{colors.status.posSubtle}"),
            subtle:     alias("{colors.status.posSubtle}"),
            emphasized: alias("{colors.status.pos}"),
            border:     alias("{colors.status.pos}"),
            focusRing:  alias("{colors.brandMark}"),
        },
        danger: {
            solid:      alias("{colors.status.neg}"),
            solidHover: stockSolidHover("danger"),
            contrast:   alias("{colors.bg.surface}"),
            fg:         alias("{colors.fg.danger}"),
            muted:      alias("{colors.status.negSubtle}"),
            subtle:     alias("{colors.status.negSubtle}"),
            emphasized: alias("{colors.status.neg}"),
            border:     alias("{colors.status.neg}"),
            focusRing:  alias("{colors.brandMark}"),
        },
        warning: {
            solid:      alias("{colors.status.warn}"),
            solidHover: stockSolidHover("warning"),
            contrast:   alias("{colors.bg.surface}"),
            fg:         alias("{colors.fg.warning}"),
            muted:      alias("{colors.status.warnSubtle}"),
            subtle:     alias("{colors.status.warnSubtle}"),
            emphasized: alias("{colors.status.warn}"),
            border:     alias("{colors.status.warn}"),
            focusRing:  alias("{colors.brandMark}"),
        },
        info: {
            solid:      alias("{colors.status.info}"),
            solidHover: stockSolidHover("info"),
            contrast:   alias("{colors.bg.surface}"),
            fg:         alias("{colors.fg.info}"),
            muted:      alias("{colors.status.infoSubtle}"),
            subtle:     alias("{colors.status.infoSubtle}"),
            emphasized: alias("{colors.status.info}"),
            border:     alias("{colors.status.info}"),
            focusRing:  alias("{colors.brandMark}"),
        },
        /* `neutral` — the idle / unknown valence `ColorSchemeType` names: the
         * Status card's neutral dot is `--ink-4` and its word `--ink-3`; a flat
         * DeltaPill sits on `--paper-3`. */
        neutral: {
            solid:      alias("{colors.fg.subtle}"),
            solidHover: stockSolidHover("neutral"),
            contrast:   alias("{colors.bg.surface}"),
            fg:         alias("{colors.fg.muted}"),
            muted:      alias("{colors.bg.subtle}"),
            subtle:     alias("{colors.bg.subtle}"),
            emphasized: alias("{colors.fg.muted}"),
            border:     alias("{colors.border.strong}"),
            focusRing:  alias("{colors.brandMark}"),
        },

        /* Chakra's own hues — the stock palettes `ColorScheme` names. The
         * design system specifies only the brand's solid hover; a solid part
         * in one of these hovers as Chakra's theme hovers it. */
        gray:   { solidHover: stockSolidHover("gray") },
        red:    { solidHover: stockSolidHover("red") },
        orange: { solidHover: stockSolidHover("orange") },
        yellow: { solidHover: stockSolidHover("yellow") },
        green:  { solidHover: stockSolidHover("green") },
        teal:   { solidHover: stockSolidHover("teal") },
        blue:   { solidHover: stockSolidHover("blue") },
        cyan:   { solidHover: stockSolidHover("cyan") },
        purple: { solidHover: stockSolidHover("purple") },
        pink:   { solidHover: stockSolidHover("pink") },

        /* ─── No design-system role ──────────────────────────────────────
         *
         * Translucent ink for the modal backdrop and the scrollbar, which the
         * design system does not draw. They hold in both themes by alpha. */
        overlay: {
            backdrop:    modes("rgba(17, 27, 34, 0.40)", "rgba(0, 0, 0, 0.60)"),
            scrollThumb: modes("rgba(17, 27, 34, 0.30)", "rgba(255, 255, 255, 0.28)"),
            scrollTrack: modes("rgba(17, 27, 34, 0.06)", "rgba(255, 255, 255, 0.07)"),
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
