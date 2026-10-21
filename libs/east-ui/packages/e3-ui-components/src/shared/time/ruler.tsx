/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Shared period/tick bands for Plan, Calendar and the Allocation, on the body's exact scale. */
import { useRef } from "react";
import { Box } from "@chakra-ui/react";
import { MAX_BUCKETS, TIME_WORDS, periodText, resolutionInterval, type Scale, type ScaleBucket, type TimeResolution, type TimeWords } from "./scale.js";
import { startsPeriod, useRulerFit, type RulerScale } from "./use-ruler-fit.js";

type Styles = Record<string, Record<string, unknown>>;
const PARENT: Record<TimeResolution, TimeResolution> = {
    hour: "day", day: "week", week: "month", month: "year", quarter: "year", year: "year",
};

/** Group the visible scale into calendar periods without widening its domain.
 * Edge periods clip to the same window as the body; a truncated scale stops
 * at the last drawn bucket. Year ticks group into decades.
 */
export function timeRulerUnits<I>(scale: Scale<I, string>, words: TimeWords = TIME_WORDS, unit?: TimeResolution): RulerScale<Date> | undefined {
    if (scale.kind !== "time" || scale.resolution === undefined) return undefined;
    const resolution = unit ?? PARENT[scale.resolution];
    const decade = unit === undefined && scale.resolution === "year";
    const interval = resolutionInterval(resolution);
    const min = scale.toNumber(scale.window.min), max = scale.toNumber(scale.window.max);
    const span = max - min;
    const covered = min + (scale.buckets.at(-1)?.x1 ?? 0) * span;
    let start = interval.floor(new Date(min));
    if (decade) start.setUTCFullYear(Math.floor(start.getUTCFullYear() / 10) * 10);
    const buckets: ScaleBucket<Date>[] = [];
    while (start.getTime() < covered && buckets.length < MAX_BUCKETS) {
        const end = interval.offset(start, decade ? 10 : 1);
        buckets.push({ index: buckets.length, start, end,
            x0: (Math.max(min, start.getTime()) - min) / span,
            x1: (Math.min(covered, end.getTime()) - min) / span,
            label: decade ? `${words.year(start)}–${words.year(new Date(end.getTime() - 1))}` : periodText(start, resolution, words),
        });
        start = end;
    }
    return { kind: "time", resolution, buckets, toNumber: date => date.getTime() };
}

/** A ruler band. Plan fits complete labels before paint; scrolling timelines
 * keep each period caption sticky inside its own column instead.
 */
export function TimeRulerRow<I>({ scale, styles, band, owner, sticky = false, highlight, marked }: {
    scale: RulerScale<I>; styles: Styles; band: "units" | "ticks"; owner: "plan" | "plan-narrow" | "calendar" | "allocation"; sticky?: boolean; highlight?: number | undefined;
    /** Buckets the host marks (`data-marked`): the Allocation's focus's hold. */
    marked?: ((bucket: ScaleBucket<I>) => boolean) | undefined;
}) {
    const trackRef = useRef<HTMLDivElement>(null);
    const placed = useRulerFit(trackRef, scale, highlight, !sticky);
    const plan = owner === "plan" || owner === "plan-narrow";
    return <Box ref={trackRef} css={styles.rulerRow} data-time-ruler={band}
        data-calendar-ruler={owner === "calendar" ? band : undefined}
        data-allocation-ruler={owner === "allocation" ? band : undefined}
        data-plan-ruler={plan ? band : undefined}>
        {scale.buckets.map((bucket, i) => <Box key={bucket.index} css={styles.rulerTick}
            data-slot={!plan ? undefined : band === "units" ? "rulerUnit" : owner === "plan" ? "rulerTick" : "narrowRulerTick"}
            data-now={bucket.index === highlight ? "" : undefined}
            data-marked={marked?.(bucket) === true ? "" : undefined}
            data-period-start={startsPeriod(scale, bucket) ? "" : undefined}
            data-thinned={placed !== undefined && !placed.shown[i] ? "" : undefined}
            data-align={placed?.align[i] !== "centre" ? placed?.align[i] : undefined}
            style={{ left: `${bucket.x0 * 100}%`, width: `${(bucket.x1 - bucket.x0) * 100}%` }}>
            <Box as="span" css={styles.rulerLabel} data-tick-label="" data-calendar-ruler-label={owner === "calendar" ? "" : undefined}>{bucket.label}</Box>
        </Box>)}
    </Box>;
}
