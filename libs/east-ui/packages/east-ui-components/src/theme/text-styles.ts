/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Named text-style presets for the Elara Chakra v3 system.
 *
 * Components consume them via `<Text textStyle="eyebrow" />` etc. — that's
 * what enforces the canonical typography rules from the UX/UI Guide:
 *  - Display headings use DM Sans with negative tracking.
 *  - Body uses Inter Tight, line-height 1.5–1.625.
 *  - Eyebrow is the only positively-tracked, uppercase element.
 *  - Mono is JetBrains Mono with `tabular-nums` for tabular numerics.
 *
 * @packageDocumentation
 */

import { defineTextStyles } from "@chakra-ui/react";

export const textStyles = defineTextStyles({
    /* ─── Display family — DM Sans, tight tracking ─────────── */

    "display.xl": {
        value: {
            fontFamily: "heading",
            fontSize: "{fontSizes.7xl}",       // 48px
            fontWeight: "{fontWeights.bold}",
            lineHeight: "1.1",
            letterSpacing: "{letterSpacings.tighter}", // -0.02em
        },
    },
    "display.lg": {
        value: {
            fontFamily: "heading",
            fontSize: "{fontSizes.6xl}",       // 36px
            fontWeight: "{fontWeights.bold}",
            lineHeight: "{lineHeights.tight}",
            letterSpacing: "{letterSpacings.tight}",   // -0.015em
        },
    },
    "display.md": {
        value: {
            fontFamily: "heading",
            fontSize: "{fontSizes.5xl}",       // 30px
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "{lineHeights.snug}",
            letterSpacing: "{letterSpacings.snug}",    // -0.01em
        },
    },
    "display.sm": {
        value: {
            fontFamily: "heading",
            fontSize: "{fontSizes.4xl}",       // 24px
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "{lineHeights.snug}",
            letterSpacing: "{letterSpacings.snug}",
        },
    },
    "display.xs": {
        value: {
            fontFamily: "heading",
            fontSize: "{fontSizes.3xl}",       // 20px
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "{lineHeights.snug}",
        },
    },

    /* ─── Card / inline title — DM Sans medium ─────────────── */

    "title.card": {
        value: {
            fontFamily: "heading",
            fontSize: "{fontSizes.2xl}",       // 18px
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "1.3",
            letterSpacing: "{letterSpacings.snug}",
        },
    },
    "title.row": {
        value: {
            fontFamily: "heading",
            fontSize: "{fontSizes.lg}",        // 14px
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "1.3",
        },
    },

    /* ─── Body — Inter Tight ───────────────────────────────── */

    "body.lg": {
        value: {
            fontSize: "{fontSizes.xl}",        // 16px (marketing default)
            lineHeight: "{lineHeights.relaxed}",
        },
    },
    "body.md": {
        value: {
            fontSize: "{fontSizes.lg}",        // 14px (product default)
            lineHeight: "{lineHeights.normal}",
        },
    },
    "body.sm": {
        value: {
            fontSize: "{fontSizes.md}",        // 13px (compact)
            lineHeight: "{lineHeights.normal}",
        },
    },
    "lead": {
        value: {
            fontSize: "{fontSizes.2xl}",       // 18px
            lineHeight: "{lineHeights.relaxed}",
            color: "fg.muted",
        },
    },
    "small": {
        value: {
            fontSize: "{fontSizes.lg}",        // 14px
            lineHeight: "{lineHeights.normal}",
            color: "fg.muted",
        },
    },
    "caption": {
        value: {
            fontSize: "{fontSizes.sm}",        // 12px
            lineHeight: "{lineHeights.normal}",
            letterSpacing: "{letterSpacings.wide}",   // +0.02em
            color: "fg.subtle",
        },
    },

    /* ─── Eyebrow — the brand-marked section label ─────────── */

    "eyebrow": {
        value: {
            fontFamily: "body",
            fontSize: "{fontSizes.sm}",        // 12px
            fontWeight: "{fontWeights.bold}",
            lineHeight: "{lineHeights.normal}",
            letterSpacing: "{letterSpacings.widest}", // +0.12em
            textTransform: "uppercase",
            color: "{colors.brand.600}",
        },
    },

    /* ─── Sub-label — section dividers within a card ───────── */

    "sublabel": {
        value: {
            fontFamily: "body",
            fontSize: "{fontSizes.xs}",        // 11px
            fontWeight: "{fontWeights.semibold}",
            lineHeight: "{lineHeights.normal}",
            letterSpacing: "{letterSpacings.wider}",  // +0.06em
            textTransform: "uppercase",
            color: "fg.subtle",
        },
    },

    /* ─── Mono — JetBrains Mono with tabular figures ───────── */

    "mono.sm": {
        value: {
            fontFamily: "mono",
            fontSize: "{fontSizes.sm}",        // 12px
            fontVariantNumeric: "tabular-nums",
            fontFeatureSettings: '"tnum"',
        },
    },
    "mono.md": {
        value: {
            fontFamily: "mono",
            fontSize: "{fontSizes.md}",        // 13px
            fontVariantNumeric: "tabular-nums",
            fontFeatureSettings: '"tnum"',
        },
    },
    "mono.lg": {
        value: {
            fontFamily: "mono",
            fontSize: "{fontSizes.lg}",        // 14px
            fontVariantNumeric: "tabular-nums",
            fontFeatureSettings: '"tnum"',
        },
    },
});
