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
 *   virtualizer, as tall as its ledger slot. Its rows are positioned from the
 *   scroll offset the host hands it ({@link RunView}) — never a sticky child
 *   of a translated or clipped band — and only those in view are drawn, so a
 *   run of fifty thousand costs what a run of twenty does.
 * - **The host's own rows.** Each row lays its cells out on the host's grid
 *   tracks and takes the host's row and cell styles, so a placeholder row
 *   keeps the real column, day and lane rules and the gutter; each cell draws
 *   the shape its kind of content takes ({@link PlaceholderKind}). The Sheet's
 *   flat rows keep their real numbers ({@link UnloadedRunProps.rowNumber}).
 * - **Geometry first.** The rows, rules and numbers draw at once; the shapes
 *   only once the reveal says so (`filled`, CL4).
 * - **A grouped run** repeats a band — its chevron real, its key and its count
 *   placeholders — and its lines at the run's pitch.
 * - **A failed run** says so once, in its first row in view: the reason and
 *   Retry across the row's cells from the first after its heads; its other
 *   rows keep their heads and rules and carry nothing else (CL11).
 * - **Placeholders are `aria-hidden`** (CL12): a host that keeps the run a row
 *   of its grid — a treegrid's band a keyboard moves onto — wraps it in its
 *   own row; the failed line alone is read.
 *
 * It replaces the Sheet's `SheetBandRow` and the Plan's `WindowBand`.
 *
 * @packageDocumentation
 */

import { memo, type ReactNode } from "react";
import { Box, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { runRows, type RunGroup, type RunSlot, type RunView } from "./run-rows.js";
import { LoadingFailedLine, PlaceholderShape, placeholderAlign, useLoadingStyles, type LoadingRetry, type PlaceholderKind } from "./parts.js";

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

/** Props of {@link UnloadedRun}. */
export interface UnloadedRunProps {
    /** The run's height, px: its ledger slot. */
    readonly height: number;
    /** A row's height, px: the collection's declared pitch. */
    readonly pitch: number;
    /** What of the run is in view, px from its top: the host's scroll offset less where the run starts ({@link runView}). */
    readonly view: RunView;
    /** The rows' grid tracks, as the host's rows lay theirs out (`grid-template-columns`). */
    readonly columns: string;
    /** Each cell, in order. */
    readonly cells: readonly RunCell[];
    /** Whether the placeholder shapes show: past the reveal's delay (CL4). The rows, rules and numbers draw either way. */
    readonly filled: boolean;
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
    /** Compact rows: chips at 15px. */
    readonly dense?: boolean | undefined;
    /** Rows drawn either side of the view; none unless given. */
    readonly overscan?: number | undefined;
}

/**
 * The placeholder of a run of rows not yet read — see the module docs.
 *
 * @param props - The run's geometry, what is in view, its cells and its state
 * @returns The run
 */
export const UnloadedRun = memo(function UnloadedRun(props: UnloadedRunProps) {
    const { height, pitch, view, columns, cells, filled, first, rowNumber, rowCss, group, failed, dense, overscan } = props;
    const styles = useLoadingStyles();
    const slots = runRows({ height, pitch, group }, view, overscan ?? 0);
    const said = failed === undefined ? undefined : slots.find((slot) => !slot.band);
    return (
        <Box css={styles.run} style={{ height: `${Math.max(0, height)}px` }} data-unloaded-run="" data-filled={filled ? "" : undefined}
            data-failed={failed !== undefined ? "" : undefined} data-dense={dense === true ? "" : undefined}>
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
                            if (failedHere && c > failed.from) return null;
                            if (failedHere && c === failed.from) {
                                return (
                                    <Box key={c} as="span" css={[styles.cell, cell.css]} style={{ gridColumn: `${c + 1} / -1` }} data-run-cell={c} data-run-failed="">
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
