/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * The Allocation's pure functions and the yard's fit, held to the spec's worked
 * facts (`Allocation Spec.md` §0, §12.4). Every expected figure and word is the
 * mock's own functions' answer over the same yard.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DictType, East, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, isTypeEqual, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Allocation } from "@elaraai/e3-ui";
import { resolveAllocationEvents } from "@elaraai/e3-ui/internal";
import { BinValues, Kiln, TimberLoad, YardDay, yardArrivals, yardDay, yardKilns, yardLanes, yardPlanDay } from "./kiln-yard.js";
import { bulkFitBody, yardFitBody } from "./allocation.examples.js";

const Context = Allocation.Types.Context;
const Request = Allocation.Types.FitRequest(BinValues);
type Fit = ValueTypeOf<typeof Allocation.Types.Fit>;
type Result = ValueTypeOf<typeof Allocation.Types.FitResult>;

// The context the board sends: the yard's loads and kilns through the Allocation's own adapters.
const contextOf = East.compile(East.function([DictType(StringType, TimberLoad), DictType(StringType, Kiln)], Context, ($, loads, yard) => {
    const events = resolveAllocationEvents(Allocation.events(loads, {
        label: l => l.code, meta: l => some(East.str`${l.mill} · ${l.grade} · spec ${l.spec}`),
        quantity: l => l.m3, hold: l => variant("days", l.dryingDays), kind: l => some(l.spec),
        due: l => some(l.due), window: l => some({ from: l.from, to: l.to }), details: l => [{ label: "Settings", value: l.schedule }],
        values: l => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade.substring(0n, 1n), gradeMeasured: l.grade, instruction: l.instruction }),
    }), BinValues).events;
    const resources = $.const(Allocation.resources(yard, {
        label: k => k.name, group: k => some(k.group), meta: k => some(East.str`${k.group} · ${k.max} m³`), note: k => k.note,
        min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges,
    }));
    return {
        lanes: yardLanes, every: variant("hours", 1.0),
        events: events.toDict(($2, e) => e.key, ($2, e) => e), resources: resources.toDict(($2, r) => r.key, ($2, r) => r),
        rules: { under: true }, unit: "m³",
    };
}), []);
const context = contextOf(yardArrivals, yardKilns);
// The plan day as a fresh decoded value, so a test may change it.
const fresh = () => decodeBeast2For(YardDay)(encodeBeast2For(YardDay)(yardPlanDay));

const builtIn = East.compile(East.function([Request], Allocation.Types.FitResult, ($, req) => {
    const answer = $.const(Allocation.answer(BinValues));
    const rule = $.const(Allocation.fit);
    return answer(req, rule, "ranked by load, kind and spare days");
}), []);
const yard = East.compile(yardFitBody, []);
const bulk = East.compile(bulkFitBody, []);
const loads = East.compile(Allocation.loads(BinValues), []);
const check = East.compile(Allocation.check(BinValues), []);
const slots = East.compile(Allocation.slots(BinValues), []);
const candidates = East.compile(Allocation.candidates(BinValues), []);

const placeEvent = (code: string, plan = fresh()): ValueTypeOf<typeof Request> => ({
    day: yardDay, plan, context, ask: variant("place", { subject: variant("event", code), quantity: context.events.get(code)!.quantity }),
});
/** The fits of an answer's resources, best first: name, score, reason, warning. */
const ranked = (result: Result) => [...result.resources]
    .flatMap(([key, fit]) => fit.type === "fits" ? [{ key, ...fit.value }] : [])
    .sort((a, b) => b.score - a.score)
    .map(f => [f.key, f.score, f.why, f.warn.type === "some" ? f.warn.value : null]);
const refusals = (result: Result) => Object.fromEntries([...result.resources]
    .flatMap(([key, fit]) => fit.type === "refused" ? [[key, fit.value.reason]] : []));
const refusal = (fit: Fit | undefined) => { assert.ok(fit?.type === "refused"); return fit.value; };

