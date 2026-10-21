/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { East, variant } from "@elaraai/east";
import { Assert, TestImpl, describeEast } from "@elaraai/east-node-std";
import * as EastUI from "@elaraai/east-ui";
import { Calendar, Data, Schedule } from "@elaraai/e3-ui";
import { CalendarPayloadType, Record, createCalendarPayload } from "@elaraai/e3-ui/internal";
import * as ex from "./calendar.examples.js";

describeEast("Calendar — bound examples", test => {
    Assert.examples(test, { calendarMinimal: ex.calendarMinimal, calendarOperations: ex.calendarOperations,
        calendarMobile: ex.calendarMobile, calendarReadOnly: ex.calendarReadOnly, calendarWindowed: ex.calendarWindowed, calendarQuickstart: ex.calendarQuickstart, calendarCustomInspector: ex.calendarCustomInspector });
}, { platformFns: TestImpl });

// What the payload and its kinds read of e3 — the machines, the jobs and their templates, a window, the backlog, an
// event by its key — e3-ui-components' calendar payload spec reads on e3 itself.
describe("Calendar's thin e3-ui contract", () => {
    test("the public API shares Schedule's helpers, and the old heatmap is absent from east-ui", () => {
        assert.equal(Calendar.events, Schedule.events); assert.equal(Calendar.resources, Schedule.resources);
        assert.equal(Calendar.templates, Schedule.templates); assert.equal(Calendar.field, Schedule.field);
        assert.equal("Builder" in Calendar, false); assert.equal("View" in Calendar, false);
        assert.equal("Calendar" in EastUI, false);
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

/** A payload over the jobs and the machines, with these props beside them, built (not run). */
function build(props: (sources: { jobs: unknown; machines: unknown; templates: unknown }) => Record<string, unknown>, kind: Record<string, unknown> = {}) {
    return East.function([], CalendarPayloadType, $ => {
        const machines = $.let(Record.bind(ex.calendarMachines, []));
        const jobs = $.let(Record.bind(ex.calendarJobs, [ex.calendarJobsPatch]));
        const templates = $.let(Record.bind(ex.calendarJobTemplates, []));
        const entries = $.let(Data.bindPaged(ex.calendarJobs));
        const sources = {
            jobs: $.let(Data.bindPaged(ex.calendarJobs, { indexes: [ex.calendarJobsByTime, ex.calendarJobsByStatusTime] })),
            machines: $.let(Data.bindPaged(ex.calendarMachines, { indexes: [ex.calendarMachinesByArea] })),
            templates: $.let(Data.bindPaged(ex.calendarJobTemplates, { indexes: [ex.calendarJobTemplatesByGroup] })),
        };
        return createCalendarPayload({
            resources: { machines: Calendar.resources(machines.read(), { name: "Machines", icon: "gears", label: row => row.name }) },
            events: { job: Calendar.events(jobs, { name: "Production", icon: "industry", title: "title", start: "start", end: "end", resource: { field: "machine", of: "machines" },
                backlog: { duration: row => variant("hours", row.hours) }, entries,
                templates: Calendar.templates(templates.read(), { name: row => row.name, duration: row => variant("hours", row.hours), values: row => row.values, source: "jobTemplates" }),
                ...kind }) },
            ...props(sources),
        } as never);
    });
}

describe("Calendar's narrowing is one Slice.bindRecords (#1343)", () => {
    test("a source per event kind, resource kind and templates record builds, each kind narrowed through its own", () => {
        assert.doesNotThrow(() => build(sources => ({ slice: { slice: EastUI.Slice.bindRecords("spec.calendar", {
            job: { source: sources.jobs, range: "start" }, machines: { source: sources.machines }, jobTemplates: { source: sources.templates },
        }) } })));
        // A templates list names its source of the slice: one the slice lacks is refused, listing the slice's.
        assert.throws(() => build(sources => ({ slice: { slice: EastUI.Slice.bindRecords("spec.calendar", { job: { source: sources.jobs, range: "start" } }) } })),
            /Calendar: templates are records now — .*\(the slice's sources: job — 'jobTemplates' is not one of them\)$/);
    });

    test("Slice.bind, a single Slice.bindRecord and a source no kind, templates list or tab names are refused, naming the fix", () => {
        const named = /Calendar: `slice` is Slice.bindRecords\(key, \{ job, machines, jobTemplates \}\) — name each source after what it narrows; Slice.bind and Slice.bindRecord are not taken/;
        assert.throws(() => build(() => ({ slice: { slice: EastUI.Slice.bind("spec.local", [{ title: "A" }], { fields: { title: { label: "Title" } } }) } })), named);
        assert.throws(() => build(sources => ({ slice: { slice: EastUI.Slice.bindRecord("spec.single", sources.jobs as never) } })), named);
        assert.throws(() => build(sources => ({ slice: { slice: EastUI.Slice.bindRecords("spec.calendar", { jobs: { source: sources.jobs }, jobTemplates: { source: sources.templates } }) } })),
            /Calendar: `slice` narrows its event kinds, its resource kinds and the templates and tabs that name a source — its source 'jobs' is none of them; name the sources `job`, `machines` and `jobTemplates`/);
    });

    test("a kind's own slice and filter are refused, naming the builder's source; a kind with a source and no entries is refused as it builds", () => {
        assert.throws(() => build(() => ({}), { slice: {} }), /Schedule.events: "Production": `slice` moves to the builder — name a source of its Slice.bindRecords after this kind's slot/);
        assert.throws(() => build(() => ({}), { filter: () => true }), /Schedule.events: "Production": `filter` is gone — narrow the kind through its builder's Slice.bindRecords/);
        assert.throws(() => build(sources => ({ slice: { slice: EastUI.Slice.bindRecords("spec.calendar", { job: { source: sources.jobs, range: "start" }, jobTemplates: { source: sources.templates } }) } }), { entries: undefined }),
            /Schedule.events: "Production": the builder's source "job" reads only its narrowing — .* give `entries` beside it/);
    });

    test("an app's tab follows the source it names, refused when the slice lacks it", () => {
        const technicians = (source: string) => Calendar.library.tab(East.value(new Map([["ash", { name: "A. Ash", team: "Maintenance" }]]), ex.calendarPeople.type), {
            name: "Technicians", label: row => row.name, source,
        });
        assert.throws(() => build(sources => ({ slice: { slice: EastUI.Slice.bindRecords("spec.calendar", { job: { source: sources.jobs, range: "start" }, jobTemplates: { source: sources.templates } }) },
            library: [technicians("people")] })),
            /Calendar: `slice` narrows .* — its source|Calendar: the Technicians tab's source 'people' is not one of the slice's sources \(job, jobTemplates\)/);
    });

    test("every templates list is a record naming its source of the slice: one written in the code, one naming none, and templates with no slice are refused, naming the change", () => {
        const change = /^Error: Calendar: templates are records now — bind them in Slice.bindRecords and name the source, Calendar.templates\(rows, \{ …, source: "jobTemplates" \}\)/;
        const slice = (sources: { jobs: unknown; templates: unknown }) => ({ slice: { slice: EastUI.Slice.bindRecords("spec.calendar", { job: { source: sources.jobs, range: "start" }, jobTemplates: { source: sources.templates } }) } });
        // A list written in the code is refused before the slice's unnamed source is.
        assert.throws(() => build(slice, { templates: [{ key: "brackets", name: "Bracket batch", duration: variant("hours", 4), values: {} }] }), change);
        assert.throws(() => build(slice, { templates: [{ key: "brackets", name: "Bracket batch", duration: variant("hours", 4), values: {} }] }), /\(the slice's sources: job, jobTemplates\)$/);
        // A record's list naming no source.
        assert.throws(() => East.function([], CalendarPayloadType, $ => {
            const machines = $.let(Record.bind(ex.calendarMachines, []));
            const jobs = $.let(Record.bind(ex.calendarJobs, [ex.calendarJobsPatch]));
            const templates = $.let(Record.bind(ex.calendarJobTemplates, []));
            const index = $.let(Data.bindPaged(ex.calendarJobTemplates, { indexes: [ex.calendarJobTemplatesByGroup] }));
            return createCalendarPayload({ slice: { slice: EastUI.Slice.bindRecords("spec.calendar", { jobTemplates: { source: index } }) },
                resources: { machines: Calendar.resources(machines.read(), { name: "Machines", icon: "gears", label: row => row.name }) },
                events: { job: Calendar.events(jobs, { name: "Production", icon: "industry", title: "title", start: "start", end: "end", resource: { field: "machine", of: "machines" },
                    templates: Calendar.templates(templates.read(), { name: row => row.name, duration: row => variant("hours", row.hours), values: row => row.values }) }) } });
        }), change);
        // Templates with no slice at all.
        assert.throws(() => build(() => ({})), /^Error: Calendar: templates are records now — .*\(it has no slice — 'jobTemplates' is not one of them\)$/);
    });
});
