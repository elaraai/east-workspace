/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Named layer-style presets for the Elara Chakra v3 system.
 *
 * `<Box layerStyle="frame" />` — and the canonical 1 px subtle border,
 * 10 px radius, no shadow, `tnum 1` are baked in. Authors don't pick a
 * radius, padding, or border value; they pick a role.
 *
 * @packageDocumentation
 */

import { defineLayerStyles } from "@chakra-ui/react";

export const layerStyles = defineLayerStyles({
    /* ─── Pattern frame — every pattern card sits inside one ─
     *
     * Spec `.frame`: white fill, 1 px rule border, 10 px radius,
     * **no shadow**, overflow hidden. The canon "rule" colour
     * (`gray.200` / `border.subtle`) reads near-invisible against the
     * gray.50 canvas main bg, so we lift to `border.strong` (`gray.300`)
     * — same hue, +1 step of contrast — to actually render the cut. */
    "frame": {
        value: {
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "10px",
            overflow: "hidden",
        },
    },
    /** Tighter frame variant — 6 px radius, no shadow. */
    "frame.flat": {
        value: {
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "{radii.md}",
            overflow: "hidden",
        },
    },
    /** Marketing-tier frame — 12 px radius + soft shadow (one of the only
     * surfaces in the spec that carries elevation at rest). */
    "frame.lg": {
        value: {
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "12px",
            boxShadow: "sm",
            overflow: "hidden",
        },
    },

    /* ─── Cards — the workhorse list-row surface ────────────
     *
     * Smaller, denser than `frame`. Used by Card renderer for in-page
     * list items, panel rows, sub-cards. */
    "card": {
        value: {
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "{radii.md}",
            padding: "4",
        },
    },
    "card.flat": {
        value: {
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "{radii.md}",
            padding: "4",
        },
    },
    "card.elevated": {
        value: {
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "{radii.md}",
            padding: "4",
            boxShadow: "md",
        },
    },

    /* ─── Surfaces — utility regions ────────────────────────
     *
     * Strips and rails used inside frames. */
    "surface.muted": {
        value: {
            background: "bg.muted",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "{radii.sm}",
            padding: "3",
        },
    },
    "surface.canvas": {
        value: {
            background: "bg.canvas",
        },
    },
    "surface.inverse": {
        value: {
            background: "bg.inverse",
            color: "fg.inverse",
        },
    },
    /** Frame header strip — spec `.eyebrow-row` */
    "surface.frameHead": {
        value: {
            background: "bg.canvas",
            padding: "12px 20px",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
        },
    },
    /** Sticky bottom action strip — spec `.commit-bar`, `.diff-foot`, `.bf2-foot`. */
    "surface.commitBar": {
        value: {
            background: "bg.canvas",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
        },
    },

    /* ─── App shell — bsys "Header recipe" / "Sidebar recipe" ──── */

    /** Sticky top header bar — `bg.canvas` (paper-2) so chrome shares
     *  a plane with main, leaving the white `paper` surface exclusively
     *  to Frame cards. The 1 px bottom rule keeps the hard cut when
     *  content scrolls behind the sticky header — `border.strong`
     *  (gray.300) instead of `border.subtle` because the same-luminance
     *  rule against the canvas would be near-invisible otherwise.
     *
     *  Side gutter is the bsys Main recipe value (`24 px`) so the Row 2
     *  surface title aligns with the row cards' left edge below it
     *  (which use the same 24 px offset from the sidebar rule). */
    "header.bar": {
        value: {
            background: "bg.canvas",
            borderBottomWidth: "1px",
            borderBottomColor: "border.strong",
            paddingInline: "{spacing.6}",       // 24 px — bsys Main recipe
            paddingBlock: "{spacing.3}",        // 12 px (close to spec's 14 / 16 ladder)
        },
    },
    /** Sidebar panel surface — `paper-2` bg, 1 px right rule. Spec says
     *  `border.subtle` against `bg.canvas`, but at the same lightness the
     *  rule reads near-invisible — `border.strong` (gray.300) keeps the
     *  hue but lifts the contrast enough to render against the canvas. */
    "nav.panel": {
        value: {
            background: "bg.canvas",
            borderRightWidth: "1px",
            borderRightColor: "border.strong",
        },
    },
    /** Sidebar logo region — bsys "Logo region" rules. Fixed-height strip
     *  pinned to the top of the sidebar that holds *only* the wordmark or
     *  app-mark; no badges / version / toggles / search. Vertical rhythm
     *  comes from the region height, not the glyph inside it. No bottom
     *  rule — separation from the first item is a 12 px rule-free gap.
     *
     *  Layout properties (`display: flex`, `alignItems: center`,
     *  `justifyContent`) stay on the consumer Box — Chakra's layer-style
     *  validator restricts entries to surface-level CSS (bg / border /
     *  padding / radius / shadow). */
    "nav.logo": {
        value: {
            paddingInline: "16px",
        },
    },

    /* ─── Banners — full surround, no left-accent stripe ────
     *
     * Spec `.bn.*` and `.banner.*`. Each variant pairs a very low-tint
     * background with a 1 px coloured border. No 4 px left accent. */
    "banner.stale": {
        value: {
            background: "bg.warning.subtle",
            borderWidth: "1px",
            borderColor: "fg.warning",
            borderRadius: "4px",
            padding: "10px 14px",
        },
    },
    "banner.partial": {
        value: {
            background: "bg.info.subtle",
            borderWidth: "1px",
            borderColor: "fg.info",
            borderRadius: "4px",
            padding: "10px 14px",
        },
    },
    "banner.change": {
        value: {
            background: "bg.brand.subtle",
            borderWidth: "1px",
            borderColor: "border.brand",
            borderRadius: "4px",
            padding: "10px 14px",
        },
    },
    "banner.error": {
        value: {
            background: "bg.danger.subtle",
            borderWidth: "1px",
            borderColor: "fg.danger",
            borderRadius: "4px",
            padding: "10px 14px",
        },
    },
    "banner.ok": {
        value: {
            background: "bg.success.subtle",
            borderWidth: "1px",
            borderColor: "fg.success",
            borderRadius: "4px",
            padding: "10px 14px",
        },
    },
    "banner.guard": {
        value: {
            background: "bg.warning.subtle",
            borderWidth: "1px",
            borderColor: "fg.warning",
            borderRadius: "4px",
            padding: "10px 14px",
        },
    },
    /** Dashed surround for ephemeral / stale / partial banners — spec `.banner`. */
    "banner.dashed.stale": {
        value: {
            background: "bg.surface",
            borderTopWidth: "1px",
            borderTopStyle: "dashed",
            borderTopColor: "border.strong",
            borderBottomWidth: "1px",
            borderBottomStyle: "dashed",
            borderBottomColor: "border.strong",
            padding: "12px 20px",
        },
    },

    /* Note: pill / chip is intentionally NOT a layer-style — Chakra's
     * layer-style validator constrains values to surface-level properties
     * (bg, border, padding, radius, shadow). Pills carry display + font
     * + gap, so they live in the `tag` single-part recipe instead
     * (see `theme/recipes/tag.ts`). */

    /* ─── Dark code / log panels ─────────────────────────────
     *
     * Used by e3-ui-components for the EastValueViewer (decoded value
     * inspector) and VirtualizedLogViewer (task log streaming). These are
     * deliberately dark surfaces — they're code / terminal contexts, not
     * regular content. Anchored to `gray.900` so they read as "ink" even
     * in light mode. */
    "surface.code.dark": {
        value: {
            background: "{colors.gray.900}",
            color: "{colors.gray.100}",
            borderWidth: "1px",
            borderColor: "{colors.gray.800}",
            borderRadius: "{radii.md}",
        },
    },
    "surface.log.dark": {
        value: {
            background: "{colors.gray.900}",
            color: "{colors.gray.300}",
            borderWidth: "1px",
            borderColor: "{colors.gray.800}",
        },
    },
});
