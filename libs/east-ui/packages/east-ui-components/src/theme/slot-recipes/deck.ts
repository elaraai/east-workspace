/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Deck slot recipe — the grouped card collection (#359). Cards follow the
 * design spec's MINI-CARD grammar (`design/spec.css` `.sch-item`, which
 * extends `.lib-card`): a paper card with a slim 2px status rule along
 * the TOP edge in the standard tone palette, a tone-retinted icon tile,
 * a 12.5px/600 name line and a mono-uppercase sub line. Shared value
 * grammar (status pill, meter, chips) still reuses the `library` slots
 * so the family reads as one. This recipe carries the deck chrome: the
 * group-by toolbar, collapsible group heads, the wrap-grid / list
 * layouts, the detail view panel (side panel on desktop, full-screen
 * sheet on phones) and the hover peek.
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const deckSlotRecipe = defineSlotRecipe({
    className: "elara-deck",
    slots: [
        "root", "toolbar", "segGroup", "segLabel",
        "body", "group", "groupHead", "groupChevron", "groupLabel", "groupCount", "groupSummary",
        "grid", "list", "card", "cardIcon", "cardBody", "cardHead", "cardName", "cardSub", "face",
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
        /* Mini-card frame — the spec's `.sch-item` grammar: paper, 1px
         * rule, 2px radius, and a slim 2px status rule along the TOP edge
         * as the tone accent. Selected (open) = brand border + tint. */
        card: {
            position: "relative",
            display: "flex",
            alignItems: "flex-start",
            gap: "9px",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "{radii.xs}",
            paddingX: "11px",
            paddingY: "9px",
            minWidth: 0,
            transitionProperty: "border-color, background, opacity, box-shadow",
            transitionDuration: "{durations.fast}",
            "&[data-clickable]": {
                cursor: "pointer",
                _hover: { borderColor: "border.strong" },
                _focusVisible: { outline: "none", boxShadow: "{shadows.focus}" },
            },
            "&[data-filtered]": { opacity: "0.4" },
            /* Slim status rule along the top edge (the spec accent). */
            "&[data-tone]::before": {
                content: '""',
                position: "absolute",
                left: "-1px",
                right: "-1px",
                top: "-1px",
                height: "2px",
                borderTopLeftRadius: "{radii.xs}",
                borderTopRightRadius: "{radii.xs}",
            },
            "&[data-tone=success]::before": { background: "{colors.status.pos}" },
            "&[data-tone=warning]::before": { background: "{colors.status.warn}" },
            "&[data-tone=danger]::before": { background: "{colors.status.neg}" },
            "&[data-tone=info]::before": { background: "{colors.brand.600}" },
            "&[data-tone=neutral]::before": { background: "border.strong", opacity: 0.45 },
            "&[data-open]": { borderColor: "border.brand", background: "bg.brand.subtle" },
        },
        /* Icon tile — brand-tinted square, retinted by the card tone
         * (the spec's `.sch-icon` treatment). */
        cardIcon: {
            width: "28px",
            height: "28px",
            flexShrink: 0,
            borderRadius: "{radii.xs}",
            background: "bg.brand.subtle",
            color: "{colors.brand.700}",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "14px",
            "[data-tone=warning] &": { background: "bg.warning.subtle", color: "fg.warning" },
            "[data-tone=danger] &": { background: "bg.danger.subtle", color: "fg.danger" },
            "[data-tone=neutral] &": { background: "bg.subtle", color: "fg.subtle" },
        },
        cardBody: {
            display: "flex",
            flexDirection: "column",
            gap: "3px",
            flex: "1 1 auto",
            minWidth: 0,
        },
        cardHead: {
            display: "flex",
            alignItems: "center",
            gap: "6px",
            minWidth: 0,
        },
        /* Name line — 12.5px/600 body voice. */
        cardName: {
            fontFamily: "body",
            fontSize: "12.5px",
            fontWeight: "600",
            color: "fg.default",
            lineHeight: "1.15",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
        },
        /* Sub line — the mono-uppercase `.sch-sub` voice. */
        cardSub: {
            fontFamily: "mono",
            fontSize: "9.5px",
            color: "fg.subtle",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            lineHeight: "1.2",
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
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            paddingX: "{spacing.4}",
            paddingY: "{spacing.3}",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            /* Same slim top status rule as the cards. */
            "&[data-tone]::before": {
                content: '""',
                position: "absolute",
                left: 0,
                right: 0,
                top: 0,
                height: "2px",
            },
            "&[data-tone=success]::before": { background: "{colors.status.pos}" },
            "&[data-tone=warning]::before": { background: "{colors.status.warn}" },
            "&[data-tone=danger]::before": { background: "{colors.status.neg}" },
            "&[data-tone=info]::before": { background: "{colors.brand.600}" },
            "&[data-tone=neutral]::before": { background: "border.strong", opacity: 0.45 },
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
