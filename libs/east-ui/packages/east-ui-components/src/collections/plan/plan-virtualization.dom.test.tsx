/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Virtualization and measurement (#812) — the canvas body as its virtualizer
 * sees it. jsdom lays nothing out, so the geometry the frame READS is stubbed
 * (the viewport's height, the header's height, where the rows sit against a
 * scrolling ancestor) and the geometry it WRITES is read back from the DOM:
 * the extent (`data-virtual-extent`) and the one translated column the fixed
 * rows ride in, whose offset is the virtualizer's start for its first row.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { none, some, variant } from "@elaraai/east";
import { system } from "../../theme/index.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { EastChakraPlan, type PlanRootValue } from "./index.js";
import type { PlanRowId, PlanWireRow } from "./model.js";
import { setBodyRowMountProbe } from "./rows/BodyRow.js";
import type { PlanInstantValue } from "./instant.js";
import { blocksSource, oneBlock, rowId, rowKey, rowSel, testKeyOf } from "./plan.test-utils.js";
import { PLAN_GEOMETRY } from "./geometry.js";

// Every virtualizer's `measure()` is counted — the rest of TanStack is the
// real thing. (A re-measure is what a height change must cost and what a
// selection must not.)
const counted = vi.hoisted(() => ({ measure: 0 }));
vi.mock("@tanstack/react-virtual", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@tanstack/react-virtual")>();
    const wrapped = new WeakSet<object>();
    const count = <V extends { measure: () => void }>(v: V): V => {
        if (!wrapped.has(v)) {
            wrapped.add(v);
            const measure = v.measure;
            v.measure = () => {
                counted.measure += 1;
                measure();
            };
        }
        return v;
    };
    return {
        ...actual,
        useVirtualizer: ((opts: Parameters<typeof actual.useVirtualizer>[0]) =>
            count(actual.useVirtualizer(opts))) as typeof actual.useVirtualizer,
        useWindowVirtualizer: ((opts: Parameters<typeof actual.useWindowVirtualizer>[0]) =>
            count(actual.useWindowVirtualizer(opts))) as typeof actual.useWindowVirtualizer,
    };
});

// A ResizeObserver the test can fire — "the header grew" is a resize.
const resizeObservers = new Set<{ fire(): void }>();
class ResizeObserverStub {
    private readonly cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) { this.cb = cb; }
    observe() { resizeObservers.add(this); }
    unobserve() {}
    disconnect() { resizeObservers.delete(this); }
    fire() { this.cb([], this as unknown as ResizeObserver); }
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
const fireResize = () => act(() => { for (const o of [...resizeObservers]) o.fire(); });

// ── Layout stand-ins ──────────────────────────────────────────────────────
/** The bounded frame's viewport. */
let viewport = 400;
/** The sticky header's height without the focus bar, and the bar's own. */
let headerBase = 40;
const FOCUS_BAR = 30;
/** A scrolling ancestor's viewport (the unbounded tests). */
const SCROLLER = 600;

function stubbedHeight(el: Element): number {
    if (el.getAttribute("data-virtual-rows") === "bounded") return viewport;
    if (el.hasAttribute("data-plan-header")) {
        return headerBase + (el.querySelector("[data-plan-focusbar]") !== null ? FOCUS_BAR : 0);
    }
    if (el.hasAttribute("data-test-scroller")) return SCROLLER;
    return 0;
}
const realOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;
const realClientHeight = Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight")!;
const realRect = Element.prototype.getBoundingClientRect;

beforeEach(() => {
    initializeStore(new UIStore());
    counted.measure = 0;
    viewport = 400;
    headerBase = 40;
    // TanStack sizes a scroll element by `offsetHeight`; the R2 clamp reads
    // `clientHeight` — both answer from the stand-in.
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        get(this: HTMLElement) { return stubbedHeight(this); },
    });
    Object.defineProperty(Element.prototype, "clientHeight", {
        configurable: true,
        get(this: Element) { return stubbedHeight(this); },
    });
});
afterEach(() => {
    cleanup();
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", realOffsetHeight);
    Object.defineProperty(Element.prototype, "clientHeight", realClientHeight);
    Element.prototype.getBoundingClientRect = realRect;
    setBodyRowMountProbe(undefined);
});

