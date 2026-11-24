/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Query autocomplete slot recipe (#936, #1673) — the frame a step card's slot
 * opens in the query builder's pane (`Query Editor Spec.md` §4.5) around the
 * one picker, the `Chooser`, which draws its label, its search, the offers in
 * their groups and its foot.
 *
 * It is layered over the `popover` recipe's `content`, never instead of it:
 * `root` hangs in the builder's own coordinates (its measured `left`, `top`
 * or `bottom` and `maxHeight` are the renderer's one inline style), a fixed
 * width inside the design system's 240–360 band, unpadded so the picker
 * reaches its edges, and a column the picker fills, its list the one thing
 * that scrolls.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const queryAutocompleteSlotRecipe = defineSlotRecipe({
    className: "elara-query-autocomplete",
    slots: ["root"],
    base: {
        /* Over the popover's content: absolute in the builder, 320 wide within it, the picker edge to edge and filling it. */
        root: {
            position: "absolute",
            width: "320px",
            minWidth: "0",
            maxWidth: "calc(100% - 16px)",
            padding: "0",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            "& > [data-chooser]": { flex: "1 1 auto", minHeight: "0" },
        },
    },
});
