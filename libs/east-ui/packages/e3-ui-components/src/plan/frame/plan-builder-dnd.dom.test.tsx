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
 * own `canDrop` over `Schedule.Types.Candidate` puts its message on the ghost
 * and in the carry's words, and refuses a selection whole when one part is
 * refused; a kind whose save is out refuses every drop; and `data`'s rows
 * beside the kinds take no move while `data`'s own session takes none.
 *
 * Pointer geometry is laid out in jsdom (`layOutPlots`): each row's plot spans
 * the four weeks from Monday 5 October 2026, 100px a day.
 */

import { describe, test, expect } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import { ArrayType, DateTimeType, DictType, East, OptionType, StringType, StructType, decodeBeast2For, equalFor, none, some, variant } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { editingMessages, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { announced, layOut } from "@elaraai/east-ui-components/testing";
import { Plan, Record, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-events";
import { initializeRecordApi } from "../../platform/index.js";
import { rowKeyOf, type PlanRowId } from "../model.js";
import { carry, carrySaid, dragTo, keyOn } from "../plan-move.test-utils.js";
import { WORKSPACE, act, el, elementKey, entry, mount, planHarness, programOf, rowAt, settle, slot, tabs } from "./harness.test-utils.js";

const h = planHarness();

/** Each Plan is mounted under the page's drag layer, so its cards and elements drag. */
const DRAG = { drag: true } as const;

// ── The rows a drag lands on ──────────────────────────────────────────────────

/** Each press's bars, Press A1's marks and its tiles, and Crew 1's chips. */
const A1 = entry("presses.span", "Hall A", "a1");
const A2 = entry("presses.span", "Hall A", "a2");
const A3 = entry("presses.span", "Hall A", "a3");
const B1 = entry("presses.span", "Hall B", "b1");
const B2 = entry("presses.span", "Hall B", "b2");
const B3 = entry("presses.span", "Hall B", "b3");
const A1_MARKS = entry("presses.marks", "Hall A", "a1");
const A1_TILES = entry("presses.buckets", "Hall A", "a1");
const A2_TILES = entry("presses.buckets", "Hall A", "a2");
const C1 = entry("crews.cards", "Hall A", "c1");

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
 * The jobs on the presses, with their templates and backlog, and the stops as
 * tiles in each press's day — its `canDrop` refusing Press B3, which is down
 * for service, whatever is dropped there.
 */
const vetoed = East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const presses = $.let(Record.bind(ex.planPrintPresses, []));
    const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
    const stops = $.let(Record.bind(ex.planPrintStops, [ex.planPrintStopsPatch]));
    const axis = $.const(Plan.axis({ window: { min: FIRST, max: LAST }, resolution: "day" }));
    const canDrop = $.const(East.function([Schedule.Types.Candidate], OptionType(StringType), ($2, candidate) => {
        const said = $2.let(none, OptionType(StringType));
        $2.match(candidate.resource, {
            some: ($3, on) => { $3.if(on.key.equal("b3"), ($4) => { $4.assign(said, some("Press B3 is down for service")); }); },
        });
        return said;
    }));
    return Plan({
        axis,
        resources: {
            presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name, group: (p) => p.hall }),
        },
        events: {
            job: Schedule.events(jobs, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" },
                backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
                templates: [{
                    key: "brochure", name: "Brochure run", group: "Jobs", duration: variant("hours", 6.0),
                    values: { title: "Brochure run", state: variant("proposed", variant("added", null)), sheets: 40000.0, customer: "", stock: variant("coated", null), due: none },
                }],
            }),
            stop: Schedule.events(stops, {
                name: "Stop", icon: "screwdriver-wrench", draw: "buckets", title: "title", at: "at",
                resource: { field: "press", of: "presses" },
            }),
        },
        library: [Plan.library.events(), Plan.library.backlog()],
        canDrop,
    });
}))), getRegisteredPlatformImplementations());

/** A bindery line: its name and its runs. */
const BinderyRun = StructType({ key: StringType, label: StringType, start: DateTimeType, end: DateTimeType });
const BinderyLine = StructType({ label: StringType, runs: ArrayType(BinderyRun) });
/** Line 1's row, under the jobs on the presses. */
const LINE_1 = entry("bindery", "l1");

/**
 * The jobs on the presses beside `data`'s bindery line, a series that declares
 * its moves — and no editing session of its own, so its runs take no gesture.
 */
