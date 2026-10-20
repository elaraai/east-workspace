/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Schedule's declarations for the builders that write the app's own records
 * (#1367, `Builder Interfaces Spec.md` §4): the Roster's and the Allocation's
 * roles on `Schedule.events`, read and written through a kind's `buildRoster`
 * and `buildAllocation`; an optional `title`, which the Calendar and Plan
 * still require; the builders' accessors on `Schedule.resources`; and
 * `Schedule.periods`, what a builder publishes.
 *
 * The records are bound as an app binds them, `Record.bind(record,
 * [e3.mutation.patch(record)])`, under the in-memory `Record.bind`: each
 * handle reads a fixed state, and its patch door commits at `state-1`. A
 * record read a period at a time is read through the in-memory
 * `Data.bindPaged`, its searches and pages counted, and its whole reads too,
 * of which a bounded read makes none (B14).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, SetType, SortedMap, SortedSet, StringType,
    StructType, VariantType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, fromEastTypeValue, isTypeEqual, none, printFor, some, variant,
    type EastIR, type ValueTypeOf,
} from "@elaraai/east";
import { SeekQueryType, TimeStepType } from "@elaraai/east-ui";
import { Editing } from "@elaraai/east-ui/internal";
import { CalendarPayloadType, Data, Plan, PlanPayloadType, Record, Schedule, createCalendarPayload } from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import { memoryPages, memoryRecords, type MemoryIndexEntry, type MemoryPagedSource, type PagedAsked } from "./memory-records.js";

/** An instant as its author writes it: UTC, with its zone. */
const at = (text: string): Date => new Date(text);

// ============================================================================
// The records: a warehouse's duties and weeks, a kiln yard's bins and days
// ============================================================================

/** A duty: the Roster's roles beside fields of the app's own. */
const DutyType = StructType({
    who: VariantType({ staff: StringType, agency: StringType }),
    start: DateTimeType, end: DateTimeType,
    shift: StringType, team: StringType, role: StringType, task: OptionType(StringType),
    unpaidBreak: FloatType, costCentre: StringType, note: StringType,
});
/** A duty with only the Roster's required roles, its person a plain key. */
const PlainDutyType = StructType({ person: StringType, start: DateTimeType, end: DateTimeType, shift: StringType, team: StringType });
/** A bin: the Allocation's roles beside the yard's own fields. */
const BinType = StructType({
    bay: StringType, at: DateTimeType, load: OptionType(StringType), m3: FloatType, kilns: DictType(StringType, FloatType),
    dryFor: TimeStepType, spec: OptionType(StringType), specMeasured: StringType, instruction: OptionType(StringType),
});
/** A week of the app's: its status, the proposals it dismissed, and a field of its own. */
const RotaWeekType = StructType({
    state: VariantType({ open: NullType, issued: StructType({ at: DateTimeType }), cancelled: NullType }),
    dismissed: SetType(StringType), approver: OptionType(StringType),
});
/** A day of the app's, its published case holding nothing. */
const YardDayType = StructType({ state: VariantType({ draft: NullType, issued: NullType }), notes: StringType });

const Duties = DictType(StringType, DutyType);
const PlainDuties = DictType(StringType, PlainDutyType);
const Bins = DictType(StringType, BinType);
const RotaWeeks = DictType(DateTimeType, RotaWeekType);
const YardDays = DictType(DateTimeType, YardDayType);

type Duty = ValueTypeOf<typeof DutyType>;
type Bin = ValueTypeOf<typeof BinType>;
type RotaWeek = ValueTypeOf<typeof RotaWeekType>;

const byString = compareFor(StringType);
const D1: Duty = {
    who: variant("staff", "w-01"), start: at("2027-03-08T05:00:00Z"), end: at("2027-03-08T15:00:00Z"),
    shift: "early", team: "inbound", role: "lead", task: some("unloading"), unpaidBreak: 30, costCentre: "CC-10", note: "keys",
};
const D2: Duty = {
    who: variant("agency", "a-1"), start: at("2027-03-09T14:00:00Z"), end: at("2027-03-09T22:00:00Z"),
    shift: "late", team: "dispatch", role: "crew", task: none, unpaidBreak: 0, costCentre: "CC-20", note: "",
};
const D3: Duty = { ...D1, start: at("2027-03-20T05:00:00Z"), end: at("2027-03-20T13:00:00Z"), note: "a later week" };
const DUTIES = new SortedMap<string, Duty>([["d1", D1], ["d2", D2], ["d3", D3]], byString);
const PLAIN_DUTIES = new SortedMap([["p1", { person: "w-02", start: at("2027-03-08T06:00:00Z"), end: at("2027-03-08T14:00:00Z"), shift: "early", team: "inbound" }]], byString);
const B1: Bin = {
    bay: "B-1", at: at("2027-05-11T02:15:00Z"), load: some("LD-2203"), m3: 24, kilns: new SortedMap([["K-109", 24]], byString),
    dryFor: variant("days", 9), spec: some("MC14"), specMeasured: "MC14", instruction: some("Hold at 40 °C on arrival"),
};
const BINS = new SortedMap<string, Bin>([["3103", B1]], byString);
const WEEK: RotaWeek = { state: variant("issued", { at: at("2027-03-05T09:00:00Z") }), dismissed: new SortedSet(["pr-1"], byString), approver: some("Ops") };
const ROTA_WEEKS = new SortedMap<Date, RotaWeek>([
    [at("2027-03-07T00:00:00Z"), WEEK],
    [at("2027-03-14T00:00:00Z"), { state: variant("open", null), dismissed: new SortedSet([], byString), approver: none }],
    [at("2027-03-21T00:00:00Z"), { state: variant("cancelled", null), dismissed: new SortedSet([], byString), approver: none }],
], compareFor(DateTimeType));
const YARD_DAYS = new SortedMap([[at("2027-05-11T00:00:00Z"), { state: variant("draft", null), notes: "" }]], compareFor(DateTimeType));

