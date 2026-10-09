/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A Plan of event kinds on the canvas (#1192, `Plan Builder Spec.md` §9.4):
 * its resources' rows — a row per way their kinds draw, their measures, group
 * strips and nesting, and the Unassigned rows — lead every other row, read
 * from the records over the range the canvas draws, and read again when a
 * record commits. Each Plan is built by the e3-ui factory — the print works'
 * examples, or a test's own over their records — compiled and mounted through
 * the dispatcher under the record runtime a surface installs, its records and
 * inputs in memory.
 */

import { describe, test, expect, afterEach, afterAll, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import {
    ArrayType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, StringType, StructType,
    none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Paged } from "@elaraai/east-ui";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { getRegisteredPlatformImplementations, registerPlatformImplementation } from "@elaraai/east-ui-components";
import { Plan, Record, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-events";
import { rowKeyOf, type PlanRowId, type PlanWireRow } from "./model.js";
import { PLAN_GEOMETRY } from "./geometry.js";
import { NO_EDITS } from "./plan.test-utils.js";
import { dropJob, jobsDrawn, mountCanvas, pressRow, releaseCanvases, type PressValue } from "./plan-editing.test-utils.js";
import type { PlanEventRows } from "./root/events.js";
import { el, elementKey, entry, mount, planHarness, programOf, rowAt, settle } from "./frame/harness.test-utils.js";

const h = planHarness();

/** The selector of a group strip, by its id. */
const stripAt = (id: PlanRowId) => `[data-plan-group=${JSON.stringify(rowKeyOf(id))}]`;
/** The ids' text of every row and strip the canvas's grid draws, in order. */
const drawn = (container: HTMLElement): string[] =>
    [...container.querySelectorAll("[role='treegrid'] [data-plan-row], [role='treegrid'] [data-plan-group]")]
        .map((node) => node.getAttribute("data-plan-row") ?? node.getAttribute("data-plan-group")!);

type Jobs = ValueTypeOf<typeof ex.planPrintJobs.type>;
type Presses = ValueTypeOf<typeof ex.planPrintPresses.type>;
/** The print works' jobs, and the smallest builder's own. */
const JOBS = ex.planPrintJobs.default as Jobs;
const EVENT_JOBS = ex.planEventJobs.default as Jobs;
const PRESSES = ex.planPrintPresses.default as Presses;

/** A jobs record's seed with one job changed. */
function jobsWith(seed: Jobs, key: string, change: (job: ValueTypeOf<typeof ex.PrintJob>) => ValueTypeOf<typeof ex.PrintJob>): Jobs {
    const next = new Map(seed);
    next.set(key, change(seed.get(key)!));
    return next as unknown as Jobs;
}

// ============================================================================
// The print works (PB12–PB16)
// ============================================================================

describe("the print works' rows (PB12–PB16)", () => {
    test("each press its bars, its stops' marks and its utilisation, under its hall's strip; each crew its shifts' chips; every element its event, keyed by its kind and key", async () => {
        const { container } = mount(programOf(ex.planPrintWorks));
        await settle();
        const presses = [["Hall A", ["a1", "a2", "a3"]], ["Hall B", ["b1", "b2", "b3"]]] as const;
        const crews = [["Hall A", ["c1", "c2"]], ["Hall B", ["c3", "c4"]]] as const;
        expect(drawn(container)).toEqual([
            ...presses.flatMap(([hall, keys]) => [
                entry("presses.group", hall),
                ...keys.flatMap((k) => [entry("presses.span", hall, k), entry("presses.marks", hall, k), entry("util", hall, k)]),
            ]),
            ...crews.flatMap(([hall, keys]) => [entry("crews.group", hall), ...keys.map((k) => entry("crews.cards", hall, k))]),
        ].map(rowKeyOf));
        // A press's bars are its jobs, its marks its stops; a crew's chips its shifts.
        const bars = container.querySelector(rowAt(entry("presses.span", "Hall A", "a1")))!;
        expect([...bars.querySelectorAll("[data-run]")].map((r) => r.getAttribute("data-run"))).toEqual(
            ["J-1001", "J-1002", "J-1003", "J-1004", "J-1005"].map((k) => elementKey("job", k)));
        expect(bars.querySelector(el("data-run", "job", "J-1001"))!.textContent).toContain("Spring catalogue");
        expect(container.querySelector(`${rowAt(entry("presses.marks", "Hall A", "a1"))} ${el("data-mark", "stop", "S-01")}`)).toBeTruthy();
        expect(container.querySelector(`${rowAt(entry("crews.cards", "Hall A", "c1"))} ${el("data-chip", "shift", "SH-01")}`)).toBeTruthy();
        expect(container.querySelector(rowAt(entry("util", "Hall B", "b2")))!.getAttribute("data-plan-kind")).toBe("heat");
        // A press's first row carries its name; the next names the kinds that draw that way.
        expect(bars.textContent).toContain("Press A1");
        expect(container.querySelector(rowAt(entry("presses.marks", "Hall A", "a1")))!.textContent).toContain("Stop");
        expect(container.querySelector(stripAt(entry("presses.group", "Hall B")))!.textContent).toContain("Hall B");
    });

    test("the rows are read over the range the canvas draws — its window and the periods it lays out beyond each edge", async () => {
        // The smallest builder's spring catalogue, the day before the window opens, on Press A1.
        const early = jobsWith(EVENT_JOBS, "J-3001", (job) => ({ ...job, start: some(new Date("2026-10-04T06:00:00Z")), end: some(new Date("2026-10-04T08:00:00Z")) }));
        await h.commit(ex.planEventJobs, early);
        const { container } = mount(programOf(ex.planEvents));
        await settle();
        // Drawn past the window's start, where a pan reveals it.
        expect(container.querySelector(`${rowAt(entry("presses.span", "a1"))} ${el("data-run", "job", "J-3001")}`)).toBeTruthy();
    });

    test("an event whose resource is none draws on its kind's Unassigned row, after every resource kind", async () => {
        // The smallest builder's ticket books are timed, and on no press.
        const { container } = mount(programOf(ex.planEvents));
        await settle();
        const rows = drawn(container);
        expect(rows[rows.length - 1]).toBe(rowKeyOf(entry("job.unassigned", "span")));
        const lost = container.querySelector(rowAt(entry("job.unassigned", "span")))!;
        expect(lost.textContent).toContain("Unassigned");
        expect([...lost.querySelectorAll("[data-run]")].map((r) => r.getAttribute("data-run"))).toEqual([elementKey("job", "J-3009")]);
        // Drawn there alone: no press's row draws it.
        expect(container.querySelectorAll(el("data-run", "job", "J-3009"))).toHaveLength(1);
    });
});

// ============================================================================
// A record's commit (PB17)
// ============================================================================

describe("the rows follow the records", () => {
    test("a job moved to another press by a commit draws on that press's row", async () => {
        const { container } = mount(programOf(ex.planEvents));
        await settle();
        expect(container.querySelector(`${rowAt(entry("presses.span", "a1"))} ${el("data-run", "job", "J-3001")}`)).toBeTruthy();
        await h.commit(ex.planEventJobs, jobsWith(EVENT_JOBS, "J-3001", (job) => ({ ...job, press: some("b3") })));
        expect(container.querySelector(`${rowAt(entry("presses.span", "a1"))} ${el("data-run", "job", "J-3001")}`)).toBeNull();
        expect(container.querySelector(`${rowAt(entry("presses.span", "b3"))} ${el("data-run", "job", "J-3001")}`)).toBeTruthy();
    });

    test("a read that fails leaves the rows standing and says why; the next that reads clears it", async () => {
        const program = East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const presses = $.let(Record.bind(ex.planPrintPresses, []));
            const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
            // Each press's load: a press with none fails the rows' read.
            const loads = $.const(LOADS, DictType(StringType, ArrayType(Plan.Types.HeatCell)));
            const axis = $.const(Plan.axis({ window: { min: FIRST, max: LAST }, resolution: "day" }));
            return Plan({
                axis,
                resources: {
                    presses: Schedule.resources(presses.read(), {
                        name: "Presses", icon: "print", label: (p) => p.name,
                        measures: [Plan.series.heat(ex.PrintPress, { key: "load", title: "Load", label: () => "Load", cells: (_p, key) => Plan.heatCells(loads.get(key)) })],
                    }),
                },
                events: { job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }) },
            });
        }))), getRegisteredPlatformImplementations());
        const { container } = mount(program);
        await settle();
        const a1 = rowAt(entry("presses.span", "a1"));
        expect(container.querySelector(`${a1} ${el("data-run", "job", "J-1001")}`)).toBeTruthy();
        expect(container.querySelector('[data-plan-diagnostics="source"]')).toBeNull();
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const more = new Map(PRESSES);
            more.set("c1", { name: "Press C1", hall: "Hall C", sheets_per_hour: 9000.0 });
            await h.commit(ex.planPrintPresses, more);
            expect(container.querySelector('[data-plan-diagnostics="source"]')!.textContent).toMatch(/^source unavailable — /);
            expect(container.querySelector(`${a1} ${el("data-run", "job", "J-1001")}`)).toBeTruthy();
            expect(container.querySelector(rowAt(entry("presses.span", "c1")))).toBeNull();
        } finally {
            errors.mockRestore();
        }
        await h.commit(ex.planPrintPresses, PRESSES);
        expect(container.querySelector('[data-plan-diagnostics="source"]')).toBeNull();
        expect(container.querySelector(`${a1} ${el("data-run", "job", "J-1001")}`)).toBeTruthy();
    });
});

