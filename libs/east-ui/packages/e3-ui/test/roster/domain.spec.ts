/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, DateTimeType, DictType, East, FloatType, IntegerType, OptionType, SortedMap, StringType, StructType, compareFor, decodeBeast2For, encodeBeast2For,
    equalFor, isTypeEqual, none, some, variant, type EastType, type ValueTypeOf,
} from "@elaraai/east";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import { Roster } from "@elaraai/e3-ui";
import * as ex from "./domain.examples.js";

describeEast("Roster — pure domain", test => {
    Assert.examples(test, { rosterCoverage: ex.rosterCoverage, rosterChecks: ex.rosterChecks, rosterWeeklyHours: ex.rosterWeeklyHours, rosterRest: ex.rosterRest,
        rosterFitTrainer: ex.rosterFitTrainer, rosterAnswerLeads: ex.rosterAnswerLeads, rosterSlotOfPlaces: ex.rosterSlotOfPlaces,
        rosterNoGroupHours: ex.rosterNoGroupHours });
}, { platformFns: TestImpl });

type Week = ValueTypeOf<typeof ex.DomainWeek>;
const byString = compareFor(StringType);
const context = decodeBeast2For(Roster.Types.Context)(encodeBeast2For(Roster.Types.Context)(ex.context));
const fresh = (): Week => decodeBeast2For(ex.DomainWeek)(encodeBeast2For(ex.DomainWeek)(ex.week));
const pay = decodeBeast2For(Roster.Types.Pay)(encodeBeast2For(Roster.Types.Pay)(ex.pay));
const noPay = (): ValueTypeOf<typeof Roster.Types.Pay> => new SortedMap([], byString);
const coverage = East.compile(Roster.coverage(ex.DomainDuty), []), check = East.compile(Roster.check(ex.DomainDuty), []), hours = East.compile(Roster.weekHours(ex.DomainDuty), []);

