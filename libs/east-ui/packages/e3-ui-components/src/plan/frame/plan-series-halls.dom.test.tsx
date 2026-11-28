/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Plan's rows paged and narrowed by the rail's `rows` source (#1344,
 * #1541), over the windows example's records on e3 itself
 * (`planSeriesByHall`): the 2,000 presses a record paged on the canvas, each a
 * row of a resources series, the `rows` source narrowing them by hall through
 * their hall index, and the jobs on them read a cell at a time through their
 * series index. What each request asked is read from the
 * harness's request log; another planner's write is a real commit.
 *
 * - The canvas opens on the presses a window at a time, never every key the
 *   source shows; a choice pages the narrowing's presses themselves, through
 *   the index — the halls' presses a window at a time, in the index's order —
 *   never the presses whole, and the rail counts them.
 * - The jobs' cells are read for the narrowed presses in view alone, and a
 *   scroll reads the block it brings in and the next the way it went (#1797);
 *   it places those blocks' jobs alone, and back up places none (#1793) — but
 *   after a commit, which lets go of the blocks the view left, or past what
 *   the reader keeps of them: their rows are read and placed again.
 * - A choice changes nothing drawn early: until its first window lands the
 *   last view stands in, retained, and no cell is read for it.
 * - Drafts are the jobs' session's whatever the halls, and Save commits them.
 * - A hall chosen builds the Plan no more (#1354), and the bulk edit's Chooser
 *   offers the presses the selected jobs are on, by their names, whether the
 *   hall chosen shows them or not.
 * - The press at the top of a bounded view keeps its place where the halls
 *   chosen hold it, and the view starts at the top where they do not.
 *
 * An unbounded canvas mounts every row while it holds fewer than 400, so the
 * tests over one — which jsdom lays out — narrow to two halls, 500 presses;
 * a bounded frame's geometry is stubbed, as the persistence tests stub it.
 */

import { describe, test, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
    DateTimeType, East, OptionType, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, none, parseFor, printFor, some, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { Reactive, RecordSliceStateType, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { editingMessages } from "@elaraai/east-ui-components";
import { getStore } from "@elaraai/east-ui-components/internal";
import { Data, Plan, Record, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-windows";
import { PrintPress, type PrintJob } from "@elaraai/e3-ui/examples/plan/plan-events";
import type { TreePath } from "@elaraai/e3-types";
import type { E3Request } from "../../e3-web.test-utils.js";
import { width } from "../../e3-web-mount.test-utils.js";
import { PLAN_GEOMETRY } from "../geometry.js";
import { rowKeyOf } from "../model.js";
import { emulateWindowScroll } from "../window-scroll.test-utils.js";
import { setBlockPlacedProbe } from "../root/events.js";
import { cellRowsHeld } from "../../shared/schedule/cell-rows.js";
import { countBuilds } from "../../shared/builds.test-utils.js";
import { act, el, entry, planHarness, programOf, rowAt, settle, slot } from "./harness.test-utils.js";

const h = planHarness({ "plan/plan-windows": ex });

/**
 * What the reader keeps of the spans a view has left (#1797), weighed as a test asks: by its own rule — but, `heavy`, a
 * span holding an event weighs past the cap, so the reader lets go of every such span the view leaves (#1793). The
 * windows example's jobs are too few to fill what it keeps.
 */
const keptWeight = vi.hoisted(() => ({ heavy: false }));
vi.mock("../../shared/schedule/kept-spans.js", async (importOriginal) => {
    const own = await importOriginal<typeof import("../../shared/schedule/kept-spans.js")>();
    return {
        ...own,
        scheduleSpansKept: <S,>(unwanted: readonly (readonly [string, S])[], entries: (span: S) => number) =>
            own.scheduleSpansKept(unwanted, keptWeight.heavy ? (span: S) => (entries(span) > 0 ? Number.POSITIVE_INFINITY : 0) : entries),
    };
});

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
const BY_HALL = ex.planSeriesPresses.indexes.plan_series_presses_by_hall;
const SERIES = ex.planWindowJobs.indexes.plan_window_jobs_by_press_week;

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
 * `since`-th request on: each search a range a press a level (#1433), from
 * `[press, level, tile]` — the press as the index files it; a search of the
 * jobs on no press names none.
 */
function searchedPresses(since = 0): Set<string> {
    const out = new Set<string>();
    for (const request of h.requests().slice(since).filter(searchesCells)) {
        for (const search of request.searches) {
            const field = "from" in search ? search.from?.at(-3) : undefined;
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
 * The rows' source — the presses — narrowed to some halls, written whole as
 * the rail writes it — none, every press.
 *
 * @param halls - The halls chosen
 * @param settled - Whether to let the reads and the renders settle after it
 */
async function chooseHalls(halls: readonly string[], settled = true) {
    const where: State["where"] = new SortedMap(halls.length === 0 ? [] : [["hall", variant("values", halls.map((hall) => text(hall)))] as const], compareString);
    await act(async () => { getStore().write(`${KEY}.rows`, encodeState({ ...state("rows"), preset: none, where })); });
    if (settled) await settle();
}

// ── The Plan ─────────────────────────────────────────────────────────────────

/**
 * The halls example's Plan (`planSeriesByHall`): the presses a record paged on
 * the canvas as its rows, through the rail's `rows` source — a resources series
 * a row each — and narrowed by hall; the jobs read a cell at a time through the
 * series index their `job` source lists beside the interval index.
 *
 * @param height - The Plan's declared height, for a bounded frame; unbounded without one
 * @returns The Plan, as an example's program
 */
function hallsPlan(height?: string) {
    return { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const jobs = $.const(Record.bind(ex.planWindowJobs, ["patch"]));
        const jobEntries = $.const(Data.bindPaged(ex.planWindowJobs));
        const slice = $.const(Slice.bindRecords(KEY, {
            // The canvas's rows: the presses, paged through the narrowing, counted as the rail counts them.
            rows: { source: Data.bindPaged(ex.planSeriesPresses, { indexes: ["plan_series_presses_by_hall"] }), label: "Presses", fields: { hall: { label: "Hall" } } },
            job: {
                source: Data.bindPaged(ex.planWindowJobs, { indexes: ["plan_window_jobs_by_time", "plan_window_jobs_by_press_week", "plan_window_jobs_by_press_month"] }),
                fields: { start: { label: "Dates" } }, range: "start",
            },
        }));
        return Plan({
            axis: Plan.axis({ window: { min: FIRST, max: TWO_WEEKS }, resolution: "day", now: NOW }),
            inspector: true, slice: { slice },
            // Its rows are presses, in the Plan's word for them: what the rail counts and the footer's line names.
            vocabulary: { rows: { one: "Press", other: "Presses" } },
            series: [Plan.series.resources(PrintPress, { key: "presses", title: "Presses", icon: "print", label: (p) => p.name, sub: (p) => some(p.hall) })],
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

/** A press's row: its own, which its jobs draw on. */
const pressRow = (key: string) => entry("presses", key);
/** A job's bar on a press's row. */
const bar = (c: HTMLElement, key: string, press: string) => c.querySelector<HTMLElement>(`${rowAt(pressRow(press))} ${el("data-run", "job", key)}`);
/** A press's row's plot. */
const plot = (c: HTMLElement, press: string) => c.querySelector<HTMLElement>(`${rowAt(pressRow(press))} [data-plan-plot]`);
/** The presses' rows the canvas has mounted, in order, each as its id's text: the rows of the `presses` series. */
const pressRows = (c: HTMLElement) => [...slot(c, "main")!.querySelectorAll<HTMLElement>("[data-plan-row]")]
    .map((row) => row.getAttribute("data-plan-row")!)
    .filter((id) => id.includes('series="presses"'));
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

/** Opens a form's select, reads what it offers, and closes it again. */
async function offered(field: HTMLElement) {
    const trigger = field.querySelector<HTMLElement>("[data-scope=select][data-part=trigger]")!;
    await press(trigger);
    const choices = within(screen.getByRole("listbox")).getAllByRole("option").map((option) => option.textContent ?? "");
    await press(trigger);
    return choices;
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

describe("the presses, the Plan's rows, paged and narrowed by its rows source (#1344)", () => {
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

    test("the jobs' cells are read for the narrowed presses in view alone; a scroll into presses further down reads their block's and the next one down's, never those above them (#1797)", async () => {
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
            // Down to the hundredth: the block its rows meet, the third, and the next one down, the fourth, the way the view
            // went — every press of the two, and none of the two above them, which a view going down is not headed for.
            const scrolled = h.requests().length;
            act(() => { window.scrollTo({ top: 100 * ROW_PX }); });
            await waitFor(() => expect(searchedPresses(scrolled).size).toBeGreaterThan(0), { timeout: 10_000 });
            await settle();
            expect(searchedPresses(scrolled)).toEqual(new Set(chosen.slice(100, 200)));
        } finally {
            restore();
        }
    });

    test("a scroll places the jobs of the blocks it brings in, each once, and nothing of those it leaves; back up places nothing — the block it left kept — and every job in view draws once (#1793)", async () => {
        const restore = emulateWindowScroll();
        // Each block of the jobs' rows placed, by its handle.
        const placed: string[] = [];
        setBlockPlacedProbe((kind, handle) => { placed.push(`${kind} ${handle}`); });
        /** The jobs' bars the canvas draws, by their keys: each event once. */
        const drawnJobs = (c: HTMLElement) => [...slot(c, "main")!.querySelectorAll("[data-run]")].map((run) => run.getAttribute("data-run")!);
        try {
            const { container } = await h.mount(hallsPlan());
            await settle();
            // The halls chosen: the first block of their presses, placed once.
            placed.splice(0);
            await chooseHalls(["Hall 2", "Hall 5"]);
            const chosen = await pressesOf("Hall 2", "Hall 5");
            await waitFor(() => expect(bar(container, "W-0003", "P-1002")).not.toBeNull());
            await settle();
            const opened = placed.splice(0);
            expect(opened).toHaveLength(1);
            // Down to the hundredth press: its block and the next one down, placed once each — the block the view left, none.
            const scrolled = h.requests().length;
            act(() => { window.scrollTo({ top: 100 * ROW_PX }); });
            await waitFor(() => expect(searchedPresses(scrolled).size).toBeGreaterThan(0), { timeout: 10_000 });
            await settle();
            expect(searchedPresses(scrolled)).toEqual(new Set(chosen.slice(100, 200)));
            const down = placed.splice(0);
            expect([down.length, new Set(down).size, down.some((one) => opened.includes(one))]).toEqual([2, 2, false]);
            const jobs = drawnJobs(container);
            expect(new Set(jobs).size).toBe(jobs.length);
            // Back up to the top: the first block, which the reader kept, placed again for none — and nothing read.
            const back = h.requests().length;
            act(() => { window.scrollTo({ top: 0 }); });
            await waitFor(() => expect(bar(container, "W-0003", "P-1002")).not.toBeNull(), { timeout: 10_000 });
            await settle();
            expect([placed, searchedPresses(back).size]).toEqual([[], 0]);
            const again = drawnJobs(container);
            expect(again.length).toBeGreaterThan(0);
            expect(new Set(again).size).toBe(again.length);
        } finally {
            setBlockPlacedProbe(undefined);
            restore();
        }
    });

    test("a commit lets go of the blocks the view has left: the blocks in view are placed again at its revision, and back up, the first block's rows are read again and placed under a handle of their own (#1793)", async () => {
        const restore = emulateWindowScroll();
        const placed: string[] = [];
        setBlockPlacedProbe((kind, handle) => { placed.push(`${kind} ${handle}`); });
        try {
            const { container } = await h.mount(hallsPlan());
            await settle();
            placed.splice(0);
            await chooseHalls(["Hall 2", "Hall 5"]);
            await waitFor(() => expect(bar(container, "W-0003", "P-1002")).not.toBeNull());
            await settle();
            const opened = placed.splice(0);
            // Down to the hundredth press: its block and the next one down placed, the first block kept as the view left it.
            const scrolled = h.requests().length;
            act(() => { window.scrollTo({ top: 100 * ROW_PX }); });
            await waitFor(() => expect(searchedPresses(scrolled).size).toBeGreaterThan(0), { timeout: 10_000 });
            await settle();
            const down = placed.splice(0);
            expect(down).toHaveLength(2);
            // Another planner's write: the jobs' record moves on, and the reader reads the blocks in view again at its revision —
            // two placings, under handles of their own — and lets go of what the view left, kept at the revision before.
            const jobs = await storedJobs();
            await h.commit(ex.planWindowJobs, new Map([...jobs].map(([key, job]): [string, Job] => [key, stringEqual(key, "W-0014") ? { ...job, sheets: 30_000 } : job])));
            await waitFor(() => expect(placed).toHaveLength(2), { timeout: 10_000 });
            await settle();
            const committed = placed.splice(0);
            expect(committed.some((one) => down.includes(one))).toBe(false);
            // Back up to the top: the first block's cells searched again, and its jobs placed under a handle never placed before.
            const back = h.requests().length;
            act(() => { window.scrollTo({ top: 0 }); });
            await waitFor(() => expect(bar(container, "W-0003", "P-1002")).not.toBeNull(), { timeout: 10_000 });
            await waitFor(() => expect(placed.length).toBeGreaterThan(0), { timeout: 10_000 });
            await settle();
            expect(searchedPresses(back).size).toBeGreaterThan(0);
            expect(placed.filter((one) => [...opened, ...down, ...committed].includes(one))).toEqual([]);
        } finally {
            setBlockPlacedProbe(undefined);
            restore();
        }
    });

    test("a block the view has left past what the reader keeps is let go of: back to it, its rows are read again and placed under a handle of their own, each job drawn once — and the rows it held let go (#1793)", async () => {
        const restore = emulateWindowScroll();
        const placed: string[] = [];
        setBlockPlacedProbe((kind, handle) => { placed.push(`${kind} ${handle}`); });
        // Every span holding a job weighs past the cap: the reader keeps none of them once the view leaves it.
        keptWeight.heavy = true;
        try {
            const { container } = await h.mount(hallsPlan());
            await settle();
            placed.splice(0);
            await chooseHalls(["Hall 2", "Hall 5"]);
            await waitFor(() => expect(bar(container, "W-0003", "P-1002")).not.toBeNull());
            await settle();
            const opened = placed.splice(0);
            expect(opened).toHaveLength(1);
            // Down to the hundredth press: the first block's spans holding its jobs let go of as the view leaves them.
            const scrolled = h.requests().length;
            act(() => { window.scrollTo({ top: 100 * ROW_PX }); });
            await waitFor(() => expect(searchedPresses(scrolled).size).toBeGreaterThan(0), { timeout: 10_000 });
            await settle();
            placed.splice(0);
            // Back up to the top: the first block's rows read again — the page answering from what it read before — and its jobs
            // placed under a handle never placed before.
            act(() => { window.scrollTo({ top: 0 }); });
            await waitFor(() => expect(placed.length).toBeGreaterThan(0), { timeout: 10_000 });
            await waitFor(() => expect(bar(container, "W-0003", "P-1002")).not.toBeNull(), { timeout: 10_000 });
            await settle();
            expect(placed.filter((one) => opened.includes(one))).toEqual([]);
            const jobs = [...slot(container, "main")!.querySelectorAll("[data-run]")].map((run) => run.getAttribute("data-run")!);
            expect(new Set(jobs).size).toBe(jobs.length);
            // Down again, past the reads the reader keeps the rows of: the block let go of holds its rows no more.
            const handle = opened[0]!.slice(opened[0]!.indexOf(" ") + 1);
            act(() => { window.scrollTo({ top: 100 * ROW_PX }); });
            await waitFor(() => expect(cellRowsHeld(handle)).toBe(false), { timeout: 10_000 });
        } finally {
            keptWeight.heavy = false;
            setBlockPlacedProbe(undefined);
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
            await waitFor(() => expect(plot(container, "P-1141")!.querySelector("[data-loading-bar]")).toBeNull(), { timeout: 10_000 });
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
            expect(plot(container, "P-1141")!.querySelector("[data-loading-bar]")).toBeNull();
            expect(body(container).getAttribute("aria-disabled")).toBe("true");
            expect(slot(container, "main")!.getAttribute("aria-busy")).toBe("true");
            await waitFor(() => expect(loadingLine(container)).toMatch(/^Filtering/));
            expect(h.requests().slice(asked).filter(searchesCells)).toEqual([]);
            // Landed: the halls' rows, live again, where the page is — their hundred and forty-first press on — and the cells
            // of the blocks their rows meet read alone: none of the narrowing's first presses, which no view of it has shown,
            // and no block past them, a narrowing's first view having gone no way (#1797).
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

    test("a hall chosen, and the window's navigation, build the Plan no more: the presses follow over the payload it mounted with (#1354)", async () => {
        const builds = countBuilds("Plan", programOf(hallsPlan(`${VIEWPORT}px`)));
        try {
            const { container: c } = await h.mount(hallsPlan(`${VIEWPORT}px`), { program: builds.program });
            await settle();
            const mounted = [builds.runs, builds.decodes];
            expect(Math.min(...mounted)).toBeGreaterThan(0);
            // The rows' source: Hall 2's presses, then Hall 3's.
            await chooseHalls(["Hall 2"]);
            await waitFor(() => expect(pressRows(c)[0]).toBe(rowKeyOf(pressRow("P-1002"))));
            await chooseHalls(["Hall 3"]);
            await waitFor(() => expect(pressRows(c)[0]).toBe(rowKeyOf(pressRow("P-1003"))));
            // The window its own fortnight on, written into the jobs' source's range — their start an Option, as the rail prints it.
            await press(within(slot(c, "toolbar")!).getByRole("button", { name: "Next 14 days" }));
            const maybeTime = printFor(OptionType(DateTimeType));
            expect(state("job").where.get("start")).toEqual(variant("range", {
                from: maybeTime(some(new Date("2026-10-19T00:00:00Z"))), to: maybeTime(some(new Date("2026-11-02T00:00:00Z"))),
            }));
            expect([builds.runs, builds.decodes], "no choice and no navigation runs the body again or decodes a payload").toEqual(mounted);
        } finally {
            builds.restore();
        }
    });

    test("the bulk edit's Chooser offers the presses the selected jobs are on, each by its name — never the hall's other presses, which the canvas holds a page at a time — and still names them once the next hall chosen hides them (#1541)", async () => {
        const { container: c } = await h.mount(hallsPlan(`${VIEWPORT}px`));
        await settle();
        await chooseHalls(["Hall 2"]);
        // The museum guide on Press 1002 and the menu cards on Press 1010, the hall's first two presses, selected.
        await waitFor(() => expect(bar(c, "W-0006", "P-1010")).not.toBeNull());
        await act(async () => { fireEvent.click(bar(c, "W-0003", "P-1002")!); });
        await settle();
        await act(async () => { fireEvent.click(bar(c, "W-0006", "P-1010")!, { shiftKey: true }); });
        await settle();
        const chooser = () => slot(c, "end")!.querySelector<HTMLElement>('[data-inspector-bulk] [data-field="resource"]')!;
        // After Unassigned, which takes the jobs off every press.
        expect(await offered(chooser())).toEqual(["Unassigned", "Press 1002", "Press 1010"]);
        // Hall 3 chosen: both presses leave the canvas, and the Chooser still names them.
        await chooseHalls(["Hall 3"]);
        expect([plot(c, "P-1002"), plot(c, "P-1010")]).toEqual([null, null]);
        expect(await offered(chooser())).toEqual(["Unassigned", "Press 1002", "Press 1010"]);
    });

    test("while a choice's first window is read the presses shown stand in, retained, and take no write by any route: the inspector's edits are off and Delete takes nothing, until the window lands (#1398, CL8)", async () => {
        const { container: c } = await h.mount(hallsPlan(`${VIEWPORT}px`));
        await settle();
        await chooseHalls(["Hall 2"]);
        await waitFor(() => expect(bar(c, "W-0003", "P-1002")).not.toBeNull());
        await act(async () => { fireEvent.click(bar(c, "W-0003", "P-1002")!); });
        await settle();
        const edits = () => slot(c, "end")!.querySelector<HTMLFieldSetElement>("[data-inspector-edits]")!;
        await waitFor(() => expect(edits()).not.toBeNull());
        expect(edits().disabled).toBe(false);
        // Hall 4 chosen, its windows held on their way: Hall 2's presses stand in, retained.
        const windows = h.e3.hold((request) => request.dataset === PRESSES && (request.kind === "page" || request.kind === "runs")
            && request.query.get("index") === BY_HALL.name);
        await chooseHalls(["Hall 4"], false);
        await windows.holding;
        await settle();
        expect(body(c).getAttribute("aria-disabled")).toBe("true");
        expect(edits().disabled).toBe(true);
        await act(async () => { fireEvent.keyDown(bar(c, "W-0003", "P-1002")!, { key: "Delete" }); });
        await settle();
        expect([bar(c, "W-0003", "P-1002") !== null, pending(c)]).toEqual([true, "0 pending"]);
        // Landed: the presses live again, and the inspector's edits with them.
        await act(async () => { windows.release(); });
        await settle();
        await waitFor(() => expect(body(c).hasAttribute("aria-disabled")).toBe(false));
        await waitFor(() => expect(edits().disabled).toBe(false));
    });

    test("the view waits for the presses it shows once: from the window under it to the jobs' cells its rows are drawn from, main busy throughout — never idle between the two reads, so the line's reveal clock sees one wait (#1398, CL3)", async () => {
        const { container: c } = await h.mount(hallsPlan(`${VIEWPORT}px`));
        await settle();
        const main = slot(c, "main")!;
        expect(main.getAttribute("aria-busy")).not.toBe("true");
        // The presses' windows and the jobs' cells held on their way: a window the view shows, then the cells of its rows.
        const windows = h.e3.hold((request) => request.dataset === PRESSES && request.kind === "page");
        const cells = h.e3.hold(searchesCells);
        // Every value main's busy takes from here on, each commit's: what each change left behind, then what it says last.
        const said: (string | null)[] = [];
        const observer = new MutationObserver((records) => { for (const record of records) said.push(record.oldValue); });
        observer.observe(main, { attributes: true, attributeFilter: ["aria-busy"], attributeOldValue: true });
        // Far down among presses the canvas has not read: once the scroll rests, the window under it is asked.
        await scrollAndSettle(c, 1500 * ROW_PX);
        await windows.holding;
        expect(main.getAttribute("aria-busy")).toBe("true");
        // The window lands: its presses drawn, their jobs' cells asked for the rows in view — and held.
        await act(async () => { windows.release(); });
        await settle();
        await cells.holding;
        expect(main.getAttribute("aria-busy")).toBe("true");
        // The cells land: the presses in view drawn whole, and nothing waited for.
        await act(async () => { cells.release(); });
        await settle();
        await waitFor(() => expect(main.getAttribute("aria-busy")).not.toBe("true"));
        observer.disconnect();
        said.push(main.getAttribute("aria-busy"));
        // Idle, then busy from the window's read until its rows' cells landed, once — never idle between them — then idle.
        expect(said.map((busy) => busy === "true").filter((busy, i, all) => i === 0 || busy !== all[i - 1])).toEqual([false, true, false]);
    });

    test("the line names the presses the view waits for as the rail counts them — `Loading presses 1,201–2,000` — never as rows (#1398, CL3)", async () => {
        const { container: c } = await h.mount(hallsPlan(`${VIEWPORT}px`));
        await settle();
        const windows = h.e3.hold((request) => request.dataset === PRESSES && request.kind === "page");
        await scrollAndSettle(c, 1500 * ROW_PX);
        await windows.holding;
        await waitFor(() => expect(loadingLine(c)).toBe("Loading presses 1,201–2,000"));
        await act(async () => { windows.release(); });
        await settle();
    });

    test("what the canvas's view waited for goes with it as the Plan narrows: the narrow list waits on what it reads alone, so once the window lands the line is idle and main no longer busy (#1398, CL3)", async () => {
        const { container: c } = await h.mount(hallsPlan(`${VIEWPORT}px`));
        await settle();
        const main = slot(c, "main")!;
        // Far down among presses not read, their windows held: the view rests over the run that stands for them, and waits.
        const windows = h.e3.hold((request) => request.dataset === PRESSES && request.kind === "page");
        await scrollAndSettle(c, 1500 * ROW_PX);
        await windows.holding;
        expect(main.getAttribute("aria-busy")).toBe("true");
        // The Plan's box narrowed to a phone's, as a resize does: the narrow list in the canvas's place.
        const realRect = Element.prototype.getBoundingClientRect;
        vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
            return this.hasAttribute("data-plan-body")
                ? { x: 0, y: 0, top: 0, left: 0, right: 360, bottom: VIEWPORT, width: 360, height: VIEWPORT, toJSON() {} } as DOMRect
                : realRect.call(this);
        });
        await width(360);
        expect(body(c).hasAttribute("data-plan-narrow")).toBe(true);
        // The windows land: nothing the list shows is read any longer — the line idle, main not busy.
        await act(async () => { windows.release(); });
        await settle();
        await waitFor(() => expect(main.getAttribute("aria-busy")).not.toBe("true"), { timeout: 10_000 });
        expect(slot(c, "footer")!.querySelector("[data-footer-line]")!.hasAttribute("data-idle")).toBe(true);
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

    test("a view resting over presses not read yet holds no press at its top: a hall chosen then starts the view at the top — never in the run the new rows end with, where the last rested (#1398)", async () => {
        const { container: c } = await h.mount(hallsPlan(`${VIEWPORT}px`));
        await settle();
        // Far down among presses not read, their windows held on their way: the view rests over the run that stands for them.
        const windows = h.e3.hold((request) => request.dataset === PRESSES && request.kind === "page" && request.query.get("index") === null);
        await scrollAndSettle(c, 1500 * ROW_PX);
        await windows.holding;
        expect(frameOf(c).scrollTop).toBe(1500 * ROW_PX);
        // Hall 2 chosen — its presses read through the hall index, never held: once they are in, the view is at their top.
        await chooseHalls(["Hall 2"]);
        await waitFor(() => expect(pressRows(c)[0]).toBe(rowKeyOf(pressRow("P-1002"))));
        await waitFor(() => expect(frameOf(c).scrollTop).toBe(0));
        await act(async () => { windows.release(); });
        await settle();
    });

    // ── The keyboard across presses not read (#1398, CL10) ──────────────────
    describe("the keyboard across presses not read — fetch, then move (#1398, CL10)", () => {
        /** A press's grid item: its row, which takes the focus. */
        const pressItem = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-plan-item=${JSON.stringify(`r:${rowKeyOf(pressRow(key))}`)}]`);
        /** The press whose row has the focus, by its key — else what has it: the canvas's surface, a run, or the page's body. */
        const focused = (c: HTMLElement): string => {
            const at = document.activeElement;
            if (at === null || at === document.body) return "the page's body";
            if (at === body(c)) return "the canvas";
            const row = at.getAttribute("data-plan-row");
            if (row !== null) return pressKeys.find((key) => rowKeyOf(pressRow(key)) === row) ?? row;
            return at.hasAttribute("data-plan-window-band") ? "a run" : at.tagName;
        };
        /** Every press's key, in the record's order. */
        let pressKeys: readonly string[] = [];
        beforeEach(async () => { pressKeys = [...(await storedPresses()).keys()]; });
        /** What has the focus after each commit from now on — a commit drawing the rows, or a focus moving. */
        function watchFocus(c: HTMLElement): { seen: string[]; stop: () => void } {
            const seen: string[] = [];
            const observer = new MutationObserver(() => { seen.push(focused(c)); });
            observer.observe(c, { subtree: true, childList: true, attributes: true });
            const onFocus = () => { seen.push(focused(c)); };
            document.addEventListener("focusin", onFocus);
            return { seen, stop: () => { observer.disconnect(); document.removeEventListener("focusin", onFocus); } };
        }
        /** A key pressed where the focus is, and what it starts let settle. */
        async function key(name: string) {
            await act(async () => { fireEvent.keyDown(document.activeElement!, { key: name }); });
            await settle();
        }
        /** The presses' windows past the first: what a hold of them takes. */
        const pastFirst = (request: E3Request) => request.dataset === PRESSES && request.kind === "page" && Number(request.query.get("offset")) >= 200;

        test("PageDown from the last press read waits on it while the window past it is read — the view where it is, the focus never on the run — then lands a page on, never at the loaded edge", async () => {
            // The presses past the first window held on their way: the run stands for them, below the first two hundred.
            const windows = h.e3.hold(pastFirst);
            const { container: c } = await h.mount(hallsPlan(`${VIEWPORT}px`));
            await settle();
            await windows.holding;
            // Down to the last press read, Press 1200 — the two hundredth — and the run below it.
            await scrollAndSettle(c, 195 * ROW_PX);
            await act(async () => { pressItem(c, "P-1200")!.focus(); });
            const watch = watchFocus(c);
            const top = frameOf(c).scrollTop;
            await key("PageDown");
            // The window past it asked for: the focus waits on Press 1200, and the view stays.
            expect(focused(c)).toBe("P-1200");
            expect(frameOf(c).scrollTop).toBe(top);
            await act(async () => { windows.release(); });
            await settle();
            // In: a page on — 400px of view, ten presses of 42 — Press 1210, brought into view; never the run, never Press 1201.
            await waitFor(() => expect(focused(c)).toBe("P-1210"));
            expect(frameOf(c).scrollTop).toBe(210 * ROW_PX - VIEWPORT);
            watch.stop();
            expect(watch.seen.filter((at) => at !== "P-1200" && at !== "P-1210")).toEqual([]);
        });

        test("a run holding the focus — clicked, the view far among presses not read — hands it to the first of its presses the view shows as they land; a PageDown pressed on it waits for them, then goes a page on; the focus never on the page's body", async () => {
            const { container: c } = await h.mount(hallsPlan(`${VIEWPORT}px`));
            await settle();
            const windows = h.e3.hold((request) => request.dataset === PRESSES && request.kind === "page");
            // Far down among presses not read: the view over the run that stands for them, its windows held.
            await scrollAndSettle(c, 1500 * ROW_PX);
            await windows.holding;
            const run = c.querySelector<HTMLElement>("[data-plan-window-band]")!;
            await act(async () => { run.focus(); });
            expect(focused(c)).toBe("a run");
            const watch = watchFocus(c);
            await key("PageDown");
            // Nothing read in view: the key waits on the run, the view where it is.
            expect(focused(c)).toBe("a run");
            expect(frameOf(c).scrollTop).toBe(1500 * ROW_PX);
            await act(async () => { windows.release(); });
            await settle();
            // Landed: the first press in view, the fifteen hundred and first, takes the focus, and the page goes on ten presses.
            await waitFor(() => expect(focused(c)).toBe("P-2511"));
            watch.stop();
            // From the run, the first press in view, then a page on — never the page's body; the canvas's surface keeps the
            // focus while the run goes, where the run goes before a press takes it.
            const order = watch.seen.filter((at, i, all) => i === 0 || at !== all[i - 1]).filter((at) => at !== "the canvas" && at !== "a run");
            expect(order).toEqual(["P-2501", "P-2511"]);
        });

        test("a run holding the focus that a landing takes off the canvas — the windows the canvas opened on, which the page still holds, landing at once beside it as the view comes up among presses not read — leaves the focus on the canvas's surface, where a PageDown waits as it does on the run: once the presses land, the first in view takes the focus and the page goes on", async () => {
            const { container: c } = await h.mount(hallsPlan(`${VIEWPORT}px`));
            await settle();
            const pages = (request: E3Request) => request.dataset === PRESSES && request.kind === "page";
            // Far down among presses not read: the run there clicked, and as its presses land the first in view takes the focus.
            const far = h.e3.hold(pages);
            await scrollAndSettle(c, 1500 * ROW_PX);
            await far.holding;
            await act(async () => { c.querySelector<HTMLElement>("[data-plan-window-band]")!.focus(); });
            await act(async () => { far.release(); });
            await settle();
            await waitFor(() => expect(focused(c)).toBe("P-2501"));
            // Up among presses not read again, just past the windows the canvas opened on: the run the view arrives in clicked
            // as it arrives, before the view rests — the scroll and the click each flushed in a synchronous scope, which no
            // timer runs in, so the view's rest never comes between them however long their renders take.
            const up = h.e3.hold(pages);
            act(() => {
                frameOf(c).scrollTop = 700 * ROW_PX;
                fireEvent.scroll(frameOf(c));
            });
            act(() => { c.querySelector<HTMLElement>('[data-plan-window-band="head"]')!.focus(); });
            expect(focused(c)).toBe("a run");
            // At rest: the windows above the view asked for — those the page holds landing at once, the rest held on their
            // way — so the run is drawn from them on, the presses in view a run below them, and the run the click focused
            // leaves the frame: the focus is on the canvas's surface.
            await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
            await settle();
            await up.holding;
            expect(focused(c)).toBe("the canvas");
            const watch = watchFocus(c);
            // PageDown there waits for the presses, as it does on the run: in, the first press in view, the seven hundred
            // and first, takes the focus, and the page goes on ten presses.
            await key("PageDown");
            await act(async () => { up.release(); });
            await settle();
            await waitFor(() => expect(focused(c)).toBe("P-1711"));
            watch.stop();
            expect(watch.seen.filter((at) => at === "the page's body")).toEqual([]);
            expect(watch.seen.filter((at, i, all) => i === 0 || at !== all[i - 1]).filter((at) => at !== "the canvas")).toEqual(["P-1701", "P-1711"]);
        });

        test("End from a press reads the last window where the view is — the presses shown standing in, retained, the focus kept on the press it set out from, never the page's body — then lands on the last press; Home back to the first, its window still held by the page (#1398, CL10)", async () => {
            const { container: c } = await h.mount(hallsPlan(`${VIEWPORT}px`));
            await settle();
            await act(async () => { pressItem(c, "P-1001")!.focus(); });
            const windows = h.e3.hold((request) => request.dataset === PRESSES && request.kind === "page");
            const watch = watchFocus(c);
            await key("End");
            // The last window asked for: the presses shown stand in where they are while it is read — retained in a busy
            // main — the view at the top and the focus on the press it set out from.
            await windows.holding;
            expect(frameOf(c).scrollTop).toBe(0);
            expect(pressItem(c, "P-1001")).not.toBeNull();
            expect(focused(c)).toBe("P-1001");
            expect(body(c).getAttribute("aria-disabled")).toBe("true");
            expect(slot(c, "main")!.getAttribute("aria-busy")).toBe("true");
            await act(async () => { windows.release(); });
            await settle();
            // In: the last press, the two thousandth, at the foot of the view — the scroll's end, which the stand-in layout puts
            // past the rows — and nothing retained.
            await waitFor(() => expect(focused(c)).toBe("P-3000"));
            expect(frameOf(c).scrollTop).toBeGreaterThanOrEqual(2000 * ROW_PX - VIEWPORT);
            expect(body(c).hasAttribute("aria-disabled")).toBe(false);
            // Home: the first window, which the page still holds, read again at once — the first press, at the top.
            const asked = h.requests().length;
            await key("Home");
            await waitFor(() => expect(focused(c)).toBe("P-1001"));
            expect(frameOf(c).scrollTop).toBe(0);
            expect(pressesAsked(asked)).toEqual([]);
            watch.stop();
            // Never the page's body: the focus stayed on the press it set out from until the last press took it.
            expect(watch.seen.filter((at) => at === "the page's body")).toEqual([]);
            expect(watch.seen.filter((at, i, all) => i === 0 || at !== all[i - 1]).filter((at) => at !== "the canvas")).toEqual(["P-1001", "P-3000", "P-1001"]);
        });

        test("End's wait goes with the presses it set out among: a hall chosen meanwhile — its presses in two windows — never takes the focus to its last press as they land (#1398, CL10)", async () => {
            const { container: c } = await h.mount(hallsPlan(`${VIEWPORT}px`));
            await settle();
            await act(async () => { pressItem(c, "P-1001")!.focus(); });
            // The presses' own pages held on their way: End's last window waits.
            const own = h.e3.hold((request) => request.dataset === PRESSES && request.kind === "page" && request.query.get("index") === null);
            await key("End");
            await own.holding;
            expect(body(c).getAttribute("aria-disabled")).toBe("true");
            expect(focused(c)).toBe("P-1001");
            const watch = watchFocus(c);
            // Hall 3 chosen meanwhile — read through the hall index, never held: its 250 presses land, the last in the second window.
            const hall = await pressesOf("Hall 3");
            await chooseHalls(["Hall 3"]);
            await waitFor(() => expect(pressRows(c)[0]).toBe(rowKeyOf(pressRow(hall[0]!))));
            await act(async () => { own.release(); });
            await settle();
            watch.stop();
            // Never the hall's last press: the move went with the presses it set out among.
            expect(watch.seen).not.toContain(hall[hall.length - 1]);
            expect(focused(c)).not.toBe(hall[hall.length - 1]);
        });

        test("↓'s wait past the last press read goes with the presses it set out among: a hall chosen meanwhile that holds the press never takes the focus a step on in its presses as they land (#1398, CL10)", async () => {
            // The presses' own pages past the first window held on their way: the run stands for them.
            const windows = h.e3.hold((request) => pastFirst(request) && request.query.get("index") === null);
            const { container: c } = await h.mount(hallsPlan(`${VIEWPORT}px`));
            await settle();
            await windows.holding;
            await scrollAndSettle(c, 195 * ROW_PX);
            await act(async () => { pressItem(c, "P-1200")!.focus(); });
            await key("ArrowDown");
            expect(focused(c)).toBe("P-1200");
            const watch = watchFocus(c);
            // Hall 8 chosen meanwhile: Press 1200 is among its presses, Press 1208 the one after it.
            const hall = await pressesOf("Hall 8");
            expect(hall.slice(hall.indexOf("P-1200"), hall.indexOf("P-1200") + 2)).toEqual(["P-1200", "P-1208"]);
            await chooseHalls(["Hall 8"]);
            await waitFor(() => expect(pressRows(c)[0]).toBe(rowKeyOf(pressRow(hall[0]!))));
            await settle();
            // Down to Press 1200 and Press 1208 in the hall's presses: neither takes the focus as it is drawn.
            await scrollAndSettle(c, hall.indexOf("P-1200") * ROW_PX);
            watch.stop();
            expect(watch.seen).not.toContain("P-1208");
            await act(async () => { windows.release(); });
            await settle();
        });
    });
});
