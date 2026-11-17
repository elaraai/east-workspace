/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A Plan of event kinds on the canvas (#1192, #1541, `Plan Builder Spec.md`
 * §9.4): its resources are its own rows, a resources series' or a kinds
 * case's — each a landing row, a row beside it for each further way its kinds
 * draw, its own series beneath it, under group strips and nested as their tree
 * is — and the Unassigned rows after them, the events read from the records
 * over the range the canvas draws, and read again when a record commits. Each
 * Plan is built by the e3-ui factory — the print works' examples, or a test's
 * own over their records — compiled and mounted through the dispatcher under
 * the record runtime a surface installs, its records and inputs in memory.
 * What a window of paged rows reads again on a commit is
 * `frame/plan-builder-paged.dom.test.tsx`'s.
 */

import { describe, test, expect, vi } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { editingMessages } from "@elaraai/east-ui-components";
import { ArrayType, DictType, East, RecursiveType, StringType, StructType, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { Plan, Record, SCHEDULE_EVENT_CAP, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-events";
import { rowKeyOf, type PlanRowId } from "./model.js";
import { PLAN_GEOMETRY } from "./geometry.js";
import { el, elementKey, entry, planHarness, ribbonWidth, rowAt, settle, slot } from "./frame/harness.test-utils.js";

// The print works on e3.
const h = planHarness({ "plan/plan-events": ex });

/** The selector of a group strip, by its id. */
const stripAt = (id: PlanRowId) => `[data-plan-group=${JSON.stringify(rowKeyOf(id))}]`;
/** The ids' text of every row and strip the canvas's grid draws, in order. */
const drawn = (container: HTMLElement): string[] =>
    [...container.querySelectorAll("[role='treegrid'] [data-plan-row], [role='treegrid'] [data-plan-group]")]
        .map((node) => node.getAttribute("data-plan-row") ?? node.getAttribute("data-plan-group")!);

type Jobs = ValueTypeOf<typeof ex.planPrintJobs.type>;
type Presses = ValueTypeOf<typeof ex.planPrintPresses.type>;
/** The smallest builder's jobs. */
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
        const { container } = await h.mount(ex.planPrintWorks);
        await settle();
        // The works' groups in their record's order, each a strip over its resources: a press its landing row of bars, a
        // row of its stops' marks beside it and its utilisation beneath; a crew its landing row of chips.
        const presses = [["1-presses-a", ["a1", "a2", "a3"]], ["2-presses-b", ["b1", "b2", "b3"]]] as const;
        const crews = [["3-crews-a", ["c1", "c2"]], ["4-crews-b", ["c3", "c4"]]] as const;
        expect(drawn(container)).toEqual([
            ...presses.flatMap(([hall, keys]) => [
                entry("groups", hall),
                ...keys.flatMap((k) => [entry("presses", hall, k), entry("presses.marks", hall, k), entry("util", hall, k)]),
            ]),
            ...crews.flatMap(([hall, keys]) => [entry("groups", hall), ...keys.map((k) => entry("crews", hall, k))]),
            entry("groups", "5-plates"), entry("setters", "5-plates", "ps"),
            entry("groups", "6-bindery"), entry("lines", "6-bindery", "bind"), entry("lines", "6-bindery", "fold"),
            entry("groups", "7-dispatch"), entry("bays", "7-dispatch", "bay"),
            entry("groups", "8-vans"), entry("vans", "8-vans", "van1"), entry("vans", "8-vans", "van2"),
            ...["board", "coated", "uncoated"].map(key => entry("stock", key)),
        ].map(rowKeyOf));
        // A press's bars are its jobs, its marks its stops; a crew's chips its shifts.
        const bars = container.querySelector(rowAt(entry("presses", "1-presses-a", "a1")))!;
        expect([...bars.querySelectorAll("[data-run]")].map((r) => r.getAttribute("data-run"))).toEqual(
            ["J-1001", "J-1002", "J-1003", "J-1004", "J-1005"].map((k) => elementKey("job", k)));
        expect(bars.querySelector(el("data-run", "job", "J-1001"))!.textContent).toContain("Spring catalogue");
        expect(container.querySelector(`${rowAt(entry("presses.marks", "1-presses-a", "a1"))} ${el("data-mark", "stop", "S-01")}`)).toBeTruthy();
        expect(container.querySelector(`${rowAt(entry("crews", "3-crews-a", "c1"))} ${el("data-chip", "shift", "SH-01")}`)).toBeTruthy();
        expect(container.querySelector(rowAt(entry("util", "2-presses-b", "b2")))!.getAttribute("data-plan-kind")).toBe("heat");
        // A press's landing row carries its name; the row beside it names the kinds that draw that way.
        expect(bars.textContent).toContain("Press A1");
        expect(container.querySelector(rowAt(entry("presses.marks", "1-presses-a", "a1")))!.textContent).toContain("Stop");
        expect(container.querySelector(stripAt(entry("groups", "2-presses-b")))!.textContent).toContain("Hall B");
    });

    test("the rows are read over the range the canvas draws — its window and the periods it lays out beyond each edge", async () => {
        // The smallest builder's spring catalogue, the day before the window opens, on Press A1.
        const early = jobsWith(EVENT_JOBS, "J-3001", (job) => ({ ...job, start: some(new Date("2026-10-04T06:00:00Z")), end: some(new Date("2026-10-04T08:00:00Z")) }));
        await h.commit(ex.planEventJobs, early);
        const { container } = await h.mount(ex.planEvents);
        await settle();
        // Drawn past the window's start, where a pan reveals it.
        expect(container.querySelector(`${rowAt(entry("presses", "a1"))} ${el("data-run", "job", "J-3001")}`)).toBeTruthy();
    });

    test("an event whose resource is none draws on its kind's Unassigned row, after every row", async () => {
        // The smallest builder's ticket books are timed, and on no press.
        const { container } = await h.mount(ex.planEvents);
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
        const { container } = await h.mount(ex.planEvents);
        await settle();
        expect(container.querySelector(`${rowAt(entry("presses", "a1"))} ${el("data-run", "job", "J-3001")}`)).toBeTruthy();
        await h.commit(ex.planEventJobs, jobsWith(EVENT_JOBS, "J-3001", (job) => ({ ...job, press: some("b3") })));
        expect(container.querySelector(`${rowAt(entry("presses", "a1"))} ${el("data-run", "job", "J-3001")}`)).toBeNull();
        expect(container.querySelector(`${rowAt(entry("presses", "b3"))} ${el("data-run", "job", "J-3001")}`)).toBeTruthy();
    });

    test("a series that cannot read a row fails the Plan, as any series over rows read whole does — saying why — and the next commit that reads draws the rows again (#1541)", async () => {
        // The presses are the canvas's own rows (#1541), so a series beneath them is read with them, as the Plan is drawn. A
        // paged window's failure is said on the footer's line (`plan-failure.dom.test.tsx`), and so is an event kind's own
        // read's (`optimise.dom.test.tsx`).
        const program = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const presses = $.let(Record.bind(ex.planPrintPresses, []));
            const jobs = $.let(Record.bind(ex.planPrintJobs, ["patch"]));
            // Each press's load: a press with none fails the series' read.
            const loads = $.const(LOADS, DictType(StringType, ArrayType(Plan.Types.HeatCell)));
            const axis = $.const(Plan.axis({ window: { min: FIRST, max: LAST }, resolution: "day" }));
            return Plan({
                axis,
                data: presses.read(),
                series: [Plan.series.resources(ex.PrintPress, {
                    key: "presses", title: "Presses", icon: "print", label: (p) => p.name,
                    series: [Plan.series.heat(ex.PrintPress, { key: "load", title: "Load", label: () => "Load", cells: (_p, key) => Plan.heatCells(loads.get(key)) })],
                })],
                events: { job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }) },
            });
        }))) };
        const { container } = await h.mount(program);
        await settle();
        /** The footer's one loading line. */
        const line = () => container.querySelector<HTMLElement>("[data-slot=footer] [data-footer-line]");
        const a1 = rowAt(entry("presses", "a1"));
        expect([container.querySelector(`${a1} ${el("data-run", "job", "J-1001")}`) !== null, line()?.hasAttribute("data-idle")]).toEqual([true, true]);
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const more = new Map(PRESSES);
            more.set("c1", { name: "Press C1", hall: "Hall C", sheets_per_hour: 9000.0 });
            await h.commit(ex.planPrintPresses, more);
            // A press whose load the series cannot read: the Plan says why.
            expect(container.textContent).toContain('Dict does not contain key "c1"');
        } finally {
            errors.mockRestore();
        }
        await h.commit(ex.planPrintPresses, PRESSES);
        expect([container.querySelector(`${a1} ${el("data-run", "job", "J-1001")}`) !== null, line()?.hasAttribute("data-idle")]).toEqual([true, true]);
        expect(container.textContent).not.toContain('Dict does not contain key "c1"');
    });
});

