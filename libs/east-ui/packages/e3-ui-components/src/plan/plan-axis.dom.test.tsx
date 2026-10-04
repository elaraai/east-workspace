/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Plan typed-axis DOM tests (#631) — every row kind on every axis kind, and
 * the chrome each kind mounts.
 *
 * (Split out of `plan.dom.test.tsx`, #815: every test moved verbatim.)
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { variant, some, none } from "@elaraai/east";
import { system, buildSliceHandle, UIStore } from "@elaraai/east-ui-components";
import { sliceConfig } from "@elaraai/east-ui-components/testing";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import { EastChakraPlan, type PlanRootValue } from "./index.js";
import type { PlanWireRow } from "./model.js";
import type { PlanInstantValue } from "./instant.js";
import { blocksSource, oneBlock, rowId, rowSel } from "./plan.test-utils.js";

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
const n = (v: number): PlanInstantValue => variant("number", v) as PlanInstantValue;
const o = (v: string): PlanInstantValue => variant("ordinal", v) as PlanInstantValue;

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

// The stored table form is ALWAYS series — this wraps plain cells the way
// the factory's `cells` sugar does (one unstyled series).
function tableKindOf(cells: unknown[], opts?: { aggregate?: boolean; emphasis?: string }) {
    return variant("table", {
        series: cells.length > 0
            ? [{ cells, format: none, tone: none, strong: false, rollup: false, fold: variant("sum", null) }]
            : [],
        split: variant("horizontal", null),
        aggregate: opts?.aggregate === true ? some(variant("sum", null)) : none,
        format: none,
        emphasis: variant(opts?.emphasis ?? "body", null),
    });
}

describe("Plan typed axis (#631) — every row kind on every axis kind", () => {
    const PHASES = Array.from({ length: 12 }, (_u, i) => `P${i + 1}`);
    // Three 12-bucket axes; "bucket 2" and "bucket 5" on each arm. On an
    // ordinal axis an interval END names its LAST bucket (inclusive), so
    // [P3, P5] is three columns — the same width as W29..W32 and 3..6.
    const AXES = {
        time: {
            axis: variant("time", { window: some({ min: W27, max: W39 }), resolution: variant("week", null), resolutions: [], now: none, format: none }),
            at2: t(new Date("2026-07-13Z")), at5: t(new Date("2026-08-03Z")), tick2: "W29",
        },
        number: {
            axis: variant("number", { window: some({ min: 1, max: 13 }), step: 1, now: none, format: none }),
            at2: n(3), at5: n(6), tick2: "3",
        },
        ordinal: {
            axis: variant("ordinal", { values: PHASES, now: none }),
            at2: o("P3"), at5: o("P5"), tick2: "P3",
        },
    } as const;
    const rowsFor = (a: { at2: PlanInstantValue; at5: PlanInstantValue }) => [
        planRow("span", spanKind([{
            key: "r", start: a.at2, end: a.at5, label: "R", quantity: none,
            state: variant("actual", null), status: none, moved: none, icon: none,
        }])),
        planRow("buckets", variant("buckets", {
            lanes: [],
            events: [{ key: "e", at: a.at2, lane: none, label: none, icon: none, state: variant("confirmed", null),
                tone: none, color: none, colorPalette: none, stretch: none, content: none, animation: none }],
            markers: [],
        })),
        planRow("chart", variant("chart", {
            layers: [variant("column", { points: [{ t: a.at2, y: 5 }], axis: variant("left", null), series: none, breach: none, fold: variant("sum", null) })],
            left: none, right: none, height: variant("spark", null), expandedHeight: none, expandable: false,
        })),
        planRow("heat", variant("heat", {
            cells: variant("heat", {
                cells: [{ at: a.at2, value: some(50), label: some("50") }],
                scale: { min: some(0), max: some(100), warnAt: none }, fold: variant("mean", null), format: none,
            }),
            aggregate: none, scale: none,
        })),
        planRow("table", tableKindOf([{ at: a.at2, value: some(7), text: none, tone: none }])),
        planRow("cards", variant("cards", {
            chips: [{ key: "c", from: a.at2, to: a.at5, label: "C", state: variant("confirmed", null), icon: none }],
        })),
        planRow("events", variant("events", {
            marks: [{ key: "m", at: a.at2, kind: variant("milestone", null), icon: none, label: none }],
        })),
        planRow("group", variant("group", {
            summary: variant("cells", variant("heat", {
                cells: [{ at: a.at2, value: some(80), label: some("80") }],
                scale: { min: some(0), max: some(100), warnAt: none }, fold: variant("mean", null), format: none,
            })),
        }), { collapsed: true }),
    ];

    for (const [kind, a] of Object.entries(AXES)) {
        test(`${kind}: the eight kinds position by bucket index / fraction on a 12-bucket ${kind} axis`, () => {
            const { container } = renderPlan(planRoot(rowsFor(a), { axis: a.axis }), `plan-631-${kind}`);
            const q = (sel: string) => container.querySelector(sel);
            // Continuous kinds at fraction 2/12; quantised kinds in bucket 2.
            expect(q(`${rowSel("span")} [data-run="r"]`)!.getAttribute("data-plan-frac")).toBe("0.1667");
            expect(q(`${rowSel("buckets")} [data-plan-cell="2:0"]`)).toBeTruthy();
            // The column rect's x = (2/12 + 0.18/12) × 1000 viewBox units.
            expect(parseFloat(q(`${rowSel("chart")} svg rect`)!.getAttribute("x")!)).toBeCloseTo(181.67, 1);
            expect(q(`${rowSel("heat")} [data-plan-bucket="2"]`)).toBeTruthy();
            expect(q(`${rowSel("table")} [data-plan-bucket="2"]`)).toBeTruthy();
            expect(q(`${rowSel("cards")} [data-chip="c"]`)!.getAttribute("data-plan-frac")).toBe("0.1667");
            expect(q(`${rowSel("events")} [data-mark="m"]`)!.getAttribute("data-plan-frac")).toBe("0.1667");
            expect(q(`${rowSel("group", "data-plan-group")} [data-plan-bucket="2"]`)).toBeTruthy();
            // Twelve ruler ticks whatever the kind, labelled in the kind's vocabulary.
            const labels = [...container.querySelectorAll('[data-slot="rulerTick"]')].map((e) => e.textContent);
            expect(labels).toHaveLength(12);
            expect(labels[2]).toBe(a.tick2);
        });
    }

    test("a row whose instants ride another arm renders IN PLACE as a diagnostic naming the arm — the canvas draws on (#631, #811)", () => {
        const { container } = renderPlan(planRoot([
            planRow("ok", spanKind([{
                key: "r", start: n(3), end: n(6), label: "R", quantity: none,
                state: variant("actual", null), status: none, moved: none, icon: none,
            }])),
            // Time instants on a number axis — the Planner's single-axis-kind rule.
            planRow("m1", spanKind([run("x", W27, new Date("2026-07-13Z"), variant("actual", null))])),
        ], { axis: AXES.number.axis }), "plan-631-mismatch");
        const diag = container.querySelector(`${rowSel("m1")} [data-plan-diagnostic]`)!;
        expect(diag).toBeTruthy();
        expect(diag.getAttribute("data-plan-diagnostic")).toBe("time");
        expect(diag.textContent).toBe("AXIS MISMATCH — this row carries time instants; the axis is number");
        // Nothing is drawn somewhere wrong: the mismatched row places no mark...
        expect(container.querySelector('[data-run="x"]')).toBeNull();
        // ...while the rest of the canvas draws, and the toolbar counts it.
        expect(container.querySelector(`${rowSel("ok")} [data-run="r"]`)).toBeTruthy();
        const chip = container.querySelector('[data-plan-diagnostics="rows"]')!;
        expect(chip.getAttribute("data-count")).toBe("1");
        expect(chip.textContent).toBe("1 row skipped");
    });
});

describe("Plan typed axis (#631) — chrome per kind", () => {
    const numberAxis = variant("number", { window: some({ min: 1, max: 9 }), step: 1, now: some(5), format: none });
    /** A slice whose range field is a FLOAT — days 1..12 of orders. */
    const numberSlice = (key: string, days: number[]) => {
        initializeStore(new UIStore());
        const cfg = sliceConfig({
            day: variant("float", { label: "Day", accessor: (r: { day: number }) => r.day, format: none }),
        }, { rangeFieldId: some("day") });
        const initial = {
            range: some(variant("float", { from: 1, to: 9 })),
            compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
            breakdown: none, search: none, visible: none, selectedIndex: none, resolution: none,
        };
        return buildSliceHandle(key, cfg, initial as never, days.map((day) => ({ day })) as never, none) as never as {
            read(): { range: { value: { type: string; value: { from: number; to: number } } } };
        };
    };
    const ticks = (container: HTMLElement) =>
        [...container.querySelectorAll('[data-slot="rulerTick"]')].map((e) => e.textContent);
    /** A window `[a, b)` written as the slice's CLOSED float range ends one
     *  float short of `b` (`rangeOf`) — so a row at `b`, in the next step, is
     *  not counted in the window (#949). */
    const endsJustBelow = (to: number, b: number) => to < b && b - to < 1e-12;

    test("a number axis rules 1 … 8 with the NOW divider, mounts no resolution segment, and brushes the slice's FLOAT range live", async () => {
        const handle = numberSlice("plan.631.brush", [1, 12]);
        const { container } = renderPlan(planRoot([planRow("m1", spanKind([]))], {
            axis: numberAxis,
            slice: some({ slice: handle, affordances: [variant("brush", null), variant("resolution", null)] }),
        }), "plan-631-number");
        expect(ticks(container)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
        expect(screen.getByText("NOW")).toBeTruthy();
        // `step` is the declaration — there is no unit to switch.
        expect(container.querySelector("[data-slot='seg']")).toBeNull();
        // The horizon spans the DOMAIN, not the window, in WHOLE steps: days
        // 1..12 are twelve steps, `[1, 13)` (#949).
        expect(screen.getByText("HORIZON · 12 STEPS")).toBeTruthy();
        const track = container.querySelector("[data-brush-track]") as HTMLElement;
        Object.defineProperty(track, "getBoundingClientRect", {
            value: () => ({ left: 0, top: 0, right: 1200, bottom: 32, width: 1200, height: 32, x: 0, y: 0, toJSON: () => ({}) }),
        });
        // The applied window 1..9 spans the first 8/12 of the track (0..800px).
        // Grab its body at 400 and slide +100px = one step: the draft snaps to
        // 2..10 and is APPLIED — as the slice's `float` arm, closed.
        fireEvent.pointerDown(track, { clientX: 400, pointerId: 1, buttons: 1 });
        fireEvent.pointerMove(track, { clientX: 500, pointerId: 1, buttons: 1 });
        await waitFor(() => expect(handle.read().range.value.value.from).toBe(2));
        expect(handle.read().range.value.type).toBe("float");
        expect(endsJustBelow(handle.read().range.value.value.to, 10)).toBe(true);
        fireEvent.pointerUp(track, { pointerId: 1 });
        expect(handle.read().range.value.value.from).toBe(2);
        expect(endsJustBelow(handle.read().range.value.value.to, 10)).toBe(true);
        // The canvas followed: the ruler now reads 2 … 9.
        expect(ticks(container)).toEqual(["2", "3", "4", "5", "6", "7", "8", "9"]);
    });

    test("[ / ] and n write a number axis's window as the slice's float arm — closed, and read back whole", () => {
        const handle = numberSlice("plan.631.keys", [1, 12]);
        const { container } = renderPlan(planRoot([planRow("m1", spanKind([]))], {
            axis: numberAxis, slice: some({ slice: handle, affordances: [] }),
        }), "plan-631-keys");
        const surface = container.querySelector('[tabindex="0"]')!;
        const range = () => handle.read().range.value;
        fireEvent.keyDown(surface, { key: "]" });
        expect(range().type).toBe("float");
        expect(range().value.from).toBe(2);
        expect(endsJustBelow(range().value.to, 10)).toBe(true);
        // Each pan starts from the window READ BACK — whole steps, so a
        // round trip lands exactly where it began, with no shortfall carried.
        fireEvent.keyDown(surface, { key: "[" });
        expect(range().value.from).toBe(1);
        expect(endsJustBelow(range().value.to, 9)).toBe(true);
        expect(ticks(container)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
        // n re-derives the window on step edges with the same column count,
        // now (5) a third of the way in: 5 − ⌊8/3⌋ = 3 → [3, 11).
        fireEvent.keyDown(surface, { key: "n" });
        expect(range().value.from).toBe(3);
        expect(endsJustBelow(range().value.to, 11)).toBe(true);
    });

    test("an INTEGER field's window is written closed on whole values — `[1, 9)` is `1–8` — and read back whole", () => {
        initializeStore(new UIStore());
        const cfg = sliceConfig({
            day: variant("integer", { label: "Day", accessor: (r: { day: bigint }) => r.day, format: none }),
        }, { rangeFieldId: some("day") });
        const initial = {
            // The eight days 1 … 8, as an author seeds them: both ends inclusive.
            range: some(variant("integer", { from: 1n, to: 8n })),
            compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
            breakdown: none, search: none, visible: none, selectedIndex: none, resolution: none,
        };
        const handle = buildSliceHandle("plan.949.integer", cfg, initial as never,
            Array.from({ length: 12 }, (_u, i) => ({ day: BigInt(i + 1) })) as never, none) as never as {
                read(): { range: { value: { type: string; value: { from: bigint; to: bigint } } } };
            };
        const { container } = renderPlan(planRoot([planRow("m1", spanKind([]))], {
            axis: variant("number", { window: none, step: 1, now: some(5), format: none }),
            slice: some({ slice: handle, affordances: [] }),
        }), "plan-949-integer");
        // `1–8` is eight columns — the slice's closed range IS the grid.
        expect(ticks(container)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
        fireEvent.keyDown(container.querySelector('[tabindex="0"]')!, { key: "]" });
        expect(handle.read().range.value.type).toBe("integer");
        expect(handle.read().range.value.value).toEqual({ from: 2n, to: 9n });
        expect(ticks(container)).toEqual(["2", "3", "4", "5", "6", "7", "8", "9"]);
    });

    test("an ordinal axis rules its values with NOW on the named phase; the brush never mounts and the window keys idle", () => {
        initializeStore(new UIStore());
        // A DATETIME slice bound with the brush affordance — the arm a time
        // axis would brush; an ordinal axis has no arm to speak, so the
        // strip does not mount and a pan writes nothing.
        const cfg = sliceConfig({
            at: variant("datetime", { label: "At", accessor: (r: { at: Date }) => r.at, format: none }),
        }, { rangeFieldId: some("at") });
        const initial = {
            range: some(variant("datetime", { from: W27, to: W39 })),
            compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
            breakdown: none, search: none, visible: none, selectedIndex: none, resolution: none,
        };
        const handle = buildSliceHandle("plan.631.ordinal", cfg, initial as never,
            [{ at: W27 }, { at: W39 }] as never, none) as never as {
                read(): { range: { value: { value: { from: Date; to: Date } } } };
            };
        const { container } = renderPlan(planRoot([planRow("m1", spanKind([]))], {
            axis: variant("ordinal", { values: ["PREPRESS", "PLATES", "PRINT", "FINISH", "BIND", "DELIVER"], now: some("PRINT") }),
            slice: some({ slice: handle, affordances: [variant("brush", null)] }),
        }), "plan-631-ordinal");
        expect(ticks(container)).toEqual(["PREPRESS", "PLATES", "PRINT", "FINISH", "BIND", "DELIVER"]);
        expect(screen.getByText("NOW")).toBeTruthy();
        expect(container.querySelector("[data-slot='horizon']")).toBeNull();
        expect(container.querySelector("[data-brush-track]")).toBeNull();
        const before = handle.read().range.value.value.from.getTime();
        fireEvent.keyDown(container.querySelector('[tabindex="0"]')!, { key: "]" });
        expect(handle.read().range.value.value.from.getTime()).toBe(before);
        expect(ticks(container)[0]).toBe("PREPRESS");
    });
});
