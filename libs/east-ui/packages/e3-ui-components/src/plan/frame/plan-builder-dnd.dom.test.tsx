/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Plan builder's drag and drop (#1196, `Plan Builder Spec.md` §9.7, §10,
 * PB31–PB37, PB63), over the print works (`planPrintWorks`): every row of §10
 * with its refusals and what its ghost says — a template and a backlog event
 * dropped on a press, a bar moved along its press and across presses, a
 * selection moving together, a mark and a tile moved, an edge resizing a bar
 * and a chip, never shorter than one snap, an event dropped on the Backlog tab,
 * and an author's card setting its patch on a job, refused on a stop and
 * between events — each one step of the Plan's one history, which Undo takes
 * back; the Backlog tab reading the drafts; a drafted element's mark; and the
 * keyboard carrying an event's element along its kind's rows. A Plan with its
 * own `canDrop` over `Plan.Types.Candidate` puts its message on the ghost
 * and in the carry's words, and refuses a selection whole when one part is
 * refused; a kind whose Save is out takes a drop as any other, drafted beside
 * the Save's own change; and a series beneath a press that declares its moves
 * takes none while `data`'s own session takes none.
 *
 * Pointer geometry is laid out in jsdom (`layOutPlots`): each row's plot spans
 * the four weeks from Monday 5 October 2026, 100px a day.
 */

import { describe, test, expect } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import {
    ArrayType, DateTimeType, DictType, East, OptionType, SortedMap, StringType, StructType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, none,
    printFor, some, variant,
} from "@elaraai/east";
import { Reactive, RecordSliceStateType, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { editingMessages } from "@elaraai/east-ui-components";
import { getStore } from "@elaraai/east-ui-components/internal";
import { announced, layOut } from "@elaraai/east-ui-components/testing";
import { Data, Plan, Record, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-events";
import { boundFrame } from "../../sheet/frame.test-utils.js";
import { instantKey, timeInstant } from "../instant.js";
import { rowKeyOf, type PlanRowId } from "../model.js";
import { carry, carrySaid, dragTo, keyOn } from "../plan-move.test-utils.js";
import { act, drawnFrom, el, elementKey, entry, madeFrom, planHarness, ribbonWidth, rowAt, settle, slot, tabs } from "./harness.test-utils.js";
import { flowsPlan } from "./flows.test-utils.js";
import { pressKindStep, pressPlan } from "./press.test-utils.js";

const h = planHarness();

/** Each Plan is mounted under the page's drag layer, so its cards and elements drag. */
const DRAG = { drag: true } as const;

// ── The rows a drag lands on ──────────────────────────────────────────────────

/**
 * Each press's own row, which its bars draw on; Press A1's marks and its tiles, each a row beside it; and Crew 1's
 * own row, which its chips draw on — each press and crew a resource of the works' halls (#1541).
 */
const A1 = entry("presses", "1-presses-a", "a1");
const A2 = entry("presses", "1-presses-a", "a2");
const A3 = entry("presses", "1-presses-a", "a3");
const B1 = entry("presses", "2-presses-b", "b1");
const B2 = entry("presses", "2-presses-b", "b2");
const B3 = entry("presses", "2-presses-b", "b3");
const A1_MARKS = entry("presses.marks", "1-presses-a", "a1");
const A1_TILES = entry("presses.buckets", "1-presses-a", "a1");
const A2_TILES = entry("presses.buckets", "1-presses-a", "a2");
const C1 = entry("crews", "3-crews-a", "c1");

/** A row's plot: its drop cell. */
const plotOf = (c: HTMLElement, row: PlanRowId) => c.querySelector<HTMLElement>(`${rowAt(row)} [data-plan-plot]`)!;
/** A job's bar on a row. */
const bar = (c: HTMLElement, key: string, row = A1) => c.querySelector<HTMLElement>(`${rowAt(row)} ${el("data-run", "job", key)}`);
/** A stop's glyph on Press A1's marks. */
const stop = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`${rowAt(A1_MARKS)} [role="button"]${el("data-mark", "stop", key)}`);
/** A shift's chip on Crew 1. */
const chip = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`${rowAt(C1)} ${el("data-chip", "shift", key)}`);
/** The jobs a row draws, by their keys. */
const jobsOn = (c: HTMLElement, row: PlanRowId) => [...c.querySelectorAll(`${rowAt(row)} [data-run]`)].map((n) => n.getAttribute("data-run"));
/**
 * The keys of the jobs a row draws that were made from a template: the print works' jobs and shifts are read a window
 * at a time, so each is its template's key and a suffix drawn at random, read here rather than named.
 */
const jobsFrom = (c: HTMLElement, template: string, row = A1) => madeFrom(c.querySelector<HTMLElement>(rowAt(row))!, "data-run", "job", template);
/** An element's name — its title, its times, its state. */
const named = (node: HTMLElement | null) => node?.getAttribute("aria-label") ?? null;

// ── Laying the plots out ──────────────────────────────────────────────────────

type Rect = { left: number; top: number; width: number; height: number };

/** The plots' left edge, and a day's width in px. */
const PLOT_LEFT = 200;
const DAY_PX = 100;
/** The client x of an hour of a day of the window — day 0 is Monday 5 October. */
const xAt = (day: number, hour = 12) => PLOT_LEFT + (day + hour / 24) * DAY_PX;
/** Where the press of a card happens: clear of every plot. */
const OFF = { x: 20, y: 900 };

/**
 * Lay the rows' plots out, stacked 40px apart, each across the four weeks —
 * and `document.elementFromPoint` answering from them, after the elements given
 * first (what lies over a plot).
 *
 * @returns Each row's vertical centre
 */
function layOutPlots(c: HTMLElement, rows: readonly PlanRowId[], over: readonly (readonly [Element, Rect])[] = []): (row: PlanRowId) => number {
    const rects = new Map<Element, Rect>();
    for (const [node, rect] of over) rects.set(node, rect);
    const tops = new Map<string, number>();
    rows.forEach((row, i) => {
        rects.set(plotOf(c, row), { left: PLOT_LEFT, top: 40 * i, width: 28 * DAY_PX, height: 32 });
        tops.set(rowKeyOf(row), 40 * i + 16);
    });
    layOut(rects);
    return (row) => tops.get(rowKeyOf(row))!;
}

// ── The ghost, the library, the history ───────────────────────────────────────

/** What the ghost says while a drag rests, `refused:` before it when it says why not; `null` with no caption. */
const caption = () => {
    const node = document.querySelector("[data-drag-caption]");
    return node === null ? null : `${node.hasAttribute("data-refused") ? "refused: " : ""}${node.textContent}`;
};

/** The library pane. */
const pane = (c: HTMLElement) => slot(c, "start")!;
/** The open tab's panel. */
const panel = (c: HTMLElement) => pane(c).querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;
/** Opens a library tab, by its name. */
async function openTab(c: HTMLElement, name: string) {
    const tab = [...pane(c).querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent?.startsWith(`${name} `));
    if (tab === undefined) throw new Error(`no library tab ${name}`);
    fireEvent.click(tab);
    await settle();
}
/** A card of the open tab, by its key. */
const cardOf = (c: HTMLElement, key: string) => panel(c).querySelector<HTMLElement>(`[data-library-item=${JSON.stringify(key)}]`);
/** The open tab's cards, by their keys. */
const cardKeys = (c: HTMLElement) => [...panel(c).querySelectorAll("[data-library-item]")].map((n) => n.getAttribute("data-library-item"));
/** The open tab's frame: where an element returns to the library. */
const sinkOf = (c: HTMLElement) => panel(c).querySelector<HTMLElement>("[data-drag-sink]")!;

/** The history item's buttons, by the shared messages' words. */
const UNDO = editingMessages.undo();
const REDO = editingMessages.redo();
const SAVE = editingMessages.apply();
const historyButton = (c: HTMLElement, name: string) => within(slot(c, "toolbar")!).getByRole("button", { name }) as HTMLButtonElement;
/** Clicks a control as a pointer does, and lets what it starts settle. */
async function press(node: Element) {
    await act(async () => {
        fireEvent.mouseDown(node, { button: 0 });
        fireEvent.click(node);
    });
    await settle();
}
/** The footer's count of the changes waiting on Save. */
const pending = (c: HTMLElement) => slot(c, "footer")!.querySelector('[data-plan-count="pending"]')?.textContent ?? null;
/** Selects an event's element; Shift adds it. */
async function select(node: Element, add = false) {
    fireEvent.click(node, { shiftKey: add });
    await settle();
}
/** The inspector's title of what it shows. */
const inspected = (c: HTMLElement) => slot(c, "end")?.querySelector("[data-inspector-title]")?.textContent ?? null;

/** Drags a node from a point to another, lets go, and lets the canvas settle. */
async function drop(node: HTMLElement, at: { x: number; y: number }, to: { x: number; y: number }, shiftKey = false) {
    await dragTo(node, at, to, shiftKey);
    await settle();
}

// ── A Plan with its own veto ──────────────────────────────────────────────────

/** The print works' four weeks, a day a bucket. */
const FIRST = new Date("2026-10-05T00:00:00Z");
const LAST = new Date("2026-11-02T00:00:00Z");

/**
 * The jobs on the presses, with their templates — a record of their own,
 * following their source of the Plan's one rail (#1344) — and backlog, and the
 * stops as tiles in each press's day — its `canDrop` refusing Press B3, which
 * is down for service, whatever is dropped there.
 */
const vetoed = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const works = $.let(Data.bind(ex.planPrintWorksRows));
    const jobs = $.let(Record.bind(ex.planPrintJobs, ["patch"]));
    const stops = $.let(Record.bind(ex.planPrintStops, ["patch"]));
    const jobTemplates = $.let(Data.bind(ex.planPrintJobTemplates));
    const slice = $.let(Slice.bindRecords("plan.dnd.vetoed", {
        jobTemplates: { source: Data.bindPaged(ex.planPrintJobTemplates, { indexes: ["plan_print_job_templates_by_group"] }) },
    }));
    const axis = $.const(Plan.axis({ window: { min: FIRST, max: LAST }, resolution: "day" }));
    // The Plan's one check (#1541, U7): the row a drop would land on is the resource's own, its path ending in its key.
    const canDrop = $.const(East.function([Plan.Types.Candidate], OptionType(StringType), ($2, candidate) => {
        const said = $2.let(none, OptionType(StringType));
        $2.match(candidate.row, { some: ($3, row) => {
            $3.match(row, { entry: ($4, at) => {
                const steps = $4.let(at.path.size());
                $4.if(steps.greater(0n).and(() => at.path.get(steps.subtract(1n)).equal("b3")), ($5) => { $5.assign(said, some("Press B3 is down for service")); });
            } });
        } });
        return said;
    }));
    return Plan({
        axis,
        // The works' halls of presses, each a strip over its presses — the canvas's own rows (#1541).
        data: works.read().filter(($2, _group, key) => key.lessThan("3")),
        series: [Plan.series.group(ex.PrintWorksGroup, {
            key: "groups", title: "Works", label: (g) => g.name,
            children: Plan.children("resources", [Plan.series.kinds(ex.PrintResource, "what", {
                press: { key: "presses", title: "Presses", icon: "print", label: (r) => r.name },
                crew: false, setter: false, line: false, bay: false, van: false,
            })]),
        })],
        events: {
            job: Schedule.events(jobs, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" },
                backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
                templates: Schedule.templates(jobTemplates.read(), {
                    name: (t) => t.name, group: (t) => some(t.group), duration: (t) => variant("hours", t.hours), values: (t) => t.values, source: "jobTemplates",
                }),
            }),
            stop: Schedule.events(stops, {
                name: "Stop", icon: "screwdriver-wrench", draw: "buckets", title: "title", at: "at",
                resource: { field: "press", of: "presses" },
            }),
        },
        library: [Plan.library.events(), Plan.library.backlog()],
        slice: { slice },
        canDrop,
    });
}))) };

/** What a card of the stops' tab here is: a title a stop takes. */
const StopCard = StructType({ title: StringType });

/**
 * The jobs as bars and the stops as tiles on the presses, a tab whose cards
 * retitle a stop, and a `canDrop` written as the print works' is: it refuses
 * Press A1 by its own row — the `presses` series, its path ending in the
 * press's key — whatever lands there.
 */