test("§0 worked facts — each library load's fits, best first, with the mock's scores and reasons", () => {
    assert.deepEqual(ranked(builtIn(placeEvent("LD-2231"))), [
        ["K-107", 0.875, "0 d spare to Wed 19 · leaves 21 m³ · takes 12–24", null],
        ["K-601", -0.39, "open gap · leaves 21 m³ · min 40 · 19 short", "under min"],
    ]);
    assert.deepEqual(ranked(builtIn(placeEvent("LD-2232"))), [["K-601", -0.24, "open gap · leaves 30 m³ · min 40 · 10 short", "under min"]]);
    assert.deepEqual(ranked(builtIn(placeEvent("LD-2233"))), [["K-601", -0.30666666666666664, "open gap · leaves 26 m³ · min 40 · 14 short", "under min"]]);
    assert.deepEqual(ranked(builtIn(placeEvent("LD-2234"))), [["K-601", -0.44, "open gap · leaves 18 m³ · min 40 · 22 short", "under min"]]);
    assert.deepEqual(ranked(builtIn(placeEvent("LD-2235"))), [
        ["K-305", 0.8, "0 d spare to Thu 20 · leaves 8 m³ · takes 4–10", null],
        ["K-601", -0.6066666666666667, "open gap · leaves 8 m³ · min 40 · 32 short", "under min"],
    ]);
    assert.deepEqual(ranked(builtIn(placeEvent("LD-2236"))).map(f => [f[0], f[3]]), [["K-107", "under min"], ["K-103", "under min"], ["K-601", "under min"]]);
});

test("§0 worked facts — LD-2231's refusals, each group's reason, with K-503 and K-504 busy", () => {
    const result = builtIn(placeEvent("LD-2231"));
    const refused = refusals(result);
    assert.equal(Object.keys(refused).length, 31);
    assert.equal(refused["K-503"], "busy until Fri 14");
    assert.equal(refused["K-504"], "busy until Sat 15");
    assert.equal(refused["K-103"], "gap too short · next job Tue 18");
    assert.equal(refused["K-105"], "gap too short · next job Mon 17");
    assert.equal(refused["K-207"], "over max by 25 m³");
    assert.equal(refused["K-305"], "over max by 11 m³");
    // Each refusal's group and measure: what a run of refusals gathers into its label.
    const busy = refusal(result.resources.get("K-503"));
    assert.equal(busy.group, "Busy");
    assert.ok(busy.measure.type === "day" && busy.measure.value.lead === "until");
    assert.equal(busy.measure.value.at.getTime(), Date.UTC(2027, 4, 14));
    const gap = refusal(result.resources.get("K-105"));
    assert.equal(gap.group, "Gap too short");
    assert.ok(gap.measure.type === "day" && gap.measure.value.lead === "next job");
    assert.equal(gap.measure.value.at.getTime(), Date.UTC(2027, 4, 17));
    const over = refusal(result.resources.get("K-207"));
    assert.equal(over.group, "Over max");
    assert.ok(over.measure.type === "amount" && over.measure.value.lead === "by" && over.measure.value.value === 25);
});

test("§0 worked facts — bin 3113 (LD-2210, 32 m³ on K-108) fits K-103 and K-601 besides its own; 30 kilns refuse it", () => {
    const result = builtIn({ day: yardDay, plan: fresh(), context, ask: variant("place", { subject: variant("bin", "3113"), quantity: 32 }) });
    assert.deepEqual(ranked(result), [
        ["K-103", 1, "0 d spare to Tue 18 · leaves 32 m³ · takes 16–32", null],
        ["K-108", 0.92, "2 d spare to Thu 20 · leaves 32 m³ · takes 16–32", null],
        ["K-601", -0.20666666666666667, "open gap · leaves 32 m³ · min 40 · 8 short", "under min"],
    ]);
    assert.equal(Object.keys(refusals(result)).length, 30);
});

