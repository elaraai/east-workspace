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
import { coarseHitArea } from "../../style/hit-area.js";
import { wholeOrNone } from "../../style/whole-or-none.js";
import { CONFLICT_RING } from "../conflict-ring.js";
import { fontAwesomeSize } from "../icon-size.js";
import { builderFooter, builderFooterItem } from "./builder-footer.js";
import { planElementConflict, planElementDrafted, planElementFocus, planElementSelected, planRowFocus } from "./plan/focus.js";
import { INSPECTOR_SECTION, INSPECTOR_STATUS } from "./inspector.js";
import { heldToolbarSlot, retainedColumn, retainedRow, widestToolbarSlot } from "./loading.js";
import { scheduleAgenda, scheduleAgendaGroup, scheduleAgendaHead, scheduleCard, scheduleCardActions, scheduleCardHead, scheduleCardTitle } from "./schedule-agenda.js";
import { scheduleGroupBase, scheduleGroupSlots } from "./schedule-group.js";
import { schedulePaneBase, schedulePaneSlots } from "./schedule-pane.js";
import { schedulePickerBase, schedulePickerSlots } from "./schedule-picker.js";
import { timeHeaderText } from "./time/axis.js";
import { moveGhostSlots, moveGhostBase } from "./time/move-ghost.js";

/**
 * The line of each word in a duty's tile — its label and its hours — and a day's `+1` (ruled 11 Nov 2026). An even
 * height: its leading splits in whole pixels and its box, of an even height itself, centres it on one. The theme's line of
 * 1.5 is 15px for the mono words and 18.75px for the label, which a box centres on a half pixel or a fraction; the
 * painter rounds such a line up or down with where the page puts the row, so a tile's hours stood up to a pixel and a
 * half over their box's centreline, and a pixel apart from one row or page to the next. On whole pixels the mono words —
 * one face at one size — stand on one line across a row's boxes.
 */
const DAY_WORDS_LINE = "18px";

/**
 * An off day's `+ Assign`, at its box's middle to the pixel (ruled 11 Nov 2026). Its words are capitals alone, which
 * have no descender, so what the eye centres is their height. At the mono caption's 10px they are seven pixels tall, and
 * seven in a box of an even height — 24, or 20 compact — leave 8 above and 9 below at best. At 11px they are eight: 8
 * above and 8 below, 6 and 6 compact. Their line is an odd 19px, a pixel of padding over it: the face's ascent is seven
 * pixels more than its descent, so an even line splits its leading on a half pixel, which the browser rounds away and
 * the capitals stand a pixel high; and the button centres the line in what the padding leaves, on a whole pixel at
 * either height.
 */
const ASSIGN_WORDS = { textStyle: "mono.sm", lineHeight: "19px", paddingTop: "1px", paddingBottom: "0" } as const;

/**
 * A mark's fill and ink — a day's in the month, a pattern card's: the shift's colour token and the ink its shade takes
 * (`--roster-fill`, `--roster-ink`), and for a shift with no colour the theme's neutral, its solid and the paper on it —
 * 3:1 or more off the row's paper in both themes, which a mark needs to be seen without its letter.
 */
const NEUTRAL_MARK = { background: "var(--roster-fill, {colors.neutral.solid})", color: "var(--roster-ink, {colors.neutral.contrast})" } as const;