const beside = East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const presses = $.let(Record.bind(ex.planPrintPresses, []));
    const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
    const lines = $.const(new Map([["l1", {
        label: "Line 1", runs: [{ key: "w1", label: "Folding", start: new Date("2026-10-06T06:00:00Z"), end: new Date("2026-10-06T12:00:00Z") }],
    }]]), DictType(StringType, BinderyLine));
    return Plan({
        axis: Plan.axis({ window: { min: FIRST, max: LAST }, resolution: "day" }),
        data: lines,
        series: [Plan.series.span(BinderyLine, {
            key: "bindery", title: "Bindery", label: (l) => l.label,
            runs: (l) => l.runs.map((_$2, r) => Plan.run({ key: r.key, start: r.start, end: r.end, label: r.label, state: "confirmed" })),
            edit: { items: "runs", key: "key", start: "start", end: "end" },
        })],
        resources: {
            presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name, group: (p) => p.hall }),
        },
        events: {
            job: Schedule.events(jobs, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" },
                backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
            }),
        },
    });
}))), getRegisteredPlatformImplementations());

/**
 * The jobs on the presses drawn as tiles in each press's day — a kind with a
 * start and an end, its tile at its start — with the inspector, which says
 * when one runs.
 */
const tiled = East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const presses = $.let(Record.bind(ex.planPrintPresses, []));
    const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
    return Plan({
        axis: Plan.axis({ window: { min: FIRST, max: LAST }, resolution: "day" }),
        resources: {
            presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name, group: (p) => p.hall }),
        },
        events: {
            job: Schedule.events(jobs, {
                name: "Print job", icon: "file-lines", draw: "buckets", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" },
                backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
            }),
        },
        inspector: true,
    });
}))), getRegisteredPlatformImplementations());

/** The jobs on the presses, and the customers: a card dropped on a job sets its customer and its stock. */
const stocked = East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const presses = $.let(Record.bind(ex.planPrintPresses, []));
    const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
    const customers = $.let(Record.bind(ex.planPrintCustomers, []));
    return Plan({
        axis: Plan.axis({ window: { min: FIRST, max: LAST }, resolution: "day" }),
        resources: {
            presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name, group: (p) => p.hall }),
        },
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
}))), getRegisteredPlatformImplementations());

/** The jobs record as its patch door last left it. */
function readJobs() {
    const bytes = h.cache.read(WORKSPACE, [variant("field", "records"), variant("field", ex.planPrintJobs.name)]);
    if (bytes === undefined) throw new Error("the jobs record has not loaded");
    return decodeBeast2For(ex.planPrintJobs.type)(bytes);
}
const sameJob = equalFor(ex.PrintJob);

// ============================================================================
// A template, onto a resource's row (PB32)
// ============================================================================

