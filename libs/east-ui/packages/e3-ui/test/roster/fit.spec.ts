/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * The Roster's fit (#1334, east-workspace#1624; `Allocation Spec.md` §13): the
 * ready-made rule (`Roster.fit()`), `Roster.answer()` and `Roster.window`, and
 * the warehouse's fits on e3, held to the warehouse's own week. Each find is
 * one `Roster.check(R)` reports; every figure and word is the functions'
 * answer over the seeded staff — the mock's 69, and the indexed example's 500.
 *
 * The rule and the answer are held to a context that holds what the page
 * holds — the week's duties as the Roster reads them, the complete staff, the
 * configuration — so their verdicts are the ones a request that carried the
 * week gave. The warehouse's functions are run as e3 runs them: each over its
 * own inputs, the duties' and the staff's indexes built as e3 builds them, and
 * a request that carries the need, the slot, the week's first day and the
 * scope, and no row.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
    DateTimeType, DictType, East, FloatType, IntegerType, SortedMap, StringType, StructType, compareFor, decodeBeast2For, encodeBeast2For, equalFor,
    isTypeEqual, none, printFor, some, variant, type EastIR, type EastType, type ValueTypeOf,
} from "@elaraai/east";
import { RecordSliceWhereType } from "@elaraai/east-ui/internal";
import { Allocation, Roster } from "@elaraai/e3-ui";
import { Schedule, rosterAgenciesOf, rosterPeopleOf } from "@elaraai/e3-ui/internal";
import { indexEntries } from "../index-entries.js";
import {
    WarehouseActivity, WarehouseAgency, WarehouseDuty, WarehousePerson, WarehousePosition, WarehouseRosterWeek, WarehouseShift, WarehouseTeam,
    warehouseActivities, warehouseAgencies, warehouseDuties, warehousePeople, warehousePositions, warehouseShifts, warehouseStart, warehouseTeams, warehouseWeek,
} from "./warehouse.js";
import { indexedRosterDuties, indexedRosterStaff, indexedStaffFit } from "./roster-records.examples.js";
import { rosterContractFit, rosterDuties, rosterDutyRoles, rosterLockedDuties, rosterLockedFit, rosterStaff, rosterStaffFit } from "./roster.examples.js";

type Week = ValueTypeOf<typeof WarehouseRosterWeek>;
type Context = ValueTypeOf<typeof Roster.Types.Context>;
/** What a fit's function read, the duties keyed by String, as the warehouse's are. */
const FitContext = Roster.Types.FitContext();
type Read = ValueTypeOf<typeof FitContext>;
type Request = ValueTypeOf<typeof Roster.Types.FitRequest>;
type Result = ValueTypeOf<typeof Roster.Types.FitResult>;
type Fit = ValueTypeOf<typeof Roster.Types.Fit>;
type Find = Pick<Request, "need" | "slot">;
type Duty = ValueTypeOf<typeof WarehouseDuty>;
type Person = ValueTypeOf<typeof WarehousePerson>;
type Roles = ValueTypeOf<typeof Schedule.Types.RosterRoles>;

const byString = compareFor(StringType);

// The context the page holds: the warehouse's rows through the Roster's own adapters, as the examples bind them.
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

const check = East.compile(Roster.check(WarehouseDuty), []);
const weekHours = East.compile(Roster.weekHours(WarehouseDuty), []);

/**
 * What a function read, holding what the page holds: the week's duties as the Roster reads them — each assignment's
 * roles — the page's complete staff and its configuration, and its rest rule.
 */
const read = (week: Week = fresh(), ctx: Context = context): Read => ({
    people: ctx.people,
    duties: new SortedMap([...week.assignments].map(([key, a]): [string, Roles] => [key, {
        start: a.start, end: a.end, resource: some({ kind: a.who.type === "person" ? "people" : "agencies", key: a.who.value }),
        shift: a.place.shift, group: a.place.group, position: some(a.position), activity: a.activity, hours: a.hours,
    }]), byString),
    shifts: ctx.shifts, groups: ctx.groups, positions: ctx.positions, activities: ctx.activities, rest: ctx.rules.rest,
});
/** The ready-made rule over what a function read: `Roster.answer()` with `Roster.fit()`. */
const builtIn = East.compile(East.function([Roster.Types.FitRequest, FitContext], Roster.Types.FitResult, ($, request, cx) => {
    const answer = $.const(Roster.answer());
    const rule = $.const(Roster.fit());
    return answer(request, cx, rule);
}), []);

