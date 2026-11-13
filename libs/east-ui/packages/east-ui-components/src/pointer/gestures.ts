/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * One gesture in flight on a surface, and whose it is: the rule every part that
 * takes pointers of its own holds its gestures to. It is apart from the page
 * and from React, so every order its events can arrive in is tested
 * (`gestures.test.ts`); a surface feeds it its element's pointer events
 * (`surface.ts`), and a drag begun on one of many elements feeds it the
 * window's (`follow-pointer.ts`).
 *
 * A press begins a gesture, and the pointer that pressed owns it: its moves
 * drive it and its release ends it, no other pointer's. It ends once, one of
 * two ways. Released by its own pointer, it lands where it stands
 * ({@link GestureHost.release}). Or it is let go of, landing nothing
 * ({@link GestureHost.drop}): a second finger put down, a new press while it is
 * in flight, its pointer taken back by the browser or its capture lost, a mouse
 * moved with its button no longer held — let go where the surface could not
 * hear it — or the window losing the page. So no gesture is left in flight by
 * an end that was never heard, and none lands on another pointer's release.
 *
 * Fingers are held in a record of their own (`touches.ts`). One finger presses.
 * Two pinch: what the first began is dropped as the second lands, and the pinch
 * is bracketed — {@link GestureHost.pinchStart}, a {@link GestureHost.pinch} a
 * move of either finger, {@link GestureHost.pinchEnd} once fewer than two are
 * held. A third finger does nothing, and the finger left on the surface as a
 * pinch ends begins nothing, so its lift lands nothing. A press by anything but
 * a finger — a mouse, a pen — lets go of every finger held and presses: a
 * finger whose end was never heard can then keep no press from the surface.
 *
 * @packageDocumentation
 */

import { makeTouches, pinchMoves, type PinchStep, type TouchPoint } from "./touches.js";

/** What a pointer's event says of it: a `PointerEvent`'s own fields, the page's or React's. */
export interface PointerRead {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;
    readonly clientX: number;
    readonly clientY: number;
    readonly buttons: number;
}

/** A pointer as an event says it stands. */
export interface PointerState {
    /** Which pointer: the event's `pointerId`. */
    readonly id: number;
    /** Its kind, the event's `pointerType`: `touch` is a finger; any other — a mouse, a pen — presses alone. */
    readonly kind: string;
    /** Where it is, in client px. */
    readonly at: TouchPoint;
    /** Whether the browser calls it primary: for a finger, down while no other finger was on the page. */
    readonly primary: boolean;
    /** The buttons held, as the event says them: a mouse's move with its primary button not among them has let go. */
    readonly buttons: number;
}

/**
 * A pointer as its event says it stands.
 *
 * @param event - A pointer's event
 * @returns The pointer, as the gestures are told of it
 */
export function pointerState(event: PointerRead): PointerState {
    return { id: event.pointerId, kind: event.pointerType, at: { x: event.clientX, y: event.clientY }, primary: event.isPrimary, buttons: event.buttons };
}

/**
 * What a surface does with its gestures. Each of `E` is the event that brought the call, handed on as it came; a
 * press's is a `P`, where a press is told of apart from the events that follow it.
 *
 * `press` is called only while no gesture is in flight; after it, `drag` any number of times, then exactly one of
 * `release` and `drop`, once. `pinchStart` is called only while no gesture is in flight and no pinch is under way;
 * after it, `pinch` any number of times, then `pinchEnd`, once.
 */
export interface GestureHost<E, P = E> {
    /** A pointer pressed: the gesture it begins is its own from here. */
    readonly press: (event: P) => void;
    /** The pointer that pressed moved. */
    readonly drag: (event: E) => void;
    /** The pointer that pressed was released: the gesture ends, and lands where it stands. */
    readonly release: (event: E) => void;
    /** The gesture is let go of: it ends, and lands nothing. */
    readonly drop: () => void;
    /** A pointer moved over the surface while no gesture is in flight and no pinch under way. */
    readonly hover?: ((event: E) => void) | undefined;
    /** A second finger landed: a pinch begins. */
    readonly pinchStart?: (() => void) | undefined;
    /** One of a pinch's two fingers moved: what the two did in that move. */
    readonly pinch?: ((step: PinchStep, event: E) => void) | undefined;
    /** Fewer than two fingers are held: the pinch is over. */
    readonly pinchEnd?: (() => void) | undefined;
}

