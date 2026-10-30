/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The shared brush strip — the horizon brush (#1438) over the `brush-math`
 * gesture machine, used by the standalone `Slice.Rail` brush and the Plan
 * canvas's horizon band.
 *
 * Pure presentation + gesture: the host owns the domain (fraction ↔ value
 * mapping), the histogram's buckets and their counts, and the actual range
 * write. Bottom to top the strip draws:
 *
 * - the track, `bg.surface` edge to edge — nothing masks outside the window;
 * - the window band, `brandTint` at 0.7, the track's full height, behind the
 *   bars;
 * - the baseline, 1px of `border.subtle` along the track's bottom, under the
 *   bars: it shows in their gaps and under an empty bucket;
 * - the bars (`brushBars`), one width, each its bucket's count twice — by
 *   height and by a step on the heat ramp — at 0.45 outside the window and
 *   at full strength inside it: the same bars again on a layer clipped to
 *   the window, so an edge can split a bar;
 * - the now line, 1px of `brand.solid`, the track's full height;
 * - the handles: an outlined tab on each edge, in a zone 12 wide (24 on a
 *   coarse pointer); while the window is narrower than its two zones, each
 *   zone sits beside its edge — outside it, or against the track's end just
 *   inside it — its tab drawn over it, so a press inside the window moves it;
 * - the hover's Tooltip, 8 above the track over the bucket under the
 *   pointer: its bucket, then its count.
 *
 * It runs the draw / slide / resize pointer machine, reporting the result as
 * window fractions, and the keys: the start handle, the window and the end
 * handle are three stops, each a slider; an arrow moves one period, Shift ten,
 * Home and End go to the track's ends, Escape clears the range. During a drag
 * the draft window is drawn as the applied one is — what you see mid-gesture
 * is exactly what releases — and the hover's Tooltip hides.
 */

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Box, Portal, Tooltip, useSlotRecipe } from "@chakra-ui/react";
import { useDrag } from "@use-gesture/react";
import { useCoarsePointer, useContainerWidth } from "../contracts/adaptive.js";
import {
    BRUSH_HANDLE_COARSE_PX, BRUSH_HANDLE_PX, brushBars, brushBucketAt, brushCursor, brushDragWindow, brushHitTest, brushKey, brushNarrow, brushRelease,
    brushZoneSides, type BrushZoneSide,
    type BrushBar, type BrushBucketSpan, type BrushDrag, type BrushKeyTarget,
} from "./brush-math.js";

/** A bucket of the strip's histogram: its slot on the track, its count, and what its hover says. */
export interface BrushBucket extends BrushBucketSpan {
    /** Its hover's words: its bucket, then its count — `March 2024 · 1,284 items`. */
    label: string;
}

/** The names the strip's three stops are read by. */
export interface BrushWords {
    /** The start handle's. */
    start: string;
    /** The end handle's. */
    end: string;
    /** The window's, between them. */
    window: string;
}

const DEFAULT_WORDS: BrushWords = { start: "Window start", end: "Window end", window: "Window" };

/** A period the keys move by when the host names none: a hundredth of the track. */
const defaultStep = (f: number, periods: number): number => f + periods / 100;

/** A handle's value as words when the host names none: its place on the track. */
const defaultValueText = (f: number): string => `${Math.round(f * 100)}%`;

