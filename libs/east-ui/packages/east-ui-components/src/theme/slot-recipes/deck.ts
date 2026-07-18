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
 * layouts, and the VIEW-state popover card (an anchored paper card whose
 * head inherits the card face; sticky when click-opened, transient when
 * hover-peeked).
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const deckSlotRecipe = defineSlotRecipe({
    className: "elara-deck",
    slots: [
        "root", "toolbar", "segGroup", "segLabel",
        "body", "group", "groupHead", "groupChevron", "groupLabel", "groupCount", "groupSummary",
        "grid", "list", "card", "cardIcon", "cardBody", "cardHead", "cardName", "cardSub", "face",
        "pop", "popHead", "popBody", "popClose",
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
        /* The VIEW-state popover card — an anchored mini-card scaled up:
         * paper, 1px rule, 2px radius, the same slim top status rule, a
         * head inherited from the card face. Hover peeks are transient
         * and non-interactive; click popovers are sticky. */
        pop: {
            position: "fixed",
            zIndex: "1400",
            width: "380px",
            maxWidth: "calc(100vw - 24px)",
            maxHeight: "360px",
            display: "flex",
            flexDirection: "column",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "{radii.xs}",
            boxShadow: "{shadows.lg}",
            outline: "none",
            "&[data-mode=hover]": { pointerEvents: "none", zIndex: "1200" },
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
        },
        /* Inherited head — the card face's icon / name / sub / pill. */
        popHead: {
            display: "flex",
            alignItems: "flex-start",
            gap: "9px",
            paddingX: "11px",
            paddingY: "9px",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
        },
        popBody: {
            flex: "1 1 auto",
            minHeight: 0,
            overflowY: "auto",
            paddingX: "11px",
            paddingY: "9px",
        },
        popClose: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            width: "22px",
            height: "22px",
            fontSize: "11px",
            color: "fg.subtle",
            borderRadius: "{radii.xs}",
            cursor: "pointer",
            _hover: { background: "bg.emphasized", color: "fg.default" },
            _coarse: { width: "32px", height: "32px" },
        },
    },
});