// ── Fixtures ──────────────────────────────────────────────────────────────
const W27 = new Date("2026-06-29T00:00:00Z");
const W39 = new Date("2026-09-21T00:00:00Z");
const t = (d: Date): PlanInstantValue => variant("time", d) as PlanInstantValue;

/** One WIRE row, as the source serves it — named by its test key (#822); a
 *  `sub` line makes its gutter two lines (42px). */
function planRow(key: string, kind: unknown, opts?: { parent?: string; expand?: unknown; sub?: string }): PlanWireRow {
    return {
        id: rowId(key),
        parent: opts?.parent !== undefined ? some(rowId(opts.parent)) : none,
        gutter: {
            label: key, id: none, sub: opts?.sub !== undefined ? some(opts.sub) : none,
            value: none, meta: none, stacked: none, swatches: [],
        },
        kind,
        collapsed: none, pinned: none, height: none, status: none, approval: none,
        expand: opts?.expand !== undefined ? some(opts.expand) : none,
    } as unknown as PlanWireRow;
}
const span = () => variant("span", { runs: [], decisions: [], ports: [], rollup: none, unit: none });
const group = () => variant("group", { summary: none, summaryAggregate: none });
/** A spark chart the gutter toggles to expanded (32px ↔ 88px). */
const chart = () => variant("chart", {
    layers: [], left: none, right: none,
    height: variant("spark", null), expandedHeight: none, expandable: some(true),
});
const expandable = (px: string) => ({ height: some(px), axis: variant("keep", null) });
const pad = (i: number, width: number) => String(i).padStart(width, "0");

function planRoot(rows: PlanWireRow[], opts?: { height?: string; source?: unknown; expandRender?: boolean; links?: unknown[] }): PlanRootValue {
    return {
        rows: opts?.source !== undefined ? variant("paged", blocksSource(opts.source)) : variant("inline", oneBlock(rows)),
        links: opts?.links ?? [],
        axis: variant("time", {
            window: some({ min: W27, max: W39 }), resolution: variant("week", null),
            resolutions: [], now: none, format: none,
        }),
        grain: none,
        popover: none, hover: none,
        expandRender: opts?.expandRender === true
            ? some((id: PlanRowId) => variant("Text", { value: `R · ${id.value.path.join("/")}`, style: none }))
            : none,
        review: none, pick: none, slice: none, footer: [],
        id: "", sources: [], onDrag: none, canDrop: none,
        onSelect: none, onRunClick: none, onEventClick: none, onMarkClick: none, onChipClick: none, onCellClick: none,
        onGroupToggle: none, onGrainChange: none,
        style: opts?.height !== undefined
            ? some({ height: some(opts.height), maxHeight: none, density: none, gutterWidth: none })
            : none,
    } as unknown as PlanRootValue;
}

function renderPlan(value: PlanRootValue, key: string) {
    return render(
        <ChakraProvider value={system}>
            <EastChakraPlan value={value} storageKey={key} />
        </ChakraProvider>,
    );
}

// ── Reading the frame back ────────────────────────────────────────────────
const frameOf = (c: HTMLElement) => c.querySelector('[data-virtual-rows="bounded"]') as HTMLElement;
const extentOf = (c: HTMLElement) =>
    Number(c.querySelector("[data-virtual-extent]")!.getAttribute("data-virtual-extent"));
/** The first mounted row's index and where the virtualizer placed it — the
 *  fixed rows ride ONE translated column, so its offset is that row's start. */
function columnOf(c: HTMLElement): { first: number; top: number } {
    const first = c.querySelector("[data-virtual-extent] [data-index]") as HTMLElement;
    const match = /translateY\((-?[\d.]+)px\)/.exec((first.parentElement as HTMLElement).style.transform);
    return { first: Number(first.dataset["index"]), top: Number(match![1]) };
}
const scrollFrame = (c: HTMLElement, px: number) => {
    const frame = frameOf(c);
    frame.scrollTop = px;
    fireEvent.scroll(frame);
};
/** Where row `i` must start, given every row's height. */
const startOf = (heights: readonly number[], i: number) => heights.slice(0, i).reduce((a, b) => a + b, 0);

