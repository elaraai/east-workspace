/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { coarseHitArea } from "../../style/hit-area.js";

/**
 * Configurator slot recipe — the control table beside a live preview.
 *
 * The layout is the designer's: a bordered card split into a control column and
 * a narrower sidebar. Control rows are a fixed label gutter plus the control,
 * separated by hairline rules; the sidebar stacks a preview stage, an optional
 * aside, and the spec readout, divided by the same rules.
 *
 * Every value is a semantic token — the whole point of putting this in a recipe
 * is that restyling all 60+ configurator surfaces is a one-file change.
 *
 * The `data-stacked` attribute is set by the renderer when the container is too
 * narrow for two columns (see `useContainerBelow`); the recipe collapses the
 * grid to a single column rather than letting the sidebar crush.
 *
 * The `data-controls-collapsed` attribute is set when the viewer collapses the
 * control column to its rail (the Dock chrome): the grid hands the freed width
 * to the sidebar so the preview gets the room.
 */
export const configuratorSlotRecipe = defineSlotRecipe({
    className: "east-configurator",
    slots: [
        "root",
        "controls",
        "controlsHeader",
        "controlsRail",
        "railLabel",
        "toggle",
        "row",
        "rowLabel",
        "rowControl",
        "rowHint",
        "sidebar",
        "sidebarHeader",
        "sidebarTitle",
        "livePip",
        "liveLabel",
        "preview",
        "aside",
        "asideTitle",
        "spec",
        "specRow",
        "specLabel",
        "specValue",
    ],
    base: {
        root: {
            display: "grid",
            /* The PREVIEW side owns the width: controls are capped and shrink
             * first (their SegmentGroups wrap), the sidebar takes everything
             * else with minWidth: 0 so wide previews (tables, calendars,
             * benches) fit instead of clipping at a fixed sidebar width. */
            gridTemplateColumns: "minmax(220px, var(--cfg-controls, 340px)) minmax(0, 1fr)",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "lg",
            background: "bg.surface",
            overflow: "hidden",
            "&[data-stacked]": { gridTemplateColumns: "1fr" },
            "&[data-controls-collapsed]": { gridTemplateColumns: "auto 1fr" },
            "&[data-controls-collapsed][data-stacked]": { gridTemplateColumns: "1fr" },
        },

        /* ── control column ─────────────────────────────── */
        controls: {
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
        },
        controlsHeader: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingInline: "5",
            paddingBlock: "2",
            borderBottomWidth: "1px",
            borderColor: "border.subtle",
            background: "bg.subtle",
        },
        /* Collapsed control column — the Dock rail chrome: a slim clickable
         * strip whose chevron (and vertical label) expands the controls back. */
        controlsRail: {
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "2",
            paddingBlock: "3",
            paddingInline: "1.5",
            color: "fg.muted",
            cursor: "pointer",
            /* Touch hit target (#350). */
            ...coarseHitArea({ position: true }),
            transitionProperty: "background",
            transitionDuration: "{durations.fast}",
            transitionTimingFunction: "{easings.out}",
            _hover: { background: "bg.subtle" },
            "&[data-stacked]": {
                flexDirection: "row",
                paddingInline: "3",
                paddingBlock: "1.5",
            },
        },
        railLabel: {
            textStyle: "caption",
            fontFamily: "mono",
            textTransform: "uppercase",
            letterSpacing: "wide",
            color: "fg.muted",
            userSelect: "none",
            writingMode: "vertical-rl",
            "[data-stacked] &": { writingMode: "horizontal-tb" },
        },
        toggle: {
            color: "fg.muted",
            flexShrink: 0,
            /* Touch hit target (#350). */
            ...coarseHitArea({ position: true }),
        },
        row: {
            display: "grid",
            gridTemplateColumns: "var(--cfg-label, 140px) 1fr",
            alignItems: "center",
            gap: "4",
            paddingInline: "5",
            paddingBlock: "4",
            borderBottomWidth: "1px",
            borderColor: "border.subtle",
            minWidth: 0,
            "&:last-of-type": { borderBottomWidth: "0" },
            "&[data-stacked]": {
                gridTemplateColumns: "1fr",
                gap: "2",
                alignItems: "start",
            },
        },
        rowLabel: {
            textStyle: "caption",
            fontFamily: "mono",
            textTransform: "uppercase",
            letterSpacing: "wide",
            color: "fg.muted",
            userSelect: "none",
        },
        rowControl: {
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "3",
            minWidth: 0,
        },
        rowHint: {
            textStyle: "caption",
            fontFamily: "mono",
            textTransform: "uppercase",
            letterSpacing: "wide",
            color: "fg.subtle",
        },

        /* ── sidebar ────────────────────────────────────── */
        sidebar: {
            display: "flex",
            flexDirection: "column",
            borderLeftWidth: "1px",
            borderColor: "border.subtle",
            background: "bg.canvas",
            minWidth: 0,
            "&[data-stacked]": {
                borderLeftWidth: "0",
                borderTopWidth: "1px",
            },
        },
        sidebarHeader: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingInline: "5",
            paddingBlock: "3",
            borderBottomWidth: "1px",
            borderColor: "border.subtle",
        },
        sidebarTitle: {
            textStyle: "caption",
            fontFamily: "mono",
            textTransform: "uppercase",
            letterSpacing: "wide",
            color: "fg.muted",
        },
        livePip: {
            width: "6px",
            height: "6px",
            borderRadius: "full",
            background: "status.pos",
            flexShrink: 0,
        },
        liveLabel: {
            textStyle: "caption",
            fontFamily: "mono",
            textTransform: "uppercase",
            letterSpacing: "wide",
            color: "fg.muted",
        },
        preview: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "6",
            minHeight: "var(--cfg-preview-min, 160px)",
            borderBottomWidth: "1px",
            borderColor: "border.subtle",
            /* Last-resort guard: content wider than the (now 1fr) stage
             * scrolls inside the stage rather than blowing out the grid. */
            minWidth: 0,
            overflowX: "auto",
        },
        aside: {
            display: "flex",
            flexDirection: "column",
            gap: "3",
            paddingInline: "5",
            paddingBlock: "4",
            borderBottomWidth: "1px",
            borderColor: "border.subtle",
        },
        asideTitle: {
            textStyle: "caption",
            fontFamily: "mono",
            textTransform: "uppercase",
            letterSpacing: "wide",
            color: "fg.muted",
        },

        /* ── spec readout ───────────────────────────────── */
        spec: {
            display: "flex",
            flexDirection: "column",
            gap: "2",
            paddingInline: "5",
            paddingBlock: "4",
        },
        specRow: {
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: "4",
        },
        specLabel: {
            textStyle: "caption",
            fontFamily: "mono",
            textTransform: "uppercase",
            letterSpacing: "wide",
            color: "fg.muted",
        },
        specValue: {
            textStyle: "code-sm",
            fontFamily: "mono",
            color: "link",
            textAlign: "end",
            wordBreak: "break-word",
        },
    },
});
