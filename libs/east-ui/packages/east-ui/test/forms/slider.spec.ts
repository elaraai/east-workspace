/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { type ExprType } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Slider, Style } from "@elaraai/east-ui/internal";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./slider.examples.js";

describeEast("Slider", (test) => {
    Assert.examples(test, {
        sliderBasic: ex.sliderBasic,
        sliderVariants: ex.sliderVariants,
    });

    test("sliderVariants is the live configurator", $ => {
        const panel = $.const(ex.sliderVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });

    // =========================================================================
    // Basic Creation
    // =========================================================================

    test("creates slider with value only", $ => {
        const slider = $.let(Slider.Root(50.0));

        $(Assert.equal(slider.unwrap().unwrap("Slider").value, 50.0));
        $(Assert.equal(slider.unwrap().unwrap("Slider").min.hasTag("none"), true));
        $(Assert.equal(slider.unwrap().unwrap("Slider").max.hasTag("none"), true));
        $(Assert.equal(slider.unwrap().unwrap("Slider").step.hasTag("none"), true));
    });

    test("creates slider with different value", $ => {
        const slider = $.let(Slider.Root(75.5));

        $(Assert.equal(slider.unwrap().unwrap("Slider").value, 75.5));
    });

    // =========================================================================
    // Min/Max Range
    // =========================================================================

    test("creates slider with min", $ => {
        const slider = $.let(Slider.Root(25.0, {
            min: 0,
        }));

        $(Assert.equal(slider.unwrap().unwrap("Slider").min.hasTag("some"), true));
        $(Assert.equal(slider.unwrap().unwrap("Slider").min.unwrap("some"), 0.0));
    });

    test("creates slider with max", $ => {
        const slider = $.let(Slider.Root(75.0, {
            max: 100,
        }));

        $(Assert.equal(slider.unwrap().unwrap("Slider").max.hasTag("some"), true));
        $(Assert.equal(slider.unwrap().unwrap("Slider").max.unwrap("some"), 100.0));
    });

    test("creates slider with min and max", $ => {
        const slider = $.let(Slider.Root(50.0, {
            min: 0,
            max: 100,
        }));

        $(Assert.equal(slider.unwrap().unwrap("Slider").min.unwrap("some"), 0.0));
        $(Assert.equal(slider.unwrap().unwrap("Slider").max.unwrap("some"), 100.0));
    });

    test("creates slider with custom range", $ => {
        const slider = $.let(Slider.Root(500.0, {
            min: 100,
            max: 1000,
        }));

        $(Assert.equal(slider.unwrap().unwrap("Slider").value, 500.0));
        $(Assert.equal(slider.unwrap().unwrap("Slider").min.unwrap("some"), 100.0));
        $(Assert.equal(slider.unwrap().unwrap("Slider").max.unwrap("some"), 1000.0));
    });

    // =========================================================================
    // Step
    // =========================================================================

    test("creates slider with step", $ => {
        const slider = $.let(Slider.Root(50.0, {
            step: 5,
        }));

        $(Assert.equal(slider.unwrap().unwrap("Slider").step.hasTag("some"), true));
        $(Assert.equal(slider.unwrap().unwrap("Slider").step.unwrap("some"), 5.0));
    });

    test("creates slider with decimal step", $ => {
        const slider = $.let(Slider.Root(0.5, {
            min: 0,
            max: 1,
            step: 0.1,
        }));

        $(Assert.equal(slider.unwrap().unwrap("Slider").step.unwrap("some"), 0.1));
    });

    // =========================================================================
    // Orientation
    // =========================================================================

    test("creates horizontal slider", $ => {
        const slider = $.let(Slider.Root(50.0, {
            orientation: "horizontal",
        }));

        $(Assert.equal(slider.unwrap().unwrap("Slider").style.unwrap("some").orientation.hasTag("some"), true));
        $(Assert.equal(slider.unwrap().unwrap("Slider").style.unwrap("some").orientation.unwrap("some").hasTag("horizontal"), true));
    });

    test("creates vertical slider", $ => {
        const slider = $.let(Slider.Root(50.0, {
            orientation: "vertical",
        }));

        $(Assert.equal(slider.unwrap().unwrap("Slider").style.unwrap("some").orientation.unwrap("some").hasTag("vertical"), true));
    });

    test("creates slider with Style.Orientation helper", $ => {
        const slider = $.let(Slider.Root(50.0, {
            orientation: Style.Orientation("vertical"),
        }));

        $(Assert.equal(slider.unwrap().unwrap("Slider").style.unwrap("some").orientation.unwrap("some").hasTag("vertical"), true));
    });

    // =========================================================================
    // Color Palettes
    // =========================================================================

    test("creates slider with brand color palette", $ => {
        const slider = $.let(Slider.Root(50.0, {
            colorPalette: "brand",
        }));

        $(Assert.equal(slider.unwrap().unwrap("Slider").style.unwrap("some").colorPalette.hasTag("some"), true));
        $(Assert.equal(slider.unwrap().unwrap("Slider").style.unwrap("some").colorPalette.unwrap("some").hasTag("brand"), true));
    });

    test("creates slider with success color palette", $ => {
        const slider = $.let(Slider.Root(50.0, {
            colorPalette: "success",
        }));

        $(Assert.equal(slider.unwrap().unwrap("Slider").style.unwrap("some").colorPalette.unwrap("some").hasTag("success"), true));
    });

    test("creates slider with Style.ColorScheme helper", $ => {
        const slider = $.let(Slider.Root(50.0, {
            colorPalette: Style.ColorScheme("brand"),
        }));

        $(Assert.equal(slider.unwrap().unwrap("Slider").style.unwrap("some").colorPalette.unwrap("some").hasTag("brand"), true));
    });

    // =========================================================================
    // Size
    // =========================================================================

    test("creates small slider", $ => {
        const slider = $.let(Slider.Root(50.0, {
            size: "sm",
        }));

        $(Assert.equal(slider.unwrap().unwrap("Slider").style.unwrap("some").size.hasTag("some"), true));
        $(Assert.equal(slider.unwrap().unwrap("Slider").style.unwrap("some").size.unwrap("some").hasTag("sm"), true));
    });

    test("creates medium slider", $ => {
        const slider = $.let(Slider.Root(50.0, {
            size: "md",
        }));

        $(Assert.equal(slider.unwrap().unwrap("Slider").style.unwrap("some").size.unwrap("some").hasTag("md"), true));
    });

    test("creates large slider", $ => {
        const slider = $.let(Slider.Root(50.0, {
            size: "lg",
        }));

        $(Assert.equal(slider.unwrap().unwrap("Slider").style.unwrap("some").size.unwrap("some").hasTag("lg"), true));
    });

    test("creates slider with Style.Size helper", $ => {
        const slider = $.let(Slider.Root(50.0, {
            size: Style.Size("md"),
        }));

        $(Assert.equal(slider.unwrap().unwrap("Slider").style.unwrap("some").size.unwrap("some").hasTag("md"), true));
    });

    // =========================================================================
    // Variant
    // =========================================================================

    test("creates outline variant slider", $ => {
        const slider = $.let(Slider.Root(50.0, {
            variant: "outline",
        }));

        $(Assert.equal(slider.unwrap().unwrap("Slider").style.unwrap("some").variant.hasTag("some"), true));
        $(Assert.equal(slider.unwrap().unwrap("Slider").style.unwrap("some").variant.unwrap("some").hasTag("outline"), true));
    });

    test("creates subtle variant slider", $ => {
        const slider = $.let(Slider.Root(50.0, {
            variant: "subtle",
        }));

        $(Assert.equal(slider.unwrap().unwrap("Slider").style.unwrap("some").variant.unwrap("some").hasTag("subtle"), true));
    });

    test("creates slider with SliderVariant helper", $ => {
        const slider = $.let(Slider.Root(50.0, {
            variant: "subtle",
        }));

        $(Assert.equal(slider.unwrap().unwrap("Slider").style.unwrap("some").variant.unwrap("some").hasTag("subtle"), true));
    });

    // =========================================================================
    // Disabled State
    // =========================================================================

    test("creates disabled slider", $ => {
        const slider = $.let(Slider.Root(50.0, {
            disabled: true,
        }));

        $(Assert.equal(slider.unwrap().unwrap("Slider").disabled.hasTag("some"), true));
        $(Assert.equal(slider.unwrap().unwrap("Slider").disabled.unwrap("some"), true));
    });

    test("creates enabled slider explicitly", $ => {
        const slider = $.let(Slider.Root(50.0, {
            disabled: false,
        }));

        $(Assert.equal(slider.unwrap().unwrap("Slider").disabled.unwrap("some"), false));
    });

    // =========================================================================
    // Combined Options
    // =========================================================================

    test("creates slider with all options", $ => {
        const slider = $.let(Slider.Root(50.0, {
            min: 0,
            max: 100,
            step: 5,
            orientation: "horizontal",
            colorPalette: "brand",
            size: "md",
            variant: "subtle",
            disabled: false,
        }));

        $(Assert.equal(slider.unwrap().unwrap("Slider").value, 50.0));
        $(Assert.equal(slider.unwrap().unwrap("Slider").min.unwrap("some"), 0.0));
        $(Assert.equal(slider.unwrap().unwrap("Slider").max.unwrap("some"), 100.0));
        $(Assert.equal(slider.unwrap().unwrap("Slider").step.unwrap("some"), 5.0));
        $(Assert.equal(slider.unwrap().unwrap("Slider").style.unwrap("some").orientation.unwrap("some").hasTag("horizontal"), true));
        $(Assert.equal(slider.unwrap().unwrap("Slider").style.unwrap("some").colorPalette.unwrap("some").hasTag("brand"), true));
        $(Assert.equal(slider.unwrap().unwrap("Slider").style.unwrap("some").size.unwrap("some").hasTag("md"), true));
        $(Assert.equal(slider.unwrap().unwrap("Slider").style.unwrap("some").variant.unwrap("some").hasTag("subtle"), true));
        $(Assert.equal(slider.unwrap().unwrap("Slider").disabled.unwrap("some"), false));
    });

    test("creates volume slider", $ => {
        const slider = $.let(Slider.Root(75.0, {
            min: 0,
            max: 100,
            colorPalette: "brand",
            size: "sm",
        }));

        $(Assert.equal(slider.unwrap().unwrap("Slider").value, 75.0));
        $(Assert.equal(slider.unwrap().unwrap("Slider").min.unwrap("some"), 0.0));
        $(Assert.equal(slider.unwrap().unwrap("Slider").max.unwrap("some"), 100.0));
    });

    test("creates percentage slider", $ => {
        const slider = $.let(Slider.Root(0.5, {
            min: 0,
            max: 1,
            step: 0.01,
        }));

        $(Assert.equal(slider.unwrap().unwrap("Slider").value, 0.5));
        $(Assert.equal(slider.unwrap().unwrap("Slider").step.unwrap("some"), 0.01));
    });

    test("creates vertical progress slider", $ => {
        const slider = $.let(Slider.Root(30.0, {
            orientation: "vertical",
            min: 0,
            max: 100,
            colorPalette: "success",
        }));

        $(Assert.equal(slider.unwrap().unwrap("Slider").style.unwrap("some").orientation.unwrap("some").hasTag("vertical"), true));
        $(Assert.equal(slider.unwrap().unwrap("Slider").style.unwrap("some").colorPalette.unwrap("some").hasTag("success"), true));
    });

    test("creates disabled readonly slider", $ => {
        const slider = $.let(Slider.Root(50.0, {
            disabled: true,
            colorPalette: "gray",
        }));

        $(Assert.equal(slider.unwrap().unwrap("Slider").disabled.unwrap("some"), true));
        $(Assert.equal(slider.unwrap().unwrap("Slider").style.unwrap("some").colorPalette.unwrap("some").hasTag("gray"), true));
    });
}, {   platformFns: TestImpl,});
