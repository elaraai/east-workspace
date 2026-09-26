/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Plan row-focus DOM tests — the links focus (R1: rails, gap bands, and the
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
import { system } from "../../theme/index.js";
import { EastChakraPlan, type PlanRootValue } from "./index.js";
import type { PlanRowId, PlanWireRow } from "./model.js";
import type { PlanInstantValue } from "./instant.js";
import { blocksSource, oneBlock, rowId, rowIdEqual, rowSel, testKeyOf } from "./plan.test-utils.js";
import { PLAN_GEOMETRY } from "./geometry.js";
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
        status: opts?.stuck === true ? some(variant("warning", null)) : none,
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
function planRow(key: string, kind: unknown, opts?: { parent?: string; gutter?: unknown; expand?: unknown; collapsed?: boolean }): PlanWireRow {
    return {
        id: rowId(key),
        parent: opts?.parent !== undefined ? some(rowId(opts.parent)) : none,
        gutter: opts?.gutter ?? gutter(key),
        kind,
        collapsed: opts?.collapsed === true,
        pinned: false, height: none, status: none, approval: none,
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
        review: none,
        pick: opts?.pick !== undefined ? some(opts.pick) : none,
        slice: opts?.slice ?? none,
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
    /** A link keyed by the runs it joins, moving 34 t (#824: one quantity). */
    const link = (from: string, fromRun: string, to: string, toRun: string) => ({
        key: `${fromRun}>${toRun}`, from: { row: rowId(from), run: fromRun }, to: { row: rowId(to), run: toRun },
        quantity: some({ value: 34, unit: some("t"), format: none, text: none }),
    });

    test("the control gathers the TRANSITIVE family; unrelated rows rail; ← ALL ROWS returns", () => {
        const runAt = (key: string, s: Date, e: Date) => run(key, s, e, variant("confirmed", null));
        const { container } = renderPlan(planRoot([
            planRow("a", spanKind([runAt("ra", W27, new Date("2026-07-13Z"))])),
            planRow("b", spanKind([runAt("rb", new Date("2026-07-13Z"), new Date("2026-07-27Z"))])),
            planRow("c", spanKind([runAt("rc", new Date("2026-07-27Z"), new Date("2026-08-10Z"))])),
            planRow("x", spanKind([runAt("rx", W27, new Date("2026-07-13Z"))])),
        ], {
            // a → b → c is a two-hop chain: focusing b gathers BOTH.
            links: [link("a", "ra", "b", "rb"), link("b", "rb", "c", "rc")],
        }));
        // Rows an edge touches grow the links control; x has none.
        expect(container.querySelector(`${rowSel("b")} [data-plan-control="links"]`)).toBeTruthy();
        expect(container.querySelector(`${rowSel("x")} [data-plan-control="links"]`)).toBeNull();

        fireEvent.click(container.querySelector(`${rowSel("b")} [data-plan-control="links"]`)!);
        // Family keeps full rows with direction tags; x collapses to a rail.
        expect(container.querySelector('[data-plan-focusbar="links"]')).toBeTruthy();
        expect(screen.getByText("LINKS · b · 1 UPSTREAM · 1 DOWNSTREAM")).toBeTruthy();
        expect(container.querySelector(`${rowSel("a")} [data-plan-focustag="UPSTREAM"]`)).toBeTruthy();
        expect(container.querySelector(`${rowSel("c")} [data-plan-focustag="DOWNSTREAM"]`)).toBeTruthy();
        expect(container.querySelector(rowSel("x", "data-plan-rail"))).toBeTruthy();
        expect(container.querySelector(rowSel("x"))).toBeNull();

        // ← ALL ROWS restores everything.
        fireEvent.click(container.querySelector("[data-plan-focusback]")!);
        expect(container.querySelector(rowSel("x", "data-plan-rail"))).toBeNull();
        expect(container.querySelector(rowSel("x"))).toBeTruthy();
    });

    test("a RUN of unrelated rows elides to one ⋯ gap band; a lone one keeps its rail; the gap click returns", () => {
        const runAt = (key: string, s: Date, e: Date) => run(key, s, e, variant("confirmed", null));
        const { container } = renderPlan(planRoot([
            planRow("a", spanKind([runAt("ra", W27, new Date("2026-07-13Z"))])),
            planRow("x", spanKind([])),
            planRow("b", spanKind([runAt("rb", new Date("2026-07-13Z"), new Date("2026-07-27Z"))])),
            planRow("y1", spanKind([])),
            planRow("y2", spanKind([])),
            planRow("y3", spanKind([])),
        ], { links: [link("a", "ra", "b", "rb")] }));
        fireEvent.click(container.querySelector(`${rowSel("a")} [data-plan-control="links"]`)!);
        // The lone x stays an 11px rail; the y1–y3 run is ONE gap band.
        expect(container.querySelector(rowSel("x", "data-plan-rail"))).toBeTruthy();
        expect(container.querySelector('[data-plan-gap="3"]')).toBeTruthy();
        expect(container.querySelectorAll("[data-plan-gap]")).toHaveLength(1);
        expect(container.querySelector(rowSel("y2"))).toBeNull();

        fireEvent.click(container.querySelector("[data-plan-gap]")!);
        expect(container.querySelector("[data-plan-gap]")).toBeNull();
        expect(container.querySelector(rowSel("y2"))).toBeTruthy();
    });

    test("a rail click returns; esc walks the focus rung", () => {
        const { container } = renderPlan(planRoot([
            planRow("a", spanKind([run("ra", W27, new Date("2026-07-13Z"), variant("actual", null))])),
            planRow("x", spanKind([])),
        ], { links: [link("a", "ra", "a", "ra")] }));
        fireEvent.click(container.querySelector('[data-plan-control="links"]')!);
        expect(container.querySelector(rowSel("x", "data-plan-rail"))).toBeTruthy();
        fireEvent.click(container.querySelector(rowSel("x", "data-plan-rail"))!);
        expect(container.querySelector(rowSel("x", "data-plan-rail"))).toBeNull();

        fireEvent.click(container.querySelector('[data-plan-control="links"]')!);
        fireEvent.keyDown(container.querySelector('[tabindex="0"]')!, { key: "Escape" });
        expect(container.querySelector(rowSel("x", "data-plan-rail"))).toBeNull();
    });
});

describe("Plan link ribbons (#818)", () => {
    /** A link keyed by the runs it joins, moving 34 t (#824: one quantity). */
    const link = (from: string, fromRun: string, to: string, toRun: string) => ({
        key: `${fromRun}>${toRun}`, from: { row: rowId(from), run: fromRun }, to: { row: rowId(to), run: toRun },
        quantity: some({ value: 34, unit: some("t"), format: none, text: none }),
    });
    const confirmed = variant("confirmed", null);
    const JUL13 = new Date("2026-07-13Z");
    const JUL27 = new Date("2026-07-27Z");
    // The 12-week window across a 1000px plot, right of the 168px gutter.
    const xAt = (d: Date) => 168 + ((d.getTime() - W27.getTime()) / (84 * 86_400_000)) * 1000;

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
     * jsdom lays nothing out. Give the ribbon layer its width — the 168px
     * gutter and a 1000px plot — and a bounded frame its viewport and the
     * sticky header above its rows their heights (TanStack sizes the frame by
     * `offsetHeight`, the view reads `clientHeight`); every other element keeps
     * measuring 0.
     */
    function stubLayout(viewportPx = 0, headerPx = 0): () => void {
        const heightOf = (el: HTMLElement) => (el.getAttribute("data-virtual-rows") === "bounded" ? viewportPx
            : el.hasAttribute("data-plan-header") ? headerPx : 0);
        const stubs: Record<string, (el: HTMLElement) => number> = {
            clientWidth: (el) => (el.hasAttribute("data-plan-ribbons") ? 1168 : 0),
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
            // cell, the 32px row less the rule under it...
            const band = container.querySelector('[data-plan-link="0"] [data-plan-ribbon-band]')!;
            expect(band.getAttribute("d")!.startsWith(`M ${xAt(JUL13).toFixed(1)} 15.5`)).toBe(true);
            expect(band.getAttribute("stroke-width")).toBe(String(PLAN_GEOMETRY.default.bar / 2));
            // ...and arrives at b's run START, at b's bar centre (32 + 15.5).
            const head = container.querySelector('[data-plan-link="0"] [data-plan-ribbon-head]')!;
            expect(tipOf(head.getAttribute("d")!)).toEqual([Number(xAt(JUL13).toFixed(1)), 47.5]);
            // Past the old 320ms settle: still nothing measured by the layer.
            await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
            expect(measured.filter((el) => el.closest("[data-plan-body]") !== null)).toEqual([]);
        } finally {
            Element.prototype.getBoundingClientRect = rect;
            restore();
        }
    });

    test("a link to a row scrolled out of view ends in a stub pointing toward it, and follows the scroll", () => {
        // A bounded frame 140px tall under a 40px sticky header: a 100px view
        // of the rows. a, c, d, e, b stack 32px apart, so b (128–160) lies
        // past the view's bottom.
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
            // Scroll 80px: b comes into view, and a leaves it at the top — the
            // stub moves to the ribbon's start, pointing up toward a.
            const frame = container.querySelector<HTMLElement>('[data-virtual-rows="bounded"]')!;
            Object.defineProperty(frame, "scrollTop", { configurable: true, value: 80 });
            act(() => { fireEvent.scroll(frame); });
            expect(toB.querySelector('[data-plan-stub="below"]')).toBeNull();
            const up = toB.querySelector('[data-plan-stub="above"]')!;
            expect(tipOf(up.getAttribute("d")!)[1]).toBe(80);
            // A ribbon with both ends past the top — a to c, both above 80 — is not drawn.
            expect(container.querySelector('[data-plan-link="0"]')).toBeNull();
        } finally {
            restore();
        }
    });

    test("collapsing a section re-routes the ribbons in the same render", () => {
        const restore = stubLayout();
        try {
            const { container } = renderPlan(planRoot([
                planRow("a", spanKind([run("ra", W27, JUL13, confirmed)])),
                planRow("p", spanKind([run("rp", JUL13, JUL27, confirmed)])),
                planRow("p1", spanKind([]), { parent: "p" }),
                planRow("p2", spanKind([]), { parent: "p" }),
                planRow("p3", spanKind([]), { parent: "p" }),
                planRow("c", spanKind([run("rc", JUL27, new Date("2026-08-10Z"), confirmed)])),
            ], { links: [link("a", "ra", "p", "rp"), link("p", "rp", "c", "rc")] }), "plan-818-collapse");
            focusLinks(container, "p");
            const toC = () => container.querySelector('[data-plan-link="1"] [data-plan-ribbon-band]')!;
            // c sits below a, p, and the one ⋯ band standing in for p's three
            // children: its bar centre is 32 + 32 + 22 + 15.5.
            expect(container.querySelector('[data-plan-gap="3"]')).toBeTruthy();
            expect(endOf(toC().getAttribute("d")!)[1]).toBe(101.5);
            expect(toC().getAttribute("stroke-width")).toBe(String(PLAN_GEOMETRY.default.bar / 2));
            // Collapse p: its children go, and the band with them.
            fireEvent.click(container.querySelector(`${rowSel("p")} > :first-child`)!);
            expect(container.querySelector("[data-plan-gap]")).toBeNull();
            // The same render: c's end rose by the band's 22px, and p's runs
            // now draw at its rollup height, so the ribbon out of them thins.
            expect(endOf(toC().getAttribute("d")!)[1]).toBe(79.5);
            expect(toC().getAttribute("stroke-width")).toBe(String(PLAN_GEOMETRY.default.rollBar / 2));
        } finally {
            restore();
        }
    });

    test("hovering a ribbon lights it and rings the two runs it joins", () => {
        const restore = stubLayout();
        try {
            const { container } = renderPlan(planRoot([
                planRow("a", spanKind([run("ra", W27, JUL13, confirmed)])),
                planRow("b", spanKind([run("rb", JUL13, JUL27, confirmed)])),
            ], { links: [link("a", "ra", "b", "rb")] }), "plan-818-hover");
            focusLinks(container, "a");
            const g = container.querySelector('[data-plan-link="0"]')!;
            const hit = g.querySelector('[data-link="0"]')!;
            expect(g.hasAttribute("data-lit")).toBe(false);
            fireEvent.pointerEnter(hit);
            expect(g.hasAttribute("data-lit")).toBe(true);
            // The rings sit exactly on the two runs' bars: a's in row 0, b's in row 1.
            const ring = (side: string) => {
                const el = g.querySelector(`[data-plan-linkend="${side}"]`)!;
                return ["x", "y", "height"].map((k) => Number(el.getAttribute(k)));
            };
            expect(ring("from")).toEqual([168, 5.5, 20]);
            expect(ring("to")).toEqual([xAt(JUL13), 37.5, 20]);
            fireEvent.pointerLeave(hit);
            expect(g.hasAttribute("data-lit")).toBe(false);
            expect(g.querySelector("[data-plan-linkend]")).toBeNull();
        } finally {
            restore();
        }
    });

    test("the ribbons come and go without remounting a row", () => {
        // The layer is drawn in the rows' own box — which must not come and go
        // with it, or every row would remount as a focus opens and closes.
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
            // x rails — the same row, drawn another way.
            expect(container.querySelector(rowSel("x", "data-plan-rail"))).toBeTruthy();
            fireEvent.click(container.querySelector("[data-plan-focusback]")!);
            expect(container.querySelector("[data-plan-ribbons]")).toBeNull();
            expect(mounts).toEqual([]);
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
            expect(container.querySelector('[data-plan-link="0"] [data-plan-ribbon-caption]')!.textContent).toBe("34 t");
            expect(hit.getAttribute("aria-label")).toBe("34 t");
            fireEvent.pointerOver(hit);
            await waitFor(() => expect(document.querySelector('[data-plan-overlay="tooltip"]')?.textContent).toBe("34 t"));
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
            expect(container.querySelector('[data-plan-link="0"] [data-plan-ribbon-band]')).toBeTruthy();
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

    test("a ribbon click reports the link's ref to onElementClick and opens the root's popover for it (#824)", async () => {
        const restore = stubLayout();
        try {
            const seen: unknown[] = [];
            const popover = (ref: { type: string; value: { key?: string } }) => (ref.type === "link"
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
            const ref = seen[0] as { type: string; value: { key: string; from: { row: PlanRowId; run: string }; to: { row: PlanRowId; run: string } } };
            expect(ref.type).toBe("link");
            expect(ref.value.key).toBe("ra>rb");
            expect(rowIdEqual(ref.value.from.row, rowId("a"))).toBe(true);
            expect(ref.value.from.run).toBe("ra");
            expect(rowIdEqual(ref.value.to.row, rowId("b"))).toBe(true);
            expect(ref.value.to.run).toBe("rb");
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
            planRow("l4m13", spanKind([run("rb", W27, new Date("2026-07-27Z"), variant("actual", null))]), {
                expand: { height: some("152px"), axis: variant("dim", null) },
            }),
            planRow("l4m14", spanKind([])),
        ], {
            // The render is the ROOT's resolver, called with the row's id (#822).
            expandRender: (id: PlanRowId) =>
                variant("Text", { value: `UTIL RENDER · ${id.value.path.join("/")}`, style: none }),
        }));
        // Only the declaring row grows the control.
        expect(container.querySelector(`${rowSel("l4m13")} [data-plan-control="expand"]`)).toBeTruthy();
        expect(container.querySelector(`${rowSel("l4m14")} [data-plan-control="expand"]`)).toBeNull();

        fireEvent.click(container.querySelector('[data-plan-control="expand"]')!);
        expect(container.querySelector('[data-plan-focusbar="expand"]')).toBeTruthy();
        expect(screen.getByText("EXPANDED · l4m13")).toBeTruthy();
        // The focused row keeps its NORMAL anatomy, with the axis treatment on
        // its own plot; the render mounts as its own body item beneath it.
        const focal = container.querySelector(rowSel("l4m13")) as HTMLElement;
        expect(focal).toBeTruthy();
        expect(focal.hasAttribute("data-ctx")).toBe(false);
        // The row EXPANDS to hold the render — the render is inside the focal
        // row's plot cell, not a sibling, so the gutter grows with it.
        expect(focal.hasAttribute("data-expanded")).toBe(true);
        const region = focal.querySelector("[data-plan-expandrender]") as HTMLElement;
        expect(region).toBeTruthy();
        expect(screen.getByText("UTIL RENDER · l4m13")).toBeTruthy();
        expect(container.querySelector(`${rowSel("l4m13")} [data-axis="dim"]`)).toBeTruthy();

        // ── The #591 contract: COLLAPSE, NEVER REMOVE ──
        // The neighbour is still mounted, still in order, wearing the strip.
        const ctxRow = container.querySelector(rowSel("l4m14")) as HTMLElement;
        expect(ctxRow).toBeTruthy();
        expect(ctxRow.hasAttribute("data-ctx")).toBe(true);
        // ...and it is BELOW the focal row and its render, not reordered.
        const order = [...container.querySelectorAll("[data-plan-row]")]
            .map((el) => testKeyOf(el.getAttribute("data-plan-row")!));
        expect(order).toEqual(["l4m13", "l4m14"]);

        fireEvent.keyDown(container.querySelector('[tabindex="0"]')!, { key: "Escape" });
        expect(container.querySelector("[data-plan-expandrender]")).toBeNull();
        expect(container.querySelector(rowSel("l4m13"))!.hasAttribute("data-expanded")).toBe(false);
        expect(container.querySelector(rowSel("l4m14"))!.hasAttribute("data-ctx")).toBe(false);
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
                key: "m1", at: t(W27), kind: variant("milestone", null), icon: none, label: some("KICKOFF"),
            }] })),
            planRow("cov", variant("chart", {
                layers: [variant("line", {
                    points: [{ t: t(W27), y: 94 }, { t: t(new Date("2026-08-31Z")), y: 101 }],
                    axis: variant("left", null), breach: none, fold: variant("mean", null),
                })],
                left: some({ domain: none, tickValues: some(variant("number", [80])), format: none }),
                right: none, height: variant("spark", null), expandedHeight: none, expandable: false,
            })),
        ], {
            expandRender: (id: PlanRowId) =>
                variant("Text", { value: `R · ${id.value.path.join("/")}`, style: none }),
        }));
        // At rest the chart row draws its marks and prints its axis.
        expect(container.querySelector(`${rowSel("cov")} [data-plan-mark="line"]`)).toBeTruthy();
        expect(container.querySelector(`${rowSel("cov")} [data-plan-tickpx]`)).toBeTruthy();
        fireEvent.click(container.querySelector('[data-plan-control="expand"]')!);
        // R2 — values RE-ENCODE: the strip is a tone strip, so there is no SVG
        // to squash and no value axis to label in 16px — the ticks go with it.
        expect(container.querySelector(rowSel("cov"))!.hasAttribute("data-ctx")).toBe(true);
        expect(container.querySelector(`${rowSel("cov")} [data-plan-mark="line"]`)).toBeNull();
        expect(container.querySelector(`${rowSel("cov")} [data-plan-tickpx]`)).toBeNull();
        // R1 — the span bar is still there, still positioned, flagged for 7px.
        const bar = container.querySelector(`${rowSel("s")} [data-run="r1"]`) as HTMLElement;
        expect(bar).toBeTruthy();
        expect(bar.hasAttribute("data-ctx")).toBe(true);
        // R3 — the milestone keeps its silhouette; its label does not.
        const dot = container.querySelector(`${rowSel("e")} [data-mark="m1"]`) as HTMLElement;
        expect(dot).toBeTruthy();
        expect(dot.hasAttribute("data-ctx")).toBe(true);
    });

    test("a focus-expanded CHART row scales its plot to the BAND, not the grown row (#591)", () => {
        // The focal row grows to hold its render, but its marks keep the band
        // at the top. The plot's y-scale (the SVG viewBox), the ≥48px
        // ref-label gate and the gutter ticks all used to answer to the GROWN
        // row height: a 272px scale squashed into a 32px band, a spark row
        // suddenly printed its ref label, and the ticks drifted down the tall
        // gutter cell. All three read the band now.
        const { container } = renderPlan(planRoot([
            planRow("cov", variant("chart", {
                layers: [
                    variant("line", {
                        points: [{ t: t(W27), y: 94 }, { t: t(new Date("2026-08-31Z")), y: 101 }],
                        axis: variant("left", null), breach: none, fold: variant("mean", null),
                    }),
                    variant("refLine", { y: 100, axis: variant("left", null), label: some("TARGET 100") }),
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
        const plotSvg = () => container.querySelector(`${rowSel("cov")} [data-plan-mark="line"]`)!.closest("svg")!;
        const tick = () => container.querySelector(`${rowSel("cov")} [data-plan-tickpx]`)!;
        // At rest: a 32px spark. The scale's floor sits at the 4px pad + the
        // 24px inner height = 28px; too shallow for the ref label.
        expect(plotSvg().getAttribute("viewBox")).toBe("0 0 1000 32");
        expect(tick().getAttribute("data-plan-tickpx")).toBe("28");
        expect(screen.queryByText("TARGET 100")).toBeNull();

        fireEvent.click(container.querySelector(`${rowSel("cov")} [data-plan-control="expand"]`)!);
        const focal = container.querySelector(rowSel("cov")) as HTMLElement;
        expect(focal.hasAttribute("data-expanded")).toBe(true);
        expect(focal.querySelector("[data-plan-expandrender]")).toBeTruthy();
        // The ROW grew (32 + 240); the band did not — and the plot, the tick
        // and the label gate all scale against the band.
        expect(plotSvg().getAttribute("viewBox")).toBe("0 0 1000 32");
        expect(tick().getAttribute("data-plan-tickpx")).toBe("28");
        expect(screen.queryByText("TARGET 100")).toBeNull();
    });
});
