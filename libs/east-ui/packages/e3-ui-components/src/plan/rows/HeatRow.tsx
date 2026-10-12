/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Heat rows (`Plan Spec.md` §4·K4) — the Matrix cell recipes quantised onto
 * the shared scale: heat cells on the design system's heat ramp, five steps
 * (`heat.1` … `heat.5`; #949 — the cell's value prints in the ink its step
 * pairs with, at least 4.5:1 in both themes), 45° no-data hatch, ≥ warn
 * threshold ring,
 * booked-vs-free weight bars (planned ⇒ pale), and weighted segment
 * compositions. The renderer names each cell's STEP and each segment's FILL
 * as data attributes; every colour lives on the `plan` recipe slots.
 *
 * Group summary strips (§5) are exactly the `heat` arm rendered by
 * {@link HeatCells} — GroupRow delegates here.
 *
 * A data row's cell names itself — `data-cell`, its own declared instant —
 * so the canvas's one overlay layer opens the root's popover and hover card
 * for it (#816, #743 item 5). A group strip's cells are the band's toggle
 * instead, and name nothing.
 *
 * Every cell says the value its colour or width encodes (#819): a data row's
 * cell is a button named by its bucket and value, a strip's cell carries the
 * same words as visually hidden text.
 */

import { variant, type ValueTypeOf } from "@elaraai/east";
import { Box, VisuallyHidden } from "@chakra-ui/react";
import { Plan } from "@elaraai/e3-ui/internal";
import { usePlanDispatch, usePlanResolvers, usePlanScale, type PlanElementRefValue } from "../context.js";
import { instantKey, type PlanInstantValue } from "../instant.js";
import type { PlanBucket } from "../scale.js";
import { maxOf, minOf } from "../reductions.js";
import { cellName, heatValueText, segmentsText, weightValueText } from "../a11y.js";
import type { PlanRowId } from "../model.js";
import { usePlanWords } from "../words.js";
import { getSomeorUndefined } from "@elaraai/east-ui-components";

type Styles = Record<string, Record<string, unknown>>;
type HeatCellsValue = ValueTypeOf<typeof Plan.Types.HeatCells>;

/** The heat-ramp level a depth in `[0, 1]` falls on — five, 0 to 4 (the
 *  ramp's steps 1 to 5). */
export function heatLevel(depth: number): number {
    return Math.max(0, Math.min(4, Math.round(depth * 4)));
}

export type HeatCellsProps = {
    /** R2 context strip (#591) — render this row's marks at strip size. */
    ctx?: boolean | undefined;

    rowKey: string;
    cells: HeatCellsValue;
    styles: Styles;
} & (
    | {
        /** A data row's cells are elements: a click selects the row and names
         *  it by its id (#822). */
        rowId: PlanRowId;
        onCellClick?: undefined;
    }
    | {
        /** What a strip's cell click DOES instead. A collapsed group's summary
         *  strip passes its toggle — selecting the GROUP key is a click that
         *  visibly does nothing, and it swallows the band's own toggle (#615). */
        onCellClick: () => void;
        rowId?: undefined;
    }
);

/**
 * The heat-arm plot content — one cell / bar / composition per bucket,
 * positioned by `bucketOf` with the §8 3px insets.
 */
export function HeatCells({ rowKey, rowId, cells, styles, ctx, onCellClick }: HeatCellsProps) {
    const ctxAttr = ctx === true ? "" : undefined;
    const scale = usePlanScale();
    const dispatch = usePlanDispatch();
    // The canvas's words (#820) — every cell's text alternative speaks them.
    const w = usePlanWords();
    const { onElementClick } = usePlanResolvers();
    // RENDER bucketing (#619): overscan cells mount clipped at rest so a
    // brush-slide pan reveals them; interactions still speak `bucketOf`.
    const cellBox = (at: PlanInstantValue): { left: string; width: string; bucket: PlanBucket } | undefined => {
        const b = scale.renderBucketOf(at);
        if (b === undefined) return undefined;
        return { left: `calc(${b.x0 * 100}% + 1.5px)`, width: `calc(${(b.x1 - b.x0) * 100}% - 3px)`, bucket: b };
    };
    // A data row's cell is an element — it names its instant, takes focus for
    // the keyboard path to its popover, and is a button named by its bucket
    // and value (#819). A strip's cell is part of its band: its words are
    // visually hidden text (`cellWords`), and its printed label is then their
    // echo.
    const element = onCellClick === undefined;
    const cellAttrs = (at: PlanInstantValue, bucket: PlanBucket, value: string) => (element
        ? {
            "data-cell": instantKey(at), "data-plan-frac": bucket.x0.toFixed(4), tabIndex: -1,
            role: "button", "aria-label": cellName(scale, bucket, value, w),
        }
        : {});
    const cellWords = (bucket: PlanBucket, value: string) => (element
        ? null
        : <VisuallyHidden>{cellName(scale, bucket, value, w)}</VisuallyHidden>);
    const clickCell = (at: PlanInstantValue) => (e: React.MouseEvent) => {
        e.stopPropagation();
        if (onCellClick !== undefined) {
            onCellClick();
            return;
        }
        dispatch({ t: "row.select", key: rowKey });
        // The cell's own declared instant — what the author addressed it by.
        if (rowId !== undefined) onElementClick?.(variant("cell", { row: rowId, at }) as PlanElementRefValue);
    };

    if (cells.type === "heat") {
        const { cells: hc, scale: { min, max, warnAt } } = cells.value;
        const format = getSomeorUndefined(cells.value.format);
        const values = hc.map((c) => (c.value.type === "some" ? c.value.value : undefined));
        const present = values.filter((v): v is number => v !== undefined);
        const lo = min.type === "some" ? min.value : (present.length > 0 ? minOf(present) : 0);
        const hi = max.type === "some" ? max.value : (present.length > 0 ? maxOf(present) : 1);
        const warn = warnAt.type === "some" ? warnAt.value : undefined;
        const span = hi - lo;
        return (
            <>
                {hc.map((c, i) => {
                    const box = cellBox(c.at);
                    if (box === undefined) return null;
                    const v = values[i];
                    const depth = v === undefined || span <= 0 ? 0 : Math.max(0, Math.min(1, (v - lo) / span));
                    // A cell prints its label; one without prints its value
                    // only through a declared format (#824) — a row painted by
                    // depth alone stays unprinted.
                    const label = c.label.type === "some" ? c.label.value
                        : v !== undefined && format !== undefined ? w.value(v, format) : undefined;
                    const warned = v !== undefined && warn !== undefined && v >= warn;
                    const words = heatValueText(v, label, warned, w);
                    // Its level on the heat ramp — the recipe paints it, and
                    // inks its value to match.
                    const level = v === undefined ? undefined : heatLevel(depth);
                    return (
                        <Box key={i} css={styles.heatCell} data-ctx={ctxAttr}
                            data-plan-bucket={box.bucket.index}
                            {...cellAttrs(c.at, box.bucket, words)}
                            data-nodata={v === undefined ? "" : undefined}
                            data-warn={warned ? "" : undefined}
                            data-level={level}
                            left={box.left} width={box.width}
                            onClick={clickCell(c.at)}
                        >
                            {/* Its number: drawn whole, or — wider than the cell — off its line, out of sight, and said
                                by the cell's hover (#1269). */}
                            <Box as="span" css={styles.heatLabel} data-level={level} data-ctx={ctxAttr} data-plan-heat-label
                                data-plan-label="" aria-hidden={element ? undefined : "true"}>
                                {v === undefined ? "–" : label}
                            </Box>
                            {cellWords(box.bucket, words)}
                        </Box>
                    );
                })}
            </>
        );
    }

    if (cells.type === "weight") {
        // The Matrix `.wbar`: a single left-anchored bar, its width the
        // booked fraction of the cell — no background track.
        const format = getSomeorUndefined(cells.value.format);
        return (
            <>
                {cells.value.cells.map((c, i) => {
                    const b = scale.renderBucketOf(c.at);
                    if (b === undefined) return null;
                    const frac = Math.max(0, Math.min(1, c.fraction));
                    const words = weightValueText(c.fraction, c.planned, w, format);
                    return (
                        <Box key={i} css={styles.weightBar}
                            data-plan-bucket={b.index}
                            {...cellAttrs(c.at, b, words)}
                            data-planned={c.planned ? "" : undefined}
                            left={`calc(${b.x0 * 100}% + 4px)`}
                            width={`calc((${(b.x1 - b.x0) * 100}% - 8px) * ${frac})`}
                            onClick={clickCell(c.at)}>
                            {cellWords(b, words)}
                        </Box>
                    );
                })}
            </>
        );
    }

    const segmentFormat = getSomeorUndefined(cells.value.format);
    return (
        <>
            {cells.value.cells.map((c, i) => {
                const b = scale.renderBucketOf(c.at);
                if (b === undefined) return null;
                const total = c.segments.reduce((acc, s) => acc + Math.max(0, s.weight), 0);
                const words = segmentsText(c.segments, w, segmentFormat);
                return (
                    <Box key={i} css={styles.segmentTrack}
                        data-plan-bucket={b.index}
                        {...cellAttrs(c.at, b, words)}
                        left={`calc(${b.x0 * 100}% + 4px)`}
                        width={`calc(${(b.x1 - b.x0) * 100}% - 8px)`}
                        onClick={clickCell(c.at)}>
                        {c.segments.map((s, j) => {
                            const share = total > 0 ? Math.max(0, s.weight) / total : 0;
                            const label = s.label.type === "some" ? s.label.value : undefined;
                            const fillTag = s.fill.type;
                            return (
                                <Box key={j} css={styles.segmentPart}
                                    width={`${share * 100}%`}
                                    // The fill names its meaning; the recipe paints it.
                                    data-fill={fillTag}
                                    aria-hidden={element ? undefined : "true"}
                                >
                                    {share > 0.14 ? label : undefined}
                                </Box>
                            );
                        })}
                        {cellWords(b, words)}
                    </Box>
                );
            })}
        </>
    );
}
