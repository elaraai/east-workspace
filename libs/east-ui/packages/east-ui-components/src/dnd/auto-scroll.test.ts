/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The drag layer's edge scroller in its row-stepped mode (A25): a container
 * of rows on a grid scrolls one row every eighth frame while the pointer rests
 * within 24px of its top — below its sticky head — or its bottom, landing on
 * the grid. And along an axis a container scrolls on alone (#1442): one that
 * scrolls sideways and clips its taller content (`overflow: auto hidden`) is
 * never scrolled down or up.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { EdgeScroller, ROW_EDGE, ROW_EVERY } from "./auto-scroll.js";

/** A 400px pane of 36px rows under a 48px sticky head, its rect stubbed (jsdom lays nothing out). */
function pane(): HTMLDivElement {
    const el = document.createElement("div");
    el.dataset.edgeScrollRow = "36";
    el.style.overflowY = "auto";
    el.style.scrollPaddingTop = "48px";
    Object.defineProperty(el, "scrollHeight", { value: 3600 });
    Object.defineProperty(el, "clientHeight", { value: 400 });
    el.getBoundingClientRect = () => ({ x: 0, y: 100, left: 0, top: 100, right: 300, bottom: 500, width: 300, height: 400, toJSON() {} });
    document.body.appendChild(el);
    return el;
}

afterEach(() => { document.body.innerHTML = ""; vi.unstubAllGlobals(); });

/** Runs the scroller's frames by hand, the pointer over the pane. */
function frames(el: HTMLElement) {
    const queue: (() => void)[] = [];
    vi.stubGlobal("requestAnimationFrame", (fn: () => void) => { queue.push(fn); return queue.length; });
    vi.stubGlobal("cancelAnimationFrame", () => { queue.length = 0; });
    document.elementFromPoint = () => el;
    const steps = vi.fn();
    const scroller = new EdgeScroller(steps);
    return { scroller, steps, run(n: number) { for (let i = 0; i < n; i++) queue.shift()?.(); } };
}

describe("the edge scroller's row step", () => {
    test("A25 — near the bottom it scrolls one row every eighth frame, on the rows' grid", () => {
        const el = pane();
        const { scroller, steps, run } = frames(el);
        scroller.update({ x: 150, y: 500 - ROW_EDGE + 2 });
        run(ROW_EVERY - 2);
        expect(el.scrollTop).toBe(0);
        run(1);
        expect(el.scrollTop).toBe(36);
        expect(steps).toHaveBeenCalledTimes(1);
        run(ROW_EVERY);
        expect(el.scrollTop).toBe(72);
        // Off grid, the next step lands on it.
        el.scrollTop = 80;
        run(ROW_EVERY);
        expect(el.scrollTop).toBe(108);
        scroller.stop();
    });

    test("A25 — near the top, below what the sticky head covers, it scrolls up; within the head, or outside the bands, it rests", () => {
        const el = pane();
        el.scrollTop = 360;
        const { scroller, run } = frames(el);
        // Inside the head's 48px: nothing.
        scroller.update({ x: 150, y: 100 + 20 });
        run(ROW_EVERY * 2);
        expect(el.scrollTop).toBe(360);
        // Just below it: a row up every eighth frame.
        scroller.update({ x: 150, y: 100 + 48 + ROW_EDGE - 4 });
        run(ROW_EVERY * 2);
        expect(el.scrollTop).toBe(288);
        // In the middle: nothing.
        scroller.update({ x: 150, y: 300 });
        run(ROW_EVERY * 2);
        expect(el.scrollTop).toBe(288);
        scroller.stop();
    });
});

/**
 * A 400 × 300px canvas that scrolls sideways over content three times as wide and clips content three times as tall —
 * `overflow: auto hidden`, as the showcase's canvases are — its rect stubbed.
 */
function canvas(): HTMLDivElement {
    const el = document.createElement("div");
    el.style.overflowX = "auto";
    el.style.overflowY = "hidden";
    Object.defineProperty(el, "scrollWidth", { value: 1200 });
    Object.defineProperty(el, "clientWidth", { value: 400 });
    Object.defineProperty(el, "scrollHeight", { value: 900 });
    Object.defineProperty(el, "clientHeight", { value: 300 });
    el.getBoundingClientRect = () => ({ x: 0, y: 100, left: 0, top: 100, right: 400, bottom: 400, width: 400, height: 300, toJSON() {} });
    document.body.appendChild(el);
    return el;
}

describe("the edge scroller's axes (#1442)", () => {
    test("a container that clips its taller content scrolls nothing while the pointer rests in its bottom band", () => {
        const el = canvas();
        const { scroller, steps, run } = frames(el);
        scroller.update({ x: 200, y: 400 - 8 });
        run(10);
        expect([el.scrollLeft, el.scrollTop]).toEqual([0, 0]);
        expect(steps).not.toHaveBeenCalled();
        scroller.stop();
    });

    test("the same container, the pointer in its bottom band and its right band, scrolls along x alone", () => {
        const el = canvas();
        const { scroller, steps, run } = frames(el);
        scroller.update({ x: 400 - 8, y: 400 - 8 });
        run(2);
        expect(el.scrollLeft).toBeGreaterThan(0);
        expect(el.scrollTop).toBe(0);
        expect(steps).toHaveBeenCalledTimes(3);
        scroller.stop();
    });
});
