/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * One read-only cell by kind (B§11): text · mono (date, stamped) · num + unit
 * (quantity, integer) · enum dot + word · a link's chips (the split cell
 * proper lands in P3; here the halves print as chips around the arrow) · a
 * custom kind's `print`. A ghost (a pending fill, P4) draws in `fg.subtle`
 * over the brand hatch; the next Tab target carries the dotted underline.
 */

import { memo } from "react";
import { Box } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRightLong, faMinus } from "@fortawesome/free-solid-svg-icons";
import { getSomeorUndefined } from "../../../utils.js";
import { cellIsBlank, cellText, memberIsDashed, memberLabel, type SheetColumnMeta } from "../model.js";
import type { SheetCellValue, SheetLinkValue, SheetMemberValue, SheetRegisterMemberValue } from "../values.js";

type Styles = Record<string, Record<string, unknown>>;

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
    /** The driver's sides make the link cell draw `in place` (a minus). */
    linkIn: boolean;
}

/** The chips of one link half. */
function LinkHalf({ styles, members, half, empty }: { styles: Styles; members: readonly SheetMemberValue[]; half: "from" | "to"; empty: boolean }) {
    return (
        <Box css={styles.half} data-half={half}>
            {empty && members.length === 0 && <Box as="span" css={styles.halfLabel}>{half}</Box>}
            {members.map((m, i) => (
                <Box key={i} as="span" css={memberIsDashed(m) ? styles.chipDashed : styles.chip} data-member={m.type}>
                    {memberLabel(m)}
                </Box>
            ))}
        </Box>
    );
}

/** Renders a cell's content. */
export const SheetCellContent = memo(function SheetCellContent({ styles, meta, cell, rowBlank, unit, member, ghost, linkIn }: SheetCellContentProps) {
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
        case "set":
        case "link": {
            if (shown === undefined || shown.type !== "Link") {
                if (shown !== undefined && !cellIsBlank(shown)) return <Box as="span" css={styles.cellText}>{cellText(shown, meta)}</Box>;
                return null;
            }
            const link = shown.value as SheetLinkValue;
            if (meta.kind === "set") {
                return (
                    <Box css={styles.half} data-half="to" style={{ justifyContent: "flex-start" }}>
                        {link.to.map((m, i) => (
                            <Box key={i} as="span" css={memberIsDashed(m) || isGhost ? styles.chipDashed : styles.chip} data-member={m.type}>{memberLabel(m)}</Box>
                        ))}
                    </Box>
                );
            }
            return (
                <Box css={styles.linkGrid} data-ghost={isGhost ? "" : undefined}>
                    <LinkHalf styles={styles} members={link.from} half="from" empty={!rowBlank} />
                    <Box as="span" css={styles.arrow} aria-hidden="true">
                        <FontAwesomeIcon icon={linkIn ? faMinus : faArrowRightLong} />
                    </Box>
                    <LinkHalf styles={styles} members={link.to} half="to" empty={!rowBlank} />
                </Box>
            );
        }
        default: {
            if (cellIsBlank(shown)) return null;
            return <Box as="span" css={isGhost ? styles.cellGhost : styles.cellText}>{cellText(shown, meta)}</Box>;
        }
    }
});
