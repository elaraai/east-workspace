/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The accessible canvas (#819): the body is a treegrid whose every row kind is
 * a row at its level and place — mounted or not, loaded or not — with ONE tab
 * stop roving between them; a keyboard map over rows and their elements; a
 * live region that says what changed; and words for everything the canvas says
 * only by shape or colour.
 */

import { describe, test, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import { none, some, variant } from "@elaraai/east";
import { system } from "../../theme/index.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { registerReactiveTracker, type ReactiveTracker } from "../../reactive/tracker.js";
import { EastChakraPlan, type PlanRootValue, type PlanRowValue } from "./index.js";
import { setBodyRowRenderProbe } from "./rows/BodyRow.js";
import { PLAN_PAGE_SIZE } from "./use-plan-paging.js";
import { minOf } from "./reductions.js";
import type { PlanInstantValue } from "./instant.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const cleanups: (() => void)[] = [];
beforeEach(() => { initializeStore(new UIStore()); });
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    while (cleanups.length > 0) cleanups.pop()!();
    setBodyRowRenderProbe(undefined);
    localStorage.clear();
});

/**
 * Waits, each call, for the open popover to arm its dismissal (the #816
 * tests' watch). Zag arms it on the document after the popover opens — the
 * Escape listener a frame later, the outside-press listener (a capture
 * `pointerdown`) a frame and a task after that, which is what this counts. A
 * user's Escape always comes later; a test's can come first, and then meets
 * the canvas's own rung instead of the popover's.
 */
function watchPopoverArming(): () => Promise<void> {
    let armings = 0;
    let waited = 0;
    const add = EventTarget.prototype.addEventListener;
    vi.spyOn(document, "addEventListener").mockImplementation(function (
        this: Document, ...args: Parameters<EventTarget["addEventListener"]>
    ) {
        const [type, , options] = args;
        if (type === "pointerdown" && options === true
            && document.querySelector('[data-plan-overlay="popover"]') !== null) armings += 1;
        add.apply(this, args);
    } as typeof document.addEventListener);
    return async () => {
        await waitFor(() => expect(armings).toBeGreaterThan(waited));
        waited = armings;
    };
}

// ── Fixtures ──────────────────────────────────────────────────────────────
const W27 = new Date("2026-06-29T00:00:00Z");
const W39 = new Date("2026-09-21T00:00:00Z");
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const t = (d: Date): PlanInstantValue => variant("time", d) as PlanInstantValue;

function planRow(key: string, kind: unknown, opts?: { parent?: string; label?: string; pinned?: boolean; status?: string; expand?: boolean }): PlanRowValue {
    return {
        key,
        parent: opts?.parent !== undefined ? some(opts.parent) : none,
        gutter: { label: opts?.label ?? key, id: none, sub: none, value: none, meta: none, stacked: none, swatches: [] },
        kind,
        pinned: opts?.pinned === true ? some(true) : none,
        height: none,
        status: opts?.status !== undefined ? some(variant(opts.status, null)) : none,
        approval: none,
        expand: opts?.expand === true ? some({ height: some("120px"), axis: variant("keep", null) }) : none,
    } as unknown as PlanRowValue;
}
const group = (collapsed?: boolean, summary?: unknown) => variant("group", {
    summary: summary !== undefined ? some(summary) : none, summaryAggregate: none,
    collapsed: collapsed !== undefined ? some(collapsed) : none,
});
function run(key: string, start: Date, end: Date, state: unknown = variant("actual", null), status?: string) {
    return {
        key, start: t(start), end: t(end), label: key.toUpperCase(), quantity: none, qty: none, state,
        status: status !== undefined ? some(variant(status, null)) : none, moved: none, icon: none,
    };
}
const span = (runs: unknown[] = [], decisions: unknown[] = [], ports: unknown[] = []) =>
    variant("span", { runs, decisions, ports, rollup: none, unit: none });
const chart = (points: [Date, number][], expandable = true) => variant("chart", {
    layers: [variant("line", { points: points.map(([d, y]) => ({ t: t(d), y })), axis: variant("left", null), breach: none })],
    left: none, right: none, height: variant("spark", null), expandedHeight: none,
    expandable: expandable ? some(true) : none,
});
const heatCells = (cells: [Date, number | undefined][], warnAt?: number) => variant("heat", {
    cells: cells.map(([d, v]) => ({ at: t(d), value: v !== undefined ? some(v) : none, label: none })),
    min: some(0), max: some(100), warnAt: warnAt !== undefined ? some(warnAt) : none,
});