describe("a template card dropped on a resource's row (PB32)", () => {
    test("creates an event of its kind at the bucket under the pointer, for its duration, selected — the ghost saying what lands where, one step Undo takes back", async () => {
        const { container: c } = mount(programOf(ex.planPrintWorks), DRAG);
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
        const made = bar(c, "brochure-2");
        expect(named(made)).toMatch(/^Brochure run, Oct 12, 2026 – Oct 12, 2026, 06:00, proposed/);
        expect(made!.getAttribute("aria-pressed")).toBe("true");
        expect(made!.hasAttribute("data-draft")).toBe(true);
        expect(inspected(c)).toBe("Brochure run");
        expect(pending(c)).toBe("1 pending");
        await press(historyButton(c, UNDO));
        expect(bar(c, "brochure-2")).toBeNull();
        expect(pending(c)).toBe("0 pending");
        expect(historyButton(c, UNDO).disabled).toBe(true);
    }, 30_000);

    test("a template with a start time starts at it on a whole day; a stop's lands on the press whichever of its rows takes it — drawn on its marks", async () => {
        const { container: c } = mount(programOf(ex.planPrintWorks), DRAG);
        await settle();
        const y = layOutPlots(c, [A1, C1]);
        // The early shift, from 06:00 for eight hours, on Crew 1's Tuesday.
        const letGo = await carry(cardOf(c, elementKey("shift", "early"))!, OFF, { x: xAt(8), y: y(C1) });
        expect(caption()).toBe("Early shift · Crew 1 · Tue, Oct 13, 2026 · 06:00");
        await letGo();
        await settle();
        expect(named(chip(c, "early-2"))).toMatch(/^Early, Oct 13, 2026, 06:00 – Oct 13, 2026, 14:00/);
        // A plate change dropped on Press A1's bars lands on Press A1: a mark, on its marks row, at the day's start.
        await drop(cardOf(c, elementKey("stop", "plates"))!, OFF, { x: xAt(3), y: y(A1) });
        expect(stop(c, "plates-2")).not.toBeNull();
        expect(named(stop(c, "plates-2"))).toMatch(/Oct 8, 2026/);
        expect(pending(c)).toBe("2 pending");
    }, 30_000);

    test("refused on a resource of a kind it is not placed on — the ghost says what it needs, in red, and the drop makes nothing", async () => {
        const { container: c } = mount(programOf(ex.planPrintWorks), DRAG);
        await settle();
        const y = layOutPlots(c, [A1, C1]);
        const letGo = await carry(cardOf(c, elementKey("job", "brochure"))!, OFF, { x: xAt(7), y: y(C1) });
        expect(plotOf(c, C1).hasAttribute("data-drop-invalid")).toBe(true);
        expect(plotOf(c, C1).hasAttribute("data-drop-active")).toBe(false);
        expect(caption()).toBe("refused: Needs presses");
        await letGo();
        expect(announced()).toBe("Brochure run was not dropped.");
        expect(chip(c, "brochure-2")).toBeNull();
        expect(pending(c)).toBe("0 pending");
    }, 30_000);

    test("refused where the Plan's canDrop says so — its message on the ghost; taken a press away", async () => {
        const { container: c } = mount(vetoed, DRAG);
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
    }, 30_000);

    test("dropped twice on one day it makes two events, each under a new key of its own", async () => {
        const { container: c } = mount(programOf(ex.planPrintWorks), DRAG);
        await settle();
        let y = layOutPlots(c, [A1]);
        await drop(cardOf(c, elementKey("job", "brochure"))!, OFF, { x: xAt(7), y: y(A1) });
        y = layOutPlots(c, [A1]);
        await drop(cardOf(c, elementKey("job", "brochure"))!, OFF, { x: xAt(7), y: y(A1) });
        expect(named(bar(c, "brochure-2"))).toMatch(/^Brochure run, Oct 12, 2026 – Oct 12, 2026, 06:00/);
        expect(named(bar(c, "brochure-3"))).toMatch(/^Brochure run, Oct 12, 2026 – Oct 12, 2026, 06:00/);
        expect(pending(c)).toBe("2 pending");
    }, 30_000);

    test("refused while its kind's save is out — the ghost says the kind can't change now — and taken once the save is back", async () => {
        const { container: c } = mount(programOf(ex.planPrintWorks), DRAG);
        await settle();
        let y = layOutPlots(c, [A1, A3]);
        // A draft to save: the spring catalogue a day on.
        await drop(bar(c, "J-1001")!, { x: xAt(0, 9), y: y(A1) }, { x: xAt(1, 9), y: y(A1) });
        // The writes held: saving.
        let release!: () => void;
        const held = new Promise<void>((resolve) => { release = resolve; });
        initializeRecordApi({ ...h.memory, mutate: async (ws, record, mutation, req) => { await held; return h.memory.mutate(ws, record, mutation, req); } }, h.cache, WORKSPACE);
        await press(historyButton(c, SAVE));
        y = layOutPlots(c, [A1, A3]);
        const letGo = await carry(cardOf(c, elementKey("job", "brochure"))!, OFF, { x: xAt(9), y: y(A3) });
        expect(plotOf(c, A3).hasAttribute("data-drop-invalid")).toBe(true);
        expect(caption()).toBe("refused: Print job can't change now");
        await letGo();
        expect(bar(c, "brochure-2", A3)).toBeNull();
        await act(async () => { release(); });
        await settle();
        y = layOutPlots(c, [A1, A3]);
        await drop(cardOf(c, elementKey("job", "brochure"))!, OFF, { x: xAt(9), y: y(A3) });
        expect(bar(c, "brochure-2", A3)).not.toBeNull();
        expect(pending(c)).toBe("1 pending");
    }, 30_000);
});

// ============================================================================
// A backlog event, onto a resource's row (PB33) — the Backlog tab reading the drafts
// ============================================================================

