/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { type ExprType } from "@elaraai/east";
import { Badge, Style, UIComponentType } from "@elaraai/east-ui/internal";
import * as ex from "./badge.examples.js";

describeEast("Badge", (test) => {
    Assert.examples(test, {
        badgeBasic: ex.badgeBasic,
        badgeStyles: ex.badgeStyles,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#462).
    // The mono-uppercase Text captions are the stable per-mini anchors.
    // =========================================================================

    test("badgeStyles drives its preview from inline option tables", $ => {
        // Everything the configurator needs — the variant / density / colour /
        // border / opacity / padding tables — is declared inside the example
        // body, because the documentation capture only extracts `fn`. That puts
        // the tables inside the Reactive body, which TestImpl does not execute,
        // so they cannot be asserted from here; `Assert.examples` above still
        // compiles and evaluates the outer function. The per-variant coverage
        // lives in the Badge.Root tests below, which construct each variant
        // directly.
        const panel = $.const(ex.badgeStyles.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });

    // =========================================================================
    // Basic Creation
    // =========================================================================

    test("creates badge with string value", $ => {
        const badge = $.let(Badge.Root("New"));

        $(Assert.equal(badge.unwrap().unwrap("Badge").value, "New"));
        $(Assert.equal(badge.unwrap().unwrap("Badge").style.hasTag("none"), true));
    });

    test("creates badge with expression value", $ => {
        const badge = $.let(Badge.Root("Active"));

        $(Assert.equal(badge.unwrap().unwrap("Badge").value, "Active"));
    });

    test("creates badge with number text", $ => {
        const badge = $.let(Badge.Root("42"));

        $(Assert.equal(badge.unwrap().unwrap("Badge").value, "42"));
    });

    // =========================================================================
    // Variants
    // =========================================================================

    test("creates solid variant badge", $ => {
        const badge = $.let(Badge.Root("Sold", {
            variant: "solid",
        }));

        $(Assert.equal(badge.unwrap().unwrap("Badge").style.unwrap("some").variant.hasTag("some"), true));
        $(Assert.equal(badge.unwrap().unwrap("Badge").style.unwrap("some").variant.unwrap("some").hasTag("solid"), true));
    });

    test("creates subtle variant badge", $ => {
        const badge = $.let(Badge.Root("Pending", {
            variant: "subtle",
        }));

        $(Assert.equal(badge.unwrap().unwrap("Badge").style.unwrap("some").variant.unwrap("some").hasTag("subtle"), true));
    });

    test("creates outline variant badge", $ => {
        const badge = $.let(Badge.Root("Draft", {
            variant: "outline",
        }));

        $(Assert.equal(badge.unwrap().unwrap("Badge").style.unwrap("some").variant.unwrap("some").hasTag("outline"), true));
    });

    test("creates badge with Style.StyleVariant helper", $ => {
        const badge = $.let(Badge.Root("Featured", {
            variant: Style.StyleVariant("solid"),
        }));

        $(Assert.equal(badge.unwrap().unwrap("Badge").style.unwrap("some").variant.unwrap("some").hasTag("solid"), true));
    });

    // =========================================================================
    // Color Palettes
    // =========================================================================

    test("creates badge with success color palette", $ => {
        const badge = $.let(Badge.Root("Active", {
            colorPalette: "success",
        }));

        $(Assert.equal(badge.unwrap().unwrap("Badge").style.unwrap("some").colorPalette.hasTag("some"), true));
        $(Assert.equal(badge.unwrap().unwrap("Badge").style.unwrap("some").colorPalette.unwrap("some").hasTag("success"), true));
    });

    test("creates badge with danger color palette", $ => {
        const badge = $.let(Badge.Root("Sold", {
            colorPalette: "danger",
        }));

        $(Assert.equal(badge.unwrap().unwrap("Badge").style.unwrap("some").colorPalette.unwrap("some").hasTag("danger"), true));
    });

    test("creates badge with brand color palette", $ => {
        const badge = $.let(Badge.Root("Featured", {
            colorPalette: "brand",
        }));

        $(Assert.equal(badge.unwrap().unwrap("Badge").style.unwrap("some").colorPalette.unwrap("some").hasTag("brand"), true));
    });

    test("creates badge with Style.ColorScheme helper", $ => {
        const badge = $.let(Badge.Root("Premium", {
            colorPalette: Style.ColorScheme("brand"),
        }));

        $(Assert.equal(badge.unwrap().unwrap("Badge").style.unwrap("some").colorPalette.unwrap("some").hasTag("brand"), true));
    });

    // =========================================================================
    // Size
    // =========================================================================

    test("creates extra small badge", $ => {
        const badge = $.let(Badge.Root("XS", {
            size: "xs",
        }));

        $(Assert.equal(badge.unwrap().unwrap("Badge").style.unwrap("some").size.hasTag("some"), true));
        $(Assert.equal(badge.unwrap().unwrap("Badge").style.unwrap("some").size.unwrap("some").hasTag("xs"), true));
    });

    test("creates small badge", $ => {
        const badge = $.let(Badge.Root("SM", {
            size: "sm",
        }));

        $(Assert.equal(badge.unwrap().unwrap("Badge").style.unwrap("some").size.unwrap("some").hasTag("sm"), true));
    });

    test("creates medium badge", $ => {
        const badge = $.let(Badge.Root("MD", {
            size: "md",
        }));

        $(Assert.equal(badge.unwrap().unwrap("Badge").style.unwrap("some").size.unwrap("some").hasTag("md"), true));
    });

    test("creates large badge", $ => {
        const badge = $.let(Badge.Root("LG", {
            size: "lg",
        }));

        $(Assert.equal(badge.unwrap().unwrap("Badge").style.unwrap("some").size.unwrap("some").hasTag("lg"), true));
    });

    test("creates badge with Style.Size helper", $ => {
        const badge = $.let(Badge.Root("Size", {
            size: Style.Size("md"),
        }));

        $(Assert.equal(badge.unwrap().unwrap("Badge").style.unwrap("some").size.unwrap("some").hasTag("md"), true));
    });

    // =========================================================================
    // Combined Options
    // =========================================================================

    test("creates badge with all options", $ => {
        const badge = $.let(Badge.Root("Active", {
            variant: "solid",
            colorPalette: "success",
            size: "sm",
        }));

        $(Assert.equal(badge.unwrap().unwrap("Badge").value, "Active"));
        $(Assert.equal(badge.unwrap().unwrap("Badge").style.unwrap("some").variant.unwrap("some").hasTag("solid"), true));
        $(Assert.equal(badge.unwrap().unwrap("Badge").style.unwrap("some").colorPalette.unwrap("some").hasTag("success"), true));
        $(Assert.equal(badge.unwrap().unwrap("Badge").style.unwrap("some").size.unwrap("some").hasTag("sm"), true));
    });

    test("creates status badge", $ => {
        const badge = $.let(Badge.Root("Online", {
            colorPalette: "success",
            variant: "solid",
        }));

        $(Assert.equal(badge.unwrap().unwrap("Badge").value, "Online"));
        $(Assert.equal(badge.unwrap().unwrap("Badge").style.unwrap("some").colorPalette.unwrap("some").hasTag("success"), true));
    });

    test("creates notification count badge", $ => {
        const badge = $.let(Badge.Root("99+", {
            colorPalette: "danger",
            variant: "solid",
            size: "xs",
        }));

        $(Assert.equal(badge.unwrap().unwrap("Badge").value, "99+"));
        $(Assert.equal(badge.unwrap().unwrap("Badge").style.unwrap("some").colorPalette.unwrap("some").hasTag("danger"), true));
    });

    test("creates category tag badge", $ => {
        const badge = $.let(Badge.Root("Technology", {
            colorPalette: "brand",
            variant: "subtle",
            size: "sm",
        }));

        $(Assert.equal(badge.unwrap().unwrap("Badge").value, "Technology"));
        $(Assert.equal(badge.unwrap().unwrap("Badge").style.unwrap("some").variant.unwrap("some").hasTag("subtle"), true));
    });

    test("creates premium label badge", $ => {
        const badge = $.let(Badge.Root("PRO", {
            colorPalette: "brand",
            variant: "outline",
        }));

        $(Assert.equal(badge.unwrap().unwrap("Badge").value, "PRO"));
        $(Assert.equal(badge.unwrap().unwrap("Badge").style.unwrap("some").variant.unwrap("some").hasTag("outline"), true));
    });
}, {   platformFns: TestImpl,});
