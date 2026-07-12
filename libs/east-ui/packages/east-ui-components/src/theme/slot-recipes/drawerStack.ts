/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Drawer-stack rail slot recipe (#328) — an ancestor drawer collapsed to a thin
 * vertical rail while a deeper drawer is active. The recipe carries the static
 * chrome (surface, border, rotated label, icon, hover); the fixed edge position
 * + stacking offset are data-driven and set inline (they depend on the drawer's
 * placement and its depth in the stack, not tokens).
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const drawerStackRailSlotRecipe = defineSlotRecipe({
    className: "elara-drawer-stack-rail",
    slots: ["rail", "icon", "label"],
    base: {
        rail: {
            position: "fixed",
            // The drawer Positioner it rides in is pointer-events:none (clicks fall
            // through to the backdrop); re-enable so the rail is clickable.
            pointerEvents: "auto",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "{spacing.2}",
            width: "40px",
            paddingBlock: "{spacing.3}",
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
