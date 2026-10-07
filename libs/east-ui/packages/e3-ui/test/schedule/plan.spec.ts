/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Schedule`'s Plan options (#1190, `Plan Builder Spec.md` §4.1, §4.2,
 * PB4–PB7), over the print works' records (§3.1): each option resolved — how
 * a kind draws, an instant kind's `at`, the lifecycle, quantity, lane and
 * verdict its events carry, the kind's own inspector (PB60, #1197), a resource
 * kind's groups, nesting, gutter, fold, rollup, measures and window — the
 * Calendar's kinds unchanged with Plan's options present, each refusal at
 * build, and each mistyped name failing to compile.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, BlobType, DateTimeType, DictType, East, FloatType, FunctionType, NullType, OptionType, SortedMap, StringType, StructType,
    VariantType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { ApprovalStateType, EventStateType, Format, StatusValueType, UIComponentType } from "@elaraai/east-ui";
import { EditingDraftFieldType, Text, TickFormatType } from "@elaraai/east-ui/internal";
import { Data, Plan, Record, Schedule } from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import { memoryRecords } from "./memory-records.js";

// ============================================================================
// The print works (Plan Builder Spec §3.1)
// ============================================================================

const PressType = StructType({ name: StringType, hall: StringType, sheets_per_hour: FloatType });
const CrewType = StructType({ name: StringType, hall: StringType });
const JobType = StructType({
    title: StringType,
    start: OptionType(DateTimeType),
    end: OptionType(DateTimeType),
    press: OptionType(StringType),
    state: EventStateType,
    sheets: FloatType,
    verdict: ApprovalStateType,
    customer: StringType,
    stock: VariantType({ coated: NullType, uncoated: NullType, board: NullType }),
    due: OptionType(DateTimeType),
});
const StopType = StructType({ title: StringType, at: DateTimeType, press: StringType, kind: VariantType({ plate_change: NullType, service: NullType }) });
const ShiftType = StructType({ title: StringType, start: DateTimeType, end: DateTimeType, crew: StringType, state: EventStateType });
// A delivery is one instant at a press, in the morning's lane or the afternoon's.
const DeliveryType = StructType({ title: StringType, at: DateTimeType, press: StringType, slot: StringType });
// A press whose rows carry a verdict, for a measure that would write one.
const ReviewedPressType = StructType({ name: StringType, hall: StringType, verdict: ApprovalStateType });

const Presses = DictType(StringType, PressType);
const Crews = DictType(StringType, CrewType);
const ReviewedPresses = DictType(StringType, ReviewedPressType);

type Press = ValueTypeOf<typeof PressType>;
type Job = ValueTypeOf<typeof JobType>;
type Stop = ValueTypeOf<typeof StopType>;
type Shift = ValueTypeOf<typeof ShiftType>;
type Delivery = ValueTypeOf<typeof DeliveryType>;

/** An instant as its author writes it: UTC, with its zone. */
const at = (text: string): Date => new Date(text);

const PRESSES = new SortedMap<string, Press>([
    ["pa", { name: "Press A", hall: "Hall 1", sheets_per_hour: 12000 }],
    ["pb", { name: "Press B", hall: "Hall 1", sheets_per_hour: 9000 }],
    ["pc", { name: "Press C", hall: "Hall 2", sheets_per_hour: 15000 }],
], compareFor(StringType));
const CREWS = new SortedMap([["c1", { name: "Crew 1", hall: "Hall 1" }]], compareFor(StringType));
const REVIEWED_PRESSES = new SortedMap([["pa", { name: "Press A", hall: "Hall 1", verdict: variant("pending", null) }]], compareFor(StringType));
const JOBS = new SortedMap<string, Job>([
    ["j1", { title: "Brochure run", start: some(at("2026-10-05T06:00:00Z")), end: some(at("2026-10-05T12:00:00Z")), press: some("pa"),
        state: variant("proposed", variant("added", null)), sheets: 40000, verdict: variant("pending", null), customer: "Harbour Lane Books",
        stock: variant("coated", null), due: none }],
    ["j2", { title: "Catalogue run", start: none, end: none, press: none,
        state: variant("estimated", null), sheets: 24000, verdict: variant("approved", null), customer: "Fernhill Garden Club",
        stock: variant("uncoated", null), due: some(at("2026-10-09T00:00:00Z")) }],
], compareFor(StringType));
const STOPS = new SortedMap<string, Stop>([
    ["s1", { title: "Plate change", at: at("2026-10-05T12:00:00Z"), press: "pa", kind: variant("plate_change", null) }],
], compareFor(StringType));
const SHIFTS = new SortedMap<string, Shift>([
    ["h1", { title: "Early", start: at("2026-10-05T06:00:00Z"), end: at("2026-10-05T14:00:00Z"), crew: "c1", state: variant("confirmed", null) }],
], compareFor(StringType));
const DELIVERIES = new SortedMap<string, Delivery>([
    ["d1", { title: "Van to depot", at: at("2026-10-05T09:00:00Z"), press: "pb", slot: "AM" }],
], compareFor(StringType));

const pressesRecord = e3.record("plan_spec_presses", Presses, new Map());
const crewsRecord = e3.record("plan_spec_crews", Crews, new Map());
const jobsRecord = e3.record("plan_spec_jobs", DictType(StringType, JobType), new Map());
const stopsRecord = e3.record("plan_spec_stops", DictType(StringType, StopType), new Map());
const shiftsRecord = e3.record("plan_spec_shifts", DictType(StringType, ShiftType), new Map());
const deliveriesRecord = e3.record("plan_spec_deliveries", DictType(StringType, DeliveryType), new Map());
const jobsPatch = e3.mutation.patch(jobsRecord);
const stopsPatch = e3.mutation.patch(stopsRecord);
const shiftsPatch = e3.mutation.patch(shiftsRecord);
const deliveriesPatch = e3.mutation.patch(deliveriesRecord);

/** `Record.bind`, in memory, over the print works' records. */
const PLATFORM = memoryRecords(new Map<string, unknown>([
    ["plan_spec_jobs", JOBS],
    ["plan_spec_stops", STOPS],
    ["plan_spec_shifts", SHIFTS],
    ["plan_spec_deliveries", DELIVERIES],
]));

type PlanKind = ValueTypeOf<typeof Schedule.Types.PlanKind>;
type PlanItem = ValueTypeOf<typeof Schedule.Types.PlanItem>;
type Kind = ValueTypeOf<typeof Schedule.Types.Kind>;

/** How a job's sheets print: whole numbers. */
const SHEETS_FORMAT = East.compile(East.function([], TickFormatType, (_$) => Format.Number({ maximumFractionDigits: 0n })), [])();

/** The print job kind as Plan takes it: bars, its lifecycle, its sheets, its verdict and its backlog. */
const jobKind = East.compile(East.function([], Schedule.Types.PlanKind, ($) => {
    const jobs = $.let(Record.bind(jobsRecord, [jobsPatch]));
    return Schedule.events(jobs, {
        name: "Print job", icon: "file-lines", draw: "span",
        title: "title", start: "start", end: "end",
        resource: { field: "press", of: "presses" },
        state: "state", review: "verdict",
        quantity: { field: "sheets", unit: "sheets", format: Format.Number({ maximumFractionDigits: 0n }) },
        backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
    }).buildPlan("job");
}), PLATFORM)() as PlanKind;

/** The stop kind: one instant each, drawn as marks, a plate change dropped from the library. */
const stopKind = East.compile(East.function([], Schedule.Types.PlanKind, ($) => {
    const stops = $.let(Record.bind(stopsRecord, [stopsPatch]));
    return Schedule.events(stops, {
        name: "Stop", icon: "screwdriver-wrench", draw: "marks",
        title: "title", at: "at",
        resource: { field: "press", of: "presses" },
        templates: [{ key: "plates", name: "Plate change", group: "Stops", values: { title: "Plate change", kind: variant("plate_change", null) } }],
    }).buildPlan("stop");
}), PLATFORM)() as PlanKind;

/** A stop's own inspector: its title, and a button that marks it checked through its writer. */
const stopInspector = East.function([StopType, FunctionType([StopType], NullType)], UIComponentType, ($, stop, update) => {
    $(update({ title: stop.title.concat(" — checked"), at: stop.at, press: stop.press, kind: stop.kind }));
    return Text.Root(stop.title);
});

/** The stop kind with its own inspector. */
const inspectedStopKind = East.compile(East.function([], Schedule.Types.PlanKind, ($) => {
    const stops = $.let(Record.bind(stopsRecord, [stopsPatch]));
    return Schedule.events(stops, {
        name: "Stop", icon: "screwdriver-wrench", draw: "marks",
        title: "title", at: "at",
        resource: { field: "press", of: "presses" },
        inspector: stopInspector,
    }).buildPlan("stop");
}), PLATFORM)() as PlanKind;

/** The delivery kind: instants drawn as tiles in their lanes, which may share a press at once. */
const deliveryKind = East.compile(East.function([], Schedule.Types.PlanKind, ($) => {
    const deliveries = $.let(Record.bind(deliveriesRecord, [deliveriesPatch]));
    return Schedule.events(deliveries, {
        name: "Delivery", icon: "truck", draw: "buckets",
        title: "title", at: "at",
        resource: { field: "press", of: "presses" },
        lane: "slot", overlaps: "allow",
    }).buildPlan("delivery");
}), PLATFORM)() as PlanKind;

/** The crew shift kind: chips, their lifecycle read from the shift. */
const shiftKind = East.compile(East.function([], Schedule.Types.PlanKind, ($) => {
    const shifts = $.let(Record.bind(shiftsRecord, [shiftsPatch]));
    return Schedule.events(shifts, {
        name: "Crew shift", icon: "user-clock", draw: "cards",
        title: "title", start: "start", end: "end",
        resource: { field: "crew", of: "crews" }, state: "state",
    }).buildPlan("shift");
}), PLATFORM)() as PlanKind;

/** The crew shift kind with none of Plan's options. */
const plainShiftKind = East.compile(East.function([], Schedule.Types.PlanKind, ($) => {
    const shifts = $.let(Record.bind(shiftsRecord, [shiftsPatch]));
    return Schedule.events(shifts, {
        name: "Crew shift", icon: "user-clock",
        title: "title", start: "start", end: "end",
        resource: { field: "crew", of: "crews" },
    }).buildPlan("shift");
}), PLATFORM)() as PlanKind;

const NO_DRAFTS = new SortedMap<string, Uint8Array>([], compareFor(StringType));
const DAY = ["2026-10-05T00:00:00Z", "2026-10-06T00:00:00Z"] as const;
const itemEqual = equalFor(Schedule.Types.PlanItem);
const rolesEqual = equalFor(Schedule.Types.PlanRoles);

/** A kind's events on 5 October, as Plan draws them. */
function onTheFifth(kind: PlanKind): PlanItem[] {
    const read = kind.planItems(at(DAY[0]), at(DAY[1]), NO_DRAFTS);
    if (read.type !== "some") assert.fail("expected the window read");
    return read.value;
}

// ============================================================================
// Schedule.events — Plan's options
// ============================================================================

describe("Schedule.events — Plan's options (PB5)", () => {
    test("builds the Calendar's kind, with how it draws, its roles' fields and whether its overlaps warn", () => {
        assert.equal(jobKind.key, "job");
        assert.deepEqual(jobKind.takes, ["presses"]);
        assert.equal(jobKind.backlog, true);
        assert.equal(jobKind.draw.type, "span");
        assert.equal(jobKind.instant, false);
        assert.equal(jobKind.overlaps.type, "warn");
        assert.ok(rolesEqual(jobKind.roles, { state: some("state"), quantity: some("sheets"), lane: none, review: some("verdict") }));
    });

    test("draws each event with the lifecycle it wears, its quantity in its unit and format, and its verdict", () => {
        const [run] = onTheFifth(jobKind);
        assert.ok(itemEqual(run!, {
            kind: "job", key: "j1", title: "Brochure run",
            start: some(at("2026-10-05T06:00:00Z")), end: some(at("2026-10-05T12:00:00Z")),
            resource: some({ kind: "presses", key: "pa" }), status: none, minutes: 360n, due: none,
            state: variant("proposed", variant("added", null)),
            quantity: some({ value: 40000, unit: some("sheets"), format: some(SHEETS_FORMAT), text: none }),
            lane: none, verdict: some(variant("pending", null)),
        }));
    });

    test("draws its backlog the same way, each row sized by its duration", () => {
        const read = jobKind.planUnscheduled(NO_DRAFTS);
        if (read.type !== "some") assert.fail("expected the backlog");
        assert.deepEqual(read.value.map((i) => i.key), ["j2"]);
        const [waiting] = read.value;
        assert.equal(waiting!.minutes, 180n);
        assert.ok(equalFor(EventStateType)(waiting!.state, variant("estimated", null)));
        assert.ok(equalFor(OptionType(ApprovalStateType))(waiting!.verdict, some(variant("approved", null))));
    });

    test("a kind with none of Plan's options draws bars, warns of overlaps, and its events wear confirmed", () => {
        assert.equal(plainShiftKind.draw.type, "span");
        assert.equal(plainShiftKind.overlaps.type, "warn");
        assert.ok(rolesEqual(plainShiftKind.roles, { state: none, quantity: none, lane: none, review: none }));
        const [early] = onTheFifth(plainShiftKind);
        assert.ok(equalFor(EventStateType)(early!.state, variant("confirmed", null)));
        assert.deepEqual([early!.quantity.type, early!.lane.type, early!.verdict.type], ["none", "none", "none"]);
    });

    test("reads one event by its key — as Plan draws it, and its row — with its draft in place; none for a key there is no event of (#1197)", () => {
        const read = jobKind.planEvent("j1", NO_DRAFTS);
        if (read.type !== "some") assert.fail("expected the job read");
        const [run] = onTheFifth(jobKind);
        assert.ok(itemEqual(read.value.item, run!));
        assert.ok(equalFor(JobType)(decodeBeast2For(JobType)(read.value.row), JOBS.get("j1")!));
        assert.equal(jobKind.planEvent("j9", NO_DRAFTS).type, "none");
        // A draft in place: an edited job reads as drafted, a deleted one as none, and one drafted new as itself.
        const encodeDraft = encodeBeast2For(EditingDraftFieldType(JobType));
        const reprint = { ...JOBS.get("j1")!, title: "Brochure reprint" };
        const drafts = new SortedMap<string, Uint8Array>([
            ["j1", encodeDraft(variant("value", reprint))],
            ["j2", encodeDraft(variant("missing", null))],
            ["j3", encodeDraft(variant("value", { ...reprint, title: "Leaflet run" }))],
        ], compareFor(StringType));
        const edited = jobKind.planEvent("j1", drafts);
        if (edited.type !== "some") assert.fail("expected the drafted job");
        assert.equal(edited.value.item.title, "Brochure reprint");
        assert.ok(equalFor(JobType)(decodeBeast2For(JobType)(edited.value.row), reprint));
        assert.equal(jobKind.planEvent("j2", drafts).type, "none");
        const added = jobKind.planEvent("j3", drafts);
        if (added.type !== "some") assert.fail("expected the job drafted new");
        assert.deepEqual([added.value.item.key, added.value.item.title], ["j3", "Leaflet run"]);
    });

    test("a kind drawn as chips reads its lifecycle from its own field", () => {
        assert.equal(shiftKind.draw.type, "cards");
        const [early] = onTheFifth(shiftKind);
        assert.ok(equalFor(EventStateType)(early!.state, variant("confirmed", null)));
        assert.ok(rolesEqual(shiftKind.roles, { state: some("state"), quantity: none, lane: none, review: none }));
    });
});

describe("Schedule.events — an instant kind (`at`)", () => {
    test("each event is one time, its start and its end, drawn as marks; it has no backlog", () => {
        assert.equal(stopKind.instant, true);
        assert.equal(stopKind.draw.type, "marks");
        assert.equal(stopKind.backlog, false);
        const [plates] = onTheFifth(stopKind);
        assert.deepEqual([plates!.key, plates!.minutes], ["s1", 0n]);
        assert.ok(equalFor(OptionType(DateTimeType))(plates!.start, some(at("2026-10-05T12:00:00Z"))));
        assert.ok(equalFor(OptionType(DateTimeType))(plates!.end, some(at("2026-10-05T12:00:00Z"))));
    });

    test("a placement writes `at`, a move to the backlog is refused, and a template creates an event of no length", () => {
        const decode = decodeBeast2For(StopType);
        const s1 = encodeBeast2For(StopType)(STOPS.get("s1")!);
        const [moved] = stopKind.write([{ id: "s1", entry: s1, gesture: variant("place", {
            start: at("2026-10-05T15:00:00Z"), end: at("2026-10-05T15:00:00Z"), resource: some({ kind: "presses", key: "pc" }),
        }) }]);
        if (moved!.type !== "some") assert.fail("expected the stop placed");
        assert.ok(equalFor(StopType)(decode(moved!.value), { ...STOPS.get("s1")!, at: at("2026-10-05T15:00:00Z"), press: "pc" }));
        const [unplaced] = stopKind.write([{ id: "s1", entry: s1, gesture: variant("unplace", null) }]);
        assert.equal(unplaced!.type, "none");
        const [created] = stopKind.write([{ id: "s9", entry: new Uint8Array(), gesture: variant("create", {
            template: "plates", start: at("2026-10-06T07:00:00Z"), end: at("2026-10-06T07:00:00Z"), resource: some({ kind: "presses", key: "pb" }),
        }) }]);
        if (created!.type !== "some") assert.fail("expected the plate change created");
        assert.ok(equalFor(StopType)(decode(created!.value), { title: "Plate change", at: at("2026-10-06T07:00:00Z"), press: "pb", kind: variant("plate_change", null) }));
        const [template] = stopKind.templates;
        assert.ok(equalFor(Schedule.Types.Duration)(template!.duration, variant("minutes", 0)));
    });

    test("drawn as tiles, each in its lane, the kind's overlaps allowed", () => {
        assert.equal(deliveryKind.draw.type, "buckets");
        assert.equal(deliveryKind.overlaps.type, "allow");
        const [van] = onTheFifth(deliveryKind);
        assert.ok(equalFor(OptionType(StringType))(van!.lane, some("AM")));
        assert.ok(rolesEqual(deliveryKind.roles, { state: none, quantity: none, lane: some("slot"), review: none }));
    });
});

describe("Schedule.events — the kind's own inspector (PB60)", () => {
    test("a kind given none has none: the inspector shows its form", () => {
        assert.equal(jobKind.inspector.type, "none");
        assert.equal(stopKind.inspector.type, "none");
    });

    test("given one, the event arrives as its own row, its UI is what the author's function returns, and its writer takes the edited row back", () => {
        if (inspectedStopKind.inspector.type !== "some") assert.fail("expected the kind's own inspector");
        const written: Uint8Array[] = [];
        const ui = inspectedStopKind.inspector.value(encodeBeast2For(StopType)(STOPS.get("s1")!), (bytes: Uint8Array) => { written.push(bytes); return null; });
        assert.ok(equalFor(UIComponentType)(ui, East.compile(East.function([], UIComponentType, () => Text.Root("Plate change")), [])()));
        assert.equal(written.length, 1, "one write");
        assert.ok(equalFor(StopType)(decodeBeast2For(StopType)(written[0]!), { ...STOPS.get("s1")!, title: "Plate change — checked" }));
    });
});

describe("Schedule.events — the Calendar's kind with Plan's options present (PB5)", () => {
    /** The job kind as the Calendar takes it, with or without Plan's options. */
    const calendarJobs = (withPlan: boolean) => East.compile(East.function([], Schedule.Types.Kind, ($) => {
        const jobs = $.let(Record.bind(jobsRecord, [jobsPatch]));
        const plan = withPlan
            ? {
                draw: "span" as const, state: "state" as const, review: "verdict" as const, quantity: { field: "sheets" as const, unit: "sheets" }, overlaps: "allow" as const,
                inspector: East.function([JobType, FunctionType([JobType], NullType)], UIComponentType, (_$2, job) => Text.Root(job.title)),
            }
            : {};
        return Schedule.events(jobs, {
            name: "Print job", icon: "file-lines",
            title: "title", start: "start", end: "end",
            resource: { field: "press", of: "presses" },
            backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
            templates: [{ key: "brochure", name: "Brochure run", group: "Jobs", duration: variant("hours", 6.0),
                values: { title: "Brochure run", state: variant("proposed", variant("added", null)), sheets: 40000.0,
                    verdict: variant("pending", null), customer: "", stock: variant("coated", null), due: none } }],
            ...plan,
        }).build("job");
    }), PLATFORM)() as Kind;

    test("draws exactly as it does without them: its fields, its events, its backlog and its writes", () => {
        const [plain, withPlan] = [calendarJobs(false), calendarJobs(true)];
        const fields = Schedule.Types.Kind.fields;
        for (const f of ["key", "name", "icon", "takes", "status", "backlog", "templates", "fields"] as const) {
            assert.ok(equalFor(fields[f])(plain[f] as never, withPlan[f] as never), `the kind's ${f}`);
        }
        const items = equalFor(OptionType(ArrayType(Schedule.Types.Item)));
        assert.ok(items(plain.items(at(DAY[0]), at(DAY[1]), NO_DRAFTS), withPlan.items(at(DAY[0]), at(DAY[1]), NO_DRAFTS)));
        assert.ok(items(plain.unscheduled(NO_DRAFTS), withPlan.unscheduled(NO_DRAFTS)));
        const j1 = encodeBeast2For(JobType)(JOBS.get("j1")!);
        const request = [{ id: "j1", entry: j1, gesture: variant("place", {
            start: at("2026-10-05T08:00:00Z"), end: at("2026-10-05T14:00:00Z"), resource: some({ kind: "presses", key: "pb" }),
        }) }];
        assert.ok(equalFor(ArrayType(OptionType(BlobType)))(plain.write(request as never), withPlan.write(request as never)));
        assert.equal(plain.editing.sourceId, withPlan.editing.sourceId);
    });
});