export interface BrushStripProps {
    /**
     * The histogram (#1438), for the track's width in px: its buckets along the
     * track — each its slot as fractions, its count and its hover's words — or
     * `"loading"` while their counts are read. `undefined`, or none counting
     * anything, draws the baseline alone.
     */
    buckets?: ((trackPx: number) => readonly BrushBucket[] | "loading" | undefined) | undefined;
    /** The applied window as track fractions `[0, 1]`; `undefined` ⇒ no window: no band, no handles, every bar at full strength. */
    window: { from: number; to: number } | undefined;
    /** Optional now-instant fraction — the now line. */
    nowFrac?: number | undefined;
    /** Track height in px (rail 28 / 18; Plan horizon 32, 44 on a coarse pointer). */
    height: number;
    /** The tallest a bar draws, px — the track less its 4px headroom. */
    barHeight: number;
    /** A drag or a key committed a window (fractions, `from < to`). */
    onCommit: (from: number, to: number) => void;
    /** A sub-threshold click on empty track, or Escape, cleared the window. */
    onClear: () => void;
    /**
     * Optional: a gesture on the strip ended, however and wherever it ended —
     * committed, cleared, a click that changed nothing, cancelled, or let go
     * off the strip, where nothing around the strip hears the release.
     */
    onEnd?: (() => void) | undefined;
    /**
     * Optional window snapping (fraction pair → fraction pair) — applied to
     * the in-flight draft AND the committed window, so what you see
     * mid-gesture is exactly what releases. The host owns the semantics
     * (e.g. the Plan snaps to resolution-period edges with a one-period
     * minimum width).
     */
    snapWindow?: ((from: number, to: number) => { from: number; to: number }) | undefined;
    /**
     * Optional live preview while adjusting an EXISTING window (move /
     * resize — never a fresh draw): fired with the snapped draft fractions
     * each time they CHANGE, so a snapping host applies the pan in discrete
     * per-period steps rather than per pixel. A cancelled or no-op-released
     * drag re-fires the origin window, so live-applied hosts always land
     * back where the drag started.
     */
    onPreview?: ((from: number, to: number) => void) | undefined;
    /** Moves a fraction by whole periods, either way — what an arrow key moves by; a hundredth of the track when omitted. */
    step?: ((f: number, periods: number) => number) | undefined;
    /** A handle's value as words, its date on a time axis, for a reader; its place on the track when omitted. */
    valueText?: ((f: number) => string) | undefined;
    /** The names the three stops are read by. */
    words?: BrushWords | undefined;
}

/** The gesture-threaded state: the brush-math drag plus the preview channel's
 *  origin window and last-fired draft (all track fractions). */
type DragState = BrushDrag & {
    origin?: { from: number; to: number };
    preview?: { from: number; to: number };
};

type Styles = ReturnType<ReturnType<typeof useSlotRecipe>>;

/** One layer of the histogram's bars, each at its whole-pixel place: dimmed outside the window, or clipped to it. */
function Bars({ bars, styles, dim, clip }: { bars: readonly BrushBar[]; styles: Styles; dim?: boolean; clip?: string }) {
    return (
        <Box css={styles.bars} data-brush-bars={clip === undefined ? "" : "in"} data-dim={dim ? "" : undefined}
            style={clip === undefined ? undefined : { clipPath: clip }}>
            {bars.map((b) => (
                <Box key={b.index} css={styles.bar} data-brush-bar="" data-step={b.step} data-count={b.count}
                    style={{ left: `${b.x}px`, width: `${b.width}px`, height: `${b.height}px` }} />
            ))}
        </Box>
    );
}

/** A handle: an outlined tab on its edge — beside a narrow window's, over its zone — a slider, its two grips. */
function Handle({ styles, edge, at, side, pressed, name, text, onKeyDown }: {
    styles: Styles; edge: "lo" | "hi"; at: number; side: BrushZoneSide | undefined; pressed: boolean; name: string; text: string;
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}) {
    return (
        <Box css={styles.zone} data-brush-zone="" data-edge={edge} data-side={side} style={{ left: `${at * 100}%` }}>
            <Box css={styles.handle} data-brush-handle={edge} data-pressed={pressed ? "" : undefined}
                role="slider" tabIndex={0} aria-label={name} aria-orientation="horizontal"
                aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(at * 100)} aria-valuetext={text}
                onKeyDown={onKeyDown}>
                <Box as="span" css={styles.grip} />
                <Box as="span" css={styles.grip} />
            </Box>
        </Box>
    );
}

/**
 * Renders the brush strip and runs its pointer and key machines. See the
 * module doc for the visual contract; geometry decisions (draw vs slide vs
 * resize, click-through threshold, keys, bars) live in `brush-math.ts`.
 */
