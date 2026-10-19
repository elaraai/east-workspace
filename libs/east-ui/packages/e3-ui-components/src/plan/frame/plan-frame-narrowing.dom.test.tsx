/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Plan follows its rail (#1344) over the print works' records: one
 * `Slice.bindRecords`, a source per event kind it narrows — the jobs and the
 * shifts, each through its interval index — per resource kind, per templates
 * record, and the customers an author's tab names. The window is every event
 * source's range: the toolbar's navigation writes them all, a range written to
 * the leading one is written to the others, and the resolution goes to each.
 * Each source narrows every place its records appear: the jobs' choices their
 * events and their backlog, the Backlog tab counting `N of M` and its Clear
 * filters keeping the window; the presses' their rows and the bulk edit's
 * Chooser, which keeps a selected event's own; a templates record's the Events
 * tab; the customers' the tab that names them — each tab counting what it
 * shows and saying so, with Clear filters, when the rail leaves it none. A Save
 * that moves a job out of its kind's narrowing says so in the footer, and the
 * jobs are never read whole. A source's methods share one descriptor (#1352),
 * and a window read through the interval indexes lands its key searches
 * re-rendering the readers alone, never the frame. That no function holds the
 * whole slice is e3-ui's one guard over every builder's examples (#1356).
 */

import { describe, expect, test } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
    DateTimeType, East, Expr, IRType, OptionType, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, isRef, none, printFor, some, variant,
    type StructType, type ValueTypeOf,
} from "@elaraai/east";
import { EAST_IR_SYMBOL } from "@elaraai/east/internal";
import { RecordSliceBindType, RecordSliceStateType, Slice, type RecordSliceChoiceType } from "@elaraai/east-ui/internal";
import { editingMessages, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { getStore } from "@elaraai/east-ui-components/internal";
import { Data } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-events";
import { initializePagedApi } from "../../platform/index.js";
import { rowKeyOf, type PlanRowId } from "../model.js";
import { WORKSPACE, act, el, entry, mount, planHarness, programOf, rowAt, settle, slot, tabs } from "./harness.test-utils.js";
import { setPlanFrameRenderProbe } from "./index.js";

const h = planHarness();
// A select scrolls its open listbox to the chosen option; jsdom does not scroll.
Element.prototype.scrollTo ??= function scrollTo() { /* jsdom lays nothing out */ };

/** The rail's key: the example's, each source's state kept under `${KEY}.${source}`. */
const KEY = "ex.planPrintWorks";
/** Where a decoded or compiled East function keeps its captured values: the runtime's registered symbol. */
const CAPTURES = Symbol.for("east.captures");
const compareString = compareFor(StringType);
const text = printFor(StringType);
const time = printFor(DateTimeType);
const maybeTime = printFor(OptionType(DateTimeType));
const stockOf = printFor(ex.PrintJob.fields.stock);
const decodeState = decodeBeast2For(RecordSliceStateType);
const encodeState = encodeBeast2For(RecordSliceStateType);
const decodeJobs = decodeBeast2For(ex.planPrintJobs.type);

type Job = ValueTypeOf<typeof ex.PrintJob>;
/** A source's state, as the store keeps it. */
type State = ValueTypeOf<typeof RecordSliceStateType>;
/** A source's narrowing: each field's choice, as the rail writes it. */
type Where = State["where"];
/** One field's choice. */
type Choice = ValueTypeOf<RecordSliceChoiceType>;

/** The print works' four weeks, and the days a test moves its window to. */
const FIRST = new Date("2026-10-05T00:00:00Z");
const LAST = new Date("2026-11-02T00:00:00Z");
const day = (date: string) => new Date(`2026-${date}T00:00:00Z`);

// ── The rail, as the store keeps it ──────────────────────────────────────────

/** A source's state, as the store keeps it. */
const state = (source: string): State => decodeState(getStore().read(`${KEY}.${source}`)!);
/** A source's narrowing. */
const narrowing = (source: string): Where => state(source).where;
/** A narrowing of the choices given, in field order. */
const where = (...choices: readonly (readonly [string, Choice])[]): Where => new SortedMap(choices.map(([field, choice]) => [field, choice] as const), compareString);
/** A choice of a field's values, each as East prints it. */
const values = (...chosen: readonly string[]): Choice => variant("values", [...chosen]);
/** A source's window: its half-open range on its start field, as the rail writes it — an optional field's ends as Options. */
const range = (from: Date, to: Date, optional: boolean): Choice => variant("range", optional
    ? { from: maybeTime(some(from)), to: maybeTime(some(to)) }
    : { from: time(from), to: time(to) });

/** A source's narrowing written whole, as the rail writes it; then the reads and the renders settle. */
async function narrow(source: string, next: Where) {
    await act(async () => { getStore().write(`${KEY}.${source}`, encodeState({ ...state(source), preset: none, where: next })); });
    await settle();
}

// ── The frame's regions, the canvas's rows and the library's tabs ────────────

/** Clicks a control, as a pointer does, and lets what it starts settle. */
async function press(node: Element | null | undefined) {
    expect(node).toBeTruthy();
    await act(async () => {
        fireEvent.mouseDown(node!, { button: 0 });
        fireEvent.click(node!);
    });
    await settle();
}

/** Clicks an event's element, Shift adding it to the selection. */
async function pick(node: Element | null | undefined, add = false) {
    expect(node).toBeTruthy();
    await act(async () => { fireEvent.click(node!, { shiftKey: add }); });
    await settle();
}

const toolbar = (c: HTMLElement) => within(slot(c, "toolbar")!);
/** A press's row of bars, by its hall and its key. */
const pressRow = (hall: string, key: string) => entry("presses.span", hall, key);
/** A crew's row of chips, by its hall and its key. */
const crewRow = (hall: string, key: string) => entry("crews.cards", hall, key);
/** A job's bar on a press's row. */
const bar = (c: HTMLElement, key: string, hall: string, press: string) => c.querySelector<HTMLElement>(`${rowAt(pressRow(hall, press))} ${el("data-run", "job", key)}`);
/** A shift's chip on a crew's row. */
const chip = (c: HTMLElement, key: string, hall: string, crew: string) => c.querySelector<HTMLElement>(`${rowAt(crewRow(hall, crew))} ${el("data-chip", "shift", key)}`);
/** Whether the canvas draws a row. */
const draws = (c: HTMLElement, id: PlanRowId) => slot(c, "main")!.querySelector(rowAt(id)) !== null;
/** Whether the canvas draws a resource kind's group strip, by its group. */
const drawsStrip = (c: HTMLElement, kind: string, group: string) =>
    slot(c, "main")!.querySelector(`[data-plan-group=${JSON.stringify(rowKeyOf(entry(`${kind}.group`, group)))}]`) !== null;

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
/** A card's body: its name and the line under it — the card's block that is not its icon tile. */
const bodyOf = (card: HTMLElement) => [...card.children].find((part) => part.tagName === "DIV" && part.querySelector(":scope > svg") === null)!;
/** The open tab's cards' names, in order. */
const cardNames = (c: HTMLElement) => [...panel(c).querySelectorAll<HTMLElement>("[data-library-item]")].map((card) => bodyOf(card).children[0]!.textContent);
/** The open tab's narrowed empty state, when the rail left it none of what a source narrows: its title and the line under it. */
const narrowedOut = (c: HTMLElement) => {
    const said = panel(c).querySelector<HTMLElement>("[data-library-empty][data-narrowed]");
    if (said === null) return null;
    const title = within(said).getByRole("heading");
    return [title.textContent, title.nextElementSibling?.textContent ?? null];
};
/** Presses the open tab's narrowed empty state's Clear filters. */
const clearFilters = (c: HTMLElement) => press(within(panel(c).querySelector<HTMLElement>("[data-library-empty][data-narrowed]")!).getByRole("button", { name: "Clear filters" }));

/** Opens a form's select, reads what it offers, and closes it again. */
async function offered(field: HTMLElement) {
    const trigger = field.querySelector<HTMLElement>("[data-scope=select][data-part=trigger]")!;
    await press(trigger);
    const choices = within(screen.getByRole("listbox")).getAllByRole("option").map((option) => option.textContent ?? "");
    await press(trigger);
    return choices;
}
/** Picks a form's select option by its words. */
async function choose(field: HTMLElement, label: string) {
    await press(field.querySelector<HTMLElement>("[data-scope=select][data-part=trigger]"));
    await press(within(screen.getByRole("listbox")).getAllByRole("option").find((option) => option.textContent === label));
}

/** The jobs as their record holds them now, read uncounted. */
const storedJobs = () => decodeJobs(h.raw(WORKSPACE, ex.planPrintJobs.path)!) as ReadonlyMap<string, Job>;
/** The jobs' record as e3 names it: what a whole read of it is counted by. */
const JOBS = `records.${ex.planPrintJobs.name}`;

// ============================================================================
// One window (#1344)
// ============================================================================

describe("the Plan's one window (#1344)", () => {
    test("every event source's range holds the window: the toolbar's navigation writes both, a range written to the leading one is followed, and the resolution goes to each — no range is a chip of the rail", async () => {
        const { container } = mount(programOf(ex.planPrintWorks));
        await settle();
        // The axis's four weeks, in the jobs' optional start and the shifts' start alike.
        expect(narrowing("job").get("start")).toEqual(range(FIRST, LAST, true));
        expect(narrowing("shift").get("start")).toEqual(range(FIRST, LAST, false));
        // A day on: both move, keeping the window's twenty-eight days.
        await press(toolbar(container).getByRole("button", { name: "Next day" }));
        expect(narrowing("job").get("start")).toEqual(range(day("10-06"), day("11-03"), true));
        expect(narrowing("shift").get("start")).toEqual(range(day("10-06"), day("11-03"), false));
        // The range editor writes the leading source's range — here, as the rail writes it; the shifts follow, and
        // the canvas draws those days: the magazine run on the 12th and Crew 1's late shift on the 13th, and neither
        // the first week's jobs nor its shifts.
        await narrow("job", where(["start", range(day("10-12"), day("10-19"), true)]));
        expect(narrowing("shift").get("start")).toEqual(range(day("10-12"), day("10-19"), false));
        expect(bar(container, "J-1014", "Hall B", "b1")).not.toBeNull();
        expect(chip(container, "SH-03", "Hall A", "c1")).not.toBeNull();
        expect(bar(container, "J-1001", "Hall A", "a1")).toBeNull();
        expect(chip(container, "SH-01", "Hall A", "c1")).toBeNull();
        // The window is the navigation's: no source's range is a chip; the date picker's Range panel edits the leading source's.
        expect(slot(container, "toolbar")!.querySelector('[data-record-slice-field="start"]')).toBeNull();
        await press(toolbar(container).getByRole("button", { name: "Choose plan dates" }));
        await press(within(screen.getByRole("dialog")).getByRole("radio", { name: "Range" }));
        expect(screen.getByRole("dialog").querySelector('[data-record-slice-editor="start"][data-record-slice-source="job"]')).not.toBeNull();
        await act(async () => { fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }); });
        await settle();
        // The resolution, written to each source holding the window; the window stands.
        await press(toolbar(container).getByText("WEEK"));
        expect(state("job").resolution).toEqual(some(variant("week", null)));
        expect(state("shift").resolution).toEqual(some(variant("week", null)));
        expect(narrowing("shift").get("start")).toEqual(range(day("10-12"), day("10-19"), false));
    });
});

