/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Deck slot recipe — the grouped card collection (#359). Cards follow the
 * board grammar: a quiet Card-family frame (10px radius, 1px subtle
 * border) whose STATUS paints an explicit colour system through two CSS
 * vars the renderer binds from the deck's status registry — `--dc` (the
 * bold indicator: solid tag, dot, fill bar, hover border) and `--dt`
 * (the faint face wash derived from it). Metrics are label-over-value
 * pairs in the mono tabular voice; the fill bar and readout / detail
 * rows / note blocks carry the popover-body vocabulary. Shared value
 * grammar (meter / chips / text facts) still reuses the `library` slots.
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const deckSlotRecipe = defineSlotRecipe({
    className: "elara-deck",
    slots: [
        "root", "toolbar", "segGroup", "segLabel",
        "body", "group", "groupHead", "groupChevron", "groupSwatch", "groupLabel", "groupCount", "groupSummary",
        "grid", "list",
        "card", "cardIcon", "cardBody", "cardHead", "cardId", "cardName", "cardSub",
        "stag", "sdot",
        "metricsRow", "metricCell", "metricK", "metricV",
        "fillRow", "fillTrack", "fillBar", "fillPct",
        "face",
        "footRow", "footK", "footV", "footSep",
        "legend", "legendItem", "legendSw", "legendLb", "legendDs",
        "pop", "popHead", "popBody", "popClose",
        "readout", "readoutCell", "readoutK", "readoutV", "readoutU",
        "drows", "drow", "drowK", "drowV",
        "note",
    ],
    base: {
        /* Bare like Table / Library — identity chrome is host composition. */
        root: {
            background: "bg.surface",
            "&[data-scrollable]": {
                display: "flex",
                flexDirection: "column",
                minHeight: "0",
            },
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
        segGroup: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.1}",
            flexWrap: "wrap",
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
        body: {
            "&[data-scrollable]": {
                overflowY: "auto",
                flex: "1 1 0%",
                minHeight: "0",
            },
        },
        group: {},
        /* Collapsible group head — the whole row is the toggle button. */
        groupHead: {
            display: "flex",
            alignItems: "baseline",
            gap: "{spacing.3}",
            width: "100%",
            paddingX: "{spacing.5}",
            paddingY: "{spacing.2}",
            background: "bg.panel",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            cursor: "pointer",
            textAlign: "left",
            _hover: { background: "bg.subtle" },
            /* Touch (#346 policy). */
            _coarse: { minHeight: "44px" },
        },
        groupChevron: {
            fontSize: "9px",
            color: "fg.subtle",
            flexShrink: 0,
            alignSelf: "center",
        },
        /* Status swatch when grouping BY the status accessor (colour is
         * data-driven from the registry). */
        groupSwatch: {
            width: "10px",
            height: "10px",
            borderRadius: "3px",
            flexShrink: 0,
            alignSelf: "center",
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
        groupCount: {
            fontFamily: "mono",
            fontSize: "10px",
            fontVariantNumeric: "tabular-nums",
            color: "fg.subtle",
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
        /* Wrap grid — the renderer binds gridTemplateColumns from
         * minCardWidth (data-driven): desktop rows of cards, one phone
         * column, no breakpoint logic. */
        grid: {
            display: "grid",
            gap: "{spacing.3}",
            padding: "{spacing.4}",
        },
        /* Single-column list rows. */
        list: {
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.2}",
            padding: "{spacing.4}",
        },
        /* The card — quiet Card-family frame; a STATUS paints the faint
         * face wash (--dt) and the bold indicator (--dc) drives the
         * hover border and selected ring. */
        card: {
            position: "relative",
            display: "flex",
            alignItems: "flex-start",
            gap: "9px",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "{radii.md}",
            overflow: "hidden",
            paddingX: "13px",
            paddingY: "11px",
            minWidth: 0,
            transitionProperty: "border-color, background, opacity, box-shadow",
            transitionDuration: "{durations.fast}",
            "&[data-status]": { background: "var(--dt)" },
            "&[data-clickable]": {
                cursor: "pointer",
                _hover: { borderColor: "var(--dc, {colors.border.strong})" },
                _focusVisible: { outline: "none", boxShadow: "{shadows.focus}" },
            },
            "&[data-filtered]": { opacity: "0.4" },
            "&[data-open]": {
                borderColor: "var(--dc, {colors.border.brand})",
                boxShadow: "inset 0 0 0 1px var(--dc, {colors.border.brand})",
            },
        },
        /* Icon tile — brand-tinted square. */
        cardIcon: {
            width: "28px",
            height: "28px",
            flexShrink: 0,
            borderRadius: "{radii.xs}",
            background: "bg.brand.subtle",
            color: "brand.fg",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "14px",
        },
        cardBody: {
            display: "flex",
            flexDirection: "column",
            gap: "9px",
            flex: "1 1 auto",
            minWidth: 0,
        },
        cardHead: {
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "{spacing.2}",
            minWidth: 0,
        },
        cardId: {
            display: "flex",
            flexDirection: "column",
            gap: "3px",
            minWidth: 0,
        },
        /* Name line — brand-voice 15px/700. */
        cardName: {
            fontFamily: "heading",
            fontSize: "15px",
            fontWeight: "700",
            letterSpacing: "-0.01em",
            color: "fg.default",
            lineHeight: "1.15",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
        },
        /* Sub line — mono-uppercase eyebrow voice. */
        cardSub: {
            fontFamily: "mono",
            fontSize: "10.5px",
            fontWeight: "500",
            color: "fg.subtle",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            lineHeight: "1.2",
        },
        /* THE explicit colour indicator — a solid saturated status tag. */
        stag: {
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "700",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "white",
            background: "var(--dc, {colors.fg.subtle})",
            paddingY: "3px",
            paddingLeft: "6px",
            paddingRight: "8px",
            borderRadius: "4px",
            whiteSpace: "nowrap",
            lineHeight: "1.2",
            flexShrink: 0,
            "&[data-pulse] [data-part=sdot]": {
                animation: "elara-pulse 1.7s ease-in-out infinite",
            },
        },
        sdot: {
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: "whiteAlpha.900",
        },
        /* Metric strip — label-over-value pairs, mono tabular. */
        metricsRow: {
            display: "flex",
            flexWrap: "wrap",
            gap: "6px 14px",
        },
        metricCell: {
            display: "flex",
            flexDirection: "column",
            gap: "1px",
        },
        metricK: {
            fontFamily: "mono",
            fontSize: "9px",
            fontWeight: "600",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "fg.subtle",
        },
        metricV: {
            fontFamily: "mono",
            fontSize: "13px",
            fontWeight: "600",
            color: "fg.default",
            lineHeight: "1",
            fontVariantNumeric: "tabular-nums",
            "&[data-warn]": { color: "{colors.status.neg}" },
            "&[data-muted]": { color: "fg.subtle", fontWeight: "500" },
        },
        /* Status-coloured fill bar with a right-aligned reading. */
        fillRow: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
        },
        fillTrack: {
            flex: "1",
            height: "5px",
            borderRadius: "3px",
            background: "color-mix(in srgb, var(--dc, {colors.fg.subtle}) 14%, {colors.bg.surface})",
            overflow: "hidden",
        },
        fillBar: {
            height: "100%",
            borderRadius: "3px",
            background: "var(--dc, {colors.fg.subtle})",
        },
        fillPct: {
            fontFamily: "mono",
            fontSize: "10.5px",
            fontWeight: "600",
            color: "fg.muted",
            fontVariantNumeric: "tabular-nums",
            minWidth: "30px",
            textAlign: "right",
        },
        /* Custom face slot beneath the structured fields. */
        face: {
            minWidth: 0,
        },
        /* Board-foot key/value stats. */
        footRow: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            flexWrap: "wrap",
            paddingX: "{spacing.5}",
            paddingY: "{spacing.3}",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
            fontFamily: "mono",
            fontSize: "11px",
            color: "fg.subtle",
        },
        footK: {
            letterSpacing: "0.1em",
            textTransform: "uppercase",
        },
        footV: {
            color: "fg.default",
            fontWeight: "600",
        },
        footSep: { color: "border.strong" },
        /* Status legend (from the registry). */
        legend: {
            display: "flex",
            flexWrap: "wrap",
            gap: "8px 16px",
            paddingX: "{spacing.5}",
            paddingY: "{spacing.3}",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
        },
        legendItem: {
            display: "inline-flex",
            alignItems: "center",
            gap: "7px",
        },
        legendSw: {
            width: "11px",
            height: "11px",
            borderRadius: "3px",
        },
        legendLb: {
            fontFamily: "mono",
            fontSize: "10.5px",
            fontWeight: "600",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "fg.muted",
        },
        legendDs: {
            fontSize: "11.5px",
            color: "fg.subtle",
        },
        /* The VIEW-state popover card — positioned by the popover
         * machine's Positioner; the head inherits the card face and its
         * status wash. */
        pop: {
            position: "relative",
            width: "380px",
            maxWidth: "var(--available-width)",
            maxHeight: "360px",
            display: "flex",
            flexDirection: "column",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "{radii.md}",
            overflow: "hidden",
            boxShadow: "{shadows.lg}",
            outline: "none",
            "&[data-mode=hover]": { pointerEvents: "none" },
        },
        popHead: {
            display: "flex",
            alignItems: "flex-start",
            gap: "9px",
            paddingX: "13px",
            paddingY: "11px",
            background: "var(--dt, {colors.bg.canvas})",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
        },
        popBody: {
            flex: "1 1 auto",
            minHeight: 0,
            overflowY: "auto",
            paddingX: "13px",
            paddingY: "11px",
        },
        popClose: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            width: "24px",
            height: "24px",
            fontSize: "12px",
            color: "fg.subtle",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "{radii.xs}",
            background: "bg.surface",
            cursor: "pointer",
            _hover: { color: "fg.default", borderColor: "fg.subtle" },
            _coarse: { width: "32px", height: "32px" },
        },
        /* Readout rail — bordered grid of big mono values. */
        readout: {
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "{radii.sm}",
            overflow: "hidden",
        },
        readoutCell: {
            paddingX: "11px",
            paddingY: "9px",
            borderRightWidth: "1px",
            borderRightColor: "border.subtle",
            "&:last-child": { borderRightWidth: 0 },
        },
        readoutK: {
            fontFamily: "mono",
            fontSize: "9px",
            fontWeight: "600",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "fg.subtle",
            marginBottom: "4px",
        },
        readoutV: {
            fontFamily: "mono",
            fontSize: "17px",
            fontWeight: "500",
            color: "fg.default",
            lineHeight: "1",
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.01em",
            "&[data-warn]": { color: "{colors.status.neg}" },
            "&[data-muted]": { color: "fg.subtle" },
        },
        readoutU: {
            fontSize: "10px",
            color: "fg.subtle",
            marginLeft: "2px",
        },
        /* Key–value detail rows. */
        drows: {
            display: "flex",
            flexDirection: "column",
            gap: "7px",
        },
        drow: {
            display: "grid",
            gridTemplateColumns: "96px 1fr",
            gap: "{spacing.3}",
            alignItems: "baseline",
            fontSize: "13px",
        },
        drowK: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "fg.subtle",
        },
        drowV: { color: "fg.default" },
        /* Dashed-top mono footnote. */
        note: {
            fontFamily: "mono",
            fontSize: "10.5px",
            lineHeight: "1.5",
            color: "fg.subtle",
            borderTopWidth: "1px",
            borderTopStyle: "dashed",
            borderTopColor: "border.subtle",
            paddingTop: "{spacing.2}",
        },
    },
});
