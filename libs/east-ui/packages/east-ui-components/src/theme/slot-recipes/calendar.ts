/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Calendar geometry uses the builders' text, state, time and inspector styles. */
import { defineSlotRecipe } from "@chakra-ui/react";
import { fontAwesomeSize } from "../icon-size.js";
import { INSPECTOR_STATUS } from "./inspector.js";
import { PLAN_OVERLAP_RING, planElementDrafted, planElementFocus, planElementSelected } from "./plan/focus.js";
import { builderFooter, builderFooterItem } from "./builder-footer.js";
import { moveGhostSlots, moveGhostBase } from "./time/move-ghost.js";
import { scheduleGroupBase, scheduleGroupSlots } from "./schedule-group.js";
import { rowsBase } from "./plan/rows.js";
import { shellBase } from "./plan/shell.js";
import { nowSlots, nowBase } from "./time/now.js";
import { timeAxisText, timeHeaderText, timeRulerBase } from "./time/axis.js";
import { timeResizeEdge } from "./time/resize.js";

export const calendarSlotRecipe = defineSlotRecipe({
    className: "east-calendar",
    slots: [
        ...moveGhostSlots, "footerItem",
        "root", "main", "scroll", "head", "headerCaption", "columnHead", "columnMeta", "resourceHeading", "rowTitle", "dayHeading", "weekday", "dayDate",
        "timeGridContent", "timeGutter", "timeLabel", "columns", "column", "hour", "shade", "event", "ghost", "eventTitle",
        "eventTop", "eventIcon", "eventWarning", "eventDetail", "eventResource", ...scheduleGroupSlots, "title", "detail",
        "ruler", "rulerRow", "rulerTick", "rulerLabel", "resize", "month", "monthDay", "dayNumber", "more", "timeline",
        "timelineRow", "rowHead", "rowPlot", "agenda", "agendaDay", "agendaHead", "card", "cardHead", "cardTitle",
        "actions", "pane", "paneFoot", "section", "status", "footer", "toolbarRange", "rangeTitle", "toolbarText",
        "form", "error", "empty", ...nowSlots,
    ],
    base: {
        ...moveGhostBase,
        ...nowBase,
        ...scheduleGroupBase,
        root: { ...shellBase.root, height: "100%", minHeight: 0 },
        main: { position: "relative", display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" },
        scroll: { flex: 1, minHeight: 0, minWidth: 0, overflow: "auto", overscrollBehavior: "contain", "&[data-calendar-month-grid]": { display: "flex", flexDirection: "column", "--calendar-month-min-width": "calc(var(--calendar-month-columns) * 104px)" } },
        head: { display: "flex", position: "sticky", top: 0, zIndex: 5, height: "28px", flexShrink: 0, background: "bg.surface", borderBottomWidth: "1px", borderColor: "border.subtle", "&[data-resources]": { height: "44px" }, "&[data-timeline]": { height: "auto" }, "&[data-month]": { minWidth: "var(--calendar-month-min-width)" } },
        headerCaption: { ...shellBase.brushCaption, position: "sticky", left: 0, width: "184px", flexShrink: 0, zIndex: 4, background: "bg.surface" },
        columnHead: {
            flex: 1, minWidth: 0, display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "flex-start", gap: "8px",
            "[data-resources] &": { flexDirection: "column", alignItems: "stretch", justifyContent: "center", gap: "2px" },
            padding: "0 10px", borderLeftWidth: "1px", borderColor: "border.subtle", textAlign: "left",
            "& svg": { ...fontAwesomeSize("10px"), color: "fg.subtle" },
            "&[data-today]": { color: "brand.fg", background: "brand.subtle" },
        },
        dayHeading: { display: "flex", alignItems: "baseline", gap: "6px", minWidth: 0, flexShrink: 0 },
        weekday: { ...timeHeaderText, "[data-today] &": { color: "brand.fg" } },
        dayDate: { ...timeHeaderText, "[data-today] &": { color: "brand.fg" } },
        columnMeta: { ...rowsBase.gutterSub, minWidth: 0, marginTop: 0 },
        resourceHeading: { ...timeHeaderText, overflow: "hidden", textOverflow: "ellipsis" },
        rowTitle: { ...rowsBase.gutterName },
        timeGridContent: { minWidth: "calc(56px + var(--calendar-columns) * 112px)", "&[data-resources]": { minWidth: "calc(56px + var(--calendar-columns) * 104px)" }, "&[data-single]": { minWidth: "296px" } },
        timeGutter: { ...timeAxisText, width: "56px", flexShrink: 0, position: "sticky", left: 0, zIndex: 4, background: "bg.surface", color: "fg.subtle" },
        timeLabel: { position: "absolute", right: "8px", transform: "translateY(-50%)" },
        columns: { display: "flex", flex: 1, minWidth: 0, position: "relative" },
        column: { position: "relative", flex: 1, minWidth: 0, borderLeftWidth: "1px", borderColor: "border.subtle", touchAction: "pan-y" },
        hour: { position: "absolute", left: 0, right: 0, borderTopWidth: "1px", borderColor: "border.subtle", pointerEvents: "none", "&[data-half]": { opacity: 0.45 } },
        shade: { position: "absolute", background: "bg.muted", opacity: 0.45, pointerEvents: "none", "&[data-along=y]": { left: 0, right: 0 }, "&[data-along=x]": { top: 0, bottom: 0 } },
        event: {
            ...planElementDrafted, ...planElementSelected, ...planElementFocus,
            position: "absolute", display: "flex", flexDirection: "column", gap: "2px", padding: "4px 6px",
            borderWidth: "1px", borderColor: "border.strong", borderRadius: "sm", background: "bg.panel", color: "fg",
            textAlign: "left", cursor: "pointer", minHeight: "16px", minWidth: "4px", overflow: "hidden",
            "&[data-draggable]": { cursor: "grab" },
            "&[data-compact]": { flexDirection: "row", alignItems: "center", paddingY: 0, gap: "5px" },
            "&[data-chip]": { height: "21px", flexShrink: 0 },
            "&[data-overlap]": { boxShadow: PLAN_OVERLAP_RING },
            "&[data-dragging]": { zIndex: 10 },
        },
        ghost: {
            textStyle: "mono.xs", position: "absolute", borderWidth: "1.5px", borderStyle: "dashed", borderColor: "brand.solid",
            background: "brand.subtle", color: "brand.fg", pointerEvents: "none", zIndex: 6, overflow: "hidden",
            "&[data-whole-day]": { inset: 0 }, "&[data-along=x]:not([data-whole-day])": { top: 0, bottom: 0 }, "&[data-along=y]:not([data-whole-day])": { left: 0, right: 0 },
            "&[data-calendar-landing]": { display: "none" }, "&[data-calendar-landing]:where([data-drop-active] > *)": { display: "block" },
        },
        eventTop: { display: "flex", alignItems: "center", gap: "5px", minWidth: 0, flexShrink: 0, "[data-compact] &": { display: "contents" } },
        eventIcon: { ...fontAwesomeSize("9px"), display: "inline-flex", alignItems: "center", flexShrink: 0, color: "fg.muted" },
        eventWarning: { ...fontAwesomeSize("9px"), display: "inline-flex", color: "fg.warning", flexShrink: 0, order: 4 },
        eventTitle: {
            textStyle: "body.sm", fontWeight: "semibold", lineHeight: "tight", minWidth: 0, whiteSpace: "nowrap",
            overflow: "hidden", textOverflow: "ellipsis", flexShrink: 0, order: 2,
            "[data-compact] &": { flex: "1 1 auto" }, "&[data-wrap]": { whiteSpace: "normal", lineClamp: 2 },
            "&[data-measure]": { position: "absolute", visibility: "hidden", pointerEvents: "none" },
        },
        eventDetail: { textStyle: "mono.xs", color: "fg.muted", lineHeight: "tight", whiteSpace: "nowrap", width: "max-content", flexShrink: 0, order: 1, "&[data-measure]": { position: "absolute", visibility: "hidden", pointerEvents: "none" } },
        eventResource: { textStyle: "mono.sm", color: "fg.muted", lineHeight: "tight", whiteSpace: "nowrap", width: "max-content", flexShrink: 0, order: 3, "&[data-measure]": { position: "absolute", visibility: "hidden", pointerEvents: "none" } },

        ruler: { flex: 1, minWidth: 0 },
        rulerRow: timeRulerBase.rulerRow,
        rulerTick: { ...timeRulerBase.rulerTick, justifyContent: "flex-start", padding: "0 4px", overflow: "clip", textOverflow: "ellipsis", borderLeftWidth: "1px", borderColor: "border.subtle" },
        rulerLabel: { ...timeRulerBase.rulerLabel, position: "sticky", left: "188px", background: "bg.surface", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" },
        title: { textStyle: "body.sm", fontWeight: "semibold", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 },
        detail: { textStyle: "mono.xs", color: "fg.muted", overflowWrap: "anywhere" },
        resize: {
            ...timeResizeEdge("y", "data-edge"),
            "&[data-along=x]": {
                ...timeResizeEdge("x", "data-edge"), left: "auto", right: "auto", height: "auto",
                "&::after": { ...timeResizeEdge("x", "data-edge")["&::after"], right: "auto", height: "auto" },
            },
        },
        month: { display: "grid", flex: 1, minHeight: 0, minWidth: "var(--calendar-month-min-width)", gridTemplateColumns: "repeat(var(--calendar-month-columns), minmax(104px, 1fr))", gridTemplateRows: "repeat(var(--calendar-month-rows), minmax(128px, 1fr))" },
        monthDay: { position: "relative", minWidth: 0, minHeight: "128px", padding: "6px", borderRightWidth: "1px", borderBottomWidth: "1px", borderColor: "border.subtle", display: "flex", flexDirection: "column", gap: "4px", "&[data-outside]": { background: "bg.muted" }, "& [data-calendar-event]": { position: "relative", width: "100%" } },
        dayNumber: { ...timeHeaderText, textAlign: "left", minHeight: "24px", "&[data-today]": { color: "brand.fg" } },
        more: { textStyle: "mono.xs", color: "brand.fg", textAlign: "left", minHeight: "28px" },
        timeline: { minWidth: 0 },
        timelineRow: { display: "flex", borderBottomWidth: "1px", borderColor: "border.subtle" },
        rowHead: { ...rowsBase.gutterCell, position: "sticky", left: 0, width: "184px", flexShrink: 0, padding: "4px 12px", zIndex: 4, background: "bg.surface", borderRightWidth: "1px", borderColor: "border.subtle", overflowWrap: "anywhere" },
        rowPlot: { position: "relative", flex: 1 },
        agenda: { minWidth: 0, padding: "12px", background: "bg.panel", display: "flex", flexDirection: "column", gap: "16px" },
        agendaDay: { display: "flex", flexDirection: "column", gap: "8px", minWidth: 0 },
        agendaHead: { ...timeHeaderText },
        card: { ...planElementDrafted, ...planElementSelected, ...planElementFocus, minWidth: 0, padding: "12px", borderWidth: "1px", borderColor: "border.subtle", borderRadius: "sm", background: "bg.surface", display: "flex", flexDirection: "column", gap: "8px", "&[data-overlap]": { boxShadow: PLAN_OVERLAP_RING } },
        cardHead: { minWidth: 0, display: "flex", flexDirection: "column", gap: "4px", textAlign: "left" },
        cardTitle: { textStyle: "title.row", overflowWrap: "anywhere", minWidth: 0 },
        actions: { display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" },
        pane: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0, minWidth: 0 },
        paneFoot: { flexShrink: 0, padding: "12px", borderTopWidth: "1px", borderColor: "border.subtle" },
        section: { display: "flex", flexDirection: "column", gap: "12px", padding: "16px", borderBottomWidth: "1px", borderColor: "border.subtle", minWidth: 0 },
        status: INSPECTOR_STATUS,
        footer: builderFooter,
        footerItem: builderFooterItem,
        toolbarRange: { display: "flex", alignItems: "baseline", gap: "8px", whiteSpace: "nowrap" },
        rangeTitle: { textStyle: "h5", whiteSpace: "nowrap" },
        toolbarText: shellBase.footerItem,
        form: { display: "flex", flexDirection: "column", gap: "12px", minWidth: 0 },
        error: { textStyle: "body.sm", color: "fg.danger", overflowWrap: "anywhere" },
        empty: { textStyle: "body.sm", padding: "16px", color: "fg.muted" },
    },
});
