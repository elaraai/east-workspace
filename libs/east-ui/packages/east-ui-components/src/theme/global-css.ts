/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Global CSS for the Elara Chakra v3 system.
 *
 *  - Imports the brand fonts (DM Sans, Inter Tight, JetBrains Mono).
 *  - Sets the html/body baseline (Inter Tight, fg, bg.canvas).
 *  - Honours `prefers-reduced-motion: reduce`.
 *  - Universal focus-visible — any element with `data-focus-visible`
 *    or focused via keyboard gets the canonical 3 px brand-tinted ring.
 *
 * @packageDocumentation
 */

import { defineGlobalStyles } from "@chakra-ui/react";

export const globalCss = defineGlobalStyles({
    "@import": [
        "url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=Inter+Tight:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap')",
    ],

    "html, body": {
        margin: 0,
        padding: 0,
        fontFamily: "body",
        color: "fg",
        background: "bg.canvas",
        WebkitFontSmoothing: "antialiased",
        textRendering: "optimizeLegibility",
    },

    "*, *::before, *::after": {
        boxSizing: "border-box",
    },

    /* Code / pre default to mono with the soft inline chip treatment. */
    "code, pre": {
        fontFamily: "mono",
    },

    /* Number-aware default — numerics should align column-wise unless
     * a parent overrides. Applies in cells, KPIs, deltas. */
    "[data-numeric]": {
        fontVariantNumeric: "tabular-nums",
        fontFeatureSettings: '"tnum"',
    },

    /* Reduced motion — replace transitions with instant. Per UX/UI Guide §11. */
    "@media (prefers-reduced-motion: reduce)": {
        "*, *::before, *::after": {
            animationDuration: "0.001ms !important",
            animationIterationCount: "1 !important",
            transitionDuration: "0.001ms !important",
        },
    },

    /* Universal focus-visible. Any focusable element receives the canonical
     * 3 px brand-tinted box-shadow. Component recipes can override per case. */
    ":focus-visible": {
        outline: "none",
        boxShadow: "{shadows.focus}",
    },

    /* Keyframes used by Spinner / pulsing dots. */
    "@keyframes elara-pulse": {
        "0%, 100%": { opacity: 1 },
        "50%":      { opacity: 0.4 },
    },
    "@keyframes elara-spin": {
        from: { transform: "rotate(0deg)" },
        to:   { transform: "rotate(360deg)" },
    },
    "@keyframes elara-shimmer": {
        from: { backgroundPosition: "200% 0" },
        to:   { backgroundPosition: "-200% 0" },
    },
});