function planRoot(rows: PlanRowValue[], opts: {
    source?: unknown; popover?: unknown; onRunClick?: unknown; links?: unknown[];
    height?: string; expandRender?: boolean;
} = {}): PlanRootValue {
    return {
        rows: opts.source !== undefined
            ? variant("paged", opts.source)
            : variant("inline", new Map(rows.map((r) => [r.key, r]))),
        links: opts.links ?? [],
        axis: variant("time", {
            window: some({ min: W27, max: W39 }), resolution: variant("week", null),
            resolutions: [], now: none, format: none,
        }),
        grain: none,
        popover: opts.popover !== undefined ? some(opts.popover) : none,
        hover: none,
        expandRender: opts.expandRender === true
            ? some((ref: { key: string }) => variant("Text", { value: `R · ${ref.key}`, style: none }))
            : none,
        expandGutter: none, review: none, pick: none, slice: none, footer: [],
        id: "", sources: [], onDrag: none, canDrop: none,
        onSelect: none,
        onRunClick: opts.onRunClick !== undefined ? some(opts.onRunClick) : none,
        onEventClick: none, onMarkClick: none, onChipClick: none, onCellClick: none,
        onGroupToggle: none, onGrainChange: none,
        style: opts.height !== undefined
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

/** One of every row kind under a group, and a pinned row above them. */
const EVERY_KIND = () => [
    planRow("pin", span(), { pinned: true, label: "Pinned" }),
    planRow("G", group(), { label: "Line 1" }),
    planRow("s", span(
        [run("r1", W27, day("2026-07-13"), variant("actual", null), "warning")],
        [{ key: "d1", at: t(day("2026-07-06")), applied: true }],
        [{ at: t(day("2026-07-20")), label: some("IN · 40 t") }],
    ), { parent: "G", status: "warning" }),
    planRow("b", variant("buckets", {
        lanes: [{ key: "am", label: some("AM") }],
        events: [{
            key: "e1", at: t(W27), lane: some("am"), label: some("Pour"), icon: none, state: variant("confirmed", null),
            tone: none, color: none, colorPalette: none, stretch: none, content: none, animation: none,
        }],
        markers: [{ at: t(W27), lane: some("am"), status: variant("danger", null), message: "Crew short" }],
    }), { parent: "G" }),
    planRow("k", chart([[W27, 94], [day("2026-08-31"), 101]]), { parent: "G" }),
    planRow("h", variant("heat", { cells: heatCells([[W27, 80], [day("2026-07-06"), undefined]], 75), aggregate: none }), { parent: "G" }),
    planRow("t", variant("table", {
        series: [{ cells: [{ at: t(W27), value: some(1204), text: none, tone: none }], format: none, tone: none, strong: none, rollup: none }],
        split: variant("horizontal", null), aggregate: none, format: none, emphasis: variant("body", null),
    }), { parent: "G" }),
    planRow("c", variant("cards", {
        chips: [{ key: "c1", from: t(W27), to: t(day("2026-07-13")), label: "D. OKAFOR", state: variant("confirmed", null), icon: none }],
    }), { parent: "G" }),
    planRow("e", variant("events", {
        marks: [
            { key: "k1", at: t(W27), kind: variant("milestone", null), icon: none, label: some("KICKOFF") },
            { key: "k2", at: t(day("2026-07-13")), kind: variant("decision", { applied: false }), icon: none, label: none },
            { key: "k3", at: t(day("2026-07-27")), kind: variant("exception", null), icon: none, label: none },
        ],
    }), { parent: "G" }),
];

const item = (c: HTMLElement, key: string) => c.querySelector(`[data-plan-item="${key}"]`) as HTMLElement;
const gridOf = (c: HTMLElement) => c.querySelector('[role="treegrid"]') as HTMLElement;
const announced = (c: HTMLElement) => c.querySelector("[data-plan-announce]")!.textContent;
const focusedItem = () => (document.activeElement as HTMLElement | null)?.getAttribute("data-plan-item");
const press = (key: string, opts: { shiftKey?: boolean } = {}) =>
    fireEvent.keyDown(document.activeElement as HTMLElement, { key, ...opts });

// ── The treegrid ──────────────────────────────────────────────────────────
describe("the canvas is a treegrid (#819)", () => {
    test("every row kind is a row at its level and place; the grid counts them all and owns the pinned rows", () => {
        const { container } = renderPlan(planRoot(EVERY_KIND()), "plan-819-rows");
        const grid = gridOf(container);
        expect(grid.getAttribute("aria-label")).toBe("Plan");
        expect(grid.getAttribute("aria-rowcount")).toBe("9");
        // The pinned row renders in the header, yet is the grid's first row.
        const pinned = document.getElementById(grid.getAttribute("aria-owns")!)!;
        expect(pinned.getAttribute("role")).toBe("rowgroup");
        expect(pinned.contains(item(container, "r:pin"))).toBe(true);
        const order = ["pin", "G", "s", "b", "k", "h", "t", "c", "e"];
        order.forEach((key, i) => {
            const row = item(container, `r:${key}`);
            expect(row.getAttribute("role")).toBe("row");
            expect(row.getAttribute("aria-rowindex")).toBe(String(i + 1));
            expect(row.getAttribute("aria-level")).toBe(key === "pin" || key === "G" ? "1" : "2");
            // The name cell, then the plot.
            expect(row.querySelector(":scope > [role='rowheader']")).toBeTruthy();
            expect(row.querySelector(":scope > [role='gridcell']")).toBeTruthy();
        });
        // Expanded: the open section, the closed expandable chart; a plain row says nothing.
        expect(item(container, "r:G").getAttribute("aria-expanded")).toBe("true");
        expect(item(container, "r:k").getAttribute("aria-expanded")).toBe("false");
        expect(item(container, "r:s").hasAttribute("aria-expanded")).toBe(false);
        // Selected: every data row says whether it is; a group band cannot be.
        expect(item(container, "r:s").getAttribute("aria-selected")).toBe("false");
        expect(item(container, "r:G").hasAttribute("aria-selected")).toBe(false);
        fireEvent.click(item(container, "r:s"));
        expect(item(container, "r:s").getAttribute("aria-selected")).toBe("true");
        // A status is a colour — the dot names it.
        expect(item(container, "r:s").querySelector("[role='rowheader'] [role='img']")!.getAttribute("aria-label"))
            .toBe("Status: warning");
    });

    test("every element kind is a button named by what its look encodes; labelled marks and charts are images", () => {
        const { container } = renderPlan(planRoot(EVERY_KIND()), "plan-819-elements");
        const named = (sel: string) => {
            const el = container.querySelector(sel) as HTMLElement;
            return [el.getAttribute("role"), el.getAttribute("aria-label")];
        };
        expect(named("[data-run='r1']")).toEqual(["button", "R1, Jun 29, 2026 – Jul 13, 2026, actual, warning"]);
        expect(named("[data-plan-item='r:s'] [data-mark='d1']")).toEqual(["button", "Decision, Jul 6, 2026, applied"]);
        expect(named("[data-port]")).toEqual(["img", "IN · 40 t"]);
        expect(named("[data-event='e1']")).toEqual(["button", "Pour, Week of Jun 29, 2026, AM, confirmed"]);
        expect(named("[data-marker]")).toEqual(["img", "Crew short"]);
        expect(named("[data-chip='c1']")).toEqual(["button", "D. OKAFOR, Jun 29, 2026 – Jul 13, 2026, confirmed"]);
        expect(named("[data-plan-item='r:e'] [data-mark='k1'][tabindex]")).toEqual(["button", "KICKOFF, milestone, Jun 29, 2026"]);
        expect(named("[data-plan-item='r:e'] [data-mark='k2']")).toEqual(["button", "Decision, pending, Jul 13, 2026"]);
        expect(named("[data-plan-item='r:e'] [data-mark='k3']")).toEqual(["button", "Exception, Jul 27, 2026"]);
        // A printed mark label is that name's echo — hidden from a reader.
        expect(container.querySelector("[data-plan-item='r:e'] [data-mark='k1']:not([tabindex])")!.getAttribute("aria-hidden")).toBe("true");
        expect(named("[data-plan-item='r:t'] [data-cell]")).toEqual(["button", "Week of Jun 29, 2026: 1,204"]);
        // A chart is a shape: an image, named by its values, with a title.
        const plot = container.querySelector("[data-plan-item='r:k'] [data-plan-chart]")!;
        expect(plot.getAttribute("role")).toBe("img");
        expect(plot.getAttribute("aria-label")).toBe("Chart: line min 94, max 101, last 101");
        expect(plot.querySelector("svg > title")!.textContent).toBe("Chart: line min 94, max 101, last 101");
    });

    test("a collapse renumbers every row below it — written onto them, not rendered", () => {
        const rows = [
            planRow("A", group()),
            ...["a1", "a2", "a3"].map((k) => planRow(k, span(), { parent: "A" })),
            ...["b1", "b2", "b3"].map((k) => planRow(k, span())),
        ];
        const { container } = renderPlan(planRoot(rows), "plan-819-renumber");
        expect(item(container, "r:b1").getAttribute("aria-rowindex")).toBe("5");
        const rendered: string[] = [];
        setBodyRowRenderProbe((key) => rendered.push(key));
        fireEvent.click(item(container, "r:A"));
        expect(gridOf(container).getAttribute("aria-rowcount")).toBe("4");
        expect(["b1", "b2", "b3"].map((k) => item(container, `r:${k}`).getAttribute("aria-rowindex"))).toEqual(["2", "3", "4"]);
        // Only the band that closed rendered — the rows below kept their memo.
        expect(rendered).toEqual(["A"]);
    });

    describe("under virtualization", () => {
        // jsdom lays nothing out: the bounded frame's viewport and the header
        // are stood in for (the #812 tests' stand-ins).
        const realOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;
        const realClientHeight = Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight")!;
        const stubbed = (el: Element) => (el.getAttribute("data-virtual-rows") === "bounded" ? 400
            : el.hasAttribute("data-plan-header") ? 40 : 0);
        beforeEach(() => {
            Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get(this: HTMLElement) { return stubbed(this); } });
            Object.defineProperty(Element.prototype, "clientHeight", { configurable: true, get(this: Element) { return stubbed(this); } });
        });
        afterEach(() => {
            Object.defineProperty(HTMLElement.prototype, "offsetHeight", realOffsetHeight);
            Object.defineProperty(Element.prototype, "clientHeight", realClientHeight);
        });

        test("a mounted row says its place among ALL the rows — scrolled or not", () => {
            const rows = Array.from({ length: 200 }, (_u, i) => planRow(`r${String(i).padStart(3, "0")}`, span()));
            const { container } = renderPlan(planRoot(rows, { height: "400px" }), "plan-819-virtual");
            expect(gridOf(container).getAttribute("aria-rowcount")).toBe("200");
            const mounted = () => [...container.querySelectorAll("[data-plan-item]")] as HTMLElement[];
            /** Each mounted row's place — from its key — and the index it says. */
            const places = (): [number, number][] => mounted().map((r) =>
                [Number(r.getAttribute("data-plan-row")!.slice(1)) + 1, Number(r.getAttribute("aria-rowindex"))]);
            expect(mounted().length).toBeLessThan(200);
            for (const [want, got] of places()) expect(got).toBe(want);
            // Deep in: the rows mounted there number from where they are.
            const frame = container.querySelector('[data-virtual-rows="bounded"]') as HTMLElement;
            frame.scrollTop = 100 * 32;
            fireEvent.scroll(frame);
            expect(container.querySelector('[data-plan-row="r000"]')).toBeNull();
            expect(minOf(places().map(([w]) => w))).toBeGreaterThan(50);
            for (const [want, got] of places()) expect(got).toBe(want);
        });
    });
});

