/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A surface that takes its own pointers — a canvas that pans and pinches, a
 * lane a new event is drawn on, a minimap — hears them through here: the
 * handlers its element carries, feeding the one rule every such surface holds
 * its gestures to (`gestures.ts`). A surface says only what its gestures do
 * ({@link GestureHost}): what a press begins, what a drag draws, what a release
 * lands and what letting go puts back.
 *
 * Every pointer the surface takes it captures, each finger of a pinch too: its
 * release, or the browser taking it back, is heard here wherever it ends and
 * whatever becomes of the element it landed on — a card a pinch zooms out of
 * goes from under its finger. A surface whose own children are pressed in their
 * own right — a list of cards — captures none ({@link SurfaceOptions.capture}):
 * a captured pointer's click is the capturing element's, never the child's it
 * pressed. The window losing the page is heard while the surface holds a
 * pointer, and at rest nothing listens.
 *
 * @packageDocumentation
 */

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { makeGestures, pointerState, type GestureHost, type PointerState } from "./gestures.js";

/**
 * Captures a pointer for a gesture where it can be: a pointer no longer active — one the browser cancelled before the
 * handler ran, or one an automation made up — takes no capture, and its gesture runs uncaptured rather than throw out of
 * the handler (`setPointerCapture`'s `NotFoundError`, or `InvalidStateError`).
 *
 * @param element - The element that captures
 * @param pointerId - The pointer
 */
export function capturePointer(element: Element, pointerId: number): void {
    try {
        element.setPointerCapture(pointerId);
    } catch (err) {
        if (!(err instanceof DOMException)) throw err;
    }
}

/** What a surface's element carries: its pointers' handlers. */
export interface SurfaceGestures {
    readonly onPointerDown: (event: ReactPointerEvent) => void;
    readonly onPointerMove: (event: ReactPointerEvent) => void;
    readonly onPointerUp: (event: ReactPointerEvent) => void;
    readonly onPointerCancel: (event: ReactPointerEvent) => void;
    readonly onLostPointerCapture: (event: ReactPointerEvent) => void;
}

/** How a surface takes its pointers. */
export interface SurfaceOptions {
    /**
     * Whether the surface takes a press. `false` leaves the pointer to what it landed on: a button of the surface's own, a
     * part with a drag of its own. It is asked only of the primary button's press; any other is never the surface's.
     */
    readonly accepts?: ((event: ReactPointerEvent) => boolean) | undefined;
    /**
     * Whether the events of a pointer the surface holds go no further than it: a surface inside another — a minimap on
     * its canvas — keeps its own.
     */
    readonly contained?: boolean | undefined;
    /**
     * Whether the surface captures the pointers it takes; it does unless told `false`. A surface whose children take
     * presses of their own — a list of cards, each tapped — captures none: a captured pointer's click goes to the
     * element that captured it, so every tap on a card would be the list's. Its pointers' events then reach it through
     * what they landed on, as a browser holds a finger to the element it touched; an end that never arrives is let go of
     * as every unheard end is — the page's next first finger landing, the window losing the page.
     */
    readonly capture?: boolean | undefined;
}

/**
 * A surface's gestures, as its element hears them (see the module docs).
 *
 * @param host - What the surface's gestures do: read as each event arrives, so it may be made anew each render
 * @param options - Which presses it takes, and whether its pointers' events go no further
 * @returns The handlers its element carries
 */
export function useSurfaceGestures(host: GestureHost<ReactPointerEvent>, options: SurfaceOptions = {}): SurfaceGestures {
    // The host and the options as the last commit had them: a handler reads them as its event arrives.
    const latest = useRef({ host, options });
    useLayoutEffect(() => { latest.current = { host, options }; });
    const [surface] = useState(() => {
        const gestures = makeGestures<ReactPointerEvent>({
            press: (event) => latest.current.host.press(event),
            drag: (event) => latest.current.host.drag(event),
            release: (event) => latest.current.host.release(event),
            drop: () => latest.current.host.drop(),
            hover: (event) => latest.current.host.hover?.(event),
            pinchStart: () => latest.current.host.pinchStart?.(),
            pinch: (step, event) => latest.current.host.pinch?.(step, event),
            pinchEnd: () => latest.current.host.pinchEnd?.(),
        });
        // The window losing the page — another app taken up, the tab hidden — ends what no event may ever say ended. Heard
        // only while the surface holds a pointer: at rest nothing listens.
        let unwatch: (() => void) | undefined;
        const watch = (doc: Document): void => {
            if (gestures.idle) {
                unwatch?.();
                unwatch = undefined;
                return;
            }
            if (unwatch !== undefined) return;
            const win = doc.defaultView ?? window;
            const lose = (): void => {
                gestures.lose();
                watch(doc);
            };
            const hidden = (): void => { if (doc.visibilityState === "hidden") lose(); };
            win.addEventListener("blur", lose);
            doc.addEventListener("visibilitychange", hidden);
            unwatch = () => {
                win.removeEventListener("blur", lose);
                doc.removeEventListener("visibilitychange", hidden);
            };
        };
        /** Feeds the gestures a pointer's event; one of a pointer the surface holds goes no further where it is contained. */
        const hear = (event: ReactPointerEvent, feed: (pointer: PointerState) => void): void => {
            const pointer = pointerState(event);
            if (latest.current.options.contained === true && gestures.holds(pointer.id)) event.stopPropagation();
            feed(pointer);
            watch(event.currentTarget.ownerDocument);
        };
        const handlers: SurfaceGestures = {
            onPointerDown: (event) => {
                const taken = latest.current.options;
                if (event.button !== 0 || taken.accepts?.(event) === false) return;
                if (taken.capture !== false) capturePointer(event.currentTarget, event.pointerId);
                if (taken.contained === true) event.stopPropagation();
                gestures.down(pointerState(event), event);
                watch(event.currentTarget.ownerDocument);
            },
            onPointerMove: (event) => hear(event, (pointer) => gestures.move(pointer, event)),
            onPointerUp: (event) => hear(event, (pointer) => gestures.up(pointer, event)),
            onPointerCancel: (event) => hear(event, (pointer) => gestures.cancel(pointer)),
            onLostPointerCapture: (event) => hear(event, (pointer) => gestures.cancel(pointer)),
        };
        return { handlers, dispose: () => { unwatch?.(); unwatch = undefined; } };
    });
    useEffect(() => surface.dispose, [surface]);
    return surface.handlers;
}
