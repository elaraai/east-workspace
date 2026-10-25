/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Roster mock's grid, using shared builder text, draft states and footer. A week's read (#1398): a week not read
 * yet draws its slots with placeholders (`readLine`, `heldSlot`, `unreadValue`), and while a narrowing is read the week
 * stands in, retained (`data-roster-stale` on main, CL5): its people's rows and its slots' rules dashed, its duties' and
 * cards' words in the third ink — the shared retained parts.
 *
 * The People layout (#1406, `Roster People Spec.md` §8): a row a person at the density's pitch (36px, 32px compact),
 * a 232px name cell holding the name, the Agency badge and the week's hours over a 56 × 3px meter; a tile a duty in
 * each day cell, its fill the shift's colour token (`--roster-fill`) and its words in the ink the shade takes
 * (`--roster-ink`), neutral without one; `+ Assign` on an off day; the month's columns a week each, a cell seven marks;
 * the Patterns tab's strip of marks on each card.
 */
import { defineSlotRecipe } from "@chakra-ui/react";
import { fontAwesomeSize } from "../icon-size.js";
import { builderFooter, builderFooterItem } from "./builder-footer.js";
import { planElementDrafted, planElementFocus, planElementSelected, planRowFocus } from "./plan/focus.js";
import { INSPECTOR_SECTION, INSPECTOR_STATUS } from "./inspector.js";
import { heldToolbarSlot, retainedColumn, retainedRow } from "./loading.js";
import { scheduleAgenda, scheduleAgendaGroup, scheduleCard, scheduleCardActions, scheduleCardHead, scheduleCardTitle } from "./schedule-agenda.js";
import { scheduleGroupBase, scheduleGroupSlots } from "./schedule-group.js";
import { schedulePaneBase, schedulePaneSlots } from "./schedule-pane.js";
import { timeHeaderText } from "./time/axis.js";
import { moveGhostSlots, moveGhostBase } from "./time/move-ghost.js";

export const rosterBuilderSlotRecipe = defineSlotRecipe({
    className: "east-roster-builder",
    slots: [...moveGhostSlots, "root", "main", "scroll", "grid", "row", "gutter", "headerGutter", "head", "shiftHead", "shiftHeading", "shiftLabel", "shiftMeta", "time", ...scheduleGroupSlots,
        "rowHead", "eyebrow", "title", "detail", "requirement", "coverageHead", "metric", "coverageBar", "coverageSegment", "coverageTick", "skillLine", "skillCode",
        "cell", "cellHead", "chips", "assignment", "assignmentName", "badge", "flag", "activity", "fit", "grip", "chipAction", "dropStrip", "landing", "openPosition", "proposal", "proposalMark", "proposalName", "proposalReason", "proposalAction",
        "weekCell", "weekValue", "weekFill", "weekFillValue", "issueDot", "delta", "peopleHead", "peopleCell", "agenda", "agendaGroup", "card", "cardHead", "cardTitle", "actions", ...schedulePaneSlots, "section", "status",
        "footer", "footerItem", "legendItem", "legendSwatch", "toolbarRange", "rangeTitle", "toolbarText", "error", "empty", "pickerDot", "summary", "stat", "statValue", "statLabel", "issue", "issueTitle", "issueDetail", "issueActions",
        "readLine", "heldSlot", "unreadValue",
        "peopleRow", "peopleName", "nameLine", "personName", "agencyBadge", "hoursCell", "hoursText", "meter", "meterFill", "dayCell", "tile", "tileLabel", "tileMeta", "tileWarn", "tileMore",
        "assign", "assignMenuHead", "assignItem", "swatch", "monthRow", "monthHead", "monthGutter", "weekHead", "weekNumber", "weekRange", "dayTicks", "dayTick", "monthCell",
        "markStrip", "mark", "patternStrip", "patternMark"],
    base: {
        ...moveGhostBase,
        ...scheduleGroupBase,
        ...schedulePaneBase,
        root: { height: "100%", minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column", background: "bg.surface", color: "fg" },
        main: { flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column", "&[data-roster-grid=people]": { "--roster-columns": "8", "--roster-people-width": "1100px" } },
        scroll: { flex: 1, minHeight: 0, minWidth: 0, overflow: "auto", overscrollBehavior: "contain" },
        grid: { minWidth: "832px", "&[data-period=week]": { minWidth: "862px" } },
        row: { display: "grid", gridTemplateColumns: "148px repeat(var(--roster-columns), minmax(0, 1fr))", borderBottomWidth: "1px", borderColor: "border.subtle",
            // A person's row retained while a narrowing is read (#1398, CL5): the shared retained row.
            "&[data-roster-person-row]": { "[data-roster-stale] &": retainedRow } },
        gutter: { position: "sticky", left: 0, zIndex: 3, background: "bg.surface", borderRightWidth: "1px", borderColor: "border.subtle" },
        headerGutter: { display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-start", gap: "2px", padding: "4px 12px",
            "&[data-week]": { minHeight: "28px", padding: "0 12px", flexDirection: "row", alignItems: "center", justifyContent: "flex-start", gap: "8px" } },
        head: { position: "sticky", top: 0, zIndex: 5, background: "bg.surface" },
        shiftHead: { height: "44px", minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-start", textAlign: "left", gap: "2px", padding: "4px 12px", borderLeftWidth: "1px", borderColor: "border.subtle", ...planRowFocus,
            "&[data-week]": { height: "28px", padding: "0 4px", alignItems: "center", textAlign: "center" }, "&[data-people]": { height: "36px" }, "&[data-selected]": { background: "brand.subtle" } },
        shiftHeading: { ...timeHeaderText, display: "flex", alignItems: "center", gap: "8px", maxWidth: "100%", minWidth: 0, whiteSpace: "nowrap" },
        shiftMeta: { textStyle: "mono.xs", color: "fg.muted", maxWidth: "100%", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
        shiftLabel: { ...timeHeaderText, color: "fg.muted" },
        time: { textStyle: "mono.xs", color: "fg.subtle", whiteSpace: "nowrap" },
        rowHead: { padding: "12px 16px", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "5px", textAlign: "left", ...planRowFocus },
        eyebrow: { textStyle: "caption.eyebrow" },
        title: { textStyle: "body.sm", fontWeight: "semibold", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
        detail: { textStyle: "mono.xs", color: "fg.muted", overflowWrap: "anywhere" },
        requirement: { minWidth: 0, padding: "10px 12px", display: "flex", flexDirection: "column", gap: "7px", borderLeftWidth: "1px", borderColor: "border.subtle", textAlign: "left", ...planRowFocus },
        coverageHead: { display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "6px", minWidth: 0 },
        metric: { textStyle: "mono.tabular.sm", "&[data-tone=warning]": { color: "fg.warning" }, "&[data-tone=danger]": { color: "fg.danger" } },
        coverageBar: { height: "10px", position: "relative", background: "bg.subtle", borderRadius: "2px", overflow: "visible" },
        coverageSegment: { position: "absolute", top: 0, bottom: 0, background: "brand.solid", "&[data-kind=agency]": { background: "teal.500" }, "&[data-kind=overtime]": { background: "purple.500" },
            "&[data-kind=requested]": { background: "transparent", border: "1px dashed", borderColor: "teal.500" }, "&[data-kind=open]": { background: "transparent", border: "1px dashed", borderColor: "fg.warning" } },
        coverageTick: { position: "absolute", top: "-2px", bottom: "-2px", borderLeft: "1px solid", borderColor: "fg", pointerEvents: "none" },
        skillLine: { display: "grid", gridTemplateColumns: "22px minmax(0, 1fr) auto auto", alignItems: "baseline", gap: "6px", textStyle: "body.sm", "&[data-tone=warning]": { color: "fg.warning" }, "&[data-tone=success]": { color: "fg.success" } },
        skillCode: { textStyle: "mono.xs", color: "fg.subtle" },
        cell: { position: "relative", minWidth: 0, padding: "8px 8px 10px", borderLeftWidth: "1px", borderColor: "border.subtle", display: "flex", flexDirection: "column", gap: "4px", "& [data-roster-landing]": { display: "none" }, "&[data-drop-active]": { background: "brand.subtle", "& [data-roster-landing]": { display: "flex" } }, "&[data-drop-active][data-roster-landing-tone=warning]": { background: "bg.warning.subtle", outlineColor: "fg.warning" }, "&[data-drop-invalid] [data-roster-landing]": { display: "flex" },
            // Retained while a narrowing is read (#1398, CL5): the shared retained column.
            "[data-roster-stale] &": retainedColumn },
        cellHead: { textStyle: "mono.xs", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "5px", textAlign: "left", marginBottom: "2px", color: "fg.muted", "&[data-open]": { color: "fg.warning" } },
        chips: { display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 },
        assignment: { display: "flex", alignItems: "center", gap: "5px", minHeight: "26px", padding: "0 6px", minWidth: 0, border: "1px solid", borderColor: "border.subtle", borderRadius: "3px", background: "bg.surface", cursor: "pointer",
            "&[data-added], &[data-moved]": { borderStyle: "dashed" }, "&[data-layout=people]": { flexWrap: "wrap", gap: "3px", padding: "3px", "& [data-roster-assignment-name]": { flexBasis: "60%" }, "& [data-roster-grip]": { display: "none" } },
            "&[data-density=compact]": { minHeight: "22px" }, "&[data-agency]": { background: "bg.panel" }, "&[data-request]": { borderStyle: "dashed", background: "transparent" },
            ...planElementDrafted, ...planElementSelected, ...planElementFocus,
            "&[data-tone=warning]": { borderColor: "fg.warning" }, "&[data-tone=danger]": { borderColor: "fg.danger", background: "bg.danger.subtle" },
            "&[data-removed]": { textDecoration: "line-through", background: "bg.warning.subtle", color: "fg.subtle" }, "&[data-dragging]": { opacity: 0.4 },
            "&:hover [data-roster-grip], &:focus-within [data-roster-grip]": { opacity: 0.45 }, "&:hover [data-roster-chip-action], &:focus-within [data-roster-chip-action]": { opacity: 1 },
            // Retained while a narrowing is read (#1398, CL5): its words in the third ink, its own edge kept.
            "[data-roster-stale] &": { color: "fg.muted", "& *": { color: "inherit" } } },
        assignmentName: { textStyle: "body.sm", fontWeight: "medium", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
        badge: { textStyle: "mono.xs", fontSize: "label.xs", color: "fg.muted", flexShrink: 0, "&[data-lead]": { color: "brand.fg", fontWeight: "bold" } },
        flag: { "& svg": fontAwesomeSize("9px"), maxWidth: "70px", overflow: "hidden", textOverflow: "ellipsis", flexShrink: 1, textStyle: "mono.xs", fontSize: "label.xs", whiteSpace: "nowrap", color: "fg.warning", "&[data-tone=danger]": { color: "fg.danger" } },
        activity: { textStyle: "mono.xs", minWidth: "22px", padding: "0 3px", border: "1px solid", borderColor: "border.subtle", borderRadius: "2px", "&[data-empty]": { borderStyle: "dashed", color: "fg.faint" } },
        fit: { textStyle: "mono.xs", fontSize: "label.xs", color: "fg.subtle", whiteSpace: "nowrap" },
        grip: { display: "inline-flex", opacity: 0, flexShrink: 0, cursor: "grab", ...fontAwesomeSize("8px"), width: "7px" },
        chipAction: { display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, opacity: 0, color: "fg.subtle", ...fontAwesomeSize("9px"), width: "16px", height: "20px", _hover: { color: "fg" }, _focusVisible: { opacity: 1 }, _hoverNone: { opacity: 1 } },
        dropStrip: { textStyle: "mono.xs", minHeight: "28px", color: "fg.subtle", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "4px 2px", marginTop: "4px", borderTop: "1px dashed", borderColor: "border.subtle" },
        landing: { textStyle: "mono.xs", minHeight: "26px", padding: "4px 8px", border: "1px dashed", borderColor: "brand.solid", borderRadius: "3px", color: "brand.fg", overflowWrap: "anywhere", "&[data-tone=warning]": { color: "fg.warning", borderColor: "fg.warning", background: "bg.warning.subtle" }, "&[data-tone=danger]": { color: "fg.danger", borderColor: "fg.danger", background: "bg.danger.subtle" } },
        openPosition: { textStyle: "mono.xs", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px", border: "1px dashed", borderColor: "fg.warning", padding: "4px 6px", borderRadius: "3px", color: "fg.warning" },
        proposal: { borderStyle: "dashed", borderColor: "border.emphasized", background: "transparent", padding: "0 3px 0 6px", _hover: { borderColor: "fg.subtle" } },
        proposalMark: { color: "brand.fg", fontWeight: "semibold", letterSpacing: "0.1em", textTransform: "uppercase" },
        proposalName: { fontStyle: "italic", color: "fg.muted", textAlign: "left", ...planRowFocus },
        proposalReason: { whiteSpace: "nowrap", flexShrink: 0, fontSize: "label.xs" },
        proposalAction: { opacity: 1, width: "18px", height: "18px", borderRadius: "3px", "&[data-accept]": { border: "1px solid", borderColor: "border.emphasized", background: "bg.surface", color: "fg.success", _hover: { borderColor: "fg.success" } }, _hover: { background: "bg.panel" } },
        weekCell: { padding: "5px 2px", textAlign: "center", borderLeftWidth: "1px", borderColor: "border.subtle", minWidth: 0, ...planRowFocus, "&[data-drop-active]": { background: "brand.subtle" },
            "[data-roster-stale] &": retainedColumn },
        delta: { textStyle: "mono.xs", marginLeft: "auto", whiteSpace: "nowrap", color: "fg.success", "&[data-tone=warning]": { color: "fg.warning" } },
        weekFill: { height: "3px", background: "bg.subtle", marginTop: "4px", overflow: "hidden" },
        weekFillValue: { height: "100%", background: "brand.solid" },
        issueDot: { width: "4px", height: "4px", borderRadius: "50%", background: "fg.warning", margin: "4px auto 0" },
        weekValue: { textStyle: "mono.xs", "&[data-tone=warning]": { color: "fg.warning" }, "&[data-tone=danger]": { color: "fg.danger" } },
        peopleHead: { padding: "6px 12px", display: "flex", flexDirection: "column", gap: "3px", minHeight: "50px", justifyContent: "center", textAlign: "left", ...planRowFocus, "&[data-tone=warning]": { color: "fg.warning" } },
        peopleCell: { display: "flex", flexDirection: "column", justifyContent: "center", gap: "3px", padding: "6px", borderLeftWidth: "1px", borderColor: "border.subtle", minWidth: 0, "&[data-selected]": { background: "bg.panel" }, "&[data-drop-active]": { background: "brand.subtle" },
            // Retained while a narrowing is read (#1398, CL5): the shared retained column, as a shifts cell is.
            "[data-roster-stale] &": retainedColumn },
        // The phone's cards: the shared part the Calendar and the Allocation take too.
        agenda: scheduleAgenda, agendaGroup: scheduleAgendaGroup, cardHead: scheduleCardHead, cardTitle: scheduleCardTitle, actions: scheduleCardActions,
        // Retained while a narrowing is read (#1398, CL5): a card's words in the third ink, its own edge kept.
        card: { ...scheduleCard, "[data-roster-stale] &": { color: "fg.muted", "& *": { color: "inherit" } } },
        section: { ...INSPECTOR_SECTION, gap: "12px" },
        status: INSPECTOR_STATUS,
        footer: builderFooter, footerItem: builderFooterItem,
        legendItem: { display: "inline-flex", alignItems: "center", gap: "5px", flexShrink: 0 },
        legendSwatch: { position: "relative", top: "auto", bottom: "auto", width: "12px", height: "8px", flexShrink: 0, "&[data-kind=needed]": { width: "2px", height: "12px" } },
        toolbarRange: { display: "flex", alignItems: "baseline", gap: "8px", whiteSpace: "nowrap" },
        rangeTitle: { textStyle: "h5", whiteSpace: "nowrap" }, toolbarText: builderFooterItem,
        error: { textStyle: "body.sm", color: "fg.danger", overflowWrap: "anywhere" },
        empty: { padding: "16px", textStyle: "body.sm", color: "fg.muted" },
        pickerDot: { width: "6px", height: "6px", borderRadius: "50%", border: "1px solid", borderColor: "fg.subtle", "&[data-state=published]": { background: "fg.success", borderColor: "fg.success" }, "&[data-state=draft]": { background: "brand.solid", borderColor: "brand.solid" } },
        summary: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "16px", padding: "16px", borderBottomWidth: "1px", borderColor: "border.subtle" },
        stat: { display: "flex", flexDirection: "column", gap: "4px" }, statValue: { textStyle: "num-lg" }, statLabel: { textStyle: "caption.eyebrow" },
        issue: { ...INSPECTOR_SECTION, gap: "6px", borderLeft: "2px solid", borderLeftColor: "fg.warning", "&[data-tone=danger]": { borderLeftColor: "fg.danger" }, "&[data-tone=info]": { borderLeftColor: "brand.solid" } },
        issueTitle: { textStyle: "body.sm", fontWeight: "semibold", textAlign: "left" }, issueDetail: { textStyle: "mono.xs", color: "fg.muted" }, issueActions: { display: "flex", gap: "8px", flexWrap: "wrap" },
        // A week whose read failed says so once, in its first row in view (#1398, CL11): one line across that row's
        // cells — a person's seven days, or every column of a shifts row — its head kept, the rest blank.
        readLine: { gridColumn: "2 / -1", display: "flex", alignItems: "center", minWidth: 0, padding: "6px 12px", borderLeftWidth: "1px", borderColor: "border.subtle",
            "&[data-days]": { gridColumn: "2 / span 7" } },
        // A toolbar slot held while what fills it is unread, or empty (#1398, CL1): the shared part, so the toolbar never
        // shifts as the week lands.
        heldSlot: heldToolbarSlot,
        // A figure the week's read has not given yet beside what is known without it — a person's worked hours beside
        // their contract's: the placeholder, then the known words, on one line (#1398).
        unreadValue: { display: "inline-flex", alignItems: "center", gap: "4px", minWidth: 0, textStyle: "mono.xs", color: "fg.muted", whiteSpace: "nowrap" },

        // ── The People layout (#1406) ──────────────────────────────────────────────────────────────────────────────
        // A person's row by week: the 232px name cell, then seven day cells, one line at the density's pitch.
        peopleRow: { display: "grid", gridTemplateColumns: "232px repeat(7, minmax(0, 1fr))", minHeight: "36px", borderBottomWidth: "1px", borderColor: "border.subtle",
            "&[data-density=compact]": { minHeight: "32px" }, "&[data-roster-person-row]": { "[data-roster-stale] &": retainedRow } },
        // The name cell: the name and the badge at the start, the hours and their meter at the end.
        peopleName: { position: "sticky", left: 0, zIndex: 3, background: "bg.surface", borderRightWidth: "1px", borderColor: "border.subtle", display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: "8px", padding: "0 12px 0 20px", minWidth: 0, textAlign: "left",
            "&[data-selected]": { background: "bg.panel" }, "&[data-head]": { display: "flex", justifyContent: "space-between", alignItems: "center" } },
        nameLine: { display: "flex", alignItems: "center", gap: "6px", minWidth: 0 },
        personName: { display: "inline-flex", alignItems: "center", minWidth: 0, textStyle: "body.sm", fontWeight: "semibold", textAlign: "left",
            "& > span": { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, ...planRowFocus },
        agencyBadge: { textStyle: "mono.xs", fontSize: "label.xs", fontWeight: "semibold", textTransform: "uppercase", letterSpacing: "0.08em", height: "16px", padding: "0 4px",
            display: "inline-flex", alignItems: "center", borderWidth: "1px", borderColor: "border.emphasized", borderRadius: "2px", color: "fg.muted", flexShrink: 0 },
        hoursCell: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "3px", minWidth: 0, "&[data-tone=warning]": { color: "fg.warning" } },
        hoursText: { textStyle: "mono.xs", fontWeight: "medium", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
        meter: { width: "56px", height: "3px", background: "bg.subtle", borderRadius: "1px", overflow: "hidden" },
        meterFill: { height: "100%", background: "brand.solid", "[data-tone=warning] &": { background: "fg.warning" } },
        // A day cell: its tiles across it, an off day's `+ Assign`; tinted while drafted, the panel while selected, outlined in the
        // ink while its person-week is selected, dashed in the brand while a pattern hovers its row.
        dayCell: { position: "relative", display: "flex", alignItems: "center", gap: "2px", padding: "0 4px", minWidth: 0, borderLeftWidth: "1px", borderColor: "border.subtle",
            "&[data-drafted]": { background: "{colors.brandTint}" }, "&[data-selected]": { background: "bg.panel" },
            "&[data-week-selected]": { boxShadow: "inset 0 0 0 1px {colors.fg}" }, "&[data-week-selected] + &[data-week-selected]": { boxShadow: "inset 0 -1px 0 {colors.fg}, inset 0 1px 0 {colors.fg}" },
            "&[data-drop-active]": { background: "brand.subtle" }, "&[data-pattern-hover]": { boxShadow: "inset 0 0 0 1px {colors.brand.solid}" },
            "&[data-pattern-hover][data-pattern-changes]": { background: "{colors.brandTint}" },
            // While the pattern's day previews, the day's own tiles, `+1` and `+ Assign` stay mounted and hide (P19).
            "&[data-roster-previewing] > :not([data-preview])": { display: "none" },
            "[data-roster-stale] &": retainedColumn },
        // A tile a duty: its fill the shift's token, its words in the ink the shade takes; neutral on the panel without one.
        tile: { display: "flex", alignItems: "center", gap: "6px", flex: "1 1 0", minWidth: 0, height: "24px", padding: "0 6px", borderRadius: "3px", cursor: "pointer",
            borderWidth: "1px", borderStyle: "solid", borderColor: "border.subtle", background: "var(--roster-fill, {colors.bg.panel})", color: "var(--roster-ink, {colors.fg})",
            "[data-density=compact] &": { height: "20px", padding: "0 4px", gap: "4px" },
            "&[data-added], &[data-moved]": { borderStyle: "dashed", borderColor: "brand.solid" },
            "&[data-drafted]:not([data-added]):not([data-moved])": { boxShadow: "inset 0 0 0 1.5px {colors.brand.solid}" },
            "&[data-request]": { borderStyle: "dashed", background: "transparent", color: "fg" },
            "&[data-tone=warning]": { borderColor: "fg.warning" }, "&[data-tone=danger]": { borderColor: "fg.danger" },
            "&[data-removed]": { textDecoration: "line-through", background: "bg.warning.subtle", color: "fg.subtle" },
            "&[data-preview]": { borderStyle: "dashed", borderColor: "brand.solid", background: "transparent", color: "brand.fg" },
            "&[data-preview][data-off]": { borderColor: "fg.subtle", color: "fg.subtle", textDecoration: "line-through" },
            "&[data-selected]": { outline: "1px solid", outlineColor: "fg", outlineOffset: "0" }, ...planElementFocus, "&[data-dragging]": { opacity: 0.4 },
            "&:hover [data-roster-chip-action], &:focus-within [data-roster-chip-action]": { opacity: 1 },
            "[data-roster-stale] &": { color: "fg.muted", "& *": { color: "inherit" } } },
        tileLabel: { textStyle: "body.sm", fontWeight: "medium", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
        tileMeta: { textStyle: "mono.xs", whiteSpace: "nowrap", flexShrink: 0, opacity: 0.85, "&[data-own]": { fontWeight: "semibold", opacity: 1 },
            "&[data-group]": { fontSize: "label.xs", fontWeight: "semibold", textTransform: "uppercase", letterSpacing: "0.06em" } },
        tileWarn: { display: "inline-flex", flexShrink: 0, color: "fg.warning", ...fontAwesomeSize("10px"), "&[data-tone=danger]": { color: "fg.danger" } },
        tileMore: { textStyle: "mono.xs", fontWeight: "semibold", color: "fg.danger", flexShrink: 0, whiteSpace: "nowrap" },
        // An off day's `+ Assign`: a wash across the cell, its words shown on hover, focus or selection; inert while a run of the
        // optimiser holds the week (#1409, R2).
        assign: { flex: "1 1 0", minWidth: 0, height: "24px", borderRadius: "3px", background: "color-mix(in srgb, {colors.fg} 7%, transparent)", color: "transparent",
            textStyle: "mono.xs", fontWeight: "semibold", textTransform: "uppercase", letterSpacing: "0.08em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            "[data-density=compact] &": { height: "20px" }, "&:hover, &:focus-visible, &[data-state=open], [data-selected] > &": { color: "fg.muted" }, "&:disabled": { cursor: "not-allowed" }, ...planElementFocus },
        assignMenuHead: { textStyle: "mono.xs", fontSize: "label.xs", fontWeight: "semibold", textTransform: "uppercase", letterSpacing: "0.08em", color: "fg.muted", padding: "4px 8px" },
        assignItem: { display: "flex", alignItems: "center", gap: "8px", minHeight: "28px", "& [data-roster-shift-times]": { textStyle: "mono.xs", color: "fg.subtle", marginLeft: "auto" } },
        swatch: { width: "12px", height: "12px", borderRadius: "2px", flexShrink: 0, background: "var(--roster-fill, {colors.bg.panel})", borderWidth: "1px", borderColor: "border.subtle" },
        // The month: the 168px name cell, then a column a week touching the month.
        monthRow: { display: "grid", gridTemplateColumns: "168px repeat(var(--roster-weeks, 5), minmax(0, 1fr))", minHeight: "36px", borderBottomWidth: "1px", borderColor: "border.subtle",
            "&[data-density=compact]": { minHeight: "32px" }, "&[data-roster-person-row]": { "[data-roster-stale] &": retainedRow } },
        monthHead: { position: "sticky", top: 0, zIndex: 5, background: "bg.surface" },
        monthGutter: { position: "sticky", left: 0, zIndex: 3, background: "bg.surface", borderRightWidth: "1px", borderColor: "border.subtle", display: "flex", alignItems: "center",
            padding: "0 12px 0 20px", ...timeHeaderText, color: "fg.muted" },
        // A week's column header: its number and range over its seven days' ticks; a press opens the week.
        weekHead: { display: "flex", flexDirection: "column", minWidth: 0, borderLeftWidth: "1px", borderColor: "border.subtle", textAlign: "left", ...planRowFocus,
            "&[data-selected]": { background: "brand.subtle" } },
        weekNumber: { display: "flex", alignItems: "baseline", gap: "8px", height: "24px", padding: "0 8px", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textStyle: "body.sm", fontWeight: "semibold" },
        weekRange: { ...timeHeaderText, color: "fg.muted", overflow: "hidden", textOverflow: "ellipsis" },
        dayTicks: { display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", height: "32px", padding: "0 2px", gap: "2px" },
        dayTick: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minWidth: 0, overflow: "hidden", textStyle: "mono.xs", color: "fg.subtle",
            "& > span:last-of-type": { color: "fg.muted" } },
        // A person's week cell: seven marks; tinted while a day of it is drafted, the panel while selected, outlined as its row's cells are.
        monthCell: { position: "relative", display: "flex", alignItems: "center", padding: "0 2px", minWidth: 0, borderLeftWidth: "1px", borderColor: "border.subtle", textAlign: "left", ...planRowFocus,
            "&[data-drafted]": { background: "{colors.brandTint}" }, "&[data-selected]": { background: "bg.panel", boxShadow: "inset 0 0 0 1px {colors.fg}" },
            "&[data-drop-active]": { background: "brand.subtle" }, "&[data-pattern-hover]": { boxShadow: "inset 0 0 0 1px {colors.brand.solid}" },
            "[data-roster-stale] &": retainedColumn },
        markStrip: { display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: "2px", flex: "1 1 0", minWidth: 0, height: "24px", "[data-density=compact] &": { height: "20px" } },
        // A mark: a day's shift in its colour, its letter where the day is wide enough; an off day faint; a placeholder while unread.
        mark: { display: "flex", alignItems: "center", justifyContent: "center", minWidth: 0, overflow: "hidden", borderRadius: "3px", textStyle: "mono.xs", fontWeight: "semibold",
            background: "var(--roster-fill, {colors.bg.panel})", color: "var(--roster-ink, {colors.fg})", borderWidth: "1px", borderColor: "transparent",
            "&[data-off]": { background: "color-mix(in srgb, {colors.fg} 7%, transparent)", color: "transparent" },
            "&[data-removed]": { textDecoration: "line-through", background: "bg.warning.subtle", color: "fg.subtle" },
            "&[data-drafted]": { borderColor: "brand.solid" },
            "&[data-preview]": { borderStyle: "dashed", borderColor: "brand.solid", background: "transparent", color: "brand.fg" },
            "&[data-preview][data-off]": { borderColor: "fg.subtle", color: "transparent" },
            "&[data-pending]": { background: "bg.subtle", color: "transparent" } },
        // The Patterns tab: each card's strip of marks, Sunday to Saturday as the card's name reads.
        patternStrip: { display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: "2px", height: "18px", marginTop: "4px", width: "100%" },
        patternMark: { display: "flex", alignItems: "center", justifyContent: "center", minWidth: 0, overflow: "hidden", borderRadius: "2px", textStyle: "mono.xs", fontWeight: "semibold",
            background: "var(--roster-fill, {colors.bg.panel})", color: "var(--roster-ink, {colors.fg})",
            "&[data-off]": { background: "color-mix(in srgb, {colors.fg} 7%, transparent)", color: "transparent" } },
    },
});
