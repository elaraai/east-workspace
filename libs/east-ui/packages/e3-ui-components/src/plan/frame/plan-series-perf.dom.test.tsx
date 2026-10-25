/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The series benchmark (#1039) — `E3_UI_PERF=1`, never in CI: a timing on a
 * shared runner is no deterministic signal, and CI keeps the request-log proofs
 * of `plan-series.dom.test.tsx`. 50,000 presses, and twenty jobs a week on each
 * of the first two hundred over a quarter, written through the benchmark
 * record's patch door, read a cell at a time:
 *
 * - the quarter at a month: the first screen's shading, from the summary;
 * - a fortnight at a day: the first screen's bars, from the cells in view;
 * - a scroll to the fourth block of presses, which hold jobs, and one to the
 *   25,000th press, which holds none.
 *
 * For each it records the time to what it draws and the requests it made, by
 * kind, and holds what the Plan never does at any size: read the jobs whole.
 *
 * Run: `E3_UI_PERF=1 pnpm exec vitest run src/plan/frame/plan-series-perf.dom.test.tsx`.
 */

import { describe, expect, test } from "vitest";
import { waitFor, type RenderResult } from "@testing-library/react";
import { East, StringType, compareFor, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { Data, Plan, Record, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-windows";
import type { PrintJob } from "@elaraai/e3-ui/examples/plan/plan-events";
import type { TreePath } from "@elaraai/e3-types";
import { PLAN_GEOMETRY } from "../geometry.js";
import { emulateWindowScroll } from "../window-scroll.test-utils.js";
import { act, el, entry, planHarness, rowAt, settle } from "./harness.test-utils.js";

/** Whether the benchmark runs: `E3_UI_PERF=1`, as the Sheet's lens benchmark is asked for. */
const PERF = process.env["E3_UI_PERF"] === "1";

/** The presses, and how many of the first hold jobs. */
const PRESSES = 50_000;
const BUSY = 200;
/** The quarter's weeks, from Monday 5 October 2026, and the jobs of each on a busy press. */
const WEEKS = 13;
const PER_WEEK = 20;

/** e3 with the windows module deployed — only for the benchmark: its jobs are empty until it fills them. */
const h = PERF ? planHarness({ "plan/plan-windows": ex }) : undefined;

type Job = ValueTypeOf<typeof PrintJob>;

/** The benchmark's jobs, as their dataset's requests name it. */
const JOBS = (ex.planBenchJobs.path as TreePath).map((step) => step.value).join(".");

/** A Plan over the presses and the benchmark's jobs, its window and resolution given. */
function benchPlan(min: Date, max: Date, resolution: "day" | "month") {
    const key = `bench.series.${resolution}`;
    return { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const pressPages = $.const(Data.bindPaged(ex.planWindowPresses));
        const jobs = $.const(Record.bind(ex.planBenchJobs, [ex.planBenchJobsPatch]));
        const jobEntries = $.const(Data.bindPaged(ex.planBenchJobs));
        const slice = $.const(Slice.bindRecords(key, {
            job: { source: Data.bindPaged(ex.planBenchJobs, { indexes: [ex.planBenchJobsByTime, ex.planBenchJobsByPressWeek, ex.planBenchJobsByPressMonth] }), range: "start" },
        }));
        return Plan({
            axis: Plan.axis({ window: { min, max }, resolution, resolutions: ["day", "week", "month"] }),
            slice: { slice },
            // Each press's hall its second line, as `planWindows` draws it: a row of the stacked height the scrolls below count in.
            resources: { presses: Schedule.resources(pressPages, { name: "Presses", icon: "print", label: (p) => p.name, sub: (p) => some(p.hall) }) },
            events: {
                job: Schedule.events(jobs, {
                    name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", state: "state",
                    resource: { field: "press", of: "presses" }, entries: jobEntries,
                }),
            },
        });
    }))) };
}

/** A press's row. */
const pressRow = (key: string) => rowAt(entry("presses.span", key));

/** What each request kind is called in the results. */
const KINDS = ["find", "runs", "page", "rows", "within", "read"] as const;
/** The requests of the benchmark's jobs since a mark, by kind, and how many searches they asked. */
function requestsSince(mark: number): Record<string, number> {
    const since = h!.requests().filter((request) => request.dataset === JOBS).slice(mark);
    return {
        ...Object.fromEntries(KINDS.map((kind) => [kind, since.filter((request) => request.kind === kind).length])),
        searches: since.reduce((sum, request) => sum + request.searches.length, 0),
    };
}
/** How many requests of the benchmark's jobs have been made. */
const marked = () => h!.requests().filter((request) => request.dataset === JOBS).length;

