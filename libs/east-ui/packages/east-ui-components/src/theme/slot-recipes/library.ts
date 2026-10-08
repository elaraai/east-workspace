/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Library slot recipe — the draggable palette, drawn as the Studio mock's
 * component library: one toolbar band, the row every toolbar host lays its
 * chrome in (the shared `toolbar` recipe), holding the search box (its ⌘ /
 * key cap at the right), the grouping, the secondary-fact and filter
 * controls and any caption; group heads that name the group and count it;
 * and compact cards — the grip, the icon tile, the name over its mono meta
 * line, and any status and glyph at the right. A placed card — the one
 * already on the target — is drawn in the brand: its border, a tint, and the
 * brand ink through it. Narrow, the cards stack in one column, the mock's
 * palette, none wider than it; wide, the same cards pack a grid. Filtered
 * cards dim rather than unmount.
 *
 * The gallery draws the Studio mock's page library and component library
 * cards: the media on the sunken paper, above the face or at its start; the
 * name and status over the mono meta line; a foot under a rule holding the
 * byline and the action in the link voice; and a dashed card to add one. Its
 * status is the shared `status` recipe's and its byline avatar the shared
 * `avatar` recipe's.
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

export const librarySlotRecipe = defineSlotRecipe({
    className: "elara-library",
    slots: [
        "root", "hint",
        "toolbar", "searchBox", "searchIcon", "searchInput", "searchClear", "searchKbd",
        "groupTrigger", "dimTrigger", "menuCheck",
        "group", "groupHead", "groupLabel", "groupSummary", "grid",
        "body", "canvas", "row", "rowGrid",
        "card", "grip", "iconTile", "cardBody", "cardHead", "cardLabel",
        "cardSublabel", "trailing", "statusPill", "glyph",
        "meter", "meterTrack", "meterFill", "meterText",
        "chips", "chip", "dimText",
        "footer", "hiddenNote", "showAll", "addAction", "ghost",
        "galleryGrid", "galleryCard", "galleryMedia", "galleryFace", "galleryHead", "galleryTitle",
        "gallerySublabel", "galleryFoot", "galleryByline", "galleryBylineText", "galleryAction",
        "galleryAdd", "galleryAddIcon", "galleryAddLabel",
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
            /* A host's (no toolbar of its own): the cards sit in its frame. */
            "&[data-hosted]": { background: "transparent" },
        },
        /* The groups + card region; becomes the scroll container when the
         * root is height-constrained. */
        body: {
            display: "flex",
            flexDirection: "column",
            gap: "18px",
            padding: "14px",
            "[data-hosted] > &": { padding: "0" },
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
        /* The caption at the toolbar's end. */
        hint: {
            ...CAPS,
            letterSpacing: "0.14em",
            color: "fg.subtle",
            whiteSpace: "nowrap",
        },
        /* The toolbar band over the cards: one row, the shared toolbar's. */
        toolbar: {
            display: "flex",
            flexWrap: "nowrap",
            alignItems: "center",
            height: "44px",
            paddingX: "14px",
            background: "bg.surface",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            overflow: "clip",
            flexShrink: "0",
        },
        /* Its width is the form the toolbar folds it to: wide, then mid,
         * then narrow, without the key cap. */
        searchBox: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            width: "300px",
            height: "{spacing.7}",
            paddingLeft: "10px",
            paddingRight: "{spacing.1}",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "{radii.md}",
            transitionProperty: "border-color, box-shadow",
            transitionDuration: "fast",
            _focusWithin: { borderColor: "brand.solid", boxShadow: "focus" },
            "&[data-size=mid]": { width: "220px" },
            "&[data-size=narrow]": { width: "160px" },
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
            textOverflow: "ellipsis",
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
        /* The key cap; a device without a keyboard has no shortcut to show,
         * and a narrow box has no room for it. */
        searchKbd: {
            flexShrink: "0",
            _hoverNone: { display: "none" },
            "[data-size=narrow] &": { display: "none" },
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
        /* Cards 220px wide at least, packed as many to a row as fit — and in a
         * column narrower than one, as a phone's pane is, a card its width. */
        grid: {
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(min(220px, 100%), 1fr))",
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
            "&[data-clickable]": { cursor: "pointer" },
            "&[data-draggable]": { cursor: "grab" },
            "&[data-filtered]": { opacity: "0.45" },
            "&[data-dragging]": { opacity: "0.4" },
            _focusVisible: { outline: "none", boxShadow: "focus" },
            /* Secondary facts under the meta: the grip and tile top-align. */
            "&[data-tall]": { alignItems: "flex-start" },
            /* Placed — the item already on the target: the brand border and
             * tint, and the brand ink through the grip, the tile, the name,
             * the meta and the glyph. */
            "&[data-placed]": {
                borderColor: "brand.solid",
                background: "bg.brand.subtle",
                _hover: { borderColor: "brand.solid" },
            },
        },
        grip: {
            flexShrink: "0",
            width: "{spacing.2}",
            fontSize: "10px",
            /* The faintest ink, `--ink-5`. */
            color: "fg.faint",
            /* Touch: the grip is the instant-drag handle (drag-layer grip
             * fast-path) — no scroll gesture from it, and a 32px tap halo. */
            touchAction: "none",
            ...coarseHitArea({ position: true, size: 32 }),
            "[data-tall] > &": { alignSelf: "center" },
            "[data-placed] > &": { color: "brand.solid" },
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
            "[data-placed] > &": { background: "bg.surface", color: "brand.solid" },
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
            fontSize: "{fontSizes.body}",
            fontWeight: "600",
            lineHeight: "1.2",
            color: "fg",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            "[data-placed] &": { color: "brand.fg" },
        },
        cardSublabel: {
            fontFamily: "mono",
            fontSize: "10px",
            lineHeight: "1.2",
            color: "fg.subtle",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            "[data-placed] &": { color: "brand.solid" },
        },
        /* The card's right edge — its status, then its glyph. */
        trailing: {
            flexShrink: "0",
            display: "inline-flex",
            alignItems: "center",
            gap: "{spacing.2}",
            "[data-tall] > &": { alignSelf: "center" },
        },
        /* A lock, a status dot: the quiet ink, the brand's while placed,
         * or the tone it carries. */
        glyph: {
            display: "inline-flex",
            flexShrink: "0",
            fontSize: "9.5px",
            color: "fg.faint",
            "[data-placed] &": { color: "brand.solid" },
            "&[data-tone=success]": { color: "fg.success" },
            "&[data-tone=warning]": { color: "fg.warning" },
            "&[data-tone=danger]": { color: "fg.danger" },
            "&[data-tone=info]": { color: "brand.solid" },
            "&[data-tone=neutral]": { color: "fg.subtle" },
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
        /* The footer's add, at its end: Font Awesome's plus, then the words
         * (#1263) — the plus the secondary-fact trigger's icon size, its own
         * width, not Font Awesome's fixed 1.25em. */
        addAction: {
            ...CAPS,
            "--fa-width": "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            marginLeft: "auto",
            letterSpacing: "0.14em",
            color: "brand.solid",
            cursor: "pointer",
            background: "transparent",
            border: "none",
            padding: "0",
            "& svg": { fontSize: "9px" },
            _hover: { color: "brand.fg" },
        },
        ghost: {
            fontSize: "{fontSizes.body}",
            fontWeight: "600",
            color: "fg",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "brand.solid",
            borderRadius: "{radii.md}",
            paddingX: "{spacing.3}",
            paddingY: "{spacing.1}",
        },

        /* ─── Gallery ─────────────────────────────────────────────────
         * The renderer binds `--library-columns` (the style's columns) and
         * `--library-media` (its media size) on the grid, which carries the
         * layout (`data-layout`) and the media's place (`data-media`). A
         * column never narrows past the card's least width, so a narrower
         * Library holds fewer, and a phone one. */
        galleryGrid: {
            "--library-gap": "12px",
            "--library-least": "180px",
            display: "grid",
            gap: "var(--library-gap)",
            gridTemplateColumns:
                "repeat(auto-fill, minmax(max(var(--library-least), calc((100% - (var(--library-columns) - 1) * var(--library-gap)) / var(--library-columns))), 1fr))",
            "&[data-media=start]": { "--library-gap": "14px", "--library-least": "320px" },
            "&[data-layout=list]": { gridTemplateColumns: "minmax(0, 1fr)" },
        },
        galleryCard: {
            position: "relative",
            display: "flex",
            flexDirection: "column",
            minWidth: "0",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "10px",
            overflow: "hidden",
            transitionProperty: "border-color",
            transitionDuration: "fast",
            transitionTimingFunction: "out",
            _hover: { borderColor: "fg.muted" },
            "[data-media=start] > &": { flexDirection: "row", minHeight: "140px" },
            "&[data-clickable]": { cursor: "pointer" },
            "&[data-draggable]": { cursor: "grab" },
            "&[data-filtered]": { opacity: "0.45" },
            "&[data-dragging]": { opacity: "0.4" },
            _focusVisible: { outline: "none", boxShadow: "focus" },
            "&[data-placed]": {
                borderColor: "brand.solid",
                background: "bg.brand.subtle",
                _hover: { borderColor: "brand.solid" },
            },
        },
        /* The media on the sunken paper — a thumbnail, so the card takes its
         * pointer, nothing in it takes focus, and nothing in it scrolls: what
         * does not fit is clipped, never given a scrollbar. */
        galleryMedia: {
            flexShrink: "0",
            display: "flex",
            flexDirection: "column",
            minWidth: "0",
            overflow: "hidden",
            background: "bg.subtle",
            pointerEvents: "none",
            "& *": { scrollbarWidth: "none" },
            "& *::-webkit-scrollbar": { display: "none" },
            "[data-media=top] &": {
                height: "var(--library-media, 112px)",
                padding: "12px",
                borderBottomWidth: "1px",
                borderBottomColor: "border.subtle",
            },
            "[data-media=start] &": {
                width: "var(--library-media, 156px)",
                padding: "14px",
                borderRightWidth: "1px",
                borderRightColor: "border.subtle",
            },
        },
        galleryFace: {
            flex: "1",
            minWidth: "0",
            display: "flex",
            flexDirection: "column",
            gap: "3px",
            paddingX: "12px",
            paddingY: "10px",
            "[data-media=start] &": { gap: "6px", paddingX: "16px", paddingY: "14px" },
        },
        /* The name, and the status at the right. */
        galleryHead: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "10px",
            minWidth: "0",
        },
        galleryTitle: {
            minWidth: "0",
            fontSize: "13px",
            fontWeight: "600",
            lineHeight: "1.3",
            color: "fg",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            "[data-media=start] &": {
                fontFamily: "heading",
                fontSize: "15px",
                fontWeight: "700",
                letterSpacing: "-0.01em",
            },
            "[data-placed] &": { color: "brand.fg" },
        },
        gallerySublabel: {
            fontFamily: "mono",
            fontSize: "10px",
            lineHeight: "1.3",
            color: "fg.subtle",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            "[data-media=start] &": { fontSize: "10.5px" },
            "[data-placed] &": { color: "brand.solid" },
        },
        /* The foot, under a rule at the face's end: the byline, then the
         * action or the glyph. */
        galleryFoot: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "10px",
            marginTop: "auto",
            paddingTop: "10px",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
            "[data-media=top] &": { marginTop: "6px" },
        },
        galleryByline: {
            display: "flex",
            alignItems: "center",
            gap: "7px",
            minWidth: "0",
        },
        galleryBylineText: {
            fontFamily: "mono",
            fontSize: "10px",
            color: "fg.subtle",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        galleryAction: {
            flexShrink: "0",
            fontSize: "12px",
            fontWeight: "600",
            color: "brand.solid",
            whiteSpace: "nowrap",
        },
        /* The dashed last card: a new one. */
        galleryAdd: {
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            minHeight: "96px",
            padding: "0",
            background: "transparent",
            borderWidth: "1px",
            borderStyle: "dashed",
            borderColor: "border.strong",
            borderRadius: "10px",
            cursor: "pointer",
            transitionProperty: "border-color",
            transitionDuration: "fast",
            _hover: { borderColor: "fg.muted" },
            _focusVisible: { outline: "none", boxShadow: "focus" },
            "[data-media=start] > &": { minHeight: "140px" },
        },
        galleryAddIcon: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "30px",
            height: "30px",
            borderRadius: "{radii.md}",
            borderWidth: "1px",
            borderColor: "border.strong",
            background: "bg.surface",
            color: "fg.muted",
            fontSize: "11px",
        },
        galleryAddLabel: {
            fontSize: "12.5px",
            fontWeight: "500",
            color: "fg.muted",
        },
    },
});
