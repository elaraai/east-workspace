/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Global CSS for the Elara Chakra v3 system — the East Design System's base
 * element styles (`app_design_system/_ds_bundle.css`).
 *
 *  - Sets the html/body baseline (Inter Tight, `--ink`, `--paper-2`, tabular
 *    figures).
 *  - Makes brand the default colour palette; text selection stays neutral.
 *  - `h1` … `h6` take the design system's title styles (24 / 20 / 18 / 16 /
 *    15, then Inter Tight 14), keeping the text colour of their surface; a
 *    link is `--brand-d`, `--brand-dd` and underlined under the pointer;
 *    inline `code` is the `--paper-3` chip and a bare `kbd` the key cap.
 *    The design system's `p` rule is not applied: Chakra's `<Text>` renders
 *    a `<p>`, and an element rule would override the size and ink it
 *    inherits from its parent. The text classes are text styles
 *    (`text-styles.ts`) instead.
 *  - Honours `prefers-reduced-motion: reduce`.
 *  - Universal focus-visible — the browser's outline gives way to the one
 *    focus ring, `--shadow-focus` (3px of `--brand` at 35%; of the lifted
 *    `--brand-d` at 80% in dark). A recipe's own `_focusVisible` (an inset
 *    ring on a cell, `none` inside a field's chrome) still wins: recipes
 *    sit in a later cascade layer than these global styles.
 *
 * Brand fonts (DM Sans, Inter Tight, JetBrains Mono) are self-hosted via
 * the `@fontsource-variable/*` stylesheets that an app registers with one
 * import of `@elaraai/east-ui-components/fonts` (`src/fonts.ts`). No CDN
 * @import here — the VS Code extension webview's CSP
 * (`font-src ${cspSource}`) would block it.
 *
 * Keyframes live in `theme.keyframes` (see `theme/keyframes.ts`), not
 * here — Chakra v3's `SystemStyleObject` validator rejects percentage
 * step keys, and the dedicated keyframes config slot accepts them as
 * first-class citizens.
 *
 * @packageDocumentation
 */

