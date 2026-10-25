/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * The Plan's `optimise` contract (#1409, #1411, `Optimise Spec.md` §4, §5):
 * the request and result types over the kinds' rows by slot, the prop's
 * refusals — with no event kinds among them — the payload's `optimise`, and
 * the print works' optimiser over a small window: the backlog placed on the
 * presses' free time.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    DateTimeType, DictType, East, IntegerType, NullType, OptionType, SortedMap, StringType, StructType, compareFor, isTypeEqual, none, some, variant,
    type BlockBuilder, type ValueTypeOf,
} from "@elaraai/east";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import e3 from "@elaraai/e3";
import { Schedule } from "@elaraai/e3-ui";
import { Func, FuncBindingType, Plan, PlanPayloadType, Record } from "@elaraai/e3-ui/internal";
import * as base from "./plan-events.examples.js";
import * as ex from "./optimise.examples.js";

describeEast("Plan — the optimiser's example (#1409)", test => {
    Assert.examples(test, { planOptimise: ex.planOptimise });
}, { platformFns: TestImpl });

type Request = ValueTypeOf<typeof ex.PlanOptimiseRequest>;
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
    const jobs = $.let(Record.bind(base.planEventJobs, [base.planEventJobsPatch]));
    return Plan.Payload({
        axis: Plan.axis({ window: WINDOW, resolution: "day" }),
        resources: { presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: (p) => p.name }) },
        events: { job: Schedule.events(jobs, { name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "presses" } }) },
        ...change,
    } as never);
}

describe("the types (§5.1)", () => {
    test("OptimiseRequest(E, S) is the window, the run, each event kind's rows by slot and by key, and each resource kind's; OptimiseResult(E) the events", () => {
        assert.ok(isTypeEqual(ex.PlanOptimiseRequest, StructType({
            from: DateTimeType, to: DateTimeType, run: IntegerType,
            events: StructType({ job: DictType(StringType, base.PrintJob) }), resources: StructType({ presses: DictType(StringType, base.PrintPress) }),
        })));
        assert.ok(isTypeEqual(ex.PlanOptimiseResult, StructType({ events: StructType({ job: DictType(StringType, base.PrintJob) }) })));
        assert.ok(isTypeEqual(Plan.Types.OptimiseRequest({ job: base.PrintJob }, { presses: base.PrintPress }), ex.PlanOptimiseRequest));
        assert.equal(isTypeEqual(Plan.Types.OptimiseRequest({ job: base.PrintJob, stop: base.PrintStop }, { presses: base.PrintPress }), ex.PlanOptimiseRequest), false);
    });

    test("the payload carries the optimiser's binding, or none (§5.2)", () => {
        assert.ok(isTypeEqual(PlanPayloadType.fields.optimise, OptionType(FuncBindingType)));
    });
});

