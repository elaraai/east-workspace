/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Dock slot recipe — the design system's docked pane, as the Studio spec
 * draws its palette and inspector. Expanded, the pane has one row: its tab
 * row, the mono caps labels — each with any count after it, in the quiet ink
 * — with the open tab underlined in ink, and the collapse control at the
 * row's end. A row its tabs don't fit folds them (#1210): its counts leave
 * the row (`data-fold` on the tab list), then its trailing tabs go into the
 * `+n` menu's trigger (`tabMore`), drawn as a tab is; a lone open tab that
 * still doesn't fit (`data-squeezed`) shrinks, its name cut short with an
 * ellipsis. Collapsed, the rail: a bar holding the expand control, then the
 * icon tile, the count, the label and the detail, read down the rail — the
 * tile and the count in the brand while the pane is active, as the
 * inspector's are while a tile is selected. The recipe carries
 * the static chrome; the size along the collapse axis and the animated
 * transition are data-driven and set inline by the renderer.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { coarseHitArea } from "../../style/hit-area.js";

/** The mono caps voice of a pane's tabs and its rail label. */
const CAPS = {
    fontFamily: "mono",
    fontSize: "10.5px",
    fontWeight: "600",
    letterSpacing: "0.14em",
    lineHeight: "normal",
    textTransform: "uppercase",
} as const;

export const dockSlotRecipe = defineSlotRecipe({
    className: "elara-dock",
    slots: ["root", "header", "tabs", "tabList", "tab", "tabLabel", "tabCount", "tabMore", "toggle", "body", "railBar", "rail", "iconTile", "badge", "railLabel", "railDetail"],
    base: {
        root: {
            display: "flex",
            flexDirection: "column",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "{radii.md}",
            background: "bg.surface",
            overflow: "hidden",
            minWidth: 0,
            minHeight: 0,
            /* A pane inside a host's frame keeps only the rule toward the
             * content it serves. */
            "&[data-surface=shell]": { borderWidth: "0", borderRadius: "0" },
            "&[data-surface=shell][data-orientation=horizontal][data-side=start]": { borderRightWidth: "1px" },
            "&[data-surface=shell][data-orientation=horizontal][data-side=end]": { borderLeftWidth: "1px" },
            "&[data-surface=shell][data-orientation=vertical][data-side=start]": { borderBottomWidth: "1px" },
            "&[data-surface=shell][data-orientation=vertical][data-side=end]": { borderTopWidth: "1px" },
            /* A collapsed tray lays its rail along the row. */
            "&[data-collapsed][data-orientation=vertical]": { flexDirection: "row" },
        },
        /* The pane's one row: its tabs, and the collapse control at the end. */
        header: {
            display: "flex",
            alignItems: "stretch",
            gap: "20px",
            paddingLeft: "{spacing.4}",
            paddingRight: "{spacing.2}",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            flexShrink: 0,
            "& > button:last-child": { marginLeft: "auto" },
        },
        /* The tabs and the `+n` menu: the room the row leaves beside the
         * collapse control, whatever the tabs take — what the fold measures. */
        tabs: {
            display: "flex",
            alignItems: "stretch",
            gap: "20px",
            flex: "1 1 0",
            minWidth: 0,
        },
        tabList: {
            display: "flex",
            gap: "20px",
            minWidth: 0,
        },
        tab: {
            ...CAPS,
            display: "flex",
            alignItems: "center",
            gap: "7px",
            flexShrink: 0,
            height: "43px",
            padding: "0",
            background: "transparent",
            border: "none",
            borderBottomWidth: "2px",
            borderBottomStyle: "solid",
            borderBottomColor: "transparent",
            color: "fg.subtle",
            whiteSpace: "nowrap",
            cursor: "pointer",
            _hover: { color: "fg" },
            _focusVisible: { outline: "none", boxShadow: "focus" },
            "&[data-selected]": { color: "fg", borderBottomColor: "fg" },
            /* The open tab alone beside the menu, and still too wide: it shrinks. */
            "&[data-squeezed]": { flexShrink: 1, minWidth: 0 },
            /* The label as the pane's only tab is a name, not a control. */
            "span&": { cursor: "default" },
        },
        tabLabel: {
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
        /* What a tab holds, counted after its label: lighter, near-untracked
         * tabular figures in the quiet ink, open or not. A folded row keeps
         * it in the tab's name, off the row. */
        tabCount: {
            fontWeight: "500",
            letterSpacing: "0.04em",
            fontVariantNumeric: "tabular-nums",
            color: "fg.subtle",
            "[data-fold] &": {
                position: "absolute",
                width: "1px",
                height: "1px",
                margin: "-1px",
                padding: "0",
                overflow: "hidden",
                clip: "rect(0, 0, 0, 0)",
                whiteSpace: "nowrap",
                borderWidth: "0",
            },
        },
        /* The `+n` menu's trigger: the folded tabs' count, drawn as a tab is. */
        tabMore: {
            ...CAPS,
            display: "flex",
            alignItems: "center",
            gap: "5px",
            flexShrink: 0,
            height: "43px",
            padding: "0",
            background: "transparent",
            border: "none",
            borderBottomWidth: "2px",
            borderBottomStyle: "solid",
            borderBottomColor: "transparent",
            color: "fg.subtle",
            whiteSpace: "nowrap",
            cursor: "pointer",
            _hover: { color: "fg" },
            _focusVisible: { outline: "none", boxShadow: "focus" },
            "& svg": { fontSize: "8px", opacity: 0.7 },
        },
        toggle: {
            flexShrink: 0,
            alignSelf: "center",
            display: "grid",
            placeItems: "center",
            width: "28px",
            height: "28px",
            padding: "0",
            background: "transparent",
            border: "none",
            borderRadius: "{radii.md}",
            color: "fg.subtle",
            fontSize: "11px",
            cursor: "pointer",
            transitionProperty: "background, color",
            transitionDuration: "{durations.fast}",
            transitionTimingFunction: "{easings.out}",
            _hover: { background: "bg.subtle", color: "fg" },
            _focusVisible: { outline: "none", boxShadow: "focus" },
            /* Touch hit target (#350). */
            ...coarseHitArea({ position: true }),
        },
        body: {
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            overflow: "auto",
            display: "flex",
            flexDirection: "column",
            "&[hidden]": { display: "none" },
        },
        /* The rail's head: the expand control, alone on its bar. */
        railBar: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "44px",
            flexShrink: 0,
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            "[data-orientation=vertical] > &": {
                height: "auto",
                width: "44px",
                borderBottomWidth: "0",
                borderRightWidth: "1px",
                borderRightColor: "border.subtle",
            },
        },
        /* The rest of the rail — the whole of it expands the pane. */
        rail: {
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "{spacing.3}",
            paddingY: "14px",
            color: "fg.muted",
            cursor: "pointer",
            transitionProperty: "background",
            transitionDuration: "{durations.fast}",
            transitionTimingFunction: "{easings.out}",
            _hover: { background: "bg.panel" },
            "[data-orientation=vertical] > &": { flexDirection: "row", paddingY: "0", paddingX: "14px" },
        },
        iconTile: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            width: "30px",
            height: "30px",
            borderRadius: "{radii.sm}",
            background: "bg.subtle",
            color: "fg.muted",
            fontSize: "12px",
            "[data-active] > &": { background: "bg.brand.subtle", color: "brand.solid" },
        },
        badge: {
            display: "inline-flex",
            alignItems: "center",
            flexShrink: 0,
            height: "18px",
            paddingX: "5px",
            borderWidth: "1px",
            borderColor: "border.strong",
            borderRadius: "{radii.sm}",
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            lineHeight: "normal",
            fontVariantNumeric: "tabular-nums",
            color: "fg.muted",
            "[data-active] > &": { borderColor: "brand.solid", background: "bg.brand.subtle", color: "brand.fg" },
        },
        railLabel: {
            ...CAPS,
            writingMode: "vertical-rl",
            /* Strong secondary ink, `--ink-2`. */
            color: "fg.strong",
            whiteSpace: "nowrap",
            "[data-orientation=vertical] &": { writingMode: "horizontal-tb" },
        },
        /* What the pane shows now — the inspector's selected tile — muted
         * until the pane is active. */
        railDetail: {
            writingMode: "vertical-rl",
            maxHeight: "340px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: "12px",
            fontWeight: "600",
            lineHeight: "normal",
            color: "fg.subtle",
            "[data-active] > &": { color: "fg" },
            "[data-orientation=vertical] &": { writingMode: "horizontal-tb", maxHeight: "none", maxWidth: "340px" },
        },
    },
});