describe.skipIf(!PERF)("the Plan read a cell at a time over 50,000 presses (E3_UI_PERF=1; not a CI gate)", () => {
    test("a quarter shaded, a fortnight drawn, and a scroll to presses with jobs and to presses with none: each one's time and its requests — never the jobs read whole", async () => {
        const harness = h!;
        // 50,000 presses, generated by their task from the count.
        const generating = performance.now();
        await harness.write(ex.planWindowPressCount, BigInt(PRESSES));
        await harness.run();
        const pressesMs = Math.round(performance.now() - generating);
        // The first two hundred in the presses' key order, as a window reads them.
        const keys = Array.from({ length: PRESSES }, (_u, n) => `P-${n + 1_001}`).sort(compareFor(StringType));
        const busy = keys.slice(0, BUSY);
        // Twenty jobs a week on each, four a weekday of three hours each, over the quarter's thirteen weeks.
        const jobs = new Map<string, Job>();
        const monday = Date.UTC(2026, 9, 5);
        busy.forEach((press, p) => {
            for (let w = 0; w < WEEKS; w++) {
                for (let j = 0; j < PER_WEEK; j++) {
                    const start = new Date(monday + (w * 7 + Math.floor(j / 4)) * 86_400_000 + (6 + (j % 4) * 4) * 3_600_000);
                    jobs.set(`B${String(p).padStart(3, "0")}${String(w).padStart(2, "0")}${String(j).padStart(2, "0")}`, {
                        title: `Run ${j + 1}`, start: some(start), end: some(new Date(start.getTime() + 3 * 3_600_000)), press: some(press),
                        state: variant("confirmed", null), sheets: 24_000, customer: "Alder & Finch", stock: variant("coated", null), due: some(start),
                    });
                }
            }
        });
        const filling = performance.now();
        await harness.patch(ex.planBenchJobs, jobs);
        const fillMs = Math.round(performance.now() - filling);
        const results: { phase: string; ms: number; requests: Record<string, number> }[] = [];
        const restore = emulateWindowScroll();
        try {
            // The quarter at a month: past the budget, shaded from the summary.
            let mark = marked();
            let start = performance.now();
            const quarter: RenderResult = await harness.mount(benchPlan(new Date("2026-10-01T00:00:00Z"), new Date("2027-01-01T00:00:00Z"), "month"), { storageKey: "bench.quarter" });
            await waitFor(() => expect(quarter.container.querySelector(`${pressRow(busy[0]!)} [data-cell]`)).not.toBeNull(), { timeout: 600_000 });
            results.push({ phase: "a quarter at a month: shaded", ms: Math.round(performance.now() - start), requests: requestsSince(mark) });
            await settle();
            quarter.unmount();
            // A fortnight at a day: the cells in view, drawn.
            mark = marked();
            start = performance.now();
            const fortnight: RenderResult = await harness.mount(benchPlan(new Date("2026-10-05T00:00:00Z"), new Date("2026-10-19T00:00:00Z"), "day"), { storageKey: "bench.fortnight" });
            await waitFor(() => expect(fortnight.container.querySelector(`${pressRow(busy[0]!)} [data-run]`)).not.toBeNull(), { timeout: 600_000 });
            results.push({ phase: "a fortnight at a day: drawn", ms: Math.round(performance.now() - start), requests: requestsSince(mark) });
            await settle();
            // Down to the fourth block of presses, which hold jobs.
            const ROW_PX = PLAN_GEOMETRY.default.rowStacked;
            mark = marked();
            start = performance.now();
            act(() => { window.scrollTo({ top: 160 * ROW_PX }); });
            await waitFor(() => expect(fortnight.container.querySelector(`${pressRow(busy[165]!)} ${el("data-run", "job", "B1650000")}`)).not.toBeNull(), { timeout: 600_000 });
            results.push({ phase: "a scroll to presses with jobs", ms: Math.round(performance.now() - start), requests: requestsSince(mark) });
            await settle();
            // Down to the 25,000th press, which holds none.
            mark = marked();
            start = performance.now();
            act(() => { window.scrollTo({ top: 25_000 * ROW_PX }); });
            await waitFor(() => expect(fortnight.container.querySelector(pressRow(keys[25_000]!))).not.toBeNull(), { timeout: 600_000 });
            await waitFor(() => expect(requestsSince(mark)["find"]).toBeGreaterThan(0), { timeout: 600_000 });
            await settle();
            results.push({ phase: "a scroll to presses with none", ms: Math.round(performance.now() - start), requests: requestsSince(mark) });
            fortnight.unmount();
        } finally {
            restore();
        }
        // Never the jobs whole: every read was a cell's, a source's count and its range's bounds, or the backlog's.
        expect(results.every((result) => result.requests["read"] === 0)).toBe(true);
        console.log(`[series benchmark] ${JSON.stringify({ presses: PRESSES, jobs: jobs.size, pressesMs, fillMs, results })}`);
    }, 3_600_000);
});