// ============================================================================
// Nesting (PB14)
// ============================================================================

/** A machine: its name and the one it sits under. */
const Machine = StructType({ name: StringType, parent: OptionType(StringType) });
/** Line A over Press A2 over Press A3; B1 and B2 name each other; B3 names a machine there is none of. */
const MACHINES = new Map([
    ["a1", { name: "Line A", parent: none }],
    ["a2", { name: "Press A2", parent: some("a1") }],
    ["a3", { name: "Press A3", parent: some("a2") }],
    ["b1", { name: "Press B1", parent: some("b2") }],
    ["b2", { name: "Press B2", parent: some("b1") }],
    ["b3", { name: "Press B3", parent: some("zz") }],
]);
/** Each press's load: none drawn, and none for a press there is no entry for. */
const LOADS = new Map(["a1", "a2", "a3", "b1", "b2", "b3"].map((k): [string, ValueTypeOf<typeof Plan.Types.HeatCell>[]] => [k, []]));
const FIRST = new Date("2026-10-05T00:00:00Z");
const LAST = new Date("2026-11-02T00:00:00Z");

describe("nesting (PB14)", () => {
    test("a resource nests under the one its parent names, and a parent declared collapsed draws folded from the first frame", async () => {
        const program = East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
            const machines = $.const(MACHINES, DictType(StringType, Machine));
            const axis = $.const(Plan.axis({ window: { min: FIRST, max: LAST }, resolution: "day" }));
            return Plan({
                axis,
                resources: {
                    presses: Schedule.resources(machines, {
                        name: "Machines", icon: "gears", label: (m) => m.name, parent: (m) => m.parent, collapsed: (_m, key) => key.equal("a1"),
                    }),
                },
                events: { job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }) },
            });
        }))), getRegisteredPlatformImplementations());
        const { container } = mount(program);
        await settle();
        // Line A is folded: Press A2 and Press A3, under it, are not drawn.
        expect(drawn(container)).toEqual([
            entry("presses.span", "a1"), entry("presses.span", "b1"), entry("presses.span", "b2"), entry("presses.span", "b3"),
        ].map(rowKeyOf));
        expect(container.querySelector(rowAt(entry("presses.span", "a1")))!.getAttribute("aria-expanded")).toBe("false");
    });
});

