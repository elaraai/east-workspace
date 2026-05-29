/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Tabs slot recipe — underline style only (no pill or boxed tabs); a
 * segmented control belongs on `SegmentGroup`, not here. The active tab
 * gets an ink underline overlapping a hairline base rule; labels follow
 * the mono eyebrow grammar, inactive reading one step quieter. `line`
 * (default) and `plain` variants.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const tabsSlotRecipe = defineSlotRecipe({
    className: "elara-tabs",
    slots: ["root", "list", "trigger", "content", "indicator"],
    base: {
        root: {},
        list: {
            display: "flex",
            alignItems: "stretch",
        },
        trigger: {
            display: "inline-flex",
            alignItems: "center",
            gap: "{spacing.2}",
            cursor: "pointer",
            transitionProperty: "background, color, border-color",
            transitionDuration: "{durations.fast}",
            transitionTimingFunction: "{easings.out}",
            _focusVisible: { outline: "none", boxShadow: "{shadows.focus}" },
        },
        content: {
            paddingY: "{spacing.4}",
        },
        indicator: {
            display: "none",
        },
    },
    variants: {
        variant: {
            /** Default — hairline base rule, ink underline on active.
             *  Trigger labels follow bsys eyebrow grammar. */
            line: {
                list: {
                    borderBottomWidth: "1px",
                    borderBottomColor: "border.subtle",
                    gap: "{spacing.4}",
                },
                trigger: {
                    fontFamily: "mono",
                    fontSize: "11px",
                    fontWeight: "semibold",
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                    color: "fg.subtle",
                    background: "transparent",
                    paddingX: "{spacing.3}",
                    paddingY: "{spacing.3}",
                    borderBottomWidth: "2px",
                    borderBottomColor: "transparent",
                    marginBottom: "-1px",
                    _hover: { color: "fg" },
                    _selected: {
                        color: "fg",
                        borderBottomColor: "fg",
                    },
                    "&[data-selected]": {
                        color: "fg",
                        borderBottomColor: "fg",
                    },
                },
            },
            /** Plain — minimal mono uppercase, no decoration. */
            plain: {
                list: { gap: "{spacing.4}" },
                trigger: {
                    fontFamily: "mono",
                    fontSize: "11px",
                    fontWeight: "semibold",
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                    color: "fg.subtle",
                    background: "transparent",
                    paddingX: "{spacing.2}",
                    paddingY: "{spacing.2}",
                    _hover: { color: "fg" },
                    _selected: { color: "fg" },
                    "&[data-selected]": { color: "fg" },
                },
            },
        },
        size: {
            sm: { trigger: { fontSize: "10.5px" } },
            md: { trigger: { fontSize: "11px" } },
            lg: { trigger: { fontSize: "11.5px" } },
        },
    },
    defaultVariants: {
        variant: "line",
        size: "md",
    },
});
