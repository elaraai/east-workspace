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

/** Half-width of the edge-resize hot zone (px either side of a bound). */
export const BRUSH_HANDLE_PX = 5;

/** Pointer travel below this is a click, not a drag (px). */
export const BRUSH_CLICK_PX = 5;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Resolves which gesture a pointer-down at `x` starts against the applied
 * window. Edge hot zones win over the window interior; no window (or a
 * pointer outside it) means a fresh draw.
 *
 * @param x - Pointer-down position (track px)
 * @param win - The applied window in track px, if any
 * @param handlePx - Half-width of each edge hot zone
 * @returns The drag mode the gesture runs in
 */
export function brushHitTest(x: number, win: BrushWindowPx | undefined, handlePx: number = BRUSH_HANDLE_PX): BrushMode {
    if (win === undefined) return "draw";
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
