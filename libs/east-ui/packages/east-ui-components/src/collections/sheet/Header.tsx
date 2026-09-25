/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The two-line sticky header (B§11): the gutter's corner — a checkbox over
 * the rail (indeterminate while any row is picked), `#` over the numbers
 * and, on a grouped sheet, the fold-all over the actions column (a ghost
 * button like the rows' actions, drawn as the group chevron doubled and
 * turning like it: right while every group is folded, down otherwise) —
 * then one cell per column: the label line (mono 10/600/.16em uppercase)
 * over the grey `sub` line that tells the planner what the cell accepts.
 * To assistive tech it is the grid's first row, the gutter its first column
 * (#860); the fold-all is out of the tab order like every control in the
 * grid — ⇧Space on a band does what it does.
 */

import { memo } from "react";
import { Box, chakra } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMinus } from "@fortawesome/free-solid-svg-icons";
import { countNoun, type SheetColumnMeta } from "./model.js";
import type { SheetNounValue } from "./values.js";
import { useSheetWords } from "./words.js";

type Styles = Record<string, Record<string, unknown>>;

export interface SheetHeaderProps {
    styles: Styles;
    columns: readonly SheetColumnMeta[];
    /** The CSS grid template — the gutter track then one per column. */
    gridTemplate: string;
    /** Whether any row is picked — the corner checkbox goes indeterminate. */
    picked?: boolean | undefined;
    /** The fold-all, on a grouped sheet only: whether every group is folded (the action is then to open them), how many, the host's noun, and the gesture. */
    foldAll?: { folded: boolean; count: number; noun: SheetNounValue; onFoldAll: (folded: boolean) => void } | undefined;
}

/** The fold-all's glyph: two of the groups' 10 px stroke chevrons side by side; the button turns it down while any group is open. */
function DoubleChevron() {
    return (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2.25 2.5 4.75 5l-2.5 2.5M5.75 2.5 8.25 5l-2.5 2.5" />
        </svg>
    );
}

/** Renders the header row. */
export const SheetHeader = memo(function SheetHeader({ styles, columns, gridTemplate, picked, foldAll }: SheetHeaderProps) {
    // The fold-all's words, its count in the app's locale (#850, #861).
    const words = useSheetWords();
    const { m } = words;
    const groups = foldAll !== undefined ? countNoun(foldAll.count, foldAll.noun, words) : "";
    return (
        <Box css={styles.header} style={{ gridTemplateColumns: gridTemplate }} data-slot="header" role="row" aria-rowindex={1}>
            <Box css={styles.headerGutter} data-slot="headerGutter" role="columnheader" aria-colindex={1}>
                <Box css={styles.rail} data-slot="rail">
                    <Box as="span" css={styles.checkbox} data-slot="checkbox" data-mixed={picked ? "" : undefined} aria-hidden="true">
                        {picked && <FontAwesomeIcon icon={faMinus} />}
                    </Box>
                </Box>
                <Box as="span" css={styles.headerNumber} data-slot="headerNumber">{m.headerNumber()}</Box>
                <Box css={styles.gutterAction} data-slot="foldAllSlot">
                    {foldAll !== undefined && foldAll.count > 0 && (
                        <chakra.button
                            type="button" css={styles.gutterButton} data-slot="foldAll" data-kind="fold" data-folded={foldAll.folded ? "" : undefined} tabIndex={-1}
                            aria-expanded={!foldAll.folded}
                            aria-label={m.foldAll({ folded: foldAll.folded, groups })}
                            title={m.foldAllTitle({ folded: foldAll.folded, groups, noun: foldAll.noun.singular })}
                            onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
                            onClick={(event) => { event.stopPropagation(); foldAll.onFoldAll(!foldAll.folded); }}>
                            <DoubleChevron />
                        </chakra.button>
                    )}
                </Box>
            </Box>
            {columns.map((col, i) => (
                <Box key={col.key} css={styles.headerCell} data-slot="headerCell" data-key={col.key} role="columnheader" aria-colindex={i + 2} title={col.sub}>
                    <Box as="span" css={styles.headerLabel}>{col.header}</Box>
                    {col.sub !== undefined && <Box as="span" css={styles.headerSub}>{col.sub}</Box>}
                </Box>
            ))}
        </Box>
    );
});
