/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * The Roster's fit (#1334, `Allocation Spec.md` §13): the ready-made rule
 * (`Roster.fit(R)`), `Roster.answer(R)`, and the warehouse's greedy fit, held to
 * the warehouse's own week — its duties, as the Roster reads them
 * (`Roster.Types.Week(WarehouseDuty)`). Each find is one `Roster.check(R)`
 * reports; every figure and word is the functions' answer over the seeded
 * staff — the mock's 69, and the indexed example's 500 — through the Roster's
 * own adapters of the warehouse's rows.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DictType, East, FloatType, StringType, compareFor, decodeBeast2For, encodeBeast2For, isTypeEqual, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Allocation, Roster } from "@elaraai/e3-ui";
import { Schedule, rosterAgenciesOf, rosterPeopleOf, rosterPersonHours } from "@elaraai/e3-ui/internal";
import {
    WarehouseActivity, WarehouseAgency, WarehouseDuty, WarehousePerson, WarehousePosition, WarehouseRosterWeek, WarehouseShift, WarehouseTeam,
    warehouseActivities, warehouseAgencies, warehousePeople, warehousePositions, warehouseShifts, warehouseStart, warehouseTeams, warehouseWeek,
} from "./warehouse.js";
import { indexedRosterStaff } from "./roster-records.examples.js";
import { rosterContractFitBody, rosterStaffFitBody } from "./roster.examples.js";

const FitRequest = Roster.Types.FitRequest(WarehouseDuty);
type Week = ValueTypeOf<typeof WarehouseRosterWeek>;
type Context = ValueTypeOf<typeof Roster.Types.Context>;
type Request = ValueTypeOf<typeof FitRequest>;
type Result = ValueTypeOf<typeof Roster.Types.FitResult>;
type Fit = ValueTypeOf<typeof Roster.Types.Fit>;
type Find = Pick<Request, "need" | "slot">;

// The context the Roster sends: the warehouse's rows through the Roster's own adapters, as the examples bind them.
const contextOf = East.compile(East.function(
    [DictType(StringType, WarehousePerson), DictType(StringType, WarehouseActivity), DictType(StringType, WarehouseShift), DictType(StringType, WarehouseTeam),
        DictType(StringType, WarehousePosition), DictType(StringType, WarehouseAgency)],
    Roster.Types.Context, ($, staff, activities, shifts, teams, positions, agencies) => {
        const people = $.const(rosterPeopleOf(Schedule.resources(staff, {
            name: "People", icon: "user", label: p => p.name, group: p => p.team, position: p => p.position, skills: p => p.skills,
            contract: p => p.contract, agency: p => p.agency, trainer: p => p.trainer, trainee: p => p.trainee, usual: p => p.usual,
        })));
        return {
            people: people.toDict((_$2, p) => p.key, (_$2, p) => p),
            groups: Roster.groups(teams, { label: t => t.label, order: t => t.order }).rows,
            activities: Roster.activities(activities, { label: a => a.label, code: a => a.code, group: a => a.group, order: a => a.order }),
            shifts: Roster.shifts(shifts, { label: s => s.label, code: s => s.code, start: s => s.start, hours: s => s.hours, order: s => s.order }).rows,
            positions: Roster.positions(positions, { label: p => p.label, code: p => p.code, lead: p => p.lead, order: p => p.order }).rows,
            agencies: rosterAgenciesOf(Schedule.resources(agencies, { name: "Agencies", icon: "building", label: a => a.name })),
            rules: { rest: 10, lead: true, trainer: true, skill: true },
        };
    }), []);
const indexedStaff = indexedRosterStaff.default;
if (indexedStaff === undefined) throw new Error("the indexed example seeds its 500 staff");
const context = contextOf(warehousePeople, warehouseActivities, warehouseShifts, warehouseTeams, warehousePositions, warehouseAgencies);
const indexed = contextOf(indexedStaff, warehouseActivities, warehouseShifts, warehouseTeams, warehousePositions, warehouseAgencies);
// The warehouse's week as a fresh decoded value, so a test may change it.
const fresh = (): Week => decodeBeast2For(WarehouseRosterWeek)(encodeBeast2For(WarehouseRosterWeek)(warehouseWeek));
const noPay = (): ValueTypeOf<typeof Roster.Types.Pay> => new Map();