describe("Plan heights at a constant row count (#812, #743 item 1)", () => {
    // r00 (expandable) · chart · r01…r59 — 61 rows in a 400px frame.
    const rows = () => [
        planRow("r00", span(), { expand: expandable("120px") }),
        planRow("chart", chart()),
        ...Array.from({ length: 59 }, (_u, i) => planRow(`r${pad(i + 1, 2)}`, span())),
    ];

    test("a chart toggle moves every following row by exactly the delta, and the extent follows — both ways", () => {
        const { container } = renderPlan(planRoot(rows(), { height: "400px", expandRender: true }), "plan-812-chart");
        const rest = Array.from({ length: 61 }, () => 32);
        expect(extentOf(container)).toBe(startOf(rest, 61));

        // Spark → expanded: +56px at a constant count.
        fireEvent.click(container.querySelector(rowSel("chart"))!.children[0]!);
        const open = rest.map((h, i) => (i === 1 ? 88 : h));
        expect(extentOf(container)).toBe(startOf(open, 61));
        // Deep in the canvas, the first mounted row sits where the NEW heights
        // put it — the old measurements kept it 56px too high, over the chart.
        scrollFrame(container, 1200);
        const deep = columnOf(container);
        expect(deep.first).toBeGreaterThan(1);
        expect(deep.top).toBe(startOf(open, deep.first));

        // Expanded → spark: back by the same delta.
        scrollFrame(container, 0);
        fireEvent.click(container.querySelector(rowSel("chart"))!.children[0]!);
        expect(extentOf(container)).toBe(startOf(rest, 61));
        scrollFrame(container, 1200);
        const back = columnOf(container);
        expect(back.top).toBe(startOf(rest, back.first));
    });

    test("opening and closing an expand render re-lays every row: the focal row grows, the rest strip, the extent follows", () => {
        const { container } = renderPlan(planRoot(rows(), { height: "400px", expandRender: true }), "plan-812-expand");
        fireEvent.click(container.querySelector(`${rowSel("r00")} [data-plan-control="expand"]`)!);
        // The clamp floors the render at 88px here (400 − strips − chrome < 0),
        // so r00 is 32 + 88 and every other row a 16px strip.
        const focused = Array.from({ length: 61 }, (_u, i) => (i === 0 ? 32 + 88 : 16));
        expect(extentOf(container)).toBe(startOf(focused, 61));
        scrollFrame(container, 600);
        const deep = columnOf(container);
        expect(deep.first).toBeGreaterThan(0);
        expect(deep.top).toBe(startOf(focused, deep.first));

        scrollFrame(container, 0);
        fireEvent.keyDown(container.querySelector('[tabindex="0"]')!, { key: "Escape" });
        const rest = Array.from({ length: 61 }, () => 32);
        expect(extentOf(container)).toBe(startOf(rest, 61));
        scrollFrame(container, 1200);
        const back = columnOf(container);
        expect(back.top).toBe(startOf(rest, back.first));
    });
});

describe("Plan rows are keyed (#812)", () => {
    // Three groups of five: collapsing the FIRST moves every other row up.
    const rows = () => ["A", "B", "C"].flatMap((g) => [
        planRow(g, group()),
        ...Array.from({ length: 5 }, (_u, i) => planRow(`${g.toLowerCase()}${i + 1}`, span(), { parent: g })),
    ]);
    const survivors = ["A", "B", "b1", "b2", "b3", "b4", "b5", "C", "c1", "c2", "c3", "c4", "c5"];

    for (const mode of ["bounded", "unbounded"] as const) {
        test(`${mode}: collapsing a group keeps every surviving row's component instance`, () => {
            viewport = 2_000;                                   // every row mounted, before and after
            const events: string[] = [];
            setBodyRowMountProbe((key, phase) => events.push(`${phase} ${testKeyOf(key)}`));
            const { container } = renderPlan(
                planRoot(rows(), mode === "bounded" ? { height: "2000px" } : undefined), `plan-812-keys-${mode}`);
            expect(container.querySelectorAll("[data-plan-row]")).toHaveLength(15);
            events.length = 0;

            fireEvent.click(container.querySelector(rowSel("A", "data-plan-group"))!);
            expect(container.querySelector(rowSel("a1"))).toBeNull();
            // The hidden rows went; no row that is still on screen was
            // unmounted or mounted again. Keyed by index, the instances that
            // had drawn c1…c5 unmounted while c1…c5 moved up into instances
            // that had drawn other rows.
            const moved = events.filter((e) => survivors.includes(e.split(" ")[1]!));
            expect(moved).toEqual([]);
            expect(events.filter((e) => e.startsWith("unmount")).sort())
                .toEqual(["unmount a1", "unmount a2", "unmount a3", "unmount a4", "unmount a5"]);
        });
    }
});