// ============================================================================
// Links between events (PB10, PB15)
// ============================================================================

describe("a link's event ends", () => {
    /**
     * jsdom lays nothing out. Give the ribbon layer its width — the 168px
     * gutter and a 1000px plot — and a bounded frame a view tall enough for
     * every row (TanStack sizes the frame by `offsetHeight`, the view reads
     * `clientHeight`), so every row mounts and no end clamps to an edge; every
     * other element keeps measuring 0.
     */
    function ribbonWidth(): () => void {
        const heightOf = (el: HTMLElement) => (el.getAttribute("data-virtual-rows") === "bounded" ? 4000 : 0);
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

    test("each end is found where its event draws — a plate's mark, a job's bar, a bindery job's chip, a delivery's tile: every row a link touches takes the links control, and a row's family draws every link (#1258)", async () => {
        const restore = ribbonWidth();
        try {
            const { container } = mount(programOf(ex.planEventLinks));
            await settle();
            const ps = entry("setters.marks", "ps");
            const a1 = entry("presses.span", "Hall A", "a1");
            const a2 = entry("presses.span", "Hall A", "a2");
            const a3 = entry("presses.span", "Hall A", "a3");
            const b1 = entry("presses.span", "Hall B", "b1");
            const b2 = entry("presses.span", "Hall B", "b2");
            const b3 = entry("presses.span", "Hall B", "b3");
            const fold = entry("lines.cards", "fold");
            const bind = entry("lines.cards", "bind");
            const bay = entry("bays.buckets", "bay");
            for (const row of [ps, a1, a2, a3, b1, b2, b3, fold, bind, bay]) {
                expect(container.querySelector(`${rowAt(row)} [data-plan-control="links"]`), rowKeyOf(row)).toBeTruthy();
            }
            fireEvent.click(container.querySelector(`${rowAt(a1)} [data-plan-control="links"]`)!);
            await settle();
            const ends = [...container.querySelectorAll("[data-link]")].map((path) => [
                path.getAttribute("data-link-key"),
                path.getAttribute("data-link-from"), path.getAttribute("data-link-from-run"),
                path.getAttribute("data-link-to"), path.getAttribute("data-link-to-run"),
            ]);
            const end = (row: PlanRowId, kind: string, key: string) => [rowKeyOf(row), elementKey(kind, key)];
            expect(ends).toEqual([
                ["plates", ...end(ps, "plate", "P-01"), ...end(a1, "job", "J-2001")],
                ["covers", ...end(a1, "job", "J-2001"), ...end(b1, "job", "J-2013")],
                ["card", ...end(b3, "job", "J-2020"), ...end(a2, "job", "J-2005")],
                ["inserts", ...end(a1, "job", "J-2003"), ...end(b2, "job", "J-2016")],
                ["report-covers", ...end(b3, "job", "J-2022"), ...end(a3, "job", "J-2009")],
                ["seed-prints", ...end(b1, "job", "J-2014"), ...end(b2, "job", "J-2017")],
                ["tags", ...end(a2, "job", "J-2006"), ...end(a2, "job", "J-2007")],
                ["pads", ...end(a3, "job", "J-2010"), ...end(a3, "job", "J-2011")],
                ["proofs", ...end(a3, "job", "J-2008"), ...end(b2, "job", "J-2015")],
                ["proof-sheets", ...end(b1, "job", "J-2012"), ...end(a2, "job", "J-2004")],
                ["tickets", ...end(b2, "job", "J-2019"), ...end(b3, "job", "J-2023")],
                ["sections", ...end(b3, "job", "J-2021"), ...end(fold, "binding", "B-01")],
                ["sections-more", ...end(b3, "job", "J-2021"), ...end(fold, "binding", "B-02")],
                ["folded", ...end(fold, "binding", "B-02"), ...end(bind, "binding", "B-03")],
                ["books", ...end(bind, "binding", "B-03"), ...end(bay, "delivery", "D-01")],
                ["posters", ...end(a1, "job", "J-2002"), ...end(bay, "delivery", "D-02")],
                ["book-blocks", ...end(b2, "job", "J-2018"), ...end(bind, "binding", "B-04")],
            ]);
            // Each figure the case table names, in the links' order.
            expect([...container.querySelectorAll("[data-plan-link]")].map((g) => g.getAttribute("data-plan-route"))).toEqual([
                "s", "s", "s", "loop", "loop", "loop", "feed", "runoff", "loop", "s", "s", "s", "s", "s", "s", "s", "loop",
            ]);
        } finally {
            restore();
        }
    });

    /** A triangle's tip — its second vertex. */
    const tipOf = (d: string): [number, number] => {
        const nums = d.trim().split(/[\sMLZ]+/).filter((s) => s !== "").map(Number);
        return [nums[2]!, nums[3]!];
    };

    test("a ribbon meets its event however it draws — at the edge of a stop's mark, not across its row (#1258)", async () => {
        const restore = ribbonWidth();
        try {
            const program = East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
                const presses = $.let(Record.bind(ex.planPrintPresses, []));
                const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
                const stops = $.let(Record.bind(ex.planPrintStops, [ex.planPrintStopsPatch]));
                const axis = $.const(Plan.axis({ window: { min: FIRST, max: LAST }, resolution: "day" }));
                return Plan({
                    axis,
                    resources: { presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name }) },
                    events: {
                        job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }),
                        stop: Schedule.events(stops, { name: "Stop", icon: "screwdriver-wrench", title: "title", at: "at", resource: { field: "press", of: "presses" } }),
                    },
                    links: [Plan.link({ key: "plates", from: Plan.eventRef("job", "J-1001"), to: Plan.eventRef("stop", "S-01") })],
                });
            }))), getRegisteredPlatformImplementations());
            const { container } = mount(program);
            await settle();
            fireEvent.click(container.querySelector(`${rowAt(entry("presses.span", "a1"))} [data-plan-control="links"]`)!);
            await settle();
            expect(container.querySelector('[data-link="0"]')!.getAttribute("data-link-to")).toBe(rowKeyOf(entry("presses.marks", "a1")));
            // S-01 is at noon on 7 October: two and a half of the window's 28
            // days across the 1000px plot, past the 168px gutter. Its mark wears
            // its kind's icon, so the link meets the left edge of the icon's box.
            const head = container.querySelector('[data-plan-link="0"] [data-plan-ribbon-head]')!;
            expect(tipOf(head.getAttribute("d")!)[0]).toBe(Number((168 + (2.5 / 28) * 1000 - PLAN_GEOMETRY.default.markIconWidth / 2).toFixed(1)));
        } finally {
            restore();
        }
    });
});

