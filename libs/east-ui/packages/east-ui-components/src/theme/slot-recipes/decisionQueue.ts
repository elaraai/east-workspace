/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * DecisionQueue slot recipe (#1447; `Decision Queue Spec.md` §8) — the queue's own looks, from the mock: what no other
 * builder draws. The frame, the toolbar's row and its history item, the buttons (`xs`), the radios, the note's
 * textarea, Modify's inspector form, the banners and the empty state are the shared parts' own (§6), and a preview's
 * entries are each builder's own recipes at the crop's sizes; this recipe never restyles them. The parts set data
 * attributes and geometry only.
 *
 *   - title / count / late: the toolbar's `Decisions`, its count chip — `count` is every count chip the queue draws,
 *     a section's and the Routine band's too, and settles from the tint to its paper as the count changes
 *     (`data-settle`, the queue keying it again at each change) — and the past-due words.
 *   - list: main's list, on `--paper-2`.
 *   - section, sectionLabel, sectionRule, sectionTotal: a section's head, a row of the list: 12 from the list's top
 *     (`data-first`) and 16 below the row above (the section's 4 under its cards and the next one's 12 above its head),
 *     20 tall; its label in its tone (`data-tone="overdue"`), its count chip, the rule filling the row, its total.
 *   - cardRow: a row of the list that holds a card or a receipt, inset 12 at either side; the card and the receipt
 *     stand 8 below the row above (their own `margin-top`, inside the row, so the row's measured height carries it).
 *   - card, head and its parts: the card, `--ink` while open (`data-open`); its head — sticky at the list's top while
 *     the card is open, `--paper-3` with a rule under it then, `--brand-tint` once modified (`data-modified`), its
 *     eyebrow, due words in their section's tone (`data-tone="overdue|today"`), title, chip line and value line with
 *     the status at its end (`data-tone="warn|neg"`).
 *   - body, bodyClip, bodyInner and the open card's parts: the body grows down from under the head as it opens
 *     (`decision-open`, `--dur-base`); Options, Change, the figures, Your call and the warning (`call`, in its tone),
 *     Why, the actions' foot, the Edit and Override panels.
 *   - receipt and its parts: what a verdict leaves where its card stood — arriving from the card's height
 *     (`--receipt-from`, which the queue sets) to its 40px, leaving to nothing (`data-leaving`) with the 8px above it, so
 *     the rows below rise with no jump; its dot and verdict in the verdict's tone (`data-verdict`).
 *   - routine and its parts: the Routine band at the list's end.
 *   - chevron: Why's and the Routine band's, turned 90° while open (`data-open`).
 *   - link: Open in…, Add a note, Reset all.
 *   - preview, previewIcon, previewShared, previewGuess: a preview's frame (`role="img"`, dashed while stale —
 *     `data-stale`) and the marks on the `elara` tokens over the attributes a builder's own entries carry in it, the
 *     words Optimise's landing reads (#1409): a proposed entry (`data-op="add|chg"`) the steady highlight Optimise's
 *     result is drawn with (`ELARA_STEADY`), on the dirty fill unless the entry has its own (`data-fill="own"`), inset
 *     on a Sheet cell (`data-fill="cell"`); a ghost — an entry the proposal moves off (`data-op="from"`) or removes
 *     (`data-op="del"`, struck through) — dashed in `elara.edge`, unfilled, its words `--ink-4`; an entry the proposal
 *     knocks on (`data-knock`) a dashed `elara.edge` ring 3px out; one it overfills or breaks a rule on
 *     (`data-breach`) a `--warn` ring; while stale the proposal dashed on `--paper-3`, no glow; once applied
 *     (`data-applied`) the glow settles to nothing over `--dur-slow` and the ghosts go. The warning and lock icons, the
 *     shared `+N` chip and the guess dot are the marks' own parts.
 *
 * Under `prefers-reduced-motion` every duration is 0: the body opens, the receipt arrives and leaves and the chip
 * settles at once.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { ELARA_STEADY, ELARA_STEADY_INSET } from "../elara-marks.js";

/** A label in the mono caps the queue's eyebrows, section heads and part labels share. */
const CAPS = {
    fontFamily: "mono",
    fontWeight: "semibold",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
} satisfies SystemStyleObject;

/** One line, cut with an ellipsis. */
const ONE_LINE = {
    minWidth: "0",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
} satisfies SystemStyleObject;

/** A figure in running text — a title's, the change's, Why's: mono, the text's own weight unless given. */
const FIGURES = { "& [data-figure]": { fontFamily: "mono" } } satisfies SystemStyleObject;

/** A bare button the queue draws in its own words — Why's toggle, the Routine band's, a link, Undo. */
const BARE = {
    appearance: "none",
    margin: "0",
    padding: "0",
    border: "0",
    background: "transparent",
    cursor: "pointer",
    outline: "none",
    _focusVisible: { boxShadow: "{shadows.focus}" },
} satisfies SystemStyleObject;

/** The 6% wash of a tone a call box stands on. */
const wash = (tone: string) => `color-mix(in oklch, {colors.${tone}} 6%, transparent)`;

/** A ghost in a preview: dashed `elara.edge`, unfilled, its words `--ink-4`. */
const GHOST = {
    borderWidth: "1px",
    borderStyle: "dashed",
    borderColor: "elara.edge",
    background: "transparent",
    boxShadow: "none",
    color: "fg.subtle",
} satisfies SystemStyleObject;

/** The marks over a preview's entries (§8, P13–P22): what the `preview` slot draws on the builder's own parts. */
const MARKS = {
    "& [data-op=add], & [data-op=chg]": {
        boxShadow: ELARA_STEADY,
        transitionProperty: "box-shadow",
        transitionDuration: "slow",
        transitionTimingFunction: "{easings.out}",
    },
    "& [data-op=add]:not([data-fill=own]):not([data-fill=cell]), & [data-op=chg]:not([data-fill=own]):not([data-fill=cell])": {
        backgroundColor: "brandTint",
    },
    "& [data-fill=cell][data-op=add], & [data-fill=cell][data-op=chg]": { backgroundColor: "brandTint", boxShadow: ELARA_STEADY_INSET },
    "& [data-op=from], & [data-op=del]": {
        ...GHOST,
        transitionProperty: "opacity",
        transitionDuration: "slow",
        transitionTimingFunction: "{easings.out}",
    },
    "& [data-op=del]": { textDecoration: "line-through" },
    "& [data-op=from] *, & [data-op=del] *": { color: "inherit" },
    "& [data-knock]": { outline: "1px dashed {colors.elara.edge}", outlineOffset: "3px" },
    "& [data-breach]": { outline: "1px solid {colors.status.warn}", outlineOffset: "3px" },
    // Stale (P21): the proposal dashed on `--paper-3`, its words `--ink-3`, no glow.
    "&[data-stale] [data-op=add], &[data-stale] [data-op=chg]": {
        borderWidth: "1px",
        borderStyle: "dashed",
        borderColor: "fg.subtle",
        backgroundColor: "bg.subtle",
        boxShadow: "none",
        color: "fg.muted",
    },
    // Applied (P22): the glow settles, the ghosts go.
    "&[data-applied] [data-op=add], &[data-applied] [data-op=chg]": { boxShadow: "none" },
    "&[data-applied] [data-op=from], &[data-applied] [data-op=del]": { opacity: 0 },
    _motionReduce: {
        "& [data-op]": { transition: "none" },
    },
} satisfies SystemStyleObject;

export const decisionQueueSlotRecipe = defineSlotRecipe({
    className: "elara-decision-queue",
    slots: [
        "title", "count", "late",
        "list",
        "section", "sectionLabel", "sectionRule", "sectionTotal",
        "cardRow", "card", "head",
        "eyebrow", "eyebrowIcon", "eyebrowText", "due",
        "headTitle", "chipLine", "proposal", "summary",
        "valueLine", "value", "unit", "status", "statusDot",
        "body", "bodyClip", "bodyInner",
        "part", "partHead", "partLabel",
        "options", "option", "optionMark", "optionText", "optionLabel", "optionLine", "optionValue",
        "change",
        "figures", "figure", "figureLabel", "figureValue", "figureSub",
        "call", "callIcon", "callBody", "callWord", "callQuestion", "callHelp", "callText",
        "why", "chevron", "toggleLabel", "whyModel", "whyText",
        "link",
        "actions", "actionRow",
        "panel", "panelHead", "panelTitle", "panelMeta", "overrideKinds",
        "receipt", "receiptDot", "receiptVerdict", "receiptTitle", "receiptUndo",
        "routine", "routineHead", "routineToggle", "routineTotal", "routineList", "routineRow",
        "routineIcon", "routineText", "routineTitle", "routineMeta", "routineValue",
        "preview", "previewIcon", "previewShared", "previewGuess",
    ],
    base: {
        // The toolbar (§8): the frame's 44px row holds them.
        title: {
            ...CAPS,
            ...ONE_LINE,
            fontSize: "label.md",
            letterSpacing: "label",
            color: "fg",
        },
        count: {
            flex: "none",
            height: "16px",
            boxSizing: "border-box",
            display: "inline-flex",
            alignItems: "center",
            paddingInline: "4px",
            borderRadius: "sm",
            background: "bg.subtle",
            fontFamily: "mono",
            fontSize: "label.sm",
            fontWeight: "semibold",
            lineHeight: "1",
            color: "fg.strong",
            "&[data-settle]": { animation: "decision-settle {durations.slow} {easings.out}" },
            _motionReduce: { "&[data-settle]": { animation: "none" } },
        },
        late: {
            flex: "none",
            fontFamily: "mono",
            fontSize: "label.xs",
            fontWeight: "semibold",
            color: "fg.danger",
            whiteSpace: "nowrap",
        },
        list: {
            height: "100%",
            minHeight: "0",
            background: "bg.canvas",
            scrollbarWidth: "thin",
        },
        section: {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            boxSizing: "content-box",
            height: "20px",
            paddingInline: "12px",
            paddingTop: "16px",
            "&[data-first]": { paddingTop: "12px" },
        },
        sectionLabel: {
            ...CAPS,
            fontSize: "label.sm",
            letterSpacing: "label",
            color: "fg.subtle",
            "&[data-tone=overdue]": { color: "fg.danger" },
        },
        sectionRule: {
            flex: "1",
            height: "1px",
            background: "border.subtle",
        },
        sectionTotal: {
            fontFamily: "mono",
            fontSize: "label.xs",
            color: "fg.subtle",
            whiteSpace: "nowrap",
        },
        cardRow: {
            paddingInline: "12px",
        },
        card: {
            marginTop: "8px",
            minWidth: "0",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "border.strong",
            borderRadius: "md",
            background: "bg.surface",
            overflow: "clip",
            "&[data-open]": { borderColor: "fg" },
        },
        head: {
            position: "sticky",
            top: "0",
            zIndex: "1",
            display: "grid",
            gap: "8px",
            padding: "12px",
            minWidth: "0",
            background: "bg.surface",
            cursor: "pointer",
            outline: "none",
            "&:hover": { background: "bg.canvas" },
            "&[data-modified], &[data-modified]:hover": { background: "brandTint" },
            "&[data-open], &[data-open]:hover": {
                background: "bg.subtle",
                borderBottomWidth: "1px",
                borderBottomStyle: "solid",
                borderBottomColor: "border.subtle",
            },
            _focusVisible: { boxShadow: "{shadows.focusInset}" },
        },
        eyebrow: {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            minWidth: "0",
        },
        eyebrowIcon: {
            "--fa-width": "auto",
            flex: "none",
            display: "inline-flex",
            justifyContent: "center",
            width: "14px",
            fontSize: "11px",
            color: "fg.muted",
        },
        eyebrowText: {
            ...CAPS,
            ...ONE_LINE,
            flex: "1",
            fontSize: "label.xs",
            letterSpacing: "widest",
            color: "fg.subtle",
        },
        due: {
            flex: "none",
            fontFamily: "mono",
            fontSize: "label.md",
            fontWeight: "semibold",
            color: "fg.muted",
            whiteSpace: "nowrap",
            "&[data-tone=overdue]": { color: "fg.danger" },
            "&[data-tone=today]": { color: "fg.warning" },
        },
        headTitle: {
            fontSize: "body",
            fontWeight: "semibold",
            lineHeight: "1.4",
            color: "fg",
            textWrap: "pretty",
            ...FIGURES,
        },
        chipLine: {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            minWidth: "0",
        },
        proposal: {
            flex: "none",
            height: "18px",
            boxSizing: "border-box",
            display: "inline-flex",
            alignItems: "center",
            paddingInline: "4px",
            borderWidth: "1px",
            borderStyle: "dashed",
            borderColor: "brand.solid",
            borderRadius: "sm",
            fontFamily: "mono",
            fontSize: "label.xs",
            fontWeight: "semibold",
            letterSpacing: "caps",
            textTransform: "uppercase",
            color: "brand.solid",
        },
        summary: {
            ...ONE_LINE,
            flex: "1",
            fontFamily: "mono",
            fontSize: "label.md",
            color: "fg.muted",
        },
        valueLine: {
            display: "flex",
            flexWrap: "wrap",
            alignItems: "baseline",
            gap: "4px",
            minWidth: "0",
        },
        value: {
            fontFamily: "mono",
            fontSize: "body",
            fontWeight: "semibold",
            color: "fg",
            whiteSpace: "nowrap",
            "&[data-modified]": { color: "brandPressed" },
        },
        unit: {
            fontFamily: "mono",
            fontSize: "label.md",
            fontWeight: "medium",
            color: "fg.subtle",
            whiteSpace: "nowrap",
        },
        status: {
            ...CAPS,
            alignSelf: "center",
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "label.sm",
            letterSpacing: "caps",
            "&[data-tone=warn]": { color: "fg.warning" },
            "&[data-tone=neg]": { color: "fg.danger" },
        },
        statusDot: {
            flex: "none",
            width: "8px",
            height: "8px",
            borderRadius: "full",
            "&[data-tone=warn]": { background: "status.warn" },
            "&[data-tone=neg]": { background: "status.neg" },
        },
        // The open card (§8): its body grows down from under the head.
        body: {
            display: "grid",
            gridTemplateRows: "1fr",
            animation: "decision-open {durations.normal} {easings.out}",
            _motionReduce: { animation: "none" },
        },
        bodyClip: {
            minHeight: "0",
            overflow: "hidden",
        },
        bodyInner: {
            display: "grid",
            gap: "16px",
            padding: "12px",
        },
        part: {
            display: "grid",
            gap: "8px",
            minWidth: "0",
        },
        partHead: {
            display: "flex",
            alignItems: "baseline",
            gap: "8px",
            "& > :first-child": { flex: "1" },
        },
        partLabel: {
            ...CAPS,
            fontSize: "label.xs",
            letterSpacing: "widest2",
            color: "fg.subtle",
        },
        options: {
            display: "flex",
            flexDirection: "column",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "border.strong",
            borderRadius: "md",
            overflow: "hidden",
            background: "bg.surface",
        },
        option: {
            appearance: "none",
            margin: "0",
            width: "100%",
            display: "grid",
            gridTemplateColumns: "14px minmax(0, 1fr) auto",
            alignItems: "center",
            gap: "8px",
            minHeight: "40px",
            boxSizing: "border-box",
            paddingBlock: "4px",
            paddingInline: "12px",
            border: "0",
            background: "bg.surface",
            textAlign: "left",
            cursor: "pointer",
            outline: "none",
            "& + &": { borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "border.subtle" },
            "&:hover": { background: "bg.canvas" },
            "&[aria-selected=true], &[aria-selected=true]:hover": { background: "bg.subtle" },
            "&[aria-disabled=true], &[aria-disabled=true]:hover": { background: "bg.surface", cursor: "default" },
            _focusVisible: { boxShadow: "{shadows.focusInset}" },
        },
        optionMark: {
            "--fa-width": "auto",
            display: "flex",
            justifyContent: "center",
            fontSize: "label.lg",
            color: "fg.success",
            "&[data-refused]": { color: "fg.warning" },
        },
        optionText: {
            display: "grid",
            gap: "2px",
            minWidth: "0",
        },
        optionLabel: {
            ...ONE_LINE,
            fontFamily: "mono",
            fontSize: "label.lg",
            fontWeight: "semibold",
            color: "fg",
            "&[data-refused]": { color: "fg.subtle" },
        },
        optionLine: {
            ...ONE_LINE,
            fontFamily: "mono",
            fontSize: "label.xs",
            color: "fg.subtle",
            "&[data-tone=warn]": { color: "fg.warning" },
        },
        optionValue: {
            fontFamily: "mono",
            fontSize: "label.md",
            fontWeight: "semibold",
            color: "fg",
            whiteSpace: "nowrap",
        },
        change: {
            fontSize: "body.sm",
            lineHeight: "1.5",
            color: "fg.strong",
            "& [data-figure]": { fontFamily: "mono", fontWeight: "medium" },
        },
        figures: {
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: "12px",
        },
        figure: {
            display: "grid",
            gap: "2px",
            minWidth: "0",
        },
        figureLabel: {
            ...CAPS,
            ...ONE_LINE,
            fontSize: "label.xs",
            letterSpacing: "label",
            color: "fg.subtle",
        },
        figureValue: {
            fontFamily: "mono",
            fontSize: "body",
            fontWeight: "semibold",
            color: "fg",
            whiteSpace: "nowrap",
            "&[data-tone=neg]": { color: "fg.danger" },
            "&[data-modified]": { color: "brandPressed" },
            "&[data-empty]": { fontStyle: "italic", color: "fg.subtle" },
        },
        figureSub: {
            fontFamily: "mono",
            fontSize: "label.xs",
            color: "fg.muted",
            whiteSpace: "nowrap",
        },
        // Your call and the warning (§8): a box in its tone over a 6% wash of it.
        call: {
            display: "flex",
            alignItems: "flex-start",
            gap: "8px",
            paddingBlock: "8px",
            paddingInline: "12px",
            borderRadius: "md",
            borderWidth: "1px",
            borderStyle: "solid",
            "&[data-tone=warn]": { borderColor: "status.warn", background: wash("status.warn") },
            "&[data-tone=neg]": { borderColor: "status.neg", background: wash("status.neg") },
            "&[data-tone=pos]": { borderColor: "status.pos", background: wash("status.pos") },
        },
        callIcon: {
            "--fa-width": "auto",
            flex: "none",
            display: "inline-flex",
            justifyContent: "center",
            width: "14px",
            paddingTop: "3px",
            fontSize: "14px",
            "&[data-tone=warn]": { color: "status.warn" },
            "&[data-tone=neg]": { color: "status.neg" },
            "&[data-tone=pos]": { color: "status.pos" },
        },
        callBody: {
            flex: "1",
            minWidth: "0",
            display: "grid",
            gap: "4px",
        },
        callWord: {
            ...CAPS,
            fontSize: "label.sm",
            letterSpacing: "widest",
            "&[data-tone=warn]": { color: "fg.warning" },
            "&[data-tone=neg]": { color: "fg.danger" },
            "&[data-tone=pos]": { color: "fg.success" },
        },
        callQuestion: {
            fontSize: "body",
            fontWeight: "semibold",
            lineHeight: "1.5",
            color: "fg",
        },
        callHelp: {
            fontSize: "body.sm",
            lineHeight: "1.5",
            color: "fg.muted",
        },
        callText: {
            fontSize: "body.sm",
            lineHeight: "1.5",
            color: "fg",
        },
        // Why (§8): a 24px toggle, its paragraph inset 24.
        why: {
            ...BARE,
            display: "flex",
            alignItems: "center",
            gap: "8px",
            height: "24px",
            borderRadius: "sm",
            textAlign: "left",
            minWidth: "0",
        },
        chevron: {
            "--fa-width": "auto",
            width: "16px",
            flex: "none",
            display: "inline-flex",
            justifyContent: "center",
            fontSize: "14px",
            color: "fg.muted",
            transitionProperty: "transform",
            transitionDuration: "fast",
            transitionTimingFunction: "{easings.inOut}",
            "&[data-open]": { transform: "rotate(90deg)" },
            _motionReduce: { transition: "none" },
        },
        toggleLabel: {
            ...CAPS,
            flex: "none",
            fontSize: "label.sm",
            letterSpacing: "label",
            color: "fg.subtle",
        },
        whyModel: {
            ...ONE_LINE,
            fontFamily: "mono",
            fontSize: "label.xs",
            color: "fg.subtle",
        },
        whyText: {
            margin: "0",
            paddingLeft: "24px",
            fontSize: "body.sm",
            lineHeight: "1.5",
            color: "fg.strong",
            textWrap: "pretty",
            "& [data-figure]": { fontFamily: "mono", fontWeight: "medium" },
        },
        link: {
            ...BARE,
            borderRadius: "sm",
            fontFamily: "body",
            fontSize: "body.sm",
            fontWeight: "medium",
            color: "brand.solid",
            whiteSpace: "nowrap",
            justifySelf: "start",
            _hover: { color: "brandPressed", textDecoration: "underline", textUnderlineOffset: "2px" },
        },
        actions: {
            display: "grid",
            gap: "12px",
            padding: "12px",
            background: "bg.surface",
            borderTopWidth: "1px",
            borderTopStyle: "solid",
            borderTopColor: "border.subtle",
        },
        actionRow: {
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "8px",
        },
        // Edit and Override (§8): a panel under the actions.
        panel: {
            display: "grid",
            gap: "16px",
            padding: "12px",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "border.strong",
            borderRadius: "md",
            background: "bg.surface",
        },
        panelHead: {
            display: "flex",
            alignItems: "baseline",
            gap: "8px",
            minWidth: "0",
        },
        panelTitle: {
            ...CAPS,
            flex: "none",
            fontSize: "label.xs",
            letterSpacing: "widest2",
            color: "fg.subtle",
        },
        panelMeta: {
            ...ONE_LINE,
            flex: "1",
            fontFamily: "mono",
            fontSize: "label.xs",
            color: "fg.subtle",
        },
        overrideKinds: {
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            columnGap: "8px",
        },
        // The receipt (§8): what a verdict leaves where its card stood.
        receipt: {
            marginTop: "8px",
            height: "40px",
            flex: "none",
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            paddingBlock: "0",
            paddingInlineStart: "12px",
            paddingInlineEnd: "8px",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "border.subtle",
            borderRadius: "md",
            background: "bg.canvas",
            overflow: "hidden",
            animation: "decision-receipt-in {durations.normal} {easings.out} both",
            "&[data-leaving]": { animation: "decision-receipt-out {durations.normal} {easings.out} forwards" },
            _motionReduce: { animation: "none", "&[data-leaving]": { animation: "none" } },
        },
        receiptDot: {
            flex: "none",
            width: "8px",
            height: "8px",
            borderRadius: "full",
            background: "fg.subtle",
            "&[data-verdict=applied]": { background: "status.pos" },
            "&[data-verdict=overridden]": { background: "status.warn" },
            "&[data-verdict=handoff]": { background: "status.info" },
        },
        receiptVerdict: {
            ...CAPS,
            flex: "none",
            fontSize: "label.sm",
            letterSpacing: "label",
            color: "fg.muted",
            "&[data-verdict=applied]": { color: "fg.success" },
            "&[data-verdict=overridden]": { color: "fg.warning" },
            "&[data-verdict=handoff]": { color: "fg.info" },
        },
        receiptTitle: {
            ...ONE_LINE,
            flex: "1",
            fontSize: "body.sm",
            color: "fg.muted",
        },
        receiptUndo: {
            ...BARE,
            flex: "none",
            height: "24px",
            paddingInline: "8px",
            borderRadius: "sm",
            fontFamily: "body",
            fontSize: "body.sm",
            fontWeight: "semibold",
            color: "brand.solid",
            _hover: { background: "bg.subtle", color: "brandPressed" },
        },
        // The Routine band (§8), at the list's end.
        routine: {
            display: "grid",
            gap: "8px",
            padding: "12px",
            paddingTop: "16px",
            "&[data-first]": { paddingTop: "12px" },
        },
        routineHead: {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            minHeight: "24px",
        },
        routineToggle: {
            ...BARE,
            height: "24px",
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            paddingInlineEnd: "4px",
            borderRadius: "md",
        },
        routineTotal: {
            flex: "1",
            fontFamily: "mono",
            fontSize: "label.xs",
            color: "fg.subtle",
            whiteSpace: "nowrap",
        },
        routineList: {
            display: "grid",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "border.strong",
            borderRadius: "md",
            overflow: "hidden",
            background: "bg.surface",
        },
        routineRow: {
            display: "grid",
            gridTemplateColumns: "14px minmax(0, 1fr) auto",
            alignItems: "center",
            gap: "8px",
            minHeight: "40px",
            paddingBlock: "4px",
            paddingInline: "12px",
            "& + &": { borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "border.subtle" },
        },
        routineIcon: {
            "--fa-width": "auto",
            display: "inline-flex",
            justifyContent: "center",
            fontSize: "10px",
            color: "fg.muted",
        },
        routineText: {
            display: "grid",
            minWidth: "0",
        },
        routineTitle: {
            fontSize: "body.sm",
            fontWeight: "medium",
            lineHeight: "1.4",
            color: "fg",
            ...FIGURES,
        },
        routineMeta: {
            ...ONE_LINE,
            fontFamily: "mono",
            fontSize: "label.xs",
            color: "fg.subtle",
        },
        routineValue: {
            fontFamily: "mono",
            fontSize: "body.sm",
            fontWeight: "semibold",
            color: "fg",
            whiteSpace: "nowrap",
        },
        // A preview (§8, P2–P22): its frame, and the marks on the builder's own entries in it.
        preview: {
            position: "relative",
            boxSizing: "border-box",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "border.subtle",
            borderRadius: "sm",
            background: "bg.surface",
            overflow: "hidden",
            "&[data-stale]": { borderStyle: "dashed", borderColor: "border.strong" },
            ...MARKS,
        },
        previewIcon: {
            "--fa-width": "auto",
            flex: "none",
            display: "inline-flex",
            fontSize: "label.xs",
            color: "inherit",
            "&[data-tone=warn]": { color: "status.warn" },
        },
        previewShared: {
            flex: "none",
            height: "12px",
            display: "inline-flex",
            alignItems: "center",
            paddingInline: "4px",
            borderRadius: "2px",
            background: "bg.surface",
            color: "fg",
            fontSize: "label.xs",
        },
        previewGuess: {
            flex: "none",
            width: "6px",
            height: "6px",
            borderRadius: "full",
            background: "status.warn",
        },
    },
});
