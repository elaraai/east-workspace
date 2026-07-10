/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * DecisionQueue slot recipe — the Decide entry surface's row layout.
 *
 * Owns only what the shared chrome doesn't: the active-decision row grid
 * (urgency · title · value · actions), the Group-by toolbar band and its
 * collapsible group heads, the collapsed routine rows, and the dashed
 * routine-summary bar. The frame, header, urgency flag, action buttons,
 * Group-by toggle pills (the `chip` recipe) and any staged footer come from
 * `frame` / `eyebrowRow` / `status` / `button` / `chip` / `commitBar` —
 * this recipe never restyles them.
 *
 * Active rows lead the queue; routine rows demote to a quieter compact grid
 * (no per-row actions) under a single bulk-accept summary.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe } from "@chakra-ui/react";

export const decisionQueueSlotRecipe = defineSlotRecipe({
    className: "elara-decision-queue",
    slots: [
        "rowShell", "row", "title", "titleText", "value", "actions",
        "toolbar", "segLabel", "collapseAll",
        "groupHead", "groupCaret", "groupLabel", "groupSummary",
        "routineGroup", "routineRow", "routineValue", "summary", "summaryCap",
    ],
    base: {
        // Wraps every queue row so a resolved decision can animate out before
        // it unmounts. The exit is verdict-aware: Apply washes the row in the
        // success tone and sweeps it right, Reject washes danger and sweeps
        // left, and a removal that arrived from outside (another operator, a
        // dataflow re-run) gets a quiet fade + lift. The background wash lands
        // first, the sweep/fade follows, and the height collapse trails so the
        // list closes up after the row has visually left.
        rowShell: {
            overflow: "hidden",
            maxHeight: "480px",
            transitionProperty: "opacity, transform, max-height, background-color",
            transitionDuration: "260ms, 300ms, 240ms, 120ms",
            transitionDelay: "100ms, 100ms, 260ms, 0ms",
            transitionTimingFunction: "ease-in, cubic-bezier(0.5, 0, 0.85, 0.4), ease-in-out, ease-out",
            "&[data-leaving]": {
                opacity: 0,
                transform: "translateY(-6px)",
                maxHeight: "0",
            },
            "&[data-leaving=apply]": {
                backgroundColor: "success.subtle",
                transform: "translateX(48px)",
            },
            "&[data-leaving=reject]": {
                backgroundColor: "danger.subtle",
                transform: "translateX(-48px)",
            },
        },
        row: {
            display: "grid",
            gridTemplateColumns: "130px 1fr 90px auto",
            gap: "16px",
            alignItems: "center",
            paddingInline: "18px",
            paddingBlock: "14px",
            borderBottomWidth: "1px",
            borderBottomStyle: "solid",
            borderBottomColor: "border.subtle",
        },
        title: {
            fontSize: "13.5px",
            color: "fg",
            minWidth: "0",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
        // The element that DIRECTLY contains the kind · title · summary spans.
        // `text-overflow: ellipsis` only clips inline content of the element
        // that owns it — a block child (the old structure) defeats it.
        titleText: {
            minWidth: "0",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
        toolbar: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.4}",
            paddingX: "{spacing.5}",
            paddingY: "{spacing.2}",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            flexWrap: "wrap",
        },
        segLabel: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            letterSpacing: "0.14em",
            lineHeight: "normal",
            textTransform: "uppercase",
            color: "fg.subtle",
            marginRight: "{spacing.1}",
        },
        collapseAll: {
            marginLeft: "auto",
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "600",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "link",
            cursor: "pointer",
            background: "transparent",
            border: "none",
            padding: "0",
        },
        groupHead: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.3}",
            paddingInline: "18px",
            paddingBlock: "{spacing.2}",
            background: "bg.panel",
            borderBottomWidth: "1px",
            borderBottomColor: "border.subtle",
            "&[data-collapsible]": { cursor: "pointer" },
        },
        groupCaret: {
            fontFamily: "mono",
            fontSize: "10px",
            color: "fg.subtle",
            width: "12px",
            flexShrink: "0",
        },
        groupLabel: {
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            letterSpacing: "0.14em",
            lineHeight: "normal",
            textTransform: "uppercase",
            color: "fg.muted",
        },
        groupSummary: {
            marginLeft: "auto",
            fontFamily: "mono",
            fontSize: "10px",
            fontWeight: "600",
            letterSpacing: "0.14em",
            lineHeight: "normal",
            textTransform: "uppercase",
            color: "fg.subtle",
        },
        value: {
            fontFamily: "mono",
            fontWeight: "semibold",
            textAlign: "right",
            color: "fg",
        },
        actions: {
            display: "flex",
            alignItems: "center",
            gap: "8px",
        },
        routineGroup: {
            paddingInline: "18px",
            paddingBlock: "8px",
        },
        routineRow: {
            display: "grid",
            gridTemplateColumns: "130px 1fr 90px",
            gap: "16px",
            alignItems: "center",
            paddingBlock: "6px",
            fontSize: "13px",
            color: "fg.subtle",
        },
        routineValue: {
            fontFamily: "mono",
            textAlign: "right",
            color: "fg.muted",
        },
        summary: {
            display: "flex",
            alignItems: "center",
            gap: "12px",
            paddingInline: "14px",
            paddingBlock: "10px",
            background: "bg.canvas",
            borderWidth: "1px",
            borderStyle: "dashed",
            borderColor: "border.strong",
            borderRadius: "6px",
            marginBlock: "4px 10px",
            marginInlineStart: "146px",
        },
        summaryCap: {
            fontFamily: "mono",
            fontSize: "11px",
            fontWeight: "semibold",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "fg.subtle",
        },
    },
});
