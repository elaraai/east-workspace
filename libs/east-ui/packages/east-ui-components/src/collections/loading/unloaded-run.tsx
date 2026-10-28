/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `UnloadedRun` (#1398, CL2) — the one placeholder of a paged collection's
 * rows not yet read: rows at the collection's real pitch, with its real
 * columns, rules and gutter, drawn only where the run meets the viewport.
 *
 * - **One item, one element a visible row.** The run is one item of its
 *   virtualizer, as tall as its ledger slot. Its rows are positioned in it
 *   from where the view is — never a sticky child of a translated or clipped
 *   band — and only those in view are drawn, so a run of fifty thousand costs
 *   what a run of twenty does. In a `VirtualRows` frame the run follows the
 *   view itself (`useRowsScroll`): drawn before paint as it mounts, and again
 *   only as a row comes into the view or leaves it; a host may hand it the
 *   view instead ({@link RunView}).
 * - **The host's own rows.** Each row lays its cells out on the host's grid
 *   tracks and takes the host's row and cell styles, so a placeholder row
 *   keeps the real column, day and lane rules and the gutter; each cell draws
 *   the shape its kind of content takes ({@link PlaceholderKind}). The Sheet's
 *   flat rows keep their real numbers ({@link UnloadedRunProps.rowNumber}).
 * - **Geometry first.** The rows, rules and numbers draw at once; the shapes
 *   only once the reveal says so (CL4): the builder's `LoadingReveal`, or
 *   `filled`.
 * - **A grouped run** repeats a band — its chevron real, its key and its count
 *   placeholders — and its lines at the run's pitch.
 * - **A failed run** says so once, in its first row in view: the reason and
 *   Retry across the row's cells from the first after its heads; its other
 *   rows keep their heads and rules and carry nothing else (CL11).
 * - **Placeholders are `aria-hidden`** (CL12): a host that keeps the run a row
 *   of its grid — a treegrid's band a keyboard moves onto — wraps it in its
 *   own row, and the run is that row's one cell across the grid
 *   ({@link UnloadedRunProps.cell}), saying nothing; a failed run's line is the
 *   cell instead, and the one thing read.
 *
 * It replaces the Sheet's `SheetBandRow` and the Plan's `WindowBand`.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { Box, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { createRowsScroll, useRowTop, useRowsScroll } from "../rows-scroll.js";
import { runRows, type RunGroup, type RunSlot, type RunView } from "./run-rows.js";
import { LoadingFailedLine, PlaceholderShape, placeholderAlign, useLoadingStyles, type LoadingRetry, type PlaceholderKind } from "./parts.js";
import { useRevealed } from "./reveal.js";

/** One cell of a run's rows: what it holds, and how the host draws it. */
export interface RunCell {
    /** What the cell holds before its value lands. */
    readonly kind: PlaceholderKind;
    /** Where its shape sits; by its kind unless given — a number at the end, a boolean in the middle. */
    readonly align?: "start" | "end" | "center" | undefined;
    /** The host's own style for the cell, merged over the run's: its real rules, padding and track. */
    readonly css?: SystemStyleObject | undefined;
    /** What the host draws over a `wash` cell, the same in every row: a plot's grid and its now line. */
    readonly overlay?: ReactNode;
}

/** A failed run: what it says once, and where its line starts. */
export interface RunFailure {
    /** The reason, in the record's noun: `Couldn't read work orders 8,301–8,500`. */
    readonly message: ReactNode;
    /** Its Retry. */
    readonly retry: LoadingRetry;
    /** The first cell the line spans, counted from 0: the cells before it — the row's heads — stay. */
    readonly from: number;
}

/** Where a host's grid holds a run that is one of its rows: the row's one cell, across the grid (#860). */
export interface RunGridCell {
    /** The cell's column, 1-based, where the grid numbers its columns (`aria-colindex`). */
    readonly colIndex?: number | undefined;
    /** How many of the grid's columns the run spans, its heads included (`aria-colspan`). */
    readonly colSpan?: number | undefined;
}

/** Props of {@link UnloadedRun}. */
export interface UnloadedRunProps {
    /** The run's height, px: its ledger slot. */
    readonly height: number;
    /** A row's height, px: the collection's declared pitch. */
    readonly pitch: number;
    /**
     * What of the run is in view, px from its top: the host's scroll offset less where the run starts ({@link runView}).
     * Absent, the run follows its own place in the view of the frame around (`useRowsScroll`), else the window's.
     */
    readonly view?: RunView | undefined;
    /** The rows' grid tracks, as the host's rows lay theirs out (`grid-template-columns`). */
    readonly columns: string;
    /** Each cell, in order. */
    readonly cells: readonly RunCell[];
    /**
     * Whether the placeholder shapes show: past the reveal's delay (CL4). The rows, rules and numbers draw either way.
     * Absent, as the builder's `LoadingReveal` says, else at once.
     */
    readonly filled?: boolean | undefined;
    /** The run's first element's place in the collection: what numbers its rows, and keys their bars. */
    readonly first: number;
    /** A flat run's real row numbers, by a row's place in the collection: the Sheet's `position + 1`. */
    readonly rowNumber?: ((index: number) => string) | undefined;
    /** The host's own style for a row, merged over the run's: its rules and its background. */
    readonly rowCss?: SystemStyleObject | undefined;
    /** A grouped run: each element a band at its own height, its key and count placeholders, then its lines at the pitch. */
    readonly group?: (RunGroup & { readonly css?: SystemStyleObject | undefined }) | undefined;
    /** A failed run: what it says once, in its first row in view. */
    readonly failed?: RunFailure | undefined;
    /**
     * The host's grid holds the run as one of its rows (CL12): the run is then that row's one cell (`gridcell`), its
     * placeholders hidden, and a failed run's line is that cell instead, from its first cell to the grid's end.
     */
    readonly cell?: RunGridCell | undefined;
    /** Compact rows: chips at 15px. */
    readonly dense?: boolean | undefined;
    /** Rows drawn either side of the view; none unless given where the host hands the view, one where the run follows it. */
    readonly overscan?: number | undefined;
}

/** Nothing in view: before a run following the view has been placed. */
const NO_VIEW: RunView = { top: 0, bottom: 0 };

/** The page's own scroll: what a run outside any frame follows. */
const PAGE = createRowsScroll();

/** A view in whole rows of `pitch`, as its frame's store compares it, by value: `top:bottom`; `""` for none. */
function rowsKey(view: RunView | undefined, pitch: number): string {
    if (view === undefined || !(pitch > 0)) return "";
    return `${Math.floor(view.top / pitch) * pitch}:${Math.ceil(view.bottom / pitch) * pitch}`;
}

/**
 * What of a run the view shows, in whole rows: the host's, or followed through
 * the frame's rows' scroll. A run its virtual frame positions reads it as it
 * renders — from the frame's scroll offset and where it placed the run
 * (`useRowTop`) — so a commit that moves the run, a window landing above it,
 * draws its rows there in that commit, never in another after it; a scroll
 * draws it again only as a row comes into the view or leaves it, and a scroll
 * inside a row draws nothing again. Elsewhere — a frame that has not placed
 * its rows yet, rows in flow, the page — it is placed before paint, from where
 * the run sits.
 */
function useRunInView(root: RefObject<HTMLElement | null>, pitch: number, given: RunView | undefined): RunView {
    const scroll = useRowsScroll() ?? PAGE;
    const rowTop = useRowTop();
    const follows = given === undefined;
    const positioned = follows && rowTop !== undefined;
    const subscribe = useCallback((cb: () => void) => (positioned ? scroll.listen(cb) : () => {}), [positioned, scroll]);
    const snapshot = useCallback(
        () => (positioned ? rowsKey(scroll.viewAt(rowTop!), pitch) : ""),
        [positioned, rowTop, scroll, pitch]);
    const placed = useSyncExternalStore(subscribe, snapshot, snapshot);
    const [own, setOwn] = useState(NO_VIEW);
    const seen = useRef(NO_VIEW);
    const measured = follows && placed === "";
    useLayoutEffect(() => {
        if (!measured) return undefined;
        const place = () => {
            const el = root.current;
            if (el === null || !(pitch > 0)) return;
            const at = scroll.view(el);
            const next = { top: Math.floor(at.top / pitch) * pitch, bottom: Math.ceil(at.bottom / pitch) * pitch };
            if (next.top === seen.current.top && next.bottom === seen.current.bottom) return;
            seen.current = next;
            setOwn(next);
        };
        place();
        return scroll.listen(place);
    }, [root, scroll, pitch, measured]);
    if (given !== undefined) return given;
    if (placed !== "") {
        const [top, bottom] = placed.split(":").map(Number);
        return { top: top!, bottom: bottom! };
    }
    return own;
}

/**
 * The placeholder of a run of rows not yet read — see the module docs.
 *
 * @param props - The run's geometry, what is in view, its cells and its state
 * @returns The run
 */
export const UnloadedRun = memo(function UnloadedRun(props: UnloadedRunProps) {
    const { height, pitch, columns, cells, first, rowNumber, rowCss, group, failed, dense, cell: grid } = props;
    const styles = useLoadingStyles();
    const root = useRef<HTMLDivElement | null>(null);
    const view = useRunInView(root, pitch, props.view);
    const revealed = useRevealed();
    const filled = props.filled ?? revealed ?? true;
    const slots = runRows({ height, pitch, group }, view, props.overscan ?? (props.view === undefined ? 1 : 0));
    // Said once, in the run's first row in view — never in a row the overscan draws above it.
    const said = failed === undefined ? undefined : slots.find((slot) => !slot.band && slot.top + slot.height > view.top);
    // Held as a row of the host's grid: the run is the row's one cell, saying nothing — or, failed, its line is.
    const asCell = grid !== undefined && failed === undefined;
    // Where the line starts: its first cell past the heads — or, in a row with no cell past them, its last, so it is said.
    const lineFrom = failed === undefined ? 0 : Math.max(0, Math.min(failed.from, cells.length - 1));
    return (
        <Box ref={root} css={styles.run} style={{ height: `${Math.max(0, height)}px` }} data-unloaded-run="" data-filled={filled ? "" : undefined}
            data-failed={failed !== undefined ? "" : undefined} data-dense={dense === true ? "" : undefined}
            role={asCell ? "gridcell" : undefined} aria-colindex={asCell ? grid.colIndex : undefined} aria-colspan={asCell ? grid.colSpan : undefined}>
            {slots.map((slot) => {
                const index = first + (group === undefined ? slot.index : slot.element);
                const place = { top: `${slot.top}px`, height: `${slot.height}px`, gridTemplateColumns: columns };
                if (slot.band) {
                    return (
                        <Box key={slot.index} css={[styles.row, rowCss]} style={place} aria-hidden="true" data-run-row={slot.index} data-run-band="">
                            <Box as="span" css={[styles.cell, styles.band, group?.css]}>
                                <Box as="span" css={styles.chevron}><FontAwesomeIcon icon={faChevronRight} /></Box>
                                {filled && failed === undefined && <PlaceholderShape kind="aggregate" index={index} styles={styles} />}
                                {filled && failed === undefined && <PlaceholderShape kind="count" index={index} styles={styles} />}
                            </Box>
                        </Box>
                    );
                }
                const number = group === undefined && rowNumber !== undefined ? rowNumber(index) : undefined;
                const failedHere = failed !== undefined && said === slot;
                return (
                    <Box key={slot.index} css={[styles.row, rowCss]} style={place} aria-hidden={failedHere ? undefined : "true"}
                        data-run-row={slot.index} data-run-index={index}>
                        {cells.map((cell, c) => {
                            if (failedHere && c > lineFrom) return null;
                            if (failedHere && c === lineFrom) {
                                return (
                                    <Box key={c} as="span" css={[styles.cell, cell.css]} style={{ gridColumn: `${c + 1} / -1` }} data-run-cell={c} data-run-failed=""
                                        role={grid !== undefined ? "gridcell" : undefined}
                                        aria-colindex={grid?.colIndex !== undefined ? grid.colIndex + c : undefined}
                                        aria-colspan={grid?.colSpan !== undefined ? Math.max(1, grid.colSpan - c) : undefined}>
                                        <LoadingFailedLine message={failed.message} retry={failed.retry} />
                                    </Box>
                                );
                            }
                            return <RunCellView key={c} cell={cell} c={c} slot={slot} index={index} number={number}
                                shapes={filled && failed === undefined} styles={styles} />;
                        })}
                    </Box>
                );
            })}
        </Box>
    );
});

/**
 * One cell of a run's row: the host's cell, and the shape its kind takes —
 * a real row number whatever the fill, the rest only once filled.
 */
function RunCellView({ cell, c, slot, index, number, shapes, styles }: {
    cell: RunCell; c: number; slot: RunSlot; index: number; number: string | undefined; shapes: boolean; styles: Record<string, SystemStyleObject>;
}) {
    const real = cell.kind === "rowNumber" && number !== undefined;
    // A wash is a region's ground, not a value: it draws under the host's overlay as soon as the fill does.
    const drawn = real || shapes;
    return (
        <Box as="span" css={[styles.cell, cell.css]} data-run-cell={c} data-kind={cell.kind} data-align={cell.align ?? placeholderAlign(cell.kind)}>
            {drawn && <PlaceholderShape kind={cell.kind} index={index + (slot.line > 0 ? slot.line : 0)} number={number} overlay={cell.overlay} styles={styles} />}
            {!drawn && cell.kind === "wash" && cell.overlay}
        </Box>
    );
}
