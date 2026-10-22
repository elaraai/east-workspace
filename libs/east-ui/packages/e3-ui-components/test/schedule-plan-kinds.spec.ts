/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Schedule`'s Plan options (#1190, `Plan Builder Spec.md` §4.1, PB5) over the
 * print works' records on e3 itself (#1379): each event kind is built over a
 * record of Schedule's example module, against the platform a UI task's
 * preview gives it, so the record it reads is e3's — how a kind draws, an
 * instant kind's `at`, the lifecycle, quantity and lane its events carry, the
 * kind's own inspector (PB60, #1197), and the Calendar's kind unchanged with
 * Plan's options present.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, BlobType, DateTimeType, East, FunctionType, NullType, OptionType, SortedMap, StringType, compareFor, decodeBeast2For, encodeBeast2For,
    equalFor, none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { EventStateType, Format, UIComponentType } from "@elaraai/east-ui";
import { EditingDraftFieldType, Text, TickFormatType } from "@elaraai/east-ui/internal";
import { Record, Schedule } from "@elaraai/e3-ui/internal";
import * as sx from "@elaraai/e3-ui/examples/schedule/schedule";
import { e3Spec } from "./fixtures/e3.js";

const h = e3Spec({ "schedule/schedule": sx });

/** An instant as its author writes it: UTC, with its zone. */
const at = (text: string): Date => new Date(text);

type PlanKind = ValueTypeOf<typeof Schedule.Types.PlanKind>;
type PlanItem = ValueTypeOf<typeof Schedule.Types.PlanItem>;
type Kind = ValueTypeOf<typeof Schedule.Types.Kind>;

/** How a job's sheets print: whole numbers. */
const SHEETS_FORMAT = East.compile(East.function([], TickFormatType, (_$) => Format.Number({ maximumFractionDigits: 0n })), [])();

/** The print job kind as Plan takes it: bars, its lifecycle, its sheets and its backlog. */
const jobProgram = East.function([], Schedule.Types.PlanKind, ($) => {
    const jobs = $.let(Record.bind(sx.schedulePrintJobs, [sx.schedulePrintJobsPatch]));
    return Schedule.events(jobs, {
        name: "Print job", icon: "file-lines", draw: "span",
        title: "title", start: "start", end: "end",
        resource: { field: "press", of: "presses" },
        state: "state",
        quantity: { field: "sheets", unit: "sheets", format: Format.Number({ maximumFractionDigits: 0n }) },
        backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
    }).buildPlan("job");
});

/** The stop kind: one instant each, drawn as marks, a plate change dropped from the library. */
const stopProgram = East.function([], Schedule.Types.PlanKind, ($) => {
    const stops = $.let(Record.bind(sx.schedulePrintStops, [sx.schedulePrintStopsPatch]));
    return Schedule.events(stops, {
        name: "Stop", icon: "screwdriver-wrench", draw: "marks",
        title: "title", at: "at",
        resource: { field: "press", of: "presses" },
        templates: [{ key: "plates", name: "Plate change", group: "Stops", values: { title: "Plate change", kind: variant("plate_change", null) } }],
    }).buildPlan("stop");
});

/** A stop's own inspector: its title, and a button that marks it checked through its writer. */
const stopInspector = East.function([sx.SchedulePrintStop, FunctionType([sx.SchedulePrintStop], NullType)], UIComponentType, ($, stop, update) => {
    $(update({ title: stop.title.concat(" — checked"), at: stop.at, press: stop.press, kind: stop.kind }));
    return Text.Root(stop.title);
});

/** The stop kind with its own inspector. */
const inspectedStopProgram = East.function([], Schedule.Types.PlanKind, ($) => {
    const stops = $.let(Record.bind(sx.schedulePrintStops, [sx.schedulePrintStopsPatch]));
    return Schedule.events(stops, {
        name: "Stop", icon: "screwdriver-wrench", draw: "marks",
        title: "title", at: "at",
        resource: { field: "press", of: "presses" },
        inspector: stopInspector,
    }).buildPlan("stop");
});

/** The delivery kind: instants drawn as tiles in their lanes, which may share a press at once. */
const deliveryProgram = East.function([], Schedule.Types.PlanKind, ($) => {
    const deliveries = $.let(Record.bind(sx.schedulePrintDeliveries, [sx.schedulePrintDeliveriesPatch]));
    return Schedule.events(deliveries, {
        name: "Delivery", icon: "truck", draw: "buckets",
        title: "title", at: "at",
        resource: { field: "press", of: "presses" },
        lane: "slot", overlaps: "allow",
    }).buildPlan("delivery");
});

/** The crew shift kind: chips, their lifecycle read from the shift. */
const shiftProgram = East.function([], Schedule.Types.PlanKind, ($) => {
    const shifts = $.let(Record.bind(sx.schedulePrintShifts, [sx.schedulePrintShiftsPatch]));
    return Schedule.events(shifts, {
        name: "Crew shift", icon: "user-clock", draw: "cards",
        title: "title", start: "start", end: "end",
        resource: { field: "crew", of: "crews" }, state: "state",
    }).buildPlan("shift");
});

/** The crew shift kind with none of Plan's options. */
const plainShiftProgram = East.function([], Schedule.Types.PlanKind, ($) => {
    const shifts = $.let(Record.bind(sx.schedulePrintShifts, [sx.schedulePrintShiftsPatch]));
    return Schedule.events(shifts, {
        name: "Crew shift", icon: "user-clock",
        title: "title", start: "start", end: "end",
        resource: { field: "crew", of: "crews" },
    }).buildPlan("shift");
});

/**
 * A kind built over e3, as a UI task's preview builds it.
 *
 * @param program - The kind's East function
 * @returns The kind
 */
async function built(program: typeof jobProgram): Promise<PlanKind> {
    const { platform } = await h.platform(program);
    return East.compile(program, platform)();
}

const NO_DRAFTS = new SortedMap<string, Uint8Array>([], compareFor(StringType));
const DAY = ["2026-10-05T00:00:00Z", "2026-10-06T00:00:00Z"] as const;
/** The range a canvas reads, which a kind read whole takes no notice of. */
const RANGE = [at(DAY[0]), at(DAY[1])] as const;
const itemEqual = equalFor(Schedule.Types.PlanItem);
const rolesEqual = equalFor(Schedule.Types.PlanRoles);

/** A kind's events on 5 October, as Plan draws them. */
function onTheFifth(kind: PlanKind): PlanItem[] {
    const read = kind.planItems(at(DAY[0]), at(DAY[1]), NO_DRAFTS);
    if (read.type !== "some") assert.fail("expected the window read");
    return read.value;
}

describe("Schedule.events — Plan's options (PB5)", () => {
    test("builds the Calendar's kind, with how it draws, its roles' fields and whether its overlaps warn", async () => {
        const jobKind = await built(jobProgram);
        assert.equal(jobKind.key, "job");
        assert.deepEqual(jobKind.takes, ["presses"]);
        assert.equal(jobKind.backlog, true);
        assert.equal(jobKind.draw.type, "span");
        assert.equal(jobKind.instant, false);
        assert.equal(jobKind.overlaps.type, "warn");
        assert.ok(rolesEqual(jobKind.roles, { state: some("state"), quantity: some("sheets"), lane: none }));
    });

    test("draws each event with the lifecycle it wears and its quantity in its unit and format", async () => {
        const [run] = onTheFifth(await built(jobProgram));
        assert.ok(itemEqual(run!, {
            kind: "job", key: "j1", title: "Brochure run",
            start: some(at("2026-10-05T06:00:00Z")), end: some(at("2026-10-05T12:00:00Z")),
            resource: some({ kind: "presses", key: "pa" }), status: none, minutes: 360n, due: none,
            state: variant("proposed", variant("added", null)),
            quantity: some({ value: 40000, unit: some("sheets"), format: some(SHEETS_FORMAT), text: none }),
            lane: none,
        }));
    });

    test("draws its backlog the same way, each row sized by its duration", async () => {
        const read = (await built(jobProgram)).planUnscheduled(...RANGE, NO_DRAFTS);
        if (read.type !== "some") assert.fail("expected the backlog");
        assert.deepEqual(read.value.map((i) => i.key), ["j2"]);
        const [waiting] = read.value;
        assert.equal(waiting!.minutes, 180n);
        assert.ok(equalFor(EventStateType)(waiting!.state, variant("estimated", null)));
    });

    test("a kind with none of Plan's options draws bars, warns of overlaps, and its events wear confirmed", async () => {
        const plainShiftKind = await built(plainShiftProgram);
        assert.equal(plainShiftKind.draw.type, "span");
        assert.equal(plainShiftKind.overlaps.type, "warn");
        assert.ok(rolesEqual(plainShiftKind.roles, { state: none, quantity: none, lane: none }));
        const [early] = onTheFifth(plainShiftKind);
        assert.ok(equalFor(EventStateType)(early!.state, variant("confirmed", null)));
        assert.deepEqual([early!.quantity.type, early!.lane.type], ["none", "none"]);
    });

    test("reads one event by its key — as Plan draws it, and its row — with its draft in place; none for a key there is no event of (#1197)", async () => {
        const jobKind = await built(jobProgram);
        const j1 = (await h.read(sx.schedulePrintJobs)).get("j1")!;
        const read = jobKind.planEvent("j1", NO_DRAFTS, ...RANGE);
        if (read.type !== "some") assert.fail("expected the job read");
        const [run] = onTheFifth(jobKind);
        assert.ok(itemEqual(read.value.item, run!));
        assert.ok(equalFor(sx.SchedulePrintJob)(decodeBeast2For(sx.SchedulePrintJob)(read.value.row), j1));
        assert.equal(jobKind.planEvent("j9", NO_DRAFTS, ...RANGE).type, "none");
        // A draft in place: an edited job reads as drafted, a deleted one as none, and one drafted new as itself.
        const encodeDraft = encodeBeast2For(EditingDraftFieldType(sx.SchedulePrintJob));
        const reprint = { ...j1, title: "Brochure reprint" };
        const drafts = new SortedMap<string, Uint8Array>([
            ["j1", encodeDraft(variant("value", reprint))],
            ["j2", encodeDraft(variant("missing", null))],
            ["j3", encodeDraft(variant("value", { ...reprint, title: "Leaflet run" }))],
        ], compareFor(StringType));
        const edited = jobKind.planEvent("j1", drafts, ...RANGE);
        if (edited.type !== "some") assert.fail("expected the drafted job");
        assert.equal(edited.value.item.title, "Brochure reprint");
        assert.ok(equalFor(sx.SchedulePrintJob)(decodeBeast2For(sx.SchedulePrintJob)(edited.value.row), reprint));
        assert.equal(jobKind.planEvent("j2", drafts, ...RANGE).type, "none");
        const added = jobKind.planEvent("j3", drafts, ...RANGE);
        if (added.type !== "some") assert.fail("expected the job drafted new");
        assert.deepEqual([added.value.item.key, added.value.item.title], ["j3", "Leaflet run"]);
    });

    test("a kind drawn as chips reads its lifecycle from its own field", async () => {
        const shiftKind = await built(shiftProgram);
        assert.equal(shiftKind.draw.type, "cards");
        const [early] = onTheFifth(shiftKind);
        assert.ok(equalFor(EventStateType)(early!.state, variant("confirmed", null)));
        assert.ok(rolesEqual(shiftKind.roles, { state: some("state"), quantity: none, lane: none }));
    });
});

describe("Schedule.events — an instant kind (`at`)", () => {
    test("each event is one time, its start and its end, drawn as marks; it has no backlog", async () => {
        const stopKind = await built(stopProgram);
        assert.equal(stopKind.instant, true);
        assert.equal(stopKind.draw.type, "marks");
        assert.equal(stopKind.backlog, false);
        const [plates] = onTheFifth(stopKind);
        assert.deepEqual([plates!.key, plates!.minutes], ["s1", 0n]);
        assert.ok(equalFor(OptionType(DateTimeType))(plates!.start, some(at("2026-10-05T12:00:00Z"))));
        assert.ok(equalFor(OptionType(DateTimeType))(plates!.end, some(at("2026-10-05T12:00:00Z"))));
    });

    test("a placement writes `at`, a move to the backlog is refused, and a template creates an event of no length", async () => {
        const stopKind = await built(stopProgram);
        const decode = decodeBeast2For(sx.SchedulePrintStop);
        const stop = (await h.read(sx.schedulePrintStops)).get("s1")!;
        const s1 = encodeBeast2For(sx.SchedulePrintStop)(stop);
        const [moved] = stopKind.write([{ id: "s1", entry: s1, gesture: variant("place", {
            start: at("2026-10-05T15:00:00Z"), end: at("2026-10-05T15:00:00Z"), resource: some({ kind: "presses", key: "pc" }),
        }) }]);
        if (moved!.type !== "some") assert.fail("expected the stop placed");
        assert.ok(equalFor(sx.SchedulePrintStop)(decode(moved!.value), { ...stop, at: at("2026-10-05T15:00:00Z"), press: "pc" }));
        const [unplaced] = stopKind.write([{ id: "s1", entry: s1, gesture: variant("unplace", null) }]);
        assert.equal(unplaced!.type, "none");
        const [created] = stopKind.write([{ id: "s9", entry: new Uint8Array(), gesture: variant("create", {
            template: "plates", start: at("2026-10-06T07:00:00Z"), end: at("2026-10-06T07:00:00Z"), resource: some({ kind: "presses", key: "pb" }),
        }) }]);
        if (created!.type !== "some") assert.fail("expected the plate change created");
        assert.ok(equalFor(sx.SchedulePrintStop)(decode(created!.value), { title: "Plate change", at: at("2026-10-06T07:00:00Z"), press: "pb", kind: variant("plate_change", null) }));
        const [template] = stopKind.templates;
        assert.ok(equalFor(Schedule.Types.Duration)(template!.duration, variant("minutes", 0)));
    });

    test("drawn as tiles, each in its lane, the kind's overlaps allowed", async () => {
        const deliveryKind = await built(deliveryProgram);
        assert.equal(deliveryKind.draw.type, "buckets");
        assert.equal(deliveryKind.overlaps.type, "allow");
        const [van] = onTheFifth(deliveryKind);
        assert.ok(equalFor(OptionType(StringType))(van!.lane, some("AM")));
        assert.ok(rolesEqual(deliveryKind.roles, { state: none, quantity: none, lane: some("slot") }));
    });
});

describe("Schedule.events — the kind's own inspector (PB60)", () => {
    test("a kind given none has none: the inspector shows its form", async () => {
        assert.equal((await built(jobProgram)).inspector.type, "none");
        assert.equal((await built(stopProgram)).inspector.type, "none");
    });

    test("given one, the event arrives as its own row, its UI is what the author's function returns, and its writer takes the edited row back", async () => {
        const inspectedStopKind = await built(inspectedStopProgram);
        if (inspectedStopKind.inspector.type !== "some") assert.fail("expected the kind's own inspector");
        const stop = (await h.read(sx.schedulePrintStops)).get("s1")!;
        const written: Uint8Array[] = [];
        const ui = inspectedStopKind.inspector.value(encodeBeast2For(sx.SchedulePrintStop)(stop), (bytes: Uint8Array) => { written.push(bytes); return null; });
        assert.ok(equalFor(UIComponentType)(ui, East.compile(East.function([], UIComponentType, () => Text.Root("Plate change")), [])()));
        assert.equal(written.length, 1, "one write");
        assert.ok(equalFor(sx.SchedulePrintStop)(decodeBeast2For(sx.SchedulePrintStop)(written[0]!), { ...stop, title: "Plate change — checked" }));
    });
});

describe("Schedule.events — the Calendar's kind with Plan's options present (PB5)", () => {
    /** The job kind as the Calendar takes it, with or without Plan's options. */
    const calendarJobs = (withPlan: boolean) => East.function([], Schedule.Types.Kind, ($) => {
        const jobs = $.let(Record.bind(sx.schedulePrintJobs, [sx.schedulePrintJobsPatch]));
        const plan = withPlan
            ? {
                draw: "span" as const, state: "state" as const, quantity: { field: "sheets" as const, unit: "sheets" }, overlaps: "allow" as const,
                inspector: East.function([sx.SchedulePrintJob, FunctionType([sx.SchedulePrintJob], NullType)], UIComponentType, (_$2, job) => Text.Root(job.title)),
            }
            : {};
        return Schedule.events(jobs, {
            name: "Print job", icon: "file-lines",
            title: "title", start: "start", end: "end",
            resource: { field: "press", of: "presses" },
            backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
            templates: [{ key: "brochure", name: "Brochure run", group: "Jobs", duration: variant("hours", 6.0),
                values: { title: "Brochure run", state: variant("proposed", variant("added", null)), sheets: 40000.0,
                    customer: "", stock: variant("coated", null), due: none } }],
            ...plan,
        }).build("job");
    });
    /** The Calendar's kind built over e3. */
    const builtKind = async (program: ReturnType<typeof calendarJobs>): Promise<Kind> => {
        const { platform } = await h.platform(program);
        return East.compile(program, platform)();
    };

    test("draws exactly as it does without them: its fields, its events, its backlog and its writes", async () => {
        const [plain, withPlan] = [await builtKind(calendarJobs(false)), await builtKind(calendarJobs(true))];
        const fields = Schedule.Types.Kind.fields;
        for (const f of ["key", "name", "icon", "takes", "status", "backlog", "templates", "fields"] as const) {
            assert.ok(equalFor(fields[f])(plain[f] as never, withPlan[f] as never), `the kind's ${f}`);
        }
        const items = equalFor(OptionType(ArrayType(Schedule.Types.Item)));
        assert.ok(items(plain.items(at(DAY[0]), at(DAY[1]), NO_DRAFTS), withPlan.items(at(DAY[0]), at(DAY[1]), NO_DRAFTS)));
        assert.ok(items(plain.unscheduled(...RANGE, NO_DRAFTS), withPlan.unscheduled(...RANGE, NO_DRAFTS)));
        const j1 = encodeBeast2For(sx.SchedulePrintJob)((await h.read(sx.schedulePrintJobs)).get("j1")!);
        const request = [{ id: "j1", entry: j1, gesture: variant("place", {
            start: at("2026-10-05T08:00:00Z"), end: at("2026-10-05T14:00:00Z"), resource: some({ kind: "presses", key: "pb" }),
        }) }];
        assert.ok(equalFor(ArrayType(OptionType(BlobType)))(plain.write(request as never), withPlan.write(request as never)));
        assert.equal(plain.editing.sourceId, withPlan.editing.sourceId);
    });
});