const stopCards = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const works = $.let(Data.bind(ex.planPrintWorksRows));
    const jobs = $.let(Record.bind(ex.planPrintJobs, ["patch"]));
    const stops = $.let(Record.bind(ex.planPrintStops, ["patch"]));
    const cards = $.const(new Map([["inspection", { title: "Inspection" }]]), DictType(StringType, StopCard));
    const canDrop = $.const(East.function([Plan.Types.Candidate], OptionType(StringType), ($2, candidate) => {
        const said = $2.let(none, OptionType(StringType));
        $2.match(candidate.row, { some: ($3, row) => {
            $3.match(row, { entry: ($4, at) => {
                const steps = $4.let(at.path.size());
                $4.if(at.series.equal("presses").and(() => steps.greater(0n)).and(() => at.path.get(steps.subtract(1n)).equal("a1")), ($5) => {
                    $5.assign(said, some("Press A1 takes no change today"));
                });
            } });
        } });
        return said;
    }));
    return Plan({
        axis: Plan.axis({ window: { min: FIRST, max: LAST }, resolution: "day" }),
        data: works.read().filter(($2, _group, key) => key.lessThan("3")),
        series: [Plan.series.group(ex.PrintWorksGroup, {
            key: "groups", title: "Works", label: (g) => g.name,
            children: Plan.children("resources", [Plan.series.kinds(ex.PrintResource, "what", {
                press: { key: "presses", title: "Presses", icon: "print", label: (r) => r.name },
                crew: false, setter: false, line: false, bay: false, van: false,
            })]),
        })],
        events: {
            job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }),
            stop: Schedule.events(stops, { name: "Stop", icon: "screwdriver-wrench", draw: "buckets", title: "title", at: "at", resource: { field: "press", of: "presses" } }),
        },
        library: [Plan.library.tab(cards, { name: "Stops", label: (card) => card.title, drop: (card) => Schedule.patch(ex.PrintStop, { title: card.title }) })],
        canDrop,
    });
}))) };

/** A run a press is booked for outside the jobs: its name and its times. */
const PressRun = StructType({ label: StringType, start: DateTimeType, end: DateTimeType });
/** A press and the runs it is booked for, by id. */
const BookedPress = StructType({ name: StringType, runs: DictType(StringType, PressRun) });
/** Press A1's own row, which its jobs draw on, and the row of its booked runs beneath it. */
const BOOKED_A1 = entry("presses", "a1");
const RUNS_A1 = entry("booked", "a1");

/**
 * The jobs on Press A1, a row of `data`'s, with the runs it is booked for a
 * series beneath it that declares its moves — and no editing session of
 * `data`'s, so those runs take no gesture.
 */
const beside = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const jobs = $.let(Record.bind(ex.planPrintJobs, ["patch"]));
    const presses = $.const(new Map([["a1", {
        name: "Press A1", runs: new Map([["w1", { label: "Make-ready", start: new Date("2026-10-06T06:00:00Z"), end: new Date("2026-10-06T12:00:00Z") }]]),
    }]]), DictType(StringType, BookedPress));
    return Plan({
        axis: Plan.axis({ window: { min: FIRST, max: LAST }, resolution: "day" }),
        data: presses,
        series: [Plan.series.resources(BookedPress, {
            key: "presses", title: "Presses", icon: "print", label: (p) => p.name,
            series: [Plan.series.span(BookedPress, {
                key: "booked", title: "Booked",
                runs: Plan.items("runs", { from: "start", to: "end" }, (r) => ({ label: r.label, state: "confirmed" })),
                edit: true,
            })],
        })],
        events: {
            job: Schedule.events(jobs, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" },
                backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
            }),
        },
    });
}))) };

/**
 * The jobs on the presses drawn as tiles in each press's day — a kind with a
 * start and an end, its tile at its start — with the inspector, which says
 * when one runs.
 */
const tiled = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const works = $.let(Data.bind(ex.planPrintWorksRows));
    const jobs = $.let(Record.bind(ex.planPrintJobs, ["patch"]));
    return Plan({
        axis: Plan.axis({ window: { min: FIRST, max: LAST }, resolution: "day" }),
        // The works' halls of presses, each a strip over its presses — the canvas's own rows (#1541).
        data: works.read().filter(($2, _group, key) => key.lessThan("3")),
        series: [Plan.series.group(ex.PrintWorksGroup, {
            key: "groups", title: "Works", label: (g) => g.name,
            children: Plan.children("resources", [Plan.series.kinds(ex.PrintResource, "what", {
                press: { key: "presses", title: "Presses", icon: "print", label: (r) => r.name },
                crew: false, setter: false, line: false, bay: false, van: false,
            })]),
        })],
        events: {
            job: Schedule.events(jobs, {
                name: "Print job", icon: "file-lines", draw: "buckets", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" },
                backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
            }),
        },
        inspector: true,
    });
}))) };

/** The jobs on the presses, and the customers: a card dropped on a job sets its customer and its stock. */
const stocked = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const works = $.let(Data.bind(ex.planPrintWorksRows));
    const jobs = $.let(Record.bind(ex.planPrintJobs, ["patch"]));
    const customers = $.let(Record.bind(ex.planPrintCustomers, []));
    return Plan({
        axis: Plan.axis({ window: { min: FIRST, max: LAST }, resolution: "day" }),
        // The works' halls of presses, each a strip over its presses — the canvas's own rows (#1541).
        data: works.read().filter(($2, _group, key) => key.lessThan("3")),
        series: [Plan.series.group(ex.PrintWorksGroup, {
            key: "groups", title: "Works", label: (g) => g.name,
            children: Plan.children("resources", [Plan.series.kinds(ex.PrintResource, "what", {
                press: { key: "presses", title: "Presses", icon: "print", label: (r) => r.name },
                crew: false, setter: false, line: false, bay: false, van: false,
            })]),
        })],
        events: {
            job: Schedule.events(jobs, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" },
                backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
            }),
        },
        library: [Plan.library.tab(customers.read(), {
            name: "Customers", icon: "building", label: (cu) => cu.name,
            drop: (cu) => Schedule.patch(ex.PrintJob, { customer: cu.name, stock: variant("board", null) }),
        })],
    });
}))) };

/** The jobs record as e3 holds it now, read as another planner would. */
const readJobs = () => h.read(ex.planPrintJobs);
const sameJob = equalFor(ex.PrintJob);

// ============================================================================
// A template, onto a resource's row (PB32)
// ============================================================================

describe("a template card dropped on a resource's row (PB32)", () => {
    test("creates an event of its kind at the bucket under the pointer, for its duration, selected — the ghost saying what lands where, one step Undo takes back", async () => {
        const { container: c } = await h.mount(ex.planPrintWorks, DRAG);
        await settle();
        const card = cardOf(c, elementKey("job", "brochure"))!;
        expect(card.hasAttribute("data-draggable")).toBe(true);
        const y = layOutPlots(c, [A1, C1]);
        const letGo = await carry(card, OFF, { x: xAt(7), y: y(A1) });
        expect(plotOf(c, A1).hasAttribute("data-drop-active")).toBe(true);
        expect(caption()).toBe("Brochure run · Press A1 · Mon, Oct 12, 2026");
        // The band spans the six hours it would run: from the day's start, a quarter of a day.
        const band = plotOf(c, A1).querySelector<HTMLElement>("[data-plan-drop-preview]")!;
        expect(parseFloat(band.style.left)).toBeCloseTo(100 * 7 / 28, 6);
        expect(parseFloat(band.style.width)).toBeCloseTo(100 * 0.25 / 28, 6);
        await letGo();
        await settle();
        expect(announced()).toBe("Brochure run was dropped on Press A1, Mon, Oct 12, 2026.");
        // A new job, keyed from its template, drawn where it was dropped, selected, and drafted.
        const [key, ...more] = jobsFrom(c, "brochure");
        expect([more, key]).toEqual([[], expect.stringMatching(drawnFrom("brochure"))]);
        const made = bar(c, key!);
        expect(named(made)).toMatch(/^Brochure run, Oct 12, 2026 – Oct 12, 2026, 06:00, proposed/);
        expect(made!.getAttribute("aria-pressed")).toBe("true");
        expect(made!.hasAttribute("data-draft")).toBe(true);
        expect(inspected(c)).toBe("Brochure run");
        expect(pending(c)).toBe("1 pending");
        await press(historyButton(c, UNDO));
        expect(bar(c, key!)).toBeNull();
        expect(pending(c)).toBe("0 pending");
        expect(historyButton(c, UNDO).disabled).toBe(true);
    });

    test("templates highlight only matching sub-rows and refuse a different draw on the same resource", async () => {
        const { container: c } = await h.mount(ex.planPrintWorks, DRAG);
        await settle();
        let y = layOutPlots(c, [A1, A1_MARKS, C1]);
        // The early shift starts at 06:00 for eight hours on the cards row.
        const letGo = await carry(cardOf(c, elementKey("shift", "early"))!, OFF, { x: xAt(8), y: y(C1) });
        expect(plotOf(c, A1).hasAttribute("data-drop-valid")).toBe(false);
        expect(plotOf(c, A1_MARKS).hasAttribute("data-drop-valid")).toBe(false);
        expect(caption()).toBe("Early shift · Crew 1 · Tue, Oct 13, 2026 · 06:00");
        await letGo();
        await settle();
        const [early, ...others] = madeFrom(c.querySelector<HTMLElement>(rowAt(C1))!, "data-chip", "shift", "early");
        expect([others, early]).toEqual([[], expect.stringMatching(drawnFrom("early"))]);
        expect(named(chip(c, early!))).toMatch(/^Early, Oct 13, 2026, 06:00 – Oct 13, 2026, 14:00/);
        // A mark cannot land on the neighbouring bars, even on the same press.
        y = layOutPlots(c, [A1, A1_MARKS, C1]);
        const refused = await carry(cardOf(c, elementKey("stop", "plates"))!, OFF, { x: xAt(3), y: y(A1) });
        expect(plotOf(c, A1_MARKS).hasAttribute("data-drop-valid")).toBe(true);
        expect(plotOf(c, A1).hasAttribute("data-drop-valid")).toBe(false);
        expect(plotOf(c, A1).hasAttribute("data-drop-invalid")).toBe(true);
        expect(caption()).toBe("refused: Drop on a Stop row");
        await refused();
        expect(stop(c, "plates-2")).toBeNull();
        expect(pending(c)).toBe("1 pending");
        await drop(cardOf(c, elementKey("stop", "plates"))!, OFF, { x: xAt(3), y: y(A1_MARKS) });
        expect(named(stop(c, "plates-2"))).toMatch(/Oct 8, 2026/);
        expect(pending(c)).toBe("2 pending");
    });

    test("refused on a resource of a kind it is not placed on — the ghost says what it needs, in red, and the drop makes nothing", async () => {
        const { container: c } = await h.mount(ex.planPrintWorks, DRAG);
        await settle();
        const y = layOutPlots(c, [A1, C1]);
        const letGo = await carry(cardOf(c, elementKey("job", "brochure"))!, OFF, { x: xAt(7), y: y(C1) });
        expect(plotOf(c, C1).hasAttribute("data-drop-invalid")).toBe(true);
        expect(plotOf(c, C1).hasAttribute("data-drop-active")).toBe(false);
        expect(caption()).toBe("refused: Needs presses");
        await letGo();
        // Said with the ghost's words (#1680's review).
        expect(announced()).toBe("Brochure run was not dropped: Needs presses.");
        expect(chip(c, "brochure-2")).toBeNull();
        expect(pending(c)).toBe("0 pending");
    });

    test("refused where the Plan's canDrop says so — its message on the ghost; taken a press away", async () => {
        const { container: c } = await h.mount(vetoed, DRAG);
        await settle();
        const y = layOutPlots(c, [B2, B3]);
        const card = cardOf(c, elementKey("job", "brochure"))!;
        const letGo = await carry(card, OFF, { x: xAt(9), y: y(B3) });
        expect(plotOf(c, B3).hasAttribute("data-drop-invalid")).toBe(true);
        expect(caption()).toBe("refused: Press B3 is down for service");
        await letGo();
        expect(jobsOn(c, B3)).not.toContain(elementKey("job", "brochure-2"));
        await drop(card, OFF, { x: xAt(9), y: y(B2) });
        expect(jobsOn(c, B2)).toContain(elementKey("job", "brochure-2"));
    });

    test("dropped twice on one day it makes two events, each under a new key of its own", async () => {
        const { container: c } = await h.mount(ex.planPrintWorks, DRAG);
        await settle();
        let y = layOutPlots(c, [A1]);
        await drop(cardOf(c, elementKey("job", "brochure"))!, OFF, { x: xAt(7), y: y(A1) });
        y = layOutPlots(c, [A1]);
        await drop(cardOf(c, elementKey("job", "brochure"))!, OFF, { x: xAt(7), y: y(A1) });
        const made = jobsFrom(c, "brochure");
        expect([made.length, new Set(made).size, made.every((key) => drawnFrom("brochure").test(key))]).toEqual([2, 2, true]);
        for (const key of made) expect(named(bar(c, key))).toMatch(/^Brochure run, Oct 12, 2026 – Oct 12, 2026, 06:00/);
        expect(pending(c)).toBe("2 pending");
    });

    test("taken while its kind's Save is out, as any other drop: the new job is drafted beside the Save's own change, and is the one change left to save once the Save is back", async () => {
        const { container: c } = await h.mount(ex.planPrintWorks, DRAG);
        await settle();
        let y = layOutPlots(c, [A1, A3]);
        // A draft to save: the spring catalogue a day on.
        await drop(bar(c, "J-1001")!, { x: xAt(0, 9), y: y(A1) }, { x: xAt(1, 9), y: y(A1) });
        // The writes held on their way to e3: saving.
        const writes = h.e3.hold((request) => request.kind === "mutate");
        await press(historyButton(c, SAVE));
        await writes.holding;
        // A Save never stops the editing: the ghost says what lands where, and the drop makes the job.
        y = layOutPlots(c, [A1, A3]);
        const letGo = await carry(cardOf(c, elementKey("job", "brochure"))!, OFF, { x: xAt(9), y: y(A3) });
        expect(plotOf(c, A3).hasAttribute("data-drop-invalid")).toBe(false);
        expect(caption()).toBe("Brochure run · Press A3 · Wed, Oct 14, 2026");
        await letGo();
        await settle();
        const [made, ...more] = jobsFrom(c, "brochure", A3);
        expect([more, made]).toEqual([[], expect.stringMatching(drawnFrom("brochure"))]);
        expect(bar(c, made!, A3)!.hasAttribute("data-draft")).toBe(true);
        expect(pending(c)).toBe("2 pending");
        await act(async () => { writes.release(); });
        await settle();
        // The Save is back: the catalogue's move is saved, and the job dropped meanwhile is the one change left.
        await waitFor(() => expect(pending(c)).toBe("1 pending"));
        expect(bar(c, "J-1001")!.hasAttribute("data-draft")).toBe(false);
        expect(bar(c, made!, A3)!.hasAttribute("data-draft")).toBe(true);
        expect((await readJobs()).has(made!)).toBe(false);
        // Saved in its turn, it is the record's.
        await press(historyButton(c, SAVE));
        await waitFor(() => expect(pending(c)).toBe("0 pending"));
        expect((await readJobs()).has(made!)).toBe(true);
    });
});

