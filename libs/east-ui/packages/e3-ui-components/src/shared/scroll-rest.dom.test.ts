/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * When a scroll has come to rest (`scroll-rest.ts`): by the browser's
 * `scrollend` where it has the event, and where it has none — an older iPhone
 * — once the scroll has stood still a moment with no finger on the page.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { SCROLL_REST_MS, onScrollRest } from "./scroll-rest.js";

/** The page's `onscrollend`, as the test's browser has it: what says the browser tells when a scroll ends. */
const SAYS = Object.getOwnPropertyDescriptor(window, "onscrollend");
/** A browser that says when a scroll ends, or one that never does — an older iPhone's. */
function browser(says: boolean): void {
    delete (window as unknown as { onscrollend?: unknown }).onscrollend;
    if (says) Object.defineProperty(window, "onscrollend", { configurable: true, writable: true, value: null });
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as { onscrollend?: unknown }).onscrollend;
    if (SAYS !== undefined) Object.defineProperty(window, "onscrollend", SAYS);
    document.body.replaceChildren();
});

/** An element that scrolls, on the page, and each rest heard of it. */
function scroller(): { el: HTMLElement; rests: () => number; stop: () => void } {
    const el = document.createElement("div");
    document.body.append(el);
    let heard = 0;
    const stop = onScrollRest(el, () => { heard += 1; });
    return { el, rests: () => heard, stop };
}

const scroll = (el: HTMLElement): void => { el.dispatchEvent(new Event("scroll")); };
/** A touch event on the element, the fingers then on the page as the browser counts them. */
function touch(el: HTMLElement, type: "touchstart" | "touchend" | "touchcancel", fingers: number): void {
    const event = new Event(type, { bubbles: true });
    Object.defineProperty(event, "touches", { value: { length: fingers } });
    el.dispatchEvent(event);
}

describe("where the browser says a scroll has ended", () => {
    test("its `scrollend` alone is a rest: no pause after a scroll is one", () => {
        browser(true);
        const { el, rests, stop } = scroller();
        scroll(el);
        vi.advanceTimersByTime(10 * SCROLL_REST_MS);
        expect(rests()).toBe(0);
        el.dispatchEvent(new Event("scrollend"));
        expect(rests()).toBe(1);
        stop();
        el.dispatchEvent(new Event("scrollend"));
        expect(rests()).toBe(1);
    });
});

describe("where the browser never says so", () => {
    beforeEach(() => { browser(false); });

    test("a scroll is at rest once it has stood still a moment: each scroll starts the wait again, and it rests once", () => {
        const { el, rests } = scroller();
        scroll(el);
        vi.advanceTimersByTime(SCROLL_REST_MS - 1);
        scroll(el);
        vi.advanceTimersByTime(SCROLL_REST_MS - 1);
        expect(rests()).toBe(0);
        vi.advanceTimersByTime(1);
        expect(rests()).toBe(1);
        vi.advanceTimersByTime(10 * SCROLL_REST_MS);
        expect(rests()).toBe(1);
    });

    test("a finger resting mid-swipe holds the scroll: nothing settles under it, and its lift is a rest — after the scroll its momentum carries on", () => {
        const { el, rests } = scroller();
        touch(el, "touchstart", 1);
        scroll(el);
        vi.advanceTimersByTime(10 * SCROLL_REST_MS);
        expect(rests()).toBe(0);
        // Lifted: the scroll carries on a while, then stands.
        touch(el, "touchend", 0);
        vi.advanceTimersByTime(SCROLL_REST_MS - 1);
        scroll(el);
        vi.advanceTimersByTime(SCROLL_REST_MS - 1);
        expect(rests()).toBe(0);
        vi.advanceTimersByTime(1);
        expect(rests()).toBe(1);
    });

    test("one of two fingers lifted is no rest; the last one's lift is, with no scroll after it", () => {
        const { el, rests } = scroller();
        touch(el, "touchstart", 1);
        touch(el, "touchstart", 2);
        scroll(el);
        touch(el, "touchend", 1);
        vi.advanceTimersByTime(10 * SCROLL_REST_MS);
        expect(rests()).toBe(0);
        touch(el, "touchcancel", 0);
        vi.advanceTimersByTime(SCROLL_REST_MS);
        expect(rests()).toBe(1);
    });

    test("a lift the page is never told of holds nothing for good: the next touch says how many fingers there are, and the window losing the page lets go of them", () => {
        const told = scroller();
        touch(told.el, "touchstart", 1);
        scroll(told.el);
        // Its lift is never heard. A new touch, lifted: the browser's own count is none.
        touch(told.el, "touchstart", 1);
        touch(told.el, "touchend", 0);
        vi.advanceTimersByTime(SCROLL_REST_MS);
        expect(told.rests()).toBe(1);
        const left = scroller();
        touch(left.el, "touchstart", 1);
        window.dispatchEvent(new Event("blur"));
        scroll(left.el);
        vi.advanceTimersByTime(SCROLL_REST_MS);
        expect(left.rests()).toBe(1);
    });

    test("stopped, it hears nothing more, and a wait under way is let go", () => {
        const { el, rests, stop } = scroller();
        scroll(el);
        stop();
        vi.advanceTimersByTime(10 * SCROLL_REST_MS);
        scroll(el);
        touch(el, "touchend", 0);
        vi.advanceTimersByTime(10 * SCROLL_REST_MS);
        expect(rests()).toBe(0);
    });
});
