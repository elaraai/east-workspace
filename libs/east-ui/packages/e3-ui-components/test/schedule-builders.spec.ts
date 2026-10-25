/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Schedule's declarations for the builders that write the app's own records
 * (#1367, `Builder Interfaces Spec.md` §4) over Schedule's example records on
 * e3 itself (#1379): the Roster's and the Allocation's roles on
 * `Schedule.events`, read and written through a kind's `buildRoster` and
 * `buildAllocation`; an optional `title`; and `Schedule.periods`, what a
 * builder publishes. Each is built against the platform a UI task's preview
 * gives it, so the record it reads is e3's and an Apply commits through its
 * patch door; a record read a period at a time is paged by e3, its searches
 * and pages counted from the harness's request log, and never read whole
 * (B14).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, DateTimeType, East, OptionType, SetType, SortedMap, SortedSet, StringType, StructType, compareFor, decodeBeast2For, encodeBeast2For, equalFor,
    fromEastTypeValue, isTypeEqual, none, printFor, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import { Data, Record, Schedule } from "@elaraai/e3-ui/internal";
import { datasetGetStatus } from "@elaraai/e3-api-client";
import * as sx from "@elaraai/e3-ui/examples/schedule/schedule";
import type { E3Request } from "../src/e3-web.test-utils.js";
import { e3Spec } from "./fixtures/e3.js";

const h = e3Spec({ "schedule/schedule": sx });

/** An instant as its author writes it: UTC, with its zone. */
const at = (text: string): Date => new Date(text);
const byString = compareFor(StringType);

type RosterKind = ValueTypeOf<typeof Schedule.Types.RosterKind>;
type AllocationKind = ValueTypeOf<typeof Schedule.Types.AllocationKind>;
type Periods = ValueTypeOf<typeof Schedule.Types.PeriodsKind>;
type Kind = ValueTypeOf<typeof Schedule.Types.Kind>;

const encodeDuty = encodeBeast2For(sx.ScheduleDuty);
const decodeDuty = decodeBeast2For(sx.ScheduleDuty);
const dutyEqual = equalFor(sx.ScheduleDuty);
const encodeBin = encodeBeast2For(sx.ScheduleBin);
const decodeBin = decodeBeast2For(sx.ScheduleBin);
const binEqual = equalFor(sx.ScheduleBin);
const encodeWeek = encodeBeast2For(sx.ScheduleWeek);
const decodeWeek = decodeBeast2For(sx.ScheduleWeek);
const weekEqual = equalFor(sx.ScheduleWeek);
const rosterRolesEqual = equalFor(Schedule.Types.RosterRoles);
const allocationRolesEqual = equalFor(Schedule.Types.AllocationRoles);
const statusEqual = equalFor(Schedule.Types.PeriodStatus);

/** The warehouse's duty kind, every one of the Roster's roles mapped, its hours less the unpaid break. */
const dutyProgram = East.function([], Schedule.Types.RosterKind, ($) => {
    const duties = $.let(Record.bind(sx.scheduleDuties, [sx.scheduleDutiesPatch]));
    return Schedule.events(duties, {
        name: "Duty", icon: "user-clock",
        start: "start", end: "end", resource: { field: "who", of: { staff: "people", agency: "agencies" } },
        shift: "shift", group: "team", position: "role", activity: "task",
        hours: (d) => d.start.durationMinutes(d.end).subtract(d.unpaidBreak).divide(60.0),
    }).buildRoster("duty");
});

/** A duty kind with only the Roster's required roles: no title, no position, no activity, no hours accessor. */
const plainProgram = East.function([], Schedule.Types.RosterKind, ($) => {
    const duties = $.let(Record.bind(sx.schedulePlainDuties, [sx.schedulePlainDutiesPatch]));
    return Schedule.events(duties, {
        name: "Duty", icon: "user-clock", start: "start", end: "end", resource: { field: "person", of: "people" }, shift: "shift", group: "team",
    }).buildRoster("duty");
});

/** The yard's bin kind, every one of the Allocation's roles mapped. */
const binProgram = East.function([], Schedule.Types.AllocationKind, ($) => {
    const bins = $.let(Record.bind(sx.scheduleBins, [sx.scheduleBinsPatch]));
    return Schedule.events(bins, {
        name: "Bin", icon: "box", at: "at", resource: { field: "bay", of: "bays" }, arrival: "load",
        quantity: { field: "m3", unit: "m³" }, parts: { field: "kilns", of: "kilns" }, hold: "dryFor", kind: "spec",
    }).buildAllocation("bin");
});

/** The warehouse's weeks: its status mapped, and the proposals each dismissed. */
const weekProgram = East.function([], Schedule.Types.PeriodsKind, ($) => {
    const weeks = $.let(Record.bind(sx.scheduleWeeks, [sx.scheduleWeeksPatch]));
    return Schedule.periods(weeks, { every: "week", status: { field: "state", draft: "open", published: "issued" }, dismissed: "dismissed" }).build();
});

/** The yard's days: a published case holding nothing, and no dismissals. */
const dayProgram = East.function([], Schedule.Types.PeriodsKind, ($) => {
    const days = $.let(Record.bind(sx.scheduleDays, [sx.scheduleDaysPatch]));
    return Schedule.periods(days, { every: "day", status: { field: "state", draft: "draft", published: "issued" } }).build();
});

/** A Roster's duty kind built over e3, as a UI task's preview builds it. */
async function builtRoster(program: typeof dutyProgram): Promise<RosterKind> {
    const { platform } = await h.platform(program);
    return East.compile(program, platform)();
}
/** An Allocation's bin kind built over e3. */
async function builtAllocation(program: typeof binProgram): Promise<AllocationKind> {
    const { platform } = await h.platform(program);
    return East.compile(program, platform)();
}
/** A builder's periods built over e3. */
async function builtPeriods(program: typeof weekProgram): Promise<Periods> {
    const { platform } = await h.platform(program);
    return East.compile(program, platform)();
}
/** A duty as e3 holds it. */
const duty = async (key: string) => (await h.read(sx.scheduleDuties)).get(key)!;
/** A week as e3 holds it, by its start. */
const week = async (start: string) => (await h.read(sx.scheduleWeeks)).get(at(start))!;

// ============================================================================
// The Roster's roles
// ============================================================================

describe("Schedule.events — the Roster's roles (buildRoster)", () => {
    test("reads a duty's roles: its times, its person or agency, its shift and group, its position, its activity and its hours", async () => {
        const dutyKind = await builtRoster(dutyProgram);
        const [D1, D2] = [await duty("d1"), await duty("d2")];
        assert.ok(rosterRolesEqual(dutyKind.read(encodeDuty(D1), "d1"), {
            start: D1.start, end: D1.end, resource: some({ kind: "people", key: "w-01" }),
            shift: "early", group: "inbound", position: some("lead"), activity: some("unloading"), hours: 9.5,
        }));
        const agency = dutyKind.read(encodeDuty(D2), "d2");
        assert.ok(equalFor(OptionType(Schedule.Types.ResourceRef))(agency.resource, some({ kind: "agencies", key: "a-1" })), "an agency's request, by the variant's case");
        assert.equal(agency.hours, 8, "the hours accessor reads the row");
        assert.deepEqual([dutyKind.roles.position, dutyKind.roles.activity], [true, true]);
    });

    test("writes a duty's roles, and every other field of the row reads back as it was (B1)", async () => {
        const dutyKind = await builtRoster(dutyProgram);
        const D1 = await duty("d1");
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

    test("creates a new duty from its roles: every other field its type's default", async () => {
        const created = (await builtRoster(dutyProgram)).create({
            start: at("2027-03-10T06:00:00Z"), end: at("2027-03-10T14:00:00Z"), resource: some({ kind: "people", key: "w-03" }),
            shift: "early", group: "inbound", position: some("crew"), activity: none, hours: 0,
        });
        if (created.type !== "some") assert.fail("expected the duty created");
        assert.ok(dutyEqual(decodeDuty(created.value), {
            who: variant("staff", "w-03"), start: at("2027-03-10T06:00:00Z"), end: at("2027-03-10T14:00:00Z"),
            shift: "early", team: "inbound", role: "crew", task: none, unpaidBreak: 0, costCentre: "", note: "",
        }));
    });

    test("a kind without the optional roles reads none for them, and counts a duty's length in hours", async () => {
        const plainKind = await builtRoster(plainProgram);
        const rows = plainKind.rows(at("2027-03-07T00:00:00Z"), at("2027-03-14T00:00:00Z"));
        if (rows.type !== "some") assert.fail("expected the rows");
        const roles = rows.value.get("p1")!.roles;
        assert.deepEqual([roles.position.type, roles.activity.type, roles.hours], ["none", "none", 8]);
        assert.deepEqual([plainKind.roles.position, plainKind.roles.activity], [false, false]);
    });

    test("reads the rows overlapping [from, to) by key, each its roles beside its row, from a record no source narrows", async () => {
        const dutyKind = await builtRoster(dutyProgram);
        const D1 = await duty("d1");
        const rows = dutyKind.rows(at("2027-03-07T00:00:00Z"), at("2027-03-14T00:00:00Z"));
        if (rows.type !== "some") assert.fail("expected the rows");
        assert.deepEqual([...rows.value.keys()], ["d1", "d2"], "d3 is a later week's");
        const d1 = rows.value.get("d1")!;
        assert.ok(dutyEqual(decodeDuty(d1.row), D1));
        assert.ok(rosterRolesEqual(d1.roles, dutyKind.read(encodeDuty(D1), "d1")), "the pass that reads the row reads its roles as `read` does");
        assert.ok(isTypeEqual(fromEastTypeValue(dutyKind.rowType), sx.ScheduleDuty));
    });

    test("carries the kind's session over the record: its patch door, and its form over the fields no role writes", async () => {
        const dutyKind = await builtRoster(dutyProgram);
        assert.equal(dutyKind.kind.editing.sourceId, "schedule_duties");
        assert.deepEqual(dutyKind.kind.fields.map((f) => f.path.join(".")), ["unpaidBreak", "costCentre", "note"]);
    });
});

// ============================================================================
// The Allocation's roles
// ============================================================================

describe("Schedule.events — the Allocation's roles (buildAllocation)", () => {
    const bin = async () => (await h.read(sx.scheduleBins)).get("3103")!;

    test("reads a bin's roles: its time, lane, arrival, quantity, parts, hold and kind", async () => {
        const binKind = await builtAllocation(binProgram);
        const B1 = await bin();
        assert.ok(allocationRolesEqual(binKind.read(encodeBin(B1)), {
            at: B1.at, lane: "B-1", arrival: some("LD-2203"), quantity: 24, parts: new SortedMap([["K-109", 24]], byString),
            hold: variant("days", 9), kind: some("MC14"),
        }));
        assert.deepEqual([binKind.lanes, binKind.parts, binKind.kinded], ["bays", "kilns", true]);
        assert.ok(equalFor(OptionType(StringType))(binKind.unit, some("m³")), "the quantity's unit, its role's");
    });

    test("writes a bin's roles, and the yard's own fields read back as they were (B1)", async () => {
        const binKind = await builtAllocation(binProgram);
        const B1 = await bin();
        const moved = binKind.write(encodeBin(B1), {
            at: at("2027-05-11T06:35:00Z"), lane: "B-2", arrival: some("LD-2203"), quantity: 24,
            parts: new SortedMap([["K-109", 12], ["K-110", 12]], byString), hold: variant("days", 9), kind: some("MC14"),
        });
        assert.ok(binEqual(decodeBin(moved), { ...B1, bay: "B-2", at: at("2027-05-11T06:35:00Z"), kilns: new SortedMap([["K-109", 12], ["K-110", 12]], byString) }));
    });

    test("books a new bin from its roles and an arrival's values; a reservation's own fields are their type's default (B13)", async () => {
        const binKind = await builtAllocation(binProgram);
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

    test("names the fields no role maps: what an arrival's values give a booked bin", async () => {
        const binKind = await builtAllocation(binProgram);
        assert.ok(isTypeEqual(fromEastTypeValue(binKind.values), StructType({ specMeasured: StringType, instruction: OptionType(StringType) })));
    });

    test("reads the bins of [from, to) by their time, each its roles beside its row", async () => {
        const binKind = await builtAllocation(binProgram);
        const B1 = await bin();
        const rows = binKind.rows(at("2027-05-11T00:00:00Z"), at("2027-05-12T00:00:00Z"));
        if (rows.type !== "some") assert.fail("expected the rows");
        assert.deepEqual([...rows.value.keys()], ["3103"]);
        const read = rows.value.get("3103")!;
        assert.ok(binEqual(decodeBin(read.row), B1));
        assert.ok(allocationRolesEqual(read.roles, binKind.read(encodeBin(B1))));
        const none_ = binKind.rows(at("2027-05-12T00:00:00Z"), at("2027-05-13T00:00:00Z"));
        if (none_.type !== "some") assert.fail("expected the rows");
        assert.equal(none_.value.size, 0);
    });
});

// ============================================================================
// An optional title (B3)
// ============================================================================

describe("Schedule.events — `title` is optional (B3)", () => {
    test("a kind with no title builds, its events titled with nothing", async () => {
        const program = East.function([], Schedule.Types.Kind, ($) => {
            const duties = $.let(Record.bind(sx.schedulePlainDuties, [sx.schedulePlainDutiesPatch]));
            return Schedule.events(duties, { name: "Duty", icon: "i", start: "start", end: "end" }).build("duty");
        });
        const { platform } = await h.platform(program);
        const kind: Kind = East.compile(program, platform)();
        const items = kind.items(at("2027-03-08T00:00:00Z"), at("2027-03-09T00:00:00Z"), new SortedMap([], byString));
        if (items.type !== "some") assert.fail("expected the items");
        assert.deepEqual(items.value.map((i) => [i.key, i.title]), [["p1", ""]]);
    });
});

// ============================================================================
// Schedule.periods
// ============================================================================

describe("Schedule.periods — what a builder publishes", () => {
    const ISSUED = at("2027-03-12T08:30:00Z");

    test("reads each period's status: its draft case, its published case and when, or another case by its name", async () => {
        const [weekPeriods, dayPeriods] = [await builtPeriods(weekProgram), await builtPeriods(dayProgram)];
        assert.ok(statusEqual(weekPeriods.status(encodeWeek(await week("2027-03-14T00:00:00Z"))), variant("draft", null)));
        assert.ok(statusEqual(weekPeriods.status(encodeWeek(await week("2027-03-07T00:00:00Z"))), variant("published", { at: some(at("2027-03-05T09:00:00Z")) })));
        assert.ok(statusEqual(dayPeriods.status(encodeBeast2For(sx.ScheduleDay)({ state: variant("issued", null), notes: "" })), variant("published", { at: none })),
            "a published case holding nothing says no time");
        assert.ok(statusEqual(weekPeriods.status(encodeWeek(await week("2027-03-21T00:00:00Z"))), variant("other", "cancelled")));
        assert.equal(weekPeriods.every.type, "week");
        assert.equal(dayPeriods.every.type, "day");
    });

    test("publishes a period: its status the published case at the time given, its own fields as they were", async () => {
        const [weekPeriods, dayPeriods] = [await builtPeriods(weekProgram), await builtPeriods(dayProgram)];
        const draft = await week("2027-03-14T00:00:00Z");
        assert.ok(weekEqual(decodeWeek(weekPeriods.publish(some(encodeWeek({ ...draft, approver: some("Ops") })), ISSUED)),
            { ...draft, approver: some("Ops"), state: variant("issued", { at: ISSUED }) }));
        const days = decodeBeast2For(sx.ScheduleDay);
        assert.ok(equalFor(sx.ScheduleDay)(days(dayPeriods.publish(some(encodeBeast2For(sx.ScheduleDay)({ state: variant("draft", null), notes: "wet" })), ISSUED)),
            { state: variant("issued", null), notes: "wet" }), "a published case holding nothing");
    });

    test("creates a period's row when it has none: the published or the draft case, every other field its type's default", async () => {
        const weekPeriods = await builtPeriods(weekProgram);
        assert.ok(weekEqual(decodeWeek(weekPeriods.publish(none, ISSUED)),
            { state: variant("issued", { at: ISSUED }), dismissed: new SortedSet([], byString), approver: none }));
        assert.ok(weekEqual(decodeWeek(weekPeriods.dismiss(none, new SortedSet(["pr-7"], byString))),
            { state: variant("open", null), dismissed: new SortedSet(["pr-7"], byString), approver: none }));
    });

    test("reads and writes the proposals a week dismissed; a builder with no `dismissed` has none to read", async () => {
        const [weekPeriods, dayPeriods] = [await builtPeriods(weekProgram), await builtPeriods(dayProgram)];
        const issued = await week("2027-03-07T00:00:00Z");
        assert.equal(weekPeriods.dismissible, true);
        assert.ok(equalFor(SetType(StringType))(weekPeriods.dismissed(encodeWeek(issued)), new SortedSet(["pr-1"], byString)));
        assert.ok(weekEqual(decodeWeek(weekPeriods.dismiss(some(encodeWeek(issued)), new SortedSet(["pr-1", "pr-2"], byString))),
            { ...issued, dismissed: new SortedSet(["pr-1", "pr-2"], byString) }));
        assert.equal(dayPeriods.dismissible, false);
        assert.equal(dayPeriods.dismissed(encodeBeast2For(sx.ScheduleDay)({ state: variant("draft", null), notes: "" })).size, 0);
    });

    test("reads the periods starting in [from, to) by their start, the record read whole", async () => {
        const weekPeriods = await builtPeriods(weekProgram);
        const rows = weekPeriods.rows(at("2027-03-07T00:00:00Z"), at("2027-03-21T00:00:00Z"));
        if (rows.type !== "some") assert.fail("expected the periods");
        assert.ok(equalFor(ArrayType(DateTimeType))([...rows.value.keys()], [at("2027-03-07T00:00:00Z"), at("2027-03-14T00:00:00Z")]),
            "the week of the 21st starts at the span's end");
        assert.ok(weekEqual(decodeWeek(rows.value.get(at("2027-03-07T00:00:00Z"))!), await week("2027-03-07T00:00:00Z")));
    });

    test("keeps a session over the record: whole entries by their start, Saved through its patch door at the state it writes", async () => {
        const editing = (await builtPeriods(weekProgram)).editing;
        const weeks = await h.read(sx.scheduleWeeks);
        assert.equal(editing.sourceId, "schedule_weeks");
        if (editing.snapshot.type !== "some") assert.fail("expected the record as the snapshot");
        assert.ok(equalFor(sx.scheduleWeeks.type)(decodeBeast2For(sx.scheduleWeeks.type)(editing.snapshot.value), weeks), "the snapshot is what e3 holds");
        const apply = editing.onApply;
        if (apply.type !== "some" || apply.value.type !== "async") assert.fail("expected an async Apply");
        // A period is named by its start's text, as East prints it.
        const open = weeks.get(at("2027-03-14T00:00:00Z"))!;
        const batch = encodeBeast2For(Editing.Types.ChangeSet(sx.ScheduleWeek, DateTimeType))({
            requestId: "publish-w11", base: variant("revision", "state-0"), label: "Publish week",
            changes: [{ id: printFor(DateTimeType)(at("2027-03-14T00:00:00Z")), patch: variant("replace", { before: some(open),
                after: some({ ...open, state: variant("issued", { at: ISSUED }) }) }), place: none }],
        } as never);
        const result = await apply.value.value(batch);
        const status = await datasetGetStatus(h.e3.apiUrl, h.e3.repo, h.workspace, sx.scheduleWeeks.path, h.e3.direct);
        assert.equal(status.hash.type, "some");
        assert.ok(equalFor(Editing.Types.ApplyResult)(result, variant("applied", { revision: some(status.hash.value!) })), "applied at the state e3 holds now");
        assert.ok(weekEqual((await h.read(sx.scheduleWeeks)).get(at("2027-03-14T00:00:00Z"))!, { ...open, state: variant("issued", { at: ISSUED }) }), "the commit is e3's");
    });
});

// ============================================================================
// Reads bounded to the period, never the record whole (B14)
// ============================================================================

describe("reads bounded to the period, the record never read whole (B14)", () => {
    const printAt = printFor(DateTimeType);
    /** Whether a request searches, or pages, a record — through one of its indexes, or its own entries when none is named. */
    const finds = (record: string, index?: string) => (request: E3Request) =>
        request.kind === "find" && request.dataset === `records.${record}` && (request.query.get("index") ?? undefined) === index;
    const pages = (record: string, index?: string) => (request: E3Request) =>
        request.kind === "page" && request.dataset === `records.${record}` && (request.query.get("index") ?? undefined) === index;

    test("a duty kind read by its day index: its period's rows from the days in view alone, `none` in flight, the record never read whole", async () => {
        const program = East.function([], Schedule.Types.RosterKind, ($) => {
            const duties = $.let(Record.bind(sx.scheduleDuties, [sx.scheduleDutiesPatch]));
            const days = $.let(Data.bindPaged(sx.scheduleDuties, { index: sx.scheduleDutiesByDay, join: true }));
            const entries = $.let(Data.bindPaged(sx.scheduleDuties));
            return Schedule.events(duties, {
                name: "Duty", icon: "user-clock", start: "start", end: "end", resource: { field: "who", of: { staff: "people", agency: "agencies" } },
                shift: "shift", group: "team", window: days, entries,
            }).buildRoster("duty");
        });
        const kind: RosterKind = East.compile(program, (await h.platform(program)).platform)();
        const read = (from: string, to: string) => h.ready(() => kind.rows(at(from), at(to)));
        const rows = await read("2027-03-07T00:00:00Z", "2027-03-14T00:00:00Z");
        assert.deepEqual([...rows.keys()], ["d1", "d2"], "d3 is filed under a later day");
        // The week's days sought, from its first midnight to its end, and one page from the start of the page they start in:
        // the entry past the week ends the read.
        const byDay = sx.scheduleDutiesByDay.name;
        assert.deepEqual(h.requests().filter(finds("schedule_duties", byDay)).map((request) => [request.query.getAll("from"), request.query.getAll("to")]),
            [[[printAt(at("2027-03-07T00:00:00Z"))], [printAt(at("2027-03-14T00:00:00Z"))]]]);
        assert.deepEqual(h.requests().filter(pages("schedule_duties", byDay)).map((request) => [request.query.get("offset"), request.query.get("limit")]), [["0", "256"]]);
        assert.equal(h.requests("read", "records.schedule_duties").length, 0, "the record is never read whole");
        // Its session is over the record's revision, with no snapshot of the record.
        assert.equal(kind.kind.editing.snapshot.type, "none");
        // A period whose search is held on its way to e3 is in flight, and its rows land once it goes on.
        const held = h.e3.hold(finds("schedule_duties", byDay));
        assert.equal((await h.inFlight(() => kind.rows(at("2027-03-14T00:00:00Z"), at("2027-03-21T00:00:00Z")), held)).type, "none", "in flight");
        held.release();
        assert.deepEqual([...(await read("2027-03-14T00:00:00Z", "2027-03-21T00:00:00Z")).keys()], ["d3"]);
    });

    test("the periods read by key through `entries`: one key search and one page a span, `none` in flight, the record never read whole", async () => {
        const program = East.function([], Schedule.Types.PeriodsKind, ($) => {
            const weeks = $.let(Record.bind(sx.scheduleWeeks, [sx.scheduleWeeksPatch]));
            const entries = $.let(Data.bindPaged(sx.scheduleWeeks));
            return Schedule.periods(weeks, { every: "week", status: { field: "state", draft: "open", published: "issued" }, dismissed: "dismissed", entries }).build();
        });
        const periods: Periods = East.compile(program, (await h.platform(program)).platform)();
        const read = (from: string, to: string) => h.ready(() => periods.rows(at(from), at(to)));
        const rows = await read("2027-03-07T00:00:00Z", "2027-03-21T00:00:00Z");
        assert.ok(equalFor(ArrayType(DateTimeType))([...rows.keys()], [at("2027-03-07T00:00:00Z"), at("2027-03-14T00:00:00Z")]));
        assert.ok(weekEqual(decodeWeek(rows.get(at("2027-03-07T00:00:00Z"))!), await week("2027-03-07T00:00:00Z")));
        assert.deepEqual(h.requests().filter(finds("schedule_weeks")).map((request) => [request.query.getAll("from"), request.query.getAll("to")]),
            [[[printAt(at("2027-03-07T00:00:00Z"))], [printAt(at("2027-03-21T00:00:00Z"))]]]);
        assert.deepEqual(h.requests().filter(pages("schedule_weeks")).map((request) => [request.query.get("offset"), request.query.get("limit")]), [["0", "2"]],
            "the span's two periods, one page");
        assert.equal(h.requests("read", "records.schedule_weeks").length, 0, "the record is never read whole");
        assert.equal(periods.editing.snapshot.type, "none");
        assert.equal(periods.entries.type, "some");
        // A span holding no period: none read, and no page.
        const paged = h.requests().filter(pages("schedule_weeks")).length;
        const empty = await read("2027-04-04T00:00:00Z", "2027-04-11T00:00:00Z");
        assert.equal(empty.size, 0);
        assert.equal(h.requests().filter(pages("schedule_weeks")).length, paged, "no page of a span holding none");
        // A span whose search is held on its way to e3 is in flight, and its periods land once it goes on.
        const held = h.e3.hold(finds("schedule_weeks"));
        assert.equal((await h.inFlight(() => periods.rows(at("2027-03-14T00:00:00Z"), at("2027-03-28T00:00:00Z")), held)).type, "none", "in flight");
        held.release();
        assert.ok(equalFor(ArrayType(DateTimeType))([...(await read("2027-03-14T00:00:00Z", "2027-03-28T00:00:00Z")).keys()],
            [at("2027-03-14T00:00:00Z"), at("2027-03-21T00:00:00Z")]));
    });
});