// ── Paged sources ─────────────────────────────────────────────────────────
/** A paged source whose windows past `openUpTo` stay in flight until opened
 *  and their channel fired (the #815 tests' held source). */
function heldSource(windows: number, rowsPer: number, openUpTo = 0) {
    const subs = new Map<string, Set<() => void>>();
    let recording: string[] | null = null;
    const tracker: ReactiveTracker = {
        id: "plan-819-channels",
        enableTracking() { recording = []; },
        disableTracking() { const r = recording ?? []; recording = null; return r; },
        getStore: () => ({
            subscribe(key, cb) {
                const set = subs.get(key) ?? new Set<() => void>();
                set.add(cb);
                subs.set(key, set);
                return () => { set.delete(cb); };
            },
            getKeyVersion: () => 0,
        }),
    };
    const state = { openUpTo };
    const source = {
        id: "plan-819-held",
        page: (offset: bigint) => {
            const w = Number(offset) / PLAN_PAGE_SIZE;
            recording?.push(`w${w}`);
            if (w > state.openUpTo) return none;
            return some(new Map(Array.from({ length: rowsPer }, (_u, i) => {
                const row = planRow(`w${w}r${String(i).padStart(2, "0")}`, span());
                return [row.key, row] as const;
            })));
        },
        total: () => some(BigInt(windows * PLAN_PAGE_SIZE)),
        seek: none,
        revision: () => none,
        refresh: () => null,
    };
    const fire = (key: string) => { for (const cb of [...(subs.get(key) ?? [])]) cb(); };
    cleanups.push(registerReactiveTracker(tracker));
    return { source, state, fire };
}