// The warehouse's fits, each its function's body over its own inputs, as e3 runs it.
const staffFit = (rosterStaffFit.body as EastIR<EastType[], EastType>).compile([]) as unknown as (...inputs: unknown[]) => Result;
const contractFit = (rosterContractFit.body as EastIR<EastType[], EastType>).compile([]) as unknown as (...inputs: unknown[]) => Result;
const byTime = (duties: ReadonlyMap<string, Duty>) => indexEntries(rosterDuties, rosterDuties.indexes.roster_duties_by_time, duties).entries;
/** The warehouse's greedy fit over the duties and the staff given: the holders of the need, through the staff's indexes. */
const greedy = (request: Request, duties: ReadonlyMap<string, Duty> = warehouseDuties, staff: ReadonlyMap<string, Person> = warehousePeople): Result => staffFit(
    byTime(duties), duties,
    indexEntries(rosterStaff, rosterStaff.indexes.roster_staff_by_skill, staff).entries,
    indexEntries(rosterStaff, rosterStaff.indexes.roster_staff_by_position, staff).entries,
    indexEntries(rosterStaff, rosterStaff.indexes.roster_staff_by_trainer, staff).entries, staff,
    warehouseShifts, warehouseTeams, warehousePositions, warehouseActivities, request);
/**
 * The indexed roster's fit over the duties and its 500 staff, each through its own record's indexes — on a page whose
 * scope holds its people to some positions, those alone.
 */
const indexedBody = (indexedStaffFit.body as EastIR<EastType[], EastType>).compile([]) as unknown as (...inputs: unknown[]) => Result;
const indexedFit = (request: Request, duties: ReadonlyMap<string, Duty> = warehouseDuties): Result => indexedBody(
    indexEntries(indexedRosterDuties, indexedRosterDuties.indexes.indexed_roster_duties_by_time, duties).entries, duties,
    indexEntries(indexedRosterStaff, indexedRosterStaff.indexes.staff_by_skill, indexedStaff).entries,
    indexEntries(indexedRosterStaff, indexedRosterStaff.indexes.staff_by_position, indexedStaff).entries,
    indexEntries(indexedRosterStaff, indexedRosterStaff.indexes.staff_by_trainer, indexedStaff).entries, indexedStaff,
    warehouseShifts, warehouseTeams, warehousePositions, warehouseActivities, request);
/** The warehouse's fit over its locked duties: the same order, the week read through that record's own index. */
const lockedBody = (rosterLockedFit.body as EastIR<EastType[], EastType>).compile([]) as unknown as (...inputs: unknown[]) => Result;
const lockedFit = (request: Request, duties: ReadonlyMap<string, Duty> = warehouseDuties): Result => lockedBody(
    indexEntries(rosterLockedDuties, rosterLockedDuties.indexes.roster_locked_duties_by_time, duties).entries, duties,
    indexEntries(rosterStaff, rosterStaff.indexes.roster_staff_by_skill, warehousePeople).entries,
    indexEntries(rosterStaff, rosterStaff.indexes.roster_staff_by_position, warehousePeople).entries,
    indexEntries(rosterStaff, rosterStaff.indexes.roster_staff_by_trainer, warehousePeople).entries, warehousePeople,
    warehouseShifts, warehouseTeams, warehousePositions, warehouseActivities, request);
/** Another app's fit over the same staff: everyone, the staff read whole. */
const contract = (request: Request, duties: ReadonlyMap<string, Duty> = warehouseDuties, staff: ReadonlyMap<string, Person> = warehousePeople): Result => contractFit(
    byTime(duties), duties, staff, warehouseShifts, warehouseTeams, warehousePositions, warehouseActivities, request);

