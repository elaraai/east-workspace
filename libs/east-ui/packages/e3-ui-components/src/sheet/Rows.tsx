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
 *
 * Where the sheet takes drops (#1187), each row, line and band is a drop
 * target and, when it moves, carries a grip in its gutter's actions column.
 *
 * A FOLDED gutter (#1215) — a coarse pointer's, in a frame too narrow for its
 * actions beside a cell — holds one row-actions button in place of the
 * actions column: the row's grip, and a tap's menu of its decisions and its
 * inserts.
 */

import { memo, useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import { Box, chakra, Menu as ChakraMenu, Portal, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRight, faCheck, faChevronRight, faEllipsisVertical, faGripVertical, faMinus, faXmark } from "@fortawesome/free-solid-svg-icons";
import { none } from "@elaraai/east";
import {
    getSomeorUndefined, optimiseMessages, useDragEventChip, useDropCell, type CellCoord, type DragHandle, type DragPayload, type DropCellOptions,
} from "@elaraai/east-ui-components";
import { EastErrorBoundary, UnloadedRun, loadingLineText, type PlaceholderKind, type RunCell } from "@elaraai/east-ui-components/internal";
import {
    BAND_MIN_PX, TITLE_KEY, cellIsBlank, cellText, driverKeyOf, resolveMember,
    type LineGroup, type SheetBand, type SheetColumnIndex, type SheetColumnMeta, type SheetGroupIndex, type SheetKind, type SheetRegisterIndex, type SheetWindowFailure,
} from "./model.js";
import { SheetCellContent, type LinkCellContext } from "./cells/Cell.js";
import { cellDetail } from "./detail.js";
import type { PendingFill } from "./sheet-types.js";
import type { SheetCellValue, SheetNounValue, SheetRowValue, SheetSubRowValue } from "./values.js";
import type { DraftPresentation } from "./draft-state.js";
import type { SheetMembership } from "./membership.js";
import type { SheetCellOp, SheetRowMarks } from "./optimise.js";
import { SheetInsertPoint } from "./Insertion.js";
import type { SheetRowDrop } from "./drop.js";
import { useSheetWords } from "./words.js";

type Styles = Record<string, Record<string, unknown>>;

/**
 * Test-only render probe (#858) — lets "a gesture re-renders only the rows it
 * touches" be asserted as WHICH rows rendered, deterministically: a line or a
 * band reports its row-space index as it renders, and a copy that sticks under
 * the header says it is one. `undefined` outside tests; the call is a single
 * optional invocation. The Plan's `setBodyRowRenderProbe` (#815).
 */
let sheetRowRenderProbe: ((r: number, copy: boolean) => void) | undefined;
/** Install (or clear) the test render probe. Test use only. */
export function setSheetRowRenderProbe(fn: ((r: number, copy: boolean) => void) | undefined): void {
    sheetRowRenderProbe = fn;
}

// The gutter is three columns with three jobs — RAIL (select: a 14 px
// checkbox on a 1 px connector) · NUMBER · ACTIONS (decide: 24 px ghost
// buttons, Font Awesome 13 px). Inserts are not gutter content: both chips
// float at the row boundary, threaded on the insertion line
// (`Insertion.tsx`). A group's identity is its band plus the connector;
// brand appears only for selection and insertion.

/**
 * The chevron: Font Awesome's chevron-right on a line's number and a group's
 * band alike (#1263), in the recipe's 10 px box. It always points right; its
 * button turns it down when open (the recipe's `rotate`), so opening and
 * folding turn it rather than swap it.
 */
function Chevron() {
    return <FontAwesomeIcon icon={faChevronRight} aria-hidden />;
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

/**
 * The rail: the connector behind, the checkbox on top (none on a blank row).
 * A group's checkbox goes indeterminate while some of its lines are picked.
 * Like every control inside the grid it is out of the tab order (#860): the
 * grid is one tab stop, and its keys reach what the controls do (⇧ with the
 * arrows, Home and End stretches a range over whole rows).
 */
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
        {selectable && <chakra.button type="button" css={styles.checkbox} data-slot="checkbox" tabIndex={-1}
            aria-label={label} title={label} aria-pressed={picked} data-mixed={mixed && !picked ? "" : undefined}
            onMouseDown={(event) => { event.stopPropagation(); event.preventDefault(); }}
            onClick={(event) => { event.stopPropagation(); onPick(event); }}>
            {picked ? <FontAwesomeIcon icon={faCheck} /> : mixed ? <FontAwesomeIcon icon={faMinus} /> : null}
        </chakra.button>}
    </Box>;
}

/**
 * A row's part in drag and drop (#1187): its drop cell on the sheet's surface
 * — the seam the pointer's half picks, or the row itself for an author's
 * card — and, when it moves, its grip, carrying a ghost that names it. With
 * no drops, the row registers nothing and has no grip.
 *
 * @param self - The row's element
 * @param drop - The sheet's drops, when it takes them
 * @param dropRow - The row as its drop names it
 * @param movable - Whether its grip moves it
 * @param label - The row's name, as its gutter names it: what its ghost says, and the drag layer's announcements
 * @param ghostCss - The ghost's style
 * @returns The ref the row's element takes, and the grip's handle while it moves
 */
function useRowDrop(self: RefObject<HTMLDivElement | null>, drop: SheetRowDrop | undefined, dropRow: string | undefined, movable: boolean,
    label: string, ghostCss: Record<string, unknown> | undefined): { ref: (el: HTMLDivElement | null) => void; grip: DragHandle | undefined } {
    // Registered at its seam below — the drag-start sweep's question; where a drag rests, the pointer's half answers.
    const coord = useMemo((): CellCoord | null => (drop !== undefined && dropRow !== undefined ? { surface: drop.surface, row: dropRow, slot: "after" } : null), [drop, dropRow]);
    const resolveCoord = useCallback((_x: number, y: number, payload: DragPayload): CellCoord => {
        const box = self.current?.getBoundingClientRect();
        return { surface: drop?.surface ?? "", row: dropRow ?? "", slot: box === undefined || drop === undefined ? "" : drop.slotAt(payload, box, y) };
    }, [self, drop, dropRow]);
    const options = useMemo((): DropCellOptions | undefined => (drop === undefined ? undefined : {
        ...drop.options,
        onHover: (x, y, payload) => {
            const el = self.current;
            if (el !== null) drop.hover(el, resolveCoord(x, y, payload), payload);
        },
    }), [self, drop, resolveCoord]);
    const cell = useDropCell(coord, false, drop?.canDrop, coord === null ? undefined : resolveCoord, options);
    // One ref, two jobs: the row's own element, and the layer's registration.
    const ref = useCallback((el: HTMLDivElement | null) => {
        self.current = el;
        cell(el);
    }, [self, cell]);
    const from = useMemo((): Required<CellCoord> | null => (coord !== null && movable ? { ...coord, slot: "", event: coord.row } : null), [coord, movable]);
    const ghost = useMemo(() => <Box css={ghostCss} data-slot="dragGhost">{label}</Box>, [ghostCss, label]);
    const grip = useDragEventChip(from, ghost, false, label);
    return { ref, grip };
}

/**
 * A row's grip (#1187, SB44): the handle a row, a line or a band is dragged
 * to another seam by — the pointer's, and a touch's at once. Like every
 * control in the grid it is out of the tab order (#860), and a press on it
 * never picks the row.
 */
function Grip({ styles, grip, what }: { styles: Styles; grip: DragHandle; what: string }) {
    const { m } = useSheetWords();
    return (
        <Box as="span" css={styles.rowGrip} data-slot="rowGrip" data-drag-grip="" {...grip} tabIndex={-1}
            aria-label={m.dropGrip({ what })} title={m.dropGripTitle()}
            onMouseDown={(event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); }}>
            <FontAwesomeIcon icon={faGripVertical} />
        </Box>
    );
}

/**
 * What a cell a run of the optimiser changed says on hover (#1409, R7, R25):
 * `Added by Elara · run #7` for a blank given a value, `Was 12 Mar · Elara
 * run #7` for a value changed or cleared.
 *
 * @param op - The cell's operation
 * @param was - The cell before the run
 * @param meta - Its column
 * @param run - The run's number, formatted
 * @param words - The sheet's words
 * @returns The provenance
 */
function cellProvenance(op: SheetCellOp, was: SheetCellValue | undefined, meta: SheetColumnMeta, run: string, words: ReturnType<typeof useSheetWords>): string {
    if (op === "add") return optimiseMessages.entryAdded({ run });
    return optimiseMessages.entryChanged({ previous: was === undefined || cellIsBlank(was) ? "—" : cellText(was, meta, words), run });
}

/** One item of a folded gutter's menu (#1215): what it says, and what it does. */
export interface SheetRowAction {
    /** The item's key in the menu. */
    value: string;
    /** Its words — the words of the control it stands for. */
    label: string;
    /** What it does. */
    run: () => void;
}

const NO_ACTIONS: readonly SheetRowAction[] = [];

/**
 * A folded gutter's one control (#1215): the row's actions in a 44 px button.
 * A tap opens an anchored menu of what the unfolded gutter offers there — the
 * row's decisions, then the inserts at it, read as the menu opens; a drag on
 * it moves the row, as its grip does, and only a drag (`data-drag-grip="tap"`
 * waits for travel). Like every control in the grid it takes no focus (#860):
 * it has no tab stop, so a closing menu leaves the focus where its action put
 * it — a new row's editor — or hands it to the grid.
 */
function RowActions({ styles, r, grip, what, decisions, inserts }: {
    styles: Styles;
    /** The row-space index: where its inserts land. */
    r: number;
    /** The row's grip, when it moves. */
    grip: DragHandle | undefined;
    /** The row, as its grip names it. */
    what: string;
    /** The row's decisions, as its gutter offers them. */
    decisions: readonly SheetRowAction[];
    /** The inserts at a row, read when the menu opens — absent where nothing inserts. */
    inserts: ((r: number) => readonly SheetRowAction[]) | undefined;
}) {
    const { m } = useSheetWords();
    const self = useRef<HTMLElement | null>(null);
    const gripRef = grip?.ref;
    const ref = useCallback((el: HTMLElement | null) => {
        self.current = el;
        gripRef?.(el);
    }, [gripRef]);
    const [open, setOpen] = useState(false);
    if (grip === undefined && decisions.length === 0 && inserts === undefined) return null;
    const items = open ? [...decisions, ...(inserts?.(r) ?? NO_ACTIONS)] : NO_ACTIONS;
    const select = (value: string) => {
        items.find((item) => item.value === value)?.run();
        // What the action did not focus, the grid takes back from the closing menu.
        queueMicrotask(() => {
            const card = self.current?.closest<HTMLElement>("[data-sheet-card]");
            if (card != null && !card.contains(document.activeElement)) card.focus({ preventScroll: true });
        });
    };
    return (
        <ChakraMenu.Root open={open} onOpenChange={(details) => setOpen(details.open)} onSelect={(details) => select(details.value)}
            lazyMount unmountOnExit positioning={{ placement: "bottom-start" }}>
            <ChakraMenu.Trigger asChild>
                <Box as="span" css={styles.rowActions} data-slot="rowActions" data-drag-grip={grip !== undefined ? "tap" : undefined}
                    {...grip} ref={ref} role="button" tabIndex={undefined} aria-roledescription={undefined}
                    aria-label={m.rowActions({ what })} title={m.rowActionsTitle({ movable: grip !== undefined })}
                    onMouseDown={(event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); }}>
                    <FontAwesomeIcon icon={faEllipsisVertical} />
                </Box>
            </ChakraMenu.Trigger>
            <Portal>
                <ChakraMenu.Positioner>
                    <ChakraMenu.Content>
                        {items.map((item) => <ChakraMenu.Item key={item.value} value={item.value}>{item.label}</ChakraMenu.Item>)}
                    </ChakraMenu.Content>
                </ChakraMenu.Positioner>
            </Portal>
        </ChakraMenu.Root>
    );
}

/**
 * The per-row facts the row renderer is handed — primitives and references
 * that hold still, so the memo skips every row a gesture does not touch (#858).
 */
export interface SheetRowProps {
    styles: Styles;
    /** The insertion seam above the row, by the side of the gutter its chips take — `undefined` where nothing inserts. */
    seam?: "gutter" | "body" | undefined;
    /** The seam is hovered: the sheet's one insertion layer shows its chips. */
    onSeamEnter?: ((r: number, side: "gutter" | "body", hit: HTMLElement) => void) | undefined;
    /** The pointer left the seam. */
    onSeamLeave?: ((to: EventTarget | null) => void) | undefined;
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
    /** The grid's id (#860): each cell's id is `{idPrefix}-{r}-{c}`, what the grid names as its active cell. None on a copy that sticks under the header. */
    idPrefix?: string | undefined;
    /** The row's place among the grid's rows, the header first (#860). */
    ariaRowIndex?: number | undefined;
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
    /** Discard a never-applied row as an undoable gesture — the row's id, or a line's group and its key. */
    onDiscard?: ((id: string, child?: string) => void) | undefined;
    /** How many sub rows sit under this line (none: `undefined`), and whether they show. */
    subRowCount?: number | undefined;
    subRowsOpen?: boolean | undefined;
    /** The chevron: show or hide them; `all` (⌥) takes every line of the group the same way. */
    onSubRows?: ((r: number, all: boolean) => void) | undefined;
    /** The host's word for a group (#844) — the chevron's title names it. */
    noun?: SheetNounValue | undefined;
    /** The copy that sticks under the group's band while the line's sub rows scroll under it. */
    sticky?: boolean | undefined;
    /** The line's group was just unfolded: it drops in, this far into the cascade. */
    entering?: number | undefined;
    /** The sheet's drops (#1187): the row is a drop target — a builder's sheet; absent where the sheet takes none. */
    drop?: SheetRowDrop | undefined;
    /** The row as its drop names it — `SheetDropRowType`, printed. */
    dropRow?: string | undefined;
    /** Its grip moves it (SB44). */
    movable?: boolean | undefined;
    /** The gutter is folded (#1215): one row-actions button holds the row's grip, its decisions and its inserts. */
    foldedGutter?: boolean | undefined;
    /** A folded gutter's inserts at a row, read when its menu opens — absent where nothing inserts. Stable. */
    inserts?: ((r: number) => readonly SheetRowAction[]) | undefined;
    /** What a run of the optimiser left on the row (#1409, R25), while it is the run's draft: each changed cell's mark, and its provenance on hover. */
    marks?: SheetRowMarks | undefined;
}

/** Renders one row. */
export const SheetRow = memo(function SheetRow(props: SheetRowProps) {
    const { styles, columns, registers, driverColumn, gridTemplate, rowPx, r, number, row, group, linkCtx, selC, range, picked, hit, editor, fills, nextTargetC, hoverC, first, seam, subRowCount } = props;
    sheetRowRenderProbe?.(r, props.sticky === true);
    const subRowsOpen = props.subRowsOpen === true;
    // The row's words, its counts in the app's locale (#850, #861).
    const words = useSheetWords();
    const { m } = words;
    const issuePrefix = useId();
    const self = useRef<HTMLDivElement | null>(null);
    useArrival(self, props.entering);
    const invalid = props.draft?.invalid === true || (row !== undefined && [...row.cells.values()].some(cell => cell.type === "Invalid"));
    const rowBlank = row === undefined;
    const groupTitle = group?.row.cells.get(TITLE_KEY);
    const groupName = group === undefined ? undefined : groupTitle?.type === "String" ? groupTitle.value : group.row.id;
    const driverKey = driverKeyOf(row, driverColumn);
    const hasFills = fills !== undefined && fills.size > 0;
    // The row as its grip's name says it — `row 3`, `line 2 of WO-2201 · Kitchen, oak` — and as its gutter names it, what its ghost and the announcements say.
    const noun = props.noun?.singular ?? m.groupNoun();
    const what = group !== undefined
        ? m.inspectorWhat({ what: "line", number: String(number), title: groupTitle?.type === "String" && groupTitle.value !== "" ? groupTitle.value : undefined, noun })
        : m.inspectorWhat({ what: "row", number: String(number), title: undefined, noun });
    const label = groupName !== undefined ? m.lineName({ number: String(number), group: groupName }) : m.rowName({ number: String(number) });
    const { ref: rowRef, grip } = useRowDrop(self, props.drop, props.dropRow, props.movable === true && !rowBlank, label, styles.dragGhost);
    // The row's discard — its gutter's ×, or its folded menu's item.
    const discard = () => {
        if (group !== undefined) props.onDiscard?.(group.row.id, group.key);
        else if (row !== undefined) props.onDiscard?.(row.id);
    };
    // What a run of the optimiser left on the row's cells (#1409, R25), while the row is still the run's draft.
    const marks = props.draft?.pending === true ? props.marks : undefined;
    return (
        <Box
            ref={rowRef}
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
            data-sub-rows-open={subRowsOpen ? "" : undefined}
            role="row"
            aria-rowindex={props.ariaRowIndex}
        >
            <Box
                css={styles.gutter}
                data-slot="gutter"
                role="rowheader"
                aria-colindex={1}
                aria-label={groupName !== undefined ? m.lineName({ number: String(number), group: groupName }) : m.rowName({ number: String(number) })}
                onMouseDown={(e) => props.onRowPick(r, e)}
                title={m.rowTitle({ fills: hasFills })}
            >
                {seam !== undefined && props.onSeamEnter !== undefined && props.onSeamLeave !== undefined && (
                    <SheetInsertPoint styles={styles} side={seam} onEnter={(hit) => props.onSeamEnter?.(r, seam, hit)} onLeave={props.onSeamLeave} />
                )}
                <Rail styles={styles} membership={rowBlank ? undefined : props.membership} picked={picked} mixed={false} selectable={!rowBlank}
                    label={m.selectRow({ number: String(number), group: groupName })}
                    onPick={(event) => props.onRowPick(r, event)} />
                <Box as="span" css={styles.gutterNumber} data-slot="gutterNumber" data-hit={hit ? "" : undefined} data-blank={rowBlank ? "" : undefined}
                    data-chevron={subRowCount !== undefined ? "" : undefined}>
                    {/* A line with sub rows: the chevron before its number shows or hides them (⌥ every line of the group); open, the tree's stem starts just under it. The number keeps clear of it. */}
                    {subRowCount !== undefined && (
                        <chakra.button type="button" css={styles.subRowChevron} data-slot="subRowChevron" data-open={subRowsOpen ? "" : undefined} tabIndex={-1}
                            aria-expanded={subRowsOpen}
                            aria-label={m.subRows({ open: subRowsOpen, n: subRowCount, count: words.number(subRowCount), line: String(number) })}
                            title={m.subRowsTitle({ open: subRowsOpen, n: subRowCount, count: words.number(subRowCount), noun: props.noun?.singular ?? m.groupNoun() })}
                            onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); props.onSubRows?.(r, event.altKey); }}
                            onClick={(event) => { if (event.detail === 0) props.onSubRows?.(r, event.altKey); }}>
                            <Chevron />
                        </chakra.button>
                    )}
                    {subRowsOpen && <Box as="span" css={styles.subRowStem} data-slot="subRowStem" aria-hidden="true" />}
                    {number}
                </Box>
                {props.foldedGutter === true ? (
                    <RowActions styles={styles} r={r} grip={grip} what={what} inserts={rowBlank ? undefined : props.inserts}
                        decisions={[
                            ...(hasFills ? [{ value: "fill", label: m.fillRow(), run: props.onFillRow }] : []),
                            ...(props.draft?.discardable ? [{ value: "discard", label: m.discardRow(), run: discard }] : []),
                        ]} />
                ) : (
                    <Box css={styles.gutterAction} data-slot="fillSlot">
                        {grip !== undefined && <Grip styles={styles} grip={grip} what={what} />}
                        {hasFills && (
                            <Box
                                as="span"
                                css={styles.gutterButton}
                                data-slot="fillRow"
                                data-kind="apply"
                                role="button"
                                aria-label={m.fillRow()}
                                title={m.fillRowTitle()}
                                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); props.onFillRow(); }}
                            >
                                <FontAwesomeIcon icon={faArrowRight} />
                            </Box>
                        )}
                        {props.draft?.discardable && <chakra.button
                            type="button" css={styles.gutterButton} tabIndex={-1}
                            data-slot="discardDraft" data-kind="discard" aria-label={m.discardRow()} title={m.discardRow()}
                            onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
                            onClick={(event) => { event.stopPropagation(); discard(); }}
                        ><FontAwesomeIcon icon={faXmark} /></chakra.button>}
                    </Box>
                )}
            </Box>
            {columns.list.map((meta, c) => {
                const cell: SheetCellValue | undefined = row?.cells.get(meta.key);
                const issue = cell?.type === "Invalid" ? m.issueInvalid({ value: cell.value }) : props.draft?.issues.get(meta.key);
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
                const detail = row !== undefined ? cellDetail(meta, row.cells, words) : undefined;
                const op = marks?.cells.get(meta.key);
                const provenance = op === undefined || marks === undefined ? undefined : cellProvenance(op, marks.previous.get(meta.key), meta, marks.run, words);
                const title = issue ?? (provenance === undefined ? detail?.title : detail?.title === undefined ? provenance : `${provenance} · ${detail.title}`);
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
                        data-op={op}
                        data-fill={op !== undefined ? "cell" : undefined}
                        aria-invalid={issue !== undefined ? true : undefined}
                        aria-describedby={issue !== undefined ? issueId : undefined}
                        title={title}
                        data-selected={selected ? "" : undefined}
                        data-blank={cellIsBlank(cell) ? "" : undefined}
                        data-proposed={fill !== undefined ? "" : undefined}
                        data-next-target={isTarget ? "" : undefined}
                        role="gridcell"
                        id={props.idPrefix !== undefined ? `${props.idPrefix}-${r}-${c}` : undefined}
                        aria-colindex={c + 2}
                        aria-selected={selC === c || inRange}
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
                            marked={op !== undefined}
                        />
                        {isTarget && <Box css={styles.nextTarget} data-slot="nextTarget" aria-hidden="true" />}
                        {fill !== undefined && hoverC === c && (
                            <Box
                                as="span"
                                css={styles.takeButton}
                                data-slot="take"
                                role="button"
                                aria-label={m.take({ header: meta.header })}
                                title={m.takeTitle({ meta: fill.meta === "" ? undefined : fill.meta })}
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
    /** The gutter's width (px) — the well starts at its edge. */
    gutterPx: number;
    /** The width of the view (px): the well's content stays inside it while the columns scroll sideways. */
    viewPx: number | undefined;
    membership?: SheetMembership | undefined;
    /** Its line was just opened: it drops in, this far into the cascade. */
    entering?: number | undefined;
    /** The row's place among the grid's rows, the header first (#860). */
    ariaRowIndex?: number | undefined;
    /** How many columns the well spans (#860). */
    colCount: number;
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
export const SheetSubRow = memo(function SheetSubRow({ styles, subRowPx, subRow, parent, index, count, gutterPx, viewPx, membership, entering, ariaRowIndex, colCount }: SheetSubRowProps) {
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
            role="row"
            aria-rowindex={ariaRowIndex}
        >
            <Box css={styles.subRowGutter} data-slot="gutter" role="rowheader" aria-colindex={1} style={{ width: `${gutterPx}px` }}>
                <Rail styles={styles} membership={membership} picked={false} mixed={false} selectable={false} label="" onPick={() => {}} />
                <Box as="span" css={styles.subRowIndex} data-slot="subRowIndex">{`${parent}.${index + 1}`}</Box>
            </Box>
            <Box css={styles.subRowWell} data-slot="subRowWell" role="gridcell" aria-colindex={2} aria-colspan={Math.max(1, colCount)}>
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
    /** The row's place among the grid's rows on a grouped sheet (#860); a flat sheet's proposal has no source position, so none. */
    ariaRowIndex?: number | undefined;
    /** The gutter is folded (#1215): ✓ and × are its row-actions button's menu. */
    foldedGutter?: boolean | undefined;
}

/** A proposed row (B§5.2): dashed-topped, hatched, real numbers; ✓ adds it, × rejects it. */
export const SheetProposalRow = memo(function SheetProposalRow(props: SheetProposalRowProps) {
    const { styles, columns, registers, driverColumn, gridTemplate, rowPx, index, number, cells, meta, picked, linkCtx } = props;
    // The suggestion's words (#861).
    const { m } = useSheetWords();
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
            aria-rowindex={props.ariaRowIndex}
            title={meta}
        >
            <Box css={styles.gutter} data-slot="gutter" role="rowheader" aria-colindex={1} aria-label={m.proposalName({ number: String(number) })} onMouseDown={pick} title={m.proposalTitle()}>
                <Rail styles={styles} membership={props.grouped ? { id: "", color: 0, above: true, below: true } : undefined} picked={picked} mixed={false} selectable
                    label={m.proposalSelect()} onPick={pick} />
                <Box as="span" css={styles.gutterNumber} data-slot="gutterNumber">{number}</Box>
                {props.foldedGutter === true ? (
                    <RowActions styles={styles} r={-1} grip={undefined} what={m.proposalName({ number: String(number) })} inserts={undefined}
                        decisions={[
                            { value: "accept", label: m.proposalAccept(), run: () => props.onAccept(index) },
                            { value: "reject", label: m.proposalReject(), run: () => props.onReject(index) },
                        ]} />
                ) : (
                    <Box css={styles.gutterAction} data-slot="proposalActions">
                        <Box
                            as="span"
                            css={styles.gutterButton}
                            data-slot="accept"
                            data-kind="accept"
                            role="button"
                            aria-label={m.proposalAccept()}
                            title={m.proposalAcceptTitle()}
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
                            aria-label={m.proposalReject()}
                            title={m.proposalRejectTitle()}
                            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); props.onReject(index); }}
                        >
                            <FontAwesomeIcon icon={faXmark} />
                        </Box>
                    </Box>
                )}
            </Box>
            {columns.list.map((colMeta, c) => {
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
                        aria-colindex={c + 2}
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

/** A recipe slot's styles, as the shared run merges them over its own. */
const slot = (styles: Styles, name: string): SystemStyleObject | undefined => styles[name] as SystemStyleObject | undefined;

/** What a column's cells hold before their rows land (#1398): the issue's shape by the column's kind. */
const RUN_KINDS: Readonly<Record<SheetKind, PlaceholderKind>> = {
    text: "text", lookup: "text", reference: "text", custom: "text",
    date: "date", stamped: "date",
    quantity: "number", integer: "number",
    enum: "enum", set: "chip", link: "link",
};

export interface SheetRunRowProps {
    styles: Styles;
    /** The run's place among the grid's rows, the header first: where its first element would be (#860). */
    ariaRowIndex?: number | undefined;
    /** A paged source's unloaded run, or a stretch of the record the lens is still reading (#1349). */
    band?: SheetBand | undefined;
    /** A window whose read failed (#853): the run said once, with its Retry (CL11). */
    failure?: SheetWindowFailure | undefined;
    /** Whether the run's rows are in flight: it is the region being read (`aria-busy`). */
    loading: boolean;
    /** The rows' grid tracks: the gutter, then each column's. */
    gridTemplate: string;
    /** The columns the grid draws. */
    columns: SheetColumnIndex;
    /** A row's height, px: the density's pitch. */
    rowPx: number;
    /** A grouped sheet's band height, px: each element a band, then its lines at the row's pitch; absent, a flat sheet. */
    bandPx?: number | undefined;
    /** Compact rows. */
    dense: boolean;
    /** What the rail counts the rows in — `work orders`: what a failed run's line names them by. */
    noun: string;
    /** Ask a failed window again. */
    onRetry: (w: number) => void;
}

/**
 * A run of the sheet's rows not drawn yet (#1398, CL2) — a paged source's
 * unloaded run, a stretch of the record the lens is still reading or placing
 * (#1349), or a window whose read failed (#853) — as the shared
 * `UnloadedRun`: rows at the density's pitch where the run meets the view,
 * with the sheet's own gutter, columns and rules, each cell its column kind's
 * placeholder. A flat sheet's runs keep their real row numbers. A lens
 * stretch stands for the narrowing's rows in it — as many placeholders as it
 * holds matches, at the pitch they land at — whose numbers are not known
 * until they are read, so its numbers are short bars, as a grouped sheet's
 * lines are, under a band of the band's height. A failed window is said once,
 * in its first row in view, with Retry; its other rows keep their numbers and
 * rules and carry nothing else (CL11). Its height is the ledger's slot, so the
 * rows that replace it take the same space. To the grid it is one row at its
 * first element's place, its one cell across the grid (#860), busy while its
 * rows are read; its placeholders are `aria-hidden`, and a failed run's line
 * is the cell instead (CL12).
 */
export const SheetRunRow = memo(function SheetRunRow({
    styles, band, failure, loading, gridTemplate, columns, rowPx, bandPx, dense, noun, onRetry, ariaRowIndex,
}: SheetRunRowProps) {
    const words = useSheetWords();
    const { m } = words;
    const from = failure?.from ?? band?.from ?? 0;
    const to = failure?.to ?? band?.to ?? -1;
    // The elements it stands for: every one it covers, or under the lens the narrowing's rows among them.
    const elements = failure !== undefined ? failure.elements : band?.elements;
    const n = elements ?? Math.max(0, to - from + 1);
    const px = Math.max(BAND_MIN_PX, failure?.px ?? band?.px ?? 0);
    // The gutter, then each column's cells: the column kind's shape on the sheet's own cell rules.
    const cells = useMemo((): RunCell[] => [
        { kind: "rowNumber", css: slot(styles, "runGutter") },
        ...columns.list.map((meta): RunCell => ({ kind: RUN_KINDS[meta.kind], css: slot(styles, "runCell") })),
    ], [styles, columns]);
    // A grouped sheet's elements: a band each, then the lines the ledger's rate says an element draws.
    const group = useMemo(() => {
        if (bandPx === undefined) return undefined;
        const each = n > 0 ? px / n : px;
        return { band: bandPx, lines: Math.max(0, Math.round((each - bandPx) / rowPx)), css: slot(styles, "runBand") };
    }, [bandPx, n, px, rowPx, styles]);
    // A flat run's rows are the source's positions; a lens stretch's are not known until the lens draws them. Each is
    // numbered as the gutter numbers the row that lands in its place: 24994, never 24,994.
    const numbered = bandPx === undefined && elements === undefined;
    const rowNumber = useCallback((index: number) => String(index + 1), []);
    const range = { from: words.number(from + 1), to: words.number(to + 1) };
    const w = failure?.w;
    const failed = useMemo(() => (w === undefined ? undefined : {
        message: loadingLineText(m.lineFailed({ noun, ...range })),
        retry: { onRetry: () => onRetry(w), label: m.retry(), name: m.retryRange({ noun, ...range }) },
        from: 1,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the range is its two formatted ends
    }), [w, m, noun, range.from, range.to, onRetry]);
    // To the grid the run is one row, its one cell across the gutter and every column (#860).
    const cell = useMemo(() => ({ colIndex: 1, colSpan: columns.list.length + 1 }), [columns]);
    return (
        <Box
            css={styles.run}
            data-slot="band"
            data-band={failure !== undefined ? "failed" : band?.at}
            data-failed={w}
            data-elements={n}
            role="row"
            aria-rowindex={ariaRowIndex}
            aria-busy={loading && failure === undefined ? "true" : undefined}
        >
            <UnloadedRun height={px} pitch={rowPx} columns={gridTemplate} cells={cells} first={from}
                rowNumber={numbered ? rowNumber : undefined} rowCss={slot(styles, "runRow")} group={group} failed={failed} cell={cell} dense={dense} />
        </Box>
    );
});

export interface SheetRetryProps {
    styles: Styles;
    /** Ask again. */
    onRetry: () => void;
}

/** The whole-sheet message's Retry (#853): a source that failed before any row landed asks again through it. */
export function SheetRetry({ styles, onRetry }: SheetRetryProps) {
    const { m } = useSheetWords();
    return (
        <chakra.button type="button" css={styles.retry} data-slot="retry"
            onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
            onClick={(event) => { event.stopPropagation(); onRetry(); }}>
            {m.retry()}
        </chakra.button>
    );
}

export interface SheetRowBoundaryProps {
    styles: Styles;
    /** The row's least height (px). */
    rowPx: number;
    /** Its 1-based number — what the diagnostic names. */
    number: number;
    /** The row's data — when it changes, the boundary tries again. */
    resetKey: unknown;
    children: ReactNode;
}

/**
 * A render failure stays in its row (#853): a row that throws while it
 * renders shows as a one-row diagnostic in its place, and the rows around it
 * keep working. It resets when the row's data changes. The Plan's part
 * boundary does the same (#811).
 */
export function SheetRowBoundary({ styles, rowPx, number, resetKey, children }: SheetRowBoundaryProps) {
    const { m } = useSheetWords();
    return (
        <EastErrorBoundary
            title={`Sheet row ${number}`}
            resetKey={resetKey}
            fallback={({ message }) => (
                <Box css={styles.rowError} data-slot="rowError" data-row-error={number} role="row" style={{ minHeight: `${rowPx}px` }}>
                    <Box as="span" role="alert">{m.rowFailed({ number: String(number), reason: message })}</Box>
                </Box>
            )}
        >
            {children}
        </EastErrorBoundary>
    );
}

// ── Grouped rows (#740) ───────────────────────────────────────────────────

export interface SheetGroupRowProps {
    styles: Styles;
    /** The insertion seam above the band, by the side of the gutter its chips take — `undefined` where nothing inserts. */
    seam?: "gutter" | "body" | undefined;
    onSeamEnter?: ((r: number, side: "gutter" | "body", hit: HTMLElement) => void) | undefined;
    onSeamLeave?: ((to: EventTarget | null) => void) | undefined;
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
    /** The grid's id (#860): the title's id is `{idPrefix}-{r}-0`, a band cell's `{idPrefix}-{r}-{c}`. None on the copy that sticks under the header. */
    idPrefix?: string | undefined;
    /** The band's place among the grid's rows, the header first (#860). */
    ariaRowIndex?: number | undefined;
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
    /** Discard a never-applied group as an undoable gesture — the group's id. */
    onDiscard?: ((id: string) => void) | undefined;
    /** The sheet's drops (#1187): the band is a drop target — a builder's sheet; absent where the sheet takes none. */
    drop?: SheetRowDrop | undefined;
    /** The band as its drop names it — `SheetDropRowType`, printed. */
    dropRow?: string | undefined;
    /** Its grip moves the group (SB44). */
    movable?: boolean | undefined;
    /** The gutter is folded (#1215): one row-actions button holds the band's grip, its discard and its inserts. */
    foldedGutter?: boolean | undefined;
    /** A folded gutter's inserts at a row, read when its menu opens — absent where nothing inserts. Stable. */
    inserts?: ((r: number) => readonly SheetRowAction[]) | undefined;
    /** What a run of the optimiser left on the band's cells (#1409, R25), while the group is still the run's draft. */
    marks?: SheetRowMarks | undefined;
}

/** Renders one full-width summary with a fold control and independent metadata. */
export const SheetGroupRow = memo(function SheetGroupRow(props: SheetGroupRowProps) {
    const { styles, columns, registers, gridTemplate, bandPx, r, row, group, folded, count, first, sticky, selC, range, picked, editor, seam } = props;
    sheetRowRenderProbe?.(r, sticky === true);
    const titleCell = row.cells.get(TITLE_KEY);
    const title = titleCell !== undefined && titleCell.type === "String" ? titleCell.value : "";
    const sub = getSomeorUndefined(row.band)?.sub ?? "";
    const span = group.titleSpan;
    const titleMeta = group.cells.get(TITLE_KEY);
    const titleSelected = selC !== undefined && selC < span && editor === undefined;
    const titleEditing = editor !== undefined && editor.c < span;
    // The band's words, its line count and cells' titles in the app's locale (#850, #852, #861).
    const words = useSheetWords();
    const { m } = words;
    // The host's word for a group, else the sheet's own (#844, #861).
    const word = group.noun?.singular ?? m.groupNoun();
    // To assistive tech (#860) the band is a row: its rowheader names the
    // group and its lines, the title is its first cell — the sub line that
    // cell's description — and each band cell a cell under its column.
    const subId = useId();
    // The band as a drop target, and its group's grip (#1187): `Move order 2`, its ghost the group's title.
    const self = useRef<HTMLDivElement | null>(null);
    const what = m.inspectorWhat({ what: "band", number: String(props.number), title: title !== "" ? title : undefined, noun: word });
    const { ref: bandRef, grip } = useRowDrop(self, props.drop, props.dropRow, props.movable === true, title !== "" ? title : what, styles.dragGhost);
    // What a run of the optimiser left on the band's cells (#1409, R25), while the group is still the run's draft.
    const marks = props.draft?.pending === true ? props.marks : undefined;
    const titleOp = titleMeta === undefined ? undefined : marks?.cells.get(TITLE_KEY);
    const titleProvenance = titleOp === undefined || marks === undefined || titleMeta === undefined ? undefined : cellProvenance(titleOp, marks.previous.get(TITLE_KEY), titleMeta, marks.run, words);
    return (
        <Box
            ref={bandRef}
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
            aria-rowindex={props.ariaRowIndex}
            aria-expanded={!folded}
        >
            <Box css={styles.gutter} data-slot="gutter" role="rowheader" aria-colindex={1}
                aria-label={m.groupName({ noun: word, number: String(props.number), n: count, count: words.number(count) })}
                onMouseDown={(e) => props.onRowPick(r, e)} title={m.groupTitle({ noun: word })}>
                {seam !== undefined && props.onSeamEnter !== undefined && props.onSeamLeave !== undefined && (
                    <SheetInsertPoint styles={styles} side={seam} onEnter={(hit) => props.onSeamEnter?.(r, seam, hit)} onLeave={props.onSeamLeave} />
                )}
                <Rail styles={styles} membership={props.membership} picked={picked} mixed={props.mixed === true} selectable
                    label={m.groupSelect({ noun: word, title })} onPick={(event) => props.onRowPick(r, event)} />
                <Box as="span" css={styles.gutterNumber} data-slot="gutterNumber">{props.number}</Box>
                {props.foldedGutter === true ? (
                    <RowActions styles={styles} r={r} grip={grip} what={what} inserts={props.inserts}
                        decisions={props.draft?.discardable ? [{ value: "discard", label: m.groupDiscard({ noun: word }), run: () => props.onDiscard?.(row.id) }] : NO_ACTIONS} />
                ) : (
                    <Box css={styles.gutterAction} data-slot="fillSlot">
                        {grip !== undefined && <Grip styles={styles} grip={grip} what={what} />}
                        {props.draft?.discardable && <chakra.button
                            type="button" css={styles.gutterButton} tabIndex={-1}
                            data-slot="discardDraft" data-kind="discard" aria-label={m.groupDiscard({ noun: word })} title={m.groupDiscard({ noun: word })}
                            onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
                            onClick={(event) => { event.stopPropagation(); props.onDiscard?.(row.id); }}
                        ><FontAwesomeIcon icon={faXmark} /></chakra.button>}
                    </Box>
                )}
            </Box>
            <Box css={styles.groupSummary} data-slot="groupSummary" role="none"
                style={{ gridColumn: `span ${Math.max(1, columns.list.length)}` }}>
                {/* The row's `aria-expanded` says whether it is open, and Space folds it: the chevron is the pointer's. */}
                <chakra.button type="button" css={styles.groupChevron} data-slot="fold" tabIndex={-1} aria-hidden="true"
                    aria-label={m.groupFold({ folded, noun: word })} aria-expanded={!folded}
                    title={m.groupFoldTitle({ folded })}
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
                    data-op={titleOp}
                    data-fill={titleOp !== undefined ? "cell" : undefined}
                    title={titleProvenance}
                    role="gridcell"
                    id={props.idPrefix !== undefined ? `${props.idPrefix}-${r}-0` : undefined}
                    aria-colindex={2}
                    aria-colspan={span}
                    aria-selected={(selC !== undefined && selC < span) || (range !== undefined && range.c0 < span)}
                    aria-describedby={sub !== "" ? subId : undefined}
                    onMouseDown={(e) => props.onCellDown(r, 0, e)}
                    onDoubleClick={() => props.onCellDouble(r, 0)}
                    onMouseEnter={() => props.onCellEnter(r, 0)}
                >
                    {range !== undefined && range.c0 < span && <Box css={styles.rangeWash} data-slot="rangeWash" />}
                    <Box as="span" css={styles.groupTitleText} data-slot="groupTitle" data-op-value={titleOp !== undefined ? "" : undefined}>{title === "" && titleMeta !== undefined ? m.untitled() : title}</Box>
                    {titleSelected && <Box css={styles.ring} data-slot="ring" />}
                    {titleEditing && editor.node}
                </Box>
                {sub !== "" && <Box as="span" css={styles.groupSub} data-slot="groupSub" id={subId} aria-hidden="true">{sub}</Box>}
                <Box as="span" css={styles.groupCount} data-slot="groupCount" aria-hidden="true">{words.number(count)}</Box>
                {columns.list.map((colMeta, c) => {
                    if (c < span) return null;
                    const meta = group.cells.get(colMeta.key);
                    if (meta === undefined) return null;
                    const cell = meta !== undefined ? row.cells.get(colMeta.key) : undefined;
                    const editing = editor?.c === c;
                    const selected = selC === c && !editing;
                    const inRange = range !== undefined && c >= range.c0 && c <= range.c1;
                    const member = meta?.kind === "enum" && cell?.type === "String" ? resolveMember(registers, meta.register, cell.value) : undefined;
                    const op = marks?.cells.get(colMeta.key);
                    const provenance = op === undefined || marks === undefined ? undefined : cellProvenance(op, marks.previous.get(colMeta.key), meta, marks.run, words);
                    const bandTitle = m.bandCellTitle({ header: colMeta.header, value: cellText(cell, meta, words) });
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
                            data-op={op}
                            data-fill={op !== undefined ? "cell" : undefined}
                            role="gridcell"
                            id={props.idPrefix !== undefined ? `${props.idPrefix}-${r}-${c}` : undefined}
                            aria-colindex={c + 2}
                            aria-selected={selC === c || inRange}
                            onMouseDown={(e) => props.onCellDown(r, c, e)}
                            onDoubleClick={() => props.onCellDouble(r, c)}
                            onMouseEnter={() => props.onCellEnter(r, c)}
                            title={provenance === undefined ? bandTitle : `${provenance} · ${bandTitle}`}
                        >
                            {inRange && <Box css={styles.rangeWash} data-slot="rangeWash" />}
                            <SheetCellContent styles={styles} meta={meta} cell={cell} rowBlank={false} unit={undefined} member={member} ghost={undefined} link={undefined} marked={op !== undefined} />
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