const dutiesRecord = e3.record("builders_spec_duties", Duties, new Map());
const plainDutiesRecord = e3.record("builders_spec_plain_duties", PlainDuties, new Map());
const binsRecord = e3.record("builders_spec_bins", Bins, new Map());
const weeksRecord = e3.record("builders_spec_weeks", RotaWeeks, new Map());
const daysRecord = e3.record("builders_spec_days", YardDays, new Map());
const dutiesPatch = e3.mutation.patch(dutiesRecord);
const plainDutiesPatch = e3.mutation.patch(plainDutiesRecord);
const binsPatch = e3.mutation.patch(binsRecord);
const weeksPatch = e3.mutation.patch(weeksRecord);
const daysPatch = e3.mutation.patch(daysRecord);

/** `Record.bind`, in memory, over the states above. */
const PLATFORM = memoryRecords(new Map<string, unknown>([
    ["builders_spec_duties", DUTIES],
    ["builders_spec_plain_duties", PLAIN_DUTIES],
    ["builders_spec_bins", BINS],
    ["builders_spec_weeks", ROTA_WEEKS],
    ["builders_spec_days", YARD_DAYS],
]));

const encodeDuty = encodeBeast2For(DutyType);
const decodeDuty = decodeBeast2For(DutyType);
const dutyEqual = equalFor(DutyType);
const encodeBin = encodeBeast2For(BinType);
const decodeBin = decodeBeast2For(BinType);
const binEqual = equalFor(BinType);
const encodeWeek = encodeBeast2For(RotaWeekType);
const decodeWeek = decodeBeast2For(RotaWeekType);
const weekEqual = equalFor(RotaWeekType);
const rosterRolesEqual = equalFor(Schedule.Types.RosterRoles);
const allocationRolesEqual = equalFor(Schedule.Types.AllocationRoles);
const statusEqual = equalFor(Schedule.Types.PeriodStatus);

type RosterKind = ValueTypeOf<typeof Schedule.Types.RosterKind>;
type AllocationKind = ValueTypeOf<typeof Schedule.Types.AllocationKind>;
type Periods = ValueTypeOf<typeof Schedule.Types.PeriodsKind>;

/** The warehouse's duty kind, every one of the Roster's roles mapped, its hours less the unpaid break. */
const dutyKind = East.compile(East.function([], Schedule.Types.RosterKind, ($) => {
    const duties = $.let(Record.bind(dutiesRecord, [dutiesPatch]));
    return Schedule.events(duties, {
        name: "Duty", icon: "user-clock",
        start: "start", end: "end", resource: { field: "who", of: { staff: "people", agency: "agencies" } },
        shift: "shift", group: "team", position: "role", activity: "task",
        hours: (d) => d.start.durationMinutes(d.end).subtract(d.unpaidBreak).divide(60.0),
    }).buildRoster("duty");
}), PLATFORM)() as RosterKind;

/** A duty kind with only the Roster's required roles: no title, no position, no activity, no hours accessor. */
const plainKind = East.compile(East.function([], Schedule.Types.RosterKind, ($) => {
    const duties = $.let(Record.bind(plainDutiesRecord, [plainDutiesPatch]));
    return Schedule.events(duties, {
        name: "Duty", icon: "user-clock", start: "start", end: "end", resource: { field: "person", of: "people" }, shift: "shift", group: "team",
    }).buildRoster("duty");
}), PLATFORM)() as RosterKind;

/** The yard's bin kind, every one of the Allocation's roles mapped. */
const binKind = East.compile(East.function([], Schedule.Types.AllocationKind, ($) => {
    const bins = $.let(Record.bind(binsRecord, [binsPatch]));
    return Schedule.events(bins, {
        name: "Bin", icon: "box", at: "at", resource: { field: "bay", of: "bays" }, arrival: "load",
        quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor", kind: "spec",
    }).buildAllocation("bin");
}), PLATFORM)() as AllocationKind;

/** The warehouse's weeks: its status mapped, and the proposals each dismissed. */
const weekPeriods = East.compile(East.function([], Schedule.Types.PeriodsKind, ($) => {
    const weeks = $.let(Record.bind(weeksRecord, [weeksPatch]));
    return Schedule.periods(weeks, { every: "week", status: { field: "state", draft: "open", published: "issued" }, dismissed: "dismissed" }).build();
}), PLATFORM)() as Periods;

/** The yard's days: a published case holding nothing, and no dismissals. */
const dayPeriods = East.compile(East.function([], Schedule.Types.PeriodsKind, ($) => {
    const days = $.let(Record.bind(daysRecord, [daysPatch]));
    return Schedule.periods(days, { every: "day", status: { field: "state", draft: "draft", published: "issued" } }).build();
}), PLATFORM)() as Periods;

// ============================================================================
// The Roster's roles
// ============================================================================