describe("a backlog card dropped on a resource's row (PB33)", () => {
    test("schedules its event — its start, its end from its duration and its resource; it leaves the Backlog tab at once, and Undo brings it back", async () => {
        const { container: c } = mount(programOf(ex.planPrintWorks), DRAG);
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
    }, 30_000);

    test("refused on a crew, and where canDrop refuses it — the same refusals as a template's", async () => {
        const works = mount(programOf(ex.planPrintWorks), DRAG);
        await settle();
        await openTab(works.container, "Backlog");
        let y = layOutPlots(works.container, [A3, C1]);
        const letGo = await carry(cardOf(works.container, elementKey("job", "J-1023"))!, OFF, { x: xAt(4), y: y(C1) });
        expect(caption()).toBe("refused: Needs presses");
        await letGo();
        works.unmount();
        const { container: c } = mount(vetoed, DRAG);
        await settle();
        await openTab(c, "Backlog");
        y = layOutPlots(c, [B3]);
        const vetoedLetGo = await carry(cardOf(c, elementKey("job", "J-1023"))!, OFF, { x: xAt(4), y: y(B3) });
        expect(caption()).toBe("refused: Press B3 is down for service");
        await vetoedLetGo();
        expect(jobsOn(c, B3)).not.toContain(elementKey("job", "J-1023"));
    }, 30_000);
});

// ============================================================================
// An element, along its row and across rows (PB34)
// ============================================================================

describe("an element moved along its row or onto another resource's (PB34)", () => {
    test("a bar moves by the days the pointer crossed; across presses it writes the press — each one step, the ghost saying where", async () => {
        const { container: c } = mount(programOf(ex.planPrintWorks), DRAG);
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
    }, 30_000);

    test("refused onto a resource of a kind it is not placed on: a job over a crew says what it needs", async () => {
        const { container: c } = mount(programOf(ex.planPrintWorks), DRAG);
        await settle();
        const y = layOutPlots(c, [A1, C1]);
        const letGo = await carry(bar(c, "J-1001")!, { x: xAt(0, 9), y: y(A1) }, { x: xAt(0, 9), y: y(C1) });
        expect(plotOf(c, C1).hasAttribute("data-drop-invalid")).toBe(true);
        expect(caption()).toBe("refused: Needs presses");
        await letGo();
        expect(announced()).toBe("Spring catalogue was not dropped.");
        expect(pending(c)).toBe("0 pending");
    }, 30_000);

    test("a selected element moves the selection: the others by the same days, in one step", async () => {
        const { container: c } = mount(programOf(ex.planPrintWorks), DRAG);
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
    }, 30_000);

    test("carried onto another press, a selection takes the events on the grabbed one's press with it — one on a press of its own stays, undrafted", async () => {
        const { container: c } = mount(programOf(ex.planPrintWorks), DRAG);
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
    }, 30_000);

    test("one part refused refuses the whole selection: a job on a press canDrop refuses holds the others where they are", async () => {
        const { container: c } = mount(vetoed, DRAG);
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
    }, 30_000);

    test("a mark moves along its press, by the days crossed", async () => {
        const { container: c } = mount(programOf(ex.planPrintWorks), DRAG);
        await settle();
        const y = layOutPlots(c, [A1_MARKS]);
        // The plate change at 12:00 on Wednesday, a day on.
        await drop(stop(c, "S-01")!, { x: xAt(2, 12), y: y(A1_MARKS) }, { x: xAt(3, 12), y: y(A1_MARKS) });
        expect(named(stop(c, "S-01"))).toMatch(/Oct 8, 2026, 12:00/);
        expect(stop(c, "S-01")!.hasAttribute("data-draft")).toBe(true);
    }, 30_000);

    test("a tile moves to another press's day — it has no ends to drag — and wears the drafted look until Undo", async () => {
        const { container: c } = mount(vetoed, DRAG);
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
    }, 30_000);

    test("a tile of a kind with a start and an end moves its event's times by the days crossed — its length kept", async () => {
        const { container: c } = mount(tiled, DRAG);
        await settle();
        const y = layOutPlots(c, [A1_TILES]);
        const tile = () => c.querySelector<HTMLElement>(`${rowAt(A1_TILES)} ${el("data-event", "job", "J-1001")}`);
        const when = () => slot(c, "end")!.querySelector("[data-inspector-when]")?.textContent ?? null;
        await select(tile()!);
        expect(when()).toBe("Mon, Oct 5, 2026 · 06:00–14:00");
        // The spring catalogue's tile, in Monday's cell, two days on.
        await drop(tile()!, { x: xAt(0), y: y(A1_TILES) }, { x: xAt(2), y: y(A1_TILES) });
        await select(tile()!);
        expect(named(tile())).toMatch(/Oct 7, 2026/);
        expect(when()).toBe("Wed, Oct 7, 2026 · 06:00–14:00");
    }, 30_000);
});

