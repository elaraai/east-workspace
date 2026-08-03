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

    test("markVariants drives its preview from inline option tables", $ => {
        // Everything the configurator needs — the variant / palette tables and
        // the in-context switch — is declared inside the example body, because
        // the documentation capture only extracts `fn`. That puts the tables
        // inside the Reactive body, which TestImpl does not execute, so they
        // cannot be asserted from here; `Assert.examples` above still compiles
        // and evaluates the outer function. The per-variant coverage lives in
        // the Mark.Root tests below, which construct each variant directly.
        const panel = $.const(ex.markVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
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

    test("creates mark with warning colorPalette", $ => {
        const mark = $.let(Mark.Root("Highlighted", { colorPalette: "warning" }));
        const style = mark.unwrap().unwrap("Mark").style.unwrap("some");
        $(Assert.equal(style.colorPalette.hasTag("some"), true));
        $(Assert.equal(style.colorPalette.unwrap("some"), "warning"));
    });

    test("creates mark with success colorPalette", $ => {
        const mark = $.let(Mark.Root("Success", { colorPalette: "success" }));
        const style = mark.unwrap().unwrap("Mark").style.unwrap("some");
        $(Assert.equal(style.colorPalette.unwrap("some"), "success"));
    });

    test("creates mark with danger colorPalette", $ => {
        const mark = $.let(Mark.Root("Error", { colorPalette: "danger" }));
        const style = mark.unwrap().unwrap("Mark").style.unwrap("some");
        $(Assert.equal(style.colorPalette.unwrap("some"), "danger"));
    });

    // =========================================================================
    // Colour escape hatches (inside style)
    // =========================================================================

    test("creates mark with explicit color + background", $ => {
        const mark = $.let(Mark.Root("Branded", {
            color: "fg.danger",
            background: "bg.warning.subtle",
        }));
        const style = mark.unwrap().unwrap("Mark").style.unwrap("some");
        $(Assert.equal(style.color.unwrap("some"), "fg.danger"));
        $(Assert.equal(style.background.unwrap("some"), "bg.warning.subtle"));
    });

    // =========================================================================
    // Combined Options
    // =========================================================================

    test("creates mark with variant + palette", $ => {
        const mark = $.let(Mark.Root("Featured", {
            variant: "solid",
            colorPalette: "brand",
        }));
        const style = mark.unwrap().unwrap("Mark").style.unwrap("some");

        $(Assert.equal(mark.unwrap().unwrap("Mark").value, "Featured"));
        $(Assert.equal(style.variant.unwrap("some").hasTag("solid"), true));
        $(Assert.equal(style.colorPalette.unwrap("some"), "brand"));
    });

    test("creates warning mark", $ => {
        const mark = $.let(Mark.Root("Warning", {
            variant: "subtle",
            colorPalette: "warning",
        }));
        const style = mark.unwrap().unwrap("Mark").style.unwrap("some");

        $(Assert.equal(mark.unwrap().unwrap("Mark").value, "Warning"));
        $(Assert.equal(style.variant.unwrap("some").hasTag("subtle"), true));
        $(Assert.equal(style.colorPalette.unwrap("some"), "warning"));
    });

    test("creates info mark", $ => {
        const mark = $.let(Mark.Root("Note", {
            variant: "text",
            colorPalette: "info",
        }));
        const style = mark.unwrap().unwrap("Mark").style.unwrap("some");

        $(Assert.equal(mark.unwrap().unwrap("Mark").value, "Note"));
        $(Assert.equal(style.variant.unwrap("some").hasTag("text"), true));
    });
}, { platformFns: TestImpl });
