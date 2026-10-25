/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * The Calendar's `optimise` contract (#1409, #1411, `Optimise Spec.md` §4,
 * §5): the request and result types over the kinds' rows by slot, the prop's
 * refusals, the payload's `optimise`, and the shop's optimiser over a small
 * window: the backlog scheduled into free machine time.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    DateTimeType, DictType, East, IntegerType, OptionType, SortedMap, StringType, StructType, compareFor, isTypeEqual, none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import e3 from "@elaraai/e3";
import { Calendar } from "@elaraai/e3-ui";
import { CalendarPayloadType, Func, FuncBindingType, Record, createCalendarPayload } from "@elaraai/e3-ui/internal";
import * as base from "./calendar.examples.js";
import * as ex from "./optimise.examples.js";

describeEast("Calendar — the optimiser's example (#1409)", test => {
    Assert.examples(test, { calendarOptimise: ex.calendarOptimise });
}, { platformFns: TestImpl });

type Request = ValueTypeOf<typeof ex.CalendarOptimiseRequest>;
type Job = ValueTypeOf<typeof base.CalendarJob>;
const byString = compareFor(StringType);

/** Builds a payload's East function over the jobs and the machines, the props the test gives beside them — refused, if it is, as it is built. */
function payload(change: Readonly<Record<string, unknown>> = {}): void {
    East.function([], CalendarPayloadType, ($) => {
        const machines = $.let(Record.bind(base.calendarMachines, []));
        const jobs = $.let(Record.bind(base.calendarJobs, [base.calendarJobsPatch]));
        return createCalendarPayload({
            resources: { machines: Calendar.resources(machines.read(), { name: "Machines", icon: "gears", label: row => row.name }) },
            events: { job: Calendar.events(jobs, { name: "Production", icon: "industry", title: "title", start: "start", end: "end", resource: { field: "machine", of: "machines" } }) },
            ...change,
        } as never);
    });
}

describe("the types (§5.1)", () => {
    test("OptimiseRequest(E, S) is the window, the run, each event kind's rows by slot and by key, and each resource kind's; OptimiseResult(E) the events", () => {
        assert.ok(isTypeEqual(ex.CalendarOptimiseRequest, StructType({
            from: DateTimeType, to: DateTimeType, run: IntegerType,
            events: StructType({ job: DictType(StringType, base.CalendarJob) }), resources: StructType({ machines: DictType(StringType, base.CalendarMachine) }),
        })));
        assert.ok(isTypeEqual(ex.CalendarOptimiseResult, StructType({ events: StructType({ job: DictType(StringType, base.CalendarJob) }) })));
    });

    test("the slots sort by name however they are listed, a kind's record type is taken as it is, and the resources may be left out", () => {
        assert.ok(isTypeEqual(Calendar.Types.OptimiseRequest({ shift: base.CalendarShift, job: base.CalendarJob }), Calendar.Types.OptimiseRequest({ job: base.CalendarJob, shift: base.CalendarShift })));
        const byNumber = Calendar.Types.OptimiseRequest({ job: DictType(IntegerType, base.CalendarJob) });
        assert.ok(isTypeEqual(byNumber.fields.events, StructType({ job: DictType(IntegerType, base.CalendarJob) })));
        assert.ok(isTypeEqual(byNumber.fields.resources, StructType({})));
        assert.equal(isTypeEqual(Calendar.Types.OptimiseRequest({ job: base.CalendarJob }), ex.CalendarOptimiseRequest), false, "the machines are part of the request");
        assert.ok(isTypeEqual(Calendar.Types.OptimiseResult({ job: base.CalendarJob }), ex.CalendarOptimiseResult));
    });

    test("the payload carries the optimiser's binding, or none (§5.2)", () => {
        assert.ok(isTypeEqual(CalendarPayloadType.fields.optimise, OptionType(FuncBindingType)));
    });
});

