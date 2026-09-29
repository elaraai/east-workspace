/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Library slot recipe — the draggable palette, drawn as the Studio mock's
 * component library: a sunken toolbar band holding the search box (its ⌘ /
 * key cap at the right) and the grouping and secondary-fact controls under
 * it; group heads that name the group and count it; and compact cards — the
 * grip, the icon tile, the name over its mono meta line, and any status at
 * the right. Narrow, the cards stack in one column, the mock's palette; wide,
 * the same cards pack a grid. Filtered cards dim rather than unmount.
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { coarseHitArea } from "../../style/hit-area.js";

/** The mono caps label voice — group heads, the grouping control. */
const CAPS = {
    fontFamily: "mono",
    fontSize: "10px",
    fontWeight: "600",
    letterSpacing: "0.16em",
    lineHeight: "normal",
    textTransform: "uppercase",
} as const;

/** The faintest ink — the grip's. */
const INK_5 = { base: "gray.400", _dark: "gray.600" } as const;

export const librarySlotRecipe = defineSlotRecipe({
    className: "elara-library",
    slots: [
        "root", "header", "hint",
        "toolbar", "searchBox", "searchIcon", "searchInput", "searchClear", "searchKbd",
        "controls", "groupTrigger", "dimTrigger", "menuCheck",
        "group", "groupHead", "groupLabel", "groupSummary", "grid",
        "body", "canvas", "row", "rowGrid",
        "card", "grip", "iconTile", "cardBody", "cardHead", "cardLabel",
        "cardSublabel", "trailing", "statusPill",
        "meter", "meterTrack", "meterFill", "meterText",
        "chips", "chip", "dimText",
        "footer", "hiddenNote", "showAll", "addAction", "ghost",
    ],
    base: {
        /* Bare like the Table — identity chrome (title, outer frame)
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
        /* The groups + card region; becomes the scroll container when the
         * root is height-constrained. */
        body: {
            display: "flex",
            flexDirection: "column",
            gap: "18px",
            padding: "14px",
            "&[data-scrollable]": {
                overflowY: "auto",
                flex: "1 1 0%",
                minHeight: "0",
            },
            /* Virtualized, the rows carry the gaps and the virtualizer the ends. */
            "&[data-virtual]": {
                display: "block",
                padding: "0",
            },
        },
        /* Virtualizer sizing canvas — height is bound per render. */
        canvas: {
            position: "relative",
            width: "100%",
        },
        /* One absolutely-positioned virtual row (group head or card chunk),
         * carrying the gaps the unvirtualized body puts between them. */
        row: {
            position: "absolute",
            top: "0",
            left: "0",
            width: "100%",
            paddingX: "14px",
            "&[data-head]": { paddingBottom: "{spacing.2}" },
            "&[data-head]:not([data-first])": { paddingTop: "{spacing.3}" },
            "&[data-cards]": { paddingBottom: "6px" },
        },
        /* A single chunked card row — the virtualized sibling of `grid`;
         * gridTemplateColumns is bound to the measured column count. */
        rowGrid: {
            display: "grid",
            gap: "6px",
        },
        header: {
            display: "flex",
            alignItems: "baseline",
            gap: "{spacing.4}",
            paddingX: "14px",
            paddingY: "{spacing.3}",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
        },
        hint: {
            ...CAPS,
            marginLeft: "auto",
            letterSpacing: "0.14em",
            color: "fg.subtle",
        },
        /* The sunken band over the cards: the search box, then the controls. */
        toolbar: {
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            paddingX: "14px",
            paddingY: "{spacing.3}",
            background: "bg.panel",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
        },
        searchBox: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            height: "{spacing.8}",
            paddingLeft: "10px",
            paddingRight: "6px",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "{radii.md}",
            transitionProperty: "border-color, box-shadow",
            transitionDuration: "fast",
            _focusWithin: { borderColor: "brand.solid", boxShadow: "focus" },
        },
        searchIcon: {
            flexShrink: "0",
            fontSize: "11px",
            color: "fg.subtle",
        },
        searchInput: {
            flex: "1",
            minWidth: "0",
            height: "100%",
            padding: "0",
            background: "transparent",
            border: "none",
            outline: "none",
            fontSize: "12.5px",
            color: "fg",
            _placeholder: { color: "fg.subtle" },
        },
        searchClear: {
            flexShrink: "0",
            display: "grid",
            placeItems: "center",
            width: "{spacing.5}",
            height: "{spacing.5}",
            padding: "0",
            background: "transparent",
            border: "none",
            borderRadius: "{radii.xs}",
            color: "fg.subtle",
            fontSize: "10px",
            cursor: "pointer",
            _hover: { color: "fg", background: "bg.subtle" },
        },
        /* The key cap; a device without a keyboard has no shortcut to show. */
        searchKbd: {
            flexShrink: "0",
            _hoverNone: { display: "none" },
        },
        controls: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "{spacing.3}",
        },
        groupTrigger: {
            ...CAPS,
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            padding: "0",
            background: "transparent",
            border: "none",
            color: "fg.subtle",
            cursor: "pointer",
            whiteSpace: "nowrap",
            _hover: { color: "fg.muted" },
        },
        dimTrigger: {
            ...CAPS,
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            marginLeft: "auto",
            padding: "0",
            background: "transparent",
            border: "none",
            letterSpacing: "0.14em",
            color: "brand.solid",
            cursor: "pointer",
            whiteSpace: "nowrap",
            "& svg": { fontSize: "9px" },
            _hover: { color: "brand.fg" },
        },
        /* The mark beside the checked option in a control's menu. */
        menuCheck: {
            width: "{spacing.3}",
            color: "brand.solid",
            fontSize: "10px",
        },
        group: {
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.2}",
        },
        groupHead: {
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: "{spacing.3}",
        },
        groupLabel: {
            ...CAPS,
            color: "fg.subtle",
        },
        groupSummary: {
            fontFamily: "mono",
            fontSize: "10px",
            lineHeight: "normal",
            fontVariantNumeric: "tabular-nums",
            color: "fg.subtle",
            whiteSpace: "nowrap",
        },
        grid: {
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: "6px",
        },
        card: {
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            minWidth: "0",
            paddingY: "{spacing.2}",
            paddingLeft: "{spacing.2}",
            paddingRight: "10px",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "{radii.md}",
            transitionProperty: "border-color",
            transitionDuration: "fast",
            transitionTimingFunction: "out",
            _hover: { borderColor: "fg.muted" },
            "&[data-draggable]": { cursor: "grab" },
            "&[data-filtered]": { opacity: "0.45" },
            "&[data-dragging]": { opacity: "0.4" },
            /* Secondary facts under the meta: the grip and tile top-align. */
            "&[data-tall]": { alignItems: "flex-start" },
        },
        grip: {
            flexShrink: "0",
            width: "{spacing.2}",
            fontSize: "10px",
            color: INK_5,
            /* Touch: the grip is the instant-drag handle (drag-layer grip
             * fast-path) — no scroll gesture from it, and a 32px tap halo. */
            touchAction: "none",
            ...coarseHitArea({ position: true, size: 32 }),
            "[data-tall] > &": { alignSelf: "center" },
        },
        iconTile: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: "0",
            width: "30px",
            height: "30px",
            borderRadius: "{radii.sm}",
            background: "bg.subtle",
            color: "fg.muted",
            fontSize: "12px",
        },
        cardBody: {
            flex: "1",
            minWidth: "0",
            display: "flex",
            flexDirection: "column",
            gap: "3px",
        },
        /* A tall card's first line: the name, and its status at the right. */
        cardHead: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            minWidth: "0",
            "& > [data-tone]": { marginLeft: "auto", flexShrink: "0" },
        },
        cardLabel: {
            fontSize: "{fontSizes.control}",
            fontWeight: "600",
            lineHeight: "1.2",
            color: "fg",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        cardSublabel: {
            fontFamily: "mono",
            fontSize: "10px",
            lineHeight: "1.2",
            color: "fg.subtle",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        /* The card's right edge — its status. */
        trailing: {
            flexShrink: "0",
            display: "inline-flex",
            alignItems: "center",
            "[data-tall] > &": { alignSelf: "center" },
        },
        statusPill: {
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
            "&[data-tone=info]": { background: "bg.brand.subtle", color: "brand.fg" },
            "&[data-tone=neutral]": { background: "bg.subtle", color: "fg.muted" },
        },
        meter: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            marginTop: "3px",
        },
        meterTrack: {
            flex: "1",
            height: "6px",
            background: "bg.subtle",
            borderRadius: "{radii.xs}",
            overflow: "hidden",
        },
        meterFill: {
            height: "100%",
            background: "brand.solid",
            borderRadius: "{radii.xs}",
        },
        meterText: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            color: "fg",
            fontVariantNumeric: "tabular-nums",
        },
        chips: {
            display: "flex",
            flexWrap: "wrap",
            gap: "{spacing.1}",
            marginTop: "3px",
        },
        chip: {
            fontFamily: "mono",
            fontSize: "10px",
            lineHeight: "normal",
            color: "fg.muted",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "{radii.xs}",
            paddingX: "6px",
            paddingY: "1px",
        },
        dimText: {
            fontFamily: "mono",
            fontSize: "10px",
            lineHeight: "1.2",
            color: "fg.subtle",
        },
        footer: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.4}",
            paddingX: "14px",
            paddingY: "10px",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
        },
        hiddenNote: {
            fontFamily: "mono",
            fontSize: "10px",
            color: "fg.subtle",
        },
        showAll: {
            ...CAPS,
            letterSpacing: "0.14em",
            color: "brand.solid",
            cursor: "pointer",
            background: "transparent",
            border: "none",
            padding: "0",
            _hover: { color: "brand.fg" },
        },
        addAction: {
            ...CAPS,
            letterSpacing: "0.14em",
            color: "brand.solid",
            cursor: "pointer",
            background: "transparent",
            border: "none",
            padding: "0",
            _hover: { color: "brand.fg" },
        },
        ghost: {
            fontSize: "{fontSizes.control}",
            fontWeight: "600",
            color: "fg",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "brand.solid",
            borderRadius: "{radii.md}",
            boxShadow: "md",
            paddingX: "{spacing.3}",
            paddingY: "{spacing.1}",
        },
    },
});
