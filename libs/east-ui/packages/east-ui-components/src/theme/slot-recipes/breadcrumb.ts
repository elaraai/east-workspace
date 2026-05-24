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
            color: "{colors.brand.600}",
            textDecoration: "none",
            cursor: "pointer",
            transitionProperty: "color",
            transitionDuration: "{durations.fast}",
            _hover: { color: "{colors.brand.700}", textDecoration: "none" },
        },
        currentLink: {
            fontFamily: "mono",
            fontSize: "11px",
            letterSpacing: "0.06em",
            color: "{colors.brand.900}",
            fontWeight: "semibold",
        },
        separator: {
            color: "{colors.gray.500}",
            marginX: "0",
            fontFamily: "mono",
            fontSize: "11px",
        },
    },
});
