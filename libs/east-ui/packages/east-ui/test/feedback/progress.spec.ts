/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Progress } from "@elaraai/east-ui";
import * as ex from "./progress.examples.js";

describeEast("Progress", (test) => {
    Assert.examples(test, {
        progressBasic: ex.progressBasic,
        progressLabeled: ex.progressLabeled,
        progressColors: ex.progressColors,
        progressSizes: ex.progressSizes,
        progressStriped: ex.progressStriped,
        progressRange: ex.progressRange,
        progressIndeterminate: ex.progressIndeterminate,
        progressWithETA: ex.progressWithETA,
        progressInteractive: ex.progressInteractive,
    });

    // =========================================================================
    // Basic creation
    // =========================================================================

    test("creates progress at 50%", $ => {
        const p = $.let(Progress.Root(50.0));
        const v = p.unwrap().unwrap("Progress");
        $(Assert.equal(v.value, 50.0));
        $(Assert.equal(v.min.hasTag("none"), true));
        $(Assert.equal(v.max.hasTag("none"), true));
        $(Assert.equal(v.indeterminate.hasTag("none"), true));
        $(Assert.equal(v.style.hasTag("none"), true));
    });

    test("creates progress with custom min/max", $ => {
        const p = $.let(Progress.Root(7.5, { min: 0, max: 10 }));
        const v = p.unwrap().unwrap("Progress");
        $(Assert.equal(v.min.unwrap("some"), 0.0));
        $(Assert.equal(v.max.unwrap("some"), 10.0));
    });

    // =========================================================================
    // Label / valueText
    // =========================================================================

    test("creates progress with label + valueText", $ => {
        const p = $.let(Progress.Root(60.0, { label: "Upload", valueText: "60%" }));
        const v = p.unwrap().unwrap("Progress");
        $(Assert.equal(v.label.unwrap("some"), "Upload"));
        $(Assert.equal(v.valueText.unwrap("some"), "60%"));
    });

    // =========================================================================
    // NEW: indeterminate / showValue / ETA
    // =========================================================================

    test("creates indeterminate progress", $ => {
        const p = $.let(Progress.Root(0.0, { indeterminate: true }));
        $(Assert.equal(p.unwrap().unwrap("Progress").indeterminate.unwrap("some"), true));
    });

    test("creates progress with showValue flag", $ => {
        const p = $.let(Progress.Root(42.0, { showValue: true }));
        $(Assert.equal(p.unwrap().unwrap("Progress").showValue.unwrap("some"), true));
    });

    test("creates progress with estimatedDuration and startedAt", $ => {
        const started = new Date("2026-01-01T09:00:00Z");
        const p = $.let(Progress.Root(40.0, {
            estimatedDuration: 120n,
            startedAt: started,
        }));
        const v = p.unwrap().unwrap("Progress");
        $(Assert.equal(v.estimatedDuration.unwrap("some"), 120n));
        $(Assert.equal(v.startedAt.hasTag("some"), true));
    });

    // =========================================================================
    // Style — visual presets + colour slots
    // =========================================================================

    test("creates progress with style.variant + colorPalette + size", $ => {
        const p = $.let(Progress.Root(50.0, {
            style: { variant: "subtle", colorPalette: "blue", size: "md" },
        }));
        const s = p.unwrap().unwrap("Progress").style.unwrap("some");
        $(Assert.equal(s.variant.unwrap("some").hasTag("subtle"), true));
        $(Assert.equal(s.colorPalette.unwrap("some").hasTag("blue"), true));
        $(Assert.equal(s.size.unwrap("some").hasTag("md"), true));
    });

    test("creates progress with style.striped + animated", $ => {
        const p = $.let(Progress.Root(50.0, { style: { striped: true, animated: true } }));
        const s = p.unwrap().unwrap("Progress").style.unwrap("some");
        $(Assert.equal(s.striped.unwrap("some"), true));
        $(Assert.equal(s.animated.unwrap("some"), true));
    });

    test("creates progress with colour slots", $ => {
        const p = $.let(Progress.Root(50.0, {
            style: {
                trackColor: "#e5e7eb",
                fillColor: "#3d5cff",
                labelColor: "#111827",
            },
        }));
        const s = p.unwrap().unwrap("Progress").style.unwrap("some");
        $(Assert.equal(s.trackColor.unwrap("some"), "#e5e7eb"));
        $(Assert.equal(s.fillColor.unwrap("some"), "#3d5cff"));
        $(Assert.equal(s.labelColor.unwrap("some"), "#111827"));
    });
}, { platformFns: TestImpl });
