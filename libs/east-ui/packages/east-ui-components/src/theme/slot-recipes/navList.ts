/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** NavList slot recipe. */

import { defineSlotRecipe } from "@chakra-ui/react";

export const navListSlotRecipe = defineSlotRecipe({
    className: "elara-navlist",
    slots: ["root", "group", "groupLabel", "item", "itemIcon", "itemText", "badge"],
    base: {
        // Shared base — layout + mono type only. The card chrome (paper-2 fill,
        // 1px rule, radius, vertical padding) is applied by the NavList renderer
        // on its own wrapper so other consumers of this slot (e.g. the showcase
        // app-shell sidebar, which brings its own panel chrome) stay un-bordered.
        root: {
            display: "flex",
            flexDirection: "column",
            gap: "0",
            fontFamily: "mono",
        },
        groupLabel: {
            fontFamily: "mono",
            fontSize: "9.5px",
            fontWeight: "semibold",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "{colors.gray.500}",
            paddingInline: "14px",
            paddingTop: "4px",
            paddingBottom: "6px",
            marginTop: "{spacing.2}",
            _first: { marginTop: "0" },
        },
        item: {
            display: "flex",
            alignItems: "center",
            gap: "10px",
            width: "full",
            height: "36px",
            paddingInline: "14px",
            paddingBlock: "0",
            borderRadius: "{radii.sm}",
            background: "transparent",
            color: "{colors.gray.600}",
            fontFamily: "mono",
            fontSize: "{fontSizes.xs}",
            fontWeight: "semibold",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            textAlign: "start",
            appearance: "none",
            cursor: "pointer",
            transitionProperty: "background, color",
            transitionDuration: "{durations.fast}",
            _hover: {
                color: "{colors.brand.600}",
            },
            // Active row is an inset pill, not a full-width band.
            "&[aria-current=page], &[data-active]": {
                width: "calc(100% - 16px)",
                marginInline: "8px",
                paddingInline: "12px",
                background: "{colors.brandTint}",
                color: "{colors.brand.700}",
                fontWeight: "bold",
            },
        },
        itemIcon: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "16px",
            fontSize: "{fontSizes.xs}",
            flexShrink: "0",
        },
        itemText: {
            flex: "1",
            minWidth: "0",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
        badge: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "semibold",
            letterSpacing: "0.04em",
            color: "{colors.gray.500}",
            flexShrink: "0",
        },
    },
    variants: {
        /** Where the nav renders: as its own card, or inside an app shell. */
        surface: {
            /** Standalone NavList component — paper-2 card with 1px rule + radius. */
            card: {
                root: {
                    paddingBlock: "12px",
                    background: "{colors.gray.50}",
                    borderWidth: "1px",
                    borderStyle: "solid",
                    borderColor: "{colors.gray.200}",
                    borderRadius: "{radii.lg}",
                },
            },
            /** App-shell sidebar — no chrome; the host panel owns fill + rule. */
            shell: {},
        },
    },
    defaultVariants: {
        surface: "card",
    },
});