export function BrushStrip({ buckets, window: win, nowFrac, height, barHeight, onCommit, onClear, onEnd, snapWindow, onPreview, step, valueText, words }: BrushStripProps) {
    const styles = useSlotRecipe({ key: "brushStrip" })();
    const trackRef = useRef<HTMLDivElement | null>(null);
    const anchorRef = useRef<HTMLDivElement | null>(null);
    const [drag, setDrag] = useState<DragState | null>(null);
    const [hover, setHover] = useState<number | undefined>(undefined);
    const trackPx = useContainerWidth(trackRef);
    const coarse = useCoarsePointer();
    const handlePx = coarse ? BRUSH_HANDLE_COARSE_PX : BRUSH_HANDLE_PX;
    const said = words ?? DEFAULT_WORDS;
    const text = valueText ?? defaultValueText;

    // The pointer gesture rides `@use-gesture` (the GanttTask precedent) —
    // it owns capture, cancellation and listener cleanup, so a missed
    // pointerup can never wedge the strip in a phantom drag. Geometry
    // decisions stay in `brush-math`; the in-flight state threads through
    // the gesture's `memo` (no stale-closure reads) with the `drag` state
    // mirroring it for the draft rendering.
    const bind = useDrag(({ xy: [clientX], first, last, canceled, memo }) => {
        const el = trackRef.current;
        if (el === null) return memo as DragState | undefined;
        const rect = el.getBoundingClientRect();
        const x = clientX - rect.left;
        if (first) {
            const w = win !== undefined ? { lo: win.from * rect.width, hi: win.to * rect.width } : undefined;
            const d: DragState = { mode: brushHitTest(x, w, rect.width, handlePx), start: x, current: x, width: rect.width, win: w };
            // Seed the preview channel at the origin window, so the first
            // fire only happens once the snapped draft actually LEAVES it.
            if (win !== undefined) { d.origin = win; d.preview = win; }
            setDrag(d);
            setHover(undefined);
            return d;
        }
        const d = memo as DragState | undefined;
        if (d === undefined) return memo as DragState | undefined;
        // A drag that live-applied preview steps must land the window
        // somewhere deliberate: the origin on cancel / no-op release.
        const restoreOrigin = (): void => {
            if (onPreview !== undefined && d.origin !== undefined && d.preview !== undefined
                && (d.preview.from !== d.origin.from || d.preview.to !== d.origin.to)) {
                onPreview(d.origin.from, d.origin.to);
            }
        };
        if (canceled) {
            setDrag(null);
            restoreOrigin();
            onEnd?.();
            return d;
        }
        const next: DragState = { ...d, current: x };
        if (last) {
            setDrag(null);
            // `brushRelease` owns the click-vs-drag semantics (clear on
            // empty track, no-op on the window, commit past the threshold).
            const release = brushRelease(next);
            if (release.kind === "clear") onClear();
            else if (release.kind === "commit") {
                const raw = { from: release.lo / next.width, to: release.hi / next.width };
                const s = snapWindow !== undefined ? snapWindow(raw.from, raw.to) : raw;
                onCommit(s.from, s.to);
            } else restoreOrigin();
            onEnd?.();
            return next;
        }
        // Live preview: adjusting an existing window (move / resize) fires
        // the snapped draft whenever it changes — under resolution snapping
        // that is one step per period-boundary crossing. Fresh draws stay
        // draft-only until release.
        if (onPreview !== undefined && next.mode !== "draw" && next.win !== undefined) {
            const w = brushDragWindow(next);
            const raw = { from: Math.max(0, w.lo / next.width), to: Math.min(1, w.hi / next.width) };
            const p = snapWindow !== undefined ? snapWindow(raw.from, raw.to) : raw;
            if (next.preview === undefined || next.preview.from !== p.from || next.preview.to !== p.to) {
                next.preview = p;
                onPreview(p.from, p.to);
            }
        }
        setDrag(next);
        return next;
    }, { preventDefault: true, pointer: { capture: false } });

    const draft = drag !== null ? brushDragWindow(drag) : undefined;
    // The window being DISPLAYED: the in-flight draft while dragging (snapped
    // when the host snaps), else the applied one. Fractions clamped.
    const rawDraft = draft !== undefined && drag !== null
        ? { from: Math.max(0, draft.lo / drag.width), to: Math.min(1, draft.hi / drag.width) }
        : undefined;
    const shown = rawDraft !== undefined
        ? (snapWindow !== undefined ? snapWindow(rawDraft.from, rawDraft.to) : rawDraft)
        : win;
    // The handle a resize holds — the edge it drags, which a drag past the other edge swaps.
    const pressed = drag === null || drag.win === undefined ? undefined
        : drag.mode === "resize-lo" ? (drag.current > drag.win.hi ? "hi" : "lo")
            : drag.mode === "resize-hi" ? (drag.current < drag.win.lo ? "lo" : "hi")
                : undefined;
    // Narrower than its two zones side by side, each zone sits beside its edge, its tab over it (brush-math's hit test).
    const shownPx = shown !== undefined && trackPx > 0 ? { lo: shown.from * trackPx, hi: shown.to * trackPx } : undefined;
    const narrow = shownPx !== undefined && brushNarrow(shownPx, handlePx);
    const sides = narrow ? brushZoneSides(shownPx, trackPx, handlePx) : undefined;

    const read = buckets?.(trackPx);
    const list = read === undefined || read === "loading" ? [] : read;
    const bars = brushBars(list, trackPx, barHeight);
    const tip = hover !== undefined && drag === null ? list[hover] : undefined;

    // The three stops' keys: an arrow, Home, End or Escape from a handle or the window.
    const keyOn = (target: BrushKeyTarget) => (e: KeyboardEvent<HTMLElement>) => {
        if (win === undefined) return;
        const r = brushKey(e.key, e.shiftKey, target, win, step ?? defaultStep);
        if (r === undefined) return;
        e.preventDefault();
        e.stopPropagation();
        if (r.kind === "clear") { onClear(); return; }
        const s = snapWindow !== undefined ? snapWindow(r.from, r.to) : r;
        if (s.from !== win.from || s.to !== win.to) onCommit(s.from, s.to);
    };
    // The hover: a mouse over a bucket, never while a gesture is in hand.
    const hoverAt = (e: PointerEvent<HTMLElement>) => {
        const el = trackRef.current;
        if (el === null || drag !== null || e.pointerType === "touch") return;
        const rect = el.getBoundingClientRect();
        const at = brushBucketAt(e.clientX - rect.left, rect.width, list);
        if (at !== hover) setHover(at);
    };
    const handlers = bind();

    return (
        <Box
            ref={trackRef}
            css={styles.track}
            style={{ height: `${height}px` }}
            cursor={drag !== null ? brushCursor(drag.mode) : "crosshair"}
            data-brush-track=""
            data-state={read === "loading" ? "loading" : bars.length === 0 ? "empty" : "drawn"}
            data-dragging={drag !== null ? "" : undefined}
            data-narrow={narrow ? "" : undefined}
            {...handlers}
            onPointerMove={(e: PointerEvent<HTMLDivElement>) => { handlers.onPointerMove?.(e); hoverAt(e); }}
            onPointerLeave={(e: PointerEvent<HTMLDivElement>) => { handlers.onPointerLeave?.(e); setHover(undefined); }}
        >
            {shown !== undefined && <Box css={styles.band} data-brush-band="" style={{ left: `${shown.from * 100}%`, width: `${(shown.to - shown.from) * 100}%` }} />}
            <Box css={styles.baseline} data-brush-baseline="" />
            {bars.length > 0 && <Bars bars={bars} styles={styles} dim={shown !== undefined} />}
            {bars.length > 0 && shown !== undefined && (
                <Bars bars={bars} styles={styles} clip={`inset(0 ${(1 - shown.to) * 100}% 0 ${shown.from * 100}%)`} />
            )}
            {nowFrac !== undefined && nowFrac >= 0 && nowFrac <= 1 && (
                <Box css={styles.now} data-brush-now="" style={{ left: `${nowFrac * 100}%` }} />
            )}
            {shown !== undefined && (
                <>
                    <Handle styles={styles} edge="lo" at={shown.from} side={sides?.lo} pressed={pressed === "lo"} name={said.start} text={text(shown.from)}
                        onKeyDown={keyOn("lo")} />
                    <Box css={styles.window} data-brush-window="" style={{ left: `${shown.from * 100}%`, width: `${(shown.to - shown.from) * 100}%` }}
                        role="slider" tabIndex={0} aria-label={said.window} aria-orientation="horizontal"
                        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(shown.from * 100)}
                        aria-valuetext={`${text(shown.from)} – ${text(shown.to)}`}
                        onKeyDown={keyOn("window")} />
                    <Handle styles={styles} edge="hi" at={shown.to} side={sides?.hi} pressed={pressed === "hi"} name={said.end} text={text(shown.to)}
                        onKeyDown={keyOn("hi")} />
                </>
            )}
            {tip !== undefined && (
                <>
                    <Box ref={anchorRef} css={styles.anchor} data-brush-anchor="" style={{ left: `${tip.from * 100}%`, width: `${(tip.to - tip.from) * 100}%` }} />
                    <Tooltip.Root open positioning={{
                        placement: "top", gutter: 8, flip: false,
                        getAnchorElement: () => anchorRef.current,
                        // Kept inside the plot: the track bounds where it may slide.
                        boundary: () => trackRef.current ?? document.body,
                    }}>
                        <Portal>
                            <Tooltip.Positioner>
                                <Tooltip.Content data-brush-tip="">{tip.label}</Tooltip.Content>
                            </Tooltip.Positioner>
                        </Portal>
                    </Tooltip.Root>
                </>
            )}
        </Box>
    );
}