// ============================================================================
// Each source narrows every place its records appear (#1344)
// ============================================================================

describe("each source narrows every place its records appear (#1344)", () => {
    test("the jobs' source narrows their events alone: a stock chosen leaves the other stocks' jobs out, and every shift in", async () => {
        const { container } = mount(programOf(ex.planPrintWorks));
        await settle();
        const start = narrowing("job").get("start")!;
        await narrow("job", where(["start", start], ["stock", values(stockOf(variant("board", null)))]));
        // The menu cards and the box sleeves are on board; the spring catalogue is coated.
        expect(bar(container, "J-1005", "Hall A", "a1")).not.toBeNull();
        expect(bar(container, "J-1022", "Hall B", "b3")).not.toBeNull();
        expect(bar(container, "J-1001", "Hall A", "a1")).toBeNull();
        // The shifts' source narrows nothing: Crew 1's first shift stays.
        expect(chip(container, "SH-01", "Hall A", "c1")).not.toBeNull();
        // The window stands beside the choice.
        expect(narrowing("job").get("start")).toEqual(start);
    });

    test("the presses' source narrows their rows and strips, never the crews'; the bulk edit's Chooser offers the presses it shows and those the selected jobs are on", async () => {
        const { container } = mount(programOf(ex.planPrintWorks));
        await settle();
        await pick(bar(container, "J-1001", "Hall A", "a1"));
        await pick(bar(container, "J-1013", "Hall B", "b1"), true);
        await narrow("presses", where(["hall", values(text("Hall A"))]));
        expect(draws(container, pressRow("Hall A", "a1"))).toBe(true);
        expect(draws(container, pressRow("Hall B", "b1"))).toBe(false);
        expect(drawsStrip(container, "presses", "Hall B")).toBe(false);
        // The crews follow no source: both halls stay.
        expect(drawsStrip(container, "crews", "Hall B")).toBe(true);
        expect(draws(container, crewRow("Hall B", "c3"))).toBe(true);
        // The holiday catalogue runs on Press B1, which the rail hides: the Chooser keeps it beside Hall A's presses,
        // after Unassigned, which takes the jobs off every press.
        const resource = slot(container, "end")!.querySelector<HTMLElement>('[data-inspector-bulk] [data-field="resource"]')!;
        expect(await offered(resource)).toEqual(["Unassigned", "Press A1", "Press A2", "Press A3", "Press B1"]);
    });

    test("the customers' tab follows their source, its count `6 of 16`; one the rail empties says so, and its Clear filters clears that source alone", async () => {
        const { container } = mount(programOf(ex.planPrintWorks));
        await settle();
        expect(tabs(pane(container))).toEqual(["Events 12", "Backlog 8", "Series 15", "Customers 16"]);
        await narrow("customers", where(["district", values(text("Old Town"))]));
        expect(tabs(pane(container))).toEqual(["Events 12", "Backlog 8", "Series 15", "Customers 6 of 16"]);
        await openTab(container, "Customers");
        expect(cardNames(container)).toEqual(["Alder & Finch", "Copperleaf Cafe", "Granite Hall", "Heathfield Theatre", "Larkspur Home", "Orchard Street Market"]);
        await narrow("customers", where(["district", values(text("Nowhere"))]));
        expect(tabs(pane(container))[3]).toBe("Customers 0 of 16");
        expect(narrowedOut(container)).toEqual(["No customers match the filters", "Change or clear the filters to see more customers."]);
        // The jobs keep their window.
        const window = narrowing("job").get("start");
        await clearFilters(container);
        expect(narrowing("customers").size).toBe(0);
        expect(narrowing("job").get("start")).toEqual(window);
        expect(tabs(pane(container))[3]).toBe("Customers 16");
    });

    test("a templates record's source narrows the Events tab: one it empties says so above the other kinds' templates, and its Clear filters clears it alone", async () => {
        const { container } = mount(programOf(ex.planPrintWorks));
        await settle();
        await narrow("jobTemplates", where(["group", values(text("Nothing"))]));
        expect(tabs(pane(container))[0]).toBe("Events 8 of 12");
        await openTab(container, "Events");
        expect(narrowedOut(container)).toEqual(["No templates match the filters", "Change or clear the filters to see more templates."]);
        expect(cardNames(container)).toEqual(["Plate change", "Service", "Early shift", "Late shift", "Night shift", "Job plates", "Fold sections", "Morning delivery"]);
        await narrow("shiftTemplates", where(["group", values(text("Nothing"))]));
        expect(tabs(pane(container))[0]).toBe("Events 5 of 12");
        await clearFilters(container);
        // Both lists the rail emptied, cleared; the others never narrowed.
        expect([narrowing("jobTemplates").size, narrowing("shiftTemplates").size]).toEqual([0, 0]);
        expect(tabs(pane(container))[0]).toBe("Events 12");
    });

    test("the backlog is the jobs' own narrowing: it counts what their choices hide, and its Clear filters keeps the window", async () => {
        const { container } = mount(programOf(ex.planPrintWorks));
        await settle();
        const start = narrowing("job").get("start")!;
        await narrow("job", where(["start", start], ["stock", values(stockOf(variant("board", null)))]));
        expect(tabs(pane(container))[1]).toBe("Backlog 1 of 8");
        await openTab(container, "Backlog");
        expect(cardNames(container)).toEqual(["Spare covers"]);
        // The spare covers scheduled, by another planner: no board job waits.
        const jobs = new Map(ex.planPrintJobs.default as ReadonlyMap<string, Job>);
        jobs.set("J-1029", { ...jobs.get("J-1029")!, start: some(new Date("2026-10-20T06:00:00Z")), end: some(new Date("2026-10-20T08:00:00Z")), press: some("a1") });
        await h.commit(ex.planPrintJobs, jobs);
        expect(tabs(pane(container))[1]).toBe("Backlog 0 of 7");
        expect(narrowedOut(container)).toEqual(["No backlog events match the filters", "Change or clear the filters to see more backlog events."]);
        expect(bar(container, "J-1029", "Hall A", "a1")).not.toBeNull();
        await clearFilters(container);
        expect([...narrowing("job").keys()]).toEqual(["start"]);
        expect(narrowing("job").get("start")).toEqual(start);
        expect(tabs(pane(container))[1]).toBe("Backlog 7");
    });

    test("a Save that moves a job out of its kind's narrowing says so in the footer, and the jobs are never read whole", async () => {
        const { container } = mount(programOf(ex.planPrintWorks));
        await settle();
        const start = narrowing("job").get("start")!;
        await narrow("job", where(["start", start], ["stock", values(stockOf(variant("coated", null)))]));
        // The holiday catalogue, coated, printed on uncoated stock instead.
        await pick(bar(container, "J-1013", "Hall B", "b1"));
        await choose(slot(container, "end")!.querySelector<HTMLElement>("[data-inspector-fields='form'] [data-field='stock']")!, "Uncoated");
        await press(toolbar(container).getByRole("button", { name: editingMessages.apply() }));
        await waitFor(() => expect(slot(container, "footer")!.querySelector("[data-record-save-notice]")?.textContent).toBe("1 print job event left this view"));
        expect(storedJobs().get("J-1013")!.stock).toEqual(variant("uncoated", null));
        expect(bar(container, "J-1013", "Hall B", "b1")).toBeNull();
        expect(h.wholeReads.filter((path) => path === JOBS)).toEqual([]);
    });
});

