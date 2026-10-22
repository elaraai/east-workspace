/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The board's reading of the app's own rows (#1371, `Builder Interfaces
 * Spec.md` §6.2–§6.4): the lanes and the resources from their kinds'
 * accessors, and the arrivals from theirs; a bin as the board reads it, its
 * kind's roles and its row, on the day its `at` falls in (B12); what booking an
 * arrival writes into a bin's own fields (B13); and the fit's and the check's
 * requests, decoded, each bin carrying its own row (B16). The bin kind reads
 * and writes a row's roles on e3 (e3-ui-components' `test/schedule-builders.spec.ts`);
 * here, the roles as its `rows` and `read` give them.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, BlobType, DateTimeType, DictType, East, IntegerType, NullType, OptionType, SortedMap, StringType, StructType, compareFor, decodeBeast2For,
    defaultValue, encodeBeast2For, equalFor, isTypeEqual, none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Allocation, Schedule } from "@elaraai/e3-ui";
import {
    Record, ScheduleAllocationRolesType, SchedulePeriodStatusType, allocationArrivalsOf, allocationBinOf, allocationInitial, allocationLanesOf,
    allocationResourcesOf,
} from "@elaraai/e3-ui/internal";
import { Bay, Kiln, KilnBin, TimberLoad, YardBin, YardPlan, yardArrivals, yardBayRows, yardBinRows, yardDay, yardKilns, yardPlanDay } from "./kiln-yard.js";
import { yardContext as context } from "./yard-context.js";
import * as ex from "./allocation.examples.js";

type Roles = ValueTypeOf<typeof ScheduleAllocationRolesType>;
type Row = ValueTypeOf<typeof KilnBin>;
const byString = compareFor(StringType);
const DAY = 86_400_000;

/** A bin's roles as its kind reads them from the yard's row: its time and bay, its load, its m³ and split, its drying time and spec. */
const rolesOf = (row: Row): Roles => ({
    at: row.at, lane: row.bay, arrival: row.load, quantity: row.m3, parts: new SortedMap([...row.kilns], byString), hold: row.dryFor, kind: row.spec,
});

describe("the lanes, the resources and the arrivals: the app's rows through their accessors", () => {
    const Lanes = ArrayType(Allocation.Types.Lane);
    const Resources = ArrayType(Allocation.Types.Resource);
    const read = East.compile(East.function([DictType(StringType, Bay), DictType(StringType, Kiln)],
        StructType({ lanes: Lanes, bare: Lanes, resources: Resources, plain: Resources }), (_$, bays, kilns) => ({
            lanes: allocationLanesOf(Schedule.resources(bays, { name: "Bays", icon: "warehouse", label: b => East.str`Bay ${b.name}`, offset: b => b.offset })),
            bare: allocationLanesOf(Schedule.resources(bays, { name: "Bays", icon: "warehouse", label: b => b.name })),
            resources: allocationResourcesOf(Schedule.resources(kilns, {
                name: "Kilns", icon: "fire", label: k => k.name, group: k => k.group, meta: k => some(East.str`${k.group} · ${East.Float.roundHalf(k.max)} m³`),
                note: k => k.note, min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges,
            })),
            plain: allocationResourcesOf(Schedule.resources(kilns, { name: "Kilns", icon: "fire", label: k => k.name, min: k => k.min, max: k => k.max })),
        })), []);
    const value = read(yardBayRows, yardKilns);

    test("a lane per row of the lanes' kind, in key order, each keyed by its row and booked at its offset; with no offset, on the slot", () => {
        assert.deepEqual(value.lanes.map(lane => [lane.key, lane.label]), [["B-1", "Bay B-1"], ["B-2", "Bay B-2"], ["B-3", "Bay B-3"]]);
        assert.deepEqual(value.lanes.map(lane => lane.offset), [variant("minutes", 15), variant("minutes", 35), variant("minutes", 55)]);
        assert.deepEqual(value.bare.map(lane => lane.offset), [variant("minutes", 0), variant("minutes", 0), variant("minutes", 0)]);
    });

    test("a resource per row of the resources' kind, in key order, each accessor's value; one the kind was not given its default", () => {
        assert.equal(value.resources.length, 33);
        assert.deepEqual(value.resources.find(r => r.key === "K-108"), {
            key: "K-108", label: "K-108", group: some("Hall A"), meta: some("Hall A · 32 m³"), note: some("the plan had this charge on Wed 12"),
            min: 16, max: 32, hold: variant("days", 7), jobs: yardKilns.get("K-108")!.charges,
        });
        assert.deepEqual(value.plain.find(r => r.key === "K-108"), {
            key: "K-108", label: "K-108", group: none, meta: none, note: none, min: 16, max: 32, hold: variant("days", 0), jobs: [],
        });
        assert.deepEqual(value.plain.map(r => r.key), [...yardKilns.keys()]);
    });

    test("an arrival per row, keyed by its row, each accessor's value; one not given its default", () => {
        const arrivalsOf = East.compile(East.function([DictType(StringType, TimberLoad)], StructType({ full: ArrayType(Allocation.Types.Arrival), plain: ArrayType(Allocation.Types.Arrival) }),
            (_$, loads) => ({
                full: allocationArrivalsOf(Allocation.arrivals(loads, {
                    label: l => l.code, meta: l => some(East.str`${l.mill} · ${l.grade} · spec ${l.spec}`),
                    quantity: l => l.m3, hold: l => variant("days", l.dryingDays), kind: l => some(l.spec),
                    due: l => some(l.due), window: l => some({ from: l.from, to: l.to }), details: l => [{ label: "Settings", value: l.schedule }],
                })),
                plain: allocationArrivalsOf(Allocation.arrivals(loads, { label: l => l.code, quantity: l => l.m3, hold: l => variant("days", l.dryingDays) })),
            })), []);
        const arrivals = arrivalsOf(yardArrivals);
        assert.deepEqual(arrivals.full.map(a => a.key), [...yardArrivals.keys()]);
        assert.deepEqual(arrivals.full.find(a => a.key === "LD-2231"), {
            key: "LD-2231", label: "LD-2231", meta: some("BRK · R2 · spec MC12"), quantity: 21, hold: variant("days", 8), kind: some("MC12"),
            due: some(new Date("2027-05-09T00:00:00Z")), window: some({ from: new Date("2027-05-07T00:00:00Z"), to: new Date("2027-05-10T00:00:00Z") }),
            details: [{ label: "Settings", value: "Schedule KS-2 · 55 °C dry bulb · 10 % target" }],
        });
        assert.deepEqual(arrivals.plain.find(a => a.key === "LD-2231"), {
            key: "LD-2231", label: "LD-2231", meta: none, quantity: 21, hold: variant("days", 8), kind: none, due: none, window: none, details: [],
        });
    });

    test("Allocation.arrivals refuses rows that are not a Dict keyed by String, an accessor returning another type, naming what it returns, and one it needs left out", () => {
        assert.throws(() => East.function([DictType(StringType, TimberLoad)], NullType, (_$, loads) => {
            Allocation.arrivals(loads, { label: l => l.code, quantity: l => l.m3, hold: undefined as never });
        }), /Allocation\.arrivals: `hold` is an accessor, \(row, key\) => …, which the board reads of every arrival — give it/);
        assert.throws(() => East.function([DictType(DateTimeType, TimberLoad)], NullType, (_$, loads) => {
            Allocation.arrivals(loads as never, { label: () => "", quantity: () => 0, hold: () => variant("days", 0) });
        }), /Allocation\.arrivals: arrivals are a Dict keyed by String — a record's read\(\) — and these are \.Dict/);
        assert.throws(() => East.function([DictType(StringType, TimberLoad)], NullType, (_$, loads) => {
            Allocation.arrivals(loads, { label: l => l.code, quantity: l => l.code as never, hold: l => variant("days", l.dryingDays) });
        }), /Allocation\.arrivals: `quantity` returns a Float, an arrival's quantity — and this one returns \.String/);
        assert.throws(() => East.function([DictType(StringType, TimberLoad)], NullType, (_$, loads) => {
            Allocation.arrivals(loads, { label: l => l.code, quantity: l => l.m3, hold: l => l.dryingDays as never });
        }), /Allocation\.arrivals: `hold` returns a TimeStep, how long a resource holds a bin of it — and this one returns \.Float/);
    });
});

describe("a bin as the board reads it, on its day (B12)", () => {
    const binOf = East.compile(allocationBinOf(KilnBin), []);
    const binEqual = equalFor(OptionType(YardBin));

    test("the plan day holds the bins whose `at` falls in it, each its roles beside its own row; another day's bins it holds none of", () => {
        let held = 0;
        for (const [id, row] of yardBinRows) {
            const read = binOf(rolesOf(row), row, yardDay);
            const ours = yardPlanDay.bins.get(id);
            if (ours === undefined) {
                assert.equal(read.type, "none", `${id} is another day's`);
            } else {
                assert.ok(binEqual(read, some(ours)), `${id} as the plan day holds it`);
                held++;
            }
        }
        assert.equal(held, 26);
    });

    test("a day runs from its midnight to the next: a bin at its first instant is its, and one at the next midnight the next day's", () => {
        const row = yardBinRows.get("3101")!;
        const at = (ms: number) => ({ ...row, at: new Date(yardDay.getTime() + ms) });
        for (const [ms, held] of [[0, true], [DAY - 1, true], [DAY, false], [-1, false]] as const) {
            const moved = at(ms);
            assert.equal(binOf(rolesOf(moved), moved, yardDay).type, held ? "some" : "none", `${ms} ms past midnight`);
        }
    });

    test("a batch's bins keep one minute apart: each bin's `at` as it is, every one of the batch in its slot", () => {
        const slots = East.compile(Allocation.slots(KilnBin), []);
        const day = decodeBeast2For(YardPlan)(encodeBeast2For(YardPlan)(yardPlanDay));
        const batches = slots(yardDay, day, context).filter(slot => slot.bins.length > 1);
        assert.deepEqual(batches.map(slot => [slot.lane, slot.at, slot.bins.map(id => day.bins.get(id)!.at)]), [
            ["B-3", new Date("2027-05-11T01:55:00Z"), [new Date("2027-05-11T01:55:00Z"), new Date("2027-05-11T01:56:00Z")]],
            ["B-2", new Date("2027-05-11T05:35:00Z"), [new Date("2027-05-11T05:35:00Z"), new Date("2027-05-11T05:36:00Z")]],
            ["B-2", new Date("2027-05-11T06:35:00Z"), [new Date("2027-05-11T06:35:00Z"), new Date("2027-05-11T06:36:00Z")]],
            ["B-1", new Date("2027-05-11T10:15:00Z"), [new Date("2027-05-11T10:15:00Z"), new Date("2027-05-11T10:16:00Z")]],
            ["B-3", new Date("2027-05-11T17:55:00Z"), [new Date("2027-05-11T17:55:00Z"), new Date("2027-05-11T17:56:00Z"), new Date("2027-05-11T17:57:00Z")]],
            ["B-2", new Date("2027-05-11T20:35:00Z"), [new Date("2027-05-11T20:35:00Z"), new Date("2027-05-11T20:36:00Z")]],
            ["B-3", new Date("2027-05-11T20:55:00Z"), [new Date("2027-05-11T20:55:00Z"), new Date("2027-05-11T20:56:00Z")]],
        ]);
    });
});

