/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Plan failure-locality DOM tests (#811) — a row, a window, a resolver or a
 * part that fails stays where it happened, and the toolbar counts it.
 *
 * (Split out of `plan.dom.test.tsx`, #815: every test moved verbatim.)
 */

import { describe, test, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import { variant, some, none } from "@elaraai/east";
import { system } from "../../theme/index.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { EastChakraPlan, type PlanRootValue } from "./index.js";
import type { PlanWireRow } from "./model.js";
import type { PlanInstantValue } from "./instant.js";
import { rowId, rowKey, rowSel, testKeyOf } from "./plan.test-utils.js";

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

/** One WIRE row, as the source serves it — named by its test key (#822). */
function planRow(key: string, kind: unknown, opts?: { parent?: string; gutter?: unknown; expand?: unknown; collapsed?: boolean }): PlanWireRow {
    return {
        id: rowId(key),
        parent: opts?.parent !== undefined ? some(rowId(opts.parent)) : none,
        gutter: opts?.gutter ?? gutter(key),
        kind,
        collapsed: opts?.collapsed !== undefined ? some(opts.collapsed) : none,
        pinned: none, height: none, status: none, approval: none,
        expand: opts?.expand !== undefined ? some(opts.expand) : none,
    } as unknown as PlanWireRow;
}

function spanKind(runs: unknown[], opts?: { rollup?: string; unit?: string }) {
    return variant("span", {
        runs, decisions: [], ports: [],
        rollup: opts?.rollup !== undefined ? some(variant(opts.rollup, null)) : none,
        unit: opts?.unit !== undefined ? some(opts.unit) : none,
    });
}

function planRoot(rows: PlanWireRow[], opts?: { footer?: unknown[]; now?: Date | undefined; slice?: unknown; resolutions?: unknown[]; links?: unknown[]; popover?: unknown; hover?: unknown; expandRender?: unknown; source?: unknown; pick?: unknown; axis?: unknown; style?: { height?: string; maxHeight?: string }; clicks?: { onRunClick?: unknown; onEventClick?: unknown; onMarkClick?: unknown; onChipClick?: unknown; onCellClick?: unknown } }): PlanRootValue {
    return {
        rows: opts?.source !== undefined ? variant("paged", opts.source) : variant("inline", rows),
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

describe("Plan failure is local (#811)", () => {
    /** One source window of span rows keyed `w{w}r{i}` — two per window unless
     *  asked for more, each with a time-axis run; `offAxis` rows carry NUMBER
     *  instants instead. */
    const windowRows = (w: number, offAxis: ReadonlySet<string> = new Set(), perWindow = 2): PlanWireRow[] => Array.from({ length: perWindow }, (_u, i) => {
        const key = `w${w}r${i}`;
        return planRow(key, spanKind([offAxis.has(key)
            ? { key: `x${key}`, start: n(3), end: n(6), label: key, quantity: none, qty: none,
                state: variant("actual", null), status: none, moved: none, icon: none }
            : run(`x${key}`, W27, new Date("2026-07-13Z"), variant("actual", null))]));
    });
    const TOTAL = 1_200n;                                    // six windows of 200 elements

    test("paged: window 3 arrives with an off-axis row — it renders as a diagnostic row, windows 0–2 and 4+ render, the toolbar counts 1", async () => {
        initializeStore(new UIStore());
        const source = {
            id: "dom-811-axis",
            page: (offset: bigint) => {
                const w = Number(offset) / 200;
                // Sixteen rows a window: window 0 fills the jsdom viewport, so
                // the demand rests on its ring (#812).
                return w < 6 ? some(windowRows(w, new Set(["w3r0"]), 16)) : some([]);
            },
            total: () => some(TOTAL),
            // A keyed source seeks: every query lands on element 600 — window 3.
            seek: some(() => some({ found: true, row: 600n, count: 1n })),
            revision: () => none,
            refresh: () => null,
        };
        const { container } = renderPlan(planRoot([], { source }), "plan-811-axis");
        // The opening ring is windows 0–2; window 3 has not arrived.
        await waitFor(() => expect(container.querySelector(rowSel("w2r1"))).toBeTruthy());
        expect(container.querySelector(rowSel("w3r0"))).toBeNull();

        // Jump to window 3 through the shipped key search — the bad row
        // arrives mid-session, as it would mid-scroll.
        const input = container.querySelector('[data-part="dataset-key-search"] input')! as HTMLElement;
        await userEvent.type(input, "w3");
        await waitFor(() => expect(container.querySelector('[data-part="dataset-key-search"]')!.textContent).toMatch(/match/),
            { timeout: 5_000 });
        fireEvent.keyDown(input, { key: "Enter" });
        await waitFor(() => expect(container.querySelector(rowSel("w5r1"))).toBeTruthy(), { timeout: 10_000 });

        // The canvas stayed up, and every other window's rows render.
        expect(container.querySelector("[data-plan-body]")).toBeTruthy();
        for (const key of ["w0r0", "w1r1", "w2r0", "w3r1", "w4r0", "w5r1"]) {
            expect(container.querySelector(`${rowSel(key)} [data-run="x${key}"]`), key).toBeTruthy();
        }
        // The off-axis row is IN PLACE, as its diagnostic, placing no mark.
        const bad = container.querySelector(rowSel("w3r0"))!;
        expect(bad.querySelector('[data-plan-diagnostic="number"]')!.textContent)
            .toBe("AXIS MISMATCH — this row carries number instants; the axis is time");
        expect(bad.querySelector("[data-run]")).toBeNull();
        const chip = container.querySelector('[data-plan-diagnostics="rows"]')!;
        expect(chip.getAttribute("data-count")).toBe("1");
        expect(chip.textContent).toBe("1 row skipped");
    }, 30_000);

    test("paged: window 2's page throws — a window-height band with Retry; Retry lands the rows once the source recovers; its neighbours are untouched", async () => {
        const state = { failing: true };
        const asked: number[] = [];
        const source = {
            id: "dom-811-retry",
            page: (offset: bigint) => {
                const w = Number(offset) / 200;
                asked.push(w);
                if (w === 2 && state.failing) throw new Error("fetch failed: 503");
                return w < 6 ? some(windowRows(w)) : some([]);
            },
            total: () => some(TOTAL),
            seek: none,
            revision: () => none,
            refresh: () => null,
        };
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const { container } = renderPlan(planRoot([], { source }), "plan-811-retry");
            const band = await waitFor(() => {
                const el = container.querySelector('[data-plan-failed="2"]');
                expect(el).toBeTruthy();
                return el!;
            });
            // Window-height: window 2's ledger slot (0 measured 64px over 200
            // elements; the frozen rate floors at 1px per element → 200px).
            expect(band.getAttribute("data-plan-px")).toBe("200");
            expect(band.textContent).toMatch(/Elements 401–600 could not be read — fetch failed: 503/);
            // The neighbours landed and render.
            expect(container.querySelector(rowSel("w0r0"))).toBeTruthy();
            expect(container.querySelector(rowSel("w1r1"))).toBeTruthy();
            expect(container.querySelector(rowSel("w2r0"))).toBeNull();
            // The band sits in window 2's seam — after window 1's rows.
            const order = [...container.querySelectorAll("[data-plan-row], [data-plan-failed]")].map((el) => {
                const row = el.getAttribute("data-plan-row");
                return row !== null ? testKeyOf(row) : `F${el.getAttribute("data-plan-failed")}`;
            });
            expect(order.slice(0, 5)).toEqual(["w0r0", "w0r1", "w1r0", "w1r1", "F2"]);

            // The source recovers; Retry asks window 2 again and its rows land.
            const tries = asked.filter((w) => w === 2).length;
            state.failing = false;
            fireEvent.click(band.querySelector('[data-plan-retry="2"]')!);
            await waitFor(() => expect(container.querySelector(rowSel("w2r0"))).toBeTruthy());
            expect(asked.filter((w) => w === 2).length).toBe(tries + 1);
            expect(container.querySelector("[data-plan-failed]")).toBeNull();
            expect(container.querySelector(rowSel("w0r0"))).toBeTruthy();
            expect(container.querySelector(rowSel("w1r1"))).toBeTruthy();
        } finally {
            err.mockRestore();
        }
    });

    test("a popover body that throws at render shows its fallback INSIDE the popover; the canvas stays interactive", async () => {
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            // `Text` with no payload: a UI value that throws while rendering.
            const popover = () => some(variant("Text", null));
            const { container } = renderPlan(planRoot([
                planRow("m1", spanKind([run("r1", W27, new Date("2026-07-13Z"), variant("actual", null))])),
                planRow("m2", spanKind([])),
            ], { popover }), "plan-811-popover");
            const user = userEvent.setup();
            await user.click(container.querySelector('[data-run="r1"]')!);
            const fallback = await waitFor(() => {
                const el = document.querySelector('[data-plan-error="popover"]');
                expect(el).toBeTruthy();
                return el!;
            });
            expect(fallback.textContent).toMatch(/^popover could not render — /);
            // Inside the popover's own surface, not in the canvas.
            expect(container.contains(fallback)).toBe(false);
            // The canvas is still there and still answers.
            fireEvent.click(container.querySelector(rowSel("m2"))!);
            expect(container.querySelector(rowSel("m2"))!.hasAttribute("data-selected")).toBe(true);
            expect(container.querySelector(`${rowSel("m1")} [data-run="r1"]`)).toBeTruthy();
        } finally {
            err.mockRestore();
        }
    });

    test("an expand render that throws shows its fallback in the focused row; the other rows keep working", () => {
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const { container } = renderPlan(planRoot([
                planRow("focal", spanKind([]), { expand: { height: some("120px"), axis: variant("keep", null) } }),
                planRow("other", spanKind([run("r2", W27, new Date("2026-07-13Z"), variant("actual", null))])),
            ], { expandRender: () => variant("Text", null) }), "plan-811-expand");
            fireEvent.click(container.querySelector('[data-plan-control="expand"]')!);
            const focal = container.querySelector(rowSel("focal"))!;
            expect(focal.querySelector('[data-plan-expandrender] [data-plan-error="expand render"]')).toBeTruthy();
            // The strip is still the way back, and the canvas still answers it.
            fireEvent.click(container.querySelector(rowSel("other"))!);
            expect(container.querySelector("[data-plan-expandrender]")).toBeNull();
            fireEvent.click(container.querySelector(rowSel("other"))!);
            expect(container.querySelector(rowSel("other"))!.hasAttribute("data-selected")).toBe(true);
        } finally {
            err.mockRestore();
        }
    });

    test("one row's plot that throws at render shows its fallback in THAT row; every other row draws", () => {
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            // A run missing its `status` option: the span renderer reads it and
            // throws; nothing else on the canvas (derivations, heights) does.
            const broken = { ...run("rb", W27, new Date("2026-07-13Z"), variant("actual", null)), status: undefined };
            const { container } = renderPlan(planRoot([
                planRow("good", spanKind([run("rg", W27, new Date("2026-07-13Z"), variant("actual", null))])),
                planRow("bad", spanKind([broken])),
                planRow("after", spanKind([run("ra", W27, new Date("2026-07-13Z"), variant("actual", null))])),
            ]), "plan-811-row");
            const bad = container.querySelector(rowSel("bad"))!;
            // Named by its label in words, by its key in the stable id.
            expect(bad.querySelector(`[data-plan-error=${JSON.stringify(`row ${rowKey("bad")}`)}]`)!.textContent)
                .toMatch(/^row bad could not render — /);
            // The row keeps its gutter; its neighbours draw their marks.
            expect(bad.textContent).toContain("bad");
            expect(container.querySelector(`${rowSel("good")} [data-run="rg"]`)).toBeTruthy();
            expect(container.querySelector(`${rowSel("after")} [data-run="ra"]`)).toBeTruthy();
            // And the canvas still answers.
            fireEvent.click(container.querySelector(rowSel("after"))!);
            expect(container.querySelector(rowSel("after"))!.hasAttribute("data-selected")).toBe(true);
        } finally {
            err.mockRestore();
        }
    });

    test("a truncated axis says so in the toolbar — with no other chrome asking for one", () => {
        // 600 days at day resolution: the grid stops at 500 buckets.
        const min = new Date("2026-01-01T00:00:00Z");
        const max = new Date(Date.UTC(2026, 0, 1) + 600 * 86_400_000);
        const { container } = renderPlan(planRoot([planRow("m1", spanKind([]))], {
            axis: variant("time", {
                window: some({ min, max }), resolution: variant("day", null), resolutions: [], now: none, format: none,
            }),
        }), "plan-811-truncated");
        expect(container.querySelector("[data-slot='toolbar']")).toBeTruthy();
        expect(container.querySelector('[data-plan-diagnostics="truncated"]')!.textContent)
            .toBe("showing the first 500 buckets — zoom in");
        expect(container.querySelectorAll('[data-slot="rulerTick"]')).toHaveLength(500);
    });

    test("narrow: a failed window is a card with Retry; an off-axis row is a diagnostic card; the chips ride the chip row", async () => {
        const realRect = Element.prototype.getBoundingClientRect;
        Element.prototype.getBoundingClientRect = function () {
            return { left: 0, top: 0, right: 360, bottom: 600, width: 360, height: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
        };
        const state = { failing: true };
        const source = {
            id: "dom-811-narrow",
            page: (offset: bigint) => {
                const w = Number(offset) / 200;
                if (w === 1 && state.failing) throw new Error("fetch failed: 503");
                return w < 3 ? some(windowRows(w, new Set(["w0r1"]))) : some([]);
            },
            total: () => some(600n),
            seek: none,
            revision: () => none,
            refresh: () => null,
        };
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const { container } = renderPlan(planRoot([], { source }), "plan-811-narrow");
            await waitFor(() => expect(container.querySelector('[data-plan-failed="1"]')).toBeTruthy());
            expect(container.querySelector("[data-plan-narrow]")).toBeTruthy();
            expect(container.querySelector(`${rowSel("w0r1", "data-plan-card")} [data-plan-diagnostic="number"]`)).toBeTruthy();
            expect(container.querySelector(`${rowSel("w0r0", "data-plan-card")} [data-run="xw0r0"]`)).toBeTruthy();
            // The count is stated; the narrow list has no scroll target to seek.
            const chip = container.querySelector("[data-slot='narrowChips'] [data-plan-diagnostics='rows']")!;
            expect(chip.tagName).not.toBe("BUTTON");
            expect(chip.textContent).toBe("1 row skipped");

            state.failing = false;
            fireEvent.click(container.querySelector('[data-plan-retry="1"]')!);
            await waitFor(() => expect(container.querySelector(rowSel("w1r0", "data-plan-card"))).toBeTruthy());
            expect(container.querySelector("[data-plan-failed]")).toBeNull();
        } finally {
            err.mockRestore();
            Element.prototype.getBoundingClientRect = realRect;
        }
    });
});
