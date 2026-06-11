/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Heading, Style } from "@elaraai/east-ui/internal";
import * as ex from "./heading.examples.js";

describeEast("Heading", (test) => {
    Assert.examples(test, {
        headingBasic: ex.headingBasic,
        headingStandardSizes: ex.headingStandardSizes,
        headingExtendedSizes: ex.headingExtendedSizes,
        headingSemanticLevels: ex.headingSemanticLevels,
        headingColored: ex.headingColored,
        headingAlignment: ex.headingAlignment,
        headingCombined: ex.headingCombined,
        headingBackground: ex.headingBackground,
    });

    // =========================================================================
    // Basic Creation — { value, as, style } shape
    // =========================================================================

    test("creates heading with string value", $ => {
        const heading = $.let(Heading.Root("Hello World"));

        $(Assert.equal(heading.unwrap().unwrap("Heading").value, "Hello World"));
    });

    test("creates heading with no style — style is none", $ => {
        const heading = $.let(Heading.Root("Title"));

        $(Assert.equal(heading.unwrap().unwrap("Heading").value, "Title"));
        $(Assert.equal(heading.unwrap().unwrap("Heading").as.hasTag("none"), true));
        $(Assert.equal(heading.unwrap().unwrap("Heading").style.hasTag("none"), true));
    });

    // =========================================================================
    // textStyle (inside style) — replaces the old `size` prop
    // =========================================================================

    test("creates heading with heading-xs textStyle", $ => {
        const heading = $.let(Heading.Root("XS", { textStyle: "heading-xs" }));
        const style = heading.unwrap().unwrap("Heading").style.unwrap("some");
        $(Assert.equal(style.textStyle.unwrap("some").hasTag("heading-xs"), true));
    });

    test("creates heading with heading-sm textStyle", $ => {
        const heading = $.let(Heading.Root("SM", { textStyle: "heading-sm" }));
        const style = heading.unwrap().unwrap("Heading").style.unwrap("some");
        $(Assert.equal(style.textStyle.unwrap("some").hasTag("heading-sm"), true));
    });

    test("creates heading with heading-md textStyle", $ => {
        const heading = $.let(Heading.Root("MD", { textStyle: "heading-md" }));
        const style = heading.unwrap().unwrap("Heading").style.unwrap("some");
        $(Assert.equal(style.textStyle.unwrap("some").hasTag("heading-md"), true));
    });

    test("creates heading with heading-lg textStyle", $ => {
        const heading = $.let(Heading.Root("LG", { textStyle: "heading-lg" }));
        const style = heading.unwrap().unwrap("Heading").style.unwrap("some");
        $(Assert.equal(style.textStyle.unwrap("some").hasTag("heading-lg"), true));
    });

    test("creates heading with display-sm textStyle", $ => {
        const heading = $.let(Heading.Root("DisplaySM", { textStyle: "display-sm" }));
        const style = heading.unwrap().unwrap("Heading").style.unwrap("some");
        $(Assert.equal(style.textStyle.unwrap("some").hasTag("display-sm"), true));
    });

    test("creates heading with display-lg textStyle", $ => {
        const heading = $.let(Heading.Root("Hero", { textStyle: "display-lg" }));
        const style = heading.unwrap().unwrap("Heading").style.unwrap("some");
        $(Assert.equal(style.textStyle.unwrap("some").hasTag("display-lg"), true));
    });

    // =========================================================================
    // Semantic Level (as — on main)
    // =========================================================================

    test("creates h1 heading", $ => {
        const heading = $.let(Heading.Root("Main Title", { as: "h1" }));

        $(Assert.equal(heading.unwrap().unwrap("Heading").as.hasTag("some"), true));
        $(Assert.equal(heading.unwrap().unwrap("Heading").as.unwrap("some").hasTag("h1"), true));
    });

    test("creates h2 heading", $ => {
        const heading = $.let(Heading.Root("Section", { as: "h2" }));
        $(Assert.equal(heading.unwrap().unwrap("Heading").as.unwrap("some").hasTag("h2"), true));
    });

    test("creates h3 heading", $ => {
        const heading = $.let(Heading.Root("Subsection", { as: "h3" }));
        $(Assert.equal(heading.unwrap().unwrap("Heading").as.unwrap("some").hasTag("h3"), true));
    });

    test("creates h4 heading", $ => {
        const heading = $.let(Heading.Root("Minor", { as: "h4" }));
        $(Assert.equal(heading.unwrap().unwrap("Heading").as.unwrap("some").hasTag("h4"), true));
    });

    test("creates h5 heading", $ => {
        const heading = $.let(Heading.Root("Small", { as: "h5" }));
        $(Assert.equal(heading.unwrap().unwrap("Heading").as.unwrap("some").hasTag("h5"), true));
    });

    test("creates h6 heading", $ => {
        const heading = $.let(Heading.Root("Smallest", { as: "h6" }));
        $(Assert.equal(heading.unwrap().unwrap("Heading").as.unwrap("some").hasTag("h6"), true));
    });

    // =========================================================================
    // Color (inside style)
    // =========================================================================

    test("creates heading with color", $ => {
        const heading = $.let(Heading.Root("Colored", { color: "blue.500" }));
        const style = heading.unwrap().unwrap("Heading").style.unwrap("some");
        $(Assert.equal(style.color.unwrap("some"), "blue.500"));
    });

    test("creates heading with background (hero band)", $ => {
        const heading = $.let(Heading.Root("Hero", {
            background: "blue.50",
            color: "blue.900",
        }));
        const style = heading.unwrap().unwrap("Heading").style.unwrap("some");
        $(Assert.equal(style.background.unwrap("some"), "blue.50"));
        $(Assert.equal(style.color.unwrap("some"), "blue.900"));
    });

    // =========================================================================
    // fontWeight / fontStyle / fontFamily (inside style)
    // =========================================================================

    test("creates heading with fontWeight override", $ => {
        const heading = $.let(Heading.Root("Bold", {
            fontWeight: Style.FontWeight("semibold"),
        }));
        const style = heading.unwrap().unwrap("Heading").style.unwrap("some");
        $(Assert.equal(style.fontWeight.unwrap("some").hasTag("semibold"), true));
    });

    test("creates heading with fontStyle italic", $ => {
        const heading = $.let(Heading.Root("Italic", { fontStyle: "italic" }));
        const style = heading.unwrap().unwrap("Heading").style.unwrap("some");
        $(Assert.equal(style.fontStyle.unwrap("some").hasTag("italic"), true));
    });

    test("creates heading with serif fontFamily", $ => {
        const heading = $.let(Heading.Root("Display", { fontFamily: "serif" }));
        const style = heading.unwrap().unwrap("Heading").style.unwrap("some");
        $(Assert.equal(style.fontFamily.unwrap("some").hasTag("serif"), true));
    });

    // =========================================================================
    // Text Alignment (inside style)
    // =========================================================================

    test("creates left aligned heading", $ => {
        const heading = $.let(Heading.Root("Left", {
            textAlign: Style.TextAlign("left"),
        }));
        const style = heading.unwrap().unwrap("Heading").style.unwrap("some");
        $(Assert.equal(style.textAlign.unwrap("some").hasTag("left"), true));
    });

    test("creates center aligned heading", $ => {
        const heading = $.let(Heading.Root("Center", {
            textAlign: Style.TextAlign("center"),
        }));
        const style = heading.unwrap().unwrap("Heading").style.unwrap("some");
        $(Assert.equal(style.textAlign.unwrap("some").hasTag("center"), true));
    });

    test("creates right aligned heading", $ => {
        const heading = $.let(Heading.Root("Right", {
            textAlign: Style.TextAlign("right"),
        }));
        const style = heading.unwrap().unwrap("Heading").style.unwrap("some");
        $(Assert.equal(style.textAlign.unwrap("some").hasTag("right"), true));
    });

    // =========================================================================
    // Combined Options
    // =========================================================================

    test("creates heading with all options", $ => {
        const heading = $.let(Heading.Root("Page Title", {
            as: "h1",
            textStyle: "display-md",
            color: "gray.900",
            textAlign: Style.TextAlign("center"),
        }));
        const main = heading.unwrap().unwrap("Heading");
        const style = main.style.unwrap("some");

        $(Assert.equal(main.value, "Page Title"));
        $(Assert.equal(main.as.unwrap("some").hasTag("h1"), true));
        $(Assert.equal(style.textStyle.unwrap("some").hasTag("display-md"), true));
        $(Assert.equal(style.color.unwrap("some"), "gray.900"));
        $(Assert.equal(style.textAlign.unwrap("some").hasTag("center"), true));
    });

    test("creates section heading", $ => {
        const heading = $.let(Heading.Root("Features", {
            as: "h2",
            textStyle: "heading-lg",
        }));
        const main = heading.unwrap().unwrap("Heading");
        const style = main.style.unwrap("some");

        $(Assert.equal(main.value, "Features"));
        $(Assert.equal(main.as.unwrap("some").hasTag("h2"), true));
        $(Assert.equal(style.textStyle.unwrap("some").hasTag("heading-lg"), true));
    });
}, { platformFns: TestImpl });
