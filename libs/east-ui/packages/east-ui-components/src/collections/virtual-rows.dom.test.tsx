/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * VirtualRows fixed-row mode (#533): a fixed-height collection opts out of
 * per-row measurement with `measureRows: false`, so rows sit at exact
 * multiples of the fixed height. Under browser zoom, measurement reports
 * device-snapped FRACTIONAL heights even for a fixed-height box, and the
 * drift between measured offsets and rendered boxes paints as stray
 * hairline rules and vertically clipped row text — these tests pin that
 * fractional measurements cannot leak into row offsets.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../theme/index.js";
import { VirtualRows } from "./virtual-rows.js";

const ROW_H = 32;
/** What zoomed measurement reports for a nominally 32px row. */
const FRACTIONAL_ROW_H = 31.594;

const originalGetRect = Element.prototype.getBoundingClientRect;
const originalOffsetH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
const originalOffsetW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");

beforeEach(() => {
    // Row wrappers measure fractional (the zoom scenario); the scroll
    // viewport is sized through offsetHeight (what the virtualizer reads),
    // which jsdom reports as zero — leaving the virtual range empty
    // without this.
    Element.prototype.getBoundingClientRect = function (this: Element) {
        const height = this.hasAttribute("data-index") ? FRACTIONAL_ROW_H : 200;
        return {
            x: 0, y: 0, top: 0, left: 0, right: 240,
            width: 240, height, bottom: height,
            toJSON: () => ({}),
        } as DOMRect;
    };
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        get(this: HTMLElement) { return this.hasAttribute("data-index") ? ROW_H : 200; },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
        configurable: true,
        get() { return 240; },
    });
});

afterEach(() => {
    cleanup();
    Element.prototype.getBoundingClientRect = originalGetRect;
    if (originalOffsetH !== undefined) Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetH);
    if (originalOffsetW !== undefined) Object.defineProperty(HTMLElement.prototype, "offsetWidth", originalOffsetW);
});

describe("VirtualRows fixed-row geometry", () => {
    test("measureRows: false stacks the window's rows in one normal-flow column", () => {
        const { container } = render(
            <ChakraProvider value={system}>
                <VirtualRows
                    height="200px"
                    maxHeight={undefined}
                    count={20}
                    estimateSize={() => ROW_H}
                    measureRows={false}
                    overscan={6}
                    renderRow={(i) => <div>row {i}</div>}
                />
            </ChakraProvider>,
        );
        const wrappers = [...container.querySelectorAll<HTMLElement>("[data-index]")];
        expect(wrappers.length).toBeGreaterThan(1);
        // Rows are plain flow siblings inside ONE translated column — no
        // per-row transforms or absolute positioning whose device-pixel
        // rounding could paint seams between rows. Fractional measurements
        // never enter: nothing is measured in fixed-row mode.
        const column = wrappers[0]!.parentElement as HTMLElement;
        for (const el of wrappers) {
            expect(el.parentElement, `row ${el.dataset["index"]} sits in the shared window column`).toBe(column);
            expect(el.style.transform, `row ${el.dataset["index"]} has no per-row transform`).toBe("");
            expect(el.style.position).not.toBe("absolute");
        }
        const match = /translateY\((-?[\d.]+)px\)/.exec(column.style.transform);
        expect(match, "the window column carries the one translateY").toBeTruthy();
        expect(Number(match![1]) % ROW_H, "the window offset is an exact row multiple").toBe(0);
    });
});

describe("VirtualRows — the paged collection's two signals (#577)", () => {
    test("onRangeChange reports the mounted range, overscan included", () => {
        const seen: { startIndex: number; endIndex: number; isScrolling: boolean }[] = [];
        render(
            <ChakraProvider value={system}>
                <VirtualRows
                    height="200px"
                    maxHeight={undefined}
                    count={500}
                    estimateSize={() => ROW_H}
                    measureRows={false}
                    overscan={6}
                    onRangeChange={(range, isScrolling) => seen.push({ ...range, isScrolling })}
                    renderRow={(i) => <div>row {i}</div>}
                />
            </ChakraProvider>,
        );
        expect(seen.length).toBeGreaterThan(0);
        const last = seen[seen.length - 1]!;
        expect(last.startIndex).toBe(0);
        // A 200px viewport of 32px rows, plus overscan — a window, not the lot.
        expect(last.endIndex).toBeGreaterThan(0);
        expect(last.endIndex).toBeLessThan(499);
        // Idle at rest: a reader gates fetching and eviction on this.
        expect(last.isScrolling).toBe(false);
    });

    test("the range report carries the item under the viewport CENTER, resolved from the live offset (#612)", () => {
        const centers: ({ index: number; withinPx: number } | undefined)[] = [];
        const { container } = render(
            <ChakraProvider value={system}>
                <VirtualRows
                    height="200px"
                    maxHeight={undefined}
                    count={500}
                    estimateSize={() => ROW_H}
                    measureRows={false}
                    overscan={6}
                    onRangeChange={(_range, _isScrolling, center) => centers.push(center)}
                    renderRow={(i) => <div>row {i}</div>}
                />
            </ChakraProvider>,
        );
        // At rest the 200px viewport's center (100px) sits 4px into row 3.
        expect(centers[centers.length - 1]).toEqual({ index: 3, withinPx: 4 });

        // Scroll deep. The center must be read from the LIVE offset at report
        // time — a drag within one huge item never moves the mounted range,
        // so render-captured geometry would still say row 3.
        const scrollEl = container.firstElementChild as HTMLElement;
        scrollEl.scrollTop = 6400;
        fireEvent.scroll(scrollEl);
        const at = 6400 + 100;
        expect(centers[centers.length - 1]).toEqual({
            index: Math.floor(at / ROW_H),
            withinPx: at % ROW_H,
        });
    });

    test("sizeVersion busts TanStack's measurement memo when heights move at a constant count", () => {
        // The hazard, verified against virtual-core@3.13.23: `getMeasurements`
        // memoizes on [count, paddingStart, scrollMargin, getItemKey, enabled,
        // lanes] + the item-size cache — NOT on `estimateSize`. A skeleton band
        // becoming rows changes heights without changing the count, so without
        // a version bump every offset below it is stale.
        let rowHeight = ROW_H;
        const frame = (version: number) => (
            <ChakraProvider value={system}>
                <VirtualRows
                    height="200px"
                    maxHeight={undefined}
                    count={20}
                    estimateSize={() => rowHeight}
                    measureRows={false}
                    overscan={2}
                    sizeVersion={version}
                    renderRow={(i) => <div>row {i}</div>}
                />
            </ChakraProvider>
        );
        const { container, rerender } = render(frame(1));
        // How many rows the 200px viewport mounts is a direct read of the
        // measurements: taller rows ⇒ fewer of them fit.
        const mounted = (): number => container.querySelectorAll("[data-index]").length;
        const atShortRows = mounted();
        expect(atShortRows).toBeGreaterThan(2);

        // Heights double, count unchanged, version unchanged ⇒ STALE: the
        // virtualizer still believes the old geometry and mounts the same rows.
        rowHeight = ROW_H * 2;
        rerender(frame(1));
        expect(mounted()).toBe(atShortRows);

        // Bump the version ⇒ re-measured, so half as many rows now fit.
        rerender(frame(2));
        expect(mounted()).toBeLessThan(atShortRows);
    });
});
