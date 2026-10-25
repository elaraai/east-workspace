/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The lists the Roster reads over the app's own rows (#1368, `Builder
 * Interfaces Spec.md` §5.2): `Roster.shifts`, `groups`, `positions`,
 * `activities`, `proposals` and `patterns` (#1406), each through accessors
 * reified once, its rows in their `order` and then key order, each row's key
 * its record's.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, BooleanType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, SortedMap, StringType, StructType, compareFor, none, some,
    variant,
} from "@elaraai/east";
import { ColorTokenType } from "@elaraai/east-ui";
import { Roster, Schedule } from "@elaraai/e3-ui";

const byString = compareFor(StringType);
const at = (text: string): Date => new Date(text);

const ShiftRow = StructType({ name: StringType, code: StringType, starts: Schedule.Types.Clock, hours: FloatType, order: IntegerType });
const ColouredShiftRow = StructType({ name: StringType, code: StringType, starts: Schedule.Types.Clock, hours: FloatType, colour: OptionType(ColorTokenType) });
const PatternRow = StructType({ name: StringType, days: ArrayType(OptionType(StringType)), rank: IntegerType });
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
        { key: "early", label: "Early", code: "E", start: { hour: 6n, minute: 0n }, hours: 8, color: none },
        { key: "late", label: "Late", code: "L", start: { hour: 14n, minute: 30n }, hours: 7.5, color: none },
        { key: "night", label: "Night", code: "N", start: { hour: 22n, minute: 0n }, hours: 8, color: none },
    ]);
});

test("Roster.shifts' `color` reads the app's colour token for a shift, an Option<ColorToken>; omitted, every shift is neutral (#1406)", () => {
    const read = East.compile(East.function([DictType(StringType, ColouredShiftRow)], ArrayType(Roster.Types.Shift), (_$, rows) =>
        Roster.shifts(rows, { label: s => s.name, code: s => s.code, start: s => s.starts, hours: s => s.hours, color: s => s.colour }).rows), []);
    const rows = new SortedMap([
        ["early", { name: "Early", code: "E", starts: { hour: 6n, minute: 0n }, hours: 8, colour: some(variant("teal", variant("300", null))) }],
        ["late", { name: "Late", code: "L", starts: { hour: 14n, minute: 0n }, hours: 8, colour: none }],
    ], byString);
    assert.deepEqual(read(rows), [
        { key: "early", label: "Early", code: "E", start: { hour: 6n, minute: 0n }, hours: 8, color: some(variant("teal", variant("300", null))) },
        { key: "late", label: "Late", code: "L", start: { hour: 14n, minute: 0n }, hours: 8, color: none },
    ]);
});

test("Roster.patterns reads the app's week pattern rows in their order, each its seven days; its tab's name and icon are the declaration's, `calendar-week` by default (#1406)", () => {
    const rows = new SortedMap([
        ["off", { name: "Off", days: [none, none, none, none, none, none, none], rank: 3n }],
        ["e5s", { name: "Early · Sun–Thu", days: [some("early"), some("early"), some("early"), some("early"), some("early"), none, none], rank: 1n }],
        ["fwd", { name: "Forward rotation", days: [some("early"), some("early"), some("late"), some("late"), some("night"), none, none], rank: 2n }],
    ], byString);
    const read = East.compile(East.function([DictType(StringType, PatternRow)], ArrayType(Roster.Types.Pattern), (_$, rows) =>
        Roster.patterns(rows, { name: "Weeks", label: p => p.name, days: p => p.days, order: p => p.rank }).rows), []);
    assert.deepEqual(read(rows), [
        { key: "e5s", label: "Early · Sun–Thu", days: [some("early"), some("early"), some("early"), some("early"), some("early"), none, none] },
        { key: "fwd", label: "Forward rotation", days: [some("early"), some("early"), some("late"), some("late"), some("night"), none, none] },
        { key: "off", label: "Off", days: [none, none, none, none, none, none, none] },
    ]);
    // With no order, key order.
    const byKey = East.compile(East.function([DictType(StringType, PatternRow)], ArrayType(Roster.Types.Pattern), (_$, rows) =>
        Roster.patterns(rows, { name: "Weeks", label: p => p.name, days: p => p.days }).rows), []);
    assert.deepEqual(byKey(rows).map(pattern => pattern.key), ["e5s", "fwd", "off"]);
    // The tab's words are the declaration's own, plain values.
    East.function([DictType(StringType, PatternRow)], NullType, (_$, rows) => {
        const weeks = Roster.patterns(rows, { name: "Weeks", label: p => p.name, days: p => p.days });
        assert.deepEqual([weeks.name, weeks.icon], ["Weeks", "calendar-week"]);
        const patterns = Roster.patterns(rows, { name: "Patterns", icon: "repeat", label: p => p.name, days: p => p.days });
        assert.deepEqual([patterns.name, patterns.icon], ["Patterns", "repeat"]);
    });
});

test("Roster.patterns is refused without a `name`, with an `icon` that is no String, and with `days` of another type, naming it (#1406)", () => {
    assert.throws(() => East.function([DictType(StringType, PatternRow)], NullType, (_$, rows) => {
        Roster.patterns(rows, { name: undefined as never, label: p => p.name, days: p => p.days });
    }), /Roster\.patterns: `name` titles the tab \("Patterns", "Weeks"\) — a String, as Schedule\.events' `name` is/);
    assert.throws(() => East.function([DictType(StringType, PatternRow)], NullType, (_$, rows) => {
        Roster.patterns(rows, { name: "Weeks", icon: 3 as never, label: p => p.name, days: p => p.days });
    }), /Roster\.patterns: `icon` is the cards' Font Awesome solid icon name \("calendar-week"\), a String/);
    assert.throws(() => East.function([DictType(StringType, PatternRow)], NullType, (_$, rows) => {
        Roster.patterns(rows, { name: "Weeks", label: p => p.name, days: p => p.name as never });
    }), /Roster\.patterns: `days` returns an Array of seven Option<String> shift keys from the week's first day — and this one returns \.String/);
    assert.throws(() => East.function([DictType(DateTimeType, PatternRow)], NullType, (_$, rows) => {
        Roster.patterns(rows as never, { name: "Weeks", label: () => "", days: () => [] });
    }), /Roster\.patterns: patterns are a Dict keyed by String/);
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
    // A colour of another type is refused naming ColorTokenType (#1406).
    assert.throws(() => East.function([DictType(StringType, ShiftRow)], NullType, (_$, rows) => {
        Roster.shifts(rows, { label: s => s.name, code: s => s.code, start: s => s.starts, hours: s => s.hours, color: s => s.code as never });
    }), /Roster\.shifts: `color` returns an Option of a ColorTokenType, a shift's colour \(Style\.ColorToken\("teal", "500"\)\) — and this one returns \.String/);
    assert.throws(() => East.function([DictType(StringType, PositionRow)], NullType, (_$, rows) => {
        Roster.positions(rows, { label: p => p.name, code: p => p.badge, lead: p => p.rank as never });
    }), /Roster\.positions: `lead` returns a Boolean, whether a position satisfies the lead rule — and this one returns \.Integer/);
    assert.throws(() => East.function([DictType(StringType, SuggestionRow)], NullType, (_$, rows) => {
        Roster.proposals(rows, { person: s => s.who, day: s => s.why as never, group: s => s.team, shift: s => s.shift, reason: s => s.why });
    }), /Roster\.proposals: `day` returns a DateTime, the day suggested — and this one returns \.String/);
});
