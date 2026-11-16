/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The canvas's rows never follow the dates on screen (#1344): a `range` on a
 * Plan's `rows` source — the source of the rows its event kinds land on too
 * (#1541) — would hold the window and narrow the rows at every pan, so the
 * Plan refuses it as its payload is evaluated — its sources' controls are read
 * only then — in words naming the change to make; the field stays a field of
 * the rail. The payload compiles against the platform a UI task's preview gives
 * it, its slice made on the record Slice's platform, over the print works' jobs
 * on e3 itself.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { East, type BlockBuilder, type ExprType, type ValueTypeOf } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui";
import { StateRuntime, UIStore, createRecordSliceImplementation } from "@elaraai/east-ui-components/platform";
import { Data, Plan, PlanPayloadType } from "@elaraai/e3-ui/internal";
import * as events from "@elaraai/e3-ui/examples/plan/plan-events";
import { e3Spec } from "./fixtures/e3.js";

const h = e3Spec({ "plan/plan-events": events });

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
    const source = { source: Data.bindPaged(events.planPrintJobs, { indexes: ["plan_print_jobs_by_time"] }), fields: { start: { label: "Dates" } } };
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

describe("a range on the canvas's rows' source is refused as the payload is evaluated (#1344)", () => {
    test("the `rows` source's: the rows never follow the dates on screen — leave `range` out, and the field stays a field of the rail", async () => {
        await assert.rejects(payloadOf(rowsPlan(true)),
            /Plan: the slice's `rows` source gives the canvas its rows, and its range "start" would hold the window — the rows never follow the dates on screen: leave `range` out, and "start" stays a field of the rail the viewer sets/);
        // Left out, the field is the rail's: the Plan builds.
        const payload = await payloadOf(rowsPlan(false));
        assert.equal(payload.plan.slice.type, "some");
    });
});