describe("Plan re-measures on heights, never on selection (#812)", () => {
    test("selecting rows and moving the cursor re-measure nothing; a chart toggle re-measures once", () => {
        const { container } = renderPlan(planRoot([
            ...Array.from({ length: 10 }, (_u, i) => planRow(`r${i}`, span())),
            planRow("chart", chart()),
        ], { height: "400px" }), "plan-812-measure");
        expect(counted.measure).toBe(0);

        fireEvent.click(container.querySelector(rowSel("r2"))!);
        fireEvent.click(container.querySelector(rowSel("r3"))!);
        expect(container.querySelector(rowSel("r3"))!.hasAttribute("data-selected")).toBe(true);
        const plot = container.querySelector(rowSel("r1"))!.children[1] as HTMLElement;
        Object.defineProperty(plot, "getBoundingClientRect", {
            value: () => ({ left: 0, top: 0, right: 1000, bottom: 32, width: 1000, height: 32, x: 0, y: 0, toJSON: () => ({}) }),
        });
        fireEvent.pointerMove(plot, { clientX: 400 });
        fireEvent.pointerMove(plot, { clientX: 600 });
        expect(counted.measure).toBe(0);

        // The control: a height that moves IS re-measured — exactly once.
        fireEvent.click(container.querySelector(rowSel("chart"))!.children[0]!);
        expect(counted.measure).toBe(1);
    });
});

describe("Plan expand clamp reads the LIVE header (#812)", () => {
    test("the render is the body minus the strips minus the header WITH its focus bar — and follows the header when it grows", () => {
        viewport = 600;
        const { container } = renderPlan(planRoot([
            planRow("r0", span(), { expand: expandable("500px") }),
            ...Array.from({ length: 9 }, (_u, i) => planRow(`r${i + 1}`, span())),
        ], { height: "600px", expandRender: true }), "plan-812-clamp");
        fireEvent.click(container.querySelector(`${rowSel("r0")} [data-plan-control="expand"]`)!);
        expect(container.querySelector("[data-plan-focusbar]")).toBeTruthy();
        // 600 − (32 + 9 × 16 strips) − (40 + the 30px focus bar) = 354px of
        // render: r0 is 32 + 354, the strips 16 each. A header measured
        // before the focus bar mounted (40px) would have made it 384.
        const strips = 9 * 16;
        expect(extentOf(container)).toBe(32 + (600 - (32 + strips) - (40 + FOCUS_BAR)) + strips);

        // The toolbar wraps: the header grows 20px and the render gives it back.
        headerBase = 60;
        fireResize();
        expect(extentOf(container)).toBe(32 + (600 - (32 + strips) - (60 + FOCUS_BAR)) + strips);
    });
});

