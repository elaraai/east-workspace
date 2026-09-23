/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * UI state survives a remount (#813) — under the canvas's `storageKey`, the
 * user's collapse toggles, expanded charts and scroll anchor persist, and a
 * remount restores them; a bound slice keeps the resolution. jsdom lays
 * nothing out and cannot scroll, so the bounded frame's geometry is stubbed
 * and its `scrollTo` moves `scrollTop` the way a browser does.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act, waitFor, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { none, some, variant } from "@elaraai/east";
import { system } from "../../theme/index.js";
import { buildSliceHandle } from "../../platform/slice/index.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { EastChakraPlan, type PlanRootValue, type PlanRowValue } from "./index.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

// ── Layout stand-ins: a 400px bounded frame over a tall scroll extent ─────
const VIEWPORT = 400;
const frameHeight = (el: Element): number | undefined =>
    el.getAttribute("data-virtual-rows") === "bounded" ? VIEWPORT : undefined;
const saved = {
    offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!,
    clientHeight: Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight")!,
    scrollHeight: Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight")!,
    scrollTo: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo"),
};

beforeEach(() => {
    initializeStore(new UIStore());
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true, get(this: HTMLElement) { return frameHeight(this) ?? 0; },
    });
    Object.defineProperty(Element.prototype, "clientHeight", {
        configurable: true, get(this: Element) { return frameHeight(this) ?? 0; },
    });
    Object.defineProperty(Element.prototype, "scrollHeight", {
        configurable: true, get(this: Element) { return frameHeight(this) !== undefined ? 1_000_000 : 0; },
    });
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
        configurable: true,
        writable: true,
        value(this: HTMLElement, arg: ScrollToOptions | number) {
            this.scrollTop = typeof arg === "number" ? arg : (arg.top ?? this.scrollTop);
            this.dispatchEvent(new Event("scroll"));
        },
    });
});
afterEach(() => {
    cleanup();
    localStorage.clear();
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", saved.offsetHeight);
    Object.defineProperty(Element.prototype, "clientHeight", saved.clientHeight);
    Object.defineProperty(Element.prototype, "scrollHeight", saved.scrollHeight);
    if (saved.scrollTo !== undefined) Object.defineProperty(HTMLElement.prototype, "scrollTo", saved.scrollTo);
    else delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
});

// ── Fixtures ──────────────────────────────────────────────────────────────
const W27 = new Date("2026-06-29T00:00:00Z");
const W39 = new Date("2026-09-21T00:00:00Z");

function planRow(key: string, kind: unknown, parent?: string): PlanRowValue {
    return {
        key,
        parent: parent !== undefined ? some(parent) : none,
        gutter: { label: key, id: none, sub: none, value: none, meta: none, stacked: none, swatches: [] },
        kind,
        pinned: none, height: none, status: none, approval: none, expand: none,
    } as unknown as PlanRowValue;
}
const span = () => variant("span", { runs: [], decisions: [], ports: [], rollup: none, unit: none });
const group = (collapsed: boolean) => variant("group", {
    summary: none, summaryAggregate: none, collapsed: collapsed ? some(true) : none,
});
const chart = () => variant("chart", {
    layers: [], left: none, right: none,
    height: variant("spark", null), expandedHeight: none, expandable: some(true),
});
const pad = (i: number, width: number) => String(i).padStart(width, "0");

/** A (declared collapsed) and B, three members each; an expandable chart;
 *  sixty plain rows. */
const rows = () => [
    planRow("A", group(true)),
    ...[1, 2, 3].map((i) => planRow(`a${i}`, span(), "A")),
    planRow("B", group(false)),
    ...[1, 2, 3].map((i) => planRow(`b${i}`, span(), "B")),
    planRow("chart", chart()),
    ...Array.from({ length: 60 }, (_u, i) => planRow(`r${pad(i, 2)}`, span())),
];

function planRoot(body: PlanRowValue[], opts?: { source?: unknown; slice?: unknown; resolutions?: unknown[] }): PlanRootValue {
    return {
        rows: opts?.source !== undefined
            ? variant("paged", opts.source)
            : variant("inline", new Map(body.map((r) => [r.key, r]))),
        links: [],
        axis: variant("time", {
            window: some({ min: W27, max: W39 }), resolution: variant("week", null),
            resolutions: opts?.resolutions ?? [], now: none, format: none,
        }),
        grain: none, popover: none, hover: none, expandRender: none, review: none, pick: none,
        slice: opts?.slice ?? none, footer: [],
        id: "", sources: [], onDrag: none, canDrop: none,
        onSelect: none, onRunClick: none, onEventClick: none, onMarkClick: none, onChipClick: none, onCellClick: none,
        onGroupToggle: none, onGrainChange: none,
        style: some({ height: some(`${VIEWPORT}px`), maxHeight: none, density: none, gutterWidth: none }),
    } as unknown as PlanRootValue;
}

