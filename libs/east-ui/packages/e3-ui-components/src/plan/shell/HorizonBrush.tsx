/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The horizon strip (`Plan Spec.md` §7) — the shared brush strip at horizon
 * density over the bound slice's FULL range domain, in whole periods around
 * its data: gutter caption (`HORIZON · 26 WK`), self-excluding row-count
 * histogram (one bar per period, #949), the applied window as a full brush
 * selection, and the now tick. Editing the window here is editing the slice's
 * Range — commits route through the machine (`brush.commit` →
 * `slice.setRange`), which never stores a window itself.
 *
 * The strip is an OVERVIEW on its own scale, so it never reads as the grid's
 * (#949): a lens under it joins the window it selected to the plot's edges —
 * the grid below is that window, magnified.
 *
 * Renders only when a slice is bound with a range domain of the AXIS's arm
 * (#631): a `datetime` domain on a time axis, a `float` / `integer` domain on
 * a number axis — the brush speaks whichever the slice's field is, and every
 * step it applies is written as that arm. An ordinal axis has no range arm
 * (its list is its window), so the strip never mounts there; an unbound Plan
 * has no wider horizon to brush.
 */

import { useEffect, useMemo, useRef } from "react";
import { Box, chakra } from "@chakra-ui/react";
import { some, type ValueTypeOf } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { BrushStrip, boundRangeDomain, boundRangeHistogram } from "@elaraai/east-ui-components/internal";
import { useSliceReactivity } from "@elaraai/east-ui-components";
import { usePlanDispatch, usePlanGeometry, usePlanScale } from "../context.js";
import { rangeArmOf, rangeOf } from "../axis.js";
import type { PlanInstantValue } from "../instant.js";
import type { PlanHorizonUnit } from "../messages.js";
import { usePlanWords } from "../words.js";

type Styles = Record<string, Record<string, unknown>>;
type SliceBindValue = ValueTypeOf<typeof Slice.Types.Bind>;

/** The lens's viewBox width — its lines' x in these units, stretched to the plot. */
const LENS_W = 1000;

/** How many periods the horizon counts at most — a guard on the walk that
 *  counts them; the histogram caps its bars far below this. */
const MAX_PERIODS = 100_000;

export interface HorizonBrushProps {
    styles: Styles;
    gridTemplate: string;
    slice: SliceBindValue;
    /** The now instant, if any (domain tick) — on the axis's arm. */
    now: PlanInstantValue | undefined;
}

/** The horizon band — caption gutter cell + the shared brush strip + its lens. */
export function HorizonBrush({ styles, gridTemplate, slice, now }: HorizonBrushProps) {
    const dispatch = usePlanDispatch();
    const geometry = usePlanGeometry();
    const words = usePlanWords();
    // The scale IS the applied window (slice range ▸ axis ▸ fit), on its
    // own numeric domain — epoch ms, or the value on a number axis.
    const scale = usePlanScale();
    // ── Live PER-STEP application (#620; the #609 pattern, resizes too) ──
    // The draft is SNAPPED to period edges, so it changes a handful of times
    // per gesture — there is nothing per-frame to smooth, and a transform
    // preview of stale DOM lies (the reverted #620 attempt scaled plain
    // slides wherever the snapped draft's ms-width differed from the applied
    // window's — month/quarter periods, unaligned windows, edge clamps).
    // Instead, each snapped step WRITES the draft window to the slice,
    // rAF-coalesced: every mid-gesture frame is a real render of the draft —
    // grid, ruler, geometry and zoom are correct by construction, and the
    // post-#616 canvas (virtualized rows, memoized row layer) makes a step
    // a few milliseconds. A cancelled / no-op drag re-fires the origin
    // through the same channel, so the window always lands somewhere
    // deliberate; the release's commit cancels any pending frame so it is
    // always the last write.
    const stepFrameRef = useRef<number | null>(null);
    const stepPendingRef = useRef<{ min: PlanInstantValue; max: PlanInstantValue } | null>(null);
    useEffect(() => () => {
        if (stepFrameRef.current !== null) cancelAnimationFrame(stepFrameRef.current);
    }, []);
    // Self-subscribe (#611): the histogram is a STORE read, and a re-render
    // does not bust a memo whose deps did not move — the version has to be
    // one of them. (The previous disable comment justified the old deps with
    // "useSliceReactivity re-renders on change", which is exactly the
    // misconception: it re-renders, and the memo then serves the stale value.)
    const sliceVersion = useSliceReactivity(slice.key);
    const domain = boundRangeDomain(slice.key);
    // The domain must speak the axis's arm — a datetime field on a time
    // axis, a numeric field on a number axis. An ordinal axis never fits.
    const fits = domain !== undefined && domain.max > domain.min && (
        scale.kind === "time" ? domain.kind === "datetime"
            : scale.kind === "number" ? domain.kind !== "datetime"
                : false);
    // The horizon in WHOLE periods around the data (#949): from the start of
    // the period the first value falls in to the end of the period the last
    // one falls in. Every period then counts once — the last value never
    // piles into the final bar beside the one before it — and the caption
    // counts periods, not the gaps between them.
    const extent = useMemo(() => {
        if (!fits || domain === undefined) return undefined;
        const first = scale.floor(scale.fromNumber(domain.min));
        const end = scale.offset(scale.floor(scale.fromNumber(domain.max)), 1);
        const lo = scale.toNumber(first);
        const hi = scale.toNumber(end);
        if (!(hi > lo)) return undefined;
        let periods = 0;
        for (let t = first; scale.toNumber(t) < hi && periods <= MAX_PERIODS; t = scale.offset(t, 1)) periods += 1;
        return { lo, hi, periods };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the domain's bounds are primitives; the object is new per read
    }, [fits, domain?.min, domain?.max, scale]);
    // One histogram bar per period (the §2 mock: 26 weekly bars over a
    // 26-week horizon), capped for a very long horizon.
    const buckets = extent !== undefined ? Math.max(1, Math.min(64, extent.periods)) : 0;
    const counts = useMemo(
        () => (extent !== undefined && buckets > 0 ? boundRangeHistogram(slice.key, buckets, { min: extent.lo, max: extent.hi }) : undefined),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- sliceVersion IS the histogram's dependency: it re-derives when the STORE moves (#611)
        [slice.key, buckets, extent, sliceVersion],
    );
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
    // over the same interval (#617).
    const snapPair = (f0: number, f1: number): [PlanInstantValue, PlanInstantValue] => {
        const a = scale.snap(fromFraction(f0));
        let b = scale.snap(fromFraction(f1));
        if (scale.toNumber(b) <= scale.toNumber(a)) b = scale.offset(a, 1);
        return [a, b];
    };
    const snapWindow = (f0: number, f1: number): { from: number; to: number } => {
        const [a, b] = snapPair(f0, f1);
        return { from: toFrac(a), to: toFrac(b) };
    };
    // The caption spans the whole brushable horizon, not the applied window
    // — `HORIZON · 26 WK` over a 12-week window; on a number axis the count
    // is in steps — and counts its PERIODS.
    const unit: PlanHorizonUnit = scale.kind === "time" ? (scale.resolution ?? "week") : "step";
    const periods = extent.periods;
    const caption = words.m.horizon({ n: periods, count: words.number(periods), unit });
    // Every write speaks the slice field's arm (#631): `datetime` on a time
    // axis; `float` / `integer` per the field on a number axis — an Integer
    // field needs bigint bounds or the range is inert (#167).
    const arm = rangeArmOf(scale.kind, slice.read(), domain.kind);
    if (arm === undefined) return null;

    // One coalesced slice write per frame — the LAST step wins the frame.
    const applyStep = (min: PlanInstantValue, max: PlanInstantValue) => {
        stepPendingRef.current = { min, max };
        stepFrameRef.current ??= requestAnimationFrame(() => {
            stepFrameRef.current = null;
            const w = stepPendingRef.current;
            stepPendingRef.current = null;
            if (w !== null) slice.setRange(some(rangeOf(arm, w.min, w.max)));
        });
    };
    const cancelStep = () => {
        if (stepFrameRef.current !== null) {
            cancelAnimationFrame(stepFrameRef.current);
            stepFrameRef.current = null;
        }
        stepPendingRef.current = null;
    };

    return (
        <Box css={styles.brushRow} gridTemplateColumns={gridTemplate} data-slot="horizon"
            // The esc rung DISARMS on any release — including the
            // sub-threshold click where the strip emits neither a commit nor
            // a clear (`brushRelease` is a noop there), which used to leave
            // `ui.brush` armed forever and silently eat the next Escape (#615).
            onPointerUpCapture={() => dispatch({ t: "brush.up" })}
            onPointerCancelCapture={() => dispatch({ t: "brush.up" })}>
            <Box css={styles.brushCaption}>{caption}</Box>
            {/* Only the STRIP arms the rung — a caption click is not a brush
                gesture, and only strip gestures can ever settle one. */}
            <Box minWidth={0} onPointerDownCapture={() => dispatch({ t: "brush.down" })}>
                <BrushStrip
                    counts={counts}
                    window={winTo > winFrom ? { from: winFrom, to: winTo } : undefined}
                    nowFrac={nowFrac !== undefined && nowFrac >= 0 && nowFrac <= 1 ? nowFrac : undefined}
                    // The strip and its tallest bar are the canvas geometry
                    // (#817) — the band less its lens, bars inset within it.
                    height={geometry.brush - geometry.lens}
                    barHeight={geometry.brushBar}
                    snapWindow={snapWindow}
                    // Snap AGAIN on the instants themselves so float round-trips
                    // can never land the committed window off an edge. The
                    // commit cancels any pending step frame, so it is always
                    // the last write.
                    onCommit={(f0, f1) => {
                        cancelStep();
                        const [a, b] = snapPair(f0, f1);
                        dispatch({ t: "brush.commit", min: a, max: b });
                    }}
                    // Live per-step application — the strip fires only when
                    // the SNAPPED draft changes (one step per period-boundary
                    // crossing), and each step writes the draft window to the
                    // slice: moves slide the real canvas, resizes zoom it.
                    // The one-period floor mirrors `snapWindow`, so what the
                    // steps show is exactly what the release commits.
                    onPreview={(f0, f1) => {
                        const [a, b] = snapPair(f0, f1);
                        applyStep(a, b);
                    }}
                    onClear={() => { cancelStep(); dispatch({ t: "brush.clear" }); }}
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
