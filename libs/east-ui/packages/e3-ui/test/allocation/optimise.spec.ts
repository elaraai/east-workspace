/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * The Allocation's `optimise` contract (#1409, #1411, `Optimise Spec.md` §4,
 * §5): the request and result types over the bins' row type, the prop's
 * refusals, the payload's `optimise`, and the yard's optimiser over its own
 * day — a joint one: the kilns' overloads moved and the day's links mended,
 * then every load not yet booked booked into a free bay slot and onto the
 * kilns the fit ranks best, whole or split; a load no kiln can take booked on
 * none.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, DateTimeType, DictType, East, FloatType, IntegerType, OptionType, SortedMap, StringType, StructType, compareFor, equalFor, isTypeEqual, some,
    variant, type ValueTypeOf,
} from "@elaraai/east";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import e3 from "@elaraai/e3";
import { Allocation, Data, Schedule } from "@elaraai/e3-ui";
import { AllocationPayloadType, Func, FuncBindingType, Record, createAllocationPayload, type AllocationProps } from "@elaraai/e3-ui/internal";
import { KilnBin, MinimalBin, YardPlan, yardBinRows, yardDay, yardSplitDay } from "./kiln-yard.js";
import { yardContext } from "./yard-context.js";
import * as base from "./allocation.examples.js";
import * as ex from "./optimise.examples.js";

describeEast("Allocation — the optimiser's example (#1409)", test => {
    Assert.examples(test, { allocationOptimise: ex.allocationOptimise });
}, { platformFns: TestImpl });

const Request = Allocation.Types.OptimiseRequest(KilnBin);
const Result = Allocation.Types.OptimiseResult(KilnBin);
type Request = ValueTypeOf<typeof Request>;
type Bin = ValueTypeOf<typeof KilnBin>;
type Props = AllocationProps<typeof KilnBin>;
const byString = compareFor(StringType);

/** Builds a payload's East function over the kiln yard's records, the props the test gives beside the base's — refused, if it is, as it is built. */
function payload(change: Partial<Props> | Readonly<Record<string, unknown>> = {}): void {
    East.function([], AllocationPayloadType, ($) => {
        const bins = $.let(Record.bind(base.kilnBins, [base.kilnBinsPatch]));
        const loads = $.let(Data.bind(base.arrivals));
        const yard = $.let(Data.bind(base.kilns));
        const bays = $.let(Data.bind(base.yardBays));
        const fit = $.let(Func.bind(base.yardFit));
        return createAllocationPayload({
            fit,
            events: { bin: Schedule.events(bins, {
                name: "Bin", icon: "box", at: "at", resource: { field: "bay", of: "bays" }, arrival: "load",
                quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor", kind: "spec",
            }) },
            resources: {
                bays: Schedule.resources(bays.read(), { name: "Bays", icon: "warehouse", label: b => b.name, offset: b => b.offset }),
                kilns: Schedule.resources(yard.read(), { name: "Kilns", icon: "fire", label: k => k.name, min: k => k.min, max: k => k.max }),
            },
            arrivals: Allocation.arrivals(loads.read(), { label: l => l.code, quantity: l => l.m3, hold: l => variant("days", l.dryingDays) }),
            ...change,
        } as Props);
    });
}

describe("the types (§5.1)", () => {
    test("OptimiseRequest(R) is the day, the run, the bins by key as the app's rows, every arrival and the context; OptimiseResult(R) the bins", () => {
        assert.ok(isTypeEqual(Request, StructType({
            day: DateTimeType, run: IntegerType, bins: DictType(StringType, KilnBin), arrivals: ArrayType(Allocation.Types.Arrival), context: Allocation.Types.Context,
        })));
        assert.ok(isTypeEqual(Result, StructType({ bins: DictType(StringType, KilnBin) })));
        assert.ok(isTypeEqual(Allocation.Types.OptimiseRequest(KilnBin), Request));
        assert.equal(isTypeEqual(Allocation.Types.OptimiseRequest(MinimalBin), Request), false);
        assert.equal(isTypeEqual(Allocation.Types.OptimiseResult(MinimalBin), Result), false);
    });

    test("the payload carries the optimiser's binding, or none (§5.2)", () => {
        assert.ok(isTypeEqual(AllocationPayloadType.fields.optimise, OptionType(FuncBindingType)));
    });
});

