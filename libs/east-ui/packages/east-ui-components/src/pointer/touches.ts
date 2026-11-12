/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The fingers a surface holds, and the pinch between two of them: what a canvas
 * that pans and zooms under touch keeps of its touch pointers, apart from the
 * page and from React, so every order its events can arrive in is tested
 * (`touches.test.ts`).
 *
 * A finger is held from the press the surface hears until its end — its lift,
 * the browser taking it back (`pointercancel`: a system gesture, an edge swipe,
 * a palm), or the surface losing its capture — and a surface tells
 * {@link Touches.end} of each alike. A phone does not always say a finger
 * ended, so nothing here trusts that it will: the first finger of a new touch
 * — the browser's primary pointer, down while no other finger is on the page —
 * lets go of every finger still held, and a surface forgets them all as its
 * window loses the page ({@link Touches.clear}). One finger remembered past its
 * end would make every later one a second finger: a pinch that never ends.
 *
 * One finger is a press, the surface's own to pan, tap or drag with. Two pinch:
 * each move of either says how much further apart they stand, and where the
 * point midway between them stood and stands ({@link PinchStep}) — what a
 * canvas zooms by, and carries its drawing by, so the drawing stays under the
 * fingers. A third and later do nothing while two are held, and as one of the
 * two ends the pinch goes on between the two held longest. A step is only ever
 * what those two did in that one move — the record keeps each finger's point
 * and nothing worked out from them — so no step carries a distance from before
 * a finger came or went, and nothing jumps.
 *
 * @packageDocumentation
 */

/** A point on the page, in client px. */
export interface TouchPoint {
    readonly x: number;
    readonly y: number;
}

/**
 * What two fingers did in one move of either: how much further apart they
 * stand, and where the point midway between them stood and stands. A canvas
 * zooms by the one about where the point stood, and carries what it draws
 * there to where the point stands: each finger then stays on the point of the
 * drawing it touched.
 */
export interface PinchStep {
    /** The fingers' distance now over their distance before: above 1 drawn apart, below 1 drawn together, 1 where either is nothing. */
    readonly factor: number;
    /** The point midway between them before the move, in client px. */
    readonly from: TouchPoint;
    /** The point midway between them now, in client px. */
    readonly to: TouchPoint;
}

/**
 * What a finger put down begins: `press`, the one finger held, the surface's
 * own gesture; `pinch`, the second, a pinch between the two; `extra`, a third
 * or later, nothing.
 */
export type TouchBegan = "press" | "pinch" | "extra";

/** The fingers a surface holds (see the module docs). */
export interface Touches {
    /**
     * A finger put down on the surface.
     *
     * @param id - Its pointer's id
     * @param at - Where it is
     * @param primary - Whether the browser calls it primary: down while no other finger was on the page
     * @returns What it begins
     */
    down(id: number, at: TouchPoint, primary: boolean): TouchBegan;
    /**
     * A finger moved.
     *
     * @param id - Its pointer's id
     * @param at - Where it is now
     * @returns The pinch's step while two or more are held — one of no change ({@link pinchMoves}) where the finger is a
     *   third — or `undefined` for a finger the surface does not hold, or the only one held: a single finger's move, the
     *   surface's own
     */
    move(id: number, at: TouchPoint): PinchStep | undefined;
    /**
     * A finger gone: lifted, taken back by the browser, or its capture lost. One the surface does not hold changes
     * nothing.
     *
     * @param id - Its pointer's id
     */
    end(id: number): void;
    /** Lets go of every finger: the window lost the page, and no end may be heard. */
    clear(): void;
    /** Whether the surface holds a finger. */
    holds(id: number): boolean;
    /** How many fingers the surface holds: two or more, and a pinch is under way. */
    readonly size: number;
}

/** Two fingers as a pinch measures them: how far apart, and the point midway. */
interface Span {
    readonly dist: number;
    readonly x: number;
    readonly y: number;
}

/**
 * Makes the record of the fingers a surface holds.
 *
 * @returns The record, holding none
 */
export function makeTouches(): Touches {
    // In the order they were put down: the two held longest pinch. Each finger's point, and nothing worked out from them.
    const held = new Map<number, TouchPoint>();
    const measure = (): Span | undefined => {
        const [a, b] = [...held.values()];
        return a === undefined || b === undefined ? undefined : { dist: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };
    return {
        down(id, at, primary) {
            // No other finger is on the page: none still held is live. One the surface never heard end is let go here.
            if (primary) held.clear();
            // A pointer's id pressed again was never heard to end: it is a new finger, the last to arrive.
            held.delete(id);
            held.set(id, { x: at.x, y: at.y });
            return held.size === 1 ? "press" : held.size === 2 ? "pinch" : "extra";
        },
        move(id, at) {
            if (!held.has(id)) return undefined;
            // The two held longest as they stood, and as they stand: the step is this move's alone.
            const was = measure();
            held.set(id, { x: at.x, y: at.y });
            const now = measure();
            if (was === undefined || now === undefined) return undefined;
            return { factor: was.dist > 0 && now.dist > 0 ? now.dist / was.dist : 1, from: { x: was.x, y: was.y }, to: { x: now.x, y: now.y } };
        },
        end(id) {
            held.delete(id);
        },
        clear() {
            held.clear();
        },
        holds: (id) => held.has(id),
        get size() { return held.size; },
    };
}

/**
 * Whether a pinch's step moves anything: the fingers stand further apart or closer, or the point midway between them
 * moved. A third finger's move, and a move to where the finger stood, is a step of no change.
 *
 * @param step - The step
 * @returns Whether a canvas has anything to do for it
 */
export function pinchMoves(step: PinchStep): boolean {
    return step.factor !== 1 || step.from.x !== step.to.x || step.from.y !== step.to.y;
}
