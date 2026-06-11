/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Button, Style } from "@elaraai/east-ui/internal";
import * as ex from "./button.examples.js";

describeEast("Button", (test) => {
    Assert.examples(test, {
        buttonBasic: ex.buttonBasic,
        buttonSolidVariant: ex.buttonSolidVariant,
        buttonDangerOutline: ex.buttonDangerOutline,
        buttonReactiveCounter: ex.buttonReactiveCounter,
        buttonWithIcons: ex.buttonWithIcons,
        buttonLoading: ex.buttonLoading,
        buttonRichLabel: ex.buttonRichLabel,
        buttonGhost: ex.buttonGhost,
        buttonPlain: ex.buttonPlain,
        buttonBrandedColours: ex.buttonBrandedColours,
    });

    // =========================================================================
    // Basic Creation — label is now a UIComponentType (string coerced to Text).
    // =========================================================================

    test("creates button with string label (coerced to Text.Root)", $ => {
        const button = $.let(Button.Root("Click me"));
        $(Assert.equal(button.unwrap().unwrap("Button").label.unwrap().unwrap("Text").value, "Click me"));
        $(Assert.equal(button.unwrap().unwrap("Button").style.hasTag("none"), true));
    });

    test("creates button with different label", $ => {
        const button = $.let(Button.Root("Submit"));
        $(Assert.equal(button.unwrap().unwrap("Button").label.unwrap().unwrap("Text").value, "Submit"));
    });

    // =========================================================================
    // Variants — all live inside `style`.
    // =========================================================================

    test("creates solid button", $ => {
        const button = $.let(Button.Root("Solid", { variant: "solid" }));
        const style = button.unwrap().unwrap("Button").style.unwrap("some");
        $(Assert.equal(style.variant.unwrap("some").hasTag("solid"), true));
    });

    test("creates subtle button", $ => {
        const button = $.let(Button.Root("Subtle", { variant: "subtle" }));
        $(Assert.equal(button.unwrap().unwrap("Button").style.unwrap("some").variant.unwrap("some").hasTag("subtle"), true));
    });

    test("creates outline button", $ => {
        const button = $.let(Button.Root("Outline", { variant: "outline" }));
        $(Assert.equal(button.unwrap().unwrap("Button").style.unwrap("some").variant.unwrap("some").hasTag("outline"), true));
    });

    test("creates ghost button", $ => {
        const button = $.let(Button.Root("Ghost", { variant: "ghost" }));
        $(Assert.equal(button.unwrap().unwrap("Button").style.unwrap("some").variant.unwrap("some").hasTag("ghost"), true));
    });

    test("creates plain button (new variant)", $ => {
        const button = $.let(Button.Root("Plain", { variant: "plain" }));
        $(Assert.equal(button.unwrap().unwrap("Button").style.unwrap("some").variant.unwrap("some").hasTag("plain"), true));
    });

    // =========================================================================
    // Color Palettes
    // =========================================================================

    test("creates button with blue color palette", $ => {
        const button = $.let(Button.Root("Blue", { colorPalette: "blue" }));
        $(Assert.equal(button.unwrap().unwrap("Button").style.unwrap("some").colorPalette.unwrap("some").hasTag("blue"), true));
    });

    test("creates button with red color palette", $ => {
        const button = $.let(Button.Root("Red", { colorPalette: "red" }));
        $(Assert.equal(button.unwrap().unwrap("Button").style.unwrap("some").colorPalette.unwrap("some").hasTag("red"), true));
    });

    test("creates button with green color palette", $ => {
        const button = $.let(Button.Root("Green", { colorPalette: "green" }));
        $(Assert.equal(button.unwrap().unwrap("Button").style.unwrap("some").colorPalette.unwrap("some").hasTag("green"), true));
    });

    test("creates button with Style.ColorScheme helper", $ => {
        const button = $.let(Button.Root("Teal", { colorPalette: Style.ColorScheme("teal") }));
        $(Assert.equal(button.unwrap().unwrap("Button").style.unwrap("some").colorPalette.unwrap("some").hasTag("teal"), true));
    });

    // =========================================================================
    // Sizes
    // =========================================================================

    test("creates extra small button", $ => {
        const button = $.let(Button.Root("XS", { size: "xs" }));
        $(Assert.equal(button.unwrap().unwrap("Button").style.unwrap("some").size.unwrap("some").hasTag("xs"), true));
    });

    test("creates small button", $ => {
        const button = $.let(Button.Root("Small", { size: "sm" }));
        $(Assert.equal(button.unwrap().unwrap("Button").style.unwrap("some").size.unwrap("some").hasTag("sm"), true));
    });

    test("creates medium button", $ => {
        const button = $.let(Button.Root("Medium", { size: "md" }));
        $(Assert.equal(button.unwrap().unwrap("Button").style.unwrap("some").size.unwrap("some").hasTag("md"), true));
    });

    test("creates large button", $ => {
        const button = $.let(Button.Root("Large", { size: "lg" }));
        $(Assert.equal(button.unwrap().unwrap("Button").style.unwrap("some").size.unwrap("some").hasTag("lg"), true));
    });

    test("creates button with Style.Size helper", $ => {
        const button = $.let(Button.Root("Sized", { size: Style.Size("md") }));
        $(Assert.equal(button.unwrap().unwrap("Button").style.unwrap("some").size.unwrap("some").hasTag("md"), true));
    });

    // =========================================================================
    // State — lives on MAIN, not inside `style`.
    // =========================================================================

    test("creates loading button (state on main)", $ => {
        const button = $.let(Button.Root("Loading…", { loading: true }));
        $(Assert.equal(button.unwrap().unwrap("Button").loading.unwrap("some"), true));
    });

    test("creates non-loading button explicitly", $ => {
        const button = $.let(Button.Root("Ready", { loading: false }));
        $(Assert.equal(button.unwrap().unwrap("Button").loading.unwrap("some"), false));
    });

    test("creates disabled button (state on main)", $ => {
        const button = $.let(Button.Root("Disabled", { disabled: true }));
        $(Assert.equal(button.unwrap().unwrap("Button").disabled.unwrap("some"), true));
    });

    test("creates enabled button explicitly", $ => {
        const button = $.let(Button.Root("Enabled", { disabled: false }));
        $(Assert.equal(button.unwrap().unwrap("Button").disabled.unwrap("some"), false));
    });

    // =========================================================================
    // Icon slots (main content) — startIcon / endIcon / loadingIcon.
    // =========================================================================

    test("creates button with start icon", $ => {
        const button = $.let(Button.Root("Save", { startIcon: { prefix: "fas", name: "save" } }));
        const b = button.unwrap().unwrap("Button");
        $(Assert.equal(b.startIcon.unwrap("some").prefix, "fas"));
        $(Assert.equal(b.startIcon.unwrap("some").name, "save"));
    });

    test("creates button with end icon", $ => {
        const button = $.let(Button.Root("Next", { endIcon: { prefix: "fas", name: "arrow-right" } }));
        $(Assert.equal(button.unwrap().unwrap("Button").endIcon.unwrap("some").name, "arrow-right"));
    });

    test("creates button with loading text + loading icon", $ => {
        const button = $.let(Button.Root("Submit", {
            loading: true,
            loadingText: "Submitting…",
            loadingIcon: { prefix: "fas", name: "spinner" },
        }));
        const b = button.unwrap().unwrap("Button");
        $(Assert.equal(b.loading.unwrap("some"), true));
        $(Assert.equal(b.loadingText.unwrap("some"), "Submitting…"));
        $(Assert.equal(b.loadingIcon.unwrap("some").name, "spinner"));
    });

    // =========================================================================
    // Colour escape hatches — inside style.
    // =========================================================================

    test("creates button with color escape hatch", $ => {
        const button = $.let(Button.Root("Branded", { color: "#1a2234", background: "#e7efff" }));
        const s = button.unwrap().unwrap("Button").style.unwrap("some");
        $(Assert.equal(s.color.unwrap("some"), "#1a2234"));
        $(Assert.equal(s.background.unwrap("some"), "#e7efff"));
    });

    test("creates button with borderColor + hoverBackground", $ => {
        const button = $.let(Button.Root("Hover me", { borderColor: "#3d5cff", hoverBackground: "#1f362d" }));
        const s = button.unwrap().unwrap("Button").style.unwrap("some");
        $(Assert.equal(s.borderColor.unwrap("some"), "#3d5cff"));
        $(Assert.equal(s.hoverBackground.unwrap("some"), "#1f362d"));
    });

    // =========================================================================
    // Combined — kitchen-sink style options.
    // =========================================================================

    test("creates button with all style properties + main fields", $ => {
        const button = $.let(Button.Root("Full Style", {
            loading: false,
            disabled: false,
            variant: "solid",
            colorPalette: "blue",
            size: "md",
        }));
        const b = button.unwrap().unwrap("Button");
        $(Assert.equal(b.loading.unwrap("some"), false));
        $(Assert.equal(b.disabled.unwrap("some"), false));
        const s = b.style.unwrap("some");
        $(Assert.equal(s.variant.unwrap("some").hasTag("solid"), true));
        $(Assert.equal(s.colorPalette.unwrap("some").hasTag("blue"), true));
        $(Assert.equal(s.size.unwrap("some").hasTag("md"), true));
    });

    test("button without options → label only, style is none, main state is none", $ => {
        const button = $.let(Button.Root("Plain"));
        const b = button.unwrap().unwrap("Button");
        $(Assert.equal(b.style.hasTag("none"), true));
        $(Assert.equal(b.loading.hasTag("none"), true));
        $(Assert.equal(b.disabled.hasTag("none"), true));
        $(Assert.equal(b.onClick.hasTag("none"), true));
        $(Assert.equal(b.startIcon.hasTag("none"), true));
        $(Assert.equal(b.endIcon.hasTag("none"), true));
    });

    test("button with no visual style options has none style", $ => {
        const button = $.let(Button.Root("Empty Style", {}));
        $(Assert.equal(button.unwrap().unwrap("Button").style.hasTag("none"), true));
    });
}, { platformFns: TestImpl });