/** An issue's find, as `Roster.check` reports it: its need and its slot. */
function findOf(title: string, day: bigint, week: Week = fresh(), ctx: Context = context): Find {
    const issue = check(week, ctx).find(i => i.title === title && i.slot.type === "some" && i.slot.value.day === day);
    assert.ok(issue !== undefined && issue.fix.type === "some" && issue.fix.value.type === "find" && issue.slot.type === "some", `${title} on day ${day}`);
    return { need: issue.fix.value.value, slot: issue.slot.value };
}
/** The question the Roster asks for a find: the need, the slot, the week's first day and the page's scope, here none. */
const ask = (find: Find): Request => ({ ...find, start: warehouseStart, scope: new Map() });
const byScore = compareFor(FloatType);
/** An answer's fits, best first — ties in staff-key order, as the People tab lists them: key, score, reason. */
const ranked = (result: Result) => [...result.people].flatMap(([key, fit]) => fit.type === "fits" ? [{ key, score: fit.value.score, why: fit.value.why }] : [])
    .sort((a, b) => byScore(b.score, a.score)).map(f => [f.key, f.score, f.why]);
/** How many of an answer's people each refusal group holds. */
const refused = (result: Result) => [...result.people.values()].reduce((counts, fit) =>
    fit.type === "refused" ? { ...counts, [fit.value.group]: (counts[fit.value.group] ?? 0) + 1 } : counts, {} as Record<string, number>);

const sameFit = equalFor(Roster.Types.Fit);
const printFit = printFor(Roster.Types.Fit);
const sameAnswer = equalFor(Roster.Types.FitResult);
const printAnswer = printFor(Roster.Types.FitResult);
/** Holds an answer to the one expected, by East's own equality. */
function sameResult(actual: Result, expected: Result, of: string): void {
    assert.ok(sameAnswer(actual, expected), `${of}: ${printAnswer(actual)}, expected ${printAnswer(expected)}`);
}
/** Holds a verdict to the one expected, by East's own equality. */
function verdict(actual: Fit | undefined, expected: Fit, of = ""): void {
    assert.ok(actual !== undefined && sameFit(actual, expected), `${of} ${actual === undefined ? "has no verdict" : printFit(actual)}, expected ${printFit(expected)}`);
}
/** A refusal with nothing measured, as the fit gives one: its group and its reason. */
const refusal = (group: string, reason: string): Fit => variant("refused", { group, reason, measure: variant("none", null) });
const FindType = StructType({ need: Roster.Types.Need, slot: Roster.Types.Slot });
const LEAD = () => findOf("No lead on Dispatch · Early", 4n);
const TRAINER_THU = () => findOf("B. Swale · trainee without trainer", 4n);
/** The refusals of someone who does not hold the need: whom a function that reads the need's holders alone never asks about. */
const NOT_HELD = ["Not a lead", "Not a trainer", "Not skilled"];

test("the types (#1624): a request is the need, the slot, the week's first day and the page's scope, and no row; a context and a candidate hold the Roster's reading, never the app's row", () => {
    assert.ok(isTypeEqual(Roster.Types.FitRequest, StructType({
        need: Roster.Types.Need, slot: Roster.Types.Slot, start: DateTimeType, scope: DictType(StringType, RecordSliceWhereType),
    })));
    assert.ok(isTypeEqual(FitContext.fields.duties, DictType(StringType, Schedule.Types.RosterRoles)));
    assert.ok(isTypeEqual(FitContext.fields.people, DictType(StringType, Roster.Types.Person)));
    assert.ok(isTypeEqual(Roster.Types.Candidate().fields.duties, DictType(StringType, StructType({ place: Roster.Types.Place, roles: Schedule.Types.RosterRoles }))));
    assert.deepEqual(Object.keys(Roster.Types.Candidate().fields),
        ["need", "slot", "start", "person", "duties", "hours", "shifts", "groups", "positions", "activities", "rest"]);
});

