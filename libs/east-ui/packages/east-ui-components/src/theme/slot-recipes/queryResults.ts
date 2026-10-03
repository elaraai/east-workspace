/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Query results slot recipe (#935, #938) — the region beside the query
 * builder's pane where a run's result shows (`Query Editor Spec.md` §4.11):
 *
 * - `banners`: the strips, which the builder draws under its toolbar, its full
 *   width, edge to edge, each over a rule —
 *   a `strip` of `data-tone` stale (its `stripTag`, its `stripText` and Run
 *   again's `stripAction` with its `stripKeys`), error (its `stripIcon`, then
 *   a `stripBody` of its `stripTitle` and its message) or note (its icon, its
 *   text and its dismiss);
 * - `body`: the result — the Table or the Value tree filling it — or what
 *   stands in for one: `idle` (the empty state and its `idleList`) before any
 *   run, `running` (its `runningHead` — the sources it reads, and a split
 *   run's `runningProgress` at its end — then `skeletonRow`s of
 *   `skeletonCell`s, each `data-width` short, mid or long) while one goes.
 *   `data-stale`: the result is of another query than the one shown — its
 *   body is dashed;
 * - `footer`: the result's read-outs — `footerCount`, `footerFields`, a
 *   `footerSpacer`, the plan's read-out `footerPlan` (a quiet button, #941),
 *   the run's `footerRun` and what it read, `footerReads`. On the root,
 *   `data-width` narrow drops the fields and tight what the run read too;
 * - the plan's explanation, in the design system's popover the read-out
 *   opens: `planLines`, each `planLine` a `planText` and the `planCode` it is
 *   about; `data-kind` total sets a total under its combine, and path, the
 *   verdict, in the ink.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const queryResultsSlotRecipe = defineSlotRecipe({
    className: "elara-query-results",
    slots: [
        "root", "banners", "strip", "stripTag", "stripText", "stripIcon", "stripBody", "stripTitle", "stripKeys", "stripAction",
        "body", "idle", "idleList", "running", "runningHead", "runningProgress", "skeletonRow", "skeletonCell",
        "footer", "footerCount", "footerFields", "footerSpacer", "footerPlan", "footerRun", "footerReads",
        "planLines", "planLine", "planText", "planCode",
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
            flexShrink: "0",
            "&:empty": { display: "none" },
        },
        /* A strip: edge to edge, over a rule; its tone by `data-tone`. */
        strip: {
            display: "flex",
            alignItems: "center",
            gap: "10px",
            minHeight: "36px",
            paddingY: "6px",
            paddingInlineStart: "{spacing.4}",
            paddingInlineEnd: "{spacing.3}",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            fontSize: "12.5px",
            lineHeight: "1.45",
            color: "fg.muted",
            "&[data-tone=stale]": {
                background: "bg.panel",
                borderBottomStyle: "dashed",
                borderBottomColor: "border.strong",
            },
            "&[data-tone=error]": {
                alignItems: "flex-start",
                paddingY: "10px",
                background: "bg.danger.subtle",
            },
            "&[data-tone=note]": {
                background: "bg.info.subtle",
            },
        },
        /* The stale strip's tag: mono capitals before its words. */
        stripTag: {
            flex: "none",
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "semibold",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "fg.subtle",
        },
        stripText: {
            flex: "1",
            minWidth: "0",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            "[data-tone=note] > &": { whiteSpace: "normal" },
        },
        stripIcon: {
            display: "inline-flex",
            flex: "none",
            fontSize: "13px",
            "[data-tone=error] > &": { color: "fg.danger", marginTop: "2px" },
            "[data-tone=note] > &": { color: "fg.info", fontSize: "12px" },
        },
        stripBody: {
            display: "flex",
            flexDirection: "column",
            gap: "2px",
            minWidth: "0",
        },
        stripTitle: {
            fontWeight: "semibold",
            color: "fg",
        },
        /* Run again, and the note's dismiss: at the strip's end. */
        stripAction: {
            flex: "none",
            gap: "6px",
            fontWeight: "semibold",
        },
        /* Run again's keys, beside its word. */
        stripKeys: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "medium",
            color: "fg.subtle",
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
        /* A split run's progress: at the head's end, in the muted ink. */
        runningProgress: {
            marginInlineStart: "auto",
            color: "fg.muted",
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
        /* The plan's read-out: a quiet button in the footer's own type, which opens its explanation. */
        footerPlan: {
            flexShrink: "0",
            display: "inline-flex",
            alignItems: "center",
            height: "22px",
            paddingX: "6px",
            marginX: "-6px",
            borderRadius: "{radii.xs}",
            background: "transparent",
            fontFamily: "inherit",
            fontSize: "inherit",
            fontWeight: "inherit",
            lineHeight: "inherit",
            color: "fg.muted",
            cursor: "pointer",
            _hover: { background: "bg.muted", color: "fg" },
            "&[data-state=open]": { background: "bg.muted", color: "fg" },
            _focusVisible: { outline: "none", boxShadow: "focus" },
        },
        footerRun: {
            flexShrink: "0",
        },
        footerReads: {
            minWidth: "0",
            overflow: "hidden",
            textOverflow: "ellipsis",
        },
        /* The plan's explanation: a line per sentence, each with the jq it is about under it. */
        planLines: {
            listStyle: "none",
            margin: "0",
            padding: "0",
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.2}",
        },
        planLine: {
            display: "flex",
            flexDirection: "column",
            gap: "2px",
            color: "fg.muted",
            "&[data-kind=path]": { color: "fg", fontWeight: "medium" },
            "&[data-kind=total]": { paddingInlineStart: "{spacing.3}" },
        },
        planText: {
            fontSize: "{fontSizes.control}",
            lineHeight: "1.4",
        },
        planCode: {
            fontFamily: "mono",
            fontSize: "11px",
            lineHeight: "1.5",
            color: "fg",
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
        },
    },
});