describe("a booking's row: its roles, its `values` and the defaults (B13)", () => {
    /** The bin kind over the yard's bins, every one of the Allocation's roles mapped, as the examples declare it. */
    let values: StructType | undefined;
    let bare: StructType | undefined;
    East.function([], NullType, ($) => {
        const bins = $.let(Record.bind(ex.kilnBins, [ex.kilnBinsPatch]));
        values = Schedule.events(bins, {
            name: "Bin", icon: "box", at: "at", resource: { field: "bay", of: "bays" }, arrival: "load",
            quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor", kind: "spec",
        }).allocationValues;
        const minimal = $.let(Record.bind(ex.minimalBins, [ex.minimalBinsPatch]));
        bare = Schedule.events(minimal, {
            name: "Bin", icon: "box", at: "at", resource: { field: "bay", of: "bays" }, arrival: "load", quantity: { field: "m3" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor",
        }).allocationValues;
    });
    const Values = StructType({ specBooked: StringType, specMeasured: StringType, gradeBooked: StringType, gradeMeasured: StringType, instruction: OptionType(StringType) });
    /** An arrival's starting fields, as bytes at the bin kind's own fields: the yard's `values`, or none without it. */
    const initialOf = (given: boolean) => East.compile(East.function([DictType(StringType, TimberLoad), StringType], OptionType(BlobType), ($, loads, key) => {
        const arrivals = given
            ? Allocation.arrivals(loads, { label: l => l.code, quantity: l => l.m3, hold: l => variant("days", l.dryingDays), kind: l => some(l.spec),
                values: l => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade.substring(0n, 1n), gradeMeasured: l.grade, instruction: l.instruction }) })
            : Allocation.arrivals(loads, { label: l => l.code, quantity: l => l.m3, hold: l => variant("days", l.dryingDays), kind: l => some(l.spec) });
        const initial = $.const(allocationInitial(arrivals, values!));
        return initial(key);
    }), []);

    test("the bin kind's own fields are the ones no role maps: what an arrival's `values` gives a booked bin", () => {
        assert.ok(values !== undefined && isTypeEqual(values, Values));
        assert.ok(bare !== undefined && isTypeEqual(bare, StructType({})), "a kind whose every field is a role has none of its own");
    });

    test("its roles come from its arrival: its key, and the quantity, kind and hold its accessors give", () => {
        const arrival = context.arrivals.get("LD-2231")!;
        assert.deepEqual([arrival.key, arrival.quantity, arrival.kind, arrival.hold], ["LD-2231", 21, some("MC12"), variant("days", 8)]);
    });

    test("its own fields are its arrival's `values`, as bytes at the bin kind's: LD-2231's spec booked and measured, its grade by its letter, its instruction", () => {
        const decode = decodeBeast2For(Values);
        const initial = initialOf(true)(yardArrivals, "LD-2231");
        if (initial.type !== "some") assert.fail("expected LD-2231's starting fields");
        assert.ok(equalFor(Values)(decode(initial.value), {
            specBooked: "MC12", specMeasured: "MC12", gradeBooked: "R", gradeMeasured: "R2", instruction: some("Sticker every 600 mm before loading"),
        }));
        assert.equal(initialOf(true)(yardArrivals, "LD-9999").type, "none", "no arrival, no fields");
    });

    test("without `values`, and for a reservation, a bin's own fields are their type's default", () => {
        assert.equal(initialOf(false)(yardArrivals, "LD-2231").type, "none", "the bin kind's create gives each its type's default");
        assert.ok(equalFor(Values)(defaultValue(Values) as never, { specBooked: "", specMeasured: "", gradeBooked: "", gradeMeasured: "", instruction: none }));
    });
});