const coverage = East.compile(Roster.coverage(WarehouseDuty), []), check = East.compile(Roster.check(WarehouseDuty), []);
const weekHours = East.compile(Roster.weekHours(WarehouseDuty), []);
const personHours = East.compile(rosterPersonHours(WarehouseDuty), []);
const builtIn = East.compile(East.function([FitRequest], Roster.Types.FitResult, ($, req) => {
    const answer = $.const(Roster.answer(WarehouseDuty));
    const rule = $.const(Roster.fit(WarehouseDuty));
    return answer(req, rule);
}), []);
const greedy = East.compile(rosterStaffFitBody, []);
const contract = East.compile(rosterContractFitBody, []);

/** An issue's find, as `Roster.check` reports it: its need and its slot. */
function findOf(title: string, day: bigint, week: Week = fresh(), ctx: Context = context): Find {
    const issue = check(week, ctx).find(i => i.title === title && i.slot.type === "some" && i.slot.value.day === day);
    assert.ok(issue !== undefined && issue.fix.type === "some" && issue.fix.value.type === "find" && issue.slot.type === "some", `${title} on day ${day}`);
    return { need: issue.fix.value.value, slot: issue.slot.value };
}
/** The question the Roster asks for a find, over the drafted week and its coverage. */
const ask = (find: Find, week: Week = fresh(), ctx: Context = context): Request => ({ ...find, start: warehouseStart, week, context: ctx, coverage: coverage(week, ctx, noPay()) });
const byScore = compareFor(FloatType);
/** An answer's fits, best first — ties in staff-key order, as the People tab lists them: key, score, reason. */
const ranked = (result: Result) => [...result.people].flatMap(([key, fit]) => fit.type === "fits" ? [{ key, score: fit.value.score, why: fit.value.why }] : [])
    .sort((a, b) => byScore(b.score, a.score)).map(f => [f.key, f.score, f.why]);
/** How many of an answer's people each refusal group holds. */
const refused = (result: Result) => [...result.people.values()].reduce((counts, fit) =>
    fit.type === "refused" ? { ...counts, [fit.value.group]: (counts[fit.value.group] ?? 0) + 1 } : counts, {} as Record<string, number>);

/** A refusal with nothing measured, as the fit gives one: its group and its reason. */
const refusal = (group: string, reason: string): Fit => variant("refused", { group, reason, measure: variant("none", null) });
const LEAD = () => findOf("No lead on Dispatch · Early", 4n);
const TRAINER_THU = () => findOf("B. Swale · trainee without trainer", 4n);

test("R1 — Roster.fit: the need held, not rostered that day, rest kept — each refusal its group and reason, J. Quartz the one lead free for Dispatch's early shift on Thursday", () => {
    assert.deepEqual(LEAD(), { need: variant("leads", null), slot: { day: 4n, group: "dispatch", shift: "early" } });
    const result = builtIn(ask(LEAD()));
    assert.deepEqual(ranked(result), [["jquartz", 182, "Dispatch · 14 h spare"]]);
    assert.deepEqual(refused(result), { "Not a lead": 57, Rostered: 11 });
    assert.deepEqual(result.people.get("wcopse"), refusal("Not a lead", "Associate · not a lead"));
    assert.deepEqual(result.people.get("aalder"), refusal("Rostered", "rostered on Inbound · Early"));
    // A night on Dispatch the day before, to 06:00 Thursday, leaves no rest before the early shift: refused, its measure the rest.
    const week = fresh();
    const start = new Date("2028-03-08T22:00:00Z"), end = new Date("2028-03-09T06:00:00Z");
    week.assignments.set("x-night", { slot: { day: 3n, group: "dispatch", shift: "night" }, who: variant("person", "jquartz"), position: "deputy",
        activity: none, start, end, hours: 8, row: { who: variant("staff", "jquartz"), start, end, shift: "night", team: "dispatch", role: "deputy",
            task: none, unpaidBreak: 0, agreed: none, costCentre: "CC-DS", note: "" } });
    assert.deepEqual(builtIn(ask(LEAD(), week)).people.get("jquartz"),
        variant("refused", { group: "Rest too short", reason: "0 h rest · minimum 10 h", measure: variant("amount", { lead: "rest", value: 0 }) }));
    // With no minimum rest, the night refuses nothing.
    assert.equal(builtIn(ask(LEAD(), week, { ...context, rules: { ...context.rules, rest: 0 } })).people.get("jquartz")?.type, "fits");
});

