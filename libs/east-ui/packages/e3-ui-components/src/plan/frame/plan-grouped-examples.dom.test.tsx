/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The grouped example (#1710), on e3 itself: `planSeriesAll` mounts as a
 * surface mounts it — its halls read a hall at a time, rows beside groups at
 * every level, and each of its five kinds' events a cell at a time through the
 * kind's own series index, never read whole nor a row by its key: the halls'
 * inspections through an index in the halls' order, each search a range of one
 * hall; the folders' runs and the bays' deliveries through indexes in time
 * order led by the hall, each search under one hall; the presses' jobs and
 * the guillotines' trims through indexes led by the hall and the line, each
 * search under one line of one hall. Its Plan built with no refusal, and every
 * way an event kind draws drawn: chips, bars, tiles and marks. Its horizon's
 * bars are the kinds' totals a period, which their bindings list (#1732).
 *
 * And each hall's own row, each line's, and a section's header inside a hall
 * (`planSeriesSections`) count the events beneath them a column at a time,
 * open or folded (#1716): each column's number the events touching it, from
 * each record's totals led by the hall, or by the hall and the line — one
 * search a row a record, none sent twice, no event read — and drawn while
 * the rows are, never holding them back. After a zoom a row keeps the cells
 * it drew, hidden and as they were, until the new period's land.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { StringType, equalFor, printFor, variant } from "@elaraai/east";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-grouped";
import type { TreePath } from "@elaraai/e3-types";
import type { E3Request } from "../../e3-web.test-utils.js";
import { periodText } from "../../shared/time/scale.js";
import { boundFrame, frameScrolls } from "../../sheet/frame.test-utils.js";
import { rowKeyOf, type PlanRowId } from "../model.js";
import { act, el, entry, horizonLaidOut, planHarness, rowAt, settle, slot, toggleSeries, zoomTo } from "./harness.test-utils.js";
import { instants, periodCounts, spans, touched, type Span } from "./horizon.test-utils.js";

const h = planHarness({ "plan/plan-grouped": ex });

/** A record's path, as e3's requests name it. */
const pathText = (path: TreePath) => path.map((step) => step.value).join(".");

// The example's frame as a browser lays it: 700px tall, each mounted row as tall as it draws.
let restore: (() => void)[] = [];
beforeEach(() => { restore = [boundFrame(700), frameScrolls()]; });
afterEach(() => { for (const undo of restore.reverse()) undo(); });

/**
 * Each kind's record, the series index its source lists, and the rows its
 * searches stand under: one hall — the index in the halls' own order, or one
 * led by the hall — or one line of one hall.
 */
const KINDS = [
    { record: ex.planSeriesInspections, series: "plan_series_inspections_by_hall_week", under: "hall", totals: "plan_series_inspections" },
    { record: ex.planSeriesFolding, series: "plan_series_folding_by_hall_week", under: "hall", totals: "plan_series_folding" },
    { record: ex.planSeriesDeliveries, series: "plan_series_deliveries_by_hall_week", under: "hall", totals: "plan_series_deliveries" },
    { record: ex.planSeriesJobs, series: "plan_series_jobs_by_line_week", under: "line", totals: "plan_series_jobs" },
    { record: ex.planSeriesTrims, series: "plan_series_trims_by_line_week", under: "line", totals: "plan_series_trims" },
] as const;

/** Every kind's events, each `[start, end)` in ms: an instant's, `[at, at]`. */
const EVENTS = [
    ...spans([...ex.planSeriesInspections.default!.values(), ...ex.planSeriesFolding.default!.values(), ...ex.planSeriesJobs.default!.values()],
        (row) => [row.start, row.end]),
    ...instants([...ex.planSeriesDeliveries.default!.values(), ...ex.planSeriesTrims.default!.values()], (row) => row.at),
];

/** The window the grouped example's axis states: the four weeks from Monday 5 October 2026. */
const WINDOW: Span = [Date.UTC(2026, 9, 5), Date.UTC(2026, 10, 2)];

const printText = printFor(StringType);
/** Each line's key, as an index's second leading field holds it, by its hall's key as the first holds it: `.east` literals of a String. */
const LINES = new Map([...ex.planSeriesHalls.default!].map(([hall, of]) => [printText(hall), new Set([...of.lines.keys()].map((line) => printText(line)))] as const));

/** Whether a request reads the totals a horizon's bars count: a kind's record's, under no field, a month, a quarter or a year. */
const horizonTotals = (request: E3Request, totals: string) =>
    ["month", "quarter", "year"].some((tile) => request.query.get("index") === `${totals}_${tile}_totals`);

/** Whether a request reads totals a group's own row counts from (#1716): a record's, led by the hall, or by the hall and the line. */
const bandTotals = (request: E3Request) => /_by_(hall|line)_(day|week|month)_totals$/.test(request.query.get("index") ?? "");

/** Each search some requests sent, under its index: none a group's row reads is sent twice at one zoom. */
const searchesOf = (requests: readonly E3Request[]) =>
    requests.flatMap((request) => request.searches.map((search) => `${request.query.get("index") ?? ""}\u0000${JSON.stringify(search)}`));

const sameText = equalFor(StringType);
/** The runs of a hall's folders, each `[start, end)` in ms. */
const runsIn = (hall: string) => spans([...ex.planSeriesFolding.default!.values()].filter((run) => sameText(run.hall, hall)), (run) => [run.start, run.end]);
/** The paper delivered to a hall's bays, each at its instant. */
const deliveriesIn = (hall: string) => instants([...ex.planSeriesDeliveries.default!.values()].filter((paper) => sameText(paper.hall, hall)), (paper) => paper.at);
/** The print jobs of a hall's presses, or of one line's. */
const jobsIn = (hall: string, line?: string) => spans([...ex.planSeriesJobs.default!.values()]
    .filter((job) => sameText(job.hall, hall) && (line === undefined || sameText(job.line, line))), (job) => [job.start, job.end]);
/** The trims of a hall's guillotines, or of one line's. */
const trimsIn = (hall: string, line?: string) => instants([...ex.planSeriesTrims.default!.values()]
    .filter((trim) => sameText(trim.hall, hall) && (line === undefined || sameText(trim.line, line))), (trim) => trim.at);
/** Everything beneath a hall's own row: its folders' runs, its bays' paper, and its lines' jobs and trims. */
const beneathHall = (hall: string) => [...runsIn(hall), ...deliveriesIn(hall), ...jobsIn(hall), ...trimsIn(hall)];

/** A group's own row's count cells (#1716), in order: each its column in words, the number it shows, and all it says. */
function countsOf(main: HTMLElement, id: PlanRowId) {
    return [...main.querySelectorAll<HTMLElement>(`[data-plan-group=${JSON.stringify(rowKeyOf(id))}] [data-plan-band-count]`)].map((cell) => {
        const label = cell.getAttribute("aria-label") ?? "";
        return { bucket: label.slice(0, label.indexOf(": ")), shown: cell.textContent ?? "", label };
    });
}

/**
 * Holds a group's own row's count cells to the events beneath it (#1716): each cell's number the events that touch its
 * column, and every column with events between the first the row counts and the last.
 */
function expectCounts(cells: ReturnType<typeof countsOf>, events: readonly Span[], unit: "day" | "week"): void {
    const counts = periodCounts(events, unit);
    const byText = new Map([...counts].map(([at, n]) => [periodText(new Date(at), unit), { at, n }] as const));
    expect(cells.length, "the row counts some columns").toBeGreaterThan(0);
    const columns = cells.map((cell) => {
        const held = byText.get(cell.bucket);
        expect(held, cell.label).toBeDefined();
        expect(Number(cell.shown), cell.label).toBe(held!.n);
        return held!.at;
    });
    expect(columns).toEqual([...counts.keys()].filter((at) => at >= columns[0]! && at <= columns[columns.length - 1]!));
}

describe("the grouped example on e3 (#1710)", () => {
    test("planSeriesAll: its halls a hall at a time, rows beside groups, each kind's events through its series index under the rows its resources stand under, every way a kind draws drawn", async () => {
        const { container: c } = await h.mount(ex.planSeriesAll);
        await settle();
        const main = slot(c, "main") ?? c;
        expect([...c.querySelectorAll("[data-plan-diagnostic],[data-plan-error],[role='alert']")].map((el) => el.textContent ?? "")).toEqual([]);
        // Every way a kind draws: the jobs' bars, the services' chips, the deliveries' tiles and the checks' marks.
        await waitFor(() => {
            for (const drawn of ["[data-run]", "[data-chip]", "[data-event]", "[data-mark]"]) {
                expect(main.querySelectorAll(`[data-plan-row] ${drawn}`).length, drawn).toBeGreaterThan(0);
            }
        });
        // Every hall row at the top is read and draws its own events (#1710): the halls as rows are a block of a row a
        // window beside the halls as groups over the same windows, and both are on screen — each block's demand follows
        // its own rows, and a screen of one-row windows is all demanded. The first four halls' first inspections fall
        // in the opening weeks.
        await waitFor(() => {
            for (const hall of ["H-101", "H-102", "H-103", "H-104"]) {
                expect(main.querySelector(`${rowAt(entry("halls", hall))} ${el("data-chip", "inspection", `${hall}-I1`)}`), hall).not.toBeNull();
            }
        });
        // The halls a window each.
        const pages = h.requests("page", pathText(ex.planSeriesHalls.path as TreePath));
        expect(pages.length).toBeGreaterThan(0);
        expect(pages.every((read) => read.query.get("limit") === "1")).toBe(true);
        for (const { record, series, under } of KINDS) {
            const dataset = pathText(record.path as TreePath);
            // Its cells through its series index: the searches, then the entries they select.
            expect(h.readKinds(dataset, series), series).toEqual(expect.arrayContaining(["find", "runs"]));
            // Each search under one hall, the first of its key's parts, or one line of one hall, the first two.
            const searches = h.requests("find", dataset).filter((request) => request.query.get("index") === series).flatMap((request) => request.searches);
            expect(searches.length, series).toBeGreaterThan(0);
            for (const search of searches) {
                const from = "from" in search ? search.from ?? [] : [];
                const to = "to" in search ? search.to ?? [] : [];
                if (under === "hall") {
                    expect(LINES.has(from[0] ?? ""), series).toBe(true);
                    expect(to[0], series).toBe(from[0]);
                } else {
                    expect(LINES.get(from[0] ?? "")?.has(from[1] ?? ""), series).toBe(true);
                    expect([to[0], to[1]], series).toEqual([from[0], from[1]]);
                }
            }
            // Never read whole, nor a row by its key: nothing asked for one.
            expect(h.requests("read", dataset)).toEqual([]);
            expect(h.requests("rows", dataset)).toEqual([]);
        }
    });

    test("planSeriesAll zoomed out past its kinds' series tiles shades its rows from their summaries and reads no event; zoomed back in, draws them (#1706, #1710)", async () => {
        const { container: c } = await h.mount(ex.planSeriesAll);
        await settle();
        const main = slot(c, "main") ?? c;
        const drawn = () => main.querySelectorAll("[data-plan-row] [data-run], [data-plan-row] [data-chip], [data-plan-row] [data-event], [data-plan-row] [data-mark]").length;
        await waitFor(() => expect(drawn()).toBeGreaterThan(0));
        // Each kind's series searches, so far.
        const searched = () => KINDS.map(({ record, series }) =>
            h.requests("find", pathText(record.path as TreePath)).filter((request) => request.query.get("index") === series).length);
        // A month: past every kind's series tile, a week's. No event drawn, the rows shaded from the month summaries — a
        // folder's cells named by the share of each month its runs book — and no series index searched again: each
        // kind's month summary read instead.
        await zoomTo(c, "month");
        const atMonth = searched();
        const folder = () => [...main.querySelectorAll<HTMLElement>(`${rowAt(entry("folders", "H-101", "F-101-1"))} [data-cell]`)];
        await waitFor(() => expect(folder().length).toBeGreaterThan(0), { timeout: 10_000 });
        expect(folder().some((cell) => /% booked/.test(cell.getAttribute("aria-label") ?? ""))).toBe(true);
        expect(drawn()).toBe(0);
        await settle();
        expect(searched()).toEqual(atMonth);
        for (const { record } of KINDS) {
            const summaries = h.requests("find", pathText(record.path as TreePath)).filter((request) => request.query.get("index")?.endsWith("_month") === true);
            expect(summaries.length, pathText(record.path as TreePath)).toBeGreaterThan(0);
        }
        // Back to the week, the series tile: the events read and drawn again.
        await zoomTo(c, "week");
        await waitFor(() => expect(drawn()).toBeGreaterThan(0));
    });

    test("planSeriesAll's horizon draws each month's events of its kinds from their month totals — a kind's years in one request of one range, nothing counted, no event read — and a zoom within the years reads them nowhere again (#1732)", async () => {
        // The strip laid out 3,000px wide: the three years keep some 80px a month, a bar a month.
        horizonLaidOut()(3000);
        const { container: c } = await h.mount(ex.planSeriesAll);
        await settle();
        const band = () => c.querySelector<HTMLElement>("[data-slot='horizon']")!;
        const bars = () => [...band().querySelectorAll<HTMLElement>("[data-brush-bars=''] > [data-brush-bar]")];
        await waitFor(() => expect(bars().length).toBeGreaterThan(0), { timeout: 10_000 });
        // Each month from the horizon's first to the last start's, and every kind's events that touch it.
        expect(bars().map((bar) => Number(bar.getAttribute("data-count")))).toEqual(touched(EVENTS, WINDOW));
        // Each kind's month totals in one request, one range over the whole years — never its interval index counted month
        // by month, nor an event read.
        const totalsRead = () => KINDS.map(({ record, totals }) =>
            h.requests("find", pathText(record.path as TreePath)).filter((request) => horizonTotals(request, totals)));
        totalsRead().forEach((read, i) => {
            const { record, totals } = KINDS[i]!;
            const dataset = pathText(record.path as TreePath);
            expect(read.map((request) => request.query.get("index")), dataset).toEqual([`${totals}_month_totals`]);
            expect(read[0]!.searches, dataset).toHaveLength(1);
            const counted = h.requests("find", dataset).filter((request) => request.query.get("index")?.endsWith("_by_time") === true && request.searches.length > 55);
            expect(counted, dataset).toEqual([]);
            expect(h.requests("read", dataset)).toEqual([]);
        });
        // To the week and back: the window moves within the years, and no kind's totals are read again.
        const asked = totalsRead().map((read) => read.length);
        await zoomTo(c, "week");
        await zoomTo(c, "day");
        await settle();
        expect(totalsRead().map((read) => read.length)).toEqual(asked);
        expect(bars().map((bar) => Number(bar.getAttribute("data-count")))).toEqual(touched(EVENTS, WINDOW));
    });

    test("planSeriesAll's horizon on a strip too narrow for 4px a month draws quarters from the quarter totals, an event over two months counted once in their quarter (#1732)", async () => {
        // 120px: a month keeps some 3px of the three years, a quarter some 10px.
        horizonLaidOut()(120);
        const { container: c } = await h.mount(ex.planSeriesAll);
        await settle();
        const bars = () => [...c.querySelectorAll<HTMLElement>("[data-slot='horizon'] [data-brush-bars=''] > [data-brush-bar]")];
        await waitFor(() => expect(bars().length).toBeGreaterThan(0), { timeout: 10_000 });
        expect(bars().map((bar) => Number(bar.getAttribute("data-count")))).toEqual(touched(EVENTS, WINDOW, "quarter"));
        for (const { record, totals } of KINDS) {
            const read = h.requests("find", pathText(record.path as TreePath)).filter((request) => horizonTotals(request, totals));
            expect(read.map((request) => request.query.get("index"))).toEqual([`${totals}_quarter_totals`]);
        }
    });

    test("planSeriesAll: a kind whose cells e3 cannot read is said so on the footer, with Retry — never loading for ever, nor the canvas busy; Retry reads them once e3 answers again (#1710)", async () => {
        // The inspections' series searches answered as e3 answers a failure.
        const dataset = pathText(ex.planSeriesInspections.path as TreePath);
        const stop = h.e3.fail((request) => request.dataset === dataset && request.query.get("index") === "plan_series_inspections_by_hall_week",
            { status: 500, type: "internal", message: "the store is down" });
        const { container: c } = await h.mount(ex.planSeriesAll);
        await settle();
        const main = slot(c, "main") ?? c;
        const footer = () => slot(c, "footer")?.textContent ?? "";
        await waitFor(() => expect(footer()).toContain("Couldn't read"), { timeout: 10_000 });
        expect(footer()).not.toMatch(/Loading/);
        expect(c.querySelector("[data-builder-frame][aria-busy='true'], [data-plan-body][aria-busy='true']")).toBeNull();
        // e3 answers again: Retry reads the inspections, and the first hall's draws.
        stop();
        fireEvent.click(within(slot(c, "footer")!).getByRole("button", { name: /Retry/ }));
        await waitFor(() => expect(main.querySelector(`${rowAt(entry("halls", "H-101"))} ${el("data-chip", "inspection", "H-101-I1")}`)).not.toBeNull(),
            { timeout: 10_000 });
        expect(footer()).not.toContain("Couldn't read");
    });
});

describe("a group's own row counts the events beneath it, on e3 (#1716)", () => {
    test("planSeriesAll: each hall's own row, and each line's, counts the events beneath it a column at a time — open, folded and after Collapse all — from each record's totals a day, led by the hall or by the hall and the line: one search a row a record, none sent twice, and no event read", async () => {
        const { container: c } = await h.mount(ex.planSeriesAll);
        await settle();
        const main = slot(c, "main") ?? c;
        const hall = entry("floors", "H-101");
        const line = entry("lines", "H-101", "L-101-1");
        await waitFor(() => expect(countsOf(main, line).length).toBeGreaterThan(0), { timeout: 10_000 });
        // The hall's row: its folders' runs, its bays' paper, and its line's jobs and trims; the line's, its jobs and trims.
        expectCounts(countsOf(main, hall), beneathHall("H-101"), "day");
        expectCounts(countsOf(main, line), [...jobsIn("H-101", "L-101-1"), ...trimsIn("H-101", "L-101-1")], "day");
        // Its hover names each record's share by its kinds, where a column counts more than one.
        const open = countsOf(main, hall);
        expect(open.some((cell) => /events — .*Print job \d+/.test(cell.label)), "a column's shares").toBe(true);
        // Each from its record's totals a day, led by the hall, or by the hall and the line; the inspections — on the halls' own
        // rows, beside the groups — by none.
        expect(new Set(h.requests("find").filter(bandTotals).map((request) => request.query.get("index")))).toEqual(new Set([
            "plan_series_folding_by_hall_day_totals", "plan_series_deliveries_by_hall_day_totals", "plan_series_jobs_by_hall_day_totals",
            "plan_series_trims_by_hall_day_totals", "plan_series_jobs_by_line_day_totals", "plan_series_trims_by_line_day_totals",
        ]));
        // Folded, the hall's row counts the same.
        const band = () => main.querySelector<HTMLElement>(`[data-plan-group=${JSON.stringify(rowKeyOf(hall))}]`)!;
        fireEvent.click(band());
        await settle();
        expect(band().getAttribute("aria-expanded")).toBe("false");
        expect(countsOf(main, hall)).toEqual(open);
        // A group folded makes the toolbar's first action Expand all; then Collapse all, and each hall's row the view now
        // shows counts the events beneath it.
        const fold = () => slot(c, "toolbar")!.querySelector<HTMLElement>("[data-plan-fold-all]")!;
        expect(fold().getAttribute("aria-label")).toBe("Expand all");
        fireEvent.click(fold());
        await settle();
        expect(fold().getAttribute("aria-label")).toBe("Collapse all");
        fireEvent.click(fold());
        await settle();
        const halls = ["H-101", "H-102", "H-103", "H-104"];
        await waitFor(() => { for (const key of halls) expect(countsOf(main, entry("floors", key)).length, key).toBeGreaterThan(0); }, { timeout: 10_000 });
        for (const key of halls) expectCounts(countsOf(main, entry("floors", key)), beneathHall(key), "day");
        // One search a row a record, none sent twice; and no event read whole, nor by its key.
        const sent = searchesOf(h.requests("find").filter(bandTotals));
        expect(new Set(sent).size).toBe(sent.length);
        for (const { record } of KINDS) {
            expect(h.requests("read", pathText(record.path as TreePath))).toEqual([]);
            expect(h.requests("rows", pathText(record.path as TreePath))).toEqual([]);
        }
    });

    test("planSeriesAll zoomed to the week counts each hall's events from its totals a week: each event once, a run of a day and a half once in its week", async () => {
        const { container: c } = await h.mount(ex.planSeriesAll);
        await settle();
        const main = slot(c, "main") ?? c;
        await zoomTo(c, "week");
        await waitFor(() => expectCounts(countsOf(main, entry("floors", "H-101")), beneathHall("H-101"), "week"), { timeout: 10_000 });
        const indexes = new Set(h.requests("find").filter(bandTotals).map((request) => request.query.get("index") ?? ""));
        expect([...indexes].filter((index) => index.endsWith("_week_totals")).sort()).toEqual([
            "plan_series_deliveries_by_hall_week_totals", "plan_series_folding_by_hall_week_totals", "plan_series_jobs_by_hall_week_totals",
            "plan_series_jobs_by_line_week_totals", "plan_series_trims_by_hall_week_totals", "plan_series_trims_by_line_week_totals",
        ]);
    });

    test("planSeriesAll zoomed to the week while the week's totals are on their way: each hall's row keeps the day's cells it drew, hidden and as they were — none laid out again on the week's columns — and the week's replace them as they land", async () => {
        const { container: c } = await h.mount(ex.planSeriesAll);
        await settle();
        const main = slot(c, "main") ?? c;
        const hall = entry("floors", "H-101");
        const cells = () => main.querySelector<HTMLElement>(`[data-plan-group=${JSON.stringify(rowKeyOf(hall))}] [data-plan-band-counts]`);
        await waitFor(() => expect(countsOf(main, hall).length).toBeGreaterThan(0), { timeout: 10_000 });
        const day = countsOf(main, hall);
        const weekly = h.e3.hold((request) => bandTotals(request) && (request.query.get("index") ?? "").endsWith("_week_totals"));
        await zoomTo(c, "week");
        await weekly.holding;
        // The day's cells as they were drawn, hidden: no hover, no reader hears them.
        expect(countsOf(main, hall)).toEqual(day);
        expect(cells()?.hasAttribute("hidden")).toBe(true);
        await act(async () => { weekly.release(); });
        await settle();
        await waitFor(() => expectCounts(countsOf(main, hall), beneathHall("H-101"), "week"), { timeout: 10_000 });
        expect(cells()?.hasAttribute("hidden")).toBe(false);
    });

    test("planSeriesAll draws its rows and their events while the group rows' counts are on their way, and counts once they land", async () => {
        const counting = h.e3.hold(bandTotals);
        const { container: c } = await h.mount(ex.planSeriesAll);
        await settle();
        const main = slot(c, "main") ?? c;
        await counting.holding;
        await waitFor(() => expect(main.querySelectorAll("[data-plan-row] [data-run]").length).toBeGreaterThan(0));
        expect(main.querySelectorAll("[data-plan-band-count]").length).toBe(0);
        await act(async () => { counting.release(); });
        await settle();
        await waitFor(() => expectCounts(countsOf(main, entry("floors", "H-101")), beneathHall("H-101"), "day"), { timeout: 10_000 });
    });

    test("planSeriesAll with the folding runs switched off in the Series tab: each hall's row counts what the canvas shows beneath it, the runs left out", async () => {
        const { container: c } = await h.mount(ex.planSeriesAll);
        await settle();
        const main = slot(c, "main") ?? c;
        const hall = entry("floors", "H-101");
        await waitFor(() => expect(countsOf(main, hall).length).toBeGreaterThan(0), { timeout: 10_000 });
        await toggleSeries(c, "Folding run");
        await waitFor(() => expectCounts(countsOf(main, hall), [...deliveriesIn("H-101"), ...jobsIn("H-101"), ...trimsIn("H-101")], "day"), { timeout: 10_000 });
    });

    test("planSeriesSections: a section's header inside a hall counts the deliveries landing within it, as the hall's own row counts its runs and its deliveries — the two rows' search of the deliveries one", async () => {
        const { container: c } = await h.mount(ex.planSeriesSections);
        await settle();
        const main = slot(c, "main") ?? c;
        const header = variant("section", { series: "loading", path: ["H-101"] }) as PlanRowId;
        await waitFor(() => expect(countsOf(main, header).length).toBeGreaterThan(0), { timeout: 10_000 });
        expectCounts(countsOf(main, header), deliveriesIn("H-101"), "day");
        expectCounts(countsOf(main, entry("floors", "H-101")), [...runsIn("H-101"), ...deliveriesIn("H-101")], "day");
        const sent = searchesOf(h.requests("find").filter(bandTotals));
        expect(new Set(sent).size).toBe(sent.length);
    });
});