describe("Plan large unbounded canvases (#812)", () => {
    test("10,000 inline rows with no height mount what the scrolling ancestor shows — and scrolling it reveals more", () => {
        // The rows' top moves against the ancestor as it scrolls.
        let scrolled = 0;
        Element.prototype.getBoundingClientRect = function (this: Element) {
            if (this.hasAttribute("data-virtual-extent")) {
                return { x: 0, y: -scrolled, top: -scrolled, left: 0, right: 1000, bottom: -scrolled, width: 1000, height: 0, toJSON: () => ({}) } as DOMRect;
            }
            return realRect.call(this);
        };
        const rows = Array.from({ length: 10_000 }, (_u, i) => planRow(`r${pad(i, 5)}`, span()));
        const { container } = render(
            <ChakraProvider value={system}>
                <div data-test-scroller="" style={{ height: `${SCROLLER}px`, overflowY: "auto" }}>
                    <EastChakraPlan value={planRoot(rows)} storageKey="plan-812-large" />
                </div>
            </ChakraProvider>,
        );
        expect(container.querySelector('[data-virtual-rows="ancestor"]')).toBeTruthy();
        expect(container.querySelector(rowSel("r00000"))).toBeTruthy();
        expect(container.querySelectorAll("[data-plan-row]").length).toBeLessThan(100);
        // The frame is as tall as all of its rows — it still grows to content.
        expect(extentOf(container)).toBe(10_000 * 32);

        const scroller = container.querySelector("[data-test-scroller]") as HTMLElement;
        scrolled = 5_000 * 32;
        scroller.scrollTop = scrolled;
        fireEvent.scroll(scroller);
        expect(container.querySelector(rowSel("r05000"))).toBeTruthy();
        expect(container.querySelector(rowSel("r00000"))).toBeNull();
        expect(container.querySelectorAll("[data-plan-row]").length).toBeLessThan(100);
    });

    test("below 400 rows an unbounded inline canvas still renders every row in flow", () => {
        const rows = Array.from({ length: 399 }, (_u, i) => planRow(`r${pad(i, 3)}`, span()));
        const { container } = renderPlan(planRoot(rows), "plan-812-below");
        expect(container.querySelector("[data-virtual-rows]")).toBeNull();
        expect(container.querySelectorAll("[data-plan-row]")).toHaveLength(399);
    });
});