export const rosterBuilderSlotRecipe = defineSlotRecipe({
    className: "east-roster-builder",
    slots: [...moveGhostSlots, "root", "main", "scroll", "grid", "row", "gutter", "headerGutter", "head", "shiftHead", "shiftHeading", "shiftLabel", "shiftMeta", "time", ...scheduleGroupSlots,
        "rowHead", "eyebrow", "title", "detail", "requirement", "coverageHead", "metric", "coverageBar", "coverageSegment", "coverageTick", "coverageLine", "coverageName", "coverageFigures", "skillLine", "skillCode",
        "cell", "cellHead", "chips", "assignment", "assignmentName", "badge", "flag", "activity", "fit", "grip", "chipAction", "dropStrip", "landing", "openPosition", "proposal", "proposalMark", "proposalName", "proposalReason", "proposalAction",
        "weekCell", "weekValue", "weekFill", "weekFillValue", "issueDot", "delta", "peopleHead", "peopleCell", "agenda", "agendaGroup", "agendaHead", "card", "cardHead", "cardTitle", "actions", ...schedulePaneSlots, "section", "status",
        "footer", "footerItem", "legendItem", "legendSwatch", "toolbarRange", "rangeTitle", "toolbarText", "error", "empty", ...schedulePickerSlots, "summary", "stat", "statValue", "statLabel", "issue", "issueTitle", "issueDetail", "issueActions",
        "readLine", "heldSlot", "widestSlot", "unreadValue",
        "peopleRow", "peopleName", "nameLine", "personName", "agencyBadge", "hoursCell", "hoursText", "meter", "meterFill", "dayCell", "tile", "tileLabel", "tileMeta", "tileWarn", "tileMore",
        "assign", "assignMenuHead", "assignItem", "swatch", "monthRow", "monthHead", "monthGutter", "weekHead", "weekNumber", "weekRange", "dayTicks", "dayTick", "monthCell",
        "markStrip", "mark", "patternStrip", "patternMark",
        "demandRow", "demandName", "demandFigure", "laneName", "laneToggle", "laneSwatch", "laneLabel", "laneHours", "laneWeek", "laneCell", "laneLine", "laneFigure", "laneDiff",
        "laneBar", "laneTick", "laneNoTarget", "laneMark", "skillTag", "skillName", "skillBar", "assignRow", "assignLabel", "demandCards", "demandCardsHead", "demandShift"],
    base: {
        ...moveGhostBase,
        ...scheduleGroupBase,
        // A People band's work requirement (#1568, A1): the count of its people in the subtle ink, and how many shifts are
        // short in the warning's.
        groupMeta: { ...scheduleGroupBase.groupMeta, "&[data-count]": { color: "fg.subtle" }, "& [data-tone=warning]": { color: "fg.warning" } },
        ...schedulePaneBase,
        ...schedulePickerBase,
        root: { height: "100%", minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column", background: "bg.surface", color: "fg" },
        main: { flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column", "&[data-roster-grid=people]": { "--roster-columns": "8", "--roster-people-width": "1100px" } },
        // The People rows stuck under the header (#1568, A6) on the surface's paper, opaque as the header is.
        scroll: { flex: 1, minHeight: 0, minWidth: 0, overflow: "auto", overscrollBehavior: "contain", "& [data-virtual-stuck] > [data-index]": { background: "bg.surface" } },
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
        coverageSegment: { position: "absolute", top: 0, bottom: 0, background: "brand.solid", "&[data-kind=agency]": { background: "accent.teal" }, "&[data-kind=overtime]": { background: "accent.purple" },
            "&[data-kind=requested]": { background: "transparent", border: "1px dashed", borderColor: "accent.teal" }, "&[data-kind=open]": { background: "transparent", border: "1px dashed", borderColor: "fg.warning" },
            // A 1px gap in the panel's colour between a bar's parts, in both themes (ruled 9 Nov 2026): the permanent staff's
            // blue and agency staff's teal are of one lightness in the dark theme.
            "& + &": { borderLeftWidth: "1px", borderLeftStyle: "solid", borderLeftColor: "bg.panel" } },
        coverageTick: { position: "absolute", top: "-2px", bottom: "-2px", borderLeft: "1px solid", borderColor: "fg", pointerEvents: "none" },
        // A skill's line in a coverage: its name and its figures on one line where they fit. Where they do not, the name takes
        // the cell's whole width, breaking at its spaces, and its figures keep together on the line under it, at its end.
        coverageLine: { display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", columnGap: "8px", minWidth: 0, textStyle: "body.sm", "&[data-tone=warning]": { color: "fg.warning" }, "&[data-tone=success]": { color: "fg.success" } },
        coverageName: { minWidth: 0, overflowWrap: "break-word", "& > :first-of-type": { marginRight: "6px" } },
        // Its hours, in the design system's mono face, as the skill's code beside them is.
        coverageFigures: { display: "inline-flex", alignItems: "baseline", gap: "6px", marginLeft: "auto", flexShrink: 0, whiteSpace: "nowrap", fontFamily: "mono", fontVariantNumeric: "tabular-nums" },
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
            ...planElementDrafted, ...planElementSelected, ...planElementFocus, ...planElementConflict,
            "&[data-tone=warning]": { borderColor: "fg.warning" }, "&[data-tone=danger]": { borderColor: "fg.danger", background: "bg.danger.subtle" },
            "&[data-removed]": { textDecoration: "line-through", background: "bg.warning.subtle", color: "fg.subtle" }, "&[data-dragging]": { opacity: 0.4 },
            "&:hover [data-roster-grip], &:focus-within [data-roster-grip]": { opacity: 0.45 }, "&:hover [data-roster-chip-action], &:focus-within [data-roster-chip-action]": { opacity: 1 },
            // Retained while a narrowing is read (#1398, CL5): its words in the third ink, its own edge kept.
            "[data-roster-stale] &": { color: "fg.muted", "& *": { color: "inherit" } } },
        assignmentName: { textStyle: "body.sm", fontWeight: "medium", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
        // A chip's badge: its position's code, a trainer's T, or — an agency person's duty, a request — the app's short word
        // for agency staff, in capitals as the People layout's badge has it (#1566).
        badge: { textStyle: "mono.xs", fontSize: "label.xs", color: "fg.muted", flexShrink: 0, "&[data-lead]": { color: "brand.fg", fontWeight: "bold" },
            "&[data-roster-agency-badge]": { textTransform: "uppercase" } },
        flag: { "&[data-roster-card-flag]": { maxWidth: "none", whiteSpace: "normal", overflow: "visible", overflowWrap: "anywhere" }, "& svg": fontAwesomeSize("9px"), maxWidth: "70px", overflow: "hidden", textOverflow: "ellipsis", flexShrink: 1, textStyle: "mono.xs", fontSize: "label.xs", whiteSpace: "nowrap", color: "fg.warning", "&[data-tone=danger]": { color: "fg.danger" } },
        activity: { textStyle: "mono.xs", minWidth: "22px", padding: "0 3px", border: "1px solid", borderColor: "border.subtle", borderRadius: "2px", "&[data-empty]": { borderStyle: "dashed", color: "fg.faint" } },
        fit: { textStyle: "mono.xs", fontSize: "label.xs", color: "fg.subtle", whiteSpace: "nowrap" },
        grip: { display: "inline-flex", opacity: 0, flexShrink: 0, cursor: "grab", ...fontAwesomeSize("8px"), width: "7px" },
        chipAction: { display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, opacity: 0, color: "fg.subtle", ...fontAwesomeSize("9px"), width: "16px", height: "20px", _hover: { color: "fg" }, _focusVisible: { opacity: 1 }, _hoverNone: { opacity: 1 } },
        dropStrip: { textStyle: "mono.xs", minHeight: "28px", color: "fg.subtle", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "4px 2px", marginTop: "4px", borderTop: "1px dashed", borderColor: "border.subtle" },
        landing: { textStyle: "mono.xs", minHeight: "26px", padding: "4px 8px", border: "1px dashed", borderColor: "brand.solid", borderRadius: "3px", color: "brand.fg", overflowWrap: "anywhere", "&[data-tone=warning]": { color: "fg.warning", borderColor: "fg.warning", background: "bg.warning.subtle" }, "&[data-tone=danger]": { color: "fg.danger", borderColor: "fg.danger", background: "bg.danger.subtle" } },
        openPosition: { textStyle: "mono.xs", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px", border: "1px dashed", borderColor: "fg.warning", padding: "4px 6px", borderRadius: "3px", color: "fg.warning" },
        proposal: { borderStyle: "dashed", borderColor: "border.emphasized", background: "transparent", padding: "0 3px 0 6px", _hover: { borderColor: "fg.subtle" } },
        proposalMark: { color: "brand.fg", fontWeight: "semibold", letterSpacing: "0.1em", textTransform: "uppercase" },
        proposalName: { fontStyle: "italic", color: "fg.muted", textAlign: "left", ...planRowFocus,
            // A phone's card (its proposal has no density: the desktop's chip does): the name selects it, a finger's height.
            "[data-roster-proposal]:not([data-density]) &": { _coarse: { minHeight: "44px" } } },
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
        // The phone's cards: the shared part the Calendar and the Allocation take too, a day's heading the Calendar's.
        agenda: scheduleAgenda, agendaGroup: scheduleAgendaGroup, agendaHead: scheduleAgendaHead, cardHead: scheduleCardHead, cardTitle: scheduleCardTitle, actions: scheduleCardActions,
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
        // A period's mark in the date picker, told apart by shape as well as colour (#1595): a published one filled, a draft's a
        // hollow ring, one not started a muted ring. The legend draws each beside its word.
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
        // The status's and the issues' slots, each the widest of what it may say, so the toolbar holds still as they change (#1595).
        widestSlot: widestToolbarSlot,
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
        // A tile a duty: its fill the shift's token, its words in the ink the shade takes; neutral on the panel without one. It
        // fills its day, a removed one too, and its action — remove, or a removed one's restore — stands at its end, never
        // beside its words (ruled 11 Nov 2026).
        tile: { display: "flex", alignItems: "center", gap: "6px", flex: "1 1 0", minWidth: 0, height: "24px", padding: "0 6px", borderRadius: "3px", cursor: "pointer",
            "& > [data-roster-chip-action]": { marginInlineStart: "auto" },
            borderWidth: "1px", borderStyle: "solid", borderColor: "border.subtle", background: "var(--roster-fill, {colors.bg.panel})", color: "var(--roster-ink, {colors.fg})",
            "[data-density=compact] &": { height: "20px", padding: "0 4px", gap: "4px" },
            "&[data-added], &[data-moved]": { borderStyle: "dashed", borderColor: "brand.solid" },
            "&[data-drafted]:not([data-added]):not([data-moved])": { boxShadow: "inset 0 0 0 1.5px {colors.brand.solid}" },
            "&[data-request]": { borderStyle: "dashed", background: "transparent", color: "fg" },
            "&[data-tone=warning]": { borderColor: "fg.warning" }, "&[data-tone=danger]": { borderColor: "fg.danger" },
            "&[data-removed]": { textDecoration: "line-through", background: "bg.warning.subtle", color: "fg.subtle" },
            "&[data-preview]": { borderStyle: "dashed", borderColor: "brand.solid", background: "transparent", color: "brand.fg" },
            "&[data-preview][data-off]": { borderColor: "fg.subtle", color: "fg.subtle", textDecoration: "line-through" },
            "&[data-selected]": { outline: "1px solid", outlineColor: "fg", outlineOffset: "0" }, ...planElementFocus, ...planElementConflict, "&[data-dragging]": { opacity: 0.4 },
            // Holding a conflict, or a number outside its bounds: a drafted tile's brand ring inside the warn, and a selection's
            // ring just outside it.
            "&[data-drafted]:is([data-conflict], [data-bounds]):not([data-added]):not([data-moved])": { boxShadow: `inset 0 0 0 1.5px {colors.brand.solid}, ${CONFLICT_RING}` },
            "&[data-selected]:is([data-conflict], [data-bounds])": { outlineOffset: "1px" },
            "&:hover [data-roster-chip-action], &:focus-within [data-roster-chip-action]": { opacity: 1 },
            "[data-roster-stale] &": { color: "fg.muted", "& *": { color: "inherit" } } },
        tileLabel: { textStyle: "body.sm", lineHeight: DAY_WORDS_LINE, fontWeight: "medium", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
        tileMeta: { textStyle: "mono.xs", lineHeight: DAY_WORDS_LINE, whiteSpace: "nowrap", flexShrink: 0, opacity: 0.85, "&[data-own]": { fontWeight: "semibold", opacity: 1 },
            "&[data-group]": { fontSize: "label.xs", fontWeight: "semibold", textTransform: "uppercase", letterSpacing: "0.06em" },
            // A duty in no group's badge (#1595): its words where they and the shift's whole name both fit, else its icon, each
            // form laid out always, unseen but the one shown, so the tile's fit reads both: the unseen one's box is nothing wide,
            // or it would widen the grid's scroll on the week's last day, and the fit adds back what its box cuts.
            "&[data-roster-tile-group]": { position: "relative", display: "inline-flex", alignItems: "center",
                "&[data-roster-tile-group=words] > [data-form=icon], &[data-roster-tile-group=icon] > [data-form=words]": { position: "absolute", visibility: "hidden", width: "0", overflow: "hidden" },
                "& > [data-form=icon]": { display: "inline-flex", ...fontAwesomeSize("10px") } } },
        tileWarn: { display: "inline-flex", flexShrink: 0, color: "fg.warning", ...fontAwesomeSize("10px"), "&[data-tone=danger]": { color: "fg.danger" } },
        tileMore: { textStyle: "mono.xs", lineHeight: DAY_WORDS_LINE, fontWeight: "semibold", color: "fg.danger", flexShrink: 0, whiteSpace: "nowrap" },
        // An off day's `+ Assign`: a wash across the cell, its words shown on hover, focus or selection; inert while a run of the
        // optimiser holds the week (#1409, R2). Its capitals stand at its box's middle (`ASSIGN_WORDS`).
        assign: { flex: "1 1 0", minWidth: 0, height: "24px", borderRadius: "3px", background: "color-mix(in srgb, {colors.fg} 7%, transparent)", color: "transparent",
            ...ASSIGN_WORDS, fontWeight: "semibold", textTransform: "uppercase", letterSpacing: "0.08em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
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
        // Its label never cuts (the hand retest, R3): the header's fit (`data-week-label` on the header's row) shows its
        // dates, else their days alone — the month name dropped — else none; the other form of its dates is laid out
        // unseen, out of the flow and clipped by the label, so the fit measures it whole.
        // Its week number in the design system's mono face, as its dates are.
        weekNumber: { position: "relative", display: "flex", alignItems: "baseline", gap: "8px", height: "24px", padding: "0 8px", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textStyle: "body.sm", fontWeight: "semibold",
            fontFamily: "mono", fontVariantNumeric: "tabular-nums",
            "& > [data-roster-week-dates]": { position: "absolute", left: 0, top: 0, visibility: "hidden" },
            "[data-week-label=full] &": { "& > [data-roster-week-dates=full]": { position: "static", visibility: "visible" } },
            "[data-week-label=days] &": { "& > [data-roster-week-dates=days]": { position: "static", visibility: "visible" } } },
        weekRange: { ...timeHeaderText, color: "fg.muted", overflow: "hidden", textOverflow: "ellipsis" },
        dayTicks: { display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", height: "32px", padding: "0 2px", gap: "2px" },
        // A tick's letter, and its number, show only where every day holds its own whole (R3: `data-day-letters`,
        // `data-day-numbers` on the header's row); unseen, they keep their room, so the fit measures them still.
        dayTick: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minWidth: 0, overflow: "hidden", textStyle: "mono.xs", color: "fg.subtle",
            "& > span:last-of-type": { color: "fg.muted" },
            "[data-day-letters=off] &": { "& > [data-roster-day-letter]": { visibility: "hidden" } },
            "[data-day-numbers=off] &": { "& > [data-roster-day-number]": { visibility: "hidden" } } },
        // A person's week cell: seven marks; tinted while a day of it is drafted, the panel while selected, outlined as its row's cells are.
        monthCell: { position: "relative", display: "flex", alignItems: "center", padding: "0 2px", minWidth: 0, borderLeftWidth: "1px", borderColor: "border.subtle", textAlign: "left", ...planRowFocus,
            "&[data-drafted]": { background: "{colors.brandTint}" }, "&[data-selected]": { background: "bg.panel", boxShadow: "inset 0 0 0 1px {colors.fg}" },
            "&[data-drop-active]": { background: "brand.subtle" }, "&[data-pattern-hover]": { boxShadow: "inset 0 0 0 1px {colors.brand.solid}" },
            "[data-roster-stale] &": retainedColumn },
        markStrip: { display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: "2px", flex: "1 1 0", minWidth: 0, height: "24px", "[data-density=compact] &": { height: "20px" } },
        // A mark: a day's shift in its colour, its letter where the day is wide enough; an off day faint; a placeholder while unread.
        // A shift the app gives no colour is filled in the theme's neutral (`NEUTRAL_MARK`): a tile has its words to say a duty
        // by, a mark its fill alone wherever its day has no room for a letter — on the panel's paper it read as a day off.
        mark: { display: "flex", alignItems: "center", justifyContent: "center", minWidth: 0, overflow: "hidden", borderRadius: "3px", textStyle: "mono.xs", fontWeight: "semibold",
            ...NEUTRAL_MARK, borderWidth: "1px", borderColor: "transparent",
            "&[data-off]": { background: "color-mix(in srgb, {colors.fg} 7%, transparent)", color: "transparent" },
            "&[data-removed]": { textDecoration: "line-through", background: "bg.warning.subtle", color: "fg.subtle" },
            "&[data-drafted]": { borderColor: "brand.solid" },
            "&[data-preview]": { borderStyle: "dashed", borderColor: "brand.solid", background: "transparent", color: "brand.fg" },
            "&[data-preview][data-off]": { borderColor: "fg.subtle", color: "transparent" },
            "&[data-pending]": { background: "bg.subtle", color: "transparent" } },
        // The Patterns tab: each card's strip of marks, Sunday to Saturday as the card's name reads.
        patternStrip: { display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: "2px", height: "18px", marginTop: "4px", width: "100%" },
        patternMark: { display: "flex", alignItems: "center", justifyContent: "center", minWidth: 0, overflow: "hidden", borderRadius: "2px", textStyle: "mono.xs", fontWeight: "semibold",
            ...NEUTRAL_MARK,
            "&[data-off]": { background: "color-mix(in srgb, {colors.fg} 7%, transparent)", color: "transparent" } },

        // ── The People layout's work requirement (#1568, `People Work Requirements` 2a) ──────────────────────────────
        // Its eyebrow under a band (A2): the heading in the name cell, then each day's hours rostered against needed, no
        // valence, 28px on the canvas paper; by month (A2.2) on the month's columns, a figure a week. Its lanes and skill
        // rows are People rows (`peopleRow`), by month the month's (`monthRow`), at the density's pitch.
        demandRow: { display: "grid", gridTemplateColumns: "232px repeat(7, minmax(0, 1fr))", height: "28px", background: "bg.canvas", borderBottomWidth: "1px", borderColor: "border.subtle",
            "&[data-period=month]": { gridTemplateColumns: "168px repeat(var(--roster-weeks, 5), minmax(0, 1fr))" } },
        demandName: { position: "sticky", left: 0, zIndex: 3, display: "flex", alignItems: "center", minWidth: 0, padding: "0 12px 0 20px", background: "bg.canvas",
            borderRightWidth: "1px", borderColor: "border.subtle", textStyle: "mono.xs", fontWeight: "semibold", letterSpacing: "label", textTransform: "uppercase", color: "fg.subtle",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
        // By month a week's hours take the richest form every week's column holds whole (the header's fit rule, R3:
        // `data-demand-form` on the eyebrow's row); the other forms are laid out unseen, out of the flow and clipped by
        // the cell, so the fit measures each whole. The stacked form sets the hours needed under the hours rostered.
        demandFigure: { position: "relative", display: "flex", alignItems: "center", minWidth: 0, padding: "0 10px", borderLeftWidth: "1px", borderColor: "border.subtle", textStyle: "mono.xs",
            color: "fg.muted", whiteSpace: "nowrap", overflow: "hidden",
            "& > [data-roster-demand-form]": { position: "absolute", left: 0, top: 0, visibility: "hidden" },
            "& > [data-roster-demand-form=stacked]": { display: "flex", flexDirection: "column", gap: "2px", lineHeight: 1.2 },
            "[data-demand-form=full] &": { "& > [data-roster-demand-form=full]": { position: "static", visibility: "visible" } },
            "[data-demand-form=short] &": { "& > [data-roster-demand-form=short]": { position: "static", visibility: "visible" } },
            "[data-demand-form=stacked] &": { "& > [data-roster-demand-form=stacked]": { position: "static", visibility: "visible" } } },
        // A lane's name cell (A3.2): its chevron, the shift's swatch, its label and hours, and by week its week's figures at
        // the end; a skill row's (A4.2) its code tag and name, indented under the lane's. By month (168px) it holds no
        // figures (P16).
        laneName: { position: "sticky", left: 0, zIndex: 3, display: "flex", alignItems: "center", gap: "8px", minWidth: 0, padding: "0 12px 0 20px", background: "bg.surface",
            borderRightWidth: "1px", borderColor: "border.subtle", whiteSpace: "nowrap", overflow: "hidden", textAlign: "left", "&[data-skill]": { paddingLeft: "40px" },
            "&[data-period=month]": { paddingRight: "8px" } },
        // The lane's name cell is its disclosure (A3.7): the chevron turns a quarter as its skill rows open.
        laneToggle: { cursor: "pointer", ...planRowFocus,
            "& > svg": { flexShrink: 0, color: "fg.muted", transition: "transform {durations.fast} {easings.inOut}", ...fontAwesomeSize("12px") },
            "&[aria-expanded=true] > svg": { transform: "rotate(90deg)" } },
        laneSwatch: { width: "8px", height: "8px", flexShrink: 0, borderRadius: "2px", background: "var(--roster-fill, {colors.bg.subtle})" },
        laneLabel: { textStyle: "body.md", fontWeight: "semibold", color: "fg", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
        laneHours: { textStyle: "mono.xs", color: "fg.subtle", flexShrink: 0 },
        laneWeek: { marginLeft: "auto", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px", flexShrink: 0, textStyle: "mono.xs", fontSize: "label.md", lineHeight: 1 },
        // A lane's or a skill row's day (A3.3, A4.3): its figures over its bar, centred in the row; a lane's is a button
        // that selects its slot, ringed while selected.
        laneCell: { display: "flex", flexDirection: "column", justifyContent: "center", gap: "6px", minWidth: 0, padding: "0 10px", borderLeftWidth: "1px", borderColor: "border.subtle",
            textAlign: "left", "&:is(button)": { cursor: "pointer", ...planRowFocus }, "&[data-selected]": { boxShadow: "inset 0 0 0 1px {colors.fg}" } },
        laneLine: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "4px", minWidth: 0, textStyle: "mono.xs", fontSize: "label.md", lineHeight: 1, whiteSpace: "nowrap" },
        // The hours rostered — or a skill's assigned — against those needed: the first in the ink, the warning's where a
        // skill is short; the second subtle.
        laneFigure: { display: "inline-flex", gap: "4px", "& > [data-rostered]": { fontWeight: "medium", color: "fg", "&[data-tone=warning]": { color: "fg.warning" } },
            "& > [data-needed]": { color: "fg.subtle" }, "&[data-skill] > [data-rostered]": { color: "fg.strong" } },
        // A difference (K3): the warning's ink where short, muted where over, the positive's where exact.
        laneDiff: { fontWeight: "semibold", "&[data-tone=short]": { color: "fg.warning" }, "&[data-tone=over]": { color: "fg.muted" }, "&[data-tone=exact]": { color: "fg.success" } },
        // A lane's 6px bar: its parts the coverage's segments, the needed tick crossing it.
        laneBar: { position: "relative", height: "6px", background: "bg.subtle" },
        laneTick: { position: "absolute", top: "-3px", bottom: "-3px", width: "2px", marginLeft: "-1px", background: "fg", pointerEvents: "none" },
        laneNoTarget: { textStyle: "mono.xs", fontSize: "label.md", fontStyle: "italic", fontWeight: "normal", color: "fg.subtle", whiteSpace: "nowrap" },
        // A lane's or a skill row's day by month (A3.5, A4.4), over the person marks' `mark`: a cup (ruled 8 Nov 2026),
        // filled from the bottom to its hours rostered of those needed — a skill's, assigned — full at them, its parts the
        // week bar's in their colours, placed by the levels its style sets: the permanent staff's first, then agency
        // staff's, the agencies' requests' on top in the teal's tint, solid, a dash being too small to read in a cup. What
        // a short day lacks is open above them on the warning's 6% wash, its edge — the cup's top and sides along it —
        // dashed in the warning's colour, drawn inside it and clipped to it, so a sliver of a gap never draws its dashes
        // over the fill. A cup nothing fills is open whole (`data-whole`), its dashed edge closed along its bottom too,
        // round at the cup's corners (ruled 9 Nov 2026); an off mark, with no target, is an empty cup. A 1px gap in the
        // panel's colour stands between its parts, in both themes, drawn inside the part above it: a border would make a
        // part thinner than the gap as tall as the gap, past its level. Its difference whole or not at all, never cut, in the
        // text colour with a thin outline in the panel's colour, whatever the fill behind it: no digit splits (ruled 9 Nov
        // 2026). A lane's is a button that selects its slot, ringed over its parts while selected.
        laneMark: { ...wholeOrNone("100%"), position: "relative", borderWidth: 0, fontSize: "label.xs", background: "bg.subtle", color: "fg.muted",
            "--roster-cup-permanent": "0%", "--roster-cup-agency": "0%", "--roster-cup-fill": "0%",
            "&:is(button)": { cursor: "pointer", ...planElementFocus },
            "& > [data-roster-cup-part]": { position: "absolute", left: 0, right: 0, pointerEvents: "none" },
            "& > [data-roster-cup-part=permanent], & > [data-roster-cup-part=assigned]": { bottom: 0, height: "var(--roster-cup-permanent)", background: "brand.solid" },
            "& > [data-roster-cup-part=agency]": { bottom: "var(--roster-cup-permanent)", height: "calc(var(--roster-cup-agency) - var(--roster-cup-permanent))", background: "accent.teal" },
            "& > [data-roster-cup-part=requested]": { bottom: "var(--roster-cup-agency)", height: "calc(var(--roster-cup-fill) - var(--roster-cup-agency))",
                background: "color-mix(in srgb, {colors.accent.teal} 40%, {colors.bg.panel})" },
            "& > [data-roster-cup-part=open]": { top: 0, bottom: "var(--roster-cup-fill)", overflow: "hidden", background: "bg.warning.subtle", borderTopRadius: "inherit",
                "&::before": { content: '""', position: "absolute", inset: "0 0 1px 0", borderWidth: "1px 1px 0", borderStyle: "dashed", borderColor: "border.warning",
                    borderTopRadius: "inherit" },
                "&[data-whole]": { borderBottomRadius: "inherit", "&::before": { bottom: 0, borderBottomWidth: "1px", borderBottomRadius: "inherit" } } },
            "& > [data-roster-cup-part] + [data-roster-cup-part]": { boxShadow: "inset 0 -1px 0 0 {colors.bg.panel}" },
            "& > [data-roster-mark-figure]": { position: "relative", color: "fg", textShadow: "0 0 1px {colors.bg.panel}, 0 0 1px {colors.bg.panel}, 0 0 2px {colors.bg.panel}" },
            "&[data-state=short]": { background: "transparent" },
            "&[data-state=off]": { background: "color-mix(in srgb, {colors.fg} 7%, transparent)", color: "transparent" },
            "&[data-selected]::after": { content: '""', position: "absolute", inset: 0, borderRadius: "inherit", boxShadow: "inset 0 0 0 1px {colors.fg}", pointerEvents: "none" } },
        skillTag: { display: "inline-flex", alignItems: "center", height: "16px", flexShrink: 0, padding: "0 4px", borderWidth: "1px", borderColor: "border.strong", borderRadius: "sm",
            textStyle: "mono.xs", fontSize: "label.xs", fontWeight: "semibold", color: "fg.strong" },
        skillName: { textStyle: "body.sm", color: "fg.strong", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
        skillBar: { position: "relative", height: "3px", background: "bg.subtle", overflow: "hidden" },
        // The eyebrow before a band's people (A5): `Assignment · n people`, its words kept in view as the grid pans.
        assignRow: { display: "flex", alignItems: "center", height: "28px", background: "bg.canvas", borderBottomWidth: "1px", borderColor: "border.subtle" },
        assignLabel: { position: "sticky", left: 0, padding: "0 20px", textStyle: "mono.xs", fontWeight: "semibold", letterSpacing: "label", textTransform: "uppercase", color: "fg.subtle",
            whiteSpace: "nowrap" },
        // On a phone (#1568), before a band's people's cards: the eyebrow — its heading, the week's hours rostered of needed
        // at its end — over a card a day, 8px apart as a day's cards are in the Shifts layout's.
        demandCards: { display: "flex", flexDirection: "column", gap: "8px", minWidth: 0, paddingBottom: "8px" },
        demandCardsHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", minWidth: 0, height: "28px", padding: "0 12px", background: "bg.canvas",
            borderBottomWidth: "1px", borderColor: "border.subtle", textStyle: "mono.xs", fontWeight: "semibold", letterSpacing: "label", textTransform: "uppercase", color: "fg.subtle",
            whiteSpace: "nowrap", "& > [data-roster-demand-heading]": { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
            "& > [data-roster-demand-total]": { flexShrink: 0, fontWeight: "medium", letterSpacing: "normal", textTransform: "none", color: "fg.muted", fontVariantNumeric: "tabular-nums" } },
        // A lane's day on a day card: the shift's swatch and label, its figures at the end and its bar under them across the
        // line; one button that selects its slot, ringed while selected, out to the card's padding, a finger's height on touch.
        demandShift: { display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto", alignItems: "center", columnGap: "8px", rowGap: "6px", minWidth: 0,
            margin: "0 -8px", padding: "4px 8px", borderRadius: "sm", textAlign: "left", whiteSpace: "nowrap", cursor: "pointer", ...planRowFocus,
            ...coarseHitArea({ position: true, axis: "block" }), "& > [data-roster-lane-bar]": { gridColumn: "1 / -1" }, "&[data-selected]": { boxShadow: "inset 0 0 0 1px {colors.fg}" } },
    },
});
