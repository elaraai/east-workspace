/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Query results slot recipe (#935) — the region beside the query builder's
 * pane where a run's result shows: its body, which the result's Table or Value
 * tree fills, and its footer of read-outs. The runs and their states add their
 * slots here (#938).
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const queryResultsSlotRecipe = defineSlotRecipe({
    className: "elara-query-results",
    slots: ["root", "body", "footer"],
    base: {
        root: {
            flex: "1",
            minHeight: "0",
            display: "flex",
            flexDirection: "column",
        },
        /* The result: a Table or a Value tree, or what stands in for one. */
        body: {
            flex: "1",
            minHeight: "0",
            display: "flex",
            flexDirection: "column",
            overflow: "auto",
        },
        /* The result's read-outs: its count, its run and what it read. */
        footer: {
            display: "flex",
            alignItems: "center",
            flexShrink: "0",
            gap: "{spacing.3}",
            minHeight: "28px",
            paddingX: "{spacing.4}",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
            fontSize: "xs",
            color: "fg.muted",
            "&:empty": { display: "none" },
        },
    },
});