// ============================================================================
// An edge, along the axis (PB35)
// ============================================================================

describe("a bar's or a chip's edge resizes it (PB35)", () => {
    test("its end moves by the days crossed, and never closer to its start than one snap — a day", async () => {
        const { container: c } = mount(programOf(ex.planPrintWorks), DRAG);
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
    }, 30_000);
});

// ============================================================================
// An event, onto the Backlog tab (PB36)
// ============================================================================

describe("an event dropped on the Backlog tab (PB36)", () => {
    test("is unscheduled: it leaves its press and joins the tab at once — no trash zone on the way; Undo puts it back", async () => {
        const { container: c } = mount(programOf(ex.planPrintWorks), DRAG);
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
    }, 30_000);

    test("refused for a kind whose times are no Options: a stop has no backlog", async () => {
        const { container: c } = mount(programOf(ex.planPrintWorks), DRAG);
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
    }, 30_000);
});

// ============================================================================
// An author's card, onto an event of its patch's kind (PB63)
// ============================================================================

describe("an author's card dropped on an event of its patch's kind (PB63)", () => {
    test("sets what its patch sets, in one step: the ghost names the card and the event", async () => {
        const { container: c } = mount(programOf(ex.planPrintWorks), DRAG);
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
    }, 30_000);

    test("refused anywhere but an event of that kind: between events, and on a stop", async () => {
        const { container: c } = mount(programOf(ex.planPrintWorks), DRAG);
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
    }, 30_000);

    test("a patch that sets two fields sets both on the event, as one step — and Save writes both", async () => {
        const { container: c } = mount(stocked, DRAG);
        await settle();
        const before = readJobs().get("J-1001")!;
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
        expect(sameJob(readJobs().get("J-1001")!, { ...before, customer: "Harbour Arts Society", stock: variant("board", null) })).toBe(true);
    }, 30_000);
});

// ============================================================================
// One history, and the keyboard (PB31, PB43)
// ============================================================================

describe("every gesture is one step of the Plan's one history", () => {
    test("a drop, a schedule, a move, a resize, an unschedule and a card's patch: six steps, Undo taking each back in turn", async () => {
        const { container: c } = mount(programOf(ex.planPrintWorks), DRAG);
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
        const job = bar(c, "J-1003")!;
        y = layOutPlots(c, [A1, A3], [[job, { left: xAt(9, 7), top: 4, width: 20, height: 24 }]]);
        await drop(cardOf(c, "harbour-arts")!, OFF, { x: xAt(9, 8), y: y(A1) });
        // Five events drafted by the six gestures: the museum guide moved and resized.
        expect(pending(c)).toBe("5 pending");
        const state = () => ({
            poster: bar(c, "poster-2", A3) !== null,
            forms: bar(c, "J-1024", A3) !== null,
            guide: named(bar(c, "J-1002"))?.split(", actual")[0] ?? null,
            catalogue: bar(c, "J-1001") !== null,
            posters: bar(c, "J-1003")?.hasAttribute("data-draft") ?? null,
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
    }, 60_000);

    test("the keyboard carries a job along its kind's rows — the next press's bars, past its marks — and says why canDrop refuses a press", async () => {
        const { container: c } = mount(vetoed, DRAG);
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
    }, 30_000);
});

// ============================================================================
// `data`'s rows beside the event kinds
// ============================================================================

describe("data's rows beside the event kinds", () => {
    test("take no move while data's own session takes none: the jobs drag, the bindery's runs never do", async () => {
        const { container: c } = mount(beside, DRAG);
        await settle();
        expect(bar(c, "J-1001")!.hasAttribute("data-draggable")).toBe(true);
        const run = c.querySelector<HTMLElement>(`${rowAt(LINE_1)} [data-run="w1"]`)!;
        expect(named(run)).toMatch(/^Folding/);
        expect(run.hasAttribute("data-draggable")).toBe(false);
        // Nor does the keyboard pick one up.
        run.focus();
        await keyOn({ key: " " });
        expect(carrySaid(c)).toBe("");
    }, 30_000);
});
