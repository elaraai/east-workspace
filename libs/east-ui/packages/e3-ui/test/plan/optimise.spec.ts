/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * The Plan's `optimise` contract (#1409, east-workspace#1622): the request —
 * the window, the run and the rail's narrowing, no row — and the answer, a
 * patch of each event kind's record by slot; the prop's refusals where the page
 * is built — with no event kinds among them — and the drafts rule as it is
 * evaluated; the payload's `optimise`; and the print works' optimiser over a
 * small window, read through the jobs' interval index: the backlog placed on
 * the presses' free time, answered as a patch.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    DateTimeType, DictType, East, IntegerType, NullType, OptionType, PatchType, SortedMap, StringType, StructType, VariantType, compareFor, diffFor, equalFor,
    isTypeEqual, none, printFor, printType, some, variant, type BlockBuilder, type EastIR, type EastType, type ValueTypeOf,
} from "@elaraai/east";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import e3 from "@elaraai/e3";
import { RecordSliceWhereType } from "@elaraai/east-ui/internal";
import { Schedule } from "@elaraai/e3-ui";
import { Func, FuncBindingType, Plan, PlanPayloadType, Record, scheduleOptimiseBinding } from "@elaraai/e3-ui/internal";
import { indexEntries } from "../index-entries.js";
import { refusingPlatform } from "../refusing-platform.js";
import * as base from "./plan-events.examples.js";
import * as ex from "./optimise.examples.js";

describeEast("Plan — the optimiser's example (#1409, #1622)", test => {
    Assert.examples(test, { planOptimise: ex.planOptimise });
}, { platformFns: TestImpl });

type Request = ValueTypeOf<typeof Plan.Types.OptimiseRequest>;
type Job = ValueTypeOf<typeof base.PrintJob>;
const byString = compareFor(StringType);
const WINDOW = { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-11-02T00:00:00Z") };

/** What `build` throws inside a block, as `<Plan>`'s factory runs; `""` when it builds. */
function refusal(build: ($: BlockBuilder<NullType>) => unknown): string {
    try {
        East.function([], NullType, ($) => { build($); });
        return "";
    } catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
}

/** A Plan of the jobs on the presses, with the props given beside them. */
function payload($: BlockBuilder<NullType>, change: Readonly<Record<string, unknown>> = {}): unknown {
    const presses = $.let(Record.bind(base.planPrintPresses, []));
    const jobs = $.let(Record.bind(base.planEventJobs));
    return Plan.Payload({
        axis: Plan.axis({ window: WINDOW, resolution: "day" }),
        data: presses.read(),
        series: [Plan.series.resources(base.PrintPress, { key: "presses", title: "Presses", icon: "print", label: (p) => p.name })],
        events: { job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }) },
        ...change,
    } as never);
}

/**
 * The Plan's `optimise` binding over its job kind, evaluated as the page is: the check its tag makes, which the Calendar's
 * makes too (`scheduleOptimiseBinding`), alone — the payload around it reads the jobs as it is evaluated, which a spec reads
 * from no e3.
 *
 * @param def - The function the page binds
 * @returns The binding, once it holds
 */
function evaluated(def: unknown): ValueTypeOf<typeof FuncBindingType> {
    return East.compile(East.function([], FuncBindingType, ($) => {
        const jobs = $.let(Record.bind(base.planEventJobs));
        const optimise = $.let(Func.bind(def as never));
        const job = Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } });
        return scheduleOptimiseBinding("Plan", optimise, [["job", job]]);
    }), refusingPlatform)();
}

describe("the types (#1622)", () => {
    test("OptimiseRequest is the window and what kind of period it is, the run and each rail source's narrowing, and no row; OptimiseResult(E) a patch of each event kind's record by slot", () => {
        assert.ok(isTypeEqual(Plan.Types.OptimiseRequest, StructType({
            from: DateTimeType, to: DateTimeType, period: Plan.Types.OptimisePeriod, run: IntegerType, slice: DictType(StringType, RecordSliceWhereType),
        })));
        assert.ok(isTypeEqual(Plan.Types.OptimisePeriod, VariantType({ day: NullType, week: NullType, month: NullType, quarter: NullType, year: NullType })));
        assert.ok(isTypeEqual(ex.PlanOptimiseResult, StructType({ events: StructType({ job: PatchType(ex.PrintJobs) }) })));
        assert.equal(isTypeEqual(Plan.Types.OptimiseResult({ job: ex.PrintJobs, stop: DictType(StringType, base.PrintStop) }), ex.PlanOptimiseResult), false,
            "each event kind's record is part of the answer");
    });

    test("the payload carries the optimiser's binding, or none", () => {
        assert.ok(isTypeEqual(PlanPayloadType.fields.optimise, OptionType(FuncBindingType)));
    });
});

