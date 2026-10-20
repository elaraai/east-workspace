/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ArrayType, DateTimeType, DictType, East, IntegerType, SortedMap, StringType, StructType, compareFor, none, some, variant } from "@elaraai/east";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import * as EastUI from "@elaraai/east-ui";
import { Slice } from "@elaraai/east-ui";
import e3 from "@elaraai/e3";
import { Data, Roster } from "@elaraai/e3-ui";
import { Func, Record, RosterAuthorTabType, RosterPayloadType, buildRosterTab, createRosterPayload, type RosterProps } from "@elaraai/e3-ui/internal";
import { refusingPlatform } from "../refusing-platform.js";
import { warehouseConfig } from "./warehouse.js";
import * as ex from "./roster.examples.js";
describeEast("Roster — inline bound examples", test => {
    Assert.examples(test, { rosterWarehouse: ex.rosterWarehouse, rosterMobile: ex.rosterMobile, rosterPeople: ex.rosterPeople,
        rosterWeek: ex.rosterWeek, rosterWindowed: ex.rosterWindowed, rosterMinimal: ex.rosterMinimal, rosterPublished: ex.rosterPublished, rosterCustomInspector: ex.rosterCustomInspector });
}, { platformFns: TestImpl });
test("Roster is one tag; BuilderFrame, Builder and View are not part of its developer API", () => {
    assert.equal("Builder" in Roster, false); assert.equal("View" in Roster, false);
    const fn = East.function([], RosterPayloadType, $ => {
        const weeks = $.let(Record.bind(ex.rosterWeeks, [ex.rosterWeeksPatch]));
        return createRosterPayload({ weeks, people: [], groups: warehouseConfig.groups, shifts: warehouseConfig.shifts, rules: { rest: 12 } });
    });
    const value = East.compile(fn, refusingPlatform)();
    assert.equal(value.sourceId, ex.rosterWeeks.name); assert.equal(value.rules.rest, 12); assert.equal(value.rules.skill, true);
    assert.equal(value.library.length, 0); assert.equal(value.inspector.type, "none");
    assert.equal("frame" in value, false); assert.equal("children" in value, false);
});
test("library patches reject identity and slot changes even from untyped JavaScript", () => {
    assert.throws(() => Roster.patch({ position: "lead", ...{ slot: "unsafe" } }), /slot cannot be changed/);
    assert.throws(() => Roster.patch({ ...{ who: "someone" } } as never), /who cannot be changed/);
});

test("the old Board and Roster are absent from east-ui's public API", () => {
    assert.equal("Board" in EastUI, false); assert.equal("Roster" in EastUI, false);
});

/** A payload built over the warehouse's weeks, with these props beside the required ones. */
function payload(props: (weeks: RosterProps["weeks"]) => Partial<RosterProps>) {
    return East.function([], RosterPayloadType, $ => {
        const weeks = $.let(Record.bind(ex.rosterWeeks, [ex.rosterWeeksPatch]));
        return createRosterPayload({ weeks, people: [], groups: warehouseConfig.groups, shifts: warehouseConfig.shifts, ...props(weeks) });
    });
}
const staffSource = () => Data.bindPaged(ex.rosterStaff, { indexes: [ex.rosterStaffByTeamName, ex.rosterStaffByName] });
const activitySource = () => Data.bindPaged(ex.rosterActivities, { indexes: [ex.rosterActivitiesByGroup] });

test("the narrowing is Slice.bindRecords over people and activities: Slice.bind, a single Slice.bindRecord and a source of another name are refused (#1342)", () => {
    const named = /Roster: `slice` is Slice.bindRecords\(key, \{ people, activities \}\) — name each source after what it narrows; Slice.bind and Slice.bindRecord are not taken/;
    assert.throws(() => payload(() => ({ slice: { slice: Slice.bind("spec.local", [{ name: "A. Alder" }], { fields: { name: { label: "Name" } } }) } as never })), named);
    assert.throws(() => payload(() => ({ slice: { slice: Slice.bindRecord("spec.single", staffSource()) } as never })), named);
    assert.throws(() => payload(() => ({ slice: { slice: Slice.bindRecords("spec.staff", { staff: { source: staffSource() } }) } })),
        /Roster: `slice` narrows its people and its activities — its source 'staff' is none of them; name the sources `people` and `activities`/);
});