test("Roster.window: the window a week's duties are read over — the week and the twelve hours either side", () => {
    const windowOf = East.compile(Roster.window, []);
    const Window = StructType({ from: DateTimeType, to: DateTimeType });
    assert.ok(equalFor(Window)(windowOf(warehouseStart), { from: new Date("2028-03-04T12:00:00Z"), to: new Date("2028-03-12T12:00:00Z") }));
});

test("Roster.fit's `notALead`: the app's word in a refusal's reason and its group (#1516)", () => {
    const worded = East.compile(East.function([Roster.Types.FitRequest, FitContext], Roster.Types.FitResult, ($, request, cx) => {
        const answer = $.const(Roster.answer());
        const rule = $.const(Roster.fit({ notALead: "not a supervisor" }));
        return answer(request, cx, rule);
    }), []);
    verdict(worded(ask(LEAD()), read()).people.get("wcopse"), refusal("not a supervisor", "Associate · not a supervisor"));
});

test("R1 — Roster.fit: the need held, not rostered that day, rest kept — each refusal its group and reason, J. Quartz the one lead free for Dispatch's early shift on Thursday", () => {
    assert.ok(equalFor(FindType)(LEAD(), { need: variant("leads", null), slot: { day: 4n, group: "dispatch", shift: "early" } }));
    const result = builtIn(ask(LEAD()), read());
    assert.deepEqual(ranked(result), [["jquartz", 182, "Dispatch · 14 h spare"]]);
    assert.deepEqual(refused(result), { "Not a lead": 57, Rostered: 11 });
    verdict(result.people.get("wcopse"), refusal("Not a lead", "Associate · not a lead"));
    verdict(result.people.get("aalder"), refusal("Rostered", "rostered on Inbound · Early"));
    // A night on Dispatch the day before, to 06:00 Thursday, leaves no rest before the early shift: refused, its measure the rest.
    const week = fresh();
    const start = new Date("2028-03-08T22:00:00Z"), end = new Date("2028-03-09T06:00:00Z");
    week.assignments.set("x-night", { place: { day: 3n, group: some("dispatch"), shift: "night" }, who: variant("person", "jquartz"), position: "deputy",
        activity: none, start, end, hours: 8, row: { who: variant("staff", "jquartz"), start, end, shift: "night", team: "dispatch", role: "deputy",
            task: none, unpaidBreak: 0, agreed: none, costCentre: "CC-DS", note: "" } });
    verdict(builtIn(ask(LEAD()), read(week)).people.get("jquartz"),
        variant("refused", { group: "Rest too short", reason: "0 h rest · minimum 10 h", measure: variant("amount", { lead: "rest", value: 0 }) }));
    // With no rest to hold, the night refuses nothing.
    assert.equal(builtIn(ask(LEAD()), { ...read(week), rest: 0 }).people.get("jquartz")?.type, "fits");
    // A duty of theirs that day in no group yet (#1548) rosters them too: refused, rostered on its shift, which names no group.
    const placed = fresh();
    const noon = new Date("2028-03-09T06:00:00Z"), after = new Date("2028-03-09T14:00:00Z");
    placed.assignments.set("x-none", { place: { day: 4n, group: none, shift: "early" }, who: variant("person", "jquartz"), position: "deputy",
        activity: none, start: noon, end: after, hours: 8, row: { who: variant("staff", "jquartz"), start: noon, end: after, shift: "early", team: "dispatch", role: "deputy",
            task: none, unpaidBreak: 0, agreed: none, costCentre: "CC-DS", note: "" } });
    verdict(builtIn(ask(LEAD()), read(placed)).people.get("jquartz"), refusal("Rostered", "rostered on Early"));
});

