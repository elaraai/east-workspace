/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The shared loading parts' slot recipe (#1398; the design of record's
 * `docs/proposals/loading-1398/guidelines/cards/loading-parts.css`, in the
 * theme's tokens): the unloaded run (`collections/loading/unloaded-run.tsx`)
 * and its placeholder shapes, the region wash, a failure said in place — the
 * failed line a row grid holds, and the message box of a region with no row
 * to hold one — and the placeholder card of the narrow layouts.
 *
 *   - run / row / cell: the run's box, the rows drawn where it meets the view,
 *     and their cells — a host's own row and cell styles merge over them, so a
 *     placeholder row keeps the host's real rules, columns and gutter.
 *   - number: a flat sheet's real row number, as the gutter sets it.
 *   - bar / chip / box / dot / count / arrow / pair / stack / check: the
 *     placeholder shapes — the Skeleton's static `--paper-3`, square-ended
 *     bars (12 for a body value, 8 for a label or meta line, 24 for a large
 *     number), the Chip's rect (22, 15 dense) at `--r-sm`, the Checkbox's 14
 *     at 3px, an 8px dot, the Count's 24 × 16 rect. Each bar's and chip's
 *     length is its kind's (`data-length`), a share of its cell with a px
 *     cap; a text bar's and a label's are keyed to their row by the part's
 *     `--placeholder-share`, so the pattern never crawls. Nothing in them
 *     moves. Inside a builder's `LoadingReveal` each is unseen, at its
 *     footprint, until the reveal says so (`data-unrevealed`, CL4).
 *   - fill: its host's own box, filled — its host's size and corners, a card's
 *     meter track or a status's dot, which the host gives no fill of its own
 *     while it holds one.
 *   - band / chevron: a grouped run's band, its chevron real.
 *   - wash: the region wash, `--ink` at 6% over a region whose items have no
 *     known position yet — under the real rules, shading and the now line,
 *     which draw after it.
 *   - failedLine / failedIcon / failedMessage: a failure said once, in a row:
 *     `circle-exclamation` 14 `--neg`, the reason 13 `--ink`, then Retry.
 *   - failedBox: the same, where no row can hold a line — the Schematic's
 *     message box, `--paper`, a 1px `--rule-strong` edge, `--r-md`, 8 12.
 *   - emptyLine / emptyLead / emptyIcon / emptyHint: a region its read found
 *     empty, in the failed line's slot and shape: the Empty state's glyph 14
 *     `--rule-strong`, the words 13 `--ink`, and the hint after them on the
 *     same one line where it fits whole — else it wraps to a second line the
 *     line's height clips, so it drops whole and is still heard.
 *   - card / cardBody / cardHead / cardTitle / cardMeta: the Item card at a
 *     kind's height, a title bar in its 20px title line and a meta bar in its
 *     16px meta line.
 *
 * The retained treatment is not a slot: {@link retainedRow} and
 * {@link retainedColumn} are parts a builder merges into its own rows' and
 * cells' slots under its main's stale mark; nor is a toolbar's held slot,
 * {@link heldToolbarSlot}, which a builder takes as a slot of its own.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { fontAwesomeSize } from "../icon-size.js";

/**
 * A shape not yet revealed (CL4): inside a builder's `LoadingReveal`, kept at
 * its footprint, unseen, until the reveal says so — the shape marks itself.
 */
const UNREVEALED = { "&[data-unrevealed]": { visibility: "hidden" } } as const;

/** The placeholder fill: the Skeleton's static `--paper-3`. */
const FILL = { background: "bg.subtle", ...UNREVEALED } as const;

/**
 * Retained rows (#1398, the Row card's stale): what a row kept on screen
 * through a narrowing or a revision's re-read wears — its row rules dashed
 * `--rule-strong` and its text `--ink-3`, every part of it. A builder merges it
 * into its row's (or a row's cells') slot under its main's stale mark (the
 * Roster's `[data-roster-stale] &`), and its main is retained while the rows
 * stand in (CL8, the loading design's stale card): `aria-disabled` — readable,
 * focusable and selectable, its selection kept, every edit and drag refused in
 * code (`dnd/retained.ts`), never `inert`. Item edges keep their own
 * meaning: a chip's or a card's border is its own. Each side is set on its own:
 * the theme resolves a colour token on a side's own property, never on the
 * `borderBlockColor` shorthand.
 */
