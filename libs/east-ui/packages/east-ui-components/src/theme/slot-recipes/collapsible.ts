/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Collapsible slot recipe — bsys eyebrow grammar applies to all disclosure
 * triggers; collapsible's trigger reads as a mono-uppercase section label
 * with a leading chevron that rotates between right (closed) and down
 * (open).
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const collapsibleSlotRecipe = defineSlotRecipe({
    className: "elara-collapsible",
    slots: ["root", "trigger", "content", "indicator"],
    base: {
        trigger: {
            display: "inline-flex",
            alignItems: "center",
            gap: "{spacing.2}",
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "semibold",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "fg",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            paddingX: "0",
            paddingY: "{spacing.1}",
            _hover: { color: "brand.fg" },
            /* The chevron carries no data-state of its own, so drive its
             * rotation from the trigger's open state (the trigger button is
             * where Chakra sets data-state). */
            "&[data-state=open] [data-collapsible-chevron]": { transform: "rotate(0deg)" },
        },
        indicator: {
            color: "fg.muted",
            fontSize: "10px",
            transitionProperty: "transform",
            transitionDuration: "{durations.fast}",
            transitionTimingFunction: "{easings.out}",
            transform: "rotate(-90deg)",
        },
        content: { paddingY: "{spacing.2}" },
    },
});
