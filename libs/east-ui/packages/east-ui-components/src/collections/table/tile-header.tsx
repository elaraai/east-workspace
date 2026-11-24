/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A head of a tile's Table (#1671) — the design system's header cell: its
 * label alone, the whole of it the button that sorts; what its host says after
 * the label (a value's goal); and, once sorted, the label in `--ink` beside a
 * caret. It has no pin and no resize: a tile's columns take the widths their
 * content needs.
 *
 * @packageDocumentation
 */

import type { CSSProperties, ReactNode } from "react";
import { Box, Table as ChakraTable, chakra } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCaretDown, faCaretUp } from "@fortawesome/free-solid-svg-icons";

/** Which way a head's column is sorted; `false` for neither. */
export type TileSorted = "asc" | "desc" | false;

/**
 * The sort a click on a head makes of the sort it shows: none, then the least
 * first, then the greatest first, then none again — or, from a sort its host
 * made and the Table did not, the least first.
 *
 * @param shown - The sort the head shows
 * @param own - Whether that sort is the Table's own, which a click can clear
 * @returns The sort to make; `false` clears it
 */
export function nextTileSort(shown: TileSorted, own: boolean): TileSorted {
    if (shown === false) return "asc";
    if (shown === "asc") return "desc";
    return own ? false : "asc";
}

/** Props of {@link TileHeaderCell}. */
export interface TileHeaderCellProps {
    /** The head's label. */
    readonly label: ReactNode;
    /** What its host says after the label; `undefined` says nothing. */
    readonly note: string | undefined;
    /** Whether its column prints numbers: it ends at its end, the caret leading. */
    readonly numeric: boolean;
    /** The sort it shows. */
    readonly sorted: TileSorted;
    /** Whether a click sorts. */
    readonly canSort: boolean;
    /** Told a click. */
    readonly onSort: () => void;
    /** The `table` recipe's `columnHeader`, `tileHeader`, `tileHeaderLabel` and `tileHeaderNote`. */
    readonly styles: Readonly<Record<string, CSSProperties | undefined>>;
    /** Its place: its width and its height. */
    readonly style: CSSProperties;
}

/**
 * A head of a tile's Table.
 *
 * @param props - Its label, its note, its sort and what a click tells
 * @returns The header cell
 */
export function TileHeaderCell({ label, note, numeric, sorted, canSort, onSort, styles, style }: TileHeaderCellProps) {
    return (
        <ChakraTable.ColumnHeader css={styles.columnHeader} style={style}
            aria-sort={sorted === false ? undefined : sorted === "asc" ? "ascending" : "descending"}>
            <chakra.button type="button" css={styles.tileHeader} disabled={!canSort} data-align={numeric ? "end" : undefined}
                data-sorted={sorted === false ? undefined : ""} onClick={onSort}>
                <Box as="span" css={styles.tileHeaderLabel}>{label}</Box>
                {note !== undefined && <Box as="span" css={styles.tileHeaderNote} data-table-head-note="">{note}</Box>}
                {sorted !== false && <FontAwesomeIcon icon={sorted === "asc" ? faCaretUp : faCaretDown} />}
            </chakra.button>
        </ChakraTable.ColumnHeader>
    );
}
