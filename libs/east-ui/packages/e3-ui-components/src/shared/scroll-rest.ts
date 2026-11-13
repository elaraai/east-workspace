/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * When an element's scroll has come to rest: what a window that snaps to what
 * it holds waits for — a phone's pager settling on the nearer lane once a swipe
 * is let go.
 *
 * A browser says so with `scrollend`, where it has the event: then that alone
 * is heard. An older iPhone has none, in any browser on it, and would never
 * settle. There the scroll is at rest once it has not moved for
 * {@link SCROLL_REST_MS} with no finger on the page: a finger resting
 * mid-swipe holds the scroll, so nothing settles under it; its lift is a rest
 * of its own; and a scroll carried on by its own momentum goes on moving, so it
 * is waited out. The fingers on the page are the browser's own count
 * (`TouchEvent.touches`), read at each touch event, never kept: a lift the
 * page is never told of is forgotten at the next touch, and as the window
 * loses the page.
 *
 * @packageDocumentation
 */

/** How long a scroll must stand still to have come to rest, where the browser never says it has (ms). */
export const SCROLL_REST_MS = 100;

/**
 * Tells when an element's scroll has come to rest (see the module docs).
 *
 * @param element - The element that scrolls
 * @param rest - Called each time its scroll comes to rest
 * @returns What stops listening
 */
export function onScrollRest(element: HTMLElement, rest: () => void): () => void {
    const win = element.ownerDocument.defaultView;
    if (win === null) return () => undefined;
    // Asked of the page as it is, never of its type: every browser's type has the event, and an older iPhone's page has none.
    if (Reflect.has(win, "onscrollend")) {
        element.addEventListener("scrollend", rest, { passive: true });
        return () => { element.removeEventListener("scrollend", rest); };
    }
    let timer: number | undefined;
    let fingers = 0;
    const wait = (): void => {
        if (timer !== undefined) win.clearTimeout(timer);
        timer = win.setTimeout(() => {
            timer = undefined;
            if (fingers === 0) rest();
        }, SCROLL_REST_MS);
    };
    const touched = (event: TouchEvent): void => {
        fingers = event.touches.length;
        // The last finger lifted: where it leaves the scroll is a rest, unless the scroll carries on.
        if (fingers === 0) wait();
    };
    const left = (): void => { fingers = 0; };
    const touches = ["touchstart", "touchend", "touchcancel"] as const;
    element.addEventListener("scroll", wait, { passive: true });
    for (const type of touches) element.addEventListener(type, touched, { passive: true });
    win.addEventListener("blur", left);
    return () => {
        if (timer !== undefined) win.clearTimeout(timer);
        timer = undefined;
        element.removeEventListener("scroll", wait);
        for (const type of touches) element.removeEventListener(type, touched);
        win.removeEventListener("blur", left);
    };
}
