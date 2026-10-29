/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Pure geometry for the slice brush gesture (#192) — shared by the
 * `Slice.Rail` brush strip and the Plan's horizon brush.
 *
 * A brush drag runs a small mode machine resolved at pointer-down
 * against the applied window (d3-brush conventions):
 *
 *   - `draw`       — pointer landed on empty track: drag out a new window.
 *   - `move`       — pointer landed inside the window: slide it, width
 *                    preserved, clamped to the domain.
 *   - `resize-lo`/`resize-hi` — pointer landed on an edge hot zone: drag
 *                    that bound; crossing the opposite edge swaps cleanly.
 *
 * Everything here is track-pixel arithmetic — no DOM, no East values —
 * so the interaction semantics are unit-testable in isolation. The
 * host components own px↔domain mapping and the actual `setRange`.
 *
 * @packageDocumentation
 */

/** Interaction mode for a brush drag, resolved at pointer-down. */
export type BrushMode = "draw" | "move" | "resize-lo" | "resize-hi";

/** A window in track pixels (`0 ≤ lo ≤ hi ≤ track width`). */
export interface BrushWindowPx {
    /** Left bound, px from the track's left edge. */
    lo: number;
    /** Right bound, px from the track's left edge. */
    hi: number;
}

/** In-flight state of a brush drag, captured at pointer-down. */
export interface BrushDrag {
    /** Gesture resolved by {@link brushHitTest} at pointer-down. */
    mode: BrushMode;
    /** Pointer-down x (track px). */
    start: number;
    /** Latest pointer x (track px). */
    current: number;
    /** Track width at pointer-down (px). */
    width: number;
    /** The applied window at pointer-down (px), if any. */
    win: BrushWindowPx | undefined;
}

/** Half-width of the edge-resize hot zone (px either side of a bound): a zone 12 wide, a press within 6 of an edge (#1438). */
export const BRUSH_HANDLE_PX = 6;

/** The same on a coarse pointer: a zone 24 wide, a press within 12 of an edge (#1438). */
export const BRUSH_HANDLE_COARSE_PX = 12;

/** Pointer travel below this is a click, not a drag (px). */
export const BRUSH_CLICK_PX = 5;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Resolves which gesture a pointer-down at `x` starts against the applied
 * window. Edge hot zones win over the window interior; no window (or a
 * pointer outside it) means a fresh draw. A window narrower than its two
 * zones side by side sets each zone outside its edge, so a press inside it
 * still moves it (#1438).
 *
 * @param x - Pointer-down position (track px)
 * @param win - The applied window in track px, if any
 * @param handlePx - Half-width of each edge hot zone
 * @returns The drag mode the gesture runs in
 */
export function brushHitTest(x: number, win: BrushWindowPx | undefined, handlePx: number = BRUSH_HANDLE_PX): BrushMode {
    if (win === undefined) return "draw";
    if (win.hi - win.lo < 4 * handlePx) {
        if (x >= win.lo - 2 * handlePx && x <= win.lo) return "resize-lo";
        if (x >= win.hi && x <= win.hi + 2 * handlePx) return "resize-hi";
        return x > win.lo && x < win.hi ? "move" : "draw";
    }
    if (Math.abs(x - win.lo) <= handlePx) return "resize-lo";
    if (Math.abs(x - win.hi) <= handlePx) return "resize-hi";
    if (x > win.lo && x < win.hi) return "move";
    return "draw";
}

/**
 * Computes the in-flight window for a drag, clamped to `[0, width]`.
 *
 * `move` preserves the window's width exactly (the shift is clamped, not
 * the bounds independently); `resize-*` moves one bound and swaps via
 * min/max when dragged past the other; `draw` spans start→current.
 *
 * @param drag - The in-flight drag state
 * @returns The window the drag currently describes (track px)
 */
export function brushDragWindow(drag: BrushDrag): BrushWindowPx {
    const { mode, start, current, width, win } = drag;
    const x = clamp(current, 0, width);
    if (mode === "move" && win !== undefined) {
        const delta = clamp(current - start, -win.lo, width - win.hi);
        return { lo: win.lo + delta, hi: win.hi + delta };
    }
    if (mode === "resize-lo" && win !== undefined) {
        return { lo: Math.min(x, win.hi), hi: Math.max(x, win.hi) };
    }
    if (mode === "resize-hi" && win !== undefined) {
        return { lo: Math.min(win.lo, x), hi: Math.max(win.lo, x) };
    }
    const s = clamp(start, 0, width);
    return { lo: Math.min(s, x), hi: Math.max(s, x) };
}

/** What a completed brush gesture should do. */
export type BrushRelease =
    | { kind: "commit"; lo: number; hi: number }
    | { kind: "clear" }
    | { kind: "noop" };

/**
 * Decides the outcome of releasing a brush drag.
 *
 * A sub-{@link BRUSH_CLICK_PX} pointer travel is a click: on empty track
 * it clears the range (the established gesture), on the window or a
 * handle it is a no-op — a click must never nuke the selection. A real
 * drag commits its window, except when a resize collapsed the window
 * below the click threshold, which clears (d3 behaviour for an emptied
 * selection).
 *
 * @param drag - The drag state at pointer-up
 * @param clickPx - Pointer-travel threshold separating click from drag
 * @returns The action the host should take
 */
export function brushRelease(drag: BrushDrag, clickPx: number = BRUSH_CLICK_PX): BrushRelease {
    const moved = Math.abs(drag.current - drag.start) >= clickPx;
    if (!moved) return drag.mode === "draw" ? { kind: "clear" } : { kind: "noop" };
    const w = brushDragWindow(drag);
    if (w.hi - w.lo < clickPx) return { kind: "clear" };
    return { kind: "commit", lo: w.lo, hi: w.hi };
}

/**
 * The cursor shown on the track while a drag in `mode` is active. At
 * rest the hover cursors come from the window / handle elements
 * themselves (recipe-styled `grab` / `ew-resize`).
 *
 * @param mode - The active drag mode
 * @returns A CSS cursor keyword
 */
export function brushCursor(mode: BrushMode): string {
    if (mode === "move") return "grabbing";
    if (mode === "draw") return "crosshair";
    return "ew-resize";
}

// ── Keys (#1438) ─────────────────────────────────────────────────────────────

/** What takes a key: the start handle, the end handle, or the window between them. */
export type BrushKeyTarget = "lo" | "hi" | "window";

/** What a key does: a window to commit, as track fractions, or the range cleared. */
export type BrushKeyResult = { kind: "commit"; from: number; to: number } | { kind: "clear" };

/**
 * What a key does from a focused handle or the window (#1438). An arrow moves
 * a handle, or both edges of the window, one period — ten under Shift; Home
 * and End take a handle to its end of the track, and the window to the
 * track's ends, its width kept; Escape clears the range. A handle stays a
 * period short of the other, and nothing leaves the track.
 *
 * @param key - The key, as a keyboard event names it
 * @param shift - Whether Shift is held
 * @param target - What has the focus
 * @param win - The applied window, as track fractions
 * @param step - Moves a fraction by whole periods, either way
 * @returns What the key does; `undefined` for a key the brush does not take
 */
export function brushKey(key: string, shift: boolean, target: BrushKeyTarget, win: { from: number; to: number }, step: (f: number, periods: number) => number): BrushKeyResult | undefined {
    if (key === "Escape") return { kind: "clear" };
    const unit = (f: number, n: number) => clamp(step(f, n), 0, 1);
    const width = win.to - win.from;
    const commit = (from: number, to: number): BrushKeyResult => ({ kind: "commit", from, to });
    if (key === "ArrowLeft" || key === "ArrowRight") {
        const n = (key === "ArrowLeft" ? -1 : 1) * (shift ? 10 : 1);
        if (target === "lo") return commit(Math.min(unit(win.from, n), unit(win.to, -1)), win.to);
        if (target === "hi") return commit(win.from, Math.max(unit(win.to, n), unit(win.from, 1)));
        const from = step(win.from, n);
        const to = step(win.to, n);
        if (from < 0) return commit(0, width);
        if (to > 1) return commit(1 - width, 1);
        return commit(from, to);
    }
    if (key === "Home") {
        if (target === "lo") return commit(0, win.to);
        if (target === "hi") return commit(win.from, unit(win.from, 1));
        return commit(0, width);
    }
    if (key === "End") {
        if (target === "lo") return commit(unit(win.to, -1), win.to);
        if (target === "hi") return commit(win.from, 1);
        return commit(1 - width, 1);
    }
    return undefined;
}

// ── The histogram's bars (#1438) ─────────────────────────────────────────────

/** A bucket of the histogram: where it starts and ends on the track, as fractions, and its count. */
export interface BrushBucketSpan {
    /** Its start, a fraction of the track. */
    from: number;
    /** Its end. */
    to: number;
    /** What it counts. */
    count: number;
}

/** A bar as the strip draws it: its bucket, its place and size in whole track pixels, and its step on the heat ramp. */
export interface BrushBar {
    /** Its bucket's place among the buckets. */
    index: number;
    /** Its left edge, px from the track's. */
    x: number;
    /** Its width, px. */
    width: number;
    /** Its height, px from the track's bottom. */
    height: number;
    /** Its step on the heat ramp, 1–5. */
    step: 1 | 2 | 3 | 4 | 5;
    /** Its bucket's count. */
    count: number;
}

/**
 * The bars of a histogram on a track (#1438): every bar one width, the
 * narrowest bucket's between its whole-pixel edges less the gap — 1px, 2px
 * from 8px a bucket — at its slot's start; a short slot's bar, or an end bucket the
 * horizon clips, keeps the gap to the next slot's start. Its height is
 * linear to the largest bucket, up to `barMax`, a non-zero bucket's at least
 * 2; a zero draws none. Its tone is a step on the heat ramp, `ceil(count ÷
 * max × 5)`, so tone repeats height.
 *
 * @param buckets - The buckets, in order along the track
 * @param trackPx - The track's width, px
 * @param barMax - The tallest a bar draws, px
 * @returns The bars, one for each bucket counting anything
 */
export function brushBars(buckets: readonly BrushBucketSpan[], trackPx: number, barMax: number): BrushBar[] {
    if (!(trackPx > 0) || buckets.length === 0) return [];
    const max = buckets.reduce((m, b) => Math.max(m, b.count), 0);
    if (!(max > 0)) return [];
    // The pitch: the narrowest bucket between its whole-pixel edges, so every bar is one width with its gap kept; an end
    // bucket the horizon clips sets none.
    const inner = buckets.length > 2 ? buckets.slice(1, -1) : buckets;
    const pitch = inner.reduce((least, b) => Math.min(least, Math.round(b.to * trackPx) - Math.round(b.from * trackPx)), Infinity);
    const gap = pitch >= 8 ? 2 : 1;
    const width = Math.max(0, pitch - gap);
    const bars: BrushBar[] = [];
    buckets.forEach((b, index) => {
        if (!(b.count > 0)) return;
        const x = Math.round(b.from * trackPx);
        const room = Math.round(b.to * trackPx) - x - gap;
        const w = Math.min(width, room);
        if (w <= 0) return;
        const height = Math.max(2, Math.round((b.count / max) * barMax));
        const step = Math.min(5, Math.max(1, Math.ceil((b.count / max) * 5))) as BrushBar["step"];
        bars.push({ index, x, width: w, height, step, count: b.count });
    });
    return bars;
}

/**
 * The bucket under the pointer (#1438): the one whose slot holds it, its
 * start in it and its end not.
 *
 * @param x - The pointer, px from the track's left edge
 * @param trackPx - The track's width, px
 * @param buckets - The buckets
 * @returns Its place among the buckets; `undefined` off the track
 */
export function brushBucketAt(x: number, trackPx: number, buckets: readonly BrushBucketSpan[]): number | undefined {
    if (!(trackPx > 0) || x < 0 || x >= trackPx) return undefined;
    const f = x / trackPx;
    const i = buckets.findIndex((b) => f >= b.from && f < b.to);
    return i < 0 ? undefined : i;
}