const renderPlan = (value: PlanRootValue, key: string) => render(
    <ChakraProvider value={system}>
        <EastChakraPlan value={value} storageKey={key} />
    </ChakraProvider>,
);
const frameOf = (c: HTMLElement) => c.querySelector('[data-virtual-rows="bounded"]') as HTMLElement;
const extentOf = (c: HTMLElement) =>
    Number(c.querySelector("[data-virtual-extent]")!.getAttribute("data-virtual-extent"));
/** Scroll the frame and let the scroll SETTLE — TanStack clears its scrolling
 *  flag after 150ms without a scroll event, and only then is a rest reported. */
async function scrollAndSettle(c: HTMLElement, top: number): Promise<void> {
    const frame = frameOf(c);
    frame.scrollTop = top;
    fireEvent.scroll(frame);
    await act(async () => { await new Promise((r) => setTimeout(r, 250)); });
}
const storedAt = (key: string) => JSON.parse(localStorage.getItem(key) ?? "null") as {
    collapse: [string, boolean][]; charts: string[]; anchor: { key: string; offset: number; index: number } | null;
};

/** A slice bound for the resolution segment (WEEK / DAY). */
function resolutionSlice(key: string) {
    const cfg = {
        fields: new Map<string, unknown>([
            ["at", variant("datetime", { label: "At", accessor: (r: { at: Date }) => r.at, format: none })],
        ]),
        rangeFieldId: some("at"), searchFieldIds: [], breakdownFieldIds: [],
    };
    const initial = {
        range: some(variant("datetime", { from: W27, to: W39 })),
        compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
        breakdown: none, search: none, visible: none, selectedIndex: none,
        resolution: some(variant("week", null)),
    };
    return buildSliceHandle(key, cfg as never, initial as never, [{ at: W27 }] as never, none);
}

