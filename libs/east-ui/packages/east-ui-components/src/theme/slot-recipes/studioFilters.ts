/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Studio filters slot recipe — a page's filters (#1673): the row a page
 * draws its filter rail in, over its grid. A filter's popover edits it with
 * the query builder's condition rows in place (`queryBuilder`'s
 * `conditions`), the shared picker in the flow under them.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const studioFiltersSlotRecipe = defineSlotRecipe({
    className: "elara-studio-filters",
    slots: ["row"],
    base: {
        /* The page's rail: the shared toolbar's row, the grid's own gap under it; no border — its host frames it. */
        row: {
            display: "flex",
            alignItems: "center",
            minWidth: "0",
            marginBottom: "{spacing.3}",
        },
    },
});