describe("the fit's and the check's requests carry each bin's own row, over decoded rows (B16)", () => {
    const Request = Allocation.Types.FitRequest(KilnBin);
    const Context = Allocation.Types.CheckContext(KilnBin);
    const fresh = () => decodeBeast2For(YardPlan)(encodeBeast2For(YardPlan)(yardPlanDay));

    test("an app's fit reads the subject bin's own row: it refuses every kiln for a bin measured off its booked spec", () => {
        // The yard's own rule over the built-in ones, reading the bin's row as the request carries it.
        const fit = East.compile(East.function([Request], Allocation.Types.FitResult, ($, req) => {
            const answer = $.const(Allocation.answer(KilnBin));
            const rule = $.const(Allocation.fit);
            return answer(req, East.function([Allocation.Types.Candidate], Allocation.Types.Fit, ($2, c) => {
                $2.match(c.bin, { some: ($3, id) => {
                    const row = $3.const(req.plan.bins.get(id).row);
                    $3.if(East.notEqual(row.specBooked, row.specMeasured), ($4) => {
                        $4.return(variant("refused", { group: "Off spec", reason: East.str`measured ${row.specMeasured} · booked ${row.specBooked}`, measure: variant("none", null) }));
                    });
                } });
                return rule(c);
            }), "ranked by load, kind and spare days; a bin off its spec goes nowhere");
        }), []);
        // As the renderer sends it: encoded at the request type, and decoded where the fit runs.
        const ask = (bin: string, quantity: number) => decodeBeast2For(Request)(encodeBeast2For(Request)({
            day: yardDay, plan: fresh(), context, ask: variant("place", { subject: variant("bin", bin), quantity }),
        }));
        const off = fit(ask("3113", 32));
        assert.ok([...off.resources.values()].every(f => f.type === "refused" && f.value.reason === "measured MC22 · booked MC08"));
        const on = fit(ask("3101", 35));
        assert.ok([...on.resources.values()].some(f => f.type === "fits"), "a bin on its spec fits where the rules say");
    });

    test("an app's check reads each bin's own row: the plan day's bins measured off their booked spec, flagged by key", () => {
        const check = East.compile(East.function([Context], ArrayType(Allocation.Types.Issue), ($, cx) => {
            const issues = $.let([], ArrayType(Allocation.Types.Issue));
            $.for(cx.plan.bins, ($2, bin, id) => {
                $2.if(East.notEqual(bin.row.specBooked, bin.row.specMeasured), ($3) => {
                    $3(issues.pushLast({ kind: variant("custom", "Spec mismatch"), tone: variant("neutral", null), title: East.str`Bin ${id}`,
                        detail: East.str`Spec booked ${bin.row.specBooked} · measured ${bin.row.specMeasured}`, bin: some(id), resource: none, flag: some("≠ spec"), fix: none }));
                });
            });
            return issues;
        }), []);
        const loads = East.compile(Allocation.loads(KilnBin), []);
        const plan = fresh();
        const cx = decodeBeast2For(Context)(encodeBeast2For(Context)({ day: yardDay, plan, context, loads: loads(yardDay, plan, context) }));
        assert.deepEqual(check(cx).map(i => i.bin), ["3102", "3105", "3106", "3108", "3112", "3113", "3115", "3116", "3117", "3119", "3121"].map(id => some(id)));
        assert.equal(check(cx).find(i => equalFor(OptionType(StringType))(i.bin, some("3113")))?.detail, "Spec booked MC08 · measured MC22");
    });

    test("each type over a day is a constructor of the row type: the same row the same type, another row another; a bin carries its row", () => {
        for (const make of [Allocation.Types.Bin, Allocation.Types.Day, Allocation.Types.FitRequest, Allocation.Types.CheckContext] as const) {
            assert.ok(isTypeEqual(make(KilnBin), make(KilnBin)), make.name);
            assert.ok(!isTypeEqual(make(KilnBin), make(IntegerType)), make.name);
        }
        assert.ok(isTypeEqual(Allocation.Types.Bin(IntegerType).fields.row, IntegerType));
        assert.ok(isTypeEqual(Allocation.Types.Status, SchedulePeriodStatusType), "a day's status is Schedule's period status");
        assert.ok(isTypeEqual(Allocation.Types.Day(IntegerType).fields.status, Allocation.Types.Status));
    });
});
