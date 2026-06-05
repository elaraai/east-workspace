/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { SegmentGroup, Text } from "@elaraai/east-ui";
import * as ex from "./segment-group.examples.js";

describeEast("SegmentGroup", (test) => {
    Assert.examples(test, {
        segmentGroupViewToggle: ex.segmentGroupViewToggle,
        segmentGroupSized: ex.segmentGroupSized,
        segmentGroupReactive: ex.segmentGroupReactive,
        segmentGroupBranded: ex.segmentGroupBranded,
    });

    // =========================================================================
    // SegmentGroup.Item
    // =========================================================================

    test("creates item with string label (coerced to Text.Root)", $ => {
        const item = $.let(SegmentGroup.Item("a", "Option A"));
        $(Assert.equal(item.value, "a"));
        $(Assert.equal(item.label.unwrap().unwrap("Text").value, "Option A"));
        $(Assert.equal(item.disabled.hasTag("none"), true));
    });

    test("creates item with rich UIComp label", $ => {
        const item = $.let(SegmentGroup.Item("b", Text.Root("Bold", { fontWeight: "bold" })));
        $(Assert.equal(item.label.unwrap().unwrap("Text").value, "Bold"));
    });

    test("creates disabled item", $ => {
        const item = $.let(SegmentGroup.Item("c", "Disabled", { disabled: true }));
        $(Assert.equal(item.disabled.unwrap("some"), true));
    });

    // =========================================================================
    // SegmentGroup.Root — defaults
    // =========================================================================

    test("creates segment group with value + items only", $ => {
        const sg = $.let(SegmentGroup.Root({ value: "a", items: [
            SegmentGroup.Item("a", "A"),
            SegmentGroup.Item("b", "B"),
        ] }));
        const s = sg.unwrap().unwrap("SegmentGroup");
        $(Assert.equal(s.value, "a"));
        $(Assert.equal(s.items.size(), 2n));
        $(Assert.equal(s.onChange.hasTag("none"), true));
        $(Assert.equal(s.style.hasTag("none"), true));
    });

    // =========================================================================
    // Visual presets (inside style)
    // =========================================================================

    test("creates segment group with size inside style", $ => {
        const sg = $.let(SegmentGroup.Root({ value: "a", items: [
            SegmentGroup.Item("a", "A"),
        ], size: "sm" }));
        $(Assert.equal(
            sg.unwrap().unwrap("SegmentGroup").style.unwrap("some").size.unwrap("some").hasTag("sm"),
            true,
        ));
    });

    test("creates segment group with colorPalette", $ => {
        const sg = $.let(SegmentGroup.Root({ value: "a", items: [
            SegmentGroup.Item("a", "A"),
        ], colorPalette: "blue" }));
        $(Assert.equal(
            sg.unwrap().unwrap("SegmentGroup").style.unwrap("some").colorPalette.unwrap("some").hasTag("blue"),
            true,
        ));
    });

    test("creates vertical segment group", $ => {
        const sg = $.let(SegmentGroup.Root({ value: "a", items: [
            SegmentGroup.Item("a", "A"),
        ], orientation: "vertical" }));
        $(Assert.equal(
            sg.unwrap().unwrap("SegmentGroup").style.unwrap("some").orientation.unwrap("some").hasTag("vertical"),
            true,
        ));
    });

    // =========================================================================
    // Colour slots
    // =========================================================================

    test("creates segment group with full colour escape hatches", $ => {
        const sg = $.let(SegmentGroup.Root({ value: "a", items: [
            SegmentGroup.Item("a", "A"),
        ], 
            background: "#f9fafb",
            borderColor: "#e5e7eb",
            activeBackground: "#1a2234",
            activeColor: "#ffffff",
            inactiveColor: "#6b7280",
        }));
        const s = sg.unwrap().unwrap("SegmentGroup").style.unwrap("some");
        $(Assert.equal(s.background.unwrap("some"), "#f9fafb"));
        $(Assert.equal(s.borderColor.unwrap("some"), "#e5e7eb"));
        $(Assert.equal(s.activeBackground.unwrap("some"), "#1a2234"));
        $(Assert.equal(s.activeColor.unwrap("some"), "#ffffff"));
        $(Assert.equal(s.inactiveColor.unwrap("some"), "#6b7280"));
    });

    // =========================================================================
    // Combined
    // =========================================================================

    test("creates fully-configured segment group", $ => {
        const sg = $.let(SegmentGroup.Root({ value: "demand", items: [
            SegmentGroup.Item("summary", "Summary"),
            SegmentGroup.Item("demand", "Demand"),
            SegmentGroup.Item("coverage", "Coverage"),
        ], 
            size: "sm",
            colorPalette: "teal",
            orientation: "horizontal",
            activeBackground: "#14b8a6",
        }));
        const s = sg.unwrap().unwrap("SegmentGroup");
        $(Assert.equal(s.value, "demand"));
        $(Assert.equal(s.items.size(), 3n));
        const vs = s.style.unwrap("some");
        $(Assert.equal(vs.size.unwrap("some").hasTag("sm"), true));
        $(Assert.equal(vs.colorPalette.unwrap("some").hasTag("teal"), true));
        $(Assert.equal(vs.activeBackground.unwrap("some"), "#14b8a6"));
    });
}, { platformFns: TestImpl });
