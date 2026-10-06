/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Schedule` (#1218): the event and resource kinds the Calendar and Plan's
 * builder share. Over `Calendar Spec.md` §3.1's records — shifts on people,
 * maintenance jobs on machines with a backlog, inspections on a site or a
 * machine — each kind is built and its seams run: its events over a window
 * with the drafts in place, its backlog, a gesture written into an entry, the
 * author's check, its editing wire and its Apply. Then the day index's keys
 * (East functions, so a `describeEast` suite), the checks a builder makes
 * across its slots, every refusal, and what fails to compile.
 *
 * The records are bound as an app binds them, `Record.bind(record,
 * [e3.mutation.patch(record)])`, under an in-memory `Record.bind`: each
 * handle reads a fixed state, and its patch door commits at `state-1`.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, BooleanType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType,
    SetType, SortedMap, SortedSet, StringType, StructType, VariantType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, none,
    some, variant, type EastType, type ExprType, type ValueTypeOf,
} from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Editing } from "@elaraai/east-ui/internal";
import { Data, Record, Schedule } from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import { memoryRecords } from "./memory-records.js";

// ============================================================================
// The records (Calendar Spec §3.1), metal fabrication
// ============================================================================

const StatusType = VariantType({ tentative: NullType, confirmed: NullType, in_progress: NullType, done: NullType });
const ChecklistType = ArrayType(StructType({ item: StringType, done: BooleanType }));
const PersonType = StructType({ name: StringType, role: StringType });
const MachineType = StructType({ name: StringType, area: StringType });

const ShiftType = StructType({
    title: StringType,
    start: DateTimeType,
    end: DateTimeType,
    person: OptionType(StringType),
    status: StatusType,
    crew: IntegerType,
    skills: SetType(StringType),
    handover: ChecklistType,
});
const JobType = StructType({
    title: StringType,
    start: OptionType(DateTimeType),
    end: OptionType(DateTimeType),
    machine: OptionType(StringType),
    status: StatusType,
    work_order: StringType,
    estimate_h: FloatType,
    due: OptionType(DateTimeType),
});
// The inspector's contact is a nested struct: an edit reaches a field inside it.
const InspectionType = StructType({
    title: StringType,
    start: DateTimeType,
    end: DateTimeType,
    target: OptionType(VariantType({ site: StringType, machine: StringType })),
    status: StatusType,
    contact: StructType({ name: StringType, phone: StringType }),
});

// A task's estimate is a duration in any unit, and a task is on no resource.
const TaskType = StructType({
    title: StringType,
    start: OptionType(DateTimeType),
    end: OptionType(DateTimeType),
    estimate: Schedule.Types.Duration,
});
// A field may be named with a dot beside a struct of that name: a path names a field by its steps.
const VisitType = StructType({
    title: StringType,
    start: DateTimeType,
    end: DateTimeType,
    "contact.phone": StringType,
    contact: StructType({ phone: StringType }),
});

const People = DictType(StringType, PersonType);
const MachinesByNumber = DictType(IntegerType, MachineType);
const Shifts = DictType(StringType, ShiftType);
const Jobs = DictType(StringType, JobType);
const Inspections = DictType(StringType, InspectionType);
const Tasks = DictType(StringType, TaskType);
const Visits = DictType(StringType, VisitType);

type Shift = ValueTypeOf<typeof ShiftType>;
type Job = ValueTypeOf<typeof JobType>;
type Inspection = ValueTypeOf<typeof InspectionType>;
type Task = ValueTypeOf<typeof TaskType>;
type Visit = ValueTypeOf<typeof VisitType>;

/** An instant as its author writes it: UTC, with its zone. */
const at = (text: string): Date => new Date(text);

// Thursday 1 October 2026 is the mock's "today".
const PEOPLE = new SortedMap([
    ["p1", { name: "Ash Ferris", role: "Operator" }],
    ["p2", { name: "Bea Lund", role: "Technician" }],
], compareFor(StringType));
const MACHINES_BY_NUMBER = new SortedMap([
    [10n, { name: "Press 10", area: "Bay 1" }],
    [2n, { name: "Lathe 2", area: "Bay 2" }],
], compareFor(IntegerType));
const NO_SKILLS = new Set<string>();
const SHIFTS = new SortedMap<string, Shift>([
    ["s1", { title: "Day shift", start: at("2026-10-01T06:00:00Z"), end: at("2026-10-01T14:00:00Z"), person: some("p1"),
        status: variant("confirmed", null), crew: 1n, skills: NO_SKILLS, handover: [] }],
    ["s2", { title: "Night shift", start: at("2026-10-01T22:00:00Z"), end: at("2026-10-02T06:00:00Z"), person: none,
        status: variant("tentative", null), crew: 2n, skills: NO_SKILLS, handover: [] }],
    ["s3", { title: "Day shift", start: at("2026-10-08T06:00:00Z"), end: at("2026-10-08T14:00:00Z"), person: some("p2"),
        status: variant("done", null), crew: 1n, skills: NO_SKILLS, handover: [] }],
], compareFor(StringType));
const JOBS = new SortedMap<string, Job>([
    ["j1", { title: "Bearing swap", start: some(at("2026-10-01T09:00:00Z")), end: some(at("2026-10-01T11:00:00Z")), machine: some("m1"),
        status: variant("confirmed", null), work_order: "WO-1041", estimate_h: 2, due: none }],
    ["j2", { title: "Belt check", start: none, end: none, machine: none,
        status: variant("tentative", null), work_order: "", estimate_h: 2.5, due: some(at("2026-10-02T00:00:00Z")) }],
    ["j3", { title: "Filter change", start: none, end: none, machine: none,
        status: variant("tentative", null), work_order: "WO-1050", estimate_h: 1, due: none }],
], compareFor(StringType));
const INSPECTIONS = new SortedMap<string, Inspection>([
    ["i1", { title: "Safety walk", start: at("2026-10-01T11:00:00Z"), end: at("2026-10-01T12:00:00Z"),
        target: some(variant("site", "north")), status: variant("tentative", null), contact: { name: "Cal Moss", phone: "0400 000 001" } }],
], compareFor(StringType));
const TASKS = new SortedMap<string, Task>([
    ["t1", { title: "Deburr", start: none, end: none, estimate: variant("minutes", 90) }],
    ["t2", { title: "Paint", start: none, end: none, estimate: variant("hours", 1.5) }],
    ["t3", { title: "Cure", start: none, end: none, estimate: variant("days", 2) }],
    ["t4", { title: "Audit", start: none, end: none, estimate: variant("weeks", 1) }],
    ["t5", { title: "Overhaul", start: none, end: none, estimate: variant("months", 1) }],
], compareFor(StringType));
const VISITS = new SortedMap<string, Visit>([
    ["v1", { title: "Site visit", start: at("2026-10-01T10:00:00Z"), end: at("2026-10-01T11:00:00Z"),
        "contact.phone": "0400 000 003", contact: { phone: "0400 000 004" } }],
], compareFor(StringType));

/** How a status shows, as an app binds it once. */
const STATUS_CASES = {
    tentative: { label: "Tentative", tone: variant("neutral", null), ring: true },
    confirmed: { label: "Confirmed", tone: variant("success", null), ring: false },
    in_progress: { label: "In progress", tone: variant("info", null), ring: false },
    done: { label: "Done", tone: variant("neutral", null), ring: false },
};

// ============================================================================
// The records, bound as an app binds them
// ============================================================================

const shiftsRecord = e3.record("schedule_spec_shifts", Shifts, new Map());
const jobsRecord = e3.record("schedule_spec_jobs", Jobs, new Map());
const inspectionsRecord = e3.record("schedule_spec_inspections", Inspections, new Map());
const tasksRecord = e3.record("schedule_spec_tasks", Tasks, new Map());
const visitsRecord = e3.record("schedule_spec_visits", Visits, new Map());
const shiftsPatch = e3.mutation.patch(shiftsRecord);
const jobsPatch = e3.mutation.patch(jobsRecord);
const inspectionsPatch = e3.mutation.patch(inspectionsRecord);
const tasksPatch = e3.mutation.patch(tasksRecord);
const visitsPatch = e3.mutation.patch(visitsRecord);

/** Each record's state, by name. */
const STATES = new Map<string, unknown>([
    ["schedule_spec_shifts", SHIFTS],
    ["schedule_spec_jobs", JOBS],
    ["schedule_spec_inspections", INSPECTIONS],
    ["schedule_spec_tasks", TASKS],
    ["schedule_spec_visits", VISITS],
]);

/** `Record.bind`, in memory, over the states above. */
const PLATFORM = memoryRecords(STATES);

type Kind = ValueTypeOf<typeof Schedule.Types.Kind>;
type Item = ValueTypeOf<typeof Schedule.Types.Item>;

/** The shift kind, built under its slot, compiled. */
const shiftKind = East.compile(East.function([], Schedule.Types.Kind, ($) => {
    const shifts = $.let(Record.bind(shiftsRecord, [shiftsPatch]));
    const status = $.let(STATUS_CASES, Schedule.Types.StatusCases(StatusType));
    return Schedule.events(shifts, {
        name: "Shift", icon: "user-clock",
        title: "title", start: "start", end: "end",
        resource: { field: "person", of: "people" },
        status: { field: "status", cases: status },
        fields: { crew: Schedule.field.number({ label: "Crew size", unit: "people", min: 1n, max: 20n }) },
        templates: [
            { key: "day", name: "Day shift", group: "Operations", at: { hour: 6n, minute: 0n }, duration: variant("hours", 8),
                values: { title: "Day shift", status: variant("tentative", null), crew: 1n, skills: new Set(), handover: [] } },
        ],
    }).build("shift");
}), PLATFORM)() as Kind;

/** The job kind: Option times, a backlog, a check on its work order. */
const jobKind = East.compile(East.function([], Schedule.Types.Kind, ($) => {
    const jobs = $.let(Record.bind(jobsRecord, [jobsPatch]));
    return Schedule.events(jobs, {
        name: "Maintenance", icon: "screwdriver-wrench",
        title: "title", start: "start", end: "end",
        resource: { field: "machine", of: "machines" },
        backlog: { duration: (job) => variant("hours", job.estimate_h), due: (job) => job.due },
        // A job titled "Explode" makes the check throw: an empty list read at its first item.
        ready: (job, _key) => job.title.equal("Explode").ifElse(
            () => East.value([], ArrayType(Editing.Types.Readiness)).get(0n),
            () => job.work_order.equal("").ifElse(
                () => East.value(variant("incomplete", [{ field: "work_order", message: "A scheduled job needs its work order" }]), Editing.Types.Readiness),
                () => East.value(variant("ready", null), Editing.Types.Readiness),
            ),
        ),
    }).build("job");
}), PLATFORM)() as Kind;

/** The inspection kind: a site or a machine, by its variant's case. */
const inspectionKind = East.compile(East.function([], Schedule.Types.Kind, ($) => {
    const inspections = $.let(Record.bind(inspectionsRecord, [inspectionsPatch]));
    return Schedule.events(inspections, {
        name: "Inspection", icon: "clipboard-check",
        title: "title", start: "start", end: "end",
        resource: { field: "target", of: { site: "sites", machine: "machines" } },
    }).build("inspection");
}), PLATFORM)() as Kind;

/** The task kind: on no resource, each task's estimate in its own unit. */
const taskKind = East.compile(East.function([], Schedule.Types.Kind, ($) => {
    const tasks = $.let(Record.bind(tasksRecord, [tasksPatch]));
    return Schedule.events(tasks, {
        name: "Task", icon: "list-check",
        title: "title", start: "start", end: "end",
        backlog: { duration: (task) => task.estimate },
    }).build("task");
}), PLATFORM)() as Kind;

/** The visit kind: a field named with a dot, beside the struct it reads like. */
const visitKind = East.compile(East.function([], Schedule.Types.Kind, ($) => {
    const visits = $.let(Record.bind(visitsRecord, [visitsPatch]));
    return Schedule.events(visits, { name: "Visit", icon: "door-open", title: "title", start: "start", end: "end" }).build("visit");
}), PLATFORM)() as Kind;

const encodeShift = encodeBeast2For(ShiftType);
const decodeShift = decodeBeast2For(ShiftType);
const decodeJob = decodeBeast2For(JobType);
const decodeInspection = decodeBeast2For(InspectionType);
const shiftEqual = equalFor(ShiftType);
const shiftDraft = encodeBeast2For(Editing.Types.DraftField(ShiftType));
const refEqual = equalFor(OptionType(Schedule.Types.ResourceRef));
const statusEqual = equalFor(OptionType(Schedule.Types.Status));

/** The drafts a seam reads, by entry id. */
const draftsOf = (entries: [string, Uint8Array][]) => new SortedMap(entries, compareFor(StringType));
const NO_DRAFTS = draftsOf([]);

/** A window's items, in order. */
function itemsIn(kind: Kind, from: string, to: string, drafts = NO_DRAFTS): Item[] {
    const read = kind.items(at(from), at(to), drafts);
    if (read.type !== "some") assert.fail("expected the window read");
    return read.value;
}

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
// Schedule.events — the kind on the wire
// ============================================================================

describe("Schedule.events — the kind", () => {
    test("names itself, the resource kinds it takes, its status table and its backlog", () => {
        assert.equal(shiftKind.key, "shift");
        assert.equal(shiftKind.name, "Shift");
        assert.equal(shiftKind.icon, "user-clock");
        assert.deepEqual(shiftKind.takes, ["people"]);
        assert.deepEqual(inspectionKind.takes, ["sites", "machines"]);
        assert.deepEqual(taskKind.takes, [], "a kind on no resource takes none");
        assert.deepEqual(shiftKind.status.map((s) => [s.case, s.status.label, s.status.ring]),
            [["confirmed", "Confirmed", false], ["done", "Done", false], ["in_progress", "In progress", false], ["tentative", "Tentative", true]]);
        assert.equal(shiftKind.backlog, false);
        assert.equal(jobKind.backlog, true);
        assert.deepEqual(jobKind.status, [], "a kind without `status` has no table");
        assert.equal(shiftKind.history().type, "none", "its history is the record's, not yet read");
    });

    test("lists its templates: the card, its group, its start of day, its length and its values as bytes", () => {
        assert.equal(shiftKind.templates.length, 1);
        const day = shiftKind.templates[0]!;
        assert.equal(day.key, "day");
        assert.equal(day.name, "Day shift");
        assert.ok(equalFor(OptionType(StringType))(day.group, some("Operations")));
        assert.ok(equalFor(OptionType(Schedule.Types.Clock))(day.at, some({ hour: 6n, minute: 0n })));
        assert.ok(equalFor(Schedule.Types.Duration)(day.duration, variant("hours", 8)));
        const ValuesType = StructType({ title: StringType, status: StatusType, crew: IntegerType, skills: SetType(StringType), handover: ChecklistType });
        assert.ok(equalFor(ValuesType)(decodeBeast2For(ValuesType)(day.values),
            { title: "Day shift", status: variant("tentative", null), crew: 1n, skills: NO_SKILLS, handover: [] }));
    });

    test("draws the inspector's form over the fields a gesture does not write, the hinted first", () => {
        assert.deepEqual(shiftKind.fields.map((f) => f.path.join(".")), ["crew", "skills", "handover"]);
        assert.equal(shiftKind.fields[0]!.label, "Crew size");
        assert.deepEqual(inspectionKind.fields.map((f) => f.path.join(".")), ["status", "contact.name", "contact.phone"]);
    });
});

// ============================================================================
// Schedule.events — the seams
// ============================================================================

describe("Schedule.events — its events over a window", () => {
    test("reads the events overlapping [from, to): one starting in it, and one that runs on past it", () => {
        const items = itemsIn(shiftKind, "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z");
        assert.deepEqual(items.map((i) => i.key), ["s1", "s2"]);
        const [day, night] = items;
        assert.equal(day!.kind, "shift");
        assert.equal(day!.title, "Day shift");
        assert.equal(day!.minutes, 480n);
        assert.ok(refEqual(day!.resource, some({ kind: "people", key: "p1" })));
        assert.ok(refEqual(night!.resource, none), "an unassigned shift is on no resource");
        assert.ok(statusEqual(day!.status, some({ label: "Confirmed", tone: variant("success", null), ring: false })));
        assert.ok(statusEqual(night!.status, some({ label: "Tentative", tone: variant("neutral", null), ring: true })));
        // An event that ended before the window, or starts at its end, is not in it.
        assert.deepEqual(itemsIn(shiftKind, "2026-10-02T06:00:00Z", "2026-10-08T06:00:00Z").map((i) => i.key), []);
        // An event of no length at the window's start sits inside it.
        const handover = { ...SHIFTS.get("s1")!, title: "Handover", start: at("2026-10-01T00:00:00Z"), end: at("2026-10-01T00:00:00Z") };
        const atStart = itemsIn(shiftKind, "2026-10-01T00:00:00Z", "2026-10-01T06:00:00Z", draftsOf([["s8", shiftDraft(variant("value", handover))]]));
        assert.deepEqual(atStart.map((i) => [i.key, i.minutes]), [["s8", 0n]]);
    });

    test("draws each draft in place: a move into the window shows, a deletion leaves, an unreadable draft keeps the record's", () => {
        const moved = { ...SHIFTS.get("s3")!, start: at("2026-10-01T15:00:00Z"), end: at("2026-10-01T19:00:00Z") };
        const drafts = draftsOf([
            ["s3", shiftDraft(variant("value", moved))],
            ["s1", shiftDraft(variant("missing", null))],
            ["s2", shiftDraft(variant("invalid", "not a shift"))],
        ]);
        const items = itemsIn(shiftKind, "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z", drafts);
        assert.deepEqual(items.map((i) => [i.key, i.minutes]), [["s2", 480n], ["s3", 240n]]);
    });

    test("draws a drafted event the record does not hold yet: a created one", () => {
        const created = { ...SHIFTS.get("s1")!, title: "Extra shift", start: at("2026-10-01T16:00:00Z"), end: at("2026-10-01T20:00:00Z") };
        const items = itemsIn(shiftKind, "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z", draftsOf([["s9", shiftDraft(variant("value", created))]]));
        assert.deepEqual(items.map((i) => [i.key, i.title]), [["s1", "Day shift"], ["s2", "Night shift"], ["s9", "Extra shift"]]);
    });

    test("names a resource by the variant's case: a site or a machine", () => {
        const [walk] = itemsIn(inspectionKind, "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z");
        assert.ok(refEqual(walk!.resource, some({ kind: "sites", key: "north" })));
    });
});

describe("Schedule.events — its backlog", () => {
    test("holds the rows with no time, each sized by its duration and filed by its due date", () => {
        const read = jobKind.unscheduled(NO_DRAFTS);
        if (read.type !== "some") assert.fail("expected the backlog");
        assert.deepEqual(read.value.map((i) => [i.key, i.minutes, i.start.type, i.due.type]), [["j2", 150n, "none", "some"], ["j3", 60n, "none", "none"]]);
        // The window holds only the scheduled job.
        assert.deepEqual(itemsIn(jobKind, "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z").map((i) => [i.key, i.minutes]), [["j1", 120n]]);
    });

    test("sizes a row by its duration in any unit — a month counts 30 days", () => {
        const read = taskKind.unscheduled(NO_DRAFTS);
        if (read.type !== "some") assert.fail("expected the backlog");
        assert.deepEqual(read.value.map((i) => [i.key, i.minutes]), [["t1", 90n], ["t2", 90n], ["t3", 2_880n], ["t4", 10_080n], ["t5", 43_200n]]);
    });

    test("is empty for a kind whose times are plain", () => {
        const read = shiftKind.unscheduled(NO_DRAFTS);
        if (read.type !== "some") assert.fail("expected the backlog");
        assert.deepEqual(read.value, []);
    });
});

describe("Schedule.events — a gesture written into an entry", () => {
    const write = (kind: Kind, id: string, entry: Uint8Array, gesture: ValueTypeOf<typeof Schedule.Types.Gesture>) => {
        const [out] = kind.write([{ id, entry, gesture }]);
        return out!;
    };
    const s1 = encodeShift(SHIFTS.get("s1")!);
    const place = (start: string, end: string, resource: ValueTypeOf<OptionType<typeof Schedule.Types.ResourceRef>>) =>
        variant("place", { start: at(start), end: at(end), resource });

    test("`place` writes the times and the resource's key", () => {
        const out = write(shiftKind, "s1", s1, place("2026-10-01T08:00:00Z", "2026-10-01T16:00:00Z", some({ kind: "people", key: "p2" })));
        if (out.type !== "some") assert.fail("expected the shift placed");
        assert.ok(shiftEqual(decodeShift(out.value), { ...SHIFTS.get("s1")!, start: at("2026-10-01T08:00:00Z"), end: at("2026-10-01T16:00:00Z"), person: some("p2") }));
        // No resource unassigns an Option field.
        const off = write(shiftKind, "s1", s1, place("2026-10-01T08:00:00Z", "2026-10-01T16:00:00Z", none));
        if (off.type !== "some") assert.fail("expected the shift unassigned");
        assert.equal(decodeShift(off.value).person.type, "none");
    });

    test("`place` refuses a resource of a kind the event kind does not take", () => {
        assert.equal(write(shiftKind, "s1", s1, place("2026-10-01T08:00:00Z", "2026-10-01T16:00:00Z", some({ kind: "machines", key: "m1" }))).type, "none");
    });

    test("`place` writes a variant's case for the resource's kind, and refuses a kind with no case", () => {
        const i1 = encodeBeast2For(InspectionType)(INSPECTIONS.get("i1")!);
        const out = write(inspectionKind, "i1", i1, place("2026-10-01T13:00:00Z", "2026-10-01T14:00:00Z", some({ kind: "machines", key: "m2" })));
        if (out.type !== "some") assert.fail("expected the inspection placed");
        assert.ok(equalFor(InspectionType.fields.target)(decodeInspection(out.value).target, some(variant("machine", "m2"))));
        assert.equal(write(inspectionKind, "i1", i1, place("2026-10-01T13:00:00Z", "2026-10-01T14:00:00Z", some({ kind: "people", key: "p1" }))).type, "none");
    });

    test("`place` puts a kind on no resource on none, its Option times held as `some`, and refuses a resource", () => {
        const t1 = encodeBeast2For(TaskType)(TASKS.get("t1")!);
        const out = write(taskKind, "t1", t1, place("2026-10-01T08:00:00Z", "2026-10-01T09:30:00Z", none));
        if (out.type !== "some") assert.fail("expected the task placed");
        assert.ok(equalFor(TaskType)(decodeBeast2For(TaskType)(out.value),
            { ...TASKS.get("t1")!, start: some(at("2026-10-01T08:00:00Z")), end: some(at("2026-10-01T09:30:00Z")) }));
        assert.equal(write(taskKind, "t1", t1, place("2026-10-01T08:00:00Z", "2026-10-01T09:30:00Z", some({ kind: "people", key: "p1" }))).type, "none");
    });

    test("`unplace` sends an Option-timed event back to the backlog, and is refused on plain times", () => {
        const j1 = encodeBeast2For(JobType)(JOBS.get("j1")!);
        const out = write(jobKind, "j1", j1, variant("unplace", null));
        if (out.type !== "some") assert.fail("expected the job unscheduled");
        const job = decodeJob(out.value);
        assert.deepEqual([job.start.type, job.end.type, job.title], ["none", "none", "Bearing swap"]);
        assert.equal(write(shiftKind, "s1", s1, variant("unplace", null)).type, "none");
    });

    test("`field` writes a value at its path, a nested struct's field included", () => {
        const title = write(shiftKind, "s1", s1, variant("field", { path: ["title"], value: encodeBeast2For(StringType)("Early shift") }));
        if (title.type !== "some") assert.fail("expected the title written");
        assert.equal(decodeShift(title.value).title, "Early shift");
        const i1 = encodeBeast2For(InspectionType)(INSPECTIONS.get("i1")!);
        const phone = write(inspectionKind, "i1", i1, variant("field", { path: ["contact", "phone"], value: encodeBeast2For(StringType)("0400 000 002") }));
        if (phone.type !== "some") assert.fail("expected the phone written");
        assert.deepEqual(decodeInspection(phone.value).contact, { name: "Cal Moss", phone: "0400 000 002" });
        assert.equal(write(shiftKind, "s1", s1, variant("field", { path: ["nope"], value: encodeBeast2For(StringType)("x") })).type, "none");
    });

    test("`field` names a field by its steps: a field named with a dot is not the struct's field it reads like", () => {
        const v1 = encodeBeast2For(VisitType)(VISITS.get("v1")!);
        const phone = encodeBeast2For(StringType)("0400 000 009");
        const top = write(visitKind, "v1", v1, variant("field", { path: ["contact.phone"], value: phone }));
        if (top.type !== "some") assert.fail("expected the dotted field written");
        const topVisit = decodeBeast2For(VisitType)(top.value);
        assert.deepEqual([topVisit["contact.phone"], topVisit.contact.phone], ["0400 000 009", "0400 000 004"]);
        const nested = write(visitKind, "v1", v1, variant("field", { path: ["contact", "phone"], value: phone }));
        if (nested.type !== "some") assert.fail("expected the struct's field written");
        const nestedVisit = decodeBeast2For(VisitType)(nested.value);
        assert.deepEqual([nestedVisit["contact.phone"], nestedVisit.contact.phone], ["0400 000 003", "0400 000 009"]);
    });

    test("`create` builds a new event from its template's values and the placement; an unknown template is refused", () => {
        const out = write(shiftKind, "s9", new Uint8Array(), variant("create", {
            template: "day", start: at("2026-10-02T06:00:00Z"), end: at("2026-10-02T14:00:00Z"), resource: some({ kind: "people", key: "p2" }),
        }));
        if (out.type !== "some") assert.fail("expected the shift created");
        assert.ok(shiftEqual(decodeShift(out.value), {
            title: "Day shift", start: at("2026-10-02T06:00:00Z"), end: at("2026-10-02T14:00:00Z"), person: some("p2"),
            status: variant("tentative", null), crew: 1n, skills: NO_SKILLS, handover: [],
        }));
        assert.equal(write(shiftKind, "s9", new Uint8Array(), variant("create", {
            template: "night", start: at("2026-10-02T06:00:00Z"), end: at("2026-10-02T14:00:00Z"), resource: none,
        })).type, "none");
    });
});

describe("Schedule.events — the author's check", () => {
    test("checks each drafted entry in order, and a check that throws refuses its own entry alone", () => {
        if (jobKind.ready.type !== "some") assert.fail("expected the job kind's check");
        const job = (patch: Partial<Job>) => ({ id: "j9", entry: encodeBeast2For(JobType)({ ...JOBS.get("j1")!, ...patch }) });
        const [missing, fine, broken] = jobKind.ready.value([job({ work_order: "" }), job({}), job({ title: "Explode" })]);
        assert.equal(missing!.type, "incomplete");
        assert.equal(fine!.type, "ready");
        assert.equal(broken!.type, "invalid");
        assert.equal(shiftKind.ready.type, "none", "a kind with no `ready` has no check");
    });
});

describe("Schedule.events — the shared session over the record", () => {
    test("drafts whole entries keyed by the record's key, its snapshot the record, an entry read by its key", () => {
        const editing = shiftKind.editing;
        assert.equal(editing.sourceId, "schedule_spec_shifts");
        assert.equal(editing.keyType.type, "some");
        assert.equal(editing.idField.type, "none");
        if (editing.snapshot.type !== "some") assert.fail("expected the record as the snapshot");
        assert.ok(equalFor(Shifts)(decodeBeast2For(Shifts)(editing.snapshot.value), SHIFTS));
        const read = editing.readEntry("s2", 0n);
        if (read.type !== "some") assert.fail("expected s2 read by its key");
        assert.ok(shiftEqual(decodeShift(read.value), SHIFTS.get("s2")!));
        assert.equal(editing.readEntry("s7", 0n).type, "none");
        assert.equal(editing.mode.type, "batch");
    });

    test("commits each Apply through the record's patch door, keyed", async () => {
        const apply = shiftKind.editing.onApply;
        if (apply.type !== "some" || apply.value.type !== "async") assert.fail("expected an async Apply");
        const batch = encodeBeast2For(Editing.Types.ChangeSet(ShiftType, StringType))({
            requestId: "move-s1", base: variant("revision", "state-0"), label: "Move a shift",
            changes: [{ id: "s1", patch: variant("replace", { before: some(SHIFTS.get("s1")!), after: some({ ...SHIFTS.get("s1")!, crew: 2n }) }), place: none }],
        } as never);
        const result = await apply.value.value(batch);
        assert.ok(equalFor(Editing.Types.ApplyResult)(result, variant("applied", { revision: some("state-1") })));
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
            Schedule.events($.const(SHIFTS, Shifts) as never, { name: "Shift", icon: "i", title: "title", start: "start", end: "end" } as never);
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