// ============================================================================
// A source's methods share one descriptor (#1352)
// ============================================================================

describe("a source's methods share one descriptor (#1352)", () => {
    test("a source's methods share one descriptor: a payload writes it once, and a decode makes the one every method reads (#1352)", () => {
        const make = East.function([], undefined, () => Slice.bindRecords(`${KEY}.descriptor`, {
            job: { source: Data.bindPaged(ex.planPrintJobs, { indexes: [ex.planPrintJobsByStockTime] }), fields: { stock: { label: "Stock" } } },
        }));
        const Slices = Expr.type(make).output;
        const platform = getRegisteredPlatformImplementations();
        const made = East.compile(make, platform)();
        const decoded = decodeBeast2For(Slices, { platform })(encodeBeast2For(Slices)(made)) as typeof made;
        type Part = typeof made.sources.job;
        /** Every method of a source, its narrowed data's among them. */
        const methods = (part: Part): unknown[] => [
            ...Object.entries(RecordSliceBindType.fields).filter(([, type]) => type.type === "Function").map(([name]) => (part as Record<string, unknown>)[name]),
            part.pageWhere, part.data.page, part.data.total, part.data.revision, part.data.refresh,
            ...(part.data.seek.type === "some" ? [part.data.seek.value] : []),
        ];
        /** What a function captures, by name. */
        const capturesOf = (fn: unknown) => (fn as Record<symbol, Record<string, variant<"value" | "boxed", unknown>>>)[CAPTURES]!;
        /** The descriptors a source's methods capture. */
        const descriptors = (part: Part) => new Set(methods(part).flatMap((fn) => Object.values(capturesOf(fn)).map((held) => held.value).filter(isRef)));
        expect(methods(decoded.sources.job).length).toBeGreaterThan(20);
        expect(descriptors(made.sources.job).size).toBe(1);
        expect(descriptors(decoded.sources.job).size, "one descriptor, decoded once, read by every method").toBe(1);
        // Written once: the source is its descriptor and its methods' bodies, under four descriptors' worth of bytes, where a
        // descriptor for each method was some twenty-five. The descriptor's type is the one its methods' IR declares.
        const first = methods(made.sources.job)[0];
        const ir = (first as Record<symbol, unknown>)[EAST_IR_SYMBOL] as ValueTypeOf<typeof IRType>;
        if (ir.type !== "Function") throw new Error("a source's method is a function");
        const held = ir.value.captures.find((variable) => isRef(capturesOf(first)[variable.value.name]!.value))!;
        const descriptorBytes = encodeBeast2For(held.value.type, { codec: "none" })(capturesOf(first)[held.value.name]!.value).length;
        const sourceBytes = encodeBeast2For((Slices.fields.sources as StructType).fields.job!, { codec: "none" })(made.sources.job).length;
        expect(sourceBytes).toBeLessThan(4 * descriptorBytes);
    });
});

