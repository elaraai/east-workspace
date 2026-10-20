/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Schedule.events` (#1218) over Calendar Spec §3.1's records on e3 itself
 * (#1379): shifts on people, maintenance jobs on machines with a backlog,
 * inspections on a site or a machine, tasks and visits, each a record of
 * Schedule's example module bound as an app binds it, `Record.bind(record,
 * [e3.mutation.patch(record)])`. Each kind is built against the platform a UI
 * task's preview gives it, so the record it reads is e3's, and its seams run:
 * its events over a window with the drafts in place, its backlog, a gesture
 * written into an entry, the author's check, and its editing session, whose
 * Apply commits through the record's patch door.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, East, OptionType, SetType, SortedMap, StringType, StructType, IntegerType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, none,
    some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Editing } from "@elaraai/east-ui/internal";
import { Record, Schedule } from "@elaraai/e3-ui/internal";
import { datasetGetStatus } from "@elaraai/e3-api-client";
import * as sx from "@elaraai/e3-ui/examples/schedule/schedule";
import { e3Spec } from "./fixtures/e3.js";

const h = e3Spec({ "schedule/schedule": sx });

/** An instant as its author writes it: UTC, with its zone. */
const at = (text: string): Date => new Date(text);

/** How a status shows, as an app binds it once. */
const STATUS_CASES = {
    tentative: { label: "Tentative", tone: variant("neutral", null), ring: true },
    confirmed: { label: "Confirmed", tone: variant("success", null), ring: false },
    in_progress: { label: "In progress", tone: variant("info", null), ring: false },
    done: { label: "Done", tone: variant("neutral", null), ring: false },
};
const NO_SKILLS = new Set<string>();

type Kind = ValueTypeOf<typeof Schedule.Types.Kind>;
type Item = ValueTypeOf<typeof Schedule.Types.Item>;
type Shift = ValueTypeOf<typeof sx.ScheduleShift>;
type Job = ValueTypeOf<typeof sx.ScheduleJob>;

/** The shift kind, built under its slot. */
const shiftProgram = East.function([], Schedule.Types.Kind, ($) => {
    const shifts = $.let(Record.bind(sx.scheduleShifts, [sx.scheduleShiftsPatch]));
    const status = $.let(STATUS_CASES, Schedule.Types.StatusCases(sx.ScheduleStatus));
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
});

/** The job kind: Option times, a backlog, a check on its work order. */
const jobProgram = East.function([], Schedule.Types.Kind, ($) => {
    const jobs = $.let(Record.bind(sx.scheduleJobs, [sx.scheduleJobsPatch]));
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
});

/** The inspection kind: a site or a machine, by its variant's case. */
const inspectionProgram = East.function([], Schedule.Types.Kind, ($) => {
    const inspections = $.let(Record.bind(sx.scheduleInspections, [sx.scheduleInspectionsPatch]));
    return Schedule.events(inspections, {
        name: "Inspection", icon: "clipboard-check",
        title: "title", start: "start", end: "end",
        resource: { field: "target", of: { site: "sites", machine: "machines" } },
    }).build("inspection");
});

/** The task kind: on no resource, each task's estimate in its own unit. */
const taskProgram = East.function([], Schedule.Types.Kind, ($) => {
    const tasks = $.let(Record.bind(sx.scheduleTasks, [sx.scheduleTasksPatch]));
    return Schedule.events(tasks, {
        name: "Task", icon: "list-check",
        title: "title", start: "start", end: "end",
        backlog: { duration: (task) => task.estimate },
    }).build("task");
});

/** The visit kind: a field named with a dot, beside the struct it reads like. */
const visitProgram = East.function([], Schedule.Types.Kind, ($) => {
    const visits = $.let(Record.bind(sx.scheduleVisits, [sx.scheduleVisitsPatch]));
    return Schedule.events(visits, { name: "Visit", icon: "door-open", title: "title", start: "start", end: "end" }).build("visit");
});

/**
 * A kind built over e3, as a UI task's preview builds it: its record loaded,
 * its East function compiled against the preview's platform and run.
 *
 * @param program - The kind's East function
 * @returns The kind
 */
async function built(program: typeof shiftProgram): Promise<Kind> {
    const { platform } = await h.platform(program);
    return East.compile(program, platform)();
}

const encodeShift = encodeBeast2For(sx.ScheduleShift);
const decodeShift = decodeBeast2For(sx.ScheduleShift);
const decodeJob = decodeBeast2For(sx.ScheduleJob);
const decodeInspection = decodeBeast2For(sx.ScheduleInspection);
const shiftEqual = equalFor(sx.ScheduleShift);
const shiftDraft = encodeBeast2For(Editing.Types.DraftField(sx.ScheduleShift));
const refEqual = equalFor(OptionType(Schedule.Types.ResourceRef));
const statusEqual = equalFor(OptionType(Schedule.Types.Status));

/** The drafts a seam reads, by entry id. */
const draftsOf = (entries: [string, Uint8Array][]) => new SortedMap(entries, compareFor(StringType));
const NO_DRAFTS = draftsOf([]);
/** The window a backlog read is beside: a kind no builder's slice narrows reads its backlog whole, whatever the window (#1343). */
const OCT_1 = [at("2026-10-01T00:00:00Z"), at("2026-10-02T00:00:00Z")] as const;

/** A window's items, in order. */
function itemsIn(kind: Kind, from: string, to: string, drafts = NO_DRAFTS): Item[] {
    const read = kind.items(at(from), at(to), drafts);
    if (read.type !== "some") assert.fail("expected the window read");
    return read.value;
}

describe("Schedule.events — the kind", () => {
    test("names itself, the resource kinds it takes, its status table and its backlog", async () => {
        const [shiftKind, jobKind, inspectionKind, taskKind] = [await built(shiftProgram), await built(jobProgram), await built(inspectionProgram), await built(taskProgram)];
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

    test("lists its templates: the card, its group, its start of day, its length and its values as bytes", async () => {
        const shiftKind = await built(shiftProgram);
        assert.equal(shiftKind.templates.length, 1);
        const day = shiftKind.templates[0]!;
        assert.equal(day.key, "day");
        assert.equal(day.name, "Day shift");
        assert.ok(equalFor(OptionType(StringType))(day.group, some("Operations")));
        assert.ok(equalFor(OptionType(Schedule.Types.Clock))(day.at, some({ hour: 6n, minute: 0n })));
        assert.ok(equalFor(Schedule.Types.Duration)(day.duration, variant("hours", 8)));
        const ValuesType = StructType({ title: StringType, status: sx.ScheduleStatus, crew: IntegerType, skills: SetType(StringType), handover: sx.ScheduleChecklist });
        assert.ok(equalFor(ValuesType)(decodeBeast2For(ValuesType)(day.values),
            { title: "Day shift", status: variant("tentative", null), crew: 1n, skills: NO_SKILLS, handover: [] }));
    });

    test("draws the inspector's form over the fields a gesture does not write, the hinted first", async () => {
        const [shiftKind, inspectionKind] = [await built(shiftProgram), await built(inspectionProgram)];
        assert.deepEqual(shiftKind.fields.map((f) => f.path.join(".")), ["crew", "skills", "handover"]);
        assert.equal(shiftKind.fields[0]!.label, "Crew size");
        assert.deepEqual(inspectionKind.fields.map((f) => f.path.join(".")), ["status", "contact.name", "contact.phone"]);
    });
});

describe("Schedule.events — its events over a window", () => {
    test("reads the events overlapping [from, to): one starting in it, and one that runs on past it", async () => {
        const shiftKind = await built(shiftProgram);
        const shifts = await h.read(sx.scheduleShifts);
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
        const handover = { ...shifts.get("s1")!, title: "Handover", start: at("2026-10-01T00:00:00Z"), end: at("2026-10-01T00:00:00Z") };
        const atStart = itemsIn(shiftKind, "2026-10-01T00:00:00Z", "2026-10-01T06:00:00Z", draftsOf([["s8", shiftDraft(variant("value", handover))]]));
        assert.deepEqual(atStart.map((i) => [i.key, i.minutes]), [["s8", 0n]]);
    });

    test("draws each draft in place: a move into the window shows, a deletion leaves, an unreadable draft keeps the record's", async () => {
        const shiftKind = await built(shiftProgram);
        const shifts = await h.read(sx.scheduleShifts);
        const moved = { ...shifts.get("s3")!, start: at("2026-10-01T15:00:00Z"), end: at("2026-10-01T19:00:00Z") };
        const drafts = draftsOf([
            ["s3", shiftDraft(variant("value", moved))],
            ["s1", shiftDraft(variant("missing", null))],
            ["s2", shiftDraft(variant("invalid", "not a shift"))],
        ]);
        const items = itemsIn(shiftKind, "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z", drafts);
        assert.deepEqual(items.map((i) => [i.key, i.minutes]), [["s2", 480n], ["s3", 240n]]);
    });

    test("draws a drafted event the record does not hold yet: a created one", async () => {
        const shiftKind = await built(shiftProgram);
        const shifts = await h.read(sx.scheduleShifts);
        const created = { ...shifts.get("s1")!, title: "Extra shift", start: at("2026-10-01T16:00:00Z"), end: at("2026-10-01T20:00:00Z") };
        const items = itemsIn(shiftKind, "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z", draftsOf([["s9", shiftDraft(variant("value", created))]]));
        assert.deepEqual(items.map((i) => [i.key, i.title]), [["s1", "Day shift"], ["s2", "Night shift"], ["s9", "Extra shift"]]);
    });

    test("names a resource by the variant's case: a site or a machine", async () => {
        const [walk] = itemsIn(await built(inspectionProgram), "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z");
        assert.ok(refEqual(walk!.resource, some({ kind: "sites", key: "north" })));
    });
});

describe("Schedule.events — its backlog", () => {
    test("holds the rows with no time, each sized by its duration and filed by its due date", async () => {
        const jobKind = await built(jobProgram);
        const read = jobKind.unscheduled(...OCT_1, NO_DRAFTS);
        if (read.type !== "some") assert.fail("expected the backlog");
        assert.deepEqual(read.value.map((i) => [i.key, i.minutes, i.start.type, i.due.type]), [["j2", 150n, "none", "some"], ["j3", 60n, "none", "none"]]);
        // The window holds only the scheduled job.
        assert.deepEqual(itemsIn(jobKind, "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z").map((i) => [i.key, i.minutes]), [["j1", 120n]]);
    });

    test("sizes a row by its duration in any unit — a month counts 30 days", async () => {
        const read = (await built(taskProgram)).unscheduled(...OCT_1, NO_DRAFTS);
        if (read.type !== "some") assert.fail("expected the backlog");
        assert.deepEqual(read.value.map((i) => [i.key, i.minutes]), [["t1", 90n], ["t2", 90n], ["t3", 2_880n], ["t4", 10_080n], ["t5", 43_200n]]);
    });

    test("is empty for a kind whose times are plain", async () => {
        const read = (await built(shiftProgram)).unscheduled(...OCT_1, NO_DRAFTS);
        if (read.type !== "some") assert.fail("expected the backlog");
        assert.deepEqual(read.value, []);
    });
});

describe("Schedule.events — a gesture written into an entry", () => {
    const write = (kind: Kind, id: string, entry: Uint8Array, gesture: ValueTypeOf<typeof Schedule.Types.Gesture>) => {
        const [out] = kind.write([{ id, entry, gesture }]);
        return out!;
    };
    const place = (start: string, end: string, resource: ValueTypeOf<OptionType<typeof Schedule.Types.ResourceRef>>) =>
        variant("place", { start: at(start), end: at(end), resource });
    /** s1 as e3 holds it, and as bytes. */
    const s1 = async (): Promise<[Shift, Uint8Array]> => {
        const shift = (await h.read(sx.scheduleShifts)).get("s1")!;
        return [shift, encodeShift(shift)];
    };

    test("`place` writes the times and the resource's key", async () => {
        const shiftKind = await built(shiftProgram);
        const [shift, entry] = await s1();
        const out = write(shiftKind, "s1", entry, place("2026-10-01T08:00:00Z", "2026-10-01T16:00:00Z", some({ kind: "people", key: "p2" })));
        if (out.type !== "some") assert.fail("expected the shift placed");
        assert.ok(shiftEqual(decodeShift(out.value), { ...shift, start: at("2026-10-01T08:00:00Z"), end: at("2026-10-01T16:00:00Z"), person: some("p2") }));
        // No resource unassigns an Option field.
        const off = write(shiftKind, "s1", entry, place("2026-10-01T08:00:00Z", "2026-10-01T16:00:00Z", none));
        if (off.type !== "some") assert.fail("expected the shift unassigned");
        assert.equal(decodeShift(off.value).person.type, "none");
    });

    test("`place` refuses a resource of a kind the event kind does not take", async () => {
        const [, entry] = await s1();
        assert.equal(write(await built(shiftProgram), "s1", entry, place("2026-10-01T08:00:00Z", "2026-10-01T16:00:00Z", some({ kind: "machines", key: "m1" }))).type, "none");
    });

    test("`place` writes a variant's case for the resource's kind, and refuses a kind with no case", async () => {
        const inspectionKind = await built(inspectionProgram);
        const i1 = encodeBeast2For(sx.ScheduleInspection)((await h.read(sx.scheduleInspections)).get("i1")!);
        const out = write(inspectionKind, "i1", i1, place("2026-10-01T13:00:00Z", "2026-10-01T14:00:00Z", some({ kind: "machines", key: "m2" })));
        if (out.type !== "some") assert.fail("expected the inspection placed");
        assert.ok(equalFor(sx.ScheduleInspection.fields.target)(decodeInspection(out.value).target, some(variant("machine", "m2"))));
        assert.equal(write(inspectionKind, "i1", i1, place("2026-10-01T13:00:00Z", "2026-10-01T14:00:00Z", some({ kind: "people", key: "p1" }))).type, "none");
    });

    test("`place` puts a kind on no resource on none, its Option times held as `some`, and refuses a resource", async () => {
        const taskKind = await built(taskProgram);
        const task = (await h.read(sx.scheduleTasks)).get("t1")!;
        const t1 = encodeBeast2For(sx.ScheduleTask)(task);
        const out = write(taskKind, "t1", t1, place("2026-10-01T08:00:00Z", "2026-10-01T09:30:00Z", none));
        if (out.type !== "some") assert.fail("expected the task placed");
        assert.ok(equalFor(sx.ScheduleTask)(decodeBeast2For(sx.ScheduleTask)(out.value),
            { ...task, start: some(at("2026-10-01T08:00:00Z")), end: some(at("2026-10-01T09:30:00Z")) }));
        assert.equal(write(taskKind, "t1", t1, place("2026-10-01T08:00:00Z", "2026-10-01T09:30:00Z", some({ kind: "people", key: "p1" }))).type, "none");
    });

    test("`unplace` sends an Option-timed event back to the backlog, and is refused on plain times", async () => {
        const jobKind = await built(jobProgram);
        const j1 = encodeBeast2For(sx.ScheduleJob)((await h.read(sx.scheduleJobs)).get("j1")!);
        const out = write(jobKind, "j1", j1, variant("unplace", null));
        if (out.type !== "some") assert.fail("expected the job unscheduled");
        const job = decodeJob(out.value);
        assert.deepEqual([job.start.type, job.end.type, job.title], ["none", "none", "Bearing swap"]);
        const [, entry] = await s1();
        assert.equal(write(await built(shiftProgram), "s1", entry, variant("unplace", null)).type, "none");
    });

    test("`field` writes a value at its path, a nested struct's field included", async () => {
        const shiftKind = await built(shiftProgram);
        const [, entry] = await s1();
        const title = write(shiftKind, "s1", entry, variant("field", { path: ["title"], value: encodeBeast2For(StringType)("Early shift") }));
        if (title.type !== "some") assert.fail("expected the title written");
        assert.equal(decodeShift(title.value).title, "Early shift");
        const i1 = encodeBeast2For(sx.ScheduleInspection)((await h.read(sx.scheduleInspections)).get("i1")!);
        const phone = write(await built(inspectionProgram), "i1", i1, variant("field", { path: ["contact", "phone"], value: encodeBeast2For(StringType)("0400 000 002") }));
        if (phone.type !== "some") assert.fail("expected the phone written");
        assert.deepEqual(decodeInspection(phone.value).contact, { name: "Cal Moss", phone: "0400 000 002" });
        assert.equal(write(shiftKind, "s1", entry, variant("field", { path: ["nope"], value: encodeBeast2For(StringType)("x") })).type, "none");
    });

    test("`field` names a field by its steps: a field named with a dot is not the struct's field it reads like", async () => {
        const visitKind = await built(visitProgram);
        const v1 = encodeBeast2For(sx.ScheduleVisit)((await h.read(sx.scheduleVisits)).get("v1")!);
        const phone = encodeBeast2For(StringType)("0400 000 009");
        const top = write(visitKind, "v1", v1, variant("field", { path: ["contact.phone"], value: phone }));
        if (top.type !== "some") assert.fail("expected the dotted field written");
        const topVisit = decodeBeast2For(sx.ScheduleVisit)(top.value);
        assert.deepEqual([topVisit["contact.phone"], topVisit.contact.phone], ["0400 000 009", "0400 000 004"]);
        const nested = write(visitKind, "v1", v1, variant("field", { path: ["contact", "phone"], value: phone }));
        if (nested.type !== "some") assert.fail("expected the struct's field written");
        const nestedVisit = decodeBeast2For(sx.ScheduleVisit)(nested.value);
        assert.deepEqual([nestedVisit["contact.phone"], nestedVisit.contact.phone], ["0400 000 003", "0400 000 009"]);
    });

    test("`create` builds a new event from its template's values and the placement; an unknown template is refused", async () => {
        const shiftKind = await built(shiftProgram);
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
    test("checks each drafted entry in order, and a check that throws refuses its own entry alone", async () => {
        const jobKind = await built(jobProgram);
        if (jobKind.ready.type !== "some") assert.fail("expected the job kind's check");
        const j1 = (await h.read(sx.scheduleJobs)).get("j1")!;
        const job = (patch: Partial<Job>) => ({ id: "j9", entry: encodeBeast2For(sx.ScheduleJob)({ ...j1, ...patch }) });
        const [missing, fine, broken] = jobKind.ready.value([job({ work_order: "" }), job({}), job({ title: "Explode" })]);
        assert.equal(missing!.type, "incomplete");
        assert.equal(fine!.type, "ready");
        assert.equal(broken!.type, "invalid");
        assert.equal((await built(shiftProgram)).ready.type, "none", "a kind with no `ready` has no check");
    });
});

describe("Schedule.events — the shared session over the record", () => {
    test("drafts whole entries keyed by the record's key, its snapshot the record, an entry read by its key", async () => {
        const editing = (await built(shiftProgram)).editing;
        const shifts = await h.read(sx.scheduleShifts);
        assert.equal(editing.sourceId, "schedule_shifts");
        assert.equal(editing.keyType.type, "some");
        assert.equal(editing.idField.type, "none");
        if (editing.snapshot.type !== "some") assert.fail("expected the record as the snapshot");
        assert.ok(equalFor(sx.scheduleShifts.type)(decodeBeast2For(sx.scheduleShifts.type)(editing.snapshot.value), shifts), "the snapshot is what e3 holds");
        const read = editing.readEntry("s2", 0n);
        if (read.type !== "some") assert.fail("expected s2 read by its key");
        assert.ok(shiftEqual(decodeShift(read.value), shifts.get("s2")!));
        assert.equal(editing.readEntry("s7", 0n).type, "none");
        assert.equal(editing.mode.type, "batch");
    });

    test("commits each Apply through the record's patch door, keyed, at the state it writes", async () => {
        const apply = (await built(shiftProgram)).editing.onApply;
        if (apply.type !== "some" || apply.value.type !== "async") assert.fail("expected an async Apply");
        const s1 = (await h.read(sx.scheduleShifts)).get("s1")!;
        const batch = encodeBeast2For(Editing.Types.ChangeSet(sx.ScheduleShift, StringType))({
            requestId: "move-s1", base: variant("revision", "state-0"), label: "Move a shift",
            changes: [{ id: "s1", patch: variant("replace", { before: some(s1), after: some({ ...s1, crew: 2n }) }), place: none }],
        } as never);
        const result = await apply.value.value(batch);
        const status = await datasetGetStatus(h.e3.apiUrl, h.e3.repo, h.workspace, sx.scheduleShifts.path, h.e3.direct);
        assert.equal(status.hash.type, "some");
        assert.ok(equalFor(Editing.Types.ApplyResult)(result, variant("applied", { revision: some(status.hash.value!) })), "applied at the state e3 holds now");
        assert.equal((await h.read(sx.scheduleShifts)).get("s1")!.crew, 2n, "the commit is e3's");
    });
});
