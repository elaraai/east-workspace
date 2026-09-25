/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * ONE overlay layer (#816): a canvas mounts no overlay machine per element — a
 * popover, a hover card and a tooltip exist only while open, whatever the
 * element count. Cells join runs, events, chips and marks as subjects of the
 * root's resolvers (#743 item 5), on the canvas and in the narrow cards. Click
 * opens the popover, hover the card, focus + Enter the popover, and Esc closes
 * it — and nothing else — and hands focus back. Resolvers run lazily, once per
 * open; `none` opens nothing; selection, click payloads and group-strip toggles
 * are unchanged; a surface whose element scrolls out of view closes.
 */

import { describe, test, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import { none, some, variant } from "@elaraai/east";
import { system } from "../../theme/index.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { EastChakraPlan, type PlanRootValue } from "./index.js";
import type { PlanRowId, PlanWireRow } from "./model.js";
import type { PlanInstantValue } from "./instant.js";
import { oneBlock, rowId, rowIdEqual, rowSel } from "./plan.test-utils.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

/** Every IntersectionObserver the canvas creates, so a test can scroll an
 *  anchor out of view by answering for the browser. */
const observers: { cb: IntersectionObserverCallback; targets: Element[] }[] = [];
class IntersectionObserverStub {
    readonly entry: { cb: IntersectionObserverCallback; targets: Element[] };
    constructor(cb: IntersectionObserverCallback) {
        this.entry = { cb, targets: [] };
        observers.push(this.entry);
    }
    observe(el: Element) { this.entry.targets.push(el); }
    unobserve() {}
    disconnect() { this.entry.targets = []; }
    takeRecords() { return []; }
}

beforeEach(() => {
    initializeStore(new UIStore());
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = IntersectionObserverStub;
});
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
    observers.length = 0;
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
});

const W27 = new Date("2026-06-29T00:00:00Z");
const W39 = new Date("2026-09-21T00:00:00Z");
const week = (n: number) => new Date(W27.getTime() + n * 7 * 86_400_000);
const t = (d: Date): PlanInstantValue => variant("time", d) as PlanInstantValue;

function run(key: string, from: number, to: number) {
    return {
        key, start: t(week(from)), end: t(week(to)), label: key.toUpperCase(),
        quantity: none, state: variant("actual", null), status: none, moved: none, icon: none,
    };
}
const spanKind = (runs: unknown[], ports: unknown[] = []) =>
    variant("span", { runs, decisions: [], ports, rollup: none });
const port = (at: number, label?: string) =>
    ({ at: t(week(at)), label: label !== undefined ? some(label) : none });

/** One WIRE row, as the source serves it — named by its test key (#822). */
function planRow(key: string, kind: unknown, parent?: string, collapsed?: boolean): PlanWireRow {
    return {
        id: rowId(key),
        parent: parent !== undefined ? some(rowId(parent)) : none,
        gutter: { label: key, id: false, sub: none, value: none, meta: none, stacked: false, swatches: [] },
        kind,
        collapsed: collapsed === true,
        pinned: false, height: none, status: none, approval: none, expand: none,
    } as unknown as PlanWireRow;
}

function planRoot(rows: PlanWireRow[], opts: { popover?: unknown; hover?: unknown; onElementClick?: unknown } = {}): PlanRootValue {
    return {
        rows: variant("inline", oneBlock(rows)),
        links: [],
        axis: variant("time", {
            window: some({ min: W27, max: W39 }), resolution: variant("week", null),
            resolutions: [], now: none, format: none,
        }),
        grain: none,
        popover: opts.popover !== undefined ? some(opts.popover) : none,
        hover: opts.hover !== undefined ? some(opts.hover) : none,
        expandRender: none, expandGutter: none, review: none, pick: none,
        slice: none, footer: [], id: none, sources: [], editing: none, canDrop: none,
        onSelect: none, onElementClick: opts.onElementClick !== undefined ? some(opts.onElementClick) : none,
        onGroupToggle: none, onGrainChange: none, ui: none, style: none,
    } as unknown as PlanRootValue;
}

const renderPlan = (value: PlanRootValue, key: string) => render(
    <ChakraProvider value={system}>
        <EastChakraPlan value={value} storageKey={key} />
    </ChakraProvider>,
);

/** The element refs a resolver was called with, as `kind:row/key` — the row
 *  named by its id's path (#822). */