describe("paged canvases (#819)", () => {
    // Sixteen rows a window: window 0 fills the jsdom viewport, so the demand
    // rests on its ring [0, 2] — windows 1 and 2 in flight, 3 and 4 a band.
    test("an unloaded run is ONE row — the band — and the rows that land before it take their numbers", async () => {
        const held = heldSource(5, 16);
        const { container } = renderPlan(planRoot([], { source: held.source }), "plan-819-paged");
        await waitFor(() => expect(item(container, "r:w0r15")).toBeTruthy());
        const grid = gridOf(container);
        // Window 0's rows, then the band for elements 601–1,000.
        expect(grid.getAttribute("aria-rowcount")).toBe("17");
        expect(item(container, "b:tail").getAttribute("role")).toBe("row");
        expect(item(container, "b:tail").getAttribute("aria-rowindex")).toBe("17");
        act(() => {
            held.state.openUpTo = 2;
            held.fire("w1");
        });
        expect(grid.getAttribute("aria-rowcount")).toBe("49");
        expect(item(container, "r:w1r00").getAttribute("aria-rowindex")).toBe("17");
        expect(item(container, "b:tail").getAttribute("aria-rowindex")).toBe("49");
        expect(announced(container)).toBe("Loaded elements 201–600 of 1,000");
    });
});