describe("Plan narrow paged demand (#812)", () => {
    /** A phone-width body (the adaptive contract reads its rect). */
    const phoneWidth = () => {
        Element.prototype.getBoundingClientRect = function () {
            return { left: 0, top: 0, right: 360, bottom: 600, width: 360, height: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
        };
    };
    /** 2,000 elements, one row each — ten windows. Records the windows asked. */
    function source2k() {
        const asked: number[] = [];
        const value = {
            id: "dom-812-narrow",
            page: (offset: bigint) => {
                const from = Number(offset);
                asked.push(from / 200);
                return some(Array.from({ length: Math.max(0, Math.min(200, 2_000 - from)) }, (_u, i) =>
                    planRow(`u${pad(from + i, 4)}`, span())));
            },
            total: () => some(2_000n),
            seek: none,
            revision: () => none,
            refresh: () => null,
        };
        return { value, asked };
    }
    const realIO = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    afterEach(() => { (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = realIO; });

    test("a narrow paged canvas over 2,000 rows reaches its last window by scrolling", async () => {
        phoneWidth();
        // An IntersectionObserver the test drives: "scrolling" is cards coming
        // into view.
        const io: { callback: IntersectionObserverCallback | undefined } = { callback: undefined };
        (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
            constructor(cb: IntersectionObserverCallback) { io.callback = cb; }
            observe() {}
            unobserve() {}
            disconnect() {}
            takeRecords() { return []; }
        };
        const inView = (els: Element[]) => act(() => {
            io.callback!(els.map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry),
                {} as IntersectionObserver);
        });

        const { value: source, asked } = source2k();
        const { container } = renderPlan(planRoot([], { source }), "plan-812-narrow");
        await vi.waitFor(() => expect(container.querySelector(rowSel("u0000", "data-plan-card"))).toBeTruthy());
        expect(container.querySelector("[data-plan-narrow]")).toBeTruthy();
        // At rest the demand is the opening ring — windows 0–2, no further.
        expect(Math.max(...asked)).toBe(2);

        const transport = () => container.querySelector('[data-slot="footerTransport"]')!.textContent;
        let tailShown = false;
        // Scroll: the list's last card comes into view, then its "N more
        // rows" is tapped. Only loaded rows are ever revealed — the demand
        // comes from the cards on screen, and it stays AHEAD of the reader:
        // the list never runs out and asks for the next window itself.
        for (let step = 0; step < 400 && transport() !== "2,000 loaded of 2,000"; step++) {
            const cards = container.querySelectorAll("[data-plan-card]");
            inView([cards[cards.length - 1]!]);
            tailShown ||= container.querySelector('[data-plan-more="source"]') !== null;
            const more = container.querySelector('[data-plan-more="rows"]');
            if (more !== null) fireEvent.click(more);
            await act(async () => {});
        }
        expect(transport()).toBe("2,000 loaded of 2,000");
        expect(tailShown).toBe(false);
        // Window by window, each asked once — it followed the list.
        expect(asked.filter((w) => w === 9)).toHaveLength(1);
    }, 60_000);

    test("with no IntersectionObserver the list's load-more still loads the next window", async () => {
        phoneWidth();
        delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
        const { value: source, asked } = source2k();
        const { container } = renderPlan(planRoot([], { source }), "plan-812-narrow-tap");
        await vi.waitFor(() => expect(container.querySelector(rowSel("u0000", "data-plan-card"))).toBeTruthy());
        // Nothing reports the viewport, so the resident rows run out: reveal
        // them all, and the load-more becomes the tail band in list form.
        for (let step = 0; step < 200 && container.querySelector('[data-plan-more="rows"]') !== null; step++) {
            fireEvent.click(container.querySelector('[data-plan-more="rows"]')!);
        }
        const tail = container.querySelector('[data-plan-more="source"]')!;
        expect(tail.textContent).toBe("1,400 more elements — scroll to load");
        expect(Math.max(...asked)).toBe(2);
        // A tap loads past the run — and opens the next page of it.
        fireEvent.click(tail);
        await vi.waitFor(() => expect(container.querySelector(rowSel("u0600", "data-plan-card"))).toBeTruthy());
        expect(asked).toContain(3);
    }, 60_000);
});

// ── Paged canvases page by parents (#823) ───────────────────────────────────
/** A paged canvas's transport line. */
const transport = (c: HTMLElement) => c.querySelector('[data-slot="footerTransport"]')!.textContent;
/** Where a mounted body item starts: its column's top, plus every mounted item
 *  above it — a row's `data-plan-h`, a band's `data-plan-px`. */
function topOf(c: HTMLElement, el: Element): number {
    let at = columnOf(c).top;
    for (const wrapper of c.querySelectorAll<HTMLElement>("[data-virtual-extent] [data-index]")) {
        if (wrapper.contains(el)) return at;
        const sized = wrapper.querySelector("[data-plan-h], [data-plan-px]")!;
        at += Number(sized.getAttribute("data-plan-h") ?? sized.getAttribute("data-plan-px"));
    }
    throw new Error("the item is not mounted");
}
/** The frame scrolls through `scrollTo`, which jsdom lacks: a write lands on
 *  scrollTop — and, when `notify`, sends its scroll event, as a browser's does. */
function stubScrollTo(notify: boolean): () => void {
    const proto = HTMLElement.prototype as unknown as { scrollTo?: (options: ScrollToOptions) => void };
    const real = proto.scrollTo;
    proto.scrollTo = function (this: HTMLElement, options: ScrollToOptions) {
        if (options.top === undefined) return;
        this.scrollTop = options.top;
        if (notify) this.dispatchEvent(new Event("scroll"));
    };
    return () => {
        if (real === undefined) delete proto.scrollTo;
        else proto.scrollTo = real;
    };
}

describe("the sticky parent (#823)", () => {
    // Line 1 holds a cell of forty machines — a parent inside a parent — and
    // line 2 ten. A band is 26px, a machine 32px.
    const rows = () => [
        planRow("L1", group()),
        planRow("L1a", group(), { parent: "L1" }),
        ...Array.from({ length: 40 }, (_u, i) => planRow(`L1a-m${pad(i, 2)}`, span(), { parent: "L1a" })),
        planRow("L2", group()),
        ...Array.from({ length: 10 }, (_u, i) => planRow(`L2-m${pad(i, 2)}`, span(), { parent: "L2" })),
    ];
    const INSIDE_L1A = 2 * 26 + 10 * 32 + 5;
    const L2_TOP = 2 * 26 + 40 * 32;
    // A scroll it asks for is clamped to the frame's scroll height, which
    // jsdom reports as 0: the frame scrolls as far as it is asked.
    const realScrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight")!;
    let restore: () => void = () => {};
    beforeEach(() => {
        restore = stubScrollTo(true);
        Object.defineProperty(Element.prototype, "scrollHeight", {
            configurable: true,
            get(this: Element) { return this.getAttribute("data-virtual-rows") === "bounded" ? 1_000_000 : 0; },
        });
    });
    afterEach(() => {
        restore();
        Object.defineProperty(Element.prototype, "scrollHeight", realScrollHeight);
    });
    const sticky = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-plan-sticky]");

    for (const arm of ["inline", "paged"] as const) {
        test(`${arm}: scrolled inside a parent whose band has gone, the band pins with its ancestors — and a click goes to it`, async () => {
            const all = rows();
            // Paged, both lines are entries of one window.
            const source = {
                id: "dom-823-sticky", page: (offset: bigint) => (offset === 0n ? some(all) : some([])),
                total: () => some(2n), seek: none, revision: () => none, refresh: () => null,
            };
            const { container } = renderPlan(
                planRoot(all, { height: "400px", ...(arm === "paged" ? { source } : {}) }), `plan-823-sticky-${arm}`);
            await waitFor(() => expect(container.querySelector(rowSel("L1", "data-plan-group"))).toBeTruthy());
            // At the top, the first row is line 1's own band: nothing to pin.
            expect(sticky(container)).toBeNull();
            // Ten machines into the cell: its band and line 1's have scrolled
            // off. The strip names the cell, after the path down to it.
            scrollFrame(container, INSIDE_L1A);
            const strip = sticky(container)!;
            expect(strip.getAttribute("data-plan-sticky")).toBe(rowKey("L1a"));
            expect([...strip.querySelectorAll("span")].map((x) => x.textContent)).toEqual(["L1", "L1a"]);
            expect(strip.getAttribute("aria-hidden")).toBe("true");
            // Line 2's own band at the top: nothing to pin; inside it, line 2.
            scrollFrame(container, L2_TOP);
            expect(sticky(container)).toBeNull();
            scrollFrame(container, L2_TOP + 26 + 3 * 32);
            expect(sticky(container)!.getAttribute("data-plan-sticky")).toBe(rowKey("L2"));
            // A click on the strip goes to its parent's row: the cell's band is
            // at the top of the view — and line 1, off the top above it, pins.
            scrollFrame(container, INSIDE_L1A);
            fireEvent.click(sticky(container)!);
            await waitFor(() => expect(frameOf(container).scrollTop).toBe(26));
            expect(sticky(container)!.getAttribute("data-plan-sticky")).toBe(rowKey("L1"));
            expect([...sticky(container)!.querySelectorAll("span")].map((x) => x.textContent)).toEqual(["L1"]);
        });
    }
});