/** A surface's gestures, fed its pointers' events (see the module docs). */
export interface Gestures<E, P = E> {
    /** A pointer was put down on the surface. */
    down(pointer: PointerState, event: P): void;
    /** A pointer moved. */
    move(pointer: PointerState, event: E): void;
    /** A pointer was released. */
    up(pointer: PointerState, event: E): void;
    /** A pointer was taken back by the browser, or the surface lost its capture. */
    cancel(pointer: PointerState): void;
    /** The window lost the page: no end of any pointer may ever be heard. */
    lose(): void;
    /** Whether the surface holds a pointer: the one whose gesture is in flight, or a finger. */
    holds(id: number): boolean;
    /** The pointer whose gesture is in flight; `undefined` while none is. */
    readonly owner: number | undefined;
    /** Whether a pinch is under way. */
    readonly pinching: boolean;
    /** Whether the surface holds nothing: no gesture in flight, and no finger. */
    readonly idle: boolean;
}

/**
 * Makes a surface's gestures.
 *
 * @param host - What the surface does with them
 * @returns The gestures, at rest
 */
export function makeGestures<E, P = E>(host: GestureHost<E, P>): Gestures<E, P> {
    const touches = makeTouches();
    // The pointer whose press began the gesture in flight; `null` while none is.
    let owner: number | null = null;
    let pinching = false;
    const drop = (): void => {
        if (owner === null) return;
        owner = null;
        host.drop();
    };
    // A pinch is over once fewer than two fingers are held: one lifted, taken back or lost, or all let go of.
    const settle = (): void => {
        if (!pinching || touches.size >= 2) return;
        pinching = false;
        host.pinchEnd?.();
    };
    return {
        down(pointer, event) {
            if (pointer.kind === "touch") {
                const began = touches.down(pointer.id, pointer.at, pointer.primary);
                // The page's first finger let go of fingers never heard to end: a pinch of theirs is over.
                settle();
                if (began === "pinch") {
                    drop();
                    // A finger pressed again while two are held is the second of the two still: the pinch goes on.
                    if (!pinching) {
                        pinching = true;
                        host.pinchStart?.();
                    }
                    return;
                }
                if (began === "extra") return;
            } else {
                // A mouse or a pen presses alone: every finger held is let go of, and a pinch of theirs is over. One whose
                // end was never heard keeps no press from the surface.
                touches.clear();
                settle();
            }
            // One gesture at a time: a press while one is in flight — its pointer's end never heard — lets go of it first.
            drop();
            owner = pointer.id;
            host.press(event);
        },
        move(pointer, event) {
            if (pointer.kind === "touch") {
                const step = touches.move(pointer.id, pointer.at);
                if (step !== undefined) {
                    if (pinching && pinchMoves(step)) host.pinch?.(step, event);
                    return;
                }
            }
            if (owner === null) {
                if (!pinching) host.hover?.(event);
                return;
            }
            // Another pointer's move is never this gesture's.
            if (pointer.id !== owner) return;
            // A mouse moved with its button not held let go where the surface could not hear it.
            if (pointer.kind === "mouse" && (pointer.buttons & 1) === 0) {
                drop();
                host.hover?.(event);
                return;
            }
            host.drag(event);
        },
        up(pointer, event) {
            if (pointer.kind === "touch") {
                touches.end(pointer.id);
                settle();
            }
            // Another pointer's release neither ends this gesture nor lands it.
            if (owner !== pointer.id) return;
            owner = null;
            host.release(event);
        },
        cancel(pointer) {
            if (pointer.kind === "touch") {
                touches.end(pointer.id);
                settle();
            }
            if (owner === pointer.id) drop();
        },
        lose() {
            touches.clear();
            settle();
            drop();
        },
        holds: (id) => owner === id || touches.holds(id),
        get owner() { return owner ?? undefined; },
        get pinching() { return pinching; },
        get idle() { return owner === null && touches.size === 0; },
    };
}
