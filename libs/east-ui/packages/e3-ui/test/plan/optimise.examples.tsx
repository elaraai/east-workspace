/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
/**
 * The Plan's optimiser (#1409, east-workspace#1622): the window in view in, a
 * patch of the jobs out — `Plan.Types.OptimiseRequest` to
 * `Plan.Types.OptimiseResult({ job: PrintJobs })`, an `e3.function` that reads
 * the jobs through their record's interval index, the Plan's unsaved edits
 * laid over them — bound to the Plan's `optimise`, which the Elara eye calls
 * once per run and whose answer lands in the session as one edit.
 */
import { DateTimeType, DictType, East, StringType, example, some, variant } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { Reactive, UIComponentType } from "@elaraai/east-ui";
import { Func, Plan, Record, Schedule } from "@elaraai/e3-ui";
import { PrintJob, planEventJobs, planPrintCustomers, planPrintPresses } from "./plan-events.examples.js";

/** The jobs' record type: the jobs by key. */
export const PrintJobs = DictType(StringType, PrintJob);
/** The jobs' optimiser's answer: a patch of the jobs' record. */
export const PlanOptimiseResult = Plan.Types.OptimiseResult({ job: PrintJobs });

/**
 * The print works' optimiser, on e3: each job of the backlog — one with no start — is placed on a press, in key order: on
 * its press where it names one, else on the press free soonest, from when that press is free — the window's start, or the
 * end of its last job in the window — for as long as its sheets take at 8,000 an hour; one that would end past the window
 * it is asked of stays waiting, so no job is put outside it. It reads the window's jobs and the backlog through the jobs'
 * interval index and each job's row by its key, never the record whole, with the Plan's unsaved edits laid over them;
 * every placed job stays as it was, and the answer is the backlog's change alone.
 */
export const placeJobs = e3.function("plan_place_jobs", {
    inputs: [e3.index(planEventJobs.indexes.plan_event_jobs_by_time), planEventJobs, planPrintPresses],
    // The Plan's unsaved edits of the jobs are laid over them, and over their index
    drafts: [planEventJobs],
    args: [Plan.Types.OptimiseRequest],
    output: PlanOptimiseResult,
}, ($, jobsByTime, jobs, presses, request) => {
    // When each press is next free: the window's start, or past its last job in the window.
    const free = $.let(new Map(), DictType(StringType, DateTimeType));
    $.for(presses, ($2, _press, key) => { $2(free.insert(key, request.from)); });
    jobsByTime.overlapping({ from: request.from, to: request.to }).each($, ($2, _carried, key) => {
        const job = $2.const(jobs.get(key));
        $2.match(job.press, { some: ($3, press) => {
            $3.match(job.end, { some: ($4, end) => {
                $4.if(free.has(press).and(() => East.less(free.get(press), end)), ($5) => { $5(free.insertOrUpdate(press, end, (_$6, _held, later) => later)); });
            } });
        } });
    });
    // The backlog, the jobs with no start, in key order: each on its press, or the one free soonest, from when it is free.
    const backlog = $.const(jobsByTime.unset().collect($));
    const before = $.let(new Map(), PrintJobs);
    const after = $.let(new Map(), PrintJobs);
    $.for(backlog, ($2, _carried, key) => {
        const job = $2.const(jobs.get(key));
        const soonest = $2.const(free.toArray(($3, at, press) => ({ press, at })).sort(($3, slot) => slot.at).get(0n).press);
        const press = $2.const(job.press.match({
            some: ($3, named) => free.has(named).ifElse(() => named, () => soonest),
            none: ($3) => soonest,
        }));
        const start = $2.const(free.get(press));
        // A job's hours on a press are its sheets at 8,000 an hour: its minutes, whole.
        const end = $2.const(start.addMinutes(East.Float.roundHalf(job.sheets.divide(8000.0).multiply(60.0))));
        // Within the window it was asked of: a job that would end past it stays waiting.
        $2.if(East.lessEqual(end, request.to), ($3) => {
            $3(before.insert(key, job));
            $3(after.insert(key, {
                title: job.title, start: some(start), end: some(end), press: some(press), state: job.state,
                sheets: job.sheets, customer: job.customer, stock: job.stock, due: job.due,
            }));
            $3(free.insertOrUpdate(press, end, (_$4, _held, later) => later));
        });
    });
    return { events: { job: East.diff(before, after) } };
});

export const planOptimise = example({
    inputs: [],
    description: "The smallest builder with the Elara eye (#1409, #1622): `optimise` is Func.bind of the print works' optimiser on e3 — Plan.Types.OptimiseRequest in, the plan window in view, the run number and the rail's narrowing and no row; Plan.Types.OptimiseResult({ job: PrintJobs }) out, a patch of the jobs' record. The function reads the window's jobs and the backlog through the jobs' interval index and each job by its key, the Plan's unsaved edits laid over them (drafts: [planEventJobs]), and places each backlog job on a press's free time, one that would end past the window left waiting. A click on the eye runs it once over the window; its patch lands in the session as one edit, which one Undo reverts and Save commits with everything else.",
    keywords: ["Plan", "optimise", "Optimise", "Elara", "OptimiseRequest", "OptimiseResult", "Func.bind", "e3.function", "e3.index", "drafts", "overlapping", "unset", "East.diff", "patch", "backlog", "one edit", "Undo", "Record.bind", "Schedule.events", "Schedule.resources", "Plan.library.backlog"],
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const presses = $.let(Record.bind(planPrintPresses, []));
            const jobs = $.let(Record.bind(planEventJobs));
            const customers = $.let(Record.bind(planPrintCustomers, []));
            const axis = $.let(Plan.axis({
                window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-11-02T00:00:00Z") },
                resolution: "day", now: new Date("2026-10-14T09:00:00Z"),
            }));
            // The app's optimiser: the eye calls it once per run over the plan window in view, with the jobs' unsaved edits as drafts.
            const optimise = $.let(Func.bind(placeJobs));
            return (
                <Plan
                    id="planOptimise"
                    axis={axis}
                    optimise={optimise}
                    resources={{ presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: p => p.name }) }}
                    events={{
                        job: Schedule.events(jobs, {
                            name: "Print job", icon: "file-lines",
                            title: "title", start: "start", end: "end",
                            resource: { field: "press", of: "presses" },
                            state: "state",
                            backlog: { duration: j => variant("hours", j.sheets.divide(8000.0)), due: j => j.due },
                            fields: {
                                customer: Schedule.field.text({ label: "Customer" }),
                                stock: Schedule.field.select({ labels: { coated: "Coated", uncoated: "Uncoated", board: "Board" } }),
                            },
                        }),
                    }}
                    library={[
                        Plan.library.backlog(),
                        Plan.library.tab(customers.read(), {
                            name: "Customers", icon: "building",
                            label: c => c.name, meta: c => some(c.trade), group: c => c.district,
                            drop: c => Schedule.patch(PrintJob, { customer: c.name }),
                        }),
                    ]}
                    inspector
                />
            );
        }}</Reactive>
    )),
});
