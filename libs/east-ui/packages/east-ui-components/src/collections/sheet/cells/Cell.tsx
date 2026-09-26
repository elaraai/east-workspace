/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * One read-only cell by kind (B§11): text · mono (date, stamped) · num + unit
 * (quantity, integer) · enum dot + word · the split link cell (`LinkCell`)
 * · a custom kind's `print`. A date read at a level (#844) prints `dd/mm/yy`
 * (and its time at the time level) with the resolution as a tag; once its
 * actual is known it prints when the work happened instead, the tag saying
 * how that stands against the wanted date. A ghost (a pending fill, P4) draws in
 * `fg.subtle` over the brand hatch; the next Tab target carries the dotted
 * underline.
 */

import { memo } from "react";
import { Box } from "@chakra-ui/react";
import { getSomeorUndefined } from "../../../utils.js";
import { useSheetWords } from "../words.js";
import { EMPTY_LINK, cellIsBlank, cellText, memberIsDashed, memberLabel, type SheetColumnMeta } from "../model.js";
import { LinkCell } from "./LinkCell.js";
import { actualAgainst, formatWhen, type WhenLevel } from "../parse/date.js";
import type { LinkVocabulary } from "../link/grammar.js";
import type { LinkHalves } from "../link/sides.js";
import { NO_FLAGS, type LinkFlags } from "../link/checks.js";
import type { SheetCellValue, SheetRegisterMemberValue } from "../values.js";

type Styles = Record<string, Record<string, unknown>>;

/** What a link cell needs beyond its value. */
export interface LinkCellContext {
    halves: LinkHalves;
    vocab: LinkVocabulary | undefined;
    flags: LinkFlags;
    /** The row's driver member's name — `undefined` when it names none. */
    driverName: string | undefined;
}

export interface SheetCellContentProps {
    styles: Styles;
    meta: SheetColumnMeta;
    cell: SheetCellValue | undefined;
    /** Whether the row is blank — a stamped / enum column prints `—` only on a non-blank row. */
    rowBlank: boolean;
    /** The unit for a quantity cell (from the driver). */
    unit: string | undefined;
    /** The enum member the cell names, for its tone. */
    member: SheetRegisterMemberValue | undefined;
    /** A pending fill — drawn as a ghost when the cell is blank (P4). */
    ghost: SheetCellValue | undefined;
    /** The link cell's halves, vocabulary and flags. */
    link: LinkCellContext | undefined;
    /** A date cell's level for its row, and the actual instant once the work has happened (#844). */
    when?: { level: WhenLevel; actual?: Date | undefined } | undefined;
}

/** Renders a cell's content. */
export const SheetCellContent = memo(function SheetCellContent({ styles, meta, cell, rowBlank, unit, member, ghost, link, when }: SheetCellContentProps) {
    // Numbers in the viewer's language — the one its edit box reads back (#852) — and the sheet's words (#861).
    const words = useSheetWords();
    const blank = cellIsBlank(cell);
    const shown = blank && ghost !== undefined ? ghost : cell;
    const isGhost = blank && ghost !== undefined;
    if (shown?.type === "Invalid") return <Box as="span" css={styles.cellText} data-slot="cellText">{shown.value}</Box>;
    switch (meta.kind) {
        case "date":
        case "stamped": {
            // Once the work has happened the cell prints when, to the minute; the tag says how that stands against the wanted date.
            if (meta.kind === "date" && when?.actual !== undefined && !isGhost) {
                const a = formatWhen(when.actual, "time", words);
                const vs = shown?.type === "DateTime" ? actualAgainst(shown.value, when.level, when.actual, words)
                    : { tag: words.m.actualTag({ tone: "on", n: 0, count: words.number(0), unit: "d" }), tone: "on" as const };
                return (
                    <>
                        <Box as="span" css={styles.cellMono} data-mono="" data-actual="">{a.text}</Box>
                        <Box as="span" css={styles.cellRes} data-slot="whenRes" data-actual={vs.tone}>{vs.tag}</Box>
                    </>
                );
            }
            if (cellIsBlank(shown)) {
                return meta.kind === "stamped" && !rowBlank ? <Box as="span" css={styles.cellGhost}>—</Box> : null;
            }
            // At a level the date prints `dd/mm/yy` (its time at the time level) and the resolution as a tag at the cell's right edge.
            if (meta.kind === "date" && when !== undefined && shown?.type === "DateTime") {
                const w = formatWhen(shown.value, when.level, words);
                return (
                    <>
                        <Box as="span" css={isGhost ? styles.cellGhost : styles.cellMono} data-mono="" data-level={when.level}>{w.text}</Box>
                        <Box as="span" css={styles.cellRes} data-slot="whenRes" data-level={when.level}>{w.suffix}</Box>
                    </>
                );
            }
            return <Box as="span" css={isGhost ? styles.cellGhost : styles.cellMono} data-mono="">{cellText(shown, meta, words)}</Box>;
        }
        case "quantity":
        case "integer": {
            if (cellIsBlank(shown)) return null;
            return (
                <>
                    <Box as="span" css={isGhost ? styles.cellGhost : styles.cellNum} data-num="">{cellText(shown, meta, words)}</Box>
                    {unit !== undefined && <Box as="span" css={styles.cellUnit}>{unit}</Box>}
                </>
            );
        }
        case "enum": {
            if (cellIsBlank(shown)) return rowBlank ? null : <Box as="span" css={styles.cellGhost}>—</Box>;
            const tone = member !== undefined ? getSomeorUndefined(member.tone)?.type : undefined;
            if (isGhost) return <Box as="span" css={styles.cellGhost}>{cellText(shown, meta, words)}</Box>;
            return (
                <>
                    <Box as="span" css={styles.cellDot} data-tone={tone} />
                    <Box as="span" css={styles.cellWord}>{cellText(shown, meta, words)}</Box>
                </>
            );
        }
        case "set": {
            if (shown === undefined || shown.type !== "Link") {
                if (shown !== undefined && !cellIsBlank(shown)) return <Box as="span" css={styles.cellText}>{cellText(shown, meta, words)}</Box>;
                return null;
            }
            const set = shown.value;
            return (
                <Box css={styles.half} data-half="to" style={{ justifyContent: "flex-start" }}>
                    {set.to.map((m, i) => (
                        <Box key={i} as="span" css={memberIsDashed(m) || isGhost ? styles.chipDashed : styles.chip} data-slot="chip" data-member={m.type}>{memberLabel(m)}</Box>
                    ))}
                </Box>
            );
        }
        case "link": {
            // The two halves are always drawn once the row has content, so an
            // empty cell still says what it wants; blank rows stay blank.
            if (shown !== undefined && shown.type !== "Link" && !cellIsBlank(shown)) {
                return <Box as="span" css={styles.cellText}>{cellText(shown, meta, words)}</Box>;
            }
            if (rowBlank || link === undefined) return null;
            const value = shown !== undefined && shown.type === "Link" ? shown.value : EMPTY_LINK;
            return (
                <LinkCell
                    styles={styles}
                    link={value}
                    halves={link.halves}
                    vocab={link.vocab}
                    flags={isGhost ? NO_FLAGS : link.flags}
                    ghost={isGhost}
                    driverName={link.driverName}
                />
            );
        }
        default: {
            if (cellIsBlank(shown)) return null;
            return <Box as="span" css={isGhost ? styles.cellGhost : styles.cellText}>{cellText(shown, meta, words)}</Box>;
        }
    }
});
