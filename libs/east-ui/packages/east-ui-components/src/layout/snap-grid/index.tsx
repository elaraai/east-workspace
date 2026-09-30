/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * SnapGrid renderer (#989) — the 12-column snap grid of tiles.
 *
 * Rows stack in the order their keys first appear among the cells, and each
 * row is a 12-column grid of its cells, in their order. The `snapGrid` slot
 * recipe owns every design value — the gaps, the tile frame, the wireframe's
 * outline, and the container widths the spans answer to; the renderer sets
 * each cell's spans and height, and nothing else. A SnapGrid that declares
 * `editing` is the builder's canvas instead ({@link SnapGridEditor}, #990).
 *
 * @packageDocumentation
 */

import { memo, useMemo, type CSSProperties, type ReactNode } from "react";
import { Box, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { IntegerType, compareFor, equivalentFor, type option, type ValueTypeOf } from "@elaraai/east";
import { SnapGrid } from "@elaraai/east-ui/internal";
import { EastChakraComponent } from "../../component";
import { getSomeorUndefined } from "../../utils";
import { parseCssSize } from "../../style/parse-size.js";
import { SnapGridEditor } from "./editor.js";

const snapGridEqual = equivalentFor(SnapGrid.Types.Root);
const compareSpan = compareFor(IntegerType);

/** A SnapGrid's decoded value. */
export type SnapGridValue = ValueTypeOf<typeof SnapGrid.Types.Root>;

/** One decoded cell. */
export type SnapGridCellValue = ValueTypeOf<typeof SnapGrid.Types.Cell>;

/**
 * A cell as the editing canvas takes it: a SnapGrid's, or a host renderer's
 * whose tiles it draws itself (`renderContent`), with no East content.
 */
export type SnapGridEditorCell = Omit<SnapGridCellValue, "content"> & { readonly content?: SnapGridCellValue["content"] };

/** A SnapGrid's decoded editing declaration. */
type SnapGridEditingValue = SnapGridValue["editing"] extends option<infer E> ? E : never;

/** The editing declaration as the canvas takes it — its drafted cells {@link SnapGridEditorCell}s. */
export type SnapGridEditorEditing = Omit<SnapGridEditingValue, "derive"> & {
    readonly derive: (rows: Uint8Array) => SnapGridEditorCell[];
};

/**
 * The editing canvas's value: a SnapGrid's, or one a host renderer builds in
 * the browser, whose cells carry no East content when it draws them itself.
 */
export type SnapGridEditorValue = Omit<SnapGridValue, "cells" | "editing"> & {
    readonly cells: readonly SnapGridEditorCell[];
    readonly editing: option<SnapGridEditorEditing>;
};

/**
 * A cell as {@link SnapGridTiles} lays it out: where it sits, and whether it
 * is framed — its content is the host's to draw.
 */
export type SnapGridLayoutCell = Pick<SnapGridCellValue, "key" | "row" | "span" | "height" | "align" | "frame">;

/** A row of the grid: its key, and its cells in their order. */
interface SnapGridRow<C extends SnapGridLayoutCell> {
    key: string;
    cells: C[];
}

/** The cells grouped into rows, the rows in the order their keys first appear. */
export function snapGridRows<C extends SnapGridLayoutCell>(cells: readonly C[]): SnapGridRow<C>[] {
    const rows: SnapGridRow<C>[] = [];
    const at = new Map<string, number>();
    for (const cell of cells) {
        let index = at.get(cell.row);
        if (index === undefined) {
            index = rows.length;
            at.set(cell.row, index);
            rows.push({ key: cell.row, cells: [] });
        }
        rows[index]!.cells.push(cell);
    }
    return rows;
}

/**
 * A cell's spans: the one declared, held to the grid's 1–12, and the one it
 * takes at a medium width — 6 for a span under 6, 12 for any other.
 */
export function snapGridSpans(span: bigint): { span: number; medium: number } {
    const held = compareSpan(span, 1n) < 0 ? 1n : compareSpan(span, 12n) > 0 ? 12n : span;
    return { span: Number(held), medium: compareSpan(held, 6n) < 0 ? 6 : 12 };
}

/** Props for {@link EastChakraSnapGrid}. */
export interface EastChakraSnapGridProps {
    /** The SnapGrid's value. */
    value: SnapGridValue;
    /** Storage key prefix for the cells' content state. */
    storageKey: string;
}

/**
 * Renders a SnapGrid: its rows of tiles on the 12-column grid, or — the
 * `wireframe` variant — each cell as an outline at its tile's size, and the
 * blank page when it has none; the builder's canvas when it declares
 * `editing`.
 */
export const EastChakraSnapGrid = memo(function EastChakraSnapGrid({ value, storageKey }: EastChakraSnapGridProps) {
    return value.editing.type === "some"
        ? <SnapGridEditor value={value} storageKey={storageKey} />
        : <SnapGridView value={value} storageKey={storageKey} />;
}, (prev, next) => snapGridEqual(prev.value, next.value) && prev.storageKey === next.storageKey);

/** The SnapGrid as a page: its tiles, or its wireframe. */
function SnapGridView({ value, storageKey }: EastChakraSnapGridProps) {
    return (
        <SnapGridTiles
            cells={value.cells}
            wireframe={getSomeorUndefined(value.variant)?.type === "wireframe"}
            width={getSomeorUndefined(value.width)}
            height={getSomeorUndefined(value.height)}
            maxHeight={getSomeorUndefined(value.maxHeight)}
            content={(cell) => <EastChakraComponent value={cell.content} storageKey={`${storageKey}.${cell.key}`} />}
        />
    );
}

/** Props of {@link SnapGridTiles}. */
export interface SnapGridTilesProps<C extends SnapGridLayoutCell> {
    /** The cells, in order — rows in the order their keys first appear. */
    cells: readonly C[];
    /** Draws a cell's content in its tile. */
    content: (cell: C) => ReactNode;
    /** Each cell an outline at its tile's size, its content not drawn, and with no cells the blank page. */
    wireframe?: boolean | undefined;
    /** The design width, a CSS length. */
    width?: string | undefined;
    /** A pinned height, a CSS length; the grid scrolls within. */
    height?: string | undefined;
    /** A height cap, a CSS length; the grid scrolls past it. */
    maxHeight?: string | undefined;
}

/**
 * The snap grid's tiles as React — the SnapGrid's page, and the grid a host
 * renderer lays out whose tiles it draws itself: rows of cells on the
 * 12-column grid, each cell's content the host's.
 *
 * @param props - The cells, how a cell's content is drawn, and the grid's sizes
 * @returns The grid
 */
export function SnapGridTiles<C extends SnapGridLayoutCell>({ cells, content, wireframe = false, ...sizes }: SnapGridTilesProps<C>) {
    const styles = useSlotRecipe({ key: "snapGrid" })({ variant: wireframe ? "wireframe" : "tiles" }) as Record<string, SystemStyleObject>;
    const rows = useMemo(() => snapGridRows(cells), [cells]);
    const width = parseCssSize(sizes.width);
    const height = parseCssSize(sizes.height);
    const maxHeight = parseCssSize(sizes.maxHeight);
    const bounded = height !== undefined || maxHeight !== undefined;
    return (
        <Box
            css={styles.root}
            data-snap-grid=""
            data-snap-grid-variant={wireframe ? "wireframe" : "tiles"}
            height={height}
            maxHeight={maxHeight}
            overflowY={bounded ? "auto" : undefined}
        >
            <Box css={styles.grid} data-snap-grid-body="" width={width}>
                {wireframe && rows.length === 0 && (
                    <>
                        <Box css={styles.blankBand} data-snap-grid-blank="band" />
                        <Box css={styles.blankBody} data-snap-grid-blank="body" />
                    </>
                )}
                {rows.map(row => (
                    <Box key={row.key} css={styles.row} data-snap-grid-row={row.key}>
                        {row.cells.map(cell => {
                            const spans = snapGridSpans(cell.span);
                            const cellHeight = getSomeorUndefined(cell.height);
                            const style = {
                                "--snap-grid-span": String(spans.span),
                                "--snap-grid-span-medium": String(spans.medium),
                                height: cellHeight === undefined ? undefined : `${cellHeight}px`,
                            } as CSSProperties;
                            return (
                                <Box
                                    key={cell.key}
                                    css={styles.cell}
                                    style={style}
                                    data-snap-grid-cell={cell.key}
                                    data-snap-grid-span={spans.span}
                                    data-align={cell.align.type}
                                    data-auto-height={cellHeight === undefined ? "" : undefined}
                                    data-frame={!wireframe && cell.frame ? "" : undefined}
                                >
                                    {wireframe ? null : content(cell)}
                                </Box>
                            );
                        })}
                    </Box>
                ))}
            </Box>
        </Box>
    );
}
