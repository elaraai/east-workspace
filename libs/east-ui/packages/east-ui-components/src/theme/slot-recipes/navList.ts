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
            color: "fg.subtle",
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
            /* Touch (#346): the fixed 36px row grows to 44px on coarse. */
            _coarse: { height: "44px" },
            paddingInline: "14px",
            paddingBlock: "0",
            borderRadius: "{radii.sm}",
            background: "transparent",
            color: "fg.muted",
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
                color: "link",
            },
            // Active row is an inset pill, not a full-width band. `brandTint`
            // and `brand.fg` are mode-aware semantic tokens (#362) — the pill
            // flips to a brand.800 fill with brand.300 ink in dark.
            "&[aria-current=page], &[data-active]": {
                width: "calc(100% - 16px)",
                marginInline: "8px",
                paddingInline: "12px",
                background: "{colors.brandTint}",
                color: "brand.fg",
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
            color: "fg.subtle",
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
                    background: "bg.panel",
                    borderWidth: "1px",
                    borderStyle: "solid",
                    borderColor: "border.subtle",
                    borderRadius: "{radii.lg}",
                },
            },
            /** App-shell sidebar — no chrome; the host panel owns fill + rule. */
            shell: {},
        },
        /** Collapsed rail — icon-only: labels / badges / section headings hidden,
         *  rows centred so the leading icon is the whole hit target (the `<App>`
         *  56 px rail). Active tint + click stay live. */
        collapsed: {
            true: {
                item: {
                    justifyContent: "center",
                    gap: "0",
                    paddingInline: "0",
                    "&[aria-current=page], &[data-active]": {
                        width: "calc(100% - 12px)",
                        marginInline: "6px",
                        paddingInline: "0",
                        justifyContent: "center",
                    },
                },
                itemText: { display: "none" },
                badge: { display: "none" },
                groupLabel: { display: "none" },
            },
            false: {},
        },
    },
    defaultVariants: {
        surface: "card",
        collapsed: false,
    },
});
