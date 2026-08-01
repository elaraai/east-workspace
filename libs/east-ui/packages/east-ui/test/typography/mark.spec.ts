/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { type ExprType } from "@elaraai/east";
import { Mark } from "@elaraai/east-ui/internal";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./mark.examples.js";

describeEast("Mark", (test) => {
    Assert.examples(test, {
        markBasic: ex.markBasic,
        markVariants: ex.markVariants,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#459).
    // The mono-uppercase Text captions are the stable per-mini anchors.
    // =========================================================================

    test("markVariants panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.markVariants.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 16n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "SUBTLE"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "SOLID"));
        $(Assert.equal(rows.get(4n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "TEXT"));
        $(Assert.equal(rows.get(6n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "PLAIN"));
        $(Assert.equal(rows.get(8n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "COLORS"));
        $(Assert.equal(rows.get(10n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "SOLID COLORS"));
        $(Assert.equal(rows.get(12n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "IN CONTEXT"));
        $(Assert.equal(rows.get(14n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "INTERACTIVE"));
    });

    // =========================================================================
    // Basic Creation — { value, style } shape
    // =========================================================================

    test("creates mark with string value", $ => {
        const mark = $.let(Mark.Root("Important"));

        $(Assert.equal(mark.unwrap().unwrap("Mark").value, "Important"));
    });

    test("creates mark with no style — style is none", $ => {
        const mark = $.let(Mark.Root("Text"));

        $(Assert.equal(mark.unwrap().unwrap("Mark").value, "Text"));
        $(Assert.equal(mark.unwrap().unwrap("Mark").style.hasTag("none"), true));
    });

    // =========================================================================
    // Variants (inside style)
    // =========================================================================

    test("creates subtle variant mark", $ => {
        const mark = $.let(Mark.Root("Subtle", { variant: "subtle" }));
        const style = mark.unwrap().unwrap("Mark").style.unwrap("some");
        $(Assert.equal(style.variant.hasTag("some"), true));
        $(Assert.equal(style.variant.unwrap("some").hasTag("subtle"), true));
    });

    test("creates solid variant mark", $ => {
        const mark = $.let(Mark.Root("Solid", { variant: "solid" }));
        const style = mark.unwrap().unwrap("Mark").style.unwrap("some");
        $(Assert.equal(style.variant.unwrap("some").hasTag("solid"), true));
    });

    test("creates text variant mark", $ => {
        const mark = $.let(Mark.Root("Text", { variant: "text" }));
        const style = mark.unwrap().unwrap("Mark").style.unwrap("some");
        $(Assert.equal(style.variant.unwrap("some").hasTag("text"), true));
    });

    test("creates plain variant mark", $ => {
        const mark = $.let(Mark.Root("Plain", { variant: "plain" }));
        const style = mark.unwrap().unwrap("Mark").style.unwrap("some");
        $(Assert.equal(style.variant.unwrap("some").hasTag("plain"), true));
    });

    // =========================================================================
    // Color Palette (inside style)
    // =========================================================================

    test("creates mark with yellow colorPalette", $ => {
        const mark = $.let(Mark.Root("Highlighted", { colorPalette: "yellow" }));
        const style = mark.unwrap().unwrap("Mark").style.unwrap("some");
        $(Assert.equal(style.colorPalette.hasTag("some"), true));
        $(Assert.equal(style.colorPalette.unwrap("some"), "yellow"));
    });

    test("creates mark with green colorPalette", $ => {
        const mark = $.let(Mark.Root("Success", { colorPalette: "green" }));
        const style = mark.unwrap().unwrap("Mark").style.unwrap("some");
        $(Assert.equal(style.colorPalette.unwrap("some"), "green"));
    });

    test("creates mark with red colorPalette", $ => {
        const mark = $.let(Mark.Root("Error", { colorPalette: "red" }));
        const style = mark.unwrap().unwrap("Mark").style.unwrap("some");
        $(Assert.equal(style.colorPalette.unwrap("some"), "red"));
    });

    // =========================================================================
    // Colour escape hatches (inside style)
    // =========================================================================

    test("creates mark with explicit color + background", $ => {
        const mark = $.let(Mark.Root("Branded", {
            color: "#7a3b2e",
            background: "#fde3c6",
        }));
        const style = mark.unwrap().unwrap("Mark").style.unwrap("some");
        $(Assert.equal(style.color.unwrap("some"), "#7a3b2e"));
        $(Assert.equal(style.background.unwrap("some"), "#fde3c6"));
    });

    // =========================================================================
    // Combined Options
    // =========================================================================

    test("creates mark with variant + palette", $ => {
        const mark = $.let(Mark.Root("Featured", {
            variant: "solid",
            colorPalette: "blue",
        }));
        const style = mark.unwrap().unwrap("Mark").style.unwrap("some");

        $(Assert.equal(mark.unwrap().unwrap("Mark").value, "Featured"));
        $(Assert.equal(style.variant.unwrap("some").hasTag("solid"), true));
        $(Assert.equal(style.colorPalette.unwrap("some"), "blue"));
    });

    test("creates warning mark", $ => {
        const mark = $.let(Mark.Root("Warning", {
            variant: "subtle",
            colorPalette: "orange",
        }));
        const style = mark.unwrap().unwrap("Mark").style.unwrap("some");

        $(Assert.equal(mark.unwrap().unwrap("Mark").value, "Warning"));
        $(Assert.equal(style.variant.unwrap("some").hasTag("subtle"), true));
        $(Assert.equal(style.colorPalette.unwrap("some"), "orange"));
    });

    test("creates info mark", $ => {
        const mark = $.let(Mark.Root("Note", {
            variant: "text",
            colorPalette: "cyan",
        }));
        const style = mark.unwrap().unwrap("Mark").style.unwrap("some");

        $(Assert.equal(mark.unwrap().unwrap("Mark").value, "Note"));
        $(Assert.equal(style.variant.unwrap("some").hasTag("text"), true));
    });
}, { platformFns: TestImpl });
