/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Schematic slot recipe — the read-only 2D canvas per the `schematic`
 * pattern: paper-wash canvas, dashed zone outlines with mono eyebrow
 * labels, hatched walkway bands, solid pipe runs / dashed routing links,
 * and node cards (icon · label · status dot · meter · metric). Selection
 * gets the ink outline.
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const schematicSlotRecipe = defineSlotRecipe({
    className: "elara-schematic",
    slots: [
        "root", "canvas", "grid", "cardLayer", "underlay", "zone", "zoneLabel",
        "zoneShapes", "zoneShapeLabel", "footprints",
        "item", "itemHead", "itemIcon", "itemLabel", "statusDot",
        "itemSublabel", "meterTrack", "meterFill", "itemMetric",
        "itemDot", "itemPin",
        "controls", "controlButton", "controlGroup", "selectBox", "scaleBar", "scaleRuler", "scaleLabel",
        "minimap", "minimapZone", "minimapViewport",
        "nav", "navCollapsed", "navHeader", "navTitle", "navToggle",
        "navSearch", "navTree", "navZone", "navCaret",
        "navZoneLabel", "navCount", "navItem", "navMetric",
    ],
    base: {
        /* Bare like Table / Planner — identity chrome (title, outer frame)
         * is host composition via Card / Slice.Frame. */
        root: {
            background: "bg.surface",
            display: "flex",
            alignItems: "stretch",
            /* The canvas aspect drives the height; the navigator scrolls
             * inside it rather than stretching the row. */
            maxHeight: "75vh",
            overflow: "hidden",
        },
        canvas: {
            position: "relative",
            flex: "1",
            minWidth: "0",
            minHeight: "320px",
            background: "bg.panel",
            overflow: "hidden",
            cursor: "grab",
            touchAction: "none",
            userSelect: "none",
            "&:active": { cursor: "grabbing" },
        },
        /* Metric grid per the spec plant-floor canvas — minor lines with a
         * heavier major rule; the major cell equals the scale legend. The
         * grid is the ground layer of the canvas contrast hierarchy
         * (ground ⇢ annotation ⇢ content): felt, never read. */
        grid: {
            position: "absolute",
            inset: "0",
            pointerEvents: "none",
            backgroundImage: `
                linear-gradient(to right, color-mix(in oklch, {colors.border.strong} 30%, transparent) 1px, transparent 1px),
                linear-gradient(to bottom, color-mix(in oklch, {colors.border.strong} 30%, transparent) 1px, transparent 1px),
                linear-gradient(to right, color-mix(in oklch, {colors.border.subtle} 22%, transparent) 1px, transparent 1px),
                linear-gradient(to bottom, color-mix(in oklch, {colors.border.subtle} 22%, transparent) 1px, transparent 1px)`,
        },
        /* Holds the live `--cam-ppu` / `--cam-tx` / `--cam-ty` custom
         * properties (written by applyCamera each frame). Transparent and
         * click-through; each card re-enables its own pointer events so the
         * full-cover layer never swallows canvas clicks (issue #57). */
        cardLayer: {
            position: "absolute",
            inset: "0",
            pointerEvents: "none",
        },
        /* Links draw in pixel space; tone → token mapping lives here so
         * data only ever names a tone. */
        underlay: {
            position: "absolute",
            inset: "0",
            pointerEvents: "none",
            "& g[data-tone=brand]": { "--schematic-tone": "{colors.brand.600}" },
            "& g[data-tone=ink]": { "--schematic-tone": "{colors.fg}" },
            "& g[data-tone=muted]": { "--schematic-tone": "{colors.fg.muted}" },
            "& g[data-tone=success]": { "--schematic-tone": "{colors.status.ok}" },
            "& g[data-tone=warning]": { "--schematic-tone": "{colors.status.warn}" },
            "& g[data-tone=danger]": { "--schematic-tone": "{colors.status.bad}" },
            "& path": {
                stroke: "var(--schematic-tone)",
                strokeLinecap: "round",
            },
            "& circle": {
                fill: "var(--schematic-tone)",
            },
        },
        /* Zones are HTML — dashed outline or screen-space hatching via
         * repeating-linear-gradient, so angles and spacing never distort
         * with the canvas aspect. */
        zone: {
            position: "absolute",
            "&[data-tone=brand]": { "--schematic-tone": "{colors.brand.600}" },
            "&[data-tone=ink]": { "--schematic-tone": "{colors.fg}" },
            "&[data-tone=muted]": { "--schematic-tone": "{colors.border.strong}" },
            "&[data-tone=success]": { "--schematic-tone": "{colors.status.ok}" },
            "&[data-tone=warning]": { "--schematic-tone": "{colors.status.warn}" },
            "&[data-tone=danger]": { "--schematic-tone": "{colors.status.bad}" },
            "&[data-pattern=outline]": {
                borderWidth: "1px",
                borderStyle: "dashed",
                borderColor: "var(--schematic-tone)",
                borderRadius: "{radii.sm}",
            },
            "&[data-pattern=hatch]": {
                backgroundImage:
                    "repeating-linear-gradient(var(--hatch-angle, 45deg), var(--schematic-tone) 0, var(--schematic-tone) 1px, transparent 1px, transparent var(--hatch-spacing, 8px))",
                opacity: "0.3",
            },
        },
        zoneLabel: {
            position: "absolute",
            top: "0",
            left: "{spacing.2}",
            transform: "translateY(-50%)",
            fontFamily: "mono",
            fontSize: "9px",
            fontWeight: "600",
            letterSpacing: "0.14em",
            lineHeight: "normal",
            textTransform: "uppercase",
            color: "fg.muted",
            background: "bg.panel",
            paddingX: "{spacing.1}",
            whiteSpace: "nowrap",
        },
        /* Shaped zones (polyline / polygon) stroke in SVG so curves and
         * diagonals aren't confined to a div bounding box. Tone → token
         * mapping mirrors `underlay`; data only ever names a tone. These
         * are annotations like the rect zones — no pointer events. */
        zoneShapes: {
            position: "absolute",
            inset: "0",
            pointerEvents: "none",
            overflow: "visible",
            "& g[data-tone=brand]": { "--schematic-tone": "{colors.brand.600}" },
            "& g[data-tone=ink]": { "--schematic-tone": "{colors.fg}" },
            "& g[data-tone=muted]": { "--schematic-tone": "{colors.border.strong}" },
            "& g[data-tone=success]": { "--schematic-tone": "{colors.status.ok}" },
            "& g[data-tone=warning]": { "--schematic-tone": "{colors.status.warn}" },
            "& g[data-tone=danger]": { "--schematic-tone": "{colors.status.bad}" },
            "& path": {
                stroke: "var(--schematic-tone)",
                fill: "none",
                strokeLinejoin: "round",
            },
            /* Polygon outline echoes the dashed outline-rect zone. */
            "& path[data-shape=polygon]": {
                strokeWidth: "1px",
                strokeDasharray: "4 3",
            },
            /* Polyline is a run / road: a thin centre-line, or a soft band
             * when a world-space width is set inline. */
            "& path[data-shape=polyline]": {
                strokeWidth: "1.5px",
                strokeLinecap: "round",
                opacity: "0.55",
            },
        },
        /* Standalone eyebrow for a shaped zone — same look as `zoneLabel`
         * but positioned at the bbox top-left via inline coords. */
        zoneShapeLabel: {
            position: "absolute",
            transform: "translateY(-50%)",
            marginLeft: "{spacing.2}",
            fontFamily: "mono",
            fontSize: "9px",
            fontWeight: "600",
            letterSpacing: "0.14em",
            lineHeight: "normal",
            textTransform: "uppercase",
            color: "fg.muted",
            background: "bg.panel",
            paddingX: "{spacing.1}",
            whiteSpace: "nowrap",
            pointerEvents: "none",
        },
        /* Item footprints — the true shape body at close zoom (semantic
         * zoom). The path is clickable (selects the item); the card still
         * renders at the anchor, so no item info is lost. */
        footprints: {
            position: "absolute",
            inset: "0",
            pointerEvents: "none",
            overflow: "visible",
            "& g[data-tone=success]": { "--schematic-tone": "{colors.status.ok}" },
            "& g[data-tone=warning]": { "--schematic-tone": "{colors.status.warn}" },
            "& g[data-tone=danger]": { "--schematic-tone": "{colors.status.bad}" },
            "& g[data-tone=info]": { "--schematic-tone": "{colors.brand.500}" },
            "& g[data-tone=neutral]": { "--schematic-tone": "{colors.fg.muted}" },
            "& path": {
                stroke: "var(--schematic-tone)",
                strokeWidth: "1.5px",
                strokeLinejoin: "round",
                fill: "color-mix(in oklch, var(--schematic-tone) 12%, transparent)",
                cursor: "pointer",
                pointerEvents: "visiblePainted",
                transition: "fill {durations.fast}",
            },
            "& path[data-shape=polyline]": {
                fill: "none",
                strokeLinecap: "round",
            },
            "& g:hover path": {
                fill: "color-mix(in oklch, var(--schematic-tone) 20%, transparent)",
            },
            "& g[data-selected] path": {
                strokeWidth: "2.5px",
                fill: "color-mix(in oklch, var(--schematic-tone) 24%, transparent)",
            },
        },
        /* LOD tiers — constant screen-size markers over scaled geometry.
         * Items are the content layer: the darkest marks on the canvas at
         * every tier. */
        itemDot: {
            position: "absolute",
            transform: "translate(-50%, -50%)",
            width: "10px",
            height: "10px",
            borderRadius: "{radii.full}",
            borderWidth: "1.5px",
            borderColor: "{colors.white}",
            cursor: "pointer",
            boxShadow: "0 0 0 1px color-mix(in oklch, {colors.fg} 18%, transparent)",
            "&[data-tone=success]": { background: "{colors.status.ok}" },
            "&[data-tone=warning]": { background: "{colors.status.warn}" },
            "&[data-tone=danger]": { background: "{colors.status.bad}" },
            "&[data-tone=info]": { background: "{colors.brand.500}" },
            "&[data-tone=neutral]": { background: "{colors.fg.muted}" },
            "&[data-selected]": {
                outline: "2px solid",
                outlineColor: "fg",
                outlineOffset: "1px",
                boxShadow: "0 0 0 5px color-mix(in oklch, {colors.fg} 16%, transparent)",
            },
        },
        itemPin: {
            position: "absolute",
            transform: "translate(-50%, -50%)",
            display: "inline-flex",
            alignItems: "center",
            gap: "{spacing.1}",
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            color: "fg",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "{radii.full}",
            paddingX: "{spacing.1.5}",
            paddingY: "1px",
            whiteSpace: "nowrap",
            cursor: "pointer",
            boxShadow: "xs",
            "&[data-selected]": {
                outline: "2px solid",
                outlineColor: "fg",
                outlineOffset: "-1px",
            },
        },
        item: {
            position: "absolute",
            transform: "translate(-50%, -50%)",
            pointerEvents: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "2px",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "{radii.sm}",
            paddingX: "{spacing.2}",
            paddingY: "{spacing.1}",
            minWidth: "84px",
            cursor: "pointer",
            boxShadow: "sm",
            "&[data-selected]": {
                outline: "2px solid",
                outlineColor: "fg",
                outlineOffset: "-1px",
            },
            /* Slice-effect emphasis: a matched card gets a brand ring + soft glow.
             * The animated "pulse" breathing lives on the canvas dot / label
             * markers; a card carries the same static highlight for both `halo`
             * and `pulse` so the survivor set reads at card zoom too. */
            "&[data-emphasis]": {
                borderColor: "{colors.brand.600}",
                boxShadow: "0 0 0 2px color-mix(in oklch, {colors.brand.600} 35%, transparent)",
            },
        },
        itemHead: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.1}",
        },
        itemIcon: {
            color: "fg.muted",
            fontSize: "10px",
            flexShrink: "0",
        },
        itemLabel: {
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "600",
            color: "fg",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        statusDot: {
            width: "7px",
            height: "7px",
            borderRadius: "{radii.full}",
            marginLeft: "auto",
            flexShrink: "0",
            "&[data-tone=success]": { background: "{colors.status.ok}" },
            "&[data-tone=warning]": { background: "{colors.status.warn}" },
            "&[data-tone=danger]": { background: "{colors.status.bad}" },
            "&[data-tone=info]": { background: "{colors.brand.500}" },
            "&[data-tone=neutral]": { background: "{colors.fg.muted}" },
        },
        itemSublabel: {
            fontFamily: "mono",
            fontSize: "9px",
            letterSpacing: "0.08em",
            lineHeight: "normal",
            textTransform: "uppercase",
            color: "fg.subtle",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        meterTrack: {
            height: "4px",
            background: "bg.subtle",
            borderRadius: "{radii.full}",
            overflow: "hidden",
        },
        meterFill: {
            height: "100%",
            background: "{colors.brand.500}",
            borderRadius: "{radii.full}",
        },
        itemMetric: {
            fontFamily: "mono",
            fontSize: "10px",
            color: "fg.muted",
            fontVariantNumeric: "tabular-nums",
        },
        controls: {
            position: "absolute",
            top: "{spacing.2}",
            right: "{spacing.2}",
            display: "flex",
            flexDirection: "column",
            gap: "2px",
        },
        controlButton: {
            width: "24px",
            height: "24px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "11px",
            color: "fg.muted",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "{radii.sm}",
            cursor: "pointer",
            boxShadow: "xs",
            "&:hover": { color: "fg", borderColor: "border.strong" },
            // Active tool (#153) — the selected segment reads as pressed.
            "&[data-active]": { color: "{colors.white}", background: "{colors.brand.600}", borderColor: "{colors.brand.600}" },
            "&[data-active]:hover": { color: "{colors.white}", background: "{colors.brand.600}", borderColor: "{colors.brand.600}" },
        },
        // A vertical segmented group of `controlButton`s (#153) — same button
        // visual, attached: outer corners rounded (overflow-clipped), one shared
        // shadow, and the inner border collapsed so adjacent buttons share a rule.
        controlGroup: {
            display: "flex",
            flexDirection: "column",
            borderRadius: "{radii.sm}",
            overflow: "hidden",
            boxShadow: "xs",
            "& > button": { borderRadius: "0", boxShadow: "none" },
            "& > button:not(:first-of-type)": { borderTopWidth: "0" },
        },
        // Drag-select marquee (#153) — dashed brand box over the canvas showing
        // the region a select-drag will zoom into.
        selectBox: {
            position: "absolute",
            pointerEvents: "none",
            borderWidth: "1px",
            borderStyle: "dashed",
            borderColor: "{colors.brand.600}",
            background: "color-mix(in oklch, {colors.brand.600} 12%, transparent)",
            borderRadius: "{radii.xs}",
            zIndex: "5",
        },
        minimap: {
            position: "absolute",
            left: "{spacing.2}",
            bottom: "{spacing.2}",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "{radii.sm}",
            boxShadow: "sm",
            overflow: "hidden",
            cursor: "pointer",
        },
        minimapZone: {
            position: "absolute",
            borderWidth: "1px",
            borderColor: "border.subtle",
            background: "bg.panel",
        },
        minimapViewport: {
            position: "absolute",
            borderWidth: "1.5px",
            borderColor: "{colors.brand.600}",
            background: "bg.brand.subtle",
            opacity: "0.75",
            pointerEvents: "none",
        },
        /* Navigator rail — typographic mono TOC per the spec `.toc`
         * pattern: no hover fills; hover and the active trail are colour
         * and weight changes only. */
        nav: {
            width: "230px",
            flexShrink: "0",
            display: "flex",
            flexDirection: "column",
            borderRightWidth: "1px",
            borderRightColor: "border.subtle",
            background: "bg.surface",
        },
        navCollapsed: {
            width: "28px",
            flexShrink: "0",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            paddingTop: "{spacing.2}",
            borderRightWidth: "1px",
            borderRightColor: "border.subtle",
            background: "bg.surface",
        },
        navHeader: {
            display: "flex",
            alignItems: "center",
            paddingX: "{spacing.3}",
            paddingTop: "{spacing.3}",
        },
        navTitle: {
            flex: "1",
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            letterSpacing: "0.18em",
            lineHeight: "normal",
            textTransform: "uppercase",
            color: "fg",
        },
        navToggle: {
            background: "transparent",
            border: "none",
            padding: "2px",
            fontFamily: "mono",
            fontSize: "12px",
            color: "fg.subtle",
            cursor: "pointer",
            "&:hover": { color: "fg" },
        },
        navSearch: {
            margin: "{spacing.2}",
            fontSize: "{fontSizes.control}",
            color: "fg",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "{radii.sm}",
            paddingX: "{spacing.2}",
            paddingY: "{spacing.1}",
            outline: "none",
            _placeholder: { color: "fg.subtle" },
            _focusVisible: { borderColor: "border.focus" },
        },
        navTree: {
            flex: "1",
            minHeight: "0",
            overflowY: "auto",
            paddingBottom: "{spacing.2}",
            lineHeight: "1.7",
            // Row height shared by the sticky zone headers (their stacked `top`
            // offset is a multiple of this) so an ancestor chain pins flush.
            "--nav-row-h": "22px",
        },
        /* Zone headers pin to the top of the scroll area like a tree view: each
         * depth level sticks at `top = depth × --nav-row-h` (set inline), so the
         * area (and its ancestors) stays visible while you scroll its items.
         * The opaque surface + z-index occlude the items scrolling underneath. */
        navZone: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.1}",
            height: "var(--nav-row-h)",
            paddingRight: "{spacing.3}",
            position: "sticky",
            background: "bg.surface",
            zIndex: "1",
        },
        navCaret: {
            background: "transparent",
            border: "none",
            color: "fg.subtle",
            fontSize: "9px",
            cursor: "pointer",
            padding: "2px",
            "& svg": { transition: "transform {durations.fast}" },
            "&[data-open] svg": { transform: "rotate(90deg)" },
        },
        navZoneLabel: {
            background: "transparent",
            border: "none",
            padding: "0",
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            letterSpacing: "0.18em",
            lineHeight: "1.7",
            textTransform: "uppercase",
            color: "fg.muted",
            cursor: "pointer",
            textAlign: "left",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            flex: "1",
            "&:hover": { color: "{colors.brand.700}" },
            "[data-current] &": { color: "fg" },
        },
        navCount: {
            fontFamily: "mono",
            fontSize: "9px",
            color: "fg.subtle",
            fontVariantNumeric: "tabular-nums",
        },
        navItem: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.1.5}",
            width: "100%",
            background: "transparent",
            border: "none",
            paddingY: "2px",
            paddingRight: "{spacing.3}",
            // Keep the auto-scroll-to-selected item clear of the pinned zone
            // headers (up to two ancestor levels).
            scrollMarginTop: "calc(var(--nav-row-h) * 2)",
            fontFamily: "mono",
            fontSize: "11px",
            letterSpacing: "0.06em",
            lineHeight: "1.7",
            color: "fg.muted",
            cursor: "pointer",
            textAlign: "left",
            whiteSpace: "nowrap",
            overflow: "hidden",
            "&:hover": { color: "{colors.brand.700}" },
            "&[data-selected]": { color: "fg", fontWeight: "600" },
        },
        navMetric: {
            marginLeft: "auto",
            fontSize: "10px",
            color: "fg.subtle",
            fontVariantNumeric: "tabular-nums",
        },
        /* Map-style ruler — a bare bottom bracket with quarter ticks and
         * the distance floating above it; a text halo keeps it legible
         * with no panel chrome (the Mapbox convention). */
        scaleBar: {
            position: "absolute",
            right: "{spacing.3}",
            bottom: "{spacing.2}",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "0px",
            pointerEvents: "none",
            height: "20px",
            background: "bg.surface",
             borderColor: "border.subtle",
             borderRadius: "{radii.xs}",  
             boxShadow: "xs",
             padding: "2px",
        },
        scaleRuler: {
            display: "block",
            "& path": {
                stroke: "{colors.fg.muted}",
                strokeWidth: "1px",
            },
        },
        scaleLabel: {
            fontFamily: "mono",
            fontSize: "9px",
            fontWeight: "600",
            letterSpacing: "0.08em",
            lineHeight: "1",
            textTransform: "uppercase",
            color: "fg.muted",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            textShadow: "0 0 3px {colors.bg.panel}, 0 0 3px {colors.bg.panel}, 0 0 2px {colors.bg.panel}",
        },
    },
});
