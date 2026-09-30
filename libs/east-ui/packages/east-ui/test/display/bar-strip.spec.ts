/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, test as nodeTest } from "node:test";
import assert from "node:assert/strict";
import { ArrayType, East, FloatType, StringType, StructType, type ExprType, type ValueTypeOf } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { BarStrip, Text } from "@elaraai/east-ui/internal";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./bar-strip.examples.js";

describeEast("BarStrip", (test) => {
    Assert.examples(test, {
        barStripBasic: ex.barStripBasic,
        barStripVariants: ex.barStripVariants,
        barStripFromData: ex.barStripFromData,
    });

    test("BS1, BS2: the data form maps each row to a bar, in the rows' order; sort and maxItems ride with it as with written items", $ => {
        const rows = $.const([
            { region: "West", revenue: 27.0 },
            { region: "North", revenue: 42.0 },
            { region: "South", revenue: 31.0 },
        ], ArrayType(StructType({ region: StringType, revenue: FloatType })));
        const s = $.let(BarStrip.Root(rows, {
            item: r => ({ label: Text.Root(r.region), value: r.revenue, tone: "info" }),
            sort: "desc",
            maxItems: 2n,
        }));
        const strip = $.let(s.unwrap().unwrap("BarStrip"));
        $(Assert.equal(strip.items.map((_$2, bar) => bar.value), [27.0, 42.0, 31.0]));
        $(Assert.equal(strip.items.get(1n).label.unwrap().unwrap("Text").value, "North"));
        $(Assert.equal(strip.items.get(0n).tone.unwrap("some").hasTag("info"), true));
        $(Assert.equal(strip.items.get(0n).color.hasTag("none"), true));
        $(Assert.equal(strip.sort.unwrap("some").hasTag("desc"), true));
        $(Assert.equal(strip.maxItems.unwrap("some"), 2n));
    });

    test("barStripVariants is the live configurator", $ => {
        const panel = $.const(ex.barStripVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
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

describe("BarStrip — the data form's mapper (#1001)", () => {
    nodeTest("BS4: the mapper is reified once — expanded once, however many rows there are, and every row mapped through it", () => {
        let expansions = 0;
        const program = East.compile(East.function([], UIComponentType, ($) => {
            const rows = $.const([
                { region: "North", revenue: 42.0 },
                { region: "South", revenue: 31.0 },
                { region: "West", revenue: 27.0 },
            ], ArrayType(StructType({ region: StringType, revenue: FloatType })));
            return BarStrip.Root(rows, {
                item: r => {
                    expansions += 1;
                    return { label: Text.Root(r.region), value: r.revenue };
                },
            });
        }), []);
        assert.equal(expansions, 1);
        const value = program() as ValueTypeOf<typeof UIComponentType>;
        if (value.type !== "BarStrip") assert.fail(`expected a BarStrip, got ${value.type}`);
        assert.deepEqual(value.value.items.map((bar) => bar.value), [42.0, 31.0, 27.0]);
    });
});
