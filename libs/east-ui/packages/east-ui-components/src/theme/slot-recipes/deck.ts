/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Deck slot recipe — the grouped card collection (#359). Card INTERNALS
 * (icon tile, label, status pill, meter, chips) reuse the `library` slot
 * recipe so palettes and decks read as one family; this recipe carries
 * the deck-specific chrome: the group-by toolbar row, collapsible group
 * heads, the wrap-grid / list layouts, clickable-card states, tone
 * accent bars, the detail view panel (side panel on desktop, full-screen
 * sheet on phones) and the hover peek.
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const deckSlotRecipe = defineSlotRecipe({
    className: "elara-deck",
    slots: [
        "root", "toolbar", "segGroup", "segLabel",
        "body", "group", "groupHead", "groupChevron", "groupLabel", "groupCount", "groupSummary",
        "grid", "list", "card", "face",
        "overlay", "panel", "panelHead", "panelTitle", "panelClose", "panelBody", "panelNav", "navBtn",
        "peek",
    ],
    base: {
        /* Bare like Library / Table — identity chrome is host composition. */
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
        /* Card frame — internals reuse the library card slots. A `tone`
         * paints the card-level accent bar (the customisable colour) in
         * the standard status palette. */
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
            minWidth: 0,
            "&[data-clickable]": {
                cursor: "pointer",
                transitionProperty: "border-color, background",
                transitionDuration: "{durations.fast}",
                _hover: { borderColor: "border.strong", background: "bg.subtle" },
                _focusVisible: { outline: "none", boxShadow: "{shadows.focus}" },
            },
            "&[data-filtered]": { opacity: "0.45" },
            "&[data-tone]": { borderLeftWidth: "3px" },
            "&[data-tone=success]": { borderLeftColor: "fg.success" },
            "&[data-tone=warning]": { borderLeftColor: "fg.warning" },
            "&[data-tone=danger]": { borderLeftColor: "fg.danger" },
            "&[data-tone=info]": { borderLeftColor: "{colors.brand.500}" },
            "&[data-tone=neutral]": { borderLeftColor: "border.strong" },
            "&[data-open]": { borderColor: "border.strong", boxShadow: "{shadows.focus}" },
        },
        /* Custom face slot beneath the structured fields. */
        face: {
            minWidth: 0,
            marginTop: "{spacing.1}",
        },
        /* Detail-view scrim — click closes. */
        overlay: {
            position: "fixed",
            inset: 0,
            background: "{colors.blackAlpha.500}",
            zIndex: "1300",
        },
        /* The VIEW state panel — a right side panel; phones get the full
         * width (a sheet). */
        panel: {
            position: "fixed",
            top: 0,
            right: 0,
            height: "100dvh",
            width: { base: "100%", sm: "440px" },
            background: "bg.surface",
            borderLeftWidth: "1px",
            borderLeftColor: "border.subtle",
            boxShadow: "{shadows.lg}",
            zIndex: "1400",
            display: "flex",
            flexDirection: "column",
            outline: "none",
        },
        panelHead: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            paddingX: "{spacing.4}",
            paddingY: "{spacing.3}",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            "&[data-tone]": { borderLeftWidth: "3px" },
            "&[data-tone=success]": { borderLeftColor: "fg.success" },
            "&[data-tone=warning]": { borderLeftColor: "fg.warning" },
            "&[data-tone=danger]": { borderLeftColor: "fg.danger" },
            "&[data-tone=info]": { borderLeftColor: "{colors.brand.500}" },
            "&[data-tone=neutral]": { borderLeftColor: "border.strong" },
        },
        panelTitle: {
            fontWeight: "600",
            fontSize: "{fontSizes.sm}",
            color: "fg.default",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
        panelClose: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            marginLeft: "auto",
            width: "28px",
            height: "28px",
            color: "fg.subtle",
            borderRadius: "{radii.sm}",
            cursor: "pointer",
            _hover: { background: "bg.emphasized", color: "fg.default" },
            _coarse: { width: "36px", height: "36px" },
        },
        panelBody: {
            flex: "1 1 0%",
            minHeight: 0,
            overflowY: "auto",
            padding: "{spacing.4}",
        },
        /* Prev / next traversal along the visible cards. */
        panelNav: {
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: "{spacing.1}",
            paddingX: "{spacing.4}",
            paddingY: "{spacing.2}",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
        },
        navBtn: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "28px",
            height: "28px",
            fontSize: "11px",
            color: "fg.subtle",
            borderRadius: "{radii.sm}",
            cursor: "pointer",
            _hover: { background: "bg.emphasized", color: "fg.default" },
            _coarse: { width: "40px", height: "40px" },
        },
        /* Hover peek — a floating summary card (hover-capable pointers). */
        peek: {
            position: "fixed",
            zIndex: "1200",
            width: "340px",
            maxHeight: "240px",
            overflow: "hidden",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "{radii.md}",
            boxShadow: "{shadows.lg}",
            padding: "{spacing.3}",
            pointerEvents: "none",
        },
    },
});