// ============================================================================
// Schedule.resources — Plan's options
// ============================================================================

describe("Schedule.resources — Plan's options (PB5)", () => {
    const planRowEqual = equalFor(Schedule.Types.PlanResourceRow);
    const status = (s: "success") => some(variant(s, null));

    test("resolves each resource's group, the resource it nests under, its gutter and its fold, and the kind's rollup", () => {
        const presses = East.compile(East.function([], Schedule.Types.PlanResources, ($) => {
            const rows = $.const(PRESSES, Presses);
            return Schedule.resources(rows, {
                name: "Presses", icon: "print",
                label: (p) => p.name, group: (p) => p.hall,
                parent: (_p, key) => key.equal("pb").ifElse(() => East.value(some("pa"), OptionType(StringType)), () => East.value(none, OptionType(StringType))),
                sub: (p) => some(p.name), value: (_p, key) => some(key),
                status: (p) => p.sheets_per_hour.greater(10000.0).ifElse(
                    () => East.value(some(variant("success", null)), OptionType(StatusValueType)),
                    () => East.value(none, OptionType(StatusValueType))),
                collapsed: (p) => p.hall.equal("Hall 1"),
                rollup: "sum",
            }).buildPlan("presses");
        }), [])();
        assert.equal(presses.key, "presses");
        assert.equal(presses.rollup.type, "sum");
        assert.deepEqual(presses.measures, []);
        const [pa, pb, pc] = presses.rows;
        assert.ok(planRowEqual(pa!, { key: "pa", label: "Press A", meta: none, group: some("Hall 1"), parent: none, sub: some("Press A"), value: some("pa"), status: status("success"), collapsed: true }));
        assert.ok(planRowEqual(pb!, { key: "pb", label: "Press B", meta: none, group: some("Hall 1"), parent: some("pa"), sub: some("Press B"), value: some("pb"), status: none, collapsed: true }));
        assert.ok(planRowEqual(pc!, { key: "pc", label: "Press C", meta: none, group: some("Hall 2"), parent: none, sub: some("Press C"), value: some("pc"), status: status("success"), collapsed: false }));
    });

    test("with none of them: no group, no parent, an empty gutter, unfolded, and a union rollup; `collapsed: true` folds every row", () => {
        const build = (collapsed: boolean | undefined) => East.compile(East.function([], Schedule.Types.PlanResources, ($) => {
            const rows = $.const(CREWS, Crews);
            return Schedule.resources(rows, { name: "Crews", icon: "user-group", label: (c) => c.name, ...(collapsed === undefined ? {} : { collapsed }) }).buildPlan("crews");
        }), [])();
        const crews = build(undefined);
        assert.equal(crews.rollup.type, "union");
        assert.ok(planRowEqual(crews.rows[0]!, { key: "c1", label: "Crew 1", meta: none, group: none, parent: none, sub: none, value: none, status: none, collapsed: false }));
        assert.equal(build(true).rows[0]!.collapsed, true);
    });

    test("the Calendar's kind is unchanged with them present", () => {
        const build = (withPlan: boolean) => East.compile(East.function([], Schedule.Types.Resources, ($) => {
            const rows = $.const(PRESSES, Presses);
            return (withPlan
                ? Schedule.resources(rows, { name: "Presses", icon: "print", label: (p) => p.name, meta: (p) => some(p.hall), group: (p) => p.hall, collapsed: true, rollup: "byStatus" })
                : Schedule.resources(rows, { name: "Presses", icon: "print", label: (p) => p.name, meta: (p) => some(p.hall) })).build("presses");
        }), [])();
        assert.ok(equalFor(Schedule.Types.Resources)(build(false), build(true)));
    });

    test("keeps its measures in order, and a window over the resources' record", () => {
        East.function([], NullType, ($) => {
            const rows = $.const(PRESSES, Presses);
            const util = Plan.series.heat(PressType, { key: "util", title: "Utilisation", label: () => "Utilisation", cells: () => Plan.heatCells([], { min: 0, max: 100, warnAt: 95 }) });
            const output = Plan.series.table(PressType, { key: "output", title: "Output", label: () => "Output" });
            const trend = Plan.series.chart(PressType, { key: "trend", title: "Trend", label: () => "Trend", layers: () => [] });
            const window = $.let(Data.bindPaged(pressesRecord));
            const presses = Schedule.resources(rows, { name: "Presses", icon: "print", label: (p) => p.name, measures: [util, output, trend], window });
            assert.equal(presses.measures.length, 3);
            [util, output, trend].forEach((series, i) => { assert.equal(presses.measures[i], series, `measures[${i}] as declared`); });
            assert.ok(presses.window !== undefined);
            assert.equal(Schedule.resources(rows, { name: "Presses", icon: "print", label: (p) => p.name }).window, undefined);
        });
        // On the wire, the measures' keys in order: each lays its row out at its resource's path (#1197).
        const built = East.compile(East.function([], Schedule.Types.PlanResources, ($) => {
            const rows = $.const(PRESSES, Presses);
            const util = Plan.series.heat(PressType, { key: "util", title: "Utilisation", label: () => "Utilisation", cells: () => Plan.heatCells([], { min: 0, max: 100, warnAt: 95 }) });
            const output = Plan.series.table(PressType, { key: "output", title: "Output", label: () => "Output" });
            return Schedule.resources(rows, { name: "Presses", icon: "print", label: (p) => p.name, measures: [util, output] }).buildPlan("presses");
        }), [])();
        assert.deepEqual(built.measures, ["util", "output"]);
    });
});