// ============================================================================
// A backlog event, onto a resource's row (PB33) — the Backlog tab reading the drafts
// ============================================================================

describe("a backlog card dropped on a resource's row (PB33)", () => {
    test("schedules its event — its start, its end from its duration and its resource; it leaves the Backlog tab at once, and Undo brings it back", async () => {
        const { container: c } = await h.mount(ex.planPrintWorks, DRAG);
        await settle();
        await openTab(c, "Backlog");
        expect(tabs(pane(c))[1]).toBe("Backlog 8");
        const reprint = elementKey("job", "J-1023");
        expect(cardKeys(c)).toContain(reprint);
        const y = layOutPlots(c, [A3, C1]);
        // The guide reprint takes three hours (24,000 sheets at 8,000 an hour), onto Press A3's Friday.
        const letGo = await carry(cardOf(c, reprint)!, OFF, { x: xAt(4), y: y(A3) });
        expect(caption()).toBe("Guide reprint · Press A3 · Fri, Oct 9, 2026");
        await letGo();
        await settle();
        expect(named(bar(c, "J-1023", A3))).toMatch(/^Guide reprint, Oct 9, 2026 – Oct 9, 2026, 03:00/);
        expect(bar(c, "J-1023", A3)!.hasAttribute("data-draft")).toBe(true);
        // The tab reads the drafts: the card has left it.
        expect(tabs(pane(c))[1]).toBe("Backlog 7");
        expect(cardKeys(c)).not.toContain(reprint);
        await press(historyButton(c, UNDO));
        expect(bar(c, "J-1023", A3)).toBeNull();
        expect(tabs(pane(c))[1]).toBe("Backlog 8");
        expect(cardKeys(c)).toContain(reprint);
    });

    test("refused on a crew, and where canDrop refuses it — the same refusals as a template's", async () => {
        const works = await h.mount(ex.planPrintWorks, DRAG);
        await settle();
        await openTab(works.container, "Backlog");
        let y = layOutPlots(works.container, [A3, C1]);
        const letGo = await carry(cardOf(works.container, elementKey("job", "J-1023"))!, OFF, { x: xAt(4), y: y(C1) });
        expect(caption()).toBe("refused: Needs presses");
        await letGo();
        works.unmount();
        const { container: c } = await h.mount(vetoed, DRAG);
        await settle();
        await openTab(c, "Backlog");
        y = layOutPlots(c, [B3]);
        const vetoedLetGo = await carry(cardOf(c, elementKey("job", "J-1023"))!, OFF, { x: xAt(4), y: y(B3) });
        expect(caption()).toBe("refused: Press B3 is down for service");
        await vetoedLetGo();
        expect(jobsOn(c, B3)).not.toContain(elementKey("job", "J-1023"));
    });
});

// ============================================================================
// An element, along its row and across rows (PB34)
// ============================================================================

describe("an element moved along its row or onto another resource's (PB34)", () => {
    test("a bar moves by the days the pointer crossed; across presses it writes the press — each one step, the ghost saying where", async () => {
        const { container: c } = await h.mount(ex.planPrintWorks, DRAG);
        await settle();
        const y = layOutPlots(c, [A1, B1, C1]);
        // The spring catalogue runs 06:00–14:00 on Monday: grabbed at 09:00, let go two days on.
        const letGo = await carry(bar(c, "J-1001")!, { x: xAt(0, 9), y: y(A1) }, { x: xAt(2, 9), y: y(A1) });
        expect(caption()).toBe("Spring catalogue · Press A1 · Wed, Oct 7, 2026 · 06:00");
        await letGo();
        await settle();
        expect(named(bar(c, "J-1001"))).toMatch(/^Spring catalogue, Oct 7, 2026, 06:00 – Oct 7, 2026, 14:00/);
        expect(bar(c, "J-1001")!.hasAttribute("data-draft")).toBe(true);
        // Onto Press B1, the same day: the job is B1's now.
        layOutPlots(c, [A1, B1, C1]);
        await drop(bar(c, "J-1001")!, { x: xAt(2, 9), y: y(A1) }, { x: xAt(2, 9), y: y(B1) });
        expect(bar(c, "J-1001")).toBeNull();
        expect(named(bar(c, "J-1001", B1))).toMatch(/^Spring catalogue, Oct 7, 2026, 06:00 – Oct 7, 2026, 14:00/);
        expect(pending(c)).toBe("1 pending");
        // Two steps: Undo takes the press back, then the days.
        await press(historyButton(c, UNDO));
        expect(named(bar(c, "J-1001"))).toMatch(/^Spring catalogue, Oct 7, 2026, 06:00/);
        await press(historyButton(c, UNDO));
        expect(named(bar(c, "J-1001"))).toMatch(/^Spring catalogue, Oct 5, 2026, 06:00/);
        expect(bar(c, "J-1001")!.hasAttribute("data-draft")).toBe(false);
    });

    test("refused onto a resource of a kind it is not placed on: a job over a crew says what it needs", async () => {
        const { container: c } = await h.mount(ex.planPrintWorks, DRAG);
        await settle();
        const y = layOutPlots(c, [A1, A1_MARKS, C1]);
        for (const [target, reason] of [[A1_MARKS, "Drop on a Print job row"], [C1, "Needs presses"]] as const) {
            const letGo = await carry(bar(c, "J-1001")!, { x: xAt(0, 9), y: y(A1) }, { x: xAt(0, 9), y: y(target) });
            expect(plotOf(c, A1).hasAttribute("data-drop-valid")).toBe(true);
            expect(plotOf(c, A1_MARKS).hasAttribute("data-drop-valid")).toBe(false);
            expect(plotOf(c, target).hasAttribute("data-drop-invalid")).toBe(true);
            expect(caption()).toBe(`refused: ${reason}`);
            await letGo();
            expect(announced()).toBe(`Spring catalogue was not dropped: ${reason}.`);
            expect(pending(c)).toBe("0 pending");
        }
    });

    test("a selected element moves the selection: the others by the same days, in one step", async () => {
        const { container: c } = await h.mount(ex.planPrintWorks, DRAG);
        await settle();
        await select(bar(c, "J-1001")!);
        await select(bar(c, "J-1002")!, true);
        const y = layOutPlots(c, [A1]);
        const letGo = await carry(bar(c, "J-1001")!, { x: xAt(0, 9), y: y(A1) }, { x: xAt(1, 9), y: y(A1) });
        expect(caption()).toBe("2 events · Press A1 · Tue, Oct 6, 2026 · 06:00");
        await letGo();
        await settle();
        expect(named(bar(c, "J-1001"))).toMatch(/^Spring catalogue, Oct 6, 2026, 06:00/);
        expect(named(bar(c, "J-1002"))).toMatch(/^Museum guide, Oct 8, 2026, 06:00/);
        expect(pending(c)).toBe("2 pending");
        await press(historyButton(c, UNDO));
        expect(named(bar(c, "J-1001"))).toMatch(/^Spring catalogue, Oct 5, 2026, 06:00/);
        expect(named(bar(c, "J-1002"))).toMatch(/^Museum guide, Oct 7, 2026, 06:00/);
        expect(historyButton(c, UNDO).disabled).toBe(true);
    });

    test("carried onto another press, a selection takes the events on the grabbed one's press with it — one on a press of its own stays, undrafted", async () => {
        const { container: c } = await h.mount(ex.planPrintWorks, DRAG);
        await settle();
        await select(bar(c, "J-1001")!);
        await select(bar(c, "J-1002")!, true);
        await select(bar(c, "J-1006", A2)!, true);
        const y = layOutPlots(c, [A1, A2, B1]);
        const letGo = await carry(bar(c, "J-1001")!, { x: xAt(0, 9), y: y(A1) }, { x: xAt(0, 9), y: y(B1) });
        expect(caption()).toBe("2 events · Press B1 · Mon, Oct 5, 2026 · 06:00");
        await letGo();
        await settle();
        expect(named(bar(c, "J-1001", B1))).toMatch(/^Spring catalogue, Oct 5, 2026, 06:00/);
        expect(named(bar(c, "J-1002", B1))).toMatch(/^Museum guide, Oct 7, 2026, 06:00/);
        expect(jobsOn(c, A1)).not.toContain(elementKey("job", "J-1002"));
        expect(named(bar(c, "J-1006", A2))).toMatch(/^Tour brochure, Oct 6, 2026, 06:00/);
        expect(bar(c, "J-1006", A2)!.hasAttribute("data-draft")).toBe(false);
        expect(pending(c)).toBe("2 pending");
        await press(historyButton(c, UNDO));
        expect(jobsOn(c, B1)).not.toContain(elementKey("job", "J-1001"));
        expect(jobsOn(c, A1)).toEqual(expect.arrayContaining([elementKey("job", "J-1001"), elementKey("job", "J-1002")]));
    });

    test("one part refused refuses the whole selection: a job on a press canDrop refuses holds the others where they are", async () => {
        const { container: c } = await h.mount(vetoed, DRAG);
        await settle();
        await select(bar(c, "J-1018", B2)!);
        await select(bar(c, "J-1022", B3)!, true);
        let y = layOutPlots(c, [B2, B3]);
        // The market posters a day on, with the box sleeves on Press B3 beside them.
        const letGo = await carry(bar(c, "J-1018", B2)!, { x: xAt(15, 9), y: y(B2) }, { x: xAt(16, 9), y: y(B2) });
        expect(plotOf(c, B2).hasAttribute("data-drop-invalid")).toBe(true);
        expect(caption()).toBe("refused: Press B3 is down for service");
        await letGo();
        expect(named(bar(c, "J-1018", B2))).toMatch(/^Market posters, Oct 20, 2026, 06:00/);
        expect(named(bar(c, "J-1022", B3))).toMatch(/^Box sleeves, Oct 20, 2026, 06:00/);
        expect(pending(c)).toBe("0 pending");
        // Alone, they move.
        await select(bar(c, "J-1018", B2)!);
        y = layOutPlots(c, [B2, B3]);
        await drop(bar(c, "J-1018", B2)!, { x: xAt(15, 9), y: y(B2) }, { x: xAt(16, 9), y: y(B2) });
        expect(named(bar(c, "J-1018", B2))).toMatch(/^Market posters, Oct 21, 2026, 06:00/);
        expect(pending(c)).toBe("1 pending");
    });

    test("a mark moves along its press, by the days crossed", async () => {
        const { container: c } = await h.mount(ex.planPrintWorks, DRAG);
        await settle();
        const y = layOutPlots(c, [A1_MARKS]);
        // The plate change at 12:00 on Wednesday, a day on.
        await drop(stop(c, "S-01")!, { x: xAt(2, 12), y: y(A1_MARKS) }, { x: xAt(3, 12), y: y(A1_MARKS) });
        expect(named(stop(c, "S-01"))).toMatch(/Oct 8, 2026, 12:00/);
        expect(stop(c, "S-01")!.hasAttribute("data-draft")).toBe(true);
    });

    test("a tile moves to another press's day — it has no ends to drag — and wears the drafted look until Undo", async () => {
        const { container: c } = await h.mount(vetoed, DRAG);
        await settle();
        const y = layOutPlots(c, [A1_TILES, A2_TILES]);
        const tile = c.querySelector<HTMLElement>(`${rowAt(A1_TILES)} ${el("data-event", "stop", "S-01")}`)!;
        expect(tile.hasAttribute("data-draggable")).toBe(true);
        expect(tile.querySelector("[data-plan-edge]")).toBeNull();
        expect(tile.hasAttribute("data-draft")).toBe(false);
        await drop(tile, { x: xAt(2), y: y(A1_TILES) }, { x: xAt(4), y: y(A2_TILES) });
        const moved = c.querySelector<HTMLElement>(`${rowAt(A2_TILES)} ${el("data-event", "stop", "S-01")}`);
        expect(named(moved)).toMatch(/Oct 9, 2026/);
        expect(c.querySelector(`${rowAt(A1_TILES)} ${el("data-event", "stop", "S-01")}`)).toBeNull();
        // Its drafts changed it: the tile wears the drafted look, as a bar does.
        expect(moved!.hasAttribute("data-draft")).toBe(true);
        await press(historyButton(c, UNDO));
        const back = c.querySelector<HTMLElement>(`${rowAt(A1_TILES)} ${el("data-event", "stop", "S-01")}`);
        expect(back!.hasAttribute("data-draft")).toBe(false);
    });

    test("a tile of a kind with a start and an end moves its event's times by the days crossed — its length kept", async () => {
        const { container: c } = await h.mount(tiled, DRAG);
        await settle();
        // The jobs are the presses' one way of drawing: their tiles are on each press's own row.
        const y = layOutPlots(c, [A1]);
        const tile = () => c.querySelector<HTMLElement>(`${rowAt(A1)} ${el("data-event", "job", "J-1001")}`);
        const when = () => slot(c, "end")!.querySelector("[data-inspector-when]")?.textContent ?? null;
        await select(tile()!);
        expect(when()).toBe("Mon, Oct 5, 2026 · 06:00–14:00");
        // The spring catalogue's tile, in Monday's cell, two days on.
        await drop(tile()!, { x: xAt(0), y: y(A1) }, { x: xAt(2), y: y(A1) });
        await select(tile()!);
        expect(named(tile())).toMatch(/Oct 7, 2026/);
        expect(when()).toBe("Wed, Oct 7, 2026 · 06:00–14:00");
    });
});

