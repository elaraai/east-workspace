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
        /* Mobile hygiene (#346): keep the browser from inflating text on
         * orientation change, and drop the grey tap flash — components give
         * their own pressed/selected feedback. */
        textSizeAdjust: "100%",
        WebkitTapHighlightColor: "transparent",
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
    /* The shared trash sink (#267) — a fixed bottom-centre zone the drag
     * layer portals in during any `remove`-capable drag. Dashed = ephemeral
     * (the stage vocabulary); danger tones because the drop is a removal.
     * Animates in via the shared fade keyframe; the active stage brightens
     * it like any sink. Never `data-drop-invalid` — a trash drop is always
     * structurally valid for a removable payload. */
    "[data-drag-trash]": {
        position: "fixed",
        /* Safe-area (#346): clear the home indicator on notched phones. */
        bottom: "calc(24px + env(safe-area-inset-bottom, 0px))",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1690,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: "120px",
        height: "44px",
        paddingInline: "18px",
        borderRadius: "{radii.md}",
        borderWidth: "1.5px",
        borderStyle: "dashed",
        borderColor: "fg.danger",
        background: "bg.danger.subtle",
        color: "fg.danger",
        fontSize: "18px",
        lineHeight: "1",
        userSelect: "none",
        animation: "elara-fade-in 0.15s ease-out",
    },
    "[data-drag-trash][data-drop-active]": {
        background: "bg.danger.subtle",
        outline: "2px solid",
        outlineColor: "fg.danger",
        outlineOffset: "-3px",
    },
    /* The three drop stages are drawn as an OVERLAY pseudo-element, not as an
     * `outline`. A cell's children may be absolutely positioned and paint over
     * the parent's outline: a Plan row's plot holds a full-height grid line at
     * every bucket edge, which chopped the frame into segments and read as a
     * broken border. An overlay with its own stacking order paints above them,
     * and `inset: 0` tracks the cell whatever its children do.
     *
     * The stages are mutually exclusive by construction — `valid` is the
     * drag-start candidate marking and stays set while a cell is hovered, so
     * without the `:not()` guards the dashed candidate frame would render
     * underneath the active/invalid one. */
    "[data-drag-cell][data-drop-valid], [data-drag-cell][data-drop-active], [data-drag-cell][data-drop-invalid], [data-drag-sink][data-drop-valid], [data-drag-sink][data-drop-active]": {
        position: "relative",
    },
    "[data-drag-cell][data-drop-valid]::before, [data-drag-cell][data-drop-active]::before, [data-drag-cell][data-drop-invalid]::before, [data-drag-sink][data-drop-valid]::before, [data-drag-sink][data-drop-active]::before": {
        content: '""',
        position: "absolute",
        inset: "0",
        pointerEvents: "none",
        zIndex: 4,
        borderRadius: "inherit",
    },
    /* Candidate: a dashed inset frame per the spec's "dashed = ephemeral"
     * stroke — the earlier flat brand wash read washed-out when a whole grid of
     * cells was valid at once. Suppressed once the cell becomes the active or
     * the vetoed one, so exactly one stage is ever painted. */
    "[data-drag-cell][data-drop-valid]:not([data-drop-active]):not([data-drop-invalid])::before, [data-drag-sink][data-drop-valid]:not([data-drop-active])::before": {
        borderWidth: "1px",
        borderStyle: "dashed",
        borderColor: "{colors.brand.500}",
    },
    /* Active: the cell the pointer is actually over. */
    "[data-drag-cell][data-drop-active]:not([data-drop-invalid])::before, [data-drag-sink][data-drop-active]::before": {
        borderWidth: "2px",
        borderStyle: "solid",
        borderColor: "{colors.brand.600}",
    },
    "[data-drag-cell][data-drop-active]:not([data-drop-invalid]), [data-drag-sink][data-drop-active]": {
        background: "bg.brand.subtle",
    },
    /* A connected-but-vetoed cell (duplicate person, host `canAssign` veto)
     * while hovered — red frame + the circle-with-cross badge, and the
     * not-allowed cursor, per the Schematic connect-tool danger treatment.
     * Outranks both stages above: a refusal must never read as an invitation. */
    "[data-drag-cell][data-drop-invalid]::before": {
        borderWidth: "2px",
        borderStyle: "solid",
        borderColor: "fg.danger",
    },
    "[data-drag-cell][data-drop-invalid]": {
        background: "bg.danger.subtle",
        cursor: "not-allowed",
        "&::after": {
            content: '"⊘"',
            position: "absolute",
            top: "2px",
            right: "6px",
            fontSize: "14px",
            lineHeight: "1",
            color: "fg.danger",
            pointerEvents: "none",
            zIndex: 5,
        },
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
