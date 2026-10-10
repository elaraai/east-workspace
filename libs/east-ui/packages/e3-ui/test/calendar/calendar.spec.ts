/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { East, SortedMap, StringType, compareFor, decodeBeast2For, none, some, variant } from "@elaraai/east";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import * as EastUI from "@elaraai/east-ui";
import { Calendar, Schedule } from "@elaraai/e3-ui";
import { CalendarPayloadType, Record, createCalendarPayload } from "@elaraai/e3-ui/internal";
import { memoryRecords } from "../schedule/memory-records.js";
import * as ex from "./calendar.examples.js";

describeEast("Calendar — bound examples", test => {
    Assert.examples(test, { calendarMinimal: ex.calendarMinimal, calendarOperations: ex.calendarOperations,
        calendarMobile: ex.calendarMobile, calendarReadOnly: ex.calendarReadOnly, calendarWindowed: ex.calendarWindowed, calendarQuickstart: ex.calendarQuickstart, calendarCustomInspector: ex.calendarCustomInspector });
}, { platformFns: TestImpl });

const states = new Map<string, unknown>([
    [ex.calendarMachines.name, ex.calendarMachines.default], [ex.calendarJobs.name, ex.calendarJobs.default],
    [ex.calendarPeople.name, ex.calendarPeople.default], [ex.calendarServices.name, ex.calendarServices.default],
    [ex.calendarJobTemplates.name, ex.calendarJobTemplates.default],
]);
const platform = memoryRecords(states);
const program = East.function([], CalendarPayloadType, $ => {
    const machines = $.let(Record.bind(ex.calendarMachines, []));
    const jobs = $.let(Record.bind(ex.calendarJobs, [ex.calendarJobsPatch]));
    const templates = $.let(Record.bind(ex.calendarJobTemplates, []));
    return createCalendarPayload({ id: "contract", inspector: true,
        resources: { machines: Calendar.resources(machines.read(), { name: "Machines", icon: "gears", label: row => row.name }) },
        events: { job: Calendar.events(jobs, { name: "Production", icon: "industry", title: "title", start: "start", end: "end", resource: { field: "machine", of: "machines" },
            backlog: { duration: row => variant("hours", row.hours), due: row => row.due },
            templates: Calendar.templates(templates.read(), { name: row => row.name, group: row => some(row.group), duration: row => variant("hours", row.hours), values: row => row.values }),
        }) }, library: [Calendar.library.templates(), Calendar.library.backlog()],
    });
});
const payload = () => East.compile(program, platform)();
const drafts = () => new SortedMap<string, Uint8Array>([], compareFor(StringType));
const from = new Date("2026-10-01T00:00:00Z");
const to = new Date("2026-10-02T00:00:00Z");

