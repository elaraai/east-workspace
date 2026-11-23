/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The horizon strip (`Plan Spec.md` §7) — the shared brush strip at horizon
 * density over the FULL range domain of the sources holding the window
 * (#1344), in whole periods around their data: gutter caption (`HORIZON · 26
 * WK`), the applied window as a full brush selection, and the now tick.
 * Editing the window here is editing every such source's range — a commit
 * routes through the machine (`brush.commit` → `slice.setRange`), which never
 * stores a window itself, and writes it into each source at once.
 *
 * The strip is an OVERVIEW on its own scale, so it never reads as the grid's
 * (#949): a lens under it joins the window it selected to the plot's edges —
 * the grid below is that window, magnified.
 *
 * Its bars (#1438): over rows read through a nested series index, how much
 * the collections the series shown read hold in each month, as e3 keeps it in
 * the index's span; over record sources holding the window (#1710), how many
 * of every source's rows overlap each month, under its narrowing but the
 * window — each source's months counted through the index its window is read
 * by, every month of it in one request, no row read
 * (`shared/time/horizon-months.ts`). A bar each month, quarter or year, the
 * finest that keeps 4px a bar (`horizonDensity`) — with the largest under the
 * caption, `max 1,559 items / mo`, or `no data`; while a source's months are
 * counted the strip says it reads them.
 *
 * Renders only over a horizon of the AXIS's arm (#631): a `datetime` domain on
 * a time axis, a `float` / `integer` domain on a number axis. The horizon
 * spans every source's domain holding the window — the jobs' and the shifts'
 * together — and the window shown and the axis's stated window with them: the
 * data may fill a few days of the window, or none of it, and the strip still
 * holds what the canvas shows and widens back out to the stated window. A
 * slice with no source holding the window leaves the canvas its
 * own (#1344), and the horizon then spans the axis's stated window and the
 * window shown, with the window shown's length again either side — so the lens
 * never fills the strip and slides either way — and the strip moves the
 * canvas's window as it moves a source's. An ordinal axis has no range arm (its list is its window), so the
 * strip never mounts there; a Plan with no slice has no wider horizon to
 * brush. A record's query moves once per gesture: the strip previews its
 * selection, and commits on release. While the sources' span is read its row
 * is held at its height, a placeholder track in the strip's place (#1398,
 * CL1), so nothing below it moves as the span lands.
 */

import { useCallback, useMemo, useRef } from "react";
import { Box, chakra } from "@chakra-ui/react";
import { BrushStrip, PlaceholderShape, brushHorizon, type BrushBucket, type BrushHeld } from "@elaraai/east-ui-components/internal";
import { useContainerWidth, useSlicesReactivity, useTrackedEvaluation } from "@elaraai/east-ui-components";
import { periodText, resolutionInterval } from "../../shared/time/scale.js";
import { horizonMonths, sourcesMonthCounts } from "../../shared/time/horizon-months.js";
import { brushPeriodsOf, limitWindow } from "../../shared/time/zoom.js";
import { usePlanDispatch, usePlanGeometry, usePlanScale } from "../context.js";
import type { PlanInstantValue } from "../instant.js";
import type { PlanHorizonUnit } from "../messages.js";
import { windowPartsDomain, type PlanWindowDomain, type PlanWindowPart } from "../root/window.js";
import type { PlanNestedSpan, PlanNestedSpanRead, SPAN_READING } from "../root/nested.js";
import { usePlanWords, type PlanWords } from "../words.js";
import { horizonDensity, type HorizonDensity } from "./horizon-density.js";

type Styles = Record<string, Record<string, unknown>>;

/** The lens's viewBox width — its lines' x in these units, stretched to the plot. */
const LENS_W = 1000;

/** How many periods the horizon counts at most — a guard on the walk that
 *  counts them; the histogram caps its bars far below this. */
const MAX_PERIODS = 100_000;

/** A source's range domain, on the axis's arm: its kind, and its bounds as numbers. */
type RecordSliceRange = PlanWindowDomain;

export interface HorizonBrushProps {
    styles: Styles;
    gridTemplate: string;
    /** The sources holding the window: the horizon spans their domains. None, the canvas holds its own window (#1344). */
    parts: readonly PlanWindowPart[];
    /** The axis's stated window, `[from, to)` on its domain: beside the window shown, in every horizon — the horizon of a canvas
     *  holding its own, and taken into the sources' domains where they hold the window. */
    stated: readonly [number, number] | undefined;
    /** The span of what every series reads through the rows' nested series index (#1438, #1440), whichever are shown, or its read in
     *  flight: beside the window shown, the horizon of a canvas holding its own, in place of the stated window's; its months' counts —
     *  the series shown's — its bars. */
    span?: PlanNestedSpanRead | typeof SPAN_READING | undefined;
    /** The now instant, if any (domain tick) — on the axis's arm. */
    now: PlanInstantValue | undefined;
}

/**
 * The horizon of a canvas holding its own window (#1344): the axis's stated
 * window and the window shown, together, with the window shown's length again
 * either side, half-open on the axis's domain — what the strip spans while no
 * source's domain says where the data is. Without the margin the lens would
 * fill the strip whenever the window shown is the stated one, and its body
 * could slide nowhere.
 *
 * @param kind - The axis's arm, as a source's domain names it
 * @param stated - The axis's stated window, if it states one
 * @param shown - The window shown
 * @returns The horizon
 */
function ownHorizon(kind: RecordSliceRange["kind"], stated: readonly [number, number] | undefined, shown: readonly [number, number]): RecordSliceRange {
    const margin = shown[1] - shown[0];
    const min = stated === undefined ? shown[0] : Math.min(stated[0], shown[0]);
    const max = stated === undefined ? shown[1] : Math.max(stated[1], shown[1]);
    return { kind, min: min - margin, max: max + margin };
}

/** The span of a read in flight, as the span's reader names it. */
const READING: typeof SPAN_READING = "reading";

/**
 * The horizon of a canvas holding its own window over rows whose collections
 * it reads through their nested series index (#1438): the span of what its
 * series read, shown or not (#1440), and the window shown — the time it can be
 * brushed to, as a source's domain is.
 *
 * @param span - The span, `[from, to)` in ms
 * @param shown - The window shown
 * @returns The horizon
 */
function spanHorizon(span: PlanNestedSpan, shown: readonly [number, number]): RecordSliceRange {
    return { kind: "datetime", min: Math.min(span[0], shown[0]), max: Math.max(span[1], shown[1]) };
}

/**
 * The horizon's bars as the strip draws them (#1438): each bucket's slot and
 * count, and its hover's words — its period, then its count.
 *
 * @param density - The horizon's buckets
 * @param words - The canvas's words
 * @returns The strip's buckets
 */
function densityBuckets(density: HorizonDensity, words: PlanWords): BrushBucket[] {
    return density.buckets.map((b) => ({
        from: b.from, to: b.to, count: b.count,
        label: `${periodText(b.start, density.unit, words)} · ${words.m.horizonCount({ n: b.count, count: words.number(b.count) })}`,
    }));
}

/** The horizon band — caption gutter cell + the shared brush strip + its lens. */
export function HorizonBrush({ styles, gridTemplate, parts, stated, span: dataSpan, now }: HorizonBrushProps) {
    const dispatch = usePlanDispatch();
    const geometry = usePlanGeometry();
    const words = usePlanWords();
    // The strip's width, which decides the period its bars count by (#1438).
    const trackRef = useRef<HTMLDivElement | null>(null);
    const trackPx = useContainerWidth(trackRef);
    // The scale IS the applied window (slice range ▸ axis ▸ fit), on its
    // own numeric domain — epoch ms, or the value on a number axis.
    const scale = usePlanScale();
    // Self-subscribe (#611): each source's domain is a STORE read through its choices, and a re-render does not
    // bust a memo whose deps did not move.
    useSlicesReactivity(parts.map(({ part }) => part.key));
    const readDomain = useCallback(() => windowPartsDomain(parts), [parts]);
    const { result: recordDomain } = useTrackedEvaluation(readDomain);
    // No source holding the window, the canvas holds its own (#1344): the horizon is the axis's stated window and the
    // window shown, as long again either side, which nothing reads — half-open, as a window is, where a source's domain
    // holds its last value.
    const own = parts.length === 0;
    const shownFrom = scale.toNumber(scale.window.min);
    const shownTo = scale.toNumber(scale.window.max);
    // Over the rows' nested series (#1438), the span of what every series reads (#1440), held while it is read.
    const reading = dataSpan === READING;
    const read = dataSpan === READING ? undefined : dataSpan;
    const domain = own
        ? (scale.kind === "ordinal" ? undefined
            : scale.kind === "time" && reading ? undefined
                : scale.kind === "time" && read !== undefined ? spanHorizon(read.span, [shownFrom, shownTo])
                    : ownHorizon(scale.kind === "time" ? "datetime" : "float", stated, [shownFrom, shownTo]))
        : recordDomain.ok ? recordDomain.value : undefined;
    // The domain must speak the axis's arm — a datetime field on a time
    // axis, a numeric field on a number axis. An ordinal axis never fits.
    const fits = domain !== undefined && domain.max >= domain.min && (
        scale.kind === "time" ? domain.kind === "datetime"
            : scale.kind === "number" ? domain.kind !== "datetime"
                : false);
    // The horizon in WHOLE periods around the data (#949): from the start of
    // the period the first value falls in to the end of the period the last
    // one falls in. Every period then counts once — the last value never
    // piles into the final bar beside the one before it — and the caption
    // counts periods, not the gaps between them. The canvas's own horizon is
    // half-open: it ends at its end where that is a period's edge.
    const statedFrom = stated?.[0];
    const statedTo = stated?.[1];
    const extent = useMemo(() => {
        if (!fits || domain === undefined) return undefined;
        const first = scale.floor(scale.fromNumber(domain.min));
        const last = scale.floor(scale.fromNumber(domain.max));
        const end = own && scale.toNumber(last) >= domain.max ? last : scale.offset(last, 1);
        let lo = scale.toNumber(first);
        let hi = scale.toNumber(end);
        // The sources' domain is where their data is, and the window shown and the stated window are the canvas's
        // whatever the data holds: the horizon takes both in, each in whole periods, ending at its end where that is a
        // period's edge. Without them the window clamped to the data's ends, a window past the data had no place on the
        // strip at all, and no gesture could widen the window back out (#1680's review). The canvas's own horizon holds
        // them already.
        if (!own) {
            const windows: (readonly [number, number])[] = [[shownFrom, shownTo]];
            if (statedFrom !== undefined && statedTo !== undefined) windows.push([statedFrom, statedTo]);
            const periodsOf = ([from, to]: readonly [number, number]): readonly [number, number] => {
                const edge = scale.floor(scale.fromNumber(to));
                return [scale.toNumber(scale.floor(scale.fromNumber(from))), scale.toNumber(edge) >= to ? scale.toNumber(edge) : scale.toNumber(scale.offset(edge, 1))];
            };
            ({ min: lo, end: hi } = brushHorizon({ min: lo, end: hi }, windows.map(periodsOf)));
        }
        if (!(hi > lo)) return undefined;
        let periods = 0;
        for (let t = scale.floor(scale.fromNumber(lo)); scale.toNumber(t) < hi && periods <= MAX_PERIODS; t = scale.offset(t, 1)) periods += 1;
        return { lo, hi, periods };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the domain's bounds are primitives; the object is new per read
    }, [fits, domain?.min, domain?.max, own, scale, shownFrom, shownTo, statedFrom, statedTo]);
    // Its bars over the sources holding the window (#1710): each month's rows of every source, counted through the index
    // its window is read by — every month of a source in one request, no row read — as a nested series' months are e3's.
    const sourceMonths = useMemo(() => (own || extent === undefined || scale.kind !== "time" ? undefined : horizonMonths(extent.lo, extent.hi)),
        [own, extent, scale.kind]);
    const readCounts = useCallback(() => (sourceMonths === undefined ? undefined : sourcesMonthCounts(parts.map(({ part }) => part), sourceMonths)),
        [parts, sourceMonths]);
    const { result: sourceCounts } = useTrackedEvaluation(readCounts);
    if (!own && !recordDomain.ok) return <Box css={styles.partError} role="alert">
        Could not load date span <chakra.button type="button" css={styles.windowRetry} onClick={() => { for (const { part } of parts) part.retry(); }}>Retry</chakra.button>
    </Box>;
    // Its row is held while its span is read (#1398, CL1): the band at its height, a placeholder track in the
    // strip's place and the caption's in its own, so the rows below never move as the span lands.
    if (domain === undefined && (scale.kind === "time" || scale.kind === "number")) {
        return (
            <Box css={styles.brushRow} style={{ gridTemplateColumns: gridTemplate }} data-slot="horizon" data-plan-horizon="pending" aria-hidden="true">
                <Box css={styles.brushCaption}><PlaceholderShape kind="label" index={0} /></Box>
                <Box css={styles.brushPending} />
            </Box>
        );
    }
    if (extent === undefined || domain === undefined) return null;

    const span = extent.hi - extent.lo;
    const clamp = (f: number) => Math.max(0, Math.min(1, f));
    const winFrom = clamp((scale.toNumber(scale.window.min) - extent.lo) / span);
    const winTo = clamp((scale.toNumber(scale.window.max) - extent.lo) / span);
    const nowN = now !== undefined ? scale.toNumber(now) : NaN;
    const nowFrac = Number.isFinite(nowN) ? (nowN - extent.lo) / span : undefined;
    const fromFraction = (f: number): PlanInstantValue => scale.fromNumber(extent.lo + clamp(f) * span);
    const toFrac = (t: PlanInstantValue): number => clamp((scale.toNumber(t) - extent.lo) / span);
    // Resolution-edge snapping: the draft and the committed window land on
    // period boundaries of the ACTIVE resolution (a whole step on a number
    // axis), at least one period wide. The scale's OWN `snap` / `offset` —
    // this band used to carry a hand-copy of the same floor/offset/midpoint
    // over the same interval (#617). On a time axis the window keeps within the
    // most its zoom shows (#1710) — six weeks of days, six months of weeks: the
    // edge the gesture holds stays (the strip names it), and the other gives way.
    const limits = scale.kind === "time" ? brushPeriodsOf(scale.resolution) : undefined;
    const snapPair = (f0: number, f1: number, held?: BrushHeld): readonly [PlanInstantValue, PlanInstantValue] => {
        const a = scale.snap(fromFraction(f0));
        let b = scale.snap(fromFraction(f1));
        if (scale.toNumber(b) <= scale.toNumber(a)) b = scale.offset(a, 1);
        if (limits === undefined) return [a, b];
        return limitWindow(a, b, held === "lo" ? "start" : held === "hi" ? "end" : undefined, limits,
            (at, n) => scale.offset(at, n), (at) => scale.toNumber(at));
    };
    const snapWindow = (f0: number, f1: number, held?: BrushHeld): { from: number; to: number } => {
        const [a, b] = snapPair(f0, f1, held);
        return { from: toFrac(a), to: toFrac(b) };
    };
    // The caption spans the whole brushable horizon, not the applied window
    // — `HORIZON · 26 WK` over a 12-week window; on a number axis the count
    // is in steps — and counts its PERIODS.
    const unit: PlanHorizonUnit = scale.kind === "time" ? (scale.resolution ?? "week") : "step";
    const periods = extent.periods;
    const caption = words.m.horizon({ n: periods, count: words.number(periods), unit });
    // Its bars, in the finest period that keeps 4px a bar: over the rows' nested series, each month's items as e3 keeps them in
    // the index's span (#1438); over the sources holding the window, each month's rows of them all (#1710), the strip saying
    // so while they are counted.
    const months = !own ? (sourceCounts.ok ? sourceCounts.value : undefined) : read?.months;
    const density = scale.kind === "time" && months !== undefined ? horizonDensity(extent.lo, extent.hi, months, trackPx) : undefined;
    const buckets = density === undefined ? undefined : densityBuckets(density, words);
    const counting = !own && scale.kind === "time" && sourceCounts.ok && sourceCounts.value === undefined;
    // A key moves the window a period of the resolution; a handle says its instant — the end handle, on a time axis, the
    // last day inside the window, as the date navigator names it (`max − 1 ms`, its time too at the hour's resolution):
    // the window ends exclusively, so its end's own instant is the next day's start.
    const step = (f: number, n: number): number => toFrac(scale.offset(fromFraction(f), n));
    const valueText = (f: number): string => scale.instantText(fromFraction(f));
    const endText = scale.kind === "time" ? (f: number): string => {
        const last = scale.toNumber(fromFraction(f)) - 1;
        return scale.instantText(scale.fromNumber(scale.resolution === "hour" ? last : resolutionInterval("day").floor(new Date(last)).getTime()));
    } : undefined;
    return (
        <Box css={styles.brushRow} style={{ gridTemplateColumns: gridTemplate }} data-slot="horizon">
            <Box css={styles.brushCaption}>
                <Box as="span" data-plan-horizon-caption="">{caption}</Box>
                {/* The meta line (#1438): the largest bucket and its period, or that nothing is in the horizon. */}
                {density !== undefined && (density.max > 0
                    ? <Box as="span" css={styles.brushMeta} data-plan-horizon-meta="">
                        {words.m.horizonMax({ n: density.max, count: words.number(density.max), unit: density.unit })}
                    </Box>
                    : <Box as="span" css={styles.brushMeta} data-plan-horizon-meta="" data-empty="">{words.m.horizonNoData()}</Box>)}
            </Box>
            {/* Only the STRIP arms the rung — a caption click is not a brush
                gesture, and only strip gestures can ever settle one. */}
            <Box ref={trackRef} css={styles.brushTrack} data-plan-horizon-track="" onPointerDownCapture={() => dispatch({ t: "brush.down" })}>
                <BrushStrip
                    buckets={buckets !== undefined ? () => buckets : counting ? () => "loading" : undefined}
                    step={step}
                    valueText={valueText}
                    endText={endText}
                    words={{ start: words.m.horizonStart(), end: words.m.horizonEnd(), window: words.m.horizonWindow() }}
                    window={winTo > winFrom ? { from: winFrom, to: winTo } : undefined}
                    nowFrac={nowFrac !== undefined && nowFrac >= 0 && nowFrac <= 1 ? nowFrac : undefined}
                    // The strip and its tallest bar are the canvas geometry
                    // (#817) — the band less its lens, bars inset within it.
                    height={geometry.brush - geometry.lens}
                    barHeight={geometry.brushBar}
                    snapWindow={snapWindow}
                    // Snap AGAIN on the instants themselves so float round-trips
                    // can never land the committed window off an edge. A
                    // record's query moves once per gesture: the strip owns the
                    // live selection preview, and the release commits it, so
                    // dragging never floods the server with a new window for
                    // each pointer frame.
                    onCommit={(f0, f1) => {
                        const [a, b] = snapPair(f0, f1);
                        dispatch({ t: "brush.commit", min: a, max: b });
                    }}
                    onClear={() => { dispatch({ t: "brush.clear" }); }}
                    // The esc rung DISARMS when the gesture ends, however it ends — the sub-threshold click where the
                    // strip emits neither a commit nor a clear (`brushRelease` is a noop there), which used to leave
                    // `ui.brush` armed and silently eat the next Escape (#615), and a release off the strip, which no
                    // listener around it hears (#1440).
                    onEnd={() => { dispatch({ t: "brush.up" }); }}
                />
                {/* The lens (#949): from the window's edges on the strip's own
                    scale down to the plot's edges — the grid below is this
                    window, magnified. Geometry only; the recipe draws it. */}
                <chakra.svg css={styles.horizonLens} viewBox={`0 0 ${LENS_W} ${geometry.lens}`}
                    preserveAspectRatio="none" aria-hidden="true" data-plan-lens="">
                    {winTo > winFrom && (
                        <>
                            <line x1={winFrom * LENS_W} y1={0} x2={0} y2={geometry.lens} vectorEffect="non-scaling-stroke" />
                            <line x1={winTo * LENS_W} y1={0} x2={LENS_W} y2={geometry.lens} vectorEffect="non-scaling-stroke" />
                        </>
                    )}
                </chakra.svg>
            </Box>
        </Box>
    );
}
