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

    test("meterVariants panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.meterVariants.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 8n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "SUCCESS"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "WARNING"));
        $(Assert.equal(rows.get(4n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "DENSITIES"));
        $(Assert.equal(rows.get(6n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "CUSTOM MAX"));
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
        const m = $.let(Meter.Root(50.0, { fillColor: "purple.500", trackColor: "purple.100", labelColor: "purple.700" }));
        $(Assert.equal(m.unwrap().unwrap("Meter").style.unwrap("some").fillColor.unwrap("some"), "purple.500"));
        $(Assert.equal(m.unwrap().unwrap("Meter").style.unwrap("some").trackColor.unwrap("some"), "purple.100"));
        $(Assert.equal(m.unwrap().unwrap("Meter").style.unwrap("some").labelColor.unwrap("some"), "purple.700"));
    });
}, { platformFns: TestImpl });
