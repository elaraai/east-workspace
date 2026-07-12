/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Drawer-stack rail slot recipe (#328) — ancestor drawers collapsed to thin
 * vertical rails while a deeper drawer is active. The `railGroup` is a
 * full-height flex sibling of the drawer panel INSIDE the active drawer's
 * Positioner, so the rails sit beside the panel (no hardcoded width / position /
 * z-index) and inherit the drawer's overlay layer. Each `rail` stretches to the
 * group's full height with its icon + rotated label centred.
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
            // Stretch to the Positioner's full height so the rails are a
            // full-height spine beside the panel.
            alignSelf: "stretch",
            alignItems: "stretch",
            gap: "{spacing.2}",
            paddingBlock: "{spacing.3}",
            paddingInline: "{spacing.2}",
            // The Positioner is pointer-events:none (clicks fall through to the
            // backdrop); re-enable so the rails are clickable.
            pointerEvents: "auto",
        },
        rail: {
            pointerEvents: "auto",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "{spacing.2}",
            width: "44px",
            flexShrink: 0,
            background: "bg.subtle",
            borderColor: "border.subtle",
            borderWidth: "1px",
            borderRadius: "{radii.md}",
            boxShadow: "sm",
            cursor: "pointer",
            color: "fg.muted",
            transitionProperty: "background, color",
            transitionDuration: "{durations.fast}",
            transitionTimingFunction: "{easings.out}",
            _hover: { background: "bg.muted", color: "fg.default" },
            _focusVisible: { background: "bg.muted", color: "fg.default", outline: "2px solid", outlineColor: "border.emphasized" },
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
            maxHeight: "70%",
        },
    },
});
