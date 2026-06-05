/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Text, Style } from "@elaraai/east-ui/internal";
import * as ex from "./text.examples.js";

describeEast("Text", (test) => {
    Assert.examples(test, {
        textBasic: ex.textBasic,
        textColored: ex.textColored,
        textBold: ex.textBold,
        textItalic: ex.textItalic,
        textFontWeights: ex.textFontWeights,
        textTransforms: ex.textTransforms,
        textBackground: ex.textBackground,
        textBordered: ex.textBordered,
        textColors: ex.textColors,
        textCombined: ex.textCombined,
        textDecoration: ex.textDecoration,
        textSpacing: ex.textSpacing,
        textOpacity: ex.textOpacity,
        textPaddingMargin: ex.textPaddingMargin,
        textOverflow: ex.textOverflow,
        textStyleScale: ex.textStyleScale,
        textMonoKpi: ex.textMonoKpi,
        textTabularNums: ex.textTabularNums,
    });

    // =========================================================================
    // Basic Creation — { value, style } shape
    // =========================================================================

    test("creates text with string value", $ => {
        const text = $.let(Text.Root("Hello"));

        $(Assert.equal(text.unwrap().unwrap("Text").value, "Hello"));
    });

    test("creates text with no style — style is none", $ => {
        const text = $.let(Text.Root("Plain"));

        $(Assert.equal(text.unwrap().unwrap("Text").value, "Plain"));
        $(Assert.equal(text.unwrap().unwrap("Text").style.hasTag("none"), true));
    });

    // =========================================================================
    // Style Properties — Individual (inside style)
    // =========================================================================

    test("creates text with textStyle", $ => {
        const text = $.let(Text.Root("Body md", { textStyle: "body-md" }));
        const style = text.unwrap().unwrap("Text").style.unwrap("some");
        $(Assert.equal(style.textStyle.hasTag("some"), true));
        $(Assert.equal(style.textStyle.unwrap("some").hasTag("body-md"), true));
    });

    test("creates text with mono-kpi textStyle", $ => {
        const text = $.let(Text.Root("$1.84M", { textStyle: "mono-kpi" }));
        const style = text.unwrap().unwrap("Text").style.unwrap("some");
        $(Assert.equal(style.textStyle.unwrap("some").hasTag("mono-kpi"), true));
    });

    test("creates text with fontFamily", $ => {
        const text = $.let(Text.Root("Mono", { fontFamily: "mono" }));
        const style = text.unwrap().unwrap("Text").style.unwrap("some");
        $(Assert.equal(style.fontFamily.unwrap("some").hasTag("mono"), true));
    });

    test("creates text with fontVariantNumeric", $ => {
        const text = $.let(Text.Root("42", { fontVariantNumeric: "tabular-nums" }));
        const style = text.unwrap().unwrap("Text").style.unwrap("some");
        $(Assert.equal(style.fontVariantNumeric.unwrap("some").hasTag("tabular-nums"), true));
    });

    test("creates text with color", $ => {
        const text = $.let(Text.Root("Colored", { color: "blue.500" }));
        const style = text.unwrap().unwrap("Text").style.unwrap("some");
        $(Assert.equal(text.unwrap().unwrap("Text").value, "Colored"));
        $(Assert.equal(style.color.hasTag("some"), true));
        $(Assert.equal(style.color.unwrap("some"), "blue.500"));
    });

    test("creates text with background", $ => {
        const text = $.let(Text.Root("Background", { background: "gray.100" }));
        const style = text.unwrap().unwrap("Text").style.unwrap("some");
        $(Assert.equal(style.background.unwrap("some"), "gray.100"));
    });

    test("creates text with fontWeight", $ => {
        const text = $.let(Text.Root("Bold", {
            fontWeight: Style.FontWeight("bold"),
        }));
        const style = text.unwrap().unwrap("Text").style.unwrap("some");
        $(Assert.equal(style.fontWeight.unwrap("some").hasTag("bold"), true));
    });

    test("creates text with fontStyle", $ => {
        const text = $.let(Text.Root("Italic", {
            fontStyle: Style.FontStyle("italic"),
        }));
        const style = text.unwrap().unwrap("Text").style.unwrap("some");
        $(Assert.equal(style.fontStyle.unwrap("some").hasTag("italic"), true));
    });

    test("creates text with textTransform", $ => {
        const text = $.let(Text.Root("uppercase", {
            textTransform: Style.TextTransform("uppercase"),
        }));
        const style = text.unwrap().unwrap("Text").style.unwrap("some");
        $(Assert.equal(style.textTransform.unwrap("some").hasTag("uppercase"), true));
    });

    test("creates text with textAlign", $ => {
        const text = $.let(Text.Root("Centered", {
            textAlign: Style.TextAlign("center"),
        }));
        const style = text.unwrap().unwrap("Text").style.unwrap("some");
        $(Assert.equal(style.textAlign.unwrap("some").hasTag("center"), true));
    });

    test("creates text with borderWidth", $ => {
        const text = $.let(Text.Root("Bordered", {
            borderWidth: Style.BorderWidth("thin"),
        }));
        const style = text.unwrap().unwrap("Text").style.unwrap("some");
        $(Assert.equal(style.borderWidth.unwrap("some").hasTag("thin"), true));
    });

    test("creates text with borderStyle", $ => {
        const text = $.let(Text.Root("Bordered", {
            borderStyle: Style.BorderStyle("solid"),
        }));
        const style = text.unwrap().unwrap("Text").style.unwrap("some");
        $(Assert.equal(style.borderStyle.unwrap("some").hasTag("solid"), true));
    });

    test("creates text with borderColor", $ => {
        const text = $.let(Text.Root("Bordered", { borderColor: "red.500" }));
        const style = text.unwrap().unwrap("Text").style.unwrap("some");
        $(Assert.equal(style.borderColor.unwrap("some"), "red.500"));
    });

    // =========================================================================
    // Multiple Style Properties
    // =========================================================================

    test("creates text with multiple styles", $ => {
        const text = $.let(Text.Root("Styled", {
            color: "blue.500",
            fontWeight: Style.FontWeight("bold"),
            textAlign: Style.TextAlign("center"),
            background: "yellow.100",
        }));
        const style = text.unwrap().unwrap("Text").style.unwrap("some");

        $(Assert.equal(text.unwrap().unwrap("Text").value, "Styled"));
        $(Assert.equal(style.color.unwrap("some"), "blue.500"));
        $(Assert.equal(style.fontWeight.unwrap("some").hasTag("bold"), true));
        $(Assert.equal(style.textAlign.unwrap("some").hasTag("center"), true));
        $(Assert.equal(style.background.unwrap("some"), "yellow.100"));
        // Other styles should be none
        $(Assert.equal(style.fontStyle.hasTag("none"), true));
        $(Assert.equal(style.borderWidth.hasTag("none"), true));
    });

    // =========================================================================
    // All Font Weights
    // =========================================================================

    test("supports all font weights", $ => {
        const normal = $.let(Text.Root("normal", { fontWeight: Style.FontWeight("normal") }));
        const bold = $.let(Text.Root("bold", { fontWeight: Style.FontWeight("bold") }));
        const semibold = $.let(Text.Root("semibold", { fontWeight: Style.FontWeight("semibold") }));
        const medium = $.let(Text.Root("medium", { fontWeight: Style.FontWeight("medium") }));
        const light = $.let(Text.Root("light", { fontWeight: Style.FontWeight("light") }));

        $(Assert.equal(normal.unwrap().unwrap("Text").style.unwrap("some").fontWeight.unwrap("some").hasTag("normal"), true));
        $(Assert.equal(bold.unwrap().unwrap("Text").style.unwrap("some").fontWeight.unwrap("some").hasTag("bold"), true));
        $(Assert.equal(semibold.unwrap().unwrap("Text").style.unwrap("some").fontWeight.unwrap("some").hasTag("semibold"), true));
        $(Assert.equal(medium.unwrap().unwrap("Text").style.unwrap("some").fontWeight.unwrap("some").hasTag("medium"), true));
        $(Assert.equal(light.unwrap().unwrap("Text").style.unwrap("some").fontWeight.unwrap("some").hasTag("light"), true));
    });

    // =========================================================================
    // All Text Alignments
    // =========================================================================

    test("supports all text alignments", $ => {
        const left = $.let(Text.Root("left", { textAlign: Style.TextAlign("left") }));
        const center = $.let(Text.Root("center", { textAlign: Style.TextAlign("center") }));
        const right = $.let(Text.Root("right", { textAlign: Style.TextAlign("right") }));
        const justify = $.let(Text.Root("justify", { textAlign: Style.TextAlign("justify") }));

        $(Assert.equal(left.unwrap().unwrap("Text").style.unwrap("some").textAlign.unwrap("some").hasTag("left"), true));
        $(Assert.equal(center.unwrap().unwrap("Text").style.unwrap("some").textAlign.unwrap("some").hasTag("center"), true));
        $(Assert.equal(right.unwrap().unwrap("Text").style.unwrap("some").textAlign.unwrap("some").hasTag("right"), true));
        $(Assert.equal(justify.unwrap().unwrap("Text").style.unwrap("some").textAlign.unwrap("some").hasTag("justify"), true));
    });

    // =========================================================================
    // All Text Transforms
    // =========================================================================

    test("supports all text transforms", $ => {
        const uppercase = $.let(Text.Root("a", { textTransform: Style.TextTransform("uppercase") }));
        const lowercase = $.let(Text.Root("A", { textTransform: Style.TextTransform("lowercase") }));
        const capitalize = $.let(Text.Root("hello", { textTransform: Style.TextTransform("capitalize") }));
        const none = $.let(Text.Root("Hello", { textTransform: Style.TextTransform("none") }));

        $(Assert.equal(uppercase.unwrap().unwrap("Text").style.unwrap("some").textTransform.unwrap("some").hasTag("uppercase"), true));
        $(Assert.equal(lowercase.unwrap().unwrap("Text").style.unwrap("some").textTransform.unwrap("some").hasTag("lowercase"), true));
        $(Assert.equal(capitalize.unwrap().unwrap("Text").style.unwrap("some").textTransform.unwrap("some").hasTag("capitalize"), true));
        $(Assert.equal(none.unwrap().unwrap("Text").style.unwrap("some").textTransform.unwrap("some").hasTag("none"), true));
    });

    // =========================================================================
    // All Border Widths
    // =========================================================================

    test("supports all border widths", $ => {
        const noBorder = $.let(Text.Root("none", { borderWidth: Style.BorderWidth("none") }));
        const thin = $.let(Text.Root("thin", { borderWidth: Style.BorderWidth("thin") }));
        const medium = $.let(Text.Root("medium", { borderWidth: Style.BorderWidth("medium") }));
        const thick = $.let(Text.Root("thick", { borderWidth: Style.BorderWidth("thick") }));

        $(Assert.equal(noBorder.unwrap().unwrap("Text").style.unwrap("some").borderWidth.unwrap("some").hasTag("none"), true));
        $(Assert.equal(thin.unwrap().unwrap("Text").style.unwrap("some").borderWidth.unwrap("some").hasTag("thin"), true));
        $(Assert.equal(medium.unwrap().unwrap("Text").style.unwrap("some").borderWidth.unwrap("some").hasTag("medium"), true));
        $(Assert.equal(thick.unwrap().unwrap("Text").style.unwrap("some").borderWidth.unwrap("some").hasTag("thick"), true));
    });

    // =========================================================================
    // All Border Styles
    // =========================================================================

    test("supports all border styles", $ => {
        const solid = $.let(Text.Root("solid", { borderStyle: Style.BorderStyle("solid") }));
        const dashed = $.let(Text.Root("dashed", { borderStyle: Style.BorderStyle("dashed") }));
        const dotted = $.let(Text.Root("dotted", { borderStyle: Style.BorderStyle("dotted") }));
        const double_ = $.let(Text.Root("double", { borderStyle: Style.BorderStyle("double") }));
        const noBorder = $.let(Text.Root("none", { borderStyle: Style.BorderStyle("none") }));

        $(Assert.equal(solid.unwrap().unwrap("Text").style.unwrap("some").borderStyle.unwrap("some").hasTag("solid"), true));
        $(Assert.equal(dashed.unwrap().unwrap("Text").style.unwrap("some").borderStyle.unwrap("some").hasTag("dashed"), true));
        $(Assert.equal(dotted.unwrap().unwrap("Text").style.unwrap("some").borderStyle.unwrap("some").hasTag("dotted"), true));
        $(Assert.equal(double_.unwrap().unwrap("Text").style.unwrap("some").borderStyle.unwrap("some").hasTag("double"), true));
        $(Assert.equal(noBorder.unwrap().unwrap("Text").style.unwrap("some").borderStyle.unwrap("some").hasTag("none"), true));
    });

    // =========================================================================
    // Full Border Configuration
    // =========================================================================

    test("creates text with full border configuration", $ => {
        const text = $.let(Text.Root("Bordered", {
            borderWidth: Style.BorderWidth("medium"),
            borderStyle: Style.BorderStyle("solid"),
            borderColor: "gray.300",
        }));
        const style = text.unwrap().unwrap("Text").style.unwrap("some");

        $(Assert.equal(style.borderWidth.unwrap("some").hasTag("medium"), true));
        $(Assert.equal(style.borderStyle.unwrap("some").hasTag("solid"), true));
        $(Assert.equal(style.borderColor.unwrap("some"), "gray.300"));
    });
}, { platformFns: TestImpl });
