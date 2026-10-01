/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Query results slot recipe (#935, #938) — the region beside the query
 * builder's pane where a run's result shows (`Query Editor Spec.md` §4.11):
 *
 * - `banners`: the stale banner, a run's failure and the note after a
 *   download, in flow at the top;
 * - `body`: the result — the Table or the Value tree filling it — or what
 *   stands in for one: `idle` (the empty state and its `idleList`) before any
 *   run, `running` (its `runningHead`, then `skeletonRow`s of
 *   `skeletonCell`s, each `data-width` short, mid or long) while one goes.
 *   `data-stale`: the result is of another query than the one shown — its
 *   body is dashed;
 * - `footer`: the result's read-outs — `footerCount`, `footerFields`, a
 *   `footerSpacer`, the run's `footerRun` and what it read, `footerReads`.
 *   On the root, `data-width` narrow drops the fields and tight what the run
 *   read too.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const queryResultsSlotRecipe = defineSlotRecipe({
    className: "elara-query-results",
    slots: [
        "root", "banners", "body", "idle", "idleList", "running", "runningHead", "skeletonRow", "skeletonCell",
        "footer", "footerCount", "footerFields", "footerSpacer", "footerRun", "footerReads",
    ],
    base: {
        root: {
            flex: "1",
            minHeight: "0",
            display: "flex",
            flexDirection: "column",
            "&[data-width=narrow] [data-query-result-fields], &[data-width=tight] [data-query-result-fields]": { display: "none" },
            "&[data-width=tight] [data-query-result-reads]": { display: "none" },
        },
        banners: {
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.2}",
            flexShrink: "0",
            paddingX: "{spacing.4}",
            paddingTop: "{spacing.3}",
            "&:empty": { display: "none" },
        },
        /* The result: a Table or a Value tree, or what stands in for one. */
        body: {
            position: "relative",
            flex: "1",
            minHeight: "0",
            display: "flex",
            flexDirection: "column",
            overflow: "auto",
            "&[data-stale]": {
                outlineWidth: "1px",
                outlineStyle: "dashed",
                outlineColor: "border.strong",
                outlineOffset: "-5px",
            },
        },
        idle: {
            flex: "1",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "{spacing.6}",
        },
        idleList: {
            listStyle: "none",
            margin: "0",
            padding: "0",
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.1}",
            textAlign: "start",
            fontSize: "{fontSizes.control}",
            color: "fg.muted",
        },
        running: {
            display: "flex",
            flexDirection: "column",
        },
        runningHead: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            height: "36px",
            paddingX: "{spacing.4}",
            background: "bg.panel",
            borderBottomWidth: "1px",
            borderBottomColor: "border.strong",
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "semibold",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "fg.subtle",
        },
        skeletonRow: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.6}",
            height: "36px",
            paddingX: "{spacing.4}",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
        },
        skeletonCell: {
            height: "10px",
            borderRadius: "{radii.xs}",
            "&[data-width=short]": { width: "64px" },
            "&[data-width=mid]": { width: "96px" },
            "&[data-width=long]": { width: "160px" },
        },
        /* The result's read-outs: its count, its run and what it read. */
        footer: {
            display: "flex",
            alignItems: "center",
            flexShrink: "0",
            gap: "{spacing.3}",
            minHeight: "32px",
            paddingX: "{spacing.4}",
            borderTopWidth: "1px",
            borderTopColor: "border.subtle",
            background: "bg.panel",
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "medium",
            fontVariantNumeric: "tabular-nums",
            color: "fg.subtle",
            whiteSpace: "nowrap",
            "&:empty": { display: "none" },
        },
        footerCount: {
            flexShrink: "0",
            color: "fg.muted",
        },
        footerFields: {
            minWidth: "0",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        footerSpacer: {
            flex: "1",
        },
        footerRun: {
            flexShrink: "0",
        },
        footerReads: {
            minWidth: "0",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
    },
});
