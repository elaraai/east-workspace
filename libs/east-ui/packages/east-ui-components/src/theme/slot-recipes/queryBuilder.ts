/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Query builder slot recipe (#935) — the builder's frame, as the Query Editor
 * spec draws it: its one toolbar band over the pane and the results, side by
 * side, and the status line under both. The builder fills its host and draws
 * no border of its own; a host frames it, or places it bare.
 *
 * Only the layout is the builder's own. Its toolbar row is the shared
 * `toolbar`'s, its pane the `dock`'s, its history item the `editHistory`'s;
 * the Query tab's parts, the jq view and the results are their own recipes'
 * (`queryResults`, `jqEditor`), each surface adding its slots.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const queryBuilderSlotRecipe = defineSlotRecipe({
    className: "elara-query-builder",
    slots: ["root", "toolbar", "body", "tab", "results", "status"],
    base: {
        /* As tall as its host lets it be, and unframed. */
        root: {
            display: "flex",
            flexDirection: "column",
            width: "100%",
            height: "100%",
            minHeight: "0",
            background: "bg.surface",
            overflow: "hidden",
        },
        /* The one toolbar band: the shared toolbar's row. */
        toolbar: {
            display: "flex",
            flexWrap: "nowrap",
            alignItems: "center",
            flexShrink: "0",
            height: "44px",
            paddingX: "{spacing.4}",
            background: "bg.surface",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            overflow: "clip",
        },
        /* The pane before the results. */
        body: {
            flex: "1",
            minHeight: "0",
            display: "flex",
            flexDirection: "row",
        },
        /* A tab of the pane: its panel's whole height, scrolling. */
        tab: {
            height: "100%",
            minHeight: "0",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
        },
        /* The results beside the pane. */
        results: {
            flex: "1",
            minWidth: "0",
            minHeight: "0",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
        },
        /* The status line under the pane and the results. */
        status: {
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
        },
    },
});
