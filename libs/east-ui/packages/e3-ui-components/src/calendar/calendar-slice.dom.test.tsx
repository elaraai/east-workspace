/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * The Calendar follows its rail (#1343) over the operations' records: one
 * `Slice.bindRecords`, a source per event kind, resource kind and templates
 * record. The date window is every event source's range — navigation writes
 * them all, and a range written to one is written to the others; each event
 * kind reads through its own source, in every layout and in the backlog; a
 * resource kind's source narrows its columns, its timeline rows and its
 * Choosers, which keep an event's own; a templates record's narrows the
 * Templates tab, and the source an app's tab names narrows that tab — each
 * tab counting what it shows and saying so, with Clear filters, when the rail
 * leaves it none. A hidden draft still saves to its original key. A window read
 * through interval indexes lands some fifty-five key searches a kind, each
 * re-rendering the window's reader alone, never the frame. A filter change
 * builds nothing again: the Calendar's body runs no more, and no payload is
 * decoded (#1354).
 */
import { describe, expect, test } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateTimeType, OptionType, StringType, printFor, some, variant } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import * as ex from "@elaraai/e3-ui/examples/calendar/calendar";
import { initializePagedApi } from "../platform/index.js";
import { act, calendarHarness, card, event, mount, narrow, narrowing, open, programOf, settle, slot, width, WORKSPACE, type Where } from "./harness.test-utils.js";
import { countBuilds } from "../shared/builds.test-utils.js";
import { setCalendarFrameRenderProbe } from "./index.js";

const h = calendarHarness();
const EX = "calendarOperations";
const text = printFor(StringType), maybeText = printFor(OptionType(StringType));
const time = printFor(DateTimeType), maybeTime = printFor(OptionType(DateTimeType));
const status = printFor(ex.CalendarJobState);
async function press(node: Element | null | undefined) { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await settle(); }
const toolbar = (c: HTMLElement) => within(slot(c, "toolbar"));
const tabs = (c: HTMLElement) => within(slot(c, "start")).getAllByRole("tab").map(t => t.textContent);
const tab = (c: HTMLElement, name: string) => press(within(slot(c, "start")).getAllByRole("tab").find(t => t.textContent!.startsWith(name)));
/** The open tab's panel: every tab's stays mounted, the others hidden. */
const open_ = (c: HTMLElement) => slot(c, "start").querySelector<HTMLElement>("[role=tabpanel]:not([hidden])")!;
/** The open tab's mounted cards: each card's key, and its text. */
const cards = (c: HTMLElement) => [...open_(c).querySelectorAll("[data-library-item]")].map(el => ({ key: el.getAttribute("data-library-item"), text: el.textContent ?? "" }));
const resources = (c: HTMLElement) => [...slot(c, "main").querySelectorAll("[data-calendar-resource-title]")].map(el => el.textContent?.trim());
const values = (field: string, chosen: readonly string[]): Where => new Map([[field, variant("values", [...chosen])]]);
/** A source's window: its half-open range on its start field, as the rail writes it. */
const window = (from: Date, to: Date, optional: boolean) => variant("range", optional
    ? { from: maybeTime(some(from)), to: maybeTime(some(to)) }
    : { from: time(from), to: time(to) });
/** Opens a form's select, reads what it offers, and closes it again. */
async function offered(field: HTMLElement) {
    const trigger = field.querySelector<HTMLElement>("[data-scope=select][data-part=trigger]")!;
    await press(trigger);
    const choices = within(screen.getByRole("listbox")).getAllByRole("option").map(option => option.textContent ?? "");
    await press(trigger);
    return choices.filter(choice => choice !== "Unassigned");
}
/** Picks a form's select option by its words. */
async function choose(field: HTMLElement, label: string) {
    await press(field.querySelector<HTMLElement>("[data-scope=select][data-part=trigger]"));
    await press(within(screen.getByRole("listbox")).getAllByRole("option").find(option => option.textContent === label));
}

describe("the Calendar's one window (#1343)", () => {
    test("navigation writes the window into every event source's range, a range written to one is written to the others, and no range field is a chip of the rail", async () => {
        const { container, store } = await open(ex.calendarOperations);
        for (const [source, optional] of [["job", true], ["service", false], ["shift", false]] as const) {
            expect(narrowing(store, EX, source).get("start")).toEqual(window(new Date("2026-09-28T00:00:00Z"), new Date("2026-10-05T00:00:00Z"), optional));
        }
        await press(toolbar(container).getByRole("button", { name: "Next week" }));
        for (const [source, optional] of [["job", true], ["service", false], ["shift", false]] as const) {
            expect(narrowing(store, EX, source).get("start")).toEqual(window(new Date("2026-10-05T00:00:00Z"), new Date("2026-10-12T00:00:00Z"), optional));
        }
        // The range editor writes the leading source's range — here, as the rail writes it; the others follow, and the view shows those days.
        await narrow(store, EX, "job", new Map([["start", window(new Date("2026-10-02T00:00:00Z"), new Date("2026-10-03T00:00:00Z"), true)]]));
        for (const [source, optional] of [["service", false], ["shift", false]] as const) {
            expect(narrowing(store, EX, source).get("start")).toEqual(window(new Date("2026-10-02T00:00:00Z"), new Date("2026-10-03T00:00:00Z"), optional));
        }
        expect(event(container, "job", "job4")).not.toBeNull();
        expect(event(container, "job", "job1")).toBeNull();
        expect(event(container, "service", "service2")).not.toBeNull();
        // The window is the navigation's: no source's range is a chip; the date picker's Range panel edits the leading source's.
        expect(slot(container, "toolbar").querySelector('[data-record-slice-field="start"]')).toBeNull();
        await press(toolbar(container).getByRole("button", { name: "Choose date" }));
        await press(within(screen.getByRole("dialog")).getByRole("radio", { name: "Range" }));
        expect(screen.getByRole("dialog").querySelector('[data-record-slice-editor="start"][data-record-slice-source="job"]')).not.toBeNull();
    });

    test("the summary names each source a narrowing hides rows of: an event kind's own window holds its count; a source it hides nothing of is not named (#1358)", async () => {
        const { container } = await open(ex.calendarOperations);
        const summary = slot(container, "toolbar").querySelector("[data-record-slices-summary]")!;
        expect(summary.querySelector('[data-record-slice-source="job"]')?.textContent).toBe("6 of 10 production events");
        expect(summary.querySelector('[data-record-slice-source="machines"]')).toBeNull();
        expect(summary.querySelector('[data-record-slice-source="jobTemplates"]')).toBeNull();
    });
});

describe("each source narrows every place its records appear (#1343)", () => {
    test("an event kind's source narrows that kind in every layout and leaves the others; overlaps still read every event", async () => {
        const { container, store } = await open(ex.calendarOperations);
        await narrow(store, EX, "job", values("status", [status(variant("active", null))]));
        expect(event(container, "job", "job1")).not.toBeNull();
        expect(event(container, "job", "job2")).toBeNull();
        expect(event(container, "service", "service1")).not.toBeNull();
        expect(event(container, "shift", "shift1")).not.toBeNull();
        for (const layout of ["Resources", "Timeline"]) {
            await press(toolbar(container).getByRole("radio", { name: layout }));
            expect(event(container, "job", "job1")).not.toBeNull();
            expect(event(container, "job", "job2")).toBeNull();
        }
        await width(390);
        expect(card(container, "job", "job1")).not.toBeNull();
        expect(card(container, "job", "job2")).toBeNull();
    });

    test("a resource kind's source narrows its columns and rows, never an event; a placement's Chooser offers the rows it shows and the event's own", async () => {
        const { container, store } = await open(ex.calendarOperations);
        await narrow(store, EX, "machines", values("area", [text("Press shop")]));
        await press(toolbar(container).getByRole("radio", { name: "Resources" }));
        expect(resources(container)).toEqual(["Press 1", "Press 2", "A. Ash", "B. Birch", "C. Cedar", "Unassigned"]);
        await press(toolbar(container).getByRole("radio", { name: "Timeline" }));
        expect(resources(container)).toEqual(["Press 1", "Press 2", "A. Ash", "B. Birch", "C. Cedar", "Unassigned"]);
        await press(toolbar(container).getByRole("radio", { name: "Calendar" }));
        // job2 runs on Lathe 1, which the rail hides: it still shows, and its Chooser keeps Lathe 1 beside the presses, in the record's key order.
        await press(event(container, "job", "job2"));
        const placement = slot(container, "end").querySelector<HTMLElement>('[data-field="resource"]')!;
        expect(await offered(placement)).toEqual(["Lathe 1 · Machines", "Press 1 · Machines", "Press 2 · Machines"]);
    });

    test("an app's tab follows the source it names, its count `2 of 3`; the people's columns follow it too", async () => {
        const { container, store } = await open(ex.calendarOperations);
        expect(tabs(container)).toEqual(["Templates 6", "Backlog 4", "Technicians 3"]);
        await narrow(store, EX, "people", values("team", [text("Maintenance")]));
        expect(tabs(container)).toEqual(["Templates 6", "Backlog 4", "Technicians 2 of 3"]);
        await tab(container, "Technicians");
        expect(cards(container).map(card => card.key)).toEqual(["ash", "cedar"]);
        await press(toolbar(container).getByRole("radio", { name: "Resources" }));
        expect(resources(container)).toEqual(["Lathe 1", "Lathe 2", "Press 1", "Press 2", "A. Ash", "C. Cedar", "Unassigned"]);
    });

    test("a templates record's source narrows the Templates tab; one it empties says so above the others' cards, and its Clear filters clears it alone", async () => {
        const { container, store } = await open(ex.calendarOperations);
        await narrow(store, EX, "jobTemplates", values("group", [text("Fabrication")]));
        expect(tabs(container)[0]).toBe("Templates 5 of 6");
        await narrow(store, EX, "jobTemplates", new Map());
        await narrow(store, EX, "serviceTemplates", values("group", [text("Nothing")]));
        expect(tabs(container)[0]).toBe("Templates 4 of 6");
        const empty = open_(container).querySelector("[data-library-empty][data-narrowed]")!;
        expect(empty.textContent).toContain("No templates match the filters");
        expect(cards(container)).toHaveLength(4);
        await press(within(empty as HTMLElement).getByRole("button", { name: "Clear filters" }));
        expect(narrowing(store, EX, "serviceTemplates").size).toBe(0);
        expect(tabs(container)[0]).toBe("Templates 6");
    });

    test("the backlog is each kind's own narrowing: it counts what the choices hide, and its Clear filters keeps the window", async () => {
        const { container, store } = await open(ex.calendarOperations);
        const start = narrowing(store, EX, "job").get("start")!;
        await narrow(store, EX, "job", new Map([["machine", variant("values", [maybeText(some("press1"))])], ["start", start]]));
        expect(tabs(container)[1]).toBe("Backlog 1 of 4");
        await tab(container, "Backlog");
        expect(cards(container).map(card => card.text).some(text => text.includes("Torque-test fixtures"))).toBe(true);
        await narrow(store, EX, "job", new Map([["machine", variant("values", [maybeText(some("lathe2"))])], ["start", start]]));
        expect(tabs(container)[1]).toBe("Backlog 0 of 4");
        const empty = open_(container).querySelector("[data-library-empty][data-narrowed]")!;
        expect(empty.textContent).toContain("No backlog events match the filters");
        await press(within(empty as HTMLElement).getByRole("button", { name: "Clear filters" }));
        expect([...narrowing(store, EX, "job").keys()]).toEqual(["start"]);
        expect(narrowing(store, EX, "job").get("start")).toEqual(start);
        expect(tabs(container)[1]).toBe("Backlog 4");
    });

    test("a draft the narrowing hides still saves to its original key, and nothing reads the record whole", async () => {
        const { container, store } = await open(ex.calendarOperations);
        const start = narrowing(store, EX, "job").get("start")!;
        await narrow(store, EX, "job", new Map([["status", variant("values", [status(variant("active", null))])], ["start", start]]));
        await press(event(container, "job", "job1"));
        const user = userEvent.setup();
        const input = slot(container, "end").querySelector<HTMLInputElement>('[data-field="customer"] input')!;
        await user.clear(input); await user.type(input, "Hidden customer{Enter}"); await settle();
        await narrow(store, EX, "job", new Map([["status", variant("values", [status(variant("planned", null))])], ["start", start]]));
        expect(event(container, "job", "job1")).toBeNull();
        await press(toolbar(container).getByRole("button", { name: editingMessages.apply() }));
        // Nothing read the record whole — the test's own read, below, comes after.
        expect(h.paging.reads.paths.filter(path => path === "records.calendar_jobs")).toEqual([]);
        expect(h.read(ex.calendarJobs).get("job1")!.customer).toBe("Hidden customer");
    });
    test("a Save that moves an event out of its kind's narrowing says so in the footer, in that kind's words", async () => {
        const { container, store } = await open(ex.calendarOperations);
        const start = narrowing(store, EX, "job").get("start")!;
        await narrow(store, EX, "job", new Map([["machine", variant("values", [maybeText(some("press1"))])], ["start", start]]));
        await press(event(container, "job", "job1"));
        await choose(slot(container, "end").querySelector<HTMLElement>('[data-field="resource"]')!, "Lathe 2 · Machines");
        await press(toolbar(container).getByRole("button", { name: editingMessages.apply() }));
        await waitFor(() => expect(slot(container, "footer").querySelector("[data-record-save-notice]")?.textContent).toBe("1 production event left this view"));
        expect(h.read(ex.calendarJobs).get("job1")!.machine).toEqual(some("lathe2"));
    });
});

describe("the windowed Calendar's own navigation picks its days (#1343)", () => {
    test("it reads the days through the day index, and selection and Save read by key without downloading the record", async () => {
        const { container } = mount(ex.calendarWindowed); await settle();
        expect(event(container, "job", "job1")).not.toBeNull();
        expect(h.paging.requests.some(request => request.includes("index calendar_jobs_by_day seek 2026-10-01"))).toBe(true);
        await press(toolbar(container).getByRole("button", { name: "Next day" }));
        expect(h.paging.requests.some(request => request.includes("index calendar_jobs_by_day seek 2026-10-02"))).toBe(true);
        expect(event(container, "job", "job1")).toBeNull(); expect(event(container, "job", "job4")).not.toBeNull();
        await width(390); expect(card(container, "job", "job4")).not.toBeNull();
        await width(900);
        await press(toolbar(container).getByRole("button", { name: "Previous day" }));
        await press(event(container, "job", "job1"));
        const input = slot(container, "end").querySelector<HTMLInputElement>('[data-field="customer"] input')!;
        const user = userEvent.setup(); await user.clear(input); await user.type(input, "Scoped customer{Enter}"); await settle();
        await press(toolbar(container).getByRole("button", { name: editingMessages.apply() }));
        expect(h.paging.requests.some(request => request.includes('seek "job1"'))).toBe(true);
        expect(h.paging.reads.paths.filter(path => path === "records.calendar_jobs")).toEqual([]);
        expect(h.read(ex.calendarJobs).get("job1")!.customer).toBe("Scoped customer");
    });
});

describe("a window read through interval indexes re-renders its reader, never the frame (#1343)", () => {
    /** Every key search through an event kind's interval index, held until it is let land, in the order asked. */
    function holdIntervalSearches() {
        const intervals = new Set<string>([ex.calendarJobsByTime.name, ex.calendarServicesByTime.name, ex.calendarShiftsByTime.name]);
        const held: (() => void)[] = [];
        const served = h.paging.api;
        initializePagedApi({ ...served, findKey: (workspace, path, query) => query.index !== undefined && intervals.has(query.index)
            ? new Promise(resolve => { held.push(() => resolve(served.findKey(workspace, path, query))); })
            : served.findKey(workspace, path, query) }, WORKSPACE);
        /** Lets every held search but the last land, one at a time, then the rest. */
        return {
            held,
            async landAllButOne() { while (held.length > 1) { await act(async () => { held.shift()!(); }); } await settle(); },
            async landAll() { while (held.length > 0) { await act(async () => { held.shift()!(); }); await settle(); } },
        };
    }

    test("each of a window's key searches lands without rendering the frame, which renders once they all have — on the first window and on the next with an event selected", async () => {
        const searches = holdIntervalSearches();
        let renders = 0;
        setCalendarFrameRenderProbe(() => { renders += 1; });
        try {
            const { container } = await open(ex.calendarOperations);
            // One start range and the carry-in ranges at each span, for each event kind's window.
            expect(searches.held.length).toBeGreaterThan(3 * 50);
            renders = 0;
            await searches.landAllButOne();
            expect(renders).toBe(0);
            await searches.landAll();
            expect(renders).toBeGreaterThan(0);
            expect(event(container, "job", "job1")).not.toBeNull();
            // With an event selected, the next window's searches render nothing until they have all landed either.
            await press(event(container, "job", "job1"));
            await press(toolbar(container).getByRole("button", { name: "Next week" }));
            expect(searches.held.length).toBeGreaterThan(3 * 50);
            renders = 0;
            await searches.landAllButOne();
            expect(renders).toBe(0);
            await searches.landAll();
            // The next week holds none of the operations' events, and its read has landed.
            expect(event(container, "job", "job1")).toBeNull();
            expect(container.querySelector("[data-calendar-main]")!.getAttribute("aria-busy")).toBe("false");
        } finally {
            setCalendarFrameRenderProbe(undefined);
        }
    });
});

describe("a filter change rebuilds no builder (#1354)", () => {
    test("a choice on the rail, and the window's navigation, build the Calendar no more: the events, the columns and the tabs follow over the payload it mounted with", async () => {
        const builds = countBuilds("Calendar", programOf(ex.calendarOperations));
        const { container, store } = await open(builds.program);
        const mounted = [builds.runs, builds.decodes];
        expect(Math.min(...mounted)).toBeGreaterThan(0);
        // An event kind's source, its window kept.
        const start = narrowing(store, EX, "job").get("start")!;
        await narrow(store, EX, "job", new Map([["status", variant("values", [status(variant("active", null))])], ["start", start]]));
        expect(event(container, "job", "job1")).not.toBeNull();
        expect(event(container, "job", "job2")).toBeNull();
        // A tab's source: its count, and the people's columns.
        await narrow(store, EX, "people", values("team", [text("Maintenance")]));
        expect(tabs(container)[2]).toBe("Technicians 2 of 3");
        // The window, written into every event source's range.
        await press(toolbar(container).getByRole("button", { name: "Next week" }));
        expect(narrowing(store, EX, "service").get("start")).toEqual(window(new Date("2026-10-05T00:00:00Z"), new Date("2026-10-12T00:00:00Z"), false));
        expect([builds.runs, builds.decodes], "no choice and no navigation runs the body again or decodes a payload").toEqual(mounted);
    });
});
