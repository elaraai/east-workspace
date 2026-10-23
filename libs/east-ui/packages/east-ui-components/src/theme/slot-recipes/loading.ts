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
 *     at 3px, an 8px dot, the Count's 24 × 16 rect. Nothing in them moves.
 *   - band / chevron: a grouped run's band, its chevron real.
 *   - wash: the region wash, `--ink` at 6% over a region whose items have no
 *     known position yet — under the real rules, shading and the now line,
 *     which draw after it.
 *   - failedLine / failedIcon / failedMessage: a failure said once, in a row:
 *     `circle-exclamation` 14 `--neg`, the reason 13 `--ink`, then Retry.
 *   - failedBox: the same, where no row can hold a line — the Schematic's
 *     message box, `--paper`, a 1px `--rule-strong` edge, `--r-md`, 8 12.
 *   - card / cardBody / cardHead / cardTitle / cardMeta: the Item card at a
 *     kind's height, a title bar in its 20px title line and a meta bar in its
 *     16px meta line.
 *
 * The retained treatment is not a slot: {@link retainedRow} and
 * {@link retainedColumn} are parts a builder merges into its own rows' and
 * cells' recipes under `&[data-retained]`.
 *
 * @packageDocumentation
 */

import { defineSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { fontAwesomeSize } from "../icon-size.js";

/** The placeholder fill: the Skeleton's static `--paper-3`. */
const FILL = { background: "bg.subtle" } as const;

/**
 * Retained rows (#1398, the Row card's stale): what a row kept on screen
 * through a narrowing or a revision's re-read wears — its row rules dashed
 * `--rule-strong` and its text `--ink-3`, every part of it. A builder merges it
 * into its row's (or a row's cells') recipe under `&[data-retained]`, and
 * turns its editing off there (`aria-disabled`); selection is kept. Item edges
 * keep their own meaning: a chip's or a card's border is its own.
 */
export const retainedRow = {
    borderBlockStyle: "dashed",
    borderBlockColor: "border.strong",
    color: "fg.muted",
    "& *": { color: "inherit" },
} satisfies SystemStyleObject;

/**
 * Retained columns (#1398): a grid's column kept on screen — a time grid's day
 * column, a resource column — its column rules dashed `--rule-strong` and its
 * text `--ink-3`, merged as {@link retainedRow} is.
 */
export const retainedColumn = {
    borderInlineStyle: "dashed",
    borderInlineColor: "border.strong",
    color: "fg.muted",
    "& *": { color: "inherit" },
} satisfies SystemStyleObject;

export const loadingSlotRecipe = defineSlotRecipe({
    className: "elara-loading",
    slots: [
        "run", "row", "cell", "number", "bar", "chip", "box", "dot", "count", "arrow", "pair", "stack", "check", "band", "chevron",
        "wash", "failedLine", "failedIcon", "failedMessage", "failedBox", "card", "cardBody", "cardHead", "cardTitle", "cardMeta",
    ],
    base: {
        run: {
            position: "relative",
            width: "100%",
            overflow: "hidden",
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
        },
        chip: {
            ...FILL,
            display: "block",
            flex: "none",
            height: "22px",
            maxWidth: "100%",
            borderRadius: "sm",
            "[data-dense] &": { height: "15px" },
        },
        box: { ...FILL, display: "block", flex: "none", width: "14px", height: "14px", borderRadius: "xs" },
        dot: { ...FILL, display: "block", flex: "none", width: "8px", height: "8px", borderRadius: "full" },
        count: { ...FILL, display: "block", flex: "none", width: "24px", height: "16px", borderRadius: "sm" },
        arrow: { flex: "none", fontFamily: "mono", fontSize: "{fontSizes.label.md}", color: "fg.subtle" },
        pair: { display: "inline-flex", alignItems: "center", gap: "{spacing.1}", minWidth: "0", maxWidth: "100%" },
        stack: { display: "grid", gap: "{spacing.1}", minWidth: "0", width: "100%" },
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
        },
        failedLine: {
            display: "flex",
            alignItems: "center",
            gap: "{spacing.2}",
            minWidth: "0",
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
