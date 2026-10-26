/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Calendar's payload and its job kind over the Calendar examples' records
 * on e3 itself (#1379): each East function compiles against the platform a UI
 * task's preview gives it, so the machines, the jobs and the job templates it
 * reads are e3's, and another session's change to the templates is a commit
 * through their patch door, read again once the cache's poll reports it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { East, SortedMap, StringType, compareFor, decodeBeast2For, none, some, variant } from "@elaraai/east";
import { Calendar } from "@elaraai/e3-ui";
import { CalendarPayloadType, Record, ScheduleKindType, createCalendarPayload } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/calendar/calendar";
import { e3Spec } from "./fixtures/e3.js";

const h = e3Spec({ "calendar/calendar": ex });

const program = East.function([], CalendarPayloadType, $ => {
    const machines = $.let(Record.bind(ex.calendarMachines, []));
    const jobs = $.let(Record.bind(ex.calendarJobs, [ex.calendarJobsPatch]));
    return createCalendarPayload({ id: "contract", inspector: true,
        resources: { machines: Calendar.resources(machines.read(), { name: "Machines", icon: "gears", label: row => row.name }) },
        events: { job: Calendar.events(jobs, { name: "Production", icon: "industry", title: "title", start: "start", end: "end", resource: { field: "machine", of: "machines" },
            backlog: { duration: row => variant("hours", row.hours), due: row => row.due },
        }) }, library: [Calendar.library.templates(), Calendar.library.backlog()],
    });
});
// The job kind alone, its templates read from their record, as a builder builds it (#1343): a Calendar takes templates
// only beside a slice naming their source, so the kind's own build is what runs.
const kindProgram = East.function([], ScheduleKindType, $ => {
    const jobs = $.let(Record.bind(ex.calendarJobs, [ex.calendarJobsPatch]));
    const templates = $.let(Record.bind(ex.calendarJobTemplates, []));
    return Calendar.events(jobs, { name: "Production", icon: "industry", title: "title", start: "start", end: "end", resource: { field: "machine", of: "machines" },
        backlog: { duration: row => variant("hours", row.hours), due: row => row.due },
        templates: Calendar.templates(templates.read(), { name: row => row.name, group: row => some(row.group), duration: row => variant("hours", row.hours), values: row => row.values, source: "jobTemplates" }),
    }).build("job");
});
/** The payload, compiled over e3 and run. */
const payload = async () => {
    const { platform } = await h.platform(program);
    return East.compile(program, platform)();
};
/** The job kind with its templates, compiled over e3 and run. */
const templatedKind = async () => {
    const { platform } = await h.platform(kindProgram);
    return East.compile(kindProgram, platform)();
};
const drafts = () => new SortedMap<string, Uint8Array>([], compareFor(StringType));
const from = new Date("2026-10-01T00:00:00Z");
const to = new Date("2026-10-02T00:00:00Z");

test("the payload contains bound kinds and preferences, with no authored frame tree", async () => {
    const value = await payload();
    assert.equal(value.events[0]!.key, "job"); assert.equal(value.resources[0]!.rows.length, 4);
    assert.deepEqual(value.library.map(tab => tab.type), ["templates", "backlog"]);
    assert.equal(value.settings.period.type, "week"); assert.equal(value.inspector, true);
    assert.equal("frame" in value, false); assert.equal("children" in value, false);
});

test("the window and backlog project one record, and a shared by-key read retains all its typed fields", async () => {
    const kind = (await payload()).events[0]!;
    // No reader's cells: the window and the backlog are read over the window, the event by its key.
    const scheduled = kind.items(from, to, drafts(), none); const backlog = kind.unscheduled(from, to, drafts(), none);
    assert.equal(scheduled.type, "some"); assert.equal(backlog.type, "some");
    if (scheduled.type !== "some" || backlog.type !== "some") assert.fail("expected loaded records");
    assert.deepEqual(scheduled.value.map(item => item.key), ["job1", "job2", "job3", "job5"]);
    assert.equal(backlog.value.length, 4); assert.equal(backlog.value[0]!.minutes, 120n);
    const read = kind.event("job1", drafts(), from, to, none); if (read.type !== "some") assert.fail("missing event");
    assert.equal(decodeBeast2For(ex.CalendarJob)(read.value.row).customer, "Alder Works");
});

test("bound template values create a whole typed row; the record key is the template key", async () => {
    const kind = await templatedKind();
    assert.deepEqual(kind.templates.map(template => template.key), ["brackets", "housings"]);
    const result = kind.write([{ id: "new", entry: new Uint8Array(), gesture: variant("create", { template: "brackets", start: from, end: new Date(from.getTime() + 4 * 3_600_000), resource: some({ kind: "machines", key: "press2" }) }) }])[0]!;
    if (result.type !== "some") assert.fail("creation refused");
    const row = decodeBeast2For(ex.CalendarJob)(result.value);
    assert.equal(row.title, "Bracket batch"); assert.equal(row.hours, 4); assert.deepEqual(row.machine, some("press2"));
    assert.equal(row.status.type, "planned"); assert.deepEqual(row.due, none);
});

test("templates are reevaluated from their record, including their initial values", async () => {
    const { platform, clock } = await h.platform(kindProgram);
    const kind = East.compile(kindProgram, platform);
    assert.equal(kind().templates[0]!.name, "Bracket batch");
    // Another session renames the brackets' template and the title it starts a job with.
    const templates = await h.read(ex.calendarJobTemplates);
    const brackets = templates.get("brackets")!;
    templates.set("brackets", { ...brackets, name: "Renamed", values: { ...brackets.values, title: "New title" } });
    await h.patch(ex.calendarJobTemplates, templates);
    clock.tickAll();
    await h.settle();
    const rebuilt = kind();
    assert.equal(rebuilt.templates[0]!.name, "Renamed");
    assert.equal(decodeBeast2For(ex.CalendarJobValues)(rebuilt.templates[0]!.values).title, "New title");
});

test("a schedule and a return to backlog preserve the other fields", async () => {
    const kind = (await payload()).events[0]!;
    const read = kind.event("backlog1", drafts(), from, to, none); if (read.type !== "some") assert.fail("missing backlog");
    const placed = kind.write([{ id: "backlog1", entry: read.value.row, gesture: variant("place", { start: from, end: to, resource: some({ kind: "machines", key: "lathe1" }) }) }])[0]!;
    if (placed.type !== "some") assert.fail("schedule refused");
    const returned = kind.write([{ id: "backlog1", entry: placed.value, gesture: variant("unplace", null) }])[0]!;
    if (returned.type !== "some") assert.fail("return refused");
    const row = decodeBeast2For(ex.CalendarJob)(returned.value);
    assert.equal(row.start.type, "none"); assert.equal(row.end.type, "none"); assert.equal(row.customer, "Alder Works");
});
