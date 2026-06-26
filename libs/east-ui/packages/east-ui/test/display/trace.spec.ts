/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Trace } from "@elaraai/east-ui/internal";
import * as ex from "./trace.examples.js";

describeEast("Trace", (test) => {
    Assert.examples(test, {
        traceBasic: ex.traceBasic,
        traceDensities: ex.traceDensities,
        traceScales: ex.traceScales,
        traceRagged: ex.traceRagged,
        traceWithChipRail: ex.traceWithChipRail,
    });

    // =========================================================================
    // Basic creation
    // =========================================================================

    test("creates a trace with two tracks (defaults)", $ => {
        const trace = $.let(Trace.Root([
            { name: "A", values: [1.0, 2.0, 3.0] },
            { name: "B", values: [3.0, 2.0, 1.0] },
        ]));

        $(Assert.equal(trace.unwrap().unwrap("Trace").tracks.size(), 2n));
        $(Assert.equal(trace.unwrap().unwrap("Trace").now.hasTag("none"), true));
        $(Assert.equal(trace.unwrap().unwrap("Trace").density.hasTag("none"), true));
        $(Assert.equal(trace.unwrap().unwrap("Trace").scale.hasTag("none"), true));
    });

    test("preserves track name + values", $ => {
        const trace = $.let(Trace.Root([{ name: "A", values: [10.0, 20.0] }]));
        const track = $.let(trace.unwrap().unwrap("Trace").tracks.get(0n));

        $(Assert.equal(track.name, "A"));
        $(Assert.equal(track.values.size(), 2n));
        $(Assert.equal(track.values.get(1n), 20.0));
    });

    // =========================================================================
    // now-line
    // =========================================================================

    test("stores the now index when provided", $ => {
        const trace = $.let(Trace.Root([{ name: "A", values: [1.0, 2.0, 3.0, 4.0] }], { now: 2n }));

        $(Assert.equal(trace.unwrap().unwrap("Trace").now.unwrap("some"), 2n));
    });

    // =========================================================================
    // Density / scale / future
    // =========================================================================

    test("stores density", $ => {
        const trace = $.let(Trace.Root([{ name: "A", values: [1.0] }], { density: "compact" }));
        $(Assert.equal(trace.unwrap().unwrap("Trace").density.unwrap("some").hasTag("compact"), true));
    });

    test("stores scale", $ => {
        const trace = $.let(Trace.Root([{ name: "A", values: [1.0] }], { scale: "diverge" }));
        $(Assert.equal(trace.unwrap().unwrap("Trace").scale.unwrap("some").hasTag("diverge"), true));
    });

    test("stores future style", $ => {
        const trace = $.let(Trace.Root([{ name: "A", values: [1.0] }], { future: "hatch" }));
        $(Assert.equal(trace.unwrap().unwrap("Trace").future.unwrap("some").hasTag("hatch"), true));
    });

    // =========================================================================
    // axis + style escape hatches
    // =========================================================================

    test("stores axis labels", $ => {
        const trace = $.let(Trace.Root([{ name: "A", values: [1.0, 2.0] }], { axis: ["t0", "t1"] }));
        const axis = $.let(trace.unwrap().unwrap("Trace").axis.unwrap("some"));

        $(Assert.equal(axis.size(), 2n));
        $(Assert.equal(axis.get(0n), "t0"));
    });

    test("stores colour overrides", $ => {
        const trace = $.let(Trace.Root([{ name: "A", values: [1.0] }], {
            brandColor: "purple.500",
            nowLineColor: "gray.700",
        }));
        const style = $.let(trace.unwrap().unwrap("Trace").style.unwrap("some"));

        $(Assert.equal(style.brandColor.unwrap("some"), "purple.500"));
        $(Assert.equal(style.nowLineColor.unwrap("some"), "gray.700"));
    });
}, { platformFns: TestImpl });
