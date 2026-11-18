/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
/**
 * The Calendar's optimiser (#1409, east-workspace#1622): the window in view
 * in, a patch of the jobs out — `Calendar.Types.OptimiseRequest` to
 * `Calendar.Types.OptimiseResult({ job: CalendarJobs })`, an `e3.function`
 * that reads the jobs through their record's interval index, the Calendar's
 * unsaved edits laid over them — bound to the Calendar's `optimise`, which the
 * Elara eye calls once per run and whose answer lands in the session as one
 * edit.
 */
import { DateTimeType, DictType, East, StringType, example, some, variant } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { Box, Reactive, UIComponentType } from "@elaraai/east-ui";
import { Calendar, Func, Record } from "@elaraai/e3-ui";
import { CalendarJob, calendarJobs, calendarMachines } from "./calendar.examples.js";

/** The jobs' record type: the jobs by key. */
export const CalendarJobs = DictType(StringType, CalendarJob);
/** The jobs' optimiser's answer: a patch of the jobs' record. */
export const CalendarOptimiseResult = Calendar.Types.OptimiseResult({ job: CalendarJobs });

/**
 * The shop's now: where its Calendar draws the now line, and before which its optimiser schedules nothing (#1680's
 * review). A live app's optimiser reads its clock instead.
 */
export const SHOP_NOW = new Date("2026-10-01T10:15:00Z");

/**
 * The shop's optimiser, on e3: each job of the backlog — one with no start — is scheduled into free machine time, in key
 * order: on its machine where it names one, else on the machine free soonest, from when that machine is free — the
 * window's start or the shop's now, whichever is later, or the end of its last job in the window — for as long as its
 * hours take; one that would end past the window it is asked of stays waiting, so no job is put outside the period in
 * view — a day, a week or a month — and none in the past. It reads the window's jobs and the backlog through the jobs'
 * interval index and each job's row by its key, never the record whole, with the Calendar's unsaved edits laid over
 * them; every scheduled job stays as it was, and the answer is the backlog's change alone.
 */
export const scheduleBacklog = e3.function("calendar_schedule_backlog", {
    inputs: [e3.index(calendarJobs.indexes.calendar_jobs_by_time), calendarJobs, calendarMachines],
    // The Calendar's unsaved edits of the jobs are laid over them, and over their index
    drafts: [calendarJobs],
    args: [Calendar.Types.OptimiseRequest],
    output: CalendarOptimiseResult,
}, ($, jobsByTime, jobs, machines, request) => {
    // Nothing is scheduled before now: from the window's start, or now where the window starts before it.
    const now = $.const(SHOP_NOW);
    const from = $.const(East.less(request.from, now).ifElse(() => now, () => request.from));
    // When each machine is next free: from then, or past its last job in the window.
    const free = $.let(new Map(), DictType(StringType, DateTimeType));
    $.for(machines, ($2, _machine, key) => { $2(free.insert(key, from)); });
    jobsByTime.overlapping({ from: request.from, to: request.to }).each($, ($2, _carried, key) => {
        const job = $2.const(jobs.get(key));
        $2.match(job.machine, { some: ($3, machine) => {
            $3.match(job.end, { some: ($4, end) => {
                $4.if(free.has(machine).and(() => East.less(free.get(machine), end)), ($5) => { $5(free.insertOrUpdate(machine, end, (_$6, _held, later) => later)); });
            } });
        } });
    });
    // The backlog, the jobs with no start, in key order: each on its machine, or the one free soonest, from when it is free.
    const backlog = $.const(jobsByTime.unset().collect($));
    const before = $.let(new Map(), CalendarJobs);
    const after = $.let(new Map(), CalendarJobs);
    $.for(backlog, ($2, _carried, key) => {
        const job = $2.const(jobs.get(key));
        const soonest = $2.const(free.toArray(($3, at, machine) => ({ machine, at })).sort(($3, slot) => slot.at).get(0n).machine);
        const machine = $2.const(job.machine.match({
            some: ($3, named) => free.has(named).ifElse(() => named, () => soonest),
            none: ($3) => soonest,
        }));
        const start = $2.const(free.get(machine));
        // A job's hours may be fractional: its minutes, whole.
        const end = $2.const(start.addMinutes(East.Float.roundHalf(job.hours.multiply(60.0))));
        // Within the window it was asked of: a job that would end past it stays waiting.
        $2.if(East.lessEqual(end, request.to), ($3) => {
            $3(before.insert(key, job));
            $3(after.insert(key, {
                title: job.title, start: some(start), end: some(end), machine: some(machine), status: job.status,
                hours: job.hours, customer: job.customer, due: job.due,
            }));
            $3(free.insertOrUpdate(machine, end, (_$4, _held, later) => later));
        });
    });
    return { events: { job: East.diff(before, after) } };
});

export const calendarOptimise = example({
    inputs: [],
    description: "The jobs calendar with the Elara eye (#1409, #1622): `optimise` is Func.bind of the shop's optimiser on e3 — Calendar.Types.OptimiseRequest in, the window in view, the run number and the rail's narrowing and no row; Calendar.Types.OptimiseResult({ job: CalendarJobs }) out, a patch of the jobs' record. The function reads the window's jobs and the backlog through the jobs' interval index and each job by its key, the Calendar's unsaved edits laid over them (drafts: [calendarJobs]), and schedules each backlog job into its machine's free time from the shop's now, the now line's, one that would end past the window left waiting. A click on the eye runs it once over the window; its patch lands in the session as one edit, which one Undo reverts and Save commits with everything else.",
    keywords: ["Calendar", "optimise", "Optimise", "Elara", "OptimiseRequest", "OptimiseResult", "Func.bind", "e3.function", "e3.index", "drafts", "overlapping", "unset", "East.diff", "patch", "backlog", "one edit", "Undo", "Record.bind", "Schedule.events", "Schedule.resources"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const machines = $.let(Record.bind(calendarMachines, []));
        const jobs = $.let(Record.bind(calendarJobs));
        // The app's optimiser: the eye calls it once per run over the window in view, with the jobs' unsaved edits as drafts.
        const optimise = $.let(Func.bind(scheduleBacklog));
        return <Box height="680px"><Calendar id="calendarOptimise" inspector view={{ period: "week", date: new Date("2026-10-01T00:00:00Z") }} now={SHOP_NOW}
            optimise={optimise}
            resources={{ machines: Calendar.resources(machines.read(), { name: "Machines", icon: "gears", label: row => row.name }) }}
            events={{ job: Calendar.events(jobs, { name: "Production", icon: "industry", title: "title", start: "start", end: "end", resource: { field: "machine", of: "machines" },
                backlog: { duration: row => variant("hours", row.hours), due: row => row.due } }) }}
            library={[Calendar.library.backlog()]} />
        </Box>;
    }}</Reactive>),
});
