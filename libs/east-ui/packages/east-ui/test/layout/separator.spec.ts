/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Separator } from "@elaraai/east-ui";
import * as ex from "./separator.examples.js";

describeEast("Separator", (test) => {
    Assert.examples(test, {
        separatorHorizontal: ex.separatorHorizontal,
        separatorVertical: ex.separatorVertical,
        separatorSolid: ex.separatorSolid,
        separatorDashed: ex.separatorDashed,
        separatorDotted: ex.separatorDotted,
        separatorSizes: ex.separatorSizes,
        separatorLabeled: ex.separatorLabeled,
        separatorColored: ex.separatorColored,
        separatorFormDivider: ex.separatorFormDivider,
        separatorWithEyebrow: ex.separatorWithEyebrow,
        separatorAlignedStart: ex.separatorAlignedStart,
    });

    // =========================================================================
    // Basic Creation
    // =========================================================================

    test("creates separator with no options", $ => {
        const separator = $.let(Separator.Root());

        $(Assert.equal(separator.unwrap().unwrap("Separator").orientation.hasTag("none"), true));
        $(Assert.equal(separator.unwrap().unwrap("Separator").variant.hasTag("none"), true));
        $(Assert.equal(separator.unwrap().unwrap("Separator").size.hasTag("none"), true));
        $(Assert.equal(separator.unwrap().unwrap("Separator").color.hasTag("none"), true));
        $(Assert.equal(separator.unwrap().unwrap("Separator").label.hasTag("none"), true));
    });

    // =========================================================================
    // Orientation
    // =========================================================================

    test("creates horizontal separator", $ => {
        const separator = $.let(Separator.Root({
            orientation: "horizontal",
        }));

        $(Assert.equal(separator.unwrap().unwrap("Separator").orientation.hasTag("some"), true));
        $(Assert.equal(separator.unwrap().unwrap("Separator").orientation.unwrap("some").hasTag("horizontal"), true));
    });

    test("creates vertical separator", $ => {
        const separator = $.let(Separator.Root({
            orientation: "vertical",
        }));

        $(Assert.equal(separator.unwrap().unwrap("Separator").orientation.hasTag("some"), true));
        $(Assert.equal(separator.unwrap().unwrap("Separator").orientation.unwrap("some").hasTag("vertical"), true));
    });

    // =========================================================================
    // Variant (Line Style)
    // =========================================================================

    test("creates separator with solid variant", $ => {
        const separator = $.let(Separator.Root({
            variant: "solid",
        }));

        $(Assert.equal(separator.unwrap().unwrap("Separator").variant.hasTag("some"), true));
        $(Assert.equal(separator.unwrap().unwrap("Separator").variant.unwrap("some").hasTag("solid"), true));
    });

    test("creates separator with dashed variant", $ => {
        const separator = $.let(Separator.Root({
            variant: "dashed",
        }));

        $(Assert.equal(separator.unwrap().unwrap("Separator").variant.hasTag("some"), true));
        $(Assert.equal(separator.unwrap().unwrap("Separator").variant.unwrap("some").hasTag("dashed"), true));
    });

    test("creates separator with dotted variant", $ => {
        const separator = $.let(Separator.Root({
            variant: "dotted",
        }));

        $(Assert.equal(separator.unwrap().unwrap("Separator").variant.hasTag("some"), true));
        $(Assert.equal(separator.unwrap().unwrap("Separator").variant.unwrap("some").hasTag("dotted"), true));
    });

    // =========================================================================
    // Size
    // =========================================================================

    test("creates separator with small size", $ => {
        const separator = $.let(Separator.Root({
            size: "sm",
        }));

        $(Assert.equal(separator.unwrap().unwrap("Separator").size.hasTag("some"), true));
        $(Assert.equal(separator.unwrap().unwrap("Separator").size.unwrap("some").hasTag("sm"), true));
    });

    test("creates separator with medium size", $ => {
        const separator = $.let(Separator.Root({
            size: "md",
        }));

        $(Assert.equal(separator.unwrap().unwrap("Separator").size.hasTag("some"), true));
        $(Assert.equal(separator.unwrap().unwrap("Separator").size.unwrap("some").hasTag("md"), true));
    });

    test("creates separator with large size", $ => {
        const separator = $.let(Separator.Root({
            size: "lg",
        }));

        $(Assert.equal(separator.unwrap().unwrap("Separator").size.hasTag("some"), true));
        $(Assert.equal(separator.unwrap().unwrap("Separator").size.unwrap("some").hasTag("lg"), true));
    });

    // =========================================================================
    // Color
    // =========================================================================

    test("creates separator with color", $ => {
        const separator = $.let(Separator.Root({
            color: "gray.300",
        }));

        $(Assert.equal(separator.unwrap().unwrap("Separator").color.hasTag("some"), true));
        $(Assert.equal(separator.unwrap().unwrap("Separator").color.unwrap("some"), "gray.300"));
    });

    test("creates separator with custom color", $ => {
        const separator = $.let(Separator.Root({
            color: "#e2e8f0",
        }));

        $(Assert.equal(separator.unwrap().unwrap("Separator").color.hasTag("some"), true));
        $(Assert.equal(separator.unwrap().unwrap("Separator").color.unwrap("some"), "#e2e8f0"));
    });

    // =========================================================================
    // Label
    // =========================================================================

    test("creates separator with label", $ => {
        const separator = $.let(Separator.Root({
            label: "OR",
        }));

        // String labels coerce to Text.Root at the factory — the `label` field
        // is a UIComponentType, so unwrap the Text inside.
        $(Assert.equal(separator.unwrap().unwrap("Separator").label.hasTag("some"), true));
        $(Assert.equal(separator.unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "OR"));
    });

    test("creates separator with long label", $ => {
        const separator = $.let(Separator.Root({
            label: "Continue with",
        }));

        $(Assert.equal(separator.unwrap().unwrap("Separator").label.hasTag("some"), true));
        $(Assert.equal(separator.unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "Continue with"));
    });

    // =========================================================================
    // Multiple Properties
    // =========================================================================

    test("creates separator with multiple properties", $ => {
        const separator = $.let(Separator.Root({
            orientation: "horizontal",
            variant: "dashed",
            size: "md",
            color: "gray.400",
            label: "Section Break",
        }));

        $(Assert.equal(separator.unwrap().unwrap("Separator").orientation.unwrap("some").hasTag("horizontal"), true));
        $(Assert.equal(separator.unwrap().unwrap("Separator").variant.unwrap("some").hasTag("dashed"), true));
        $(Assert.equal(separator.unwrap().unwrap("Separator").size.unwrap("some").hasTag("md"), true));
        $(Assert.equal(separator.unwrap().unwrap("Separator").color.unwrap("some"), "gray.400"));
        // String label coerces to Text.Root; unwrap the Text value.
        $(Assert.equal(separator.unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "Section Break"));
    });

    // =========================================================================
    // Typical Use Cases
    // =========================================================================

    test("creates simple horizontal divider", $ => {
        const divider = $.let(Separator.Root({
            orientation: "horizontal",
        }));

        $(Assert.equal(divider.unwrap().unwrap("Separator").orientation.unwrap("some").hasTag("horizontal"), true));
    });

    test("creates labeled OR separator for forms", $ => {
        const orSeparator = $.let(Separator.Root({
            label: "OR",
            color: "gray.400",
        }));

        // String label coerces to Text.Root; unwrap the Text value.
        $(Assert.equal(orSeparator.unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "OR"));
        $(Assert.equal(orSeparator.unwrap().unwrap("Separator").color.unwrap("some"), "gray.400"));
    });

    test("creates vertical separator for side-by-side content", $ => {
        const verticalDivider = $.let(Separator.Root({
            orientation: "vertical",
            color: "gray.200",
        }));

        $(Assert.equal(verticalDivider.unwrap().unwrap("Separator").orientation.unwrap("some").hasTag("vertical"), true));
        $(Assert.equal(verticalDivider.unwrap().unwrap("Separator").color.unwrap("some"), "gray.200"));
    });

    test("creates styled section divider", $ => {
        const sectionDivider = $.let(Separator.Root({
            variant: "dotted",
            color: "blue.300",
            size: "sm",
        }));

        $(Assert.equal(sectionDivider.unwrap().unwrap("Separator").variant.unwrap("some").hasTag("dotted"), true));
        $(Assert.equal(sectionDivider.unwrap().unwrap("Separator").color.unwrap("some"), "blue.300"));
        $(Assert.equal(sectionDivider.unwrap().unwrap("Separator").size.unwrap("some").hasTag("sm"), true));
    });

    // =========================================================================
    // Label alignment (start | center | end)
    // =========================================================================

    test("creates separator with align: start", $ => {
        const sep = $.let(Separator.Root({ label: "Phase 1", align: "start" }));
        $(Assert.equal(sep.unwrap().unwrap("Separator").align.unwrap("some").hasTag("start"), true));
    });

    test("creates separator with align: center", $ => {
        const sep = $.let(Separator.Root({ label: "Cross-phase decisions", align: "center" }));
        $(Assert.equal(sep.unwrap().unwrap("Separator").align.unwrap("some").hasTag("center"), true));
    });

    test("creates separator with align: end", $ => {
        const sep = $.let(Separator.Root({ label: "Notes", align: "end" }));
        $(Assert.equal(sep.unwrap().unwrap("Separator").align.unwrap("some").hasTag("end"), true));
    });

    test("align defaults to none when unset", $ => {
        const sep = $.let(Separator.Root({ label: "OR" }));
        $(Assert.equal(sep.unwrap().unwrap("Separator").align.hasTag("none"), true));
    });
}, {   platformFns: TestImpl,});