// ============================================================================
// An edge, along the axis (PB35)
// ============================================================================

describe("a bar's or a chip's edge resizes it (PB35)", () => {
    test("its end moves by the days crossed, and never closer to its start than one snap — a day", async () => {
        const { container: c } = await h.mount(ex.planPrintWorks, DRAG);
        await settle();
        let y = layOutPlots(c, [A1, C1]);
        const end = () => bar(c, "J-1001")!.querySelector<HTMLElement>('[data-plan-edge="end"]')!;
        await drop(end(), { x: xAt(0, 14), y: y(A1) }, { x: xAt(1, 14), y: y(A1) });
        expect(named(bar(c, "J-1001"))).toMatch(/^Spring catalogue, Oct 5, 2026, 06:00 – Oct 6, 2026, 14:00/);
        // Carried back past its start: one snap is all it keeps.
        y = layOutPlots(c, [A1, C1]);
        await drop(end(), { x: xAt(1, 14), y: y(A1) }, { x: xAt(0, 2), y: y(A1) });
        expect(named(bar(c, "J-1001"))).toMatch(/^Spring catalogue, Oct 5, 2026, 06:00 – Oct 6, 2026, 06:00/);
        // A chip's end, a day on.
        y = layOutPlots(c, [A1, C1]);
        const chipEnd = chip(c, "SH-01")!.querySelector<HTMLElement>('[data-plan-edge="end"]')!;
        await drop(chipEnd, { x: xAt(0, 14), y: y(C1) }, { x: xAt(1, 14), y: y(C1) });
        expect(named(chip(c, "SH-01"))).toMatch(/^Early, Oct 5, 2026, 06:00 – Oct 6, 2026, 14:00/);
        expect(chip(c, "SH-01")!.hasAttribute("data-draft")).toBe(true);
        expect(pending(c)).toBe("2 pending");
    });
});

// ============================================================================
// An event, onto the Backlog tab (PB36)
// ============================================================================

describe("an event dropped on the Backlog tab (PB36)", () => {
    test("is unscheduled: it leaves its press and joins the tab at once — no trash zone on the way; Undo puts it back", async () => {
        const { container: c } = await h.mount(ex.planPrintWorks, DRAG);
        await settle();
        await openTab(c, "Backlog");
        const sink = sinkOf(c);
        const y = layOutPlots(c, [A1], [[sink, { left: 0, top: 600, width: 180, height: 300 }]]);
        const letGo = await carry(bar(c, "J-1001")!, { x: xAt(0, 9), y: y(A1) }, { x: 90, y: 700 });
        expect(sink.hasAttribute("data-drop-active")).toBe(true);
        expect(caption()).toBe("Spring catalogue → Backlog");
        // Its elements return to the Backlog tab alone: no trash zone.
        expect(document.querySelector("[data-drag-trash]")).toBeNull();
        await letGo();
        await settle();
        expect(bar(c, "J-1001")).toBeNull();
        expect(tabs(pane(c))[1]).toBe("Backlog 9");
        expect(cardKeys(c)).toContain(elementKey("job", "J-1001"));
        await press(historyButton(c, UNDO));
        expect(bar(c, "J-1001")).not.toBeNull();
        expect(tabs(pane(c))[1]).toBe("Backlog 8");
    });

    test("refused for a kind whose times are no Options: a stop has no backlog", async () => {
        const { container: c } = await h.mount(ex.planPrintWorks, DRAG);
        await settle();
        await openTab(c, "Backlog");
        const sink = sinkOf(c);
        const y = layOutPlots(c, [A1_MARKS], [[sink, { left: 0, top: 600, width: 180, height: 300 }]]);
        const letGo = await carry(stop(c, "S-01")!, { x: xAt(2, 12), y: y(A1_MARKS) }, { x: 90, y: 700 });
        expect(sink.hasAttribute("data-drop-invalid")).toBe(true);
        expect(caption()).toBe("refused: Stops have no backlog");
        await letGo();
        expect(stop(c, "S-01")).not.toBeNull();
        expect(pending(c)).toBe("0 pending");
    });
});

// ============================================================================
// An author's card, onto an event of its patch's kind (PB63)
// ============================================================================

describe("an author's card dropped on an event of its patch's kind (PB63)", () => {
    test("sets what its patch sets, in one step: the ghost names the card and the event", async () => {
        const { container: c } = await h.mount(ex.planPrintWorks, DRAG);
        await settle();
        await openTab(c, "Customers");
        const card = cardOf(c, "harbour-arts")!;
        expect(card.hasAttribute("data-draggable")).toBe(true);
        const job = bar(c, "J-1001")!;
        const y = layOutPlots(c, [A1], [[job, { left: xAt(0, 6), top: 4, width: 33, height: 24 }]]);
        const letGo = await carry(card, OFF, { x: xAt(0, 9), y: y(A1) });
        expect(caption()).toBe("Harbour Arts Society → Spring catalogue");
        await letGo();
        await settle();
        expect(pending(c)).toBe("1 pending");
        // The inspector shows it: the customer the card set.
        await select(bar(c, "J-1001")!);
        const customer = slot(c, "end")!.querySelector<HTMLElement>("[data-inspector-fields='form'] [data-field=\"customer\"]")!;
        expect((within(customer).getByRole("textbox") as HTMLInputElement).value).toBe("Harbour Arts Society");
        expect(bar(c, "J-1001")!.hasAttribute("data-draft")).toBe(true);
        await press(historyButton(c, UNDO));
        expect((within(customer).getByRole("textbox") as HTMLInputElement).value).toBe("Alder & Finch");
    });

    test("refused anywhere but an event of that kind: between events, and on a stop", async () => {
        const { container: c } = await h.mount(ex.planPrintWorks, DRAG);
        await settle();
        await openTab(c, "Customers");
        const card = cardOf(c, "harbour-arts")!;
        const plate = stop(c, "S-01")!;
        const y = layOutPlots(c, [A1, A1_MARKS], [[plate, { left: xAt(2, 12) - 6, top: 44, width: 12, height: 24 }]]);
        // Between events on Press A1's Thursday.
        const letGo = await carry(card, OFF, { x: xAt(3), y: y(A1) });
        expect(plotOf(c, A1).hasAttribute("data-drop-invalid")).toBe(true);
        expect(caption()).toBe("refused: Drop a customer onto an event");
        await letGo();
        // On the plate change.
        const onStop = await carry(card, OFF, { x: xAt(2, 12), y: y(A1_MARKS) });
        expect(caption()).toBe("refused: Stops take no customer");
        await onStop();
        expect(pending(c)).toBe("0 pending");
    });

    test("a card dropped on an event drawn on a row beside its resource's is judged by the resource's own row, as every other drop there is (#1541, U7)", async () => {
        const { container: c } = await h.mount(stopCards, DRAG);
        await settle();
        await openTab(c, "Stops");
        // Press A1's plate change, a tile on the row beside the press's own, Wednesday 7 October.
        const tile = c.querySelector<HTMLElement>(`${rowAt(A1_TILES)} ${el("data-event", "stop", "S-01")}`)!;
        const y = layOutPlots(c, [A1, A1_TILES], [[tile, { left: xAt(2, 12) - 6, top: 44, width: 12, height: 24 }]]);
        const letGo = await carry(cardOf(c, "inspection")!, OFF, { x: xAt(2, 12), y: y(A1_TILES) });
        // The check refuses Press A1 by its own row: the card lands on none of the press's events.
        expect(caption()).toBe("refused: Press A1 takes no change today");
        await letGo();
        expect(pending(c)).toBe("0 pending");
        // A stop of a press the check takes lands: Press A2's plate change, Wednesday 14 October.
        const other = c.querySelector<HTMLElement>(`${rowAt(A2_TILES)} ${el("data-event", "stop", "S-03")}`)!;
        const y2 = layOutPlots(c, [A2_TILES], [[other, { left: xAt(9, 12) - 6, top: 4, width: 12, height: 24 }]]);
        const lands = await carry(cardOf(c, "inspection")!, OFF, { x: xAt(9, 12), y: y2(A2_TILES) });
        expect(caption()).toBe("Inspection → Plate change");
        await lands();
        expect(pending(c)).toBe("1 pending");
    });

    test("a patch that sets two fields sets both on the event, as one step — and Save writes both", async () => {
        const { container: c } = await h.mount(stocked, DRAG);
        await settle();
        const before = (await readJobs()).get("J-1001")!;
        const job = bar(c, "J-1001")!;
        const y = layOutPlots(c, [A1], [[job, { left: xAt(0, 6), top: 4, width: 33, height: 24 }]]);
        await drop(cardOf(c, "harbour-arts")!, OFF, { x: xAt(0, 9), y: y(A1) });
        expect(pending(c)).toBe("1 pending");
        // One step: Undo takes both fields back, Redo sets both again.
        await press(historyButton(c, UNDO));
        expect(pending(c)).toBe("0 pending");
        expect(historyButton(c, UNDO).disabled).toBe(true);
        await press(historyButton(c, REDO));
        expect(pending(c)).toBe("1 pending");
        await press(historyButton(c, SAVE));
        expect(sameJob((await readJobs()).get("J-1001")!, { ...before, customer: "Harbour Arts Society", stock: variant("board", null) })).toBe(true);
    });
});

// ============================================================================
// One history, and the keyboard (PB31, PB43)
// ============================================================================

