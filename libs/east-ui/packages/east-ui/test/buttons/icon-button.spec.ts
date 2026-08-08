/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { IconButton } from "@elaraai/east-ui/internal";
import { type ExprType } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./icon-button.examples.js";

describeEast("IconButton", (test) => {
    Assert.examples(test, {
        iconButtonBasic: ex.iconButtonBasic,
        iconButtonVariants: ex.iconButtonVariants,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#463).
    // =========================================================================

    test("iconButtonVariants drives its preview from inline option tables", $ => {
        // Everything the configurator needs — the glyph / size / palette /
        // colour / badge / attention tables — is declared inside the example
        // body, because the documentation capture only extracts `fn`. That puts
        // the tables inside the Reactive body, which TestImpl does not execute,
        // so they cannot be asserted from here; `Assert.examples` above still
        // compiles and evaluates the outer function. The per-option coverage
        // lives in the IconButton.Root tests below, which construct each option
        // directly.
        const panel = $.const(ex.iconButtonVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });

    // =========================================================================
    // Required label (aria-label)
    // =========================================================================

    test("creates icon button with required label", $ => {
        const btn = $.let(IconButton.Root({ prefix: "fas", name: "xmark", label: "Close" }));
        $(Assert.equal(btn.unwrap().unwrap("IconButton").label, "Close"));
        $(Assert.equal(btn.unwrap().unwrap("IconButton").prefix, "fas"));
        $(Assert.equal(btn.unwrap().unwrap("IconButton").name, "xmark"));
    });

    test("style is none when no options supplied", $ => {
        const btn = $.let(IconButton.Root({ prefix: "fas", name: "bars", label: "Menu" }));
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
        const btn = $.let(IconButton.Root({ prefix: "fas", name: "save", label: "Save", variant: "solid" }));
        $(Assert.equal(
            btn.unwrap().unwrap("IconButton").style.unwrap("some").variant.unwrap("some").hasTag("solid"),
            true,
        ));
    });

    test("creates icon button with ghost variant", $ => {
        const btn = $.let(IconButton.Root({ prefix: "fas", name: "xmark", label: "Close", variant: "ghost" }));
        $(Assert.equal(
            btn.unwrap().unwrap("IconButton").style.unwrap("some").variant.unwrap("some").hasTag("ghost"),
            true,
        ));
    });

    test("creates icon button with plain variant (new)", $ => {
        const btn = $.let(IconButton.Root({ prefix: "fas", name: "ellipsis", label: "More", variant: "plain" }));
        $(Assert.equal(
            btn.unwrap().unwrap("IconButton").style.unwrap("some").variant.unwrap("some").hasTag("plain"),
            true,
        ));
    });

    // =========================================================================
    // Color palette + size
    // =========================================================================

    test("creates icon button with colorPalette", $ => {
        const btn = $.let(IconButton.Root({ prefix: "fas", name: "heart", label: "Favourite", colorPalette: "danger" }));
        $(Assert.equal(
            btn.unwrap().unwrap("IconButton").style.unwrap("some").colorPalette.unwrap("some").hasTag("danger"),
            true,
        ));
    });

    test("creates icon button with size xs", $ => {
        const btn = $.let(IconButton.Root({ prefix: "fas", name: "gear", label: "Settings", size: "xs" }));
        $(Assert.equal(
            btn.unwrap().unwrap("IconButton").style.unwrap("some").size.unwrap("some").hasTag("xs"),
            true,
        ));
    });

    // =========================================================================
    // State on main (not inside style)
    // =========================================================================

    test("creates loading icon button", $ => {
        const btn = $.let(IconButton.Root({ prefix: "fas", name: "rotate", label: "Refresh", loading: true }));
        $(Assert.equal(btn.unwrap().unwrap("IconButton").loading.unwrap("some"), true));
    });

    test("creates disabled icon button", $ => {
        const btn = $.let(IconButton.Root({ prefix: "fas", name: "save", label: "Save", disabled: true }));
        $(Assert.equal(btn.unwrap().unwrap("IconButton").disabled.unwrap("some"), true));
    });

    test("creates icon button with loadingIcon on main", $ => {
        const btn = $.let(IconButton.Root({ prefix: "fas", name: "rotate", label: "Refresh",
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
        const btn = $.let(IconButton.Root({ prefix: "fas", name: "rocket", label: "Deploy",
            color: "fg.inverse",
            background: "bg.inverse",
            borderColor: "border.brand",
            hoverBackground: "bg.inverse",
        }));
        const s = btn.unwrap().unwrap("IconButton").style.unwrap("some");
        $(Assert.equal(s.color.unwrap("some"), "fg.inverse"));
        $(Assert.equal(s.background.unwrap("some"), "bg.inverse"));
        $(Assert.equal(s.borderColor.unwrap("some"), "border.brand"));
        $(Assert.equal(s.hoverBackground.unwrap("some"), "bg.inverse"));
    });

    // =========================================================================
    // Combined — kitchen sink
    // =========================================================================

    test("creates fully-configured icon button", $ => {
        const btn = $.let(IconButton.Root({ prefix: "fas", name: "check", label: "Confirm",
            loading: false,
            disabled: false,
            variant: "solid",
            colorPalette: "success",
            size: "md",
            color: "fg.inverse",
        }));
        const b = btn.unwrap().unwrap("IconButton");
        $(Assert.equal(b.label, "Confirm"));
        $(Assert.equal(b.loading.unwrap("some"), false));
        $(Assert.equal(b.disabled.unwrap("some"), false));
        const s = b.style.unwrap("some");
        $(Assert.equal(s.variant.unwrap("some").hasTag("solid"), true));
        $(Assert.equal(s.colorPalette.unwrap("some").hasTag("success"), true));
        $(Assert.equal(s.size.unwrap("some").hasTag("md"), true));
        $(Assert.equal(s.color.unwrap("some"), "fg.inverse"));
    });
}, { platformFns: TestImpl });
