/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A phone's lane pager settles its window on the nearer lane once a swipe has
 * come to rest: by the browser's `scrollend` where it has the event, and where
 * it has none — an older iPhone, in any browser on it — once the scroll has
 * stood still a moment (`../shared/scroll-rest.ts`). Hearing `scrollend` alone,
 * a swipe let go between two lanes there stayed between them.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { formatters, system } from "@elaraai/east-ui-components";
import { SCROLL_REST_MS } from "../shared/scroll-rest.js";
import { FlowchartLanePager } from "./lane-pager.js";
import { flowchartMessages, type FlowchartWords } from "./messages.js";

const WORDS: FlowchartWords = { ...formatters("en-US"), m: flowchartMessages };
/** A lane's width, and the window's: one lane in view. */
const LANE = 300;

/** The page's `onscrollend`, as the test's browser has it: what says the browser tells when a scroll ends. */
const SAYS = Object.getOwnPropertyDescriptor(window, "onscrollend");
/** A browser that says when a scroll ends, or one that never does — an older iPhone's. */
function browser(says: boolean): void {
    delete (window as unknown as { onscrollend?: unknown }).onscrollend;
    if (says) Object.defineProperty(window, "onscrollend", { configurable: true, writable: true, value: null });
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
    cleanup();
    vi.useRealTimers();
    delete (window as unknown as { onscrollend?: unknown }).onscrollend;
    if (SAYS !== undefined) Object.defineProperty(window, "onscrollend", SAYS);
    document.body.replaceChildren();
});

/** A canvas's scroll frame — five lanes and what stands past the last — under its pager: where a swipe leaves it, and each place the pager moved it to. */
function pager() {
    const frame = document.createElement("div");
    document.body.append(frame);
    let left = 0;
    Object.defineProperties(frame, {
        clientWidth: { value: LANE },
        scrollWidth: { value: 5 * LANE + 120 },
        scrollLeft: { get: () => left, set: (to: number) => { left = to; } },
    });
    const moved: number[] = [];
    frame.scrollTo = ((to: ScrollToOptions) => { moved.push(to.left ?? 0); left = to.left ?? 0; }) as typeof frame.scrollTo;
    const ui = render(<ChakraProvider value={system}><FlowchartLanePager frame={frame} total={5} inView={1} slotPx={LANE} centred={false} words={WORDS} /></ChakraProvider>);
    return {
        frame, moved,
        readout: () => ui.container.querySelector("[data-slot='pagerReadout']")?.textContent,
        /** A swipe leaves the window at a place. */
        swipeTo: (to: number) => { left = to; act(() => { frame.dispatchEvent(new Event("scroll")); }); },
        pass: (ms: number) => { act(() => { vi.advanceTimersByTime(ms); }); },
    };
}

test("on a browser with no `scrollend`, a swipe let go between two lanes settles on the nearer once the scroll has stood still a moment — and a window already on a lane, or at the canvas's end, is left where it is", () => {
    browser(false);
    const { moved, swipeTo, pass, readout } = pager();
    expect(readout()).toBe("Lanes 1 of 5");
    // Let go two thirds of the way to the second lane.
    swipeTo(200);
    pass(SCROLL_REST_MS - 1);
    expect(moved).toEqual([]);
    pass(1);
    expect(moved).toEqual([LANE]);
    // On a lane: nothing to settle.
    swipeTo(2 * LANE);
    pass(SCROLL_REST_MS);
    expect([moved, readout()]).toEqual([[LANE], "Lanes 3 of 5"]);
    // At the canvas's end, past the last lane's start: left there.
    swipeTo(5 * LANE + 120 - LANE);
    pass(SCROLL_REST_MS);
    expect(moved).toEqual([LANE]);
});

test("on a browser that says when a scroll ends, its `scrollend` alone settles the window: no pause in a swipe does", () => {
    browser(true);
    const { frame, moved, swipeTo, pass } = pager();
    swipeTo(200);
    pass(10 * SCROLL_REST_MS);
    expect(moved).toEqual([]);
    act(() => { frame.dispatchEvent(new Event("scrollend")); });
    expect(moved).toEqual([LANE]);
});
