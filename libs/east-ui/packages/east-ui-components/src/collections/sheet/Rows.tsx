/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Renders aligned spreadsheet rows and full-width group summaries. Group
 * membership lives in the gutter markers and rails; rows share one grid.
 * And the SUB ROWS under a line (#844): read-only rows that share none of
 * the line's columns — a tree and a `{line}.{n}` index in the gutter, then
 * one grey well spanning the rest.
 */

import { memo, useId, useLayoutEffect, useRef, type MouseEvent, type ReactNode, type RefObject } from "react";
import { Box, chakra } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faAngleDown, faAngleUp, faArrowRight, faCheck, faMinus, faXmark } from "@fortawesome/free-solid-svg-icons";
import { none } from "@elaraai/east";
import { getSomeorUndefined } from "../../utils.js";
import {
    TITLE_KEY, cellIsBlank, cellText, driverKeyOf, isLinePosition, lineNumberOf, resolveMember,
    type LineGroup, type SheetBand, type SheetColumnIndex, type SheetColumnMeta, type SheetGroupIndex, type SheetRegisterIndex,
} from "./model.js";
import { SheetCellContent, type LinkCellContext } from "./cells/Cell.js";
import { cellDetail } from "./detail.js";
import type { LensGap } from "./lens.js";
import type { PendingFill } from "./sheet-types.js";
import type { SheetCellValue, SheetNounValue, SheetRowValue, SheetSubRowValue } from "./values.js";
import type { DraftPresentation } from "./draft-state.js";
import type { SheetMembership } from "./membership.js";

type Styles = Record<string, Record<string, unknown>>;

// The gutter is three columns with three jobs — RAIL (select: a 14 px
// checkbox on a 1 px connector) · NUMBER · ACTIONS (decide: 24 px ghost
// buttons, Font Awesome 13 px). Inserts are not gutter content: both chips
// float at the row boundary, threaded on the insertion line
// (`Insertion.tsx`). A group's identity is its band plus the connector;
// brand appears only for selection and insertion.

/**
 * The chevron: a 10 px stroke on a line's number and a group's band alike.
 * It always points right; its button turns it down when open (the recipe's
 * `rotate`), so opening and folding turn it rather than swap it.
 */
function Chevron() {
    return (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3.75 2.5 6.25 5l-2.5 2.5" />
        </svg>
    );
}

/**
 * A row a gesture has just brought into view (a line's sub rows opening, an
 * unfolded group's lines) drops in: it fades up from a few
 * pixels above, `order` places it in a short cascade. Once, when it mounts —
 * a row scrolled into view later arrives still — and not at all where the
 * viewer asks for less motion.
 */
function useArrival(ref: RefObject<HTMLElement | null>, order: number | undefined): void {
    useLayoutEffect(() => {
        const el = ref.current;
        if (order === undefined || el === null || typeof el.animate !== "function") return;
        if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const arrival = el.animate(
            [{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }],
            { duration: 220, delay: order * 16, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "backwards" },
        );
        return () => arrival.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a row arrives once, when it mounts
    }, []);
}

/** The rail: the connector behind, the checkbox on top (none on a blank row). A group's checkbox goes indeterminate while some of its lines are picked. */
function Rail({ styles, membership, picked, mixed, label, selectable, onPick }: {
    styles: Styles;
    membership?: SheetMembership | undefined;
    picked: boolean;
    mixed: boolean;
    label: string;
    selectable: boolean;
    onPick: (event: MouseEvent) => void;
}) {
    return <Box css={styles.rail} data-slot="rail">
        {membership !== undefined && <Box css={styles.connector} data-slot="connector"
            data-above={membership.above ? "" : undefined} data-below={membership.below ? "" : undefined} aria-hidden="true" />}
        {selectable && <chakra.button type="button" css={styles.checkbox} data-slot="checkbox"
            aria-label={label} title={label} aria-pressed={picked} data-mixed={mixed && !picked ? "" : undefined}
            onMouseDown={(event) => { event.stopPropagation(); event.preventDefault(); }}
            onClick={(event) => { event.stopPropagation(); onPick(event); }}>
            {picked ? <FontAwesomeIcon icon={faCheck} /> : mixed ? <FontAwesomeIcon icon={faMinus} /> : null}
        </chakra.button>}
    </Box>;
}