describe("every gesture is one step of the Plan's one history", () => {
    test("a drop, a schedule, a move, a resize, an unschedule and a card's patch: six steps, Undo taking each back in turn", async () => {
        const { container: c } = await h.mount(ex.planPrintWorks, DRAG);
        await settle();
        let y = layOutPlots(c, [A1, A3]);
        await drop(cardOf(c, elementKey("job", "poster"))!, OFF, { x: xAt(9), y: y(A3) });
        await openTab(c, "Backlog");
        y = layOutPlots(c, [A1, A3]);
        await drop(cardOf(c, elementKey("job", "J-1024"))!, OFF, { x: xAt(10), y: y(A3) });
        y = layOutPlots(c, [A1, A3]);
        await drop(bar(c, "J-1002")!, { x: xAt(2, 9), y: y(A1) }, { x: xAt(3, 9), y: y(A1) });
        y = layOutPlots(c, [A1, A3]);
        await drop(bar(c, "J-1002")!.querySelector<HTMLElement>('[data-plan-edge="end"]')!, { x: xAt(3, 12), y: y(A1) }, { x: xAt(4, 12), y: y(A1) });
        const sink = sinkOf(c);
        y = layOutPlots(c, [A1, A3], [[sink, { left: 0, top: 600, width: 180, height: 300 }]]);
        await drop(bar(c, "J-1001")!, { x: xAt(0, 9), y: y(A1) }, { x: 90, y: 700 });
        await openTab(c, "Customers");
        // The course handbook: the event posters, where the card went before, are under way, and locked (#1541, U9).
        const job = bar(c, "J-1004")!;
        y = layOutPlots(c, [A1, A3], [[job, { left: xAt(9, 7), top: 4, width: 20, height: 24 }]]);
        await drop(cardOf(c, "harbour-arts")!, OFF, { x: xAt(9, 8), y: y(A1) });
        // Five events drafted by the six gestures: the museum guide moved and resized.
        expect(pending(c)).toBe("5 pending");
        const state = () => ({
            poster: jobsFrom(c, "poster", A3).length === 1,
            forms: bar(c, "J-1024", A3) !== null,
            guide: named(bar(c, "J-1002"))?.split(", actual")[0] ?? null,
            catalogue: bar(c, "J-1001") !== null,
            posters: bar(c, "J-1004")?.hasAttribute("data-draft") ?? null,
        });
        expect(state()).toEqual({ poster: true, forms: true, guide: "Museum guide, Oct 8, 2026, 06:00 – Oct 9, 2026, 12:00", catalogue: false, posters: true });
        // Each Undo takes one gesture back, the last first.
        await press(historyButton(c, UNDO));
        expect(state()).toEqual({ poster: true, forms: true, guide: "Museum guide, Oct 8, 2026, 06:00 – Oct 9, 2026, 12:00", catalogue: false, posters: false });
        await press(historyButton(c, UNDO));
        expect(state()).toEqual({ poster: true, forms: true, guide: "Museum guide, Oct 8, 2026, 06:00 – Oct 9, 2026, 12:00", catalogue: true, posters: false });
        await press(historyButton(c, UNDO));
        expect(state().guide).toBe("Museum guide, Oct 8, 2026, 06:00 – Oct 8, 2026, 12:00");
        await press(historyButton(c, UNDO));
        expect(state().guide).toBe("Museum guide, Oct 7, 2026, 06:00 – Oct 7, 2026, 12:00");
        expect(pending(c)).toBe("2 pending");
        await press(historyButton(c, UNDO));
        expect(state()).toEqual({ poster: true, forms: false, guide: "Museum guide, Oct 7, 2026, 06:00 – Oct 7, 2026, 12:00", catalogue: true, posters: false });
        await press(historyButton(c, UNDO));
        expect(state().poster).toBe(false);
        expect(pending(c)).toBe("0 pending");
        expect(historyButton(c, UNDO).disabled).toBe(true);
    });

    test("the keyboard carries a job along its kind's rows — the next press's bars, past its marks — and says why canDrop refuses a press", async () => {
        const { container: c } = await h.mount(vetoed, DRAG);
        await settle();
        const posters = bar(c, "J-1018", B2)!;
        posters.focus();
        await keyOn({ key: " " });
        expect(carrySaid(c)).toBe("Picked up Market posters: Press B2, Oct 20, 2026, 06:00 – Oct 20, 2026, 12:00");
        await keyOn({ key: "ArrowRight" });
        expect(carrySaid(c)).toBe("Market posters: Press B2, Oct 21, 2026, 06:00 – Oct 21, 2026, 12:00");
        await keyOn({ key: "ArrowDown" });
        expect(carrySaid(c)).toBe("Market posters cannot be dropped on Press B3, Oct 21, 2026, 06:00 – Oct 21, 2026, 12:00 — Press B3 is down for service");
        await keyOn({ key: "ArrowUp" });
        await keyOn({ key: "ArrowUp" });
        expect(carrySaid(c)).toBe("Market posters: Press B1, Oct 21, 2026, 06:00 – Oct 21, 2026, 12:00");
        await keyOn({ key: " " });
        expect(carrySaid(c)).toBe("Dropped Market posters on Press B1, Oct 21, 2026, 06:00 – Oct 21, 2026, 12:00");
        expect(jobsOn(c, B1)).toContain(elementKey("job", "J-1018"));
        expect(pending(c)).toBe("1 pending");
    });
});

// ============================================================================
// A card that makes an event (#1541, U1)
// ============================================================================

describe("a card of a tab with `create`, dropped on a resource's row (#1541, U1)", () => {
    /** Press A1 of the smallest builder: a row of its presses' record. */
    const PRESS_A1 = entry("presses", "a1");
    const eventJobs = () => h.read(ex.planEventJobs);

    test("makes an event of the tab's kind there, as a template does — the ghost saying what lands where, its key made from the card's, one step Undo takes back; Save writes the order's values on the press", async () => {
        const { container: c } = await h.mount(ex.planEvents, DRAG);
        await settle();
        const before = [...(await eventJobs()).keys()];
        await openTab(c, "Orders");
        const card = cardOf(c, "O-502")!;
        expect(card.hasAttribute("data-draggable")).toBe(true);
        const y = layOutPlots(c, [PRESS_A1]);
        // Monday 12 October, a whole day: from its start.
        const letGo = await carry(card, OFF, { x: xAt(7, 9), y: y(PRESS_A1) });
        expect(caption()).toBe("Season programme · Press A1 · Mon, Oct 12, 2026");
        await letGo();
        await settle();
        // 48,000 sheets at 8,000 an hour: six hours. Its key is made from the order's, never from its kind's key for it.
        const [made, ...more] = jobsFrom(c, "O-502", PRESS_A1);
        expect(more).toEqual([]);
        expect(named(bar(c, made!, PRESS_A1))).toBe("Season programme, Oct 12, 2026 – Oct 12, 2026, 06:00, proposed");
        expect(bar(c, made!, PRESS_A1)!.getAttribute("aria-pressed")).toBe("true");
        expect(pending(c)).toBe("1 pending");
        // One step.
        await press(historyButton(c, UNDO));
        expect([jobsFrom(c, "O-502", PRESS_A1), pending(c)]).toEqual([[], "0 pending"]);
        await press(historyButton(c, REDO));
        await press(historyButton(c, SAVE));
        const after = await eventJobs();
        const added = [...after.keys()].filter((key) => !before.includes(key));
        expect(added.length).toBe(1);
        expect(sameJob(after.get(added[0]!)!, {
            title: "Season programme", start: some(new Date("2026-10-12T00:00:00Z")), end: some(new Date("2026-10-12T06:00:00Z")), press: some("a1"),
            state: variant("proposed", variant("added", null)), sheets: 48000.0, customer: "Heathfield Theatre", stock: variant("coated", null), due: none,
        })).toBe(true);
    });

    test("a tab with a `drop` alone still needs an event to land on: only a tab with `create` makes one", async () => {
        const { container: c } = await h.mount(ex.planEvents, DRAG);
        await settle();
        await openTab(c, "Customers");
        const y = layOutPlots(c, [PRESS_A1]);
        const letGo = await carry(cardOf(c, "harbour-arts")!, OFF, { x: xAt(7, 9), y: y(PRESS_A1) });
        expect(caption()).toBe("refused: Drop a customer onto an event");
        await letGo();
        await settle();
        expect(pending(c)).toBe("0 pending");
    });
});

// ============================================================================
// A locked event (#1541, U9)
// ============================================================================

describe("an event its kind's `locked` holds where it is (#1541, U9)", () => {
    test("draws with a lock and says so by name; it takes no move — no handle, no end handles, nothing for a drag or Space to pick up", async () => {
        const { container: c } = await h.mount(ex.planPrintWorks, DRAG);
        await settle();
        // The event posters are under way: the works' own rule locks them.
        const posters = bar(c, "J-1003")!;
        expect([posters.hasAttribute("data-locked"), posters.querySelector("[data-plan-lock] svg") !== null]).toEqual([true, true]);
        expect(named(posters)).toMatch(/^Event posters, Oct 14, 2026, 07:00 .*, locked$/);
        expect([posters.hasAttribute("data-draggable"), posters.querySelector("[data-plan-edge]")]).toEqual([false, null]);
        // The spring catalogue, printed, has no lock, and moves as any job does.
        const catalogue = bar(c, "J-1001")!;
        expect([catalogue.hasAttribute("data-locked"), catalogue.querySelector("[data-plan-lock]"), catalogue.hasAttribute("data-draggable")]).toEqual([false, null, true]);
        expect(named(catalogue)).not.toMatch(/locked/);
        // Dragged a day on, the posters go nowhere; and Space picks nothing up for the arrows to carry.
        const y = layOutPlots(c, [A1]);
        await drop(posters, { x: xAt(9, 9), y: y(A1) }, { x: xAt(10, 9), y: y(A1) });
        posters.focus();
        await keyOn({ key: " " });
        await keyOn({ key: "ArrowRight" });
        await keyOn({ key: " " });
        expect(named(bar(c, "J-1003"))).toMatch(/^Event posters, Oct 14, 2026, 07:00/);
        expect(historyButton(c, UNDO).disabled).toBe(true);
    });

    test("a card dropped onto it is refused, the ghost saying it is locked; a selection it is part of stays where it is, held by it", async () => {
        const { container: c } = await h.mount(ex.planPrintWorks, DRAG);
        await settle();
        await openTab(c, "Customers");
        let y = layOutPlots(c, [A1], [[bar(c, "J-1003")!, { left: xAt(9, 7), top: 4, width: 20, height: 24 }]]);
        const letGo = await carry(cardOf(c, "harbour-arts")!, OFF, { x: xAt(9, 8), y: y(A1) });
        expect(caption()).toBe("refused: Event posters is locked");
        await letGo();
        await settle();
        expect(bar(c, "J-1003")!.hasAttribute("data-draft")).toBe(false);
        // Selected with the spring catalogue, which is dragged a day on: a selection moves together, or not at all.
        await select(bar(c, "J-1001")!);
        await select(bar(c, "J-1003")!, true);
        y = layOutPlots(c, [A1]);
        const held = await carry(bar(c, "J-1001")!, { x: xAt(0, 9), y: y(A1) }, { x: xAt(1, 9), y: y(A1) });
        expect(caption()).toBe("refused: Event posters is locked");
        await held();
        await settle();
        expect(named(bar(c, "J-1001"))).toMatch(/^Spring catalogue, Oct 5, 2026, 06:00/);
        expect(historyButton(c, UNDO).disabled).toBe(true);
    });

    test("the inspector says it is locked, its form read only and its gestures off; among several selected, a shift and Delete reach the others alone", async () => {
        const { container: c } = await h.mount(ex.planPrintWorks, DRAG);
        await settle();
        await select(bar(c, "J-1003")!);
        const end = slot(c, "end")!;
        const edits = () => end.querySelector<HTMLFieldSetElement>("[data-inspector-edits]")!;
        expect(end.querySelector("[data-inspector-locked]")?.textContent).toBe("LockedIt can't be moved, changed or deleted.");
        expect(edits().disabled).toBe(true);
        // The Delete key takes nothing either.
        fireEvent.keyDown(bar(c, "J-1003")!, { key: "Delete" });
        await settle();
        expect([bar(c, "J-1003") !== null, historyButton(c, UNDO).disabled]).toEqual([true, true]);
        // With the course handbook: both are listed, one of them locked, and an hour's shift moves the handbook alone.
        await select(bar(c, "J-1004")!, true);
        expect(end.querySelector("[data-inspector-locked]")?.textContent).toBe("1 locked: left as they are");
        expect([...end.querySelectorAll("[data-inspector-event]")].map((n) => n.hasAttribute("data-locked"))).toEqual([true, false]);
        expect(edits().disabled).toBe(false);
        await press(end.querySelector<HTMLElement>('[data-inspector-action="shift:1hour"]')!);
        expect(pending(c)).toBe("1 pending");
        expect(named(bar(c, "J-1003"))).toMatch(/^Event posters, Oct 14, 2026, 07:00/);
        expect(named(bar(c, "J-1004"))).toMatch(/^Course handbook, Oct 19, 2026, 07:00/);
        // Delete takes the handbook, and leaves the posters where they are — and selected still: what stayed is what
        // the pane goes on showing, never a selection let go without a word.
        await press(end.querySelector<HTMLElement>('[data-inspector-action="delete"]')!);
        expect([bar(c, "J-1003") !== null, bar(c, "J-1004")]).toEqual([true, null]);
        expect(bar(c, "J-1003")!.getAttribute("aria-pressed")).toBe("true");
        expect(end.querySelector("[data-inspector-locked]")?.textContent).toBe("LockedIt can't be moved, changed or deleted.");
    });

    test("planLocks: each way an event draws wears the lock — a chip, a mark and a tile — and says so in its name; what the works' rules let go wears none", async () => {
        const { container: c } = await h.mount(ex.planLocks, DRAG);
        await settle();
        /** An event's element, whichever row it is on: whether it is locked, draws a lock, and is picked up. */
        const drawn = (attr: "data-chip" | "data-mark" | "data-event", kind: string, key: string) => {
            const node = c.querySelector<HTMLElement>(`[role="gridcell"] ${el(attr, kind, key)}`)!;
            // A mark's lock stands beside its glyph, where its label would start; a chip's and a tile's inside it.
            const lock = attr === "data-mark" ? node.parentElement!.querySelector("[data-plan-lock]") : node.querySelector("[data-plan-lock]");
            return [node.hasAttribute("data-locked"), lock !== null, node.hasAttribute("data-draggable"), /, locked$/.test(named(node) ?? "")];
        };
        // A confirmed shift, a service and a delivery that has gone: locked, a lock drawn, not picked up, named locked.
        expect(drawn("data-chip", "shift", "SH-01")).toEqual([true, true, false, true]);
        expect(drawn("data-mark", "stop", "S-05")).toEqual([true, true, false, true]);
        expect(drawn("data-event", "delivery", "D-103")).toEqual([true, true, false, true]);
        // A proposed shift, a plate change and a delivery still queued: none of it.
        expect(drawn("data-chip", "shift", "SH-05")).toEqual([false, false, true, false]);
        expect(drawn("data-mark", "stop", "S-01")).toEqual([false, false, true, false]);
        expect(drawn("data-event", "delivery", "D-101")).toEqual([false, false, true, false]);
    });

    test("the Delete key over a selection it is part of takes the others and leaves it selected, where it is", async () => {
        const { container: c } = await h.mount(ex.planPrintWorks, DRAG);
        await settle();
        await select(bar(c, "J-1003")!);
        await select(bar(c, "J-1004")!, true);
        await act(async () => { fireEvent.keyDown(bar(c, "J-1004")!, { key: "Delete" }); });
        await settle();
        expect([bar(c, "J-1003") !== null, bar(c, "J-1004")]).toEqual([true, null]);
        expect(bar(c, "J-1003")!.getAttribute("aria-pressed")).toBe("true");
        // Alone, it takes no Delete: nothing is removed, and it stays selected.
        await act(async () => { fireEvent.keyDown(bar(c, "J-1003")!, { key: "Delete" }); });
        await settle();
        expect([bar(c, "J-1003") !== null, bar(c, "J-1003")!.getAttribute("aria-pressed"), pending(c)]).toEqual([true, "true", "1 pending"]);
    });
});

