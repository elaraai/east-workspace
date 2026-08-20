/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The horizon strip (32px, `Plan Spec.md` §7) — the shared brush strip at
 * horizon density over the bound slice's FULL range domain: gutter caption
 * (`HORIZON · 26 WK`), self-excluding row-count histogram, the applied window
 * as a full brush selection, and the now tick. Editing the window here is
 * editing the slice's Range — commits route through the machine
 * (`brush.commit` → `slice.setRange`), which never stores a window itself.
 *
 * Renders only when a slice is bound with a usable datetime range domain —
 * an unbound Plan has no wider horizon to brush.
 */

import { useEffect, useMemo, useRef } from "react";
import { Box } from "@chakra-ui/react";
import { some, variant, type ValueTypeOf } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { BrushStrip } from "../../../slice/brush-strip.js";
import { boundRangeDomain, boundRangeHistogram } from "../../../platform/slice/index.js";
import { useSliceReactivity } from "../../../slice/use-slice-reactivity.js";
import { usePlanDispatch, usePlanScale } from "../context.js";
import { resolutionInterval, type PlanWindow } from "../scale.js";

type Styles = Record<string, Record<string, unknown>>;
type SliceBindValue = ValueTypeOf<typeof Slice.Types.Bind>;

/** Strip height / max bar height (the §7 sheet: 32px, bars 5px+4px inset). */
const STRIP_H = 32;
const BAR_H = 23;

/** Resolution → the caption unit + its span in ms (for `HORIZON · 26 WK`). */
const CAPTION_UNIT: Record<string, { label: string; ms: number }> = {
    hour: { label: "HR", ms: 3_600_000 },
    day: { label: "D", ms: 86_400_000 },
    week: { label: "WK", ms: 7 * 86_400_000 },
    month: { label: "MO", ms: 30 * 86_400_000 },
    quarter: { label: "Q", ms: 91 * 86_400_000 },
    year: { label: "YR", ms: 365 * 86_400_000 },
};

export interface HorizonBrushProps {
    styles: Styles;
    gridTemplate: string;
    slice: SliceBindValue;
    /** The Plan's current window (the applied brush selection). */
    window: PlanWindow;
    /** The now instant, if any (domain tick). */
    now: Date | undefined;
    /** The bucket resolution (caption unit — the caption spans the DOMAIN). */
    resolution: string;
}

/** The 32px horizon band — caption gutter cell + the shared brush strip. */
export function HorizonBrush({ styles, gridTemplate, slice, window, now, resolution }: HorizonBrushProps) {
    const dispatch = usePlanDispatch();
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
    const stepPendingRef = useRef<PlanWindow | null>(null);
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
    // One histogram bucket per resolution period across the domain (the §2
    // mock: 26 weekly bars over a 26-week horizon), clamped to sanity.
    const unitMs = (CAPTION_UNIT[resolution] ?? CAPTION_UNIT.week!).ms;
    const buckets = domain !== undefined
        ? Math.max(8, Math.min(64, Math.round((domain.max - domain.min) / unitMs)))
        : 0;
    const counts = useMemo(
        () => (domain !== undefined ? boundRangeHistogram(slice.key, buckets) : undefined),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- sliceVersion IS the histogram's dependency: it re-derives when the STORE moves (#611)
        [slice.key, buckets, domain?.min, domain?.max, sliceVersion],
    );
    if (domain === undefined || domain.kind !== "datetime" || domain.max <= domain.min) return null;

    const span = domain.max - domain.min;
    const winFrom = Math.max(0, (window.min.getTime() - domain.min) / span);
    const winTo = Math.min(1, (window.max.getTime() - domain.min) / span);
    const nowFrac = now !== undefined ? (now.getTime() - domain.min) / span : undefined;
    const fromFraction = (f: number) => new Date(domain.min + Math.max(0, Math.min(1, f)) * span);
    // Resolution-edge snapping: the draft and the committed window land on
    // period boundaries of the ACTIVE resolution, at least one period wide.
    // The scale's OWN `snap` — this band used to carry a hand-copy of the
    // same floor/offset/midpoint over the same interval (#617).
    const interval = resolutionInterval(scale.resolution);
    const snapDate = scale.snap;
    const toFrac = (d: Date) => Math.max(0, Math.min(1, (d.getTime() - domain.min) / span));
    const snapWindow = (f0: number, f1: number): { from: number; to: number } => {
        const a = snapDate(fromFraction(f0));
        let b = snapDate(fromFraction(f1));
        if (b.getTime() <= a.getTime()) b = interval.offset(a, 1);
        return { from: toFrac(a), to: toFrac(b) };
    };
    // The caption spans the DOMAIN (the whole brushable horizon), not the
    // applied window — `HORIZON · 26 WK` over a 12-week window.
    const unit = CAPTION_UNIT[resolution] ?? CAPTION_UNIT.week!;
    const caption = `HORIZON · ${Math.max(1, Math.round(span / unitMs))} ${unit.label}`;

    // One coalesced slice write per frame — the LAST step wins the frame.
    const applyStep = (min: Date, max: Date) => {
        stepPendingRef.current = { min, max };
        stepFrameRef.current ??= requestAnimationFrame(() => {
            stepFrameRef.current = null;
            const w = stepPendingRef.current;
            stepPendingRef.current = null;
            if (w !== null) slice.setRange(some(variant("datetime", { from: w.min, to: w.max })));
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
                    height={STRIP_H}
                    barHeight={BAR_H}
                    snapWindow={snapWindow}
                    // Snap AGAIN on the dates themselves so float round-trips
                    // can never land the committed window 1ms off an edge. The
                    // commit cancels any pending step frame, so it is always
                    // the last write.
                    onCommit={(f0, f1) => {
                        cancelStep();
                        dispatch({ t: "brush.commit", min: snapDate(fromFraction(f0)), max: snapDate(fromFraction(f1)) });
                    }}
                    // Live per-step application — the strip fires only when
                    // the SNAPPED draft changes (one step per period-boundary
                    // crossing), and each step writes the draft window to the
                    // slice: moves slide the real canvas, resizes zoom it.
                    // The one-period floor mirrors `snapWindow`, so what the
                    // steps show is exactly what the release commits.
                    onPreview={(f0, f1) => {
                        const a = snapDate(fromFraction(f0));
                        let b = snapDate(fromFraction(f1));
                        if (b.getTime() <= a.getTime()) b = interval.offset(a, 1);
                        applyStep(a, b);
                    }}
                    onClear={() => { cancelStep(); dispatch({ t: "brush.clear" }); }}
                />
            </Box>
        </Box>
    );
}
