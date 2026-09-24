/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A contract with TanStack Virtual that every virtualizer here depends on
 * (#837): when scrolling stops, the "scrolling ended" report carries the
 * element's offset as it is now.
 *
 * `@tanstack/virtual-core` 3.13.23 reported the offset captured at the last
 * scroll event instead, and reset the pending scroll adjustment with it.
 * Under load its debounce timer fired after a size correction had moved the
 * element but before that move's scroll event. The virtualizer's offset went
 * back to the stale value, and the next correction was computed from it,
 * undoing the first. The showcase's deep links then landed 4,450 px off
 * target. 3.17 reads the live offset; this pins it.
 */

import { describe, test, expect, vi } from "vitest";
import { observeElementOffset } from "@tanstack/react-virtual";

describe("TanStack's scroll-end report", () => {
    test("carries the element's offset now, not the one its last scroll event saw", () => {
        vi.useFakeTimers();
        try {
            const element = document.createElement("div");
            let scrollTop = 0;
            Object.defineProperty(element, "scrollTop", { configurable: true, get: () => scrollTop });
            const reports: Array<[number, boolean]> = [];
            // The fields the observer reads — the scroll element, its window
            // and the options that choose the debounced path.
            const instance = {
                scrollElement: element,
                targetWindow: window,
                options: { horizontal: false, isRtl: false, useScrollendEvent: false, isScrollingResetDelay: 150 },
            };
            const stop = observeElementOffset(
                instance as unknown as Parameters<typeof observeElementOffset>[0],
                (offset, isScrolling) => { reports.push([offset, isScrolling]); },
            );

            // The reader scrolls…
            scrollTop = 100;
            element.dispatchEvent(new Event("scroll"));
            // …a size correction then moves the element, its scroll event
            // still pending…
            scrollTop = 4550;
            // …and the debounced end fires first.
            vi.advanceTimersByTime(150);

            expect(reports).toEqual([[100, true], [4550, false]]);
            stop?.();
        } finally {
            vi.useRealTimers();
        }
    });
});