test("R1 — Roster.fit: a skill's holders and a trainee's trainers — the skill held, every trainer rostered on Thursday", () => {
    const unload = builtIn(ask(findOf("Unloading · 8 h short", 4n)));
    assert.deepEqual(ranked(unload), [["nochre", 182, "Inbound · 14 h spare"]]);
    assert.deepEqual(refused(unload), { "Not skilled": 47, Rostered: 21 });
    assert.deepEqual(unload.people.get("aosier"), refusal("Not skilled", "doesn't hold Unloading"));
    const trainers = builtIn(ask(TRAINER_THU()));
    assert.deepEqual(ranked(trainers), []);
    assert.deepEqual(refused(trainers), { "Not a trainer": 66, Rostered: 3 });
    assert.deepEqual(["haspen", "dheath", "rplover"].map(key => trainers.people.get(key)), [
        refusal("Rostered", "rostered on Inbound · Early"),
        refusal("Rostered", "rostered on Inbound · Late"),
        refusal("Rostered", "rostered on Picking · Early"),
    ]);
});

test("R1 — Roster.fit ranks the slot's group first, then spare contract hours; over the contract it says so", () => {
    // Saturday's trainee: two Inbound trainers are off, one with hours to spare, one already over contract.
    assert.deepEqual(ranked(builtIn(ask(findOf("B. Swale · trainee without trainer", 6n)))), [
        ["dheath", 6, "from Inbound · 6 h spare"],
        ["haspen", -2, "from Inbound · 2 h over contract"],
    ]);
    // Over the 500, Thursday's trainers: Picking's own six first, a week's 168 hours above the thirteen of Inbound.
    const fits = ranked(builtIn(ask(TRAINER_THU(), fresh(), indexed)));
    assert.equal(fits.length, 19);
    assert.deepEqual(fits.slice(0, 7), [
        ["pool-1056", 206, "Picking · 38 h spare"], ["pool-1125", 206, "Picking · 38 h spare"], ["pool-1194", 206, "Picking · 38 h spare"],
        ["pool-1263", 206, "Picking · 38 h spare"], ["pool-1332", 206, "Picking · 38 h spare"], ["pool-1401", 206, "Picking · 38 h spare"],
        ["pool-1013", 38, "from Inbound · 38 h spare"],
    ]);
    assert.ok(fits.slice(6).every(([, score, why]) => byScore(score as number, 38) === 0 && why === "from Inbound · 38 h spare"));
});

test("R1 — Roster.answer: a verdict for every person of the complete staff, with the need and the slot it answers", () => {
    const find = LEAD();
    for (const ctx of [context, indexed]) {
        const result = builtIn(ask(find, fresh(), ctx));
        assert.deepEqual([result.need, result.slot], [find.need, find.slot]);
        assert.deepEqual([...result.people.keys()], [...ctx.people.keys()]);
    }
    assert.equal(indexed.people.size, 500);
});

