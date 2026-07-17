/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Splitter slot recipe — overrides Chakra's default `resizeTrigger` handle
 * (a prominent white pill) with a restrained grip: a small rounded bar, subtle
 * at rest and brighter on hover/focus. Auto-applies to every `Splitter.Root`
 * (general layout, Gantt, Planner). Dual-pane collections nudge the grip into
 * the rows area with a per-instance `_after.top` override (the header height is
 * runtime data, not a recipe value).
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { coarseHitArea } from "../../style/hit-area.js";

export const splitterSlotRecipe = defineSlotRecipe({
    className: "elara-splitter",
    slots: ["root", "panel", "resizeTrigger"],
    base: {
        resizeTrigger: {
            width: "9px",
            background: "transparent",
            cursor: "col-resize",
            position: "relative",
            outline: "none",
            /* Touch (#346): `_after` carries the visual grip, so the coarse
             * hit halo rides `_before`. */
            ...coarseHitArea({ pseudo: "_before" }),
            // Hide Chakra's default handle children — the grip below replaces it.
            "& > *": { display: "none" },
            _after: {
                content: '""',
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: "4px",
                height: "26px",
                borderRadius: "full",
                background: "gray.300",
                transition: "background-color 0.15s",
            },
            _hover: { _after: { background: "gray.500" } },
            _focusVisible: { _after: { background: "gray.500" } },
        },
    },
});