describe("`optimise` (§4): Func.bind of an e3.function from OptimiseRequest(R) to OptimiseResult(R), refused otherwise naming the row type", () => {
    test("the yard's optimiser is taken; without the prop the board builds as before", () => {
        assert.doesNotThrow(() => payload({ optimise: Func.bind(ex.yardOptimise) }));
        assert.doesNotThrow(() => payload());
    });

    test("one bound over another row type is refused naming both rows", () => {
        const otherRows = e3.function("allocation_optimise_spec_other_rows", East.function([Allocation.Types.OptimiseRequest(MinimalBin)], Allocation.Types.OptimiseResult(MinimalBin), (_$, req) => ({ bins: req.bins })));
        assert.throws(() => payload({ optimise: Func.bind(otherRows) as never }),
            /^Error: Allocation: `optimise` is bound over bin rows \.Struct \[.*dryFor.*\], and the bin kind's rows are \.Struct \[.*specBooked.*\] — bind an optimiser over Allocation\.Types\.OptimiseRequest of the bins' row type$/);
    });

    test("one asking or answering another type is refused naming it, and a value that is no Func.bind handle naming the signature", () => {
        const answersText = e3.function("allocation_optimise_spec_answers_text", East.function([Request], StringType, () => "nothing"));
        assert.throws(() => payload({ optimise: Func.bind(answersText) as never }), /^Error: Allocation: `optimise` answers \.String, not Allocation\.Types\.OptimiseResult\(\.Struct \[/);
        const asksText = e3.function("allocation_optimise_spec_asks_text", East.function([StringType], Result, () => ({ bins: new Map() })));
        assert.throws(() => payload({ optimise: Func.bind(asksText) as never }), /^Error: Allocation: `optimise` asks \.String, not Allocation\.Types\.OptimiseRequest\(\.Struct \[/);
        assert.throws(() => payload({ optimise: East.value("yard_optimise") as never }),
            /^Error: Allocation: `optimise` is Func\.bind of the app's e3\.function from Allocation\.Types\.OptimiseRequest\(R\) to Allocation\.Types\.OptimiseResult\(R\), R the bins' row type — the period's rows in, the same rows out, complete$/);
    });
});

describe("the yard's optimiser over its own day (§3.1): a joint one — the day's links mended, then every waiting load booked and linked", () => {
    /** A day's bins, the yard's rows by key: what the board sends, base plus drafts. */
    const binsOf = (day: Date) => new SortedMap<string, Bin>([...yardBinRows].filter(([, bin]) => bin.at >= day && bin.at.getTime() < day.getTime() + 86_400_000), byString);
    /** A bin as the optimiser answers it, read as its row type's value: the answer's dicts are the runtime's own, typed as Maps by `East.compile`. */
    const rowOf = (row: Omit<Bin, "kilns"> & { kilns: ReadonlyMap<string, number> }): Bin => ({ ...row, kilns: new SortedMap([...row.kilns], byString) });
    const rowsOf = (bins: ReadonlyMap<string, Omit<Bin, "kilns"> & { kilns: ReadonlyMap<string, number> }>) => new SortedMap([...bins].map(([id, row]) => [id, rowOf(row)] as const), byString);
    const sameBin = equalFor(KilnBin), sameBins = equalFor(DictType(StringType, KilnBin)), sameKilns = equalFor(DictType(StringType, FloatType));
    /** The day as the board reads it, from the yard's rows: what the loads and the check read. */
    const planOf = (bins: SortedMap<string, Bin>): ValueTypeOf<typeof YardPlan> => ({
        status: variant("draft", null),
        bins: new SortedMap([...bins].map(([id, row]) => [id, {
            lane: row.bay, at: row.at, arrival: row.load, quantity: row.m3, kind: row.spec, hold: row.dryFor, parts: new SortedMap([...row.kilns], byString), row,
        }] as const), byString),
    });
    const loads = East.compile(Allocation.loads(KilnBin), []);
    const check = East.compile(Allocation.check(KilnBin), []);
    /** The kinds of the built-in checks' issues over a day's bins. */
    const issuesOf = (day: Date, bins: SortedMap<string, Bin>) => check(day, planOf(bins), yardContext).map((issue) => issue.kind.type);
    const sum = (kilns: ReadonlyMap<string, number>) => [...kilns.values()].reduce((total, part) => total + part, 0);
    const bins = binsOf(yardDay);
    const request: Request = { day: yardDay, run: 1n, bins, arrivals: [...yardContext.arrivals.values()], context: yardContext };
    const optimise = East.compile(ex.allocationOptimiseBody, []);
    /** The loads the day has not booked, in the loads' order. */
    const bookedBefore = new Set([...request.bins.values()].flatMap((bin) => bin.load.type === "some" ? [bin.load.value] : []));
    const waiting = [...yardContext.arrivals.keys()].filter((code) => !bookedBefore.has(code));

    test("every bin the day held keeps its slot and its load; the one kiln over its maximum, K-207, gives the 4 m³ over of its latest bin to a kiln with room for it, and no kiln is over after", () => {
        assert.deepEqual(issuesOf(yardDay, bins).filter((kind) => kind === "over"), ["over"]);
        const result = rowsOf(optimise(request).bins);
        for (const [key, bin] of request.bins) {
            const after = result.get(key)!;
            assert.ok(sameBin({ ...after, kilns: bin.kilns }, bin), `${key} keeps its slot, its load and its own fields`);
            if (key !== "3109") assert.ok(sameKilns(after.kilns, bin.kilns), `${key} keeps its kilns`);
        }
        const moved = result.get("3109")!;
        assert.deepEqual([moved.kilns.get("K-207"), moved.kilns.size, sum(moved.kilns)], [40, 2, 44]);
        const after = loads(yardDay, planOf(result), yardContext);
        assert.ok([...after].every(([kiln, load]) => load.fill <= yardContext.resources.get(kiln)!.max), "no kiln over its maximum");
        assert.deepEqual(issuesOf(yardDay, result).filter((kind) => kind === "over"), []);
    });

    test("every load not yet booked is booked into a free slot, in the loads' order, under a key of the run's own — and onto kilns with room for it, whole on the best fit or split", () => {
        const result = rowsOf(optimise(request).bins);
        const added = [...result].filter(([key]) => !request.bins.has(key));
        assert.deepEqual(waiting, ["LD-2231", "LD-2232", "LD-2233", "LD-2234", "LD-2235", "LD-2236"]);
        assert.deepEqual(added.map(([key, bin]) => [key, bin.load]), waiting.map((code) => [`elara-1-${code}`, some(code)]));
        // Each new bin's slot is free: no other bin, held or new, in that bay at that time; the slots in time then lane order, the earliest first.
        const slotOf = (bin: Bin): string => `${bin.at.getTime()} ${bin.bay}`;
        const held = new Set([...request.bins.values()].map(slotOf));
        const slots = added.map(([, bin]) => slotOf(bin));
        assert.equal(new Set(slots).size, slots.length, "each new bin its own slot");
        assert.ok(slots.every((slot) => !held.has(slot)), "no new bin in a held slot");
        const order = added.map(([, bin]) => [bin.at.getTime(), bin.bay] as const);
        assert.ok(order.every((slot, i) => i === 0 || order[i - 1]![0] < slot[0] || (order[i - 1]![0] === slot[0] && order[i - 1]![1] < slot[1])), "the day's free slots, first to last");
        assert.deepEqual([added[0]![1].bay, added[0]![1].at], ["B-1", new Date("2027-05-11T00:15:00Z")], "the day's first free slot: B-1 at 00:15");
        // Each on kilns, whole: four take one kiln each, two no one kiln had room for are split.
        assert.ok(added.every(([, bin]) => bin.kilns.size > 0), "every load linked");
        assert.deepEqual(added.map(([, bin]) => sum(bin.kilns)), added.map(([, bin]) => bin.m3));
        assert.deepEqual(added.map(([, bin]) => bin.kilns.size > 1), [false, false, false, true, true, false]);
        // The fit's rules held: no kiln over its maximum, none busy, and no hold run into a next job the day did not run into before.
        const after = issuesOf(yardDay, result);
        assert.deepEqual(after.filter((kind) => kind === "unlinked" || kind === "unallocated" || kind === "over"), []);
        assert.equal(after.filter((kind) => kind === "overlap").length, issuesOf(yardDay, bins).filter((kind) => kind === "overlap").length);
    });

    test("a new bin carries its load's m³, spec and drying time, its spec booked as measured, on the kiln the fit ranks best for it", () => {
        const result = optimise(request);
        const bin = result.bins.get("elara-1-LD-2231")!;
        const load = yardContext.arrivals.get("LD-2231")!;
        assert.deepEqual([bin.m3, bin.spec, bin.dryFor, bin.specBooked, bin.specMeasured, bin.gradeBooked, bin.gradeMeasured, bin.instruction.type],
            [load.quantity, load.kind, load.hold, "MC12", "MC12", "", "", "none"]);
        // The Hall A kiln with room for its 21 m³ and a gap for its 8-day hold.
        assert.deepEqual([...bin.kilns], [["K-107", 21]]);
    });

    test("links alone: a day with nothing waiting and a bin partly allocated — Wed 12's LD-2232, 4 m³ of its 30 on no kiln — has the 4 m³ placed, and nothing booked", () => {
        const wed = binsOf(yardSplitDay);
        assert.deepEqual(issuesOf(yardSplitDay, wed).filter((kind) => kind === "unallocated"), ["unallocated"]);
        const result = rowsOf(optimise({ day: yardSplitDay, run: 1n, bins: wed, arrivals: [], context: yardContext }).bins);
        assert.deepEqual([...result.keys()], [...wed.keys()]);
        const bin = result.get("3201")!;
        assert.deepEqual([bin.kilns.get("K-208"), bin.kilns.get("K-601"), bin.kilns.size, sum(bin.kilns)], [6, 20, 3, 30]);
        for (const key of ["3202", "3203"]) assert.ok(sameBin(result.get(key)!, wed.get(key)!), `${key} as it was`);
        assert.deepEqual(issuesOf(yardSplitDay, result).filter((kind) => kind === "unallocated"), []);
    });

    test("links may be empty: with every kiln busy, the loads are booked into their slots on no kiln, and the kiln over its maximum stays so, for the planner", () => {
        const busy: Request["context"] = { ...yardContext, resources: new SortedMap([...yardContext.resources].map(([key, kiln]) => [key, {
            ...kiln, jobs: [{ label: "charge", start: new Date(yardDay.getTime() - 86_400_000), end: new Date(yardDay.getTime() + 86_400_000) }],
        }] as const), byString) };
        const result = rowsOf(optimise({ ...request, context: busy }).bins);
        const added = [...result].filter(([key]) => !request.bins.has(key));
        assert.deepEqual(added.map(([, bin]) => [bin.load.type, bin.kilns.size]), waiting.map(() => ["some", 0]));
        assert.ok(sameBin(result.get("3109")!, request.bins.get("3109")!), "the overloaded kiln's bin as it was");
        assert.equal(issuesOf(yardDay, result).filter((kind) => kind === "over" || kind === "unlinked").length, 7);
    });

    test("a day with nothing left to do is returned as it is", () => {
        const booked = rowsOf(optimise(request).bins);
        assert.ok(sameBins(rowsOf(optimise({ ...request, run: 2n, bins: booked }).bins), booked));
    });
});
