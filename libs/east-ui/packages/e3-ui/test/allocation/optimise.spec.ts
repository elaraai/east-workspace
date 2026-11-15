/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * The Allocation's `optimise` contract (#1409, east-workspace#1622): the
 * request — the day, the run and the rail's narrowing, no row — and the
 * answer, a patch of the bins' record; the prop's refusals where the page is
 * built, and the drafts rule over the bins and the days the board publishes as
 * it is evaluated; the payload's
 * `optimise`; and the yard's optimiser over its own records — the day's bins
 * read through their interval index, the board's context built from the bays,
 * the kilns and the loads (`Allocation.context`) — a joint one: the kilns'
 * overloads moved and the day's links mended, then every load not yet booked
 * booked into a free bay slot and onto the kilns the fit ranks best, whole or
 * split; a load no kiln can take booked on none; answered as a patch.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, PatchType, SortedMap, StringType, StructType, VariantType, compareFor, diffFor,
    equalFor, isTypeEqual, printFor, printType, some, variant, type EastIR, type EastType, type ValueTypeOf,
} from "@elaraai/east";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import e3 from "@elaraai/e3";
import { RecordSliceWhereType } from "@elaraai/east-ui/internal";
import { Allocation, Data, Schedule } from "@elaraai/e3-ui";
import {
    AllocationPayloadType, Func, FuncBindingType, Record, allocationEdits, allocationOptimiseBinding, createAllocationPayload, type AllocationProps,
} from "@elaraai/e3-ui/internal";
import { Kiln, KilnBin, MinimalBin, YardPlan, yardArrivals, yardBayRows, yardBinRows, yardDay, yardKilns, yardSplitDay } from "./kiln-yard.js";
import { yardContext } from "./yard-context.js";
import { indexEntries } from "../index-entries.js";
import { patchedFor } from "../patches.js";
import { refusingPlatform } from "../refusing-platform.js";
import * as base from "./allocation.examples.js";
import * as ex from "./optimise.examples.js";

describeEast("Allocation — the optimiser's example (#1409, #1622)", test => {
    Assert.examples(test, { allocationOptimise: ex.allocationOptimise });
}, { platformFns: TestImpl });

type Bin = ValueTypeOf<typeof KilnBin>;
type Props = AllocationProps<typeof KilnBin>;
const byString = compareFor(StringType);
const MinimalBins = DictType(StringType, MinimalBin);

