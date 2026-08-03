/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Switch, Style } from "@elaraai/east-ui/internal";
import * as ex from "./switch.examples.js";

describeEast("Switch", (test) => {
    Assert.examples(test, {
        switchBasic: ex.switchBasic,
        switchSizes: ex.switchSizes,
        switchInteractive: ex.switchInteractive,
    });

    // =========================================================================
    // Basic Creation
    // =========================================================================

    test("creates switch with checked true", $ => {
        const sw = $.let(Switch.Root(true));

        $(Assert.equal(sw.unwrap().unwrap("Switch").checked, true));
        $(Assert.equal(sw.unwrap().unwrap("Switch").label.hasTag("none"), true));
        $(Assert.equal(sw.unwrap().unwrap("Switch").disabled.hasTag("none"), true));
        $(Assert.equal(sw.unwrap().unwrap("Switch").style.hasTag("none"), true));
    });

    test("creates switch with checked false", $ => {
        const sw = $.let(Switch.Root(false));

        $(Assert.equal(sw.unwrap().unwrap("Switch").checked, false));
    });

    // =========================================================================
    // Label
    // =========================================================================

    test("creates switch with label", $ => {
        const sw = $.let(Switch.Root(false, {
            label: "Enable notifications",
        }));

        $(Assert.equal(sw.unwrap().unwrap("Switch").label.hasTag("some"), true));
        $(Assert.equal(sw.unwrap().unwrap("Switch").label.unwrap("some"), "Enable notifications"));
    });

    test("creates switch with long label", $ => {
        const sw = $.let(Switch.Root(false, {
            label: "Enable all email notifications for this account",
        }));

        $(Assert.equal(sw.unwrap().unwrap("Switch").label.unwrap("some"), "Enable all email notifications for this account"));
    });

    // =========================================================================
    // Disabled State
    // =========================================================================

    test("creates disabled switch", $ => {
        const sw = $.let(Switch.Root(false, {
            disabled: true,
        }));

        $(Assert.equal(sw.unwrap().unwrap("Switch").disabled.hasTag("some"), true));
        $(Assert.equal(sw.unwrap().unwrap("Switch").disabled.unwrap("some"), true));
    });

    test("creates enabled switch explicitly", $ => {
        const sw = $.let(Switch.Root(true, {
            disabled: false,
        }));

        $(Assert.equal(sw.unwrap().unwrap("Switch").disabled.unwrap("some"), false));
    });

    // =========================================================================
    // Color Palettes (now inside style)
    // =========================================================================

    test("creates switch with brand color palette in style", $ => {
        const sw = $.let(Switch.Root(true, {
            colorPalette: "brand",
        }));
        const style = $.let(sw.unwrap().unwrap("Switch").style.unwrap("some"));
        $(Assert.equal(style.colorPalette.hasTag("some"), true));
        $(Assert.equal(style.colorPalette.unwrap("some").hasTag("brand"), true));
    });

    test("creates switch with success color palette in style", $ => {
        const sw = $.let(Switch.Root(true, {
            colorPalette: "success",
        }));
        const style = $.let(sw.unwrap().unwrap("Switch").style.unwrap("some"));
        $(Assert.equal(style.colorPalette.unwrap("some").hasTag("success"), true));
    });

    test("creates switch with brand color palette in style", $ => {
        const sw = $.let(Switch.Root(true, {
            colorPalette: "brand",
        }));
        const style = $.let(sw.unwrap().unwrap("Switch").style.unwrap("some"));
        $(Assert.equal(style.colorPalette.unwrap("some").hasTag("brand"), true));
    });

    test("creates switch with Style.ColorScheme helper in style", $ => {
        const sw = $.let(Switch.Root(true, {
            colorPalette: Style.ColorScheme("brand"),
        }));
        const style = $.let(sw.unwrap().unwrap("Switch").style.unwrap("some"));
        $(Assert.equal(style.colorPalette.unwrap("some").hasTag("brand"), true));
    });

    // =========================================================================
    // Sizes (now inside style)
    // =========================================================================

    test("creates small switch via style.size", $ => {
        const sw = $.let(Switch.Root(true, {
            size: "sm",
        }));
        const style = $.let(sw.unwrap().unwrap("Switch").style.unwrap("some"));
        $(Assert.equal(style.size.hasTag("some"), true));
        $(Assert.equal(style.size.unwrap("some").hasTag("sm"), true));
    });

    test("creates medium switch via style.size", $ => {
        const sw = $.let(Switch.Root(true, {
            size: "md",
        }));
        const style = $.let(sw.unwrap().unwrap("Switch").style.unwrap("some"));
        $(Assert.equal(style.size.unwrap("some").hasTag("md"), true));
    });

    test("creates large switch via style.size", $ => {
        const sw = $.let(Switch.Root(true, {
            size: "lg",
        }));
        const style = $.let(sw.unwrap().unwrap("Switch").style.unwrap("some"));
        $(Assert.equal(style.size.unwrap("some").hasTag("lg"), true));
    });

    test("creates switch with Style.Size helper in style", $ => {
        const sw = $.let(Switch.Root(true, {
            size: Style.Size("md"),
        }));
        const style = $.let(sw.unwrap().unwrap("Switch").style.unwrap("some"));
        $(Assert.equal(style.size.unwrap("some").hasTag("md"), true));
    });

    // =========================================================================
    // Colour escape hatches (new)
    // =========================================================================

    test("onColor / offColor / thumbColor round-trip via style", $ => {
        const sw = $.let(Switch.Root(true, {
            onColor: "fg.success",
            offColor: "fg.muted",
            thumbColor: "fg.inverse",
        }));
        const style = $.let(sw.unwrap().unwrap("Switch").style.unwrap("some"));
        $(Assert.equal(style.onColor.unwrap("some"), "fg.success"));
        $(Assert.equal(style.offColor.unwrap("some"), "fg.muted"));
        $(Assert.equal(style.thumbColor.unwrap("some"), "fg.inverse"));
    });

    // =========================================================================
    // Combined Options
    // =========================================================================

    test("creates switch with all options", $ => {
        const sw = $.let(Switch.Root(true, {
            label: "Dark mode",
            disabled: false,
            colorPalette: "brand",
            size: "md",
        }));

        $(Assert.equal(sw.unwrap().unwrap("Switch").checked, true));
        $(Assert.equal(sw.unwrap().unwrap("Switch").label.unwrap("some"), "Dark mode"));
        $(Assert.equal(sw.unwrap().unwrap("Switch").disabled.unwrap("some"), false));
        const style = $.let(sw.unwrap().unwrap("Switch").style.unwrap("some"));
        $(Assert.equal(style.colorPalette.unwrap("some").hasTag("brand"), true));
        $(Assert.equal(style.size.unwrap("some").hasTag("md"), true));
    });

    test("creates dark mode toggle switch", $ => {
        const sw = $.let(Switch.Root(false, {
            label: "Dark mode",
            colorPalette: "gray",
        }));

        $(Assert.equal(sw.unwrap().unwrap("Switch").checked, false));
        $(Assert.equal(sw.unwrap().unwrap("Switch").label.unwrap("some"), "Dark mode"));
        const style = $.let(sw.unwrap().unwrap("Switch").style.unwrap("some"));
        $(Assert.equal(style.colorPalette.unwrap("some").hasTag("gray"), true));
    });

    test("creates notification settings switch", $ => {
        const sw = $.let(Switch.Root(true, {
            label: "Push notifications",
            colorPalette: "success",
            size: "sm",
        }));

        $(Assert.equal(sw.unwrap().unwrap("Switch").checked, true));
        $(Assert.equal(sw.unwrap().unwrap("Switch").label.unwrap("some"), "Push notifications"));
        const style = $.let(sw.unwrap().unwrap("Switch").style.unwrap("some"));
        $(Assert.equal(style.colorPalette.unwrap("some").hasTag("success"), true));
        $(Assert.equal(style.size.unwrap("some").hasTag("sm"), true));
    });

    test("creates disabled premium feature switch", $ => {
        const sw = $.let(Switch.Root(false, {
            label: "Premium feature (upgrade required)",
            disabled: true,
            colorPalette: "gray",
        }));

        $(Assert.equal(sw.unwrap().unwrap("Switch").checked, false));
        $(Assert.equal(sw.unwrap().unwrap("Switch").disabled.unwrap("some"), true));
        const style = $.let(sw.unwrap().unwrap("Switch").style.unwrap("some"));
        $(Assert.equal(style.colorPalette.unwrap("some").hasTag("gray"), true));
    });
}, {   platformFns: TestImpl,});