test("requests fill positions but provide no staff, lead, trainer, skills or activity capacity", () => {
    const week = fresh(); week.assignments.delete("a"); week.assignments.delete("b");
    const c = coverage(week, context, pay).get(ex.slot)!;
    assert.equal(c.filled, 1n); assert.equal(c.people, 0n); assert.equal(c.open, 3n);
    assert.equal(c.lead, false); assert.equal(c.trainer, false); assert.equal(c.hours.requested, 8); assert.equal(c.cost, 408);
    assert.equal(c.lines[0]!.holders.type === "some" && c.lines[0]!.holders.value, 0n);
    assert.equal(c.lines[0]!.gap, 24); assert.equal(c.lines[0]!.assigned, 0);
});
test("activity placement is not capacity: an unskilled assignment warns without granting the skill", () => {
    const week = fresh(); week.assignments.set("b", { ...week.assignments.get("b")!, activity: some("reach") });
    const c = coverage(week, context, pay).get(ex.slot)!;
    assert.equal(c.lines[0]!.assigned, 18); assert.equal(c.lines[0]!.gap, 16);
    assert.ok(check(week, context).some(i => i.assignment.type === "some" && i.assignment.value === "b" && i.flag.type === "some" && i.flag.value === "not skilled"));
});
test("a person's hours are their duties' own hours — a later start and a longer duty its own times — and zero for one with none", () => {
    assert.deepEqual([...hours(fresh(), context)], [["agency", 8], ["lead", 10], ["off", 0]]);
});
test("a slot's cost is the app's pay for its duties, every code summed; without pay it has none", () => {
    assert.equal(coverage(fresh(), context, pay).get(ex.slot)!.cost, 1278);
    assert.equal(coverage(fresh(), context, noPay()).get(ex.slot)!.cost, 0);
});
test("the check's words print its hours as the fit's do: a whole number without a decimal point, any other as East prints it", () => {
    const issues = check(fresh(), context);
    const of = (flag: string) => issues.find(i => i.flag.type === "some" && i.flag.value === flag)!;
    // Sunday's early shift asks four positions and fills three: one open, its eight hours unfilled.
    assert.deepEqual([of("1 open").title, of("1 open").detail], ["1 open position · Goods · Early", "8 h unfilled · 3 of 4 positions"]);
    // Reach truck needs 24 hours, and its one holder brings the shift's eight.
    assert.deepEqual([of("skill gap").title, of("skill gap").detail], ["Reach truck · 16 h short", "Goods · Early · 8 h capacity of 24 h"]);
    // A fraction prints as East prints it: a shift of 7.5 hours leaves 7.5 unfilled.
    const half = { ...context, shifts: context.shifts.map(shift => shift.key === "early" ? { ...shift, hours: 7.5 } : shift) };
    assert.equal(check(fresh(), half).find(i => i.flag.type === "some" && i.flag.value === "1 open")!.detail, "7.5 h unfilled · 3 of 4 positions");
    // Two open of two: the plural, and one asked of none filled, the singular.
    const empty = fresh(); empty.assignments.clear();
    empty.requirements.set(ex.slot, { positions: 2n, hours: new Map() });
    const two = check(empty, context).find(i => i.kind.type === "gap")!;
    assert.deepEqual([two.title, two.detail], ["2 open positions · Goods · Early", "16 h unfilled · 0 of 2 positions"]);
    empty.requirements.set(ex.slot, { positions: 1n, hours: new Map() });
    const one = check(empty, context).find(i => i.kind.type === "gap")!;
    assert.deepEqual([one.title, one.detail], ["1 open position · Goods · Early", "8 h unfilled · 0 of 1 position"]);
});
test("empty targets produce open-position fixes only when an agency is configured", () => {
    const week = fresh(); week.assignments.clear();
    const gap = check(week, context).find(i => i.kind.type === "gap")!;
    assert.equal(gap.fix.type === "some" && gap.fix.value.type, "request");
    assert.equal(check(week, { ...context, agencies: [] })[0]!.fix.type, "none");
});
test("double booking and a trainee without a trainer are independent warnings", () => {
    const week = fresh(); week.assignments.delete("a");
    const b = week.assignments.get("b")!;
    week.assignments.set("duplicate", { ...b, place: { ...b.place, shift: "night" } });
    const people = new Map(context.people); people.set("agency", { ...people.get("agency")!, trainee: true });
    const issues = check(week, { ...context, people });
    assert.equal(issues.filter(i => i.flag.type === "some" && i.flag.value === "double").length, 2);
    assert.equal(issues.filter(i => i.flag.type === "some" && i.flag.value === "trainee").length, 2);
});
test("a published week's calculations are a draft's", () => {
    const week = fresh();
    assert.deepEqual(coverage({ ...week, status: variant("published", { at: some(new Date("2028-03-05T00:00:00Z")) }) }, context, pay), coverage(week, context, pay));
    assert.deepEqual(check({ ...week, status: variant("other", "cancelled") }, context), check(week, context));
});
test("disabling skill checks removes skill warnings while retaining coverage and unrelated gaps", () => {
    const week = fresh(); week.assignments.set("b", { ...week.assignments.get("b")!, activity: some("reach") });
    const unchecked = { ...context, rules: { ...context.rules, skill: false } };
    assert.equal(check(week, unchecked).filter(i => i.flag.type === "some" && ["not skilled", "skill gap"].includes(i.flag.value)).length, 0);
    assert.ok(check(week, unchecked).some(i => i.flag.type === "some" && i.flag.value === "1 open"));
    assert.deepEqual(coverage(week, unchecked, pay), coverage(week, context, pay));
});
test("the rest fix moves a duty to another shift of its day that keeps the rest, or else proposes a later start, its length kept", () => {
    // The lead's night runs on to 08:00 Monday, six hours before their late shift that day.
    const week = fresh();
    const lead = week.assignments.get("a")!;
    /** A duty of the lead's on a slot, from and to the times given: its row's times its own. */
    const duty = (place: typeof lead.place, from: string, to: string, hours: number) => ({
        ...lead, place, activity: none, start: new Date(from), end: new Date(to), hours, row: { ...lead.row, start: new Date(from), end: new Date(to), note: "" },
    });
    week.assignments.set("night", duty({ day: 0n, group: some("goods"), shift: "night" }, "2028-03-05T22:00:00Z", "2028-03-06T08:00:00Z", 10));
    week.assignments.set("monday", duty({ day: 1n, group: some("goods"), shift: "late" }, "2028-03-06T14:00:00Z", "2028-03-06T22:00:00Z", 8));
    const restOf = (issues: ReturnType<typeof check>) => issues.find(i => i.assignment.type === "some" && i.assignment.value === "monday" && i.title.endsWith("h rest"))!;
    const rest = restOf(check(week, context));
    // Its words print whole hours as the fit's do (`6 h rest · minimum 10 h`): no decimal point.
    assert.equal(rest.title, "Lead · 6 h rest");
    assert.equal(rest.detail, "Goods · Late · minimum 10 h since the previous shift");
    assert.deepEqual(rest.flag, some("6h rest"));
    // Monday's night, its times kept against its shift's start, leaves fourteen hours: the fix moves it there.
    assert.deepEqual(rest.fix, some(variant("move", "night")));
    // With no night shift, no other shift of the day keeps ten hours, so the fix is a later start: four hours on, at 18:00.
    const later = restOf(check(week, { ...context, shifts: context.shifts.filter(shift => shift.key !== "night") }));
    assert.deepEqual(later.fix, some(variant("start", new Date("2028-03-06T18:00:00Z"))));
});

