/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * The Calendar's `optimise` contract (#1409, east-workspace#1622): the
 * request — the window, the run and the rail's narrowing, no row — and the
 * answer, a patch of each event kind's record by slot; the prop's refusals
 * where the page is built, and the drafts rule as it is evaluated; the
 * payload's `optimise`; and the shop's optimiser over a small window, read
 * through the jobs' interval index: the backlog scheduled into free machine
 * time, answered as a patch.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    DateTimeType, DictType, East, IntegerType, NullType, OptionType, PatchType, SortedMap, StringType, StructType, VariantType, compareFor, diffFor, equalFor,
    isTypeEqual, none, printFor, printType, some, variant, type EastIR, type EastType, type ValueTypeOf,
} from "@elaraai/east";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import e3 from "@elaraai/e3";
import { RecordSliceWhereType } from "@elaraai/east-ui/internal";
import { Calendar } from "@elaraai/e3-ui";
import { CalendarPayloadType, Func, FuncBindingType, Record, createCalendarPayload, scheduleOptimiseBinding } from "@elaraai/e3-ui/internal";
import { indexEntries } from "../index-entries.js";
import { refusingPlatform } from "../refusing-platform.js";
import * as base from "./calendar.examples.js";
import * as ex from "./optimise.examples.js";

describeEast("Calendar — the optimiser's example (#1409, #1622)", test => {
    Assert.examples(test, { calendarOptimise: ex.calendarOptimise });
}, { platformFns: TestImpl });

type Request = ValueTypeOf<typeof Calendar.Types.OptimiseRequest>;
type Job = ValueTypeOf<typeof base.CalendarJob>;
type Machine = ValueTypeOf<typeof base.CalendarMachine>;
const byString = compareFor(StringType);

/** The payload's East function over the jobs and the machines, with the props the test gives beside them. */
function payloadFn(change: Readonly<Record<string, unknown>> = {}) {
    return East.function([], CalendarPayloadType, ($) => {
        const machines = $.let(Record.bind(base.calendarMachines, []));
        const jobs = $.let(Record.bind(base.calendarJobs));
        return createCalendarPayload({
            resources: { machines: Calendar.resources(machines.read(), { name: "Machines", icon: "gears", label: row => row.name }) },
            events: { job: Calendar.events(jobs, { name: "Production", icon: "industry", title: "title", start: "start", end: "end", resource: { field: "machine", of: "machines" } }) },
            ...change,
        } as never);
    });
}

/** Builds the payload — refused, if it is, where the page is built. */
function payload(change: Readonly<Record<string, unknown>> = {}): void {
    payloadFn(change);
}

/**
 * The Calendar's `optimise` binding over its job kind, evaluated as the page is: the check its tag makes, which the Plan's
 * makes too (`scheduleOptimiseBinding`), alone — the payload around it reads the jobs as it is evaluated, which a spec reads
 * from no e3.
 *
 * @param def - The function the page binds
 * @returns The binding, once it holds
 */
function evaluated(def: unknown): ValueTypeOf<typeof FuncBindingType> {
    return East.compile(East.function([], FuncBindingType, ($) => {
        const jobs = $.let(Record.bind(base.calendarJobs));
        const optimise = $.let(Func.bind(def as never));
        const job = Calendar.events(jobs, { name: "Production", icon: "industry", title: "title", start: "start", end: "end", resource: { field: "machine", of: "machines" } });
        return scheduleOptimiseBinding("Calendar", optimise, [["job", job]]);
    }), refusingPlatform)();
}

describe("the types (#1622)", () => {
    test("OptimiseRequest is the window and what kind of period it is, the run and each rail source's narrowing, and no row; OptimiseResult(E) a patch of each event kind's record by slot", () => {
        assert.ok(isTypeEqual(Calendar.Types.OptimiseRequest, StructType({
            from: DateTimeType, to: DateTimeType, period: Calendar.Types.OptimisePeriod, run: IntegerType, slice: DictType(StringType, RecordSliceWhereType),
        })));
        assert.ok(isTypeEqual(Calendar.Types.OptimisePeriod, VariantType({ day: NullType, week: NullType, month: NullType, quarter: NullType, year: NullType })));
        assert.ok(isTypeEqual(ex.CalendarOptimiseResult, StructType({ events: StructType({ job: PatchType(ex.CalendarJobs) }) })));
    });

    test("the slots sort by name however they are listed, and a kind's record type is taken as it is, its key among it", () => {
        const Shifts = DictType(StringType, base.CalendarShift);
        assert.ok(isTypeEqual(Calendar.Types.OptimiseResult({ shift: Shifts, job: ex.CalendarJobs }), Calendar.Types.OptimiseResult({ job: ex.CalendarJobs, shift: Shifts })));
        const byNumber = Calendar.Types.OptimiseResult({ job: DictType(IntegerType, base.CalendarJob) });
        assert.ok(isTypeEqual(byNumber.fields.events, StructType({ job: PatchType(DictType(IntegerType, base.CalendarJob)) })));
    });

    test("a slot given a row rather than its record's type is refused, naming the slot", () => {
        assert.throws(() => Calendar.Types.OptimiseResult({ job: base.CalendarJob as unknown as DictType<EastType, EastType> }), {
            message: `OptimiseResult: \`job\` is given ${printType(base.CalendarJob)} — a result takes each event kind's record type, a Dict of its rows by key: { job: DictType(StringType, Row) }`,
        });
    });

    test("the payload carries the optimiser's binding, or none", () => {
        assert.ok(isTypeEqual(CalendarPayloadType.fields.optimise, OptionType(FuncBindingType)));
    });
});