test("R5 — the warehouse's greedy fit: the ready-made rule's fits and reasons, the most spare contract hours first, whatever the group", () => {
    // Every find of Thursday: the same people fit as the rule says, for the same reasons, each scored by their spare hours alone.
    const finds = check(fresh(), context).flatMap(i => i.fix.type === "some" && i.fix.value.type === "find" && i.slot.type === "some" && i.slot.value.day === 4n
        ? [{ need: i.fix.value.value, slot: i.slot.value }] : []);
    assert.equal(finds.length, 5);
    const hours = weekHours(fresh(), context);
    for (const find of finds) {
        const rule = builtIn(ask(find)), ours = greedy(ask(find));
        assert.deepEqual([...ours.people].map(([key, fit]) => [key, fit.type, fit.type === "fits" ? fit.value.why : fit.value]),
            [...rule.people].map(([key, fit]) => [key, fit.type, fit.type === "fits" ? fit.value.why : fit.value]));
        for (const [key, fit] of ours.people) {
            if (fit.type === "fits") assert.equal(fit.value.score, context.people.get(key)!.contract - hours.get(key)!, key);
        }
    }
    assert.deepEqual(ranked(greedy(ask(LEAD()))), [["jquartz", 14, "Dispatch · 14 h spare"]]);
    assert.deepEqual(ranked(greedy(ask(findOf("B. Swale · trainee without trainer", 6n)))), [
        ["dheath", 6, "from Inbound · 6 h spare"], ["haspen", -2, "from Inbound · 2 h over contract"],
    ]);
    // Over the 500, Thursday's trainers all have 38 hours to spare: the slot's group no longer leads, so they rank in staff-key order.
    assert.deepEqual(ranked(greedy(ask(TRAINER_THU(), fresh(), indexed))).slice(0, 3), [
        ["pool-1013", 38, "from Inbound · 38 h spare"], ["pool-1027", 38, "from Inbound · 38 h spare"], ["pool-1056", 38, "Picking · 38 h spare"],
    ]);
});

test("another app's fit: the warehouse's order and reasons, and a warning on whoever the slot's 8-hour shift would take past their contract", () => {
    /** An answer's fits, best first: key, score, reason and warning. */
    const warned = (result: Result) => [...result.people].flatMap(([key, fit]) => fit.type === "fits" ? [{ key, ...fit.value }] : [])
        .sort((a, b) => byScore(b.score, a.score)).map(f => [f.key, f.score, f.why, f.warn]);
    // Thursday's lead: J. Quartz has 14 hours to spare, more than the shift.
    assert.deepEqual(warned(contract(ask(LEAD()))), [["jquartz", 14, "Dispatch · 14 h spare", none]]);
    // Saturday's trainee: D. Heath has 6 to spare, short of the shift, and H. Aspen is 2 over already.
    assert.deepEqual(warned(contract(ask(findOf("B. Swale · trainee without trainer", 6n)))), [
        ["dheath", 6, "from Inbound · 6 h spare", some("past contract")],
        ["haspen", -2, "from Inbound · 2 h over contract", some("past contract")],
    ]);
    // Whom the rule refuses, it refuses too.
    const rule = builtIn(ask(LEAD())), ours = contract(ask(LEAD()));
    assert.deepEqual([...ours.people].filter(([, fit]) => fit.type === "refused"), [...rule.people].filter(([, fit]) => fit.type === "refused"));
});

test("Roster.fit's hours are the ones Roster.weekHours gives each person", () => {
    for (const [week, ctx] of [[fresh(), context], [fresh(), indexed]] as const) {
        const hours = weekHours(week, ctx);
        for (const key of ctx.people.keys()) assert.equal(personHours(week, ctx, key), hours.get(key), key);
    }
});

test("the Roster's fit is Schedule's, the Allocation's too; a find's need is the Fix's find", () => {
    assert.ok(isTypeEqual(Roster.Types.Fit, Schedule.Types.Fit));
    assert.ok(isTypeEqual(Roster.Types.Fit, Allocation.Types.Fit));
    assert.ok(isTypeEqual(Roster.Types.Refusal, Allocation.Types.Refusal));
    assert.ok(isTypeEqual(Roster.Types.Fix.cases.find, Roster.Types.Need));
    assert.ok(isTypeEqual(Roster.Types.FitResult.fields.people.value, Schedule.Types.Fit));
});