export const retainedRow = {
    borderBlockStartStyle: "dashed",
    borderBlockEndStyle: "dashed",
    borderBlockStartColor: "border.strong",
    borderBlockEndColor: "border.strong",
    color: "fg.muted",
    "& *": { color: "inherit" },
} satisfies SystemStyleObject;

/**
 * Retained columns (#1398): a grid's column kept on screen — a time grid's day
 * column, a resource column — its column rules dashed `--rule-strong` and its
 * text `--ink-3`, merged as {@link retainedRow} is.
 */
export const retainedColumn = {
    borderInlineStartStyle: "dashed",
    borderInlineEndStyle: "dashed",
    borderInlineStartColor: "border.strong",
    borderInlineEndColor: "border.strong",
    color: "fg.muted",
    "& *": { color: "inherit" },
} satisfies SystemStyleObject;

/**
 * A toolbar slot held from cold load (#1398, CL1): the status, the issues and
 * Publish keep their places while what fills them is unread, or empty, so the
 * toolbar never shifts nor folds again as the period lands. Unread, it holds
 * its placeholder — kept at its footprint and unseen until the reveal says so
 * (the shape's own `data-unrevealed`); at no issues, nothing, at its least
 * size. The Roster's and the Allocation's toolbars take it as a slot of their
 * own.
 */
export const heldToolbarSlot = {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    minWidth: "24px",
    minHeight: "24px",
} satisfies SystemStyleObject;