describe("Schedule.events — the Roster's roles (buildRoster)", () => {
    test("reads a duty's roles: its times, its person or agency, its shift and group, its position, its activity and its hours", () => {
        assert.ok(rosterRolesEqual(dutyKind.read(encodeDuty(D1), "d1"), {
            start: D1.start, end: D1.end, resource: some({ kind: "people", key: "w-01" }),
            shift: "early", group: "inbound", position: some("lead"), activity: some("unloading"), hours: 9.5,
        }));
        const agency = dutyKind.read(encodeDuty(D2), "d2");
        assert.ok(equalFor(OptionType(Schedule.Types.ResourceRef))(agency.resource, some({ kind: "agencies", key: "a-1" })), "an agency's request, by the variant's case");
        assert.equal(agency.hours, 8, "the hours accessor reads the row");
        assert.deepEqual([dutyKind.roles.position, dutyKind.roles.activity], [true, true]);
    });

    test("writes a duty's roles, and every other field of the row reads back as it was (B1)", () => {
        const moved = dutyKind.write(encodeDuty(D1), {
            start: at("2027-03-08T14:00:00Z"), end: at("2027-03-08T22:00:00Z"), resource: some({ kind: "agencies", key: "a-2" }),
            shift: "late", group: "picking", position: some("crew"), activity: none, hours: 0,
        });
        if (moved.type !== "some") assert.fail("expected the duty written");
        assert.ok(dutyEqual(decodeDuty(moved.value), {
            ...D1, who: variant("agency", "a-2"), start: at("2027-03-08T14:00:00Z"), end: at("2027-03-08T22:00:00Z"),
            shift: "late", team: "picking", role: "crew", task: none,
        }), "the unpaid break, the cost centre and the note are the row's own");
        assert.equal(dutyKind.write(encodeDuty(D1), { ...dutyKind.read(encodeDuty(D1), "d1"), resource: some({ kind: "machines", key: "m1" }) }).type, "none",
            "a resource of a kind the duty kind does not take is refused");
    });

    test("creates a new duty from its roles: every other field its type's default", () => {
        const created = dutyKind.create({
            start: at("2027-03-10T06:00:00Z"), end: at("2027-03-10T14:00:00Z"), resource: some({ kind: "people", key: "w-03" }),
            shift: "early", group: "inbound", position: some("crew"), activity: none, hours: 0,
        });
        if (created.type !== "some") assert.fail("expected the duty created");
        assert.ok(dutyEqual(decodeDuty(created.value), {
            who: variant("staff", "w-03"), start: at("2027-03-10T06:00:00Z"), end: at("2027-03-10T14:00:00Z"),
            shift: "early", team: "inbound", role: "crew", task: none, unpaidBreak: 0, costCentre: "", note: "",
        }));
    });

    test("a kind without the optional roles reads none for them, and counts a duty's length in hours", () => {
        const rows = plainKind.rows(at("2027-03-07T00:00:00Z"), at("2027-03-14T00:00:00Z"));
        if (rows.type !== "some") assert.fail("expected the rows");
        const roles = rows.value.get("p1")!.roles;
        assert.deepEqual([roles.position.type, roles.activity.type, roles.hours], ["none", "none", 8]);
        assert.deepEqual([plainKind.roles.position, plainKind.roles.activity], [false, false]);
    });

    test("reads the rows overlapping [from, to) by key, each its roles beside its row, from a record no source narrows", () => {
        const rows = dutyKind.rows(at("2027-03-07T00:00:00Z"), at("2027-03-14T00:00:00Z"));
        if (rows.type !== "some") assert.fail("expected the rows");
        assert.deepEqual([...rows.value.keys()], ["d1", "d2"], "d3 is a later week's");
        const d1 = rows.value.get("d1")!;
        assert.ok(dutyEqual(decodeDuty(d1.row), D1));
        assert.ok(rosterRolesEqual(d1.roles, dutyKind.read(encodeDuty(D1), "d1")), "the pass that reads the row reads its roles as `read` does");
        assert.ok(isTypeEqual(fromEastTypeValue(dutyKind.rowType), DutyType));
    });

    test("carries the kind's session over the record: its patch door, and its form over the fields no role writes", () => {
        assert.equal(dutyKind.kind.editing.sourceId, "builders_spec_duties");
        assert.deepEqual(dutyKind.kind.fields.map((f) => f.path.join(".")), ["unpaidBreak", "costCentre", "note"]);
    });
});

// ============================================================================
// The Allocation's roles
// ============================================================================

describe("Schedule.events — the Allocation's roles (buildAllocation)", () => {
    test("reads a bin's roles: its time, lane, arrival, quantity, parts, hold and kind", () => {
        assert.ok(allocationRolesEqual(binKind.read(encodeBin(B1)), {
            at: B1.at, lane: "B-1", arrival: some("LD-2203"), quantity: 24, parts: new SortedMap([["K-109", 24]], byString),
            hold: variant("days", 9), kind: some("MC14"),
        }));
        assert.deepEqual([binKind.lanes, binKind.parts, binKind.kinded], ["bays", "kilns", true]);
        assert.ok(equalFor(OptionType(StringType))(binKind.unit, some("m³")), "the quantity's unit, its role's");
    });

    test("writes a bin's roles, and the yard's own fields read back as they were (B1)", () => {
        const moved = binKind.write(encodeBin(B1), {
            at: at("2027-05-11T06:35:00Z"), lane: "B-2", arrival: some("LD-2203"), quantity: 24,
            parts: new SortedMap([["K-109", 12], ["K-110", 12]], byString), hold: variant("days", 9), kind: some("MC14"),
        });
        assert.ok(binEqual(decodeBin(moved), { ...B1, bay: "B-2", at: at("2027-05-11T06:35:00Z"), kilns: new SortedMap([["K-109", 12], ["K-110", 12]], byString) }));
    });

    test("books a new bin from its roles and an arrival's values; a reservation's own fields are their type's default (B13)", () => {
        const roles: ValueTypeOf<typeof Schedule.Types.AllocationRoles> = { at: at("2027-05-11T00:15:00Z"), lane: "B-1", arrival: some("LD-2235"), quantity: 8,
            parts: new SortedMap<string, number>([], byString), hold: variant("days", 9), kind: some("MC10") };
        const Values = StructType({ specMeasured: StringType, instruction: OptionType(StringType) });
        const booked = binKind.create(roles, some(encodeBeast2For(Values)({ specMeasured: "MC10", instruction: some("Sticker every 600 mm") })));
        assert.ok(binEqual(decodeBin(booked), {
            bay: "B-1", at: roles.at, load: some("LD-2235"), m3: 8, kilns: roles.parts, dryFor: variant("days", 9), spec: some("MC10"),
            specMeasured: "MC10", instruction: some("Sticker every 600 mm"),
        }));
        const reserved = binKind.create({ ...roles, arrival: none, quantity: 0, kind: none }, none);
        assert.ok(binEqual(decodeBin(reserved), {
            bay: "B-1", at: roles.at, load: none, m3: 0, kilns: roles.parts, dryFor: variant("days", 9), spec: none, specMeasured: "", instruction: none,
        }));
    });

    test("names the fields no role maps: what an arrival's values give a booked bin", () => {
        assert.ok(isTypeEqual(fromEastTypeValue(binKind.values), StructType({ specMeasured: StringType, instruction: OptionType(StringType) })));
    });

    test("reads the bins of [from, to) by their time, each its roles beside its row", () => {
        const rows = binKind.rows(at("2027-05-11T00:00:00Z"), at("2027-05-12T00:00:00Z"));
        if (rows.type !== "some") assert.fail("expected the rows");
        assert.deepEqual([...rows.value.keys()], ["3103"]);
        const bin = rows.value.get("3103")!;
        assert.ok(binEqual(decodeBin(bin.row), B1));
        assert.ok(allocationRolesEqual(bin.roles, binKind.read(encodeBin(B1))));
        const none_ = binKind.rows(at("2027-05-12T00:00:00Z"), at("2027-05-13T00:00:00Z"));
        if (none_.type !== "some") assert.fail("expected the rows");
        assert.equal(none_.value.size, 0);
    });
});

