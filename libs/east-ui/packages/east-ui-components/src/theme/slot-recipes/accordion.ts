/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Accordion slot recipe — bsys §Accordion (design/index.html L1374).
 *
 * Trigger is mono uppercase eyebrow grammar; closed chevron points right,
 * open chevron points down (CSS rotation). Open trigger uses `paper-2`
 * (canvas) fill; closed stays on `paper`. Outer container carries
 * `1px rule` + 6px radius + overflow hidden so item dividers read cleanly.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const accordionSlotRecipe = defineSlotRecipe({
    className: "elara-accordion",
    slots: ["root", "item", "itemTrigger", "itemTitle", "itemMeta", "itemContent", "itemIndicator", "itemBody"],
    base: {
        root: {
            display: "flex",
            flexDirection: "column",
            borderWidth: "1px",
            borderColor: "border.subtle",
            borderRadius: "{radii.md}",
            overflow: "hidden",
            background: "bg.surface",
        },
        item: {
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            "&:last-of-type": { borderBottomWidth: "0" },
        },
        itemTrigger: {
            display: "flex",
            alignItems: "center",
            gap: "10px",
            width: "100%",
            paddingX: "16px",
            paddingY: "12px",
            cursor: "pointer",
            background: "bg.surface",
            transitionProperty: "background",
            transitionDuration: "{durations.fast}",
            transitionTimingFunction: "{easings.out}",
            _hover: { background: "bg.canvas" },
            /* Open trigger: paper-2 (canvas) fill per bsys L2296 mockup. */
            "&[data-state=open]": {
                background: "bg.canvas",
            },
        },
        /* Title — bsys Accordion header (L2298): mono 11px / 600 / 0.14em
         * uppercase. ink-3 when closed, ink when open. The explicit fontSize on
         * this span beats Chakra's base trigger font. */
        itemTitle: {
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "semibold",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "{colors.gray.600}",
            "[data-state=open] &": {
                color: "{colors.brand.900}",
            },
        },
        /* Meta — right-aligned field/dirty count: mono 11px ink-4 (L2299). */
        itemMeta: {
            marginInlineStart: "auto",
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "normal",
            letterSpacing: "normal",
            textTransform: "none",
            color: "{colors.gray.500}",
        },
        itemIndicator: {
            color: "fg.subtle",
            fontSize: "10px",
            transitionProperty: "transform",
            transitionDuration: "{durations.fast}",
            transitionTimingFunction: "{easings.out}",
            /* Closed: chevron points right; open: chevron points down.
             * Chakra ships the default-down chevron; we rotate -90deg when
             * closed to land on right. */
            transform: "rotate(-90deg)",
            "&[data-state=open]": {
                transform: "rotate(0deg)",
            },
        },
        itemContent: {
            paddingX: "18px",
            paddingY: "14px",
        },
        itemBody: {
            fontSize: "13px",
            color: "fg",
            lineHeight: "1.5",
        },
    },
});
