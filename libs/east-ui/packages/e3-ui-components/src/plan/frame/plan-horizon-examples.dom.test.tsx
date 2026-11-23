/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Every Plan example whose rail holds the window draws its horizon's bars
 * from its sources' totals (#1732), on e3 itself: each source lists the
 * record's totals a month, a quarter and a year in its binding, and each bar
 * is the events of every source that touch its month — each source's months
 * read in one request of one range, as e3 keeps them, never counted. The
 * grouped example's horizon is held in `plan-grouped-examples.dom.test.tsx`.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { StringType, equalFor, type option } from "@elaraai/east";
import type { TreePath } from "@elaraai/e3-types";
import * as events from "@elaraai/e3-ui/examples/plan/plan-events";
import * as windows from "@elaraai/e3-ui/examples/plan/plan-windows";
import * as optimise from "@elaraai/e3-ui/examples/plan/optimise-windows";
import * as records from "@elaraai/e3-ui/examples/plan/plan-records";
import * as sheet from "@elaraai/e3-ui/examples/sheet/sheet-records";
import type { E3Record } from "../../e3-web.test-utils.js";
import type { Example } from "../../e3-web-mount.test-utils.js";
import { boundFrame, frameScrolls } from "../../sheet/frame.test-utils.js";
import { horizonLaidOut, planHarness, settle } from "./harness.test-utils.js";

const h = planHarness({
    "plan/plan-events": events, "plan/plan-windows": windows, "plan/optimise-windows": optimise, "plan/plan-records": records,
    "sheet/sheet-records": sheet,
});

/** A record's path, as e3's requests name it. */
const pathText = (path: TreePath) => path.map((step) => step.value).join(".");

// The examples' frames as a browser lays them: 700px tall, each mounted row as tall as it draws.
let restore: (() => void)[] = [];
beforeEach(() => { restore = [boundFrame(700), frameScrolls()]; });
afterEach(() => { for (const undo of restore.reverse()) undo(); });

/** An event's `[start, end)`, in ms: an instant's, and one ending at or before its start, `[at, at]`. */
type Span = readonly [number, number];

/** A span from an event's start and end: one ending at or before its start is an instant, as e3 files it. */
const spanOf = (start: number, end: number): Span => [start, Math.max(start, end)];

/**
 * The spans of rows timed by Option<DateTime> fields: a row with no start waits in the backlog, filed nowhere, and
 * one with no end is an instant.
 */
function optionSpans<R>(rows: Iterable<R>, times: (row: R) => readonly [option<Date>, option<Date>]): Span[] {
    return [...rows].flatMap((row) => {
        const [start, end] = times(row);
        if (start.type !== "some") return [];
        return [spanOf(start.value.getTime(), end.type === "some" ? end.value.getTime() : start.value.getTime())];
    });
}

/** The spans of rows timed by DateTime fields. */
function spans<R>(rows: Iterable<R>, times: (row: R) => readonly [Date, Date]): Span[] {
    return [...rows].map((row) => {
        const [start, end] = times(row);
        return spanOf(start.getTime(), end.getTime());
    });
}

/** The spans of rows each an instant, by its DateTime field. */
function instants<R>(rows: Iterable<R>, at: (row: R) => Date): Span[] {
    return [...rows].map((row) => spanOf(at(row).getTime(), at(row).getTime()));
}

/**
 * Each month's count of the events that touch it — those starting in it, and those running into it — across the
 * horizon: from the month the first event or the axis's window begins in to the one the last event starts or the
 * window ends in. A month none touches is left out, as the strip draws no bar for it.
 *
 * @param events - Every source's events
 * @param window - The axis's stated window, `[from, to)` in ms
 * @returns Each touched month's count, in order
 */
function touched(events: readonly Span[], window: Span): number[] {
    const first = events.reduce((least, [start]) => Math.min(least, start), window[0]);
    const last = events.reduce((most, [start]) => Math.max(most, start), window[1] - 1);
    const expected: number[] = [];
    const begin = new Date(first);
    for (let at = Date.UTC(begin.getUTCFullYear(), begin.getUTCMonth(), 1); at <= last;) {
        const from = new Date(at);
        const next = Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1);
        const n = events.filter(([start, end]) => (start >= at && start < next) || (start < at && end > at)).length;
        if (n > 0) expected.push(n);
        at = next;
    }
    return expected;
}

/** The window the windows' examples' axis states: the fortnight from Monday 5 October 2026. */
const WINDOWS_FORTNIGHT: Span = [Date.UTC(2026, 9, 5), Date.UTC(2026, 9, 19)];
/** The window the work orders' Plan's axis states: the first fortnight of October 2026. */
const ORDERS_FORTNIGHT: Span = [Date.UTC(2026, 9, 1), Date.UTC(2026, 9, 15)];
/** The window the print works' Plans' axes state: the four weeks from Monday 5 October 2026. */
const WORKS_FOUR_WEEKS: Span = [Date.UTC(2026, 9, 5), Date.UTC(2026, 10, 2)];

/** The press tasks, each an instant on its day. */
const pressTasks = () => [...events.planPressTaskRows.default!.values()];
const sameText = equalFor(StringType);

/** The windows' print jobs, each a span; four in the backlog, filed nowhere. */
const windowJobs = () => optionSpans(windows.planWindowJobs.default!.values(), (job) => [job.start, job.end]);