describe("Calendar's thin e3-ui contract", () => {
    test("the public API shares Schedule's helpers, and the old heatmap is absent from east-ui", () => {
        assert.equal(Calendar.events, Schedule.events); assert.equal(Calendar.resources, Schedule.resources);
        assert.equal(Calendar.templates, Schedule.templates); assert.equal(Calendar.field, Schedule.field);
        assert.equal("Builder" in Calendar, false); assert.equal("View" in Calendar, false);
        assert.equal("Calendar" in EastUI, false);
    });
    test("the payload contains bound kinds and preferences, with no authored frame tree", () => {
        const value = payload();
        assert.equal(value.events[0]!.key, "job"); assert.equal(value.resources[0]!.rows.length, 4);
        assert.deepEqual(value.library.map(tab => tab.type), ["templates", "backlog"]);
        assert.equal(value.settings.period.type, "week"); assert.equal(value.inspector, true);
        assert.equal("frame" in value, false); assert.equal("children" in value, false);
    });
    test("the window and backlog project one record, and a shared by-key read retains all its typed fields", () => {
        const kind = payload().events[0]!;
        const scheduled = kind.items(from, to, drafts()); const backlog = kind.unscheduled(drafts());
        assert.equal(scheduled.type, "some"); assert.equal(backlog.type, "some");
        if (scheduled.type !== "some" || backlog.type !== "some") assert.fail("expected loaded records");
        assert.deepEqual(scheduled.value.map(item => item.key), ["job1", "job2", "job3", "job5"]);
        assert.equal(backlog.value.length, 4); assert.equal(backlog.value[0]!.minutes, 120n);
        const read = kind.event("job1", drafts(), from, to); if (read.type !== "some") assert.fail("missing event");
        assert.equal(decodeBeast2For(ex.CalendarJob)(read.value.row).customer, "Alder Works");
    });
    test("bound template values create a whole typed row; the record key is the template key", () => {
        const kind = payload().events[0]!;
        assert.deepEqual(kind.templates.map(template => template.key), ["brackets", "housings"]);
        const result = kind.write([{ id: "new", entry: new Uint8Array(), gesture: variant("create", { template: "brackets", start: from, end: new Date(from.getTime() + 4 * 3_600_000), resource: some({ kind: "machines", key: "press2" }) }) }])[0]!;
        if (result.type !== "some") assert.fail("creation refused");
        const row = decodeBeast2For(ex.CalendarJob)(result.value);
        assert.equal(row.title, "Bracket batch"); assert.equal(row.hours, 4); assert.deepEqual(row.machine, some("press2"));
        assert.equal(row.status.type, "planned"); assert.deepEqual(row.due, none);
    });
    test("templates are reevaluated from their record, including their initial values", () => {
        const old = states.get(ex.calendarJobTemplates.name);
        const templates = new Map(ex.calendarJobTemplates.default!);
        templates.set("brackets", { ...templates.get("brackets")!, name: "Renamed", values: { ...templates.get("brackets")!.values, title: "New title" } });
        try {
            states.set(ex.calendarJobTemplates.name, templates);
            const value = payload(); assert.equal(value.events[0]!.templates[0]!.name, "Renamed");
            assert.equal(decodeBeast2For(ex.CalendarJobValues)(value.events[0]!.templates[0]!.values).title, "New title");
        } finally { states.set(ex.calendarJobTemplates.name, old); }
    });
    test("a schedule and a return to backlog preserve the other fields", () => {
        const kind = payload().events[0]!;
        const read = kind.event("backlog1", drafts(), from, to); if (read.type !== "some") assert.fail("missing backlog");
        const placed = kind.write([{ id: "backlog1", entry: read.value.row, gesture: variant("place", { start: from, end: to, resource: some({ kind: "machines", key: "lathe1" }) }) }])[0]!;
        if (placed.type !== "some") assert.fail("schedule refused");
        const returned = kind.write([{ id: "backlog1", entry: placed.value, gesture: variant("unplace", null) }])[0]!;
        if (returned.type !== "some") assert.fail("return refused");
        const row = decodeBeast2For(ex.CalendarJob)(returned.value);
        assert.equal(row.start.type, "none"); assert.equal(row.end.type, "none"); assert.equal(row.customer, "Alder Works");
    });
    test("bound templates reject initial values from a different event row at build time", () => {
        assert.throws(() => East.function([], CalendarPayloadType, $ => {
            const jobs = $.let(Record.bind(ex.calendarJobs, [ex.calendarJobsPatch]));
            const presets = $.let(Record.bind(ex.calendarServiceTemplates, []));
            return createCalendarPayload({ events: { job: Calendar.events(jobs, {
                name: "Jobs", icon: "industry", title: "title", start: "start", end: "end", resource: { field: "machine", of: "machines" },
                // @ts-expect-error Templates from another row are rejected by both TypeScript and the factory.
                templates: Calendar.templates(presets.read(), { name: row => row.name, duration: row => variant("hours", row.hours), values: row => row.values }),
            }) } });
        }), /templates.values.*expected/);
    });
    test("bad working hours and duplicate library tabs fail while building, naming the problem", () => {
        assert.throws(() => East.function([], CalendarPayloadType, $ => {
            const jobs = $.let(Record.bind(ex.calendarJobs, [ex.calendarJobsPatch]));
            return createCalendarPayload({ events: { job: Calendar.events(jobs, { name: "Jobs", icon: "industry", title: "title", start: "start", end: "end" }) }, hours: { from: 22n, to: 6n } });
        }), /hours/);
        assert.throws(() => East.function([], CalendarPayloadType, $ => {
            const jobs = $.let(Record.bind(ex.calendarJobs, [ex.calendarJobsPatch]));
            return createCalendarPayload({ events: { job: Calendar.events(jobs, { name: "Jobs", icon: "industry", title: "title", start: "start", end: "end" }) }, library: [Calendar.library.backlog(), Calendar.library.backlog()] });
        }), /backlog.*twice/);
    });
});
