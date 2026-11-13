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
 * Which fingers the list holds, and when two of them pan, are the shared
 * pointer core's (east-ui-components' `src/pointer/`): the list is a surface
 * of it, and its two fingers' pinch is the pan. A finger is held only while it
 * is down — one whose lift is never heard is let go of as the page's next first
 * finger lands, or the window loses the page — so none is counted into a pan
 * that never ends, nor against the two that pan. What is here is what the
 * list's gestures do ({@link twoFingerPan}), and the arithmetic under it
 * ({@link panPeriods}): pure, no React.
 */

import type { GestureHost } from "@elaraai/east-ui-components/internal";

/** A pan's running state — one a list. */
export interface TwoFingerPan {
    /** Horizontal travel of the point midway between the two fingers since the last period edge crossed, in px. */
    travel: number;
}

/** A pan at rest. */
export function newTwoFingerPan(): TwoFingerPan {
    return { travel: 0 };
}

/**
 * Adds a move to a pan's travel, and takes out of it the whole periods it has
 * crossed.
 *
 * @param travel - The travel since the last period edge crossed, in px
 * @param moved - How far the point midway between the two fingers moved, in px: negative, to the left
 * @param periodPx - One period's width in px (≤ 0 crosses none)
 * @returns The travel left, and the whole periods crossed: positive, later in time — the content was dragged LEFT
 */
export function panPeriods(travel: number, moved: number, periodPx: number): { travel: number; periods: number } {
    let left = travel + moved;
    if (periodPx <= 0) return { travel: left, periods: 0 };
    // Dragging the content left (negative travel) reveals later time.
    let periods = 0;
    while (Math.abs(left) >= periodPx) {
        const step = left < 0 ? 1 : -1;
        periods += step;
        left += step * periodPx;
    }
    return { travel: left, periods };
}

/**
 * What the list's gestures do: one finger nothing — the page's scroll is its —
 * and two a pan, the point midway between them carrying the window a whole
 * period per period width it crosses. A pan begins afresh as a second finger
 * lands, and what it had travelled short of a period is forgotten as it ends.
 *
 * @param pan - The pan's running state (mutated)
 * @param periodPx - One period's width in px, as the list stands
 * @param onPan - Told the whole periods to pan by: positive, later in time
 * @returns The gestures' host, for the list's surface
 */
export function twoFingerPan(pan: TwoFingerPan, periodPx: () => number, onPan: (periods: number) => void): GestureHost<unknown> {
    const nothing = (): void => undefined;
    return {
        press: nothing,
        drag: nothing,
        release: nothing,
        drop: nothing,
        pinchStart: () => { pan.travel = 0; },
        pinch: (step) => {
            const moved = panPeriods(pan.travel, step.to.x - step.from.x, periodPx());
            pan.travel = moved.travel;
            if (moved.periods !== 0) onPan(moved.periods);
        },
        pinchEnd: () => { pan.travel = 0; },
    };
}