test("§12.4 the yard's greedy look-ahead — LD-2236 reorders: K-103, K-601, then K-107, which leaves two loads with no fit", () => {
    const result = yard(placeEvent("LD-2236"));
    assert.deepEqual(ranked(result).map(f => [f[0], f[2]]), [
        ["K-103", "1 d spare to Tue 18 · leaves 11 m³ · min 16 · 5 short · leaves 1 load with no fit"],
        ["K-601", "open gap · leaves 11 m³ · min 40 · 29 short · leaves 1 load with no fit"],
        ["K-107", "2 d spare to Wed 19 · leaves 11 m³ · min 12 · 1 short · leaves 2 loads with no fit"],
    ]);
    assert.equal(result.basis, "ranked by load, kind and spare days, and what it leaves for the day's other loads");
});

test("§12.4 the yard's greedy look-ahead — LD-2231 ranks K-107 first, because K-601 is the only fit for LD-2232, LD-2233 and LD-2234", () => {
    assert.deepEqual(ranked(yard(placeEvent("LD-2231"))).map(f => [f[0], f[1], f[2]]), [
        ["K-107", -0.125, "0 d spare to Wed 19 · leaves 21 m³ · takes 12–24 · leaves 1 load with no fit"],
        ["K-601", -2.39, "open gap · leaves 21 m³ · min 40 · 19 short · leaves 2 loads with no fit"],
    ]);
    // A refusal passes through the look-ahead as the rules give it.
    assert.equal(refusals(yard(placeEvent("LD-2231")))["K-503"], "busy until Fri 14");
});

test("the yard's rule over the ready-made fit refuses what the built-in rules accept", () => {
    const fit = bulk(placeEvent("LD-2235")).resources.get("K-601");
    assert.equal(refusal(fit).reason, "bulk kilns take 20 m³ and more");
    assert.equal(builtIn(placeEvent("LD-2235")).resources.get("K-601")?.type, "fits");
    assert.equal(bulk(placeEvent("LD-2231")).resources.get("K-601")?.type, "fits");
});

test("§0 worked facts — the day's loads: 26 bins, 556 m³; 21 kilns loading, 10 free, 2 busy", () => {
    const all = loads(yardDay, fresh(), context);
    const states = [...all.values()].reduce((m, l) => ({ ...m, [l.state.type]: (m[l.state.type] ?? 0) + 1 }), {} as Record<string, number>);
    assert.deepEqual(states, { loading: 21, free: 10, busy: 2 });
    assert.equal([...all.values()].reduce((sum, l) => sum + l.fill, 0), 556);
    assert.equal([...all.values()].reduce((sum, l) => sum + Number(l.bins), 0), 26);
    const k105 = all.get("K-105")!;
    assert.ok(k105.hold.type === "some");
    assert.equal(k105.hold.value.to.getTime(), Date.UTC(2027, 4, 19));
});

test("§0 worked facts — the checks: K-207 over max, K-105 and K-301 overlap their next jobs, nothing unlinked", () => {
    const issues = check(yardDay, fresh(), context);
    assert.deepEqual(issues.map(i => [i.kind.type, i.title, i.detail, i.tone.type]), [
        ["overlap", "K-105", "8-day hold to Tue 18 · runs 2 d into the job planned Mon 17", "warning"],
        ["overlap", "K-301", "8-day hold to Tue 18 · runs 3 d into the job planned Sun 16", "warning"],
        ["over", "K-207", "44 m³ · max 40 · 4 over · over max", "danger"],
    ]);
    // Each resource's issue offers to move its latest bin.
    const over = issues.find(i => i.kind.type === "over")!;
    assert.ok(over.fix.type === "some" && over.fix.value.type === "move");
    assert.equal(over.fix.value.value, "3109");
});