/** The per-row facts the row renderer is handed — primitives, so the memo can skip. */
export interface SheetRowProps {
    styles: Styles;
    insertion?: ReactNode;
    insertPreview?: "row" | "group" | undefined;
    /** Where the previewing seam's chips sit; the insertion line starts at them. */
    insertSide?: "gutter" | "body" | undefined;
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
    /** A line's group: its number resets within the group; membership stays in the gutter. */
    group?: LineGroup | undefined;
    membership?: SheetMembership | undefined;
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
    /** Schema-derived state of the current unapplied row. */
    draft?: DraftPresentation | undefined;
    /** Discard a never-applied row as an undoable gesture. */
    onDiscard?: (() => void) | undefined;
    /** The sub rows under this line: how many, and whether they show. */
    subRows?: { count: number; open: boolean } | undefined;
    /** The chevron: show or hide them; `all` (⌥) takes every line of the group the same way. */
    onSubRows?: ((r: number, all: boolean) => void) | undefined;
    /** The host's word for a group (#844) — the chevron's title names it. */
    noun?: SheetNounValue | undefined;
    /** The copy that sticks under the group's band while the line's sub rows scroll under it. */
    sticky?: boolean | undefined;
    /** The line's group was just unfolded: it drops in, this far into the cascade. */
    entering?: number | undefined;
}