// ============================================================================
// `data`'s rows beside the event kinds
// ============================================================================

describe("a series of data's beneath a press", () => {
    test("takes no move while data's own session takes none: the jobs on the press drag, the press's own runs never do", async () => {
        const { container: c } = await h.mount(beside, DRAG);
        await settle();
        expect(bar(c, "J-1001", BOOKED_A1)!.hasAttribute("data-draggable")).toBe(true);
        const run = c.querySelector<HTMLElement>(`${rowAt(RUNS_A1)} [data-run="w1"]`)!;
        expect(named(run)).toMatch(/^Make-ready/);
        expect(run.hasAttribute("data-draggable")).toBe(false);
        // Nor does the keyboard pick one up.
        run.focus();
        await keyOn({ key: " " });
        expect(carrySaid(c)).toBe("");
    });
});

// ── Connect (#1541, U10) ──────────────────────────────────────────────────────

/** Example 16's rows: Presses A1 and A2, and the plate room's platesetter. */
const LINK_A1 = entry("presses", "a1");
const LINK_A2 = entry("presses", "a2");
const LINK_PS = entry("setters", "ps");
/** A tool of the toolbar's strip, by its name. */
const tool = (c: HTMLElement, name: string) =>
    within(within(slot(c, "toolbar")!).getByRole("radiogroup", { name: "Tools" })).getByRole("radio", { name });
/** A job's bar on one of example 16's presses. */
const linkJob = (c: HTMLElement, row: PlanRowId, key: string) => c.querySelector<HTMLElement>(`${rowAt(row)} ${el("data-run", "job", key)}`)!;
/** Connect's draft line: `snapped` to the event it may end at, `loose` at the pointer; `null` while none is drawn. */
const draftLine = (c: HTMLElement): "snapped" | "loose" | null => {
    const layer = c.querySelector("[data-plan-connect]");
    if (layer === null || layer.querySelector("[data-plan-link-preview] [data-plan-ribbon-band]") === null) return null;
    return layer.getAttribute("data-plan-connect") === "snapped" ? "snapped" : "loose";
};
/** Where Catalogue covers (J-2001) is pressed: Thursday 8 October, 07:00. */
const COVERS_AT = { day: 3, hour: 7 };
/** Price lists' bar (J-2004) on Press A2, the second row laid out: Wednesday noon to Thursday 18:00. */
const PRICE_LISTS: Rect = { left: xAt(2, 12), top: 44, width: 125, height: 24 };

describe("Connect draws a link kind's link from one event to another (#1541, U10)", () => {
    test("held, a drag from an event to another draws a link in place of a move: the ghost names it, the drop drafts it and selects it, and Undo takes it back", async () => {
        const { container: c } = await h.mount(flowsPlan(), DRAG);
        await settle();
        // Select until the viewer picks: the tools show while the flows are bound with their patch door.
        expect(tool(c, "Select").getAttribute("aria-checked")).toBe("true");
        await press(tool(c, "Connect"));
        expect(tool(c, "Connect").getAttribute("aria-checked")).toBe("true");
        const covers = linkJob(c, LINK_A1, "J-2001");
        const y = layOutPlots(c, [LINK_A1, LINK_A2], [[linkJob(c, LINK_A2, "J-2004"), PRICE_LISTS]]);
        const release = await carry(covers, { x: xAt(COVERS_AT.day, COVERS_AT.hour), y: y(LINK_A1) }, { x: xAt(3, 0), y: y(LINK_A2) });
        expect(caption()).toBe("Flow · Catalogue covers → Price lists");
        // The draft line is drawn, snapped to the event the flow may end at.
        expect(draftLine(c)).toBe("snapped");
        await release();
        expect(draftLine(c)).toBeNull();
        // One more flow, a draft of the flows' record, selected: the inspector shows it. The job is where it was.
        expect(pending(c)).toBe("1 pending");
        expect(inspected(c)).toBe("Catalogue covers → Price lists");
        expect(linkJob(c, LINK_A1, "J-2001")).not.toBeNull();
        expect(c.querySelector(`${rowAt(LINK_A2)} ${el("data-run", "job", "J-2001")}`)).toBeNull();
        // One step of the history: Undo takes the flow back, and nothing else stands to undo.
        await press(historyButton(c, UNDO));
        expect(pending(c)).toBe("0 pending");
        expect(historyButton(c, UNDO).disabled).toBe(true);
    });

    test("an event its kind's end takes none of refuses the draft, the ghost saying why in the kind's own words, and the drop draws nothing", async () => {
        const { container: c } = await h.mount(flowsPlan(), DRAG);
        await settle();
        await press(tool(c, "Connect"));
        const plates = c.querySelector<HTMLElement>(`${rowAt(LINK_PS)} [role="button"]${el("data-mark", "plate", "P-01")}`)!;
        // The plate room's row is laid out second: the plates' glyph at Monday noon.
        const y = layOutPlots(c, [LINK_A1, LINK_PS], [[plates, { left: xAt(0, 12) - 6, top: 44, width: 12, height: 24 }]]);
        const release = await carry(linkJob(c, LINK_A1, "J-2001"), { x: xAt(COVERS_AT.day, COVERS_AT.hour), y: y(LINK_A1) }, { x: xAt(0, 12), y: y(LINK_PS) });
        // A flow ends at a job, a bindery job or a delivery: never at plates.
        expect(caption()).toBe("refused: Flow can't end at Catalogue plates");
        // Refused, the line follows the pointer and snaps to nothing.
        expect(draftLine(c)).toBe("loose");
        await release();
        expect(pending(c)).toBe("0 pending");
    });

    test("a `key` that fails for the two events makes no link: the ghost says no key can be made, and the drop draws nothing", async () => {
        // A flow's key, its plates' key: a flow from a job has none, and its key fails.
        const keyed = flowsPlan({ key: (flow) => flow.from.unwrap("plate") });
        const { container: c } = await h.mount(keyed, DRAG);
        await settle();
        await press(tool(c, "Connect"));
        const y = layOutPlots(c, [LINK_A1, LINK_A2], [[linkJob(c, LINK_A2, "J-2004"), PRICE_LISTS]]);
        const release = await carry(linkJob(c, LINK_A1, "J-2001"), { x: xAt(COVERS_AT.day, COVERS_AT.hour), y: y(LINK_A1) }, { x: xAt(3, 0), y: y(LINK_A2) });
        expect(caption()).toBe("refused: No key can be made for a new flow");
        await release();
        expect(pending(c)).toBe("0 pending");
    });

    test("over no event the draft has nowhere to land: nothing is said, and letting go there draws nothing and moves nothing", async () => {
        const { container: c } = await h.mount(flowsPlan(), DRAG);
        await settle();
        await press(tool(c, "Connect"));
        const y = layOutPlots(c, [LINK_A1, LINK_A2]);
        const release = await carry(linkJob(c, LINK_A1, "J-2001"), { x: xAt(COVERS_AT.day, COVERS_AT.hour), y: y(LINK_A1) }, { x: xAt(20, 0), y: y(LINK_A2) });
        expect(caption()).toBeNull();
        expect(draftLine(c)).toBe("loose");
        await release();
        expect(draftLine(c)).toBeNull();
        expect(pending(c)).toBe("0 pending");
        expect(linkJob(c, LINK_A1, "J-2001")).not.toBeNull();
    });

    test("the Plan's `canConnect` hears the kind and the two events, and its words refuse the draft on the ghost", async () => {
        const vetoedFlows = flowsPlan({ canConnect: () => East.function([Plan.Types.ConnectCandidate], OptionType(StringType), ($, candidate) => {
            const said = $.let(none, OptionType(StringType));
            $.if(candidate.kind.equal("flow").and(() => candidate.from.kind.equal("job")).and(() => candidate.to.key.equal("J-2004")), ($2) => {
                $2.assign(said, some("Price lists are already at the bindery"));
            });
            return said;
        }) });
        const { container: c } = await h.mount(vetoedFlows, DRAG);
        await settle();
        await press(tool(c, "Connect"));
        const y = layOutPlots(c, [LINK_A1, LINK_A2], [[linkJob(c, LINK_A2, "J-2004"), PRICE_LISTS]]);
        const release = await carry(linkJob(c, LINK_A1, "J-2001"), { x: xAt(COVERS_AT.day, COVERS_AT.hour), y: y(LINK_A1) }, { x: xAt(3, 0), y: y(LINK_A2) });
        expect(caption()).toBe("refused: Price lists are already at the bindery");
        await release();
        expect(pending(c)).toBe("0 pending");
        // A screen reader hears the refusal in the Plan's words too (#1680's review).
        expect(announced()).toBe("Catalogue covers was not dropped: Price lists are already at the bindery.");
    });

    test("a link kind's template, held in the library's Events tab by a click, gives the link Connect draws its other fields; let go, a link takes their defaults", async () => {
        const { container: c } = await h.mount(flowsPlan({ templates: true }), DRAG);
        await settle();
        // The flows' preset, under the kind's name: a card that drags nowhere, and is held by a click.
        const preset = () => cardOf(c, elementKey("flow", "standard"))!;
        expect(preset().textContent).toContain("Standard run");
        expect(preset().hasAttribute("data-placed")).toBe(false);
        // Only a link kind's template takes the click: the plates' preset beside it drags, and is no button of the click.
        expect([preset().hasAttribute("data-clickable"), cardOf(c, elementKey("plate", "plates"))!.hasAttribute("data-clickable")]).toEqual([true, false]);
        await press(preset());
        expect(preset().hasAttribute("data-placed")).toBe(true);
        await press(tool(c, "Connect"));
        const y = layOutPlots(c, [LINK_A1, LINK_A2], [[linkJob(c, LINK_A2, "J-2004"), PRICE_LISTS]]);
        const release = await carry(linkJob(c, LINK_A1, "J-2001"), { x: xAt(COVERS_AT.day, COVERS_AT.hour), y: y(LINK_A1) }, { x: xAt(3, 0), y: y(LINK_A2) });
        await release();
        // Said as the link it drew, never as the job dropped somewhere: Connect moves nothing (#1680's review).
        expect(announced()).toBe("Drew a flow from Catalogue covers to Price lists.");
        // The flow drawn moves what the preset holds: twelve thousand sheets.
        expect(inspected(c)).toBe("Catalogue covers → Price lists");
        expect(slot(c, "end")!.querySelector('[data-fact="quantity"]')?.textContent).toBe("12 k sheets");
        // Let go by a second click, the next flow moves none: a flow's sheets are an Option, none by default.
        await press(preset());
        expect(preset().hasAttribute("data-placed")).toBe(false);
    });
});

