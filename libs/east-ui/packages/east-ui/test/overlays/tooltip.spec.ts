/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Tooltip, Button, Text } from "@elaraai/east-ui/internal";
import * as ex from "./tooltip.examples.js";

describeEast("Tooltip", (test) => {
    Assert.examples(test, {
        tooltipBasic: ex.tooltipBasic,
        tooltipArrow: ex.tooltipArrow,
    });

    // =========================================================================
    // Basic Creation
    // =========================================================================

    test("creates basic tooltip with button trigger", $ => {
        const tooltip = $.let(Tooltip.Root(
            "This is a tooltip",
            { trigger: Button.Root("Hover me") }
        ));

        $(Assert.equal(tooltip.unwrap().getTag(), "Tooltip"));
        $(Assert.equal(tooltip.unwrap().unwrap("Tooltip").content, "This is a tooltip"));
        $(Assert.equal(tooltip.unwrap().unwrap("Tooltip").trigger.unwrap().getTag(), "Button"));
    });

    test("creates tooltip with text trigger", $ => {
        const tooltip = $.let(Tooltip.Root(
            "Additional information",
            { trigger: Text.Root("Hover for info") }
        ));

        $(Assert.equal(tooltip.unwrap().unwrap("Tooltip").content, "Additional information"));
        $(Assert.equal(tooltip.unwrap().unwrap("Tooltip").trigger.unwrap().getTag(), "Text"));
    });

    test("creates tooltip with default options", $ => {
        const tooltip = $.let(Tooltip.Root(
            "Help text",
            { trigger: Button.Root("Help") }
        ));

        $(Assert.equal(tooltip.unwrap().unwrap("Tooltip").style.hasTag("none"), true));
    });

    // =========================================================================
    // Placement
    // =========================================================================

    test("creates tooltip with top placement", $ => {
        const tooltip = $.let(Tooltip.Root(
            "Tooltip above",
            { trigger: Button.Root("Hover"), placement: "top" }
        ));
        const sv = tooltip.unwrap().unwrap("Tooltip").style.unwrap("some");
        $(Assert.equal(sv.placement.unwrap("some").hasTag("top"), true));
    });

    test("creates tooltip with bottom placement", $ => {
        const tooltip = $.let(Tooltip.Root(
            "Tooltip below",
            { trigger: Button.Root("Hover"), placement: "bottom" }
        ));
        const sv = tooltip.unwrap().unwrap("Tooltip").style.unwrap("some");
        $(Assert.equal(sv.placement.unwrap("some").hasTag("bottom"), true));
    });

    test("creates tooltip with left placement", $ => {
        const tooltip = $.let(Tooltip.Root(
            "Tooltip left",
            { trigger: Button.Root("Hover"), placement: "left" }
        ));
        const sv = tooltip.unwrap().unwrap("Tooltip").style.unwrap("some");
        $(Assert.equal(sv.placement.unwrap("some").hasTag("left"), true));
    });

    test("creates tooltip with right placement", $ => {
        const tooltip = $.let(Tooltip.Root(
            "Tooltip right",
            { trigger: Button.Root("Hover"), placement: "right" }
        ));
        const sv = tooltip.unwrap().unwrap("Tooltip").style.unwrap("some");
        $(Assert.equal(sv.placement.unwrap("some").hasTag("right"), true));
    });

    test("creates tooltip with top-start placement", $ => {
        const tooltip = $.let(Tooltip.Root(
            "Tooltip top start",
            { trigger: Button.Root("Hover"), placement: "top-start" }
        ));
        const sv = tooltip.unwrap().unwrap("Tooltip").style.unwrap("some");
        $(Assert.equal(sv.placement.unwrap("some").hasTag("top-start"), true));
    });

    test("creates tooltip with bottom-end placement", $ => {
        const tooltip = $.let(Tooltip.Root(
            "Tooltip bottom end",
            { trigger: Button.Root("Hover"), placement: "bottom-end" }
        ));
        const sv = tooltip.unwrap().unwrap("Tooltip").style.unwrap("some");
        $(Assert.equal(sv.placement.unwrap("some").hasTag("bottom-end"), true));
    });

    // =========================================================================
    // Arrow
    // =========================================================================

    test("creates tooltip with arrow", $ => {
        const tooltip = $.let(Tooltip.Root(
            "Tooltip with arrow",
            { trigger: Button.Root("Hover"), hasArrow: true }
        ));
        const sv = tooltip.unwrap().unwrap("Tooltip").style.unwrap("some");
        $(Assert.equal(sv.hasArrow.unwrap("some"), true));
    });

    test("creates tooltip without arrow", $ => {
        const tooltip = $.let(Tooltip.Root(
            "Tooltip without arrow",
            { trigger: Button.Root("Hover"), hasArrow: false }
        ));
        const sv = tooltip.unwrap().unwrap("Tooltip").style.unwrap("some");
        $(Assert.equal(sv.hasArrow.unwrap("some"), false));
    });

    // =========================================================================
    // Combined Options
    // =========================================================================

    test("creates tooltip with placement and arrow", $ => {
        const tooltip = $.let(Tooltip.Root(
            "Save your changes",
            { trigger: Button.Root("Save"), placement: "bottom", hasArrow: true }
        ));
        const sv = tooltip.unwrap().unwrap("Tooltip").style.unwrap("some");
        $(Assert.equal(sv.placement.unwrap("some").hasTag("bottom"), true));
        $(Assert.equal(sv.hasArrow.unwrap("some"), true));
    });

    test("creates tooltip with all options", $ => {
        const tooltip = $.let(Tooltip.Root(
            "This action cannot be undone",
            { trigger: Button.Root("Delete"), placement: "top", hasArrow: true }
        ));
        const t = tooltip.unwrap().unwrap("Tooltip");
        const sv = t.style.unwrap("some");
        $(Assert.equal(t.content, "This action cannot be undone"));
        $(Assert.equal(sv.placement.unwrap("some").hasTag("top"), true));
        $(Assert.equal(sv.hasArrow.unwrap("some"), true));
    });

    // =========================================================================
    // Practical Examples
    // =========================================================================

    test("creates help tooltip on form field", $ => {
        const tooltip = $.let(Tooltip.Root(
            "Enter your full legal name as it appears on your ID",
            { trigger: Text.Root("?"), placement: "right", hasArrow: true }
        ));
        const t = tooltip.unwrap().unwrap("Tooltip");
        const sv = t.style.unwrap("some");
        $(Assert.equal(t.trigger.unwrap().unwrap("Text").value, "?"));
        $(Assert.equal(sv.placement.unwrap("some").hasTag("right"), true));
    });

    test("creates action button tooltip", $ => {
        const tooltip = $.let(Tooltip.Root(
            "Submit your application for review",
            { trigger: Button.Root("Submit"), placement: "top" }
        ));

        $(Assert.equal(tooltip.unwrap().unwrap("Tooltip").trigger.unwrap().unwrap("Button").label.unwrap().unwrap("Text").value, "Submit"));
    });

    test("creates info tooltip", $ => {
        const tooltip = $.let(Tooltip.Root(
            "Click to read our full terms and conditions",
            { trigger: Text.Root("Terms & Conditions"), placement: "bottom-start" }
        ));
        const sv = tooltip.unwrap().unwrap("Tooltip").style.unwrap("some");
        $(Assert.equal(sv.placement.unwrap("some").hasTag("bottom-start"), true));
    });
}, {   platformFns: TestImpl,});
