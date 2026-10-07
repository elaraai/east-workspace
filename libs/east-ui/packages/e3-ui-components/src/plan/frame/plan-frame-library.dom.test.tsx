/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Plan>`'s library pane (#1195, `Plan Builder Spec.md` §8, §9.6, PB25–PB30,
 * PB61, PB62), over the print works' examples and their seeded records: the
 * tabs the author's `library` lists, in its order, each with its count, and
 * no pane when it lists none; the rail's count; the Events tab's templates by
 * kind and group; the Backlog tab's unscheduled events by when they are due,
 * read again as a record commits; the Series tab hiding a kind, a measure, a
 * resource kind and a row of the Plan's own, kept per viewer across a
 * remount; an author's tab's cards, its search and a click selecting a card;
 * the empty states; and the panes' open tab and collapsed state kept under
 * the Plan's id. The Series tab is `Pick.Panel`'s list: the old Series
 * popover's tests run in it, over a canvas whose series are picked.
 */

import { describe, test, expect, vi } from "vitest";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { UIStore, getRegisteredPlatformImplementations, system } from "@elaraai/east-ui-components";
import { getStore, initializeStore } from "@elaraai/east-ui-components/internal";
import { Plan, Record, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-events";
import { EastChakraPlan, type PlanRootValue, type PlanValue } from "../index.js";
import { rowKeyOf, type PlanRowId } from "../model.js";
import { oneBlock, rowId } from "../plan.test-utils.js";
import { entry, mount, planHarness, programOf, settle, slot, tabs } from "./harness.test-utils.js";

const h = planHarness();

/** Each Plan is mounted under the page's drag layer, so its cards drag. */
const DRAG = { drag: true } as const;

// ── The frame's regions, the pane's tabs and cards ───────────────────────────

/** The library pane. */
const pane = (c: HTMLElement) => slot(c, "start")!;

/** Opens a library tab, by its name. */
async function openTab(c: HTMLElement, name: string) {
    const tab = [...pane(c).querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent?.startsWith(`${name} `));
    if (tab === undefined) throw new Error(`no library tab ${name}`);
    fireEvent.click(tab);
    await settle();
}

/** The open tab's panel. */
const panel = (c: HTMLElement) => pane(c).querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;

/** A panel's group heads: each label and its count. */
const heads = (c: HTMLElement) => [...panel(c).querySelectorAll("[data-library-head]")]
    .map((head) => [head.children[0]!.textContent, head.children[1]!.textContent]);

/** A card's body: its name and the line under it — the card's block that is not its icon tile. */
const bodyOf = (card: HTMLElement) => [...card.children].find((el) => el.tagName === "DIV" && el.querySelector(":scope > svg") === null)!;

/** A panel's cards, in order: each card's name and the line under it. */
const cards = (c: HTMLElement) => [...panel(c).querySelectorAll<HTMLElement>("[data-library-item]")]
    .map((card) => [bodyOf(card).children[0]!.textContent, bodyOf(card).children[1]?.textContent ?? null]);

/** A card of the open tab, by its name. */
const cardNamed = (c: HTMLElement, name: string) => {
    const card = [...panel(c).querySelectorAll<HTMLElement>("[data-library-item]")].find((el) => bodyOf(el).children[0]!.textContent === name);
    if (card === undefined) throw new Error(`no card ${name}`);
    return card;
};

/** Types in the open tab's search. */
async function search(c: HTMLElement, text: string) {
    await act(async () => { fireEvent.change(within(panel(c)).getByRole("textbox", { name: "Search library" }), { target: { value: text } }); });
}

/** The open tab's empty state: its title and the line under it, or `null` while cards show. */
const emptyState = (c: HTMLElement) => {
    const empty = panel(c).querySelector<HTMLElement>("[data-library-empty]") ?? panel(c).querySelector<HTMLElement>("[data-empty-state]");
    if (empty === null) return null;
    const title = within(empty).getByRole("heading");
    return [title.textContent, title.nextElementSibling?.textContent ?? null];
};

/** The Series tab's lines: each its name and whether it shows. */
const lines = (c: HTMLElement) => [...panel(c).querySelectorAll<HTMLElement>("[data-slot='pickPanel'] button[aria-pressed]")]
    .map((line) => [line.getAttribute("aria-label")!.replace(/^Toggle /, ""), line.getAttribute("aria-pressed") === "true"]);

/** Toggles a Series line, by its name. */
async function toggle(c: HTMLElement, name: string) {
    fireEvent.click(within(panel(c)).getByRole("button", { name: `Toggle ${name}` }));
    await settle();
}

// ── The canvas's rows ───────────────────────────────────────────────────────

/** Whether the canvas draws a row — pinned under the ruler, or in its grid. */
const draws = (c: HTMLElement, id: PlanRowId) => slot(c, "main")!.querySelector(`[data-plan-row=${JSON.stringify(rowKeyOf(id))}]`) !== null;
/** Whether the canvas draws a group strip. */
const drawsStrip = (c: HTMLElement, id: PlanRowId) => slot(c, "main")!.querySelector(`[data-plan-group=${JSON.stringify(rowKeyOf(id))}]`) !== null;

// ── Plans of the tests' own ──────────────────────────────────────────────────

type Job = ValueTypeOf<typeof ex.PrintJob>;
type Customers = ValueTypeOf<typeof ex.planPrintCustomers.type>;
const FIRST = new Date("2026-10-05T00:00:00Z");
const LAST = new Date("2026-11-02T00:00:00Z");

/** A tab a test's Plan lists: a built-in tab, or the customers, a tab of the author's own with no `drop`. */
type TabName = "events" | "backlog" | "series" | "customers";

/** The presses and the print jobs on them, with a backlog and no templates, the library the tabs named and the Plan the id given. */
function jobsPlan(tabs: readonly TabName[], id?: string) {
    return East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const presses = $.let(Record.bind(ex.planPrintPresses, []));
        const jobs = $.let(Record.bind(ex.planPrintJobs, [ex.planPrintJobsPatch]));
        const customers = $.let(Record.bind(ex.planPrintCustomers, []));
        const axis = $.const(Plan.axis({ window: { min: FIRST, max: LAST }, resolution: "day", now: new Date("2026-10-14T09:00:00Z") }));
        const library = tabs.map((tab) => (tab === "events" ? Plan.library.events() : tab === "backlog" ? Plan.library.backlog()
            : tab === "series" ? Plan.library.series() : Plan.library.tab(customers.read(), { name: "Customers", label: (c) => c.name })));
        return Plan({
            axis,
            resources: { presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name }) },
            events: {
                job: Schedule.events(jobs, {
                    name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                    resource: { field: "press", of: "presses" },
                    backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
                }),
            },
            library,
            ...(id !== undefined ? { id } : {}),
        });
    }))), getRegisteredPlatformImplementations());
}

/** The print works' jobs, every one of them scheduled. */
function allScheduled(): Map<string, Job> {
    const jobs = new Map(ex.planPrintJobs.default as ReadonlyMap<string, Job>);
    for (const [key, job] of jobs) {
        if (job.start.type === "none") {
            jobs.set(key, { ...job, start: some(new Date("2026-10-20T06:00:00Z")), end: some(new Date("2026-10-20T08:00:00Z")), press: some("a1") });
        }
    }
    return jobs;
}

// ============================================================================
// The tabs `library` lists (PB26, PB61)
// ============================================================================

describe("the tabs `library` lists (PB26, PB61)", () => {
    test("in its order, each with its count; collapsed, the pane is a rail with the backlog's count", async () => {
        const { container } = mount(programOf(ex.planPrintWorks), DRAG);
        await settle();
        // Nine templates; eight jobs in the backlog; seven lines to hide; sixteen customers.
        expect(tabs(pane(container))).toEqual(["Events 9", "Backlog 8", "Series 7", "Customers 16"]);
        fireEvent.click(within(pane(container)).getByRole("button", { name: "Collapse Library" }));
        await settle();
        expect(pane(container).hasAttribute("data-collapsed")).toBe(true);
        expect(within(pane(container)).getByText("8")).toBeTruthy();
    });

    test("a Plan whose library lists no tab has no pane; without a Backlog tab, the rail counts the first tab's cards", async () => {
        const bare = mount(programOf(ex.planEvents), DRAG);
        await settle();
        expect(slot(bare.container, "start")).toBeNull();
        cleanup();
        const { container } = mount(jobsPlan(["customers", "events"]), DRAG);
        await settle();
        expect(tabs(pane(container))).toEqual(["Customers 16", "Events 0"]);
        fireEvent.click(within(pane(container)).getByRole("button", { name: "Collapse Library" }));
        await settle();
        expect(within(pane(container)).getByText("16")).toBeTruthy();
    });
});

// ============================================================================
// Events (PB27)
// ============================================================================

describe("Events (PB27)", () => {
    test("every kind's templates under its kind's name, then their group: each its kind's icon, its name, and its kind, how long it runs and the resource kinds it is placed on", async () => {
        const { container } = mount(programOf(ex.planPrintWorks), DRAG);
        await settle();
        await openTab(container, "Events");
        expect(heads(container)).toEqual([["Print job · Jobs", "4"], ["Stop · Stops", "2"], ["Crew shift · Shifts", "3"]]);
        expect(cards(container)).toEqual([
            ["Brochure run", "Print job · 6 h · presses"],
            ["Catalogue run", "Print job · 12 h · presses"],
            ["Poster run", "Print job · 4 h · presses"],
            ["Board run", "Print job · 8 h · presses"],
            // A stop is an instant: it runs for no time.
            ["Plate change", "Stop · presses"],
            ["Service", "Stop · presses"],
            ["Early shift", "Crew shift · 8 h · crews"],
            ["Late shift", "Crew shift · 8 h · crews"],
            ["Night shift", "Crew shift · 8 h · crews"],
        ]);
        // Each card wears its kind's icon, and drags.
        expect(cardNamed(container, "Brochure run").querySelector('svg[data-icon="file-lines"]')).not.toBeNull();
        expect(cardNamed(container, "Service").querySelector('svg[data-icon="screwdriver-wrench"]')).not.toBeNull();
        expect(cardNamed(container, "Early shift").hasAttribute("data-draggable")).toBe(true);
        // The search reads a card's name, its group and its line.
        await search(container, "crew");
        expect(cards(container).map(([name]) => name)).toEqual(["Early shift", "Late shift", "Night shift"]);
        await search(container, "stops");
        expect(cards(container).map(([name]) => name)).toEqual(["Plate change", "Service"]);
    });
});

// ============================================================================
// Backlog (PB28)
// ============================================================================

describe("Backlog (PB28)", () => {
    test("every kind's unscheduled events, grouped by when they are due — counted from the week the axis's now is in — each how long it takes, its resource and its due day", async () => {
        const { container } = mount(programOf(ex.planPrintWorks), DRAG);
        await settle();
        await openTab(container, "Backlog");
        // Now is Wednesday 14 October: this week runs to Sunday 18.
        expect(heads(container)).toEqual([["Due this week", "2"], ["Due next week", "2"], ["Later", "2"], ["No date", "2"]]);
        expect(cards(container)).toEqual([
            ["Guide reprint", "3 h · Unassigned · due Fri 16"],
            ["Order forms", "5 h · Unassigned · due Sat 17"],
            ["Winter brochure", "8 h · Unassigned · due Wed 21"],
            ["Wall calendars", "6 h 15 m · Unassigned · due Fri 23"],
            ["Prospectus", "12 h 30 m · Unassigned · due Fri 6"],
            ["Price lists", "2 h · Unassigned · due Fri 13"],
            ["Spare covers", "1 h · Unassigned"],
            ["Proof sheets", "15 m · Unassigned"],
        ]);
        expect(cardNamed(container, "Prospectus").querySelector('svg[data-icon="file-lines"]')).not.toBeNull();
        expect(cardNamed(container, "Prospectus").hasAttribute("data-draggable")).toBe(true);
    });

    test("a job overdue is due this week; one on a press names it; the tab reads the record again as it commits", async () => {
        const { container } = mount(programOf(ex.planPrintWorks), DRAG);
        await settle();
        await openTab(container, "Backlog");
        const jobs = new Map(ex.planPrintJobs.default as ReadonlyMap<string, Job>);
        // Price lists were due last week, and wait on Press B1; the guide reprint is scheduled.
        jobs.set("J-1028", { ...jobs.get("J-1028")!, due: some(new Date("2026-10-09T00:00:00Z")), press: some("b1") });
        jobs.set("J-1023", { ...jobs.get("J-1023")!, start: some(new Date("2026-10-15T06:00:00Z")), end: some(new Date("2026-10-15T09:00:00Z")), press: some("a1") });
        await h.commit(ex.planPrintJobs, jobs);
        expect(tabs(pane(container))[1]).toBe("Backlog 7");
        expect(heads(container)).toEqual([["Due this week", "2"], ["Due next week", "2"], ["Later", "1"], ["No date", "2"]]);
        expect(cards(container).slice(0, 2)).toEqual([
            ["Price lists", "2 h · Press B1 · due Fri 9"],
            ["Order forms", "5 h · Unassigned · due Sat 17"],
        ]);
    });
});

// ============================================================================
// Series (PB29)
// ============================================================================

describe("Series (PB29)", () => {
    test("each resource kind and its measures, the event kinds and the Plan's rows, in the order the canvas draws them, each with an eye, frameless in the pane", async () => {
        const { container } = mount(programOf(ex.planPrintWorks), DRAG);
        await settle();
        await openTab(container, "Series");
        expect(lines(container)).toEqual([
            ["Presses", true], ["Utilisation", true], ["Crews", true], ["Print job", true], ["Stop", true], ["Crew shift", true], ["SHEETS / DAY", true],
        ]);
        expect(panel(container).querySelector("[data-slot='pickPanel']")!.getAttribute("data-density")).toBe("editor");
        // A measure says whose it is, and each line wears its kind's icon.
        const util = within(panel(container)).getByRole("button", { name: "Toggle Utilisation" });
        expect(util.textContent).toContain("Presses");
        expect(util.querySelector('svg[data-icon="table-cells-large"]')).not.toBeNull();
        expect(within(panel(container)).getByRole("button", { name: "Toggle Stop" }).querySelector('svg[data-icon="screwdriver-wrench"]')).not.toBeNull();
    });

    test("a hidden event kind leaves the canvas, and stays hidden for the viewer across a remount", async () => {
        const first = mount(programOf(ex.planPrintWorks), DRAG);
        await settle();
        const marks = entry("presses.marks", "Hall A", "a1");
        expect(draws(first.container, marks)).toBe(true);
        await openTab(first.container, "Series");
        await toggle(first.container, "Stop");
        // The stops were the presses' only marks: their row goes, the bars stay.
        expect(draws(first.container, marks)).toBe(false);
        expect(draws(first.container, entry("presses.span", "Hall A", "a1"))).toBe(true);
        expect(lines(first.container)[4]).toEqual(["Stop", false]);
        expect(localStorage.getItem("plan.series")).toBe(JSON.stringify(["events.stop"]));
        first.unmount();

        // Kept for the viewer, under the Plan's id.
        const again = mount(programOf(ex.planPrintWorks), DRAG);
        await settle();
        expect(draws(again.container, marks)).toBe(false);
        await openTab(again.container, "Series");
        expect(lines(again.container)[4]).toEqual(["Stop", false]);
        await toggle(again.container, "Stop");
        expect(draws(again.container, marks)).toBe(true);
        expect(localStorage.getItem("plan.series")).toBe(JSON.stringify([]));
    });

    test("a hidden measure, resource kind or row of the Plan's own leaves the canvas", async () => {
        const { container } = mount(programOf(ex.planPrintWorks), DRAG);
        await settle();
        await openTab(container, "Series");
        const util = entry("util", "Hall A", "a1");
        const output = entry("", "output");
        expect(draws(container, util) && draws(container, output)).toBe(true);
        await toggle(container, "Utilisation");
        expect(draws(container, util)).toBe(false);
        expect(draws(container, entry("presses.span", "Hall A", "a1"))).toBe(true);
        // The pinned chart under the ruler is one of the Plan's own rows.
        await toggle(container, "SHEETS / DAY");
        expect(draws(container, output)).toBe(false);
        // The presses go whole: their rows and their strips.
        await toggle(container, "Presses");
        expect(draws(container, entry("presses.span", "Hall A", "a1"))).toBe(false);
        expect(drawsStrip(container, entry("presses.group", "Hall A"))).toBe(false);
        expect(drawsStrip(container, entry("crews.group", "Hall A"))).toBe(true);
        expect(JSON.parse(localStorage.getItem("plan.series")!)).toEqual(["measures.util", "rows.output", "resources.presses"]);
    });

    test("a Plan without the Series tab hides nothing a store holds, nor does a store holding something other than a list of ids", async () => {
        localStorage.setItem("plan.series", JSON.stringify(["resources.presses"]));
        const { container } = mount(jobsPlan(["events"]), DRAG);
        await settle();
        expect(draws(container, entry("presses.span", "a1"))).toBe(true);
        cleanup();
        localStorage.setItem("plan.series", JSON.stringify({ "resources.presses": true }));
        const odd = mount(jobsPlan(["series"]), DRAG);
        await settle();
        expect(draws(odd.container, entry("presses.span", "a1"))).toBe(true);
    });
});

// ============================================================================
// An author's tab (PB62)
// ============================================================================

describe("an author's tab (PB62)", () => {
    test("one card per row — its label, its meta, the tab's icon — grouped by its group, searched by key, label and meta; each drags", async () => {
        const { container } = mount(programOf(ex.planPrintWorks), DRAG);
        await settle();
        await openTab(container, "Customers");
        expect(heads(container)).toEqual([["Old Town", "6"], ["North Quay", "5"], ["Riverside", "5"]]);
        expect(cards(container).slice(0, 3)).toEqual([["Alder & Finch", "Retail"], ["Copperleaf Cafe", "Hospitality"], ["Granite Hall", "Events"]]);
        const card = cardNamed(container, "Alder & Finch");
        expect(card.querySelector('svg[data-icon="building"]')).not.toBeNull();
        expect(card.hasAttribute("data-draggable")).toBe(true);
        // The cards a search leaves keep their groups, in the order the cards come.
        await search(container, "arts");
        expect(heads(container)).toEqual([["North Quay", "2"], ["Old Town", "1"]]);
        expect(cards(container).map(([name]) => name)).toEqual(["Driftwood Museum", "Harbour Arts Society", "Hollow Oak Theatre"]);
        await search(container, "northwind");
        expect(cards(container).map(([name]) => name)).toEqual(["Northwind Outfitters"]);
        // Its key alone finds a card: neither its label nor its meta holds it.
        await search(container, "alder-finch");
        expect(cards(container).map(([name]) => name)).toEqual(["Alder & Finch"]);
    });

    test("a tab with no `drop` and no `group` lists its cards ungrouped, with nothing to group by, and none of them drags: a card of it lands nowhere", async () => {
        const { container } = mount(jobsPlan(["customers"]), DRAG);
        await settle();
        await openTab(container, "Customers");
        expect(cards(container)).toHaveLength(16);
        expect(heads(container)).toEqual([]);
        expect(within(panel(container)).queryByRole("button", { name: "Group by" })).toBeNull();
        expect(panel(container).querySelector("[data-draggable]")).toBeNull();
    });

    test("a click on a card selects it, a click on another moves the selection, and a click on the selected card lets it go", async () => {
        const { container } = mount(programOf(ex.planPrintWorks), DRAG);
        await settle();
        await openTab(container, "Customers");
        const placed = () => ["Alder & Finch", "Granite Hall"].map((name) => cardNamed(container, name).hasAttribute("data-placed"));
        fireEvent.click(cardNamed(container, "Alder & Finch"));
        await settle();
        expect(placed()).toEqual([true, false]);
        fireEvent.click(cardNamed(container, "Granite Hall"));
        await settle();
        expect(placed()).toEqual([false, true]);
        fireEvent.click(cardNamed(container, "Granite Hall"));
        await settle();
        expect(panel(container).querySelector("[data-placed]")).toBeNull();
    });
});

// ============================================================================
// Empty tabs (PB30)
// ============================================================================

describe("empty tabs (PB30)", () => {
    test("Backlog clear when every event is scheduled, Nothing in an author's tab with no rows, No templates, and No matches naming the search", async () => {
        await h.commit(ex.planPrintJobs, allScheduled());
        await h.commit(ex.planPrintCustomers, new Map() as unknown as Customers);
        const { container } = mount(jobsPlan(["backlog", "customers", "events"]), DRAG);
        await settle();
        expect(tabs(pane(container))).toEqual(["Backlog 0", "Customers 0", "Events 0"]);
        await openTab(container, "Backlog");
        expect(emptyState(container)).toEqual(["Backlog clear", "Every event is scheduled."]);
        await openTab(container, "Customers");
        expect(emptyState(container)).toEqual(["Nothing in Customers", "Customers lists nothing yet."]);
        await openTab(container, "Events");
        expect(emptyState(container)).toEqual(["No templates", "No event kind declares a template to drag in."]);
        cleanup();
        const works = mount(programOf(ex.planPrintWorks), DRAG);
        await settle();
        await openTab(works.container, "Events");
        await search(works.container, "zz");
        expect(emptyState(works.container)).toEqual(["No matches", 'Nothing matches "zz".']);
    });
});

// ============================================================================
// The panes' state (PB25)
// ============================================================================

describe("the panes' state (PB25)", () => {
    test("the library's open tab and collapsed state persist under the Plan's id, and another Plan's are its own", async () => {
        const first = mount(jobsPlan(["events", "backlog"], "ops"), DRAG);
        await settle();
        await openTab(first.container, "Backlog");
        fireEvent.click(within(pane(first.container)).getByRole("button", { name: "Collapse Library" }));
        await settle();
        first.unmount();

        // The same Plan, again: collapsed, and on its Backlog tab once opened.
        const again = mount(jobsPlan(["events", "backlog"], "ops"), DRAG);
        await settle();
        expect(pane(again.container).hasAttribute("data-collapsed")).toBe(true);
        fireEvent.click(within(pane(again.container)).getByRole("button", { name: "Expand Library" }));
        await settle();
        expect(panel(again.container).querySelector("[data-library]")!.getAttribute("data-library")).toBe("plan.library.ops:backlog");
        again.unmount();

        // Another Plan keeps its own.
        const other = mount(jobsPlan(["events", "backlog"], "night"), DRAG);
        await settle();
        expect(pane(other.container).hasAttribute("data-collapsed")).toBe(false);
        expect(panel(other.container).querySelector("[data-library]")!.getAttribute("data-library")).toBe("plan.library.night:events");
    });
});

// ============================================================================
// The Series tab is Pick.Panel's: the old popover's tests (#590)
// ============================================================================

describe("the Series tab over a canvas whose series are picked (#590)", () => {
    /** A `PickBindType` closure — the whole surface the panel consumes. */
    function fakePick(hidden: string[] = [], key = "test.plan.pick") {
        let st = [...hidden];
        return {
            key,
            state: { read: () => st, write: (n: string[]) => { st = n; return null; }, has: () => true },
            items: [
                { id: "a", title: "Press jobs", subtitle: none, icon: none, count: none, narrowed: false },
                { id: "b", title: "Hall load", subtitle: none, icon: none, count: none, narrowed: false },
                { id: "c", title: "Crew shifts", subtitle: none, icon: none, count: none, narrowed: false },
            ],
        };
    }

    /** A line of the Series tab's own, known at build. */
    const own = (id: string, title: string) => ({ id, title, subtitle: none, icon: none, count: none, narrowed: false });

    /** A canvas of one row whose series are picked, with a Series tab listing a kind of its own before the pick and a row after. */
    function renderPicked(pick: ReturnType<typeof fakePick> | { key: string; state: unknown; items: unknown[] }) {
        initializeStore(new UIStore());
        const root = {
            rows: variant("inline", oneBlock([{
                id: rowId("m1"), parent: none,
                gutter: { label: "Row", id: false, sub: none, value: none, meta: none, stacked: false, swatches: [] },
                kind: variant("span", { runs: [], decisions: [], ports: [], rollup: none }),
                collapsed: false, pinned: false, height: none, status: none, expand: none,
            }] as never)),
            links: [],
            axis: variant("time", { window: some({ min: FIRST, max: LAST }), resolution: variant("week", null), resolutions: [], now: none, format: none }),
            grain: none, popover: none, hover: none, expandRender: none, expandGutter: none, pick: some(pick), slice: none, footer: [],
            id: none, sources: [], editing: none, canDrop: none, onSelect: none, onElementClick: none, onGroupToggle: none, onGrainChange: none, ui: none,
            style: none,
        } as unknown as PlanRootValue;
        const library = [variant("series", {
            kinds: [own("events.job", "Print job")],
            rows: [{ item: own("rows.ms", "Milestones"), hides: variant("rows", "ms") }],
        })] as unknown as PlanValue["library"];
        return render(
            <ChakraProvider value={system}>
                <EastChakraPlan value={root} storageKey="plan-picked" library={library} />
            </ChakraProvider>,
        );
    }

    test("the tab lists its own lines with the pick's between them; a toggle writes the pick for its series, the viewer's set for the rest", async () => {
        const pick = fakePick(["c"]);
        const { container } = renderPicked(pick);
        await settle();
        await openTab(container, "Series");
        expect(lines(container)).toEqual([["Print job", true], ["Press jobs", true], ["Hall load", true], ["Crew shifts", false], ["Milestones", true]]);
        await toggle(container, "Press jobs");
        expect(pick.state.read()).toEqual(["c", "a"]);
        expect(localStorage.getItem("plan.series")).toBe(JSON.stringify([]));
        await toggle(container, "Print job");
        expect(pick.state.read()).toEqual(["c", "a"]);
        expect(localStorage.getItem("plan.series")).toBe(JSON.stringify(["events.job"]));
    });

    test("two toggles before the tab draws again compose: the second reads what the first wrote", async () => {
        const pick = fakePick();
        const { container } = renderPicked(pick);
        await settle();
        await openTab(container, "Series");
        // One act: the panel does not draw again between the two clicks.
        act(() => {
            fireEvent.click(within(panel(container)).getByRole("button", { name: "Toggle Print job" }));
            fireEvent.click(within(panel(container)).getByRole("button", { name: "Toggle Milestones" }));
        });
        await settle();
        expect(localStorage.getItem("plan.series")).toBe(JSON.stringify(["events.job", "rows.ms"]));
        expect(lines(container)).toEqual([["Print job", false], ["Press jobs", true], ["Hall load", true], ["Crew shifts", true], ["Milestones", false]]);
    });

    test("the list is searchable, and searching never touches what is hidden", async () => {
        const pick = fakePick();
        const { container } = renderPicked(pick);
        await settle();
        await openTab(container, "Series");
        const box = within(panel(container)).getByLabelText("Search series");
        await act(async () => { fireEvent.change(box, { target: { value: "crew" } }); });
        expect(lines(container).map(([name]) => name)).toEqual(["Crew shifts"]);
        expect(pick.state.read()).toEqual([]);
        await act(async () => { fireEvent.change(box, { target: { value: "zzz" } }); });
        expect(panel(container).querySelector("[data-slot='pickEmpty']")).not.toBeNull();
        fireEvent.click(within(panel(container)).getByRole("button", { name: "Clear search" }));
        await settle();
        expect(lines(container)).toHaveLength(5);
    });

    test("the eyes read the pick again on a write to its store that changes no rows", async () => {
        let hidden: string[] = [];
        const pick = {
            key: "plan.pick.zero-rows",
            state: { read: () => hidden, write: (n: string[]) => { hidden = n; return null; }, has: () => true },
            items: [own("a", "Press jobs"), own("b", "Hall load")],
        };
        const { container } = renderPicked(pick);
        await settle();
        await openTab(container, "Series");
        expect(lines(container)[1]).toEqual(["Press jobs", true]);
        act(() => {
            hidden = ["a"];
            getStore().write("plan.pick.zero-rows", new Uint8Array());
        });
        expect(lines(container)[1]).toEqual(["Press jobs", false]);
    });

    test("two lines sharing an id are one switch — reported, and reconciled correctly", async () => {
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        let st: string[] = [];
        const pick = {
            key: "k",
            state: { read: () => st, write: (n: string[]) => { st = n; return null; }, has: () => true },
            items: [own("dup", "First"), own("dup", "Second")],
        };
        const { container } = renderPicked(pick);
        await settle();
        await openTab(container, "Series");
        expect(lines(container).map(([name]) => name)).toContain("Second");
        expect(err.mock.calls.some((c) => String(c[0]).includes("same key"))).toBe(false);
        expect(err.mock.calls.some((c) => String(c[0]).includes("duplicate item id"))).toBe(true);
        await toggle(container, "First");
        expect(st).toEqual(["dup"]);
        err.mockRestore();
    });
});
