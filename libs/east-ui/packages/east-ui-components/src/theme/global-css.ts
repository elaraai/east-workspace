/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Global CSS for the Elara Chakra v3 system.
 *
 *  - Sets the html/body baseline (Inter Tight, fg, bg.canvas).
 *  - Honours `prefers-reduced-motion: reduce`.
 *  - Universal focus-visible — any element with `data-focus-visible`
 *    or focused via keyboard gets the canonical 3 px brand-tinted ring.
 *
 * Brand fonts (DM Sans, Inter Tight, JetBrains Mono) are self-hosted via
 * `@fontsource-variable/*` packages imported for side effects from
 * `src/index.ts`. No CDN @import here — the VS Code extension webview's
 * CSP (`font-src ${cspSource}`) would block it.
 *
 * Keyframes live in `theme.keyframes` (see `theme/keyframes.ts`), not
 * here — Chakra v3's `SystemStyleObject` validator rejects percentage
 * step keys, and the dedicated keyframes config slot accepts them as
 * first-class citizens.
 *
 * @packageDocumentation
 */

import { defineGlobalStyles, type SystemStyleObject } from "@chakra-ui/react";

/* Reduced-motion reset. Built via `Record<string, SystemStyleObject>` and
 * then narrowed to `SystemStyleObject`. Chakra v3's `SystemStyleObject` is
 * a hybrid type (explicit CSS-property keys + an index signature for
 * arbitrary selectors), so TS's excess-property check rejects a literal
 * with selector-only keys like `"*"`. Building through the loose record
 * type bypasses that check; the runtime shape is unchanged. */
const reducedMotionStep: Record<string, SystemStyleObject> = {
    "*": {
        animationDuration: "0.001ms !important",
        animationIterationCount: "1 !important",
        transitionDuration: "0.001ms !important",
    },
    "*::before": {
        animationDuration: "0.001ms !important",
        animationIterationCount: "1 !important",
        transitionDuration: "0.001ms !important",
    },
    "*::after": {
        animationDuration: "0.001ms !important",
        animationIterationCount: "1 !important",
        transitionDuration: "0.001ms !important",
    },
};
const reducedMotionRules = reducedMotionStep as SystemStyleObject;

export const globalCss = defineGlobalStyles({
    "html, body": {
        margin: 0,
        padding: 0,
        fontFamily: "body",
        color: "fg",
        background: "bg.canvas",
        textRendering: "optimizeLegibility",
    },

    "*, *::before, *::after": {
        boxSizing: "border-box",
    },

    /* Code / pre default to mono with the soft inline chip treatment. */
    "code, pre": {
        fontFamily: "mono",
    },

    /* Font Awesome ships `vertical-align: -0.125em` on every icon to align
     * it next to text baselines. Inside flex/grid centered containers
     * (Steps indicators, Timeline indicators, IconButton, etc.) that
     * shoves the icon a couple of pixels low. Reset to 0 globally — the
     * inline-with-text case is rare and easy to opt back in per-callsite. */
    ".svg-inline--fa": {
        verticalAlign: 0,
    },

    /* Number-aware default — numerics should align column-wise unless
     * a parent overrides. Applies in cells, KPIs, deltas. */
    "[data-numeric]": {
        fontVariantNumeric: "tabular-nums",
        fontFeatureSettings: '"tnum"',
    },

    /* Plain <table> elements default to spec chrome — tnum on, full width,
     * body font. Slot-recipe `table` overrides for compound contexts. */
    "table": {
        fontFamily: "body",
        borderCollapse: "collapse",
        width: "100%",
        fontFeatureSettings: '"tnum" 1',
    },

    /* Bare <kbd> follows the same look as the `kbd` recipe — flat, no
     * drop shadow, 3 px radius. */
    "kbd": {
        fontFamily: "mono",
        fontSize: "10px",
        fontWeight: "{fontWeights.semibold}",
        letterSpacing: "{letterSpacings.wide}",
        background: "bg.subtle",
        borderWidth: "1px",
        borderColor: "border.strong",
        borderRadius: "3px",
        paddingX: "{spacing.2}",
        paddingY: "1px",
        color: "fg",
    },

    /* Dashed hairline separator (spec uses for ephemeral / stale rules). */
    "hr.dashed": {
        border: "0",
        borderTop: "1px dashed",
        borderTopColor: "border.strong",
        margin: "0",
    },

    /* ─── Drag & drop stages (drag-drop-visuals) ─────────────────────────
     * The DragLayerProvider drives these via data attributes; surfaces get
     * the treatment for free by registering cells/sinks.
     *
     * Scoped `:not([data-scope])` so it dims only our own drag origins —
     * Ark/Zag widgets (Slider, etc.) set `data-dragging` on themselves for
     * their own drag state and carry a `data-scope`; without this exclusion
     * a slider goes to 40% opacity while its thumb is dragged. */
    "[data-dragging]:not([data-scope])": {
        opacity: "0.4",
    },
    "[data-drag-ghost]": {
        opacity: "0.8",
    },
    /* Valid destinations are marked before the drop (indicators precede).
     * A flat wash, not an outline — adjacent grid cells would double their
     * outlines along shared edges. */
    "[data-drag-cell][data-drop-valid]": {
        background: "{colors.brand.50}",
    },
    /* Only the active cell carries the outline, inset clear of its
     * neighbours' borders. */
    "[data-drag-cell][data-drop-active], [data-drag-sink][data-drop-active]": {
        background: "bg.brand.subtle",
        outline: "2px solid",
        outlineColor: "{colors.brand.600}",
        outlineOffset: "-3px",
    },

    /* Reduced motion — replace transitions with instant.
     * See `reducedMotionRules` above for why this is extracted. */
    "@media (prefers-reduced-motion: reduce)": reducedMotionRules,

    /* Universal focus-visible: strip the browser default outline. Components
     * opt in to the brand-tinted focus ring via their own recipe
     * `_focusVisible` declarations (Button, IconButton). Inputs (Input,
     * Select, Combobox, Slider, Date / Time inputs, SegmentGroup) signal
     * focus via border-colour change only — no shadow ring. */
    ":focus-visible": {
        outline: "none",
    },
});
