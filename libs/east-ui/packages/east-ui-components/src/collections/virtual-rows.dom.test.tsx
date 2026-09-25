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

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { useEffect } from "react";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../theme/index.js";
import { VirtualRows, devicePixels, type RowsViewport } from "./virtual-rows.js";

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

describe("VirtualRows measured rows — device pixels and identity (#843)", () => {
    const offsets = (container: HTMLElement): number[] =>
        [...container.querySelectorAll<HTMLElement>("[data-slot=virtualRow]")]
            .map((el) => Number(/translateY\((-?[\d.]+)px\)/.exec(el.style.transform)![1]));

    test("devicePixels rounds a CSS height to whole device pixels at the current ratio", () => {
        const dpr = window.devicePixelRatio;
        try {
            Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1 });
            expect(devicePixels(31.594)).toBe(32);
            Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1.25 });
            // 30 CSS px = 37.5 device px → 38 device px = 30.4 CSS px.
            expect(devicePixels(30)).toBeCloseTo(30.4, 10);
            expect((devicePixels(30) * 1.25) % 1).toBeCloseTo(0, 10);
        } finally {
            Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: dpr });
        }
    });

    test("fractional measurements never put a measured row between device pixels", () => {
        const { container } = render(
            <ChakraProvider value={system}>
                <VirtualRows height="200px" maxHeight={undefined} count={20} estimateSize={() => ROW_H} overscan={6}
                    renderRow={(i) => <div>row {i}</div>} />
            </ChakraProvider>,
        );
        const ys = offsets(container);
        expect(ys.length).toBeGreaterThan(2);
        // Rows measure 31.594px (the zoom scenario); each slot rounds to 32, so offsets stay whole.
        for (const y of ys) expect(Number.isInteger(y), `offset ${y} is a whole device pixel`).toBe(true);
    });

    test("a keyed row keeps its element when a row is inserted above it", () => {
        const frame = (keys: readonly string[]) => (
            <ChakraProvider value={system}>
                <VirtualRows height="200px" maxHeight={undefined} count={keys.length} estimateSize={() => ROW_H} overscan={6}
                    getItemKey={(i) => keys[i]!} renderRow={(i) => <div data-key={keys[i]}>{keys[i]}</div>} />
            </ChakraProvider>
        );
        const { container, rerender } = render(frame(["a", "b", "c", "d"]));
        const wrapperOf = (key: string) => container.querySelector(`[data-key="${key}"]`)!.parentElement;
        const before = wrapperOf("c");
        rerender(frame(["new", "a", "b", "c", "d"]));
        expect(wrapperOf("c"), "the same wrapper element follows its row").toBe(before);
        expect(before!.dataset["index"], "…to its new index").toBe("3");
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

describe("VirtualRows — keys, exact sizes, a watched header (#812)", () => {
    const extentOf = (c: HTMLElement) =>
        Number(c.querySelector("[data-virtual-extent]")!.getAttribute("data-virtual-extent"));

    test("exact sizes re-measure by themselves when an entry moves at a constant count", () => {
        const frame = (sizes: readonly number[]) => (
            <ChakraProvider value={system}>
                <VirtualRows height="200px" maxHeight={undefined} count={sizes.length} sizes={sizes}
                    measureRows={false} overscan={2} renderRow={(i) => <div>row {i}</div>} />
            </ChakraProvider>
        );
        const short = Array.from({ length: 20 }, () => ROW_H);
        const { container, rerender } = render(frame(short));
        const mounted = (): number => container.querySelectorAll("[data-index]").length;
        const atShort = mounted();
        expect(extentOf(container)).toBe(20 * ROW_H);
        // A new list, the same entries: the geometry holds.
        rerender(frame([...short]));
        expect(mounted()).toBe(atShort);
        // Every row doubles at the same count — no version to bump; the frame
        // sees the entries move, so half as many rows fit and the extent follows.
        rerender(frame(short.map((h) => h * 2)));
        expect(extentOf(container)).toBe(20 * 2 * ROW_H);
        expect(mounted()).toBeLessThan(atShort);
    });

    test("getItemKey keeps a row's instance when the rows above it go", () => {
        const events: string[] = [];
        function Row({ id }: { id: string }) {
            useEffect(() => {
                events.push(`mount ${id}`);
                return () => { events.push(`unmount ${id}`); };
            }, [id]);
            return <div>{id}</div>;
        }
        const frame = (ids: readonly string[]) => (
            <ChakraProvider value={system}>
                <VirtualRows height="200px" maxHeight={undefined} count={ids.length} sizes={ids.map(() => ROW_H)}
                    getItemKey={(i) => ids[i]!} measureRows={false} overscan={10}
                    renderRow={(i) => <Row id={ids[i]!} />} />
            </ChakraProvider>
        );
        const { rerender } = render(frame(["a", "b", "c", "d"]));
        events.length = 0;
        // a and b collapse away: c and d move up two places. Keyed by index,
        // the instances at 0 and 1 would be handed c and d, and the ones that
        // drew them would go.
        rerender(frame(["c", "d"]));
        expect([...events].sort()).toEqual(["unmount a", "unmount b"]);
    });

    test("unbounded with a range listener: every row renders, and the range is the scrolling ancestor's", () => {
        const seen: { startIndex: number; endIndex: number }[] = [];
        const { container } = render(
            <ChakraProvider value={system}>
                <div style={{ overflowY: "auto", height: "200px" }}>
                    <VirtualRows height={undefined} maxHeight={undefined} count={50} estimateSize={() => ROW_H}
                        measureRows={false} overscan={2} onRangeChange={(range) => seen.push(range)}
                        renderRow={(i) => <div>row {i}</div>} />
                </div>
            </ChakraProvider>,
        );
        expect(container.querySelector('[data-virtual-rows="watched"]')).toBeTruthy();
        // Every row is in flow — none is a virtual window item...
        expect(container.querySelectorAll("[data-index]")).toHaveLength(0);
        expect(container.textContent).toContain("row 49");
        // ...and the range reported is the one the 200px ancestor shows.
        const last = seen[seen.length - 1]!;
        expect(last.startIndex).toBe(0);
        expect(last.endIndex).toBeGreaterThan(0);
        expect(last.endIndex).toBeLessThan(49);
    });

    test("unbounded at scale mounts only what the scrolling ancestor shows, at the full extent", () => {
        const { container } = render(
            <ChakraProvider value={system}>
                <div style={{ overflowY: "auto", height: "200px" }}>
                    <VirtualRows height={undefined} maxHeight={undefined} count={1_000} estimateSize={() => ROW_H}
                        measureRows={false} overscan={2} virtualizeUnboundedAt={400}
                        renderRow={(i) => <div>row {i}</div>} />
                </div>
            </ChakraProvider>,
        );
        expect(container.querySelector('[data-virtual-rows="ancestor"]')).toBeTruthy();
        const mounted = container.querySelectorAll("[data-index]").length;
        expect(mounted).toBeGreaterThan(1);
        expect(mounted).toBeLessThan(20);
        expect(extentOf(container)).toBe(1_000 * ROW_H);
    });

    test("a settled scroll reports the row resting at the top and how far into it; a restore puts it back (#813)", async () => {
        const anchors: { index: number; offset: number }[] = [];
        const frame = (restore?: { index: number; offset: number }) => (
            <ChakraProvider value={system}>
                <VirtualRows height="200px" maxHeight={undefined} count={100} sizes={Array.from({ length: 100 }, () => ROW_H)}
                    measureRows={false} overscan={2} onAnchorChange={(a) => anchors.push(a)} restoreAnchor={restore}
                    renderRow={(i) => <div>row {i}</div>} />
            </ChakraProvider>
        );
        const { container, rerender } = render(frame());
        const scrollEl = container.firstElementChild as HTMLElement;
        // The frame's first rest is no scroll the user chose — nothing reported.
        expect(anchors).toEqual([]);
        // Scroll 10px into row 20 and let it settle (TanStack clears its
        // scrolling flag 150ms after the last scroll event).
        scrollEl.scrollTop = 20 * ROW_H + 10;
        fireEvent.scroll(scrollEl);
        await act(async () => { await new Promise((r) => setTimeout(r, 250)); });
        expect(anchors[anchors.length - 1]).toEqual({ index: 20, offset: 10 });

        // A restore scrolls the frame so that row sits at the top again.
        const scrolled: number[] = [];
        Object.defineProperty(scrollEl, "scrollTo", {
            configurable: true,
            value: (arg: ScrollToOptions) => { scrolled.push(arg.top ?? -1); },
        });
        Object.defineProperty(scrollEl, "scrollHeight", { configurable: true, get: () => 100 * ROW_H });
        rerender(frame({ index: 40, offset: 6 }));
        expect(scrolled).toEqual([40 * ROW_H + 6]);
    });

    test("a header that grows moves the scroll margin — the range follows the rows down", () => {
        // A ResizeObserver the test fires, and the rows' offset below the
        // header as the frame measures it.
        const observers: (() => void)[] = [];
        const realRO = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
        (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
            private readonly cb: ResizeObserverCallback;
            constructor(cb: ResizeObserverCallback) { this.cb = cb; }
            observe() { observers.push(() => this.cb([], this as unknown as ResizeObserver)); }
            unobserve() {}
            disconnect() {}
        };
        let headerPx = 20;
        const realOffsetTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetTop");
        Object.defineProperty(HTMLElement.prototype, "offsetTop", {
            configurable: true,
            get(this: HTMLElement) { return this.hasAttribute("data-virtual-extent") ? headerPx : 0; },
        });
        try {
            const seen: { startIndex: number; endIndex: number }[] = [];
            render(
                <ChakraProvider value={system}>
                    <VirtualRows height="200px" maxHeight={undefined} count={100} estimateSize={() => ROW_H}
                        measureRows={false} overscan={0} header={<div>header</div>}
                        onRangeChange={(range) => seen.push(range)}
                        renderRow={(i) => <div>row {i}</div>} />
                </ChakraProvider>,
            );
            // Under a 20px header the 200px viewport shows rows 0–5.
            expect(seen[seen.length - 1]!.endIndex).toBe(5);
            // The header grows by 100px (a focus bar, a wrapped toolbar): the
            // rows start lower, so fewer of them are on screen.
            headerPx = 120;
            act(() => { for (const fire of observers) fire(); });
            expect(seen[seen.length - 1]!.endIndex).toBe(2);
        } finally {
            (globalThis as { ResizeObserver?: unknown }).ResizeObserver = realRO;
            if (realOffsetTop !== undefined) Object.defineProperty(HTMLElement.prototype, "offsetTop", realOffsetTop);
        }
    });
});

describe("VirtualRows — scroll anchoring (#878)", () => {
    // jsdom has no element `scrollTo`: the frame's writes land on scrollTop,
    // as a browser's do. Their scroll events are not sent — the virtualizer
    // already holds the offset it wrote.
    const proto = HTMLElement.prototype as unknown as { scrollTo?: (options: ScrollToOptions) => void };
    const realScrollTo = proto.scrollTo;
    beforeEach(() => {
        proto.scrollTo = function (this: HTMLElement, options: ScrollToOptions) {
            if (options.top !== undefined) this.scrollTop = options.top;
        };
    });
    afterEach(() => {
        if (realScrollTo === undefined) delete proto.scrollTo;
        else proto.scrollTo = realScrollTo;
    });

    const keysOf = (prefix: string, n: number): string[] => Array.from({ length: n }, (_u, i) => `${prefix}${i}`);
    const ROWS = keysOf("r", 100);
    /** The frame over `keys` — every row may anchor unless `anchorable` says otherwise. */
    const frame = (keys: readonly string[], opts: { anchorable?: ((i: number) => boolean) | null; scrollToIndex?: number } = {}) => (
        <ChakraProvider value={system}>
            <VirtualRows height="200px" maxHeight={undefined} count={keys.length} estimateSize={() => ROW_H} overscan={2}
                getItemKey={(i) => keys[i]!} anchorable={opts.anchorable === null ? undefined : opts.anchorable ?? (() => true)}
                scrollToIndex={opts.scrollToIndex}
                renderRow={(i) => <div data-key={keys[i]}>{keys[i]}</div>} />
        </ChakraProvider>
    );
    /** Where a row sits in the view: its offset from the view's top. */
    const inView = (container: HTMLElement, key: string): number => {
        const wrapper = container.querySelector(`[data-key="${key}"]`)!.parentElement as HTMLElement;
        const top = Number(/translateY\((-?[\d.]+)px\)/.exec(wrapper.style.transform)![1]);
        return top - (container.firstElementChild as HTMLElement).scrollTop;
    };
    /** Scroll the frame and let the virtualizer read it. */
    const scrollTo = (container: HTMLElement, px: number) => {
        const scrollEl = container.firstElementChild as HTMLElement;
        scrollEl.scrollTop = px;
        fireEvent.scroll(scrollEl);
        return scrollEl;
    };

    test("rows inserted above the view leave the row at its top where it is", () => {
        const { container, rerender } = render(frame(ROWS));
        const scrollEl = scrollTo(container, 50 * ROW_H);
        expect(inView(container, "r50")).toBe(0);
        // Ten rows land above it — a paged window.
        rerender(frame([...keysOf("n", 10), ...ROWS]));
        expect(scrollEl.scrollTop).toBe(60 * ROW_H);
        expect(inView(container, "r50")).toBe(0);
    });

    test("a row above the view growing leaves the row at its top where it is — its heights re-measured after the render", () => {
        // A stable key function and exact sizes: the growth reaches the frame
        // only through its re-measure, after the render that drew the rows.
        const keyOf = (i: number) => ROWS[i]!;
        const sized = (sizes: readonly number[]) => (
            <ChakraProvider value={system}>
                <VirtualRows height="200px" maxHeight={undefined} count={sizes.length} sizes={sizes} measureRows={false} overscan={2}
                    getItemKey={keyOf} anchorable={() => true} renderRow={(i) => <div>{ROWS[i]}</div>} />
            </ChakraProvider>
        );
        const flat = ROWS.map(() => ROW_H);
        const { container, rerender } = render(sized(flat));
        const scrollEl = scrollTo(container, 50 * ROW_H);
        // Row 10, far above the view, grows by 64px — a chart opening.
        rerender(sized(flat.map((h, i) => (i === 10 ? h + 64 : h))));
        expect(scrollEl.scrollTop).toBe(50 * ROW_H + 64);
    });

    test("a scroll the frame has not seen yet wins: a programmatic one, and the user's", () => {
        const { container, rerender } = render(frame(ROWS));
        const scrollEl = scrollTo(container, 50 * ROW_H);
        Object.defineProperty(scrollEl, "scrollHeight", { configurable: true, get: () => 110 * ROW_H });
        // A request for row 80: the frame scrolls there, its event still to come…
        rerender(frame(ROWS, { scrollToIndex: 80 }));
        const requested = scrollEl.scrollTop;
        expect(requested).not.toBe(50 * ROW_H);
        // …and rows land above before it arrives: the request stands, and follows its row (#885) — row 80
        // keeps the place in the view it was given. The anchor, taken before the request, never applies.
        rerender(frame([...keysOf("n", 10), ...ROWS], { scrollToIndex: 80 }));
        expect(scrollEl.scrollTop).toBe(requested + 10 * ROW_H);

        // The user scrolls, and rows land above before the event arrives: their scroll stands.
        const { container: c2, rerender: rerender2 } = render(frame(ROWS));
        const el2 = scrollTo(c2, 50 * ROW_H);
        el2.scrollTop = 20 * ROW_H;
        rerender2(frame([...keysOf("n", 10), ...ROWS]));
        expect(el2.scrollTop).toBe(20 * ROW_H);
    });

    describe("the pinned header is no row moving (#944)", () => {
        // The rows' offset below the header, as the frame measures it, and a
        // ResizeObserver the test fires.
        let headerPx = 72;
        const observers: (() => void)[] = [];
        const realOffsetTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetTop");
        const realRO = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
        beforeEach(() => {
            headerPx = 72;
            observers.length = 0;
            Object.defineProperty(HTMLElement.prototype, "offsetTop", {
                configurable: true,
                get(this: HTMLElement) { return this.hasAttribute("data-virtual-extent") ? headerPx : 0; },
            });
            (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
                private readonly cb: ResizeObserverCallback;
                constructor(cb: ResizeObserverCallback) { this.cb = cb; }
                observe() { observers.push(() => this.cb([], this as unknown as ResizeObserver)); }
                unobserve() {}
                disconnect() {}
            };
        });
        afterEach(() => {
            (globalThis as { ResizeObserver?: unknown }).ResizeObserver = realRO;
            if (realOffsetTop !== undefined) Object.defineProperty(HTMLElement.prototype, "offsetTop", realOffsetTop);
        });
        const headed = (
            <ChakraProvider value={system}>
                <VirtualRows height="200px" maxHeight={undefined} count={ROWS.length} estimateSize={() => ROW_H} overscan={2}
                    getItemKey={(i) => ROWS[i]!} anchorable={() => true} header={<div>header</div>}
                    renderRow={(i) => <div data-key={ROWS[i]}>{ROWS[i]}</div>} />
            </ChakraProvider>
        );

        test("a header the frame measures after its first commit leaves it at its first row", () => {
            const { container } = render(headed);
            expect((container.firstElementChild as HTMLElement).scrollTop).toBe(0);
            expect(inView(container, "r0")).toBe(0);
        });

        test("a header that grows while the frame is scrolled scrolls nothing — the rows move down with its edge", () => {
            const { container } = render(headed);
            const scrollEl = scrollTo(container, 50 * ROW_H);
            headerPx = 172;
            act(() => { for (const fire of observers) fire(); });
            expect(scrollEl.scrollTop).toBe(50 * ROW_H);
            expect(inView(container, "r50")).toBe(0);
        });
    });

    test("a row that may not anchor never does, and a frame that names none does not anchor at all", () => {
        // Only the r-rows may anchor: with the view's top on an n-row, the
        // anchor is the first r-row starting in view — two rows down.
        const nRows = keysOf("n", 100);
        const onlyR = (keys: readonly string[]) => (i: number) => keys[i]!.startsWith("r");
        const mixed = [...nRows.slice(0, 52), "r0", ...nRows.slice(52)];
        const { container, rerender } = render(frame(mixed, { anchorable: onlyR(mixed) }));
        const scrollEl = scrollTo(container, 50 * ROW_H);
        expect(inView(container, "r0")).toBe(2 * ROW_H);
        // Two rows land between the view's top and the anchor: it keeps its
        // place, and the n-row at the top gives way.
        const grown = [...mixed.slice(0, 52), "x0", "x1", ...mixed.slice(52)];
        rerender(frame(grown, { anchorable: onlyR(grown) }));
        expect(inView(container, "r0")).toBe(2 * ROW_H);
        expect(scrollEl.scrollTop).toBe(52 * ROW_H);

        const { container: c2, rerender: rerender2 } = render(frame(ROWS, { anchorable: null }));
        const el2 = scrollTo(c2, 50 * ROW_H);
        rerender2(frame([...keysOf("n", 10), ...ROWS], { anchorable: null }));
        expect(el2.scrollTop).toBe(50 * ROW_H);
    });

    describe("a scroll request follows its row, not its index (#885)", () => {
        /** The next animation frame — TanStack reconciles a scroll in one. */
        const nextFrame = () => new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); });
        /**
         * A paged frame, as the Plan draws one — exact sizes, keyed: a band stands for the rows not loaded above
         * the loaded ones, as tall as they are, and never anchors.
         */
        const paged = (loaded: readonly string[], above: number, scrollToIndex: number) => {
            const keys = ["band", ...loaded];
            return (
                <ChakraProvider value={system}>
                    <VirtualRows height="200px" maxHeight={undefined} count={keys.length}
                        sizes={keys.map((k) => (k === "band" ? above * ROW_H : ROW_H))} measureRows={false} overscan={2}
                        getItemKey={(i) => keys[i]!} anchorable={(i) => keys[i] !== "band"} scrollToIndex={scrollToIndex}
                        renderRow={(i) => <div data-key={keys[i]}>{keys[i]}</div>} />
                </ChakraProvider>
            );
        };

        test("a window landing above the row a request brought in, before the next frame, leaves it where the request put it", async () => {
            const { container, rerender } = render(paged(ROWS, 100, 0));
            const scrollEl = container.firstElementChild as HTMLElement;
            Object.defineProperty(scrollEl, "scrollHeight", { configurable: true, get: () => 200 * ROW_H });
            // A jump to r0, the first loaded row, under the band: the frame scrolls, and the scroll is reported.
            rerender(paged(ROWS, 100, 1));
            fireEvent.scroll(scrollEl);
            const placed = scrollEl.scrollTop;
            expect(placed).toBe(100 * ROW_H - (200 - ROW_H) / 2);
            // The ten rows above it land before the next frame: the band gives up their height, so r0 starts where
            // it did — and index 1, the request's, is now n0, ten rows up. The frames come: the view stays on r0.
            rerender(paged([...keysOf("n", 10), ...ROWS], 90, 1));
            await act(async () => { await nextFrame(); await nextFrame(); });
            expect(scrollEl.scrollTop).toBe(placed);
        });

        // A frame that does not anchor takes nothing else from TanStack between the row's measure and the
        // follow-up: it reads the commit's measurements itself.
        test.each([["an anchoring frame", () => true], ["a frame that does not anchor", null]] as const)(
            "a requested row that measures taller than its estimate is still brought wholly into view — %s",
            (_frame, anchorable) => {
                // Row 80 draws 96px tall; its estimate is a row's 32.
                const measured = Element.prototype.getBoundingClientRect;
                Element.prototype.getBoundingClientRect = function (this: Element) {
                    const rect = measured.call(this);
                    return this.querySelector('[data-key="r80"]') !== null && this.hasAttribute("data-index") ? { ...rect, height: 96, bottom: 96 } : rect;
                };
                try {
                    const { container, rerender } = render(frame(ROWS, { anchorable }));
                    const scrollEl = container.firstElementChild as HTMLElement;
                    Object.defineProperty(scrollEl, "scrollHeight", { configurable: true, get: () => 100 * ROW_H + 64 });
                    rerender(frame(ROWS, { anchorable, scrollToIndex: 80 }));
                    // A commit before the scroll is reported — a hover, say — finds row 80 where its estimate puts
                    // it, not yet mounted: the request stands.
                    rerender(frame(ROWS, { anchorable, scrollToIndex: 80 }));
                    // The scroll is reported; row 80 mounts, measures, and the frame centres it at its height.
                    fireEvent.scroll(scrollEl);
                    expect(inView(container, "r80")).toBe((200 - 96) / 2);
                } finally {
                    Element.prototype.getBoundingClientRect = measured;
                }
            },
        );

        test("the viewer's scroll ends it: rows landing above later are the anchor's, and the view is not taken back to the row", () => {
            const { container, rerender } = render(frame(ROWS));
            const scrollEl = container.firstElementChild as HTMLElement;
            Object.defineProperty(scrollEl, "scrollHeight", { configurable: true, get: () => 110 * ROW_H });
            rerender(frame(ROWS, { scrollToIndex: 80 }));
            // Before row 80 is in, the viewer scrolls to row 20.
            scrollTo(container, 20 * ROW_H);
            // Ten rows land above the view: the viewer's rows keep their place, and nothing scrolls to row 80.
            rerender(frame([...keysOf("n", 10), ...ROWS], { scrollToIndex: 80 }));
            expect(scrollEl.scrollTop).toBe(30 * ROW_H);
            expect(inView(container, "r20")).toBe(0);
        });

        test("a request is followed for five seconds at most, TanStack's own cap", () => {
            const { container, rerender } = render(frame(ROWS));
            const scrollEl = container.firstElementChild as HTMLElement;
            Object.defineProperty(scrollEl, "scrollHeight", { configurable: true, get: () => 120 * ROW_H });
            rerender(frame(ROWS, { scrollToIndex: 80 }));
            const requested = scrollEl.scrollTop;
            // Six seconds on, with its scroll still unreported, rows land above row 80: the request has lapsed.
            const start = performance.now();
            const clock = vi.spyOn(performance, "now").mockReturnValue(start + 6_000);
            try {
                rerender(frame([...keysOf("n", 10), ...ROWS], { scrollToIndex: 80 }));
            } finally {
                clock.mockRestore();
            }
            expect(scrollEl.scrollTop).toBe(requested);
        });

        test("a request whose row leaves the frame is dropped: nothing scrolls after it, least of all to the row that took its index", () => {
            const { container, rerender } = render(paged(ROWS, 100, 0));
            const scrollEl = container.firstElementChild as HTMLElement;
            Object.defineProperty(scrollEl, "scrollHeight", { configurable: true, get: () => 200 * ROW_H });
            rerender(paged(ROWS, 100, 1));
            const requested = scrollEl.scrollTop;
            // Before its scroll is reported, r0 leaves as the ten rows above it land: index 1 is n0, ten rows up.
            rerender(paged([...keysOf("n", 10), ...ROWS.slice(1)], 90, 1));
            expect(scrollEl.scrollTop).toBe(requested);
        });
    });
});