describe("`optimise`: Func.bind of an e3.function from OptimiseRequest to OptimiseResult(E), each record it reads that the Plan edits listed in its drafts", () => {
    test("the print works' optimiser is taken, its binding naming the jobs it lists and reads; without the prop the Plan builds as before", () => {
        assert.equal(refusal(($) => payload($, { optimise: Func.bind(ex.placeJobs) })), "");
        assert.equal(refusal(($) => payload($)), "");
        const binding = evaluated(ex.placeJobs);
        assert.ok(equalFor(FuncBindingType)(binding, { name: "plan_place_jobs", drafts: ["plan_event_jobs"], reads: ["plan_event_jobs", "plan_print_presses"] }),
            printFor(FuncBindingType)(binding));
    });

    test("a Plan with no event kinds edits no record: `optimise` is refused naming `events`", () => {
        assert.equal(refusal(() => Plan.Payload({
            axis: Plan.axis({ window: WINDOW, resolution: "day" }), rows: [Plan.events({ key: "ms", label: "Milestones" })], optimise: Func.bind(ex.placeJobs),
        })), "Plan: `optimise` answers a patch of each event kind's record, and this Plan has no event kinds — declare `events` (Schedule.events), or leave `optimise` out");
    });

    test("one answering a patch of other rows, or asking the rows themselves, is refused naming what it answers or asks; a value that is no Func.bind handle naming the signature", () => {
        const Other = DictType(StringType, StructType({ title: StringType, grade: StringType }));
        const otherRows = e3.function("plan_optimise_spec_other_rows", { inputs: [], args: [Plan.Types.OptimiseRequest], output: Plan.Types.OptimiseResult({ job: Other }) }, ($) => {
            const held = $.const(new Map(), Other);
            return { events: { job: East.diff(held, held) } };
        });
        assert.equal(refusal(($) => payload($, { optimise: Func.bind(otherRows) })),
            `Plan: \`optimise\` answers ${printType(Plan.Types.OptimiseResult({ job: Other }))}, not Plan.Types.OptimiseResult({ job: ${printType(ex.PrintJobs)} }) — ` +
            "a patch of each record the Plan edits");
        const AsksRows = StructType({ from: DateTimeType, to: DateTimeType, run: IntegerType, events: StructType({ job: ex.PrintJobs }) });
        const asksRows = e3.function("plan_optimise_spec_asks_rows", { inputs: [], args: [AsksRows], output: ex.PlanOptimiseResult }, ($) => {
            const held = $.const(new Map(), ex.PrintJobs);
            return { events: { job: East.diff(held, held) } };
        });
        assert.equal(refusal(($) => payload($, { optimise: Func.bind(asksRows) })),
            `Plan: \`optimise\` asks ${printType(AsksRows)}, not Plan.Types.OptimiseRequest — ` +
            "a request carries the period in view, the run's number and the page's narrowing, and no row: the function reads what it needs from the workspace");
        assert.equal(refusal(($) => payload($, { optimise: East.value("plan_place_jobs") })),
            "Plan: `optimise` is Func.bind of the app's e3.function from Plan.Types.OptimiseRequest to Plan.Types.OptimiseResult(E), E the event kinds' record types " +
            "by slot — the period in view and the page's narrowing in, a patch of each record the Plan edits out");
    });

    test("one that reads the jobs and does not list them in `drafts` fails the page as it is evaluated, naming the record", () => {
        const undrafted = e3.function("plan_optimise_spec_undrafted", {
            inputs: [e3.index(base.planEventJobs.indexes.plan_event_jobs_by_time)], args: [Plan.Types.OptimiseRequest], output: ex.PlanOptimiseResult,
        }, ($) => {
            const held = $.const(new Map(), ex.PrintJobs);
            return { events: { job: East.diff(held, held) } };
        });
        assert.equal(refusal(($) => payload($, { optimise: Func.bind(undrafted) })), "", "built, it stands: the records are named by values");
        assert.throws(() => evaluated(undrafted), (error: Error) => error.message.includes(
            "Plan: `optimise` is the function 'plan_optimise_spec_undrafted', which reads the record 'plan_event_jobs' that the Plan edits " +
            "and does not list it in `drafts` — it would plan around edits it cannot see: list it, drafts: [plan_event_jobs], beside the function's inputs"));
    });
});