test("R1 — Roster.fit: a skill's holders and a trainee's trainers — the skill held, every trainer rostered on Thursday", () => {
    const unload = builtIn(ask(findOf("Unloading · 8 h short", 4n)), read());
    assert.deepEqual(ranked(unload), [["nochre", 182, "Inbound · 14 h spare"]]);
    assert.deepEqual(refused(unload), { "Not skilled": 47, Rostered: 21 });
    verdict(unload.people.get("aosier"), refusal("Not skilled", "doesn't hold Unloading"));
    const trainers = builtIn(ask(TRAINER_THU()), read());
    assert.deepEqual(ranked(trainers), []);
    assert.deepEqual(refused(trainers), { "Not a trainer": 66, Rostered: 3 });
    verdict(trainers.people.get("haspen"), refusal("Rostered", "rostered on Inbound · Early"));
    verdict(trainers.people.get("dheath"), refusal("Rostered", "rostered on Inbound · Late"));
    verdict(trainers.people.get("rplover"), refusal("Rostered", "rostered on Picking · Early"));
});

test("R1 — Roster.fit ranks the slot's group first, then spare contract hours; over the contract it says so", () => {
    // Saturday's trainee: two Inbound trainers are off, one with hours to spare, one already over contract.
    assert.deepEqual(ranked(builtIn(ask(findOf("B. Swale · trainee without trainer", 6n)), read())), [
        ["dheath", 6, "from Inbound · 6 h spare"],
        ["haspen", -2, "from Inbound · 2 h over contract"],
    ]);
    // Over the 500, Thursday's trainers: Picking's own six first, a week's 168 hours above the thirteen of Inbound.
    const fits = ranked(builtIn(ask(TRAINER_THU()), read(fresh(), indexed)));
    assert.equal(fits.length, 19);
    assert.deepEqual(fits.slice(0, 7), [
        ["pool-1056", 206, "Picking · 38 h spare"], ["pool-1125", 206, "Picking · 38 h spare"], ["pool-1194", 206, "Picking · 38 h spare"],
        ["pool-1263", 206, "Picking · 38 h spare"], ["pool-1332", 206, "Picking · 38 h spare"], ["pool-1401", 206, "Picking · 38 h spare"],
        ["pool-1013", 38, "from Inbound · 38 h spare"],
    ]);
    assert.ok(fits.slice(6).every(([, score, why]) => byScore(score as number, 38) === 0 && why === "from Inbound · 38 h spare"));
});

test("R1 — Roster.answer(): a verdict for every person of the context, and no one else, with the need and the slot it answers", () => {
    const find = LEAD();
    for (const ctx of [context, indexed]) {
        const result = builtIn(ask(find), read(fresh(), ctx));
        assert.ok(equalFor(FindType)({ need: result.need, slot: result.slot }, find));
        assert.deepEqual([...result.people.keys()], [...ctx.people.keys()]);
    }
    assert.equal(indexed.people.size, 500);
    // A context of two people answers the two: whom a function asks about is its own choice.
    const two = new SortedMap([...context.people].filter(([key]) => key === "jquartz" || key === "wcopse"), byString);
    assert.deepEqual([...builtIn(ask(find), { ...read(), people: two }).people.keys()], ["jquartz", "wcopse"]);
});

