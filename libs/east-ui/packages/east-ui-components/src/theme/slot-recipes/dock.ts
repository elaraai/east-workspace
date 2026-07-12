/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Dock slot recipe — an inline panel that collapses along an axis to an icon
 * rail. The recipe carries the STATIC chrome (surface, border, header, rail,
 * badge, toggle); the size along the collapse axis, flex-direction, and
 * animated transition are data-driven and set inline by the renderer (they
 * depend on `orientation` / `collapsed` / `expandedSize` values, not tokens).
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const dockSlotRecipe = defineSlotRecipe({
    className: "elara-dock",
    slots: ["root", "header", "title", "label", "badge", "toggle", "body", "rail"],
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
        },
        header: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            paddingInline: "{spacing.3}",
            paddingBlock: "{spacing.2}",
            borderBottomWidth: "1px",
            borderColor: "border.subtle",
            background: "bg.subtle",
            flexShrink: 0,
        },
        title: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            flex: 1,
            minWidth: 0,
        },
        label: {
            fontSize: "sm",
            fontWeight: "medium",
            color: "fg.default",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        badge: {
            fontSize: "xs",
            fontWeight: "medium",
            color: "fg.default",
            background: "bg.brand.subtle",
            borderRadius: "{radii.full}",
            paddingInline: "{spacing.1.5}",
            minWidth: "{sizes.5}",
            textAlign: "center",
            flexShrink: 0,
        },
        toggle: {
            color: "fg.muted",
            flexShrink: 0,
        },
        body: {
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            overflow: "auto",
        },
        rail: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            padding: "{spacing.2}",
            color: "fg.muted",
            cursor: "pointer",
            transitionProperty: "background",
            transitionDuration: "{durations.fast}",
            transitionTimingFunction: "{easings.out}",
            _hover: { background: "bg.subtle" },
        },
    },
});