// ============================================================================
// Paged data beside event kinds
// ============================================================================

const UnitRow = StructType({ start: DateTimeType, end: DateTimeType, sheets: FloatType });
const Units = DictType(StringType, UnitRow);
/** Three units — module scope, so the East bodies call no host helper. */
const UNITS = new Map(Array.from({ length: 3 }, (_, i) => [
    `u${String(i).padStart(2, "0")}`,
    { start: FIRST, end: LAST, sheets: (i + 1) * 5 },
] as const));
/** The units as a paged source, built in East to the row-source contract: a window of them at a time, in key order. */
const UNITS_PAGE = East.function([IntegerType, IntegerType], OptionType(Units), ($, offset, limit) => {
    const all = $.const(UNITS, Units);
    const keys = $.let(all.toArray((_$, _v, k) => k));
    const n = $.let(keys.size());
    const start = $.let(offset.less(n).ifElse(() => offset, () => n));
    const end = $.let(start.add(limit).less(n).ifElse(() => start.add(limit), () => n));
    return some(all.getKeys(keys.slice(start, end).toSet()));
});
const UNITS_TOTAL = East.function([], OptionType(IntegerType), ($) => {
    const all = $.const(UNITS, Units);
    return some(all.size());
});
/** How many windows the counted source has served — a platform call in its page, so the page stays a real East function. */
let pagesServed = 0;
const countPage = East.platform("test_plan_event_rows_count_page", [], NullType);
const unregisterCount = registerPlatformImplementation([countPage.implement(() => { pagesServed += 1; })]);
afterAll(unregisterCount);
const COUNTED_PAGE = East.function([IntegerType, IntegerType], OptionType(Units), ($, offset, limit) => {
    $(countPage());
    const page = $.const(UNITS_PAGE);
    return page(offset, limit);
});
const UNITS_SOURCE = { id: "units", page: COUNTED_PAGE, total: UNITS_TOTAL, seek: none };