test("Roster.answer() places the context's duties as the page does: a person's candidate holds their duties of the week, and the hours Roster.weekHours gives them", () => {
    // Each candidate's hours, and how many duties it holds, as a rule sees them: a rule that scores a candidate by each.
    const hoursSeen = East.compile(East.function([Roster.Types.FitRequest, FitContext], Roster.Types.FitResult, ($, request, cx) => {
        const answer = $.const(Roster.answer());
        return answer(request, cx, East.function([Roster.Types.Candidate()], Roster.Types.Fit, (_$2, candidate) =>
            variant("fits", { score: candidate.hours, why: "", warn: none })));
    }), []);
    const dutiesSeen = East.compile(East.function([Roster.Types.FitRequest, FitContext], Roster.Types.FitResult, ($, request, cx) => {
        const answer = $.const(Roster.answer());
        return answer(request, cx, East.function([Roster.Types.Candidate()], Roster.Types.Fit, (_$2, candidate) =>
            variant("fits", { score: candidate.duties.size().toFloat(), why: "", warn: none })));
    }), []);
    /** A rule's score for a person. */
    const scoreOf = (result: Result, key: string): number | undefined => {
        const fit = result.people.get(key);
        return fit !== undefined && fit.type === "fits" ? fit.value.score : undefined;
    };
    for (const [week, ctx] of [[fresh(), context], [fresh(), indexed]] as const) {
        const hours = weekHours(week, ctx), candidates = hoursSeen(ask(LEAD()), read(week, ctx));
        for (const key of ctx.people.keys()) assert.equal(scoreOf(candidates, key), hours.get(key), key);
    }
    // Beside H. Aspen's five duties of the week: one of the week before that the window reaches, one of a shift not
    // configured, and an agency's request — none is theirs this week.
    const there = read();
    const mine = [...there.duties].filter(([, roles]) => roles.resource.type === "some" && roles.resource.value.key === "haspen").length;
    assert.equal(mine, 5);
    const extra = (key: string, roles: Partial<Roles>): void => {
        there.duties.set(key, { start: new Date("2028-03-07T06:00:00Z"), end: new Date("2028-03-07T14:00:00Z"), resource: some({ kind: "people", key: "haspen" }),
            shift: "early", group: some("inbound"), position: some("crew"), activity: none, hours: 8, ...roles });
    };
    extra("x-before", { start: new Date("2028-03-04T14:00:00Z"), end: new Date("2028-03-04T22:00:00Z"), shift: "late" });
    extra("x-ghost", { shift: "twilight" });
    extra("x-agency", { resource: some({ kind: "agencies", key: "northside" }) });
    assert.deepEqual([scoreOf(dutiesSeen(ask(LEAD()), there), "haspen"), scoreOf(hoursSeen(ask(LEAD()), there), "haspen")],
        [5, weekHours(fresh(), context).get("haspen")]);
});

test("R5 — the warehouse's greedy fit on e3: it asks about the holders of the need alone, through the staff's indexes; the ready-made rule's fits and reasons, the most spare contract hours first, whatever the group", () => {
    // Every find of Thursday: the same people fit as the rule says, for the same reasons, each scored by their spare hours alone.
    const finds = check(fresh(), context).flatMap(i => i.fix.type === "some" && i.fix.value.type === "find" && i.slot.type === "some" && i.slot.value.day === 4n
        ? [{ need: i.fix.value.value, slot: i.slot.value }] : []);
    assert.equal(finds.length, 5);
    const hours = weekHours(fresh(), context);
    for (const find of finds) {
        const rule = builtIn(ask(find), read()), ours = greedy(ask(find));
        // Whom it names, the rule gives the same verdict but for a fit's score.
        for (const [key, fit] of ours.people) {
            const theirs = rule.people.get(key);
            assert.ok(theirs !== undefined, key);
            if (fit.type === "fits") {
                assert.ok(theirs.type === "fits" && theirs.value.why === fit.value.why, key);
                assert.equal(fit.value.score, context.people.get(key)!.contract - hours.get(key)!, key);
            } else verdict(fit, theirs, key);
        }
        // Whom it does not name, the rule refuses for not holding the need: nobody who fits is left out.
        for (const [key, fit] of rule.people) {
            if (!ours.people.has(key)) assert.ok(fit.type === "refused" && NOT_HELD.includes(fit.value.group), `${key}: ${printFit(fit)}`);
        }
        assert.ok(ours.people.size < rule.people.size, "it asks about fewer than the staff");
    }
    assert.deepEqual(ranked(greedy(ask(LEAD()))), [["jquartz", 14, "Dispatch · 14 h spare"]]);
    // Thursday's lead: the twelve in a lead position are asked about, and no one else.
    assert.deepEqual([greedy(ask(LEAD())).people.size, refused(greedy(ask(LEAD())))], [12, { Rostered: 11 }]);
    assert.deepEqual(ranked(greedy(ask(findOf("B. Swale · trainee without trainer", 6n)))), [
        ["dheath", 6, "from Inbound · 6 h spare"], ["haspen", -2, "from Inbound · 2 h over contract"],
    ]);
    // Over the 500, Thursday's trainers all have 38 hours to spare: the slot's group no longer leads, so they rank in staff-key order.
    assert.deepEqual(ranked(greedy(ask(TRAINER_THU()), warehouseDuties, indexedStaff)).slice(0, 3), [
        ["pool-1013", 38, "from Inbound · 38 h spare"], ["pool-1027", 38, "from Inbound · 38 h spare"], ["pool-1056", 38, "Picking · 38 h spare"],
    ]);
});