// ============================================================================
// Nesting (PB14)
// ============================================================================

/** Machines as a tree, each its own row's children: Line A over Press A2 over Press A3; Presses B1, B2 and B3 on their own. */
const Machine = RecursiveType((self) => StructType({ name: StringType, under: DictType(StringType, self) }));
type MachineValue = ValueTypeOf<typeof Machine>;
const machine = (name: string, under: [string, MachineValue][] = []): MachineValue => ({ name, under: new Map(under) }) as MachineValue;
const MACHINES = new Map([
    ["a1", machine("Line A", [["a2", machine("Press A2", [["a3", machine("Press A3")]])]])],
    ["b1", machine("Press B1")], ["b2", machine("Press B2")], ["b3", machine("Press B3")],
]);
/** Each press's load: none drawn, and none for a press there is no entry for. */
const LOADS = new Map(["a1", "a2", "a3", "b1", "b2", "b3"].map((k): [string, ValueTypeOf<typeof Plan.Types.HeatCell>[]] => [k, []]));
const FIRST = new Date("2026-10-05T00:00:00Z");
const LAST = new Date("2026-11-02T00:00:00Z");

describe("nesting (PB14)", () => {
    test("a resource nests under its parent in the tree its rows hold, and a parent declared collapsed draws folded from the first frame", async () => {
        const program = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const jobs = $.let(Record.bind(ex.planPrintJobs, ["patch"]));
            const machines = $.const(MACHINES, DictType(StringType, Machine));
            const axis = $.const(Plan.axis({ window: { min: FIRST, max: LAST }, resolution: "day" }));
            return Plan({
                axis,
                data: machines,
                series: [Plan.series.resources(Machine, {
                    key: "presses", title: "Machines", icon: "gears", label: (m) => m.name, children: "under", collapsed: (_m, key) => key.equal("a1"),
                })],
                events: { job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }) },
            });
        }))) };
        const { container } = await h.mount(program);
        await settle();
        // Line A is folded: Press A2 and Press A3, under it, are not drawn.
        expect(drawn(container)).toEqual([
            entry("presses", "a1"), entry("presses", "b1"), entry("presses", "b2"), entry("presses", "b3"),
        ].map(rowKeyOf));
        expect(container.querySelector(rowAt(entry("presses", "a1")))!.getAttribute("aria-expanded")).toBe("false");
    });
});