// ============================================================================
// The roles refused at build (B2)
// ============================================================================

describe("Schedule.events — the builders' roles refused at build (B2)", () => {
    /** Declare a duty kind over `options` inside a bound block, built for the Roster unless `build` says otherwise. */
    function duties(options: object, build: "roster" | "allocation" | "none" = "roster"): void {
        East.function([], NullType, ($) => {
            const bound = $.let(Record.bind(dutiesRecord, [dutiesPatch]));
            const kind = Schedule.events(bound as never, { name: "Duty", icon: "i", start: "start", end: "end", ...options } as never);
            if (build === "roster") kind.buildRoster("duty");
            if (build === "allocation") kind.buildAllocation("duty");
        });
    }
    function bins(options: object): void {
        East.function([], NullType, ($) => {
            const bound = $.let(Record.bind(binsRecord, [binsPatch]));
            Schedule.events(bound as never, {
                name: "Bin", icon: "i", at: "at", resource: { field: "bay", of: "bays" }, arrival: "load", quantity: { field: "m3" },
                parts: { field: "kilns", of: "kilns" }, hold: "dryFor", ...options,
            } as never).buildAllocation("bin");
        });
    }

    test("a Roster role naming a field of another type", () => {
        assert.throws(() => duties({ shift: "unpaidBreak", group: "team" }), /`shift` names a String field — "unpaidBreak" holds \.Float/);
        assert.throws(() => duties({ shift: "shift", group: "team", activity: "note" }), /`activity` names an Option of a String field — "note" holds \.String/);
        assert.throws(() => duties({ shift: "shift", group: "team", position: "task" }), /`position` names a String field — "task" holds an Option of \.String/);
        assert.throws(() => duties({ shift: "shift", group: "nope" }), /`group` names "nope", a field the row does not have/);
    });

    test("an Allocation role naming a field of another type", () => {
        assert.throws(() => bins({ arrival: "bay" }), /`arrival` names an Option of a String field — "bay" holds \.String/);
        assert.throws(() => bins({ parts: { field: "m3", of: "kilns" } }), /`parts\.field` names a Dict of String to Float field — "m3" holds \.Float/);
        assert.throws(() => bins({ parts: { field: "kilns", of: "" } }), /`parts\.of` names the resource slot its keys are of/);
        assert.throws(() => bins({ hold: "m3" }), /`hold` names a TimeStep field — "m3" holds \.Float/);
        assert.throws(() => bins({ kind: "bay" }), /`kind` names an Option of a String field — "bay" holds \.String/);
    });

    test("an hours accessor returning another type than a Float", () => {
        assert.throws(() => duties({ shift: "shift", group: "team", hours: (d: { note: unknown }) => d.note }, "none"),
            /`hours` returns a Float, the hours a duty counts — and this one returns \.String/);
    });

    test("roles of both the Roster and the Allocation on one kind", () => {
        assert.throws(() => duties({ shift: "shift", group: "team", arrival: "task" }, "none"),
            /holds roles of both the Roster \(shift, group\) and the Allocation \(arrival\)/);
    });

    test("two of a builder's roles naming one field", () => {
        assert.throws(() => duties({ shift: "shift", group: "shift", resource: { field: "who", of: { staff: "people", agency: "agencies" } } }),
            /`shift` and `group` both name "shift" — the Roster writes each of its roles into a field of its own/);
        assert.throws(() => bins({ kind: "load" }), /`arrival` and `kind` both name "load" — the Allocation writes each of its roles into a field of its own/);
    });

    test("the Roster refuses a kind with no shift or group, an instant kind, Option times, and keys that are not Strings", () => {
        assert.throws(() => duties({ group: "team" }), /the Roster places a duty by its `shift` and its `group` — give both/);
        assert.throws(() => East.function([], NullType, ($) => {
            const bound = $.let(Record.bind(dutiesRecord, [dutiesPatch]));
            Schedule.events(bound as never, { name: "Duty", icon: "i", at: "start", shift: "shift", group: "team" } as never).buildRoster("duty");
        }), /the Roster reads a duty's `start` and `end`; this kind is one instant \(`at`\)/);
        const optional = e3.record("builders_spec_optional", DictType(StringType, StructType({ start: OptionType(DateTimeType), end: OptionType(DateTimeType), shift: StringType, team: StringType })), new Map());
        assert.throws(() => East.function([], NullType, ($) => {
            const bound = $.let(Record.bind(optional, [e3.mutation.patch(optional)]));
            Schedule.events(bound as never, { name: "Duty", icon: "i", start: "start", end: "end", shift: "shift", group: "team" } as never).buildRoster("duty");
        }), /a duty has its times — `start` and `end` are DateTime fields, not Options/);
        const byNumber = e3.record("builders_spec_numbered", DictType(IntegerType, PlainDutyType), new Map());
        assert.throws(() => East.function([], NullType, ($) => {
            const bound = $.let(Record.bind(byNumber, [e3.mutation.patch(byNumber)]));
            Schedule.events(bound as never, { name: "Duty", icon: "i", start: "start", end: "end", shift: "shift", group: "team" } as never).buildRoster("duty");
        }), /the Roster's duties are keyed by String — a duty is named by its key, and this record is keyed by \.Integer/);
        assert.throws(() => duties({ shift: "shift", group: "team" }), /the Roster rosters each duty to a person or an agency, its `resource` — give it/);
    });

    test("the Allocation refuses a span kind, a missing role, keys that are not Strings, and a lane that is no String key", () => {
        assert.throws(() => duties({}, "allocation"), /the Allocation's bins are an instant kind: give `at` in place of `start` and `end`/);
        assert.throws(() => bins({ arrival: undefined }), /the Allocation books a bin's `arrival` — give it/);
        assert.throws(() => bins({ parts: undefined }), /the Allocation allocates a bin's `parts` — give it/);
        assert.throws(() => bins({ hold: undefined }), /the Allocation holds a bin for its `hold` — give it/);
        assert.throws(() => bins({ quantity: undefined }), /the Allocation reads a bin's `quantity` — give it/);
        assert.throws(() => bins({ resource: undefined }), /the Allocation books a bin into a lane, its `resource` — give it/);
        const byNumber = e3.record("builders_spec_bins_numbered", DictType(IntegerType, BinType), new Map());
        const VariantLaneType = StructType({ ...BinType.fields, bay: VariantType({ bay: StringType, dock: StringType }) });
        const variantLane = e3.record("builders_spec_bins_variant_lane", DictType(StringType, VariantLaneType), new Map());
        const OptionLaneType = StructType({ ...BinType.fields, bay: OptionType(StringType) });
        const optionLane = e3.record("builders_spec_bins_option_lane", DictType(StringType, OptionLaneType), new Map());
        const binsOver = (record: unknown, of: unknown) => East.function([], NullType, ($) => {
            const def = record as typeof binsRecord;
            const bound = $.let(Record.bind(def, [e3.mutation.patch(def)]));
            Schedule.events(bound as never, {
                name: "Bin", icon: "i", at: "at", resource: { field: "bay", of }, arrival: "load", quantity: { field: "m3" },
                parts: { field: "kilns", of: "kilns" }, hold: "dryFor",
            } as never).buildAllocation("bin");
        });
        assert.throws(() => binsOver(byNumber, "bays"), /the Allocation's bins are keyed by String — a bin is named by its key, and this record is keyed by \.Integer/);
        assert.throws(() => binsOver(variantLane, { bay: "bays", dock: "docks" }),
            /the Allocation books each bin into one lane — `resource` names a String field, a key of the lanes' kind, and "bay" holds \.Variant/);
        assert.throws(() => binsOver(optionLane, "bays"),
            /the Allocation books each bin into one lane — `resource` names a String field, a key of the lanes' kind, and "bay" holds an Option of \.String/);
    });
});

// ============================================================================
// An optional title, which the Calendar and Plan require (B3)
// ============================================================================

describe("Schedule.events — `title` is optional, and the Calendar and Plan require it (B3)", () => {
    test("a kind with no title builds, its events titled with nothing", () => {
        const kind = East.compile(East.function([], Schedule.Types.Kind, ($) => {
            const duties = $.let(Record.bind(plainDutiesRecord, [plainDutiesPatch]));
            return Schedule.events(duties, { name: "Duty", icon: "i", start: "start", end: "end" }).build("duty");
        }), PLATFORM)();
        const items = kind.items(at("2027-03-08T00:00:00Z"), at("2027-03-09T00:00:00Z"), new SortedMap([], byString));
        if (items.type !== "some") assert.fail("expected the items");
        assert.deepEqual(items.value.map((i) => [i.key, i.title]), [["p1", ""]]);
    });

    test("the Calendar and Plan refuse a kind with no title, naming its slot", () => {
        assert.throws(() => East.function([], CalendarPayloadType, ($) => {
            const duties = $.let(Record.bind(plainDutiesRecord, [plainDutiesPatch]));
            return createCalendarPayload({ events: { duty: Schedule.events(duties, { name: "Duty", icon: "i", start: "start", end: "end" }) } });
        }), /Calendar: events\.duty has no title — the Calendar draws each event's title: give the kind a `title`/);
        assert.throws(() => East.function([], PlanPayloadType, ($) => {
            const duties = $.let(Record.bind(plainDutiesRecord, [plainDutiesPatch]));
            const axis = $.let(Plan.axis({ window: { min: at("2027-03-01T00:00:00Z"), max: at("2027-04-01T00:00:00Z") }, resolution: "day" }));
            return Plan.Payload({ axis, events: { duty: Schedule.events(duties, { name: "Duty", icon: "i", start: "start", end: "end" }) } });
        }), /Plan: events\.duty has no title — the Plan draws each event's title: give the kind a `title`/);
    });
});

// ============================================================================
// The builders' accessors on Schedule.resources
// ============================================================================

describe("Schedule.resources — the builders' accessors", () => {
    const PersonType = StructType({ name: StringType, team: StringType, position: StringType, skills: SetType(StringType), contract: FloatType });
    const KilnType = StructType({ name: StringType, group: StringType, min: FloatType, max: FloatType, days: FloatType });
    const PEOPLE = new SortedMap([["w-01", { name: "Ada Brook", team: "inbound", position: "lead", skills: new SortedSet(["unloading"], byString), contract: 38 }]], byString);
    const KILNS = new SortedMap([["K-109", { name: "K-109", group: "Hall A", min: 12, max: 24, days: 9 }]], byString);

    test("reifies each accessor once, each callable over a row and its key", () => {
        const read = East.compile(East.function([], StructType({ group: StringType, skills: SetType(StringType), contract: FloatType, max: FloatType, hold: TimeStepType }), ($) => {
            const people = Schedule.resources($.const(PEOPLE, DictType(StringType, PersonType)), {
                name: "People", icon: "user", label: (p) => p.name, group: (p) => p.team, position: (p) => p.position, skills: (p) => p.skills, contract: (p) => p.contract,
            });
            const kilns = Schedule.resources($.const(KILNS, DictType(StringType, KilnType)), {
                name: "Kilns", icon: "fire", label: (k) => k.name, min: (k) => k.min, max: (k) => k.max, hold: (k) => variant("days", k.days),
            });
            const person = $.const(PEOPLE.get("w-01")!, PersonType);
            const kiln = $.const(KILNS.get("K-109")!, KilnType);
            const group = $.const(people.accessors.group!);
            const skills = $.const(people.accessors.skills!);
            const contract = $.const(people.accessors.contract!);
            const max = $.const(kilns.accessors.max!);
            const hold = $.const(kilns.accessors.hold!);
            return {
                group: group(person as never, "w-01" as never), skills: skills(person as never, "w-01" as never), contract: contract(person as never, "w-01" as never),
                max: max(kiln as never, "K-109" as never), hold: hold(kiln as never, "K-109" as never),
            };
        }), [])();
        assert.equal(read.group, "inbound");
        assert.ok(equalFor(SetType(StringType))(read.skills, new SortedSet(["unloading"], byString)));
        assert.deepEqual([read.contract, read.max], [38, 24]);
        assert.ok(equalFor(TimeStepType)(read.hold, variant("days", 9)));
    });

    test("refuses an accessor returning another type, naming what it returns", () => {
        assert.throws(() => East.function([], NullType, ($) => {
            Schedule.resources($.const(PEOPLE, DictType(StringType, PersonType)) as never, {
                name: "People", icon: "user", label: (p: never) => (p as { name: unknown }).name, contract: (p: never) => (p as { name: unknown }).name,
            } as never);
        }), /Schedule\.resources: "People": `contract` returns a Float/);
    });
});

// ============================================================================
// Schedule.periods
// ============================================================================

describe("Schedule.periods — what a builder publishes", () => {
    const ISSUED = at("2027-03-12T08:30:00Z");

    test("reads each period's status: its draft case, its published case and when, or another case by its name", () => {
        assert.ok(statusEqual(weekPeriods.status(encodeWeek(ROTA_WEEKS.get(at("2027-03-14T00:00:00Z"))!)), variant("draft", null)));
        assert.ok(statusEqual(weekPeriods.status(encodeWeek(WEEK)), variant("published", { at: some(at("2027-03-05T09:00:00Z")) })));
        assert.ok(statusEqual(dayPeriods.status(encodeBeast2For(YardDayType)({ state: variant("issued", null), notes: "" })), variant("published", { at: none })),
            "a published case holding nothing says no time");
        assert.ok(statusEqual(weekPeriods.status(encodeWeek(ROTA_WEEKS.get(at("2027-03-21T00:00:00Z"))!)), variant("other", "cancelled")));
        assert.equal(weekPeriods.every.type, "week");
        assert.equal(dayPeriods.every.type, "day");
    });

    test("publishes a period: its status the published case at the time given, its own fields as they were", () => {
        const draft = ROTA_WEEKS.get(at("2027-03-14T00:00:00Z"))!;
        assert.ok(weekEqual(decodeWeek(weekPeriods.publish(some(encodeWeek({ ...draft, approver: some("Ops") })), ISSUED)),
            { ...draft, approver: some("Ops"), state: variant("issued", { at: ISSUED }) }));
        const days = decodeBeast2For(YardDayType);
        assert.ok(equalFor(YardDayType)(days(dayPeriods.publish(some(encodeBeast2For(YardDayType)({ state: variant("draft", null), notes: "wet" })), ISSUED)),
            { state: variant("issued", null), notes: "wet" }), "a published case holding nothing");
    });

    test("creates a period's row when it has none: the published or the draft case, every other field its type's default", () => {
        assert.ok(weekEqual(decodeWeek(weekPeriods.publish(none, ISSUED)),
            { state: variant("issued", { at: ISSUED }), dismissed: new SortedSet([], byString), approver: none }));
        assert.ok(weekEqual(decodeWeek(weekPeriods.dismiss(none, new SortedSet(["pr-7"], byString))),
            { state: variant("open", null), dismissed: new SortedSet(["pr-7"], byString), approver: none }));
    });

    test("reads and writes the proposals a week dismissed; a builder with no `dismissed` has none to read", () => {
        assert.equal(weekPeriods.dismissible, true);
        assert.ok(equalFor(SetType(StringType))(weekPeriods.dismissed(encodeWeek(WEEK)), new SortedSet(["pr-1"], byString)));
        assert.ok(weekEqual(decodeWeek(weekPeriods.dismiss(some(encodeWeek(WEEK)), new SortedSet(["pr-1", "pr-2"], byString))),
            { ...WEEK, dismissed: new SortedSet(["pr-1", "pr-2"], byString) }));
        assert.equal(dayPeriods.dismissible, false);
        assert.equal(dayPeriods.dismissed(encodeBeast2For(YardDayType)({ state: variant("draft", null), notes: "" })).size, 0);
    });

    test("reads the periods starting in [from, to) by their start, the record read whole", () => {
        const rows = weekPeriods.rows(at("2027-03-07T00:00:00Z"), at("2027-03-21T00:00:00Z"));
        if (rows.type !== "some") assert.fail("expected the periods");
        assert.ok(equalFor(ArrayType(DateTimeType))([...rows.value.keys()], [at("2027-03-07T00:00:00Z"), at("2027-03-14T00:00:00Z")]),
            "the week of the 21st starts at the span's end");
        assert.ok(weekEqual(decodeWeek(rows.value.get(at("2027-03-07T00:00:00Z"))!), WEEK));
    });

    test("keeps a session over the record: whole entries by their start, Saved through its patch door", async () => {
        const editing = weekPeriods.editing;
        assert.equal(editing.sourceId, "builders_spec_weeks");
        if (editing.snapshot.type !== "some") assert.fail("expected the record as the snapshot");
        assert.ok(equalFor(RotaWeeks)(decodeBeast2For(RotaWeeks)(editing.snapshot.value), ROTA_WEEKS));
        const apply = editing.onApply;
        if (apply.type !== "some" || apply.value.type !== "async") assert.fail("expected an async Apply");
        // A period is named by its start's text, as East prints it.
        const batch = encodeBeast2For(Editing.Types.ChangeSet(RotaWeekType, DateTimeType))({
            requestId: "publish-w11", base: variant("revision", "state-0"), label: "Publish week",
            changes: [{ id: printFor(DateTimeType)(at("2027-03-14T00:00:00Z")), patch: variant("replace", { before: some(ROTA_WEEKS.get(at("2027-03-14T00:00:00Z"))!),
                after: some({ ...ROTA_WEEKS.get(at("2027-03-14T00:00:00Z"))!, state: variant("issued", { at: ISSUED }) }) }), place: none }],
        } as never);
        assert.ok(equalFor(Editing.Types.ApplyResult)(await apply.value.value(batch), variant("applied", { revision: some("state-1") })));
    });

    test("refuses a record not keyed by DateTime, a status that is no variant or an Option, cases it lacks, a published case holding more, and dismissals of another type", () => {
        const refused = (record: unknown, config: object) => East.function([], NullType, ($) => {
            const def = record as typeof weeksRecord;
            const bound = $.let(Record.bind(def, [e3.mutation.patch(def)]));
            Schedule.periods(bound as never, config as never);
        });
        const status = { field: "state", draft: "open", published: "issued" };
        const byString_ = e3.record("builders_spec_weeks_by_string", DictType(StringType, RotaWeekType), new Map());
        assert.throws(() => refused(byString_, { every: "week", status }), /a period's row is keyed by its start — a Dict keyed by DateTime/);
        assert.throws(() => refused(weeksRecord, { every: "month", status }), /`every` is "week" or "day"/);
        assert.throws(() => refused(weeksRecord, { every: "week", status: { ...status, field: "approver" } }),
            /`status\.field` names a variant field, not an Option — "approver" holds an Option of \.String/);
        assert.throws(() => refused(weeksRecord, { every: "week", status: { ...status, field: "dismissed" } }), /`status\.field` names a variant field/);
        assert.throws(() => refused(weeksRecord, { every: "week", status: { ...status, published: "sent" } }),
            /`status\.published` names a case of "state" \(cancelled, issued, open\) — and it names "sent"/);
        const Holding = e3.record("builders_spec_weeks_holding", DictType(DateTimeType, StructType({ state: VariantType({ open: NullType, issued: StructType({ at: DateTimeType, by: StringType }) }) })), new Map());
        assert.throws(() => refused(Holding, { every: "week", status }), /the published case "issued" holds Null or \{ at: DateTime \}/);
        assert.throws(() => refused(weeksRecord, { every: "week", status, dismissed: "approver" }), /`dismissed` names a Set of String field — "approver" holds an Option of \.String/);
    });
});

// ============================================================================
// Reads bounded to the period, never the record whole (B14)
// ============================================================================

describe("reads bounded to the period, the record never read whole (B14)", () => {
    /** The duties by the days each touches, as a large record's day index files them. */
    const dutiesByDay = e3.recordIndex("builders_spec_duties_by_day", dutiesRecord, {
        keys: East.function([StringType, DutyType], SetType(DateTimeType), ($, _id, duty) => {
            const days = $.const(Schedule.days);
            return days(duty.start, duty.end);
        }),
    });
    /** The day index's entries, as e3 builds them: its own key function over every duty, in its order. */
    const BY_DAY: MemoryIndexEntry[] = (() => {
        const keysOf = (dutiesByDay.keyFn.toIR() as EastIR<[StringType, typeof DutyType], SetType<DateTimeType>>).compile([]) as (key: string, duty: Duty) => ReadonlySet<Date>;
        const byDay = compareFor(DateTimeType);
        const entries: MemoryIndexEntry[] = [];
        for (const [key, duty] of DUTIES) for (const day of keysOf(key, duty)) entries.push({ ik: day, key, value: null, row: some(duty) });
        return entries.sort((a, b) => byDay(a.ik as Date, b.ik as Date) || byString(a.key as string, b.key as string));
    })();
    const wholeReads = new Map<string, number>();
    let askedDays: PagedAsked = { seeks: [], pages: [] };
    let askedWeeks: PagedAsked = { seeks: [], pages: [] };
    let holdDays: (what: "seek" | bigint) => boolean = () => false;
    let holdWeeks: (what: "seek" | bigint) => boolean = () => false;
    const fresh = (): void => {
        askedDays = { seeks: [], pages: [] };
        askedWeeks = { seeks: [], pages: [] };
        holdDays = () => false;
        holdWeeks = () => false;
        wholeReads.clear();
    };
    const PAGED = [
        ...memoryRecords(new Map<string, unknown>([["builders_spec_duties", DUTIES], ["builders_spec_weeks", ROTA_WEEKS]]), wholeReads),
        ...memoryPages(new Map<string, MemoryPagedSource>([
            [`${dutiesRecord.path.map((s) => s.value).join(".")}@${dutiesByDay.name}`,
                { entries: BY_DAY, keyType: DateTimeType, get asked() { return askedDays; }, held: (w) => holdDays(w) }],
            [dutiesRecord.path.map((s) => s.value).join("."), { entries: DUTIES, keyType: StringType, get asked() { return askedDays; } }],
            [weeksRecord.path.map((s) => s.value).join("."), { entries: ROTA_WEEKS, keyType: DateTimeType, get asked() { return askedWeeks; }, held: (w) => holdWeeks(w) }],
        ])),
    ];
    const printAt = printFor(DateTimeType);

    test("a duty kind read by its day index: its period's rows from the days in view alone, `none` in flight, the record never read whole", () => {
        fresh();
        const kind = East.compile(East.function([], Schedule.Types.RosterKind, ($) => {
            const duties = $.let(Record.bind(dutiesRecord, [dutiesPatch]));
            const days = $.let(Data.bindPaged(dutiesRecord, { index: dutiesByDay, join: true }));
            const entries = $.let(Data.bindPaged(dutiesRecord));
            return Schedule.events(duties, {
                name: "Duty", icon: "user-clock", start: "start", end: "end", resource: { field: "who", of: { staff: "people", agency: "agencies" } },
                shift: "shift", group: "team", window: days, entries,
            }).buildRoster("duty");
        }), PAGED)() as RosterKind;
        const rows = kind.rows(at("2027-03-07T00:00:00Z"), at("2027-03-14T00:00:00Z"));
        if (rows.type !== "some") assert.fail("expected the rows");
        assert.deepEqual([...rows.value.keys()], ["d1", "d2"], "d3 is filed under a later day");
        // The week's first midnight sought, and one page from the start of the page it is in: the entry past the week ends the read.
        assert.ok(equalFor(ArrayType(SeekQueryType))(askedDays.seeks, [variant("range", { from: [printAt(at("2027-03-07T00:00:00Z"))], to: [] })]));
        assert.deepEqual(askedDays.pages, [[0n, 256n]]);
        assert.equal(wholeReads.get("builders_spec_duties") ?? 0, 0, "the record is never read whole");
        // Its session is over the record's revision, with no snapshot of the record.
        assert.equal(kind.kind.editing.snapshot.type, "none");
        holdDays = (what) => what === "seek";
        assert.equal(kind.rows(at("2027-03-07T00:00:00Z"), at("2027-03-14T00:00:00Z")).type, "none", "in flight");
    });

    test("the periods read by key through `entries`: one key search and one page a span, `none` in flight, the record never read whole", () => {
        fresh();
        const periods = East.compile(East.function([], Schedule.Types.PeriodsKind, ($) => {
            const weeks = $.let(Record.bind(weeksRecord, [weeksPatch]));
            const entries = $.let(Data.bindPaged(weeksRecord));
            return Schedule.periods(weeks, { every: "week", status: { field: "state", draft: "open", published: "issued" }, dismissed: "dismissed", entries }).build();
        }), PAGED)() as Periods;
        const rows = periods.rows(at("2027-03-07T00:00:00Z"), at("2027-03-21T00:00:00Z"));
        if (rows.type !== "some") assert.fail("expected the periods");
        assert.ok(equalFor(ArrayType(DateTimeType))([...rows.value.keys()], [at("2027-03-07T00:00:00Z"), at("2027-03-14T00:00:00Z")]));
        assert.ok(weekEqual(decodeWeek(rows.value.get(at("2027-03-07T00:00:00Z"))!), WEEK));
        assert.ok(equalFor(ArrayType(SeekQueryType))(askedWeeks.seeks,
            [variant("range", { from: [printAt(at("2027-03-07T00:00:00Z"))], to: [printAt(at("2027-03-21T00:00:00Z"))] })]));
        assert.deepEqual(askedWeeks.pages, [[0n, 2n]], "the span's two periods, one page");
        assert.equal(wholeReads.get("builders_spec_weeks") ?? 0, 0, "the record is never read whole");
        assert.equal(periods.editing.snapshot.type, "none");
        assert.equal(periods.entries.type, "some");
        // A span holding no period: none read, and no page.
        askedWeeks = { seeks: [], pages: [] };
        const empty = periods.rows(at("2027-04-04T00:00:00Z"), at("2027-04-11T00:00:00Z"));
        assert.equal(empty.type === "some" ? empty.value.size : -1, 0);
        assert.deepEqual(askedWeeks.pages, []);
        holdWeeks = (what) => what === "seek";
        assert.equal(periods.rows(at("2027-03-07T00:00:00Z"), at("2027-03-21T00:00:00Z")).type, "none", "in flight");
    });
});

// ============================================================================
// What fails to compile: a role named against the record's row type
// ============================================================================

/** Never run: each line below must fail to compile, or the build fails on the unused directive. */
export function builderTypeChecks(): void {
    const duties = Record.bind(dutiesRecord, [dutiesPatch]);
    const bins = Record.bind(binsRecord, [binsPatch]);
    // @ts-expect-error — `shift` is a String field, and "unpaidBreak" is a Float one
    Schedule.events(duties, { name: "Duty", icon: "i", start: "start", end: "end", shift: "unpaidBreak" });
    // @ts-expect-error — `activity` is an Option of a String field, and "note" is a String one
    Schedule.events(duties, { name: "Duty", icon: "i", start: "start", end: "end", activity: "note" });
    // @ts-expect-error — `hold` is a TimeStep field, and "m3" is a Float one
    Schedule.events(bins, { name: "Bin", icon: "i", at: "at", hold: "m3" });
    // @ts-expect-error — `parts.field` is a Dict of String to Float field, and "m3" is a Float one
    Schedule.events(bins, { name: "Bin", icon: "i", at: "at", parts: { field: "m3", of: "kilns" } });
    // @ts-expect-error — `arrival` is an Option of a String field, and "bay" is a String one
    Schedule.events(bins, { name: "Bin", icon: "i", at: "at", arrival: "bay" });
    // @ts-expect-error — `status.published` names a case of the status field, and "sent" is none of them
    Schedule.periods(Record.bind(weeksRecord, [weeksPatch]), { every: "week", status: { field: "state", draft: "open", published: "sent" } });
}
