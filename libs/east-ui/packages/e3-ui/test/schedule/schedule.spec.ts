/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Schedule` (#1218): the event and resource kinds the Calendar and Plan's
 * builder share — what is checked of them without e3. A kind is built over
 * its record, which it reads as it builds, so its seams — its events over a
 * window, its backlog, a gesture written into an entry, the author's check,
 * its editing wire and its Apply — run in e3-ui-components on e3 itself
 * (`test/schedule-kinds.spec.ts`), over Schedule's records
 * (`schedule.examples.tsx`). Here: a resource kind over rows in hand, the day
 * index's keys (East functions, so a `describeEast` suite), the checks a
 * builder makes across its slots, every refusal at build, and what fails to
 * compile.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    DateTimeType, DictType, East, IntegerType, NullType, OptionType, SortedMap, SortedSet, StringType, StructType, compareFor, equalFor, none,
    some, variant, type EastType, type ExprType, type ValueTypeOf,
} from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Data, Record, Schedule } from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import * as sx from "./schedule.examples.js";

// ============================================================================
// The rows a resource kind is built over, and the records an event kind is
// ============================================================================

const PersonType = StructType({ name: StringType, role: StringType });
const MachineType = StructType({ name: StringType, area: StringType });
const People = DictType(StringType, PersonType);
const MachinesByNumber = DictType(IntegerType, MachineType);

const PEOPLE = new SortedMap([
    ["p1", { name: "Ash Ferris", role: "Operator" }],
    ["p2", { name: "Bea Lund", role: "Technician" }],
], compareFor(StringType));
const MACHINES_BY_NUMBER = new SortedMap([
    [10n, { name: "Press 10", area: "Bay 1" }],
    [2n, { name: "Lathe 2", area: "Bay 2" }],
], compareFor(IntegerType));

const Shifts = sx.scheduleShifts.type;
const shiftsRecord = sx.scheduleShifts;
const shiftsPatch = sx.scheduleShiftsPatch;
const jobsRecord = sx.scheduleJobs;
const jobsPatch = sx.scheduleJobsPatch;
const inspectionsRecord = sx.scheduleInspections;
const inspectionsPatch = sx.scheduleInspectionsPatch;

// ============================================================================
// Schedule.resources
// ============================================================================

describe("Schedule.resources", () => {
    test("resolves a kind's rows in key order: each one's key, label and second line", () => {
        const people = East.compile(East.function([], Schedule.Types.Resources, ($) => {
            const rows = $.const(PEOPLE, People);
            return Schedule.resources(rows, { name: "People", icon: "user", label: (p) => p.name, meta: (p) => some(p.role) }).build("people");
        }), [])();
        assert.equal(people.key, "people");
        assert.equal(people.name, "People");
        assert.equal(people.icon, "user");
        assert.deepEqual(people.rows.map((r) => [r.key, r.label]), [["p1", "Ash Ferris"], ["p2", "Bea Lund"]]);
        assert.ok(equalFor(OptionType(StringType))(people.rows[0]!.meta, some("Operator")));
    });

    test("names a resource keyed by another type as East prints its key, and gives no second line without `meta`", () => {
        const machines = East.compile(East.function([], Schedule.Types.Resources, ($) => {
            const rows = $.const(MACHINES_BY_NUMBER, MachinesByNumber);
            return Schedule.resources(rows, { name: "Machines", icon: "gears", label: (m) => m.name }).build("machines");
        }), [])();
        assert.deepEqual(machines.rows.map((r) => [r.key, r.label, r.meta.type]), [["2", "Lathe 2", "none"], ["10", "Press 10", "none"]]);
    });
});

// ============================================================================
// Schedule.days and Schedule.unscheduled
// ============================================================================

/** The keys a record index files under, at module scope: East bodies never call host helpers. */
const ON_THE_1ST = new SortedSet([new Date("2026-10-01T00:00:00Z")], compareFor(DateTimeType));
const ON_THE_1ST_AND_2ND = new SortedSet([new Date("2026-10-01T00:00:00Z"), new Date("2026-10-02T00:00:00Z")], compareFor(DateTimeType));
const SEP_30_TO_OCT_2 = new SortedSet([
    new Date("2026-09-30T00:00:00Z"), new Date("2026-10-01T00:00:00Z"), new Date("2026-10-02T00:00:00Z"),
], compareFor(DateTimeType));
const MONDAY_TO_SUNDAY = new SortedSet([
    new Date("2026-10-05T00:00:00Z"), new Date("2026-10-06T00:00:00Z"), new Date("2026-10-07T00:00:00Z"), new Date("2026-10-08T00:00:00Z"),
    new Date("2026-10-09T00:00:00Z"), new Date("2026-10-10T00:00:00Z"), new Date("2026-10-11T00:00:00Z"),
], compareFor(DateTimeType));
const MONDAY_TO_MONDAY = new SortedSet([...MONDAY_TO_SUNDAY, new Date("2026-10-12T00:00:00Z")], compareFor(DateTimeType));
const DUE_ON_THE_2ND = new SortedSet([some(new Date("2026-10-02T00:00:00Z"))], compareFor(OptionType(DateTimeType)));
const DUE_NEVER = new SortedSet([none], compareFor(OptionType(DateTimeType)));
const FILED_NOWHERE = new SortedSet<ValueTypeOf<OptionType<DateTimeType>>>([], compareFor(OptionType(DateTimeType)));

describeEast("Schedule.days and Schedule.unscheduled — the keys a record index files under", (test) => {
    test("an event touches the day of its start and every day it runs into, an end at midnight left out", $ => {
        const days = $.const(Schedule.days);
        $(Assert.equal(days(new Date("2026-10-01T06:00:00Z"), new Date("2026-10-01T14:00:00Z")), ON_THE_1ST));
        $(Assert.equal(days(new Date("2026-10-01T22:00:00Z"), new Date("2026-10-02T06:00:00Z")), ON_THE_1ST_AND_2ND));
        $(Assert.equal(days(new Date("2026-10-01T06:00:00Z"), new Date("2026-10-02T00:00:00Z")), ON_THE_1ST));
        $(Assert.equal(days(new Date("2026-09-30T12:00:00Z"), new Date("2026-10-02T12:00:00Z")), SEP_30_TO_OCT_2));
        // An event of no length touches its start's day.
        $(Assert.equal(days(new Date("2026-10-01T09:00:00Z"), new Date("2026-10-01T09:00:00Z")), ON_THE_1ST));
    });

    test("a week: Monday's midnight to the next Monday's touches seven days, and run on past it, eight (#1199)", $ => {
        const days = $.const(Schedule.days);
        $(Assert.equal(days(new Date("2026-10-05T00:00:00Z"), new Date("2026-10-12T00:00:00Z")), MONDAY_TO_SUNDAY));
        $(Assert.equal(days(new Date("2026-10-05T06:00:00Z"), new Date("2026-10-12T06:00:00Z")), MONDAY_TO_MONDAY));
    });

    test("a backlog index files an unscheduled row by its due date, and a scheduled row nowhere", $ => {
        const unscheduled = $.const(Schedule.unscheduled);
        $(Assert.equal(unscheduled(none, some(new Date("2026-10-02T00:00:00Z"))), DUE_ON_THE_2ND));
        $(Assert.equal(unscheduled(none, none), DUE_NEVER));
        $(Assert.equal(unscheduled(some(new Date("2026-10-01T09:00:00Z")), some(new Date("2026-10-02T00:00:00Z"))), FILED_NOWHERE));
    });
}, { platformFns: TestImpl });

// ============================================================================
// The checks across a builder's slots
// ============================================================================

describe("Schedule.check — across a builder's slots", () => {
    /** Run `build` inside a bound block, as a builder's props are written. */
    function inBlock(build: (shifts: ExprType<EastType>) => void): void {
        East.function([], NullType, ($) => {
            build($.let(Record.bind(shiftsRecord, [shiftsPatch])) as never);
        });
    }
    const people = (rows: ExprType<EastType>) => Schedule.resources(rows as never, { name: "People", icon: "user", label: (p: ExprType<typeof PersonType>) => p.name } as never);

    test("takes kinds whose resources name slots it has, keyed by String", () => {
        inBlock((shifts) => {
            const shift = Schedule.events(shifts as never, { name: "Shift", icon: "user-clock", title: "title", start: "start", end: "end", resource: { field: "person", of: "people" } } as never);
            Schedule.check({ people: people(East.value(PEOPLE, People) as never) }, { shift }, "Calendar.Builder");
        });
    });

    test("refuses no event kinds, a resource slot it does not have, and one keyed by another type", () => {
        assert.throws(() => Schedule.check({}, {}, "Calendar.Builder"), /Calendar\.Builder: `events` declares at least one event kind/);
        assert.throws(() => inBlock((shifts) => {
            const shift = Schedule.events(shifts as never, { name: "Shift", icon: "user-clock", title: "title", start: "start", end: "end", resource: { field: "person", of: "peeple" } } as never);
            Schedule.check({ people: people(East.value(PEOPLE, People) as never) }, { shift }, "Calendar.Builder");
        }), /events\.shift's resource names the slot "peeple", and `resources` has no slot of that name \(people\)/);
        assert.throws(() => inBlock((shifts) => {
            const shift = Schedule.events(shifts as never, { name: "Shift", icon: "user-clock", title: "title", start: "start", end: "end", resource: { field: "person", of: "people" } } as never);
            const byNumber = Schedule.resources(East.value(MACHINES_BY_NUMBER, MachinesByNumber) as never, { name: "People", icon: "user", label: (m: ExprType<typeof MachineType>) => m.name } as never);
            Schedule.check({ people: byNumber }, { shift }, "Calendar.Builder");
        }), /events\.shift's resource field holds String keys of resources\.people, which is keyed by \.Integer — key the resources by String/);
    });
});

// ============================================================================
// The refusals at build
// ============================================================================

describe("Schedule.events — what it refuses at build", () => {
    /** Declare a shift kind over `options` inside a bound block. */
    function shiftsWith(options: object, record: unknown = shiftsRecord): void {
        East.function([], NullType, ($) => {
            const def = record as typeof shiftsRecord;
            const bound = $.let(Record.bind(def, [e3.mutation.patch(def)]));
            Schedule.events(bound as never, { name: "Shift", icon: "user-clock", title: "title", start: "start", end: "end", ...options } as never);
        });
    }

    test("a record that is not bound, or holds no structs by key", () => {
        assert.throws(() => East.function([], NullType, ($) => {
            Schedule.events($.const(new SortedMap<string, ValueTypeOf<typeof sx.ScheduleShift>>([], compareFor(StringType)), Shifts) as never, { name: "Shift", icon: "i", title: "title", start: "start", end: "end" } as never);
        }), /`record` is a record bound with its patch mutation/);
        assert.throws(() => shiftsWith({}, e3.record("schedule_spec_counts", DictType(StringType, IntegerType), new Map())),
            /an event kind's record holds its events by key, each a struct — a Dict of row structs, and this one holds/);
    });

    test("a title that is not a String, times that are not DateTimes, and one of each", () => {
        assert.throws(() => shiftsWith({ title: "crew" }), /`title` names a String field — "crew" holds \.Integer/);
        assert.throws(() => shiftsWith({ start: "title" }), /`start` names a DateTime field, or an Option of one — "title" holds \.String/);
        assert.throws(() => shiftsWith({ end: "nope" }), /`end` names "nope", a field the row does not have/);
        assert.throws(() => shiftsWith({}, e3.record("schedule_spec_mixed", DictType(StringType, StructType({ title: StringType, start: DateTimeType, end: OptionType(DateTimeType) })), new Map())),
            /`start` and `end` are both DateTime fields, or both Options of one/);
    });

    test("a resource field that holds no key, an `of` of the wrong form, cases that are not the variant's, and a kind named twice", () => {
        assert.throws(() => shiftsWith({ resource: { field: "crew", of: "people" } }), /`resource\.field` names a field holding a resource's key — a String, a variant of String cases, or an Option of either — and "crew" holds \.Integer/);
        assert.throws(() => shiftsWith({ resource: { field: "person", of: { a: "people" } } }), /`resource\.of` names the resource slot "person" holds keys of/);
        const inspections = (of: object) => East.function([], NullType, ($) => {
            const bound = $.let(Record.bind(inspectionsRecord, [inspectionsPatch]));
            Schedule.events(bound as never, { name: "Inspection", icon: "i", title: "title", start: "start", end: "end", resource: { field: "target", of } } as never);
        });
        assert.throws(() => inspections({ site: "sites" }), /`resource\.of` names a resource slot for each of "target"'s cases \(machine, site\) — and it names site/);
        assert.throws(() => inspections({ site: "places", machine: "places" }), /`resource\.of` names each resource slot once/);
        assert.throws(() => East.function([], NullType, ($) => {
            const bound = $.let(Record.bind(inspectionsRecord, [inspectionsPatch]));
            Schedule.events(bound as never, { name: "Inspection", icon: "i", title: "title", start: "start", end: "end", resource: { field: "target", of: "sites" } } as never);
        }), /"target" is a variant — `resource\.of` names a resource slot per case/);
    });

    test("a status that is not a variant, or is an Option", () => {
        assert.throws(() => shiftsWith({ status: { field: "crew", cases: {} } }), /`status\.field` names a variant field every event holds, a Status per case — "crew" holds \.Integer/);
        assert.throws(() => shiftsWith({ status: { field: "person", cases: {} } }), /`status\.field` names a variant field every event holds, a Status per case — "person" holds an Option of \.String/);
    });

    test("a backlog on plain times, a template key repeated, and a window over another index", () => {
        assert.throws(() => shiftsWith({ backlog: { duration: () => variant("hours", 1) } }), /`backlog` is a kind's rows with no time, and its times are plain DateTime fields/);
        const template = { key: "day", name: "Day", duration: variant("hours", 8), values: { title: "Day", status: variant("tentative", null), crew: 1n, skills: new Set(), handover: [] } };
        assert.throws(() => shiftsWith({ templates: [template, template] }), /template "day" is declared twice/);
        assert.throws(() => East.function([], NullType, ($) => {
            const bound = $.let(Record.bind(shiftsRecord, [shiftsPatch]));
            const whole = $.let(Data.bindPaged(shiftsRecord));
            Schedule.events(bound as never, { name: "Shift", icon: "i", title: "title", start: "start", end: "end", window: whole } as never);
        }), /`window` reads the record through a day index keyed by Schedule\.days/);
        assert.throws(() => shiftsWith({ backlogWindow: {} }), /`backlogWindow` reads the backlog, and a kind whose times are plain DateTime fields has none/);
    });

    test("a form hint for a field the row does not have, and a record bound without its patch door", () => {
        assert.throws(() => shiftsWith({ fields: { nope: Schedule.field.text({}) } }), /a hint names "nope", a field the struct does not have/);
        const shifts = e3.record("schedule_spec_unbound", Shifts, new Map());
        assert.throws(() => East.function([], NullType, ($) => {
            Schedule.events($.let(Record.bind(shifts, [])) as never, { name: "Shift", icon: "i", title: "title", start: "start", end: "end" } as never);
        }), /"patch" is not bound as this record's patch door/);
    });
});

// ============================================================================
// What fails to compile (PB6): a field named against the record's row type
// ============================================================================

/** Never run: each line below must fail to compile, or the build fails on the unused directive. */
export function scheduleTypeChecks(): void {
    const bound = Record.bind(shiftsRecord, [shiftsPatch]);
    const boundJobs = Record.bind(jobsRecord, [jobsPatch]);
    // @ts-expect-error — `start` is a DateTime field, and "title" is a String one
    Schedule.events(bound, { name: "Shift", icon: "i", title: "title", start: "title", end: "end" });
    // @ts-expect-error — `title` is a String field, and "crew" is an Integer one
    Schedule.events(bound, { name: "Shift", icon: "i", title: "crew", start: "start", end: "end" });
    // @ts-expect-error — `resource.field` holds a resource's key, and "crew" holds none
    Schedule.events(bound, { name: "Shift", icon: "i", title: "title", start: "start", end: "end", resource: { field: "crew", of: "people" } });
    // @ts-expect-error — `backlog` takes Option times, and a shift's are plain
    Schedule.events(bound, { name: "Shift", icon: "i", title: "title", start: "start", end: "end", backlog: { duration: () => variant("hours", 1) } });
    // A job's Option times take a backlog.
    Schedule.events(boundJobs, { name: "Job", icon: "i", title: "title", start: "start", end: "end", backlog: { duration: (job) => variant("hours", job.estimate_h) } });
    Schedule.events(bound, {
        name: "Shift", icon: "i", title: "title", start: "start", end: "end", resource: { field: "person", of: "people" },
        // @ts-expect-error — a template's values leave out the start, the end and the resource
        templates: [{ key: "day", name: "Day", duration: variant("hours", 8), values: { title: "Day", start: new Date(0), status: variant("tentative", null), crew: 1n, skills: new Set<string>(), handover: [] } }],
    });
}
