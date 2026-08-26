/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The narrow layout's two-finger horizontal pan (§10): "horizontal pan is
 * two-finger so page scroll stays vertical". One finger scrolls the page;
 * two fingers moving together drag the WINDOW, one whole period per period
 * width crossed — the same `pan` the `[` / `]` keys emit, so the write goes
 * through the slice like every other window change.
 *
 * Pure geometry here, no React: the hook below feeds it pointer events.
 */

/** The gesture's running state — one per list element. */
export interface TwoFingerPan {
    /** Active pointer x positions by pointer id. */
    pointers: Map<number, number>;
    /** The two-finger centroid at the last move (undefined until two fingers are down). */
    centroid: number | undefined;
    /** Horizontal travel since the last period edge crossed, in px. */
    acc: number;
}

/** A fresh gesture state. */
export function newTwoFingerPan(): TwoFingerPan {
    return { pointers: new Map(), centroid: undefined, acc: 0 };
}

/**
 * Feed one pointer sample; returns the number of WHOLE periods the window
 * should pan (positive = later in time, i.e. the content was dragged LEFT),
 * or 0.
 *
 * @param g - the gesture state (mutated)
 * @param kind - the pointer event kind
 * @param id - the pointer id
 * @param x - the pointer's client x
 * @param periodPx - one period's width in px (≤ 0 disables)
 */
export function feedTwoFingerPan(
    g: TwoFingerPan,
    kind: "down" | "move" | "up",
    id: number,
    x: number,
    periodPx: number,
): number {
    if (kind === "up") {
        g.pointers.delete(id);
        if (g.pointers.size < 2) { g.centroid = undefined; g.acc = 0; }
        return 0;
    }
    g.pointers.set(id, x);
    if (g.pointers.size !== 2) { g.centroid = undefined; g.acc = 0; return 0; }
    let sum = 0;
    for (const px of g.pointers.values()) sum += px;
    const c = sum / 2;
    if (kind === "down" || g.centroid === undefined) { g.centroid = c; g.acc = 0; return 0; }
    g.acc += c - g.centroid;
    g.centroid = c;
    if (periodPx <= 0) return 0;
    // Dragging the content left (negative travel) reveals later time.
    let periods = 0;
    while (Math.abs(g.acc) >= periodPx) {
        const step = g.acc < 0 ? 1 : -1;
        periods += step;
        g.acc += step * periodPx;
    }
    return periods;
}
