/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * One body row (B§11): the gutter — the row number (brand for a lens hit),
 * the 3 px bar when the whole row is selected, the ✓ × → buttons the
 * copilot adds in P4 — then one cell per column carrying the selection ring,
 * the range wash, the hatch of a pending fill, the next-target underline and
 * the overlay editor. Blank padding rows draw empty cells. A paged source's
 * unloaded run draws as a band with its element count.
 */

import { memo, type MouseEvent, type ReactNode } from "react";
import { Box } from "@chakra-ui/react";
import { getSomeorUndefined } from "../../utils.js";
import { cellIsBlank, driverKeyOf, resolveMember, type SheetBand, type SheetColumnIndex, type SheetRegisterIndex } from "./model.js";
import { SheetCellContent } from "./cells/Cell.js";
import type { SheetCellValue, SheetRowValue } from "./values.js";

type Styles = Record<string, Record<string, unknown>>;

/** The per-row facts the row renderer is handed — primitives, so the memo can skip. */
export interface SheetRowProps {
    styles: Styles;
    columns: SheetColumnIndex;
    registers: SheetRegisterIndex;
    driverColumn: string | undefined;
    gridTemplate: string;
    rowPx: number;
    /** The row-space index. */
    r: number;
    /** The 1-based row number. */
    number: number;
    /** The real row, or `undefined` for a blank padding row. */
    row: SheetRowValue | undefined;
    /** The row's driver `sides` value (link cells draw `in place` as a minus) — P3. */
    linkIn: boolean;
    /** The ring's column when it sits on this row. */
    selC: number | undefined;
    /** The range's columns when the row is inside it. */
    range: { c0: number; c1: number } | undefined;
    /** The whole row is selected (the gutter bar). */
    picked: boolean;
    /** A lens hit (brand row number) — P5. */
    hit: boolean;
    /** The editor, when it sits on this row: the column and the element. */
    editor: { c: number; node: ReactNode } | undefined;
    onCellDown: (r: number, c: number, e: MouseEvent) => void;
    onCellDouble: (r: number, c: number) => void;
    onCellEnter: (r: number, c: number) => void;
    onRowPick: (r: number, e: MouseEvent) => void;
}

/** Renders one row. */
export const SheetRow = memo(function SheetRow(props: SheetRowProps) {
    const { styles, columns, registers, driverColumn, gridTemplate, rowPx, r, number, row, linkIn, selC, range, picked, hit, editor } = props;
    const rowBlank = row === undefined;
    const driverKey = driverKeyOf(row, driverColumn);
    return (
        <Box
            css={styles.row}
            style={{ gridTemplateColumns: gridTemplate, minHeight: `${rowPx}px` }}
            data-slot="row"
            data-row={r}
            data-row-id={row?.id}
            data-blank={rowBlank ? "" : undefined}
            data-owned={row?.owned ? "" : undefined}
            role="row"
        >
            <Box
                css={styles.gutter}
                data-slot="gutter"
                onMouseDown={(e) => props.onRowPick(r, e)}
                title="Select whole row — delete removes it"
            >
                {picked && <Box css={styles.gutterBar} />}
                <Box as="span" css={styles.gutterNumber} data-hit={hit ? "" : undefined}>{number}</Box>
            </Box>
            {columns.list.map((meta, c) => {
                const cell: SheetCellValue | undefined = row?.cells.get(meta.key);
                const selected = selC === c && editor?.c !== c;
                const inRange = range !== undefined && c >= range.c0 && c <= range.c1;
                const unit = meta.kind === "quantity" && driverKey !== undefined ? meta.uom?.get(driverKey) : undefined;
                const member = meta.kind === "enum" && cell?.type === "String" ? resolveMember(registers, meta.register, cell.value as string) : undefined;
                return (
                    <Box
                        key={meta.key}
                        css={styles.cell}
                        data-slot="cell"
                        data-key={meta.key}
                        data-kind={meta.kind}
                        data-selected={selected ? "" : undefined}
                        data-blank={cellIsBlank(cell) ? "" : undefined}
                        role="gridcell"
                        onMouseDown={(e) => props.onCellDown(r, c, e)}
                        onDoubleClick={() => props.onCellDouble(r, c)}
                        onMouseEnter={() => props.onCellEnter(r, c)}
                    >
                        {inRange && <Box css={styles.rangeWash} data-slot="rangeWash" />}
                        <SheetCellContent
                            styles={styles}
                            meta={meta}
                            cell={cell}
                            rowBlank={rowBlank}
                            unit={unit}
                            member={member}
                            ghost={undefined}
                            linkIn={linkIn}
                        />
                        {selected && <Box css={styles.ring} data-slot="ring" />}
                        {editor !== undefined && editor.c === c && editor.node}
                    </Box>
                );
            })}
        </Box>
    );
});

export interface SheetBandRowProps {
    styles: Styles;
    band: SheetBand;
    loading: boolean;
}

/** A paged source's unloaded run — one band sized by the ledger. */
export const SheetBandRow = memo(function SheetBandRow({ styles, band, loading }: SheetBandRowProps) {
    const n = Math.max(0, band.to - band.from + 1);
    return (
        <Box
            css={styles.band}
            style={{ height: `${Math.max(1, band.px)}px` }}
            data-slot="band"
            data-band={band.at}
            data-elements={n}
        >
            <Box css={styles.bandRule} aria-hidden="true" />
            <Box as="span" css={styles.bandPill} style={{ position: "sticky", top: "60px", alignSelf: "flex-start", marginTop: "0" }}>
                {`${n.toLocaleString()} ${loading ? "loading" : "not loaded"}`}
            </Box>
        </Box>
    );
});

/** The tone of an enum member, exported for the gutter's future status dot. */
export function memberTone(registers: SheetRegisterIndex, register: string | undefined, key: string): string | undefined {
    const m = resolveMember(registers, register, key);
    return m !== undefined ? getSomeorUndefined(m.tone)?.type : undefined;
}
