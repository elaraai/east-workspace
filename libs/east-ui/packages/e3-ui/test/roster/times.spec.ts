/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the Roster reads from a duty's times (#1368, `Builder Interfaces
 * Spec.md` §5.5, B10): a duty's day is the day whose shift start is nearest
 * its start; its times are its own, wherever they differ from its shift's; a
 * move keeps them against the shift's start, so a move and back leaves them as
 * they were; a new duty runs its slot's shift; and a duty counts the hours its
 * roles give. Over the roles a duty kind reads (`Schedule.Types.RosterRoles`),
 * which the duty kind's own spec reads from a row on e3 (e3-ui-components'
 * `test/roster-payload.spec.ts`, its `hours` accessor less an unpaid break).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DateTimeType, East, OptionType, SortedMap, SortedSet, StringType, compareFor, equalFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Roster } from "@elaraai/e3-ui";
import { Schedule, rosterDayOf, rosterMove, rosterNewDuty, rosterPlacement } from "@elaraai/e3-ui/internal";
import { DomainDuty, DomainWeek, context, start } from "./domain.examples.js";

/** An instant as its author writes it: UTC, with its zone. */
const at = (text: string): Date => new Date(text);
type Roles = ValueTypeOf<typeof Schedule.Types.RosterRoles>;
type Duty = ValueTypeOf<typeof DomainDuty>;

const dayOf = East.compile(rosterDayOf, []);
const placementOf = East.compile(rosterPlacement(DomainDuty), []);
const move = East.compile(rosterMove, []);
const newDuty = East.compile(rosterNewDuty, []);
const rolesEqual = equalFor(OptionType(Schedule.Types.RosterRoles));
const dateEqual = equalFor(DateTimeType);
const coverage = East.compile(Roster.coverage(DomainDuty), []);
const weekHours = East.compile(Roster.weekHours(DomainDuty), []);

/** A duty's roles: the lead's, in Goods, on the shift given, its hours its length unless given. */
function roles(shift: string, from: string, to: string, hours?: number): Roles {
    return {
        start: at(from), end: at(to), resource: some({ kind: "people", key: "lead" }), shift, group: "goods",
        position: some("lead"), activity: none, hours: hours ?? (at(to).getTime() - at(from).getTime()) / 3_600_000,
    };
}
/** The row the roles were read from, the app's own. */
const rowOf = (r: Roles): Duty => ({ who: variant("staff", "lead"), start: r.start, end: r.end, note: "" });
/** Where the Roster places a duty in the week of 5 March 2028. */
const place = (r: Roles, key = "d") => placementOf(r, rowOf(r), key, start, context);

describe("a duty's day (§5.5, rule 1)", () => {
    test("is the day whose shift start is nearest its start: an early start is its shift's day", () => {
        assert.ok(dateEqual(dayOf(at("2028-03-06T05:00:00Z"), { hour: 6n, minute: 0n }), at("2028-03-06T00:00:00Z")), "05:00 on the 06:00 shift");
        const early = place(roles("early", "2028-03-06T05:00:00Z", "2028-03-06T14:00:00Z"));
        if (early.type !== "placed") assert.fail(`expected the duty placed, and it is ${early.type}`);
        assert.deepEqual(early.value.slot, { day: 1n, group: "goods", shift: "early" });
        assert.ok(dateEqual(early.value.start, at("2028-03-06T05:00:00Z")), "its own start, not its shift's");
    });

    test("a late finish keeps its day and its own end, and counts its length", () => {
        const late = place(roles("early", "2028-03-07T06:00:00Z", "2028-03-07T15:30:00Z"));
        if (late.type !== "placed") assert.fail(`expected the duty placed, and it is ${late.type}`);
        assert.equal(late.value.slot.day, 2n);
        assert.ok(dateEqual(late.value.end, at("2028-03-07T15:30:00Z")));
        assert.equal(late.value.hours, 9.5);
    });

    test("an overnight shift's duty is the night it starts on, past midnight too", () => {
        const night = place(roles("night", "2028-03-11T22:00:00Z", "2028-03-12T06:00:00Z"));
        if (night.type !== "placed") assert.fail(`expected the duty placed, and it is ${night.type}`);
        assert.equal(night.value.slot.day, 6n, "Saturday's night, though it ends in the next week");
        // A night duty that starts at 00:30 is the night before's: Sunday's 22:00 is nearer than Monday's.
        const late = place(roles("night", "2028-03-06T00:30:00Z", "2028-03-06T08:00:00Z"));
        if (late.type !== "placed") assert.fail(`expected the duty placed, and it is ${late.type}`);
        assert.equal(late.value.slot.day, 0n);
        // The Saturday before's night is another week's, though it ends in this one.
        assert.equal(place(roles("night", "2028-03-04T22:00:00Z", "2028-03-05T06:00:00Z")).type, "elsewhere");
    });

    test("a duty counts the hours its roles give: its length, or what its kind's `hours` makes of it — less an unpaid break", () => {
        const less = roles("early", "2028-03-05T06:00:00Z", "2028-03-05T14:00:00Z", 7.5);
        const placed = place(less, "a");
        if (placed.type !== "placed") assert.fail(`expected the duty placed, and it is ${placed.type}`);
        assert.equal(placed.value.hours, 7.5);
        const week: ValueTypeOf<typeof DomainWeek> = {
            status: variant("draft", null), dismissed: new SortedSet([], compareFor(StringType)),
            assignments: new SortedMap([["a", placed.value]], compareFor(StringType)), requirements: new SortedMap([], compareFor(Roster.Types.Slot)),
        };
        assert.equal(weekHours(week, context).get("lead"), 7.5, "a person's week counts it");
        assert.equal(coverage(week, context, new SortedMap([], compareFor(StringType))).get({ day: 0n, group: "goods", shift: "early" })?.hours.rostered, 7.5,
            "and so does its slot's coverage");
    });
});

describe("a duty the Roster cannot place (§5.5, rule 8)", () => {
    test("is listed in Issues, never placed, and kept as stored: a shift or a group not configured, or no one", () => {
        const unknownShift = place({ ...roles("early", "2028-03-06T06:00:00Z", "2028-03-06T14:00:00Z"), shift: "night-2" }, "d-7");
        if (unknownShift.type !== "unplaced") assert.fail(`expected the duty unplaced, and it is ${unknownShift.type}`);
        assert.equal(unknownShift.value.title, "Unknown shift · night-2");
        assert.deepEqual([unknownShift.value.slot, unknownShift.value.assignment, unknownShift.value.flag], [none, some("d-7"), some("unknown shift")]);
        const unknownGroup = place({ ...roles("early", "2028-03-06T06:00:00Z", "2028-03-06T14:00:00Z"), group: "yard" }, "d-8");
        if (unknownGroup.type !== "unplaced") assert.fail(`expected the duty unplaced, and it is ${unknownGroup.type}`);
        assert.equal(unknownGroup.value.title, "Unknown group · yard");
        const noOne = place({ ...roles("early", "2028-03-06T06:00:00Z", "2028-03-06T14:00:00Z"), resource: none }, "d-9");
        if (noOne.type !== "unplaced") assert.fail(`expected the duty unplaced, and it is ${noOne.type}`);
        assert.equal(noOne.value.title, "No one rostered · d-9");
        // One of another week is that week's, whatever its shift.
        assert.equal(place({ ...roles("early", "2028-03-13T06:00:00Z", "2028-03-13T14:00:00Z"), shift: "night-2" }).type, "elsewhere");
    });

    test("an agency's request is a request of the agency its case names", () => {
        const request = place({ ...roles("early", "2028-03-06T06:00:00Z", "2028-03-06T14:00:00Z"), resource: some({ kind: "agencies", key: "agency" }) });
        if (request.type !== "placed") assert.fail(`expected the request placed, and it is ${request.type}`);
        assert.deepEqual(request.value.who, variant("request", "agency"));
    });
});

describe("a move, a new duty (§5.5, rules 3 and 5)", () => {
    test("a move keeps a duty's times against its shift's start; a move and back leaves them as they were", () => {
        const early = roles("early", "2028-03-05T05:30:00Z", "2028-03-05T14:00:00Z");
        const moved = move(early, start, { day: 2n, group: "goods", shift: "late" }, context);
        if (moved.type !== "some") assert.fail("expected the duty moved");
        assert.ok(dateEqual(moved.value.start, at("2028-03-07T13:30:00Z")), "half an hour before the late shift, as it was before the early");
        assert.ok(dateEqual(moved.value.end, at("2028-03-07T22:00:00Z")), "its length kept");
        assert.deepEqual([moved.value.shift, moved.value.group], ["late", "goods"]);
        assert.ok(rolesEqual(move(moved.value, start, { day: 0n, group: "goods", shift: "early" }, context), some(early)), "and back");
        // An overnight duty moves as any other, and back.
        const night = roles("night", "2028-03-11T22:00:00Z", "2028-03-12T06:00:00Z");
        const day = move(night, start, { day: 0n, group: "goods", shift: "early" }, context);
        if (day.type !== "some") assert.fail("expected the duty moved");
        assert.ok(dateEqual(day.value.start, at("2028-03-05T06:00:00Z")) && dateEqual(day.value.end, at("2028-03-05T14:00:00Z")));
        assert.ok(rolesEqual(move(day.value, start, { day: 6n, group: "goods", shift: "night" }, context), some(night)));
    });

    test("a new duty runs its slot's shift, from the shift's start for the shift's hours", () => {
        const created = newDuty(variant("person", "off"), { day: 3n, group: "goods", shift: "night" }, start, some("crew"), some("general"), context);
        assert.ok(rolesEqual(created, some({
            start: at("2028-03-08T22:00:00Z"), end: at("2028-03-09T06:00:00Z"), resource: some({ kind: "people", key: "off" }),
            shift: "night", group: "goods", position: some("crew"), activity: some("general"), hours: 8,
        })));
        const request = newDuty(variant("request", "agency"), { day: 0n, group: "goods", shift: "early" }, start, none, none, context);
        if (request.type !== "some") assert.fail("expected the request");
        assert.deepEqual(request.value.resource, some({ kind: "agencies", key: "agency" }));
    });

    test("a move or a new duty to a slot whose shift or group isn't configured is none", () => {
        const early = roles("early", "2028-03-05T06:00:00Z", "2028-03-05T14:00:00Z");
        assert.equal(move(early, start, { day: 1n, group: "goods", shift: "night-2" }, context).type, "none");
        assert.equal(move(early, start, { day: 1n, group: "yard", shift: "early" }, context).type, "none");
        assert.equal(newDuty(variant("person", "lead"), { day: 1n, group: "yard", shift: "early" }, start, none, none, context).type, "none");
    });
});