describe("`optimise` (§4): Func.bind of an e3.function from OptimiseRequest(E, S) to OptimiseResult(E), refused otherwise naming the kinds' rows", () => {
    test("the shop's optimiser is taken; without the prop the Calendar builds as before", () => {
        assert.doesNotThrow(() => payload({ optimise: Func.bind(ex.scheduleBacklog) }));
        assert.doesNotThrow(() => payload());
    });

    test("one bound over the same slots' other rows is refused naming both", () => {
        const Other = StructType({ title: StringType, grade: StringType });
        const otherRows = e3.function("calendar_optimise_spec_other_rows", East.function(
            [Calendar.Types.OptimiseRequest({ job: Other }, { machines: base.CalendarMachine })], Calendar.Types.OptimiseResult({ job: Other }),
            (_$, req) => ({ events: { job: req.events.job } })));
        assert.throws(() => payload({ optimise: Func.bind(otherRows) }),
            /^Error: Calendar: `optimise` is bound over event rows \{ job: \.Struct \[.*grade.*\] \}, \{ machines: \.Struct \[.*area.*\] \}, and the kinds' rows are \{ job: \.Struct \[.*customer.*\] \}, \{ machines: \.Struct \[.*area.*\] \} — bind an optimiser over Calendar\.Types\.OptimiseRequest of the kinds' row types by slot$/);
    });

    test("one asking or answering another type is refused naming it, and a value that is no Func.bind handle naming the signature", () => {
        const otherSlots = e3.function("calendar_optimise_spec_other_slots", East.function(
            [Calendar.Types.OptimiseRequest({ jobs: base.CalendarJob }, { machines: base.CalendarMachine })], ex.CalendarOptimiseResult,
            (_$, req) => ({ events: { job: req.events.jobs } })));
        assert.throws(() => payload({ optimise: Func.bind(otherSlots) }), /^Error: Calendar: `optimise` asks \.Struct \[.*jobs.*\], not Calendar\.Types\.OptimiseRequest\(\{ job: \.Struct \[.*\] \}, \{ machines: \.Struct \[.*\] \}\)$/);
        const answersText = e3.function("calendar_optimise_spec_answers_text", East.function([ex.CalendarOptimiseRequest], StringType, () => "nothing"));
        assert.throws(() => payload({ optimise: Func.bind(answersText) }), /^Error: Calendar: `optimise` answers \.String, not Calendar\.Types\.OptimiseResult\(\{ job: \.Struct \[/);
        const notBound = /^Error: Calendar: `optimise` is Func\.bind of the app's e3\.function from Calendar\.Types\.OptimiseRequest\(E, S\) to Calendar\.Types\.OptimiseResult\(E\), E the event kinds' row types by slot and S the resource kinds' — the period's rows in, the same rows out, complete$/;
        assert.throws(() => payload({ optimise: East.value("calendar_schedule_backlog") }), notBound);
        assert.throws(() => payload({ optimise: ex.calendarOptimiseBody }), notBound);
    });
});

describe("the shop's optimiser over a small window (§3.1)", () => {
    const from = new Date("2026-10-05T00:00:00Z"), to = new Date("2026-10-12T00:00:00Z");
    const machines = new SortedMap<string, ValueTypeOf<typeof base.CalendarMachine>>([["m1", { name: "Press 1", area: "Press shop" }], ["m2", { name: "Press 2", area: "Press shop" }]], byString);
    const job = (title: string, start: Date | null, hours: number, machine: string | null): Job => ({
        title, start: start === null ? none : some(start), end: start === null ? none : some(new Date(start.getTime() + hours * 3_600_000)),
        machine: machine === null ? none : some(machine), status: variant("planned", null), hours, customer: "A customer", due: none,
    });
    const jobs = new SortedMap<string, Job>([
        ["j1", job("Scheduled on Press 1", new Date("2026-10-05T06:00:00Z"), 4, "m1")],
        ["j2", job("Waiting for Press 1", null, 2, "m1")],
        ["j3", job("Waiting for any press", null, 3, null)],
    ], byString);
    const request: Request = { from, to, run: 1n, events: { job: jobs }, resources: { machines } };
    const optimise = East.compile(ex.calendarOptimiseBody, []);

    test("each backlog job is scheduled in key order: on its machine after its last job, or on the machine free soonest from the window's start", () => {
        const result = optimise(request);
        assert.deepEqual([...result.events.job.keys()], ["j1", "j2", "j3"]);
        assert.deepEqual(result.events.job.get("j1"), jobs.get("j1"), "a scheduled job stays as it is");
        const j2 = result.events.job.get("j2")!;
        assert.deepEqual([j2.machine, j2.start, j2.end], [some("m1"), some(new Date("2026-10-05T10:00:00Z")), some(new Date("2026-10-05T12:00:00Z"))]);
        const j3 = result.events.job.get("j3")!;
        assert.deepEqual([j3.machine, j3.start, j3.end], [some("m2"), some(from), some(new Date("2026-10-05T03:00:00Z"))]);
        assert.deepEqual([j3.title, j3.hours, j3.customer, j3.status], [jobs.get("j3")!.title, 3, "A customer", variant("planned", null)], "the job's other fields are kept");
    });

    test("a window with no backlog is returned as it is", () => {
        const scheduled = optimise(request).events.job;
        const again = optimise({ ...request, run: 2n, events: { job: scheduled } }).events.job;
        assert.deepEqual([...again], [...scheduled]);
    });
});