/** Builds a payload's East function over the kiln yard's records, the props the test gives beside the base's — refused, if it is, as it is built. */
function payload(change: Partial<Props> | Readonly<Record<string, unknown>> = {}): void {
    East.function([], AllocationPayloadType, ($) => {
        const bins = $.let(Record.bind(base.kilnBins));
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

/** The days a test's board publishes: a record of the test's own, each day keyed by its UTC midnight, open or issued. */
const specDays = e3.record("allocation_optimise_spec_days", DictType(DateTimeType, StructType({ state: VariantType({ open: NullType, issued: NullType }) })), {
    initial: new Map(),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/**
 * The board's optimiser over the bins — and the days it publishes, where `withDays` — evaluated as the page is: the check
 * its tag makes (`allocationOptimiseBinding`, over `allocationEdits`), alone — the payload around it reads the kilns as it
 * is evaluated, which a spec reads from no e3.
 */
function evaluated(def: unknown, withDays = false): ValueTypeOf<typeof FuncBindingType> {
    return East.compile(East.function([], FuncBindingType, ($) => {
        const bins = $.let(Record.bind(base.kilnBins));
        const days = $.let(Record.bind(specDays));
        const optimise = $.let(Func.bind(def as never));
        const kind = Schedule.events(bins, {
            name: "Bin", icon: "box", at: "at", resource: { field: "bay", of: "bays" }, arrival: "load",
            quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor", kind: "spec",
        });
        const periods = withDays ? Schedule.periods(days, { every: "day", status: { field: "state", draft: "open", published: "issued" } }) : undefined;
        return allocationOptimiseBinding(optimise, ex.KilnBins, allocationEdits(kind as never, periods));
    }), refusingPlatform)();
}

describe("the types (#1622)", () => {
    test("OptimiseRequest is the day, the run and each rail source's narrowing, and no row; OptimiseResult(D) a patch of the bins' record", () => {
        assert.ok(isTypeEqual(Allocation.Types.OptimiseRequest, StructType({ day: DateTimeType, run: IntegerType, slice: DictType(StringType, RecordSliceWhereType) })));
        assert.ok(isTypeEqual(Allocation.Types.OptimiseResult(ex.KilnBins), StructType({ bins: PatchType(ex.KilnBins) })));
        assert.equal(isTypeEqual(Allocation.Types.OptimiseResult(MinimalBins), Allocation.Types.OptimiseResult(ex.KilnBins)), false);
        assert.throws(() => Allocation.Types.OptimiseResult(KilnBin as unknown as DictType<EastType, EastType>), {
            message: `Allocation.Types.OptimiseResult: is given ${printType(KilnBin)} — it takes the bins' record type, a Dict of bins by key: DictType(StringType, Bin)`,
        });
    });

    test("the payload carries the optimiser's binding, or none", () => {
        assert.ok(isTypeEqual(AllocationPayloadType.fields.optimise, OptionType(FuncBindingType)));
    });
});

describe("`optimise`: Func.bind of an e3.function from OptimiseRequest to OptimiseResult(D), the bins' record listed in its drafts where it reads it", () => {
    test("the yard's optimiser is taken, its binding naming the bins it lists and the records it reads; without the prop the board builds as before", () => {
        assert.doesNotThrow(() => payload({ optimise: Func.bind(ex.yardOptimise) }));
        assert.doesNotThrow(() => payload());
        const binding = evaluated(ex.yardOptimise);
        assert.ok(equalFor(FuncBindingType)(binding, { name: "yard_optimise", drafts: ["kiln_bins"], reads: ["arrivals", "kiln_bins", "kilns", "yard_bays"] }),
            printFor(FuncBindingType)(binding));
    });

    test("one that reads the bins and does not list them in `drafts` fails the page as it is evaluated, naming the record", () => {
        const undrafted = e3.function("allocation_optimise_spec_undrafted", {
            inputs: [e3.index(base.kilnBins.indexes.kiln_bins_by_time)], args: [Allocation.Types.OptimiseRequest], output: Allocation.Types.OptimiseResult(ex.KilnBins),
        }, ($) => {
            const held = $.const(new Map(), ex.KilnBins);
            return { bins: East.diff(held, held) };
        });
        assert.doesNotThrow(() => payload({ optimise: Func.bind(undrafted) }), "built, it stands: the record is named by a value");
        assert.throws(() => evaluated(undrafted), (error: Error) => error.message.includes(
            "Allocation: `optimise` is the function 'allocation_optimise_spec_undrafted', which reads the record 'kiln_bins' that the Allocation edits " +
            "and does not list it in `drafts` — it would plan around edits it cannot see: list it, drafts: [kiln_bins], beside the function's inputs"));
    });

    test("one that reads the days the board publishes and does not list them fails the page as it is evaluated, naming the days' record: their unsaved status is the board's; a board that publishes none edits none", () => {
        const undrafted = e3.function("allocation_optimise_spec_days_undrafted", {
            inputs: [specDays], args: [Allocation.Types.OptimiseRequest], output: Allocation.Types.OptimiseResult(ex.KilnBins),
        }, ($) => {
            const held = $.const(new Map(), ex.KilnBins);
            return { bins: East.diff(held, held) };
        });
        assert.throws(() => evaluated(undrafted, true), (error: Error) => error.message.includes(
            "Allocation: `optimise` is the function 'allocation_optimise_spec_days_undrafted', which reads the record 'allocation_optimise_spec_days' that the " +
            "Allocation edits and does not list it in `drafts` — it would plan around edits it cannot see: list it, drafts: [allocation_optimise_spec_days], beside the function's inputs"));
        assert.doesNotThrow(() => evaluated(undrafted, false));
    });

    test("one answering a patch of another record, or asking the rows themselves, is refused naming what it answers or asks; a value that is no Func.bind handle naming the signature", () => {
        const otherRows = e3.function("allocation_optimise_spec_other_rows", { inputs: [], args: [Allocation.Types.OptimiseRequest], output: Allocation.Types.OptimiseResult(MinimalBins) }, ($) => {
            const held = $.const(new Map(), MinimalBins);
            return { bins: East.diff(held, held) };
        });
        assert.throws(() => payload({ optimise: Func.bind(otherRows) as never }), {
            message: `Allocation: \`optimise\` answers ${printType(Allocation.Types.OptimiseResult(MinimalBins))}, not Allocation.Types.OptimiseResult(${printType(ex.KilnBins)}) — ` +
                "a patch of each record the Allocation edits",
        });
        const AsksRows = StructType({ day: DateTimeType, run: IntegerType, bins: ex.KilnBins });
        const asksRows = e3.function("allocation_optimise_spec_asks_rows", { inputs: [], args: [AsksRows], output: Allocation.Types.OptimiseResult(ex.KilnBins) }, ($) => {
            const held = $.const(new Map(), ex.KilnBins);
            return { bins: East.diff(held, held) };
        });
        assert.throws(() => payload({ optimise: Func.bind(asksRows) as never }), {
            message: `Allocation: \`optimise\` asks ${printType(AsksRows)}, not Allocation.Types.OptimiseRequest — ` +
                "a request carries the period in view, the run's number and the page's narrowing, and no row: the function reads what it needs from the workspace",
        });
        assert.throws(() => payload({ optimise: East.value("yard_optimise") as never }), {
            message: "Allocation: `optimise` is Func.bind of the app's e3.function from Allocation.Types.OptimiseRequest to Allocation.Types.OptimiseResult(D), " +
                `D the bins' record type — here ${printType(ex.KilnBins)} — the period in view and the page's narrowing in, a patch of each record the Allocation edits out`,
        });
    });
});

describe("the yard's optimiser over its own records: a joint one — the day's links mended, then every waiting load booked and linked", () => {
    type Loads = typeof yardArrivals;
    type Kilns = typeof yardKilns;
    const optimise = (ex.yardOptimise.body as EastIR<EastType[], EastType>).compile([]) as unknown as (...inputs: unknown[]) => { bins: unknown };
    const patched = patchedFor(ex.KilnBins);
    /** The bins a run over a day leaves, over the yard's bins as they stand, its loads and its kilns; and its answer. */
    const run = (day: Date, given: { bins?: ReadonlyMap<string, Bin>; loads?: Loads; kilns?: Kilns; run?: bigint } = {}) => {
        const rows = given.bins ?? yardBinRows;
        const answer = optimise(indexEntries(base.kilnBins, base.kilnBins.indexes.kiln_bins_by_time, rows).entries, rows,
            given.loads ?? yardArrivals, given.kilns ?? yardKilns, yardBayRows, { day, run: given.run ?? 1n, slice: new Map() }).bins;
        return { answer, after: patched(rows, answer) };
    };
    /** A day's bins, the yard's rows by key. */
    const binsOf = (day: Date, rows: ReadonlyMap<string, Omit<Bin, "kilns"> & { kilns: ReadonlyMap<string, number> }> = yardBinRows) =>
        new SortedMap<string, Bin>([...rows].filter(([, bin]) => bin.at >= day && bin.at.getTime() < day.getTime() + 86_400_000)
            .map(([id, row]) => [id, { ...row, kilns: new SortedMap([...row.kilns], byString) }] as const), byString);
    const sameBin = equalFor(KilnBin), sameKilns = equalFor(DictType(StringType, FloatType));
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
    /** The loads the day has not booked, in the loads' order. */
    const bookedBefore = new Set([...bins.values()].flatMap((bin) => bin.load.type === "some" ? [bin.load.value] : []));
    const waiting = [...yardContext.arrivals.keys()].filter((code) => !bookedBefore.has(code));

    test("every bin the day held keeps its slot and its load; the one kiln over its maximum, K-207, gives the 4 m³ over of its latest bin to a kiln with room for it, and no kiln is over after", () => {
        assert.deepEqual(issuesOf(yardDay, bins).filter((kind) => kind === "over"), ["over"]);
        const { after: rows } = run(yardDay);
        const result = binsOf(yardDay, rows);
        for (const [key, bin] of bins) {
            const after = result.get(key)!;
            assert.ok(sameBin({ ...after, kilns: bin.kilns }, bin), `${key} keeps its slot, its load and its own fields`);
            if (key !== "3109") assert.ok(sameKilns(after.kilns, bin.kilns), `${key} keeps its kilns`);
        }
        const moved = result.get("3109")!;
        assert.deepEqual([moved.kilns.get("K-207"), moved.kilns.size, sum(moved.kilns)], [40, 2, 44]);
        const after = loads(yardDay, planOf(result), yardContext);
        assert.ok([...after].every(([kiln, load]) => load.fill <= yardContext.resources.get(kiln)!.max), "no kiln over its maximum");
        assert.deepEqual(issuesOf(yardDay, result).filter((kind) => kind === "over"), []);
        // The other days' bins, which the run read none of, are as they were
        for (const [key, bin] of yardBinRows) if (!bins.has(key) && !key.startsWith("elara-")) assert.ok(sameBin(binsOf(bin.at, rows).get(key)!, binsOf(bin.at).get(key)!), key);
    });

    test("every load not yet booked is booked into a free slot, in the loads' order, under a key of the run's own — and onto kilns with room for it, whole on the best fit or split", () => {
        const result = binsOf(yardDay, run(yardDay).after);
        const added = [...result].filter(([key]) => !bins.has(key));
        assert.deepEqual(waiting, ["LD-2231", "LD-2232", "LD-2233", "LD-2234", "LD-2235", "LD-2236"]);
        assert.deepEqual(added.map(([key, bin]) => [key, bin.load]), waiting.map((code) => [`elara-1-${code}`, some(code)]));
        // Each new bin's slot is free: no other bin, held or new, in that bay at that time; the slots in time then lane order, the earliest first.
        const slotOf = (bin: Bin): string => `${bin.at.getTime()} ${bin.bay}`;
        const held = new Set([...bins.values()].map(slotOf));
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
        const bin = binsOf(yardDay, run(yardDay).after).get("elara-1-LD-2231")!;
        const load = yardContext.arrivals.get("LD-2231")!;
        assert.deepEqual([bin.m3, bin.spec, bin.dryFor, bin.specBooked, bin.specMeasured, bin.gradeBooked, bin.gradeMeasured, bin.instruction.type],
            [load.quantity, load.kind, load.hold, "MC12", "MC12", "", "", "none"]);
        // The Hall A kiln with room for its 21 m³ and a gap for its 8-day hold.
        assert.deepEqual([...bin.kilns], [["K-107", 21]]);
    });

    test("links alone: a day with no load waiting and a bin partly allocated — Wed 12's LD-2232, 4 m³ of its 30 on no kiln — has the 4 m³ placed, and nothing booked", () => {
        const wed = binsOf(yardSplitDay);
        assert.deepEqual(issuesOf(yardSplitDay, wed).filter((kind) => kind === "unallocated"), ["unallocated"]);
        const result = binsOf(yardSplitDay, run(yardSplitDay, { loads: new SortedMap([], byString) }).after);
        assert.deepEqual([...result.keys()], [...wed.keys()]);
        const bin = result.get("3201")!;
        assert.deepEqual([bin.kilns.get("K-208"), bin.kilns.get("K-601"), bin.kilns.size, sum(bin.kilns)], [6, 20, 3, 30]);
        for (const key of ["3202", "3203"]) assert.ok(sameBin(result.get(key)!, wed.get(key)!), `${key} as it was`);
        assert.deepEqual(issuesOf(yardSplitDay, result).filter((kind) => kind === "unallocated"), []);
    });

    test("links may be empty: with every kiln busy, the loads are booked into their slots on no kiln, and the kiln over its maximum stays so, for the planner", () => {
        const busy = new SortedMap<string, ValueTypeOf<typeof Kiln>>([...yardKilns].map(([key, kiln]): [string, ValueTypeOf<typeof Kiln>] => [key, {
            ...kiln, charges: [{ label: "charge", start: new Date(yardDay.getTime() - 86_400_000), end: new Date(yardDay.getTime() + 86_400_000) }],
        }]), byString);
        const result = binsOf(yardDay, run(yardDay, { kilns: busy }).after);
        const added = [...result].filter(([key]) => !bins.has(key));
        assert.deepEqual(added.map(([, bin]) => [bin.load.type, bin.kilns.size]), waiting.map(() => ["some", 0]));
        assert.ok(sameBin(result.get("3109")!, bins.get("3109")!), "the overloaded kiln's bin as it was");
        assert.equal(issuesOf(yardDay, result).filter((kind) => kind === "over" || kind === "unlinked").length, 7);
    });

    test("a day with nothing left to do is answered with a patch that changes nothing", () => {
        const { after } = run(yardDay);
        const { answer } = run(yardDay, { bins: after, run: 2n });
        const unchanged = diffFor(ex.KilnBins)(new SortedMap([], byString), new SortedMap([], byString));
        assert.ok(equalFor(PatchType(ex.KilnBins))(answer as never, unchanged), printFor(PatchType(ex.KilnBins))(answer as never));
    });
});
