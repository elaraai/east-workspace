/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * The Allocation's pure functions and the yard's fits, held to the spec's
 * worked facts (`Allocation Spec.md` §0, §12.4). The page's functions — loads,
 * checks and slots — read the board's reading of the yard's own bins
 * (`Allocation.Types.Day(KilnBin)`, #1371). A fit's rules read what a function
 * read (`Allocation.Types.FitContext`, east-workspace#1624): they are held to
 * a context that holds what the page holds — the day's bins as their roles,
 * the yard's loads and kilns — so their verdicts are the ones a request that
 * carried the day gave. The yard's functions are run as e3 runs them: each
 * over its own inputs, its bins' index built as e3 builds it, and a request
 * that carries the day, the question and the scope, and no row. Every expected
 * figure and word is the mock's own functions' answer over the same yard.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
    DictType, East, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, isTypeEqual, none, printFor, some, variant,
    type EastIR, type EastType, type ValueTypeOf,
} from "@elaraai/east";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import { Allocation, Schedule } from "@elaraai/e3-ui";
import { allocationResourceLine } from "@elaraai/e3-ui/internal";
import { indexEntries } from "../index-entries.js";
import {
    Bay, Kiln, KilnBin, MinimalBin, TimberLoad, YardBin, YardPlan, yardArrivals, yardBayRows, yardBinRows, yardDay, yardKilns, yardMinimalBinRows, yardPlanDay,
    yardSplitDay,
} from "./kiln-yard.js";
import { yardContext as context } from "./yard-context.js";
import { bulkFit, kilnBins, minimalBins, minimalFit, yardFit } from "./allocation.examples.js";
import * as ex from "./fit.examples.js";

describeEast("Allocation — pure functions", test => {
    Assert.examples(test, {
        allocationDayLoads: ex.allocationDayLoads, allocationRules: ex.allocationRules, allocationAnswerPlace: ex.allocationAnswerPlace,
        allocationAnswerTake: ex.allocationAnswerTake, allocationLookahead: ex.allocationLookahead, allocationChecks: ex.allocationChecks,
        allocationSlots: ex.allocationSlots,
    });
}, { platformFns: TestImpl });

type Request = ValueTypeOf<typeof Allocation.Types.FitRequest>;
type Read = ValueTypeOf<typeof Allocation.Types.FitContext>;
type Roles = ValueTypeOf<typeof Schedule.Types.AllocationRoles>;
type Fit = ValueTypeOf<typeof Allocation.Types.Fit>;
type Result = ValueTypeOf<typeof Allocation.Types.FitResult>;
type Plan = ValueTypeOf<typeof YardPlan>;
type Bin = ValueTypeOf<typeof YardBin>;
type Row = ValueTypeOf<typeof KilnBin>;
type MinimalRow = ValueTypeOf<typeof MinimalBin>;
const byString = compareFor(StringType);
const sameResult = equalFor(Allocation.Types.FitResult);
const printResult = printFor(Allocation.Types.FitResult);

// The plan day as a fresh decoded value, so a test may change it.
const fresh = () => decodeBeast2For(YardPlan)(encodeBeast2For(YardPlan)(yardPlanDay));
/** The yard's bins, every day's, as a fresh decoded value, so a test may change them. */
const freshRows = () => decodeBeast2For(kilnBins.type)(encodeBeast2For(kilnBins.type)(yardBinRows));

/**
 * What a fit's function reads of a day the page holds (#1624): its bins as their roles, with no row, and the context's
 * loads, kilns, rules and unit.
 */
const readOf = (plan: Plan, cx = context): Read => ({
    bins: new SortedMap<string, Roles>([...plan.bins].map(([id, bin]) => [id, {
        at: bin.at, lane: bin.lane, arrival: bin.arrival, quantity: bin.quantity, parts: bin.parts, hold: bin.hold, kind: bin.kind,
    }] as const), byString),
    arrivals: cx.arrivals, resources: cx.resources, rules: cx.rules, unit: cx.unit,
});
/** The built-in rules over what a function read: `Allocation.answer` with `Allocation.fit`. */
const builtInOver = East.compile(East.function([Allocation.Types.FitRequest, Allocation.Types.FitContext], Allocation.Types.FitResult, ($, request, read) => {
    const answer = $.const(Allocation.answer);
    const rule = $.const(Allocation.fit);
    return answer(request, read, rule, "ranked by load, kind and spare days");
}), []);
/** The built-in rules with the greedy look-ahead, over what a function read. */
const aheadOver = East.compile(East.function([Allocation.Types.FitRequest, Allocation.Types.FitContext], Allocation.Types.FitResult, ($, request, read) => {
    const answer = $.const(Allocation.answer);
    const rule = $.const(Allocation.fit);
    const ahead = $.const(Allocation.lookahead);
    return answer(request, read, East.function([Allocation.Types.Candidate], Allocation.Types.Fit, (_$2, c) => ahead(read, c, rule)),
        "ranked by load, kind and spare days, and what it leaves for the day's other loads");
}), []);
/** The built-in rules over a day the page holds, the plan day by default. */
const builtIn = (request: Request, plan: Plan = fresh(), cx = context): Result => builtInOver(request, readOf(plan, cx));

// The yard's fits, each its function's body over its own inputs, as e3 runs it: the bins' index, the bins, the kilns and the loads.
const yardBody = (yardFit.body as EastIR<EastType[], EastType>).compile([]) as unknown as (...inputs: unknown[]) => Result;
const bulkBody = (bulkFit.body as EastIR<EastType[], EastType>).compile([]) as unknown as (...inputs: unknown[]) => Result;
const minimalBody = (minimalFit.body as EastIR<EastType[], EastType>).compile([]) as unknown as (...inputs: unknown[]) => Result;
const byTime = (rows: ReadonlyMap<string, Row>) => indexEntries(kilnBins, kilnBins.indexes.kiln_bins_by_time, rows).entries;
/** The yard's fit over the bins given — every day's, the day's read through their index — and the yard's kilns and loads. */
const yard = (request: Request, rows: ReadonlyMap<string, Row> = yardBinRows): Result => yardBody(byTime(rows), rows, yardKilns, yardArrivals, request);
const bulk = (request: Request, rows: ReadonlyMap<string, Row> = yardBinRows): Result => bulkBody(byTime(rows), rows, yardKilns, yardArrivals, request);
/** The smallest board's fit over its own bins. */
const minimal = (request: Request, rows: ReadonlyMap<string, MinimalRow> = yardMinimalBinRows): Result =>
    minimalBody(indexEntries(minimalBins, minimalBins.indexes.kiln_minimal_bins_by_time, rows).entries, rows, yardKilns, yardArrivals, request);
const loads = East.compile(Allocation.loads(KilnBin), []);
const check = East.compile(Allocation.check(KilnBin), []);
const slots = East.compile(Allocation.slots(KilnBin), []);
const candidates = East.compile(Allocation.candidates, []);

/** The question a board asks of a day: the day, what is asked and the page's scope, here none — and no row. */
const asked = (ask: Request["ask"], day: Date = yardDay): Request => ({ day, ask, scope: new SortedMap([], byString) });
const placeArrival = (code: string): Request => asked(variant("place", { subject: variant("arrival", code), quantity: context.arrivals.get(code)!.quantity }));
const placeBin = (id: string, quantity: number): Request => asked(variant("place", { subject: variant("bin", id), quantity }));
const takeOf = (resource: string): Request => asked(variant("take", { resource }));
/** Holds an answer to the one expected, by East's own equality. */
function sameAnswer(actual: Result, expected: Result, of: string): void {
    assert.ok(sameResult(actual, expected), `${of}: ${printResult(actual)}, expected ${printResult(expected)}`);
}
/** A reservation in a lane slot, on the kilns given: no arrival, no quantity, no kind and no hold; its row's own fields their type's default. */
const reservation = (lane: string, at: Date, parts: SortedMap<string, number>): Bin => ({
    lane, at, arrival: none, quantity: 0, kind: none, hold: variant("days", 0), parts,
    row: { bay: lane, at, load: none, m3: 0, spec: none, dryFor: variant("days", 0), kilns: parts,
        specBooked: "", specMeasured: "", gradeBooked: "", gradeMeasured: "", instruction: none },
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
    assert.deepEqual(ranked(builtIn(placeArrival("LD-2231"))), [
        ["K-107", 0.875, "0 d spare to Wed 19 · leaves 21 m³ · takes 12–24", null],
        ["K-601", -0.39, "open gap · leaves 21 m³ · min 40 · 19 short", "under min"],
    ]);
    assert.deepEqual(ranked(builtIn(placeArrival("LD-2232"))), [["K-601", -0.24, "open gap · leaves 30 m³ · min 40 · 10 short", "under min"]]);
    assert.deepEqual(ranked(builtIn(placeArrival("LD-2233"))), [["K-601", -0.30666666666666664, "open gap · leaves 26 m³ · min 40 · 14 short", "under min"]]);
    assert.deepEqual(ranked(builtIn(placeArrival("LD-2234"))), [["K-601", -0.44, "open gap · leaves 18 m³ · min 40 · 22 short", "under min"]]);
    assert.deepEqual(ranked(builtIn(placeArrival("LD-2235"))), [
        ["K-305", 0.8, "0 d spare to Thu 20 · leaves 8 m³ · takes 4–10", null],
        ["K-601", -0.6066666666666667, "open gap · leaves 8 m³ · min 40 · 32 short", "under min"],
    ]);
    assert.deepEqual(ranked(builtIn(placeArrival("LD-2236"))).map(f => [f[0], f[3]]), [["K-107", "under min"], ["K-103", "under min"], ["K-601", "under min"]]);
});

test("§0 worked facts — LD-2231's refusals, each group's reason, with K-503 and K-504 busy", () => {
    const result = builtIn(placeArrival("LD-2231"));
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
    const result = builtIn(placeBin("3113", 32));
    assert.deepEqual(ranked(result), [
        ["K-103", 1, "0 d spare to Tue 18 · leaves 32 m³ · takes 16–32", null],
        ["K-108", 0.92, "2 d spare to Thu 20 · leaves 32 m³ · takes 16–32", null],
        ["K-601", -0.20666666666666667, "open gap · leaves 32 m³ · min 40 · 8 short", "under min"],
    ]);
    assert.equal(Object.keys(refusals(result)).length, 30);
});

test("§12.4 the yard's greedy look-ahead — LD-2236 reorders: K-103, K-601, then K-107, which leaves two loads with no fit", () => {
    const result = yard(placeArrival("LD-2236"));
    assert.deepEqual(ranked(result).map(f => [f[0], f[2]]), [
        ["K-103", "1 d spare to Tue 18 · leaves 11 m³ · min 16 · 5 short · leaves 1 load with no fit"],
        ["K-601", "open gap · leaves 11 m³ · min 40 · 29 short · leaves 1 load with no fit"],
        ["K-107", "2 d spare to Wed 19 · leaves 11 m³ · min 12 · 1 short · leaves 2 loads with no fit"],
    ]);
    assert.equal(result.basis, "ranked by load, kind and spare days, and what it leaves for the day's other loads");
});

test("§12.4 the yard's greedy look-ahead — LD-2231 ranks K-107 first, because K-601 is the only fit for LD-2232, LD-2233 and LD-2234", () => {
    assert.deepEqual(ranked(yard(placeArrival("LD-2231"))).map(f => [f[0], f[1], f[2]]), [
        ["K-107", -0.125, "0 d spare to Wed 19 · leaves 21 m³ · takes 12–24 · leaves 1 load with no fit"],
        ["K-601", -2.39, "open gap · leaves 21 m³ · min 40 · 19 short · leaves 2 loads with no fit"],
    ]);
    // A refusal passes through the look-ahead as the rules give it.
    assert.equal(refusals(yard(placeArrival("LD-2231")))["K-503"], "busy until Fri 14");
});

test("the yard's rule over the ready-made fit refuses what the built-in rules accept", () => {
    const fit = bulk(placeArrival("LD-2235")).resources.get("K-601");
    assert.equal(refusal(fit).reason, "bulk kilns take 20 m³ and more");
    assert.equal(builtIn(placeArrival("LD-2235")).resources.get("K-601")?.type, "fits");
    assert.equal(bulk(placeArrival("LD-2231")).resources.get("K-601")?.type, "fits");
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

test("A19 — every resource row's line at open, word for word as the mock draws them, and its tone", () => {
    const line = East.compile(allocationResourceLine, []);
    const all = loads(yardDay, fresh(), context);
    const lines = [...context.resources.values()].map(r => { const l = line(yardDay, r, all.get(r.key)!, "m³", "reserved"); return [r.label, l.text, l.tone.type]; });
    assert.deepEqual(lines, [
        ["K-101", "31 m³ · takes 16–32", "neutral"], ["K-102", "27 m³ · takes 16–32", "neutral"],
        ["K-103", "Hall A · 32 m³ · takes 16–32 m³", "neutral"], ["K-104", "Hall A · 32 m³ · takes 16–32 m³", "neutral"],
        ["K-105", "32 m³ · takes 16–32 · 2 d into next job", "warning"], ["K-106", "20 m³ · takes 12–24", "neutral"],
        ["K-107", "Hall A · 24 m³ · takes 12–24 m³", "neutral"], ["K-108", "32 m³ · takes 16–32", "neutral"],
        ["K-109", "24 m³ · takes 12–24", "neutral"], ["K-110", "Hall A · 24 m³ · takes 12–24 m³", "neutral"],
        ["K-201", "35 m³ · takes 20–40", "neutral"], ["K-202", "39 m³ · takes 20–40", "neutral"], ["K-203", "39 m³ · takes 20–40", "neutral"],
        ["K-204", "Hall B · 40 m³ · takes 20–40 m³", "neutral"], ["K-205", "37 m³ · takes 20–40", "neutral"], ["K-206", "37 m³ · takes 20–40", "neutral"],
        ["K-207", "44 m³ · max 40 · 4 over", "danger"], ["K-208", "Hall B · 40 m³ · takes 20–40 m³", "neutral"], ["K-209", "35 m³ · takes 20–40", "neutral"],
        ["K-301", "5 m³ · takes 4–10 · 3 d into next job", "warning"], ["K-302", "5 m³ · takes 4–10", "neutral"], ["K-303", "10 m³ · takes 4–10", "neutral"],
        ["K-304", "7 m³ · takes 4–10", "neutral"], ["K-305", "Compact · 10 m³ · takes 4–10 m³", "neutral"],
        ["K-401", "15 m³ · takes 10–20", "neutral"], ["K-402", "19 m³ · takes 10–20", "neutral"], ["K-403", "16 m³ · takes 10–20", "neutral"],
        ["K-501", "47 m³ · takes 24–48", "neutral"], ["K-502", "Large · 48 m³ · takes 24–48 m³", "neutral"],
        ["K-503", "busy until Fri 14", "neutral"], ["K-504", "busy until Sat 15", "neutral"],
        ["K-601", "Bulk · 60 m³ · takes 40–60 m³", "neutral"], ["K-602", "Bulk · 60 m³ · takes 40–60 m³", "neutral"],
    ]);
    const k207 = line(yardDay, context.resources.get("K-207")!, all.get("K-207")!, "m³", "reserved");
    assert.deepEqual([k207.over, k207.under, k207.overlap], [true, false, false]);
    const k105 = line(yardDay, context.resources.get("K-105")!, all.get("K-105")!, "m³", "reserved");
    assert.deepEqual([k105.over, k105.under, k105.overlap], [false, false, true]);
    // Under its minimum it warns; with only a reservation (on a kiln with an open gap) it reads `reserved`.
    const plan = fresh();
    plan.bins.get("3113")!.quantity = 10;
    plan.bins.get("3113")!.parts.set("K-108", 10);
    const under = line(yardDay, context.resources.get("K-108")!, loads(yardDay, plan, context).get("K-108")!, "m³", "reserved");
    assert.deepEqual([under.text, under.tone.type, under.under], ["10 m³ · min 16 · 6 short", "warning", true]);
    plan.bins.set("R1", reservation("B-1", new Date(Date.UTC(2027, 4, 11, 0, 15)), new SortedMap([["K-601", 0]], byString)));
    assert.equal(line(yardDay, context.resources.get("K-601")!, loads(yardDay, plan, context).get("K-601")!, "m³", "reserved").text, "reserved · takes 40–60");
    // In the board's own word for it, where it has one (#1516).
    assert.equal(line(yardDay, context.resources.get("K-601")!, loads(yardDay, plan, context).get("K-601")!, "m³", "held").text, "held · takes 40–60");
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
    const first = (plan: ValueTypeOf<typeof YardPlan>) => slots(yardDay, plan, context).find(s => s.status.type === "free")!;
    const plan = fresh();
    const free = first(plan);
    assert.deepEqual([free.lane, free.at.getTime()], ["B-1", Date.UTC(2027, 4, 11, 0, 15)]);
    // Taken, the next is B-2 at 00:35: time first, then lane order.
    const parts = new SortedMap([["K-107", 21]], byString);
    plan.bins.set("N1", { lane: "B-1", at: free.at, arrival: some("LD-2231"), quantity: 21, kind: some("MC12"), hold: variant("days", 8), parts,
        row: { bay: "B-1", at: free.at, load: some("LD-2231"), m3: 21, spec: some("MC12"), dryFor: variant("days", 8), kilns: parts,
            specBooked: "MC12", specMeasured: "MC12", gradeBooked: "R", gradeMeasured: "R2", instruction: none } });
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
    const k203 = builtIn(takeOf("K-203"), plan);
    assert.equal(k203.bins.size, 26);
    assert.equal(k203.resources.size, 0);
    assert.equal(k203.reserve.type === "some" && k203.reserve.value.type, "fits");
    plan.bins.get("3105")!.quantity = 40;
    plan.bins.get("3105")!.parts.set("K-203", 40);
    const full = builtIn(takeOf("K-203"), plan);
    assert.ok(full.reserve.type === "some");
    assert.equal(refusal(full.reserve.value).reason, "full · 40 m³ · takes 20–40");
    assert.equal(candidates(takeOf("K-203"), readOf(plan)).at(-1)!.reserve, true);
});

test("A48, A61 — a take: a verdict for booking each arrival the plan has not booked onto the resource, the one a place of it gives there", () => {
    const take = (resource: string, plan = fresh()) => builtIn(takeOf(resource), plan);
    // The six loads still to book, and no other: every one fits K-601, under its minimum.
    const k601 = take("K-601");
    assert.deepEqual([...k601.arrivals.keys()], ["LD-2231", "LD-2232", "LD-2233", "LD-2234", "LD-2235", "LD-2236"]);
    assert.ok([...k601.arrivals.values()].every(f => f.type === "fits" && f.value.warn.type === "some" && f.value.warn.value === "under min"));
    // Each verdict is the one a place of the arrival gives on that resource.
    for (const resource of ["K-601", "K-107", "K-101", "K-503"]) {
        const answer = take(resource);
        for (const [code, verdict] of answer.arrivals) assert.deepEqual(verdict, builtIn(placeArrival(code)).resources.get(resource), `${code} on ${resource}`);
    }
    assert.equal(refusal(take("K-101").arrivals.get("LD-2235")).reason, "over max by 7 m³");
    // Asked of the day without a bin, that bin's arrival is one to book: what a row's Chooser offers in its place.
    const without = fresh();
    without.bins.delete("3101");
    assert.ok(take("K-209", without).arrivals.has("LD-2201"));
    assert.equal(take("K-209").arrivals.has("LD-2201"), false);
    // A place answers no arrivals, as a take answers no resources.
    assert.equal(builtIn(placeArrival("LD-2231")).arrivals.size, 0);
});

test("§12.3 rule 4 — a reservation placed is checked with no quantity and each resource's own hold, as a take reserves", () => {
    const plan = fresh();
    plan.bins.set("V1", reservation("B-1", new Date(Date.UTC(2027, 4, 11, 0, 15)), new SortedMap([], byString)));
    const placed = builtIn(placeBin("V1", 0), plan);
    // Each resource's verdict is the one its take gives for reserving.
    for (const resource of ["K-101", "K-104", "K-207", "K-503", "K-601"]) {
        const take = builtIn(takeOf(resource), plan);
        assert.ok(take.reserve.type === "some");
        assert.deepEqual(placed.resources.get(resource), take.reserve.value, resource);
    }
    // K-104's own 8-day hold runs past its next job, a 0-day hold would not: the resource's hold decides.
    assert.equal(refusal(placed.resources.get("K-104")).reason, "gap too short · next job Fri 14");
});

test("a type constructor returns the same East type for the same bin row type", () => {
    assert.ok(isTypeEqual(Allocation.Types.Day(KilnBin), Allocation.Types.Day(KilnBin)));
    assert.equal(isTypeEqual(Allocation.Types.Day(KilnBin), Allocation.Types.Day(StringType)), false);
});

// ============================================================================
// The fit's contract (east-workspace#1624)
// ============================================================================

test("#1624 rule 1 — a fit's request holds the day, the question and the scope alone, and takes no row type", () => {
    assert.deepEqual(Object.keys(Allocation.Types.FitRequest.fields), ["day", "ask", "scope"]);
    // The scope is typed as an optimiser's `slice` is (#1622): each rail source's fields by the source's name.
    assert.ok(isTypeEqual(Allocation.Types.FitRequest.fields.scope, Allocation.Types.OptimiseRequest.fields.slice));
    // What a function read holds no row either: the bins are their roles.
    assert.ok(isTypeEqual(Allocation.Types.FitContext.fields.bins, DictType(StringType, Schedule.Types.AllocationRoles)));
});

test("#1624 — the yard's fit on e3 reads the day's bins through their index, and answers what the rules answer over the day the page holds", () => {
    // The record holds three days' bins; the function reads the plan day's 26 through the interval index, and no other.
    for (const request of [placeArrival("LD-2231"), placeArrival("LD-2236"), placeBin("3113", 32), takeOf("K-601"), takeOf("K-203")]) {
        sameAnswer(yard(request), aheadOver(request, readOf(fresh())), printFor(Allocation.Types.FitAsk)(request.ask));
    }
    // Asked of another day, it reads that day's bins: Wed 12's three, split across kilns.
    const split = yard(asked(variant("take", { resource: "K-110" }), yardSplitDay));
    assert.deepEqual([...split.bins.keys()], ["3201", "3202", "3203"]);
});

test("#1624 — a bin the record does not hold yet, laid over it as a draft is: its part counts in its kiln's load, and a place of it is answered", () => {
    // What e3 hands the body for a call with drafts: the record with the unsaved bin in it, and its index over that state.
    const rows = freshRows();
    const parts = new SortedMap([["K-107", 21]], byString);
    rows.set("N1", { bay: "B-1", at: new Date(Date.UTC(2027, 4, 11, 0, 15)), load: some("LD-2231"), m3: 21, spec: some("MC12"), dryFor: variant("days", 8), kilns: parts,
        specBooked: "MC12", specMeasured: "MC12", gradeBooked: "R", gradeMeasured: "R2", instruction: none });
    // K-107 takes 12–24 m³: saved it is free and LD-2236's 11 m³ fits it; with the unsaved 21 m³ on it, those 11 m³ are 8 over its maximum.
    assert.equal(yard(placeArrival("LD-2236")).resources.get("K-107")?.type, "fits");
    assert.equal(refusal(yard(placeArrival("LD-2236"), rows).resources.get("K-107")).reason, "over max by 8 m³");
    // The unsaved bin is a subject like any other, and its load is booked: a take offers it no more.
    const placed = yard(placeBin("N1", 21), rows);
    assert.equal(placed.resources.get("K-107")?.type, "fits");
    assert.equal(yard(takeOf("K-601"), rows).arrivals.has("LD-2231"), false);
    assert.equal(yard(takeOf("K-601")).arrivals.has("LD-2231"), true);
});

test("#1624 rule 2 — an answer covers the subjects the function considered: a context of one hall's kilns gives verdicts for those alone", () => {
    const hallA = new SortedMap([...context.resources].filter(([, kiln]) => kiln.group.type === "some" && kiln.group.value === "Hall A"), byString);
    const answer = builtInOver(placeArrival("LD-2231"), { ...readOf(fresh()), resources: hallA });
    assert.deepEqual([...answer.resources.keys()], [...hallA.keys()]);
    // Each is the verdict the whole yard's answer gives that kiln: a part on a kiln outside the context is on none.
    const whole = builtIn(placeArrival("LD-2231"));
    for (const [key, fit] of answer.resources) assert.deepEqual(fit, whole.resources.get(key), key);
});

test("#1624 rule 7 — the question's own subject: a place's bin or arrival, or a take's resource, not in the context fails the call", () => {
    const read = readOf(fresh());
    assert.throws(() => builtInOver(placeBin("nowhere", 8), read));
    assert.throws(() => builtInOver(asked(variant("place", { subject: variant("arrival", "LD-0000"), quantity: 8 })), read));
    assert.throws(() => builtInOver(takeOf("K-000"), read));
    // And through the yard's function, as e3 runs it.
    assert.throws(() => yard(placeBin("nowhere", 8)));
});

test("#1624 — the smallest board's fit reads as its page's kinds do: no kind, no group, a kiln's hold no time", () => {
    // The page's reading of the same records, through the board's own adapters with the smallest board's accessors.
    const contextOf = East.compile(East.function([DictType(StringType, Bay), DictType(StringType, TimberLoad), DictType(StringType, Kiln)], Allocation.Types.Context,
        (_$, bays, loadRows, yardRows) => Allocation.context({
            lanes: Schedule.resources(bays, { name: "Bays", icon: "warehouse", label: b => b.name, offset: b => b.offset }),
            arrivals: Allocation.arrivals(loadRows, { label: l => l.code, quantity: l => l.m3, hold: l => variant("days", l.dryingDays) }),
            resources: Schedule.resources(yardRows, { name: "Kilns", icon: "fire", label: k => k.name, min: k => k.min, max: k => k.max, jobs: k => k.charges }),
            unit: "m³",
        })), []);
    const page = contextOf(yardBayRows, yardArrivals, yardKilns);
    const read: Read = {
        bins: new SortedMap<string, Roles>([...yardMinimalBinRows].map(([id, row]) => [id, {
            at: row.at, lane: row.bay, arrival: row.load, quantity: row.m3, parts: row.kilns, hold: row.dryFor, kind: none,
        }] as const), byString),
        arrivals: page.arrivals, resources: page.resources, rules: page.rules, unit: page.unit,
    };
    for (const request of [placeArrival("LD-2231"), placeBin("3113", 32), takeOf("K-601")]) {
        sameAnswer(minimal(request), builtInOver(request, read), printFor(Allocation.Types.FitAsk)(request.ask));
    }
});
