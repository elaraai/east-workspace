/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Plan slice chrome DOM tests — a period's preset, which sets the range that
 * period fills from the window's own start (§3, #1344, #1740), the horizon
 * brush, which moves a record's window once a gesture and sets any range, the
 * columns' period following it (§7, #620, #1344, #1740), chrome that tracks the
 * slice store (#611), sizing
 * (#320 / #567 D1), and the series library, which is the library pane's
 * Series tab, not a toolbar button (#590, #1193). The narrowing is the Plan's
 * one `Slice.bindRecords` (#1344), its `dated` source the Plan's dated rows on
 * e3 itself (`rail.test-utils.ts`, #1376), holding the window as an event
 * kind's source or a tab's does: what it counts and its dates' extent read
 * from e3, the window its half-open range. The canvas's rows never follow the
 * dates: a `rows` source's range holds no window, and the canvas then holds
 * its own. A canvas persists its toggles under its storageKey (#813), and the
 * harness clears them after each test.
 *
 * (Split out of `plan.dom.test.tsx`, #815.)
 */

import { describe, test, expect } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { variant, some, none } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { system } from "@elaraai/east-ui-components";
import { recordSliceWindow, setRecordSliceWindow } from "@elaraai/east-ui-components/internal";
import { Data } from "@elaraai/e3-ui/internal";
import * as records from "@elaraai/e3-ui/examples/plan/plan-records";
import { act, e3Harness, settle } from "../e3-web-mount.test-utils.js";
import { EastChakraPlan, type PlanRootValue } from "./index.js";
import { PLAN_COLUMN_WIDTHS, PLAN_UNLAID_PLOT } from "./geometry.js";
import type { PlanWireRow } from "./model.js";
import type { PlanInstantValue } from "./instant.js";
import { planWindowParts } from "./root/sources.js";
import { blocksSource, oneBlock, keySurface, rowId } from "./plan.test-utils.js";
import { RAIL_MODULES, bindRail } from "./rail.test-utils.js";

const h = e3Harness(RAIL_MODULES, { measure: false });

const W27 = new Date("2026-06-29T00:00:00Z");           // Monday, ISO week 27
const W39 = new Date("2026-09-21T00:00:00Z");           // exclusive max → 12 weeks
const NOW = new Date("2026-08-12T00:00:00Z");
const DAY = 86_400_000;
/** How many columns a period's preset shows on a plot not laid out, as a canvas's in a DOM with no layout is (#1740). */
const PRESET = Math.floor(PLAN_UNLAID_PLOT / PLAN_COLUMN_WIDTHS.preset);
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

describe("a period pressed sets the range it fills at the preset width, from the window's own start, and the columns follow (§3, #1344, #1740)", () => {
    test("WEEK → DAY → WEEK: the twelve weeks the source holds come in to the day's preset from the same start, the window alone written; the week's is as many weeks from it", async () => {
        // The dated rows' window, twelve weeks from W27 — the source holds it, and it alone.
        const rail = await bindRail(() => Slice.bindRecords("plan.zoom", {
            dated: {
                source: Data.bindPaged(records.planDatedRows, { indexes: ["plan_dated_rows_by_at"] }),
                fields: { at: { label: "At" } }, range: "at", initial: { at: { from: W27, to: W39 } },
            },
        }), ["resolution"]);
        const part = rail.part("dated");
        const { container } = renderPlan(planRoot([planRow("m1", spanKind([]))], {
            slice: some(rail.chrome),
            resolutions: [variant("week", null), variant("day", null)],
        }));
        await settle();
        // Twelve weeks on the plot are weeks: a day's column there would be under the column floor.
        expect(container.querySelectorAll('[data-slot="rulerTick"]')).toHaveLength(12);
        const pressed = () => container.querySelector('[data-toolbar-item="resolution"] [aria-pressed="true"], [data-toolbar-item="resolution"] [aria-checked="true"]')?.textContent;
        expect(pressed()).toBe("WEEK");
        const before = rail.writes("dated");
        const resolution = part.read().resolution;
        fireEvent.click(screen.getByText("DAY"));
        await settle();
        // The day's preset from the twelve weeks' own start, W27: the start date never moves (ruled 23 Nov 2026). One
        // write, of the window, which is what a reader of the source reads; nothing of the period is written.
        expect(recordSliceWindow(part)).toEqual({ kind: "datetime", min: W27.getTime(), max: W27.getTime() + PRESET * DAY });
        expect(container.querySelectorAll('[data-slot="rulerTick"]')).toHaveLength(PRESET);
        expect(rail.writes("dated") - before).toBe(1);
        expect(part.read().resolution).toEqual(resolution);
        expect(pressed()).toBe("DAY");
        // The week: as many weeks, from the same start.
        fireEvent.click(screen.getByText("WEEK"));
        await settle();
        expect(recordSliceWindow(part)).toEqual({ kind: "datetime", min: W27.getTime(), max: W27.getTime() + PRESET * 7 * DAY });
        expect(rail.writes("dated") - before).toBe(2);
        expect(container.querySelectorAll('[data-slot="rulerTick"]')).toHaveLength(PRESET);
        expect(pressed()).toBe("WEEK");
    });

    test("WEEK → MONTH → WEEK: the months run from the window's own start to a month's edge, drawn from the first of its month; the weeks after them are from that start again", async () => {
        const rail = await bindRail(() => Slice.bindRecords("plan.zoom-fits", {
            dated: {
                source: Data.bindPaged(records.planDatedRows, { indexes: ["plan_dated_rows_by_at"] }),
                fields: { at: { label: "At" } }, range: "at", initial: { at: { from: W27, to: W39 } },
            },
        }), ["resolution"]);
        const part = rail.part("dated");
        const { container } = renderPlan(planRoot([planRow("m1", spanKind([]))], {
            slice: some(rail.chrome),
            resolutions: [variant("month", null), variant("week", null)],
        }));
        await settle();
        const ticks = () => [...container.querySelectorAll('[data-slot="rulerTick"]')].map((e) => e.textContent);
        const twelveWeeks = { kind: "datetime", min: W27.getTime(), max: W39.getTime() };
        expect(recordSliceWindow(part)).toEqual(twelveWeeks);
        const before = rail.writes("dated");
        // To the month: its preset, June the first of the months it shows. What the source holds starts on the 29th
        // still — never the 1st, where the month's columns draw from.
        fireEvent.click(screen.getByText("MONTH"));
        await settle();
        expect(recordSliceWindow(part)).toEqual({ kind: "datetime", min: W27.getTime(), max: Date.UTC(2026, 5 + PRESET, 1) });
        expect(ticks()).toHaveLength(PRESET);
        expect(ticks().slice(0, 3)).toEqual(["JUN", "JUL", "AUG"]);
        expect(rail.writes("dated") - before).toBe(1);
        // And the week: from W27 — never from the 1st of June, a Monday short of it.
        fireEvent.click(screen.getByText("WEEK"));
        await settle();
        expect(recordSliceWindow(part)).toEqual({ kind: "datetime", min: W27.getTime(), max: W27.getTime() + PRESET * 7 * DAY });
        expect(ticks()).toHaveLength(PRESET);
        expect(ticks()[0]).toBe("W27");
        expect(rail.writes("dated") - before).toBe(2);
    });
});

/** A slice-bound canvas whose brush strip spans a mocked 1300px track — the
 *  horizon's thirteen whole weeks at 100px each (#949) — its applied window
 *  W29..W33 at 200..600px: the dated rows' source holds the window, its rows —
 *  as e3 holds them deployed — W27's and W39's, the horizon their whole
 *  weeks. */
const brushFixture = async (key: string, axis?: unknown) => {
    // Applied window W29..W33 (4 weeks) inside the wider horizon. The rows span W27..W39, and the horizon is their
    // WHOLE weeks: W27 to the end of W39, thirteen of them — the last row's week counts once.
    const rail = await bindRail(() => Slice.bindRecords(key, {
        dated: {
            source: Data.bindPaged(records.planDatedRows, { indexes: ["plan_dated_rows_by_at"] }),
            fields: { at: { label: "At" } }, range: "at",
            initial: { at: { from: new Date("2026-07-13T00:00:00Z"), to: new Date("2026-08-10T00:00:00Z") } },
        },
    }), ["brush"]);
    const part = rail.part("dated");
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
        writes: () => rail.writes("dated"),
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

    test("nothing holds the window to a period's most: on an axis of days alone an end dragged to the track's end takes the window there, its start held, and a window drawn from the track's start to its end is all of it but a day (#1740)", async () => {
        const days = variant("time", { window: some({ min: W27, max: W39 }), resolution: variant("day", null), resolutions: [], now: some(NOW), format: none });
        const { container, track, range, writes, ticks } = await brushFixture("plan-1740-any-range", days);
        // The horizon in days: from W27 to the day after W39's row, eighty-five of them on the track.
        expect(screen.getByText("HORIZON · 85 D")).toBeTruthy();
        // The end handle, where the strip draws it, dragged to the track's end: ten weeks and a day from 13 July, where
        // six weeks were once the most a day showed.
        const hiAt = parseFloat(container.querySelector<HTMLElement>('[data-brush-zone][data-edge="hi"]')!.style.left) / 100 * 1300;
        fireEvent.pointerDown(track, { clientX: hiAt, pointerId: 1, buttons: 1 });
        fireEvent.pointerMove(track, { clientX: 1299, pointerId: 1, buttons: 1 });
        fireEvent.pointerUp(track, { pointerId: 1 });
        await waitFor(() => expect(range().to.toISOString()).toBe("2026-09-22T00:00:00.000Z"));
        expect(range().from.toISOString()).toBe("2026-07-13T00:00:00.000Z");
        expect(writes()).toBe(1);
        expect(ticks()).toHaveLength(71);
        // Drawn on the empty track before the window, from the second day to the track's end: the edge it started at
        // gives outward to its day's start, and the end goes where the hand does, the nearest day's edge.
        fireEvent.pointerDown(track, { clientX: 20, pointerId: 1, buttons: 1 });
        fireEvent.pointerMove(track, { clientX: 1299, pointerId: 1, buttons: 1 });
        fireEvent.pointerUp(track, { pointerId: 1 });
        await waitFor(() => expect(writes()).toBe(2));
        expect(range().from.toISOString()).toBe("2026-06-30T00:00:00.000Z");
        expect(range().to.toISOString()).toBe("2026-09-22T00:00:00.000Z");
        expect(ticks()).toHaveLength(84);
    });

    test("the columns' period follows the range the brush sets: four weeks of days, an end dragged out, are weeks, and dragged back in days again — each range on the edges of the period it takes (#1740)", async () => {
        const offered = variant("time", {
            window: some({ min: W27, max: W39 }), resolution: variant("week", null),
            resolutions: [variant("day", null), variant("week", null), variant("month", null)], now: some(NOW), format: none,
        });
        const { container, track, range, writes, ticks } = await brushFixture("plan-1740-period-follows", offered);
        const hiAt = () => parseFloat(container.querySelector<HTMLElement>('[data-brush-zone][data-edge="hi"]')!.style.left) / 100 * 1300;
        // Four weeks on the plot hold a day's column: the canvas opens on days, its horizon the eighty-five days.
        expect(ticks()).toHaveLength(28);
        expect(screen.getByText("HORIZON · 85 D")).toBeTruthy();
        // The end dragged out to the 8th of September, fifty-eight days: weeks, and the end on the nearest week's edge.
        fireEvent.pointerDown(track, { clientX: hiAt(), pointerId: 1, buttons: 1 });
        fireEvent.pointerMove(track, { clientX: 1100, pointerId: 1, buttons: 1 });
        // The strip alone draws the range under the hand: the canvas and the source keep the four weeks until release.
        expect(writes()).toBe(0);
        expect(ticks()).toHaveLength(28);
        fireEvent.pointerUp(track, { pointerId: 1 });
        await waitFor(() => expect(range().to.toISOString()).toBe("2026-09-07T00:00:00.000Z"));
        expect(range().from.toISOString()).toBe("2026-07-13T00:00:00.000Z");
        expect(writes()).toBe(1);
        expect(ticks()).toEqual(["W29", "W30", "W31", "W32", "W33", "W34", "W35", "W36"]);
        // The horizon is the thirteen whole weeks now, a hundred px each: the end dragged back in to the 24th of July.
        expect(screen.getByText("HORIZON · 13 WK")).toBeTruthy();
        fireEvent.pointerDown(track, { clientX: hiAt(), pointerId: 1, buttons: 1 });
        fireEvent.pointerMove(track, { clientX: 360, pointerId: 1, buttons: 1 });
        fireEvent.pointerUp(track, { pointerId: 1 });
        await waitFor(() => expect(range().to.toISOString()).toBe("2026-07-24T00:00:00.000Z"));
        expect(range().from.toISOString()).toBe("2026-07-13T00:00:00.000Z");
        expect(writes()).toBe(2);
        expect(ticks()).toHaveLength(11);
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
            dated: { source: Data.bindPaged(records.planDatedRows, { indexes: ["plan_dated_rows_by_at"] }), label: "Dated rows", fields: { at: { label: "At" } }, range: "at" },
        }), ["summary"]);
        const part = rail.part("dated");
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
        expect(summary()).toBe("1 of 2 dated rows");
    });
});

describe("the canvas's rows never follow the dates (#1344)", () => {
    test("a `rows` source's range holds no window: the canvas holds the axis's, and the brush, a pan and a step of the date navigator move it, writing nothing into the rows — their dates a field of the rail", async () => {
        // The canvas's rows' source naming a range of their dates, W29 to W33 — as an app written before a range there
        // meant nothing: the dates on screen never decide which rows are listed.
        const rail = await bindRail(() => Slice.bindRecords("plan.1344.rows", {
            rows: {
                source: Data.bindPaged(records.planDatedRows, { indexes: ["plan_dated_rows_by_at"] }),
                fields: { at: { label: "At" } }, range: "at",
                initial: { at: { from: new Date("2026-07-13T00:00:00Z"), to: new Date("2026-08-10T00:00:00Z") } },
            },
        }), ["fields", "brush"]);
        const part = rail.part("rows");
        const narrowing = recordSliceWindow(part);
        const { container } = renderPlan(planRoot([planRow("m1", spanKind([]))], { slice: some(rail.chrome) }), "plan-1344-rows");
        await settle();
        const ticks = () => [...container.querySelectorAll('[data-slot="rulerTick"]')].map((e) => e.textContent);
        const untouched = () => {
            expect(rail.writes("rows")).toBe(0);
            expect(recordSliceWindow(part)).toEqual(narrowing);
        };
        // The axis's twelve weeks from W27 — not the rows' four from W29 — and the rows' dates a chip of the rail.
        expect(ticks()).toHaveLength(12);
        expect(ticks()[0]).toBe("W27");
        expect(container.querySelector("[data-toolbar-item='record-slices'] [data-record-slice-source='rows'][data-record-slice-field='at']")).not.toBeNull();
        untouched();
        // The brush spans the axis's window and its twelve weeks again either side, thirty-six weeks on a 3,600px track,
        // so its lens is the strip's middle third and never fills it: its low edge, at 1,200px, dragged two weeks on.
        expect(screen.getByText("HORIZON · 36 WK")).toBeTruthy();
        const lens = () => [...container.querySelectorAll("[data-plan-lens] line")].map((line) => Number(line.getAttribute("x1")) / 1000);
        const [from, to] = lens();
        expect(from).toBeCloseTo(1 / 3, 6);
        expect(to).toBeCloseTo(2 / 3, 6);
        const track = container.querySelector("[data-brush-track]") as HTMLElement;
        let trackPx = 3600;
        Object.defineProperty(track, "getBoundingClientRect", {
            value: () => ({ left: 0, top: 0, right: trackPx, bottom: 32, width: trackPx, height: 32, x: 0, y: 0, toJSON: () => ({}) }),
        });
        fireEvent.pointerDown(track, { clientX: 1200, pointerId: 1, buttons: 1 });
        fireEvent.pointerMove(track, { clientX: 1400, pointerId: 1, buttons: 1 });
        fireEvent.pointerUp(track, { pointerId: 1 });
        await waitFor(() => expect(ticks()[0]).toBe("W29"));
        expect(ticks()).toHaveLength(10);
        untouched();
        // A pan, a week on.
        fireEvent.keyDown(keySurface(container), { key: "]" });
        expect(ticks()[0]).toBe("W30");
        untouched();
        // A step of the date navigator, the window's own ten weeks on, its weeks kept.
        fireEvent.click(within(container.querySelector<HTMLElement>("[data-toolbar-item='time-navigation']")!).getByRole("button", { name: "Next 10 weeks" }));
        expect(ticks()[0]).toBe("W40");
        expect(ticks()).toHaveLength(10);
        untouched();
        // The lens's body slides: the horizon is now the axis's window and the window shown, W27 to W50, with the window's
        // ten weeks again either side — forty-three weeks from W17, on a 4,300px track — and its body, from 2,300px, slid
        // a week on.
        expect(screen.getByText("HORIZON · 43 WK")).toBeTruthy();
        trackPx = 4300;
        fireEvent.pointerDown(track, { clientX: 2800, pointerId: 1, buttons: 1 });
        fireEvent.pointerMove(track, { clientX: 2900, pointerId: 1, buttons: 1 });
        fireEvent.pointerUp(track, { pointerId: 1 });
        await waitFor(() => expect(ticks()[0]).toBe("W41"));
        expect(ticks()).toHaveLength(10);
        untouched();
    });

    test("a source named among the canvas's rows' — `rows`, or a resource kind's — holds no window; every other source with a range of the axis's arm does", async () => {
        const dated = (fields: { at: { label: string } }) => ({
            source: Data.bindPaged(records.planDatedRows, { indexes: ["plan_dated_rows_by_at"] }), fields, range: "at" as const,
        });
        const rail = await bindRail(() => Slice.bindRecords("plan.1344.parts", {
            rows: dated({ at: { label: "At" } }), presses: dated({ at: { label: "Since" } }), deliveries: dated({ at: { label: "Delivered" } }),
        }), ["fields"]);
        // The `rows` source alone, while the canvas names no resource kind; beside a resource kind's, that too.
        expect(planWindowParts(rail.chrome, "time").map((p) => p.source)).toEqual(["presses", "deliveries"]);
        expect(planWindowParts(rail.chrome, "time", ["rows", "presses"]).map((p) => p.source)).toEqual(["deliveries"]);
        // An ordinal axis's list is its window: no source holds it.
        expect(planWindowParts(rail.chrome, "ordinal")).toEqual([]);
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