// ============================================================================
// A duty in no group yet (#1548)
// ============================================================================

test("a duty in no group counts in its person's hours and in no slot's coverage, and is checked as its person's, its issue in no slot", () => {
    const week = fresh();
    const lead = week.assignments.get("a")!;
    // The lead's Sunday duty, and a Sunday night of theirs in no group: double booked, and six hours short of the next.
    week.assignments.set("n", { ...lead, place: { day: 0n, group: none, shift: "night" }, activity: some("reach"),
        start: new Date("2028-03-05T21:00:00Z"), end: new Date("2028-03-06T05:00:00Z"), hours: 8,
        row: { ...lead.row, start: new Date("2028-03-05T21:00:00Z"), end: new Date("2028-03-06T05:00:00Z") } });
    assert.equal(hours(week, context).get("lead"), 18, "the lead's ten and eight");
    const slots = coverage(week, context, pay);
    assert.equal(slots.get({ day: 0n, group: "goods", shift: "night" })!.filled, 0n, "Goods' Sunday night holds none of it");
    assert.equal(slots.get(ex.slot)!.filled, 3n, "nor does Goods' Sunday early gain it");
    const ofN = check(week, context).filter(i => i.assignment.type === "some" && i.assignment.value === "n");
    assert.deepEqual(ofN.map(i => i.flag), [some("double"), some("4h rest")], "double booked, and four hours after the early");
    assert.ok(ofN.every(i => i.slot.type === "none"), "in no slot");
    // Its words name its shift alone: no group's word is the app's (#1566), and the check has none of its own.
    assert.equal(ofN[0]!.detail, "Night · on 2 shifts this day");
    assert.equal(ofN[1]!.detail, "Night · minimum 10 h since the previous shift");
    // The lead holds Reach truck: a skill in no group is held to every group's, and they hold it.
    const unskilled = new Map(context.people); unskilled.set("lead", { ...unskilled.get("lead")!, skills: new Set<string>() });
    assert.ok(check(week, { ...context, people: unskilled }).some(i => i.assignment.type === "some" && i.assignment.value === "n"
        && i.flag.type === "some" && i.flag.value === "not skilled"), "and without it, not skilled");
});

// ============================================================================
// The requests carry each duty's own row (B16)
// ============================================================================