describe("a paged window drawing otherwise than its estimate (#823, #878)", () => {
    // Window 0's rows draw 32px and every later window's 42px (a two-line
    // gutter), so an unvisited window is described at 32px an element and
    // lands 200 × 10px taller than its band.
    const EST = 200 * 32;
    const TALL = 200 * 42;
    const source = {
        id: "dom-823-varied",
        page: (offset: bigint) => {
            const w = Number(offset) / 200;
            return some(Array.from({ length: 200 }, (_u, i) =>
                planRow(`w${pad(w, 4)}r${pad(i, 3)}`, span(), w === 0 ? undefined : { sub: "two lines" })));
        },
        total: () => some(2_000n), seek: none, revision: () => none, refresh: () => null,
    };
    // The frame anchors through `scrollTo`: its writes land on scrollTop.
    let restore: () => void = () => {};
    beforeEach(() => { restore = stubScrollTo(false); });
    afterEach(() => { restore(); });

    test("lands above the rows in view and leaves them where they are — the view follows its rows, not the estimate", async () => {
        const { container } = renderPlan(planRoot([], { height: "400px", source }), "plan-823-anchor");
        await waitFor(() => expect(transport(container)).toBe("600 loaded of 2,000"));
        // Windows 1 and 2 landed at their own height; the rest are estimates.
        expect(extentOf(container)).toBe(EST + 2 * TALL + 7 * EST);
        // Far down, over the tail band, where the estimate puts element 1,500:
        // the run rebases to window 7 and grows to [6, 9].
        scrollFrame(container, EST + 2 * TALL + 4 * EST + 100 * 32);
        await waitFor(() => expect(transport(container)).toBe("elements 1,201–2,000 of 2,000"), { timeout: 10_000 });
        // Windows 0–5 are the head band: 0–2 as they drew, 3–5 estimates.
        const head = EST + 2 * TALL + 3 * EST;
        // Up to window 6's first row, 10px into it. Once the scroll settles,
        // window 5 above it is asked for — and lands 2,000px taller than its
        // estimate.
        scrollFrame(container, head + 10);
        const first = () => container.querySelector(rowSel("w0006r000"))!;
        expect(frameOf(container).scrollTop - topOf(container, first())).toBe(10);
        await waitFor(() => expect(transport(container)).toBe("elements 1,001–2,000 of 2,000"), { timeout: 10_000 });
        // The rows in view kept their places: the view moved with them, by
        // exactly what window 5 drew beyond its estimate.
        expect(frameOf(container).scrollTop).toBe(head + 10 + (TALL - EST));
        expect(frameOf(container).scrollTop - topOf(container, first())).toBe(10);
    }, 30_000);
});

