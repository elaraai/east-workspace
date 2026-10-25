/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
/**
 * The Plan's optimiser (#1409, `Optimise Spec.md` §3): the print works' window
 * in, the window out — `Plan.Types.OptimiseRequest({ job }, { presses })` to
 * `Plan.Types.OptimiseResult({ job })`, an `e3.function` — bound to the Plan's
 * `optimise`, which the Elara eye calls once per run and whose answer lands in
 * the session as one edit.
 */
import { DateTimeType, DictType, East, StringType, example, some, variant } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { Reactive, UIComponentType } from "@elaraai/east-ui";
import { Func, Plan, Record, Schedule } from "@elaraai/e3-ui";
import { PrintJob, PrintPress, planEventJobs, planEventJobsPatch, planPrintCustomers, planPrintPresses } from "./plan-events.examples.js";

/** The jobs' optimiser's request: the window's jobs and the backlog by key, the presses beside them. */
export const PlanOptimiseRequest = Plan.Types.OptimiseRequest({ job: PrintJob }, { presses: PrintPress });
/** The jobs' optimiser's answer: the jobs, complete. */
export const PlanOptimiseResult = Plan.Types.OptimiseResult({ job: PrintJob });

/**
 * The print works' optimiser's body: each job of the backlog — one with no start — is placed on a press, in key order: on
 * its press where it names one, else on the press free soonest, from when that press is free — the window's start, or the
 * end of its last placed job — for as long as its sheets take at 8,000 an hour; every placed job stays as it was.
 */
export const planOptimiseBody = East.function([PlanOptimiseRequest], PlanOptimiseResult, ($, req) => {
    const planned = $.let(new Map(), DictType(StringType, PrintJob));
    // When each press is next free: the window's start, or past its last placed job.
    const free = $.let(new Map(), DictType(StringType, DateTimeType));
    $.for(req.resources.presses, ($2, _press, key) => { $2(free.insert(key, req.from)); });
    $.for(req.events.job, ($2, job, key) => {
        $2(planned.insert(key, job));
        $2.match(job.press, { some: ($3, press) => {
            $3.match(job.end, { some: ($4, end) => {
                $4.if(free.has(press).and(() => East.less(free.get(press), end)), ($5) => { $5(free.insertOrUpdate(press, end, (_$6, _held, later) => later)); });
            } });
        } });
    });
    // The backlog in key order: each job on its press, or the one free soonest, from when it is free.
    const backlog = $.const(req.events.job.toArray(($2, job, key) => ({ key, job })).filter(($2, entry) => entry.job.start.hasTag("none")));
    $.for(backlog, ($2, entry) => {
        const soonest = $2.const(free.toArray(($3, at, key) => ({ key, at })).sort(($3, slot) => slot.at).get(0n).key);
        const press = $2.const(entry.job.press.match({
            some: ($3, named) => free.has(named).ifElse(() => named, () => soonest),
            none: ($3) => soonest,
        }));
        const start = $2.const(free.get(press));
        // A job's hours on a press are its sheets at 8,000 an hour: its minutes, whole.
        const end = $2.const(start.addMinutes(East.Float.roundHalf(entry.job.sheets.divide(8000.0).multiply(60.0))));
        $2(planned.insertOrUpdate(entry.key, {
            title: entry.job.title, start: some(start), end: some(end), press: some(press), state: entry.job.state,
            sheets: entry.job.sheets, customer: entry.job.customer, stock: entry.job.stock, due: entry.job.due,
        }, (_$3, _waiting, placed) => placed));
        $2(free.insertOrUpdate(press, end, (_$3, _held, later) => later));
    });
    return { events: { job: planned } };
});
/** The print works' optimiser, on e3: the backlog placed on the presses' free time. */
export const placeJobs = e3.function("plan_place_jobs", planOptimiseBody);

export const planOptimise = example({
    inputs: [],
    description: "The smallest builder with the Elara eye (#1409): `optimise` is Func.bind of the print works' optimiser on e3 — Plan.Types.OptimiseRequest({ job: PrintJob }, { presses: PrintPress }) in, the plan window in view, the run number, the window's jobs and the backlog by key, the presses beside them; Plan.Types.OptimiseResult({ job: PrintJob }) out, the jobs complete, each backlog job placed on a press's free time. A click on the eye runs it once over the window; the result lands in the session as one edit, which one Undo reverts and Save commits with everything else.",
    keywords: ["Plan", "optimise", "Optimise", "Elara", "OptimiseRequest", "OptimiseResult", "Func.bind", "e3.function", "backlog", "one edit", "Undo", "Record.bind", "Schedule.events", "Schedule.resources", "Plan.library.backlog"],
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const presses = $.let(Record.bind(planPrintPresses, []));
            const jobs = $.let(Record.bind(planEventJobs, [planEventJobsPatch]));
            const customers = $.let(Record.bind(planPrintCustomers, []));
            const axis = $.let(Plan.axis({
                window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-11-02T00:00:00Z") },
                resolution: "day", now: new Date("2026-10-14T09:00:00Z"),
            }));
            // The app's optimiser: the eye calls it once per run over the plan window in view, and its answer is one edit.
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
