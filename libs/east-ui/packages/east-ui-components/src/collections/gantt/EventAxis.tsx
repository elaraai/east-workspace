/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useMemo } from "react";
import { Box, type SystemStyleObject } from "@chakra-ui/react";
import { scaleTime } from "@visx/scale";
import { utcDay, utcWeek, utcMonth, utcYear, type TimeInterval } from "d3-time";
import { formatDatePattern } from "../../charts/spec";

/** Header band granularity — mirrors the IR `GanttTierType` arms. */
export type GanttTier = "auto" | "day" | "week" | "month" | "quarter" | "year";
type FixedTier = Exclude<GanttTier, "auto">;

export interface EventAxisProps {
    startDate: Date;
    endDate: Date;
    width: number;
    height: number;
    /**
     * The `table` slot recipe's `columnHeader` style object — the same one the
     * left table-pane consumes, so the header bands read identically to a Table
     * column header (mono / 10px / 0.16em / uppercase eyebrow).
     */
    columnHeaderStyles: SystemStyleObject;
    /** Header band granularity. `"auto"` derives one from the visible span. */
    tier?: GanttTier | undefined;
    /** Tick-label date pattern (e.g. `"MMM"`, `"MMM YYYY"`, `"YYYY"`). */
    format?: string | undefined;
}

const DAY_MS = 86_400_000;

/** Pick a band granularity from the visible span (targets ~5–26 whole bands). */
function autoTier(start: Date, end: Date): FixedTier {
    const days = (end.getTime() - start.getTime()) / DAY_MS;
    if (days <= 35) return "week";
    if (days <= 1100) return "month";
    return "quarter";
}

/** The concrete tier for a span — `"auto"` resolved, anything else passed through. */
export function effectiveTier(tier: GanttTier, start: Date, end: Date): FixedTier {
    return tier === "auto" ? autoTier(start, end) : tier;
}

/** The d3-time interval for a concrete tier. */
function fixedInterval(tier: FixedTier): TimeInterval {
    switch (tier) {
        case "day": return utcDay;
        case "week": return utcWeek;
        case "month": return utcMonth;
        case "quarter": return utcMonth.every(3) ?? utcMonth;
        case "year": return utcYear;
    }
}

/** The d3-time interval for the effective tier over `[start, end]`. Exported so
 *  the renderer can `floor`/`ceil` the data-derived domain to the same period
 *  boundaries, keeping every header band a whole period (no clipped partials). */
export function tierInterval(tier: GanttTier, start: Date, end: Date): TimeInterval {
    return fixedInterval(effectiveTier(tier, start, end));
}

/** Default label pattern for a concrete tier, when the IR gives no `format`. */
function defaultPattern(tier: FixedTier, multiYear: boolean): string {
    if (tier === "year") return "YYYY";
    if (tier === "week" || tier === "day") return "MMM DD";
    return multiYear ? "MMM YYYY" : "MMM";    // month / quarter
}

let measureCtx: CanvasRenderingContext2D | null = null;

/** Measured pixel width a header label needs — the mono eyebrow (10px / 600 /
 *  0.16em / uppercase) via canvas text metrics, plus the columnHeader's
 *  horizontal padding. Real metrics (not a char-count guess) so the label
 *  thinning is exact at any container width. */
function measureLabel(text: string): number {
    const upper = text.toUpperCase();
    const LETTER_SPACING = 1.6;   // ≈ 0.16em at 10px
    const PADDING = 28;           // columnHeader paddingX, both sides
    if (typeof document !== "undefined") {
        if (!measureCtx) {
            measureCtx = document.createElement("canvas").getContext("2d");
            if (measureCtx) measureCtx.font = "600 10px ui-monospace, SFMono-Regular, Menlo, monospace";
        }
        if (measureCtx) return measureCtx.measureText(upper).width + LETTER_SPACING * Math.max(0, upper.length - 1) + PADDING;
    }
    return upper.length * 8 + PADDING;   // SSR / no-canvas fallback
}

export const EventAxis = ({
    startDate,
    endDate,
    width,
    height,
    columnHeaderStyles,
    tier = "auto",
    format,
}: EventAxisProps) => {
    // One labelled band per period. The visx time scale maps dates → pixels;
    // the d3-time interval (resolved from the tier, or the span for `auto`)
    // gives calendar-exact period boundaries. The renderer snaps the domain to
    // the same interval, so the leading/trailing bands are whole periods too.
    const cells = useMemo(() => {
        const scale = scaleTime({ domain: [startDate, endDate], range: [0, width] });
        const eff = effectiveTier(tier, startDate, endDate);
        const boundaries = scale.ticks(fixedInterval(eff));

        const inner = boundaries.filter(d => d.getTime() > startDate.getTime() && d.getTime() < endDate.getTime());
        const periodStarts = [startDate, ...inner];

        const multiYear = startDate.getUTCFullYear() !== endDate.getUTCFullYear();
        const pattern = format ?? defaultPattern(eff, multiYear);

        // Thin the labels to the measured space: keep a period only when the
        // previous label has fully fit before it (so no overlap, no clipping).
        // Each shown band then spans to the next shown one — wider bands with
        // full labels when the timeline is narrow, every period when it's wide.
        // Re-runs on `width`, so it adapts live as the container resizes.
        const shown: { x: number; text: string }[] = [];
        let lastX = -Infinity;
        let lastW = 0;
        for (const d of periodStarts) {
            const x = scale(d);
            if (x - lastX >= lastW) {
                const text = formatDatePattern(pattern, d);
                shown.push({ x, text });
                lastX = x;
                lastW = measureLabel(text);
            }
        }
        return shown.map((s, i) => ({ label: s.text, x0: s.x, x1: shown[i + 1]?.x ?? width }));
    }, [startDate, endDate, width, tier, format]);

    return (
        <Box position="relative" width="100%" height={`${height}px`}>
            {cells.map((m, index) => (
                <Box
                    key={`band-${index}`}
                    position="absolute"
                    left={`${m.x0}px`}
                    width={`${Math.max(m.x1 - m.x0, 0)}px`}
                    height="100%"
                    color="fg.muted"
                    css={columnHeaderStyles}
                >
                    {m.label}
                </Box>
            ))}
        </Box>
    );
};
