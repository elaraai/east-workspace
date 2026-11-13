/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Follows the pointer that pressed until it lets go: the lifetime of a drag a
 * part draws itself, off the shared drag layer — a resize handle, a line drawn
 * out of a port, a card carried across a canvas. Where a surface takes every
 * press on one element (`surface.ts`), such a drag begins on one of many — a
 * handle, a port, a card — so its part hands the press here from its own
 * handler, and the pointer is followed at the window from there.
 *
 * The drag is held to the rule every gesture is (`gestures.ts`): it is its
 * pointer's — moves, releases and cancels from any other pointer are never its,
 * so a second finger's lift neither ends it nor commits it — and it ends once,
 * one of three ways. Its pointer is released (`up`). It is let go of, landing
 * nowhere (`cancel`): the browser takes the pointer back — a system gesture, a
 * scroll of its own (`pointercancel`) — a mouse moves with its button no longer
 * held — released where the window could not hear it — or the window loses the
 * page, when no release may ever be heard. Or its part goes (the stop
 * {@link followPointer} returns). Once ended it hears nothing more: no listener
 * of its outlives it, so no later pointer moves what it was dragging.
 *
 * @packageDocumentation
 */

import { makeGestures, pointerState, type PointerRead } from "./gestures.js";

/** What a followed pointer does. */
export interface PointerFollow {
    /** The pointer moved. */
    readonly move?: (event: PointerEvent) => void;
    /** The pointer was released: the drag's end, where it lands. */
    readonly up?: (event: PointerEvent) => void;
    /** The pointer was taken back, let go where the window could not hear it, or the window lost the page: the drag is let go of, and lands nowhere. */
    readonly cancel?: () => void;
}

/** The press a drag begins with: a `pointerdown`, React's or the page's. */
export interface PointerPress extends PointerRead {
    readonly target: EventTarget | null;
}

/**
 * Follows the pointer of a press until it lets go (see the module docs).
 *
 * @param pressed - The press: its pointer is the drag's, and its target's window the one listened on
 * @param follow - What the pointer's moves, its release and its loss do
 * @returns What stops following, silently — for a part that goes mid-drag; nothing once the drag has ended
 */
export function followPointer(pressed: PointerPress, follow: PointerFollow): () => void {
    const doc = (pressed.target instanceof Node ? pressed.target.ownerDocument : null) ?? document;
    const win = doc.defaultView ?? window;
    const removers: (() => void)[] = [];
    const listen = <E extends Event>(target: EventTarget, type: string, handler: (event: E) => void): void => {
        const heard = handler as EventListener;
        target.addEventListener(type, heard);
        removers.push(() => target.removeEventListener(type, heard));
    };
    const stop = (): void => { for (const remove of removers.splice(0)) remove(); };
    // The one gesture this drag is: pressed already, by the press handed here.
    const gestures = makeGestures<PointerEvent, PointerPress>({
        press: () => undefined,
        drag: (event) => follow.move?.(event),
        release: (event) => {
            stop();
            follow.up?.(event);
        },
        drop: () => {
            stop();
            follow.cancel?.();
        },
    });
    gestures.down(pointerState(pressed), pressed);
    listen<PointerEvent>(win, "pointermove", (event) => gestures.move(pointerState(event), event));
    listen<PointerEvent>(win, "pointerup", (event) => gestures.up(pointerState(event), event));
    listen<PointerEvent>(win, "pointercancel", (event) => gestures.cancel(pointerState(event)));
    // No release may ever be heard once the window has lost the page: another app taken up, the tab hidden.
    listen(win, "blur", () => gestures.lose());
    listen(doc, "visibilitychange", () => { if (doc.visibilityState === "hidden") gestures.lose(); });
    return stop;
}