describe("a link into an evicted window (#823, #818)", () => {
    // Ten windows of twenty rows, each row with one run: every window draws 640px.
    const W = 20 * 32;
    const bar = variant("span", {
        runs: [{
            key: "x", start: t(W27), end: t(new Date("2026-07-13T00:00:00Z")), label: "X",
            quantity: none, qty: none, state: variant("actual", null), status: none, moved: none, icon: none,
        }],
        decisions: [], ports: [], rollup: none, unit: none,
    });
    const source = {
        id: "dom-823-links",
        page: (offset: bigint) => {
            const w = Number(offset) / 200;
            return some(Array.from({ length: 20 }, (_u, i) => planRow(`w${pad(w, 4)}r${pad(i, 3)}`, bar)));
        },
        total: () => some(2_000n), seek: none, revision: () => none, refresh: () => null,
    };
    // A row of window 7 feeds a row of window 1.
    const links = [{ fromRow: rowId("w0007r000"), fromRun: "x", toRow: rowId("w0001r000"), toRun: "x", quantity: 5, label: "5 t" }];
    /** A triangle's tip — its second vertex. */
    const tipOf = (d: string): [number, number] => {
        const nums = d.trim().split(/[\sMLZ]+/).filter((x) => x !== "").map(Number);
        return [nums[2]!, nums[3]!];
    };
    // The ribbons need the plot's width: the layer is the 168px gutter and a 1000px plot.
    const realClientWidth = Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth")!;
    beforeEach(() => {
        Object.defineProperty(Element.prototype, "clientWidth", {
            configurable: true,
            get(this: Element) { return this.hasAttribute("data-plan-ribbons") ? 1168 : 0; },
        });
    });
    afterEach(() => { Object.defineProperty(Element.prototype, "clientWidth", realClientWidth); });

    test("its end sits at that window's offset in the band — and clamps and stubs like any row out of view", async () => {
        const { container } = renderPlan(planRoot([], { height: "400px", source, links }), "plan-823-links");
        await waitFor(() => expect(transport(container)).toBe("600 loaded of 2,000"));
        // Far down, to window 7: the run rebases to [6, 9] and windows 0–2 are
        // evicted — w0001r000 with them.
        scrollFrame(container, 7 * W + 10);
        await waitFor(() => expect(transport(container)).toBe("elements 1,201–2,000 of 2,000"), { timeout: 10_000 });
        expect(container.querySelector(rowSel("w0001r000"))).toBeNull();
        fireEvent.click(container.querySelector(`${rowSel("w0007r000")} [data-plan-control="links"]`)!);
        // Over the head band, 40px above window 1's place in it. (The scroll
        // is read before it settles — a settled one would bring window 1 back.)
        // The far end is drawn AT its window's offset, unclamped; the near
        // end, below the view, stubs toward its row.
        scrollFrame(container, W - 40);
        const link = () => container.querySelector('[data-plan-link="0"]')!;
        expect(link()).toBeTruthy();
        const head = () => link().querySelector("[data-plan-ribbon-head]")!;
        expect(head().hasAttribute("data-plan-stub")).toBe(false);
        expect(tipOf(head().getAttribute("d")!)[1]).toBe(W + PLAN_GEOMETRY.default.bar / 2);
        expect(link().querySelector('[data-plan-stub="below"]')).toBeTruthy();
        // Down at the focused row, the far end is above the view: it clamps to
        // the view's top and stubs up toward its window.
        const near = 6 * W;
        scrollFrame(container, near - 100);
        expect(head().getAttribute("data-plan-stub")).toBe("above");
        expect(tipOf(head().getAttribute("d")!)[1]).toBe(near - 100);
    }, 30_000);
});
