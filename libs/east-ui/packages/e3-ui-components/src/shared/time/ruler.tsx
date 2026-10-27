/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Shared period/tick bands for Plan, Calendar and the Allocation, on the body's exact scale. */
import { memo, useCallback, useRef, useSyncExternalStore } from "react";
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

/**
 * Where a scrolling timeline's view starts, as a store its sticky bands read (#1398, CL9): the instant at the start of
 * what its view shows, as an epoch — `undefined` before the timeline has laid out — published as it scrolls.
 */
export interface ViewStart {
    readonly get: () => number | undefined;
    /** Hears each move. */
    readonly subscribe: (cb: () => void) => () => void;
}

/** A {@link ViewStart} its timeline publishes to. */
export interface ViewStartStore extends ViewStart {
    /** Publish where the view starts now: its readers hear only as that moves. */
    readonly set: (at: number) => void;
}

/**
 * A store of where a timeline's view starts.
 *
 * @returns The store, before the timeline has laid out
 */
export function createViewStart(): ViewStartStore {
    let start: number | undefined;
    const listeners = new Set<() => void>();
    return {
        get: () => start,
        set(at) {
            if (at === start) return;
            start = at;
            for (const cb of [...listeners]) cb();
        },
        subscribe(cb) {
            listeners.add(cb);
            return () => { listeners.delete(cb); };
        },
    };
}

/**
 * How far either side of the period a view starts in its band's captions stick, in periods: the next one is sticky
 * before the view gets there, so a scroll the compositor draws ahead of the page never finds it standing still.
 */
const STICK_REACH = 1;

/**
 * The period of a band an instant falls in: its bucket's place in the band.
 *
 * @param scale - The band's scale, its buckets in order along time
 * @param at - The instant, as an epoch; `undefined` before its timeline has laid out
 * @returns The bucket's place; -1 for an instant in none
 */
function bucketAt<I>(scale: RulerScale<I>, at: number | undefined): number {
    if (at === undefined) return -1;
    const { buckets } = scale;
    let low = 0, high = buckets.length;
    while (low < high) {
        const mid = (low + high) >> 1;
        if (scale.toNumber(buckets[mid]!.end) <= at) low = mid + 1;
        else high = mid;
    }
    return low < buckets.length && scale.toNumber(buckets[low]!.start) <= at ? low : -1;
}

/** Nothing to hear: a band that does not stick. */
const NOTHING = () => () => {};

/** A ruler band's column and its caption: drawn again only as what it shows moves. */
const RulerTick = memo(function RulerTick({ styles, x0, x1, label, slot, now, marked, periodStart, thinned, align, calendar, sticks }: {
    styles: Styles; x0: number; x1: number; label: string; slot: string | undefined; now: boolean; marked: boolean; periodStart: boolean;
    thinned: boolean; align: string | undefined; calendar: boolean; sticks: boolean;
}) {
    return <Box css={styles.rulerTick} data-slot={slot} data-now={now ? "" : undefined} data-marked={marked ? "" : undefined}
        data-period-start={periodStart ? "" : undefined} data-thinned={thinned ? "" : undefined} data-align={align}
        style={{ left: `${x0 * 100}%`, width: `${(x1 - x0) * 100}%` }}>
        <Box as="span" css={styles.rulerLabel} data-tick-label="" data-calendar-ruler-label={calendar ? "" : undefined} data-sticks={sticks ? "" : undefined}>{label}</Box>
    </Box>;
});

/** A ruler band's props. */
interface TimeRulerRowProps<I> {
    scale: RulerScale<I>; styles: Styles; band: "units" | "ticks"; owner: "plan" | "plan-narrow" | "calendar" | "allocation";
    /**
     * A scrolling timeline's band (#1398, CL9): where its view starts. The caption of the period it starts in sticks
     * inside its column beside the timeline's sticky column — that caption and its neighbours alone (`data-sticks`), its
     * host's recipe making them sticky; every other caption stands where its column starts, as one that cannot stick
     * stands. A sticky caption is a layer of the compositor's own: a band of them, one a period, was most of what a frame
     * of the timeline's glide spent compositing.
     */
    sticky?: ViewStart | undefined;
    highlight?: number | undefined;
    /** Buckets the host marks (`data-marked`): the Allocation's focus's hold. */
    marked?: ((bucket: ScaleBucket<I>) => boolean) | undefined;
}

/** A ruler band. Plan fits complete labels before paint; scrolling timelines
 * keep the caption of the period their view starts in sticky inside its own column instead.
 */
function TimeRulerRowOf<I>({ scale, styles, band, owner, sticky, highlight, marked }: TimeRulerRowProps<I>) {
    const trackRef = useRef<HTMLDivElement>(null);
    const placed = useRulerFit(trackRef, scale, highlight, sticky === undefined);
    // The period the view starts in: drawn again only as that moves, each column only as its own sticking does.
    const startIn = useCallback(() => sticky === undefined ? -1 : bucketAt(scale, sticky.get()), [sticky, scale]);
    const at = useSyncExternalStore(sticky?.subscribe ?? NOTHING, startIn, startIn);
    const plan = owner === "plan" || owner === "plan-narrow";
    const slot = !plan ? undefined : band === "units" ? "rulerUnit" : owner === "plan" ? "rulerTick" : "narrowRulerTick";
    return <Box ref={trackRef} css={styles.rulerRow} data-time-ruler={band}
        data-calendar-ruler={owner === "calendar" ? band : undefined}
        data-allocation-ruler={owner === "allocation" ? band : undefined}
        data-plan-ruler={plan ? band : undefined}>
        {scale.buckets.map((bucket, i) => <RulerTick key={bucket.index} styles={styles} x0={bucket.x0} x1={bucket.x1} label={bucket.label} slot={slot}
            now={bucket.index === highlight} marked={marked?.(bucket) === true} periodStart={startsPeriod(scale, bucket)}
            thinned={placed !== undefined && !placed.shown[i]} align={placed?.align[i] !== "centre" ? placed?.align[i] : undefined}
            calendar={owner === "calendar"} sticks={at >= 0 && Math.abs(i - at) <= STICK_REACH} />)}
    </Box>;
}

/** A ruler band (see {@link TimeRulerRowProps}): drawn again only as its props, or the period its view starts in, move. */
export const TimeRulerRow = memo(TimeRulerRowOf) as typeof TimeRulerRowOf;
