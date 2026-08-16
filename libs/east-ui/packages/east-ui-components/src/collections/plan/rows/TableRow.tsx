/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Table rows (`Plan Spec.md` §4·K5) — bucketed numerals on the shared scale,
 * MULTI-SERIES per cell: each series carries its own raw cells plus the
 * position's style declarations (format / tone / strong — declared once per
 * series, never per cell). The renderer joins series by bucket and lays the
 * parts out per the row's `split` (side by side, or stacked lines on a grown
 * row). Per part: explicit `text`/`tone` overrides win; else the value prints
 * through `series.format ?? row.format`, negatives tone `neg`, missing values
 * the muted em-dash, and the series' declared tone covers the rest. Subtotal
 * parents render their renderer-DERIVED cells as one plain series; row
 * emphasis (header / footer) rides the shell's `data-emphasis`.
 */

import { type ValueTypeOf } from "@elaraai/east";
import { Box } from "@chakra-ui/react";
import { Plan } from "@elaraai/east-ui/internal";
import { usePlanDispatch, usePlanScale } from "../context.js";
import { formatTick, type TickFormatOpt } from "../../../typography/numeric/format-tick.js";

type Styles = Record<string, Record<string, unknown>>;
type TableCellValue = ValueTypeOf<typeof Plan.Types.TableCell>;
type TableSeriesValue = ValueTypeOf<typeof Plan.Types.TableSeries>;

export interface TableRowCellsProps {
    rowKey: string;
    /** The rendered series — the row's own, or its derived subtotal positions. */
    series: readonly TableSeriesValue[];
    /** The part layout (visible only with more than one series). */
    split: "horizontal" | "vertical";
    /** The ROW's shared format (a series' own format overrides per position). */
    format: TickFormatOpt;
    styles: Styles;
}

/** The table-row plot content — per-bucket cells of series-joined parts. */
export function TableRowCells({ rowKey, series, split, format, styles }: TableRowCellsProps) {
    const scale = usePlanScale();
    const dispatch = usePlanDispatch();
    // Join the series by bucket — parts arrive in series order; a series
    // without a cell in a bucket simply contributes nothing there.
    const buckets = new Map<number, { si: number; cell: TableCellValue }[]>();
    series.forEach((s, si) => {
        for (const c of s.cells) {
            const bi = scale.bucketOf(c.at);
            if (bi < 0) continue;
            const list = buckets.get(bi);
            if (list !== undefined) list.push({ si, cell: c });
            else buckets.set(bi, [{ si, cell: c }]);
        }
    });
    const multi = series.length > 1;
    return (
        <>
            {[...buckets.entries()].map(([bi, parts]) => {
                const b = scale.buckets[bi]!;
                return (
                    <Box key={bi} css={styles.tableCellText}
                        data-split={multi ? split : undefined}
                        left={`${b.x0 * 100}%`} width={`${(b.x1 - b.x0) * 100}%`}
                        onClick={(e) => { e.stopPropagation(); dispatch({ t: "row.select", key: rowKey }); }}
                    >
                        {parts.map(({ si, cell }, i) => {
                            const s = series[si]!;
                            const value = cell.value.type === "some" ? cell.value.value : undefined;
                            const partFormat = s.format.type === "some" ? s.format.value : format;
                            const text = cell.text.type === "some" ? cell.text.value
                                : value !== undefined ? formatTick(value, partFormat)
                                : "—";
                            const tone = cell.tone.type === "some" ? cell.tone.value.type
                                : value === undefined ? "muted"
                                : value < 0 ? "neg"
                                : s.tone.type === "some" ? s.tone.value.type
                                : undefined;
                            const strong = s.strong.type === "some" && s.strong.value;
                            return (
                                <Box key={i} as="span" css={styles.tableCellPart}
                                    data-tone={tone} data-strong={strong ? "" : undefined}>
                                    {text}
                                </Box>
                            );
                        })}
                    </Box>
                );
            })}
        </>
    );
}
