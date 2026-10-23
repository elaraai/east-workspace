/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Fetch on intent (#1398, CL6): a paged reader gates its demand on the range
 * report's `isScrolling`, and the frame says the scroll rests as soon as it
 * shows intent — held still 100 ms, or slowed below a viewport per 200 ms —
 * so a scripted fling past an unloaded run asks for the window it slows over
 * before the gesture ends, while the virtualizer itself still says it is
 * scrolling. Under a fake clock: the frame's dwell, the virtualizer's own
 * settle and the speed's moments are all the clock's.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../theme/index.js";
import { INTENT_DWELL_MS, INTENT_SLOW_MS, ScrollIntent, VirtualRows } from "./virtual-rows.js";

const ROW_H = 32;
/** The viewport's height: what the virtualizer reads, and what a slow scroll travels less than per 200 ms. */
const VIEW_H = 200;

const originalOffsetH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
const originalOffsetW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date", "requestAnimationFrame", "cancelAnimationFrame"] });
    // jsdom lays nothing out: the scroll viewport is sized through offsetHeight, what the virtualizer reads.
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        get(this: HTMLElement) { return this.hasAttribute("data-index") ? ROW_H : VIEW_H; },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get() { return 240; } });
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    if (originalOffsetH !== undefined) Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetH);
    if (originalOffsetW !== undefined) Object.defineProperty(HTMLElement.prototype, "offsetWidth", originalOffsetW);
});

describe("a scroll's speed (CL6)", () => {
    test("a gesture's first offset says nothing of its speed; slower than a viewport per 200 ms is slow, faster is not", () => {
        const speed = new ScrollIntent();
        expect(speed.sample(0, 0, VIEW_H)).toBe(false);
        // 600 px in 16 ms: a fling.
        expect(speed.sample(16, 600, VIEW_H)).toBe(false);
        expect(speed.sample(32, 1200, VIEW_H)).toBe(false);
        // Read over the last 200 ms: it slows to 4 px a frame, and once the fling has left the span, it is slow.
        let t = 32;
        let y = 1200;
        let slow = false;
        while (t < 32 + INTENT_SLOW_MS + 32 && !slow) {
            t += 16;
            y += 4;
            slow = speed.sample(t, y, VIEW_H);
        }
        expect(slow).toBe(true);
        expect(t - 32).toBeLessThanOrEqual(INTENT_SLOW_MS + 16);
        // Come to rest, the next gesture is read afresh.
        speed.reset();
        expect(speed.sample(t + 500, y + 1, VIEW_H)).toBe(false);
    });
});

describe("VirtualRows reports the scroll at rest on intent (CL6)", () => {
    /** The range reports a paged reader hears: when, whether scrolling, and the row under the view's centre. */
    function frame() {
        const heard: { at: number; isScrolling: boolean; center: number | undefined }[] = [];
        const ui = render(
            <ChakraProvider value={system}>
                <VirtualRows height={`${VIEW_H}px`} maxHeight={undefined} count={20_000} sizes={Array.from({ length: 20_000 }, () => ROW_H)}
                    measureRows={false} overscan={2} getItemKey={(i) => `r${i}`} anchorable={() => true}
                    onRangeChange={(_range, isScrolling, center) => heard.push({ at: performance.now(), isScrolling, center: center?.index })}
                    renderRow={(i) => <div>row {i}</div>} />
            </ChakraProvider>,
        );
        const scroller = ui.container.querySelector<HTMLElement>("[data-virtual-rows='bounded']")!;
        /** One frame of the gesture: the offset moves by `px`, the scroll event fires, and 16 ms pass. */
        const step = (px: number) => {
            act(() => {
                scroller.scrollTop += px;
                fireEvent.scroll(scroller);
            });
            act(() => { vi.advanceTimersByTime(16); });
        };
        return { heard, step, scroller };
    }

    test("a fling that slows over the rows reports them at rest before the gesture ends — the scroll's events still coming", () => {
        const { heard, step, scroller } = frame();
        const mounted = heard.length;
        // A fling: 600 px a frame, far past anything in view.
        for (let i = 0; i < 12; i++) step(600);
        const flung = heard.length;
        expect(flung).toBeGreaterThan(mounted);
        expect(heard.slice(mounted).every((h) => h.isScrolling), "a fling reads nowhere — not even as it starts").toBe(true);
        // It slows to 6 px a frame: within the next 200 ms of it the reader hears the view at rest — while the
        // gesture's events keep coming, well inside the virtualizer's own 150 ms settle.
        const slowedAt = performance.now();
        for (let i = 0; i < 20; i++) step(6);
        const rest = heard.slice(flung).find((h) => !h.isScrolling);
        expect(rest, "a report at rest while the gesture goes on").toBeDefined();
        expect(rest!.at - slowedAt).toBeLessThanOrEqual(INTENT_SLOW_MS + 16);
        expect(rest!.at).toBeLessThan(performance.now());
        // …over the rows the view shows then: the row under its centre.
        const center = Math.floor((scroller.scrollTop + VIEW_H / 2) / ROW_H);
        expect(Math.abs(rest!.center! - center)).toBeLessThan(VIEW_H / ROW_H);
    });

    test("a scrollbar drag's pause counts: 100 ms held still reports the view at rest, before the virtualizer settles", () => {
        const { heard, step } = frame();
        for (let i = 0; i < 6; i++) step(900);
        const dragged = heard.length;
        // The thumb held still: no scroll event for the dwell — the report comes at it, not at the virtualizer's 150 ms.
        const stilled = performance.now();
        act(() => { vi.advanceTimersByTime(INTENT_DWELL_MS); });
        const rest = heard.slice(dragged).find((h) => !h.isScrolling);
        expect(rest, "a report at rest at the pause").toBeDefined();
        expect(rest!.at - stilled).toBeLessThanOrEqual(INTENT_DWELL_MS);
    });
});