test("the checks: a bin not linked, a bin partly allocated, and a load under its minimum", () => {
    const plan = fresh();
    plan.bins.get("3101")!.parts.clear();
    plan.bins.get("3113")!.parts.set("K-108", 10);
    const issues = check(yardDay, plan, context);
    const unlinked = issues.find(i => i.kind.type === "unlinked")!;
    assert.deepEqual([unlinked.title, unlinked.detail], ["LD-2201 · 35 m³", "B-3 01:55 · no resource yet"]);
    assert.ok(unlinked.fix.type === "some" && unlinked.fix.value.type === "choose");
    const partly = issues.find(i => i.kind.type === "unallocated")!;
    assert.deepEqual([partly.title, partly.detail], ["LD-2210 · 32 m³", "22 m³ unallocated · B-2 10:35"]);
    assert.ok(partly.fix.type === "some" && partly.fix.value.type === "find");
    const under = issues.find(i => i.kind.type === "under")!;
    assert.deepEqual([under.title, under.detail], ["K-108", "10 m³ · min 16 · 6 short · a warning, Save still works"]);
    assert.equal(check(yardDay, plan, { ...context, rules: { under: false } }).filter(i => i.kind.type === "under").length, 0);
});

test("A36 — booking takes the plan day's first free slot, by time then lane order, from 00:00, whatever the clock says", () => {
    const first = (plan: ValueTypeOf<typeof YardDay>) => slots(yardDay, plan, context).find(s => s.status.type === "free")!;
    const plan = fresh();
    const free = first(plan);
    assert.deepEqual([free.lane, free.at.getTime()], ["B-1", Date.UTC(2027, 4, 11, 0, 15)]);
    // Taken, the next is B-2 at 00:35: time first, then lane order.
    plan.bins.set("N1", { lane: "B-1", at: free.at, event: some("LD-2231"), quantity: 21, kind: some("MC12"), hold: variant("days", 8),
        parts: new SortedMap([["K-107", 21]], compareFor(StringType)), values: { specBooked: "MC12", specMeasured: "MC12", gradeBooked: "R", gradeMeasured: "R2", instruction: none } });
    const next = first(plan);
    assert.deepEqual([next.lane, next.at.getTime()], ["B-2", Date.UTC(2027, 4, 11, 0, 35)]);
});

test("§0 worked facts — the day's slots: 80 Table rows, 18 slots holding bins", () => {
    const all = slots(yardDay, fresh(), context);
    assert.equal(all.length, 72);
    assert.equal(all.reduce((rows, s) => rows + Math.max(1, s.bins.length), 0), 80);
    assert.equal(all.filter(s => s.bins.length > 0).length, 18);
    assert.ok(all.every((s, i) => i === 0 || s.at.getTime() >= all[i - 1]!.at.getTime()));
});

test("a take: a verdict for every bin on the resource, and one for reserving — refused full at its maximum", () => {
    const plan = fresh();
    const ask = (resource: string): ValueTypeOf<typeof Request> => ({ day: yardDay, plan, context, ask: variant("take", { resource }) });
    const k203 = builtIn(ask("K-203"));
    assert.equal(k203.bins.size, 26);
    assert.equal(k203.resources.size, 0);
    assert.equal(k203.reserve.type === "some" && k203.reserve.value.type, "fits");
    plan.bins.get("3105")!.quantity = 40;
    plan.bins.get("3105")!.parts.set("K-203", 40);
    const full = builtIn(ask("K-203"));
    assert.ok(full.reserve.type === "some");
    assert.equal(refusal(full.reserve.value).reason, "full · 40 m³ · takes 20–40");
    assert.equal(candidates(ask("K-203")).at(-1)!.reserve, true);
});

test("a type constructor returns the same East type for the same bin values", () => {
    assert.ok(isTypeEqual(Allocation.Types.Days(BinValues), Allocation.Types.Days(BinValues)));
    assert.ok(isTypeEqual(Allocation.Types.FitRequest(BinValues).fields.plan, Allocation.Types.Day(BinValues)));
    assert.equal(isTypeEqual(Allocation.Types.Days(BinValues), Allocation.Types.Days(StringType)), false);
});
