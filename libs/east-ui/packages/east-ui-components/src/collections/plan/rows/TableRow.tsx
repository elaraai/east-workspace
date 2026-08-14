/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Table rows (`Plan Spec.md` §4·K5) — bucketed numerals on the shared scale:
 * per-bucket right-aligned mono cells printed through the row's shared
 * `TickFormatType` format (the Numeric / Stat `formatTick` code path).
 * Explicit `text` / `tone` overrides win; else negatives tone `neg` and a
 * missing value renders the muted em-dash. Subtotal parents render their
 * renderer-DERIVED cells; row emphasis (header / footer) rides the shell's
 * `data-emphasis`.
 */

import { type ValueTypeOf } from "@elaraai/east";
import { Box } from "@chakra-ui/react";
import { Plan } from "@elaraai/east-ui/internal";
import { usePlanDispatch, usePlanScale } from "../context.js";
import { formatTick, type TickFormatOpt } from "../../../typography/numeric/format-tick.js";

type Styles = Record<string, Record<string, unknown>>;
type TableCellValue = ValueTypeOf<typeof Plan.Types.TableCell>;

export interface TableRowCellsProps {
    rowKey: string;
    /** The rendered cells — the row's own, or the parent's derived subtotals. */
    cells: readonly TableCellValue[];
    /** The row's declared format (the shared `TickFormatType`), if any. */
    format: TickFormatOpt;
    styles: Styles;
}

/** The table-row plot content — one right-aligned numeral per bucket. */
export function TableRowCells({ rowKey, cells, format, styles }: TableRowCellsProps) {
    const scale = usePlanScale();
    const dispatch = usePlanDispatch();
    return (
        <>
            {cells.map((c, i) => {
                const bi = scale.bucketOf(c.at);
                if (bi < 0) return null;
                const b = scale.buckets[bi]!;
                const value = c.value.type === "some" ? c.value.value : undefined;
                const text = c.text.type === "some" ? c.text.value
                    : value !== undefined ? formatTick(value, format)
                    : "—";
                const tone = c.tone.type === "some" ? c.tone.value.type
                    : value === undefined ? "muted"
                    : value < 0 ? "neg"
                    : undefined;
                return (
                    <Box key={i} css={styles.tableCellText}
                        data-tone={tone}
                        left={`${b.x0 * 100}%`} width={`${(b.x1 - b.x0) * 100}%`}
                        onClick={(e) => { e.stopPropagation(); dispatch({ t: "row.select", key: rowKey }); }}
                    >
                        {text}
                    </Box>
                );
            })}
        </>
    );
}
