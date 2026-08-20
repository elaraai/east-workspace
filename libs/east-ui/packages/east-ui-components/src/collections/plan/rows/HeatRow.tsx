/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Heat rows (`Plan Spec.md` §4·K4) — the Matrix cell recipes quantised onto
 * the shared scale: colour-depth heat cells (`color-mix` ramp, label flips to
 * paper past 50%, 45° no-data hatch, ≥ warn threshold ring), booked-vs-free
 * weight bars (planned ⇒ pale), and weighted segment compositions. Cell depth
 * is data-driven (the sanctioned dynamic exception); everything enumerable
 * lives on the `plan` recipe slots.
 *
 * Group summary strips (§5) are exactly the `heat` arm rendered by
 * {@link HeatCells} — GroupRow delegates here.
 */

import { variant, type ValueTypeOf } from "@elaraai/east";
import { Box } from "@chakra-ui/react";
import { Plan } from "@elaraai/east-ui/internal";
import { usePlanDispatch, usePlanResolvers, usePlanScale, type PlanElementRefValue } from "../context.js";

type Styles = Record<string, Record<string, unknown>>;
type HeatCellsValue = ValueTypeOf<typeof Plan.Types.HeatCells>;

/** MatrixFill tag → segment fill (the Matrix vocabulary on tokens; slack is
 *  the 45° hatch, free the faint wash — the spec `.segbar` fills verbatim). */
const SEGMENT_FILL: Record<string, string> = {
    brand:   "var(--chakra-colors-brand-600)",
    success: "var(--chakra-colors-status-pos)",
    warning: "var(--chakra-colors-status-warn)",
    danger:  "var(--chakra-colors-status-neg)",
    info:    "var(--chakra-colors-status-info)",
    neutral: "var(--chakra-colors-fg-subtle)",
    slack:   "repeating-linear-gradient(45deg, transparent 0 3px, var(--chakra-colors-border-strong) 3px 4px)",
    free:    "color-mix(in srgb, var(--chakra-colors-fg) 5%, transparent)",
};

/** Segment fills that read dark enough for paper-coloured in-bar labels. */
const SEGMENT_DARK = new Set(["brand", "success", "warning", "danger", "info", "neutral"]);

export interface HeatCellsProps {
    /** R2 context strip (#591) — render this row's marks at strip size. */
    ctx?: boolean | undefined;

    rowKey: string;
    cells: HeatCellsValue;
    styles: Styles;
    /** What a cell click DOES (default: select the row). A collapsed group's
     *  summary strip passes its toggle — selecting the GROUP key is a click
     *  that visibly does nothing, and it swallows the band's own toggle (#615). */
    onCellClick?: (() => void) | undefined;
}

/**
 * The heat-arm plot content — one cell / bar / composition per bucket,
 * positioned by `bucketOf` with the §8 3px insets.
 */
export function HeatCells({ rowKey, cells, styles, ctx, onCellClick }: HeatCellsProps) {
    const ctxAttr = ctx === true ? "" : undefined;
    const scale = usePlanScale();
    const dispatch = usePlanDispatch();
    const { onElementClick } = usePlanResolvers();
    // RENDER bucketing (#619): overscan cells mount clipped at rest so a
    // brush-slide pan reveals them; interactions still speak `bucketOf`.
    const cellBox = (at: Date): { left: string; width: string } | undefined => {
        const b = scale.renderBucketOf(at);
        if (b === undefined) return undefined;
        return { left: `calc(${b.x0 * 100}% + 1.5px)`, width: `calc(${(b.x1 - b.x0) * 100}% - 3px)` };
    };
    const clickCell = (at: Date) => (e: React.MouseEvent) => {
        e.stopPropagation();
        if (onCellClick !== undefined) {
            onCellClick();
            return;
        }
        dispatch({ t: "row.select", key: rowKey });
        // The cell's own declared instant — what the author addressed it by.
        onElementClick?.(variant("cell", { row: rowKey, at }) as PlanElementRefValue);
    };

    if (cells.type === "heat") {
        const { cells: hc, min, max, warnAt } = cells.value;
        const values = hc.map((c) => (c.value.type === "some" ? c.value.value : undefined));
        const present = values.filter((v): v is number => v !== undefined);
        const lo = min.type === "some" ? min.value : (present.length > 0 ? Math.min(...present) : 0);
        const hi = max.type === "some" ? max.value : (present.length > 0 ? Math.max(...present) : 1);
        const warn = warnAt.type === "some" ? warnAt.value : undefined;
        const span = hi - lo;
        return (
            <>
                {hc.map((c, i) => {
                    const box = cellBox(c.at);
                    if (box === undefined) return null;
                    const v = values[i];
                    const depth = v === undefined || span <= 0 ? 0 : Math.max(0, Math.min(1, (v - lo) / span));
                    const label = c.label.type === "some" ? c.label.value : undefined;
                    return (
                        <Box key={i} css={styles.heatCell} data-ctx={ctxAttr}
                            data-nodata={v === undefined ? "" : undefined}
                            data-warn={v !== undefined && warn !== undefined && v >= warn ? "" : undefined}
                            left={box.left} width={box.width}
                            background={v === undefined ? undefined
                                : `color-mix(in srgb, var(--chakra-colors-brand-700) ${Math.round(depth * 88)}%, var(--chakra-colors-bg-surface))`}
                            onClick={clickCell(c.at)}
                        >
                            <Box as="span" css={styles.heatLabel} data-flip={depth > 0.5 ? "" : undefined} data-ctx={ctxAttr}>
                                {v === undefined ? "–" : label}
                            </Box>
                        </Box>
                    );
                })}
            </>
        );
    }

    if (cells.type === "weight") {
        // The Matrix `.wbar`: a single left-anchored bar, its width the
        // booked fraction of the cell — no background track.
        return (
            <>
                {cells.value.map((c, i) => {
                    const b = scale.renderBucketOf(c.at);
                    if (b === undefined) return null;
                    const frac = Math.max(0, Math.min(1, c.fraction));
                    return (
                        <Box key={i} css={styles.weightBar}
                            data-planned={c.planned ? "" : undefined}
                            left={`calc(${b.x0 * 100}% + 4px)`}
                            width={`calc((${(b.x1 - b.x0) * 100}% - 8px) * ${frac})`}
                            onClick={clickCell(c.at)} />
                    );
                })}
            </>
        );
    }

    return (
        <>
            {cells.value.map((c, i) => {
                const b = scale.renderBucketOf(c.at);
                if (b === undefined) return null;
                const total = c.segments.reduce((acc, s) => acc + Math.max(0, s.weight), 0);
                return (
                    <Box key={i} css={styles.segmentTrack}
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
                                    background={SEGMENT_FILL[fillTag] ?? SEGMENT_FILL.neutral}
                                    color={SEGMENT_DARK.has(fillTag) ? undefined : "var(--chakra-colors-fg-muted)"}
                                >
                                    {share > 0.14 ? label : undefined}
                                </Box>
                            );
                        })}
                    </Box>
                );
            })}
        </>
    );
}
