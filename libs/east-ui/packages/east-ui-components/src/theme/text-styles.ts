/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Named text-style presets for the Elara Chakra v3 system.
 *
 * Components consume them via `<Text textStyle="eyebrow" />` etc. — that's
 * what enforces the canonical typography rules from pattern_spec/colors_and_type.css:
 *  - Display headings use DM Sans with negative tracking.
 *  - Body uses Inter Tight, line-height 1.5–1.625.
 *  - Eyebrow is the only positively-tracked, uppercase element.
 *  - Mono is JetBrains Mono with `tabular-nums` for tabular numerics.
 *
 * After PR 2 (token realignment), spec fontSize tiers (xs=12 … 6xl=60)
 * line up directly with our tokens.
 *
 * @packageDocumentation
 */

import { defineTextStyles } from "@chakra-ui/react";

export const textStyles = defineTextStyles({
    /* ─── Display family — DM Sans, tight tracking ─────────── */

    "display.xl": {
        value: {
            fontFamily: "heading",
            fontSize: "{fontSizes.5xl}",        // 48px (spec h1)
            fontWeight: "{fontWeights.bold}",
            lineHeight: "1.1",
            letterSpacing: "{letterSpacings.tighter}",
        },
    },
    "display.lg": {
        value: {
            fontFamily: "heading",
            fontSize: "{fontSizes.4xl}",        // 36px (spec h2)
            fontWeight: "{fontWeights.bold}",
            lineHeight: "{lineHeights.tight}",
            letterSpacing: "{letterSpacings.tight}",
        },
    },
    "display.md": {
        value: {
            fontFamily: "heading",
            fontSize: "{fontSizes.3xl}",        // 30px (spec h3)
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "{lineHeights.snug}",
            letterSpacing: "{letterSpacings.snug}",
        },
    },
    "display.sm": {
        value: {
            fontFamily: "heading",
            fontSize: "{fontSizes.2xl}",        // 24px (spec h4)
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "{lineHeights.snug}",
            letterSpacing: "{letterSpacings.snug}",
        },
    },
    "display.xs": {
        value: {
            fontFamily: "heading",
            fontSize: "{fontSizes.xl}",         // 20px (spec h5)
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "{lineHeights.snug}",
        },
    },

    /* ─── Card / inline title — DM Sans ───────────────────── */

    /** Brief / hero title — spec `.briefing-title` 22px. */
    "title.card.lg": {
        value: {
            fontFamily: "heading",
            fontSize: "22px",
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "1.25",
            letterSpacing: "{letterSpacings.snug}",
        },
    },
    /** Card title — spec `.bf2-evi-fact` 18px. */
    "title.card.md": {
        value: {
            fontFamily: "heading",
            fontSize: "{fontSizes.lg}",         // 18px
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "1.3",
        },
    },
    /** Back-compat alias for callers that still use `title.card`. */
    "title.card": {
        value: {
            fontFamily: "heading",
            fontSize: "{fontSizes.lg}",
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "1.3",
            letterSpacing: "{letterSpacings.snug}",
        },
    },
    "title.row": {
        value: {
            fontFamily: "heading",
            fontSize: "{fontSizes.sm}",         // 14px
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "1.3",
        },
    },

    /* ─── Body — Inter Tight ───────────────────────────────── */

    "body.lg": {
        value: {
            fontSize: "{fontSizes.md}",         // 16px (marketing default)
            lineHeight: "{lineHeights.relaxed}",
        },
    },
    "body.md": {
        value: {
            fontSize: "{fontSizes.sm}",         // 14px (product default)
            lineHeight: "{lineHeights.normal}",
        },
    },
    "body.sm": {
        value: {
            fontSize: "13px",                   // spec body in tight surfaces
            lineHeight: "{lineHeights.normal}",
        },
    },
    "lead": {
        value: {
            fontSize: "{fontSizes.lg}",         // 18px
            lineHeight: "{lineHeights.relaxed}",
            color: "fg.muted",
        },
    },
    "small": {
        value: {
            fontSize: "{fontSizes.sm}",         // 14px
            lineHeight: "{lineHeights.normal}",
            color: "fg.muted",
        },
    },
    "caption": {
        value: {
            fontSize: "{fontSizes.xs}",         // 12px
            lineHeight: "{lineHeights.normal}",
            letterSpacing: "{letterSpacings.wide}",
            color: "fg.subtle",
        },
    },

    /* ─── Eyebrow family — brand section labels ─────────────
     *
     * Spec `.eyebrow` uses fontWeight 600 (semibold), NOT bold. */
    "eyebrow": {
        value: {
            fontFamily: "body",
            fontSize: "{fontSizes.xs}",         // 12px
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "{lineHeights.normal}",
            letterSpacing: "{letterSpacings.widest}",
            textTransform: "uppercase",
            /* `link` = brand.600 light / brand.300 dark — fixed brand.600
             * sits under 3:1 on dark surfaces (#362). */
            color: "{colors.link}",
        },
    },
    /** Mono eyebrow — spec `.mode-id`, `.bf2-evi-tag`. */
    "eyebrow.mono": {
        value: {
            fontFamily: "mono",
            fontSize: "{fontSizes.xs}",         // 12px
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "{lineHeights.tight}",
            letterSpacing: "{letterSpacings.wider2}",   // 0.16em
            textTransform: "uppercase",
            /* brand.fg = brand.700 light / brand.300 dark (#362). */
            color: "{colors.brand.fg}",
        },
    },
    /** Caption-tier eyebrow — spec `.cell .lbl`, `.sc-eyebrow`, `.cap-eyebrow`.
     *
     * 11 px / weight 600 / antialiased. We landed on 11 px instead of the
     * tighter 10 px so JetBrains Mono cap-tops don't blur under sub-pixel
     * hinting; the larger size lets weight 600 stay crisp while keeping
     * the labels visually present (medium/500 read as too faint).
     */
    "caption.eyebrow": {
        value: {
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "{lineHeights.tight}",
            letterSpacing: "{letterSpacings.widest2}",   // 0.18em — spec .cell .lbl / .cap-eyebrow
            textTransform: "uppercase",
            color: "fg.subtle",                          // --ink-4
        },
    },
    /** KV-pair label — spec `.tag .k`, `.kvrow .k`. */
    "tag.kv.k": {
        value: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "{fontWeights.semibold}",
            letterSpacing: "{letterSpacings.wider}",    // 0.1em
            textTransform: "uppercase",
            color: "fg.muted",
        },
    },

    /* ─── Sub-label — section dividers within a card ───────── */
    "sublabel": {
        value: {
            fontFamily: "body",
            fontSize: "{fontSizes.xs}",         // 12px
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "{lineHeights.normal}",
            letterSpacing: "{letterSpacings.wider}",
            textTransform: "uppercase",
            color: "fg.subtle",
        },
    },

    /* ─── Mono — JetBrains Mono with tabular figures ─────────
     *
     * Sizes re-anchored to the spec ladder. Renderers reach for the right
     * tier explicitly — `mono.xs` for caption-tier (10), `mono.sm` for
     * inline numerics (11), `mono.md` for default mono prose (12),
     * `mono.lg` for body-sized mono (14). */
    "mono.xs": {
        value: {
            fontFamily: "mono",
            fontSize: "10px",
            fontVariantNumeric: "tabular-nums",
            fontFeatureSettings: '"tnum"',
        },
    },
    "mono.sm": {
        value: {
            fontFamily: "mono",
            fontSize: "11px",
            fontVariantNumeric: "tabular-nums",
            fontFeatureSettings: '"tnum"',
        },
    },
    "mono.md": {
        value: {
            fontFamily: "mono",
            fontSize: "{fontSizes.xs}",         // 12px
            fontVariantNumeric: "tabular-nums",
            fontFeatureSettings: '"tnum"',
        },
    },
    "mono.lg": {
        value: {
            fontFamily: "mono",
            fontSize: "{fontSizes.sm}",         // 14px
            fontVariantNumeric: "tabular-nums",
            fontFeatureSettings: '"tnum"',
        },
    },
    /** Pattern-name / diff key — spec `.pattern-name`, `.diff-row .label .key`. */
    "mono.label": {
        value: {
            fontFamily: "mono",
            fontSize: "{fontSizes.sm}",         // 14px
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "{lineHeights.tight}",
            color: "fg",
        },
    },
    /** Body-sized tabular numerics — spec `.je-meta`, `.ar`, table numeric cells. */
    "mono.tabular.sm": {
        value: {
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "{fontWeights.medium}",
            lineHeight: "{lineHeights.normal}",
            fontVariantNumeric: "tabular-nums",
            fontFeatureSettings: '"tnum"',
        },
    },
    /** KPI hero numerics — spec `.cell .val` (22px), `.bf2-big` (44px scaled
     * via prop). Default 24px covers data-rail cells; renderers up-size with
     * a `fontSize` prop for hero contexts. */
    "mono.kpi": {
        value: {
            fontFamily: "mono",
            fontSize: "{fontSizes.2xl}",        // 24px default — covers .cell .val
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "1",
            letterSpacing: "{letterSpacings.tight}",
            fontVariantNumeric: "tabular-nums",
            fontFeatureSettings: '"tnum"',
        },
    },

    /* ─── IR-token aliases (hyphenated form) ────────────────
     *
     * The East UI IR `TextStyleType` ships hyphenated tokens
     * (`"display-lg"`, `"mono-kpi"`, …) — these are the strings renderers
     * receive from East values and pass through to Chakra's `textStyle`
     * prop. Without these aliases, `textStyle="mono-kpi"` would not
     * resolve and Numeric / Text / Heading would fall back to defaults. */
    "display-xl": {
        value: {
            fontFamily: "heading",
            fontSize: "{fontSizes.5xl}",        // 48px (spec h1)
            fontWeight: "{fontWeights.bold}",
            lineHeight: "{lineHeights.tight}",
            letterSpacing: "{letterSpacings.tighter}",
        },
    },
    "display-lg": {
        value: {
            fontFamily: "heading",
            fontSize: "{fontSizes.4xl}",
            fontWeight: "{fontWeights.bold}",
            lineHeight: "{lineHeights.tight}",
            letterSpacing: "{letterSpacings.tight}",
        },
    },
    "display-md": {
        value: {
            fontFamily: "heading",
            fontSize: "{fontSizes.3xl}",
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "{lineHeights.snug}",
            letterSpacing: "{letterSpacings.snug}",
        },
    },
    "display-sm": {
        value: {
            fontFamily: "heading",
            fontSize: "{fontSizes.2xl}",
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "{lineHeights.snug}",
            letterSpacing: "{letterSpacings.snug}",
        },
    },
    "heading-lg": {
        value: {
            fontFamily: "heading",
            fontSize: "22px",
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "1.25",
            letterSpacing: "{letterSpacings.snug}",
        },
    },
    "heading-md": {
        value: {
            fontFamily: "heading",
            fontSize: "{fontSizes.lg}",
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "1.3",
        },
    },
    "heading-sm": {
        value: {
            fontFamily: "heading",
            fontSize: "{fontSizes.sm}",
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "1.3",
        },
    },
    "heading-xs": {
        value: {
            fontFamily: "heading",
            fontSize: "13px",
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "1.3",
        },
    },
    "body-lg": {
        value: { fontSize: "{fontSizes.md}", lineHeight: "{lineHeights.relaxed}" },
    },
    "body-md": {
        value: { fontSize: "{fontSizes.sm}", lineHeight: "{lineHeights.normal}" },
    },
    "body-sm": {
        value: { fontSize: "13px", lineHeight: "{lineHeights.normal}" },
    },
    "label-md": {
        value: {
            fontFamily: "body",
            fontSize: "{fontSizes.xs}",
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "{lineHeights.normal}",
            letterSpacing: "{letterSpacings.wider}",
            textTransform: "uppercase",
            color: "fg.subtle",
        },
    },
    "label-sm": {
        value: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "{lineHeights.tight}",
            letterSpacing: "{letterSpacings.widest2}",
            textTransform: "uppercase",
            color: "fg.muted",
        },
    },
    "overline": {
        value: {
            fontFamily: "body",
            fontSize: "{fontSizes.xs}",
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "{lineHeights.normal}",
            letterSpacing: "{letterSpacings.widest}",
            textTransform: "uppercase",
            /* `link` = brand.600 light / brand.300 dark — fixed brand.600
             * sits under 3:1 on dark surfaces (#362). */
            color: "{colors.link}",
        },
    },
    "code-sm": {
        value: {
            fontFamily: "mono",
            fontSize: "11px",
            fontVariantNumeric: "tabular-nums",
            fontFeatureSettings: '"tnum"',
        },
    },
    "code-md": {
        value: {
            fontFamily: "mono",
            fontSize: "{fontSizes.xs}",
            fontVariantNumeric: "tabular-nums",
            fontFeatureSettings: '"tnum"',
        },
    },
    "mono-kpi": {
        value: {
            fontFamily: "mono",
            fontSize: "{fontSizes.2xl}",
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "1",
            letterSpacing: "{letterSpacings.tight}",
            fontVariantNumeric: "tabular-nums",
            fontFeatureSettings: '"tnum"',
        },
    },

    /* ─── App shell chrome — bsys "Header recipe" / "Sidebar recipe" ─
     *
     * The application chrome (sticky 84 px header, 240 px sidebar) is
     * driven by these five tokens. Numbers are 1:1 with the spec; the
     * colour roles use semantic tokens so dark mode inherits without
     * change. */

    /** Header Row 1 left — section breadcrumb. Spec `Header recipe Row 1`. */
    "breadcrumb": {
        value: {
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "{fontWeights.medium}",
            letterSpacing: "0.06em",
            color: "fg.muted",
        },
    },
    /** Header Row 2 left — surface title. Spec `Header recipe Row 2 title`
     *  (brand 24 px / 700 / −0.015 em). */
    "surface.title": {
        value: {
            fontFamily: "heading",
            fontSize: "{fontSizes.2xl}",        // 24px
            fontWeight: "{fontWeights.bold}",
            lineHeight: "1.1",
            letterSpacing: "-0.015em",
            color: "fg",
        },
    },
    /** Header Row 2 right — state eyebrow. Spec `Header recipe Row 2
     *  state eyebrow` (mono 10.5 px / 0.14 em uppercase). */
    "state.eyebrow": {
        value: {
            fontFamily: "mono",
            fontSize: "10.5px",
            fontWeight: "{fontWeights.semibold}",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "fg.muted",
        },
    },
    /** Sidebar group header — Spec `Sidebar recipe section eyebrow`
     *  (mono 9.5 px / 600 / 0.18 em in `ink-4`). */
    "nav.eyebrow": {
        value: {
            fontFamily: "mono",
            fontSize: "9.5px",
            fontWeight: "{fontWeights.semibold}",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "fg.muted",
        },
    },
    /** Sidebar item label — Spec `Sidebar recipe item label`
     *  (mono 12 px / 600 / 0.12 em uppercase). Colour intentionally
     *  omitted so callers control per-state (active vs. resting). */
    "nav.item": {
        value: {
            fontFamily: "mono",
            fontSize: "{fontSizes.xs}",         // 12px
            fontWeight: "{fontWeights.semibold}",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
        },
    },
});
