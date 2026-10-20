/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Plan slice chrome DOM tests — a record's resolution, which re-buckets the
 * window and fetches nothing (§3, #1344), the horizon brush, which moves a
 * record's window once a gesture (§7, #620, #1344), chrome that tracks the
 * slice store (#611), sizing
 * (#320 / #567 D1), and the series library, which is the library pane's
 * Series tab, not a toolbar button (#590, #1193). The narrowing is the Plan's
 * one `Slice.bindRecords` (#1344), its `rows` source the Plan's dated rows on
 * e3 itself (`rail.test-utils.ts`, #1376): what it counts and its dates' extent
 * read from e3, the window its half-open range. A canvas persists its toggles
 * under its storageKey (#813), and the harness clears them after each test.
 *
 * (Split out of `plan.dom.test.tsx`, #815.)
 */

import { describe, test, expect } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { variant, some, none } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { system } from "@elaraai/east-ui-components";
import { recordSliceWindow, setRecordSliceWindow } from "@elaraai/east-ui-components/internal";
import { Data } from "@elaraai/e3-ui/internal";
import * as records from "@elaraai/e3-ui/examples/plan/plan-records";
import { act, e3Harness, settle } from "../e3-web-mount.test-utils.js";
import { EastChakraPlan, type PlanRootValue } from "./index.js";
import type { PlanWireRow } from "./model.js";
import type { PlanInstantValue } from "./instant.js";
import { blocksSource, oneBlock, rowId } from "./plan.test-utils.js";
import { RAIL_MODULES, bindRail } from "./rail.test-utils.js";

const h = e3Harness(RAIL_MODULES, { measure: false });

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
        pinned: false, height: none, status: none,
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

/** The requests that read rows of a record: whole, a page, or a key search. */
const rowReads = (from: number) => h.requests().slice(from).filter((request) => request.kind === "read" || request.kind === "page" || request.kind === "find");

describe("a record's resolution re-buckets the window (§3, #1344)", () => {
    test("switching WEEK → DAY writes the resolution and keeps the window: the twelve weeks the sources hold, in days, and nothing fetched", async () => {
        // The rows' window, twelve weeks from W27 — the source holds it, and it alone.
        const rail = await bindRail(() => Slice.bindRecords("plan.zoom", {
            rows: {
                source: Data.bindPaged(records.planDatedRows, { indexes: [records.planDatedRowsByAt] }),
                fields: { at: { label: "At" } }, range: "at", initial: { at: { from: W27, to: W39 } },
            },
        }), ["resolution"]);
        const part = rail.part("rows");
        const { container } = renderPlan(planRoot([planRow("m1", spanKind([]))], {
            slice: some(rail.chrome),
            resolutions: [variant("week", null), variant("day", null)],
        }));
        await settle();
        expect(container.querySelectorAll('[data-slot="rulerTick"]')).toHaveLength(12);
        const before = h.requests().length;
        fireEvent.click(screen.getByText("DAY"));
        await settle();
        expect(part.read().resolution).toEqual(some(variant("day", null)));
        // The window stands — a record's resolution is presentation, so zooming reads no row of it — and the
        // canvas draws it by the day: eighty-four columns.
        expect(recordSliceWindow(part)).toEqual({ kind: "datetime", min: W27.getTime(), max: W39.getTime() });
        expect(rowReads(before)).toEqual([]);
        expect(container.querySelectorAll('[data-slot="rulerTick"]')).toHaveLength(84);
    });
});

/** A slice-bound canvas whose brush strip spans a mocked 1300px track — the
 *  horizon's thirteen whole weeks at 100px each (#949) — its applied window
 *  W29..W33 at 200..600px: the rows' source holds the window, its rows — the
 *  dated rows as e3 holds them deployed — W27's and W39's, the horizon their
 *  whole weeks. */
const brushFixture = async (key: string, axis?: unknown) => {
    // Applied window W29..W33 (4 weeks) inside the wider horizon. The rows span W27..W39, and the horizon is their
    // WHOLE weeks: W27 to the end of W39, thirteen of them — the last row's week counts once.
    const rail = await bindRail(() => Slice.bindRecords(key, {
        rows: {
            source: Data.bindPaged(records.planDatedRows, { indexes: [records.planDatedRowsByAt] }),
            fields: { at: { label: "At" } }, range: "at",
            initial: { at: { from: new Date("2026-07-13T00:00:00Z"), to: new Date("2026-08-10T00:00:00Z") } },
        },
    }), ["brush"]);
    const part = rail.part("rows");
    const { container } = renderPlan(planRoot([planRow("m1", spanKind([]))], {
        slice: some(rail.chrome),
        ...(axis !== undefined ? { axis } : {}),
    }), key);
    // The horizon is the rows' dates' extent, read from e3: the strip draws once it has landed.
    await settle();
    const track = container.querySelector("[data-brush-track]") as HTMLElement;
    Object.defineProperty(track, "getBoundingClientRect", {
        value: () => ({ left: 0, top: 0, right: 1300, bottom: 32, width: 1300, height: 32, x: 0, y: 0, toJSON: () => ({}) }),
    });
    const window = () => recordSliceWindow(part);
    return {
        container, track, part,
        // Every write to the source — a window, a resolution: what a gesture asks of the record.
        writes: () => rail.writes("rows"),
        range: () => ({ from: new Date(window()!.min), to: new Date(window()!.max) }),
        ranged: () => window() !== undefined,
        ticks: () => [...container.querySelectorAll('[data-slot="rulerTick"]')].map((e) => e.textContent),
    };
};

describe("Plan horizon brush — a record's window moves once a gesture (§7, #620, #1344)", () => {
    test("a SLIDE draws its snapped steps on the strip alone, and writes the window into the source once, on release", async () => {
        const { track, range, writes, ticks } = await brushFixture("plan-620-slide");
        // Grab the window body (200px..600px on the mocked track) and slide +110px ≈ +1.1 weeks: the snapped
        // draft steps one period on the strip, and the source — whose every write is a new query of the record's
        // indexes — keeps the window, as the canvas does (#1344).
        fireEvent.pointerDown(track, { clientX: 400, pointerId: 1, buttons: 1 });
        fireEvent.pointerMove(track, { clientX: 510, pointerId: 1, buttons: 1 });
        fireEvent.pointerMove(track, { clientX: 610, pointerId: 1, buttons: 1 });
        expect(writes()).toBe(0);
        expect(range().from.toISOString()).toBe("2026-07-13T00:00:00.000Z");
        expect(ticks()[0]).toBe("W29");
        // Released ≈ +2 weeks on: one write, the window half-open as a record's range is — `[W31, W35)`.
        fireEvent.pointerUp(track, { pointerId: 1 });
        await waitFor(() => expect(range().from.toISOString()).toBe("2026-07-27T00:00:00.000Z"));
        expect(range().to.toISOString()).toBe("2026-08-24T00:00:00.000Z");
        expect(writes()).toBe(1);
        expect(ticks()[0]).toBe("W31");
    });

    test("an edge RESIZE draws its snapped steps on the strip alone, and zooms the canvas once, on release", async () => {
        const { track, range, writes, ticks } = await brushFixture("plan-620-resize");
        // Grab the HI handle (winTo = 600px on the mocked track) and drag it left one snapped week: the draft
        // narrows W29..W33 → W29..W32 on the strip; the source and the canvas keep the four weeks.
        fireEvent.pointerDown(track, { clientX: 600, pointerId: 1, buttons: 1 });
        fireEvent.pointerMove(track, { clientX: 510, pointerId: 1, buttons: 1 });
        expect(writes()).toBe(0);
        expect(ticks()).toHaveLength(4);
        // Released: the narrower window, written once — a real zoom, the columns re-derived.
        fireEvent.pointerUp(track, { pointerId: 1 });
        await waitFor(() => expect(range().to.toISOString()).toBe("2026-08-03T00:00:00.000Z"));
        expect(range().from.toISOString()).toBe("2026-07-13T00:00:00.000Z");
        expect(writes()).toBe(1);
        expect(ticks()).toEqual(["W29", "W30", "W31"]);
    });
});

describe("the window is stated, or the slice's — never the rows' (#822)", () => {
    const noWindow = variant("time", {
        window: none, resolution: variant("week", null), resolutions: [], now: some(NOW), format: none,
    });
    /** A click on empty track, below the drag threshold — the brush's clear. */
    const clickEmptyTrack = (track: HTMLElement) => {
        fireEvent.pointerDown(track, { clientX: 900, pointerId: 1, buttons: 1 });
        fireEvent.pointerUp(track, { clientX: 901, pointerId: 1 });
    };

    test("the brush's clear falls back to a stated window, written into the sources as every window is (#1344)", async () => {
        const { container, track, range } = await brushFixture("plan-822-clear-stated");
        clickEmptyTrack(track);
        // The declared W27..W39 — the one window every source holds — twelve weeks from W27.
        expect(range().from.toISOString()).toBe(W27.toISOString());
        expect(range().to.toISOString()).toBe(W39.toISOString());
        const ticks = [...container.querySelectorAll('[data-slot="rulerTick"]')].map((e) => e.textContent);
        expect(ticks[0]).toBe("W27");
        expect(ticks).toHaveLength(12);
    });

    test("an axis that states none takes its window from the range — and the brush's clear keeps it", async () => {
        const { container, track, ranged, range } = await brushFixture("plan-822-clear-none", noWindow);
        expect(container.querySelector("[data-plan-empty]")).toBeNull();
        clickEmptyTrack(track);
        // Cleared, the canvas would have no window at all: the range stays.
        expect(ranged()).toBe(true);
        expect(range().from.toISOString()).toBe("2026-07-13T00:00:00.000Z");
        expect(container.querySelector("[data-plan-empty]")).toBeNull();
        expect(container.querySelector('[data-slot="rulerTick"]')!.textContent).toBe("W29");
    });

    test("with neither, the canvas says so — whatever its rows would span, inline or paged", () => {
        // Rows that would once have fitted the axis: a run W27..W29.
        const rows = [planRow("m1", spanKind([run("r1", W27, new Date("2026-07-13Z"), variant("actual", null))]))];
        const inline = renderPlan(planRoot(rows, { axis: noWindow }), "plan-822-nowindow");
        expect(inline.container.querySelector("[data-plan-empty]")!.textContent)
            .toBe("NO WINDOW — declare an axis window, or bind a slice whose range supplies it");
        expect(inline.container.querySelector("[data-run]")).toBeNull();
        cleanup();
        const source = {
            id: "plan-822-nowindow-paged", page: () => some(rows), total: () => some(1n),
            seek: none, revision: () => none, refresh: () => null,
        };
        const paged = renderPlan(planRoot([], { axis: noWindow, source }), "plan-822-nowindow-paged");
        expect(paged.container.querySelector("[data-plan-empty]")!.textContent)
            .toBe("NO WINDOW — declare an axis window, or bind a slice whose range supplies it");
    });
});

describe("Plan chrome tracks the slice store (#611)", () => {
    // The trap under test: the slice's reactivity re-renders the canvas when
    // the store moves, but a re-render does not bust a memo whose deps did
    // not move. A state write changes no value identity, so the store-read
    // counts must follow the store itself.
    test("the toolbar summary re-derives on a store write that changes NO rows", async () => {
        // Two dated rows live in the source, both in the axis's window — W27 and W36, another session's; the
        // canvas's own row is inline and never narrows. The source holds no window: the canvas writes the axis's.
        const W36 = new Date("2026-08-31T00:00:00Z");
        await h.patch(records.planDatedRows, new Map([
            ["r1", { at: W27, owner: "Team A", hall: "Hall 1" }],
            ["r2", { at: W36, owner: "Team B", hall: "Hall 1" }],
        ]));
        const rail = await bindRail(() => Slice.bindRecords("plan.summary.chrome", {
            rows: { source: Data.bindPaged(records.planDatedRows, { indexes: [records.planDatedRowsByAt] }), fields: { at: { label: "At" } }, range: "at" },
        }), ["summary"]);
        const part = rail.part("rows");
        const { container } = renderPlan(planRoot([planRow("m1", spanKind([]))], {
            slice: some(rail.chrome),
        }), "plan-611-summary");
        await settle();
        const summary = () => container.querySelector("[data-toolbar-item='record-summary'] [data-record-slices-summary]")?.textContent;
        // The window holds both rows: the summary names none (#1358).
        expect(summary()).toBeUndefined();

        // The window to now, W27 – 12 August: the W36 row leaves it, as e3 counts the record's index.
        await act(async () => {
            setRecordSliceWindow(part, W27.getTime(), NOW.getTime());
        });
        await settle();
        expect(summary()).toBe("1 of 2 rows");
    });
});

describe("Plan sizing (#320 / #567 D1)", () => {
    // 60 single-run span rows — enough that virtualization is observable.
    const many = Array.from({ length: 60 }, (_unused, i) =>
        planRow(`r${i}`, spanKind([
            run(`x${i}`, new Date("2026-06-29Z"), new Date("2026-07-13Z"), variant("actual", null)),
        ])));

    test("a declared height binds the WRAPPER and virtualizes the body", () => {
        const { container } = renderPlan(planRoot(many, { style: { height: "fill" } }), "plan-bounded");
        const body = container.querySelector("[data-plan-body]")!;
        // The bound must land on the wrapper: a percentage passed inward
        // resolves against an auto-height parent and silently unbinds, leaving
        // every row in flow (#567 D1).
        expect(body.hasAttribute("data-plan-bounded")).toBe(true);
        expect(container.querySelectorAll("[data-plan-row]").length).toBeLessThan(many.length);
    });

    test("an explicit px height binds the same way", () => {
        const { container } = renderPlan(planRoot(many, { style: { height: "400px" } }), "plan-bounded-px");
        expect(container.querySelector("[data-plan-body]")!.hasAttribute("data-plan-bounded")).toBe(true);
        expect(container.querySelectorAll("[data-plan-row]").length).toBeLessThan(many.length);
    });

    test("maxHeight alone binds", () => {
        const { container } = renderPlan(planRoot(many, { style: { maxHeight: "50%" } }), "plan-bounded-max");
        expect(container.querySelector("[data-plan-body]")!.hasAttribute("data-plan-bounded")).toBe(true);
    });

    test("no declared size keeps the grow-to-content flow — every row in flow", () => {
        const { container } = renderPlan(planRoot(many), "plan-unbounded");
        const body = container.querySelector("[data-plan-body]")!;
        expect(body.hasAttribute("data-plan-bounded")).toBe(false);
        expect(container.querySelectorAll("[data-plan-row]").length).toBe(many.length);
    });
});

describe("the series library is the library pane's Series tab (#590, #1193)", () => {
    test("a pick draws no Series button: the frame's one toolbar has none, and the canvas spends nothing on it (PB21)", () => {
        const pick = {
            key: "test.plan.pick",
            state: { read: () => [] as string[], write: () => {}, has: () => true },
            items: [
                { id: "a", title: "Press jobs", subtitle: none, icon: none, count: none, narrowed: false },
                { id: "b", title: "Hall load", subtitle: none, icon: none, count: none, narrowed: false },
            ],
        };
        const { container } = renderPlan(planRoot([planRow("m1", spanKind([]))], { pick }));
        expect(container.querySelector("[data-builder-frame]")).not.toBeNull();
        expect(container.querySelector("[data-slot='planLibraryTrigger']")).toBeNull();
        expect(screen.queryByRole("button", { name: "Series library" })).toBeNull();
        expect(container.querySelector("[data-slot='pickPanel']")).toBeNull();
        // Nothing else asks for a control here, so the frame draws no toolbar.
        expect(container.querySelector("[data-frame-slot='toolbar']")).toBeNull();
    });
});
