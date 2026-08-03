/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Progress } from "@elaraai/east-ui/internal";
import { type ExprType } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./progress.examples.js";

describeEast("Progress", (test) => {
    Assert.examples(test, {
        progressBasic: ex.progressBasic,
        progressVariants: ex.progressVariants,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#463).
    // =========================================================================

    test("progressVariants drives its preview from inline option tables", $ => {
        // Everything the configurator needs — the tone / size / value-preset
        // tables plus the striped / animated / label switches — is declared
        // inside the example body, because the documentation capture only
        // extracts `fn`. That puts the tables inside the Reactive body, which
        // TestImpl does not execute, so they cannot be asserted from here;
        // `Assert.examples` above still compiles and evaluates the outer
        // function. The per-option coverage lives in the Progress.Root tests
        // below, which construct each option directly.
        const panel = $.const(ex.progressVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
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

    test("creates progress with style.variant + tone + size", $ => {
        const p = $.let(Progress.Root(50.0, {
            variant: "subtle", tone: "pos", size: "md",
        }));
        const s = p.unwrap().unwrap("Progress").style.unwrap("some");
        $(Assert.equal(s.variant.unwrap("some").hasTag("subtle"), true));
        $(Assert.equal(s.tone.unwrap("some").hasTag("pos"), true));
        $(Assert.equal(s.size.unwrap("some").hasTag("md"), true));
    });

    test("creates progress with style.striped + animated", $ => {
        const p = $.let(Progress.Root(50.0, { striped: true, animated: true }));
        const s = p.unwrap().unwrap("Progress").style.unwrap("some");
        $(Assert.equal(s.striped.unwrap("some"), true));
        $(Assert.equal(s.animated.unwrap("some"), true));
    });

    test("creates progress with colour slots", $ => {
        const p = $.let(Progress.Root(50.0, {
            trackColor: "bg.emphasized",
            fillColor: "link",
            labelColor: "fg.default",
        }));
        const s = p.unwrap().unwrap("Progress").style.unwrap("some");
        $(Assert.equal(s.trackColor.unwrap("some"), "bg.emphasized"));
        $(Assert.equal(s.fillColor.unwrap("some"), "link"));
        $(Assert.equal(s.labelColor.unwrap("some"), "fg.default"));
    });
}, { platformFns: TestImpl });