describe("`optimise`: Func.bind of an e3.function from OptimiseRequest to OptimiseResult(E), each record it reads that the Calendar edits listed in its drafts", () => {
    test("the shop's optimiser is taken, its binding naming the jobs it lists and reads; without the prop the Calendar builds as before", () => {
        assert.doesNotThrow(() => payload({ optimise: Func.bind(ex.scheduleBacklog) }));
        const binding = evaluated(ex.scheduleBacklog);
        assert.ok(equalFor(FuncBindingType)(binding, {
            name: "calendar_schedule_backlog", drafts: ["calendar_jobs"], reads: ["calendar_jobs", "calendar_machines"],
        }), printFor(FuncBindingType)(binding));
        assert.doesNotThrow(() => payload());
    });

    test("one answering a patch of other rows is refused where the page is built, naming what it answers and the kinds' records", () => {
        const Other = DictType(StringType, StructType({ title: StringType, grade: StringType }));
        const otherRows = e3.function("calendar_optimise_spec_other_rows", { inputs: [], args: [Calendar.Types.OptimiseRequest], output: Calendar.Types.OptimiseResult({ job: Other }) },
            ($) => {
                const held = $.const(new Map(), Other);
                return { events: { job: East.diff(held, held) } };
            });
        assert.throws(() => payload({ optimise: Func.bind(otherRows) }), {
            message: `Calendar: \`optimise\` answers ${printType(Calendar.Types.OptimiseResult({ job: Other }))}, not Calendar.Types.OptimiseResult({ job: ${printType(ex.CalendarJobs)} }) — ` +
                "a patch of each record the Calendar edits",
        });
    });

    test("one asking the rows themselves is refused, saying a request carries no row; and a value that is no Func.bind handle naming the signature", () => {
        const AsksRows = StructType({ from: DateTimeType, to: DateTimeType, run: IntegerType, events: StructType({ job: ex.CalendarJobs }) });
        const asksRows = e3.function("calendar_optimise_spec_asks_rows", { inputs: [], args: [AsksRows], output: ex.CalendarOptimiseResult }, ($) => {
            const held = $.const(new Map(), ex.CalendarJobs);
            return { events: { job: East.diff(held, held) } };
        });
        assert.throws(() => payload({ optimise: Func.bind(asksRows) }), {
            message: `Calendar: \`optimise\` asks ${printType(AsksRows)}, not Calendar.Types.OptimiseRequest — ` +
                "a request carries the period in view, the run's number and the page's narrowing, and no row: the function reads what it needs from the workspace",
        });
        const message = "Calendar: `optimise` is Func.bind of the app's e3.function from Calendar.Types.OptimiseRequest to Calendar.Types.OptimiseResult(E), " +
            "E the event kinds' record types by slot — the period in view and the page's narrowing in, a patch of each record the Calendar edits out";
        assert.throws(() => payload({ optimise: East.value("calendar_schedule_backlog") }), { message });
        assert.throws(() => payload({ optimise: ex.scheduleBacklog }), { message });
    });

    test("one that reads the jobs through their index and does not list them in `drafts` fails the page as it is evaluated, naming the record", () => {
        const undrafted = e3.function("calendar_optimise_spec_undrafted", {
            inputs: [e3.index(base.calendarJobs.indexes.calendar_jobs_by_time)], args: [Calendar.Types.OptimiseRequest], output: ex.CalendarOptimiseResult,
        }, ($) => {
            const held = $.const(new Map(), ex.CalendarJobs);
            return { events: { job: East.diff(held, held) } };
        });
        // Built, it stands: the records are named by values, which the page holds as it runs
        assert.doesNotThrow(() => payload({ optimise: Func.bind(undrafted) }));
        assert.throws(() => evaluated(undrafted), (error: Error) => error.message.includes(
            "Calendar: `optimise` is the function 'calendar_optimise_spec_undrafted', which reads the record 'calendar_jobs' that the Calendar edits " +
            "and does not list it in `drafts` — it would plan around edits it cannot see: list it, drafts: [calendar_jobs], beside the function's inputs"));
    });

    test("one that reads only the machines, which the Calendar does not edit, needs no drafts", () => {
        const machinesOnly = e3.function("calendar_optimise_spec_machines_only", {
            inputs: [base.calendarMachines], args: [Calendar.Types.OptimiseRequest], output: ex.CalendarOptimiseResult,
        }, ($) => {
            const held = $.const(new Map(), ex.CalendarJobs);
            return { events: { job: East.diff(held, held) } };
        });
        assert.doesNotThrow(() => evaluated(machinesOnly));
    });
});

