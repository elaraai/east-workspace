/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { BarStrip, Text } from "@elaraai/east-ui/internal";
import * as ex from "./bar-strip.examples.js";

describeEast("BarStrip", (test) => {
    Assert.examples(test, {
        barStripBasic: ex.barStripBasic,
        barStripSorted: ex.barStripSorted,
        barStripDensities: ex.barStripDensities,
        barStripMaxItems: ex.barStripMaxItems,
    });

    test("creates a BarStrip with three items", $ => {
        const s = $.let(BarStrip.Root([
            { label: Text.Root("A"), value: 10.0 },
            { label: Text.Root("B"), value: 20.0 },
            { label: Text.Root("C"), value: 30.0 },
        ]));
        $(Assert.equal(s.unwrap().unwrap("BarStrip").items.size(), 3n));
        $(Assert.equal(s.unwrap().unwrap("BarStrip").showValues.hasTag("none"), true));
        $(Assert.equal(s.unwrap().unwrap("BarStrip").sort.hasTag("none"), true));
    });

    test("items carry tone + value", $ => {
        const s = $.let(BarStrip.Root([
            { label: Text.Root("X"), value: 42.0, tone: "info" },
        ]));
        $(Assert.equal(s.unwrap().unwrap("BarStrip").items.get(0n).value, 42.0));
        $(Assert.equal(s.unwrap().unwrap("BarStrip").items.get(0n).tone.unwrap("some").hasTag("info"), true));
    });

    test("BarStrip with sort desc + thickness md", $ => {
        const s = $.let(BarStrip.Root([
            { label: Text.Root("A"), value: 10.0 },
            { label: Text.Root("B"), value: 20.0 },
        ], { sort: "desc", thickness: "md" }));
        $(Assert.equal(s.unwrap().unwrap("BarStrip").sort.unwrap("some").hasTag("desc"), true));
        $(Assert.equal(s.unwrap().unwrap("BarStrip").style.unwrap("some").thickness.unwrap("some").hasTag("md"), true));
    });

    test("BarStrip with maxItems + showValues false", $ => {
        const s = $.let(BarStrip.Root([
            { label: Text.Root("A"), value: 10.0 },
            { label: Text.Root("B"), value: 20.0 },
        ], { maxItems: 1n, showValues: false }));
        $(Assert.equal(s.unwrap().unwrap("BarStrip").maxItems.unwrap("some"), 1n));
        $(Assert.equal(s.unwrap().unwrap("BarStrip").showValues.unwrap("some"), false));
    });

    test("BarStrip with explicit colour slots", $ => {
        const s = $.let(BarStrip.Root([
            { label: Text.Root("A"), value: 1.0 },
        ], { trackColor: "bg.subtle", labelColor: "fg.muted", valueColor: "fg.inverse" }));
        const style = $.let(s.unwrap().unwrap("BarStrip").style.unwrap("some"));
        $(Assert.equal(style.trackColor.unwrap("some"), "bg.subtle"));
        $(Assert.equal(style.labelColor.unwrap("some"), "fg.muted"));
        $(Assert.equal(style.valueColor.unwrap("some"), "fg.inverse"));
    });
}, { platformFns: TestImpl });
