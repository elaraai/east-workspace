/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The lists the Roster reads over the app's own rows (#1368, `Builder
 * Interfaces Spec.md` §5.2): `Roster.shifts`, `groups`, `positions`,
 * `activities` and `proposals`, each through accessors reified once, its rows
 * in their `order` and then key order, each row's key its record's.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, BooleanType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, SortedMap, StringType, StructType, compareFor, none, some,
} from "@elaraai/east";
import { Roster, Schedule } from "@elaraai/e3-ui";

const byString = compareFor(StringType);
const at = (text: string): Date => new Date(text);

const ShiftRow = StructType({ name: StringType, code: StringType, starts: Schedule.Types.Clock, hours: FloatType, order: IntegerType });
const GroupRow = StructType({ name: StringType });
const PositionRow = StructType({ name: StringType, badge: StringType, leads: BooleanType, rank: IntegerType });
const SuggestionRow = StructType({ who: StringType, on: DateTimeType, team: StringType, shift: StringType, why: StringType });

test("Roster.shifts reads the app's shift rows in their order, shifts of one order in key order", () => {
    const read = East.compile(East.function([DictType(StringType, ShiftRow)], ArrayType(Roster.Types.Shift), (_$, rows) =>
        Roster.shifts(rows, { label: s => s.name, code: s => s.code, start: s => s.starts, hours: s => s.hours, order: s => s.order }).rows), []);
    const rows = new SortedMap([
        ["night", { name: "Night", code: "N", starts: { hour: 22n, minute: 0n }, hours: 8, order: 2n }],
        ["early", { name: "Early", code: "E", starts: { hour: 6n, minute: 0n }, hours: 8, order: 1n }],
        ["late", { name: "Late", code: "L", starts: { hour: 14n, minute: 30n }, hours: 7.5, order: 2n }],
    ], byString);
    assert.deepEqual(read(rows), [
        { key: "early", label: "Early", code: "E", start: { hour: 6n, minute: 0n }, hours: 8 },
        { key: "late", label: "Late", code: "L", start: { hour: 14n, minute: 30n }, hours: 7.5 },
        { key: "night", label: "Night", code: "N", start: { hour: 22n, minute: 0n }, hours: 8 },
    ]);
});

test("Roster.groups and Roster.positions: with no order, key order", () => {
    const groups = East.compile(East.function([DictType(StringType, GroupRow)], ArrayType(Roster.Types.Group), (_$, rows) =>
        Roster.groups(rows, { label: g => g.name }).rows), []);
    assert.deepEqual(groups(new SortedMap([["picking", { name: "Picking" }], ["dispatch", { name: "Dispatch" }]], byString)), [
        { key: "dispatch", label: "Dispatch" }, { key: "picking", label: "Picking" },
    ]);
    const positions = East.compile(East.function([DictType(StringType, PositionRow)], ArrayType(Roster.Types.Position), (_$, rows) =>
        Roster.positions(rows, { label: p => p.name, code: p => p.badge, lead: p => p.leads, order: p => p.rank }).rows), []);
    assert.deepEqual(positions(new SortedMap([
        ["crew", { name: "Associate", badge: "", leads: false, rank: 2n }], ["lead", { name: "Supervisor", badge: "SV", leads: true, rank: 1n }],
    ], byString)), [
        { key: "lead", label: "Supervisor", code: "SV", lead: true }, { key: "crew", label: "Associate", code: "", lead: false },
    ]);
});

test("Roster.proposals reads the app's suggestion rows, each keyed by its row's key", () => {
    const read = East.compile(East.function([DictType(StringType, SuggestionRow)], ArrayType(Roster.Types.Proposal), (_$, rows) =>
        Roster.proposals(rows, { person: s => s.who, day: s => s.on, group: s => s.team, shift: s => s.shift, reason: s => s.why }).rows), []);
    assert.deepEqual(read(new SortedMap([
        ["s2", { who: "bpumice", on: at("2028-03-09T00:00:00Z"), team: "picking", shift: "night", why: "Off Thursday" }],
        ["s1", { who: "nochre", on: at("2028-03-09T00:00:00Z"), team: "inbound", shift: "night", why: "Off Thursday" }],
    ], byString)), [
        { key: "s1", day: at("2028-03-09T00:00:00Z"), group: "inbound", shift: "night", person: "nochre", reason: "Off Thursday" },
        { key: "s2", day: at("2028-03-09T00:00:00Z"), group: "picking", shift: "night", person: "bpumice", reason: "Off Thursday" },
    ]);
});

test("Roster.activities reads a keyed record in its order: each skill with its group, a duty with none, a missing code empty", () => {
    const Skills = ArrayType(Roster.Types.Skill);
    const read = East.compile(East.function([DictType(StringType, Roster.Types.Activity)], Skills, (_$, rows) => Roster.activities(rows, { label: a => a.label, code: a => a.code, group: a => a.group })), []);
    const rows = new SortedMap([["unload", { label: "Unloading", code: "UL", group: some("inbound") }], ["general", { label: "General duties", code: "GD", group: none }]], byString);
    assert.deepEqual(read(rows), [
        { key: "general", label: "General duties", code: "GD", group: none },
        { key: "unload", label: "Unloading", code: "UL", group: some("inbound") },
    ]);
    const labelsOnly = East.compile(East.function([DictType(StringType, Roster.Types.Activity)], Skills, (_$, rows) => Roster.activities(rows, { label: a => a.label })), []);
    assert.deepEqual(labelsOnly(new SortedMap([["pick", { label: "Order picking", code: "OP", group: some("picking") }]], byString)), [{ key: "pick", label: "Order picking", code: "", group: none }]);
});

test("Roster.activities in an app's order: lowest first, and activities of one order in the record's key order", () => {
    const Ordered = StructType({ label: StringType, order: IntegerType });
    const read = East.compile(East.function([DictType(StringType, Ordered)], ArrayType(Roster.Types.Skill), (_$, rows) =>
        Roster.activities(rows, { label: a => a.label, order: a => a.order })), []);
    const rows = new SortedMap([["yard", { label: "Yard", order: 2n }], ["unload", { label: "Unloading", order: 1n }], ["putaway", { label: "Put-away", order: 2n }]], byString);
    assert.deepEqual(read(rows), [
        { key: "unload", label: "Unloading", code: "", group: none },
        { key: "putaway", label: "Put-away", code: "", group: none },
        { key: "yard", label: "Yard", code: "", group: none },
    ]);
});

test("a list's rows are a Dict keyed by String, and each accessor returns its own type, or the list is refused naming it", () => {
    assert.throws(() => East.function([DictType(DateTimeType, GroupRow)], NullType, (_$, rows) => { Roster.groups(rows as never, { label: () => "" }); }),
        /Roster\.groups: groups are a Dict keyed by String — a record's read\(\) — and these are \.Dict/);
    assert.throws(() => East.function([DictType(DateTimeType, Roster.Types.Activity)], NullType, (_$, rows) => { Roster.activities(rows as never, { label: () => "" }); }),
        /Roster\.activities: activities are a Dict keyed by String/);
    assert.throws(() => East.function([DictType(StringType, ShiftRow)], NullType, (_$, rows) => {
        Roster.shifts(rows, { label: s => s.name, code: s => s.code, start: s => s.name as never, hours: s => s.hours });
    }), /Roster\.shifts: `start` returns a Schedule\.Types\.Clock, when a shift starts in UTC — and this one returns \.String/);
    assert.throws(() => East.function([DictType(StringType, PositionRow)], NullType, (_$, rows) => {
        Roster.positions(rows, { label: p => p.name, code: p => p.badge, lead: p => p.rank as never });
    }), /Roster\.positions: `lead` returns a Boolean, whether a position satisfies the lead rule — and this one returns \.Integer/);
    assert.throws(() => East.function([DictType(StringType, SuggestionRow)], NullType, (_$, rows) => {
        Roster.proposals(rows, { person: s => s.who, day: s => s.why as never, group: s => s.team, shift: s => s.shift, reason: s => s.why });
    }), /Roster\.proposals: `day` returns a DateTime, the day suggested — and this one returns \.String/);
});