test("the pay, the check and the fit are asked over the app's rows: each request carries every duty's own row (B16)", () => {
    const Request = Roster.Types.PayRequest(ex.DomainDuty);
    // The app's pay, reading its row: a cost per duty its note names.
    const notes = East.compile(East.function([Request], Roster.Types.Pay, ($, req) => req.duties.map(($2, duty) => {
        const costs = $2.let(new Map(), DictType(StringType, FloatType));
        $2(costs.insert("NOTE", duty.row.note.length().toFloat()));
        return costs;
    })), []);
    const week = fresh();
    const lead = new SortedMap([["a", week.assignments.get("a")!]], byString);
    // As the renderer sends it: encoded at the row type, and decoded where the pay runs.
    const decoded = decodeBeast2For(Request)(encodeBeast2For(Request)({ who: variant("person", "lead"), start: ex.start, duties: lead, context }));
    assert.deepEqual([...notes(decoded)].map(([key, costs]) => [key, [...costs]]), [["a", [["NOTE", "in late, stays on".length]]]]);
    // The app's check reads each duty's row, and its pay.
    const Context = Roster.Types.CheckContext(ex.DomainDuty);
    const checked = East.compile(East.function([Context], ArrayType(Roster.Types.Issue), ($, cx) => {
        const issues = $.let([], ArrayType(Roster.Types.Issue));
        const slotOf = $.const(Roster.slotOf);
        $.for(cx.week.assignments, ($2, a, id) => {
            $2.if(East.notEqual(a.row.note, "").and(() => cx.pay.has(id)), ($3) => {
                $3(issues.pushLast({ kind: variant("breach", null), tone: variant("info", null), title: a.row.note, detail: "",
                    slot: slotOf(a.place), assignment: some(id), flag: none, fix: none }));
            });
        });
        return issues;
    }), []);
    const cx = decodeBeast2For(Context)(encodeBeast2For(Context)({ start: ex.start, week, context, coverage: coverage(week, context, pay), pay }));
    assert.deepEqual(checked(cx).map(i => [i.assignment, i.title]), [[some("a"), "in late, stays on"]]);
    assert.ok(equalFor(OptionType(Roster.Types.Slot))(checked(cx)[0]!.slot, some(ex.slot)), "the issue names the duty's slot");
    // The fit's request carries the rows too.
    const Fit = Roster.Types.FitRequest(ex.DomainDuty);
    const noteOf = East.compile(East.function([Fit], StringType, (_$, req) => req.week.assignments.get("a").row.note), []);
    const ask = decodeBeast2For(Fit)(encodeBeast2For(Fit)({ need: variant("leads", null), slot: ex.slot, start: ex.start, week, context, coverage: coverage(week, context, pay) }));
    assert.equal(noteOf(ask), "in late, stays on");
});

test("each type over a week is a constructor of the row type: the same row the same type, another row another", () => {
    const Other = Roster.Types.Assignment(IntegerType);
    const makers: readonly ((row: EastType) => EastType)[] = [Roster.Types.Assignment, Roster.Types.Week, Roster.Types.PayRequest, Roster.Types.CheckContext, Roster.Types.FitRequest];
    for (const make of makers) {
        assert.ok(isTypeEqual(make(ex.DomainDuty), make(ex.DomainDuty)), make.name);
        assert.ok(!isTypeEqual(make(ex.DomainDuty), make(IntegerType)), make.name);
    }
    // Over a reference record (#1551), the check's context holds its rows by key: a constructor of both row types.
    const Rota = StructType({ person: StringType, shift: StringType, start: DateTimeType, end: DateTimeType });
    const over = Roster.Types.CheckContext(ex.DomainDuty, Rota);
    assert.ok(isTypeEqual(over, Roster.Types.CheckContext(ex.DomainDuty, Rota)));
    assert.ok(!isTypeEqual(over, Roster.Types.CheckContext(ex.DomainDuty, IntegerType)), "another reference row, another type");
    assert.ok(!isTypeEqual(over, Roster.Types.CheckContext(ex.DomainDuty)), "the duties' rows alone, another type");
    assert.ok(isTypeEqual(over.fields.reference, DictType(StringType, Rota)));
    assert.ok(isTypeEqual(over.fields.week, Roster.Types.CheckContext(ex.DomainDuty).fields.week), "beside the duties' context as it is");
    assert.ok(isTypeEqual(Other.fields.row, IntegerType));
    assert.ok(isTypeEqual(Roster.Types.Status, Roster.Types.Week(IntegerType).fields.status), "a week's status is Schedule's period status");
});
