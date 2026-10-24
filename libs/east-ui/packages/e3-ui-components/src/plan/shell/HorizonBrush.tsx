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
 * Renders only when a source holds a range domain of the AXIS's arm (#631): a
 * `datetime` domain on a time axis, a `float` / `integer` domain on a number
 * axis. The horizon spans every such source's domain: the jobs' and the
 * shifts' together. An ordinal axis has no range arm (its list is its window),
 * so the strip never mounts there; a Plan with no slice has no wider horizon
 * to brush. A record's query moves once per gesture: the strip previews its
 * selection, and commits on release. While the sources' span is read its row
 * is held at its height, a placeholder track in the strip's place (#1398,
 * CL1), so nothing below it moves as the span lands.
 */

import { useCallback, useMemo } from "react";
import { Box, chakra } from "@chakra-ui/react";
import { BrushStrip, PlaceholderShape, recordSliceDomain } from "@elaraai/east-ui-components/internal";
import { useSlicesReactivity, useTrackedEvaluation } from "@elaraai/east-ui-components";
import { usePlanDispatch, usePlanGeometry, usePlanScale } from "../context.js";
import type { PlanInstantValue } from "../instant.js";
import type { PlanHorizonUnit } from "../messages.js";
import type { PlanWindowPart } from "../root/window.js";
import { usePlanWords } from "../words.js";

type Styles = Record<string, Record<string, unknown>>;

/** The lens's viewBox width — its lines' x in these units, stretched to the plot. */
const LENS_W = 1000;

/** How many periods the horizon counts at most — a guard on the walk that
 *  counts them; the histogram caps its bars far below this. */
const MAX_PERIODS = 100_000;

/** A source's range domain, on the axis's arm: its kind, and its bounds as numbers. */
type RecordSliceRange = NonNullable<ReturnType<typeof recordSliceDomain>>;

export interface HorizonBrushProps {
    styles: Styles;
    gridTemplate: string;
    /** The sources holding the window: the horizon spans their domains. */
    parts: readonly PlanWindowPart[];
    /** The now instant, if any (domain tick) — on the axis's arm. */
    now: PlanInstantValue | undefined;
}

/**
 * The horizon over several sources' domains: from the earliest to the latest
 * of them, each of the axis's arm.
 *
 * @param parts - The sources holding the window
 * @returns Their horizon; `undefined` while no source has a domain
 */
function horizonOf(parts: readonly PlanWindowPart[]): RecordSliceRange | undefined {
    let out: RecordSliceRange | undefined;
    for (const { part } of parts) {
        const domain = recordSliceDomain(part);
        if (domain === undefined) continue;
        out = out === undefined ? domain : { kind: out.kind, min: Math.min(out.min, domain.min), max: Math.max(out.max, domain.max) };
    }
    return out;
}

/** The horizon band — caption gutter cell + the shared brush strip + its lens. */
export function HorizonBrush({ styles, gridTemplate, parts, now }: HorizonBrushProps) {
    const dispatch = usePlanDispatch();
    const geometry = usePlanGeometry();
    const words = usePlanWords();
    // The scale IS the applied window (slice range ▸ axis ▸ fit), on its
    // own numeric domain — epoch ms, or the value on a number axis.
    const scale = usePlanScale();
    // Self-subscribe (#611): each source's domain is a STORE read through its choices, and a re-render does not
    // bust a memo whose deps did not move.
    useSlicesReactivity(parts.map(({ part }) => part.key));
    const readDomain = useCallback(() => horizonOf(parts), [parts]);
    const { result: recordDomain } = useTrackedEvaluation(readDomain);
    const domain = recordDomain.ok ? recordDomain.value : undefined;
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
    if (!recordDomain.ok) return <Box css={styles.partError} role="alert">
        Could not load date span <chakra.button type="button" css={styles.windowRetry} onClick={() => { for (const { part } of parts) part.retry(); }}>Retry</chakra.button>
    </Box>;
    // Its row is held while its span is read (#1398, CL1): the band at its height, a placeholder track in the
    // strip's place and the caption's in its own, so the rows below never move as the span lands.
    if (domain === undefined && (scale.kind === "time" || scale.kind === "number")) {
        return (
            <Box css={styles.brushRow} gridTemplateColumns={gridTemplate} data-slot="horizon" data-plan-horizon="pending" aria-hidden="true">
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
            <Box css={styles.brushTrack} onPointerDownCapture={() => dispatch({ t: "brush.down" })}>
                <BrushStrip
                    counts={undefined}
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
