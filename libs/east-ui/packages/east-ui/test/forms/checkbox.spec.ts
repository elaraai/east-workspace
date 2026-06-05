/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Checkbox, Style } from "@elaraai/east-ui/internal";
import * as ex from "./checkbox.examples.js";

describeEast("Checkbox", (test) => {
    Assert.examples(test, {
        checkboxBasic: ex.checkboxBasic,
        checkboxSizes: ex.checkboxSizes,
        checkboxInteractive: ex.checkboxInteractive,
    });

    // =========================================================================
    // Basic Creation
    // =========================================================================

    test("creates checkbox with checked true", $ => {
        const checkbox = $.let(Checkbox.Root(true));

        $(Assert.equal(checkbox.unwrap().unwrap("Checkbox").checked, true));
        $(Assert.equal(checkbox.unwrap().unwrap("Checkbox").label.hasTag("none"), true));
        $(Assert.equal(checkbox.unwrap().unwrap("Checkbox").indeterminate.hasTag("none"), true));
        $(Assert.equal(checkbox.unwrap().unwrap("Checkbox").disabled.hasTag("none"), true));
        $(Assert.equal(checkbox.unwrap().unwrap("Checkbox").style.hasTag("none"), true));
    });

    test("creates checkbox with checked false", $ => {
        const checkbox = $.let(Checkbox.Root(false));

        $(Assert.equal(checkbox.unwrap().unwrap("Checkbox").checked, false));
    });

    // =========================================================================
    // Label
    // =========================================================================

    test("creates checkbox with label", $ => {
        const checkbox = $.let(Checkbox.Root(false, {
            label: "Accept terms",
        }));

        $(Assert.equal(checkbox.unwrap().unwrap("Checkbox").label.hasTag("some"), true));
        $(Assert.equal(checkbox.unwrap().unwrap("Checkbox").label.unwrap("some"), "Accept terms"));
    });

    test("creates checkbox with long label", $ => {
        const checkbox = $.let(Checkbox.Root(false, {
            label: "I agree to the terms and conditions and privacy policy",
        }));

        $(Assert.equal(checkbox.unwrap().unwrap("Checkbox").label.unwrap("some"), "I agree to the terms and conditions and privacy policy"));
    });

    // =========================================================================
    // Indeterminate State
    // =========================================================================

    test("creates indeterminate checkbox", $ => {
        const checkbox = $.let(Checkbox.Root(false, {
            indeterminate: true,
        }));

        $(Assert.equal(checkbox.unwrap().unwrap("Checkbox").indeterminate.hasTag("some"), true));
        $(Assert.equal(checkbox.unwrap().unwrap("Checkbox").indeterminate.unwrap("some"), true));
    });

    test("creates non-indeterminate checkbox explicitly", $ => {
        const checkbox = $.let(Checkbox.Root(true, {
            indeterminate: false,
        }));

        $(Assert.equal(checkbox.unwrap().unwrap("Checkbox").indeterminate.unwrap("some"), false));
    });

    // =========================================================================
    // Disabled State
    // =========================================================================

    test("creates disabled checkbox", $ => {
        const checkbox = $.let(Checkbox.Root(false, {
            disabled: true,
        }));

        $(Assert.equal(checkbox.unwrap().unwrap("Checkbox").disabled.hasTag("some"), true));
        $(Assert.equal(checkbox.unwrap().unwrap("Checkbox").disabled.unwrap("some"), true));
    });

    test("creates enabled checkbox explicitly", $ => {
        const checkbox = $.let(Checkbox.Root(true, {
            disabled: false,
        }));

        $(Assert.equal(checkbox.unwrap().unwrap("Checkbox").disabled.unwrap("some"), false));
    });

    // =========================================================================
    // Color Palettes (now inside style)
    // =========================================================================

    test("creates checkbox with blue color palette in style", $ => {
        const checkbox = $.let(Checkbox.Root(true, {
            colorPalette: "blue",
        }));
        const style = $.let(checkbox.unwrap().unwrap("Checkbox").style.unwrap("some"));
        $(Assert.equal(style.colorPalette.hasTag("some"), true));
        $(Assert.equal(style.colorPalette.unwrap("some").hasTag("blue"), true));
    });

    test("creates checkbox with green color palette in style", $ => {
        const checkbox = $.let(Checkbox.Root(true, {
            colorPalette: "green",
        }));
        const style = $.let(checkbox.unwrap().unwrap("Checkbox").style.unwrap("some"));
        $(Assert.equal(style.colorPalette.unwrap("some").hasTag("green"), true));
    });

    test("creates checkbox with Style.ColorScheme helper in style", $ => {
        const checkbox = $.let(Checkbox.Root(true, {
            colorPalette: Style.ColorScheme("purple"),
        }));
        const style = $.let(checkbox.unwrap().unwrap("Checkbox").style.unwrap("some"));
        $(Assert.equal(style.colorPalette.unwrap("some").hasTag("purple"), true));
    });

    // =========================================================================
    // Sizes (now inside style)
    // =========================================================================

    test("creates small checkbox via style.size", $ => {
        const checkbox = $.let(Checkbox.Root(true, {
            size: "sm",
        }));
        const style = $.let(checkbox.unwrap().unwrap("Checkbox").style.unwrap("some"));
        $(Assert.equal(style.size.hasTag("some"), true));
        $(Assert.equal(style.size.unwrap("some").hasTag("sm"), true));
    });

    test("creates medium checkbox via style.size", $ => {
        const checkbox = $.let(Checkbox.Root(true, {
            size: "md",
        }));
        const style = $.let(checkbox.unwrap().unwrap("Checkbox").style.unwrap("some"));
        $(Assert.equal(style.size.unwrap("some").hasTag("md"), true));
    });

    test("creates large checkbox via style.size", $ => {
        const checkbox = $.let(Checkbox.Root(true, {
            size: "lg",
        }));
        const style = $.let(checkbox.unwrap().unwrap("Checkbox").style.unwrap("some"));
        $(Assert.equal(style.size.unwrap("some").hasTag("lg"), true));
    });

    test("creates checkbox with Style.Size helper in style", $ => {
        const checkbox = $.let(Checkbox.Root(true, {
            size: Style.Size("md"),
        }));
        const style = $.let(checkbox.unwrap().unwrap("Checkbox").style.unwrap("some"));
        $(Assert.equal(style.size.unwrap("some").hasTag("md"), true));
    });

    // =========================================================================
    // Colour escape hatches (new)
    // =========================================================================

    test("fillColor / checkColor / borderColor round-trip via style", $ => {
        const checkbox = $.let(Checkbox.Root(true, {
            fillColor: "blue.500",
            checkColor: "white",
            borderColor: "gray.300",
        }));
        const style = $.let(checkbox.unwrap().unwrap("Checkbox").style.unwrap("some"));
        $(Assert.equal(style.fillColor.unwrap("some"), "blue.500"));
        $(Assert.equal(style.checkColor.unwrap("some"), "white"));
        $(Assert.equal(style.borderColor.unwrap("some"), "gray.300"));
    });

    // =========================================================================
    // Combined Options
    // =========================================================================

    test("creates checkbox with all options", $ => {
        const checkbox = $.let(Checkbox.Root(true, {
            label: "Enable feature",
            indeterminate: false,
            disabled: false,
            colorPalette: "blue",
            size: "md",
        }));

        $(Assert.equal(checkbox.unwrap().unwrap("Checkbox").checked, true));
        $(Assert.equal(checkbox.unwrap().unwrap("Checkbox").label.unwrap("some"), "Enable feature"));
        $(Assert.equal(checkbox.unwrap().unwrap("Checkbox").indeterminate.unwrap("some"), false));
        $(Assert.equal(checkbox.unwrap().unwrap("Checkbox").disabled.unwrap("some"), false));
        const style = $.let(checkbox.unwrap().unwrap("Checkbox").style.unwrap("some"));
        $(Assert.equal(style.colorPalette.unwrap("some").hasTag("blue"), true));
        $(Assert.equal(style.size.unwrap("some").hasTag("md"), true));
    });

    test("creates terms acceptance checkbox", $ => {
        const checkbox = $.let(Checkbox.Root(false, {
            label: "I accept the terms and conditions",
            colorPalette: "blue",
        }));

        $(Assert.equal(checkbox.unwrap().unwrap("Checkbox").checked, false));
        $(Assert.equal(checkbox.unwrap().unwrap("Checkbox").label.unwrap("some"), "I accept the terms and conditions"));
        const style = $.let(checkbox.unwrap().unwrap("Checkbox").style.unwrap("some"));
        $(Assert.equal(style.colorPalette.unwrap("some").hasTag("blue"), true));
    });

    test("creates select all checkbox with indeterminate", $ => {
        const checkbox = $.let(Checkbox.Root(false, {
            label: "Select all",
            indeterminate: true,
        }));

        $(Assert.equal(checkbox.unwrap().unwrap("Checkbox").label.unwrap("some"), "Select all"));
        $(Assert.equal(checkbox.unwrap().unwrap("Checkbox").indeterminate.unwrap("some"), true));
    });

    test("creates disabled readonly checkbox", $ => {
        const checkbox = $.let(Checkbox.Root(true, {
            label: "Premium feature (upgrade required)",
            disabled: true,
            colorPalette: "gray",
        }));

        $(Assert.equal(checkbox.unwrap().unwrap("Checkbox").checked, true));
        $(Assert.equal(checkbox.unwrap().unwrap("Checkbox").disabled.unwrap("some"), true));
        const style = $.let(checkbox.unwrap().unwrap("Checkbox").style.unwrap("some"));
        $(Assert.equal(style.colorPalette.unwrap("some").hasTag("gray"), true));
    });
}, {   platformFns: TestImpl,});