describe("the print works' optimiser over a small window, read through the jobs' interval index", () => {
    const from = WINDOW.min, to = WINDOW.max;
    const presses = new SortedMap<string, ValueTypeOf<typeof base.PrintPress>>([
        ["a1", { name: "Press A1", hall: "Hall A", sheets_per_hour: 12000.0 }], ["b1", { name: "Press B1", hall: "Hall B", sheets_per_hour: 15000.0 }],
    ], byString);
    const job = (title: string, start: Date | null, sheets: number, press: string | null): Job => ({
        title, start: start === null ? none : some(start), end: start === null ? none : some(new Date(start.getTime() + sheets / 8000 * 3_600_000)),
        press: press === null ? none : some(press), state: variant("estimated", null), sheets, customer: "A customer", stock: variant("coated", null), due: none,
    });
    // The works' now is Wednesday 14 Oct, 09:00 (`PRINT_WORKS_NOW`): A1's job that morning runs past it, to 10:00.
    const jobs = new SortedMap<string, Job>([
        ["J-0", job("Last month on B1", new Date("2026-09-28T06:00:00Z"), 32000, "b1")],
        ["J-1", job("Placed on A1", new Date("2026-10-14T06:00:00Z"), 32000, "a1")],
        ["J-2", job("Waiting for A1", null, 16000, "a1")],
        ["J-3", job("Waiting for any press", null, 24000, null)],
    ], byString);
    const request: Request = { from, to, period: variant("week", null), run: 1n, slice: new Map() };
    const optimise = (ex.placeJobs.body as EastIR<EastType[], EastType>).compile([]) as unknown as
        (byTime: unknown, jobs: unknown, presses: unknown, request: Request) => ValueTypeOf<typeof ex.PlanOptimiseResult>;
    const run = (held: SortedMap<string, Job>, asked: Request = request) =>
        optimise(indexEntries(base.planEventJobs, base.planEventJobs.indexes.plan_event_jobs_by_time, held).entries, held, presses, asked);
    const patchOf = diffFor(ex.PrintJobs);
    const samePatch = equalFor(PatchType(ex.PrintJobs));
    const printPatch = printFor(PatchType(ex.PrintJobs));

    // What each placement is, whatever the window: J-2 on A1 once its morning job ends; J-3 on B1, free from now.
    const placed = () => {
        const j2 = { ...jobs.get("J-2")!, start: some(new Date("2026-10-14T10:00:00Z")), end: some(new Date("2026-10-14T12:00:00Z")) };
        // B1's job of last month is outside the window, and the window starts before now: B1 is free from now
        const j3 = { ...jobs.get("J-3")!, start: some(ex.PRINT_WORKS_NOW), end: some(new Date("2026-10-14T12:00:00Z")), press: some("b1") };
        return patchOf(
            new SortedMap([["J-2", jobs.get("J-2")!], ["J-3", jobs.get("J-3")!]], byString),
            new SortedMap([["J-2", j2], ["J-3", j3]], byString));
    };

    test("each backlog job is placed in key order — on its press after its last job in the window, or on the press free soonest from the window's start or now, whichever is later, for its sheets' hours — and the answer is their change alone (#1680's review)", () => {
        const answer = run(jobs).events.job;
        assert.ok(samePatch(answer, placed()), printPatch(answer));
    });

    test("a job that would end past the window it is asked of stays waiting: no job is put outside it", () => {
        // A window of one day, now's: A1 is free from 10:00, B1 from now. Two hours and three hours fit; twenty hours' sheets on A1 do not.
        const day: Request = { ...request, from: new Date("2026-10-14T00:00:00Z"), to: new Date("2026-10-15T00:00:00Z"), period: variant("day", null) };
        const held = new SortedMap<string, Job>([...jobs, ["J-4", job("Too long for what is left of Wednesday", null, 160000, "a1")]], byString);
        const answer = run(held, day).events.job;
        assert.ok(samePatch(answer, placed()), printPatch(answer));
    });

    test("a window wholly before now places nothing: no job is put in the past (#1680's review)", () => {
        const past: Request = { ...request, to: new Date("2026-10-12T00:00:00Z") };
        const answer = run(jobs, past).events.job;
        assert.ok(samePatch(answer, patchOf(new SortedMap([], byString), new SortedMap([], byString))), printPatch(answer));
    });

    test("a window with no backlog is answered with a patch that changes nothing", () => {
        const answer = run(new SortedMap([["J-1", jobs.get("J-1")!]], byString)).events.job;
        assert.ok(samePatch(answer, patchOf(new SortedMap([], byString), new SortedMap([], byString))), printPatch(answer));
    });
});
