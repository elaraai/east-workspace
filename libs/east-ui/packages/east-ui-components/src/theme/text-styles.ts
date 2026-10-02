/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Named text-style presets for the Elara Chakra v3 system.
 *
 * Components consume them via `<Text textStyle="eyebrow" />` etc. The first
 * block is the East Design System's own text styles, one for each of its
 * classes (`app_design_system/_ds_bundle.css`: `.h1` … `.h6`, `.p`, `.lead`,
 * `.small`, `.caption`, `.eyebrow`, `.mono`, `.num`, `.num-lg`) plus
 * `absent`, its "no data" value. Every other name is an older or IR name,
 * held to the same rules:
 *  - Titles are DM Sans at the title sizes (15–24px) with negative tracking.
 *  - Running text is Inter Tight at 12.5–14px.
 *  - Labels — eyebrows, keys, statuses — are JetBrains Mono at 9.5–11px,
 *    600, uppercase, tracked 0.1–0.18em, in `--ink-4` unless they name
 *    another ink.
 *  - Numerals are mono with tabular figures; large numbers 26px / 600.
 * Only the design system's sizes, weights, line heights and tracking are
 * used — each a token (`tokens.ts`).
 *
 * @packageDocumentation
 */

import { defineTextStyles } from "@chakra-ui/react";

/** Tabular figures — every numeral in the data voice. */
const TNUM = { fontVariantNumeric: "tabular-nums", fontFeatureSettings: '"tnum"' } as const;

/** A mono label: uppercase, 600, tracked (component-rules §2) — on its own
 *  line height, or the line's when it names none. */
const label = (fontSize: string, letterSpacing: string, color: string, lineHeight?: string) => ({
    fontFamily: "mono",
    fontSize,
    fontWeight: "{fontWeights.semibold}",
    ...(lineHeight !== undefined ? { lineHeight } : {}),
    letterSpacing,
    textTransform: "uppercase",
    color,
}) as const;

const TIGHT = "{lineHeights.tight}";
const NORMAL = "{lineHeights.normal}";

/* The design system's title styles, `.h1` … `.h5` (`h6` is Inter Tight). */
const H1 = { fontFamily: "heading", fontSize: "{fontSizes.title.xl}", fontWeight: "{fontWeights.bold}",     lineHeight: "{lineHeights.tight}", letterSpacing: "{letterSpacings.tighter}" } as const;
const H2 = { fontFamily: "heading", fontSize: "{fontSizes.title.lg}", fontWeight: "{fontWeights.bold}",     lineHeight: "{lineHeights.tight}", letterSpacing: "{letterSpacings.tight}" } as const;
const H3 = { fontFamily: "heading", fontSize: "{fontSizes.title.md}", fontWeight: "{fontWeights.semibold}", lineHeight: "{lineHeights.snug}",  letterSpacing: "{letterSpacings.snug}" } as const;
const H4 = { fontFamily: "heading", fontSize: "{fontSizes.title.sm}", fontWeight: "{fontWeights.semibold}", lineHeight: "{lineHeights.snug}",  letterSpacing: "{letterSpacings.snug}" } as const;
const H5 = { fontFamily: "heading", fontSize: "{fontSizes.title.xs}", fontWeight: "{fontWeights.bold}",     lineHeight: "{lineHeights.snug}",  letterSpacing: "{letterSpacings.snug}" } as const;
const H6 = { fontFamily: "body",    fontSize: "{fontSizes.body.lg}",  fontWeight: "{fontWeights.semibold}", lineHeight: "{lineHeights.normal}" } as const;

/** The design system's heading element styles, `h1` … `h6`, without their
 *  ink: as element styles (`global-css.ts`) a heading keeps the text colour
 *  of the surface it sits on, which on a page is `--ink`. */
export const headingStyles = { h1: H1, h2: H2, h3: H3, h4: H4, h5: H5, h6: H6 } as const;

