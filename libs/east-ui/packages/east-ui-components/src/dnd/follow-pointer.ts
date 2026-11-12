/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Follows the pointer that pressed until it lets go: the lifetime of a drag a
 * part draws itself, off the shared drag layer — a resize handle, a line drawn
 * out of a port, a card carried across a canvas.
 *
 * The drag is its pointer's, as the drag layer's sensor's is (`sensor.ts`):
 * moves, releases and cancels from any other pointer are never its, so a second
 * finger's lift neither ends it nor commits it. It ends once, one of three
 * ways: its pointer is released (`up`); the browser takes the pointer back — a
 * system gesture, a scroll of its own (`pointercancel`) — or the window loses
 * the page, when no release may ever be heard (`cancel`); or its part goes (the
 * stop {@link followPointer} returns). Once ended it hears nothing more: no
 * listener of its outlives it, so no later pointer moves what it was dragging.
 *
 * @packageDocumentation
 */

/** What a followed pointer does. */
export interface PointerFollow {
    /** The pointer moved. */
    readonly move?: (event: PointerEvent) => void;
    /** The pointer was released: the drag's end, where it lands. */
    readonly up?: (event: PointerEvent) => void;
    /** The pointer was taken back, or the window lost the page: the drag is let go of, and lands nowhere. */
    readonly cancel?: () => void;
}

/** The press a drag begins with: a `pointerdown`, React's or the page's. */
export interface PointerPress {
    readonly pointerId: number;
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
    const id = pressed.pointerId;
    const doc = (pressed.target instanceof Node ? pressed.target.ownerDocument : null) ?? document;
    const win = doc.defaultView ?? window;
    const removers: (() => void)[] = [];
    const listen = <E extends Event>(target: EventTarget, type: string, handler: (event: E) => void): void => {
        const heard = handler as EventListener;
        target.addEventListener(type, heard);
        removers.push(() => target.removeEventListener(type, heard));
    };
    const stop = (): void => { for (const remove of removers.splice(0)) remove(); };
    const lose = (): void => {
        stop();
        follow.cancel?.();
    };
    listen<PointerEvent>(win, "pointermove", (event) => { if (event.pointerId === id) follow.move?.(event); });
    listen<PointerEvent>(win, "pointerup", (event) => {
        // Another finger's release neither ends nor commits this drag.
        if (event.pointerId !== id) return;
        stop();
        follow.up?.(event);
    });
    listen<PointerEvent>(win, "pointercancel", (event) => { if (event.pointerId === id) lose(); });
    // No release may ever be heard once the window has lost the page: another app taken up, the tab hidden.
    listen(win, "blur", lose);
    listen(doc, "visibilitychange", () => { if (doc.visibilityState === "hidden") lose(); });
    return stop;
}
