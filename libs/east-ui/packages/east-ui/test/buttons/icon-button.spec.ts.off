/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { IconButton } from "@elaraai/east-ui";
import * as ex from "./icon-button.examples.js";

describeEast("IconButton", (test) => {
    Assert.examples(test, {
        iconButtonBasic: ex.iconButtonBasic,
        iconButtonLoading: ex.iconButtonLoading,
        iconButtonColoured: ex.iconButtonColoured,
        iconButtonOnClickReactive: ex.iconButtonOnClickReactive,
    });

    // =========================================================================
    // Required label (aria-label)
    // =========================================================================

    test("creates icon button with required label", $ => {
        const btn = $.let(IconButton.Root("fas", "xmark", "Close"));
        $(Assert.equal(btn.unwrap().unwrap("IconButton").label, "Close"));
        $(Assert.equal(btn.unwrap().unwrap("IconButton").prefix, "fas"));
        $(Assert.equal(btn.unwrap().unwrap("IconButton").name, "xmark"));
    });

    test("style is none when no options supplied", $ => {
        const btn = $.let(IconButton.Root("fas", "bars", "Menu"));
        const b = btn.unwrap().unwrap("IconButton");
        $(Assert.equal(b.style.hasTag("none"), true));
        $(Assert.equal(b.loading.hasTag("none"), true));
        $(Assert.equal(b.disabled.hasTag("none"), true));
        $(Assert.equal(b.onClick.hasTag("none"), true));
        $(Assert.equal(b.loadingIcon.hasTag("none"), true));
    });

    // =========================================================================
    // Variants (inside style)
    // =========================================================================

    test("creates icon button with solid variant", $ => {
        const btn = $.let(IconButton.Root("fas", "save", "Save", { style: { variant: "solid" } }));
        $(Assert.equal(
            btn.unwrap().unwrap("IconButton").style.unwrap("some").variant.unwrap("some").hasTag("solid"),
            true,
        ));
    });

    test("creates icon button with ghost variant", $ => {
        const btn = $.let(IconButton.Root("fas", "xmark", "Close", { style: { variant: "ghost" } }));
        $(Assert.equal(
            btn.unwrap().unwrap("IconButton").style.unwrap("some").variant.unwrap("some").hasTag("ghost"),
            true,
        ));
    });

    test("creates icon button with plain variant (new)", $ => {
        const btn = $.let(IconButton.Root("fas", "ellipsis", "More", { style: { variant: "plain" } }));
        $(Assert.equal(
            btn.unwrap().unwrap("IconButton").style.unwrap("some").variant.unwrap("some").hasTag("plain"),
            true,
        ));
    });

    // =========================================================================
    // Color palette + size
    // =========================================================================

    test("creates icon button with colorPalette", $ => {
        const btn = $.let(IconButton.Root("fas", "heart", "Favourite", { style: { colorPalette: "red" } }));
        $(Assert.equal(
            btn.unwrap().unwrap("IconButton").style.unwrap("some").colorPalette.unwrap("some").hasTag("red"),
            true,
        ));
    });

    test("creates icon button with size xs", $ => {
        const btn = $.let(IconButton.Root("fas", "gear", "Settings", { style: { size: "xs" } }));
        $(Assert.equal(
            btn.unwrap().unwrap("IconButton").style.unwrap("some").size.unwrap("some").hasTag("xs"),
            true,
        ));
    });

    // =========================================================================
    // State on main (not inside style)
    // =========================================================================

    test("creates loading icon button", $ => {
        const btn = $.let(IconButton.Root("fas", "rotate", "Refresh", { loading: true }));
        $(Assert.equal(btn.unwrap().unwrap("IconButton").loading.unwrap("some"), true));
    });

    test("creates disabled icon button", $ => {
        const btn = $.let(IconButton.Root("fas", "save", "Save", { disabled: true }));
        $(Assert.equal(btn.unwrap().unwrap("IconButton").disabled.unwrap("some"), true));
    });

    test("creates icon button with loadingIcon on main", $ => {
        const btn = $.let(IconButton.Root("fas", "rotate", "Refresh", {
            loading: true,
            loadingIcon: { prefix: "fas", name: "spinner" },
        }));
        const b = btn.unwrap().unwrap("IconButton");
        $(Assert.equal(b.loadingIcon.unwrap("some").prefix, "fas"));
        $(Assert.equal(b.loadingIcon.unwrap("some").name, "spinner"));
    });

    // =========================================================================
    // Colour escape hatches
    // =========================================================================

    test("creates icon button with full colour escape hatches", $ => {
        const btn = $.let(IconButton.Root("fas", "rocket", "Deploy", {
            style: {
                color: "#ffffff",
                background: "#1a2234",
                borderColor: "#3d5cff",
                hoverBackground: "#25345a",
            },
        }));
        const s = btn.unwrap().unwrap("IconButton").style.unwrap("some");
        $(Assert.equal(s.color.unwrap("some"), "#ffffff"));
        $(Assert.equal(s.background.unwrap("some"), "#1a2234"));
        $(Assert.equal(s.borderColor.unwrap("some"), "#3d5cff"));
        $(Assert.equal(s.hoverBackground.unwrap("some"), "#25345a"));
    });

    // =========================================================================
    // Combined — kitchen sink
    // =========================================================================

    test("creates fully-configured icon button", $ => {
        const btn = $.let(IconButton.Root("fas", "check", "Confirm", {
            loading: false,
            disabled: false,
            style: {
                variant: "solid",
                colorPalette: "green",
                size: "md",
                color: "#ffffff",
            },
        }));
        const b = btn.unwrap().unwrap("IconButton");
        $(Assert.equal(b.label, "Confirm"));
        $(Assert.equal(b.loading.unwrap("some"), false));
        $(Assert.equal(b.disabled.unwrap("some"), false));
        const s = b.style.unwrap("some");
        $(Assert.equal(s.variant.unwrap("some").hasTag("solid"), true));
        $(Assert.equal(s.colorPalette.unwrap("some").hasTag("green"), true));
        $(Assert.equal(s.size.unwrap("some").hasTag("md"), true));
        $(Assert.equal(s.color.unwrap("some"), "#ffffff"));
    });
}, { platformFns: TestImpl });
