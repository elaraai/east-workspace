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
        tagClosable: ex.tagClosable,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#462).
    // The mono-uppercase Text captions are the stable per-mini anchors.
    // =========================================================================

    test("tagStyles panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.tagStyles.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 12n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "VARIANTS"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "CUSTOM"));
        $(Assert.equal(rows.get(4n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "BORDER"));
        $(Assert.equal(rows.get(6n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "BOX MODEL"));
        $(Assert.equal(rows.get(8n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "DENSITIES"));
        $(Assert.equal(rows.get(10n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "DYNAMIC"));
    });

    test("tagClosable panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.tagClosable.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 4n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "CLOSABLE"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "ON CLOSE INTERACTIVE"));
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

    test("creates tag with blue color palette", $ => {
        const tag = $.let(Tag.Root("React", {
            colorPalette: "blue",
        }));

        $(Assert.equal(tag.unwrap().unwrap("Tag").style.unwrap("some").colorPalette.hasTag("some"), true));
        $(Assert.equal(tag.unwrap().unwrap("Tag").style.unwrap("some").colorPalette.unwrap("some").hasTag("blue"), true));
    });

    test("creates tag with green color palette", $ => {
        const tag = $.let(Tag.Root("Active", {
            colorPalette: "green",
        }));

        $(Assert.equal(tag.unwrap().unwrap("Tag").style.unwrap("some").colorPalette.unwrap("some").hasTag("green"), true));
    });

    test("creates tag with cyan color palette", $ => {
        const tag = $.let(Tag.Root("Node.js", {
            colorPalette: "cyan",
        }));

        $(Assert.equal(tag.unwrap().unwrap("Tag").style.unwrap("some").colorPalette.unwrap("some").hasTag("cyan"), true));
    });

    test("creates tag with Style.ColorScheme helper", $ => {
        const tag = $.let(Tag.Root("Premium", {
            colorPalette: Style.ColorScheme("purple"),
        }));

        $(Assert.equal(tag.unwrap().unwrap("Tag").style.unwrap("some").colorPalette.unwrap("some").hasTag("purple"), true));
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
            colorPalette: "blue",
            size: "md",
            closable: true,
        }));

        $(Assert.equal(tag.unwrap().unwrap("Tag").label, "Complete"));
        $(Assert.equal(tag.unwrap().unwrap("Tag").style.unwrap("some").variant.unwrap("some").hasTag("solid"), true));
        $(Assert.equal(tag.unwrap().unwrap("Tag").style.unwrap("some").colorPalette.unwrap("some").hasTag("blue"), true));
        $(Assert.equal(tag.unwrap().unwrap("Tag").style.unwrap("some").size.unwrap("some").hasTag("md"), true));
        $(Assert.equal(tag.unwrap().unwrap("Tag").closable.unwrap("some"), true));
    });

    test("creates programming language tag", $ => {
        const tag = $.let(Tag.Root("Python", {
            colorPalette: "yellow",
            variant: "subtle",
        }));

        $(Assert.equal(tag.unwrap().unwrap("Tag").label, "Python"));
        $(Assert.equal(tag.unwrap().unwrap("Tag").style.unwrap("some").colorPalette.unwrap("some").hasTag("yellow"), true));
    });

    test("creates filter chip tag", $ => {
        const tag = $.let(Tag.Root("Technology", {
            colorPalette: "blue",
            closable: true,
            size: "sm",
        }));

        $(Assert.equal(tag.unwrap().unwrap("Tag").closable.unwrap("some"), true));
        $(Assert.equal(tag.unwrap().unwrap("Tag").style.unwrap("some").size.unwrap("some").hasTag("sm"), true));
    });

    test("creates status tag", $ => {
        const tag = $.let(Tag.Root("In Progress", {
            colorPalette: "orange",
            variant: "solid",
            size: "sm",
        }));

        $(Assert.equal(tag.unwrap().unwrap("Tag").label, "In Progress"));
        $(Assert.equal(tag.unwrap().unwrap("Tag").style.unwrap("some").variant.unwrap("some").hasTag("solid"), true));
    });

    test("creates removable skill tag", $ => {
        const tag = $.let(Tag.Root("React", {
            colorPalette: "cyan",
            variant: "outline",
            closable: true,
        }));

        $(Assert.equal(tag.unwrap().unwrap("Tag").style.unwrap("some").variant.unwrap("some").hasTag("outline"), true));
        $(Assert.equal(tag.unwrap().unwrap("Tag").closable.unwrap("some"), true));
    });
}, {   platformFns: TestImpl,});
