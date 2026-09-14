/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * One body row (B§11): the gutter — the row number (brand for a lens hit),
 * the 3 px bar when the whole row is selected, the → button that fills the
 * anchor row — then one cell per column carrying the selection ring, the
 * range wash, a pending fill as a grey ghost over the brand hatch, the
 * next-target dotted underline, the ✓ take button on hover, and the overlay
 * editor. Blank padding rows draw empty cells. A paged source's unloaded run
 * draws as a band with its element count; a run the lens hides (B§8) as a
 * band whose pill opens the rows a few at a time. A proposed row (B§5.2)
 * draws dashed-topped and hatched with real numbers, its gutter carrying ✓
 * and ×. A group's band (#740, G1) — the chevron and the line count in the
 * gutter, the title over the eyebrow across the first columns, the band
 * cells under their line columns — and the `+ plan` ghost band (G6); a line
 * carries the 2 px extent rule down its right edge (G2).
 */

import { memo, type MouseEvent, type ReactNode } from "react";
import { Box } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faAngleDown, faAngleRight, faAngleUp, faArrowRightLong, faCheck, faXmark } from "@fortawesome/free-solid-svg-icons";
import { none } from "@elaraai/east";
import { getSomeorUndefined } from "../../utils.js";
import {
    TITLE_KEY, cellIsBlank, cellText, driverKeyOf, resolveMember,
    type LineGroup, type SheetBand, type SheetColumnIndex, type SheetColumnMeta, type SheetGroupIndex, type SheetRegisterIndex,
} from "./model.js";
import { SheetCellContent, type LinkCellContext } from "./cells/Cell.js";
import type { LensGap } from "./lens.js";
import type { PendingFill } from "./sheet-types.js";
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
    /** The first body item — the row under the sticky header (its ring stays inside the cell). */
    first?: boolean | undefined;
    /** The real row, or `undefined` for a blank padding row. */
    row: SheetRowValue | undefined;
    /** A line's group (#740): the row is a line, numbered within its group, with the extent rule down its right edge. */
    group?: LineGroup | undefined;
    /** The link cell's halves, vocabulary and flags for a row (P3). */
    linkCtx: (row: SheetRowValue | undefined, meta: SheetColumnMeta) => LinkCellContext | undefined;
    /** The ring's column when it sits on this row. */
    selC: number | undefined;
    /** The range's columns when the row is inside it. */
    range: { c0: number; c1: number } | undefined;
    /** The whole row is selected (the gutter bar). */
    picked: boolean;
    /** A lens hit — the brand row number (B§8). */
    hit: boolean;
    /** The editor, when it sits on this row: the column and the element. */
    editor: { c: number; node: ReactNode } | undefined;
    /** The copilot's pending fills when this row is the anchor, by column key (B§5.1). */
    fills: ReadonlyMap<string, PendingFill> | undefined;
    /** The column of the next ⇥ target when it sits on this row. */
    nextTargetC: number | undefined;
    /** The hovered column when the pointer is on this row — the ✓ take button's home. */
    hoverC: number | undefined;
    onCellDown: (r: number, c: number, e: MouseEvent) => void;
    onCellDouble: (r: number, c: number) => void;
    onCellEnter: (r: number, c: number) => void;
    onRowPick: (r: number, e: MouseEvent) => void;
    /** ✓ on a fill. */
    onTake: (key: string) => void;
    /** The gutter's → button. */
    onFillRow: () => void;
}