/** Renders one row. */
export const SheetRow = memo(function SheetRow(props: SheetRowProps) {
    const { styles, columns, registers, driverColumn, gridTemplate, rowPx, r, number, row, group, linkCtx, selC, range, picked, hit, editor, fills, nextTargetC, hoverC, first } = props;
    const issuePrefix = useId();
    const self = useRef<HTMLDivElement | null>(null);
    useArrival(self, props.entering);
    const invalid = props.draft?.invalid === true || (row !== undefined && [...row.cells.values()].some(cell => cell.type === "Invalid"));
    const rowBlank = row === undefined;
    const groupTitle = group?.row.cells.get(TITLE_KEY);
    const groupName = groupTitle?.type === "String" ? groupTitle.value : group?.row.id;
    const driverKey = driverKeyOf(row, driverColumn);
    const hasFills = fills !== undefined && fills.size > 0;
    return (
        <Box
            ref={self}
            css={styles.row}
            style={{ gridTemplateColumns: gridTemplate, minHeight: `${rowPx}px` }}
            data-slot={props.sticky === true ? "stickyLine" : "row"}
            data-insert-preview={props.insertPreview}
            data-insert-side={props.insertPreview !== undefined ? props.insertSide : undefined}
            data-row={r}
            data-row-id={row?.id}
            data-blank={rowBlank ? "" : undefined}
            data-invalid={invalid ? "" : undefined}
            data-draft={props.draft?.pending ? "" : undefined}
            data-incomplete={props.draft?.incomplete ? "" : undefined}
            data-owned={row?.owned ? "" : undefined}
            data-anchor={hasFills ? "" : undefined}
            data-first={first ? "" : undefined}
            data-group-id={group?.row.id}
            data-line={group !== undefined ? group.key : undefined}
            data-picked={picked ? "" : undefined}
            data-sub-rows-open={props.subRows?.open === true ? "" : undefined}
            role="row"
        >
            <Box
                css={styles.gutter}
                data-slot="gutter"
                onMouseDown={(e) => props.onRowPick(r, e)}
                title={hasFills ? "Click the number to select the row · the button fills it" : "Select whole row — delete removes it"}
            >
                {props.insertion}
                <Rail styles={styles} membership={rowBlank ? undefined : props.membership} picked={picked} mixed={false} selectable={!rowBlank}
                    label={group !== undefined ? `Select row ${number} in ${groupName}` : `Select row ${number}`}
                    onPick={(event) => props.onRowPick(r, event)} />
                <Box as="span" css={styles.gutterNumber} data-slot="gutterNumber" data-hit={hit ? "" : undefined} data-blank={rowBlank ? "" : undefined}>
                    {/* A line with sub rows: the chevron before its number shows or hides them (⌥ every line of the group); open, the tree's stem starts just under it. */}
                    {props.subRows !== undefined && (
                        <chakra.button type="button" css={styles.subRowChevron} data-slot="subRowChevron" data-open={props.subRows.open ? "" : undefined}
                            aria-expanded={props.subRows.open}
                            aria-label={`${props.subRows.open ? "Hide" : "Show"} the ${props.subRows.count} row${props.subRows.count === 1 ? "" : "s"} under line ${number}`}
                            title={`${props.subRows.open ? "Hide" : "Show"} the ${props.subRows.count} row${props.subRows.count === 1 ? "" : "s"} under this line — Space · ⌥ every line in the ${props.noun?.singular ?? "group"}`}
                            onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); props.onSubRows?.(r, event.altKey); }}
                            onClick={(event) => { if (event.detail === 0) props.onSubRows?.(r, event.altKey); }}>
                            <Chevron />
                        </chakra.button>
                    )}
                    {props.subRows?.open === true && <Box as="span" css={styles.subRowStem} data-slot="subRowStem" aria-hidden="true" />}
                    {number}
                </Box>
                <Box css={styles.gutterAction} data-slot="fillSlot">
                    {hasFills && (
                        <Box
                            as="span"
                            css={styles.gutterButton}
                            data-slot="fillRow"
                            data-kind="apply"
                            role="button"
                            aria-label="Fill this row"
                            title="Fill this row — ⌘⏎"
                            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); props.onFillRow(); }}
                        >
                            <FontAwesomeIcon icon={faArrowRight} />
                        </Box>
                    )}
                    {props.draft?.discardable && <chakra.button
                        type="button" css={styles.gutterButton}
                        data-slot="discardDraft" data-kind="discard" aria-label="Discard new row" title="Discard new row"
                        onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
                        onClick={(event) => { event.stopPropagation(); props.onDiscard?.(); }}
                    ><FontAwesomeIcon icon={faXmark} /></chakra.button>}
                </Box>
            </Box>
            {columns.list.map((meta, c) => {
                const cell: SheetCellValue | undefined = row?.cells.get(meta.key);
                const issue = cell?.type === "Invalid" ? `Invalid input: ${cell.value}` : props.draft?.issues.get(meta.key);
                const issueId = `${issuePrefix}-${c}`;
                const editing = editor?.c === c;
                const selected = selC === c && !editing;
                const inRange = range !== undefined && c >= range.c0 && c <= range.c1;
                const unit = meta.kind === "quantity" && driverKey !== undefined ? meta.uom?.get(driverKey) : undefined;
                const member = meta.kind === "enum" && cell?.type === "String" ? resolveMember(registers, meta.register, cell.value) : undefined;
                const fill = !editing && cellIsBlank(cell) ? fills?.get(meta.key) : undefined;
                const isTarget = !editing && nextTargetC === c && fill !== undefined;
                // A date cell's level comes from the row (#844); once its actual is known, that instant prints and the wanted date becomes the cell's detail.
                const actualCell = meta.kind === "date" && meta.actual !== undefined ? row?.cells.get(meta.actual) : undefined;
                const when = meta.kind === "date" && meta.level !== undefined && row !== undefined
                    ? { level: meta.level(row.cells), actual: actualCell?.type === "DateTime" ? actualCell.value : undefined }
                    : undefined;
                const detail = row !== undefined ? cellDetail(meta, row.cells) : undefined;
                return (
                    <Box
                        key={meta.key}
                        css={styles.cell}
                        data-slot="cell"
                        data-key={meta.key}
                        data-kind={meta.kind}
                        data-editable={meta.editable ? "" : undefined}
                        data-invalid={cell?.type === "Invalid" ? "" : undefined}
                        data-value={meta.kind === "enum" && cell?.type === "String" ? cell.value : undefined}
                        aria-invalid={issue !== undefined ? true : undefined}
                        aria-describedby={issue !== undefined ? issueId : undefined}
                        title={issue ?? detail?.title}
                        data-selected={selected ? "" : undefined}
                        data-blank={cellIsBlank(cell) ? "" : undefined}
                        data-proposed={fill !== undefined ? "" : undefined}
                        data-next-target={isTarget ? "" : undefined}
                        role="gridcell"
                        onMouseDown={(e) => props.onCellDown(r, c, e)}
                        onDoubleClick={() => props.onCellDouble(r, c)}
                        onMouseEnter={() => props.onCellEnter(r, c)}
                    >
                        {issue !== undefined && <Box as="span" css={styles.cellIssue} id={issueId}>{issue}</Box>}
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
                            when={when}
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

// ── Sub rows under a line (#844) ──

export interface SheetSubRowProps {
    styles: Styles;
    /** The row's least height (px); it grows when its detail wraps. */
    subRowPx: number;
    subRow: SheetSubRowValue;
    /** Its line's number in the group — the index reads `{line}.{n}`. */
    parent: number;
    /** Its index under the line, and how many the line has (the last ends the tree). */
    index: number;
    count: number;
    /** A lens hit through this row's own text. */
    hit: boolean;
    /** The gutter's width (px) — the well starts at its edge. */
    gutterPx: number;
    /** The width of the view (px): the well's content stays inside it while the columns scroll sideways. */
    viewPx: number | undefined;
    membership?: SheetMembership | undefined;
    /** Its line was just opened: it drops in, this far into the cascade. */
    entering?: number | undefined;
}

/**
 * One sub row of an open line. It shares none of the line's columns: the
 * gutter holds the tree — the stem from the line's chevron, an elbow into
 * this row, the last row's stem stopping at its middle — and the index
 * `{line}.{n}` on the surface; then ONE grey well spans the rest. The well
 * reads left to right: the LEAD (a code and a name; with no detail beside it
 * the name runs on past the lead rather than wrap inside it), the DETAIL (chips,
 * then labelled facets; it wraps and the row grows, never truncated), and
 * the ID pinned right so ids align down the sheet. The well's content stays
 * at the view's left edge as the columns scroll sideways. Read-only, and
 * outside the row space: the ring never lands on it.
 */
export const SheetSubRow = memo(function SheetSubRow({ styles, subRowPx, subRow, parent, index, count, hit, gutterPx, viewPx, membership, entering }: SheetSubRowProps) {
    const last = index === count - 1;
    const detail = subRow.chips.length > 0 || subRow.facets.length > 0;
    const self = useRef<HTMLDivElement | null>(null);
    useArrival(self, entering);
    return (
        <Box
            ref={self}
            css={styles.subRow}
            style={{ minHeight: `${subRowPx}px` }}
            data-slot="subRow"
            data-sub-row=""
            data-detail={detail ? "" : undefined}
            data-last={last ? "" : undefined}
            data-hit={hit ? "" : undefined}
            role="row"
        >
            <Box css={styles.subRowGutter} data-slot="gutter" style={{ width: `${gutterPx}px` }}>
                <Rail styles={styles} membership={membership} picked={false} mixed={false} selectable={false} label="" onPick={() => {}} />
                <Box as="span" css={styles.subRowIndex} data-slot="subRowIndex">{`${parent}.${index + 1}`}</Box>
            </Box>
            <Box css={styles.subRowWell} data-slot="subRowWell" role="gridcell">
                <Box css={styles.subRowContent} data-slot="subRowContent"
                    style={{ left: `${gutterPx}px`, ...(viewPx !== undefined ? { maxWidth: `${Math.max(0, viewPx - gutterPx)}px` } : {}) }}>
                    <Box css={styles.subRowLead} data-slot="subRowLead">
                        {subRow.code !== "" && <Box as="span" css={styles.subRowCode} data-slot="subRowCode">{subRow.code}</Box>}
                        <Box as="span" css={styles.subRowName} data-slot="subRowName">{subRow.name}</Box>
                    </Box>
                    {detail && <Box css={styles.subRowDetail} data-slot="subRowDetail">
                        {subRow.chips.map((c, i) => <Box key={`c${i}`} as="span" css={styles.subRowChip} data-slot="subRowChip">{c}</Box>)}
                        {subRow.facets.map((f, i) => (
                            <Box key={`f${i}`} as="span" css={styles.subRowFacet} data-slot="subRowFacet">
                                <Box as="span" css={styles.subRowFacetLabel} data-slot="subRowFacetLabel">{f.label}</Box>
                                <Box as="span" css={styles.subRowFacetValue} data-slot="subRowFacetValue">{f.value}</Box>
                            </Box>
                        ))}
                    </Box>}
                    {subRow.id !== "" && <Box as="span" css={styles.subRowId} data-slot="subRowId">{subRow.id}</Box>}
                </Box>
            </Box>
        </Box>
    );
});

export interface SheetProposalRowProps {
    styles: Styles;
    insertion?: ReactNode;
    insertPreview?: "row" | "group" | undefined;
    columns: SheetColumnIndex;
    registers: SheetRegisterIndex;
    driverColumn: string | undefined;
    gridTemplate: string;
    rowPx: number;
    /** The proposal's index under its anchor. */
    index: number;
    /** The 1-based row number it would take. */
    number: number;
    /** Proposed under a grouped line. */
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
    const { styles, columns, registers, driverColumn, gridTemplate, rowPx, index, number, cells, meta, picked, linkCtx } = props;
    const pseudo: SheetRowValue = { id: "", owned: false, cells: cells as Map<string, SheetCellValue>, lines: [], band: none, subRows: [] };
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
            <Box css={styles.gutter} data-slot="gutter" onMouseDown={pick} title="Suggested row — ✓ adds it, × rejects it">
                <Rail styles={styles} membership={props.grouped ? { id: "", color: 0, above: true, below: true } : undefined} picked={picked} mixed={false} selectable
                    label="Select this suggested row" onPick={pick} />
                <Box as="span" css={styles.gutterNumber} data-slot="gutterNumber">{number}</Box>
                <Box css={styles.gutterAction} data-slot="proposalActions">
                    <Box
                        as="span"
                        css={styles.gutterButton}
                        data-slot="accept"
                        data-kind="accept"
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
                        data-kind="reject"
                        role="button"
                        aria-label="Reject this suggestion"
                        title="Reject — not offered after this activity again — ⌫"
                        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); props.onReject(index); }}
                    >
                        <FontAwesomeIcon icon={faXmark} />
                    </Box>
                </Box>
            </Box>
            {columns.list.map((colMeta) => {
                const cell = cells.get(colMeta.key);
                const unit = colMeta.kind === "quantity" && driverKey !== undefined ? colMeta.uom?.get(driverKey) : undefined;
                const member = colMeta.kind === "enum" && cell?.type === "String" ? resolveMember(registers, colMeta.register, cell.value) : undefined;
                const when = colMeta.kind === "date" && colMeta.level !== undefined ? { level: colMeta.level(cells) } : undefined;
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
                            when={when}
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
}

/**
 * A run the lens hides (B§8): 22 px, a dashed rule, the `n hidden` pill —
 * hover opens `⌃ +1 · n hidden · +1 ⌄ · all`, each press reaching further
 * from the top, the bottom, or both.
 */
export const SheetGapRow = memo(function SheetGapRow({ styles, gap, reach, onReveal }: SheetGapRowProps) {
    const press = (where: "top" | "bottom" | "both" | "all") => (e: MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        onReveal(gap, where);
    };
    const middle = gap.first ? "bottom" : gap.last ? "top" : "both";
    // A run inside a group (#740) is bounded by line numbers, not sheet rows.
    const above = isLinePosition(gap.from) ? lineNumberOf(gap.from) - 1 : gap.from;
    const below = isLinePosition(gap.to) ? lineNumberOf(gap.to) + 1 : gap.to + 2;
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
    insertion?: ReactNode;
    insertPreview?: "row" | "group" | undefined;
    insertSide?: "gutter" | "body" | undefined;
    columns: SheetColumnIndex;
    registers: SheetRegisterIndex;
    gridTemplate: string;
    /** The band's height (px). */
    bandPx: number;
    /** The row-space index. */
    r: number;
    number: number;
    membership?: SheetMembership | undefined;
    /** The group's wire row — its band cells under {@link TITLE_KEY} and the line columns. */
    row: SheetRowValue;
    /** The band's cells and the title span. */
    group: SheetGroupIndex;
    folded: boolean;
    /** The group's line count. */
    count: number;
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
    /** Some of the group's lines are picked: the band's checkbox goes indeterminate. */
    mixed?: boolean | undefined;
    /** The editor, when it sits on this band: the column and the element. */
    editor: { c: number; node: ReactNode } | undefined;
    onCellDown: (r: number, c: number, e: MouseEvent) => void;
    onCellDouble: (r: number, c: number) => void;
    onCellEnter: (r: number, c: number) => void;
    /** The gutter: selects the group's lines. */
    onRowPick: (r: number, e: MouseEvent) => void;
    /** The chevron; `all` (⌥ held) applies the band's new state to every group. */
    onFold: (r: number, all?: boolean) => void;
    draft?: DraftPresentation | undefined;
    onDiscard?: (() => void) | undefined;
}

/** Renders one full-width summary with a fold control and independent metadata. */
export const SheetGroupRow = memo(function SheetGroupRow(props: SheetGroupRowProps) {
    const { styles, columns, registers, gridTemplate, bandPx, r, row, group, folded, count, first, sticky, selC, range, picked, editor } = props;
    const titleCell = row.cells.get(TITLE_KEY);
    const title = titleCell !== undefined && titleCell.type === "String" ? titleCell.value : "";
    const sub = getSomeorUndefined(row.band)?.sub ?? "";
    const span = group.titleSpan;
    const titleMeta = group.cells.get(TITLE_KEY);
    const titleSelected = selC !== undefined && selC < span && editor === undefined;
    const titleEditing = editor !== undefined && editor.c < span;
    const word = group.noun.singular;
    return (
        <Box
            css={styles.groupRow}
            style={{ gridTemplateColumns: gridTemplate, minHeight: `${bandPx}px` }}
            data-slot={sticky === true ? "stickyBand" : "row"}
            data-band-row=""
            data-draft={props.draft?.pending ? "" : undefined}
            data-invalid={props.draft?.invalid ? "" : undefined}
            data-incomplete={props.draft?.incomplete ? "" : undefined}
            data-insert-preview={props.insertPreview}
            data-insert-side={props.insertPreview !== undefined ? props.insertSide : undefined}
            data-row={r}
            data-row-id={row.id}
            data-folded={folded ? "" : undefined}
            data-owned={row.owned ? "" : undefined}
            data-first={first ? "" : undefined}
            data-picked={picked ? "" : undefined}
            role="row"
            aria-expanded={!folded}
        >
            <Box css={styles.gutter} data-slot="gutter" onMouseDown={(e) => props.onRowPick(r, e)} title={`Select the ${word}'s lines — delete removes them`}>
                {props.insertion}
                <Rail styles={styles} membership={props.membership} picked={picked} mixed={props.mixed === true} selectable
                    label={`Select ${word} ${title}`} onPick={(event) => props.onRowPick(r, event)} />
                <Box as="span" css={styles.gutterNumber} data-slot="gutterNumber">{props.number}</Box>
                <Box css={styles.gutterAction} data-slot="fillSlot">
                    {props.draft?.discardable && <chakra.button
                        type="button" css={styles.gutterButton}
                        data-slot="discardDraft" data-kind="discard" aria-label={`Discard new ${word}`} title={`Discard new ${word}`}
                        onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
                        onClick={(event) => { event.stopPropagation(); props.onDiscard?.(); }}
                    ><FontAwesomeIcon icon={faXmark} /></chakra.button>}
                </Box>
            </Box>
            <Box css={styles.groupSummary} data-slot="groupSummary" role="gridcell" aria-colspan={columns.list.length}
                style={{ gridColumn: `span ${Math.max(1, columns.list.length)}` }}>
                <chakra.button type="button" css={styles.groupChevron} data-slot="fold"
                    aria-label={folded ? `Open the ${word}` : `Fold the ${word}`} aria-expanded={!folded}
                    title={folded ? "Open — Space · ⌥ opens all" : "Fold — Space · ⌥ folds all"}
                    onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); props.onFold(r, event.altKey); }}
                    onClick={(event) => { if (event.detail === 0) props.onFold(r, event.altKey); }}>
                    <Chevron />
                </chakra.button>
                <Box
                    css={styles.groupTitle}
                    data-slot="cell"
                    data-key={TITLE_KEY}
                    data-kind="text"
                    data-selected={titleSelected ? "" : undefined}
                    role="group"
                    onMouseDown={(e) => props.onCellDown(r, 0, e)}
                    onDoubleClick={() => props.onCellDouble(r, 0)}
                    onMouseEnter={() => props.onCellEnter(r, 0)}
                >
                    {range !== undefined && range.c0 < span && <Box css={styles.rangeWash} data-slot="rangeWash" />}
                    <Box as="span" css={styles.groupTitleText} data-slot="groupTitle">{title === "" && titleMeta !== undefined ? "Untitled" : title}</Box>
                    {titleSelected && <Box css={styles.ring} data-slot="ring" />}
                    {titleEditing && editor.node}
                </Box>
                {sub !== "" && <Box as="span" css={styles.groupSub} data-slot="groupSub">{sub}</Box>}
                <Box as="span" css={styles.groupCount} data-slot="groupCount">{count}</Box>
                {columns.list.map((colMeta, c) => {
                    if (c < span) return null;
                    const meta = group.cells.get(colMeta.key);
                    if (meta === undefined) return null;
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
                            role="group"
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
        </Box>
    );
});

/** The tone of an enum member, exported for the gutter's future status dot. */
export function memberTone(registers: SheetRegisterIndex, register: string | undefined, key: string): string | undefined {
    const m = resolveMember(registers, register, key);
    return m !== undefined ? getSomeorUndefined(m.tone)?.type : undefined;
}
