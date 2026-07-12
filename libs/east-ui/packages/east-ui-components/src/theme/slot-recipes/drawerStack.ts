/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Drawer-stack rail slot recipe (#328) — ancestor drawers collapsed to thin
 * vertical rails while a deeper drawer is active. The `railGroup` is a
 * full-height flex sibling of the drawer panel INSIDE the active drawer's
 * Positioner, so it inherits the drawer's overlay layer (no hardcoded z-index)
 * and stands flush against the panel: full height, FLAT (square, no shadow),
 * with the rail segments flush (no gap) and hairline-divided. The icon + rotated
 * label sit at the TOP of each rail.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const drawerStackRailSlotRecipe = defineSlotRecipe({
    className: "elara-drawer-stack-rail",
    slots: ["railGroup", "rail", "icon", "label"],
    base: {
        railGroup: {
            display: "flex",
            flexDirection: "row",
            alignSelf: "stretch",            // full height, matches the panel
            background: "bg.surface",        // same surface as the drawer content
            borderInlineStartWidth: "1px",   // delineate the spine's outer edge
            borderColor: "border.subtle",
            overflow: "hidden",
            // The Positioner is pointer-events:none (clicks fall through to the
            // backdrop); re-enable so the rails are clickable.
            pointerEvents: "auto",
            // flat + square: no radius, no shadow — butts flush against the panel.
        },
        rail: {
            pointerEvents: "auto",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "flex-start",    // icon + label at the TOP
            gap: "{spacing.2}",
            paddingBlockStart: "{spacing.4}",
            paddingInline: "{spacing.2}",
            width: "44px",
            flexShrink: 0,
            cursor: "pointer",
            color: "fg.muted",
            // Hairline divider between flush rail segments (none after the last).
            _notLast: { borderInlineEndWidth: "1px", borderInlineEndColor: "border.subtle" },
            transitionProperty: "background, color",
            transitionDuration: "{durations.fast}",
            transitionTimingFunction: "{easings.out}",
            _hover: { background: "bg.muted", color: "fg.default" },
            _focusVisible: { background: "bg.muted", color: "fg.default", outline: "2px solid", outlineColor: "border.emphasized", outlineOffset: "-2px" },
        },
        icon: {
            flexShrink: 0,
        },
        label: {
            writingMode: "vertical-rl",
            transform: "rotate(180deg)",
            fontSize: "sm",
            fontWeight: "medium",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxHeight: "60%",
        },
    },
});