/** Renders one row. */
export const SheetRow = memo(function SheetRow(props: SheetRowProps) {
    const { styles, columns, registers, driverColumn, gridTemplate, rowPx, r, number, row, group, linkCtx, selC, range, picked, hit, editor, fills, nextTargetC, hoverC, first } = props;
    const rowBlank = row === undefined;
    const driverKey = driverKeyOf(row, driverColumn);
    const hasFills = fills !== undefined && fills.size > 0;
    return (
        <Box
            css={styles.row}
            style={{ gridTemplateColumns: gridTemplate, minHeight: `${rowPx}px` }}
            data-slot="row"
            data-row={r}
            data-row-id={row?.id}
            data-blank={rowBlank ? "" : undefined}
            data-owned={row?.owned ? "" : undefined}
            data-anchor={hasFills ? "" : undefined}
            data-first={first ? "" : undefined}
            data-group-id={group?.row.id}
            data-line={group !== undefined ? group.key : undefined}
            role="row"
        >
            {group !== undefined && <Box css={styles.edge} data-slot="edge" aria-hidden="true" />}
            <Box
                css={styles.gutter}
                data-slot="gutter"
                onMouseDown={(e) => props.onRowPick(r, e)}
                title={hasFills ? "Click the number to select the row · the button fills it" : "Select whole row — delete removes it"}
            >
                {picked && <Box css={styles.gutterBar} />}
                <Box as="span" css={styles.gutterNumber} data-slot="gutterNumber" data-hit={hit ? "" : undefined}>{number}</Box>
                {hasFills && (
                    <Box
                        as="span"
                        css={styles.gutterButton}
                        data-slot="fillRow"
                        role="button"
                        aria-label="Fill this row"
                        title="Fill this row — ⌘⏎"
                        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); props.onFillRow(); }}
                    >
                        <FontAwesomeIcon icon={faArrowRightLong} />
                    </Box>
                )}
            </Box>
            {columns.list.map((meta, c) => {
                const cell: SheetCellValue | undefined = row?.cells.get(meta.key);
                const editing = editor?.c === c;
                const selected = selC === c && !editing;
                const inRange = range !== undefined && c >= range.c0 && c <= range.c1;
                const unit = meta.kind === "quantity" && driverKey !== undefined ? meta.uom?.get(driverKey) : undefined;
                const member = meta.kind === "enum" && cell?.type === "String" ? resolveMember(registers, meta.register, cell.value) : undefined;
                const fill = !editing && cellIsBlank(cell) ? fills?.get(meta.key) : undefined;
                const isTarget = !editing && nextTargetC === c && fill !== undefined;
                return (
                    <Box
                        key={meta.key}
                        css={styles.cell}
                        data-slot="cell"
                        data-key={meta.key}
                        data-kind={meta.kind}
                        data-selected={selected ? "" : undefined}
                        data-blank={cellIsBlank(cell) ? "" : undefined}
                        data-proposed={fill !== undefined ? "" : undefined}
                        data-next-target={isTarget ? "" : undefined}
                        role="gridcell"
                        onMouseDown={(e) => props.onCellDown(r, c, e)}
                        onDoubleClick={() => props.onCellDouble(r, c)}
                        onMouseEnter={() => props.onCellEnter(r, c)}
                    >
                        {inRange && <Box css={styles.rangeWash} data-slot="rangeWash" />}
                        {fill !== undefined && <Box css={styles.hatch} data-slot="hatch" aria-hidden="true" />}
                        <SheetCellContent
                            styles={styles}
                            meta={meta}
                            cell={cell}
                            rowBlank={rowBlank && fill === undefined}
                            unit={unit ?? (fill !== undefined && meta.kind === "quantity" && driverKey !== undefined ? meta.uom?.get(driverKey) : undefined)}
                            member={member}
                            ghost={fill?.cell}
                            link={meta.kind === "link" ? linkCtx(row, meta) : undefined}
                        />
                        {isTarget && <Box css={styles.nextTarget} data-slot="nextTarget" aria-hidden="true" />}
                        {fill !== undefined && hoverC === c && (
                            <Box
                                as="span"
                                css={styles.takeButton}
                                data-slot="take"
                                role="button"
                                aria-label={`Take ${meta.header}`}
                                title={`Take — ${fill.meta === "" ? "suggested" : fill.meta}`}
                                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); props.onTake(meta.key); }}
                            >
                                <FontAwesomeIcon icon={faCheck} />
                            </Box>
                        )}
                        {selected && <Box css={styles.ring} data-slot="ring" />}
                        {editing && editor.node}
                    </Box>
                );
            })}
        </Box>
    );
});

