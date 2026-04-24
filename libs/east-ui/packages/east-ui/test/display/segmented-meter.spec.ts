/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { SegmentedMeter } from "@elaraai/east-ui";
import * as ex from "./segmented-meter.examples.js";

describeEast("SegmentedMeter", (test) => {
    Assert.examples(test, {
        segmentedMeterBasic: ex.segmentedMeterBasic,
        segmentedMeterOutsideLabels: ex.segmentedMeterOutsideLabels,
        segmentedMeterResidual: ex.segmentedMeterResidual,
    });

    test("creates a three-segment meter", $ => {
        const m = $.let(SegmentedMeter.Root([
            { value: 30, tone: "success" },
            { value: 40, tone: "warning" },
            { value: 30, tone: "danger" },
        ]));
        $(Assert.equal(m.unwrap().unwrap("SegmentedMeter").segments.size(), 3n));
        $(Assert.equal(m.unwrap().unwrap("SegmentedMeter").max.hasTag("none"), true));
        $(Assert.equal(m.unwrap().unwrap("SegmentedMeter").caption.hasTag("none"), true));
        $(Assert.equal(m.unwrap().unwrap("SegmentedMeter").style.hasTag("none"), true));
    });

    test("segments carry tone and label", $ => {
        const m = $.let(SegmentedMeter.Root([
            { value: 50, tone: "info", label: "A" },
        ]));
        const seg = m.unwrap().unwrap("SegmentedMeter").segments.get(0n);
        $(Assert.equal(seg.value, 50.0));
        $(Assert.equal(seg.tone.unwrap("some").hasTag("info"), true));
        $(Assert.equal(seg.label.unwrap("some"), "A"));
    });

    test("segment with explicit colour override", $ => {
        const m = $.let(SegmentedMeter.Root([
            { value: 100, color: "#3d5cff" },
        ]));
        $(Assert.equal(m.unwrap().unwrap("SegmentedMeter").segments.get(0n).color.unwrap("some"), "#3d5cff"));
    });

    test("meter with max + style thickness + labels inside", $ => {
        const m = $.let(SegmentedMeter.Root([
            { value: 30 },
            { value: 10 },
        ], { max: 100.0, thickness: "md", labels: "inside", trackColor: "gray.100" }));
        $(Assert.equal(m.unwrap().unwrap("SegmentedMeter").max.unwrap("some"), 100.0));
        $(Assert.equal(m.unwrap().unwrap("SegmentedMeter").style.unwrap("some").thickness.unwrap("some").hasTag("md"), true));
        $(Assert.equal(m.unwrap().unwrap("SegmentedMeter").style.unwrap("some").labels.unwrap("some").hasTag("inside"), true));
        $(Assert.equal(m.unwrap().unwrap("SegmentedMeter").style.unwrap("some").trackColor.unwrap("some"), "gray.100"));
    });
}, { platformFns: TestImpl });
