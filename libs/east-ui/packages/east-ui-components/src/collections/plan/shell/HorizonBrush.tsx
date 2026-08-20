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

import { useEffect, useMemo } from "react";
import { Box } from "@chakra-ui/react";
import { type ValueTypeOf } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { BrushStrip } from "../../../slice/brush-strip.js";
import { boundRangeDomain, boundRangeHistogram } from "../../../platform/slice/index.js";
import { useSliceReactivity } from "../../../slice/use-slice-reactivity.js";
import { usePlanDispatch, usePlanPan, usePlanScale } from "../context.js";
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
    // ── Live preview: TRANSFORM-PAN the canvas, settle on release (#616) ──
    // A window SLIDE (same width) is a pure horizontal translation of every
    // plot layer, so a preview step is one style write through the pan
    // channel — no slice write, no scale rebuild, no re-render. The strip
    // draws the draft either way (masks + handles), an edge RESIZE previews
    // in the strip alone (a width change is not a translation), and the
    // release commits the real window ONCE through the machine. (The
    // per-step live apply this replaces re-derived the whole canvas per
    // snapped step; before that, #610's store staging doubled it.)
    const pan = usePlanPan();
    useEffect(() => pan.clear, [pan]);
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
                    // pan resets in the same frame the commit re-derives, so
                    // content lands exactly where the pan showed it.
                    onCommit={(f0, f1) => {
                        pan.clear();
                        dispatch({ t: "brush.commit", min: snapDate(fromFraction(f0)), max: snapDate(fromFraction(f1)) });
                    }}
                    // Live SLIDE preview — the snapped draft pans the canvas
                    // one discrete column at a time through the pan channel
                    // (a width change is a resize: strip-only preview). A
                    // cancelled / no-op drag re-fires the origin, which is
                    // slide(0) — the reset.
                    onPreview={(f0, f1) => {
                        const a = snapDate(fromFraction(f0));
                        const b = snapDate(fromFraction(f1));
                        const winFrom = window.min.getTime();
                        const winSpan = window.max.getTime() - winFrom;
                        if (winSpan > 0 && Math.abs((b.getTime() - a.getTime()) - winSpan) < 1) {
                            pan.slide((a.getTime() - winFrom) / winSpan);
                        } else {
                            pan.clear();
                        }
                    }}
                    onClear={() => { pan.clear(); dispatch({ t: "brush.clear" }); }}
                />
            </Box>
        </Box>
    );
}