describe("`optimise` (§4): Func.bind of an e3.function from OptimiseRequest(E, S) to OptimiseResult(E), refused otherwise naming the kinds' rows", () => {
    test("the print works' optimiser is taken; without the prop the Plan builds as before", () => {
        assert.equal(refusal(($) => payload($, { optimise: Func.bind(ex.placeJobs) })), "");
        assert.equal(refusal(($) => payload($)), "");
    });

    test("a Plan with no event kinds has no rows to send: `optimise` is refused naming `events`", () => {
        assert.match(refusal(() => Plan.Payload({
            axis: Plan.axis({ window: WINDOW, resolution: "day" }), rows: [Plan.events({ key: "ms", label: "Milestones" })], optimise: Func.bind(ex.placeJobs),
        })), /^Plan: `optimise` sends the event kinds' rows to the app's optimiser, and this Plan has no event kinds — declare `events` \(Schedule\.events\), or leave `optimise` out$/);
    });

    test("one bound over the same slots' other rows is refused naming both, and one asking or answering another type naming it", () => {
        const Other = StructType({ title: StringType, grade: StringType });
        const otherRows = e3.function("plan_optimise_spec_other_rows", East.function(
            [Plan.Types.OptimiseRequest({ job: Other }, { presses: base.PrintPress })], Plan.Types.OptimiseResult({ job: Other }),
            (_$, req) => ({ events: { job: req.events.job } })));
        assert.match(refusal(($) => payload($, { optimise: Func.bind(otherRows) })),
            /^Plan: `optimise` is bound over event rows \{ job: \.Struct \[.*grade.*\] \}, \{ presses: \.Struct \[.*hall.*\] \}, and the kinds' rows are \{ job: \.Struct \[.*sheets.*\] \}, \{ presses: \.Struct \[.*hall.*\] \} — bind an optimiser over Plan\.Types\.OptimiseRequest of the kinds' row types by slot$/);
        const noPresses = e3.function("plan_optimise_spec_no_presses", East.function([Plan.Types.OptimiseRequest({ job: base.PrintJob })], ex.PlanOptimiseResult, (_$, req) => ({ events: { job: req.events.job } })));
        assert.match(refusal(($) => payload($, { optimise: Func.bind(noPresses) })), /^Plan: `optimise` asks \.Struct \[.*\], not Plan\.Types\.OptimiseRequest\(\{ job: \.Struct \[.*\] \}, \{ presses: \.Struct \[.*\] \}\)$/);
        const answersText = e3.function("plan_optimise_spec_answers_text", East.function([ex.PlanOptimiseRequest], StringType, () => "nothing"));
        assert.match(refusal(($) => payload($, { optimise: Func.bind(answersText) })), /^Plan: `optimise` answers \.String, not Plan\.Types\.OptimiseResult\(\{ job: \.Struct \[/);
        assert.match(refusal(($) => payload($, { optimise: East.value("plan_place_jobs") })),
            /^Plan: `optimise` is Func\.bind of the app's e3\.function from Plan\.Types\.OptimiseRequest\(E, S\) to Plan\.Types\.OptimiseResult\(E\), E the event kinds' row types by slot and S the resource kinds' — the period's rows in, the same rows out, complete$/);
    });
});

describe("the print works' optimiser over a small window (§3.1)", () => {
    const from = WINDOW.min, to = WINDOW.max;
    const presses = new SortedMap<string, ValueTypeOf<typeof base.PrintPress>>([
        ["a1", { name: "Press A1", hall: "Hall A", sheets_per_hour: 12000.0 }], ["b1", { name: "Press B1", hall: "Hall B", sheets_per_hour: 15000.0 }],
    ], byString);
    const job = (title: string, start: Date | null, sheets: number, press: string | null): Job => ({
        title, start: start === null ? none : some(start), end: start === null ? none : some(new Date(start.getTime() + sheets / 8000 * 3_600_000)),
        press: press === null ? none : some(press), state: variant("estimated", null), sheets, customer: "A customer", stock: variant("coated", null), due: none,
    });
    const jobs = new SortedMap<string, Job>([
        ["J-1", job("Placed on A1", new Date("2026-10-05T06:00:00Z"), 32000, "a1")],
        ["J-2", job("Waiting for A1", null, 16000, "a1")],
        ["J-3", job("Waiting for any press", null, 24000, null)],
    ], byString);
    const request: Request = { from, to, run: 1n, events: { job: jobs }, resources: { presses } };
    const optimise = East.compile(ex.planOptimiseBody, []);

    test("each backlog job is placed in key order: on its press after its last job, or on the press free soonest from the window's start, for its sheets' hours", () => {
        const result = optimise(request);
        assert.deepEqual([...result.events.job.keys()], ["J-1", "J-2", "J-3"]);
        assert.deepEqual(result.events.job.get("J-1"), jobs.get("J-1"), "a placed job stays as it is");
        const j2 = result.events.job.get("J-2")!;
        assert.deepEqual([j2.press, j2.start, j2.end], [some("a1"), some(new Date("2026-10-05T10:00:00Z")), some(new Date("2026-10-05T12:00:00Z"))]);
        const j3 = result.events.job.get("J-3")!;
        assert.deepEqual([j3.press, j3.start, j3.end], [some("b1"), some(from), some(new Date("2026-10-05T03:00:00Z"))]);
        assert.deepEqual([j3.state, j3.sheets, j3.stock], [variant("estimated", null), 24000, variant("coated", null)], "the job's other fields are kept");
    });
});
