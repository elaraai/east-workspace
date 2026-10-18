/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * A builder's narrowing, checked once for every builder (#1340, #1341): its
 * `slice` is `Slice.bindRecords`, every source one it takes, each a record with
 * String keys — and a tab's `source` is one of the slice's.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DictType, IntegerType, StringType, StructType, some } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui";
import e3 from "@elaraai/e3";
import { Data, recordSources, tabSource } from "@elaraai/e3-ui/internal";

const Person = StructType({ name: StringType, team: StringType });
const staff = e3.record("sources_spec_staff", DictType(StringType, Person), new Map());
const staffByTeam = e3.recordIndex("sources_spec_staff_by_team", staff, { on: ["team"] });
const Activity = StructType({ label: StringType, group: StringType });
const activities = e3.record("sources_spec_activities", DictType(StringType, Activity), new Map());
const activitiesByGroup = e3.recordIndex("sources_spec_activities_by_group", activities, { on: ["group"] });
const spec = { builder: "Roster", names: ["people", "activities"], what: "its people and its activities" } as const;

test("a Slice.bindRecords over the sources a builder takes: its chrome, each source's keys and typed data, in source order", () => {
    const slice = Slice.bindRecords("spec.roster", {
        people: { source: Data.bindPaged(staff, { indexes: [staffByTeam] }), fields: { team: { label: "Group" } } },
        activities: { source: Data.bindPaged(activities, { indexes: [activitiesByGroup] }) },
    });
    const sources = recordSources({ slice }, spec);
    assert.deepEqual(sources.names, ["people", "activities"]);
    assert.equal(sources.chrome.type, "some");
    assert.deepEqual(Object.keys(sources.keys), ["people", "activities"]);
    assert.deepEqual(Object.keys(sources.data), ["people", "activities"]);
    // A builder may take only some of its sources.
    assert.deepEqual(recordSources({ slice: Slice.bindRecords("spec.people", { people: { source: Data.bindPaged(staff, { indexes: [staffByTeam] }) } }) }, spec).names, ["people"]);
});

test("no slice: no chrome, and nothing narrowed", () => {
    const sources = recordSources(undefined, spec);
    assert.deepEqual([sources.chrome.type, sources.names, sources.keys, sources.data], ["none", [], {}, {}]);
});

test("Slice.bind and a single Slice.bindRecord are refused, naming Slice.bindRecords and the builder's sources", () => {
    const local = Slice.bind("spec.local", [{ name: "A", team: "pick" }], { fields: { team: { label: "Group" } } });
    const single = Slice.bindRecord("spec.single", Data.bindPaged(staff, { indexes: [staffByTeam] }));
    const message = /Roster: `slice` is Slice.bindRecords\(key, \{ people, activities \}\) — name each source after what it narrows; Slice.bind and Slice.bindRecord are not taken/;
    assert.throws(() => recordSources({ slice: local as never }, spec), message);
    assert.throws(() => recordSources({ slice: single as never }, spec), message);
});

test("a source the builder does not take is refused, naming the ones it does; an open builder takes its own names", () => {
    const slice = Slice.bindRecords("spec.staff", { staff: { source: Data.bindPaged(staff, { indexes: [staffByTeam] }) } });
    assert.throws(() => recordSources({ slice }, spec),
        /Roster: `slice` narrows its people and its activities — its source 'staff' is none of them; name the sources `people` and `activities`/);
    assert.deepEqual(recordSources({ slice }, { ...spec, takes: () => true }).names, ["staff"]);
});

test("a source over a record whose keys are not Strings is refused", () => {
    const numbered = e3.record("sources_spec_numbered", DictType(IntegerType, Person), new Map());
    const byTeam = e3.recordIndex("sources_spec_numbered_by_team", numbered, { on: ["team"] });
    const slice = Slice.bindRecords("spec.numbered", { people: { source: Data.bindPaged(numbered, { indexes: [byTeam] }) } });
    assert.throws(() => recordSources({ slice }, spec), /Roster: `slice`'s people narrows a record whose keys are not Strings — each source is a record with String primary keys/);
});

test("a String field with neither hints nor search is refused, naming its source: it would offer nothing to choose", () => {
    const people = () => Data.bindPaged(staff, { indexes: [staffByTeam] });
    assert.throws(() => Slice.bindRecords("spec.fields", { people: { source: people(), search: [], fields: { team: { label: "Group" } } } }),
        /Slice.bindRecords: the 'people' source — Slice.bindRecord: 'Group' offers nothing to choose — give it hints, or list 'team' in search/);
    // Hints offer choices, a search finds them, and with no search named every String field is searched.
    assert.doesNotThrow(() => Slice.bindRecords("spec.hinted", { people: { source: people(), search: [], fields: { team: { label: "Group", hints: ["pick"] } } } }));
    assert.doesNotThrow(() => Slice.bindRecords("spec.searched", { people: { source: people(), search: ["team"], fields: { team: { label: "Group" } } } }));
    assert.doesNotThrow(() => Slice.bindRecords("spec.default", { people: { source: people(), fields: { team: { label: "Group" } } } }));
});

test("a tab's source: none when it names none; one of the slice's; refused otherwise, naming the slice's sources", () => {
    assert.equal(tabSource("Roster", "Positions", undefined, ["people"]).type, "none");
    assert.deepEqual(tabSource("Roster", "Positions", "people", ["people", "activities"]), some("people"));
    assert.throws(() => tabSource("Roster", "Positions", "positions", ["people", "activities"]),
        /Roster: the Positions tab's source 'positions' is not one of the slice's sources \(people, activities\)/);
    assert.throws(() => tabSource("Roster", "Positions", "positions", []), /\(it has no slice\)/);
});
