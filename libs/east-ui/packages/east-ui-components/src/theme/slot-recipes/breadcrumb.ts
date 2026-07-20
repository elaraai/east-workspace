/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Breadcrumb slot recipe — spec `.hd-crumb` mono nav crumbs.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const breadcrumbSlotRecipe = defineSlotRecipe({
    className: "elara-breadcrumb",
    slots: ["root", "list", "item", "link", "currentLink", "separator", "ellipsis"],
    base: {
        list: {
            display: "inline-flex",
            alignItems: "center",
            gap: "{spacing.2}",
            flexWrap: "wrap",
            fontFamily: "mono",
            fontSize: "11px",
            letterSpacing: "0.06em",
        },
        item: { display: "inline-flex", alignItems: "center" },
        link: {
            fontFamily: "mono",
            fontSize: "11px",
            letterSpacing: "0.06em",
            // Mode-aware `link` token (brand.600 / brand.300) — a raw brand.600
            // stays dark in dark mode and drops below AA on the dark surface (#362).
            color: "link",
            textDecoration: "none",
            cursor: "pointer",
            transitionProperty: "color",
            transitionDuration: "{durations.fast}",
            _hover: { color: "link.hover", textDecoration: "none" },
        },
        currentLink: {
            fontFamily: "mono",
            fontSize: "11px",
            letterSpacing: "0.06em",
            // `fg` (brand.900 in light, gray.100 in dark) — the strong page ink;
            // a raw brand.900 was near-invisible on the dark surface (#362).
            color: "fg",
            fontWeight: "semibold",
        },
        separator: {
            color: "fg.subtle",
            marginX: "0",
            fontFamily: "mono",
            fontSize: "11px",
        },
    },
});
