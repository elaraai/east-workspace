/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
/**
 * The Calendar's optimiser (#1409, `Optimise Spec.md` §3): the shop's window
 * in, the window out — `Calendar.Types.OptimiseRequest({ job }, { machines })`
 * to `Calendar.Types.OptimiseResult({ job })`, an `e3.function` — bound to the
 * Calendar's `optimise`, which the Elara eye calls once per run and whose
 * answer lands in the session as one edit.
 */
import { DateTimeType, DictType, East, StringType, example, some, variant } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { Box, Reactive, UIComponentType } from "@elaraai/east-ui";
import { Calendar, Func, Record } from "@elaraai/e3-ui";
import { CalendarJob, CalendarMachine, calendarJobs, calendarJobsPatch, calendarMachines } from "./calendar.examples.js";

/** The jobs' optimiser's request: the window's jobs and the backlog by key, the machines beside them. */
export const CalendarOptimiseRequest = Calendar.Types.OptimiseRequest({ job: CalendarJob }, { machines: CalendarMachine });
/** The jobs' optimiser's answer: the jobs, complete. */
export const CalendarOptimiseResult = Calendar.Types.OptimiseResult({ job: CalendarJob });

/**
 * The shop's optimiser's body: each job of the backlog — one with no start — is scheduled into free machine time, in key
 * order: on its machine where it names one, else on the machine free soonest, from when that machine is free — the
 * window's start, or the end of its last scheduled job — for as long as its hours take; every scheduled job stays as it was.
 */
export const calendarOptimiseBody = East.function([CalendarOptimiseRequest], CalendarOptimiseResult, ($, req) => {
    const planned = $.let(new Map(), DictType(StringType, CalendarJob));
    // When each machine is next free: the window's start, or past its last scheduled job.
    const free = $.let(new Map(), DictType(StringType, DateTimeType));
    $.for(req.resources.machines, ($2, _machine, key) => { $2(free.insert(key, req.from)); });
    $.for(req.events.job, ($2, job, key) => {
        $2(planned.insert(key, job));
        $2.match(job.machine, { some: ($3, machine) => {
            $3.match(job.end, { some: ($4, end) => {
                $4.if(free.has(machine).and(() => East.less(free.get(machine), end)), ($5) => { $5(free.insertOrUpdate(machine, end, (_$6, _held, later) => later)); });
            } });
        } });
    });
    // The backlog in key order: each job on its machine, or the one free soonest, from when it is free.
    const backlog = $.const(req.events.job.toArray(($2, job, key) => ({ key, job })).filter(($2, entry) => entry.job.start.hasTag("none")));
    $.for(backlog, ($2, entry) => {
        const soonest = $2.const(free.toArray(($3, at, key) => ({ key, at })).sort(($3, slot) => slot.at).get(0n).key);
        const machine = $2.const(entry.job.machine.match({
            some: ($3, named) => free.has(named).ifElse(() => named, () => soonest),
            none: ($3) => soonest,
        }));
        const start = $2.const(free.get(machine));
        // A job's hours may be fractional: its minutes, whole.
        const end = $2.const(start.addMinutes(East.Float.roundHalf(entry.job.hours.multiply(60.0))));
        $2(planned.insertOrUpdate(entry.key, {
            title: entry.job.title, start: some(start), end: some(end), machine: some(machine), status: entry.job.status,
            hours: entry.job.hours, customer: entry.job.customer, due: entry.job.due,
        }, (_$3, _waiting, scheduled) => scheduled));
        $2(free.insertOrUpdate(machine, end, (_$3, _held, later) => later));
    });
    return { events: { job: planned } };
});
/** The shop's optimiser, on e3: the backlog scheduled into free machine time. */
export const scheduleBacklog = e3.function("calendar_schedule_backlog", calendarOptimiseBody);

export const calendarOptimise = example({
    inputs: [],
    description: "The jobs calendar with the Elara eye (#1409): `optimise` is Func.bind of the shop's optimiser on e3 — Calendar.Types.OptimiseRequest({ job: CalendarJob }, { machines: CalendarMachine }) in, the window in view, the run number, the window's jobs and the backlog by key, the machines beside them; Calendar.Types.OptimiseResult({ job: CalendarJob }) out, the jobs complete, each backlog job scheduled into its machine's free time. A click on the eye runs it once over the window; the result lands in the session as one edit, which one Undo reverts and Save commits with everything else.",
    keywords: ["Calendar", "optimise", "Optimise", "Elara", "OptimiseRequest", "OptimiseResult", "Func.bind", "e3.function", "backlog", "one edit", "Undo", "Record.bind", "Schedule.events", "Schedule.resources"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const machines = $.let(Record.bind(calendarMachines, []));
        const jobs = $.let(Record.bind(calendarJobs, [calendarJobsPatch]));
        // The app's optimiser: the eye calls it once per run over the window in view, and its answer is one edit.
        const optimise = $.let(Func.bind(scheduleBacklog));
        return <Box height="680px"><Calendar id="calendarOptimise" inspector view={{ period: "week", date: new Date("2026-10-01T00:00:00Z") }} now={new Date("2026-10-01T10:15:00Z")}
            optimise={optimise}
            resources={{ machines: Calendar.resources(machines.read(), { name: "Machines", icon: "gears", label: row => row.name }) }}
            events={{ job: Calendar.events(jobs, { name: "Production", icon: "industry", title: "title", start: "start", end: "end", resource: { field: "machine", of: "machines" },
                backlog: { duration: row => variant("hours", row.hours), due: row => row.due } }) }}
            library={[Calendar.library.backlog()]} />
        </Box>;
    }}</Reactive>),
});
