/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
/**
 * The Plan's optimiser over jobs the Plan never holds whole
 * (east-workspace#1622): the print works of 2,000 presses, its jobs read a
 * cell at a time (`plan-windows.examples.tsx`), and an optimiser that reads
 * one press's jobs over the window through the jobs' series index, the Plan's
 * unsaved edits laid over them. The eye is on whatever the canvas has read:
 * the request carries no row, and the function reads what it needs.
 */
import { DictType, East, SetType, StringType, example, none, some, variant } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
import { Data, Func, Plan, Record, Schedule } from "@elaraai/e3-ui";
import { PrintJob, PrintPress } from "./plan-events.examples.js";
import { planWindowJobs, planWindowPresses } from "./plan-windows.examples.js";

/** The jobs' record type: the jobs by key. */
export const WindowJobs = DictType(StringType, PrintJob);
/** The maintenance optimiser's answer: a patch of the jobs' record. */
export const PlanWindowsOptimiseResult = Plan.Types.OptimiseResult({ job: WindowJobs });

/** The presses down for maintenance, by key: what the works' engineers set, and the optimiser clears. */
export const planPressesDown = e3.input("plan_presses_down", SetType(StringType), variant("value", new Set(["P-1003"])));

/**
 * The works' maintenance optimiser, on e3: every job on a press that is down goes back to the backlog — its start and
 * its end cleared, its press kept, so the planner sees where it was booked. It reads each such press's jobs over the
 * window through the jobs' series index, which carries each job's row — a press at a time, never the record whole —
 * with the Plan's unsaved edits laid over them: a job dragged onto a press that is down, and not saved, is among them.
 * The answer is those jobs' change alone.
 */
export const clearDownPresses = e3.function("plan_clear_down_presses", {
    inputs: [e3.index(planWindowJobs.indexes.plan_window_jobs_by_press_week), planPressesDown],
    // The Plan's unsaved edits of the jobs are laid over their index
    drafts: [planWindowJobs],
    args: [Plan.Types.OptimiseRequest],
    output: PlanWindowsOptimiseResult,
}, ($, jobsByPress, down, request) => {
    const before = $.let(new Map(), WindowJobs);
    const after = $.let(new Map(), WindowJobs);
    $.for(down, ($2, press) => {
        jobsByPress.events({ key: some(press), from: request.from, to: request.to }).each($2, ($3, job, id) => {
            $3(before.insert(id, job));
            $3(after.insert(id, {
                title: job.title, start: none, end: none, press: job.press, state: job.state,
                sheets: job.sheets, customer: job.customer, stock: job.stock, due: job.due,
            }));
        });
    });
    return { events: { job: East.diff(before, after) } };
});

export const planOptimiseWindows = example({
    inputs: [],
    description: "A Plan read a cell at a time with the Elara eye (#1622): 2,000 presses, the canvas's rows, paged (a Plan.series.resources over Data.bindPaged), their jobs read through one Slice.bindRecords rail — the interval, series and summary indexes of the jobs' record — and never held whole, and `optimise` Func.bind of the works' maintenance optimiser on e3: Plan.Types.OptimiseRequest in, the window in view, the unit the axis is zoomed to, the run number and the rail's narrowing and no row; Plan.Types.OptimiseResult({ job: WindowJobs }) out, a patch of the jobs' record. The function reads each press that is down for maintenance — an input of the workspace — and that press's jobs over the window through the jobs' series index (`jobsByPress.events({ key, from, to })`), the Plan's unsaved edits laid over them (drafts: [planWindowJobs]), and sends them back to the backlog. A job dragged onto the press that is down, and not saved, is read among them: the eye waits on nothing the canvas has read, its patch lands in the session as one edit — the bars off the press, the Backlog holding them — which one Undo reverts and Save commits with the drag.",
    keywords: ["Plan", "optimise", "Optimise", "Elara", "OptimiseRequest", "OptimiseResult", "Func.bind", "e3.function", "e3.index", "drafts", "series index", "index.series", "events", "East.diff", "patch", "backlog", "one edit", "Undo", "paged", "Data.bindPaged", "Slice.bindRecords", "cell", "large record", "e3.input", "maintenance", "Schedule.events", "Plan.series.resources", "Plan.library.backlog"],
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const presses = $.let(Data.bindPaged(planWindowPresses));
            const jobs = $.let(Record.bind(planWindowJobs));
            const jobEntries = $.let(Data.bindPaged(planWindowJobs));
            // One rail: its `job` source lists the series and the summary beside the interval index, its range the window
            // in view — the Plan reads the jobs' cells through them — and the jobs' totals, which the horizon's bars read (#1732).
            const slice = $.let(Slice.bindRecords("ex.plan.optimise.windows", {
                job: {
                    source: Data.bindPaged(planWindowJobs, {
                        indexes: ["plan_window_jobs_by_time", "plan_window_jobs_by_press_week", "plan_window_jobs_by_press_month"],
                        totals: ["plan_window_jobs_day_totals", "plan_window_jobs_week_totals", "plan_window_jobs_month_totals", "plan_window_jobs_quarter_totals", "plan_window_jobs_year_totals"],
                    }),
                    label: "Print jobs", fields: { start: { label: "Dates" } }, range: "start",
                },
            }));
            const axis = $.let(Plan.axis({
                window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-10-19T00:00:00Z") },
                resolution: "day", resolutions: ["day", "week", "month", "quarter"], now: new Date("2026-10-14T09:00:00Z"),
            }));
            // The app's optimiser: the eye calls it once per run over the plan window in view, with the jobs' unsaved edits as drafts.
            const optimise = $.let(Func.bind(clearDownPresses));
            return (
                <Plan
                    id="planOptimiseWindows"
                    axis={axis}
                    slice={{ slice }}
                    optimise={optimise}
                    // The presses are the rows, a page at a time, each a landing row its jobs land on.
                    data={presses}
                    series={[Plan.series.resources(PrintPress, {
                        key: "presses", title: "Presses", icon: "print", label: p => p.name,
                        sub: (p, key) => some(East.str`${key} · ${p.hall}`),
                    })]}
                    events={{
                        job: Schedule.events(jobs, {
                            name: "Print job", icon: "file-lines",
                            title: "title", start: "start", end: "end",
                            resource: { field: "press", of: "presses" },
                            state: "state", quantity: { field: "sheets", unit: "sheets" },
                            backlog: { duration: j => variant("hours", j.sheets.divide(8000.0)), due: j => j.due },
                            entries: jobEntries,
                        }),
                    }}
                    library={[Plan.library.backlog()]}
                    inspector
                    style={{ height: "480px" }}
                />
            );
        }}</Reactive>
    )),
});
