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
 * scrolls round a list that scrolls — and to nothing else: with no picker
 * open the rows keep their height, and a body too short for them scrolls. A page's starting filters stand in the
 * builder's canvas's band over its grid (`starting`): their caption, then
 * their rail.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const studioFiltersSlotRecipe = defineSlotRecipe({
    className: "elara-studio-filters",
    slots: ["page", "row", "rows", "starting", "caption", "bar"],
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
        /* A filter's condition rows in its popover's body: their own height; while the picker is open under them, as tall
           as the body leaves them, the picker taking the rest. */
        rows: {
            display: "flex",
            flexDirection: "column",
            flexShrink: "0",
            "&:has([data-chooser])": { flexShrink: "1", minHeight: "0" },
        },
        /* A page's starting filters in the canvas's band (#1673): their caption, then their rail, the band's whole width. */
        starting: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.3}",
            flex: "1",
            minWidth: "0",
        },
        /* Their caption, in the ink of the rail's own group captions: what they are, before their chips, kept whole. */
        caption: {
            textStyle: "nav.eyebrow",
            color: "fg.subtle",
            flexShrink: "0",
            whiteSpace: "nowrap",
        },
        /* Their rail: the shared toolbar, as wide as the band leaves it — what it folds its chips to. */
        bar: {
            display: "flex",
            alignItems: "center",
            flex: "1",
            minWidth: "0",
        },
    },
});