/** A Plan example, the window its axis states, each source holding the window — its record, and its totals' names' stem — and their events. */
interface HorizonCase {
    readonly name: string;
    readonly example: Example;
    readonly window: Span;
    readonly sources: readonly { readonly record: E3Record; readonly totals: string }[];
    readonly events: () => readonly Span[];
}

const CASES: readonly HorizonCase[] = [
    { name: "planWindows", example: windows.planWindows, window: WINDOWS_FORTNIGHT, sources: [{ record: windows.planWindowJobs, totals: "plan_window_jobs" }], events: windowJobs },
    { name: "planSeriesByHall", example: windows.planSeriesByHall, window: WINDOWS_FORTNIGHT, sources: [{ record: windows.planWindowJobs, totals: "plan_window_jobs" }], events: windowJobs },
    {
        name: "planTypedKeysPaged", example: windows.planTypedKeysPaged, window: WINDOWS_FORTNIGHT,
        sources: [{ record: windows.planKeyedWindowJobs, totals: "plan_keyed_window_jobs" }],
        events: () => optionSpans(windows.planKeyedWindowJobs.default!.values(), (job) => [job.start, job.end]),
    },
    { name: "planOptimiseWindows", example: optimise.planOptimiseWindows, window: WINDOWS_FORTNIGHT, sources: [{ record: windows.planWindowJobs, totals: "plan_window_jobs" }], events: windowJobs },
    {
        name: "planRecordIndexes", example: records.planRecordIndexes, window: ORDERS_FORTNIGHT,
        sources: [{ record: records.planOperations, totals: "plan_operations" }],
        events: () => spans(records.planOperations.default!.values(), (operation) => [operation.start, operation.end]),
    },
    {
        // Two sources hold the window: the jobs, read through their own totals while the rail chooses no stock, and the shifts.
        name: "planPrintWorks", example: events.planPrintWorks, window: WORKS_FOUR_WEEKS,
        sources: [{ record: events.planPrintJobs, totals: "plan_print_jobs" }, { record: events.planPrintShifts, totals: "plan_print_shifts" }],
        events: () => [
            ...optionSpans(events.planPrintJobs.default!.values(), (job) => [job.start, job.end]),
            ...spans(events.planPrintShifts.default!.values(), (shift) => [shift.start, shift.end]),
        ],
    },
    {
        name: "planPressTasks", example: events.planPressTasks, window: WORKS_FOUR_WEEKS,
        sources: [{ record: events.planPressTaskRows, totals: "plan_press_tasks" }],
        events: () => instants(pressTasks(), (task) => task.day),
    },
    {
        // A press's page: its scope holds the press it is for, the first, so its bars are that press's tasks, read through
        // the totals led by the press.
        name: "planOnePress", example: events.planOnePress, window: WORKS_FOUR_WEEKS,
        sources: [{ record: events.planPressTaskRows, totals: "plan_press_tasks_by_press" }],
        events: () => instants(pressTasks().filter((task) => sameText(task.press, "P03")), (task) => task.day),
    },
    {
        name: "planPrintWorksRecords", example: events.planPrintWorksRecords, window: WORKS_FOUR_WEEKS,
        sources: [
            { record: events.planWorksJobs, totals: "plan_works_jobs" }, { record: events.planWorksShifts, totals: "plan_works_shifts" },
            { record: events.planWorksStops, totals: "plan_works_stops" }, { record: events.planWorksBindings, totals: "plan_works_bindings" },
            { record: events.planWorksDeliveries, totals: "plan_works_deliveries" },
        ],
        events: () => [
            ...spans(events.planWorksJobs.default!.values(), (job) => [job.start, job.end]),
            ...spans(events.planWorksShifts.default!.values(), (shift) => [shift.start, shift.end]),
            ...instants(events.planWorksStops.default!.values(), (stop) => stop.at),
            ...spans(events.planWorksBindings.default!.values(), (binding) => [binding.start, binding.end]),
            ...instants(events.planWorksDeliveries.default!.values(), (delivery) => delivery.at),
        ],
    },
];

describe("the Plan examples' horizons over their sources' totals (#1732)", () => {
    test.each(CASES)("$name: the horizon draws each month's events of its sources from their month totals, each source's in one request of one range", async ({ example, window, sources, events }) => {
        // The strip laid out 3,000px wide: a month keeps 4px over any of these horizons, a bar a month.
        horizonLaidOut()(3000);
        const { container: c } = await h.mount(example);
        await settle();
        const bars = () => [...c.querySelectorAll<HTMLElement>("[data-slot='horizon'] [data-brush-bars=''] > [data-brush-bar]")];
        await waitFor(() => expect(bars().length).toBeGreaterThan(0), { timeout: 10_000 });
        expect(bars().map((bar) => Number(bar.getAttribute("data-count")))).toEqual(touched(events(), window));
        for (const { record, totals } of sources) {
            const dataset = pathText(record.path as TreePath);
            const read = h.requests("find", dataset).filter((request) => request.query.get("index")?.endsWith("_totals") === true);
            expect(read.map((request) => request.query.get("index")), dataset).toEqual([`${totals}_month_totals`]);
            expect(read[0]!.searches, dataset).toHaveLength(1);
        }
    });
});