describe("VirtualRows — what moves its rows (#856)", () => {
    test("bounded, its scroll element both ways; unbounded at scale, its root and the ancestor it watches; below scale, its root alone; each change once, and null once unmounted", () => {
        const seen: (RowsViewport | null)[] = [];
        const onViewport = (viewport: RowsViewport | null) => { seen.push(viewport); };
        const frame = (height: string | undefined, count: number) => (
            <ChakraProvider value={system}>
                <div data-testid="scroller" style={{ overflowY: "auto", height: "200px" }}>
                    <VirtualRows height={height} maxHeight={undefined} count={count} estimateSize={() => ROW_H}
                        measureRows={false} overscan={2} virtualizeUnboundedAt={400} onViewport={onViewport}
                        renderRow={(i) => <div>row {i}</div>} />
                </div>
            </ChakraProvider>
        );
        const { container, getByTestId, rerender, unmount } = render(frame("200px", 1_000));
        const bounded = container.querySelector('[data-virtual-rows="bounded"]');
        expect(seen).toHaveLength(1);
        expect(seen[0]?.frame).toBe(bounded);
        expect(seen[0]?.scroller).toBe(bounded);
        // Unbounded at scale: the rows scroll sideways in the root, and the page scrolls them —
        // reported once, when the ancestor is known.
        rerender(frame(undefined, 1_000));
        expect(seen).toHaveLength(2);
        expect(seen[1]?.frame).toBe(container.querySelector('[data-virtual-rows="ancestor"]'));
        expect(seen[1]?.scroller).toBe(getByTestId("scroller"));
        // Below scale, with nothing to watch, every row in flow: the root, and no scroller.
        rerender(frame(undefined, 10));
        expect(container.querySelector("[data-virtual-rows]")).toBeNull();
        expect(seen).toHaveLength(3);
        expect(seen[2]?.frame).toBe(getByTestId("scroller").firstElementChild);
        expect(seen[2]?.scroller).toBeNull();
        // Nothing changed, nothing reported; null once the frame unmounts.
        rerender(frame(undefined, 11));
        expect(seen).toHaveLength(3);
        unmount();
        expect(seen).toHaveLength(4);
        expect(seen[3]).toBeNull();
    });
});
