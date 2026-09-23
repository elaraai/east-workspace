/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Plan render-cost DOM tests — the row layer's memo (#616), O(rows) DOM
 * (#616), overscan (#619), and the ephemeral UI state surviving a data commit
 * (#610).
 *
 * (Split out of `plan.dom.test.tsx`, #815: every test moved verbatim.)
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { variant, some, none } from "@elaraai/east";
import { system } from "../../theme/index.js";
import { EastChakraPlan, type PlanRootValue, type PlanRowValue } from "./index.js";
import { setBodyRowRenderProbe } from "./rows/BodyRow.js";
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

describe("Plan row-layer memoization (#616)", () => {
    test("a selection click re-renders O(changed rows); a chart toggle exactly one", () => {
        // The render probe records WHICH rows ran — the memo property is
        // asserted deterministically, never inferred from profiler timings.
        const rendered: string[] = [];
        setBodyRowRenderProbe((key) => rendered.push(key));
        try {
            const { container } = renderPlan(planRoot([
                planRow("m1", spanKind([])),
                planRow("m2", spanKind([])),
                planRow("m3", spanKind([])),
                planRow("cov", variant("chart", {
                    layers: [], left: none, right: none,
                    height: variant("spark", null), expandedHeight: none,
                    expandable: some(true),
                })),
            ]), "plan-616-memo");
            // First selection: ONLY the newly-selected row re-renders — the
            // other rows' facts did not move, so their memo bails.
            rendered.length = 0;
            fireEvent.click(container.querySelector('[data-plan-row="m2"]')!);
            expect(rendered).toEqual(["m2"]);
            // Moving the selection re-renders exactly the two rows whose
            // `selected` fact changed.
            rendered.length = 0;
            fireEvent.click(container.querySelector('[data-plan-row="m3"]')!);
            expect([...rendered].sort()).toEqual(["m2", "m3"]);
            // A chart spark↔expanded toggle re-renders exactly the toggled
            // row (its `chartExpanded` + height moved; nothing else did).
            rendered.length = 0;
            fireEvent.click(container.querySelector('[data-plan-row="cov"]')!.children[0]!);
            expect(rendered).toEqual(["cov"]);
        } finally {
            setBodyRowRenderProbe(undefined);
        }
    });
});

describe("Plan DOM scale (#616)", () => {
    test("separator DOM is O(rows): ONE gradient element per row on a uniform axis", () => {
        const { container } = renderPlan(planRoot([
            planRow("m1", spanKind([])),
            planRow("m2", spanKind([])),
            planRow("m3", spanKind([])),
        ]), "plan-616-sep");
        // 12 equal week buckets → one separator element per row, where the
        // per-edge divs were 11 per row (33 across this canvas, ~50k at
        // 100 rows × 500 hour buckets).
        expect(container.querySelectorAll("[data-plan-gridsep]")).toHaveLength(3);
    });

    test("bucket cells mount only where OCCUPIED; the empty wash is one band per lane", () => {
        const { container } = renderPlan(planRoot([
            planRow("dock", variant("buckets", {
                lanes: [],
                events: [
                    bucketEvent("e1", new Date("2026-06-29Z"), variant("actual", null)),
                    bucketEvent("e2", new Date("2026-07-06Z"), variant("confirmed", null)),
                ],
                markers: [{ at: t(new Date("2026-07-20Z")), lane: none, status: variant("danger", null), message: "short" }],
            })),
        ]), "plan-616-cells");
        // 12 buckets: 2 event cells + 1 marker cell mount — not 12 — and the
        // empty-cell wash paints as one gradient band.
        expect(container.querySelectorAll("[data-plan-cell]")).toHaveLength(3);
        expect(container.querySelectorAll("[data-plan-cellwash]")).toHaveLength(1);
        // The marker cell still rings and pins its icon.
        expect(container.querySelector('[data-over="danger"]')).toBeTruthy();
        // A CAPTIONED lane keeps its full grid (the caption prints per cell —
        // the Planner `.bl`) — covered by the lanes test above.
    });
});

describe("Plan overscan (#619)", () => {
    test("marks wholly inside the overscan MOUNT (clipped at rest); beyond it they don't", () => {
        const { container } = renderPlan(planRoot([
            planRow("s", spanKind([
                run("in", W27, new Date("2026-07-13Z"), variant("actual", null)),
                // W39 — the first overscan week past the W27..W39 window.
                run("near", new Date("2026-09-21Z"), new Date("2026-09-28Z"), variant("confirmed", null)),
                // W42 — beyond the two-period overscan.
                run("far", new Date("2026-10-12Z"), new Date("2026-10-19Z"), variant("confirmed", null)),
            ])),
            planRow("b", variant("buckets", {
                lanes: [],
                events: [bucketEvent("oe", new Date("2026-09-22Z"), variant("confirmed", null))],
                markers: [],
            })),
        ]), "plan-619-overscan");
        // The overscan run mounts (clipped at rest by the plot; a brush-slide
        // pan reveals it) — the schematic's viewport-cull discipline, 1D.
        expect(container.querySelector('[data-run="near"]')).toBeTruthy();
        // Beyond the overscan: culled, exactly as before.
        expect(container.querySelector('[data-run="far"]')).toBeNull();
        // A bucket event in the first overscan period mounts its cell under
        // the out-of-range index; the window grid itself stays 12 buckets.
        expect(container.querySelector('[data-plan-cell="12:0"]')).toBeTruthy();
        expect(container.querySelector('[data-plan-cell="11:0"]')).toBeNull();   // empty window cell: still occupied-only (#616)
    });
});

describe("Plan ephemeral UI state survives a data commit (#610)", () => {
    // A Reactive write the series read — an approval, a committed drop — makes
    // a NEW decoded value. The canvas RECONCILES its ephemeral state against
    // the new rows instead of resetting it: only the entries whose rows
    // vanished drop, and declared collapse seeds ONCE, never again.
    const rowsAt = (tag: string, opts?: { withM2?: boolean; withGroup?: boolean }) => [
        ...(opts?.withGroup === false ? [] : [
            planRow("line1", variant("group", { summary: none, summaryAggregate: none, collapsed: some(true) })),
            planRow("m1", spanKind([]), { parent: "line1" }),
        ]),
        ...(opts?.withM2 === false ? [] : [
            planRow("m2", spanKind([]), { gutter: gutter("m2", { value: tag }) }),
        ]),
        planRow("keep", spanKind([])),
    ];
    const remount = (rerender: (ui: Parameters<typeof render>[0]) => void, rows: PlanRowValue[], key: string) => {
        rerender(
            <ChakraProvider value={system}>
                <EastChakraPlan value={planRoot(rows)} storageKey={key} />
            </ChakraProvider>,
        );
    };

    test("a data change keeps the opened group and the selection; a vanished row drops its entry", () => {
        const { container, rerender } = renderPlan(planRoot(rowsAt("v1")), "plan-reconcile");
        // The DECLARED-collapsed group starts collapsed; the user opens it...
        expect(container.querySelector('[data-plan-row="m1"]')).toBeNull();
        fireEvent.click(container.querySelector('[data-plan-group="line1"]')!);
        expect(container.querySelector('[data-plan-row="m1"]')).toBeTruthy();
        // ... and selects m2.
        fireEvent.click(container.querySelector('[data-plan-row="m2"]')!);
        expect(container.querySelector('[data-plan-row="m2"]')!.hasAttribute("data-selected")).toBe(true);

        // The host commits: same rows, new numbers.
        remount(rerender, rowsAt("v2"), "plan-reconcile");
        // The group the user opened stays open; the selection survives.
        expect(container.querySelector('[data-plan-row="m1"]')).toBeTruthy();
        expect(container.querySelector('[data-plan-row="m2"]')!.hasAttribute("data-selected")).toBe(true);

        // m2 vanishes → its entry goes with it: back in a LATER commit, it
        // renders unselected rather than resurrecting the old selection.
        remount(rerender, rowsAt("v3", { withM2: false }), "plan-reconcile");
        expect(container.querySelector('[data-plan-row="m2"]')).toBeNull();
        remount(rerender, rowsAt("v4"), "plan-reconcile");
        expect(container.querySelector('[data-plan-row="m2"]')!.hasAttribute("data-selected")).toBe(false);
        // The opened group survived all three commits.
        expect(container.querySelector('[data-plan-row="m1"]')).toBeTruthy();
    });

    test("a group that vanishes and returns re-seeds its declared collapse", () => {
        const { container, rerender } = renderPlan(planRoot(rowsAt("v1")), "plan-reseed");
        fireEvent.click(container.querySelector('[data-plan-group="line1"]')!);   // the user opens it
        expect(container.querySelector('[data-plan-row="m1"]')).toBeTruthy();
        // The group leaves the data entirely, then returns declared-collapsed:
        // a returning key is a NEW row, so the declaration applies again.
        remount(rerender, rowsAt("v2", { withGroup: false }), "plan-reseed");
        expect(container.querySelector('[data-plan-group="line1"]')).toBeNull();
        remount(rerender, rowsAt("v3"), "plan-reseed");
        expect(container.querySelector('[data-plan-group="line1"]')).toBeTruthy();
        expect(container.querySelector('[data-plan-row="m1"]')).toBeNull();
    });
});

function bucketEvent(key: string, at: Date, state: unknown, opts?: { lane?: string; label?: string; stretch?: string; tone?: string }) {
    return {
        key, at: t(at),
        lane: opts?.lane !== undefined ? some(opts.lane) : none,
        label: opts?.label !== undefined ? some(opts.label) : none,
        icon: none, state,
        tone: opts?.tone !== undefined ? some(variant(opts.tone, null)) : none,
        color: none, colorPalette: none,
        stretch: opts?.stretch !== undefined ? some(variant(opts.stretch, null)) : none,
        content: none, animation: none,
    };
}
