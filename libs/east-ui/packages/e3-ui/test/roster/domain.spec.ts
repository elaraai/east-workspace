/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { East, decodeBeast2For, encodeBeast2For, none, some, variant } from "@elaraai/east";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import { Roster } from "@elaraai/e3-ui";
import * as ex from "./domain.examples.js";

describeEast("Roster — pure domain", test => {
    Assert.examples(test, { rosterCoverage: ex.rosterCoverage, rosterChecks: ex.rosterChecks, rosterWeeklyHours: ex.rosterWeeklyHours, rosterRest: ex.rosterRest });
}, { platformFns: TestImpl });
const context = decodeBeast2For(Roster.Types.Context)(encodeBeast2For(Roster.Types.Context)(ex.context));
const fresh = () => decodeBeast2For(Roster.Types.Week)(encodeBeast2For(Roster.Types.Week)(ex.week));
const coverage = East.compile(Roster.coverage, []), check = East.compile(Roster.check, []), hours = East.compile(Roster.weekHours, []);

test("requests fill positions but provide no staff, lead, trainer, skills or activity capacity", () => {
    const week = fresh(); week.assignments.delete("a"); week.assignments.delete("b");
    const c = coverage(week, context).get(ex.slot)!;
    assert.equal(c.filled, 1n); assert.equal(c.people, 0n); assert.equal(c.open, 3n);
    assert.equal(c.lead, false); assert.equal(c.trainer, false); assert.equal(c.hours.requested, 8); assert.equal(c.cost, 408);
    assert.equal(c.lines[0]!.holders.type === "some" && c.lines[0]!.holders.value, 0n);
    assert.equal(c.lines[0]!.gap, 24); assert.equal(c.lines[0]!.assigned, 0);
});
test("activity placement is not capacity: an unskilled assignment warns without granting the skill", () => {
    const week = fresh(); week.assignments.set("b", { ...week.assignments.get("b")!, activity: some("reach") });
    const c = coverage(week, context).get(ex.slot)!;
    assert.equal(c.lines[0]!.assigned, 18); assert.equal(c.lines[0]!.gap, 16);
    assert.ok(check(week, context).some(i => i.assignment.type === "some" && i.assignment.value === "b" && i.flag.type === "some" && i.flag.value === "not skilled"));
});
test("hours retain zero-hour people and start offsets never reduce nominal hours", () => {
    assert.deepEqual([...hours(fresh(), context)], [["agency", 8], ["lead", 10], ["off", 0]]);
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
    week.assignments.set("duplicate", { ...b, slot: { ...b.slot, shift: "night" } });
    const people = new Map(context.people); people.set("agency", { ...people.get("agency")!, trainee: true });
    const issues = check(week, { ...context, people });
    assert.equal(issues.filter(i => i.flag.type === "some" && i.flag.value === "double").length, 2);
    assert.equal(issues.filter(i => i.flag.type === "some" && i.flag.value === "trainee").length, 2);
});
test("agreed changed hours no longer ask for agreement; published state does not change the pure calculations", () => {
    const week = fresh(); week.assignments.set("a", { ...week.assignments.get("a")!, agreed: some(true) });
    assert.equal(check(week, context).filter(i => i.kind.type === "agree").length, 0);
    assert.deepEqual(coverage({ ...week, status: variant("published", { at: new Date("2028-03-05T00:00:00Z") }) }, context), coverage(week, context));
    week.assignments.set("a", { ...week.assignments.get("a")!, offset: 0, overtime: 0, agreed: none });
    assert.equal(check(week, context).filter(i => i.kind.type === "agree").length, 0);
});

test("disabling skill checks removes skill warnings while retaining coverage and unrelated gaps", () => {
    const week = fresh(); week.assignments.set("b", { ...week.assignments.get("b")!, activity: some("reach") });
    const unchecked = { ...context, rules: { ...context.rules, skill: false } };
    assert.equal(check(week, unchecked).filter(i => i.flag.type === "some" && ["not skilled", "skill gap"].includes(i.flag.value)).length, 0);
    assert.ok(check(week, unchecked).some(i => i.flag.type === "some" && i.flag.value === "1 open"));
    assert.deepEqual(coverage(week, unchecked), coverage(week, context));
});
