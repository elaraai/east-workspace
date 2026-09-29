/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Layout renderer (#989) — the 12-column snap grid of tiles.
 *
 * Rows stack in the order their keys first appear among the cells, and each
 * row is a 12-column grid of its cells, in their order. The `layout` slot
 * recipe owns every design value — the gaps, the tile frame, the wireframe's
 * outline, and the container widths the spans answer to; the renderer sets
 * each cell's spans and height, and nothing else.
 *
 * @packageDocumentation
 */

import { memo, useMemo, type CSSProperties } from "react";
import { Box, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { IntegerType, compareFor, equivalentFor, type ValueTypeOf } from "@elaraai/east";
import { Layout } from "@elaraai/east-ui/internal";
import { EastChakraComponent } from "../../component";
import { getSomeorUndefined } from "../../utils";
import { parseCssSize } from "../../style/parse-size.js";

const layoutEqual = equivalentFor(Layout.Types.Root);
const compareSpan = compareFor(IntegerType);

/** A Layout's decoded value. */
export type LayoutValue = ValueTypeOf<typeof Layout.Types.Root>;

/** One decoded cell. */
export type LayoutCellValue = ValueTypeOf<typeof Layout.Types.Cell>;

/** A row of the grid: its key, and its cells in their order. */
interface LayoutRow {
    key: string;
    cells: LayoutCellValue[];
}

/** The cells grouped into rows, the rows in the order their keys first appear. */
export function layoutRows(cells: readonly LayoutCellValue[]): LayoutRow[] {
    const rows: LayoutRow[] = [];
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
export function layoutSpans(span: bigint): { span: number; medium: number } {
    const held = compareSpan(span, 1n) < 0 ? 1n : compareSpan(span, 12n) > 0 ? 12n : span;
    return { span: Number(held), medium: compareSpan(held, 6n) < 0 ? 6 : 12 };
}

/** Props for {@link EastChakraLayout}. */
export interface EastChakraLayoutProps {
    /** The Layout's value. */
    value: LayoutValue;
    /** Storage key prefix for the cells' content state. */
    storageKey: string;
}

/**
 * Renders a Layout: its rows of tiles on the 12-column grid, or — the
 * `wireframe` variant — each cell as an outline at its tile's size.
 */
export const EastChakraLayout = memo(function EastChakraLayout({ value, storageKey }: EastChakraLayoutProps) {
    const wireframe = getSomeorUndefined(value.variant)?.type === "wireframe";
    const styles = useSlotRecipe({ key: "layout" })({ variant: wireframe ? "wireframe" : "tiles" }) as Record<string, SystemStyleObject>;
    const rows = useMemo(() => layoutRows(value.cells), [value.cells]);
    const width = parseCssSize(getSomeorUndefined(value.width));
    const height = parseCssSize(getSomeorUndefined(value.height));
    const maxHeight = parseCssSize(getSomeorUndefined(value.maxHeight));
    const bounded = height !== undefined || maxHeight !== undefined;
    return (
        <Box
            css={styles.root}
            data-layout=""
            data-layout-variant={wireframe ? "wireframe" : "tiles"}
            height={height}
            maxHeight={maxHeight}
            overflowY={bounded ? "auto" : undefined}
        >
            <Box css={styles.grid} data-layout-grid="" width={width}>
                {rows.map(row => (
                    <Box key={row.key} css={styles.row} data-layout-row={row.key}>
                        {row.cells.map(cell => {
                            const spans = layoutSpans(cell.span);
                            const cellHeight = getSomeorUndefined(cell.height);
                            const style = {
                                "--layout-span": String(spans.span),
                                "--layout-span-medium": String(spans.medium),
                                height: cellHeight === undefined ? undefined : `${cellHeight}px`,
                            } as CSSProperties;
                            return (
                                <Box
                                    key={cell.key}
                                    css={styles.cell}
                                    style={style}
                                    data-layout-cell={cell.key}
                                    data-layout-span={spans.span}
                                    data-align={cell.align.type}
                                    data-frame={!wireframe && cell.frame ? "" : undefined}
                                >
                                    {wireframe ? null : <EastChakraComponent value={cell.content} storageKey={`${storageKey}.${cell.key}`} />}
                                </Box>
                            );
                        })}
                    </Box>
                ))}
            </Box>
        </Box>
    );
}, (prev, next) => layoutEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
