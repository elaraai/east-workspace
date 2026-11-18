/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Studio filters slot recipe — a page's filters (#1673): the row a page
 * draws its filter rail in, over its grid, and the condition rows a filter's
 * popover edits it with. The rows are the query builder's own parts
 * (`queryBuilder`'s `row`, `slot`, `input`, …), one under another 6 apart as
 * a step's card sets them, in a block their autocomplete hangs inside.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const studioFiltersSlotRecipe = defineSlotRecipe({
    className: "elara-studio-filters",
    slots: ["row", "rows"],
    base: {
        /* The page's rail: the shared toolbar's row, the grid's own gap under it; no border — its host frames it. */
        row: {
            display: "flex",
            alignItems: "center",
            minWidth: "0",
            marginBottom: "{spacing.3}",
        },
        /* The rows' block: the open slot's autocomplete is placed in its coordinates, and stays inside it — so while a
           slot is open the block is tall enough for the list under its slot: its filter, six offers and its foot. */
        rows: {
            position: "relative",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            minWidth: "0",
            "&[data-choosing]": { minHeight: "320px" },
        },
    },
});
