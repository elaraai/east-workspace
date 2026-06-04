/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Toggle } from "@elaraai/east-ui";
import * as ex from "./toggle.examples.js";

describeEast("Toggle", (test) => {
    Assert.examples(test, {
        toggleGridlines: ex.toggleGridlines,
        toggleLockColumns: ex.toggleLockColumns,
        toggleAutoRefreshReactive: ex.toggleAutoRefreshReactive,
    });

    // =========================================================================
    // Content: label + pressed (required)
    // =========================================================================

    test("creates toggle with string label (coerced to Text)", $ => {
        const t = $.let(Toggle.Root("Show gridlines", false));
        $(Assert.equal(
            t.unwrap().unwrap("Toggle").label.unwrap().unwrap("Text").value,
            "Show gridlines",
        ));
    });

    test("toggle without options → style/disabled/onChange/icon all none", $ => {
        const t = $.let(Toggle.Root("Mute notifications", true));
        const b = t.unwrap().unwrap("Toggle");
        $(Assert.equal(b.pressed, true));
        $(Assert.equal(b.icon.hasTag("none"), true));
        $(Assert.equal(b.disabled.hasTag("none"), true));
        $(Assert.equal(b.onChange.hasTag("none"), true));
        $(Assert.equal(b.style.hasTag("none"), true));
    });

    test("creates toggle in unpressed state", $ => {
        const t = $.let(Toggle.Root("Show legend", false));
        $(Assert.equal(t.unwrap().unwrap("Toggle").pressed, false));
    });

    test("creates toggle with leading icon", $ => {
        const t = $.let(Toggle.Root("Lock columns", false, {
            icon: { prefix: "fas", name: "lock" },
        }));
        const b = t.unwrap().unwrap("Toggle");
        $(Assert.equal(b.icon.unwrap("some").prefix, "fas"));
        $(Assert.equal(b.icon.unwrap("some").name, "lock"));
    });

    // =========================================================================
    // State: disabled on main
    // =========================================================================

    test("creates disabled toggle", $ => {
        const t = $.let(Toggle.Root("Auto-refresh", false, { disabled: true }));
        $(Assert.equal(t.unwrap().unwrap("Toggle").disabled.unwrap("some"), true));
    });

    // =========================================================================
    // Visual (style)
    // =========================================================================

    test("creates toggle with variant inside style", $ => {
        const t = $.let(Toggle.Root("A", true, { style: { variant: "subtle" } }));
        $(Assert.equal(
            t.unwrap().unwrap("Toggle").style.unwrap("some").variant.unwrap("some").hasTag("subtle"),
            true,
        ));
    });

    test("creates toggle with size inside style", $ => {
        const t = $.let(Toggle.Root("A", true, { style: { size: "sm" } }));
        $(Assert.equal(
            t.unwrap().unwrap("Toggle").style.unwrap("some").size.unwrap("some").hasTag("sm"),
            true,
        ));
    });

    test("creates toggle with pressed-state colour escape hatches", $ => {
        const t = $.let(Toggle.Root("A", true, {
            style: {
                pressedBackground: "#eef2ff",
                pressedColor: "#1a2234",
                background: "#ffffff",
                color: "#6b7280",
                borderColor: "#e5e7eb",
            },
        }));
        const s = t.unwrap().unwrap("Toggle").style.unwrap("some");
        $(Assert.equal(s.pressedBackground.unwrap("some"), "#eef2ff"));
        $(Assert.equal(s.pressedColor.unwrap("some"), "#1a2234"));
        $(Assert.equal(s.background.unwrap("some"), "#ffffff"));
        $(Assert.equal(s.color.unwrap("some"), "#6b7280"));
        $(Assert.equal(s.borderColor.unwrap("some"), "#e5e7eb"));
    });

    // =========================================================================
    // Combined
    // =========================================================================

    test("creates fully-configured toggle", $ => {
        const t = $.let(Toggle.Root("Auto-refresh", true, {
            icon: { prefix: "fas", name: "rotate" },
            disabled: false,
            style: {
                variant: "subtle",
                size: "sm",
                pressedBackground: "#eef2ff",
            },
        }));
        const b = t.unwrap().unwrap("Toggle");
        $(Assert.equal(b.pressed, true));
        $(Assert.equal(b.disabled.unwrap("some"), false));
        $(Assert.equal(b.icon.unwrap("some").name, "rotate"));
        const s = b.style.unwrap("some");
        $(Assert.equal(s.variant.unwrap("some").hasTag("subtle"), true));
        $(Assert.equal(s.size.unwrap("some").hasTag("sm"), true));
        $(Assert.equal(s.pressedBackground.unwrap("some"), "#eef2ff"));
    });
}, { platformFns: TestImpl });
