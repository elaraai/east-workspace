/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The canvas's rows never follow the dates on screen (#1344): a `range` on a
 * Plan's `rows` source, or on a resource kind's, would hold the window and
 * narrow the rows at every pan, so the Plan refuses it as its payload is
 * evaluated — its sources' controls are read only then — in words naming the
 * change to make; the field stays a field of the rail. A range on an event
 * kind's source holds the window as ever. The payload compiles against the
 * platform a UI task's preview gives it, its slice made on the record Slice's
 * platform, over the print works' jobs and the dated rows on e3 itself.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { East, type BlockBuilder, type ExprType, type ValueTypeOf } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui";
import { StateRuntime, UIStore, createRecordSliceImplementation } from "@elaraai/east-ui-components/platform";
import { Data, Plan, PlanPayloadType, Record, Schedule } from "@elaraai/e3-ui/internal";
import * as events from "@elaraai/e3-ui/examples/plan/plan-events";
import * as records from "@elaraai/e3-ui/examples/plan/plan-records";
import * as sheet from "@elaraai/e3-ui/examples/sheet/sheet-records";
import { e3Spec } from "./fixtures/e3.js";

// The dated rows' module binds the Sheet's work orders in its examples: their module is deployed beside it.
const h = e3Spec({ "plan/plan-events": events, "plan/plan-records": records, "sheet/sheet-records": sheet });

type Payload = ValueTypeOf<typeof PlanPayloadType>;

const WINDOW = { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-11-02T00:00:00Z") };

/** The payload, built over e3 as a UI task's preview builds it, its slice made on the record Slice's platform. */
async function payloadOf(build: ($: BlockBuilder<typeof PlanPayloadType>) => ExprType<typeof PlanPayloadType>): Promise<Payload> {
    const program = East.function([], PlanPayloadType, ($) => build($));
    const { platform } = await h.platform(program);
    StateRuntime.initializeStore(new UIStore());
    const implementations = [...platform];
    implementations.push(...createRecordSliceImplementation(() => implementations));
    return East.compile(program, implementations)() as Payload;
}

/** The jobs as the canvas's rows, through the slice's `rows` source over their interval index — naming a range of their starts, or not. */
const rowsPlan = (range: boolean) => ($: BlockBuilder<typeof PlanPayloadType>) => {
    const source = { source: Data.bindPaged(events.planPrintJobs, { indexes: [events.planPrintJobsByTime] }), fields: { start: { label: "Dates" } } };
    const slice = $.let(Slice.bindRecords("spec.rows.range", { rows: range ? { ...source, range: "start" as const } : source }));
    return Plan.Payload({
        axis: Plan.axis({ window: WINDOW, resolution: "day" }),
        slice: { slice },
        series: [Plan.series.span(events.PrintJob, {
            key: "jobs", title: "Jobs", label: (j) => j.title,
            runs: (j, k) => [Plan.run({ key: k, start: j.start.unwrap("some"), end: j.end.unwrap("some"), label: j.title, state: "confirmed" })],
        })],
    });
};

/**
 * The jobs placed on the dated rows as resources, the rows narrowed through their own source — naming a range of
 * their dates, or not — and the jobs through theirs, its range their starts.
 */
const resourcesPlan = (range: boolean) => ($: BlockBuilder<typeof PlanPayloadType>) => {
    const dated = $.let(Data.bind(records.planDatedRows));
    const jobs = $.let(Record.bind(events.planPrintJobs, [events.planPrintJobsPatch]));
    const entries = $.let(Data.bindPaged(events.planPrintJobs));
    const rows = { source: Data.bindPaged(records.planDatedRows, { indexes: [records.planDatedRowsByAt] }), fields: { at: { label: "At" } } };
    const slice = $.let(Slice.bindRecords("spec.resources.range", {
        dated: range ? { ...rows, range: "at" as const } : rows,
        job: { source: Data.bindPaged(events.planPrintJobs, { indexes: [events.planPrintJobsByTime] }), fields: { start: { label: "Dates" } }, range: "start" },
    }));
    return Plan.Payload({
        axis: Plan.axis({ window: WINDOW, resolution: "day" }),
        slice: { slice },
        resources: { dated: Schedule.resources(dated.read(), { name: "Dated", icon: "calendar", label: (r) => r.owner }) },
        events: {
            job: Schedule.events(jobs, {
                name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", resource: { field: "press", of: "dated" }, entries,
            }),
        },
    });
};

describe("a range on the canvas's rows' source is refused as the payload is evaluated (#1344)", () => {
    test("the `rows` source's: the rows never follow the dates on screen — leave `range` out, and the field stays a field of the rail", async () => {
        await assert.rejects(payloadOf(rowsPlan(true)),
            /Plan: the slice's `rows` source gives the canvas its rows, and its range "start" would hold the window — the rows never follow the dates on screen: leave `range` out, and "start" stays a field of the rail the viewer sets/);
        // Left out, the field is the rail's: the Plan builds.
        const payload = await payloadOf(rowsPlan(false));
        assert.equal(payload.plan.slice.type, "some");
    });

    test("a resource kind's: its rows never follow the dates either — while an event kind's source holds the window with its range", async () => {
        await assert.rejects(payloadOf(resourcesPlan(true)),
            /Plan: the slice's source "dated" narrows resources\.dated, and its range "at" would hold the window — a resource kind's rows never follow the dates on screen: leave `range` out, and "at" stays a field of the rail the viewer sets/);
        // Left out, the Plan builds, its jobs' source holding the window with its range.
        const payload = await payloadOf(resourcesPlan(false));
        assert.deepEqual(payload.events.map((kind) => kind.key), ["job"]);
    });
});
