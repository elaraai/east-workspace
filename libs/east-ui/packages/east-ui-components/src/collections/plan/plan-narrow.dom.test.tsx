/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Plan narrow-layout DOM tests (§10 / #570) — below the compact width the
 * canvas is a review tool: tabs, cards, the shared ruler and the chips.
 *
 * (Split out of `plan.dom.test.tsx`, #815: every test moved verbatim.)
 */

import { describe, test, expect, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import { variant, some, none } from "@elaraai/east";
import { system } from "../../theme/index.js";
import { buildSliceHandle } from "../../platform/slice/index.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { EastChakraPlan, type PlanRootValue, type PlanRowValue } from "./index.js";
import type { PlanInstantValue } from "./instant.js";

// A canvas persists its toggles under its storageKey (#813), and several tests
// share one — nothing may carry from one test to the next.
afterEach(() => {
    cleanup();
    localStorage.clear();
});

// jsdom lacks ResizeObserver — the floating-ui positioner behind the
// resolver popovers needs one; a no-op stub keeps positioning inert (the
// slice / schematic dom-test convention).
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
// jsdom has no `CSS.escape`, and Zag's tabs find their triggers through it
// when an arrow key moves between them (#819) — every browser has one. A
// stand-in escaping whatever an id may hold.
const cssApi = ((globalThis as { CSS?: { escape?: (s: string) => string } }).CSS ??= {});
cssApi.escape ??= (s: string) => s.replace(/[^\w-]/g, (c) => `\\${c}`);

const W27 = new Date("2026-06-29T00:00:00Z");           // Monday, ISO week 27
const W39 = new Date("2026-09-21T00:00:00Z");           // exclusive max → 12 weeks
const NOW = new Date("2026-08-12T00:00:00Z");
/** Instants on each arm — REAL East variant values, as the decoder yields them (#631). */
const t = (d: Date): PlanInstantValue => variant("time", d) as PlanInstantValue;

function run(key: string, start: Date, end: Date, state: unknown, opts?: { quantity?: string; stuck?: boolean; qty?: number }) {
    return {
        key, start: t(start), end: t(end), label: key.toUpperCase(),
        quantity: opts?.quantity !== undefined ? some(opts.quantity) : none,
        qty: opts?.qty !== undefined ? some(opts.qty) : none,
        state,
        status: opts?.stuck === true ? some(variant("warning", null)) : none,
        moved: none, icon: none,
    };
}

function gutter(label: string, opts?: { sub?: string; value?: string; meta?: string; id?: boolean }) {
    return {
        label,
        id: opts?.id === true ? some(true) : none,
        sub: opts?.sub !== undefined ? some(opts.sub) : none,
        value: opts?.value !== undefined ? some(opts.value) : none,
        meta: opts?.meta !== undefined ? some(opts.meta) : none,
        stacked: none,
        swatches: [],
    };
}

function planRow(key: string, kind: unknown, opts?: { parent?: string; gutter?: unknown; expand?: unknown }): PlanRowValue {
    return {
        key,
        parent: opts?.parent !== undefined ? some(opts.parent) : none,
        gutter: opts?.gutter ?? gutter(key),
        kind,
        pinned: none, height: none, status: none, approval: none,
        expand: opts?.expand !== undefined ? some(opts.expand) : none,
    } as unknown as PlanRowValue;
}

function spanKind(runs: unknown[], opts?: { rollup?: string; unit?: string }) {
    return variant("span", {
        runs, decisions: [], ports: [],
        rollup: opts?.rollup !== undefined ? some(variant(opts.rollup, null)) : none,
        unit: opts?.unit !== undefined ? some(opts.unit) : none,
    });
}

/** The decoded row COLLECTION — the IR's `Dict<String, PlanRow>` (#568). A
 *  plain `Map` stands in for the decoder's `SortedMap`: the renderer only
 *  iterates it, and INSERTION order keeps these fixtures readable in the order
 *  they are written. Key ORDER itself is covered in `derive.test.ts`. */
function rowCollection(rows: PlanRowValue[]): Map<string, PlanRowValue> {
    return new Map(rows.map((r) => [r.key, r]));
}

function planRoot(rows: PlanRowValue[], opts?: { footer?: unknown[]; now?: Date | undefined; slice?: unknown; resolutions?: unknown[]; links?: unknown[]; popover?: unknown; hover?: unknown; expandRender?: unknown; source?: unknown; pick?: unknown; axis?: unknown; style?: { height?: string; maxHeight?: string }; clicks?: { onRunClick?: unknown; onEventClick?: unknown; onMarkClick?: unknown; onChipClick?: unknown; onCellClick?: unknown } }): PlanRootValue {
    return {
        rows: opts?.source !== undefined ? variant("paged", opts.source) : variant("inline", rowCollection(rows)),
        links: opts?.links ?? [],
        // The TIME arm by default (#631); the typed-axis tests pass their own.
        axis: opts?.axis ?? variant("time", {
            window: some({ min: W27, max: W39 }),
            resolution: variant("week", null),
            resolutions: opts?.resolutions ?? [],
            now: opts?.now !== undefined ? some(opts.now) : (opts && "now" in opts ? none : some(NOW)),
            format: none,
        }),
        grain: none,
       
        popover: opts?.popover !== undefined ? some(opts.popover) : none,
        hover: opts?.hover !== undefined ? some(opts.hover) : none,
        expandRender: opts?.expandRender !== undefined ? some(opts.expandRender) : none,
        review: none,
        pick: opts?.pick !== undefined ? some(opts.pick) : none,
        slice: opts?.slice ?? none,
        footer: opts?.footer ?? [],
        id: "", sources: [], onDrag: none, canDrop: none,
        onSelect: none,
        onRunClick: opts?.clicks?.onRunClick !== undefined ? some(opts.clicks.onRunClick) : none,
        onEventClick: opts?.clicks?.onEventClick !== undefined ? some(opts.clicks.onEventClick) : none,
        onMarkClick: opts?.clicks?.onMarkClick !== undefined ? some(opts.clicks.onMarkClick) : none,
        onChipClick: opts?.clicks?.onChipClick !== undefined ? some(opts.clicks.onChipClick) : none,
        onCellClick: opts?.clicks?.onCellClick !== undefined ? some(opts.clicks.onCellClick) : none,
        onGroupToggle: none, onGrainChange: none,
        style: opts?.style !== undefined
            ? some({
                height: opts.style.height !== undefined ? some(opts.style.height) : none,
                maxHeight: opts.style.maxHeight !== undefined ? some(opts.style.maxHeight) : none,
                density: none,
                gutterWidth: none,
            })
            : none,
    } as unknown as PlanRootValue;
}

function renderPlan(value: PlanRootValue, key = "plan") {
    return render(
        <ChakraProvider value={system}>
            <EastChakraPlan value={value} storageKey={key} />
        </ChakraProvider>,
    );
}

describe("Plan narrow layout (§10 / #570)", () => {
    // jsdom lays nothing out; the adaptive contract measures the body's
    // bounding rect, so a 360px rect IS a phone-width container here (the
    // ResizeObserver stub at the top of the file never fires — the hook's
    // first measure runs on mount).
    const realRect = Element.prototype.getBoundingClientRect;
    const stubWidth = (width: number) => {
        Element.prototype.getBoundingClientRect = function () {
            return { left: 0, top: 0, right: width, bottom: 600, width, height: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
        };
    };
    beforeEach(() => stubWidth(360));
    afterEach(() => { Element.prototype.getBoundingClientRect = realRect; });

    const heatKind = (vals: number[]) => variant("heat", {
        cells: variant("heat", {
            cells: vals.map((v, i) => ({ at: t(new Date(W27.getTime() + i * 7 * 86_400_000)), value: some(v), label: some(String(v)) })),
            min: some(0), max: some(100), warnAt: none,
        }),
        aggregate: none,
    });
    const chartKind = variant("chart", {
        layers: [variant("line", {
            points: [{ t: t(W27), y: 94 }, { t: t(new Date("2026-08-31Z")), y: 101 }],
            axis: variant("left", null), breach: none,
        })],
        left: some({ domain: some(variant("number", { min: 80, max: 110 })), tickValues: some(variant("number", [80, 100])), format: none }),
        right: none, height: variant("spark", null), expandedHeight: none, expandable: none,
    });
    const fixture = (opts?: Parameters<typeof planRoot>[1]) => planRoot([
        planRow("line1", variant("group", { summary: none, summaryAggregate: some(variant("mean", null)), collapsed: none }),
            { gutter: gutter("Line 1", { value: "82%" }) }),
        planRow("m1", spanKind([run("r1", W27, new Date("2026-07-13Z"), variant("actual", null))]),
            { parent: "line1", gutter: gutter("L1-M03", { id: true, value: "120 t" }), expand: { height: some("120px"), axis: variant("keep", null) } }),
        planRow("l1h", heatKind([40, 60]), { parent: "line1" }),
        planRow("line2", variant("group", { summary: none, summaryAggregate: some(variant("max", null)), collapsed: none }),
            { gutter: gutter("Line 2", { value: "98%" }) }),
        planRow("l2h", heatKind([70, 98]), { parent: "line2" }),
        planRow("cov", chartKind, { gutter: gutter("COVERAGE", { id: true }) }),
    ], {
        expandRender: (ref: { key: string }) => variant("Text", { value: `R · ${ref.key}`, style: none }),
        ...opts,
    });

    test("below 480px the canvas reflows to chips · tabs · ruler · cards; Groups lists the group strips hottest first", () => {
        const { container } = renderPlan(fixture(), "plan-570-groups");
        expect(container.querySelector("[data-plan-narrow]")).toBeTruthy();
        // No gutter grid anywhere — the row identity lives in card heads.
        expect(container.querySelector("[data-plan-row]")).toBeNull();
        expect(container.querySelector("[data-slot='ruler']")).toBeNull();
        // Three tabs over one slice; Groups is the default.
        expect([...container.querySelectorAll("[data-plan-tab]")].map((t) => t.getAttribute("data-plan-tab")))
            .toEqual(["groups", "rows", "measures"]);
        expect(container.querySelector("[data-plan-tab='groups']")!.hasAttribute("data-selected")).toBe(true);
        // The strip is the production `tabs` recipe; counts ride the labels
        // as plain numerals — two groups, four data rows, one measure.
        expect(container.querySelector("[data-slot='narrowTabs'][data-part='list']")).toBeTruthy();
        expect([...container.querySelectorAll("[data-plan-tabcount]")].map((c) => c.getAttribute("data-plan-tabcount")))
            .toEqual(["2", "4", "1"]);
        // The shared ruler is the LIST's first row and carries the window's
        // ticks — one cell per bucket, so its rhythm is the card grids'.
        expect(container.querySelector("[data-slot='narrowList'] > [data-slot='narrowRuler']")).toBeTruthy();
        expect(container.querySelectorAll("[data-slot='narrowRulerTick']")).toHaveLength(12);
        expect(screen.getByText("W27")).toBeTruthy();
        // Hottest first: Line 2 peaks at 98, Line 1 at 60; the ungrouped
        // chart row rides an "Other rows" card at the end.
        expect([...container.querySelectorAll("[data-plan-groupcard]")].map((c) => c.getAttribute("data-plan-groupcard")))
            .toEqual(["line2", "line1", "other"]);
        // A group card's head carries the strip's identity; its body IS the strip.
        const line2 = container.querySelector("[data-plan-groupcard='line2']")!;
        expect(line2.textContent).toContain("Line 2");
        expect(line2.textContent).toContain("1 rs");
        expect(line2.textContent).toContain("98%");
        expect(line2.querySelector("[data-plan-cardbody='group']")).toBeTruthy();
    });

    test("a group opens its rows; a second tap drills a row in place while its neighbours keep their size; Esc returns", () => {
        const { container } = renderPlan(fixture(), "plan-570-rows");
        fireEvent.click(container.querySelector("[data-plan-groupcard='line1']")!);
        expect(container.querySelector("[data-plan-tab='rows']")!.hasAttribute("data-selected")).toBe(true);
        // One group at a time — its rows, in tree order, as cards.
        expect([...container.querySelectorAll("[data-plan-card]")].map((c) => c.getAttribute("data-plan-card")))
            .toEqual(["m1", "l1h"]);
        expect(container.querySelector("[data-slot='narrowScope']")!.textContent).toContain("Line 1");
        // The card head is the gutter identity; the body is the row's plot.
        const m1 = () => container.querySelector("[data-plan-card='m1']") as HTMLElement;
        expect(m1().textContent).toContain("L1-M03");
        expect(m1().textContent).toContain("120 t");
        expect(m1().querySelector("[data-run='r1']")).toBeTruthy();
        // Tap selects…
        fireEvent.click(m1());
        expect(m1().hasAttribute("data-selected")).toBe(true);
        expect(m1().hasAttribute("data-expanded")).toBe(false);
        // …a second tap drills in place: the render mounts INSIDE the card,
        // and the neighbour is neither stripped nor removed.
        fireEvent.click(m1());
        expect(m1().hasAttribute("data-expanded")).toBe(true);
        expect(m1().querySelector("[data-plan-expandrender]")).toBeTruthy();
        expect(screen.getByText("R · m1")).toBeTruthy();
        const l1h = container.querySelector("[data-plan-card='l1h']") as HTMLElement;
        expect(l1h).toBeTruthy();
        expect(l1h.hasAttribute("data-ctx")).toBe(false);
        expect(l1h.querySelector("[data-ctx]")).toBeNull();
        // Esc walks the ladder: the drill returns, the selection holds.
        fireEvent.keyDown(container.querySelector("[data-plan-body]")!, { key: "Escape" });
        expect(m1().hasAttribute("data-expanded")).toBe(false);
        expect(m1().hasAttribute("data-selected")).toBe(true);
        // ← Groups goes back to the strip list.
        fireEvent.click(container.querySelector("[data-plan-back]")!);
        expect(container.querySelector("[data-plan-tab='groups']")!.hasAttribute("data-selected")).toBe(true);
    });

    test("Measures stacks the chart rows at expanded density with their ticks overlaid; a two-finger drag pans the window", async () => {
        initializeStore(new UIStore());
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
        const handle = buildSliceHandle("plan.narrow.pan", cfg as never, initial as never,
            [{ at: W27 }, { at: W39 }] as never, none) as never as {
                read(): { range: { value: { value: { from: Date; to: Date } } } };
            };
        const { container } = renderPlan(fixture({ slice: some({ slice: handle, affordances: [variant("range", null)] }) }), "plan-570-measures");
        // A tab is Zag's (#819): its click selects on the machine's next turn.
        fireEvent.click(container.querySelector("[data-plan-tab='measures']")!);
        await waitFor(() => expect(container.querySelector("[data-plan-card='cov']")).toBeTruthy());
        const cov = container.querySelector("[data-plan-card='cov']") as HTMLElement;
        // Expanded density — the plot's viewBox spans 88px, not the spark's 32.
        expect(cov.querySelector('[data-plan-mark="line"]')!.closest("svg")!.getAttribute("viewBox")).toBe("0 0 1000 88");
        // The value ticks overlay the plot's left edge (no gutter to print them in).
        expect(cov.querySelectorAll("[data-plan-tickpx]")).toHaveLength(2);

        // Two fingers dragged LEFT by one period width pan the window one
        // period LATER — through the slice, like the `]` key. jsdom has no
        // layout: give the list a width so a period has a size.
        const list = container.querySelector("[data-slot='narrowList']") as HTMLElement;
        Object.defineProperty(list, "clientWidth", { value: 360 });          // period ≈ (360 − 50) / 12 ≈ 25.8px
        fireEvent.pointerDown(list, { pointerId: 1, clientX: 200 });
        fireEvent.pointerDown(list, { pointerId: 2, clientX: 240 });
        fireEvent.pointerMove(list, { pointerId: 1, clientX: 174 });          // centroid −13
        fireEvent.pointerMove(list, { pointerId: 2, clientX: 214 });          // centroid −26 → one period
        expect(handle.read().range.value.value.from.toISOString()).toBe("2026-07-06T00:00:00.000Z");
        expect(handle.read().range.value.value.to.toISOString()).toBe("2026-09-28T00:00:00.000Z");
        // One finger alone never pans — page scroll stays vertical.
        fireEvent.pointerUp(list, { pointerId: 2, clientX: 214 });
        fireEvent.pointerMove(list, { pointerId: 1, clientX: 0 });
        expect(handle.read().range.value.value.from.toISOString()).toBe("2026-07-06T00:00:00.000Z");
    });

    test("one or two strip-less groups are no index: the plan LANDS on Rows, sectioned by group; a section header scopes", () => {
        // The sweep's finding: most canvases carry one or two groups with no
        // strip, and a Groups landing showed two empty header cards before a
        // single row — a detour. Groups is the landing only when it is a map
        // (three groups, or a strip); otherwise Rows opens, and the grouping
        // survives as SECTIONS rather than flattening into one list.
        const { container } = renderPlan(planRoot([
            planRow("line1", variant("group", { summary: none, summaryAggregate: none, collapsed: none }),
                { gutter: gutter("Line 1") }),
            planRow("m1", spanKind([]), { parent: "line1" }),
            planRow("m2", spanKind([]), { parent: "line1" }),
            planRow("dock", spanKind([])),
        ]), "plan-570-sections");
        expect(container.querySelector("[data-plan-tab='rows']")!.hasAttribute("data-selected")).toBe(true);
        // The Groups tab still exists — it is just not where the plan opens.
        expect(container.querySelector("[data-plan-tab='groups']")).toBeTruthy();
        expect([...container.querySelectorAll("[data-plan-section]")].map((x) => x.getAttribute("data-plan-section")))
            .toEqual(["line1", "other"]);
        expect(container.querySelector("[data-plan-section='line1']")!.textContent).toContain("2 rs");
        expect([...container.querySelectorAll("[data-plan-card]")].map((c) => c.getAttribute("data-plan-card")))
            .toEqual(["m1", "m2", "dock"]);
        // A section header scopes to its group…
        fireEvent.click(container.querySelector("[data-plan-section='line1']")!);
        expect([...container.querySelectorAll("[data-plan-card]")].map((c) => c.getAttribute("data-plan-card")))
            .toEqual(["m1", "m2"]);
        expect(container.querySelector("[data-plan-section]")).toBeNull();
        // …and the way back names the whole plan, not an index that isn't one.
        expect(container.querySelector("[data-plan-back]")!.textContent).toBe("← All rows");
        fireEvent.click(container.querySelector("[data-plan-back]")!);
        expect(container.querySelectorAll("[data-plan-section]")).toHaveLength(2);
        expect(container.querySelector("[data-plan-tab='rows']")!.hasAttribute("data-selected")).toBe(true);
    });

    test("the tabs are a real tablist (#819): arrow keys move between them, and each controls its own tabpanel", async () => {
        const { container } = renderPlan(fixture(), "plan-819-tabs");
        const tab = (key: string) => container.querySelector(`[data-plan-tab='${key}']`) as HTMLElement;
        const panelOf = (key: string) => container.querySelector(`[role='tabpanel'][aria-labelledby='${tab(key).id}']`);
        expect(container.querySelector("[data-slot='narrowTabs']")!.getAttribute("role")).toBe("tablist");
        // Every tab has a tabpanel of its own; only the selected one shows,
        // and the selected tab says which panel it controls.
        for (const key of ["groups", "rows", "measures"]) {
            expect(tab(key).getAttribute("role")).toBe("tab");
            expect(panelOf(key)).toBeTruthy();
            expect(panelOf(key)!.hasAttribute("hidden")).toBe(key !== "groups");
        }
        expect(tab("groups").getAttribute("aria-controls")).toBe(panelOf("groups")!.id);
        // One tab stop: the selected tab.
        expect(tab("groups").getAttribute("tabindex")).toBe("0");
        expect(tab("rows").getAttribute("tabindex")).toBe("-1");
        // An arrow key focuses the next tab in one animation-frame callback and
        // selects the focused tab in the next, the focus's own event queued as
        // a microtask between them. A browser checks microtasks after every
        // callback; jsdom runs a frame's callbacks back to back — so each gets
        // a task of its own here, as a browser's checkpoint would give it.
        const raf = window.requestAnimationFrame;
        const caf = window.cancelAnimationFrame;
        window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0) as unknown as number;
        window.cancelAnimationFrame = (id) => clearTimeout(id);
        try {
            // The arrow keys walk the tabs, and a tab they land on is selected.
            const user = userEvent.setup();
            act(() => tab("groups").focus());
            await user.keyboard("{ArrowRight}");
            await waitFor(() => expect(tab("rows").getAttribute("aria-selected")).toBe("true"));
            expect(document.activeElement).toBe(tab("rows"));
            // The list moved with it: the rows panel is the list now.
            const rowsPanel = panelOf("rows")!;
            expect(rowsPanel.hasAttribute("hidden")).toBe(false);
            expect(rowsPanel.getAttribute("data-slot")).toBe("narrowList");
            expect(rowsPanel.querySelector("[data-plan-card]")).toBeTruthy();
            // The panel it left hides once its presence settles.
            await waitFor(() => expect(panelOf("groups")!.hasAttribute("hidden")).toBe(true));
            await user.keyboard("{ArrowLeft}");
            await waitFor(() => expect(tab("groups").getAttribute("aria-selected")).toBe("true"));
            await user.keyboard("{End}");
            await waitFor(() => expect(tab("measures").getAttribute("aria-selected")).toBe("true"));
            expect(document.activeElement).toBe(tab("measures"));
        } finally {
            window.requestAnimationFrame = raf;
            window.cancelAnimationFrame = caf;
        }
    });

    test("at 480px and above nothing reflows — the canvas is the canvas", () => {
        stubWidth(800);
        const { container } = renderPlan(fixture(), "plan-570-wide");
        expect(container.querySelector("[data-plan-narrow]")).toBeNull();
        expect(container.querySelector("[data-plan-row='m1']")).toBeTruthy();
        expect(container.querySelector("[data-plan-tab]")).toBeNull();
    });
});
