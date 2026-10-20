/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Allocation's payload over the kiln yard's records on e3 itself (#1379):
 * its tag's East function binds the plans, the loads, the kilns and the bays as
 * the Allocation examples do, and compiles against the platform a UI task's
 * preview gives it, so what the payload reads is e3's. Its bin values cross as
 * bytes, which the renderer decodes with the payload's own values type.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { East, decodeBeast2For, encodeBeast2For, equalFor, fromEastTypeValue, some, variant } from "@elaraai/east";
import { Allocation } from "@elaraai/e3-ui";
import { AllocationPayloadType, Data, Func, Record, createAllocationPayload } from "@elaraai/e3-ui/internal";
import * as ax from "@elaraai/e3-ui/examples/allocation/allocation";
import { e3Spec } from "./fixtures/e3.js";

const h = e3Spec({ "allocation/allocation": ax });

/** The kiln yard's payload, the tag over the records as the examples bind them. */
const program = East.function([], AllocationPayloadType, $ => {
    const days = $.let(Record.bind(ax.kilnPlans, [ax.kilnPlansPatch]));
    const fit = $.let(Func.bind(ax.yardFit));
    const loads = $.let(Data.bind(ax.arrivals));
    const yard = $.let(Data.bind(ax.kilns));
    const bays = $.let(Data.bind(ax.yardBays));
    return createAllocationPayload({
        days, fit, lanes: Allocation.lanes(bays.read(), { label: b => b.name, offset: b => b.offset }),
        events: Allocation.events(loads.read(), { label: l => l.code, quantity: l => l.m3, hold: l => variant("days", l.dryingDays), kind: l => some(l.spec),
            values: l => ({ specBooked: l.spec, specMeasured: l.spec, gradeBooked: l.grade.substring(0n, 1n), gradeMeasured: l.grade, instruction: l.instruction }) }),
        resources: Allocation.resources(yard.read(), { label: k => k.name, min: k => k.min, max: k => k.max, hold: k => variant("days", k.days), jobs: k => k.charges }),
        columns: [{ key: "spec", label: "Spec", text: v => East.equal(v.specBooked, v.specMeasured).ifElse(() => v.specMeasured, () => East.str`booked ${v.specBooked} · measured ${v.specMeasured}`) }],
    });
});

test("the app's bin values cross as bytes: the plans, an event's starting values and a column's text", async () => {
    const { platform } = await h.platform(program);
    const value = East.compile(program, platform)();
    const BinValues = fromEastTypeValue(value.valuesType);
    const plans = decodeBeast2For(Allocation.Types.Days(BinValues))(value.read());
    assert.equal(plans.size, 3, "the plans e3 holds");
    const day = [...plans.values()][1]!;
    assert.equal(day.bins.size, 26);
    assert.ok(equalFor(BinValues)(decodeBeast2For(BinValues)(value.initial("LD-2231")), {
        specBooked: "MC12", specMeasured: "MC12", gradeBooked: "R", gradeMeasured: "R2", instruction: some("Sticker every 600 mm before loading"),
    }), "LD-2231's starting values, its grade booked by its letter");
    const bin = day.bins.get("3113")!;
    const text = value.columns[0]!.text(encodeBeast2For(BinValues)(bin.values));
    assert.equal(text, "booked MC08 · measured MC22");
});
