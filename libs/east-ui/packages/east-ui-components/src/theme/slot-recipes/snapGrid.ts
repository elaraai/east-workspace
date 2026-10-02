/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * SnapGrid slot recipe — the 12-column snap grid of tiles (#989), and the
 * builder's canvas over it (#990).
 *
 * The root is the SnapGrid's frame: it never grows past its host, and a grid
 * wider than it — one at a design width — scrolls within it. The grid stacks
 * the rows with a row gap, and each row is a 12-column grid whose cells take
 * their spans (`--snap-grid-span`), continuing on a line below when their spans
 * pass 12. The grid's width picks the spans a tile takes — CSS container
 * queries, so the renderer measures nothing: under 480px every tile takes the
 * full width, from 480px a span under 6 takes 6 and any other 12
 * (`--snap-grid-span-medium`), and from 960px the span declared. A framed tile is
 * paper with a strong rule and its content clipped, with no header strip; a
 * bare tile draws nothing around its content. The SnapGrid draws no outer
 * border — the host draws the panel around it.
 *
 * A wireframe is the page's miniature, so its cells keep their declared spans
 * at any width: each is an outline, exactly as tall as its declared height,
 * and an auto-height cell — with no content drawn to size it — as tall as the
 * wireframe's row. It draws no frame of its own: its host frames it, as a
 * Library gallery card's media does, and it fills its host's height. A
 * wireframe of no cells is the blank page — a band over the body, each dashed,
 * an empty slot.
 *
 * The canvas (#990) is the builder's: every tile at its declared span on the
 * sunken panel, the column ruler above the rows and the column bands behind
 * them, a gap cell above each row (a drop there makes a new row), each tile an
 * outer placement box holding its frame, its handles and the insertion lines a
 * drag beside it draws, and the end zone under the last row. Its values are
 * the mock's builder markup, in theme tokens. A drag's indicators show only on
 * the cell the drag layer marks active, so they are drawn and hidden by CSS
 * alone; the shared candidate and active frames give way to them, and the
 * shared ⊘ refusal stays.
 *
 * The canvas is the builder's frame (#995): its own bordered panel (the `card`
 * surface), a toolbar row across its width, then its panes beside the canvas
 * column — the selection bar over the sunken column that holds the grid
 * panel. The toolbar's own items — the grid chip, the saved time and the width
 * readout — are the mock's toolbar markup; its zoom is the shared `stepper`
 * and its design widths the shared `seg` strip (#996).
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

/** The shared drag stages the canvas's own indicators replace — the candidate and active frames and the active wash. */
const OWN_INDICATORS = {
    "&[data-drag-cell][data-drop-valid]:not([data-drop-active]):not([data-drop-invalid])::before": { borderStyle: "none" },
    "&[data-drag-cell][data-drop-active]:not([data-drop-invalid])::before": { borderStyle: "none" },
    "&[data-drag-cell][data-drop-active]:not([data-drop-invalid])": { background: "transparent" },
} as const;

/** A brand line with the "+" badge on it — beside a tile, between rows. */
const INDICATOR = {
    position: "absolute",
    display: "none",
    alignItems: "center",
    gap: "{spacing.2}",
    pointerEvents: "none",
    zIndex: 2,
} as const;

/** Where a drop is taken, and not refused — the stage every indicator shows on. */
const TAKEN = "[data-drop-active]:not([data-drop-invalid])";

/**
 * A tile's content takes the tile's height: its own when the tile has none,
 * and the tile's — taller or shorter — when it has one. So a plot that fills a
 * sized box draws at that box's height in an auto tile, and grows and shrinks
 * with a height drag, as the mock's tile body does.
 */
const TILE_BODY = {
    "& > *": { flex: "1 1 auto", minHeight: "0" },
} as const;

/** The toolbar's mono micro-labels — the grid chip and the saved time. */
const MICRO_LABEL = {
    fontFamily: "mono",
    fontSize: "9.5px",
    fontWeight: "600",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
} as const;

export const snapGridSlotRecipe = defineSlotRecipe({
    className: "elara-snap-grid",
    slots: [
        "root", "grid", "row", "cell", "blankBand", "blankBody",
        "editor", "toolbarRow", "body", "pane", "main",
        "selectionBar", "selectionIcon", "selectionName", "selectionMeta", "selectionEmpty", "selectionHint",
        "chip", "saved", "readout", "divider", "widthIcon",
        "viewport", "canvas", "ruler", "rulerMark", "bands", "band", "rows", "gap", "gapLine",
        "tile", "frame", "handle", "remove", "insertBefore", "insertAfter", "rule", "badge", "edgeBefore", "edgeAfter", "guide",
        "endZone", "endZoneBox", "endZoneRest", "endZoneDragging", "endZoneTarget", "ghost",
    ],
    base: {
        root: {
            maxWidth: "100%",
            minWidth: 0,
            overflowX: "auto",
        },
        grid: {
            containerType: "inline-size",
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.3}",
        },
        row: {
            position: "relative",
            display: "grid",
            gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
            columnGap: "{spacing.3}",
            rowGap: "{spacing.3}",
            ...OWN_INDICATORS,
        },
        cell: {
            gridColumn: "span var(--snap-grid-span)",
            minWidth: 0,
            alignSelf: "start",
            display: "flex",
            flexDirection: "column",
            "&[data-align='center']": { alignSelf: "center" },
            "&[data-align='stretch']": { alignSelf: "stretch" },
            ...TILE_BODY,
        },

        // ── The builder's canvas (#990) and its frame (#995) ────────────
        editor: {
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            minHeight: 0,
            bg: "bg.surface",
        },
        // The toolbar across the frame's width, over the panes and the canvas.
        toolbarRow: {
            flex: "none",
            display: "flex",
            alignItems: "center",
            height: "44px",
            paddingX: "{spacing.4}",
            borderBottomWidth: "1px",
            borderBottomStyle: "solid",
            borderBottomColor: "border.subtle",
            bg: "bg.surface",
        },
        body: {
            flex: "1",
            display: "flex",
            minWidth: 0,
            minHeight: 0,
        },
        // A pane sizes itself — a Dock takes its width, or its rail's.
        pane: {
            flex: "none",
            display: "flex",
            minHeight: 0,
        },
        main: {
            flex: "1",
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            minHeight: 0,
            bg: "bg.subtle",
        },
        // The selection bar: the selected tile's icon, name and meta.
        selectionBar: {
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            height: "44px",
            paddingInlineStart: "{spacing.4}",
            paddingInlineEnd: "{spacing.2}",
            borderBottomWidth: "1px",
            borderBottomStyle: "solid",
            borderBottomColor: "border.subtle",
            bg: "bg.panel",
        },
        selectionIcon: {
            flex: "none",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "{spacing.6}",
            height: "{spacing.6}",
            borderRadius: "sm",
            bg: "bg.brand.subtle",
            color: "brand.solid",
            fontSize: "10.5px",
        },
        selectionName: {
            flex: "none",
            fontSize: "13px",
            fontWeight: "600",
            color: "fg",
            whiteSpace: "nowrap",
        },
        selectionMeta: {
            minWidth: 0,
            fontFamily: "mono",
            fontSize: "10.5px",
            color: "fg.subtle",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        selectionEmpty: {
            ...MICRO_LABEL,
            flex: "none",
            letterSpacing: "0.14em",
            color: "fg.subtle",
        },
        selectionHint: {
            fontSize: "12.5px",
            color: "fg.subtle",
            whiteSpace: "nowrap",
        },
        // The toolbar's own items: the grid chip, the saved time, the width
        // readout, the rule before the history, and a design width's icon in
        // its segment.
        chip: {
            ...MICRO_LABEL,
            display: "inline-flex",
            alignItems: "center",
            height: "20px",
            paddingX: "7px",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "border.subtle",
            borderRadius: "sm",
            color: "fg.muted",
        },
        saved: {
            ...MICRO_LABEL,
            color: "fg.success",
        },
        readout: {
            fontFamily: "mono",
            fontSize: "11px",
            color: "fg.subtle",
            whiteSpace: "nowrap",
        },
        divider: {
            flex: "none",
            width: "1px",
            height: "18px",
            bg: "border.strong",
        },
        widthIcon: {
            display: "inline-flex",
            marginInlineEnd: "6px",
            "&:last-child": { marginInlineEnd: "0" },
        },
        viewport: {
            flex: "1",
            minWidth: 0,
            minHeight: 0,
            overflow: "auto",
            padding: "{spacing.4}",
            outline: "none",
        },
        canvas: {
            position: "relative",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            paddingX: "{spacing.4}",
            paddingBottom: "{spacing.4}",
            bg: "bg.panel",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "border.strong",
            borderRadius: "10px",
        },
        ruler: {
            display: "grid",
            gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
            columnGap: "{spacing.3}",
            height: "{spacing.6}",
        },
        rulerMark: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderTopWidth: "2px",
            borderTopStyle: "solid",
            borderTopColor: "border.strong",
            fontFamily: "mono",
            fontSize: "9.5px",
            fontWeight: "400",
            color: "fg.subtle",
            "&[data-on]": { borderTopColor: "brand.solid", color: "brand.fg", fontWeight: "600" },
        },
        // Behind the rows and the end zone: below the ruler and its gap, down to the panel's foot.
        bands: {
            position: "absolute",
            left: "{spacing.4}",
            right: "{spacing.4}",
            top: "34px",
            bottom: "0",
            display: "grid",
            gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
            columnGap: "{spacing.3}",
            pointerEvents: "none",
        },
        band: {
            bg: "bg.subtle",
        },
        rows: {
            position: "relative",
            display: "flex",
            flexDirection: "column",
            userSelect: "none",
        },
        // The gap between rows, and the narrower one above the first — each a place a drop makes a new row.
        gap: {
            position: "relative",
            height: "{spacing.3}",
            "&[data-first]": { height: "6px" },
            ...OWN_INDICATORS,
        },
        gapLine: {
            ...INDICATOR,
            left: "0",
            right: "0",
            top: "50%",
            height: "{spacing.5}",
            marginTop: "-10px",
            "[data-first] > &": { top: "0" },
            [`${TAKEN}:not([data-snap-grid-drop='none']) > &`]: { display: "flex" },
        },
        tile: {
            position: "relative",
            gridColumn: "span var(--snap-grid-span)",
            minWidth: 0,
            alignSelf: "start",
            cursor: "grab",
            touchAction: "none",
            outline: "none",
            transitionProperty: "opacity",
            transitionDuration: "fast",
            transitionTimingFunction: "out",
            "&[data-align='center']": { alignSelf: "center" },
            "&[data-align='stretch']": { alignSelf: "stretch" },
            // The drag layer dims a moved tile's origin.
            "&[data-dragging]": { cursor: "grabbing" },
        },
        frame: {
            height: "100%",
            display: "flex",
            flexDirection: "column",
            ...TILE_BODY,
            borderRadius: "10px",
            transitionProperty: "border-color, box-shadow",
            transitionDuration: "normal",
            transitionTimingFunction: "out",
            "&[data-frame]": {
                bg: "bg.surface",
                borderWidth: "1px",
                borderStyle: "solid",
                borderColor: "border.strong",
                overflow: "hidden",
            },
            "[data-selected] > &": {
                borderWidth: "1px",
                borderStyle: "solid",
                borderColor: "brand.solid",
                boxShadow: "focus",
            },
            // A draft a check refuses — the Sheet's and the Plan's marks: an
            // edge takes the valence base, never its text step.
            "[data-incomplete] > &": { borderColor: "status.warn" },
            "[data-invalid] > &": { borderColor: "status.neg" },
        },
        handle: {
            position: "absolute",
            zIndex: 3,
            width: "9px",
            height: "9px",
            bg: "bg.surface",
            borderWidth: "1.5px",
            borderStyle: "solid",
            borderColor: "brand.solid",
            borderRadius: "2px",
            "&[data-handle='top-left']": { left: "-4px", top: "-4px" },
            "&[data-handle='top-right']": { right: "-4px", top: "-4px" },
            "&[data-handle='bottom-left']": { left: "-4px", bottom: "-4px" },
            "&[data-handle='both']": { right: "-4px", bottom: "-4px", cursor: "nwse-resize" },
            "&[data-handle='span']": {
                right: "-4px", top: "50%", transform: "translateY(-50%)", height: "{spacing.5}", cursor: "ew-resize",
            },
            "&[data-handle='height']": {
                left: "50%", bottom: "-4px", transform: "translateX(-50%)", width: "{spacing.5}", cursor: "ns-resize",
            },
        },
        remove: {
            position: "absolute",
            top: "{spacing.2}",
            right: "{spacing.2}",
            zIndex: 3,
            width: "26px",
            height: "26px",
            display: "grid",
            placeItems: "center",
            padding: "0",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "border.strong",
            borderRadius: "md",
            bg: "bg.surface",
            color: "fg.muted",
            fontSize: "11px",
            cursor: "pointer",
            _hover: { bg: "bg.subtle", color: "fg.danger" },
        },
        insertBefore: {
            ...INDICATOR,
            top: "0",
            bottom: "0",
            left: "-16px",
            width: "{spacing.5}",
            flexDirection: "column",
            [`${TAKEN} > [data-snap-grid-insert='before'] > &`]: { display: "flex" },
        },
        insertAfter: {
            ...INDICATOR,
            top: "0",
            bottom: "0",
            right: "-16px",
            width: "{spacing.5}",
            flexDirection: "column",
            [`${TAKEN} > [data-snap-grid-insert='after'] > &`]: { display: "flex" },
        },
        rule: {
            flex: "1",
            borderColor: "brand.solid",
            borderStyle: "solid",
            borderWidth: "0",
            "[data-snap-grid-insert-line] > &": { borderLeftWidth: "1px" },
            "[data-snap-grid-gap-line] > &": { borderTopWidth: "1px" },
        },
        badge: {
            flex: "none",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "{spacing.5}",
            height: "{spacing.5}",
            borderRadius: "sm",
            bg: "brand.solid",
            color: "bg.surface",
            fontSize: "9px",
        },
        // A drop in a row's top or bottom band makes a new row above or below it.
        edgeBefore: {
            ...INDICATOR,
            left: "0",
            right: "0",
            top: "-16px",
            height: "{spacing.5}",
            [`${TAKEN}[data-snap-grid-drop='before'] > &`]: { display: "flex" },
        },
        edgeAfter: {
            ...INDICATOR,
            left: "0",
            right: "0",
            bottom: "-16px",
            height: "{spacing.5}",
            [`${TAKEN}[data-snap-grid-drop='after'] > &`]: { display: "flex" },
        },
        guide: {
            position: "absolute",
            left: "-8px",
            right: "-8px",
            marginTop: "-1px",
            borderTopWidth: "1px",
            borderTopStyle: "dashed",
            borderTopColor: "brand.solid",
            pointerEvents: "none",
            zIndex: 2,
        },
        endZone: {
            position: "relative",
            paddingTop: "{spacing.3}",
            ...OWN_INDICATORS,
        },
        endZoneBox: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "{spacing.16}",
            borderWidth: "1px",
            borderStyle: "dashed",
            borderColor: "border.strong",
            borderRadius: "10px",
            fontFamily: "mono",
            fontSize: "10.5px",
            fontWeight: "600",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "fg.subtle",
            transitionProperty: "background, border-color",
            transitionDuration: "fast",
            transitionTimingFunction: "out",
            "[data-drop-valid] > &": { borderColor: "brand.solid", color: "brand.solid" },
            [`${TAKEN}:not([data-snap-grid-drop='none']) > &`]: { borderColor: "brand.solid", bg: "bg.brand.subtle", color: "brand.fg" },
            [`[data-snap-grid-drop='end']${TAKEN} ~ [data-snap-grid-end] > &`]: {
                borderColor: "brand.solid", bg: "bg.brand.subtle", color: "brand.fg",
            },
        },
        // The end zone's words: at rest, while a drag can land, and while a
        // drop there — or under the last row — would make a new row.
        endZoneRest: {
            "[data-drop-valid] > * > &": { display: "none" },
        },
        endZoneDragging: {
            display: "none",
            "[data-drop-valid] > * > &": { display: "inline" },
            [`${TAKEN}:not([data-snap-grid-drop='none']) > * > &`]: { display: "none" },
            [`[data-snap-grid-drop='end']${TAKEN} ~ [data-snap-grid-end] > * > &`]: { display: "none" },
        },
        endZoneTarget: {
            display: "none",
            [`${TAKEN}:not([data-snap-grid-drop='none']) > * > &`]: { display: "inline" },
            [`[data-snap-grid-drop='end']${TAKEN} ~ [data-snap-grid-end] > * > &`]: { display: "inline" },
        },
        ghost: {
            display: "inline-flex",
            alignItems: "center",
            paddingInline: "{spacing.3}",
            height: "{spacing.8}",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "brand.solid",
            borderRadius: "md",
            bg: "bg.surface",
            fontSize: "body",
            fontWeight: "600",
            color: "fg",
            whiteSpace: "nowrap",
        },
    },
    variants: {
        variant: {
            tiles: {
                cell: {
                    "&[data-frame]": {
                        bg: "bg.surface",
                        borderWidth: "1px",
                        borderStyle: "solid",
                        borderColor: "border.strong",
                        borderRadius: "10px",
                        overflow: "hidden",
                    },
                    "@container (max-width: 479.98px)": { gridColumn: "1 / -1" },
                    "@container (min-width: 480px) and (max-width: 959.98px)": { gridColumn: "span var(--snap-grid-span-medium)" },
                },
            },
            // The page library's thumbnail: outlined boxes, closer together
            // than a page's tiles, filling the host that frames them; the
            // blank page's empty slots dashed.
            wireframe: {
                root: { flex: "1", display: "flex", flexDirection: "column" },
                grid: { flex: "1", gap: "5px" },
                row: { columnGap: "3px", rowGap: "5px" },
                cell: {
                    "&[data-auto-height]": { minHeight: "{spacing.6}" },
                    bg: "bg.surface",
                    borderWidth: "1px",
                    borderStyle: "solid",
                    borderColor: "border.strong",
                    borderRadius: "2px",
                },
                blankBand: {
                    flexShrink: "0",
                    height: "12px",
                    bg: "bg.surface",
                    borderWidth: "1px",
                    borderStyle: "dashed",
                    borderColor: "border.strong",
                    borderRadius: "2px",
                },
                blankBody: {
                    flex: "1",
                    minHeight: "{spacing.6}",
                    bg: "bg.surface",
                    borderWidth: "1px",
                    borderStyle: "dashed",
                    borderColor: "border.strong",
                    borderRadius: "2px",
                },
            },
        },
        // The editing canvas's frame (#995): its own bordered panel, or none
        // inside a host's.
        surface: {
            card: {
                editor: {
                    borderWidth: "1px",
                    borderStyle: "solid",
                    borderColor: "border.strong",
                    borderRadius: "10px",
                    overflow: "hidden",
                },
            },
            shell: {},
        },
    },
    defaultVariants: { variant: "tiles", surface: "card" },
});
