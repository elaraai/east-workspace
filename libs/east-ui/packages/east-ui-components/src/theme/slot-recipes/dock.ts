/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Dock slot recipe — the design system's docked pane, as the Studio spec
 * draws its palette and inspector. Expanded, the pane has one row: its tab
 * row, the mono caps labels with the open tab underlined in ink, and the
 * collapse control at the row's end. Collapsed, the rail: a bar holding the
 * expand control, then the icon tile, the count and the label, read down the
 * rail. The recipe carries the static chrome; the size along the collapse axis
 * and the animated transition are data-driven and set inline by the renderer.
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

/** Strong secondary ink — the rail's label. */
const INK_2 = { base: "brand.700", _dark: "gray.300" } as const;

export const dockSlotRecipe = defineSlotRecipe({
    className: "elara-dock",
    slots: ["root", "header", "tabList", "tab", "toggle", "body", "railBar", "rail", "iconTile", "badge", "railLabel"],
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
        tabList: {
            display: "flex",
            gap: "20px",
            minWidth: 0,
        },
        tab: {
            ...CAPS,
            display: "flex",
            alignItems: "center",
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
            /* The label as the pane's only tab is a name, not a control. */
            "span&": { cursor: "default" },
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
        },
        railLabel: {
            ...CAPS,
            writingMode: "vertical-rl",
            color: INK_2,
            whiteSpace: "nowrap",
            "[data-orientation=vertical] &": { writingMode: "horizontal-tb" },
        },
    },
});
