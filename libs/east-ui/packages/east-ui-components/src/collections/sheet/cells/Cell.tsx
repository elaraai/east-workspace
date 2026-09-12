/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * One read-only cell by kind (B§11): text · mono (date, stamped) · num + unit
 * (quantity, integer) · enum dot + word · the split link cell (`LinkCell`)
 * · a custom kind's `print`. A ghost (a pending fill, P4) draws in
 * `fg.subtle` over the brand hatch; the next Tab target carries the dotted
 * underline.
 */

import { memo } from "react";
import { Box } from "@chakra-ui/react";
import { getSomeorUndefined } from "../../../utils.js";
import { EMPTY_LINK, cellIsBlank, cellText, memberIsDashed, memberLabel, type SheetColumnMeta } from "../model.js";
import { LinkCell } from "./LinkCell.js";
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
    driverName: string;
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
}

/** Renders a cell's content. */
export const SheetCellContent = memo(function SheetCellContent({ styles, meta, cell, rowBlank, unit, member, ghost, link }: SheetCellContentProps) {
    const blank = cellIsBlank(cell);
    const shown = blank && ghost !== undefined ? ghost : cell;
    const isGhost = blank && ghost !== undefined;
    switch (meta.kind) {
        case "date":
        case "stamped": {
            if (cellIsBlank(shown)) {
                return meta.kind === "stamped" && !rowBlank ? <Box as="span" css={styles.cellGhost}>—</Box> : null;
            }
            return <Box as="span" css={isGhost ? styles.cellGhost : styles.cellMono} data-mono="">{cellText(shown, meta)}</Box>;
        }
        case "quantity":
        case "integer": {
            if (cellIsBlank(shown)) return null;
            return (
                <>
                    <Box as="span" css={isGhost ? styles.cellGhost : styles.cellNum} data-num="">{cellText(shown, meta)}</Box>
                    {unit !== undefined && <Box as="span" css={styles.cellUnit}>{unit}</Box>}
                </>
            );
        }
        case "enum": {
            if (cellIsBlank(shown)) return rowBlank ? null : <Box as="span" css={styles.cellGhost}>—</Box>;
            const tone = member !== undefined ? getSomeorUndefined(member.tone)?.type : undefined;
            if (isGhost) return <Box as="span" css={styles.cellGhost}>{cellText(shown, meta)}</Box>;
            return (
                <>
                    <Box as="span" css={styles.cellDot} data-tone={tone} />
                    <Box as="span" css={styles.cellWord}>{cellText(shown, meta)}</Box>
                </>
            );
        }
        case "set": {
            if (shown === undefined || shown.type !== "Link") {
                if (shown !== undefined && !cellIsBlank(shown)) return <Box as="span" css={styles.cellText}>{cellText(shown, meta)}</Box>;
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
                return <Box as="span" css={styles.cellText}>{cellText(shown, meta)}</Box>;
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
            return <Box as="span" css={isGhost ? styles.cellGhost : styles.cellText}>{cellText(shown, meta)}</Box>;
        }
    }
});
