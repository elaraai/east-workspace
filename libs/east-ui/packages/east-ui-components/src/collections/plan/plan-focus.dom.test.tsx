/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Plan row-focus DOM tests — the links focus (R1: rails, gap bands,
 * ribbons) and expand-in-place (R2: the focused row's render and its context
 * strips).
 *
 * (Split out of `plan.dom.test.tsx`, #815: every test moved verbatim.)
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { variant, some, none } from "@elaraai/east";
import { system } from "../../theme/index.js";
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

describe("Plan links focus (R1)", () => {
    const link = (from: string, fromRun: string, to: string, toRun: string) => ({
        fromRow: from, fromRun, toRow: to, toRun, quantity: 34, label: "34 t",
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
        expect(container.querySelector('[data-plan-row="b"] [data-plan-control="links"]')).toBeTruthy();
        expect(container.querySelector('[data-plan-row="x"] [data-plan-control="links"]')).toBeNull();

        fireEvent.click(container.querySelector('[data-plan-row="b"] [data-plan-control="links"]')!);
        // Family keeps full rows with direction tags; x collapses to a rail.
        expect(container.querySelector('[data-plan-focusbar="links"]')).toBeTruthy();
        expect(screen.getByText("LINKS · b · 1 UPSTREAM · 1 DOWNSTREAM")).toBeTruthy();
        expect(container.querySelector('[data-plan-row="a"] [data-plan-focustag="UPSTREAM"]')).toBeTruthy();
        expect(container.querySelector('[data-plan-row="c"] [data-plan-focustag="DOWNSTREAM"]')).toBeTruthy();
        expect(container.querySelector('[data-plan-rail="x"]')).toBeTruthy();
        expect(container.querySelector('[data-plan-row="x"]')).toBeNull();

        // ← ALL ROWS restores everything.
        fireEvent.click(container.querySelector("[data-plan-focusback]")!);
        expect(container.querySelector('[data-plan-rail="x"]')).toBeNull();
        expect(container.querySelector('[data-plan-row="x"]')).toBeTruthy();
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
        fireEvent.click(container.querySelector('[data-plan-row="a"] [data-plan-control="links"]')!);
        // The lone x stays an 11px rail; the y1–y3 run is ONE gap band.
        expect(container.querySelector('[data-plan-rail="x"]')).toBeTruthy();
        expect(container.querySelector('[data-plan-gap="3"]')).toBeTruthy();
        expect(container.querySelectorAll("[data-plan-gap]")).toHaveLength(1);
        expect(container.querySelector('[data-plan-row="y2"]')).toBeNull();

        fireEvent.click(container.querySelector("[data-plan-gap]")!);
        expect(container.querySelector("[data-plan-gap]")).toBeNull();
        expect(container.querySelector('[data-plan-row="y2"]')).toBeTruthy();
    });

    test("a rail click returns; esc walks the focus rung", () => {
        const { container } = renderPlan(planRoot([
            planRow("a", spanKind([run("ra", W27, new Date("2026-07-13Z"), variant("actual", null))])),
            planRow("x", spanKind([])),
        ], { links: [link("a", "ra", "a", "ra")] }));
        fireEvent.click(container.querySelector('[data-plan-control="links"]')!);
        expect(container.querySelector('[data-plan-rail="x"]')).toBeTruthy();
        fireEvent.click(container.querySelector('[data-plan-rail="x"]')!);
        expect(container.querySelector('[data-plan-rail="x"]')).toBeNull();

        fireEvent.click(container.querySelector('[data-plan-control="links"]')!);
        fireEvent.keyDown(container.querySelector('[tabindex="0"]')!, { key: "Escape" });
        expect(container.querySelector('[data-plan-rail="x"]')).toBeNull();
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
            // The render is the ROOT's resolver, called with the row ref.
            expandRender: (ref: { key: string }) =>
                variant("Text", { value: `UTIL RENDER · ${ref.key}`, style: none }),
        }));
        // Only the declaring row grows the control.
        expect(container.querySelector('[data-plan-row="l4m13"] [data-plan-control="expand"]')).toBeTruthy();
        expect(container.querySelector('[data-plan-row="l4m14"] [data-plan-control="expand"]')).toBeNull();

        fireEvent.click(container.querySelector('[data-plan-control="expand"]')!);
        expect(container.querySelector('[data-plan-focusbar="expand"]')).toBeTruthy();
        expect(screen.getByText("EXPANDED · l4m13")).toBeTruthy();
        // The focused row keeps its NORMAL anatomy, with the axis treatment on
        // its own plot; the render mounts as its own body item beneath it.
        const focal = container.querySelector('[data-plan-row="l4m13"]') as HTMLElement;
        expect(focal).toBeTruthy();
        expect(focal.hasAttribute("data-ctx")).toBe(false);
        // The row EXPANDS to hold the render — the render is inside the focal
        // row's plot cell, not a sibling, so the gutter grows with it.
        expect(focal.hasAttribute("data-expanded")).toBe(true);
        const region = focal.querySelector("[data-plan-expandrender]") as HTMLElement;
        expect(region).toBeTruthy();
        expect(screen.getByText("UTIL RENDER · l4m13")).toBeTruthy();
        expect(container.querySelector('[data-plan-row="l4m13"] [data-axis="dim"]')).toBeTruthy();

        // ── The #591 contract: COLLAPSE, NEVER REMOVE ──
        // The neighbour is still mounted, still in order, wearing the strip.
        const ctxRow = container.querySelector('[data-plan-row="l4m14"]') as HTMLElement;
        expect(ctxRow).toBeTruthy();
        expect(ctxRow.hasAttribute("data-ctx")).toBe(true);
        // ...and it is BELOW the focal row and its render, not reordered.
        const order = [...container.querySelectorAll("[data-plan-row]")]
            .map((el) => el.getAttribute("data-plan-row"));
        expect(order).toEqual(["l4m13", "l4m14"]);

        fireEvent.keyDown(container.querySelector('[tabindex="0"]')!, { key: "Escape" });
        expect(container.querySelector("[data-plan-expandrender]")).toBeNull();
        expect(container.querySelector('[data-plan-row="l4m13"]')!.hasAttribute("data-expanded")).toBe(false);
        expect(container.querySelector('[data-plan-row="l4m14"]')!.hasAttribute("data-ctx")).toBe(false);
    });

    test("a strip is the return click target — clicking one leaves the focus, never selects it", () => {
        const { container } = renderPlan(planRoot([
            planRow("focal", spanKind([]), { expand: { height: none, axis: variant("keep", null) } }),
            planRow("other", spanKind([])),
        ], {
            expandRender: (ref: { key: string }) =>
                variant("Text", { value: `R · ${ref.key}`, style: none }),
        }));
        fireEvent.click(container.querySelector('[data-plan-control="expand"]')!);
        const strip = container.querySelector('[data-plan-row="other"]') as HTMLElement;
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
                    axis: variant("left", null), breach: none,
                })],
                left: some({ domain: none, tickValues: some(variant("number", [80])), format: none }),
                right: none, height: variant("spark", null), expandedHeight: none, expandable: none,
            })),
        ], {
            expandRender: (ref: { key: string }) =>
                variant("Text", { value: `R · ${ref.key}`, style: none }),
        }));
        // At rest the chart row draws its marks and prints its axis.
        expect(container.querySelector('[data-plan-row="cov"] [data-plan-mark="line"]')).toBeTruthy();
        expect(container.querySelector('[data-plan-row="cov"] [data-plan-tickpx]')).toBeTruthy();
        fireEvent.click(container.querySelector('[data-plan-control="expand"]')!);
        // R2 — values RE-ENCODE: the strip is a tone strip, so there is no SVG
        // to squash and no value axis to label in 16px — the ticks go with it.
        expect(container.querySelector('[data-plan-row="cov"]')!.hasAttribute("data-ctx")).toBe(true);
        expect(container.querySelector('[data-plan-row="cov"] [data-plan-mark="line"]')).toBeNull();
        expect(container.querySelector('[data-plan-row="cov"] [data-plan-tickpx]')).toBeNull();
        // R1 — the span bar is still there, still positioned, flagged for 7px.
        const bar = container.querySelector('[data-plan-row="s"] [data-run="r1"]') as HTMLElement;
        expect(bar).toBeTruthy();
        expect(bar.hasAttribute("data-ctx")).toBe(true);
        // R3 — the milestone keeps its silhouette; its label does not.
        const dot = container.querySelector('[data-plan-row="e"] [data-mark="m1"]') as HTMLElement;
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
                        axis: variant("left", null), breach: none,
                    }),
                    variant("refLine", { y: 100, axis: variant("left", null), label: some("TARGET 100") }),
                ],
                left: some({
                    domain: some(variant("number", { min: 80, max: 110 })),
                    tickValues: some(variant("number", [80])),
                    format: none,
                }),
                right: none,
                height: variant("spark", null), expandedHeight: none, expandable: none,
            }), { expand: { height: some("240px"), axis: variant("keep", null) } }),
            planRow("other", spanKind([])),
        ], {
            expandRender: (ref: { key: string }) =>
                variant("Text", { value: `R · ${ref.key}`, style: none }),
        }), "plan-591-chart-band");
        // The plot SVG is the one holding the line — the gutter's control
        // icon is an SVG too.
        const plotSvg = () => container.querySelector('[data-plan-row="cov"] [data-plan-mark="line"]')!.closest("svg")!;
        const tick = () => container.querySelector('[data-plan-row="cov"] [data-plan-tickpx]')!;
        // At rest: a 32px spark. The scale's floor sits at the 4px pad + the
        // 24px inner height = 28px; too shallow for the ref label.
        expect(plotSvg().getAttribute("viewBox")).toBe("0 0 1000 32");
        expect(tick().getAttribute("data-plan-tickpx")).toBe("28");
        expect(screen.queryByText("TARGET 100")).toBeNull();

        fireEvent.click(container.querySelector('[data-plan-row="cov"] [data-plan-control="expand"]')!);
        const focal = container.querySelector('[data-plan-row="cov"]') as HTMLElement;
        expect(focal.hasAttribute("data-expanded")).toBe(true);
        expect(focal.querySelector("[data-plan-expandrender]")).toBeTruthy();
        // The ROW grew (32 + 240); the band did not — and the plot, the tick
        // and the label gate all scale against the band.
        expect(plotSvg().getAttribute("viewBox")).toBe("0 0 1000 32");
        expect(tick().getAttribute("data-plan-tickpx")).toBe("28");
        expect(screen.queryByText("TARGET 100")).toBeNull();
    });
});
