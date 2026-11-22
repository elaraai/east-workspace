/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The page an unbounded Plan canvas scrolls in, for a jsdom that lays nothing
 * out (#812): what the paged canvas's DOM tests scroll it with.
 *
 * @packageDocumentation
 */

import { act } from "@testing-library/react";
import { INTENT_DWELL_MS } from "@elaraai/east-ui-components/internal";

/**
 * Waits until the scroll just made rests, as the row frame says it (#1711). A paged canvas reports the rows in view,
 * and its event kinds' reader asks for their events, only once the view has held still for the frame's dwell
 * (east-ui-components' `INTENT_DWELL_MS`): a test that reads what a stop asked waits here, then settles. A mounted row
 * says nothing of it, since a scroll under way mounts its rows at once.
 *
 * The wait is an order of two timers, never a race against one: this one is set after the dwell's and is due after
 * it, so it fires after it on any machine.
 */
export async function scrollStopped(): Promise<void> {
    await act(async () => { await new Promise<void>((resolve) => { setTimeout(resolve, INTENT_DWELL_MS + 1); }); });
}

/**
 * What the unbounded canvas reads from the page it scrolls in (#812), for a
 * jsdom that lays nothing out: the canvas sits at the top of a tall document,
 * `window.scrollTo` moves `scrollY` and fires `scroll`, and the rows' top
 * moves with it.
 *
 * @returns The restore
 */
export function emulateWindowScroll(): () => void {
    let y = 0;
    const html = document.documentElement;
    const saved = {
        scrollY: Object.getOwnPropertyDescriptor(window, "scrollY"),
        scrollTo: Object.getOwnPropertyDescriptor(window, "scrollTo"),
        rect: Element.prototype.getBoundingClientRect,
    };
    Object.defineProperty(window, "scrollY", { configurable: true, get: () => y });
    Object.defineProperty(window, "scrollTo", {
        configurable: true,
        writable: true,
        value: (arg: ScrollToOptions | number) => {
            y = Math.max(0, typeof arg === "number" ? arg : (arg.top ?? y));
            window.dispatchEvent(new Event("scroll"));
        },
    });
    // A document tall enough to scroll through the canvas (jsdom reports 0).
    Object.defineProperty(html, "scrollHeight", { configurable: true, get: () => 100_000_000 });
    Element.prototype.getBoundingClientRect = function (this: Element) {
        if (this.hasAttribute("data-virtual-extent")) {
            return { x: 0, y: -y, top: -y, left: 0, right: 1024, bottom: -y, width: 1024, height: 0, toJSON: () => ({}) } as DOMRect;
        }
        return saved.rect.call(this);
    };
    return () => {
        if (saved.scrollY !== undefined) Object.defineProperty(window, "scrollY", saved.scrollY);
        if (saved.scrollTo !== undefined) Object.defineProperty(window, "scrollTo", saved.scrollTo);
        delete (html as { scrollHeight?: number }).scrollHeight;
        Element.prototype.getBoundingClientRect = saved.rect;
    };
}