// ============================================================================
// Links between events (PB10, PB15)
// ============================================================================

describe("a link's event ends", () => {
    test("each end is found where its event draws — a plate's mark, a job's bar, a bindery job's chip, a delivery's tile: every row a link touches takes the links control, and a row's family draws every link (#1258)", async () => {
        const restore = ribbonWidth({ tall: true });
        try {
            const { container } = await h.mount(ex.planEventLinks);
            await settle();
            // Each resource's landing row: the plate setter's marks, a press's bars, a bindery line's chips, the bay's tiles.
            const ps = entry("setters", "ps");
            const a1 = entry("presses", "a1");
            const a2 = entry("presses", "a2");
            const a3 = entry("presses", "a3");
            const b1 = entry("presses", "b1");
            const b2 = entry("presses", "b2");
            const b3 = entry("presses", "b3");
            const fold = entry("lines", "fold");
            const bind = entry("lines", "bind");
            const bay = entry("bays", "bay");
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
            // A flow is a row of the flows' record, a link kind (#1541, U10): its link is named by its kind's slot and its
            // row's key, and the kind's links draw in their record's order.
            const flow = (key: string) => elementKey("flow", key);
            expect(ends).toEqual([
                [flow("book-blocks"), ...end(b2, "job", "J-2018"), ...end(bind, "binding", "B-04")],
                [flow("books"), ...end(bind, "binding", "B-03"), ...end(bay, "delivery", "D-01")],
                [flow("card"), ...end(b3, "job", "J-2020"), ...end(a2, "job", "J-2005")],
                [flow("covers"), ...end(a1, "job", "J-2001"), ...end(b1, "job", "J-2013")],
                [flow("folded"), ...end(fold, "binding", "B-02"), ...end(bind, "binding", "B-03")],
                [flow("inserts"), ...end(a1, "job", "J-2003"), ...end(b2, "job", "J-2016")],
                [flow("pads"), ...end(a3, "job", "J-2010"), ...end(a3, "job", "J-2011")],
                [flow("plates"), ...end(ps, "plate", "P-01"), ...end(a1, "job", "J-2001")],
                [flow("posters"), ...end(a1, "job", "J-2002"), ...end(bay, "delivery", "D-02")],
                [flow("proof-sheets"), ...end(b1, "job", "J-2012"), ...end(a2, "job", "J-2004")],
                [flow("proofs"), ...end(a3, "job", "J-2008"), ...end(b2, "job", "J-2015")],
                [flow("report-covers"), ...end(b3, "job", "J-2022"), ...end(a3, "job", "J-2009")],
                [flow("sections"), ...end(b3, "job", "J-2021"), ...end(fold, "binding", "B-01")],
                [flow("sections-more"), ...end(b3, "job", "J-2021"), ...end(fold, "binding", "B-02")],
                [flow("seed-prints"), ...end(b1, "job", "J-2014"), ...end(b2, "job", "J-2017")],
                [flow("tags"), ...end(a2, "job", "J-2006"), ...end(a2, "job", "J-2007")],
                [flow("tickets"), ...end(b2, "job", "J-2019"), ...end(b3, "job", "J-2023")],
            ]);
            // Each figure the case table names, in the links' order.
            expect([...container.querySelectorAll("[data-plan-link]")].map((g) => g.getAttribute("data-plan-route"))).toEqual([
                "loop", "s", "s", "s", "s", "loop", "runoff", "s", "s", "s", "loop", "loop", "s", "s", "loop", "feed", "s",
            ]);
        } finally {
            restore();
        }
    });

    test("a link kind's link selects by a click and is removed by Delete or by its ×, each a draft that Undo takes back (#1541, U10)", async () => {
        const restore = ribbonWidth({ tall: true });
        try {
            const { container } = await h.mount(ex.planEventLinks);
            await settle();
            fireEvent.click(container.querySelector(`${rowAt(entry("presses", "a1"))} [data-plan-control="links"]`)!);
            await settle();
            const flow = (key: string) => elementKey("flow", key);
            const hit = (key: string) => [...container.querySelectorAll("[data-link]")].find((path) => path.getAttribute("data-link-key") === key);
            const group = (key: string) => hit(key)?.closest("[data-plan-link]") ?? null;
            const keys = () => [...container.querySelectorAll("[data-link]")].map((path) => path.getAttribute("data-link-key"));
            const toolbar = within(slot(container, "toolbar")!);
            const undo = () => toolbar.getByRole("button", { name: editingMessages.undo() }) as HTMLButtonElement;
            const discard = () => toolbar.getByRole("button", { name: editingMessages.discard() }) as HTMLButtonElement;
            expect(keys()).toHaveLength(17);
            expect(discard().disabled).toBe(true);

            // The plates' flow carries no quantity, so no caption: selected, it is drawn in the ink all the same, with no ×.
            await act(async () => { fireEvent.click(hit(flow("plates"))!); });
            await settle();
            expect([group(flow("plates"))!.hasAttribute("data-selected"), container.querySelectorAll("[data-plan-link][data-selected]").length]).toEqual([true, 1]);
            expect(container.querySelector("[data-plan-ribbon-unlink]")).toBeNull();
            // Delete removes it: one draft, which Save waits on; the other sixteen stand.
            await act(async () => { fireEvent.keyDown(container.querySelector("[data-builder-frame]")!, { key: "Delete" }); });
            await settle();
            expect([keys().includes(flow("plates")), keys().length, discard().disabled]).toEqual([false, 16, false]);
            // Undo brings it back.
            await act(async () => { fireEvent.click(undo()); });
            await settle();
            expect([keys().includes(flow("plates")), keys().length]).toEqual([true, 17]);

            // The covers' flow has a caption: selected, its × removes it, named for its kind.
            await act(async () => { fireEvent.click(hit(flow("covers"))!); });
            await settle();
            expect(group(flow("covers"))!.hasAttribute("data-selected")).toBe(true);
            const unlink = container.querySelector<HTMLElement>("[data-plan-ribbon-unlink] button");
            expect(unlink?.getAttribute("aria-label")).toBe("Remove flow");
            await act(async () => { fireEvent.click(unlink!); });
            await settle();
            // It is gone, and nothing is selected. What it alone joined to Press A1's family leaves the focus with it, so
            // fewer than sixteen draw.
            expect([keys().includes(flow("covers")), keys().length < 17, container.querySelectorAll("[data-plan-link][data-selected]").length]).toEqual([false, true, 0]);
            await act(async () => { fireEvent.click(undo()); });
            await settle();
            expect(keys()).toHaveLength(17);
        } finally {
            restore();
        }
    });

    test("a link kind holding more links than are read draws none and says how many it holds; within the cap again, its links draw and the notice goes (#1541, U10)", async () => {
        const restore = ribbonWidth({ tall: true });
        try {
            const before = await h.read(ex.planLinkFlows);
            // Another planner books flows past the 10,000 a kind is read under: each from one job to another.
            const many = new Map(before);
            for (let i = 0; i < SCHEDULE_EVENT_CAP - before.size + 1; i++) {
                many.set(`extra-${String(i).padStart(5, "0")}`, { from: variant("job", "J-2001"), to: variant("job", "J-2013"), sheets: none });
            }
            await h.commit(ex.planLinkFlows, many);
            const { container } = await h.mount(ex.planEventLinks);
            await settle();
            const notice = () => container.querySelector('[data-plan-banner="links"]');
            expect(notice()?.getAttribute("data-plan-kind")).toBe("flow");
            expect(notice()!.textContent).toBe("10,001 flow links" + "Too many to draw: none of them is shown.");
            // No row has a link to focus on: none is read, so none is drawn.
            expect(container.querySelector('[data-plan-control="links"]')).toBeNull();
            expect(container.querySelectorAll("[data-link]")).toHaveLength(0);
            // Connect draws none of the flows: one it drew would draw nowhere. The flows are the Plan's one link kind, so it
            // offers no tools.
            const tools = () => within(slot(container, "toolbar")!).queryByRole("radiogroup", { name: "Tools" });
            expect(tools()).toBeNull();
            // The flows taken away again: within the cap, the seventeen draw and the notice goes, and Connect is offered.
            await h.commit(ex.planLinkFlows, new Map(before));
            await settle();
            await waitFor(() => expect(notice()).toBeNull());
            expect(tools()).not.toBeNull();
            fireEvent.click(container.querySelector(`${rowAt(entry("presses", "a1"))} [data-plan-control="links"]`)!);
            await settle();
            expect(container.querySelectorAll("[data-link]")).toHaveLength(17);
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
        const restore = ribbonWidth({ tall: true });
        try {
            const program = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
                const presses = $.let(Record.bind(ex.planPrintPresses, []));
                const jobs = $.let(Record.bind(ex.planPrintJobs, ["patch"]));
                const stops = $.let(Record.bind(ex.planPrintStops, ["patch"]));
                const axis = $.const(Plan.axis({ window: { min: FIRST, max: LAST }, resolution: "day" }));
                return Plan({
                    axis,
                    // The presses are the canvas's rows, a landing row each (#1541).
                    data: presses.read(),
                    series: [Plan.series.resources(ex.PrintPress, { key: "presses", title: "Presses", icon: "print", label: (p) => p.name })],
                    events: {
                        job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }),
                        stop: Schedule.events(stops, { name: "Stop", icon: "screwdriver-wrench", title: "title", at: "at", resource: { field: "press", of: "presses" } }),
                    },
                    links: [Plan.link({ key: "plates", from: Plan.eventRef("job", "J-1001"), to: Plan.eventRef("stop", "S-01") })],
                });
            }))) };
            const { container } = await h.mount(program);
            await settle();
            fireEvent.click(container.querySelector(`${rowAt(entry("presses", "a1"))} [data-plan-control="links"]`)!);
            await settle();
            expect(container.querySelector('[data-link="0"]')!.getAttribute("data-link-to")).toBe(rowKeyOf(entry("presses.marks", "a1")));
            // S-01 is at noon on 7 October: two and a half of the window's 28
            // days across the 1000px plot, past the 168px gutter. Its mark wears
            // its kind's icon, so the link meets the left edge of the icon's box.
            const head = container.querySelector('[data-plan-link="0"] [data-plan-ribbon-head]')!;
            expect(tipOf(head.getAttribute("d")!)[0]).toBe(Number((168 + (2.5 / 28) * 1000 - PLAN_GEOMETRY.default.markIconWidth / 2).toFixed(1)));
            // A link built in code is no link kind's row (#1541, U10): a click on it selects nothing.
            fireEvent.click(container.querySelector('[data-link="0"]')!);
            await settle();
            expect(container.querySelector("[data-plan-link][data-selected]")).toBeNull();
        } finally {
            restore();
        }
    });
});