describe("paged data beside event kinds", () => {
    const program = East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const presses = $.let(Record.bind(ex.planPrintPresses, []));
        const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
        const source = $.const(UNITS_SOURCE, Paged.Types.Source(Units));
        const series = $.const([
            Plan.series.span(UnitRow, {
                key: "units", title: "Units", label: (_r, k) => k, id: true,
                runs: (r, k) => [Plan.run({ key: "run", start: r.start, end: r.end, label: East.str`RUN · ${k}`, state: "actual" })],
            }),
        ], ArrayType(Plan.Types.Series(UnitRow)));
        const axis = $.const(Plan.axis({ window: { min: FIRST, max: LAST }, resolution: "day" }));
        return Plan({
            axis, data: source, series,
            resources: { presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name }) },
            events: { job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }) },
        });
    }))), getRegisteredPlatformImplementations());
    const presses = ["a1", "a2", "a3", "b1", "b2", "b3"].map((k) => entry("presses.span", k));
    const units = ["u00", "u01", "u02"].map((k) => entry("units", k));

    test("a commit that changes none of the event kinds' rows reads no window again; one that moves a job does", async () => {
        const { container } = mount(program);
        await settle();
        expect(drawn(container)).toEqual([...presses, ...units].map(rowKeyOf));
        const served = pagesServed;
        // A waiting job's customer: no row draws it.
        await h.commit(ex.planPrintJobs, jobsWith(JOBS, "J-1030", (job) => ({ ...job, customer: "Someone else" })));
        expect(pagesServed).toBe(served);
        await h.commit(ex.planPrintJobs, jobsWith(JOBS, "J-1001", (job) => ({ ...job, press: some("b3") })));
        expect(pagesServed).toBeGreaterThan(served);
    });

    test("the event kinds' rows lead every window, drawn once, and a commit draws them again in place — the units' rows after them", async () => {
        const { container } = mount(program);
        await settle();
        expect(drawn(container)).toEqual([...presses, ...units].map(rowKeyOf));
        expect(container.querySelector('[data-slot="footerTransport"]')?.textContent).toBe("3 loaded of 3");
        expect(container.querySelector(`${rowAt(entry("presses.span", "a1"))} ${el("data-run", "job", "J-1001")}`)).toBeTruthy();
        // A commit moves a job: the windows are read again, and the rows they
        // lead with are the commit's — once each, the units' unchanged.
        await h.commit(ex.planPrintJobs, jobsWith(JOBS, "J-1001", (job) => ({ ...job, press: some("b3") })));
        expect(drawn(container)).toEqual([...presses, ...units].map(rowKeyOf));
        expect(container.querySelector(`${rowAt(entry("presses.span", "a1"))} ${el("data-run", "job", "J-1001")}`)).toBeNull();
        expect(container.querySelector(`${rowAt(entry("presses.span", "b3"))} ${el("data-run", "job", "J-1001")}`)).toBeTruthy();
        expect(container.querySelector(`${rowAt(entry("units", "u01"))} [data-run="run"]`)!.textContent).toContain("RUN · u01");
    });
});

