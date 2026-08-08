/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { type ExprType } from "@elaraai/east";
import { Tag, Style, UIComponentType } from "@elaraai/east-ui/internal";
import * as ex from "./tag.examples.js";

describeEast("Tag", (test) => {
    Assert.examples(test, {
        tagBasic: ex.tagBasic,
        tagStyles: ex.tagStyles,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#462).
    // The mono-uppercase Text captions are the stable per-mini anchors.
    // =========================================================================

    test("tagStyles drives its preview from inline option tables", $ => {
        // Everything the configurator needs — the variant / density / colour /
        // border / opacity / padding tables — is declared inside the example
        // body, because the documentation capture only extracts `fn`. That puts
        // the tables inside the Reactive body, which TestImpl does not execute,
        // so they cannot be asserted from here; `Assert.examples` above still
        // compiles and evaluates the outer function. The per-variant coverage
        // lives in the Tag.Root tests below, which construct each variant
        // directly.
        const panel = $.const(ex.tagStyles.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });

    // =========================================================================
    // Basic Creation
    // =========================================================================

    test("creates tag with string label", $ => {
        const tag = $.let(Tag.Root("JavaScript"));

        $(Assert.equal(tag.unwrap().unwrap("Tag").label, "JavaScript"));
        $(Assert.equal(tag.unwrap().unwrap("Tag").style.hasTag("none"), true));
        $(Assert.equal(tag.unwrap().unwrap("Tag").closable.hasTag("none"), true));
    });

    test("creates tag with expression label", $ => {
        const tag = $.let(Tag.Root("TypeScript"));

        $(Assert.equal(tag.unwrap().unwrap("Tag").label, "TypeScript"));
    });

    // =========================================================================
    // Variants
    // =========================================================================

    test("creates solid variant tag", $ => {
        const tag = $.let(Tag.Root("Featured", {
            variant: "solid",
        }));

        $(Assert.equal(tag.unwrap().unwrap("Tag").style.unwrap("some").variant.hasTag("some"), true));
        $(Assert.equal(tag.unwrap().unwrap("Tag").style.unwrap("some").variant.unwrap("some").hasTag("solid"), true));
    });

    test("creates subtle variant tag", $ => {
        const tag = $.let(Tag.Root("Category", {
            variant: "subtle",
        }));

        $(Assert.equal(tag.unwrap().unwrap("Tag").style.unwrap("some").variant.unwrap("some").hasTag("subtle"), true));
    });

    test("creates outline variant tag", $ => {
        const tag = $.let(Tag.Root("Label", {
            variant: "outline",
        }));

        $(Assert.equal(tag.unwrap().unwrap("Tag").style.unwrap("some").variant.unwrap("some").hasTag("outline"), true));
    });

    test("creates tag with Style.StyleVariant helper", $ => {
        const tag = $.let(Tag.Root("Styled", {
            variant: Style.StyleVariant("solid"),
        }));

        $(Assert.equal(tag.unwrap().unwrap("Tag").style.unwrap("some").variant.unwrap("some").hasTag("solid"), true));
    });

    // =========================================================================
    // Color Palettes
    // =========================================================================

    test("creates tag with brand color palette", $ => {
        const tag = $.let(Tag.Root("React", {
            colorPalette: "brand",
        }));

        $(Assert.equal(tag.unwrap().unwrap("Tag").style.unwrap("some").colorPalette.hasTag("some"), true));
        $(Assert.equal(tag.unwrap().unwrap("Tag").style.unwrap("some").colorPalette.unwrap("some").hasTag("brand"), true));
    });

    test("creates tag with success color palette", $ => {
        const tag = $.let(Tag.Root("Active", {
            colorPalette: "success",
        }));

        $(Assert.equal(tag.unwrap().unwrap("Tag").style.unwrap("some").colorPalette.unwrap("some").hasTag("success"), true));
    });

    test("creates tag with info color palette", $ => {
        const tag = $.let(Tag.Root("Node.js", {
            colorPalette: "info",
        }));

        $(Assert.equal(tag.unwrap().unwrap("Tag").style.unwrap("some").colorPalette.unwrap("some").hasTag("info"), true));
    });

    test("creates tag with Style.ColorScheme helper", $ => {
        const tag = $.let(Tag.Root("Premium", {
            colorPalette: Style.ColorScheme("brand"),
        }));

        $(Assert.equal(tag.unwrap().unwrap("Tag").style.unwrap("some").colorPalette.unwrap("some").hasTag("brand"), true));
    });

    // =========================================================================
    // Size
    // =========================================================================

    test("creates small tag", $ => {
        const tag = $.let(Tag.Root("SM", {
            size: "sm",
        }));

        $(Assert.equal(tag.unwrap().unwrap("Tag").style.unwrap("some").size.hasTag("some"), true));
        $(Assert.equal(tag.unwrap().unwrap("Tag").style.unwrap("some").size.unwrap("some").hasTag("sm"), true));
    });

    test("creates medium tag", $ => {
        const tag = $.let(Tag.Root("MD", {
            size: "md",
        }));

        $(Assert.equal(tag.unwrap().unwrap("Tag").style.unwrap("some").size.unwrap("some").hasTag("md"), true));
    });

    test("creates large tag", $ => {
        const tag = $.let(Tag.Root("LG", {
            size: "lg",
        }));

        $(Assert.equal(tag.unwrap().unwrap("Tag").style.unwrap("some").size.unwrap("some").hasTag("lg"), true));
    });

    test("creates extra large tag", $ => {
        const tag = $.let(Tag.Root("XL", {
            size: "xl",
        }));

        $(Assert.equal(tag.unwrap().unwrap("Tag").style.unwrap("some").size.unwrap("some").hasTag("xl"), true));
    });

    test("creates tag with string literal size", $ => {
        const tag = $.let(Tag.Root("Sized", {
            size: "md",
        }));

        $(Assert.equal(tag.unwrap().unwrap("Tag").style.unwrap("some").size.unwrap("some").hasTag("md"), true));
    });

    // =========================================================================
    // Closable
    // =========================================================================

    test("creates closable tag", $ => {
        const tag = $.let(Tag.Root("Removable", {
            closable: true,
        }));

        $(Assert.equal(tag.unwrap().unwrap("Tag").closable.hasTag("some"), true));
        $(Assert.equal(tag.unwrap().unwrap("Tag").closable.unwrap("some"), true));
    });

    test("creates non-closable tag explicitly", $ => {
        const tag = $.let(Tag.Root("Fixed", {
            closable: false,
        }));

        $(Assert.equal(tag.unwrap().unwrap("Tag").closable.unwrap("some"), false));
    });

    // =========================================================================
    // Combined Options
    // =========================================================================

    test("creates tag with all options", $ => {
        const tag = $.let(Tag.Root("Complete", {
            variant: "solid",
            colorPalette: "brand",
            size: "md",
            closable: true,
        }));

        $(Assert.equal(tag.unwrap().unwrap("Tag").label, "Complete"));
        $(Assert.equal(tag.unwrap().unwrap("Tag").style.unwrap("some").variant.unwrap("some").hasTag("solid"), true));
        $(Assert.equal(tag.unwrap().unwrap("Tag").style.unwrap("some").colorPalette.unwrap("some").hasTag("brand"), true));
        $(Assert.equal(tag.unwrap().unwrap("Tag").style.unwrap("some").size.unwrap("some").hasTag("md"), true));
        $(Assert.equal(tag.unwrap().unwrap("Tag").closable.unwrap("some"), true));
    });

    test("creates programming language tag", $ => {
        const tag = $.let(Tag.Root("Python", {
            colorPalette: "warning",
            variant: "subtle",
        }));

        $(Assert.equal(tag.unwrap().unwrap("Tag").label, "Python"));
        $(Assert.equal(tag.unwrap().unwrap("Tag").style.unwrap("some").colorPalette.unwrap("some").hasTag("warning"), true));
    });

    test("creates filter chip tag", $ => {
        const tag = $.let(Tag.Root("Technology", {
            colorPalette: "brand",
            closable: true,
            size: "sm",
        }));

        $(Assert.equal(tag.unwrap().unwrap("Tag").closable.unwrap("some"), true));
        $(Assert.equal(tag.unwrap().unwrap("Tag").style.unwrap("some").size.unwrap("some").hasTag("sm"), true));
    });

    test("creates status tag", $ => {
        const tag = $.let(Tag.Root("In Progress", {
            colorPalette: "warning",
            variant: "solid",
            size: "sm",
        }));

        $(Assert.equal(tag.unwrap().unwrap("Tag").label, "In Progress"));
        $(Assert.equal(tag.unwrap().unwrap("Tag").style.unwrap("some").variant.unwrap("some").hasTag("solid"), true));
    });

    test("creates removable skill tag", $ => {
        const tag = $.let(Tag.Root("React", {
            colorPalette: "info",
            variant: "outline",
            closable: true,
        }));

        $(Assert.equal(tag.unwrap().unwrap("Tag").style.unwrap("some").variant.unwrap("some").hasTag("outline"), true));
        $(Assert.equal(tag.unwrap().unwrap("Tag").closable.unwrap("some"), true));
    });
}, {   platformFns: TestImpl,});