describe("a kind landing on the rows beneath its resource: a drop writes what places it (#1541, U1)", () => {
    /** A press's row of a kind of task. */
    const kindRow = (press: string, kind: Parameters<typeof pressKindStep>[0]) => entry("kinds", press, pressKindStep(kind));
    const PRESS_3 = entry("press", "P03");
    const WASH_3 = kindRow("P03", "blanket_wash");
    const INK_3 = kindRow("P03", "ink_fill");
    const PLATES_3 = kindRow("P03", "plate_check");
    const ROLLERS_4 = kindRow("P04", "roller_wash");
    /** A task's tile on a row. */
    const task = (c: HTMLElement, key: string, row: PlanRowId) => c.querySelector<HTMLElement>(`${rowAt(row)} ${el("data-event", "task", key)}`);
    /** The cell a tile is in: its bucket's place among the days, and its lane's among the row's. */
    const cellOf = (node: HTMLElement | null) => node?.closest("[data-plan-cell]")?.getAttribute("data-plan-cell") ?? null;
    // A plot is 32px tall and its two lanes 16px each: the morning's above its centre, the afternoon's below.
    const AM = -8;
    const PM = 8;

    test("each task draws on its press's row of its kind, in its half's lane; the press's own row draws none", async () => {
        const { container: c } = await h.mount(pressPlan(), DRAG);
        await settle();
        // Tuesday 6 October: the blankets washed in the morning, the cyan filled in the afternoon.
        expect(cellOf(task(c, "T-01", WASH_3))).toBe("1:0");
        expect(cellOf(task(c, "T-02", INK_3))).toBe("1:1");
        expect(cellOf(task(c, "T-07", ROLLERS_4))).toBe("2:0");
        expect(c.querySelectorAll(`${rowAt(PRESS_3)} [data-event]`).length).toBe(0);
    });

    test("a task dragged onto another kind's row of its press, into the afternoon, writes its kind and its half as one step, which Undo takes back", async () => {
        const { container: c } = await h.mount(pressPlan(), DRAG);
        await settle();
        const y = layOutPlots(c, [WASH_3, INK_3, ROLLERS_4]);
        await drop(task(c, "T-01", WASH_3)!, { x: xAt(1), y: y(WASH_3) + AM }, { x: xAt(1), y: y(INK_3) + PM });
        expect(task(c, "T-01", WASH_3)).toBeNull();
        expect(cellOf(task(c, "T-01", INK_3))).toBe("1:1");
        await press(historyButton(c, UNDO));
        expect(cellOf(task(c, "T-01", WASH_3))).toBe("1:0");
        expect(historyButton(c, UNDO).disabled).toBe(true);
    });

    test("a task dragged into its row's other lane writes its half alone: its day and its kind stand", async () => {
        const { container: c } = await h.mount(pressPlan(), DRAG);
        await settle();
        const y = layOutPlots(c, [WASH_3, INK_3, ROLLERS_4]);
        await drop(task(c, "T-01", WASH_3)!, { x: xAt(1), y: y(WASH_3) + AM }, { x: xAt(1), y: y(WASH_3) + PM });
        expect(cellOf(task(c, "T-01", WASH_3))).toBe("1:1");
        // Let go where it stands, in its own lane, it moves nothing: no step is recorded.
        await press(historyButton(c, UNDO));
        await drop(task(c, "T-01", WASH_3)!, { x: xAt(1), y: y(WASH_3) + AM }, { x: xAt(1), y: y(WASH_3) + AM });
        expect(historyButton(c, UNDO).disabled).toBe(true);
    });

    test("carried onto another kind's row of its press with another task selected, the grabbed task takes the row's kind, and the other keeps its own (#1660's review)", async () => {
        const { container: c } = await h.mount(pressPlan(), DRAG);
        await settle();
        await select(task(c, "T-01", WASH_3)!);
        await select(task(c, "T-04", PLATES_3)!, true);
        const y = layOutPlots(c, [WASH_3, INK_3, PLATES_3]);
        await drop(task(c, "T-01", WASH_3)!, { x: xAt(1), y: y(WASH_3) + AM }, { x: xAt(1), y: y(INK_3) + AM });
        expect(cellOf(task(c, "T-01", INK_3))).toBe("1:0");
        // The plate check stays the plate check: it is on the same press, and keeps its own row beneath it.
        expect(task(c, "T-04", INK_3)).toBeNull();
        expect(task(c, "T-04", PLATES_3)).not.toBeNull();
    });

    test("a card's lane is its drag's alone: refused in an afternoon, the next drag's rows are judged in no lane until it rests in one (#1660's review)", async () => {
        const { container: c } = await h.mount(pressPlan({ cards: true, noAfternoons: true }), DRAG);
        await settle();
        await openTab(c, "Orders");
        let y = layOutPlots(c, [WASH_3, INK_3, ROLLERS_4]);
        // Over the ink fill's afternoon: the Plan's check refuses it there.
        const refused = await carry(cardOf(c, "W-1")!, OFF, { x: xAt(1), y: y(INK_3) + PM });
        expect(caption()).toBe("refused: No afternoons");
        await refused();
        // The next drag, resting on no row yet: the sweep judges every kind's row in no lane, and each takes the card.
        y = layOutPlots(c, [WASH_3, INK_3, ROLLERS_4]);
        const plots = () => [WASH_3, INK_3, ROLLERS_4].map((row) => plotOf(c, row).hasAttribute("data-drop-valid"));
        const next = await carry(cardOf(c, "W-1")!, OFF, { x: OFF.x, y: OFF.y + 40 });
        expect(plots()).toEqual([true, true, true]);
        await next();
    });

    test("a task dragged onto a kind's row of another press writes its press with its kind, on the day it lands", async () => {
        const { container: c } = await h.mount(pressPlan(), DRAG);
        await settle();
        const y = layOutPlots(c, [WASH_3, INK_3, ROLLERS_4]);
        await drop(task(c, "T-01", WASH_3)!, { x: xAt(1), y: y(WASH_3) + AM }, { x: xAt(3), y: y(ROLLERS_4) + AM });
        expect(task(c, "T-01", WASH_3)).toBeNull();
        expect(cellOf(task(c, "T-01", ROLLERS_4))).toBe("3:0");
    });

    /** A task as the record holds it now. */
    const taskHeld = async (key: string) => (await h.read(ex.planPressTaskRows)).get(key)!;
    const sameKind = equalFor(ex.PressTaskKind);
    const sameHalf = equalFor(ex.PressHalf);
    const sameDay = equalFor(DateTimeType);

    test("on the works' page, its machines read a page at a time and its tasks a cell at a time: a task dragged onto another kind's row, into the afternoon, is a draft, and Save writes its kind and its half", async () => {
        // Its canvas is bounded: laid out, its paged rows mount.
        const restore = boundFrame(2000);
        try {
            const { container: c } = await h.mount(ex.planPressTasks, DRAG);
            await settle();
            await waitFor(() => expect(task(c, "T-01", WASH_3)).not.toBeNull());
            const y = layOutPlots(c, [WASH_3, INK_3, ROLLERS_4]);
            await drop(task(c, "T-01", WASH_3)!, { x: xAt(1), y: y(WASH_3) + AM }, { x: xAt(1), y: y(INK_3) + PM });
            expect(task(c, "T-01", WASH_3)).toBeNull();
            expect(cellOf(task(c, "T-01", INK_3))).toBe("1:1");
            expect(pending(c)).toBe("1 pending");
            // A draft keeps its title, as the tiles beside it do (#1680's review).
            expect(task(c, "T-01", INK_3)!.querySelector("[data-plan-label]")?.textContent).toBe("Wash blankets");
            await press(historyButton(c, SAVE));
            await waitFor(() => expect(pending(c)).toBe("0 pending"));
            const held = await taskHeld("T-01");
            expect([sameKind(held.kind, variant("ink_fill", null)), sameHalf(held.half, variant("pm", null)), held.press, sameDay(held.day, new Date("2026-10-06T00:00:00Z"))])
                .toEqual([true, true, "P03", true]);
            // Saved, it draws where it was let go.
            await waitFor(() => expect(cellOf(task(c, "T-01", INK_3))).toBe("1:1"));
        } finally {
            restore();
        }
    });

    test("on one press's own page, which draws no row of the press: a task dragged to its row's other lane is a draft, and Save writes its half alone", async () => {
        const restore = boundFrame(2000);
        try {
            const { container: c } = await h.mount(ex.planOnePress, DRAG);
            await settle();
            await waitFor(() => expect(task(c, "T-04", PLATES_3)).not.toBeNull());
            const y = layOutPlots(c, [WASH_3, INK_3, PLATES_3]);
            // Thursday 8 October's plate check, from the morning to the afternoon.
            await drop(task(c, "T-04", PLATES_3)!, { x: xAt(3), y: y(PLATES_3) + AM }, { x: xAt(3), y: y(PLATES_3) + PM });
            expect(cellOf(task(c, "T-04", PLATES_3))).toBe("3:1");
            await press(historyButton(c, SAVE));
            await waitFor(() => expect(pending(c)).toBe("0 pending"));
            const held = await taskHeld("T-04");
            expect([sameKind(held.kind, variant("plate_check", null)), sameHalf(held.half, variant("pm", null)), held.press, sameDay(held.day, new Date("2026-10-08T00:00:00Z"))])
                .toEqual([true, true, "P03", true]);
        } finally {
            restore();
        }
    });

    test("a press's own row is no destination for a task: a drag rests on it over nothing, and the drop moves nothing", async () => {
        const { container: c } = await h.mount(pressPlan(), DRAG);
        await settle();
        const y = layOutPlots(c, [PRESS_3, WASH_3]);
        const release = await carry(task(c, "T-01", WASH_3)!, { x: xAt(1), y: y(WASH_3) + AM }, { x: xAt(2), y: y(PRESS_3) });
        expect(caption()).toBeNull();
        expect(c.querySelector(`${rowAt(PRESS_3)} [data-plan-plot]`)!.hasAttribute("data-drop-active")).toBe(false);
        await release();
        await settle();
        expect(cellOf(task(c, "T-01", WASH_3))).toBe("1:0");
        expect(historyButton(c, UNDO).disabled).toBe(true);
    });
});

describe("an event kind whose record is keyed by a variant: drawn, dragged, saved, joined and optimised by its typed key (#1541)", () => {
    const printKey = printFor(ex.PrintJobKey);
    /** The jobs' keys, each as East prints it: what an event of the kind is named by on the canvas. */
    const CATALOGUE = variant("order", "J-8001");
    const PRICE_LIST = variant("order", "J-8002");
    const CATALOGUE_PROOF = variant("sample", 1n);
    const PRICE_LIST_PROOF = variant("sample", 2n);
    const P_A1 = entry("presses", "a1");
    const P_A2 = entry("presses", "a2");
    /** A job's bar on a press's row, by its typed key. */
    const keyed = (c: HTMLElement, row: PlanRowId, key: Parameters<typeof printKey>[0]) =>
        c.querySelector<HTMLElement>(`${rowAt(row)} ${el("data-run", "job", printKey(key))}`);
    const sameStart = equalFor(OptionType(DateTimeType));
    const sameKey = equalFor(ex.PrintJobKey);
    /** The client x of an hour of a day of this Plan's one week, which the plots' four weeks of px lay out: a day four times as wide. */
    const xIn = (day: number, hour: number) => xAt(4 * day, 4 * hour);
    /** The jobs and the sign-offs as their records hold them now. */
    const jobsHeld = () => h.read(ex.planKeyedJobs);
    const signOffsHeld = () => h.read(ex.planKeyedSignOffs);

    test("its bars draw on their presses, each named by its key as East prints it, and the record's sign-off joins two of them", async () => {
        // The ribbons' overlay is laid out, so a link draws.
        const restore = ribbonWidth({ tall: true });
        try {
            const { container: c } = await h.mount(ex.planTypedKeys, DRAG);
            await settle();
            for (const [row, key] of [[P_A1, CATALOGUE], [P_A2, PRICE_LIST], [P_A1, CATALOGUE_PROOF], [P_A2, PRICE_LIST_PROOF]] as const) {
                expect(keyed(c, row, key), printKey(key)).not.toBeNull();
            }
            // The catalogue's proof to its run: a link whose ends the record holds as the jobs' keys. In the press's links
            // focus it is drawn from the one bar to the other, each end named by its job's key.
            fireEvent.click(c.querySelector(`${rowAt(P_A1)} [data-plan-control="links"]`)!);
            await settle();
            expect([...c.querySelectorAll("[data-link]")].map((path) => [
                path.getAttribute("data-link-key"),
                path.getAttribute("data-link-from"), path.getAttribute("data-link-from-run"),
                path.getAttribute("data-link-to"), path.getAttribute("data-link-to-run"),
            ])).toEqual([[
                elementKey("signOff", "S-1"),
                rowKeyOf(P_A1), elementKey("job", printKey(CATALOGUE_PROOF)), rowKeyOf(P_A1), elementKey("job", printKey(CATALOGUE)),
            ]]);
            // Only the press both jobs are on takes the links control.
            expect(c.querySelector(`${rowAt(P_A2)} [data-plan-control="links"]`)).toBeNull();
        } finally {
            restore();
        }
    });

    test("a bar dragged a day on is a draft, and Save writes the job under its typed key", async () => {
        const { container: c } = await h.mount(ex.planTypedKeys, DRAG);
        await settle();
        const y = layOutPlots(c, [P_A1, P_A2]);
        // The price list, Wednesday 7 October from six: a day on.
        await drop(keyed(c, P_A2, PRICE_LIST)!, { x: xIn(2, 9), y: y(P_A2) }, { x: xIn(3, 9), y: y(P_A2) });
        expect(pending(c)).toBe("1 pending");
        await press(historyButton(c, SAVE));
        await waitFor(() => expect(pending(c)).toBe("0 pending"));
        const held = await jobsHeld();
        expect(sameStart(held.get(PRICE_LIST)!.start, some(new Date("2026-10-08T06:00:00Z")))).toBe(true);
        // No other job moved, and none stands under another key.
        expect(sameStart(held.get(CATALOGUE)!.start, some(new Date("2026-10-06T06:00:00Z")))).toBe(true);
        expect(held.size).toBe(4);
    });

    test("a sign-off drawn from one job to another is saved with both ends the jobs' typed keys", async () => {
        const { container: c } = await h.mount(ex.planTypedKeys, DRAG);
        await settle();
        await press(tool(c, "Connect"));
        const y = layOutPlots(c, [P_A1, P_A2], [[keyed(c, P_A2, PRICE_LIST)!, { left: xIn(2, 6), top: 44, width: 133, height: 24 }]]);
        // From the price list's proof, Tuesday afternoon, onto the price list itself, Wednesday morning.
        const release = await carry(keyed(c, P_A2, PRICE_LIST_PROOF)!, { x: xIn(1, 14), y: y(P_A2) }, { x: xIn(2, 9), y: y(P_A2) });
        expect(caption()).toBe("Sign-off · Price list proof → Trade price list");
        await release();
        expect(pending(c)).toBe("1 pending");
        await press(historyButton(c, SAVE));
        await waitFor(() => expect(pending(c)).toBe("0 pending"));
        const made = [...(await signOffsHeld())].filter(([key]) => key !== "S-1");
        expect(made.length).toBe(1);
        expect([sameKey(made[0]![1].from, PRICE_LIST_PROOF), sameKey(made[0]![1].to, PRICE_LIST)]).toEqual([true, true]);
    });

    test("the optimiser's answer names each job by its typed key: a run moves the proofs to the first hour not past — the window's six on Monday has gone, so now, nine on Tuesday — one edit that Save writes (#1680's review)", async () => {
        const { container: c } = await h.mount(ex.planTypedKeys, DRAG);
        await settle();
        await press(c.querySelector("[data-optimise-button]")!);
        // Both proofs moved: the catalogue's on its press from nine, the price list's from Tuesday afternoon.
        await waitFor(() => expect(pending(c)).toBe("2 pending"));
        await press(historyButton(c, SAVE));
        await waitFor(() => expect(pending(c)).toBe("0 pending"));
        const held = await jobsHeld();
        const now = some(ex.TYPED_KEYS_NOW);
        expect([sameStart(held.get(CATALOGUE_PROOF)!.start, now), sameStart(held.get(PRICE_LIST_PROOF)!.start, now)]).toEqual([true, true]);
        // The orders stand where they were.
        expect(sameStart(held.get(CATALOGUE)!.start, some(new Date("2026-10-06T06:00:00Z")))).toBe(true);
    });
});