test("each board's fit reads its own records: the indexed roster's its 500 staff, the locked roster's its locked duties, each the warehouse's order", () => {
    // The indexed roster's fit, its staff and its duties through their own indexes: the answer the warehouse's order gives over the 500.
    sameResult(indexedFit(ask(TRAINER_THU())), greedy(ask(TRAINER_THU()), warehouseDuties, indexedStaff), "Thursday's trainers over the 500");
    sameResult(indexedFit(ask(LEAD())), greedy(ask(LEAD()), warehouseDuties, indexedStaff), "Thursday's lead over the 500");
    // The locked roster's, over the warehouse's own staff.
    sameResult(lockedFit(ask(LEAD())), greedy(ask(LEAD())), "Thursday's lead over the locked duties");
});

test("#1624 — a fit on a scoped page reads the request's scope: the leads' own page asks about its position's people alone", () => {
    // The scope as the page sends it: each rail source's by its name, a field's exact values as East prints them.
    const scope = new SortedMap([["people", new SortedMap([["position", variant("values", [printFor(StringType)("lead")])]], byString)]], byString);
    const whole = indexedFit(ask(LEAD()));
    const scoped = indexedFit({ ...ask(LEAD()), scope });
    const positionOf = (key: string) => indexedStaff.get(key)!.position;
    // Every lead position's people are asked about on a page with no scope: leads, deputies and those acting.
    assert.ok([...whole.people.keys()].some(key => !equalFor(StringType)(positionOf(key), "lead")));
    // On the leads' page, the leads alone — each the verdict the whole answer gives them.
    assert.ok(scoped.people.size > 0 && [...scoped.people.keys()].every(key => equalFor(StringType)(positionOf(key), "lead")));
    for (const [key, fit] of scoped.people) verdict(fit, whole.people.get(key)!, key);
});

test("the warehouse's fit reads the duties it is given through their index: an unsaved duty laid over them is seen, and one removed is gone", () => {
    // J. Quartz, free for Thursday's early shift, given a duty that day and not saved: e3 lays the draft over the record and its index.
    const drafted = new SortedMap([...warehouseDuties], byString);
    const start = new Date("2028-03-09T14:00:00Z"), end = new Date("2028-03-09T22:00:00Z");
    drafted.set("x-draft", { who: variant("staff", "jquartz"), start, end, shift: "late", team: "dispatch", role: "deputy", task: none,
        unpaidBreak: 0, agreed: none, costCentre: "CC-DS", note: "" });
    verdict(greedy(ask(LEAD()), drafted).people.get("jquartz"), refusal("Rostered", "rostered on Dispatch · Late"));
    // A. Alder's duty that day removed and not saved: off that day, they fit.
    const theirs = [...warehouseWeek.assignments].filter(([, a]) => a.who.type === "person" && a.who.value === "aalder" && a.place.day === 4n).map(([key]) => key);
    assert.equal(theirs.length, 1);
    // The duty's roles, as the function reads them from its row, are the ones the Roster reads.
    const roles = East.compile(rosterDutyRoles, [])(warehouseDuties.get(theirs[0]!)!);
    assert.ok(equalFor(Schedule.Types.RosterRoles)(roles, read().duties.get(theirs[0]!)!));
    const removed = new SortedMap([...warehouseDuties].filter(([key]) => key !== theirs[0]), byString);
    verdict(greedy(ask(LEAD())).people.get("aalder"), refusal("Rostered", "rostered on Inbound · Early"));
    assert.equal(greedy(ask(LEAD()), removed).people.get("aalder")?.type, "fits");
});