test("the props #1342 retired are refused by name: visiblePeople, duties, and groups that carry their skills", () => {
    assert.throws(() => payload(() => ({ visiblePeople: new Set(["aalder"]) } as never)), /Roster: `visiblePeople` is gone — the Roster reads its people from `slice`'s `people` source/);
    assert.throws(() => payload(() => ({ duties: [] } as never)), /Roster: `duties` is gone — a duty is an activity of no group in `activities`/);
    assert.throws(() => payload(() => ({ groups: [{ key: "inbound", label: "Inbound", skills: [] }] } as never)),
        /Roster: groups no longer carry their skills — each skill is an activity of its group in `activities`/);
});

test("an app's tab follows the source it names; a source the slice lacks is refused; with no slice nothing is narrowed", () => {
    const Position = StructType({ label: StringType });
    const positions = (source?: string) => Roster.library.tab(East.value(new Map([["lead", { label: "Supervisor" }]]), DictType(StringType, Position)),
        { name: "Positions", label: p => p.label, ...(source === undefined ? {} : { source }) });
    const tabOf = (source: string | undefined, names: readonly string[]) => East.compile(East.function([], RosterAuthorTabType, _$ =>
        buildRosterTab(positions(source) as Extract<ReturnType<typeof positions>, { kind: "tab" }>, names)), [])();
    assert.deepEqual(tabOf("people", ["people", "activities"]).source, some("people"));
    assert.deepEqual(tabOf(undefined, ["people", "activities"]).source, none);
    assert.throws(() => tabOf("positions", ["people"]), /Roster: the Positions tab's source 'positions' is not one of the slice's sources \(people\)/);
    assert.throws(() => payload(() => ({ library: [positions("people")] })), /\(it has no slice\)/);
    // The tag builds over both sources, and over either alone.
    for (const sources of [{ people: { source: staffSource() } }, { activities: { source: activitySource() } }, { people: { source: staffSource() }, activities: { source: activitySource() } }]) {
        assert.doesNotThrow(() => payload(() => ({ slice: { slice: Slice.bindRecords("spec.roster", sources as never) }, library: [Roster.library.people(), Roster.library.activities()] })));
    }
    const bare = East.compile(payload(() => ({})), refusingPlatform)();
    assert.deepEqual([bare.slice.type, bare.narrowed.people.type, bare.narrowed.activities.type, bare.activities], ["none", "none", "none", []]);
});

test("Roster.activities reads a keyed record in its order: each skill with its group, a duty with none, a missing code empty", () => {
    const Skills = ArrayType(Roster.Types.Skill);
    const read = East.compile(East.function([DictType(StringType, Roster.Types.Activity)], Skills, (_$, rows) => Roster.activities(rows, { label: a => a.label, code: a => a.code, group: a => a.group })), []);
    const rows = new SortedMap([["unload", { label: "Unloading", code: "UL", group: some("inbound") }], ["general", { label: "General duties", code: "GD", group: none }]], compareFor(StringType));
    assert.deepEqual(read(rows), [
        { key: "general", label: "General duties", code: "GD", group: none },
        { key: "unload", label: "Unloading", code: "UL", group: some("inbound") },
    ]);
    const labelsOnly = East.compile(East.function([DictType(StringType, Roster.Types.Activity)], Skills, (_$, rows) => Roster.activities(rows, { label: a => a.label })), []);
    assert.deepEqual(labelsOnly(new SortedMap([["pick", { label: "Order picking", code: "OP", group: some("picking") }]], compareFor(StringType))), [{ key: "pick", label: "Order picking", code: "", group: none }]);
    assert.throws(() => East.function([DictType(DateTimeType, Roster.Types.Activity)], Skills, (_$, rows) => Roster.activities(rows as never, { label: () => "" })),
        /Roster.activities: activities must be a Dict keyed by String/);
});

/** A payload built over the warehouse's weeks with `fit` bound to the e3.function given. */
const boundTo = (fn: unknown) => East.function([], RosterPayloadType, $ => {
    const weeks = $.let(Record.bind(ex.rosterWeeks, [ex.rosterWeeksPatch]));
    const fit = $.let(Func.bind(fn as typeof ex.rosterStaffFit));
    return createRosterPayload({ weeks, people: [], groups: warehouseConfig.groups, shifts: warehouseConfig.shifts, fit });
});

test("R2 — `fit` is optional: without it the payload names no fit, and the Roster offers no Find fix; with it, its e3.function by name", () => {
    assert.deepEqual(East.compile(payload(() => ({})), refusingPlatform)().fit, none);
    assert.deepEqual(East.compile(boundTo(ex.rosterStaffFit), refusingPlatform)().fit, some({ name: "roster_staff_fit" }));
});

test("the tag refuses a `fit` that is no Func.bind of an e3.function from Roster.Types.FitRequest to Roster.Types.FitResult, naming what it asks or answers", () => {
    const answersText = e3.function("spec_answers_text", East.function([Roster.Types.FitRequest], StringType, () => "nobody"));
    const asksText = e3.function("spec_asks_text", East.function([StringType], Roster.Types.FitResult, (_$, group) => ({
        need: variant("leads", null), slot: { day: 0n, group, shift: "early" }, people: new Map(),
    })));
    assert.throws(() => boundTo(answersText), /Roster: `fit` answers \.String, not Roster.Types.FitResult/);
    assert.throws(() => boundTo(asksText), /Roster: `fit` asks \.String, not Roster.Types.FitRequest/);
    assert.throws(() => payload(() => ({ fit: East.value("roster_staff_fit") as never })),
        /Roster: `fit` is Func.bind of the app's e3.function from Roster.Types.FitRequest to Roster.Types.FitResult/);
});

test("Roster.activities in an app's order: lowest first, and activities of one order in the record's key order", () => {
    const Ordered = StructType({ label: StringType, order: IntegerType });
    const read = East.compile(East.function([DictType(StringType, Ordered)], ArrayType(Roster.Types.Skill), (_$, rows) =>
        Roster.activities(rows, { label: a => a.label, order: a => a.order })), []);
    const rows = new SortedMap([["yard", { label: "Yard", order: 2n }], ["unload", { label: "Unloading", order: 1n }], ["putaway", { label: "Put-away", order: 2n }]], compareFor(StringType));
    assert.deepEqual(read(rows), [
        { key: "unload", label: "Unloading", code: "", group: none },
        { key: "putaway", label: "Put-away", code: "", group: none },
        { key: "yard", label: "Yard", code: "", group: none },
    ]);
});