describe("the shop's optimiser over a small window, read through the jobs' interval index", () => {
    const from = new Date("2026-10-05T00:00:00Z"), to = new Date("2026-10-12T00:00:00Z");
    const machines = new SortedMap<string, Machine>([["m1", { name: "Press 1", area: "Press shop" }], ["m2", { name: "Press 2", area: "Press shop" }]], byString);
    const job = (title: string, start: Date | null, hours: number, machine: string | null): Job => ({
        title, start: start === null ? none : some(start), end: start === null ? none : some(new Date(start.getTime() + hours * 3_600_000)),
        machine: machine === null ? none : some(machine), status: variant("planned", null), hours, customer: "A customer", due: none,
    });
    const jobs = new SortedMap<string, Job>([
        ["j0", job("Last week on Press 2", new Date("2026-09-28T06:00:00Z"), 4, "m2")],
        ["j1", job("Scheduled on Press 1", new Date("2026-10-05T06:00:00Z"), 4, "m1")],
        ["j2", job("Waiting for Press 1", null, 2, "m1")],
        ["j3", job("Waiting for any press", null, 3, null)],
    ], byString);
    const request: Request = { from, to, period: variant("week", null), run: 1n, slice: new Map() };
    const optimise = (ex.scheduleBacklog.body as EastIR<EastType[], EastType>).compile([]) as unknown as
        (byTime: unknown, jobs: unknown, machines: unknown, request: Request) => ValueTypeOf<typeof ex.CalendarOptimiseResult>;
    const run = (held: SortedMap<string, Job>, asked: Request = request) =>
        optimise(indexEntries(base.calendarJobs, base.calendarJobs.indexes.calendar_jobs_by_time, held).entries, held, machines, asked);
    const patchOf = diffFor(ex.CalendarJobs);
    const samePatch = equalFor(PatchType(ex.CalendarJobs));
    const printPatch = printFor(PatchType(ex.CalendarJobs));

    test("each backlog job is scheduled in key order — on its machine after its last job in the window, or on the machine free soonest from the window's start — and the answer is their change alone", () => {
        const answer = run(jobs).events.job;
        const j2 = { ...jobs.get("j2")!, start: some(new Date("2026-10-05T10:00:00Z")), end: some(new Date("2026-10-05T12:00:00Z")) };
        // Press 2's job of last week is outside the window: Press 2 is free from the window's start
        const j3 = { ...jobs.get("j3")!, start: some(from), end: some(new Date("2026-10-05T03:00:00Z")), machine: some("m2") };
        const expected = patchOf(
            new SortedMap([["j2", jobs.get("j2")!], ["j3", jobs.get("j3")!]], byString),
            new SortedMap([["j2", j2], ["j3", j3]], byString));
        assert.ok(samePatch(answer, expected), printPatch(answer));
    });

    test("asked of a day, a job that would end past it stays waiting: no job is put outside the period in view", () => {
        // Monday alone: Press 1 is free from 10:00, Press 2 all day. A two-hour job and a three-hour one fit; one of twenty hours on Press 1 does not.
        const day: Request = { ...request, to: new Date("2026-10-06T00:00:00Z"), period: variant("day", null) };
        const held = new SortedMap<string, Job>([...jobs, ["j4", job("Too long for what is left of Monday", null, 20, "m1")]], byString);
        const answer = run(held, day).events.job;
        const j2 = { ...jobs.get("j2")!, start: some(new Date("2026-10-05T10:00:00Z")), end: some(new Date("2026-10-05T12:00:00Z")) };
        const j3 = { ...jobs.get("j3")!, start: some(from), end: some(new Date("2026-10-05T03:00:00Z")), machine: some("m2") };
        const expected = patchOf(
            new SortedMap([["j2", jobs.get("j2")!], ["j3", jobs.get("j3")!]], byString),
            new SortedMap([["j2", j2], ["j3", j3]], byString));
        assert.ok(samePatch(answer, expected), printPatch(answer));
    });

    test("a window with no backlog is answered with a patch that changes nothing", () => {
        const scheduled = new SortedMap<string, Job>([["j1", jobs.get("j1")!]], byString);
        const answer = run(scheduled).events.job;
        assert.ok(samePatch(answer, patchOf(new SortedMap([], byString), new SortedMap([], byString))), printPatch(answer));
    });
});