/** The design system's eyebrow (`.eyebrow`): mono 10 / 600 / 0.12em, uppercase, `--ink-4`. */
const EYEBROW = label("{fontSizes.label.sm}", "{letterSpacings.widest}", "fg.subtle", NORMAL);

/** Large numbers (`.num-lg`): mono, tabular, 26px / 600. */
const NUM_LG = { fontFamily: "mono", fontSize: "{fontSizes.num}", fontWeight: "{fontWeights.semibold}", lineHeight: "1", ...TNUM } as const;

export const textStyles = defineTextStyles({
    /* ─── The design system's text styles ─────────────────── */

    /** Page title — DM Sans 24 / 700 / −0.02em. */
    h1: { value: { ...H1, color: "fg" } },
    /** Dialog title, h2 — DM Sans 20 / 700 / −0.015em. */
    h2: { value: { ...H2, color: "fg" } },
    /** Compact bar, h3 — DM Sans 18 / 600 / −0.01em. */
    h3: { value: { ...H3, color: "fg" } },
    /** Condensed bar, h4 — DM Sans 16 / 600 / −0.01em. */
    h4: { value: { ...H4, color: "fg" } },
    /** Empty state, h5 — DM Sans 15 / 700 / −0.01em. */
    h5: { value: { ...H5, color: "fg" } },
    /** h6 — Inter Tight 14 / 600. */
    h6: { value: { ...H6, color: "fg" } },
    /** Running text (`.p`) — 13 / 1.625. */
    body: { value: { fontSize: "{fontSizes.body}", lineHeight: "{lineHeights.relaxed}", color: "fg" } },
    /** A lede — 14 / 1.625 in `--ink-3`. */
    lead: { value: { fontSize: "{fontSizes.body.lg}", lineHeight: "{lineHeights.relaxed}", color: "fg.muted" } },
    /** Small text — 12.5 / 1.5 in `--ink-3`. */
    small: { value: { fontSize: "{fontSizes.body.sm}", lineHeight: "{lineHeights.normal}", color: "fg.muted" } },
    /** A caption — 12.5 / 1.5, tracked 0.02em, in `--ink-4`. */
    caption: {
        value: {
            fontSize: "{fontSizes.body.sm}",
            lineHeight: "{lineHeights.normal}",
            letterSpacing: "{letterSpacings.wide}",
            color: "fg.subtle",
        },
    },
    /** An eyebrow — mono 10 / 600 / 0.12em, uppercase, `--ink-4`. */
    eyebrow: { value: EYEBROW },
    /** The data voice — mono with tabular figures, at the line's size. */
    mono: { value: { fontFamily: "mono", ...TNUM } },
    /** A numeral (`.num`) — mono, tabular, 500. */
    num: { value: { fontFamily: "mono", fontWeight: "{fontWeights.medium}", ...TNUM } },
    /** A large number (`.num-lg`) — Stat values, data-rail cells. */
    "num-lg": { value: NUM_LG },
    /** An absent value — "no data", or the reason it cannot exist yet — in
     *  mono italic 400, `--ink-4`, at the value's own size (base-components ›
     *  Numbers & absent values). The only italic. */
    absent: {
        value: {
            fontFamily: "mono",
            fontStyle: "italic",
            fontWeight: "{fontWeights.normal}",
            color: "fg.subtle",
        },
    },

    /* ─── Display family — the title styles under their older names ─ */

    "display.xl": { value: H1 },
    "display.lg": { value: H2 },
    "display.md": { value: H3 },
    "display.sm": { value: H4 },
    "display.xs": { value: H5 },

    /* ─── Card / inline titles — DM Sans ──────────────────── */

    /** Brief / hero title. */
    "title.card.lg": {
        value: {
            fontFamily: "heading",
            fontSize: "{fontSizes.title.lg}",
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "{lineHeights.tight}",
            letterSpacing: "{letterSpacings.snug}",
        },
    },
    /** Card title. */
    "title.card.md": {
        value: {
            fontFamily: "heading",
            fontSize: "{fontSizes.title.md}",
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "{lineHeights.snug}",
            letterSpacing: "{letterSpacings.snug}",
        },
    },
    /** Back-compat alias for callers that still use `title.card`. */
    "title.card": {
        value: {
            fontFamily: "heading",
            fontSize: "{fontSizes.title.md}",
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "{lineHeights.snug}",
            letterSpacing: "{letterSpacings.snug}",
        },
    },
    /** A row's title — the smallest title size. */
    "title.row": {
        value: {
            fontFamily: "heading",
            fontSize: "{fontSizes.title.xs}",
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "{lineHeights.snug}",
            letterSpacing: "{letterSpacings.snug}",
        },
    },

    /* ─── Body — Inter Tight ───────────────────────────────── */

    "body.lg": { value: { fontSize: "{fontSizes.body.lg}", lineHeight: "{lineHeights.relaxed}" } },
    "body.md": { value: { fontSize: "{fontSizes.body}", lineHeight: "{lineHeights.normal}" } },
    "body.sm": { value: { fontSize: "{fontSizes.body.sm}", lineHeight: "{lineHeights.normal}" } },

    /* ─── Labels — mono, uppercase, tracked ────────────────── */

    /** A brand eyebrow — spec `.mode-id`, `.bf2-evi-tag`; the one label in
     *  the brand's ink (`brand.fg`, `--brand-dd`). */
    "eyebrow.mono": { value: label("{fontSizes.label.sm}", "{letterSpacings.wider2}", "{colors.brand.fg}", TIGHT) },
    /** Caption-tier eyebrow — spec `.cell .lbl`, `.sc-eyebrow`, `.cap-eyebrow`. */
    "caption.eyebrow": { value: label("{fontSizes.label.lg}", "{letterSpacings.widest2}", "fg.subtle", TIGHT) },
    /** KV-pair key — spec `.tag .k`, `.kvrow .k`. */
    "tag.kv.k": { value: label("{fontSizes.label.sm}", "{letterSpacings.caps}", "fg.muted") },
    /** Sub-label — a section divider within a card. */
    "sublabel": { value: label("{fontSizes.label.lg}", "{letterSpacings.caps}", "fg.subtle", NORMAL) },

    /* ─── Mono — JetBrains Mono with tabular figures ─────────
     *
     * `mono.xs` for the caption tier (10), `mono.sm` for inline numerics
     * (11), `mono.md` for mono prose (12.5), `mono.lg` for body-sized mono
     * (14). */
    "mono.xs": { value: { fontFamily: "mono", fontSize: "{fontSizes.label.sm}", ...TNUM } },
    "mono.sm": { value: { fontFamily: "mono", fontSize: "{fontSizes.label.lg}", ...TNUM } },
    "mono.md": { value: { fontFamily: "mono", fontSize: "{fontSizes.body.sm}", ...TNUM } },
    "mono.lg": { value: { fontFamily: "mono", fontSize: "{fontSizes.body.lg}", ...TNUM } },
    /** Pattern-name / diff key — spec `.pattern-name`, `.diff-row .label .key`. */
    "mono.label": {
        value: {
            fontFamily: "mono",
            fontSize: "{fontSizes.body.lg}",
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "{lineHeights.tight}",
            color: "fg",
        },
    },
    /** Tabular numerics at label size — spec `.je-meta`, `.ar`. */
    "mono.tabular.sm": {
        value: {
            fontFamily: "mono",
            fontSize: "{fontSizes.label.lg}",
            fontWeight: "{fontWeights.medium}",
            lineHeight: "{lineHeights.normal}",
            ...TNUM,
        },
    },
    /** KPI numerics — the large number (`.num-lg`). */
    "mono.kpi": { value: NUM_LG },

    /* ─── IR-token aliases (hyphenated form) ────────────────
     *
     * The East UI IR `TextStyleType` ships hyphenated tokens
     * (`"display-lg"`, `"mono-kpi"`, …) — these are the strings renderers
     * receive from East values and pass through to Chakra's `textStyle`
     * prop. Without these aliases, `textStyle="mono-kpi"` would not
     * resolve and Numeric / Text / Heading would fall back to defaults. */
    "display-xl": { value: H1 },
    "display-lg": { value: H2 },
    "display-md": { value: H3 },
    "display-sm": { value: H4 },
    "heading-lg": {
        value: {
            fontFamily: "heading",
            fontSize: "{fontSizes.title.lg}",
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "{lineHeights.tight}",
            letterSpacing: "{letterSpacings.snug}",
        },
    },
    "heading-md": {
        value: {
            fontFamily: "heading",
            fontSize: "{fontSizes.title.md}",
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "{lineHeights.snug}",
            letterSpacing: "{letterSpacings.snug}",
        },
    },
    "heading-sm": {
        value: {
            fontFamily: "heading",
            fontSize: "{fontSizes.title.xs}",
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "{lineHeights.snug}",
            letterSpacing: "{letterSpacings.snug}",
        },
    },
    /** Below the title sizes a heading is `h6` — Inter Tight 14 / 600. */
    "heading-xs": { value: H6 },
    "body-lg": { value: { fontSize: "{fontSizes.body.lg}", lineHeight: "{lineHeights.relaxed}" } },
    "body-md": { value: { fontSize: "{fontSizes.body}", lineHeight: "{lineHeights.normal}" } },
    "body-sm": { value: { fontSize: "{fontSizes.body.sm}", lineHeight: "{lineHeights.normal}" } },
    /** A form / metric label. */
    "label-md": { value: label("{fontSizes.label.lg}", "{letterSpacings.caps}", "fg.subtle", NORMAL) },
    /** A small form / metric label. */
    "label-sm": { value: label("{fontSizes.label.sm}", "{letterSpacings.widest2}", "fg.subtle", TIGHT) },
    /** An overline — the eyebrow. */
    "overline": { value: EYEBROW },
    "code-sm": { value: { fontFamily: "mono", fontSize: "{fontSizes.label.lg}", ...TNUM } },
    "code-md": { value: { fontFamily: "mono", fontSize: "{fontSizes.body.sm}", ...TNUM } },
    "mono-kpi": { value: NUM_LG },

    /* ─── App shell chrome — app-layout.md › App bar, Sidebar ─
     *
     * The application chrome (sticky header, 240px sidebar). The colour
     * roles are semantic tokens, so dark mode inherits without change. */

    /** App bar row 1 — the breadcrumb's ancestors: mono 11 / 500 / 0.06em, `--ink-3`. */
    "breadcrumb": {
        value: {
            fontFamily: "mono",
            fontSize: "{fontSizes.label.lg}",
            fontWeight: "{fontWeights.medium}",
            letterSpacing: "{letterSpacings.wider}",
            color: "fg.muted",
        },
    },
    /** App bar row 2 — the surface title: DM Sans 24 / 700 / −0.015em, line
     *  height 1.1 (the comfortable bar). */
    "surface.title": {
        value: {
            fontFamily: "heading",
            fontSize: "{fontSizes.title.xl}",
            fontWeight: "{fontWeights.bold}",
            lineHeight: "1.1",
            letterSpacing: "{letterSpacings.tight}",
            color: "fg",
        },
    },
    /** App bar row 2, right — the state eyebrow: mono 10.5, uppercase. */
    "state.eyebrow": { value: label("{fontSizes.label.md}", "{letterSpacings.label}", "fg.subtle") },
    /** Sidebar section eyebrow — mono 9.5 / 600 / 0.18em, `--ink-4`. */
    "nav.eyebrow": { value: label("{fontSizes.label.xs}", "{letterSpacings.widest2}", "fg.subtle") },
    /** Sidebar item label — mono 11 / 600 / 0.12em uppercase. Colour
     *  intentionally omitted so callers control per-state (active vs. resting). */
    "nav.item": {
        value: {
            fontFamily: "mono",
            fontSize: "{fontSizes.label.lg}",
            fontWeight: "{fontWeights.semibold}",
            letterSpacing: "{letterSpacings.widest}",
            textTransform: "uppercase",
        },
    },
});
