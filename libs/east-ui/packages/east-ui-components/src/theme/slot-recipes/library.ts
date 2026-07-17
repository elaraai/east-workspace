/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Library slot recipe — the draggable palette per the `sourcelibrary`
 * pattern: framed surface, mono eyebrow header, group-by / secondary
 * toolbar, group heads with right-aligned summaries, and identity cards
 * (grip · icon tile · label/status · meter / chips / text dims). Filtered
 * cards dim rather than unmount.
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { coarseHitArea } from "../../style/hit-area.js";

export const librarySlotRecipe = defineSlotRecipe({
    className: "elara-library",
    slots: [
        "root", "header", "hint",
        "toolbar", "search", "segGroup", "segLabel",
        "group", "groupHead", "groupLabel", "groupSummary", "grid",
        "body", "canvas", "row", "rowGrid",
        "card", "grip", "iconTile", "cardBody", "cardHead", "cardLabel",
        "cardSublabel", "statusPill",
        "meter", "meterTrack", "meterFill", "meterText",
        "chips", "chip", "dimText",
        "footer", "hiddenNote", "showAll", "addAction", "ghost",
    ],
    base: {
        /* Bare like Table / Planner — identity chrome (title, outer frame)
         * is host composition via Card / Slice.Frame. */
        root: {
            background: "bg.surface",
            /* Height-constrained: chrome fixed, the body scrolls (#258). */
            "&[data-scrollable]": {
                display: "flex",
                flexDirection: "column",
                minHeight: "0",
            },
        },
        /* The groups + card-grid region; becomes the scroll container when
         * the root is height-constrained. */
        body: {
            "&[data-scrollable]": {
                overflowY: "auto",
                flex: "1 1 0%",
                minHeight: "0",
            },
        },
        /* Virtualizer sizing canvas — height is bound per render. */
        canvas: {
            position: "relative",
            width: "100%",
        },
        /* One absolutely-positioned virtual row (group head or card chunk). */
        row: {
            position: "absolute",
            top: "0",
            left: "0",
            width: "100%",
        },
        /* A single chunked card row — the virtualized sibling of `grid`;
         * gridTemplateColumns is bound to the measured column count. */
        rowGrid: {
            display: "grid",
            gap: "{spacing.3}",
            paddingX: "{spacing.4}",
            paddingY: "{spacing.1.5}",
        },
        header: {
            display: "flex",
            alignItems: "baseline",
            gap: "{spacing.4}",
            paddingX: "{spacing.5}",
            paddingY: "{spacing.3}",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
        },
        hint: {
            marginLeft: "auto",
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            letterSpacing: "0.14em",
            lineHeight: "normal",
            textTransform: "uppercase",
            color: "fg.subtle",
        },
        toolbar: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.4}",
            paddingX: "{spacing.5}",
            paddingY: "{spacing.2}",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            flexWrap: "wrap",
        },
        /* Layout only — visual chrome comes from the sliceFrame `searchPill`. */
        search: {
            width: "auto",
            minWidth: "200px",
        },
        segGroup: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.1}",
        },
        segLabel: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            letterSpacing: "0.14em",
            lineHeight: "normal",
            textTransform: "uppercase",
            color: "fg.subtle",
            marginRight: "{spacing.1}",
        },
        group: {},
        groupHead: {
            display: "flex",
            alignItems: "baseline",
            gap: "{spacing.4}",
            paddingX: "{spacing.5}",
            paddingY: "{spacing.2}",
            background: "bg.panel",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
        },
        groupLabel: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            letterSpacing: "0.14em",
            lineHeight: "normal",
            textTransform: "uppercase",
            color: "fg.muted",
        },
        groupSummary: {
            marginLeft: "auto",
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            letterSpacing: "0.14em",
            lineHeight: "normal",
            textTransform: "uppercase",
            color: "fg.subtle",
        },
        grid: {
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: "{spacing.3}",
            padding: "{spacing.4}",
        },
        card: {
            position: "relative",
            display: "flex",
            alignItems: "flex-start",
            gap: "{spacing.2}",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "{radii.md}",
            padding: "{spacing.3}",
            "&[data-draggable]": { cursor: "grab" },
            "&[data-filtered]": { opacity: "0.45" },
            "&[data-dragging]": { opacity: "0.4" },
            "&[data-compact]": { alignItems: "center" },
        },
        grip: {
            color: "fg.subtle",
            fontSize: "10px",
            paddingTop: "2px",
            flexShrink: "0",
            opacity: "0",
            transition: "opacity {durations.fast}",
            "[data-draggable]:hover &": { opacity: "1" },
            /* Touch: the grip is the instant-drag handle (drag-layer grip
             * fast-path) — always visible, no scroll gesture from it, and a
             * 32px tap halo. */
            _hoverNone: { opacity: "0.7" },
            touchAction: "none",
            ...coarseHitArea({ position: true, size: 32 }),
            "[data-compact] &": { paddingTop: "0" },
        },
        iconTile: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "32px",
            height: "32px",
            borderRadius: "{radii.sm}",
            background: "bg.panel",
            color: "fg.muted",
            fontSize: "13px",
            flexShrink: "0",
        },
        cardBody: {
            flex: "1",
            minWidth: "0",
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.1}",
        },
        cardHead: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
        },
        cardLabel: {
            fontSize: "{fontSizes.control}",
            fontWeight: "600",
            color: "fg",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        cardSublabel: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            letterSpacing: "0.14em",
            lineHeight: "normal",
            textTransform: "uppercase",
            color: "fg.subtle",
        },
        statusPill: {
            marginLeft: "auto",
            fontFamily: "mono",
            fontSize: "9px",
            fontWeight: "600",
            letterSpacing: "0.12em",
            lineHeight: "normal",
            textTransform: "uppercase",
            paddingX: "{spacing.1}",
            paddingY: "1px",
            borderRadius: "{radii.xs}",
            whiteSpace: "nowrap",
            "&[data-tone=success]": { background: "bg.success.subtle", color: "fg.success" },
            "&[data-tone=warning]": { background: "bg.warning.subtle", color: "fg.warning" },
            "&[data-tone=danger]": { background: "bg.danger.subtle", color: "fg.danger" },
            "&[data-tone=info]": { background: "bg.brand.subtle", color: "{colors.brand.700}" },
            "&[data-tone=neutral]": { background: "bg.subtle", color: "fg.muted" },
        },
        meter: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
        },
        meterTrack: {
            flex: "1",
            height: "5px",
            background: "bg.subtle",
            borderRadius: "{radii.full}",
            overflow: "hidden",
        },
        meterFill: {
            height: "100%",
            background: "{colors.brand.500}",
            borderRadius: "{radii.full}",
        },
        meterText: {
            fontFamily: "mono",
            fontSize: "11px",
            color: "fg.muted",
            fontVariantNumeric: "tabular-nums",
        },
        chips: {
            display: "flex",
            flexWrap: "wrap",
            gap: "{spacing.1}",
        },
        chip: {
            fontFamily: "mono",
            fontSize: "10px",
            color: "fg.muted",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "{radii.xs}",
            paddingX: "{spacing.1}",
            paddingY: "1px",
        },
        dimText: {
            fontFamily: "mono",
            fontSize: "11px",
            color: "fg.muted",
        },
        footer: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.4}",
            paddingX: "{spacing.5}",
            paddingY: "{spacing.2}",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
        },
        hiddenNote: {
            fontFamily: "mono",
            fontSize: "11px",
            color: "fg.subtle",
        },
        showAll: {
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "600",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "link",
            cursor: "pointer",
            background: "transparent",
            border: "none",
            padding: "0",
        },
        addAction: {
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "600",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "link",
            cursor: "pointer",
            background: "transparent",
            border: "none",
            padding: "0",
        },
        ghost: {
            fontSize: "{fontSizes.control}",
            fontWeight: "600",
            color: "fg",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "{radii.md}",
            boxShadow: "md",
            paddingX: "{spacing.3}",
            paddingY: "{spacing.1}",
        },
    },
});
