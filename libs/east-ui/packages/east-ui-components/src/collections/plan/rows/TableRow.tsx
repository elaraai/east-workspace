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
 * emphasis (header / footer) rides the shell's `data-emphasis`. A bucket's
 * cell names its bucket instant (`data-cell`), so the canvas's one overlay
 * layer opens the root's popover and hover card for it (#816). It is a button
 * named by its bucket and the numerals it prints (#819) — the em-dash of a
 * missing value said as words.
 */

import { variant, type ValueTypeOf } from "@elaraai/east";
import { Box } from "@chakra-ui/react";
import { Plan } from "@elaraai/east-ui/internal";
import { usePlanDispatch, usePlanResolvers, usePlanScale, type PlanElementRefValue } from "../context.js";
import type { TickFormatOpt } from "../../../typography/numeric/format-tick.js";
import { ToneStrip, type ToneDatum } from "./ToneStrip.js";
import type { PlanBucket } from "../scale.js";
import { instantKey } from "../instant.js";
import { cellName, tablePartsText } from "../a11y.js";
import type { PlanRowId } from "../model.js";
import { usePlanWords } from "../words.js";

type Styles = Record<string, Record<string, unknown>>;
type TableCellValue = ValueTypeOf<typeof Plan.Types.TableCell>;
type TableSeriesValue = ValueTypeOf<typeof Plan.Types.TableSeries>;

export interface TableRowCellsProps {
    rowKey: string;
    /** The row's id — what an element click names the row by (#822). */
    rowId: PlanRowId;
    /** The rendered series — the row's own, or its derived subtotal positions. */
    series: readonly TableSeriesValue[];
    /** The part layout (visible only with more than one series). */
    split: "horizontal" | "vertical";
    /** The ROW's shared format (a series' own format overrides per position). */
    format: TickFormatOpt;
    /** R2 context strip (#591) — re-encode as a tone strip; see {@link ToneStrip}. */
    ctx?: boolean | undefined;
    styles: Styles;
}

/** The table-row plot content — per-bucket cells of series-joined parts. */
export function TableRowCells({ rowKey, rowId, series, split, format, styles, ctx }: TableRowCellsProps) {
    const scale = usePlanScale();
    const dispatch = usePlanDispatch();
    const words = usePlanWords();
    const { onElementClick } = usePlanResolvers();
    // ── R2 (#591): numerals have no small form ──
    // The ROLLUP position is the one that carries the row's headline number
    // (`tableRollupSeries`' contract), so it is the one the strip encodes —
    // a multi-value row shows the shape of its primary series, not an
    // arbitrary overlay of all of them.
    if (ctx === true) {
        const primary = series.find((x) => x.rollup) ?? series[0];
        const data: ToneDatum[] = (primary?.cells ?? []).map((c) => ({
            at: c.at,
            value: c.value.type === "some" ? c.value.value : undefined,
            tone: c.tone.type === "some" && c.tone.value.type === "neg" ? "neg"
                : c.value.type === "some" && c.value.value < 0 ? "neg"
                : undefined,
        }));
        return <ToneStrip data={data} styles={styles} />;
    }
    // Join the series by bucket — parts arrive in series order; a series
    // without a cell in a bucket simply contributes nothing there. RENDER
    // bucketing (#619): overscan cells join and mount too, clipped at rest.
    const bucketByIndex = new Map<number, PlanBucket>();
    const buckets = new Map<number, { si: number; cell: TableCellValue }[]>();
    series.forEach((s, si) => {
        for (const c of s.cells) {
            const b = scale.renderBucketOf(c.at);
            if (b === undefined) continue;
            bucketByIndex.set(b.index, b);
            const list = buckets.get(b.index);
            if (list !== undefined) list.push({ si, cell: c });
            else buckets.set(b.index, [{ si, cell: c }]);
        }
    });
    const multi = series.length > 1;
    return (
        <>
            {[...buckets.entries()].map(([bi, parts]) => {
                const b = bucketByIndex.get(bi)!;
                const printed = parts.map(({ si, cell }) => {
                    const s = series[si]!;
                    const value = cell.value.type === "some" ? cell.value.value : undefined;
                    const partFormat = s.format.type === "some" ? s.format.value : format;
                    const text = cell.text.type === "some" ? cell.text.value
                        // The declared format, in the canvas's locale (#820),
                        // through the shared interpreter (#850).
                        : value !== undefined ? words.value(value, partFormat)
                        : "—";
                    const tone = cell.tone.type === "some" ? cell.tone.value.type
                        : value === undefined ? "muted"
                        : value < 0 ? "neg"
                        : s.tone.type === "some" ? s.tone.value.type
                        : undefined;
                    return { text, tone, strong: s.strong };
                });
                return (
                    <Box key={bi} css={styles.tableCellText}
                        data-plan-bucket={bi}
                        // The BUCKET instant — the same subject its click
                        // reports — and focusable for the keyboard path (#816).
                        data-cell={instantKey(b.start)}
                        data-plan-frac={b.x0.toFixed(4)}
                        tabIndex={-1}
                        role="button"
                        aria-label={cellName(scale, b, tablePartsText(printed.map((p) => p.text), words), words)}
                        data-split={multi ? split : undefined}
                        left={`${b.x0 * 100}%`} width={`${(b.x1 - b.x0) * 100}%`}
                        onClick={(e) => {
                            e.stopPropagation();
                            dispatch({ t: "row.select", key: rowKey });
                            // Parts join BY bucket (their own `at`s may differ
                            // inside it) — the BUCKET instant is the honest
                            // subject, exactly as the payload documents.
                            onElementClick?.(variant("cell", { row: rowId, at: b.start }) as PlanElementRefValue);
                        }}
                    >
                        {printed.map(({ text, tone, strong }, i) => (
                            <Box key={i} as="span" css={styles.tableCellPart}
                                data-tone={tone} data-strong={strong ? "" : undefined}>
                                {text}
                            </Box>
                        ))}
                    </Box>
                );
            })}
        </>
    );
}
