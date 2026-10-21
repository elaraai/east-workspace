/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Schedule's declarations for the builders that write the app's own records
 * (#1367, `Builder Interfaces Spec.md` §4) — what is checked of them without
 * e3. A kind and a builder's periods are built over their record, which they
 * read as they build, so the Roster's and the Allocation's roles read and
 * written through `buildRoster` and `buildAllocation`, a title-less kind's
 * events, what a builder publishes, and reads bounded to a period (B14) run
 * in e3-ui-components on e3 itself (`test/schedule-builders.spec.ts`), over
 * Schedule's records (`schedule.examples.tsx`). Here: every role refused at
 * build (B2), the Calendar's and the Plan's refusal of a kind with no title
 * (B3), the builders' accessors on `Schedule.resources`, the periods'
 * refusals, and what fails to compile.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, SetType, SortedMap, SortedSet, StringType, StructType, VariantType,
    compareFor, equalFor, variant,
} from "@elaraai/east";
import { TimeStepType } from "@elaraai/east-ui";
import { CalendarPayloadType, Plan, PlanPayloadType, Record, Schedule, createCalendarPayload } from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import * as sx from "./schedule.examples.js";

/** An instant as its author writes it: UTC, with its zone. */
const at = (text: string): Date => new Date(text);

const byString = compareFor(StringType);
const BinType = sx.ScheduleBin;
const PlainDutyType = sx.SchedulePlainDuty;
const RotaWeekType = sx.ScheduleWeek;
const dutiesRecord = sx.scheduleDuties;
const plainDutiesRecord = sx.schedulePlainDuties;
const binsRecord = sx.scheduleBins;
const weeksRecord = sx.scheduleWeeks;
const dutiesPatch = sx.scheduleDutiesPatch;
const plainDutiesPatch = sx.schedulePlainDutiesPatch;
const binsPatch = sx.scheduleBinsPatch;
const weeksPatch = sx.scheduleWeeksPatch;

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
// The Calendar and Plan require a title (B3); a kind's own is optional
// ============================================================================

describe("Schedule.events — the Calendar and Plan require a `title` (B3)", () => {
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

describe("Schedule.periods — refused at build", () => {
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