export const loadingSlotRecipe = defineSlotRecipe({
    className: "elara-loading",
    slots: [
        "run", "row", "cell", "number", "bar", "chip", "box", "dot", "count", "arrow", "pair", "stack", "check", "fill", "band", "chevron",
        "wash", "failedLine", "failedIcon", "failedMessage", "failedBox", "emptyLine", "emptyLead", "emptyIcon", "emptyHint",
        "card", "cardBody", "cardHead", "cardTitle", "cardMeta",
    ],
    base: {
        // A row the run's end cuts short is clipped there — clipped, never scrolled: a box that hides its overflow is
        // its contents' scroll container, and a sticky gutter in a row would stick to the run, never to the frame.
        run: {
            position: "relative",
            width: "100%",
            overflow: "clip",
        },
        row: {
            position: "absolute",
            insetInlineStart: "0",
            insetInlineEnd: "0",
            boxSizing: "border-box",
            display: "grid",
            alignItems: "stretch",
        },
        cell: {
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            minWidth: "0",
            overflow: "hidden",
            whiteSpace: "nowrap",
            "&[data-align=end]": { justifyContent: "flex-end" },
            "&[data-align=center]": { justifyContent: "center" },
        },
        number: {
            fontFamily: "mono",
            fontSize: "{fontSizes.label.sm}",
            fontWeight: "medium",
            fontVariantNumeric: "tabular-nums",
            color: "fg.subtle",
        },
        bar: {
            ...FILL,
            display: "block",
            flex: "none",
            height: "12px",
            maxWidth: "100%",
            "&[data-size=label]": { height: "8px" },
            "&[data-size=large]": { height: "24px" },
            // Each kind's length: a share of its cell with a px cap — a text bar's and a label's keyed to its row.
            "&[data-length=text], &[data-length=label]": { width: "calc(min(96px, 80%) * var(--placeholder-share, 1))" },
            "&[data-length=sub]": { width: "calc(min(56px, 50%) * var(--placeholder-share, 1))" },
            "&[data-length=number], &[data-length=enum]": { width: "min(40px, 60%)" },
            "&[data-length=date]": { width: "min(64px, 80%)" },
            "&[data-length=aggregate]": { width: "min(48px, 60%)" },
            "&[data-length=rowNumber]": { width: "min(24px, 60%)" },
        },
        chip: {
            ...FILL,
            display: "block",
            flex: "none",
            width: "min(48px, 90%)",
            height: "22px",
            maxWidth: "100%",
            borderRadius: "sm",
            "[data-dense] &": { height: "15px" },
            // Either side of a link's arrow: each half's.
            "&[data-length=link]": { width: "min(40px, 40%)" },
        },
        box: { ...FILL, display: "block", flex: "none", width: "14px", height: "14px", borderRadius: "xs" },
        dot: { ...FILL, display: "block", flex: "none", width: "8px", height: "8px", borderRadius: "full" },
        count: { ...FILL, display: "block", flex: "none", width: "24px", height: "16px", borderRadius: "sm" },
        arrow: { flex: "none", fontFamily: "mono", fontSize: "{fontSizes.label.md}", color: "fg.subtle" },
        pair: { display: "inline-flex", alignItems: "center", gap: "{spacing.1}", minWidth: "0", maxWidth: "100%", ...UNREVEALED },
        stack: { display: "grid", gap: "{spacing.1}", minWidth: "0", width: "100%", ...UNREVEALED },
        // Its host's own box: its size and its corners, filled.
        fill: { ...FILL, display: "block", width: "100%", height: "100%", borderRadius: "inherit" },
        check: {
            display: "block",
            flex: "none",
            width: "14px",
            height: "14px",
            boxSizing: "border-box",
            borderRadius: "xs",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "border.subtle",
            background: "transparent",
        },
        band: {
            gridColumn: "1 / -1",
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            minWidth: "0",
            paddingInline: "{spacing.2}",
        },
        chevron: {
            ...fontAwesomeSize("10px"),
            flex: "none",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "fg.muted",
            transform: "rotate(90deg)",
        },
        wash: {
            position: "absolute",
            inset: "0",
            pointerEvents: "none",
            background: "color-mix(in oklch, {colors.fg} 6%, transparent)",
            ...UNREVEALED,
        },
        failedLine: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            minWidth: "0",
            // Its Retry keeps its words whole, however little room the reason leaves.
            "& > [data-loading-retry]": { flex: "none" },
        },
        failedIcon: {
            ...fontAwesomeSize("14px"),
            flex: "none",
            color: "status.neg",
        },
        failedMessage: {
            minWidth: "0",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: "body",
            fontSize: "{fontSizes.body}",
            fontVariantNumeric: "tabular-nums",
            color: "fg",
        },
        failedBox: {
            position: "absolute",
            zIndex: "4",
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            maxWidth: "calc(100% - {spacing.4})",
            boxSizing: "border-box",
            paddingBlock: "{spacing.2}",
            paddingInline: "{spacing.3}",
            background: "bg.surface",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "border.strong",
            borderRadius: "md",
            "& > [data-loading-retry]": { flex: "none" },
        },
        // One line high, its words and its hint flex items that wrap: a hint the line has no room for goes whole to a
        // second line the height clips — never cut, still heard. The words alone end in an ellipsis before they wrap.
        emptyLine: {
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            alignContent: "flex-start",
            columnGap: "{spacing.1}",
            minWidth: "0",
            height: "20px",
            lineHeight: "20px",
            overflow: "hidden",
        },
        emptyLead: { flex: "0 1 auto", display: "flex", alignItems: "center", gap: "{spacing.2}", minWidth: "0", height: "20px" },
        emptyIcon: {
            ...fontAwesomeSize("14px"),
            flex: "none",
            color: "border.strong",
        },
        emptyHint: {
            flex: "none",
            height: "20px",
            whiteSpace: "nowrap",
            fontFamily: "body",
            fontSize: "{fontSizes.body}",
            color: "fg",
        },
        card: {
            boxSizing: "border-box",
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr)",
            minWidth: "0",
            background: "bg.surface",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "border.strong",
            borderRadius: "md",
        },
        cardBody: {
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr)",
            alignContent: "start",
            gap: "{spacing.2}",
            padding: "{spacing.3}",
            minWidth: "0",
        },
        cardHead: { display: "grid", gap: "{spacing.1}", minWidth: "0" },
        cardTitle: {
            height: "20px",
            display: "flex",
            alignItems: "center",
            minWidth: "0",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: "heading",
            fontSize: "{fontSizes.title.xs}",
            fontWeight: "semibold",
            letterSpacing: "snug",
            lineHeight: "20px",
            color: "fg",
        },
        cardMeta: { height: "16px", display: "flex", alignItems: "center", minWidth: "0" },
    },
});
