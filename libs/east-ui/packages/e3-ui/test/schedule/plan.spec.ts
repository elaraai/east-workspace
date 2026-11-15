/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Schedule`'s Plan options (#1190, `Plan Builder Spec.md` §4.1, §4.2,
 * PB4–PB7) — what is checked of them without e3. A kind is built over its
 * record, which it reads as it builds, so how a kind draws, an instant kind's
 * `at`, the lifecycle, quantity and lane its events carry, the kind's own
 * inspector (PB60, #1197) and the Calendar's kind unchanged with Plan's
 * options present run in e3-ui-components on e3 itself
 * (`test/schedule-plan-kinds.spec.ts`), over the print works' records in
 * Schedule's records (`schedule.examples.tsx`). Here: the options only a
 * Plan read of a resource kind, refused by name now that a Plan's rows are its
 * resources (#1541), and a paged read of its resources (#1424), over rows in
 * hand; each refusal at build, the removed `review` among them (#1260); and
 * each mistyped name failing to compile.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    DictType, East, FloatType, FunctionType, NullType, SortedMap, StringType, StructType, compareFor, equalFor, none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Text } from "@elaraai/east-ui/internal";
import { Data, Record, Schedule } from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import * as sx from "./schedule.examples.js";

// ============================================================================
// The print works (Plan Builder Spec §3.1): its presses and crews, rows in
// hand; its jobs, stops and shifts, Schedule's records
// ============================================================================

const PressType = StructType({ name: StringType, hall: StringType, sheets_per_hour: FloatType });
const CrewType = StructType({ name: StringType, hall: StringType });
const Presses = DictType(StringType, PressType);
const Crews = DictType(StringType, CrewType);

type Press = ValueTypeOf<typeof PressType>;

const PRESSES = new SortedMap<string, Press>([
    ["pa", { name: "Press A", hall: "Hall 1", sheets_per_hour: 12000 }],
    ["pb", { name: "Press B", hall: "Hall 1", sheets_per_hour: 9000 }],
    ["pc", { name: "Press C", hall: "Hall 2", sheets_per_hour: 15000 }],
], compareFor(StringType));

// Never read: what a paged read of the resources, and an index over them, are refused or built over.
const pressesRecord = e3.record("plan_spec_presses", Presses, {
    initial: new Map(),
    indexes: (index) => ({
        plan_spec_presses_by_hall: index.key(East.function([StringType, PressType], StringType, (_$, _key, press) => press.hall)),
    }),
});
const crewsRecord = e3.record("plan_spec_crews", Crews, { initial: new Map() });
const StopType = sx.SchedulePrintStop;
const jobsRecord = sx.schedulePrintJobs;
const stopsRecord = sx.schedulePrintStops;
const shiftsRecord = sx.schedulePrintShifts;

/** A stop's own inspector: its title, and a button that marks it checked through its writer. */
const stopInspector = East.function([StopType, FunctionType([StopType], NullType)], UIComponentType, ($, stop, update) => {
    $(update({ title: stop.title.concat(" — checked"), at: stop.at, press: stop.press, kind: stop.kind }));
    return Text.Root(stop.title);
});

// ============================================================================
// Schedule.resources — Plan's options
// ============================================================================

describe("Schedule.resources — the options only a Plan read, refused by name (#1541)", () => {
    /** What declaring the presses with `options` throws inside a block; `""` when it builds. */
    function refusal(options: object): string {
        try {
            East.function([], NullType, ($) => {
                const rows = $.const(PRESSES, Presses);
                Schedule.resources(rows, { name: "Presses", icon: "print", label: (p: { name: unknown }) => p.name, ...options } as never);
            });
            return "";
        } catch (e) {
            return e instanceof Error ? e.message : String(e);
        }
    }

    test("each names where a Plan takes it now: on the resources series that lays out its rows", () => {
        const refused = (prop: string, there: string) => `Schedule.resources: "Presses": \`${prop}\` was the Plan's, and a Plan takes no resource kinds now ` +
            `(#1541) — its rows are its resources: lay them out with Plan.series.resources(Row, { key, title, label, … }), which takes ${there}`;
        assert.equal(refusal({ parent: () => none }), refused("parent", "a tree of them, `children`"));
        assert.equal(refusal({ sub: (p: { name: unknown }) => some(p.name) }), refused("sub", "`sub`"));
        assert.equal(refusal({ value: () => none }), refused("value", "`value`"));
        assert.equal(refusal({ status: () => none }), refused("status", "`status`"));
        assert.equal(refusal({ rollup: "sum" }), refused("rollup", "`rollup`"));
        assert.equal(refusal({ collapsed: true }), refused("collapsed", "`collapsed`"));
        assert.equal(refusal({ measures: [] }), refused("measures", "`series`, the read-only rows under each resource"));
        // What the builders over the app's own records read stands.
        assert.equal(refusal({ meta: (p: { hall: unknown }) => some(p.hall), group: (p: { hall: unknown }) => p.hall }), "");
    });

    test("the Calendar's kind is unchanged with a group present", () => {
        const build = (grouped: boolean) => East.compile(East.function([], Schedule.Types.Resources, ($) => {
            const rows = $.const(PRESSES, Presses);
            return (grouped
                ? Schedule.resources(rows, { name: "Presses", icon: "print", label: (p) => p.name, meta: (p) => some(p.hall), group: (p) => p.hall })
                : Schedule.resources(rows, { name: "Presses", icon: "print", label: (p) => p.name, meta: (p) => some(p.hall) })).build("presses");
        }), [])();
        assert.ok(equalFor(Schedule.Types.Resources)(build(false), build(true)));
    });

    test("a paged read of its resources pages it, and a Dict reads them whole (#1424)", () => {
        East.function([], NullType, ($) => {
            const rows = $.const(PRESSES, Presses);
            const pages = $.let(Data.bindPaged(pressesRecord));
            const presses = Schedule.resources(pages, { name: "Presses", icon: "print", label: (p) => p.name });
            assert.ok(presses.window !== undefined && presses.source === undefined, "paged: its window, and no whole read");
            const whole = Schedule.resources(rows, { name: "Presses", icon: "print", label: (p) => p.name });
            assert.ok(whole.window === undefined && whole.source !== undefined, "whole: its rows, and no window");
        });
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
            const bound = $.let(Record.bind(def, ["patch"]));
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

    test("a `state`, `quantity` or `lane` field of another type", () => {
        assert.throws(() => kindOver(jobsRecord, { ...times, state: "stock" }), /`state` names an EventStateType field, the lifecycle an event wears — "stock" holds \.Variant/);
        assert.throws(() => kindOver(jobsRecord, { ...times, quantity: { field: "title" } }), /`quantity\.field` names a Float field, the quantity a bar prints — "title" holds \.String/);
        assert.throws(() => kindOver(jobsRecord, { ...times, lane: "sheets" }), /`lane` names a String field, the lane a tile sits in — "sheets" holds \.Float/);
    });

    test("a `review`, which is removed (#1260), whatever it names", () => {
        const removed = /Schedule\.events: "Kind": `review` is removed \(#1260\) — a Plan approves and rejects nothing: its changes are drafts of its session, saved together$/;
        assert.throws(() => kindOver(jobsRecord, { ...times, review: "state" }), removed);
        assert.throws(() => kindOver(jobsRecord, { ...times, review: "approval" }), removed);
        assert.throws(() => kindOver(stopsRecord, { at: "at", review: "at" }), removed);
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

describe("Schedule.resources — a paged read refused at build (#1199)", () => {
    test("`window`, which is gone, refused naming the paged form; and an index's window for the resources (#1199)", () => {
        assert.throws(() => East.function([], NullType, ($) => {
            const rows = $.const(PRESSES, Presses);
            const window = $.let(Data.bindPaged(crewsRecord));
            Schedule.resources(rows, { name: "Presses", icon: "print", label: (p: { name: unknown }) => p.name, window } as never);
        }), /Schedule\.resources: "Presses": `window` is gone — a kind pages when its resources are a paged read: Schedule\.resources\(Data\.bindPaged\(record\), \{ … \}\) in place of Schedule\.resources\(rows, \{ window: Data\.bindPaged\(record\) \}\)$/);
        assert.throws(() => East.function([], NullType, ($) => {
            const halls = $.let(Data.bindPaged(pressesRecord, { index: "plan_spec_presses_by_hall", join: true }));
            Schedule.resources(halls as never, { name: "Presses", icon: "print", label: (p: { name: unknown }) => p.name } as never);
        }), /Schedule\.resources: "Presses": a paged kind reads its resources' own entries a window at a time — Data\.bindPaged\(record\) over the resources' record, a Dict — and this read serves an index's window, \.Array/);
    });
});

// ============================================================================
// What fails to compile (PB6): each name checked against the row type
// ============================================================================

/** Never run: each line marked below must fail to compile, or the build fails on the unused directive. */
export function planScheduleTypeChecks(): void {
    const jobs = Record.bind(jobsRecord, ["patch"]);
    const stops = Record.bind(stopsRecord, ["patch"]);
    const shifts = Record.bind(shiftsRecord, ["patch"]);
    const presses = Record.bind(pressesRecord, []).read();
    // Spec §3.3's kinds compile as written.
    Schedule.events(jobs, {
        name: "Print job", icon: "file-lines", draw: "span",
        title: "title", start: "start", end: "end",
        resource: { field: "press", of: "presses" },
        state: "state",
        quantity: { field: "sheets", unit: "sheets" },
        backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
        templates: [{ key: "brochure", name: "Brochure run", group: "Jobs", duration: variant("hours", 6.0),
            values: { title: "Brochure run", state: variant("proposed", variant("added", null)), sheets: 40000.0,
                customer: "", stock: variant("coated", null), due: none } }],
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
    // @ts-expect-error — `state` is an EventStateType field, and "stock" is a variant of its own
    Schedule.events(jobs, { name: "Job", icon: "i", title: "title", start: "start", end: "end", state: "stock" });
    // @ts-expect-error — `quantity.field` is a Float field, and "title" is a String one
    Schedule.events(jobs, { name: "Job", icon: "i", title: "title", start: "start", end: "end", quantity: { field: "title" } });
    // @ts-expect-error — `lane` is a String field, and "sheets" is a Float one
    Schedule.events(jobs, { name: "Job", icon: "i", title: "title", start: "start", end: "end", lane: "sheets" });
    // @ts-expect-error — `review` is removed (#1260): a Plan approves and rejects nothing
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
    // @ts-expect-error — `status` was the Plan's (#1541): a resource kind takes none, a Plan.series.resources does
    Schedule.resources(presses, { name: "Presses", icon: "print", label: (p) => p.name, status: () => none });
    // A paged read of the resources compiles in their place (#1199), its rows typed from its page.
    const pages = Data.bindPaged(pressesRecord);
    Schedule.resources(pages, { name: "Presses", icon: "print", label: (p) => p.name, meta: (p) => some(p.hall) });
    // @ts-expect-error — `window` is gone (#1199): a kind pages when its resources are a paged read
    Schedule.resources(presses, { name: "Presses", icon: "print", label: (p) => p.name, window: pages });
}
