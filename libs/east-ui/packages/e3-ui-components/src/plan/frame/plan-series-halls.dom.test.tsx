/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A paged resource kind narrowed by its source of the slice (#1344), over the
 * windows example's records on e3 itself (`planSeriesByHall`): the 2,000
 * presses a record paged on the canvas, the rail's `presses` source narrowing
 * them by hall through their hall index, and the jobs on them read a cell at a
 * time through their series index. What each request asked is read from the
 * harness's request log; another planner's write is a real commit.
 *
 * - The canvas opens on the presses a window at a time, never every key the
 *   source shows; a choice pages the narrowing's presses themselves, through
 *   the index — the halls' presses a window at a time, in the index's order —
 *   never the presses whole, and the rail counts them.
 * - The jobs' cells are read for the narrowed presses in view alone, and a
 *   scroll reads the blocks it brings in alone.
 * - A choice changes nothing drawn early: until its first window lands the
 *   last view stands in, retained, and no cell is read for it.
 * - Drafts are the jobs' session's whatever the halls, and Save commits them.
 * - The press at the top of a bounded view keeps its place where the halls
 *   chosen hold it, and the view starts at the top where they do not.
 *
 * An unbounded canvas mounts every row while it holds fewer than 400, so the
 * tests over one — which jsdom lays out — narrow to two halls, 500 presses;
 * a bounded frame's geometry is stubbed, as the persistence tests stub it.
 */

import { describe, test, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import {
    East, OptionType, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, none, parseFor, printFor, some, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { Reactive, RecordSliceStateType, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { editingMessages } from "@elaraai/east-ui-components";
import { getStore } from "@elaraai/east-ui-components/internal";
import { Data, Plan, Record, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-windows";
import type { PrintJob, PrintPress } from "@elaraai/e3-ui/examples/plan/plan-events";
import type { TreePath } from "@elaraai/e3-types";
import type { E3Request } from "../../e3-web.test-utils.js";
import { PLAN_GEOMETRY } from "../geometry.js";
import { rowKeyOf } from "../model.js";
import { emulateWindowScroll } from "../window-scroll.test-utils.js";
import { act, el, entry, planHarness, rowAt, settle, slot } from "./harness.test-utils.js";

const h = planHarness({ "plan/plan-windows": ex });

type Job = ValueTypeOf<typeof PrintJob>;
type Press = ValueTypeOf<typeof PrintPress>;

const FIRST = new Date("2026-10-05T00:00:00Z");
const TWO_WEEKS = new Date("2026-10-19T00:00:00Z");
const NOW = new Date("2026-10-14T09:00:00Z");

/** The rail's key: each source's state kept under `${KEY}.${source}`. */
const KEY = "plan.series.halls.dom";

// ── The records, and what the Plan asks e3 of them ───────────────────────────

/** A dataset's path as e3's requests name it: its fields, joined by dots. */
const pathText = (path: TreePath) => path.map((step) => step.value).join(".");
/** The presses' record and the jobs', as e3's requests name them. */
const PRESSES = pathText(ex.planSeriesPresses.path as TreePath);
const JOBS = pathText(ex.planWindowJobs.path as TreePath);
/** The presses' hall index, and the jobs' series index. */
const BY_HALL = ex.planSeriesPressesByHall;
const SERIES = ex.planWindowJobsByPressWeek;

const text = printFor(StringType);

/**
 * What the presses' record was asked, from its `since`-th request on: each
 * request's kind and the index it reads through — the record's own entries
 * when it names none — a page's window, a search's keys.
 */
const pressesAsked = (since = 0) => h.requests().slice(since).filter((request) => request.dataset === PRESSES && request.kind !== "dataset-status")
    .map((request) => {
        const through = request.query.get("index") ?? "record";
        if (request.kind === "page") return `page ${through} ${request.query.get("offset")}+${request.query.get("limit")}`;
        if (request.kind === "find") return `find ${through} ${request.searches.map((search) => ("key" in search ? search.key : JSON.stringify(search))).join(" ")}`;
        return `${request.kind} ${through}`;
    });

/** Whether a request searches the jobs' series index: a batch of cells' searches. */
const searchesCells = (request: E3Request) => request.dataset === JOBS && request.kind === "find" && request.query.get("index") === SERIES.name;

const parsePress = parseFor(OptionType(StringType));
/**
 * The presses whose cells the jobs' series index was searched for, from the
 * `since`-th request on: each search's last field, the press as the index files
 * it — a search of the jobs on no press names none.
 */
function searchedPresses(since = 0): Set<string> {
    const out = new Set<string>();
    for (const request of h.requests().slice(since).filter(searchesCells)) {
        for (const search of request.searches) {
            const field = "fields" in search ? search.fields.at(-1) : undefined;
            const press = field === undefined ? undefined : parsePress(field);
            if (press?.success === true && press.value.type === "some") out.add(press.value.value);
        }
    }
    return out;
}

/** The presses as e3 holds them, read as another planner would: no request of the Plan's. */
const storedPresses = async () => (await h.read(ex.planSeriesPresses)) as ReadonlyMap<string, Press>;
/** The jobs as e3 holds them now. */
const storedJobs = async () => (await h.read(ex.planWindowJobs)) as ReadonlyMap<string, Job>;

const compareString = compareFor(StringType);
const stringEqual = equalFor(StringType);
/**
 * The keys of the presses of some halls, in the hall index's order: each
 * hall's, in their key order, a hall after the one before it.
 *
 * @param halls - The halls, in the order the index files them
 * @returns The presses' keys
 */
async function pressesOf(...halls: readonly string[]): Promise<string[]> {
    const all = [...(await storedPresses())];
    return halls.flatMap((hall) => all.filter(([, press]) => stringEqual(press.hall, hall)).map(([key]) => key));
}

// ── The rail, as the store keeps it ──────────────────────────────────────────

const decodeState = decodeBeast2For(RecordSliceStateType);
const encodeState = encodeBeast2For(RecordSliceStateType);
type State = ValueTypeOf<typeof RecordSliceStateType>;
/** A source's state, as the store keeps it. */
const state = (source: string): State => decodeState(getStore().read(`${KEY}.${source}`)!);

/**
 * The presses' source narrowed to some halls, written whole as the rail writes
 * it — none, every press.
 *
 * @param halls - The halls chosen
 * @param settled - Whether to let the reads and the renders settle after it
 */
async function chooseHalls(halls: readonly string[], settled = true) {
    const where: State["where"] = new SortedMap(halls.length === 0 ? [] : [["hall", variant("values", halls.map((hall) => text(hall)))] as const], compareString);
    await act(async () => { getStore().write(`${KEY}.presses`, encodeState({ ...state("presses"), preset: none, where })); });
    if (settled) await settle();
}

// ── The Plan ─────────────────────────────────────────────────────────────────

/**
 * The halls example's Plan (`planSeriesByHall`): the presses a record paged on
 * the canvas and narrowed through the rail's `presses` source, by hall; the
 * jobs read a cell at a time through the series index their `job` source lists
 * beside the interval index.
 *
 * @param height - The Plan's declared height, for a bounded frame; unbounded without one
 * @returns The Plan, as an example's program
 */
function hallsPlan(height?: string) {
    return { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const presses = $.const(Data.bindPaged(ex.planSeriesPresses));
        const jobs = $.const(Record.bind(ex.planWindowJobs, [ex.planWindowJobsPatch]));
        const jobEntries = $.const(Data.bindPaged(ex.planWindowJobs));
        const slice = $.const(Slice.bindRecords(KEY, {
            presses: { source: Data.bindPaged(ex.planSeriesPresses, { indexes: [ex.planSeriesPressesByHall] }), fields: { hall: { label: "Hall" } } },
            job: {
                source: Data.bindPaged(ex.planWindowJobs, { indexes: [ex.planWindowJobsByTime, ex.planWindowJobsByPressWeek, ex.planWindowJobsByPressMonth] }),
                fields: { start: { label: "Dates" } }, range: "start",
            },
        }));
        return Plan({
            axis: Plan.axis({ window: { min: FIRST, max: TWO_WEEKS }, resolution: "day", now: NOW }),
            inspector: true, slice: { slice },
            resources: {
                presses: Schedule.resources(presses, { name: "Presses", icon: "print", label: (p) => p.name, sub: (p) => some(p.hall) }),
            },
            events: {
                job: Schedule.events(jobs, {
                    name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                    resource: { field: "press", of: "presses" }, state: "state", quantity: { field: "sheets", unit: "sheets" },
                    backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
                    entries: jobEntries,
                }),
            },
            library: [Plan.library.backlog()],
            ...(height === undefined ? {} : { style: { height } }),
        });
    }))) };
}

// ── What the canvas draws ────────────────────────────────────────────────────

/** A press's row. */
const pressRow = (key: string) => entry("presses.span", key);
/** A job's bar on a press's row. */
const bar = (c: HTMLElement, key: string, press: string) => c.querySelector<HTMLElement>(`${rowAt(pressRow(press))} ${el("data-run", "job", key)}`);
/** A press's row's plot. */
const plot = (c: HTMLElement, press: string) => c.querySelector<HTMLElement>(`${rowAt(pressRow(press))} [data-plan-plot]`);
/** The presses' rows the canvas has mounted, in order, each as its id's text. */
const pressRows = (c: HTMLElement) => [...slot(c, "main")!.querySelectorAll<HTMLElement>("[data-plan-row]")]
    .map((row) => row.getAttribute("data-plan-row")!)
    .filter((id) => id.includes("presses.span"));
/** The ids' texts of some presses' rows, in order. */
const rowsOf = (keys: readonly string[]) => keys.map((key) => rowKeyOf(pressRow(key)));
/** The canvas's body: what retains its rows while a narrowing is read. */
const body = (c: HTMLElement) => slot(c, "main")!.querySelector<HTMLElement>("[data-plan-body]")!;
/** The rail's summary of what its narrowings hide. */
const summary = (c: HTMLElement) => slot(c, "toolbar")!.querySelector("[data-record-slices-summary]")?.textContent ?? null;
/** The footer's loading line. */
const loadingLine = (c: HTMLElement) => slot(c, "footer")!.querySelector<HTMLElement>("[data-footer-line] [data-line-text]")?.textContent ?? null;
/** The footer's count of the changes waiting on Save. */
const pending = (c: HTMLElement) => slot(c, "footer")!.querySelector('[data-plan-count="pending"]')?.textContent ?? null;
/** The inspector's gesture button. */
const action = (c: HTMLElement, name: string) => slot(c, "end")!.querySelector<HTMLButtonElement>(`[data-inspector-action=${JSON.stringify(name)}]`)!;
/** The history item's Save, by the shared messages' words. */
const save = (c: HTMLElement) => within(slot(c, "toolbar")!).getByRole("button", { name: editingMessages.apply() }) as HTMLButtonElement;

/** Clicks a control, as a pointer does, and lets what it starts settle. */
async function press(node: Element) {
    await act(async () => {
        fireEvent.mouseDown(node, { button: 0 });
        fireEvent.click(node);
    });
    await settle();
}

/** A press's row height, at the default density: a two-line gutter, its hall the second line. */
const ROW_PX = PLAN_GEOMETRY.default.rowStacked;

/** What is logged as an error: the Plan's and the paged runtime's say what failed to read. */
let errors: MockInstance<typeof console.error>;

beforeEach(() => {
    errors = vi.spyOn(console, "error");
});
afterEach(() => {
    // Nothing failed to read, not even for a moment: no window, no search, no cell.
    const failed = errors.mock.calls.map((call) => call.map(String).join(" "))
        .filter((line) => line.startsWith("[Plan]") || line.startsWith("Data.bindPaged"));
    errors.mockRestore();
    expect(failed).toEqual([]);
});

// ============================================================================
// The narrowing's presses themselves (#1344)
// ============================================================================

describe("a paged resource kind narrowed by its source (#1344)", () => {
    test("opens on the presses a window at a time as the canvas shows them, never every key the source shows; a choice pages the halls' presses themselves, through the index, in its order — the rail counting them", async () => {
        // The page the unbounded canvas scrolls in, which keeps the row at its top as the rows above it change.
        const restore = emulateWindowScroll();
        try {
            const { container } = await h.mount(hallsPlan());
            await settle();
            // The first windows of the presses' own entries, as the canvas's demand reads them: no scan of every press's key.
            expect(pressesAsked()).toEqual(["page record 0+1", "page record 0+200", "page record 200+200", "page record 400+200"]);
            const opened = h.requests().length;
            await chooseHalls(["Hall 2", "Hall 5"]);
            // The halls' runs of the index searched, then their presses a window at a time — the 500 of them in three, the
            // second across both runs, one request for its two parts — never the record whole, nor a window of every press
            // filtered by key.
            expect(pressesAsked(opened)).toEqual([
                `find ${BY_HALL.name} ${text("Hall 2")} ${text("Hall 5")}`, `page ${BY_HALL.name} 250+200`, `runs ${BY_HALL.name}`, `page ${BY_HALL.name} 1150+100`,
            ]);
            expect(h.requests("read", PRESSES)).toEqual([]);
            // Its rows: Hall 2's presses, then Hall 5's, in the index's order.
            const chosen = await pressesOf("Hall 2", "Hall 5");
            expect(chosen).toHaveLength(500);
            expect(pressRows(container).slice(0, 10)).toEqual(rowsOf(chosen.slice(0, 10)));
            expect(summary(container)).toContain("500 of 2,000 presses");
            // Cleared: every press again, in its key order.
            await chooseHalls([]);
            expect(pressRows(container).slice(0, 3)).toEqual(rowsOf(["P-1001", "P-1002", "P-1003"]));
        } finally {
            restore();
        }
    });

    test("the jobs' cells are read for the narrowed presses in view alone; a scroll into presses further down reads their blocks', never the first's again", async () => {
        const restore = emulateWindowScroll();
        try {
            const { container } = await h.mount(hallsPlan());
            await settle();
            const opened = h.requests().length;
            await chooseHalls(["Hall 2", "Hall 5"]);
            const chosen = await pressesOf("Hall 2", "Hall 5");
            // The first block of the narrowed presses — its fifty first — and no other press.
            await waitFor(() => expect(bar(container, "W-0003", "P-1002")).not.toBeNull());
            const first = searchedPresses(opened);
            expect(first.size).toBeGreaterThan(0);
            expect([...first].every((key) => chosen.slice(0, 50).includes(key))).toBe(true);
            // Down to the hundredth: the blocks around it, the second and the third — none of the first.
            const scrolled = h.requests().length;
            act(() => { window.scrollTo({ top: 100 * ROW_PX }); });
            await waitFor(() => expect(searchedPresses(scrolled).size).toBeGreaterThan(0), { timeout: 10_000 });
            await settle();
            const below = searchedPresses(scrolled);
            expect([...below].every((key) => chosen.slice(50, 150).includes(key))).toBe(true);
            expect([...below].some((key) => chosen.slice(0, 50).includes(key))).toBe(false);
        } finally {
            restore();
        }
    });

    test("a choice changes nothing drawn early: until its first window lands the last view stands in, retained, and no cell is read for it; landed, the cells of the narrowed presses in view are read — none of the presses where the last view's stood", async () => {
        const restore = emulateWindowScroll();
        try {
            const { container } = await h.mount(hallsPlan());
            await settle();
            // Down among the presses from 1141: their rows drawn, their cells read.
            act(() => { window.scrollTo({ top: 140 * ROW_PX }); });
            await waitFor(() => expect(plot(container, "P-1141")).not.toBeNull(), { timeout: 10_000 });
            await waitFor(() => expect(plot(container, "P-1141")!.querySelector("[data-loading-wash]")).toBeNull(), { timeout: 10_000 });
            await settle();
            // Two halls chosen that hold none of those presses, their windows held on their way.
            const windows = h.e3.hold((request) => request.dataset === PRESSES && (request.kind === "page" || request.kind === "runs")
                && request.query.get("index") === BY_HALL.name);
            const asked = h.requests().length;
            await chooseHalls(["Hall 2", "Hall 3"], false);
            await windows.holding;
            await settle();
            // The last view stands in as it was drawn — its rows, their cells — retained, and busy; the line says it filters.
            expect(plot(container, "P-1141")).not.toBeNull();
            expect(plot(container, "P-1141")!.querySelector("[data-loading-wash]")).toBeNull();
            expect(body(container).getAttribute("aria-disabled")).toBe("true");
            expect(slot(container, "main")!.getAttribute("aria-busy")).toBe("true");
            await waitFor(() => expect(loadingLine(container)).toMatch(/^Filtering/));
            expect(h.requests().slice(asked).filter(searchesCells)).toEqual([]);
            // Landed: the halls' rows, live again, where the page is — their hundred and forty-first press on — and the cells
            // of the blocks around them read alone: none of the narrowing's first presses, which no view of it has shown.
            await act(async () => { windows.release(); });
            await settle();
            await waitFor(() => expect(plot(container, "P-1141")).toBeNull());
            expect(body(container).hasAttribute("aria-disabled")).toBe(false);
            const chosen = await pressesOf("Hall 2", "Hall 3");
            await waitFor(() => expect(searchedPresses(asked).size).toBeGreaterThan(0), { timeout: 10_000 });
            await settle();
            expect([...searchedPresses(asked)].every((key) => chosen.slice(100, 200).includes(key))).toBe(true);
        } finally {
            restore();
        }
    });
});

// ============================================================================
// A bounded view: the drafts, and the press at its top (#1344)
// ============================================================================

describe("a bounded view of the narrowed presses (#1344)", () => {
    // Layout stand-ins: a 400px bounded frame over a tall scroll extent, its `scrollTo` moving `scrollTop` as a browser's does.
    const VIEWPORT = 400;
    const frameHeight = (node: Element): number | undefined => (node.getAttribute("data-virtual-rows") === "bounded" ? VIEWPORT : undefined);
    const saved = {
        offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!,
        clientHeight: Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight")!,
        scrollHeight: Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight")!,
        scrollTo: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo"),
    };
    beforeEach(() => {
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get(this: HTMLElement) { return frameHeight(this) ?? 0; } });
        Object.defineProperty(Element.prototype, "clientHeight", { configurable: true, get(this: Element) { return frameHeight(this) ?? 0; } });
        Object.defineProperty(Element.prototype, "scrollHeight", { configurable: true, get(this: Element) { return frameHeight(this) !== undefined ? 10_000_000 : 0; } });
        Object.defineProperty(HTMLElement.prototype, "scrollTo", {
            configurable: true, writable: true,
            value(this: HTMLElement, arg: ScrollToOptions | number) {
                this.scrollTop = typeof arg === "number" ? arg : (arg.top ?? this.scrollTop);
                this.dispatchEvent(new Event("scroll"));
            },
        });
    });
    afterEach(() => {
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", saved.offsetHeight);
        Object.defineProperty(Element.prototype, "clientHeight", saved.clientHeight);
        Object.defineProperty(Element.prototype, "scrollHeight", saved.scrollHeight);
        if (saved.scrollTo !== undefined) Object.defineProperty(HTMLElement.prototype, "scrollTo", saved.scrollTo);
        else delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
    });
    const frameOf = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-virtual-rows="bounded"]')!;
    /** Scrolls the frame and lets the scroll settle: TanStack clears its scrolling flag 150ms after the last scroll event, and only then is a rest reported. */
    async function scrollAndSettle(c: HTMLElement, top: number) {
        const frame = frameOf(c);
        frame.scrollTop = top;
        fireEvent.scroll(frame);
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
        await settle();
    }

    test("drafts are the jobs' session's whatever the hall: jobs moved on presses the next choice hides stay drafted, and Save commits them", async () => {
        const { container: c } = await h.mount(hallsPlan(`${VIEWPORT}px`));
        await settle();
        await chooseHalls(["Hall 2"]);
        // The museum guide on Press 1002 and the menu cards on Press 1010, the hall's first two presses, shifted a day.
        await waitFor(() => expect(bar(c, "W-0006", "P-1010")).not.toBeNull());
        await act(async () => { fireEvent.click(bar(c, "W-0003", "P-1002")!); });
        await settle();
        await act(async () => { fireEvent.click(bar(c, "W-0006", "P-1010")!, { shiftKey: true }); });
        await settle();
        await press(action(c, "shift:1day"));
        expect(pending(c)).toBe("2 pending");
        // Hall 3 chosen: both presses go; the drafts stay.
        await chooseHalls(["Hall 3"]);
        expect(plot(c, "P-1002")).toBeNull();
        expect(pressRows(c)[0]).toBe(rowKeyOf(pressRow("P-1003")));
        expect(pending(c)).toBe("2 pending");
        // Saved through the jobs' patch door, as drafted.
        await press(save(c));
        await waitFor(() => expect(pending(c)).toBe("0 pending"));
        const jobs = await storedJobs();
        expect(jobs.get("W-0003")!.start).toEqual(some(new Date("2026-10-07T06:00:00Z")));
        expect(jobs.get("W-0006")!.start).toEqual(some(new Date("2026-10-15T06:00:00Z")));
        // Back to Hall 2: the guide where it was saved.
        await chooseHalls(["Hall 2"]);
        await waitFor(() => expect(bar(c, "W-0003", "P-1002")?.getAttribute("aria-label")).toMatch(/^Museum guide, Oct 7, 2026, 06:00/));
    });

    test("the press at its top keeps its place by its key where the hall chosen holds it — the press and the px into it — and the view starts at the top where it does not", async () => {
        const { container: c } = await h.mount(hallsPlan(`${VIEWPORT}px`));
        await settle();
        // Ten px into Press 1201, the two hundred and first press — the first of the second window.
        await scrollAndSettle(c, 200 * ROW_PX + 10);
        await waitFor(() => expect(plot(c, "P-1201")).not.toBeNull());
        await scrollAndSettle(c, 200 * ROW_PX + 10);
        expect(frameOf(c).scrollTop).toBe(200 * ROW_PX + 10);
        // Hall 1 holds it, its twenty-sixth press: put back where it was, ten px into it.
        expect((await pressesOf("Hall 1")).indexOf("P-1201")).toBe(25);
        await chooseHalls(["Hall 1"]);
        await waitFor(() => expect(frameOf(c).scrollTop).toBe(25 * ROW_PX + 10));
        expect(plot(c, "P-1201")).not.toBeNull();
        await scrollAndSettle(c, 25 * ROW_PX + 10);
        // Hall 2 holds none of it: the view starts at the top, at the hall's first press.
        await chooseHalls(["Hall 2"]);
        await waitFor(() => expect(frameOf(c).scrollTop).toBe(0));
        expect(pressRows(c)[0]).toBe(rowKeyOf(pressRow("P-1002")));
    });
});