// ── The keyboard ──────────────────────────────────────────────────────────
describe("one tab stop, and the keyboard map (#819)", () => {
    test("the grid is ONE tab stop: focusing it hands focus to a row, which then holds the stop", () => {
        const { container } = renderPlan(planRoot(EVERY_KIND()), "plan-819-tabstop");
        const grid = gridOf(container);
        // Nothing chosen yet: the grid itself is the stop, every row out of the order.
        expect(grid.getAttribute("tabindex")).toBe("0");
        expect(container.querySelectorAll('[data-plan-item][tabindex="0"]')).toHaveLength(0);
        act(() => grid.focus());
        expect(focusedItem()).toBe("r:pin");
        expect(grid.getAttribute("tabindex")).toBe("-1");
        expect(item(container, "r:pin").getAttribute("tabindex")).toBe("0");
        // One stop in the grid — every row control and element is out of the
        // order. The toolbar is not the grid: its controls keep stops of their
        // own, and a segment is ONE (#632 — the grain's, on its checked radio).
        const stops = (root: Element) => [...root.querySelectorAll("*")].filter((el) => (el as HTMLElement).tabIndex >= 0
            && el.matches("button, [tabindex]"));
        const toolbar = container.querySelector("[data-slot='toolbar']")!;
        expect(stops(container.querySelector("[data-plan-body]")!).filter((el) => !toolbar.contains(el)))
            .toEqual([item(container, "r:pin")]);
        expect(stops(toolbar)).toEqual([container.querySelector("[data-plan-seg='grain'] [aria-checked='true']")]);
    });

    test("every row is reachable by ↓ from the first, and ↑ walks back", () => {
        const { container } = renderPlan(planRoot(EVERY_KIND()), "plan-819-walk");
        act(() => gridOf(container).focus());
        const seen = [focusedItem()];
        for (let i = 0; i < 8; i++) {
            press("ArrowDown");
            seen.push(focusedItem());
        }
        expect(seen).toEqual(["r:pin", "r:G", "r:s", "r:b", "r:k", "r:h", "r:t", "r:c", "r:e"]);
        // The last row is the edge.
        press("ArrowDown");
        expect(focusedItem()).toBe("r:e");
        for (let i = 0; i < 8; i++) press("ArrowUp");
        expect(focusedItem()).toBe("r:pin");
        // Home and End, and the tab stop followed every move.
        press("End");
        expect(focusedItem()).toBe("r:e");
        expect(item(container, "r:e").getAttribute("tabindex")).toBe("0");
        expect(item(container, "r:pin").getAttribute("tabindex")).toBe("-1");
        press("Home");
        expect(focusedItem()).toBe("r:pin");
    });

    test("← and → close and open a section, and step between a parent and its first child", () => {
        const { container } = renderPlan(planRoot(EVERY_KIND()), "plan-819-sections");
        act(() => gridOf(container).focus());
        press("ArrowDown");
        expect(focusedItem()).toBe("r:G");
        press("ArrowLeft");
        expect(item(container, "r:G").getAttribute("aria-expanded")).toBe("false");
        expect(item(container, "r:s")).toBeNull();
        // Focus stayed on the band.
        expect(focusedItem()).toBe("r:G");
        press("ArrowRight");
        expect(item(container, "r:G").getAttribute("aria-expanded")).toBe("true");
        press("ArrowRight");
        expect(focusedItem()).toBe("r:s");
        press("ArrowLeft");
        expect(focusedItem()).toBe("r:G");
    });

    test("Enter selects the focused row and Space toggles its section — and the live region says so", () => {
        const { container } = renderPlan(planRoot(EVERY_KIND()), "plan-819-enter");
        act(() => gridOf(container).focus());
        press("ArrowDown");
        press("ArrowDown");
        press("Enter");
        expect(item(container, "r:s").getAttribute("aria-selected")).toBe("true");
        expect(announced(container)).toBe("Selected s");
        press("ArrowUp");
        press(" ");
        expect(item(container, "r:G").getAttribute("aria-expanded")).toBe("false");
        expect(announced(container)).toBe("Line 1 collapsed");
        // The ladder still works from a row: Esc deselects.
        press("Escape");
        expect(item(container, "r:s")).toBeNull();
        expect(announced(container)).toBe("Selection cleared");
    });

    test("Tab walks into a row's widgets; ← → step its elements in time order; Esc returns to the row", () => {
        const links = [{ fromRow: "m", fromRun: "b", toRow: "n", toRun: "x", quantity: 1, label: "1 t" }];
        const { container } = renderPlan(planRoot([
            // Data order is not time order: the August run comes first.
            planRow("m", span(
                [run("b", day("2026-08-03"), day("2026-08-17")), run("a", day("2026-07-06"), day("2026-07-13"))],
                [{ key: "d", at: t(day("2026-07-20")), applied: false }],
            )),
            planRow("n", span([run("x", W27, day("2026-07-06"))])),
        ], { links }), "plan-819-widgets");
        act(() => gridOf(container).focus());
        const row = item(container, "r:m");
        expect(document.activeElement).toBe(row);
        // Reading order: the gutter's control, then the elements by time.
        press("Tab");
        expect(document.activeElement).toBe(row.querySelector("[data-plan-control='links']"));
        press("Tab");
        expect(document.activeElement).toBe(row.querySelector("[data-run='a']"));
        press("ArrowRight");
        expect(document.activeElement).toBe(row.querySelector("[data-mark='d']"));
        press("ArrowRight");
        expect(document.activeElement).toBe(row.querySelector("[data-run='b']"));
        press("ArrowRight");
        expect(document.activeElement).toBe(row.querySelector("[data-run='b']"));
        press("Home");
        expect(document.activeElement).toBe(row.querySelector("[data-run='a']"));
        press("End");
        expect(document.activeElement).toBe(row.querySelector("[data-run='b']"));
        // Shift+Tab walks back; from the first widget, to the row.
        press("Tab", { shiftKey: true });
        expect(document.activeElement).toBe(row.querySelector("[data-mark='d']"));
        press("Escape");
        expect(document.activeElement).toBe(row);
        // ↑ / ↓ from inside a row leave for the next row.
        press("Tab");
        press("Tab");
        press("ArrowDown");
        expect(focusedItem()).toBe("r:n");
    });

    test("Enter on an element opens its popover and does what its click does; Esc closes it, then returns to the row", async () => {
        const armed = watchPopoverArming();
        const clicks: unknown[] = [];
        const popover = () => some(variant("Text", { value: "RUN DETAIL", style: none }));
        const { container } = renderPlan(planRoot([planRow("m", span([run("b214", W27, day("2026-07-27"))]))],
            { popover, onRunClick: (e: unknown) => { clicks.push(e); } }), "plan-819-activate");
        act(() => gridOf(container).focus());
        const row = item(container, "r:m");
        press("Tab");
        const bar = row.querySelector("[data-run='b214']") as HTMLElement;
        expect(document.activeElement).toBe(bar);
        press("Enter");
        expect(screen.getByText("RUN DETAIL")).toBeTruthy();
        expect(row.getAttribute("aria-selected")).toBe("true");
        await waitFor(() => expect(clicks).toEqual([{ row: "m", run: "b214" }]));
        // The popover's Esc first — met, as a user's always is, by its armed
        // layer: the surface closes and focus is back on the bar… (An Esc
        // inside the first frame, before the layer listens, is the canvas's
        // rung — `plan-overlays.dom.test.tsx` covers that path.)
        await armed();
        await userEvent.setup().keyboard("{Escape}");
        await waitFor(() => expect(screen.queryByText("RUN DETAIL")).toBeNull());
        expect(document.activeElement).toBe(bar);
        // …then the element's: back to the row, the selection standing.
        press("Escape");
        expect(document.activeElement).toBe(row);
        expect(row.getAttribute("aria-selected")).toBe("true");
    });

    test("↓ past the loaded rows asks the source for more, and focus goes on to the first row that lands — announced", async () => {
        // A hundred windows: the band's run is long, and the demand for its
        // first windows leaves the rest of it a band.
        const held = heldSource(100, 16, 2);
        const { container } = renderPlan(planRoot([], { source: held.source }), "plan-819-band");
        await waitFor(() => expect(item(container, "r:w2r15")).toBeTruthy());
        act(() => gridOf(container).focus());
        for (let i = 0; i < 47; i++) press("ArrowDown");
        expect(focusedItem()).toBe("r:w2r15");
        // Onto the band: it holds focus while the windows beside it are asked for.
        press("ArrowDown");
        expect(focusedItem()).toBe("b:tail");
        act(() => {
            held.state.openUpTo = 5;
            held.fire("w3");
        });
        // The rows landed where the band's top was — focus moved on to the first.
        await waitFor(() => expect(focusedItem()).toBe("r:w3r00"));
        expect(item(container, "r:w3r00").getAttribute("aria-rowindex")).toBe("49");
        expect(announced(container)).toMatch(/^Loaded elements 601–/);
    });

    test("when the demand takes the band away — its windows now in flight — focus waits on the last row, then moves on", async () => {
        const held = heldSource(5, 16);
        const { container } = renderPlan(planRoot([], { source: held.source }), "plan-819-inflight");
        await waitFor(() => expect(item(container, "r:w0r15")).toBeTruthy());
        act(() => gridOf(container).focus());
        for (let i = 0; i < 15; i++) press("ArrowDown");
        expect(focusedItem()).toBe("r:w0r15");
        // Asking for window 3 wants the source's rest: every window is in flight, no band stands.
        press("ArrowDown");
        expect(item(container, "b:tail")).toBeNull();
        expect(focusedItem()).toBe("r:w0r15");
        act(() => {
            held.state.openUpTo = 2;
            held.fire("w1");
        });
        await waitFor(() => expect(focusedItem()).toBe("r:w1r00"));
        expect(item(container, "r:w1r00").getAttribute("aria-rowindex")).toBe("17");
    });

    test("End reaches the source's last row and Home its first — across the unloaded run", async () => {
        const held = heldSource(5, 16, 4);
        const { container } = renderPlan(planRoot([], { source: held.source }), "plan-819-edges");
        await waitFor(() => expect(item(container, "r:w0r00")).toBeTruthy());
        expect(item(container, "b:tail")).toBeTruthy();
        act(() => gridOf(container).focus());
        press("End");
        await waitFor(() => expect(focusedItem()).toBe("r:w4r15"));
        const grid = gridOf(container);
        expect(item(container, "r:w4r15").getAttribute("aria-rowindex")).toBe(grid.getAttribute("aria-rowcount"));
        press("Home");
        await waitFor(() => expect(focusedItem()).toBe("r:w0r00"));
        expect(item(container, "r:w0r00").getAttribute("aria-rowindex")).toBe("1");
    });
});

