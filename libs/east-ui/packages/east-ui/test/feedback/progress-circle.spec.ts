/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { ProgressCircle } from "@elaraai/east-ui";
import * as ex from "./progress-circle.examples.js";

describeEast("ProgressCircle", (test) => {
    Assert.examples(test, {
        progressCircleBasic: ex.progressCircleBasic,
        progressCircleIndeterminate: ex.progressCircleIndeterminate,
        progressCircleETA: ex.progressCircleETA,
    });

    test("creates progress circle at 60%", $ => {
        const p = $.let(ProgressCircle.Root(60.0));
        const v = p.unwrap().unwrap("ProgressCircle");
        $(Assert.equal(v.value, 60.0));
        $(Assert.equal(v.indeterminate.hasTag("none"), true));
        $(Assert.equal(v.style.hasTag("none"), true));
    });

    test("creates indeterminate progress circle", $ => {
        const p = $.let(ProgressCircle.Root(0.0, { indeterminate: true }));
        $(Assert.equal(p.unwrap().unwrap("ProgressCircle").indeterminate.unwrap("some"), true));
    });

    test("creates progress circle with showValueText", $ => {
        const p = $.let(ProgressCircle.Root(42.0, { showValueText: true }));
        $(Assert.equal(p.unwrap().unwrap("ProgressCircle").showValueText.unwrap("some"), true));
    });

    test("creates progress circle with min/max + ETA fields", $ => {
        const p = $.let(ProgressCircle.Root(30.0, {
            min: 0,
            max: 50,
            estimatedDuration: 60n,
            startedAt: new Date("2026-01-01T10:00:00Z"),
        }));
        const v = p.unwrap().unwrap("ProgressCircle");
        $(Assert.equal(v.min.unwrap("some"), 0.0));
        $(Assert.equal(v.max.unwrap("some"), 50.0));
        $(Assert.equal(v.estimatedDuration.unwrap("some"), 60n));
        $(Assert.equal(v.startedAt.hasTag("some"), true));
    });

    test("creates progress circle with colour slots + thickness", $ => {
        const p = $.let(ProgressCircle.Root(50.0, {
            style: {
                colorPalette: "blue",
                size: "lg",
                thickness: "6px",
                trackColor: "#e5e7eb",
                fillColor: "#3d5cff",
                labelColor: "#111827",
            },
        }));
        const s = p.unwrap().unwrap("ProgressCircle").style.unwrap("some");
        $(Assert.equal(s.colorPalette.unwrap("some").hasTag("blue"), true));
        $(Assert.equal(s.size.unwrap("some").hasTag("lg"), true));
        $(Assert.equal(s.thickness.unwrap("some"), "6px"));
        $(Assert.equal(s.trackColor.unwrap("some"), "#e5e7eb"));
        $(Assert.equal(s.fillColor.unwrap("some"), "#3d5cff"));
        $(Assert.equal(s.labelColor.unwrap("some"), "#111827"));
    });
}, { platformFns: TestImpl });
