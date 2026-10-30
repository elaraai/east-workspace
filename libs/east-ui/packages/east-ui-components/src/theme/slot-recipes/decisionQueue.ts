/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * DecisionQueue slot recipe (#1447; `Decision Queue Spec.md` §8) — the queue's own looks, from the mock: what no other
 * builder draws. The frame, the toolbar's row and its history item, the buttons (`xs`), the radios, the note's
 * textarea, Modify's inspector form, the banners and the empty state are the shared parts' own (§6), and a preview is
 * the `decisionPreview` recipe's, over each builder's own recipes at the crop's sizes; this recipe never restyles them.
 * The parts set data attributes and geometry only.
 *
 *   - root / main: the queue's root, a column filling its host, and the frame's main — a bounded column the list fills
 *     and scrolls in. While a narrowing is read the cases it showed stand in, retained (`data-decision-stale` on main,
 *     #1398 CL5): the cards', the receipts', the sections' and the Routine band's words in the third ink, every edge
 *     its own.
 *   - heading / title / count / late / lateIcon: the toolbar's first item, `Decisions` and its count chip on one line;
 *     the count chip — `count` is every count chip the queue draws, a section's and the Routine band's too, and settles
 *     from the tint to its paper as the count changes (`data-settle`, the queue keying it again at each change) — and
 *     the past-due words, and at the row's floor their clock before their number.
 *   - list, empty, emptyLines, emptyLine, emptyIcon: main's list, on `--paper-2`; and the box the shared empty state
 *     stands in once a read finds nothing, at the list's top, its two lines each led by its icon.
 *   - footer: the shared footer rail (`builder-footer.ts`), which holds the shared loading line alone.
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
 *   - note: the note's box and the override's — the shared textarea and input — `--brand-tint` while it holds text
 *     (`data-filled`).
 *   - link: Add a note, Reset all.
 *   - error: an edit a changed row's kind refuses, under the row's form in the Edit panel — the builders' inspectors' line.
 *
 * On a coarse pointer each bare button — Why's toggle, the Routine band's, a link, a receipt's Undo — is a 44px tap
 * target by its halo (`coarseHitArea`), its size kept; an option, whose neighbours sit edge to edge, is 44px tall.
 *
 * Under `prefers-reduced-motion` every duration is 0: the body opens, the receipt arrives and leaves and the chip
 * settles at once.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { coarseHitArea } from "../../style/hit-area.js";
import { builderFooter } from "./builder-footer.js";

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

/** A bare button the queue draws in its own words — Why's toggle, the Routine band's, a link, Undo — 44px to a coarse pointer by its halo. */
const BARE = {
    appearance: "none",
    margin: "0",
    padding: "0",
    border: "0",
    background: "transparent",
    cursor: "pointer",
    outline: "none",
    _focusVisible: { boxShadow: "{shadows.focus}" },
    ...coarseHitArea({ position: true }),
} satisfies SystemStyleObject;

/** What a part kept on screen while a narrowing is read wears (#1398, CL5): its words in the third ink, its edges its own. */
const RETAINED = { "[data-decision-stale] &": { color: "fg.muted", "& *": { color: "inherit" } } } satisfies SystemStyleObject;

/** The 6% wash of a tone a call box stands on. */
const wash = (tone: string) => `color-mix(in oklch, {colors.${tone}} 6%, transparent)`;

export const decisionQueueSlotRecipe = defineSlotRecipe({
    className: "elara-decision-queue",
    slots: [
        "root", "main",
        "heading", "title", "count", "late", "lateIcon",
        "list", "empty", "emptyLines", "emptyLine", "emptyIcon", "footer",
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
        "note", "link",
        "actions", "actionRow",
        "panel", "panelHead", "panelTitle", "panelMeta", "overrideKinds", "error",
        "receipt", "receiptDot", "receiptVerdict", "receiptTitle", "receiptUndo",
        "routine", "routineHead", "routineToggle", "routineTotal", "routineList", "routineRow",
        "routineIcon", "routineText", "routineTitle", "routineMeta", "routineValue",
    ],
    base: {
        // The queue (§7): a column filling its host, the frame's main a bounded column the list fills.
        root: {
            height: "100%",
            minHeight: "0",
            minWidth: "0",
            display: "flex",
            flexDirection: "column",
            background: "bg.surface",
            color: "fg",
        },
        main: {
            flex: "1",
            minHeight: "0",
            minWidth: "0",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            background: "bg.canvas",
            outline: "none",
        },
        // The toolbar (§8): the frame's 44px row holds them.
        heading: {
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            minWidth: "0",
        },
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
        // The past-due count's clock at the row's floor, in its words' ink and size, before its number.
        lateIcon: {
            "--fa-width": "auto",
            display: "inline-flex",
            marginInlineEnd: "4px",
        },
        // Main's list: the shared rows filling main, which scroll in it.
        list: {
            minHeight: "0",
            background: "bg.canvas",
            scrollbarWidth: "thin",
        },
        // Nothing waiting (§8): the shared empty state at the list's top, its two lines each led by its icon.
        empty: {
            flex: "1",
            minHeight: "0",
            display: "grid",
            justifyItems: "center",
            alignContent: "start",
            background: "bg.canvas",
            overflow: "auto",
        },
        emptyLines: {
            margin: "0",
            paddingTop: "12px",
            paddingInline: "0",
            paddingBottom: "0",
            listStyle: "none",
            display: "grid",
            gap: "8px",
            textAlign: "left",
        },
        emptyLine: {
            display: "flex",
            gap: "8px",
            fontSize: "body",
            lineHeight: "20px",
            color: "fg.strong",
        },
        emptyIcon: {
            "--fa-width": "auto",
            flex: "none",
            width: "14px",
            height: "20px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "12px",
            color: "fg.subtle",
        },
        footer: builderFooter,
        section: {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            boxSizing: "content-box",
            height: "20px",
            paddingInline: "12px",
            paddingTop: "16px",
            "&[data-first]": { paddingTop: "12px" },
            ...RETAINED,
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
            ...RETAINED,
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
            // Its neighbours sit edge to edge, so no halo: on a coarse pointer the row itself is the 44px target.
            _coarse: { minHeight: "44px" },
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
        // One line wherever its column holds it, as the mock's; in a narrow host it wraps at its spaces, never running
        // past its column (R30).
        figureSub: {
            fontFamily: "mono",
            fontSize: "label.xs",
            color: "fg.muted",
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
            // The answers: the shared radio group's row, wrapping where the card is narrow.
            "& [role=radiogroup] > div": { flexWrap: "wrap", rowGap: "4px" },
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
        // The note (§8): the shared textarea — or the override's shared input — `--brand-tint` while it holds text.
        note: {
            display: "grid",
            minWidth: "0",
            "&[data-filled] :is(textarea, input)": { background: "brandTint" },
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
        // An edit its row's kind refuses, under the row's form: the builders' inspectors' error line.
        error: { textStyle: "body.sm", color: "fg.danger", overflowWrap: "anywhere" },
        // The reasons: the shared radio group's column, laid in two.
        overrideKinds: {
            "& [role=radiogroup] > div": {
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                columnGap: "8px",
            },
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
            ...RETAINED,
        },
        receiptDot: {
            flex: "none",
            width: "8px",
            height: "8px",
            borderRadius: "full",
            background: "fg.subtle",
            "&[data-verdict=applied]": { background: "status.pos" },
            "&[data-verdict=overridden]": { background: "status.warn" },
            "&[data-verdict=handedOff]": { background: "status.info" },
        },
        receiptVerdict: {
            ...CAPS,
            flex: "none",
            fontSize: "label.sm",
            letterSpacing: "label",
            color: "fg.muted",
            "&[data-verdict=applied]": { color: "fg.success" },
            "&[data-verdict=overridden]": { color: "fg.warning" },
            "&[data-verdict=handedOff]": { color: "fg.info" },
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
            ...RETAINED,
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
    },
});