import { defineGlobalStyles, type SystemStyleObject } from "@chakra-ui/react";
import { faBan } from "@fortawesome/free-solid-svg-icons";
import { headingStyles } from "./text-styles.js";
import { iconMask } from "./icon-mask.js";

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
        /* Every numeral tabular (component-rules §2). */
        fontFeatureSettings: '"tnum" 1',
        /* Mobile hygiene (#346): keep the browser from inflating text on
         * orientation change, and drop the grey tap flash — components give
         * their own pressed/selected feedback. */
        textSizeAdjust: "100%",
        WebkitTapHighlightColor: "transparent",
    },

    /* Brand is the default palette (#1091), set where Chakra sets its own
     * (`gray`): a part with no `colorPalette` of its own — a default
     * <Button>, a checked <Switch> — takes the design system's brand. A part
     * the design system draws neutral sets `gray` in its own recipe. */
    html: {
        colorPalette: "brand",
    },

    /* Chakra tints a text selection with the palette's `emphasized` role, a
     * deep teal under the brand in light and a pale cyan in dark — neither
     * leaves the text readable — so the selection keeps the neutral it had.
     * `bg`, Chakra's own key, so this replaces its value. */
    "*::selection": {
        bg: "gray.emphasized/80",
    },

    "*, *::before, *::after": {
        boxSizing: "border-box",
    },

    /* Headings — the design system's title styles. */
    "h1": headingStyles.h1,
    "h2": headingStyles.h2,
    "h3": headingStyles.h3,
    "h4": headingStyles.h4,
    "h5": headingStyles.h5,
    "h6": headingStyles.h6,

    /* Links — `--brand-d`, `--brand-dd` and underlined under the pointer. */
    "a": {
        color: "link",
        textDecoration: "none",
    },
    "a:hover": {
        color: "link.hover",
        textDecoration: "underline",
        textUnderlineOffset: "2px",
    },

    /* Code / pre are mono; inline code is the `--paper-3` chip. */
    "code, pre": {
        fontFamily: "mono",
    },
    ":not(pre) > code": {
        fontSize: "0.92em",
        background: "bg.subtle",
        paddingBlock: "1px",
        paddingInline: "5px",
        borderRadius: "{radii.sm}",
        color: "fg",
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

    /* A bare <kbd> is the design system's key cap (parts-kbd-avatar): 20px
     * tall, mono 11 / 500 in `--ink-2`, case kept, on `--paper-2` in a 1px
     * `--rule-strong` ring — flat, no shadow. */
    "kbd": {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        height: "20px",
        minWidth: "20px",
        paddingInline: "{spacing.1}",
        fontFamily: "mono",
        fontSize: "{fontSizes.label.lg}",
        fontWeight: "{fontWeights.medium}",
        lineHeight: "1",
        background: "bg.canvas",
        borderWidth: "1px",
        borderColor: "border.strong",
        borderRadius: "{radii.sm}",
        color: "fg.strong",
        whiteSpace: "nowrap",
        verticalAlign: "middle",
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
    /* The ghost's wrapper (dnd-kit's overlay, #608) takes no pointer: the
     * layer hit-tests what lies UNDER the pointer, and the ghost must never be
     * it. */
    ".east-drag-ghost": {
        pointerEvents: "none",
    },
    /* The ghost's caption (#1187): a line under the ghost saying where the
     * drop would land — mono, on the paper in a `--rule-strong` ring — or,
     * red, why the cell under it refuses it. As wide as its words: the
     * overlay is the size of what was picked up, a row's grip as much as a
     * card. */
    "[data-drag-caption]": {
        width: "max-content",
        marginTop: "{spacing.1}",
        paddingInline: "{spacing.2}",
        paddingBlock: "{spacing.1}",
        fontFamily: "mono",
        fontSize: "{fontSizes.label.md}",
        lineHeight: "{lineHeights.tight}",
        color: "fg.muted",
        background: "bg.surface",
        borderWidth: "1px",
        borderStyle: "solid",
        borderColor: "border.strong",
        borderRadius: "{radii.sm}",
        whiteSpace: "nowrap",
    },
    "[data-drag-caption][data-refused]": {
        color: "fg.danger",
        borderColor: "status.neg",
    },
    /* A draggable is a keyboard control (#608): focused, Space / Enter picks
     * it up. The global reset below strips focus outlines, so it wears the
     * brand ring the moment the keyboard reaches it. */
    "[data-draggable]:focus-visible": {
        outline: "2px solid",
        outlineColor: "brandMark",
        outlineOffset: "2px",
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
        borderColor: "status.neg",
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
        outlineColor: "status.neg",
        outlineOffset: "-3px",
    },
    /* The three drop stages are drawn as an OVERLAY pseudo-element, not as an
     * `outline`. A cell's children may be absolutely positioned and paint over
     * the parent's outline: a Plan row's plot holds a full-height grid line at
     * every bucket edge, which chopped the frame into segments and read as a
     * broken border. An overlay with its own stacking order paints above them,
     * and `inset: 0` tracks the cell whatever its children do.
     *
     * CELLS only. A sink keeps the plain `outline` treatment (see below) —
     * anchoring an overlay would mean forcing `position: relative` on it, which
     * outranks the shared trash zone's own `position: fixed`.
     *
     * The stages are mutually exclusive by construction — `valid` is the drag
     * layer's record of structural validity and stays set while a cell is
     * hovered, so without the `:not()` guards the dashed candidate frame would
     * render underneath the active/invalid one. */
    "[data-drag-cell][data-drop-valid], [data-drag-cell][data-drop-active], [data-drag-cell][data-drop-invalid]": {
        position: "relative",
    },
    "[data-drag-cell][data-drop-valid]::before, [data-drag-cell][data-drop-active]::before, [data-drag-cell][data-drop-invalid]::before": {
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
    "[data-drag-cell][data-drop-valid]:not([data-drop-active]):not([data-drop-invalid])::before": {
        borderWidth: "1px",
        borderStyle: "dashed",
        borderColor: "brandMark",
    },
    /* Active: the cell the pointer is actually over. */
    "[data-drag-cell][data-drop-active]:not([data-drop-invalid])::before": {
        borderWidth: "2px",
        borderStyle: "solid",
        borderColor: "brand.solid",
    },
    "[data-drag-cell][data-drop-active]:not([data-drop-invalid])": {
        background: "bg.brand.subtle",
    },
    /* SINKS keep the original outline treatment. The overlay exists for cells
     * whose children paint over an outline (a Plan row's bucket grid lines); a
     * sink has no such children, and forcing `position: relative` on one to
     * anchor an overlay would outrank the shared trash zone's `position: fixed`
     * — two attribute selectors beat `[data-drag-trash]`, so the trash would
     * leave the viewport and `remove` would become unreachable. */
    "[data-drag-sink][data-drop-valid]": {
        outline: "1px dashed",
        outlineColor: "brandMark",
        outlineOffset: "-2px",
    },
    "[data-drag-sink][data-drop-active]": {
        background: "bg.brand.subtle",
        outline: "2px solid",
        outlineColor: "brand.solid",
        outlineOffset: "-3px",
    },
    /* A connected-but-vetoed cell (duplicate person, host `canAssign` veto)
     * while hovered — red frame + the ban badge, and the not-allowed cursor,
     * per the Schematic connect-tool danger treatment. Outranks both stages
     * above: a refusal must never read as an invitation. */
    "[data-drag-cell][data-drop-invalid]::before": {
        borderWidth: "2px",
        borderStyle: "solid",
        borderColor: "status.neg",
    },
    "[data-drag-cell][data-drop-invalid]": {
        background: "bg.danger.subtle",
        cursor: "not-allowed",
        /* The badge is Font Awesome's solid ban, never a text glyph — the
         * canvas's fonts lack one, and a fallback font drew it malformed
         * (#1261). It is a mark: the valence base, as the state icons are. */
        "&::after": {
            ...iconMask(faBan, "14px", "status.neg"),
            position: "absolute",
            top: "2px",
            right: "6px",
            pointerEvents: "none",
            zIndex: 5,
        },
    },

    /* Reduced motion — replace transitions with instant.
     * See `reducedMotionRules` above for why this is extracted. */
    "@media (prefers-reduced-motion: reduce)": reducedMotionRules,

    /* Universal focus-visible: no browser outline — the focus ring, the one
     * shadow the design system allows (tokens/layout.css › --shadow-focus). */
    ":focus-visible": {
        outline: "none",
        boxShadow: "focus",
    },
});