type Ref = { type: string; value: { row: PlanRowId; run?: string; at?: { type: string; value: Date } } };
const refText = (ref: Ref) => {
    const row = ref.value.row.value.path.join("/");
    return ref.type === "cell"
        ? `cell:${row}@${ref.value.at!.value.toISOString().slice(0, 10)}`
        : `${ref.type}:${row}/${ref.value.run ?? ""}`;
};
/** A resolver that records its calls and opens a body named after the ref. */
function recording(label: string) {
    const calls: string[] = [];
    const fn = (ref: Ref) => {
        calls.push(refText(ref));
        return some(variant("Text", { value: `${label} · ${refText(ref)}`, style: none }));
    };
    return { calls, fn };
}

/** Any Zag overlay part a canvas has mounted — the fingerprint of a machine. */
const overlayParts = () => document.querySelectorAll('[data-scope="popover"],[data-scope="hover-card"],[data-scope="tooltip"]');

/**
 * Waits, each call, for the open popover to arm its dismissal. Zag arms it on
 * the document after the popover opens — the Escape listener a frame later,
 * the outside-press listener (a capture `pointerdown`) a frame and a task after
 * that, which is what this counts. A user's next input always comes later; a
 * test's can come first, and then exercises nothing.
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

describe("one overlay layer (#816)", () => {
    test("50 rows × 20 elements mount NO overlay machine at rest, and exactly one surface when opened", async () => {
        const rows = Array.from({ length: 50 }, (_u, r) => planRow(`r${String(r).padStart(2, "0")}`,
            spanKind(
                Array.from({ length: 16 }, (_v, i) => run(`x${i}`, i % 10, (i % 10) + 1)),
                // Four labelled ports make twenty elements a row.
                [port(1, "in"), port(3, "out"), port(5, "in"), port(7, "out")],
            )));
        const pop = recording("POP");
        const hov = recording("HOV");
        const { container } = renderPlan(planRoot(rows, { popover: pop.fn, hover: hov.fn }), "plan-816-scale");
        expect(container.querySelectorAll("[data-run]")).toHaveLength(50 * 16);
        expect(container.querySelectorAll("[data-port][aria-label]")).toHaveLength(50 * 4);
        // The per-element design mounted a popover + hover card machine on
        // every run and a tooltip on every port — 1,800 of them. Now: none.
        expect(overlayParts()).toHaveLength(0);
        expect(pop.calls).toEqual([]);

        await userEvent.setup().click(container.querySelector(`${rowSel("r07")} [data-run="x3"]`)!);
        expect(await screen.findByText("POP · run:r07/x3")).toBeTruthy();
        // One popover, however many elements: every popover part sits in the
        // one open surface.
        expect(document.querySelectorAll('[data-scope="popover"][data-part="content"]')).toHaveLength(1);
        expect(document.querySelectorAll('[data-scope][data-part="trigger"]')).toHaveLength(0);
    });

    test("heat, table, weight and segment cells open the root's popover and hover card — each with its cell ref", async () => {
        const heat = planRow("heat", variant("heat", {
            cells: variant("heat", {
                cells: [{ at: t(week(1)), value: some(40), label: some("40") }],
                scale: { min: some(0), max: some(100), warnAt: none }, fold: variant("mean", null), format: none,
            }),
            aggregate: none, scale: none,
        }));
        const weight = planRow("weight", variant("heat", {
            cells: variant("weight", {
                cells: [{ at: t(week(2)), fraction: 0.5, planned: false }], fold: variant("mean", null), format: none,
            }),
            aggregate: none, scale: none,
        }));
        const segments = planRow("seg", variant("heat", {
            cells: variant("segments", {
                cells: [{
                    at: t(week(3)),
                    segments: [{ fill: variant("brand", null), weight: 1, label: some("all") }],
                }],
                fold: variant("sum", null), format: none,
            }),
            aggregate: none, scale: none,
        }));
        const table = planRow("tbl", variant("table", {
            series: [{
                cells: [{ at: t(week(4)), value: some(12), text: none, tone: none }],
                format: none, tone: none, strong: false, rollup: false, fold: variant("sum", null),
            }],
            split: variant("horizontal", null), aggregate: none, format: none, emphasis: variant("body", null),
        }));
        const pop = recording("POP");
        const hov = recording("HOV");
        const { container } = renderPlan(planRoot([heat, weight, segments, table], { popover: pop.fn, hover: hov.fn }), "plan-816-cells");
        const user = userEvent.setup();
        const cell = (row: string) => container.querySelector<HTMLElement>(`${rowSel(row)} [data-cell]`)!;

        await user.click(cell("heat"));
        expect(await screen.findByText("POP · cell:heat@2026-07-06")).toBeTruthy();
        await user.click(cell("weight"));
        expect(await screen.findByText("POP · cell:weight@2026-07-13")).toBeTruthy();
        await user.click(cell("seg"));
        expect(await screen.findByText("POP · cell:seg@2026-07-20")).toBeTruthy();
        await user.click(cell("tbl"));
        expect(await screen.findByText("POP · cell:tbl@2026-07-27")).toBeTruthy();
        expect(pop.calls).toEqual([
            "cell:heat@2026-07-06", "cell:weight@2026-07-13", "cell:seg@2026-07-20", "cell:tbl@2026-07-27",
        ]);

        // Hover opens the card on a cell too.
        await user.keyboard("{Escape}");
        await user.hover(cell("heat"));
        expect(await screen.findByText("HOV · cell:heat@2026-07-06")).toBeTruthy();
    });

    test("in the narrow cards, a cell opens the same popover", async () => {
        const realRect = Element.prototype.getBoundingClientRect;
        Element.prototype.getBoundingClientRect = function () {
            return { left: 0, top: 0, right: 360, bottom: 600, width: 360, height: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
        };
        try {
            const heat = planRow("heat", variant("heat", {
                cells: variant("heat", {
                    cells: [{ at: t(week(1)), value: some(40), label: some("40") }],
                    scale: { min: some(0), max: some(100), warnAt: none }, fold: variant("mean", null), format: none,
                }),
                aggregate: none, scale: none,
            }));
            const pop = recording("POP");
            const { container } = renderPlan(planRoot([heat], { popover: pop.fn }), "plan-816-narrow");
            await waitFor(() => expect(container.querySelector("[data-plan-narrow]")).toBeTruthy());
            await userEvent.setup().click(container.querySelector(`${rowSel("heat", "data-plan-card")} [data-cell]`)!);
            expect(await screen.findByText("POP · cell:heat@2026-07-06")).toBeTruthy();
        } finally {
            Element.prototype.getBoundingClientRect = realRect;
        }
    });

    /** A one-run canvas with its row selected (the gutter), so the canvas's own
     *  esc rung has something to spend, and the run's bar focused. */
    function selectedBar(key: string, popover: unknown) {
        const { container } = renderPlan(planRoot([planRow("m1", spanKind([run("b214", 1, 4)]))], { popover }), key);
        const row = container.querySelector<HTMLElement>(rowSel("m1"))!;
        fireEvent.click(row.children[0]!);
        expect(row.hasAttribute("data-selected")).toBe(true);
        const bar = container.querySelector<HTMLElement>('[data-run="b214"]')!;
        act(() => bar.focus());
        expect(document.activeElement).toBe(bar);
        return { row, bar };
    }

    test("focus + Enter opens the popover; Esc closes it, and nothing else", async () => {
        const armed = watchPopoverArming();
        const pop = recording("POP");
        const { row, bar } = selectedBar("plan-816-keys", pop.fn);
        fireEvent.keyDown(bar, { key: "Enter" });
        expect(await screen.findByText("POP · run:m1/b214")).toBeTruthy();
        // Enter again while it is open: the same open, not a second resolve.
        fireEvent.keyDown(bar, { key: "Enter" });
        expect(pop.calls).toEqual(["run:m1/b214"]);
        await armed();
        const user = userEvent.setup();
        await user.keyboard("{Escape}");
        await waitFor(() => expect(screen.queryByText("POP · run:m1/b214")).toBeNull());
        expect(document.activeElement).toBe(bar);
        // The popover's layer took that Esc — the selection stands.
        expect(row.hasAttribute("data-selected")).toBe(true);
        // The next one, with nothing open, returns from the element to its
        // row (#819) — one rung; the selection still stands.
        await user.keyboard("{Escape}");
        expect(document.activeElement).toBe(row);
        expect(row.hasAttribute("data-selected")).toBe(true);
        // The one after is the canvas's: it deselects.
        await user.keyboard("{Escape}");
        expect(row.hasAttribute("data-selected")).toBe(false);
        expect(pop.calls).toEqual(["run:m1/b214"]);
    });

    test("Esc inside the open popover closes it and hands focus back to the element", async () => {
        const armed = watchPopoverArming();
        const pop = recording("POP");
        const { row, bar } = selectedBar("plan-816-return", pop.fn);
        fireEvent.keyDown(bar, { key: "Enter" });
        expect(await screen.findByText("POP · run:m1/b214")).toBeTruthy();
        await armed();
        // Into the popover, as a reader of its body goes.
        const content = document.querySelector<HTMLElement>('[data-plan-overlay="popover"]')!;
        act(() => content.focus());
        expect(document.activeElement).toBe(content);
        await userEvent.setup().keyboard("{Escape}");
        await waitFor(() => expect(screen.queryByText("POP · run:m1/b214")).toBeNull());
        expect(document.activeElement).toBe(bar);
        expect(row.hasAttribute("data-selected")).toBe(true);
    });

    test("an Esc inside the popover's first frame, before its layer listens, still closes only the popover", () => {
        const pop = recording("POP");
        const { row, bar } = selectedBar("plan-816-first-frame", pop.fn);
        // Synchronous from here on: no frame passes, so no layer is listening
        // and the Escape reaches the canvas — whose top rung is the popover.
        fireEvent.keyDown(bar, { key: "Enter" });
        expect(screen.getByText("POP · run:m1/b214")).toBeTruthy();
        fireEvent.keyDown(bar, { key: "Escape" });
        expect(screen.queryByText("POP · run:m1/b214")).toBeNull();
        expect(document.activeElement).toBe(bar);
        expect(row.hasAttribute("data-selected")).toBe(true);
    });

    test("an Escape a layer already took is not the canvas's — as a browser delivers the popover's", () => {
        // In a browser the popover's layer shuts it within the Escape's own
        // dispatch: its document listener prevents the key, and its close runs
        // at the microtask checkpoint that follows that listener. The canvas
        // meets the key with the popover already gone. jsdom holds microtasks
        // until the whole dispatch ends, so here a listener stands in for the
        // layer.
        const { row, bar } = selectedBar("plan-816-prevented", undefined);
        const layer = (e: KeyboardEvent) => { if (e.key === "Escape") e.preventDefault(); };
        document.addEventListener("keydown", layer, true);
        try {
            fireEvent.keyDown(bar, { key: "Escape" });
            expect(row.hasAttribute("data-selected")).toBe(true);
            // Not even the element's own rung ran: focus stayed on it.
            expect(document.activeElement).toBe(bar);
        } finally {
            document.removeEventListener("keydown", layer, true);
        }
        // The same key, taken by nothing nearer, is the canvas's: from the
        // element it returns to the row (#819), and from the row it deselects.
        fireEvent.keyDown(bar, { key: "Escape" });
        expect(document.activeElement).toBe(row);
        expect(row.hasAttribute("data-selected")).toBe(true);
        fireEvent.keyDown(row, { key: "Escape" });
        expect(row.hasAttribute("data-selected")).toBe(false);
    });

    test("resolvers run lazily — only on open, once per open — and `none` opens nothing", async () => {
        const hov = recording("HOV");
        const popCalls: string[] = [];
        const popover = (ref: Ref) => { popCalls.push(refText(ref)); return none; };
        const { container } = renderPlan(planRoot([planRow("m1", spanKind([run("b214", 1, 4), run("c1", 5, 6)]))],
            { popover, hover: hov.fn }), "plan-816-lazy");
        expect(hov.calls).toEqual([]);
        const bar = container.querySelector<HTMLElement>('[data-run="b214"]')!;
        const user = userEvent.setup();
        await user.hover(bar);
        expect(await screen.findByText("HOV · run:m1/b214")).toBeTruthy();
        // Moving about INSIDE the element is not a new open.
        fireEvent.pointerOver(bar.querySelector("span")!);
        fireEvent.pointerOver(bar);
        await act(async () => { await new Promise((r) => setTimeout(r, 250)); });
        expect(hov.calls).toEqual(["run:m1/b214"]);
        // Leaving the element closes the card.
        await user.unhover(bar);
        await waitFor(() => expect(screen.queryByText("HOV · run:m1/b214")).toBeNull());
        // A popover resolver answering `none` opens nothing — no empty surface.
        await user.click(container.querySelector('[data-run="c1"]')!);
        expect(popCalls).toEqual(["run:m1/c1"]);
        expect(document.querySelector('[data-scope="popover"][data-part="content"]')).toBeNull();
    });

    test("a click still selects the row and reports its element; a group strip still toggles and opens nothing", async () => {
        const clicks: unknown[] = [];
        const pop = recording("POP");
        const group = planRow("line", variant("group", {
            summary: variant("cells", variant("heat", {
                cells: [{ at: t(week(0)), value: some(80), label: some("80") }],
                scale: { min: some(0), max: some(100), warnAt: none }, fold: variant("mean", null), format: none,
            })),
        }), undefined, true);
        const { container } = renderPlan(planRoot([
            group,
            planRow("m1", spanKind([run("b214", 1, 4)]), "line"),
            planRow("m2", spanKind([run("c7", 1, 4)])),
        ], { popover: pop.fn, onElementClick: (e: unknown) => { clicks.push(e); } }), "plan-816-semantics");
        const user = userEvent.setup();
        await user.click(container.querySelector('[data-run="c7"]')!);
        expect(await screen.findByText("POP · run:m2/c7")).toBeTruthy();
        expect(container.querySelector(rowSel("m2"))!.hasAttribute("data-selected")).toBe(true);
        await waitFor(() => expect(clicks).toHaveLength(1));
        const click = clicks[0] as { type: string; value: { row: PlanRowId; run: string } };
        expect(click.type).toBe("run");
        expect(rowIdEqual(click.value.row, rowId("m2"))).toBe(true);
        expect(click.value.run).toBe("c7");
        // The strip's cell is the band's toggle, not an element.
        expect(container.querySelector(`${rowSel("line", "data-plan-group")} [data-cell]`)).toBeNull();
        await user.click(screen.getByText("80"));
        expect(container.querySelector(rowSel("m1"))).toBeTruthy();
        expect(pop.calls).toEqual(["run:m2/c7"]);
    });

    test("a second click on the same element closes its popover", async () => {
        const armed = watchPopoverArming();
        const pop = recording("POP");
        const { container } = renderPlan(planRoot([planRow("m1", spanKind([run("b214", 1, 4)]))], { popover: pop.fn }), "plan-816-toggle");
        const bar = container.querySelector<HTMLElement>('[data-run="b214"]')!;
        const user = userEvent.setup();
        await user.click(bar);
        expect(await screen.findByText("POP · run:m1/b214")).toBeTruthy();
        await armed();
        // A real click outlasts a frame, and the popover judges a press outside
        // it a frame after the press — its own element's press must not count,
        // or the click would close it and then open it again.
        await user.pointer({ keys: "[MouseLeft>]", target: bar });
        await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
        await user.pointer({ keys: "[/MouseLeft]", target: bar });
        await waitFor(() => expect(screen.queryByText("POP · run:m1/b214")).toBeNull());
        expect(pop.calls).toEqual(["run:m1/b214"]);
    });

    test("a surface closes once its element scrolls out of view", async () => {
        const pop = recording("POP");
        const { container } = renderPlan(planRoot([planRow("m1", spanKind([run("b214", 1, 4)]))], { popover: pop.fn }), "plan-816-scroll");
        const bar = container.querySelector<HTMLElement>('[data-run="b214"]')!;
        await userEvent.setup().click(bar);
        expect(await screen.findByText("POP · run:m1/b214")).toBeTruthy();
        const watcher = observers.find((o) => o.targets.includes(bar))!;
        expect(watcher).toBeDefined();
        act(() => watcher.cb([{ target: bar, isIntersecting: false } as unknown as IntersectionObserverEntry], {} as IntersectionObserver));
        await waitFor(() => expect(screen.queryByText("POP · run:m1/b214")).toBeNull());
    });

    test("a labelled port shows its label as the tooltip, and hides it when the pointer leaves", async () => {
        const { container } = renderPlan(planRoot([planRow("m1", spanKind([run("b214", 1, 4)], [port(2, "IN · 40 t")]))]), "plan-816-tip");
        const p = container.querySelector<HTMLElement>("[data-port]")!;
        const user = userEvent.setup();
        await user.hover(p);
        expect(await screen.findByText("IN · 40 t")).toBeTruthy();
        await user.unhover(p);
        await waitFor(() => expect(screen.queryByText("IN · 40 t")).toBeNull());
    });
});
