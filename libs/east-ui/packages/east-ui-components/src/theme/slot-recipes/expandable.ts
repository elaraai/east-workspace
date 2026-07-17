/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Expandable slot recipe — an in-place region takeover. Collapsed, the root
 * is a plain positioning context for the floating toggle control. Expanded,
 * the SAME element pins to the viewport (`position: fixed; inset: 0`) so the
 * content keeps its identity — no portal, no remount.
 *
 * Stacking: the expanded surface sits at `zIndex: 900` — above host app
 * chrome, deliberately below every Chakra floating tier (dropdown 1000,
 * modal 1400, popover 1500, toast 1700, tooltip 1800) so Selects, Menus,
 * Dialogs, and Toasts raised from inside the expanded region stack above it.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const expandableSlotRecipe = defineSlotRecipe({
    className: "elara-expandable",
    slots: ["root", "control", "body"],
    base: {
        root: {
            position: "relative",
        },
        control: {
            position: "absolute",
            top: "{spacing.2}",
            right: "{spacing.2}",
            zIndex: 1,
            opacity: 0.65,
            transitionProperty: "opacity",
            transitionDuration: "{durations.fast}",
            transitionTimingFunction: "{easings.out}",
            background: "bg.surface",
            borderWidth: "1px",
            borderColor: "border.subtle",
            boxShadow: "sm",
            _hover: { opacity: 1 },
            _focusVisible: { opacity: 1 },
        },
        body: {},
    },
    variants: {
        expanded: {
            true: {
                root: {
                    position: "fixed",
                    inset: 0,
                    zIndex: 900,
                    background: "bg.canvas",
                    overflow: "hidden",
                    /* Notched phones (#350): the takeover fills the screen,
                     * so pad the content clear of the notch/home indicator.
                     * `inset: 0` already tracks the visual viewport (no vh). */
                    paddingTop: "env(safe-area-inset-top, 0px)",
                    paddingBottom: "env(safe-area-inset-bottom, 0px)",
                },
                control: {
                    boxShadow: "md",
                },
                body: {
                    height: "100%",
                    minHeight: 0,
                    overflow: "auto",
                },
            },
            false: {},
        },
    },
});
