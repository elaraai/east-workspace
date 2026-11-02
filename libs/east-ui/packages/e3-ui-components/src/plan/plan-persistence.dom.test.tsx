/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * UI state survives a remount (#813) — under the canvas's `storageKey`, the
 * user's collapse toggles, expanded charts and scroll anchor persist, and a
 * remount restores them; the slice's source — the Plan's dated rows on e3
 * itself (`rail.test-utils.ts`, #1376) — keeps the resolution (#1344). While no
 * source of the slice holds the window, the canvas's own window persists too,
 * with the zoom it was shown at (#1438), and a remount draws it from its first
 * frame, at that zoom where the slice kept none. jsdom lays nothing out and
 * cannot scroll, so the bounded frame's geometry is stubbed and its `scrollTo`
 * moves `scrollTop` the way a browser does.
 */

import { useLayoutEffect } from "react";
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent, waitFor, screen, within } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { none, some, variant } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { system } from "@elaraai/east-ui-components";
import { Data } from "@elaraai/e3-ui/internal";
import * as records from "@elaraai/e3-ui/examples/plan/plan-records";
import { act, e3Harness } from "../e3-web-mount.test-utils.js";
import { EastChakraPlan, type PlanRootValue } from "./index.js";
import type { PlanWireRow } from "./model.js";
import { blocksSource, oneBlock, rowId, rowItem, rowKey, rowSel } from "./plan.test-utils.js";
import { RAIL_MODULES, bindRail, type RailChrome } from "./rail.test-utils.js";
import { keptName } from "@elaraai/east-ui-components/internal";

e3Harness(RAIL_MODULES, { measure: false });

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
// The harness unmounts what a test rendered and clears the viewer's storage after it.
afterEach(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", saved.offsetHeight);
    Object.defineProperty(Element.prototype, "clientHeight", saved.clientHeight);
    Object.defineProperty(Element.prototype, "scrollHeight", saved.scrollHeight);
    if (saved.scrollTo !== undefined) Object.defineProperty(HTMLElement.prototype, "scrollTo", saved.scrollTo);
    else delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
});

// ── Fixtures ──────────────────────────────────────────────────────────────
const W27 = new Date("2026-06-29T00:00:00Z");
const W28 = new Date("2026-07-06T00:00:00Z");
const W29 = new Date("2026-07-13T00:00:00Z");
const W39 = new Date("2026-09-21T00:00:00Z");
const W40 = new Date("2026-09-28T00:00:00Z");
const W41 = new Date("2026-10-05T00:00:00Z");

/** One WIRE row, as the source serves it — named by its test key (#822). */
function planRow(key: string, kind: unknown, parent?: string, collapsed?: boolean): PlanWireRow {
    return {
        id: rowId(key),
        parent: parent !== undefined ? some(rowId(parent)) : none,
        gutter: { label: key, id: false, sub: none, value: none, meta: none, stacked: false, swatches: [] },
        kind,
        collapsed: collapsed === true,
        pinned: false, height: none, status: none, expand: none,
    } as unknown as PlanWireRow;
}
const span = () => variant("span", { runs: [], decisions: [], ports: [], rollup: none });
const group = (): PlanWireRow["kind"] => variant("group", { summary: variant("none", null) });
const chart = () => variant("chart", {
    layers: [], left: none, right: none,
    height: variant("spark", null), expandedHeight: none, expandable: true,
});
const pad = (i: number, width: number) => String(i).padStart(width, "0");

/** A (declared collapsed) and B, three members each; an expandable chart;
 *  sixty plain rows. */
const rows = () => [
    planRow("A", group(), undefined, true),
    ...[1, 2, 3].map((i) => planRow(`a${i}`, span(), "A")),
    planRow("B", group()),
    ...[1, 2, 3].map((i) => planRow(`b${i}`, span(), "B")),
    planRow("chart", chart()),
    ...Array.from({ length: 60 }, (_u, i) => planRow(`r${pad(i, 2)}`, span())),
];

function planRoot(body: PlanWireRow[], opts?: { source?: unknown; slice?: unknown; resolutions?: unknown[] }): PlanRootValue {
    return {
        rows: opts?.source !== undefined ? variant("paged", blocksSource(opts.source)) : variant("inline", oneBlock(body)),
        links: [],
        axis: variant("time", {
            window: some({ min: W27, max: W39 }), resolution: variant("week", null),
            resolutions: opts?.resolutions ?? [], now: none, format: none,
        }),
        grain: none, popover: none, hover: none, expandRender: none, pick: none,
        slice: opts?.slice ?? none, nested: none, footer: [],
        id: none, sources: [], editing: none, canDrop: none,
        onSelect: none, onElementClick: none,
        onGroupToggle: none, onGrainChange: none, ui: none,
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
const storedAt = (key: string) => JSON.parse(localStorage.getItem(keptName(key)) ?? "null") as {
    collapse: [string, boolean][]; charts: string[]; anchor: { key: string; offset: number; index: number } | null;
    window?: { kind: string; min: number; max: number; resolution?: string };
};
/** The ruler's first tick: the first bucket of the window the canvas draws. */
const firstTick = (c: HTMLElement) => c.querySelector('[data-slot="rulerTick"]')?.textContent;
/** The toolbar's date navigator. */
const navigatorOf = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-toolbar-item='time-navigation']")!;

/** What the ruler's first tick read in the canvas's first frame: its first commit, before any effect of the canvas's ran. */
function FirstFrame({ drawn }: { drawn: (string | undefined)[] }) {
    useLayoutEffect(() => {
        drawn.push(document.querySelector('[data-slot="rulerTick"]')?.textContent ?? undefined);
    }, [drawn]);
    return null;
}

/** A slice none of whose sources holds the window: the dated rows narrowed by their date, a field of the rail. */
async function ownWindowSlice(key: string): Promise<RailChrome> {
    const rail = await bindRail(() => Slice.bindRecords(key, {
        dated: { source: Data.bindPaged(records.planDatedRows, { indexes: ["plan_dated_rows_by_at"] }), fields: { at: { label: "At" } } },
    }), ["fields"]);
    return rail.chrome;
}

/** A slice for the resolution segment (WEEK / DAY): a source of it — the dated rows — holding the window W27..W39. */
async function resolutionSlice(key: string): Promise<RailChrome> {
    const rail = await bindRail(() => Slice.bindRecords(key, {
        dated: {
            source: Data.bindPaged(records.planDatedRows, { indexes: ["plan_dated_rows_by_at"] }),
            fields: { at: { label: "At" } }, range: "at", initial: { at: { from: W27, to: W39 } },
        },
    }), ["resolution"]);
    return rail.chrome;
}

describe("Plan UI state survives a remount (#813)", () => {
    test("collapse, expanded charts, resolution and the scroll anchor come back with the same storageKey", async () => {
        const slice = await resolutionSlice("plan-813-slice");
        const value = () => planRoot(rows(), {
            slice: some(slice),
            resolutions: [variant("week", null), variant("day", null)],
        });
        const first = renderPlan(value(), "plan-813");
        // A was declared collapsed: open it. Collapse B. Expand the chart.
        fireEvent.click(first.container.querySelector(rowSel("A", "data-plan-group"))!);
        fireEvent.click(first.container.querySelector(rowSel("B", "data-plan-group"))!);
        fireEvent.click(first.container.querySelector(rowSel("chart"))!.children[0]!);
        fireEvent.click(screen.getByText("DAY"));
        // Rest the scroll 10px into r30: A 26 + a1–a3 96 + B 26 + chart 88
        // + thirty rows of 32 = 1,196px.
        await scrollAndSettle(first.container, 1_196 + 10);
        expect(storedAt("plan-813").anchor).toMatchObject({ key: rowItem("r30"), offset: 10 });
        // Selection is never persisted.
        fireEvent.click(first.container.querySelector(rowSel("r31"))!);
        expect(first.container.querySelector(rowSel("r31"))!.hasAttribute("data-selected")).toBe(true);
        first.unmount();

        const second = renderPlan(value(), "plan-813");
        const c = second.container;
        // The scroll is back 10px into r30 — and nothing is selected there.
        await waitFor(() => expect(frameOf(c).scrollTop).toBe(1_196 + 10));
        expect(c.querySelector(rowSel("r30"))).toBeTruthy();
        expect(c.querySelector(rowSel("r31"))!.hasAttribute("data-selected")).toBe(false);
        // The body is the one the user left: A open (its three members), B
        // collapsed, the chart expanded to 88px.
        expect(extentOf(c)).toBe(26 + 3 * 32 + 26 + 88 + 60 * 32);
        // The resolution is the slice's, and the slice kept it.
        expect(c.querySelector('[data-slot="rulerTick"]')!.textContent).toBe("MON");
        // Back at the top, the groups read as the user left them.
        await scrollAndSettle(c, 0);
        expect(c.querySelector(rowSel("a1"))).toBeTruthy();
        expect(c.querySelector(rowSel("b1"))).toBeNull();
    });

    test("a persisted key that no longer exists is ignored; an anchor whose row is gone lands on its clamped index", async () => {
        localStorage.setItem(keptName("plan-813-stale"), JSON.stringify({
            collapse: [["gone", true], [rowKey("B"), true]],
            charts: ["gone-chart"],
            anchor: { key: "r:vanished", offset: 12, index: 40, window: null },
        }));
        const { container } = renderPlan(planRoot(rows()), "plan-813-stale");
        // B's toggle applies; A, never touched, takes its declaration.
        expect(container.querySelector(rowSel("b1"))).toBeNull();
        expect(container.querySelector(rowSel("a1"))).toBeNull();
        // The anchor's row is gone: index 40 is r37 (A, B and the chart first),
        // at 26 + 26 + 32 + 37 × 32 = 1,268px — offset dropped with the row.
        await waitFor(() => expect(frameOf(container).scrollTop).toBe(1_268));
        // What no longer exists stops being carried.
        await waitFor(() => expect(storedAt("plan-813-stale").collapse).toEqual([[rowKey("B"), true]]));
        expect(storedAt("plan-813-stale").charts).toEqual([]);
    });

    test("storage in a shape this version did not write is ignored, never trusted", () => {
        localStorage.setItem(keptName("plan-813-bad"), JSON.stringify({
            collapse: "B", charts: [1, 2], anchor: { key: 5 },
        }));
        const { container } = renderPlan(planRoot(rows()), "plan-813-bad");
        expect(container.querySelector(rowSel("b1"))).toBeTruthy();
        expect(container.querySelector(rowSel("a1"))).toBeNull();
        expect(frameOf(container).scrollTop).toBe(0);
    });

    test("two canvases with different storageKeys share nothing", () => {
        const one = renderPlan(planRoot(rows()), "plan-813-one");
        fireEvent.click(one.container.querySelector(rowSel("B", "data-plan-group"))!);
        expect(one.container.querySelector(rowSel("b1"))).toBeNull();
        one.unmount();

        const two = renderPlan(planRoot(rows()), "plan-813-two");
        expect(two.container.querySelector(rowSel("b1"))).toBeTruthy();
        two.unmount();

        const again = renderPlan(planRoot(rows()), "plan-813-one");
        expect(again.container.querySelector(rowSel("b1"))).toBeNull();
    });

    test("a paged canvas looks for the anchor's row in its window — a jump, not a walk", async () => {
        const asked: number[] = [];
        const source = {
            id: "dom-813-paged",
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
        // The last session rested on u1300, which came from window 6 — and
        // left toggles on rows the opening ring does not hold.
        localStorage.setItem(keptName("plan-813-paged"), JSON.stringify({
            collapse: [[rowKey("u1900"), true]], charts: [rowKey("u1999")],
            anchor: { key: rowItem("u1300"), offset: 0, index: 500, window: 6 },
        }));
        const { container } = renderPlan(planRoot([], { source }), "plan-813-paged");
        // The opening ring does not hold it, so the canvas jumps to its window
        // and scrolls to the row once it lands.
        await waitFor(() => expect(container.querySelector(rowSel("u1300"))).toBeTruthy(), { timeout: 5_000 });
        expect(frameOf(container).scrollTop).toBeGreaterThan(0);
        // Windows 3 and 4 lie between the opening ring and the anchor's
        // ring — never asked.
        expect(asked).not.toContain(3);
        expect(asked).not.toContain(4);
        // A paged source's resident rows are not all its rows: the toggles on
        // rows that have not landed are kept for when they do.
        expect(storedAt("plan-813-paged").collapse).toEqual([[rowKey("u1900"), true]]);
        expect(storedAt("plan-813-paged").charts).toEqual([rowKey("u1999")]);
    });

    test("a paged canvas whose source has shrunk past the anchor's window opens its last window and settles there — the row gone, its clamped index — and keeps the view's place again (#1398)", async () => {
        // A thousand rows now: five windows, the last u0800–u0999.
        const source = {
            id: "dom-1398-shrunk",
            page: (offset: bigint) => {
                const from = Number(offset);
                return some(Array.from({ length: Math.max(0, Math.min(200, 1_000 - from)) }, (_u, i) =>
                    planRow(`u${pad(from + i, 4)}`, span())));
            },
            total: () => some(1_000n),
            seek: none,
            revision: () => none,
            refresh: () => null,
        };
        // The last session rested on u1850, from window 9, while the source held two thousand rows.
        localStorage.setItem(keptName("plan-1398-shrunk"), JSON.stringify({
            collapse: [], charts: [],
            anchor: { key: rowItem("u1850"), offset: 0, index: 1_850, window: 9 },
        }));
        const { container } = renderPlan(planRoot([], { source }), "plan-1398-shrunk");
        // Window 9 is past the end: the canvas opens the last window, and the place settles on the clamped index —
        // the last row, at the top of the view.
        await waitFor(() => expect(frameOf(container).scrollTop).toBe(999 * 32), { timeout: 5_000 });
        expect(container.querySelector(rowSel("u0999"))).toBeTruthy();
        // Settled, the place the view rests at is kept again.
        await scrollAndSettle(container, 900 * 32);
        expect(storedAt("plan-1398-shrunk").anchor).toMatchObject({ key: rowItem("u0900"), offset: 0 });
    });

    describe("a view resting over rows not read is kept by the element under its top (#1398)", () => {
        /**
         * Two thousand rows of 32px, two hundred a window: those in `held` stay on their way, and those in `failing`
         * fail, until the test lets them go.
         */
        function unreadSource(id: string) {
            const held = new Set<number>();
            const failing = new Set<number>();
            const source = {
                id,
                page: (offset: bigint) => {
                    const from = Number(offset);
                    const w = from / 200;
                    if (failing.has(w)) throw new Error("gateway timeout");
                    if (held.has(w)) return none;
                    return some(Array.from({ length: Math.max(0, Math.min(200, 2_000 - from)) }, (_u, i) => planRow(`u${pad(from + i, 4)}`, span())));
                },
                total: () => some(2_000n),
                seek: none,
                revision: () => none,
                refresh: () => null,
            };
            return { source, held, failing };
        }
        /** The canvas, its rows read down to u1599, the view a row of them: the run past them stands for u1600 on. */
        async function readTo1600(source: unknown, key: string) {
            const first = renderPlan(planRoot([], { source }), key);
            await waitFor(() => expect(first.container.querySelector(rowSel("u0000"))).toBeTruthy());
            await scrollAndSettle(first.container, 1_000 * 32);
            await waitFor(() => expect(first.container.querySelector(rowSel("u1000"))).toBeTruthy());
            return first;
        }

        test("over a run: a remount opens the window of the element under the view's top and puts the view back on it — never as many px into the run on that side of the rows it opens on", async () => {
            const { source, held } = unreadSource("dom-1398-run");
            const first = await readTo1600(source, "plan-1398-run");
            // On to u1850, its windows on their way: the view rests over the run, two hundred and fifty rows into it.
            held.add(8);
            held.add(9);
            await scrollAndSettle(first.container, 1_850 * 32);
            expect(first.container.querySelector(rowSel("u1850"))).toBeNull();
            expect(storedAt("plan-1398-run").anchor?.key).toBe("b:0:tail");
            first.unmount();
            // Every window there to be had again: the remount opens at u1850's window, and the view is on u1850 — not
            // two hundred and fifty rows into the run that stands, as it opens, for u0600 on.
            held.clear();
            const second = renderPlan(planRoot([], { source }), "plan-1398-run");
            await waitFor(() => expect(second.container.querySelector(rowSel("u1850"))).toBeTruthy(), { timeout: 5_000 });
            await waitFor(() => expect(frameOf(second.container).scrollTop).toBe(1_850 * 32));
            expect(second.container.querySelector(rowSel("u0850"))).toBeNull();
        });

        test("over a run whose windows land as the view comes to rest there: the place is the run's as drawn, never the run the windows landing move on to", async () => {
            const { source } = unreadSource("dom-1398-landing");
            const first = await readTo1600(source, "plan-1398-landing");
            // On to u1850: the view rests over the run, and its rest reads the windows there, which land at once.
            await scrollAndSettle(first.container, 1_850 * 32);
            expect(storedAt("plan-1398-landing").anchor?.key).toBe("b:0:tail");
            await waitFor(() => expect(first.container.querySelector(rowSel("u1850"))).toBeTruthy());
            first.unmount();
            const second = renderPlan(planRoot([], { source }), "plan-1398-landing");
            await waitFor(() => expect(second.container.querySelector(rowSel("u1850"))).toBeTruthy(), { timeout: 5_000 });
            await waitFor(() => expect(frameOf(second.container).scrollTop).toBe(1_850 * 32));
        });

        test("over a window whose read failed: a remount reads that window and puts the view back the same px into its rows", async () => {
            const logged = vi.spyOn(console, "error").mockImplementation(() => {});
            try {
                const { source, failing } = unreadSource("dom-1398-failed");
                failing.add(9);
                const first = await readTo1600(source, "plan-1398-failed");
                // On to u1650: its window lands, and the one read ahead past it fails — its band where its rows would be.
                await scrollAndSettle(first.container, 1_650 * 32);
                // Down onto that band: the view rests over it, fifty rows into it.
                await scrollAndSettle(first.container, 1_850 * 32);
                await waitFor(() => expect(first.container.querySelector('[data-plan-failed="9"]')).toBeTruthy());
                expect(storedAt("plan-1398-failed").anchor?.key).toBe("f:0:9");
                first.unmount();
                // The window reads again: the view is on u1850.
                failing.clear();
                const second = renderPlan(planRoot([], { source }), "plan-1398-failed");
                await waitFor(() => expect(second.container.querySelector(rowSel("u1850"))).toBeTruthy(), { timeout: 5_000 });
                await waitFor(() => expect(frameOf(second.container).scrollTop).toBe(1_850 * 32));
            } finally {
                logged.mockRestore();
            }
        });
    });
});

describe("the canvas's own window survives a remount (#1344)", () => {
    test("moved by a pan and by the date navigator, it comes back with the same storageKey — drawn there from the first frame, never at the axis's window first", async () => {
        const slice = await ownWindowSlice("plan-own-slice");
        const value = () => planRoot(rows(), { slice: some(slice) });
        const first = renderPlan(value(), "plan-own");
        expect(firstTick(first.container)).toBe("W27");
        // A pan: a week on.
        fireEvent.keyDown(first.container.querySelector("[data-plan-body]")!, { key: "]" });
        expect(firstTick(first.container)).toBe("W28");
        await waitFor(() => expect(storedAt("plan-own").window).toEqual({ kind: "time", min: W28.getTime(), max: W40.getTime(), resolution: "week" }));
        // A step of the date navigator: a week on again.
        fireEvent.click(within(navigatorOf(first.container)).getByRole("button", { name: "Next week" }));
        expect(firstTick(first.container)).toBe("W29");
        await waitFor(() => expect(storedAt("plan-own").window).toEqual({ kind: "time", min: W29.getTime(), max: W41.getTime(), resolution: "week" }));
        first.unmount();

        const drawn: (string | undefined)[] = [];
        const second = render(
            <ChakraProvider value={system}>
                <FirstFrame drawn={drawn} />
                <EastChakraPlan value={value()} storageKey="plan-own" />
            </ChakraProvider>,
        );
        // Its first frame drew the window the viewer left — never the axis's W27 — and it stays there.
        expect(drawn).toEqual(["W29"]);
        expect(firstTick(second.container)).toBe("W29");
    });

    test("its zoom is kept with it (#1438): over a slice that kept none — a page's store gone with the page — a remount opens at the zoom it was shown at; a window kept with none, wider than the canvas draws a week at a time, is not taken back", async () => {
        const zooms = [variant("week", null), variant("month", null), variant("quarter", null), variant("year", null)];
        const value = (slice: RailChrome) => planRoot(rows(), { slice: some(slice), resolutions: zooms });
        const first = renderPlan(value(await ownWindowSlice("plan-own-zoom-first")), "plan-own-zoom");
        fireEvent.click(screen.getByText("YEAR"));
        await waitFor(() => expect(storedAt("plan-own-zoom").window?.resolution).toBe("year"));
        const kept = storedAt("plan-own-zoom").window;
        const year = firstTick(first.container);
        first.unmount();
        // A slice of its own, holding no zoom: what a page whose store did not outlive the last one binds.
        const second = renderPlan(value(await ownWindowSlice("plan-own-zoom-second")), "plan-own-zoom");
        expect(firstTick(second.container)).toBe(year);
        expect(storedAt("plan-own-zoom").window).toEqual(kept);
        second.unmount();
        // A decade kept with no zoom: 523 weeks, more than the canvas draws — the axis's window stands.
        localStorage.setItem(keptName("plan-own-decade"), JSON.stringify({
            collapse: [], charts: [], anchor: null, window: { kind: "time", min: Date.UTC(2021, 11, 27), max: Date.UTC(2032, 0, 5) },
        }));
        const decade = renderPlan(value(await ownWindowSlice("plan-own-zoom-third")), "plan-own-decade");
        expect(firstTick(decade.container)).toBe("W27");
    });

    test("a kept window the axis no longer allows is not taken back — one of another arm, or one ending before it starts: the axis's window stands", async () => {
        const slice = await ownWindowSlice("plan-own-stale-slice");
        // Kept while the axis was a number axis.
        localStorage.setItem(keptName("plan-own-number"), JSON.stringify({ collapse: [], charts: [], anchor: null, window: { kind: "number", min: 3, max: 9 } }));
        const number = renderPlan(planRoot(rows(), { slice: some(slice) }), "plan-own-number");
        expect(firstTick(number.container)).toBe("W27");
        number.unmount();
        localStorage.setItem(keptName("plan-own-inverted"), JSON.stringify({
            collapse: [], charts: [], anchor: null, window: { kind: "time", min: W39.getTime(), max: W27.getTime() },
        }));
        const inverted = renderPlan(planRoot(rows(), { slice: some(slice) }), "plan-own-inverted");
        expect(firstTick(inverted.container)).toBe("W27");
    });

    test("beside a source holding the window, a kept window is not taken back, and a pan keeps none: the window is the source's", async () => {
        const slice = await resolutionSlice("plan-own-held-slice");
        const kept = { kind: "time", min: W29.getTime(), max: W41.getTime() };
        localStorage.setItem(keptName("plan-own-held"), JSON.stringify({ collapse: [], charts: [], anchor: null, window: kept }));
        const { container } = renderPlan(planRoot(rows(), { slice: some(slice) }), "plan-own-held");
        // The source's window, W27 to W39 — never the kept one.
        expect(firstTick(container)).toBe("W27");
        fireEvent.keyDown(container.querySelector("[data-plan-body]")!, { key: "]" });
        expect(firstTick(container)).toBe("W28");
        // The pan moved the source's window, which its own state keeps: storage holds what it held.
        expect(storedAt("plan-own-held").window).toEqual(kept);
    });
});
