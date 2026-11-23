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
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { StringType, printFor } from "@elaraai/east";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-grouped";
import type { TreePath } from "@elaraai/e3-types";
import { boundFrame, frameScrolls } from "../../sheet/frame.test-utils.js";
import { el, entry, horizonLaidOut, planHarness, rowAt, settle, slot, zoomTo } from "./harness.test-utils.js";

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
    ...[...ex.planSeriesInspections.default!.values()], ...[...ex.planSeriesFolding.default!.values()], ...[...ex.planSeriesJobs.default!.values()],
].map((row) => [row.start.getTime(), row.end.getTime()] as const).concat(
    [...[...ex.planSeriesDeliveries.default!.values()], ...[...ex.planSeriesTrims.default!.values()]].map((row) => [row.at.getTime(), row.at.getTime()] as const));

/**
 * Each period's count of every kind's events that touch it — those starting in it, and those running into it — from
 * the horizon's first, October 2026's, to the one the last event starts in: a period of so many months; none touched,
 * left out, as the strip draws no bar for it.
 */
function touched(months: number): number[] {
    const last = EVENTS.reduce((most, [start]) => Math.max(most, start), 0);
    const expected: number[] = [];
    for (let at = Date.UTC(2026, 9, 1); at <= last;) {
        const from = new Date(at);
        const next = Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + months, 1);
        const n = EVENTS.filter(([start, end]) => (start >= at && start < next) || (start < at && end > at)).length;
        if (n > 0) expected.push(n);
        at = next;
    }
    return expected;
}

const printText = printFor(StringType);
/** Each line's key, as an index's second leading field holds it, by its hall's key as the first holds it: `.east` literals of a String. */
const LINES = new Map([...ex.planSeriesHalls.default!].map(([hall, of]) => [printText(hall), new Set([...of.lines.keys()].map((line) => printText(line)))] as const));

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
        expect(bars().map((bar) => Number(bar.getAttribute("data-count")))).toEqual(touched(1));
        // Each kind's month totals in one request, one range over the whole years — never its interval index counted month
        // by month, nor an event read.
        const totalsRead = () => KINDS.map(({ record }) =>
            h.requests("find", pathText(record.path as TreePath)).filter((request) => request.query.get("index")?.endsWith("_totals") === true));
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
        expect(bars().map((bar) => Number(bar.getAttribute("data-count")))).toEqual(touched(1));
    });

    test("planSeriesAll's horizon on a strip too narrow for 4px a month draws quarters from the quarter totals, an event over two months counted once in their quarter (#1732)", async () => {
        // 120px: a month keeps some 3px of the three years, a quarter some 10px.
        horizonLaidOut()(120);
        const { container: c } = await h.mount(ex.planSeriesAll);
        await settle();
        const bars = () => [...c.querySelectorAll<HTMLElement>("[data-slot='horizon'] [data-brush-bars=''] > [data-brush-bar]")];
        await waitFor(() => expect(bars().length).toBeGreaterThan(0), { timeout: 10_000 });
        expect(bars().map((bar) => Number(bar.getAttribute("data-count")))).toEqual(touched(3));
        for (const { record, totals } of KINDS) {
            const read = h.requests("find", pathText(record.path as TreePath)).filter((request) => request.query.get("index")?.endsWith("_totals") === true);
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
