/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Plan row-focus DOM tests — the links focus (R1: the role bands it gathers its
 * family under, the band its other rows fold into, #1680's review, and the
 * ribbons laid out from the model, #818) and expand-in-place (R2: the focused
 * row's render and its context strips).
 *
 * (Split out of `plan.dom.test.tsx`, #815: its tests moved verbatim; the
 * ribbon tests are #818's.)
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { variant, some, none } from "@elaraai/east";
import { system } from "@elaraai/east-ui-components";
import { EastChakraPlan, type PlanRootValue } from "./index.js";
import type { PlanRowId, PlanWireRow } from "./model.js";
import type { PlanInstantValue } from "./instant.js";
import type { PlanElementRefValue } from "./context.js";
import { blocksSource, oneBlock, keySurface, rowId, rowSel, testKeyOf } from "./plan.test-utils.js";
import { setBodyRowMountProbe } from "./rows/BodyRow.js";

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

const W27 = new Date("2026-06-29T00:00:00Z");           // Monday, ISO week 27
const W39 = new Date("2026-09-21T00:00:00Z");           // exclusive max → 12 weeks
const NOW = new Date("2026-08-12T00:00:00Z");
/** Instants on each arm — REAL East variant values, as the decoder yields them (#631). */
const t = (d: Date): PlanInstantValue => variant("time", d) as PlanInstantValue;

function run(key: string, start: Date, end: Date, state: unknown, opts?: { quantity?: number; unit?: string; text?: string; stuck?: boolean }) {
    return {
        key, start: t(start), end: t(end), label: key.toUpperCase(),
        quantity: opts?.quantity !== undefined
            ? some({ value: opts.quantity, unit: opts.unit !== undefined ? some(opts.unit) : none, format: none, text: opts.text !== undefined ? some(opts.text) : none })
            : none,
        state,
        status: opts?.stuck === true ? some({ label: "Over dwell", tone: variant("warning", null), ring: false }) : none,
        moved: none, icon: none,
    };
}

function gutter(label: string, opts?: { sub?: string; value?: string; meta?: string; id?: boolean }) {
    return {
        label,
        id: opts?.id === true,
        sub: opts?.sub !== undefined ? some(opts.sub) : none,
        value: opts?.value !== undefined ? some(opts.value) : none,
        meta: opts?.meta !== undefined ? some(opts.meta) : none,
        stacked: false,
        swatches: [],
    };
}

/** One WIRE row, as the source serves it — named by its test key (#822). */
function planRow(key: string, kind: unknown, opts?: { parent?: string; gutter?: unknown; expand?: unknown; collapsed?: boolean; pinned?: boolean; status?: string }): PlanWireRow {
    return {
        id: rowId(key),
        parent: opts?.parent !== undefined ? some(rowId(opts.parent)) : none,
        gutter: opts?.gutter ?? gutter(key),
        kind,
        collapsed: opts?.collapsed === true,
        pinned: opts?.pinned === true, height: none,
        status: opts?.status !== undefined ? some(variant(opts.status, null)) : none,
        expand: opts?.expand !== undefined ? some(opts.expand) : none,
    } as unknown as PlanWireRow;
}

function spanKind(runs: unknown[], opts?: { rollup?: string }) {
    return variant("span", {
        runs, decisions: [], ports: [],
        rollup: opts?.rollup !== undefined ? some(variant(opts.rollup, null)) : none,
    });
}

function planRoot(rows: PlanWireRow[], opts?: { footer?: unknown[]; now?: Date | undefined; slice?: unknown; resolutions?: unknown[]; links?: unknown[]; popover?: unknown; hover?: unknown; expandRender?: unknown; source?: unknown; pick?: unknown; axis?: unknown; style?: { height?: string; maxHeight?: string }; onElementClick?: unknown; ui?: unknown }): PlanRootValue {
    return {
        rows: opts?.source !== undefined ? variant("paged", blocksSource(opts.source)) : variant("inline", oneBlock(rows)),
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
        pick: opts?.pick !== undefined ? some(opts.pick) : none,
        slice: opts?.slice ?? none, nested: none,
        footer: opts?.footer ?? [],
        id: none, sources: [], editing: none, canDrop: none,
        onSelect: none,
        onElementClick: opts?.onElementClick !== undefined ? some(opts.onElementClick) : none,
        onGroupToggle: none, onGrainChange: none, ui: opts?.ui !== undefined ? some(opts.ui) : none,
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

describe("Plan links focus (R1)", () => {
    /** A link keyed by the runs it joins, moving 34 k sheets (#824: one quantity). */
    const link = (from: string, fromRun: string, to: string, toRun: string) => ({
        key: `${fromRun}>${toRun}`, from: { row: rowId(from), run: fromRun }, to: { row: rowId(to), run: toRun },
        quantity: some({ value: 34, unit: some("k sheets"), format: none, text: none }),
    });

    /** The body's items in order, as their keys name them. */
    const bodyOrder = (container: HTMLElement) => [...container.querySelectorAll("[data-plan-body] [data-plan-item]")]
        .map((el) => el.getAttribute("data-plan-item")!)
        .map((key) => (key.startsWith("r:") ? `r:${testKeyOf(key.slice(2))}` : key));

    test("the control gathers the TRANSITIVE family under its role bands; every other row folds into one band, which opens in place; ← All rows returns (#1680's review)", () => {
        const runAt = (key: string, s: Date, e: Date) => run(key, s, e, variant("confirmed", null));
        const { container } = renderPlan(planRoot([
            planRow("x", spanKind([runAt("rx", W27, new Date("2026-07-13Z"))])),
            planRow("a", spanKind([runAt("ra", W27, new Date("2026-07-13Z"))])),
            planRow("b", spanKind([runAt("rb", new Date("2026-07-13Z"), new Date("2026-07-27Z"))])),
            planRow("c", spanKind([runAt("rc", new Date("2026-07-27Z"), new Date("2026-08-10Z"))])),
        ], {
            // a → b → c is a two-hop chain: focusing b gathers BOTH.
            links: [link("a", "ra", "b", "rb"), link("b", "rb", "c", "rc")],
        }));
        // Rows an edge touches grow the links control; x has none.
        expect(container.querySelector(`${rowSel("b")} [data-plan-control="links"]`)).toBeTruthy();
        expect(container.querySelector(`${rowSel("x")} [data-plan-control="links"]`)).toBeNull();

        fireEvent.click(container.querySelector(`${rowSel("b")} [data-plan-control="links"]`)!);
        // The band names the row by its gutter label (`Plan links.html`, #1258) and counts each role's rows.
        expect(container.querySelector('[data-plan-focusbar="links"]')).toBeTruthy();
        expect(screen.getByText("Links · b · 1 upstream · 1 downstream")).toBeTruthy();
        expect(container.querySelector("[data-plan-focusback]")!.textContent).toBe("← All rows");
        // Upstream, the focused row, downstream — no Linked band, as no row is both ways — then x folded away.
        expect(bodyOrder(container)).toEqual(["l:upstream", "r:a", "l:focused", "r:b", "l:downstream", "r:c", "l:others"]);
        const others = container.querySelector<HTMLElement>('[data-plan-focusband="others"]')!;
        expect([others.textContent, others.getAttribute("aria-expanded")]).toEqual(["Other rows11 row", "false"]);
        // Opened, it holds x where it stood, and folds again.
        fireEvent.click(others);
        expect(bodyOrder(container).slice(-2)).toEqual(["l:others", "r:x"]);
        expect(container.querySelector('[data-plan-focusband="others"]')!.getAttribute("aria-expanded")).toBe("true");
        fireEvent.click(container.querySelector('[data-plan-focusband="others"]')!);
        expect(container.querySelector(rowSel("x"))).toBeNull();
        // A role's band opens nothing.
        fireEvent.click(container.querySelector('[data-plan-focusband="upstream"]')!);
        expect(bodyOrder(container)).toHaveLength(7);

        // ← All rows restores everything, in its order.
        fireEvent.click(container.querySelector("[data-plan-focusback]")!);
        expect(bodyOrder(container)).toEqual(["r:x", "r:a", "r:b", "r:c"]);
    });

    test("a role with no rows says none; a row both ways stands under Linked; a gathered row says what it nests under on its sub line, two lines tall (#1680's review)", () => {
        const runAt = (key: string, s: Date, e: Date) => run(key, s, e, variant("confirmed", null));
        // A plain group band: its summary's case `none` — no strip — is no Option's.
        const hall: PlanWireRow["kind"] = variant("group", { summary: variant("none", null) });
        const { container } = renderPlan(planRoot([
            planRow("g", hall, { gutter: gutter("Hall 1") }),
            planRow("a", spanKind([runAt("ra", W27, new Date("2026-07-13Z"))]), { parent: "g", gutter: gutter("a", { sub: "12k/h" }) }),
            planRow("m", spanKind([runAt("rm", new Date("2026-07-27Z"), new Date("2026-08-10Z"))]), { parent: "g" }),
            planRow("f", spanKind([runAt("rf", new Date("2026-07-13Z"), new Date("2026-07-27Z"))])),
        ], { links: [link("a", "ra", "f", "rf"), link("f", "rf", "m", "rm"), link("m", "rm", "f", "rf")] }));
        fireEvent.click(container.querySelector(`${rowSel("f")} [data-plan-control="links"]`)!);
        expect(screen.getByText("Links · f · 1 upstream · 1 linked · 0 downstream")).toBeTruthy();
        expect(bodyOrder(container)).toEqual(["l:upstream", "r:a", "l:focused", "r:f", "l:linked", "r:m", "l:downstream", "l:others"]);
        expect(container.querySelector('[data-plan-focusband="downstream"] [data-plan-focusnone]')!.textContent).toBe("none");
        expect(container.querySelector('[data-plan-focusband="linked"] [data-plan-focusnone]')).toBeNull();
        // Its path, then its own sub; at the top, neither.
        const sub = (key: string) => container.querySelector(`${rowSel(key)} [data-plan-gutter="sub"]`)?.textContent;
        expect([sub("a"), sub("m"), sub("f")]).toEqual(["Hall 1 · 12k/h", "Hall 1", undefined]);
        expect(["a", "m", "f"].map((k) => container.querySelector(rowSel(k))!.getAttribute("data-plan-h"))).toEqual(["42", "42", "32"]);
        // One level in, under its band; and no caret — its subtree, if any, is the others'.
        expect(container.querySelector(rowSel("m"))!.getAttribute("aria-level")).toBe("2");
    });

    test("a row control's name shows through the canvas's tooltip (#1258)", async () => {
        const { container } = renderPlan(planRoot([
            planRow("a", spanKind([run("ra", W27, new Date("2026-07-13Z"), variant("actual", null))])),
            planRow("b", spanKind([run("rb", new Date("2026-07-13Z"), new Date("2026-07-27Z"), variant("actual", null))])),
        ], { links: [link("a", "ra", "b", "rb")] }), "plan-1258-control-tip");
        const control = container.querySelector(`${rowSel("a")} [data-plan-control="links"]`)!;
        expect(control.getAttribute("aria-label")).toBe("Focus linked rows");
        fireEvent.pointerOver(control);
        await waitFor(() => expect(document.querySelector('[data-plan-overlay="tooltip"]')?.textContent).toBe("Focus linked rows"));
        fireEvent.pointerOut(control);
        await waitFor(() => expect(document.querySelector('[data-plan-overlay="tooltip"]')).toBeNull());
    });

    test("a pinned row the focus does not gather strips to 16px, its value and dot kept; its click returns; esc returns with the others' band open (#1680's review)", () => {
        const { container } = renderPlan(planRoot([
            planRow("p", spanKind([]), { pinned: true, status: "warning", gutter: gutter("On-time", { value: "94%" }) }),
            planRow("a", spanKind([run("ra", W27, new Date("2026-07-13Z"), variant("actual", null))])),
            planRow("b", spanKind([run("rb", new Date("2026-07-13Z"), new Date("2026-07-27Z"), variant("actual", null))])),
            planRow("x", spanKind([])),
        ], { links: [link("a", "ra", "b", "rb")] }));
        const pinned = () => container.querySelector(rowSel("p"))!;
        expect([pinned().getAttribute("data-plan-h"), pinned().hasAttribute("data-ctx")]).toEqual(["32", false]);
        fireEvent.click(container.querySelector(`${rowSel("a")} [data-plan-control="links"]`)!);
        expect([pinned().getAttribute("data-plan-h"), pinned().hasAttribute("data-ctx")]).toEqual(["16", true]);
        const value = pinned().querySelector('[data-plan-gutter="value"]')!;
        expect([value.textContent, value.hasAttribute("data-keep")]).toEqual(["94%", true]);
        expect(pinned().querySelector('[data-tone="warning"]')!.hasAttribute("data-keep")).toBe(true);
        fireEvent.click(pinned());
        expect(container.querySelector("[data-plan-focusbar]")).toBeNull();
        expect(pinned().getAttribute("data-plan-h")).toBe("32");

        fireEvent.click(container.querySelector(`${rowSel("a")} [data-plan-control="links"]`)!);
        fireEvent.click(container.querySelector('[data-plan-focusband="others"]')!);
        expect(container.querySelector(rowSel("x"))).toBeTruthy();
        fireEvent.keyDown(keySurface(container), { key: "Escape" });
        expect(container.querySelector("[data-plan-focusbar]")).toBeNull();
        expect(container.querySelector("[data-plan-focusband]")).toBeNull();
    });
});

describe("Plan link ribbons (#818)", () => {
    /** A link keyed by the runs it joins, moving 34 k sheets (#824: one quantity). */
    const link = (from: string, fromRun: string, to: string, toRun: string) => ({
        key: `${fromRun}>${toRun}`, from: { row: rowId(from), run: fromRun }, to: { row: rowId(to), run: toRun },
        quantity: some({ value: 34, unit: some("k sheets"), format: none, text: none }),
    });
    const confirmed = variant("confirmed", null);
    const JUL13 = new Date("2026-07-13Z");
    const JUL27 = new Date("2026-07-27Z");
    // The 12-week window across a 1000px plot, right of the 240px gutter.
    const xAt = (d: Date) => 240 + ((d.getTime() - W27.getTime()) / (84 * 86_400_000)) * 1000;

    /** A path's last point. */
    const endOf = (d: string): [number, number] => {
        const nums = d.trim().split(/[\sMLAZ]+/).filter((s) => s !== "").map(Number);
        return [nums[nums.length - 2]!, nums[nums.length - 1]!];
    };
    /** A triangle's tip — its second vertex. */
    const tipOf = (d: string): [number, number] => {
        const nums = d.trim().split(/[\sMLZ]+/).filter((s) => s !== "").map(Number);
        return [nums[2]!, nums[3]!];
    };

    /**
     * jsdom lays nothing out. Give the ribbon layer its width — the 240px
     * gutter and a 1000px plot — and a bounded frame its viewport and the
     * sticky header above its rows their heights (TanStack sizes the frame by
     * `offsetHeight`, the view reads `clientHeight`); every other element keeps
     * measuring 0.
     */
    function stubLayout(viewportPx = 0, headerPx = 0): () => void {
        const heightOf = (el: HTMLElement) => (el.getAttribute("data-virtual-rows") === "bounded" ? viewportPx
            : el.hasAttribute("data-plan-header") ? headerPx : 0);
        const stubs: Record<string, (el: HTMLElement) => number> = {
            clientWidth: (el) => (el.hasAttribute("data-plan-ribbons") ? 1240 : 0),
            clientHeight: heightOf,
            offsetHeight: heightOf,
        };
        const saved = Object.keys(stubs).map((k) => [k, Object.getOwnPropertyDescriptor(HTMLElement.prototype, k)] as const);
        for (const [k, get] of Object.entries(stubs)) {
            Object.defineProperty(HTMLElement.prototype, k, { configurable: true, get(this: HTMLElement) { return get(this); } });
        }
        return () => {
            for (const [k, d] of saved) {
                if (d !== undefined) Object.defineProperty(HTMLElement.prototype, k, d);
                else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[k];
            }
        };
    }

    const focusLinks = (container: HTMLElement, key: string) =>
        fireEvent.click(container.querySelector(`${rowSel(key)} [data-plan-control="links"]`)!);

    test("ribbons are laid out from the model the moment the focus opens — no timer, no rect read", async () => {
        const restore = stubLayout();
        // Every element the canvas measures from here on.
        const measured: Element[] = [];
        const rect = Element.prototype.getBoundingClientRect;
        try {
            const { container } = renderPlan(planRoot([
                planRow("a", spanKind([run("ra", W27, JUL13, confirmed)])),
                planRow("b", spanKind([run("rb", JUL13, JUL27, confirmed)])),
            ], { links: [link("a", "ra", "b", "rb")] }), "plan-818-model");
            Element.prototype.getBoundingClientRect = function (this: Element) {
                measured.push(this);
                return rect.call(this);
            };
            focusLinks(container, "a");
            // Nothing awaited, no timer run: the ribbon is already there. It
            // leaves a's run END at a's bar centre — the middle of its plot
            // cell, the 32px row less the rule under it, under the Upstream and
            // Focused bands (26 each, #1680's review): 52 + 15.5...
            const band = container.querySelector('[data-plan-link="0"] [data-plan-ribbon-band]')!;
            expect(band.getAttribute("d")!.startsWith(`M ${xAt(JUL13).toFixed(1)} 67.5`)).toBe(true);
            // Stroked at its weight: the family's largest quantity, so the heaviest, 6 (#1258; ruled 17 Nov 2026 over §15's 8).
            expect(band.getAttribute("stroke-width")).toBe("6");
            // ...and arrives at b's run START, at b's bar centre, under the Downstream band (84 + 26 + 15.5).
            const head = container.querySelector('[data-plan-link="0"] [data-plan-ribbon-head]')!;
            expect(tipOf(head.getAttribute("d")!)).toEqual([Number(xAt(JUL13).toFixed(1)), 125.5]);
            // Past the old 320ms settle: still no row/ribbon geometry read.
            // The shared adaptive hook reads the body's container width after
            // every commit; that is not a measurement of the ribbon layout.
            await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
            const body = container.querySelector("[data-plan-body]");
            expect(measured.filter((el) => el !== body && el.closest("[data-plan-body]") !== null)).toEqual([]);
        } finally {
            Element.prototype.getBoundingClientRect = rect;
            restore();
        }
    });

    test("a link to a row scrolled out of view ends in a stub pointing toward it, and follows the scroll", () => {
        // A bounded frame 140px tall under a 40px sticky header: a 100px view
        // of the rows. Focused on a, under the Upstream and Focused bands, a
        // stands at 52; c, d, e and b stack 32px apart under the Downstream
        // band from 110, so b (206–238) lies past the view's bottom.
        const restore = stubLayout(140, 40);
        try {
            const at = (k: string) => planRow(k, spanKind([run(`r${k}`, W27, JUL13, confirmed)]));
            const { container } = renderPlan(planRoot(["a", "c", "d", "e", "b"].map(at), {
                links: [link("a", "ra", "c", "rc"), link("a", "ra", "d", "rd"), link("a", "ra", "e", "re"), link("a", "ra", "b", "rb")],
                style: { height: "300px" },
            }), "plan-818-stub");
            focusLinks(container, "a");
            const toB = container.querySelector('[data-plan-link="3"]')!;
            // The ribbon runs to the view's bottom edge and ends in a stub
            // pointing down, toward b.
            const down = toB.querySelector('[data-plan-stub="below"]')!;
            expect(tipOf(down.getAttribute("d")!)[1]).toBe(100);
            expect(toB.querySelector('[data-plan-stub="above"]')).toBeNull();
            // Scroll 130px: b comes into view, and a leaves it at the top — the
            // stub moves to the ribbon's start, pointing up toward a.
            const frame = container.querySelector<HTMLElement>('[data-virtual-rows="bounded"]')!;
            Object.defineProperty(frame, "scrollTop", { configurable: true, value: 130 });
            act(() => { fireEvent.scroll(frame); });
            expect(toB.querySelector('[data-plan-stub="below"]')).toBeNull();
            const up = toB.querySelector('[data-plan-stub="above"]')!;
            expect(tipOf(up.getAttribute("d")!)[1]).toBe(130);
            // A ribbon with both ends past the top — a to c, both above 130 — is not drawn.
            expect(container.querySelector('[data-plan-link="0"]')).toBeNull();
        } finally {
            restore();
        }
    });

    test("a gathered row's height moving re-routes the ribbons in the same render", () => {
        const restore = stubLayout();
        try {
            // k is an expandable chart: its expand control toggles it spark ↔ chart (#1680's review).
            const chart = variant("chart", {
                layers: [], left: none, right: none, height: variant("spark", null), expandedHeight: none, expandable: true,
            });
            const { container } = renderPlan(planRoot([
                planRow("a", spanKind([run("ra", W27, JUL13, confirmed)])),
                planRow("k", chart),
                planRow("c", spanKind([run("rc", JUL27, new Date("2026-08-10Z"), confirmed)])),
            ], { links: [link("a", "ra", "k", "rk"), link("k", "rk", "c", "rc")] }), "plan-818-collapse");
            focusLinks(container, "k");
            const toC = () => container.querySelector('[data-plan-link="1"] [data-plan-ribbon-band]')!;
            // c sits under the Upstream band and a, the Focused band and k's 32px spark, and the Downstream band: its
            // bar centre is 26 + 32 + 26 + 32 + 26 + 15.5.
            expect(endOf(toC().getAttribute("d")!)[1]).toBe(157.5);
            expect(toC().getAttribute("stroke-width")).toBe("6");
            // Open k's chart: the same render, c's end down by the 56px it grew. A link's weight is its quantity's,
            // never its bar's (#1258): it keeps its 6.
            fireEvent.click(container.querySelector(`${rowSel("k")} [data-plan-control="expand"]`)!);
            expect(container.querySelector(rowSel("k"))!.getAttribute("data-plan-h")).toBe("88");
            expect(endOf(toC().getAttribute("d")!)[1]).toBe(213.5);
            expect(toC().getAttribute("stroke-width")).toBe("6");
        } finally {
            restore();
        }
    });

    test("hovering a link lights it, draws it over the others, and haloes the two runs it joins (#1258)", () => {
        const restore = stubLayout();
        try {
            const { container } = renderPlan(planRoot([
                planRow("a", spanKind([run("ra", W27, JUL13, confirmed)])),
                planRow("b", spanKind([run("rb", JUL13, JUL27, confirmed)])),
                planRow("c", spanKind([run("rc", JUL27, new Date("2026-08-10Z"), confirmed)])),
            ], { links: [link("a", "ra", "b", "rb"), link("a", "ra", "c", "rc")] }), "plan-818-hover");
            focusLinks(container, "a");
            const order = () => [...container.querySelectorAll("[data-plan-link]")].map((el) => el.getAttribute("data-plan-link"));
            expect(order()).toEqual(["0", "1"]);
            const g = container.querySelector('[data-plan-link="0"]')!;
            const hit = g.querySelector('[data-link="0"]')!;
            expect(g.hasAttribute("data-lit")).toBe(false);
            // At rest every link's casing lies under every link's ink — the
            // layer's own figures, in the plot's clip (#1258).
            expect(g.querySelector("[data-plan-ribbon-casing]")).toBeNull();
            expect(container.querySelectorAll("[data-plan-clip] > [data-plan-ribbon-casing]")).toHaveLength(2);
            fireEvent.pointerEnter(hit);
            expect(g.hasAttribute("data-lit")).toBe(true);
            // Lit, it is drawn last — its casing with it, over the rest.
            expect(order()).toEqual(["1", "0"]);
            expect(g.querySelector('[data-plan-ribbon-casing="0"]')).toBeTruthy();
            expect(container.querySelectorAll("[data-plan-clip] > [data-plan-ribbon-casing]")).toHaveLength(1);
            // The halo is 1px, 4 outside each run: a's bar at 57.5, under the
            // Upstream and Focused bands; b's at 115.5, under the Downstream
            // band (its line's middle 4.5 out, round a 7.5 corner).
            const halo = (side: string) => {
                const el = g.querySelector(`[data-plan-linkend="${side}"]`)!;
                return ["x", "y", "width", "height", "rx"].map((k) => Number(el.getAttribute(k)));
            };
            expect(halo("from")).toEqual([240 - 4.5, 57.5 - 4.5, xAt(JUL13) - 240 + 9, 20 + 9, 7.5]);
            expect(halo("to")).toEqual([xAt(JUL13) - 4.5, 115.5 - 4.5, xAt(JUL27) - xAt(JUL13) + 9, 20 + 9, 7.5]);
            fireEvent.pointerLeave(hit);
            expect(g.hasAttribute("data-lit")).toBe(false);
            expect(g.querySelector("[data-plan-linkend]")).toBeNull();
        } finally {
            restore();
        }
    });

    test("the ribbons come and go without remounting a row they gather", () => {
        // The layer is drawn in the rows' own box — which must not come and go
        // with it, or every row would remount as a focus opens and closes. The
        // rows the focus gathers keep their instances wherever they move; the
        // one it folds away goes with its band, and comes back after.
        const restore = stubLayout();
        const mounts: string[] = [];
        setBodyRowMountProbe((key, phase) => mounts.push(`${phase} ${testKeyOf(key)}`));
        try {
            const { container } = renderPlan(planRoot([
                planRow("a", spanKind([run("ra", W27, JUL13, confirmed)])),
                planRow("x", spanKind([])),
                planRow("b", spanKind([run("rb", JUL13, JUL27, confirmed)])),
            ], { links: [link("a", "ra", "b", "rb")] }), "plan-818-remount");
            mounts.length = 0;
            focusLinks(container, "a");
            expect(container.querySelector("[data-plan-ribbons]")).toBeTruthy();
            fireEvent.click(container.querySelector("[data-plan-focusback]")!);
            expect(container.querySelector("[data-plan-ribbons]")).toBeNull();
            expect(mounts).toEqual(["unmount x", "mount x"]);
        } finally {
            setBodyRowMountProbe(undefined);
            restore();
        }
    });

    test("a ribbon's label shows through the canvas's tooltip", async () => {
        const restore = stubLayout();
        try {
            const { container } = renderPlan(planRoot([
                planRow("a", spanKind([run("ra", W27, JUL13, confirmed)])),
                planRow("b", spanKind([run("rb", JUL13, JUL27, confirmed)])),
            ], { links: [link("a", "ra", "b", "rb")] }), "plan-818-tip");
            focusLinks(container, "a");
            const hit = container.querySelector('[data-link="0"]')!;
            // The captions lie over every link, each on its knockout (#1258).
            expect(container.querySelector('[data-plan-ribbon-label="0"] [data-plan-ribbon-caption]')!.textContent).toBe("34 k sheets");
            expect(hit.getAttribute("aria-label")).toBe("34 k sheets");
            fireEvent.pointerOver(hit);
            await waitFor(() => expect(document.querySelector('[data-plan-overlay="tooltip"]')?.textContent).toBe("34 k sheets"));
            fireEvent.pointerOut(hit);
            await waitFor(() => expect(document.querySelector('[data-plan-overlay="tooltip"]')).toBeNull());
        } finally {
            restore();
        }
    });

    test("a link with no quantity still draws, but prints no caption and has no tooltip (#824)", async () => {
        const restore = stubLayout();
        try {
            const { container } = renderPlan(planRoot([
                planRow("a", spanKind([run("ra", W27, JUL13, confirmed)])),
                planRow("b", spanKind([run("rb", JUL13, JUL27, confirmed)])),
            ], { links: [{ ...link("a", "ra", "b", "rb"), quantity: none }] }), "plan-824-bare");
            focusLinks(container, "a");
            // It weighs 1.5 (#1258).
            expect(container.querySelector('[data-plan-link="0"] [data-plan-ribbon-band]')!.getAttribute("stroke-width")).toBe("1.5");
            expect(container.querySelector("[data-plan-ribbon-caption]")).toBeNull();
            const hit = container.querySelector('[data-link="0"]')!;
            expect(hit.hasAttribute("aria-label")).toBe(false);
            // Past the tooltip's open delay: nothing opened.
            fireEvent.pointerOver(hit);
            await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
            expect(document.querySelector('[data-plan-overlay="tooltip"]')).toBeNull();
        } finally {
            restore();
        }
    });

    test("a link is cased in the paper, its caption sits on a knockout, and an end past the window lands in a dashed slot (#1258)", () => {
        const restore = stubLayout();
        try {
            // b's run starts after the window's end (W39).
            const { container } = renderPlan(planRoot([
                planRow("a", spanKind([run("ra", W27, JUL13, confirmed)])),
                planRow("b", spanKind([run("rb", new Date("2026-10-05Z"), new Date("2026-10-19Z"), confirmed)])),
            ], { links: [link("a", "ra", "b", "rb")] }), "plan-1258-ink");
            focusLinks(container, "a");
            // The casing: the paper 1 either side of the 6 weight, under the ink.
            const casing = container.querySelector('[data-plan-ribbon-casing="0"] [data-plan-casing="band"]')!;
            expect(casing.getAttribute("stroke-width")).toBe("8");
            expect(casing.getAttribute("d")).toBe(container.querySelector('[data-plan-link="0"] [data-plan-ribbon-band]')!.getAttribute("d"));
            // The caption's knockout: 12 tall, starting 9.5 above its text's
            // baseline, 4 either side of it (jsdom measures no text).
            const caption = container.querySelector('[data-plan-ribbon-caption]')!;
            const knockout = caption.previousElementSibling!;
            expect(knockout.getAttribute("data-plan-ribbon-knockout")).not.toBeNull();
            expect(Number(knockout.getAttribute("height"))).toBe(12);
            expect(Number(knockout.getAttribute("y"))).toBe(Number(caption.getAttribute("y")) - 9.5);
            expect(Number(knockout.getAttribute("width"))).toBe(8);
            // b's end lands on the plot's right edge (240 + 1000) in a slot
            // 40 wide and as tall as its bar, open toward the edge — b under
            // the Downstream band, its bar 115.5 to 135.5.
            const slot = container.querySelector('[data-plan-linkslot="right"]')!;
            expect(slot.getAttribute("d")).toBe("M 1240 115.5 H 1200 V 135.5 H 1240");
            expect(tipOf(container.querySelector('[data-plan-link="0"] [data-plan-ribbon-head]')!.getAttribute("d")!)).toEqual([1240, 125.5]);
        } finally {
            restore();
        }
    });

    test("a ribbon click reports the link's ref to onElementClick and opens the root's popover for it (#824)", async () => {
        const restore = stubLayout();
        try {
            const seen: unknown[] = [];
            const popover = (ref: PlanElementRefValue) => (ref.type === "link"
                ? some(variant("Text", { value: `LINK · ${ref.value.key}`, style: none }))
                : none);
            const { container } = renderPlan(planRoot([
                planRow("a", spanKind([run("ra", W27, JUL13, confirmed)])),
                planRow("b", spanKind([run("rb", JUL13, JUL27, confirmed)])),
            ], {
                links: [link("a", "ra", "b", "rb")],
                popover,
                onElementClick: (ref: unknown) => { seen.push(ref); },
            }), "plan-824-link-click");
            focusLinks(container, "a");
            const selected = () => [...container.querySelectorAll("[data-plan-row][data-selected]")]
                .map((el) => testKeyOf(el.getAttribute("data-plan-row")!));
            const before = selected();
            fireEvent.click(container.querySelector('[data-link="0"]')!);
            // The popover resolves the ref the hit path names...
            expect(await screen.findByText("LINK · ra>rb")).toBeTruthy();
            // ...and the click reports the same ref: the link's key and its two runs.
            await waitFor(() => expect(seen).toHaveLength(1));
            expect(seen[0]).toEqual(variant("link", { key: "ra>rb", from: { row: rowId("a"), run: "ra" }, to: { row: rowId("b"), run: "rb" } }));
            // A ribbon belongs to no row: the click leaves the selection as it was.
            expect(selected()).toEqual(before);
        } finally {
            restore();
        }
    });
});

describe("Plan expand-in-place (R2)", () => {
    test("the control opens the render; neighbours COMPRESS rather than disappear; esc returns", () => {
        const { container } = renderPlan(planRoot([
            planRow("h4p13", spanKind([run("rb", W27, new Date("2026-07-27Z"), variant("actual", null))]), {
                expand: { height: some("152px"), axis: variant("dim", null) },
            }),
            planRow("h4p14", spanKind([])),
        ], {
            // The render is the ROOT's resolver, called with the row's id (#822).
            expandRender: (id: PlanRowId) =>
                variant("Text", { value: `UTIL RENDER · ${id.value.path.join("/")}`, style: none }),
        }));
        // Only the declaring row grows the control.
        expect(container.querySelector(`${rowSel("h4p13")} [data-plan-control="expand"]`)).toBeTruthy();
        expect(container.querySelector(`${rowSel("h4p14")} [data-plan-control="expand"]`)).toBeNull();

        fireEvent.click(container.querySelector('[data-plan-control="expand"]')!);
        expect(container.querySelector('[data-plan-focusbar="expand"]')).toBeTruthy();
        expect(screen.getByText("EXPANDED · h4p13")).toBeTruthy();
        // The focused row keeps its NORMAL anatomy, with the axis treatment on
        // its own plot; the render mounts as its own body item beneath it.
        const focal = container.querySelector(rowSel("h4p13")) as HTMLElement;
        expect(focal).toBeTruthy();
        expect(focal.hasAttribute("data-ctx")).toBe(false);
        // The row EXPANDS to hold the render — the render is inside the focal
        // row's plot cell, not a sibling, so the gutter grows with it.
        expect(focal.hasAttribute("data-expanded")).toBe(true);
        const region = focal.querySelector("[data-plan-expandrender]") as HTMLElement;
        expect(region).toBeTruthy();
        expect(screen.getByText("UTIL RENDER · h4p13")).toBeTruthy();
        expect(container.querySelector(`${rowSel("h4p13")} [data-axis="dim"]`)).toBeTruthy();

        // ── The #591 contract: COLLAPSE, NEVER REMOVE ──
        // The neighbour is still mounted, still in order, wearing the strip.
        const ctxRow = container.querySelector(rowSel("h4p14")) as HTMLElement;
        expect(ctxRow).toBeTruthy();
        expect(ctxRow.hasAttribute("data-ctx")).toBe(true);
        // ...and it is BELOW the focal row and its render, not reordered.
        const order = [...container.querySelectorAll("[data-plan-row]")]
            .map((el) => testKeyOf(el.getAttribute("data-plan-row")!));
        expect(order).toEqual(["h4p13", "h4p14"]);

        fireEvent.keyDown(keySurface(container), { key: "Escape" });
        expect(container.querySelector("[data-plan-expandrender]")).toBeNull();
        expect(container.querySelector(rowSel("h4p13"))!.hasAttribute("data-expanded")).toBe(false);
        expect(container.querySelector(rowSel("h4p14"))!.hasAttribute("data-ctx")).toBe(false);
    });

    test("a strip is the return click target — clicking one leaves the focus, never selects it", () => {
        const { container } = renderPlan(planRoot([
            planRow("focal", spanKind([]), { expand: { height: none, axis: variant("keep", null) } }),
            planRow("other", spanKind([])),
        ], {
            expandRender: (id: PlanRowId) =>
                variant("Text", { value: `R · ${id.value.path.join("/")}`, style: none }),
        }));
        fireEvent.click(container.querySelector('[data-plan-control="expand"]')!);
        const strip = container.querySelector(rowSel("other")) as HTMLElement;
        expect(strip.hasAttribute("data-ctx")).toBe(true);
        fireEvent.click(strip);
        expect(container.querySelector('[data-plan-focusbar="expand"]')).toBeNull();
        // Returning is ALL it does — the strip does not select the row under it.
        expect(strip.hasAttribute("data-selected")).toBe(false);
    });

    test("marks survive the strip: geometry shrinks, shape shrinks, values re-encode", () => {
        const { container } = renderPlan(planRoot([
            planRow("focal", spanKind([]), { expand: { height: none, axis: variant("keep", null) } }),
            planRow("s", spanKind([run("r1", W27, new Date("2026-07-13Z"), variant("actual", null))])),
            planRow("e", variant("events", { marks: [{
                key: "m1", at: t(W27), kind: variant("milestone", null), status: none, icon: none, label: some("KICKOFF"),
            }] })),
            planRow("ontime", variant("chart", {
                layers: [variant("line", {
                    points: [{ t: t(W27), y: 94 }, { t: t(new Date("2026-08-31Z")), y: 101 }],
                    axis: variant("left", null), breach: none, fold: variant("mean", null),
                    style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none },
                })],
                left: some({ domain: none, tickValues: some(variant("number", [80])), format: none }),
                right: none, height: variant("spark", null), expandedHeight: none, expandable: false,
            })),
        ], {
            expandRender: (id: PlanRowId) =>
                variant("Text", { value: `R · ${id.value.path.join("/")}`, style: none }),
        }));
        // At rest the chart row draws its marks and its gridline: a spark reads its scale by its gridlines (#1750).
        expect(container.querySelector(`${rowSel("ontime")} [data-plan-mark="line"]`)).toBeTruthy();
        expect(container.querySelector(`${rowSel("ontime")} [data-plan-gridline]`)).toBeTruthy();
        fireEvent.click(container.querySelector('[data-plan-control="expand"]')!);
        // R2 — values RE-ENCODE: the strip is a tone strip, so there is no SVG
        // to squash and no value axis to label in 16px — the ticks go with it.
        expect(container.querySelector(rowSel("ontime"))!.hasAttribute("data-ctx")).toBe(true);
        expect(container.querySelector(`${rowSel("ontime")} [data-plan-mark="line"]`)).toBeNull();
        expect(container.querySelector(`${rowSel("ontime")} [data-plan-gridline]`)).toBeNull();
        expect(container.querySelector(`${rowSel("ontime")} [data-plan-tickpx]`)).toBeNull();
        // R1 — the span bar is still there, still positioned, flagged for 7px.
        const bar = container.querySelector(`${rowSel("s")} [data-run="r1"]`) as HTMLElement;
        expect(bar).toBeTruthy();
        expect(bar.hasAttribute("data-ctx")).toBe(true);
        // R3 — the milestone keeps its silhouette; its label does not.
        const dot = container.querySelector(`${rowSel("e")} [data-mark="m1"]`) as HTMLElement;
        expect(dot).toBeTruthy();
        expect(dot.hasAttribute("data-ctx")).toBe(true);
    });

    test("an expandable chart has no caret: its expand control is its toggle — spark ↔ chart where it declares no render, and where it does, the render opens with its chart drawn expanded in its band (#1680's review)", () => {
        // A line over 100 at its last point: a chart drawn expanded outlines the breach, a spark does not.
        const chart = () => variant("chart", {
            layers: [variant("line", {
                points: [{ t: t(W27), y: 94 }, { t: t(new Date("2026-08-31Z")), y: 101 }],
                axis: variant("left", null), breach: some(variant("above", 100)), fold: variant("mean", null),
                style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none },
            })],
            left: none, right: none, height: variant("spark", null), expandedHeight: none, expandable: true,
        });
        const { container } = renderPlan(planRoot([
            planRow("ontime", chart(), { expand: { height: some("120px"), axis: variant("keep", null) } }),
            planRow("spark", chart()),
        ], {
            expandRender: (id: PlanRowId) => variant("Text", { value: `R · ${id.value.path.join("/")}`, style: none }),
        }), "plan-1680-chart-expand");
        const row = (key: string) => container.querySelector(rowSel(key)) as HTMLElement;
        const viewBox = (key: string) => row(key).querySelector('[data-plan-mark="line"]')!.closest("svg")!.getAttribute("viewBox");
        const control = (key: string) => row(key).querySelector<HTMLElement>('[data-plan-control="expand"]')!;
        const outlined = (key: string) => row(key).querySelectorAll('[data-plan-mark="breach-rect"]').length > 0;
        // Carets only fold: neither chart draws one, and a click on its gutter selects it, never toggles it.
        expect([...container.querySelectorAll("[role='rowheader'] [data-icon='caret-down']")]).toEqual([]);
        fireEvent.click(row("spark").querySelector("[role='rowheader']")!);
        // A row's plot is the row less its rule (#1750): a 32px spark draws in 31.
        expect([viewBox("spark"), row("spark").hasAttribute("data-selected")]).toEqual(["0 0 1000 31", true]);
        // With no render, its expand control toggles spark ↔ chart, and says so.
        expect([control("spark").getAttribute("aria-pressed"), row("spark").getAttribute("aria-expanded")]).toEqual(["false", "false"]);
        fireEvent.click(control("spark"));
        expect([viewBox("spark"), control("spark").getAttribute("aria-pressed"), row("spark").getAttribute("aria-expanded"), outlined("spark")])
            .toEqual(["0 0 1000 87", "true", "true", true]);
        fireEvent.click(control("spark"));
        expect([viewBox("spark"), outlined("spark")]).toEqual(["0 0 1000 31", false]);
        // With a render, the control opens it — and the chart draws expanded in its band, the row its band and the render.
        expect(outlined("ontime")).toBe(false);
        fireEvent.click(control("ontime"));
        expect(container.querySelector('[data-plan-focusbar="expand"]')).toBeTruthy();
        expect([viewBox("ontime"), row("ontime").getAttribute("data-plan-h"), outlined("ontime")]).toEqual(["0 0 1000 88", String(88 + 120), true]);
        fireEvent.keyDown(keySurface(container), { key: "Escape" });
        expect([viewBox("ontime"), row("ontime").getAttribute("data-plan-h"), outlined("ontime")]).toEqual(["0 0 1000 31", "32", false]);
    });

    test("a focus-expanded CHART row scales its plot to the BAND, not the grown row (#591)", () => {
        // The focal row grows to hold its render, but its marks keep the band
        // at the top. The plot's y-scale (the SVG viewBox), the ≥48px
        // ref-label gate and the gutter ticks all used to answer to the GROWN
        // row height: a 272px scale squashed into a 32px band, a spark row
        // suddenly printed its ref label, and the ticks drifted down the tall
        // gutter cell. All three read the band now.
        const { container } = renderPlan(planRoot([
            planRow("ontime", variant("chart", {
                layers: [
                    variant("line", {
                        points: [{ t: t(W27), y: 94 }, { t: t(new Date("2026-08-31Z")), y: 101 }],
                        axis: variant("left", null), breach: none, fold: variant("mean", null),
                        style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none },
                    }),
                    variant("refLine", { y: 100, axis: variant("left", null), label: some("TARGET 100"), dash: none, color: none }),
                ],
                left: some({
                    domain: some(variant("number", { min: 80, max: 110 })),
                    tickValues: some(variant("number", [80])),
                    format: none,
                }),
                right: none,
                height: variant("spark", null), expandedHeight: none, expandable: false,
            }), { expand: { height: some("240px"), axis: variant("keep", null) } }),
            planRow("other", spanKind([])),
        ], {
            expandRender: (id: PlanRowId) =>
                variant("Text", { value: `R · ${id.value.path.join("/")}`, style: none }),
        }), "plan-591-chart-band");
        // The plot SVG is the one holding the line — the gutter's control
        // icon is an SVG too.
        const plotSvg = () => container.querySelector(`${rowSel("ontime")} [data-plan-mark="line"]`)!.closest("svg")!;
        const tick = () => container.querySelector(`${rowSel("ontime")} [data-plan-tickpx]`);
        const gridline = () => container.querySelector(`${rowSel("ontime")} [data-plan-gridline]`)!.getAttribute("y1");
        // At rest: a 32px spark, its plot the row less its rule — 31px. The
        // scale's floor sits 4px above the plot's foot, at 27; too shallow for
        // the ref label, and for a number: its gridline reads its scale (#1750).
        expect(plotSvg().getAttribute("viewBox")).toBe("0 0 1000 31");
        expect([tick(), gridline()]).toEqual([null, "27"]);
        expect(screen.queryByText("TARGET 100")).toBeNull();

        fireEvent.click(container.querySelector(`${rowSel("ontime")} [data-plan-control="expand"]`)!);
        const focal = container.querySelector(rowSel("ontime")) as HTMLElement;
        expect(focal.hasAttribute("data-expanded")).toBe(true);
        expect(focal.querySelector("[data-plan-expandrender]")).toBeTruthy();
        // The ROW grew (32 + 240); the band did not — and the plot, its
        // gridline and the label gate all scale against the band, 32px tall.
        expect(plotSvg().getAttribute("viewBox")).toBe("0 0 1000 32");
        expect([tick(), gridline()]).toEqual([null, "28"]);
        expect(screen.queryByText("TARGET 100")).toBeNull();
    });

    test("a focus-expanded chart row's gutter axis stands in its band, never the grown row (#1750)", () => {
        // An 88px chart, its tick at 80 on its floor, 10.5 above its plot's
        // foot: 76.5 down the 87px plot at rest, 77.5 down its 88px band —
        // clear of the first line the pressed control holds, so it is drawn.
        const { container } = renderPlan(planRoot([
            planRow("ontime", variant("chart", {
                layers: [variant("line", {
                    points: [{ t: t(W27), y: 94 }, { t: t(new Date("2026-08-31Z")), y: 101 }],
                    axis: variant("left", null), breach: none, fold: variant("mean", null),
                    style: { label: none, color: none, curve: none, width: none, dash: none, dots: false, fillOpacity: none, opacity: none, size: none, stack: none, legend: true, tooltip: true, order: none },
                })],
                left: some({ domain: none, tickValues: some(variant("number", [80])), format: none }),
                right: none,
                height: variant("expanded", null), expandedHeight: none, expandable: false,
            }), { expand: { height: some("240px"), axis: variant("keep", null) } }),
            planRow("other", spanKind([])),
        ], {
            expandRender: (id: PlanRowId) =>
                variant("Text", { value: `R · ${id.value.path.join("/")}`, style: none }),
        }), "plan-1750-chart-band");
        const tick = () => container.querySelector<HTMLElement>(`${rowSel("ontime")} [data-plan-tickpx]`)!;
        expect([tick().getAttribute("data-plan-tickpx"), tick().textContent, tick().parentElement!.style.height]).toEqual(["76.5", "80", ""]);
        fireEvent.click(container.querySelector(`${rowSel("ontime")} [data-plan-control="expand"]`)!);
        expect(container.querySelector(rowSel("ontime"))!.getAttribute("data-plan-h")).toBe(String(88 + 240));
        // Its column is the band's height, and the label its tick's share of it.
        expect([tick().getAttribute("data-plan-tickpx"), tick().parentElement!.style.height, tick().style.top])
            .toEqual(["77.5", "88px", `${(77.5 / 88) * 100}%`]);
    });
});
