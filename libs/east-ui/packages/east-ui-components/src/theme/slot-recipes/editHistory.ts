/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Edit history slot recipe — the editing session's Undo / Redo / Discard /
 * Apply bar (#879), shared by every editable collection. It sits in its
 * host's toolbar, beside the search, not in a row of its own: a status line
 * (mono 11px `fg.muted`), the issues button (hidden, keeping its place, while
 * there are none; its icon in the warn tone while warnings stand beside the
 * issues, #1585), the history buttons (the `iconButton` recipe: on a coarse
 * pointer they keep their size and take a 44px touch target from its halo,
 * #346, so a phone's toolbar row holds them beside the rest — the user's
 * ruling, #1193), and under them the latest error in `fg.danger`. While a
 * Save is out, and until its saved state is read back, Save holds the live dot
 * in place of its tick, at full strength in `fg` over its disabled look (#1573,
 * `aria-busy`). Each square's icon stands at its middle on whole pixels — the
 * `iconButton` recipe's 14px glyph in its 28px square, Save's tick and its
 * chevron moved up by what Font Awesome draws them below their boxes' middles.
 * First among
 * the buttons, while a conflict waits, the conflicts button: the not-equal
 * icon in `--warn` and how many wait in mono 11/600 in its text step, at its
 * neighbours' height, on the third paper while its popover is open
 * (`editConflicts` draws the popover's body). A host that
 * shows the error in its banners instead (`SessionBanners`) lists an Apply's
 * issues there, one to a line. Where its builder keeps a choice of an
 * automatic Save, Save is a split button: Save, then a chevron at its
 * neighbours' height, 16 wide, one `--r-sm` box of two parts, the edge between
 * them the chevron's — and the bar is no wider for it: its five squares stand
 * 4 apart in place of 8, as a phone's do, the chevron taking what that leaves
 * (12 wide where the bar is its buttons alone, a gap fewer), so a row holds
 * what it held. On a touch screen each square, and the chevron, takes its
 * target's height alone, as the segments of a strip do (#1221), so none takes
 * a tap meant for the one beside it; the
 * chevron in `--brand` while the choice is on and on the
 * third paper while its panel is open. The panel's body (pad 12, gap 8) is one
 * row — the word Autosave and, at its end, the theme's switch; the row its
 * target, 32 tall, 44 under a touch pointer (ruled 11 Nov 2026: one switch,
 * never a pair of choices to read) — and, while an optimiser's result waits
 * for a person's Save, a line with the Elara edge at its start saying so; the
 * split button then wears the Elara ring and glow as one outline, around Save
 * and its chevron together, at the pair's own corners.
 *
 * In a phone's frame (`data-history-form=phone`, the toolbar's second row,
 * `Mobile Builder Frame Spec.md` FR6): the row's width, the drafts' count at
 * its start (`No changes` mono 11 `fg.subtle`, or a `brandTint` chip mono
 * 11/600 in `brandPressed`), shown whole or not at all, then 44px outline squares with a 16px icon, Save
 * filled `brand.solid` while it would save and a live dot in its place while
 * one is out — five squares whatever waits: a conflict has no button of its
 * own there, the Issues square counting it and opening it; Save's chevron a
 * square of the row on Save's edge, the pair one
 * `--r-md` box — there where the row holds the six squares whole
 * ({@link ROW_HOLDS}: from a 308px frame, 356 with the eye), the count
 * giving way to them until the row holds it too ({@link ROW_COUNTS}: 338,
 * 386) (ruled 11 Nov 2026: the buttons themselves wherever they fit). Short
 * of the six there is no room for a sixth square of any kind: the chevron is
 * not there, Save is a whole square, and More — the ellipsis, in `--brand`
 * while Autosave is on, as the chevron is — stands in Discard's place, the
 * row its five squares: it holds the two, the Autosave switch and Discard
 * changes, a 44 button the panel's width under the switch;
 * Discard's question in the band under the row (FR8, ruled 4 Nov
 * 2026): `--paper-2` over a `--rule-strong`, padded 12 16 16, its eyebrow mono
 * caps, its title DM Sans 20/700, its body 13 `--ink-2`, Cancel and Discard
 * changes equal 44 halves; Discard on the third paper while it asks.
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { wholeOrNone } from "../../style/whole-or-none.js";
import { ELARA_RING } from "../elara-ring.js";

/** A square of a phone's second row, and the gap between the row's items, in px (FR6: the designer's measures). */
const SQUARE = 44;
const GAP = 4;

/** A phone's second row, as `BuilderFrame` marks it: the container its items ask its width (`session-row`). */
const ROW = "[data-frame-slot=sessionRow]";
/** The Elara eye, while it stands in the row (from a 312px frame up, R4). */
const EYE = "[data-optimise-button]";

/**
 * The room a phone's row leaves its count at its narrowest (FR6: a 294px frame, its content less the five squares and
 * their gaps): a count of two figures as its chip, whole (the hand test's rule — the number shows in the room the row
 * leaves, the noun going whole).
 */
const COUNT_ROOM = 26;

/**
 * What of a phone's row its six squares take: the five, a gap between each and the next, and Save's chevron on Save's
 * edge.
 */
const SIX = 5 * SQUARE + 4 * GAP + SQUARE;
/** What the row takes with its count shown before them: the count's room, and its gap. */
const COUNTED = COUNT_ROOM + GAP + SIX;
/** The eye's square and its gap. */
const EYE_ROOM = SQUARE + GAP;

/** A phone's row with the Elara eye in it, and one without. */
const ROWS = [`${ROW}:not(:has(${EYE}))`, `${ROW}:has(${EYE})`] as const;

/**
 * Where a phone's row holds Save's chevron whole (ruled 11 Nov 2026: the buttons themselves wherever they fit, the
 * count giving way to them): each state of the row — with the eye or without; a conflict waiting adds no square, its
 * Issues square opening it — and the width of its content from which the six squares stand in it. So the chevron joins
 * a row without the eye from a 308px frame, one with it from 356px, and a builder with an eye never holds it at a width
 * narrower than one it does not. Short of that the row has no room for a sixth square of any kind: the chevron is not
 * there, Save is a whole square, and More stands in Discard's place, holding the two — the Autosave switch within reach
 * at every width.
 */
const ROW_HOLDS: readonly (readonly [row: string, from: number])[] = [
    [ROWS[0], SIX],
    [ROWS[1], SIX + EYE_ROOM],
];

/**
 * Where a phone's row holds its count beside the six squares: from a 338px frame, 386px with the eye. Between the two
 * widths ({@link ROW_HOLDS}) the six squares stand and the count draws nothing.
 */
const ROW_COUNTS: readonly (readonly [row: string, from: number])[] = [
    [ROWS[0], COUNTED],
    [ROWS[1], COUNTED + EYE_ROOM],
];

/**
 * Styles a part of a phone's bar takes where its row is short of Save's chevron ({@link ROW_HOLDS}): the exact other
 * side of the width the chevron stands from. What a part takes where the row holds the chevron is its own style, so a
 * page that asks no row its width — the bar outside a frame — draws the buttons themselves.
 *
 * @param part - The part, as a selector under the phone's bar, ending at the slot's own element (`&`)
 * @param styles - What it takes there
 * @returns The fragment a slot spreads
 */
function whereRowIsShort(part: string, styles: Record<string, string>): Record<string, Record<string, Record<string, string>>> {
    return Object.fromEntries(ROW_HOLDS.map(([row, from]) => [`${row} [data-history-form=phone] ${part}`, { [`@container session-row not (min-width: ${from}px)`]: styles }]));
}

/**
 * Styles a part of a phone's bar with a split Save takes where its row holds the six squares and is short of its count
 * beside them (between {@link ROW_HOLDS} and {@link ROW_COUNTS}).
 *
 * @param part - The part, as a selector under the phone's bar, ending at the slot's own element (`&`)
 * @param styles - What it takes there
 * @returns The fragment a slot spreads
 */
function whereRowHoldsNoCount(part: string, styles: Record<string, string>): Record<string, Record<string, Record<string, string>>> {
    return Object.fromEntries(ROW_HOLDS.map(([row, from], i) => [
        `${row} [data-history-form=phone]:has([data-history-save]) ${part}`,
        { [`@container session-row (min-width: ${from}px) and (not (min-width: ${ROW_COUNTS[i]![1]}px))`]: styles },
    ]));
}

/**
 * A bar in a toolbar's row whose Save is split, as its root says it: where its squares stand closer, to hold the
 * chevron in the width it had. A phone's second row has measures of its own.
 */
const SPLIT = "[data-slot=history]:not([data-history-form=phone]):has([data-history-save])";

/** Save beside its chevron: its end square, the edge between them the chevron's. */
const JOINED = { borderTopRightRadius: "0", borderBottomRightRadius: "0", borderRightWidth: "0" };

export const editHistorySlotRecipe = defineSlotRecipe({
    className: "elara-edit-history",
    slots: ["root", "actions", "status", "button", "issues", "conflicts", "conflictsCount", "error", "notice", "bannerIssues", "bannerIssue",
        "summary", "changes", "live", "issuesCount", "ask", "askHead", "askTitle", "askBody", "askActions", "askButton",
        "save", "saveMore", "more", "fits", "autosave", "autosaveSwitch", "autosaveHeld"],
    base: {
        root: {
            flexShrink: "0",
            padding: "0",
            background: "transparent",
            /* A phone's: no box of its own, its parts the session row's items, so the count leads the row and the eye
             * listed before the history sits before Issues (R4). */
            "&[data-history-form=phone]": { display: "contents" },
        },
        actions: {
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            flexWrap: "nowrap",
            gap: "{spacing.2}",
            /* With the split Save the squares stand 4 apart: the chevron takes the width that leaves, and the bar none. */
            "&:has([data-history-save])": { gap: "{spacing.1}" },
            "[data-history-form=phone] > &": { display: "contents" },
        },
        status: {
            flex: "none",
            whiteSpace: "nowrap",
            fontFamily: "mono",
            fontSize: "label.lg",
            color: "fg.muted",
            // Its words keep their 8 before the squares.
            [`${SPLIT} &`]: { marginInlineEnd: "{spacing.1}" },
        },
        button: {
            flexShrink: "0",
            /* A phone's (the designer's `WorkOrdersPhone`): 44px squares on `--r-md`, `--rule-strong` and ink while they act,
             * `--rule` and `--ink-5` while they don't, never faded; Save `--brand-d` while it would save. */
            "[data-history-form=phone] &": {
                width: "44px", height: "44px", minWidth: "44px", padding: "0", borderRadius: "md", borderWidth: "1px",
                "&:has([data-history-issues])": { width: "auto", paddingX: "6px" },
                borderColor: "border.strong", background: "bg.surface", color: "fg", "& svg": { fontSize: "16px" },
                "&:disabled, &[aria-disabled=true]": { borderColor: "border.subtle", color: "fg.faint", opacity: 1 },
                // Save while a Save is out or read back (#1573): acting, not off.
                "&[aria-busy=true], &[aria-busy=true]:disabled": { borderColor: "border.strong", color: "fg", cursor: "progress" },
                "&[data-ready]": { background: "brand.solid", borderColor: "brand.solid", color: "brand.contrast" },
                "&[aria-expanded=true]": { background: "bg.subtle" },
            },
            /* In a bar with the split Save the squares stand 4 apart: each takes its touch target's height alone, so none's
             * halo takes a tap meant for the square beside it (#1221). */
            [`${SPLIT} &`]: { _coarse: { _before: { width: "100%" } } },
            /* Save beside its chevron in a phone's frame: the start of the pair's one box where the row holds the chevron (the
             * `save` slot's), a whole square where it is short of it. */
            ...whereRowIsShort("[data-history-save] > :first-child &", { borderTopRightRadius: "{radii.md}", borderBottomRightRadius: "{radii.md}", borderRightWidth: "1px" }),
            /* Save's tick at its square's middle: Font Awesome draws it a thirty-second of its box below the box's middle —
             * half a pixel at these sizes, which read as a tick a pixel low beside a cross drawn dead centre — so it stands
             * that much higher. */
            "& svg[data-icon=check]": { transform: "translateY(-0.03125em)" },
            // Locked while a run of the app's optimiser is out (#1409, R2): the disabled look, the control kept.
            "&[aria-disabled=true]": { color: "fg.muted", cursor: "not-allowed", opacity: 0.5 },
            // Save while a Save is out or its saved state is read back (#1573): the live dot at full strength over the
            // disabled look — working, not off.
            "&[aria-busy=true], &[aria-busy=true]:disabled": { color: "fg", cursor: "progress", opacity: 1 },
        },
        /* Save with its builder's choice of an automatic Save: Save, then the chevron, one box of two parts. */
        save: {
            display: "inline-flex",
            alignItems: "stretch",
            flexShrink: "0",
            "& > :first-child button": JOINED,
            // Save's focus stands over the chevron's edge, never under it.
            "& > :first-child": { position: "relative", zIndex: 1 },
            /* While an optimiser's result waits for a person's Save, the automatic Save on: the Elara ring and glow around
             * the pair — Save and its chevron one outline (ruled 11 Nov 2026), never Save's part alone — at the pair's own
             * corners: the bar's squares', a phone's in its row. Short of its chevron, a phone's Save is the whole box. */
            borderRadius: "sm",
            "[data-history-form=phone] &": { borderRadius: "md" },
            "&:has([data-held])": { boxShadow: ELARA_RING },
        },
        saveMore: {
            flexShrink: "0",
            width: "16px",
            minWidth: "16px",
            paddingX: "0",
            borderTopLeftRadius: "0",
            borderBottomLeftRadius: "0",
            color: "fg.muted",
            /* The design system's caret, 8: Font Awesome draws its chevron a sixteenth of its box below the box's middle, so
             * it stands that much higher — at 8px the half pixel that puts its four pixels of ink on whole pixels at the
             * square's middle; a phone's, at 12, its six. */
            "& svg": { fontSize: "8px", transform: "translateY(-0.0625em)" },
            /* The bar its buttons alone has a gap fewer to give it. */
            "[data-history-form=buttons] &": { width: "12px", minWidth: "12px" },
            "&[data-on]": { color: "brandMark" },
            "&[data-state=open], &[aria-expanded=true]": { background: "bg.subtle" },
            "&:focus-visible": { position: "relative", zIndex: 2 },
            /* A phone's: a square of its row on Save's edge, the row's own rule and paper. */
            "[data-history-form=phone] &": {
                width: `${SQUARE}px`, minWidth: `${SQUARE}px`, height: `${SQUARE}px`,
                borderTopLeftRadius: "0", borderBottomLeftRadius: "0", borderTopRightRadius: "md", borderBottomRightRadius: "md",
                "& svg": { fontSize: "12px" },
                "&[data-on]": { color: "brandMark" },
            },
            /* In a phone's frame, in the row where the row holds it whole; short of it, not there — More holds its switch. */
            ...whereRowIsShort("&", { display: "none" }),
        },
        /* A phone's More: a square of the row in Discard's place where the row is short of Discard and Save's chevron both,
         * nowhere else; its ellipsis in the brand's mark while the automatic Save is on, as the chevron is. */
        more: {
            display: "none",
            ...whereRowIsShort("&", { display: "inline-flex" }),
            "[data-history-form=phone] &": { "&[data-on]": { color: "brandMark" } },
        },
        /* A phone's Discard beside a More: in the row where the row holds it and the chevron both; short of them, More's. */
        fits: {
            flexShrink: "0",
            ...whereRowIsShort("&", { display: "none" }),
        },
        /* The automatic Save's panel: its switch, and why it waits. */
        autosave: { display: "flex", flexDirection: "column", gap: "{spacing.2}", padding: "12px" },
        /* The one row, the theme's switch: its word at the row's start, the switch at its end, the row the target. */
        autosaveSwitch: {
            display: "flex",
            justifyContent: "space-between",
            width: "100%",
            minHeight: "32px",
            _coarse: { minHeight: "44px" },
        },
        autosaveHeld: {
            paddingInlineStart: "{spacing.2}",
            borderInlineStartWidth: "2px",
            borderInlineStartColor: "elara.edge",
            fontSize: "{fontSizes.body.sm}",
            lineHeight: "{lineHeights.normal}",
            color: "fg.strong",
        },
        issues: {
            display: "flex",
            flexShrink: "0",
            // With none, hidden in its slot, which is held (#1398, CL1): the bar keeps its width as issues come and go.
            "&[data-empty]": { visibility: "hidden" },
            // Beside the issues, the warnings, which hold no Save (#1585): the icon in the warn tone.
            "&[data-warnings] svg": { color: "status.warn" },
        },
        conflicts: {
            width: "auto",
            minWidth: "28px",
            paddingX: "{spacing.2}",
            gap: "{spacing.2}",
            "& svg": { color: "status.warn", fontSize: "14px" },
            // Every one chosen, its popover still open: the icon alone, in the ink of a settled control.
            "&[data-settled] svg": { color: "fg.muted" },
            "&[data-state=open], &[aria-expanded=true]": { background: "bg.subtle" },
            // It keeps its 8 before the squares.
            [`${SPLIT} &`]: { marginInlineEnd: "{spacing.1}" },
        },
        conflictsCount: { fontFamily: "mono", fontSize: "11px", fontWeight: "semibold", color: "fg.warning", fontVariantNumeric: "tabular-nums" },
        error: {
            marginTop: "{spacing.2}",
            fontSize: "body.sm",
            color: "fg.danger",
        },
        /* What the bar says of drafts a reload would lose, or could not restore, where it says its error. */
        notice: {
            marginTop: "{spacing.2}",
            fontSize: "body.sm",
            color: "fg.warning",
        },
        /* A phone's row: what a Save is doing, else the drafts' count, taking what the buttons leave — whole, or, where
         * they leave too little, a Save's words not at all and the count its number alone. */
        summary: {
            order: -1, flex: "1 1 auto", minWidth: "0", ...wholeOrNone("24px"),
            /* Where the row holds the six squares and is short of its count beside them, the count gives way (ruled 11 Nov
             * 2026): a pixel wide, so every word of it wraps under the clip, whole, as one too wide for its box does, and
             * still read to whoever hears the page; drawn back by its pixel and its gap, so it takes none of the row — the
             * squares' own width fits a 308px frame — and the row's spare room stands before the squares, as its count's
             * does. */
            ...whereRowHoldsNoCount("&", { flex: "none", width: "1px", marginInlineStart: `-${GAP + 1}px`, marginInlineEnd: "auto" }),
        },
        changes: {
            fontFamily: "mono", fontSize: "label.lg", fontWeight: "500", color: "fg.subtle", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
            /* Each word whole or gone, the number first, so a row with little room still counts: `1 change`, then `1`. The
             * number is the box's first item, on its one line however narrow the box, so it has no line-holder before it to
             * wrap away from, and the gap is the noun's: a gap between items sent the `1` under the clip in a 26px box. */
            /* The chip itself whole or gone: no narrower than its number and its padding — the figures its count says it
             * holds — so in a box short of that it wraps under the row's clip, whole, never a number cut by it. */
            "&[data-changes]": {
                ...wholeOrNone("24px"), "&::before": { display: "none" }, lineHeight: "24px", maxWidth: "100%",
                minWidth: "calc(var(--history-figures, 1) * 1ch + 2 * {spacing.1.5})", boxSizing: "border-box", paddingX: "{spacing.1.5}", borderRadius: "sm",
                background: "brandTint", color: "brandPressed", fontWeight: "600",
                "& [data-changes-noun]": { marginInlineStart: "0.6ch" },
            },
        },
        /* A phone's Issues while any stands (FR6.3, QP6): `--warn`, then the count in mono 11/600. */
        issuesCount: {
            display: "inline-flex", alignItems: "center", gap: "2px", fontFamily: "mono", fontSize: "11px", fontWeight: "600", color: "fg.warning",
            "& svg": { color: "status.warn" },
        },
        /* Save's live dot while it is out: an echo of the dot. */
        live: {
            position: "relative", width: "8px", height: "8px", borderRadius: "full", background: "currentColor",
            "&::after": {
                content: '""', position: "absolute", inset: "0", borderRadius: "full", background: "currentColor",
                animation: "elara-live-pulse calc({durations.slow} * 4) {easings.out} infinite",
                _motionReduce: { animation: "none" },
            },
        },
        ask: {
            display: "flex", flexDirection: "column", gap: "{spacing.2}", paddingTop: "12px", paddingX: "16px", paddingBottom: "16px",
            background: "bg.canvas", borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: "border.strong",
        },
        askHead: { fontFamily: "mono", fontSize: "label.sm", fontWeight: "600", letterSpacing: "0.14em", textTransform: "uppercase", color: "fg.subtle" },
        askTitle: { fontFamily: "heading", fontSize: "title.lg", fontWeight: "700", letterSpacing: "-0.015em", color: "fg", lineHeight: "1.2" },
        askBody: { fontSize: "body", color: "fg.strong", lineHeight: "1.5" },
        askActions: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "{spacing.2}", marginTop: "{spacing.1}" },
        askButton: { minHeight: "44px", width: "100%" },
        /* An Apply's issues in a banner's body: one to a line, unmarked. */
        bannerIssues: {
            display: "flex",
            flexDirection: "column",
            gap: "{spacing.1}",
            margin: "0",
            padding: "0",
            listStyle: "none",
        },
        bannerIssue: {
            minWidth: "0",
            overflowWrap: "anywhere",
        },
    },
});