describe("the print works over plain records (planPrintWorksRecords, #1541 §3)", () => {
    /** A resource's row, under its group: a press, a crew, a bindery line, the bay or a van. */
    const A1_ROW = entry("press", "1-presses-a", "a1");
    const A3_ROW = entry("press", "1-presses-a", "a3");
    const B2_ROW = entry("press", "2-presses-b", "b2");
    const FOLD = entry("line", "5-bindery", "fold");
    const C1_HOURS = entry("hours", "3-crews-a", "c1");
    const printRole = printFor(ex.WorksRole);
    const C1_OPERATORS = entry("role", "3-crews-a", "c1", printRole(variant("operator", null)));
    /** What a row draws of a kind, by its events' keys. */
    const drawnOn = (c: HTMLElement, row: PlanRowId, attr: "data-run" | "data-mark" | "data-chip" | "data-event", kind: string, keys: readonly string[]) =>
        keys.filter((key) => c.querySelector(`${rowAt(row)} ${el(attr, kind, key)}`) !== null);
    const sameInstant = equalFor(DateTimeType);
    const sameFrom = equalFor(ex.WorksFeed.fields.from);
    const sameTo = equalFor(ex.WorksFeed.fields.to);
    /** Its canvas is bounded: laid out, its paged rows mount. */
    const mounted = async () => {
        const restore = boundFrame(2000);
        const { container } = await h.mount(ex.planPrintWorksRecords, DRAG);
        await settle();
        await waitFor(() => expect(container.querySelector(`${rowAt(A1_ROW)} ${el("data-run", "job", "J-9001")}`)).not.toBeNull());
        return { c: container, restore };
    };

    test("one record of rows, each resource by its kind, and five event kinds on them, each read a cell at a time through its own source", async () => {
        const { c, restore } = await mounted();
        try {
            // A press's jobs as bars and its stops as marks beside them, a line's bindery jobs and a crew's shifts as
            // chips, a bay's and a van's deliveries as tiles.
            expect(drawnOn(c, A1_ROW, "data-run", "job", ["J-9001", "J-9002", "J-9003"])).toEqual(["J-9001", "J-9002"]);
            expect(drawnOn(c, entry("press.marks", "1-presses-a", "a2"), "data-mark", "stop", ["S-9001"])).toEqual(["S-9001"]);
            expect(drawnOn(c, FOLD, "data-chip", "binding", ["B-9001", "B-9002", "B-9003"])).toEqual(["B-9001", "B-9002"]);
            expect(drawnOn(c, entry("crew", "3-crews-a", "c1"), "data-chip", "shift", ["H-9001", "H-9002", "H-9003"])).toEqual(["H-9001", "H-9003"]);
            expect(drawnOn(c, entry("bay", "6-dispatch", "bay"), "data-event", "delivery", ["D-9001"])).toEqual(["D-9001"]);
            expect(drawnOn(c, entry("van", "7-vans", "van2"), "data-event", "delivery", ["D-9003"])).toEqual(["D-9003"]);
            // The rows a page at a time, what belongs to them through their nested series index; each kind by its series
            // index, a bay's and a van's deliveries through one filed by a variant field.
            expect(h.readKinds("records.plan_works_rows", "plan_works_rows_by_name")).toContain("page");
            expect(h.readKinds("records.plan_works_rows", "plan_works_rows_in_time")).toEqual(expect.arrayContaining(["find", "runs"]));
            for (const [record, index] of [
                ["jobs", "by_press_week"], ["stops", "by_press_week"], ["bindings", "by_line_week"], ["shifts", "by_crew_week"], ["deliveries", "by_location_week"],
            ] as const) {
                expect(h.readKinds(`records.plan_works_${record}`, `plan_works_${record}_${index}`), record).toEqual(expect.arrayContaining(["find", "runs"]));
            }
            // The library: every kind's templates from the one presets record, the series, the orders and the customers.
            expect(tabs(slot(c, "start")!)).toEqual(["Events 7", "Series 14", "Orders 3", "Customers 16"]);
            expect(pending(c)).toBe("0 pending");
        } finally {
            restore();
        }
    });

    test("an order's card dropped on a press makes a job there, and Save writes it to the jobs' record", async () => {
        const { c, restore } = await mounted();
        try {
            const before = [...(await h.read(ex.planWorksJobs)).keys()];
            await openTab(c, "Orders");
            const y = layOutPlots(c, [A3_ROW]);
            // Monday 19 October, a whole day: from its start.
            const letGo = await carry(cardOf(c, "O-701")!, OFF, { x: xAt(14, 9), y: y(A3_ROW) });
            expect(caption()).toBe("Season programme · Press A3 · Mon, Oct 19, 2026");
            await letGo();
            await settle();
            expect(pending(c)).toBe("1 pending");
            await press(historyButton(c, SAVE));
            await waitFor(() => expect(pending(c)).toBe("0 pending"));
            const after = await h.read(ex.planWorksJobs);
            const made = [...after].filter(([key]) => !before.includes(key)).map(([, job]) => job);
            expect(made.length).toBe(1);
            // 48,000 sheets at 8,000 an hour: six hours on Press A3, with the order's own fields.
            expect([made[0]!.title, made[0]!.customer, made[0]!.press, made[0]!.sheets]).toEqual(["Season programme", "Heathfield Theatre", "a3", 48000.0]);
            expect([sameInstant(made[0]!.start, new Date("2026-10-19T00:00:00Z")), sameInstant(made[0]!.end, new Date("2026-10-19T06:00:00Z"))]).toEqual([true, true]);
        } finally {
            restore();
        }
    });

    test("the Connect tool draws a feed from a job to a bindery job, both read a cell at a time, and Save writes its ends under their kinds", async () => {
        const { c, restore } = await mounted();
        try {
            await press(tool(c, "Connect"));
            const inserts = c.querySelector<HTMLElement>(`${rowAt(FOLD)} ${el("data-chip", "binding", "B-9002")}`)!;
            const y = layOutPlots(c, [B2_ROW, FOLD], [[inserts, { left: xAt(9, 10), top: 44, width: 25, height: 24 }]]);
            // From the market posters, Tuesday 13 October on Press B2, onto the handbook's inserts at the folder.
            const release = await carry(c.querySelector<HTMLElement>(`${rowAt(B2_ROW)} ${el("data-run", "job", "J-9007")}`)!,
                { x: xAt(8, 9), y: y(B2_ROW) }, { x: xAt(9, 12), y: y(FOLD) });
            expect(caption()).toBe("Feed · Market posters → Fold handbook inserts");
            await release();
            expect(pending(c)).toBe("1 pending");
            await press(historyButton(c, SAVE));
            await waitFor(() => expect(pending(c)).toBe("0 pending"));
            const made = [...(await h.read(ex.planWorksFeeds))].filter(([key]) => !["F-1", "F-2", "F-3"].includes(key)).map(([, feed]) => feed);
            expect(made.length).toBe(1);
            expect([sameFrom(made[0]!.from, variant("job", "J-9007")), sameTo(made[0]!.to, variant("binding", "B-9002"))]).toEqual([true, true]);
        } finally {
            restore();
        }
    });

    test("the optimiser places each order on the press free soonest: one edit, and Save writes each as a job under its order's key", async () => {
        const { c, restore } = await mounted();
        try {
            await press(c.querySelector("[data-optimise-button]")!);
            await waitFor(() => expect(pending(c)).toBe("3 pending"));
            await press(historyButton(c, SAVE));
            await waitFor(() => expect(pending(c)).toBe("0 pending"));
            const jobs = await h.read(ex.planWorksJobs);
            // Press A3 is free first, from Wednesday 7 October at two: the three orders run there one after another, each
            // for as long as its sheets take at 8,000 an hour.
            const placed = ["O-701", "O-702", "O-703"].map((key) => jobs.get(key)!);
            expect(placed.map((job) => [job.title, job.press])).toEqual([["Season programme", "a3"], ["Autumn catalogue", "a3"], ["Members' newsletter", "a3"]]);
            expect(placed.map((job) => [job.start, job.end].map((at) => at.getTime()))).toEqual([
                ["2026-10-07T14:00:00Z", "2026-10-07T20:00:00Z"], ["2026-10-07T20:00:00Z", "2026-10-08T06:00:00Z"], ["2026-10-08T06:00:00Z", "2026-10-08T08:00:00Z"],
            ].map((span) => span.map((text) => new Date(text).getTime())));
            // No job of the works moved.
            expect(sameInstant(jobs.get("J-9005")!.start, new Date("2026-10-07T06:00:00Z"))).toBe(true);
        } finally {
            restore();
        }
    });

    test("the rail finds a press by its code: narrowed to it, the works are the group holding that resource, read through the index of each group under its resources' codes", async () => {
        const { c, restore } = await mounted();
        try {
            // The rail's choice of a resource, as its field writes it: Press B2's code.
            const KEY = "ex.planPrintWorksRecords.rows";
            const decode = decodeBeast2For(RecordSliceStateType);
            const where = new SortedMap([["code", variant("values", [printFor(StringType)("b2")])]], compareFor(StringType));
            await act(async () => { getStore().write(KEY, encodeBeast2For(RecordSliceStateType)({ ...decode(getStore().read(KEY)!), preset: none, where } as never)); });
            await settle();
            // Hall B alone, with its three presses: no other group holds the press.
            await waitFor(() => expect(c.querySelector(rowAt(A1_ROW))).toBeNull());
            expect([...c.querySelectorAll("[data-plan-group]")].map((group) => group.getAttribute("data-plan-group"))).toEqual([rowKeyOf(entry("groups", "2-presses-b"))]);
            expect(c.querySelector(rowAt(B2_ROW))).not.toBeNull();
            expect(h.readKinds("records.plan_works_rows", "plan_works_rows_by_resource").length).toBeGreaterThan(0);
        } finally {
            restore();
        }
    });

    test("a crew's hours by role, child rows keyed by a variant, are typed into and saved through the rows' record", async () => {
        const { c, restore } = await mounted();
        try {
            // The crews' hours are folded to start: unfolded, each role draws beneath its crew.
            await act(async () => { fireEvent.click(within(slot(c, "toolbar")!).getByRole("button", { name: "Expand all" })); });
            await settle();
            const week = new Date("2026-10-05T00:00:00Z");
            const cell = (row: PlanRowId) => [...c.querySelectorAll<HTMLElement>(`${rowAt(row)} [data-cell]`)]
                .find((one) => one.getAttribute("data-cell") === instantKey(timeInstant(week)));
            const printed = (row: PlanRowId) => cell(row)?.querySelector("[data-part='0']")?.textContent ?? "none";
            // The operators' 152 hours that week, and the crew's sum of its roles as e3 keeps it: 152 and the assistants' 76.
            await waitFor(() => expect(printed(C1_OPERATORS)).toBe("152"));
            expect(printed(C1_HOURS)).toBe("228");
            await act(async () => { fireEvent.doubleClick(cell(C1_OPERATORS)!); });
            const input = c.querySelector<HTMLInputElement>("[data-plan-typing] input")!;
            await act(async () => { fireEvent.input(input, { target: { value: "200" } }); });
            await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
            await settle();
            // The crew's sum moves at once.
            await waitFor(() => expect(printed(C1_HOURS)).toBe("276"));
            await press(historyButton(c, SAVE));
            await waitFor(() => expect(pending(c)).toBe("0 pending"));
            const crew = (await h.read(ex.planWorksRows)).get("3-crews-a")!.resources.get("c1")!;
            expect(crew.hours.get(variant("operator", null))!.hours.get(week)).toBe(200);
            // The assistants' hours stand.
            expect(crew.hours.get(variant("assistant", null))!.hours.get(week)).toBe(76);
        } finally {
            restore();
        }
    });
});
