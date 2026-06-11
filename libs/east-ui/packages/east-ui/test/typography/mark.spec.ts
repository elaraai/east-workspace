/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Mark } from "@elaraai/east-ui/internal";
import * as ex from "./mark.examples.js";

describeEast("Mark", (test) => {
    Assert.examples(test, {
        markBasic: ex.markBasic,
        markSubtle: ex.markSubtle,
        markSolid: ex.markSolid,
        markText: ex.markText,
        markPlain: ex.markPlain,
        markColors: ex.markColors,
        markSolidColors: ex.markSolidColors,
        markInContext: ex.markInContext,
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
