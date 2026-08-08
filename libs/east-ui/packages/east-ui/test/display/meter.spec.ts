/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { type ExprType } from "@elaraai/east";
import { Meter, Text, UIComponentType } from "@elaraai/east-ui/internal";
import * as ex from "./meter.examples.js";

describeEast("Meter", (test) => {
    Assert.examples(test, {
        meterBasic: ex.meterBasic,
        meterVariants: ex.meterVariants,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#462).
    // The mono-uppercase Text captions are the stable per-mini anchors.
    // =========================================================================

    test("meterVariants drives its preview from inline option tables", $ => {
        // Everything the configurator needs — the tone / density / thickness /
        // reading / scale / colour / caption tables — is declared inside the
        // example body, because the documentation capture only extracts `fn`.
        // That puts the tables inside the Reactive body, which TestImpl does not
        // execute, so they cannot be asserted from here; `Assert.examples` above
        // still compiles and evaluates the outer function. The per-axis coverage
        // lives in the Meter.Root tests below, which construct each option
        // directly.
        const panel = $.const(ex.meterVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });

    test("creates a basic meter", $ => {
        const m = $.let(Meter.Root(60.0));
        $(Assert.equal(m.unwrap().unwrap("Meter").value, 60.0));
        $(Assert.equal(m.unwrap().unwrap("Meter").max.hasTag("none"), true));
        $(Assert.equal(m.unwrap().unwrap("Meter").label.hasTag("none"), true));
        $(Assert.equal(m.unwrap().unwrap("Meter").tone.hasTag("none"), true));
        $(Assert.equal(m.unwrap().unwrap("Meter").style.hasTag("none"), true));
    });

    test("creates a meter with tone", $ => {
        const m = $.let(Meter.Root(85.0, { tone: "success" }));
        $(Assert.equal(m.unwrap().unwrap("Meter").tone.unwrap("some").hasTag("success"), true));
    });

    test("creates a meter with label + thickness", $ => {
        const m = $.let(Meter.Root(42.0, { label: Text.Root("Service level"), thickness: "lg" }));
        $(Assert.equal(m.unwrap().unwrap("Meter").label.hasTag("some"), true));
        $(Assert.equal(m.unwrap().unwrap("Meter").style.unwrap("some").thickness.unwrap("some").hasTag("lg"), true));
    });

    test("creates a meter with custom max", $ => {
        const m = $.let(Meter.Root(350.0, { max: 500.0 }));
        $(Assert.equal(m.unwrap().unwrap("Meter").max.unwrap("some"), 500.0));
    });

    test("creates a meter with explicit colour slots", $ => {
        const m = $.let(Meter.Root(50.0, { fillColor: "accent.purple", trackColor: "bg.subtle", labelColor: "accent.purple" }));
        $(Assert.equal(m.unwrap().unwrap("Meter").style.unwrap("some").fillColor.unwrap("some"), "accent.purple"));
        $(Assert.equal(m.unwrap().unwrap("Meter").style.unwrap("some").trackColor.unwrap("some"), "bg.subtle"));
        $(Assert.equal(m.unwrap().unwrap("Meter").style.unwrap("some").labelColor.unwrap("some"), "accent.purple"));
    });
}, { platformFns: TestImpl });