// ── The live region ───────────────────────────────────────────────────────
describe("the live region (#819)", () => {
    test("a click's selection and a band's collapse are announced as well as a key's", () => {
        const { container } = renderPlan(planRoot([
            planRow("A", group(), { label: "Line A" }),
            planRow("m", span(), { parent: "A", label: "Mill 3" }),
        ]), "plan-819-live");
        const region = container.querySelector("[data-plan-announce]")!;
        expect(region.getAttribute("role")).toBe("status");
        expect(region.getAttribute("aria-live")).toBe("polite");
        fireEvent.click(item(container, "r:m"));
        expect(announced(container)).toBe("Selected Mill 3");
        fireEvent.click(item(container, "r:A"));
        expect(announced(container)).toBe("Line A collapsed");
    });
});

// ── Colour-only cells ─────────────────────────────────────────────────────
describe("every colour-only cell says its value (#819)", () => {
    test("heat, weight and segment cells of a data row are buttons named by their value", () => {
        const { container } = renderPlan(planRoot([
            planRow("h", variant("heat", { cells: heatCells([[W27, 80], [day("2026-07-06"), 40], [day("2026-07-13"), undefined]], 75), aggregate: none })),
            planRow("w", variant("heat", { cells: variant("weight", [{ at: t(W27), fraction: 0.6, planned: true }]), aggregate: none })),
            planRow("g", variant("heat", {
                cells: variant("segments", [{
                    at: t(W27),
                    segments: [
                        { fill: variant("brand", null), weight: 3, label: none },
                        { fill: variant("slack", null), weight: 1, label: none },
                    ],
                }]),
                aggregate: none,
            })),
        ]), "plan-819-cells");
        const names = (key: string) => [...container.querySelectorAll(`[data-plan-item="r:${key}"] [data-cell]`)]
            .map((c) => c.getAttribute("aria-label"));
        expect(names("h")).toEqual([
            "Week of Jun 29, 2026: 80, at or above the warning threshold",
            "Week of Jul 6, 2026: 40",
            "Week of Jul 13, 2026: no data",
        ]);
        expect(names("w")).toEqual(["Week of Jun 29, 2026: 60% booked, planned"]);
        expect(names("g")).toEqual(["Week of Jun 29, 2026: booked 75%, slack 25%"]);
    });

    test("a group's summary strip says each bucket's value as text", () => {
        const { container } = renderPlan(planRoot([
            planRow("L", group(true, heatCells([[W27, 80], [day("2026-07-06"), undefined]])), { label: "Line 1" }),
            planRow("m", span(), { parent: "L" }),
        ]), "plan-819-strip");
        const cells = [...container.querySelectorAll('[data-plan-group="L"] [data-plan-bucket]')];
        // What a reader hears: everything but the printed label, which is the
        // words' echo (the no-data dash) and hidden from them.
        const heard = (c: Element) => [...c.children].filter((x) => x.getAttribute("aria-hidden") !== "true")
            .map((x) => x.textContent).join("");
        expect(cells.map(heard)).toEqual(["Week of Jun 29, 2026: 80", "Week of Jul 6, 2026: no data"]);
        expect(cells[1]!.querySelector("[aria-hidden='true']")!.textContent).toBe("–");
    });

    test("a chart or table row compressed to a tone strip says each block's value", () => {
        const { container } = renderPlan(planRoot([
            planRow("focal", span(), { expand: true }),
            planRow("k", chart([[W27, 94], [day("2026-07-06"), 101]], false)),
        ], { expandRender: true }), "plan-819-tones");
        fireEvent.click(container.querySelector('[data-plan-item="r:focal"] [data-plan-control="expand"]')!);
        const strip = item(container, "r:k");
        expect(strip.hasAttribute("data-ctx")).toBe(true);
        expect([...strip.querySelectorAll("[role='gridcell'] > *")].map((c) => c.textContent).filter((s) => s !== ""))
            .toEqual(["Week of Jun 29, 2026: 94", "Week of Jul 6, 2026: 101"]);
    });
});