// ============================================================================
// A window read through interval indexes re-renders its readers, never the frame (#1344)
// ============================================================================

describe("a window read through interval indexes re-renders its readers, never the frame (#1344)", () => {
    /** Every key search through the jobs' and the shifts' interval indexes, held until it is let land, in the order asked. */
    function holdIntervalSearches() {
        const intervals = new Set<string>([ex.planPrintJobsByTime.name, ex.planPrintJobsByStockTime.name, ex.planPrintShiftsByTime.name]);
        const held: (() => void)[] = [];
        const served = h.paging.api;
        initializePagedApi({ ...served, findKey: (workspace, path, query) => query.index !== undefined && intervals.has(query.index)
            ? new Promise((resolve) => { held.push(() => resolve(served.findKey(workspace, path, query))); })
            : served.findKey(workspace, path, query) }, WORKSPACE);
        /** Lets every held search but the last land, one at a time; then the rest. */
        return {
            held,
            async landAllButOne() { while (held.length > 1) { await act(async () => { held.shift()!(); }); } await settle(); },
            async landAll() { while (held.length > 0) { await act(async () => { held.shift()!(); }); await settle(); } },
        };
    }

    test("each of a window's key searches lands without rendering the frame, which renders once they all have — on the first window, and on the next with a job selected", async () => {
        const searches = holdIntervalSearches();
        let renders = 0;
        setPlanFrameRenderProbe(() => { renders += 1; });
        try {
            const { container } = mount(programOf(ex.planPrintWorks));
            await settle();
            // A start range and the carry-in ranges at each span, for the jobs' window and the shifts'.
            expect(searches.held.length).toBeGreaterThan(2 * 50);
            renders = 0;
            await searches.landAllButOne();
            expect(renders).toBe(0);
            await searches.landAll();
            expect(renders).toBeGreaterThan(0);
            expect(bar(container, "J-1001", "Hall A", "a1")).not.toBeNull();
            // With a job selected, the next window's searches render nothing until they have all landed either.
            await pick(bar(container, "J-1001", "Hall A", "a1"));
            await press(toolbar(container).getByRole("button", { name: "Next day" }));
            expect(searches.held.length).toBeGreaterThan(2 * 50);
            renders = 0;
            await searches.landAllButOne();
            expect(renders).toBe(0);
            await searches.landAll();
            expect(renders).toBeGreaterThan(0);
            expect(bar(container, "J-1006", "Hall A", "a2")).not.toBeNull();
        } finally {
            setPlanFrameRenderProbe(undefined);
        }
    });
});
