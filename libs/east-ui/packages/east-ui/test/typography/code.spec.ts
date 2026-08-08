/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { type ExprType } from "@elaraai/east";
import { Code, Style } from "@elaraai/east-ui/internal";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./code.examples.js";

describeEast("Code", (test) => {
    Assert.examples(test, {
        codeBasic: ex.codeBasic,
        codeVariants: ex.codeVariants,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#459).
    // The mono-uppercase Text captions are the stable per-mini anchors.
    // =========================================================================

    test("codeVariants drives its preview from inline option tables", $ => {
        // Everything the configurator needs — the variant / size / palette
        // tables — is declared inside the example body, because the
        // documentation capture only extracts `fn`. That puts the tables inside
        // the Reactive body, which TestImpl does not execute, so they cannot be
        // asserted from here; `Assert.examples` above still compiles and
        // evaluates the outer function. The per-variant coverage lives in the
        // Code.Root tests below, which construct each variant directly.
        const panel = $.const(ex.codeVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });

    // =========================================================================
    // Basic Creation — { value, style } shape
    // =========================================================================

    test("creates code with string value", $ => {
        const code = $.let(Code.Root("const x = 1"));

        $(Assert.equal(code.unwrap().unwrap("Code").value, "const x = 1"));
    });

    test("creates code with no style — style is none", $ => {
        const code = $.let(Code.Root("hello"));

        $(Assert.equal(code.unwrap().unwrap("Code").value, "hello"));
        $(Assert.equal(code.unwrap().unwrap("Code").style.hasTag("none"), true));
    });

    // =========================================================================
    // Variants (inside style)
    // =========================================================================

    test("creates subtle variant code", $ => {
        const code = $.let(Code.Root("npm install", { variant: "subtle" }));
        const style = code.unwrap().unwrap("Code").style.unwrap("some");
        $(Assert.equal(style.variant.hasTag("some"), true));
        $(Assert.equal(style.variant.unwrap("some").hasTag("subtle"), true));
    });

    test("creates surface variant code", $ => {
        const code = $.let(Code.Root("npm install", { variant: "surface" }));
        const style = code.unwrap().unwrap("Code").style.unwrap("some");
        $(Assert.equal(style.variant.unwrap("some").hasTag("surface"), true));
    });

    test("creates outline variant code", $ => {
        const code = $.let(Code.Root("npm install", { variant: "outline" }));
        const style = code.unwrap().unwrap("Code").style.unwrap("some");
        $(Assert.equal(style.variant.unwrap("some").hasTag("outline"), true));
    });

    // =========================================================================
    // Color Palette (inside style)
    // =========================================================================

    test("creates code with colorPalette", $ => {
        const code = $.let(Code.Root("const x = 1", { colorPalette: "brand" }));
        const style = code.unwrap().unwrap("Code").style.unwrap("some");
        $(Assert.equal(style.colorPalette.hasTag("some"), true));
        $(Assert.equal(style.colorPalette.unwrap("some"), "brand"));
    });

    // =========================================================================
    // Size (inside style)
    // =========================================================================

    test("creates extra small code", $ => {
        const code = $.let(Code.Root("xs", { size: "xs" }));
        const style = code.unwrap().unwrap("Code").style.unwrap("some");
        $(Assert.equal(style.size.hasTag("some"), true));
        $(Assert.equal(style.size.unwrap("some").hasTag("xs"), true));
    });

    test("creates small code", $ => {
        const code = $.let(Code.Root("sm", { size: "sm" }));
        const style = code.unwrap().unwrap("Code").style.unwrap("some");
        $(Assert.equal(style.size.unwrap("some").hasTag("sm"), true));
    });

    test("creates medium code", $ => {
        const code = $.let(Code.Root("md", { size: "md" }));
        const style = code.unwrap().unwrap("Code").style.unwrap("some");
        $(Assert.equal(style.size.unwrap("some").hasTag("md"), true));
    });

    test("creates large code", $ => {
        const code = $.let(Code.Root("lg", { size: "lg" }));
        const style = code.unwrap().unwrap("Code").style.unwrap("some");
        $(Assert.equal(style.size.unwrap("some").hasTag("lg"), true));
    });

    test("creates code with Style.Size helper", $ => {
        const code = $.let(Code.Root("size", { size: Style.Size("md") }));
        const style = code.unwrap().unwrap("Code").style.unwrap("some");
        $(Assert.equal(style.size.unwrap("some").hasTag("md"), true));
    });

    // =========================================================================
    // Colour escape hatches (inside style)
    // =========================================================================

    test("creates code with explicit color + background + borderColor", $ => {
        const code = $.let(Code.Root("rot_name", {
            variant: "outline",
            color: "fg.danger",
            background: "bg.warning.subtle",
            borderColor: "status.warn",
        }));
        const style = code.unwrap().unwrap("Code").style.unwrap("some");
        $(Assert.equal(style.color.unwrap("some"), "fg.danger"));
        $(Assert.equal(style.background.unwrap("some"), "bg.warning.subtle"));
        $(Assert.equal(style.borderColor.unwrap("some"), "status.warn"));
    });

    // =========================================================================
    // Combined Options
    // =========================================================================

    test("creates code with variant + palette + size", $ => {
        const code = $.let(Code.Root("function hello() {}", {
            variant: "subtle",
            colorPalette: "brand",
            size: "sm",
        }));
        const style = code.unwrap().unwrap("Code").style.unwrap("some");

        $(Assert.equal(code.unwrap().unwrap("Code").value, "function hello() {}"));
        $(Assert.equal(style.variant.unwrap("some").hasTag("subtle"), true));
        $(Assert.equal(style.colorPalette.unwrap("some"), "brand"));
        $(Assert.equal(style.size.unwrap("some").hasTag("sm"), true));
    });

    test("creates inline code snippet", $ => {
        const code = $.let(Code.Root("console.log()", {
            variant: "surface",
            colorPalette: "gray",
        }));
        const style = code.unwrap().unwrap("Code").style.unwrap("some");

        $(Assert.equal(code.unwrap().unwrap("Code").value, "console.log()"));
        $(Assert.equal(style.variant.unwrap("some").hasTag("surface"), true));
    });
}, { platformFns: TestImpl });
