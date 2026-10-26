/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Calendar read a page at a time (#1424) — what is checked of it without
 * e3: the windows examples run; a paged resource kind builds, its kind on the
 * wire listing no resource; the refusals at build — an event kind on the paged
 * kind read whole, read through its day index, or placed on another kind
 * beside it, each naming both indexes over the kind's own fields, and two
 * paged kinds — and the examples' manifests: the jobs record and the presses
 * paged reads alone, never preloaded or polled whole. What the Calendar reads —
 * a cell at a time, the summary past the cap, the pages around the view — and
 * the refusals of a source's indexes, which the Calendar reads only as it is
 * evaluated, are read from e3, so they are checked in e3-ui-components on e3
 * itself (`test/calendar-windows.spec.ts` and the Calendar's DOM tests).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DateTimeType, DictType, East, NullType, StringType, StructType, VariantType, variant, type BlockBuilder, type EastType, type ExprType } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Calendar, CalendarPayloadType, Data, Record, Schedule, createCalendarPayload, deriveManifest } from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import * as ex from "./calendar-windows.examples.js";
import * as plan from "../plan/plan-windows.examples.js";
import { PrintPress } from "../plan/plan-events.examples.js";
import { refusingPlatform } from "../refusing-platform.js";

describeEast("Calendar read a page at a time — the examples (#1424)", (test) => {
    Assert.examples(test, { calendarWindows: ex.calendarWindows, calendarWindowsByHall: ex.calendarWindowsByHall, calendarWindowsMobile: ex.calendarWindowsMobile });
}, { platformFns: TestImpl });

/** A dataset's path as text: its fields, joined by dots. */
function pathText(path: unknown): string {
    return (path as readonly { value: string }[]).map((step) => step.value).join(".");
}

/** What `build` throws inside a block; `""` when it builds. */
function refusal(build: ($: BlockBuilder<NullType>) => unknown): string {
    try {
        East.function([], NullType, ($) => { build($); });
        return "";
    } catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
}

/** The presses a window at a time, as the windows example declares them. */
const pressesOf = ($: BlockBuilder<NullType>) =>
    Schedule.resources($.let(Data.bindPaged(plan.planWindowPresses)), { name: "Presses", icon: "print", label: (p) => p.name });

/** The jobs' kind read whole: the record bound alone, no source of the slice and no window. */
function wholeJobs($: BlockBuilder<EastType>) {
    const jobs = $.let(Record.bind(plan.planWindowJobs, [plan.planWindowJobsPatch]));
    return Calendar.events(jobs, {
        name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
        resource: { field: "press", of: "presses" },
        backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
    });
}

/** The jobs' kind read through its day index, the form for a kind with no rail. */
function windowedJobs($: BlockBuilder<EastType>) {
    const jobs = $.let(Record.bind(plan.planWindowJobs, [plan.planWindowJobsPatch]));
    const days = $.let(Data.bindPaged(plan.planWindowJobs, { index: plan.planWindowJobsByDay, join: true }));
    const backlog = $.let(Data.bindPaged(plan.planWindowJobs, { index: plan.planWindowJobsUnscheduled, join: true }));
    const entries = $.let(Data.bindPaged(plan.planWindowJobs));
    return Calendar.events(jobs, {
        name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
        resource: { field: "press", of: "presses" },
        backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
        window: days, backlogWindow: backlog, entries,
    });
}

/** The jobs' kind as the windows example declares it: narrowed through its source of the slice, one job read by its key. */
function railJobs($: BlockBuilder<EastType>) {
    const jobs = $.let(Record.bind(plan.planWindowJobs, [plan.planWindowJobsPatch]));
    const entries = $.let(Data.bindPaged(plan.planWindowJobs));
    return Calendar.events(jobs, {
        name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end",
        resource: { field: "press", of: "presses" },
        backlog: { duration: (j) => variant("hours", j.sheets.divide(8000.0)), due: (j) => j.due },
        entries,
    });
}

/** The windows example's rail: its `job` source over the jobs' interval index, their series index and their summary. */
const jobSlice = () => Slice.bindRecords("spec.calendar.windows", {
    job: { source: Data.bindPaged(plan.planWindowJobs, { indexes: [plan.planWindowJobsByTime, plan.planWindowJobsByPressWeek, plan.planWindowJobsByPressMonth] }), range: "start" },
});

describe("a Calendar's paged resource kind (#1424)", () => {
    test("builds: its kind on the wire lists no resource, and the payload's `paged` names it", () => {
        assert.equal(refusal(($) => createCalendarPayload({ slice: { slice: jobSlice() }, resources: { presses: pressesOf($) }, events: { job: railJobs($ as never) } })), "");
        // Its kind on the wire, under its slot: its resources come a window at a time, never read whole — none is read here.
        const kind = East.compile(East.function([], Schedule.Types.Resources, ($) => pressesOf($ as never).build("presses")), refusingPlatform)();
        assert.deepEqual([kind.key, kind.rows.length], ["presses", 0]);
        // The payload's `paged` names it, beside its kind's place among the resource kinds.
        assert.ok("paged" in CalendarPayloadType.fields);
    });

    test("a calendar pages one source: two paged resource kinds are refused", () => {
        assert.match(refusal(($) => createCalendarPayload({
            slice: { slice: jobSlice() },
            resources: { presses: pressesOf($), spares: pressesOf($) },
            events: { job: railJobs($ as never) },
        })), /^Calendar: resources\.presses and resources\.spares each page their rows \(Data\.bindPaged\), and a calendar pages one source — read all but one of them whole$/);
    });

    test("an event kind on the paged kind is read a cell at a time through its source of the slice: read whole, through its day index, or beside another kind, it is refused at build, the refusal naming both indexes over the kind's own fields", () => {
        const declared = String.raw`e3\.recordIndex\.series\(name, record, \{ key: "press", from: "start", to: "end", tile: "week" \}\) and ` +
            String.raw`e3\.recordIndex\.summary\(name, record, \{ key: "press", from: "start", to: "end", tile: "month" \}\) beside its interval index$`;
        const source = String.raw`a paged kind's events are read a cell at a time, through the kind's source of the slice: `;
        const named = String.raw`name a source after "job", Data\.bindPaged\(record, \{ indexes \}\), listing `;
        // Its record read whole: no source of the slice.
        assert.match(refusal(($) => createCalendarPayload({ resources: { presses: pressesOf($) }, events: { job: wholeJobs($ as never) } })),
            new RegExp(String.raw`^Calendar: events\.job is placed on resources\.presses, paged, and its record is read whole — ${source}${named}${declared}`));
        // The days in view through its day index, the form for a kind with no rail.
        assert.match(refusal(($) => createCalendarPayload({ resources: { presses: pressesOf($) }, events: { job: windowedJobs($ as never) } })),
            new RegExp(String.raw`^Calendar: events\.job is placed on resources\.presses, paged, and reads the days in view through its day index \(\`window\`\) — ` +
                String.raw`${source}leave \`window\` and \`backlogWindow\` out, and ${named}${declared}`));
        // Placed on the paged kind and on another, read whole: no series index serves the two.
        const Crew = StructType({ name: StringType });
        const Visit = StructType({ title: StringType, start: DateTimeType, end: DateTimeType, on: VariantType({ press: StringType, crew: StringType }) });
        const visits = e3.record("calendar_windows_visits", DictType(StringType, Visit), new Map());
        const visitsPatch = e3.mutation.patch(visits);
        assert.match(refusal(($) => {
            const bound = $.let(Record.bind(visits, [visitsPatch]));
            const crews = $.const(new Map([["c1", { name: "Crew 1" }]]), DictType(StringType, Crew));
            return createCalendarPayload({
                resources: { presses: pressesOf($), crews: Calendar.resources(crews, { name: "Crews", icon: "users", label: (c) => c.name }) },
                events: { visit: Calendar.events(bound, { name: "Visit", icon: "wrench", title: "title", start: "start", end: "end", resource: { field: "on", of: { press: "presses", crew: "crews" } } }) },
            });
        }), /^Calendar: events\.visit is placed on resources\.presses, paged, and on resources\.crews, read whole — a paged kind's events are read a cell at a time, through a series index that reads its rows alone: place events\.visit on resources\.presses alone, or read resources\.presses whole$/);
        // A kind on the presses read whole is no paged kind's: read whole, or through its day index, it builds.
        const wholePresses = ($: BlockBuilder<NullType>) => Calendar.resources($.let(Data.bind(plan.planWindowPresses)).read(), { name: "Presses", icon: "print", label: (p: ExprType<typeof PrintPress>) => p.name });
        assert.equal(refusal(($) => createCalendarPayload({ resources: { presses: wholePresses($) }, events: { job: wholeJobs($ as never) } })), "");
        assert.equal(refusal(($) => createCalendarPayload({ resources: { presses: wholePresses($) }, events: { job: windowedJobs($ as never) } })), "");
    });
});

describe("the windows examples' manifests: what a ui() task preloads and polls whole (#1424)", () => {
    test("each names the jobs record and the presses as paged reads alone: neither is preloaded or polled whole", () => {
        const texts = (paths: readonly unknown[]) => paths.map(pathText);
        const jobs = pathText(plan.planWindowJobs.path);
        for (const [example, presses] of [
            [ex.calendarWindows, pathText(plan.planWindowPresses.output.path)],
            [ex.calendarWindowsByHall, pathText(plan.planSeriesPresses.path)],
            [ex.calendarWindowsMobile, pathText(plan.planWindowPresses.output.path)],
        ] as const) {
            const manifest = deriveManifest(example.fn as never);
            assert.deepEqual(manifest.records, [plan.planWindowJobs.name]);
            assert.ok(texts(manifest.pages).includes(jobs), "the jobs record is read by window");
            assert.ok(texts(manifest.pages).includes(presses), "the presses are read by window");
            assert.deepEqual(texts(manifest.paths), []);
        }
    });
});
