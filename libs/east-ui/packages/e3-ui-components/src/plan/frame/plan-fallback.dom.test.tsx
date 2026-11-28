/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Plan>`'s columns falling back to a coarser period by themselves (#1799),
 * over the windows example's records on e3 itself (`planWindows`): the 2,000
 * presses paged, and the jobs on them read a cell at a time through their
 * series index, a week at a time, beside a summary of each press's month.
 * Another planner books 10,001 hour-long proofs on fifty presses further down
 * the page — past what a view of them may draw — while the fortnight at the
 * top draws its jobs at days.
 *
 * - A scroll into the busy presses changes the columns once: their days show
 *   nothing a month's summary can shade, so the columns take months, the
 *   range as it is, and nothing is said.
 * - They stay months: back at the top, and through a pan of the window — the
 *   columns never go finer and back as a viewer moves through such a time.
 * - A period pressed is tried again: days, over a range whose presses in view
 *   hold few jobs, draw their bars at days.
 *
 * The rule that names the period is `shared/schedule/fallback-period.test.ts`'s,
 * the window hold that keeps it `root/window.test.ts`'s, and the canvas's part
 * `root/fallback.test.ts`'s; a range at the fortnight whose rows are past the cap
 * from the first, and a kind no period shows, are `plan-cap.dom.test.tsx`'s.
 */

import { describe, test, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { East, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { Data, Plan, Record, Schedule } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/plan/plan-windows";
import { PrintPress, type PrintJob } from "@elaraai/e3-ui/examples/plan/plan-events";
import { PLAN_GEOMETRY } from "../geometry.js";
import { emulateWindowScroll, scrollStopped } from "../window-scroll.test-utils.js";
import { act, el, entry, planHarness, rowAt, settle, slot, zoomTo } from "./harness.test-utils.js";

const h = planHarness({ "plan/plan-windows": ex });

type Job = ValueTypeOf<typeof PrintJob>;

const FIRST = new Date("2026-10-05T00:00:00Z");
const TWO_WEEKS = new Date("2026-10-19T00:00:00Z");
const NOW = new Date("2026-10-14T09:00:00Z");
const HOUR = 3_600_000;

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

/**
 * The windows example's Plan, unbounded — jsdom lays nothing out, so a bounded canvas would mount no row: its jobs
 * read a cell at a time through the series index its `job` source lists beside the interval index and the summary.
 */
const seriesPlan = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const pressPages = $.const(Data.bindPaged(ex.planWindowPresses));
    const jobs = $.const(Record.bind(ex.planWindowJobs, ["patch"]));
    const jobEntries = $.const(Data.bindPaged(ex.planWindowJobs));
    const slice = $.const(Slice.bindRecords("plan.fallback.dom", {
        job: {
            source: Data.bindPaged(ex.planWindowJobs, { indexes: ["plan_window_jobs_by_time", "plan_window_jobs_by_press_week", "plan_window_jobs_by_press_month"] }),
            fields: { start: { label: "Dates" } }, range: "start",
        },
    }));
    return Plan({
        axis: Plan.axis({ window: { min: FIRST, max: TWO_WEEKS }, resolution: "day", resolutions: ["day", "week", "month", "quarter"], now: NOW }),
        slice: { slice },
        // The presses are the canvas's rows, paged (#1541).
        data: pressPages,
        series: [Plan.series.resources(PrintPress, { key: "presses", title: "Presses", icon: "print", label: (p) => p.name, sub: (p) => some(p.hall) })],
        events: {
            job: Schedule.events(jobs, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
                resource: { field: "press", of: "presses" }, state: "state",
                backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
                entries: jobEntries,
            }),
        },
    });
}))) };

/** A press's row: its own, which its jobs draw on. */
const pressRow = (key: string) => entry("presses", key);
/** A press's row, drawn. */
const rowOf = (c: HTMLElement, press: string) => c.querySelector<HTMLElement>(rowAt(pressRow(press)));
/** A job's bar on a press's row. */
const bar = (c: HTMLElement, key: string, press: string) => c.querySelector<HTMLElement>(`${rowAt(pressRow(press))} ${el("data-run", "job", key)}`);
/** Every bar the canvas draws, on any row. */
const barsDrawn = (c: HTMLElement) => slot(c, "main")!.querySelectorAll("[data-plan-row] [data-run]").length;
/** The period the columns take, as the toolbar's segment shows it pressed. */
const periodShown = (c: HTMLElement) => slot(c, "toolbar")!.querySelector('[data-toolbar-item="resolution"] [aria-checked="true"]')?.textContent ?? null;
/** Any banner the frame draws: none, while the columns show what the rows hold. */
const anyBanner = (c: HTMLElement) => slot(c, "banners")?.querySelector("[data-plan-banner]") ?? null;
/** What a press's row says of October: its share booked, from the summary. */
const october = (c: HTMLElement, press: string) => [...rowOf(c, press)?.querySelectorAll<HTMLElement>("[data-cell]") ?? []]
    .map((cell) => cell.getAttribute("aria-label") ?? "").find((name) => name.startsWith("Oct")) ?? null;
/** A press's row height, at the default density: a two-line gutter, its hall the second line. */
const ROW_PX = PLAN_GEOMETRY.default.rowStacked;

/** Another planner's 10,001 hour-long proofs on the fifty presses from Press 1101, each press's an hour apart from the fortnight's start. */
async function bookProofsDown(): Promise<void> {
    const jobs = new Map((await h.read(ex.planWindowJobs)) as ReadonlyMap<string, Job>);
    const proof = jobs.get("W-0001")!;
    for (let i = 0; i < 10_001; i++) {
        const start = new Date(FIRST.getTime() + Math.floor(i / 50) * HOUR);
        jobs.set(`X-${String(i).padStart(5, "0")}`, {
            ...proof, title: `Proof ${i}`, press: some(`P-${1101 + (i % 50)}`), start: some(start), end: some(new Date(start.getTime() + HOUR)),
        });
    }
    await h.patch(ex.planWindowJobs, jobs);
}

describe("the columns falling back to a coarser period by themselves (#1799)", () => {
    test("a scroll into presses past the cap takes months once, nothing said; they stay months back at the top and through a pan; days pressed are tried again", async () => {
        await bookProofsDown();
        const restore = emulateWindowScroll();
        try {
            const { container: c } = await h.mount(seriesPlan);
            await settle();
            // At the top the fortnight's jobs draw at days: the busy presses are none of the rows in view.
            await waitFor(() => expect(bar(c, "W-0001", "P-1001")).not.toBeNull(), { timeout: 20_000 });
            expect(periodShown(c)).toBe("DAY");
            expect(anyBanner(c)).toBeNull();

            // Down to Press 1101: its block's presses hold more proofs than a view of them may draw, and their days show
            // nothing a month's summary shades — the columns take months, the fortnight as it is, and nothing is said.
            act(() => { window.scrollTo({ top: 100 * ROW_PX }); });
            await scrollStopped();
            await settle();
            await waitFor(() => expect(periodShown(c)).toBe("MONTH"), { timeout: 20_000 });
            await waitFor(() => expect(october(c, "P-1101")).toMatch(/\b[1-9]\d*% booked/), { timeout: 20_000 });
            expect(anyBanner(c)).toBeNull();
            expect(rowOf(c, "P-1101")!.querySelectorAll("[data-nodata]")).toHaveLength(0);
            expect(barsDrawn(c)).toBe(0);

            // Back up to the top: the columns stay months — never finer and back — each press shaded from the summary.
            act(() => { window.scrollTo({ top: 0 }); });
            await scrollStopped();
            await settle();
            await waitFor(() => expect(october(c, "P-1001")).toMatch(/\b[1-9]\d*% booked/), { timeout: 20_000 });
            expect(periodShown(c)).toBe("MONTH");
            expect(anyBanner(c)).toBeNull();
            expect(barsDrawn(c)).toBe(0);

            // A pan of the window: a month on, as many months long — the columns stay months.
            await act(async () => { fireEvent.keyDown(rowOf(c, "P-1001")!, { key: "]" }); });
            await settle();
            expect(periodShown(c)).toBe("MONTH");
            expect(anyBanner(c)).toBeNull();

            // Days pressed are tried again: the presses in view hold few jobs there, so the columns are days, with nothing said.
            await zoomTo(c, "day");
            await settle();
            await waitFor(() => expect(periodShown(c)).toBe("DAY"), { timeout: 20_000 });
            expect(anyBanner(c)).toBeNull();
        } finally {
            restore();
        }
    });
});
