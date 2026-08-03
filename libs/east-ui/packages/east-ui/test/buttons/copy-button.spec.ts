/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { CopyButton } from "@elaraai/east-ui/internal";
import * as ex from "./copy-button.examples.js";

describeEast("CopyButton", (test) => {
    Assert.examples(test, {
        copyButtonBasic: ex.copyButtonBasic,
        copyButtonLabelled: ex.copyButtonLabelled,
        copyButtonBranded: ex.copyButtonBranded,
    });

    // =========================================================================
    // Content — value + optional label
    // =========================================================================

    test("creates copy button with value only", $ => {
        const btn = $.let(CopyButton.Root("text-to-copy"));
        const b = btn.unwrap().unwrap("CopyButton");
        $(Assert.equal(b.value, "text-to-copy"));
        $(Assert.equal(b.label.hasTag("none"), true));
        $(Assert.equal(b.style.hasTag("none"), true));
        $(Assert.equal(b.timeout.hasTag("none"), true));
        $(Assert.equal(b.disabled.hasTag("none"), true));
    });

    test("creates copy button with label", $ => {
        const btn = $.let(CopyButton.Root("content", { label: "Copy" }));
        $(Assert.equal(btn.unwrap().unwrap("CopyButton").label.unwrap("some"), "Copy"));
    });

    // =========================================================================
    // Config — timeout on main (moved out of style)
    // =========================================================================

    test("creates copy button with timeout on main", $ => {
        const btn = $.let(CopyButton.Root("x", { timeout: "1500" }));
        $(Assert.equal(btn.unwrap().unwrap("CopyButton").timeout.unwrap("some"), "1500"));
    });

    // =========================================================================
    // State — disabled on main (moved out of style)
    // =========================================================================

    test("creates disabled copy button on main", $ => {
        const btn = $.let(CopyButton.Root("x", { disabled: true }));
        $(Assert.equal(btn.unwrap().unwrap("CopyButton").disabled.unwrap("some"), true));
    });

    // =========================================================================
    // Variants — inside style
    // =========================================================================

    test("creates copy button with solid variant", $ => {
        const btn = $.let(CopyButton.Root("x", { variant: "solid" }));
        $(Assert.equal(
            btn.unwrap().unwrap("CopyButton").style.unwrap("some").variant.unwrap("some").hasTag("solid"),
            true,
        ));
    });

    test("creates copy button with outline variant", $ => {
        const btn = $.let(CopyButton.Root("x", { variant: "outline" }));
        $(Assert.equal(
            btn.unwrap().unwrap("CopyButton").style.unwrap("some").variant.unwrap("some").hasTag("outline"),
            true,
        ));
    });

    // =========================================================================
    // Size + color palette
    // =========================================================================

    test("creates copy button with size + colorPalette inside style", $ => {
        const btn = $.let(CopyButton.Root("x", { size: "sm", colorPalette: "brand" }));
        const s = btn.unwrap().unwrap("CopyButton").style.unwrap("some");
        $(Assert.equal(s.size.unwrap("some").hasTag("sm"), true));
        $(Assert.equal(s.colorPalette.unwrap("some").hasTag("brand"), true));
    });

    // =========================================================================
    // Colour escape hatches + successColor
    // =========================================================================

    test("creates copy button with colour escape hatches + successColor", $ => {
        const btn = $.let(CopyButton.Root("x", {
            color: "fg.inverse",
            background: "bg.inverse",
            borderColor: "border.brand",
            hoverBackground: "bg.inverse",
            successColor: "fg.success",
        }));
        const s = btn.unwrap().unwrap("CopyButton").style.unwrap("some");
        $(Assert.equal(s.color.unwrap("some"), "fg.inverse"));
        $(Assert.equal(s.background.unwrap("some"), "bg.inverse"));
        $(Assert.equal(s.borderColor.unwrap("some"), "border.brand"));
        $(Assert.equal(s.hoverBackground.unwrap("some"), "bg.inverse"));
        $(Assert.equal(s.successColor.unwrap("some"), "fg.success"));
    });

    // =========================================================================
    // Kitchen sink
    // =========================================================================

    test("creates fully-configured copy button", $ => {
        const btn = $.let(CopyButton.Root("the-value", {
            label: "Copy value",
            timeout: "2500",
            disabled: false,
            variant: "outline",
            colorPalette: "brand",
            size: "md",
            successColor: "fg.success",
        }));
        const b = btn.unwrap().unwrap("CopyButton");
        $(Assert.equal(b.value, "the-value"));
        $(Assert.equal(b.label.unwrap("some"), "Copy value"));
        $(Assert.equal(b.timeout.unwrap("some"), "2500"));
        $(Assert.equal(b.disabled.unwrap("some"), false));
        const s = b.style.unwrap("some");
        $(Assert.equal(s.variant.unwrap("some").hasTag("outline"), true));
        $(Assert.equal(s.colorPalette.unwrap("some").hasTag("brand"), true));
        $(Assert.equal(s.size.unwrap("some").hasTag("md"), true));
        $(Assert.equal(s.successColor.unwrap("some"), "fg.success"));
    });
}, { platformFns: TestImpl });