describe("Plan UI state survives a remount (#813)", () => {
    test("collapse, expanded charts, resolution and the scroll anchor come back with the same storageKey", async () => {
        const slice = resolutionSlice("plan-813-slice");
        const value = () => planRoot(rows(), {
            slice: some({ slice, affordances: [variant("resolution", null)] }),
            resolutions: [variant("week", null), variant("day", null)],
        });
        const first = renderPlan(value(), "plan-813");
        // A was declared collapsed: open it. Collapse B. Expand the chart.
        fireEvent.click(first.container.querySelector('[data-plan-group="A"]')!);
        fireEvent.click(first.container.querySelector('[data-plan-group="B"]')!);
        fireEvent.click(first.container.querySelector('[data-plan-row="chart"]')!.children[0]!);
        fireEvent.click(screen.getByText("DAY"));
        // Rest the scroll 10px into r30: A 26 + a1–a3 96 + B 26 + chart 88
        // + thirty rows of 32 = 1,196px.
        await scrollAndSettle(first.container, 1_196 + 10);
        expect(storedAt("plan-813").anchor).toMatchObject({ key: "r:r30", offset: 10 });
        // Selection is never persisted.
        fireEvent.click(first.container.querySelector('[data-plan-row="r31"]')!);
        expect(first.container.querySelector('[data-plan-row="r31"]')!.hasAttribute("data-selected")).toBe(true);
        first.unmount();

        const second = renderPlan(value(), "plan-813");
        const c = second.container;
        // The scroll is back 10px into r30 — and nothing is selected there.
        await waitFor(() => expect(frameOf(c).scrollTop).toBe(1_196 + 10));
        expect(c.querySelector('[data-plan-row="r30"]')).toBeTruthy();
        expect(c.querySelector('[data-plan-row="r31"]')!.hasAttribute("data-selected")).toBe(false);
        // The body is the one the user left: A open (its three members), B
        // collapsed, the chart expanded to 88px.
        expect(extentOf(c)).toBe(26 + 3 * 32 + 26 + 88 + 60 * 32);
        // The resolution is the slice's, and the slice kept it.
        expect(c.querySelector('[data-slot="rulerTick"]')!.textContent).toBe("MON");
        // Back at the top, the groups read as the user left them.
        await scrollAndSettle(c, 0);
        expect(c.querySelector('[data-plan-row="a1"]')).toBeTruthy();
        expect(c.querySelector('[data-plan-row="b1"]')).toBeNull();
    });

    test("a persisted key that no longer exists is ignored; an anchor whose row is gone lands on its clamped index", async () => {
        localStorage.setItem("plan-813-stale", JSON.stringify({
            collapse: [["gone", true], ["B", true]],
            charts: ["gone-chart"],
            anchor: { key: "r:vanished", offset: 12, index: 40, window: null },
        }));
        const { container } = renderPlan(planRoot(rows()), "plan-813-stale");
        // B's toggle applies; A, never touched, takes its declaration.
        expect(container.querySelector('[data-plan-row="b1"]')).toBeNull();
        expect(container.querySelector('[data-plan-row="a1"]')).toBeNull();
        // The anchor's row is gone: index 40 is r37 (A, B and the chart first),
        // at 26 + 26 + 32 + 37 × 32 = 1,268px — offset dropped with the row.
        await waitFor(() => expect(frameOf(container).scrollTop).toBe(1_268));
        // What no longer exists stops being carried.
        await waitFor(() => expect(storedAt("plan-813-stale").collapse).toEqual([["B", true]]));
        expect(storedAt("plan-813-stale").charts).toEqual([]);
    });

    test("storage in a shape this version did not write is ignored, never trusted", () => {
        localStorage.setItem("plan-813-bad", JSON.stringify({
            collapse: "B", charts: [1, 2], anchor: { key: 5 },
        }));
        const { container } = renderPlan(planRoot(rows()), "plan-813-bad");
        expect(container.querySelector('[data-plan-row="b1"]')).toBeTruthy();
        expect(container.querySelector('[data-plan-row="a1"]')).toBeNull();
        expect(frameOf(container).scrollTop).toBe(0);
    });

    test("two canvases with different storageKeys share nothing", () => {
        const one = renderPlan(planRoot(rows()), "plan-813-one");
        fireEvent.click(one.container.querySelector('[data-plan-group="B"]')!);
        expect(one.container.querySelector('[data-plan-row="b1"]')).toBeNull();
        one.unmount();

        const two = renderPlan(planRoot(rows()), "plan-813-two");
        expect(two.container.querySelector('[data-plan-row="b1"]')).toBeTruthy();
        two.unmount();

        const again = renderPlan(planRoot(rows()), "plan-813-one");
        expect(again.container.querySelector('[data-plan-row="b1"]')).toBeNull();
    });

    test("a paged canvas looks for the anchor's row in its window — a jump, not a walk", async () => {
        const asked: number[] = [];
        const source = {
            id: "dom-813-paged",
            page: (offset: bigint) => {
                const from = Number(offset);
                asked.push(from / 200);
                return some(new Map(Array.from({ length: Math.max(0, Math.min(200, 2_000 - from)) }, (_u, i) => {
                    const row = planRow(`u${pad(from + i, 4)}`, span());
                    return [row.key, row] as const;
                })));
            },
            total: () => some(2_000n),
            seek: none,
        };
        // The last session rested on u1300, which came from window 6 — and
        // left toggles on rows the opening ring does not hold.
        localStorage.setItem("plan-813-paged", JSON.stringify({
            collapse: [["u1900", true]], charts: ["u1999"],
            anchor: { key: "r:u1300", offset: 0, index: 500, window: 6 },
        }));
        const { container } = renderPlan(planRoot([], { source }), "plan-813-paged");
        // The opening ring does not hold it, so the canvas jumps to its window
        // and scrolls to the row once it lands.
        await waitFor(() => expect(container.querySelector('[data-plan-row="u1300"]')).toBeTruthy(), { timeout: 5_000 });
        expect(frameOf(container).scrollTop).toBeGreaterThan(0);
        // Windows 3 and 4 lie between the opening ring and the anchor's
        // ring — never asked.
        expect(asked).not.toContain(3);
        expect(asked).not.toContain(4);
        // A paged source's resident rows are not all its rows: the toggles on
        // rows that have not landed are kept for when they do.
        expect(storedAt("plan-813-paged").collapse).toEqual([["u1900", true]]);
        expect(storedAt("plan-813-paged").charts).toEqual(["u1999"]);
    });
});