export interface SheetProposalRowProps {
    styles: Styles;
    columns: SheetColumnIndex;
    registers: SheetRegisterIndex;
    driverColumn: string | undefined;
    gridTemplate: string;
    rowPx: number;
    /** The proposal's index under its anchor. */
    index: number;
    /** The 1-based row number it would take. */
    number: number;
    /** Proposed under a line (#740) — the group's extent rule runs down its edge. */
    grouped?: boolean | undefined;
    cells: ReadonlyMap<string, SheetCellValue>;
    meta: string;
    /** Selected — the 3 px brand bar and the wash. */
    picked: boolean;
    linkCtx: (row: SheetRowValue | undefined, meta: SheetColumnMeta) => LinkCellContext | undefined;
    onPick: (i: number) => void;
    onAccept: (i: number) => void;
    onReject: (i: number) => void;
}

/** A proposed row (B§5.2): dashed-topped, hatched, real numbers; ✓ adds it, × rejects it. */
export const SheetProposalRow = memo(function SheetProposalRow(props: SheetProposalRowProps) {
    const { styles, columns, registers, driverColumn, gridTemplate, rowPx, index, number, grouped, cells, meta, picked, linkCtx } = props;
    const pseudo: SheetRowValue = { id: "", owned: false, cells: cells as Map<string, SheetCellValue>, lines: [], band: none };
    const driverKey = driverKeyOf(pseudo, driverColumn);
    const pick = (e: MouseEvent) => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); props.onPick(index); };
    return (
        <Box
            css={styles.row}
            style={{ gridTemplateColumns: gridTemplate, minHeight: `${rowPx}px` }}
            data-slot="row"
            data-proposed=""
            data-proposal={index}
            data-picked={picked ? "" : undefined}
            role="row"
            title={meta}
        >
            {grouped === true && <Box css={styles.edge} data-slot="edge" aria-hidden="true" />}
            <Box css={styles.gutter} data-slot="gutter" onMouseDown={pick} title="Suggested row — ✓ adds it, × rejects it">
                {picked && <Box css={styles.gutterBar} />}
                <Box as="span" css={styles.gutterNumber} data-slot="gutterNumber">{number}</Box>
                <Box
                    as="span"
                    css={styles.gutterButton}
                    data-slot="accept"
                    role="button"
                    aria-label="Add this suggested row"
                    title="Add this row to the plan — ⏎"
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); props.onAccept(index); }}
                >
                    <FontAwesomeIcon icon={faCheck} />
                </Box>
                <Box
                    as="span"
                    css={styles.gutterButton}
                    data-slot="reject"
                    data-reject=""
                    role="button"
                    aria-label="Reject this suggestion"
                    title="Reject — not offered after this activity again — ⌫"
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); props.onReject(index); }}
                >
                    <FontAwesomeIcon icon={faXmark} />
                </Box>
            </Box>
            {columns.list.map((colMeta) => {
                const cell = cells.get(colMeta.key);
                const unit = colMeta.kind === "quantity" && driverKey !== undefined ? colMeta.uom?.get(driverKey) : undefined;
                const member = colMeta.kind === "enum" && cell?.type === "String" ? resolveMember(registers, colMeta.register, cell.value) : undefined;
                return (
                    <Box
                        key={colMeta.key}
                        css={styles.cell}
                        data-slot="cell"
                        data-key={colMeta.key}
                        data-kind={colMeta.kind}
                        data-proposed=""
                        role="gridcell"
                        onMouseDown={pick}
                    >
                        {picked && <Box css={styles.rangeWash} data-slot="rangeWash" />}
                        <Box css={styles.hatch} data-slot="hatch" aria-hidden="true" />
                        <SheetCellContent
                            styles={styles}
                            meta={colMeta}
                            cell={undefined}
                            rowBlank={false}
                            unit={unit}
                            member={member}
                            ghost={cell !== undefined && !cellIsBlank(cell) ? cell : undefined}
                            link={colMeta.kind === "link" ? linkCtx(pseudo, colMeta) : undefined}
                        />
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

export interface SheetGapRowProps {
    styles: Styles;
    gap: LensGap;
    /** How far each control reaches on its next press (1 · 3 · 10 · all). */
    reach: { top: number; bottom: number; both: number };
    onReveal: (gap: LensGap, where: "top" | "bottom" | "both" | "all") => void;
    /** The 1-based number a lens position prints as (a line's within its group, #740). */
    numberOf?: ((position: number) => number) | undefined;
}

/**
 * A run the lens hides (B§8): 22 px, a dashed rule, the `n hidden` pill —
 * hover opens `⌃ +1 · n hidden · +1 ⌄ · all`, each press reaching further
 * from the top, the bottom, or both.
 */
export const SheetGapRow = memo(function SheetGapRow({ styles, gap, reach, onReveal, numberOf }: SheetGapRowProps) {
    const press = (where: "top" | "bottom" | "both" | "all") => (e: MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        onReveal(gap, where);
    };
    const middle = gap.first ? "bottom" : gap.last ? "top" : "both";
    const above = numberOf !== undefined ? numberOf(gap.from) - 1 : gap.from;
    const below = numberOf !== undefined ? numberOf(gap.to) + 1 : gap.to + 2;
    return (
        <Box css={styles.band} data-slot="band" data-band="lens" data-gap={gap.key} data-hidden={gap.hidden}>
            <Box css={styles.bandRule} aria-hidden="true" />
            <Box as="span" css={styles.bandPill} data-slot="bandPill" data-lens="">
                {!gap.first && (
                    <Box as="span" css={styles.bandControl} data-slot="bandControl" data-where="top" role="button"
                        aria-label={`Show ${reach.top} more after row ${above}`} title={`Show the rows just after row ${above}`} onMouseDown={press("top")}>
                        <FontAwesomeIcon icon={faAngleUp} />
                        {`+${reach.top}`}
                    </Box>
                )}
                <Box as="span" css={styles.bandCount} data-slot="bandCount" role="button" title="Expand — each click reaches further" onMouseDown={press(middle)}>
                    {`${gap.hidden.toLocaleString()} hidden`}
                </Box>
                {!gap.last && (
                    <Box as="span" css={styles.bandControl} data-slot="bandControl" data-where="bottom" role="button"
                        aria-label={`Show ${reach.bottom} more before row ${below}`} title={`Show the rows just before row ${below}`} onMouseDown={press("bottom")}>
                        {`+${reach.bottom}`}
                        <FontAwesomeIcon icon={faAngleDown} />
                    </Box>
                )}
                <Box as="span" css={styles.bandControl} data-slot="bandControl" data-where="all" role="button" aria-label="Show every hidden row" title="Show every hidden row" onMouseDown={press("all")}>
                    all
                </Box>
            </Box>
        </Box>
    );
});

// ── Grouped rows (#740) ───────────────────────────────────────────────────

export interface SheetGroupRowProps {
    styles: Styles;
    columns: SheetColumnIndex;
    registers: SheetRegisterIndex;
    gridTemplate: string;
    /** The band's height (px). */
    bandPx: number;
    /** The row-space index. */
    r: number;
    /** The group's wire row — its band cells under {@link TITLE_KEY} and the line columns. */
    row: SheetRowValue;
    /** The band's cells and the title span. */
    group: SheetGroupIndex;
    folded: boolean;
    /** The group's line count. */
    count: number;
    /** Under a lens: how many of its lines are hits. */
    hits: number | undefined;
    /** The first body item — the row under the sticky header. */
    first?: boolean | undefined;
    /** The copy that sticks under the column header while the group's lines scroll (G1). */
    sticky?: boolean | undefined;
    /** The ring's column when it sits on this band. */
    selC: number | undefined;
    /** The range's columns when the band is inside it. */
    range: { c0: number; c1: number } | undefined;
    /** The band is selected whole (the gutter bar). */
    picked: boolean;
    /** The editor, when it sits on this band: the column and the element. */
    editor: { c: number; node: ReactNode } | undefined;
    onCellDown: (r: number, c: number, e: MouseEvent) => void;
    onCellDouble: (r: number, c: number) => void;
    onCellEnter: (r: number, c: number) => void;
    /** The gutter: selects the group's lines. */
    onRowPick: (r: number, e: MouseEvent) => void;
    /** The chevron. */
    onFold: (r: number) => void;
}

/**
 * A group's band (#740, G1): the gutter carries the fold chevron and the
 * line count (`3 of 6` under a lens); the title and its eyebrow span the
 * first columns; every other column shows the group's band cell for it, or
 * nothing. The band starts the group's extent rule (G2).
 */
export const SheetGroupRow = memo(function SheetGroupRow(props: SheetGroupRowProps) {
    const { styles, columns, registers, gridTemplate, bandPx, r, row, group, folded, count, hits, first, sticky, selC, range, picked, editor } = props;
    const titleCell = row.cells.get(TITLE_KEY);
    const title = titleCell !== undefined && titleCell.type === "String" ? titleCell.value : "";
    const sub = getSomeorUndefined(row.band)?.sub ?? "";
    const span = group.titleSpan;
    const titleMeta = group.cells.get(TITLE_KEY);
    const titleSelected = selC !== undefined && selC < span && editor === undefined;
    const titleEditing = editor !== undefined && editor.c < span;
    const countText = hits !== undefined ? `${hits} of ${count}` : String(count);
    return (
        <Box
            css={styles.groupRow}
            style={{ gridTemplateColumns: gridTemplate, minHeight: `${bandPx}px` }}
            data-slot={sticky === true ? "stickyBand" : "row"}
            data-band-row=""
            data-row={r}
            data-row-id={row.id}
            data-folded={folded ? "" : undefined}
            data-owned={row.owned ? "" : undefined}
            data-first={first ? "" : undefined}
            role="row"
            aria-expanded={!folded}
        >
            <Box css={styles.edge} data-slot="edge" aria-hidden="true" />
            <Box css={styles.gutter} data-slot="gutter" onMouseDown={(e) => props.onRowPick(r, e)} title="Select the plan's lines — delete removes them">
                {picked && <Box css={styles.gutterBar} />}
                <Box
                    as="span"
                    css={styles.groupChevron}
                    data-slot="fold"
                    role="button"
                    aria-label={folded ? "Open the plan" : "Fold the plan"}
                    title={folded ? "Open — Space" : "Fold — Space"}
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); props.onFold(r); }}
                >
                    <FontAwesomeIcon icon={folded ? faAngleRight : faAngleDown} />
                </Box>
                <Box as="span" css={styles.groupCount} data-slot="groupCount" data-quiet={hits === 0 ? "" : undefined}>{countText}</Box>
            </Box>
            <Box
                css={styles.groupTitle}
                style={{ gridColumn: `span ${span}` }}
                data-slot="cell"
                data-key={TITLE_KEY}
                data-kind="text"
                data-selected={titleSelected ? "" : undefined}
                role="gridcell"
                onMouseDown={(e) => props.onCellDown(r, 0, e)}
                onDoubleClick={() => props.onCellDouble(r, 0)}
                onMouseEnter={() => props.onCellEnter(r, 0)}
            >
                {range !== undefined && range.c0 < span && <Box css={styles.rangeWash} data-slot="rangeWash" />}
                <Box as="span" css={styles.groupTitleText} data-slot="groupTitle">{title === "" && titleMeta !== undefined ? "Untitled" : title}</Box>
                {sub !== "" && <Box as="span" css={styles.groupSub} data-slot="groupSub">{sub}</Box>}
                {titleSelected && <Box css={styles.ring} data-slot="ring" />}
                {titleEditing && editor.node}
            </Box>
            {columns.list.map((colMeta, c) => {
                if (c < span) return null;
                const meta = group.cells.get(colMeta.key);
                const cell = meta !== undefined ? row.cells.get(colMeta.key) : undefined;
                const editing = editor?.c === c;
                const selected = selC === c && !editing;
                const inRange = range !== undefined && c >= range.c0 && c <= range.c1;
                const member = meta?.kind === "enum" && cell?.type === "String" ? resolveMember(registers, meta.register, cell.value) : undefined;
                return (
                    <Box
                        key={colMeta.key}
                        css={styles.groupCell}
                        data-slot="cell"
                        data-key={colMeta.key}
                        data-kind={meta?.kind}
                        data-selected={selected ? "" : undefined}
                        data-blank={cellIsBlank(cell) ? "" : undefined}
                        data-editable={meta !== undefined && meta.editable ? "" : undefined}
                        role="gridcell"
                        onMouseDown={(e) => props.onCellDown(r, c, e)}
                        onDoubleClick={() => props.onCellDouble(r, c)}
                        onMouseEnter={() => props.onCellEnter(r, c)}
                        title={meta !== undefined ? `${colMeta.header} — ${cellText(cell, meta)}` : undefined}
                    >
                        {inRange && <Box css={styles.rangeWash} data-slot="rangeWash" />}
                        {meta !== undefined && (
                            <SheetCellContent styles={styles} meta={meta} cell={cell} rowBlank={false} unit={undefined} member={member} ghost={undefined} link={undefined} />
                        )}
                        {selected && <Box css={styles.ring} data-slot="ring" />}
                        {editing && editor.node}
                    </Box>
                );
            })}
        </Box>
    );
});

export interface SheetGhostBandRowProps {
    styles: Styles;
    gridTemplate: string;
    /** The band's height (px). */
    bandPx: number;
    /** The row-space index. */
    r: number;
    /** How many columns the label spans. */
    colCount: number;
    /** The ring sits on the ghost band. */
    selected: boolean;
    /** The title editor, when a plan is being named. */
    editor: ReactNode | undefined;
    onCellDown: (r: number, c: number, e: MouseEvent) => void;
}

/** The `+ plan` ghost band (#740, G6): a click, ⏎ or a printable key opens its title; the commit creates the plan. */
export const SheetGhostBandRow = memo(function SheetGhostBandRow({ styles, gridTemplate, bandPx, r, colCount, selected, editor, onCellDown }: SheetGhostBandRowProps) {
    return (
        <Box
            css={styles.ghostBand}
            style={{ gridTemplateColumns: gridTemplate, minHeight: `${bandPx}px` }}
            data-slot="row"
            data-ghost-band=""
            data-row={r}
            role="row"
        >
            <Box css={styles.gutter} data-slot="gutter" />
            <Box
                css={styles.ghostCell}
                style={{ gridColumn: `span ${Math.max(1, colCount)}` }}
                data-slot="cell"
                data-key={TITLE_KEY}
                data-selected={selected && editor === undefined ? "" : undefined}
                role="gridcell"
                title="Add a plan — ⏎ or click, then name it"
                onMouseDown={(e) => onCellDown(r, 0, e)}
            >
                <Box as="span" css={styles.ghostLabel} data-slot="ghostLabel">+ plan</Box>
                {selected && editor === undefined && <Box css={styles.ring} data-slot="ring" />}
                {editor}
            </Box>
        </Box>
    );
});

/** The tone of an enum member, exported for the gutter's future status dot. */
export function memberTone(registers: SheetRegisterIndex, register: string | undefined, key: string): string | undefined {
    const m = resolveMember(registers, register, key);
    return m !== undefined ? getSomeorUndefined(m.tone)?.type : undefined;
}