// ============================================================================
// The refusals at build (PB6, PB7)
// ============================================================================

describe("Schedule.events — Plan's options refused at build (PB6)", () => {
    /** Declare a kind over `record` with `options` inside a bound block. */
    function kindOver(record: unknown, options: object): void {
        East.function([], NullType, ($) => {
            const def = record as typeof jobsRecord;
            const bound = $.let(Record.bind(def, [e3.mutation.patch(def)]));
            Schedule.events(bound as never, { name: "Kind", icon: "i", title: "title", ...options } as never);
        });
    }
    const times = { start: "start", end: "end" };

    test("an instant kind's `at`: given with `start` and `end`, neither given, or not a plain DateTime field", () => {
        assert.throws(() => kindOver(stopsRecord, { at: "at", ...times }), /`at` is an instant kind's one time, in place of `start` and `end` — give one or the other/);
        assert.throws(() => kindOver(stopsRecord, {}), /an event kind runs from `start` to `end` — DateTime fields, or Options of one — or is one instant, `at`/);
        assert.throws(() => kindOver(jobsRecord, { at: "start" }), /`at` names a DateTime field, an instant kind's one time — "start" holds an Option of \.DateTime/);
    });

    test("a `draw` that is not a way to draw, an instant drawn with two ends, and an `overlaps` that is neither warn nor allow", () => {
        assert.throws(() => kindOver(jobsRecord, { ...times, draw: "bars" }), /`draw` is "span", "buckets", "cards" or "marks" — and it is "bars"/);
        assert.throws(() => kindOver(stopsRecord, { at: "at", draw: "span" }), /`draw: "span"` draws an event from its start to its end, and an instant kind \(`at`\) has one time — draw it as "buckets" or "marks"/);
        assert.throws(() => kindOver(stopsRecord, { at: "at", draw: "cards" }), /`draw: "cards"` draws an event from its start to its end/);
        assert.throws(() => kindOver(jobsRecord, { ...times, overlaps: "sometimes" }), /`overlaps` is "warn" or "allow" — and it is "sometimes"/);
    });

    test("a `state`, `quantity`, `lane` or `review` field of another type", () => {
        assert.throws(() => kindOver(jobsRecord, { ...times, state: "verdict" }), /`state` names an EventStateType field, the lifecycle an event wears — "verdict" holds \.Variant/);
        assert.throws(() => kindOver(jobsRecord, { ...times, quantity: { field: "title" } }), /`quantity\.field` names a Float field, the quantity a bar prints — "title" holds \.String/);
        assert.throws(() => kindOver(jobsRecord, { ...times, lane: "sheets" }), /`lane` names a String field, the lane a tile sits in — "sheets" holds \.Float/);
        assert.throws(() => kindOver(jobsRecord, { ...times, review: "state" }), /`review` names an ApprovalStateType field, the verdict a review writes — "state" holds \.Variant/);
        assert.throws(() => kindOver(jobsRecord, { ...times, review: "approval" }), /`review` names "approval", a field the row does not have/);
    });

    test("an `inspector` over another row, or with no writer", () => {
        const refusal = /`inspector` is the kind's own inspector for one event — an East\.function over the event's row and its writer/;
        assert.throws(() => kindOver(jobsRecord, { ...times, inspector: stopInspector }), refusal);
        assert.throws(() => kindOver(stopsRecord, { at: "at", inspector: East.function([StopType], UIComponentType, (_$2, stop) => Text.Root(stop.title)) }), refusal);
    });

    test("a backlog on an instant, a span kind's template with no length, and an instant's template with one", () => {
        assert.throws(() => kindOver(stopsRecord, { at: "at", backlog: { duration: () => variant("hours", 1) } }),
            /`backlog` is a kind's rows with no time, and an instant kind's `at` is a plain DateTime field — it has none/);
        assert.throws(() => kindOver(shiftsRecord, { ...times, templates: [{ key: "early", name: "Early", values: { title: "Early", crew: "c1", state: variant("confirmed", null) } }] }),
            /template "early" gives its `duration` — how long the event it creates runs/);
        assert.throws(() => kindOver(stopsRecord, { at: "at", templates: [{ key: "plates", name: "Plate change", duration: variant("hours", 1), values: { title: "Plate change", press: "pa", kind: variant("plate_change", null) } }] }),
            /template "plates" gives a `duration`, and an instant kind's events are one time — leave it out/);
    });
});

describe("Schedule.resources — Plan's options refused at build (PB7)", () => {
    /** Declare a resource kind over `data` with `options` inside a block. */
    function resourcesOver(data: unknown, type: unknown, options: (block: { let: (v: unknown) => unknown }) => object): void {
        East.function([], NullType, ($) => {
            const rows = $.const(data as never, type as never);
            Schedule.resources(rows as never, { name: "Presses", icon: "print", label: (p: { name: unknown }) => p.name, ...options($ as never) } as never);
        });
    }
    const heat = (key: string, rowType: typeof PressType = PressType) =>
        Plan.series.heat(rowType, { key, title: "Utilisation", label: () => "Utilisation", cells: () => Plan.heatCells([], { min: 0, max: 100, warnAt: 95 }) });

    test("a `rollup` that is not a way to roll up", () => {
        assert.throws(() => resourcesOver(PRESSES, Presses, () => ({ rollup: "average" })), /`rollup` is "union", "byStatus" or "sum" — and it is "average"/);
    });

    test("a measure that declares `review`, naming Schedule.events", () => {
        assert.throws(() => resourcesOver(REVIEWED_PRESSES, ReviewedPresses, () => ({ measures: [
            Plan.series.heat(ReviewedPressType, { key: "util", title: "Utilisation", label: () => "Utilisation",
                cells: () => Plan.heatCells([], { min: 0, max: 100, warnAt: 95 }), review: { verdict: "verdict" } }),
        ] })), /measures\[0\], heat "Utilisation", declares `review` — a measure is read only, and a builder's edits go through its event kinds \(Schedule\.events\)/);
    });

    test("a measure that is not a heat, table or chart series, nests, is not written in place, is over other rows, or repeats a key", () => {
        assert.throws(() => resourcesOver(PRESSES, Presses, () => ({ measures: [
            Plan.series.span(PressType, { key: "runs", title: "Runs", label: () => "Runs", runs: () => [] }),
        ] })), /measures\[0\] is a span "Runs" series — a measure is a heat, table or chart series over the resources' rows/);
        assert.throws(() => resourcesOver(PRESSES, Presses, () => ({ measures: [
            Plan.series.heat(PressType, { key: "util", title: "Utilisation", label: () => "Utilisation",
                cells: () => Plan.heatCells([], { min: 0, max: 100, warnAt: 95 }), children: () => East.value(new SortedMap<string, Press>([], compareFor(StringType)), Presses) }),
        ] })), /measures\[0\], heat "Utilisation", declares `children` — a measure is one row under each resource/);
        assert.throws(() => resourcesOver(PRESSES, Presses, ($) => ({ measures: [$.let(heat("util"))] })),
            /measures\[0\] is a Plan\.series\.heat, table or chart written in place — a series bound or stored elsewhere cannot be laid out under each resource/);
        assert.throws(() => resourcesOver(PRESSES, Presses, () => ({ measures: [heat("crew_util", CrewType as never)] })),
            /measures\[0\] is a series over the resources' rows — Plan\.series\.heat "crew_util": the series is built over one entry type and applied to entries of another/);
        assert.throws(() => resourcesOver(PRESSES, Presses, () => ({ measures: [heat("util"), heat("util")] })),
            /measures\[1\], heat "Utilisation", repeats the key "util" — a measure row's id is its series' key and its resource's path/);
    });

    test("a window over another record", () => {
        assert.throws(() => East.function([], NullType, ($) => {
            const rows = $.const(PRESSES, Presses);
            const window = $.let(Data.bindPaged(crewsRecord));
            Schedule.resources(rows, { name: "Presses", icon: "print", label: (p) => p.name, window });
        }), /`window` pages the resources — Data\.bindPaged\(record\) over the resources' record — and this one serves \.Dict/);
    });
});

// ============================================================================
// What fails to compile (PB6): each name checked against the row type
// ============================================================================

/** Never run: each line marked below must fail to compile, or the build fails on the unused directive. */
export function planScheduleTypeChecks(): void {
    const jobs = Record.bind(jobsRecord, [jobsPatch]);
    const stops = Record.bind(stopsRecord, [stopsPatch]);
    const shifts = Record.bind(shiftsRecord, [shiftsPatch]);
    const presses = Record.bind(pressesRecord, []).read();
    // Spec §3.3's kinds compile as written.
    Schedule.events(jobs, {
        name: "Print job", icon: "file-lines", draw: "span",
        title: "title", start: "start", end: "end",
        resource: { field: "press", of: "presses" },
        state: "state", review: "verdict",
        quantity: { field: "sheets", unit: "sheets" },
        backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
        templates: [{ key: "brochure", name: "Brochure run", group: "Jobs", duration: variant("hours", 6.0),
            values: { title: "Brochure run", state: variant("proposed", variant("added", null)), sheets: 40000.0,
                verdict: variant("pending", null), customer: "", stock: variant("coated", null), due: none } }],
    });
    Schedule.events(stops, {
        name: "Stop", icon: "screwdriver-wrench", draw: "marks",
        title: "title", at: "at",
        resource: { field: "press", of: "presses" },
        templates: [{ key: "plates", name: "Plate change", group: "Stops", values: { title: "Plate change", kind: variant("plate_change", null) } }],
    });
    Schedule.events(shifts, {
        name: "Crew shift", icon: "user-clock", draw: "cards",
        title: "title", start: "start", end: "end",
        resource: { field: "crew", of: "crews" }, state: "state",
        templates: [{ key: "early", name: "Early shift", group: "Shifts", at: { hour: 6n, minute: 0n }, duration: variant("hours", 8.0),
            values: { title: "Early", state: variant("confirmed", null) } }],
    });
    // @ts-expect-error — `at` is a plain DateTime field, and a job's start is an Option
    Schedule.events(jobs, { name: "Job", icon: "i", title: "title", at: "start" });
    // @ts-expect-error — `state` is an EventStateType field, and "verdict" is an ApprovalStateType one
    Schedule.events(jobs, { name: "Job", icon: "i", title: "title", start: "start", end: "end", state: "verdict" });
    // @ts-expect-error — `quantity.field` is a Float field, and "title" is a String one
    Schedule.events(jobs, { name: "Job", icon: "i", title: "title", start: "start", end: "end", quantity: { field: "title" } });
    // @ts-expect-error — `lane` is a String field, and "sheets" is a Float one
    Schedule.events(jobs, { name: "Job", icon: "i", title: "title", start: "start", end: "end", lane: "sheets" });
    // @ts-expect-error — `review` is an ApprovalStateType field, and "state" is an EventStateType one
    Schedule.events(jobs, { name: "Job", icon: "i", title: "title", start: "start", end: "end", review: "state" });
    // @ts-expect-error — `overlaps` is "warn" or "allow"
    Schedule.events(jobs, { name: "Job", icon: "i", title: "title", start: "start", end: "end", overlaps: "sometimes" });
    // @ts-expect-error — an instant kind draws as tiles or marks, never as bars
    Schedule.events(stops, { name: "Stop", icon: "i", title: "title", at: "at", draw: "span" });
    // @ts-expect-error — an instant kind has no backlog
    Schedule.events(stops, { name: "Stop", icon: "i", title: "title", at: "at", backlog: { duration: () => variant("hours", 1) } });
    // @ts-expect-error — the kind's own inspector is a function over its own row, and a stop is not a job
    Schedule.events(jobs, { name: "Job", icon: "i", title: "title", start: "start", end: "end", inspector: stopInspector });
    // @ts-expect-error — an instant kind's template has no duration
    Schedule.events(stops, { name: "Stop", icon: "i", title: "title", at: "at", templates: [{ key: "p", name: "P", duration: variant("hours", 1), values: { title: "P", press: "pa", kind: variant("plate_change", null) } }] });
    // @ts-expect-error — `group` is a String, and a press's speed is a Float
    Schedule.resources(presses, { name: "Presses", icon: "print", label: (p) => p.name, group: (p) => p.sheets_per_hour });
    // @ts-expect-error — `status` is an Option of a status value
    Schedule.resources(presses, { name: "Presses", icon: "print", label: (p) => p.name, status: (p) => some(p.name) });
    // @ts-expect-error — `rollup` is "union", "byStatus" or "sum"
    Schedule.resources(presses, { name: "Presses", icon: "print", label: (p) => p.name, rollup: "average" });
}
