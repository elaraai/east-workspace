/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Studio filters slot recipe — a page's filters (#1673): the row a page
 * draws its filter rail in, over its grid, the two one box (`page`) whatever
 * the host holds the page in. A filter's popover edits it with
 * the query builder's condition rows in place (`queryBuilder`'s
 * `conditions`), the shared picker in the flow under them, in the block of
 * `rows`, which gives up its height to the picker so the popover's body never
 * scrolls round a list that scrolls.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const studioFiltersSlotRecipe = defineSlotRecipe({
    className: "elara-studio-filters",
    slots: ["page", "row", "rows"],
    base: {
        /* The page: its rail over its grid, one box — no gap of its host's layout comes between them (the builder's Preview's frame has one). */
        page: {
            display: "flex",
            flexDirection: "column",
            minWidth: "0",
        },
        /* The page's rail: the shared toolbar's row, the grid's own gap under it; no border — its host frames it. */
        row: {
            display: "flex",
            alignItems: "center",
            minWidth: "0",
            marginBottom: "{spacing.3}",
        },
        /* A filter's condition rows in its popover's body: as tall as the body leaves them, the picker under them taking the rest. */
        rows: {
            display: "flex",
            flexDirection: "column",
            minHeight: "0",
        },
    },
});