// ============================================================================
// Beside `data`'s editing session (#880)
// ============================================================================

describe("the event kinds' rows beside `data`'s editing session (#880)", () => {
    afterEach(() => { releaseCanvases(); });

    /** 201 presses: the last, `p200`, is the first entry of the source's second window. */
    const MANY = new Map(Array.from({ length: 201 }, (_u, i): [string, PressValue] =>
        [`p${String(i).padStart(3, "0")}`, { label: `Press ${i}`, crew: none, jobs: [] }]));
    /** A machine's row, keyed as a press is. */
    const machine = (key: string): PlanWireRow => ({
        id: entry("machines.span", key), parent: none,
        gutter: { label: `Machine ${key}`, id: false, sub: none, value: none, meta: none, stacked: false, swatches: [] },
        kind: variant("span", { runs: [], decisions: [], ports: [], rollup: none }),
        collapsed: false, pinned: false, height: none, status: none, expand: none, edits: NO_EDITS,
    }) as unknown as PlanWireRow;
    /** Event rows leading every window — one resource kind's block, then the Unassigned rows' — its machine keyed `p200`. */
    const LEAD: PlanEventRows = {
        count: 2,
        blocks: () => some([{ fixed: true, parent: none, rows: [machine("p200")] }, { fixed: true, parent: none, rows: [] }]),
    };

    test("a job dropped on a paged entry is drafted from the window its own row came from — never from an event row whose path names its key", async () => {
        const canvas = await mountCanvas({ arm: "paged", seed: MANY, events: LEAD });
        const c = canvas.container;
        expect(c.querySelector(rowAt(entry("machines.span", "p200")))).toBeTruthy();
        await dropJob(canvas, "job-1", "p200");
        expect(jobsDrawn(c, "p200")).toEqual(["job-1"]);
        expect(pressRow(c, "p200").textContent).toContain("Press 200");
        expect(canvas.patches.map((p) => p.draftChanges.map((d) => d.id))).toEqual([["p200"]]);
    }, 30_000);
});