test("another app's fit: everyone asked about, the warehouse's order and reasons, and a warning on whoever the slot's 8-hour shift would take past their contract", () => {
    /** An answer's fits, best first: key, score, reason and warning. */
    const warned = (result: Result) => [...result.people].flatMap(([key, fit]) => fit.type === "fits" ? [{ key, ...fit.value }] : [])
        .sort((a, b) => byScore(b.score, a.score)).map(f => [f.key, f.score, f.why, f.warn.type === "some" ? f.warn.value : null]);
    // Thursday's lead: J. Quartz has 14 hours to spare, more than the shift.
    assert.deepEqual(warned(contract(ask(LEAD()))), [["jquartz", 14, "Dispatch · 14 h spare", null]]);
    // Saturday's trainee: D. Heath has 6 to spare, short of the shift, and H. Aspen is 2 over already.
    assert.deepEqual(warned(contract(ask(findOf("B. Swale · trainee without trainer", 6n)))), [
        ["dheath", 6, "from Inbound · 6 h spare", "past contract"],
        ["haspen", -2, "from Inbound · 2 h over contract", "past contract"],
    ]);
    // It answers every person of the staff; whom the rule refuses, it refuses too.
    const rule = builtIn(ask(LEAD()), read()), ours = contract(ask(LEAD()));
    assert.deepEqual([...ours.people.keys()], [...rule.people.keys()]);
    for (const [key, fit] of rule.people) {
        if (fit.type === "refused") verdict(ours.people.get(key), fit, key);
    }
});

test("ruling 12 — over duties keyed by number, Roster.answer({ key }) and Roster.fit({ key }) give every person the verdict the same duties keyed by text get; what a function read and a candidate are made over the duties' key type", () => {
    const ByNumber = { key: IntegerType };
    assert.ok(isTypeEqual(Roster.Types.FitContext(ByNumber).fields.duties, DictType(IntegerType, Schedule.Types.RosterRoles)));
    assert.ok(isTypeEqual(Roster.Types.Candidate(ByNumber).fields.duties, DictType(IntegerType, StructType({ place: Roster.Types.Place, roles: Schedule.Types.RosterRoles }))));
    assert.ok(isTypeEqual(Roster.Types.FitContext({ key: StringType }), FitContext), "String where none is given");
    const numberOver = East.compile(East.function([Roster.Types.FitRequest, Roster.Types.FitContext(ByNumber)], Roster.Types.FitResult, ($, request, cx) => {
        const answer = $.const(Roster.answer(ByNumber));
        const rule = $.const(Roster.fit(ByNumber));
        return answer(request, cx, rule);
    }), []);
    // The week's duties numbered in their key order: the question and the answer name people, never a duty.
    const there = read();
    const numbered = { ...there, duties: new SortedMap([...there.duties.values()].map((roles, i) => [BigInt(i + 1), roles] as const), compareFor(IntegerType)) };
    for (const [find, of] of [[LEAD(), "Thursday's lead"], [TRAINER_THU(), "Thursday's trainers"], [findOf("Unloading · 8 h short", 4n), "Thursday's unloading"]] as const) {
        sameResult(numberOver(ask(find), numbered), builtIn(ask(find), there), of);
    }
    assert.throws(() => Roster.answer(IntegerType as never),
        { message: "Roster.answer: takes nothing, or { key: IntegerType } — the duties' key type, for duties keyed by other than String" });
    assert.throws(() => Roster.Types.Candidate({ key: "Integer" } as never),
        { message: "Roster.Types.Candidate: `key` is the duties' key type, an East type — { key: IntegerType } for duties keyed by number" });
});

test("the Roster's fit is Schedule's, the Allocation's too; a find's need is the Fix's find", () => {
    assert.ok(isTypeEqual(Roster.Types.Fit, Schedule.Types.Fit));
    assert.ok(isTypeEqual(Roster.Types.Fit, Allocation.Types.Fit));
    assert.ok(isTypeEqual(Roster.Types.Refusal, Allocation.Types.Refusal));
    assert.ok(isTypeEqual(Roster.Types.Fix.cases.find, Roster.Types.Need));
    assert.ok(isTypeEqual(Roster.Types.FitResult.fields.people.value, Schedule.Types.Fit));
});
