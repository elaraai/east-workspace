/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { type ExprType } from "@elaraai/east";
import { Link } from "@elaraai/east-ui/internal";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./link.examples.js";

describeEast("Link", (test) => {
    Assert.examples(test, {
        linkBasic: ex.linkBasic,
        linkVariants: ex.linkVariants,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#459).
    // The mono-uppercase Text captions are the stable per-mini anchors.
    // =========================================================================

    test("linkVariants drives its preview from inline option tables", $ => {
        // Everything the configurator needs — the variant / palette tables and
        // the external / in-context switches — is declared inside the example
        // body, because the documentation capture only extracts `fn`. That puts
        // the tables inside the Reactive body, which TestImpl does not execute,
        // so they cannot be asserted from here; `Assert.examples` above still
        // compiles and evaluates the outer function. The per-variant coverage
        // lives in the Link.Root tests below, which construct each variant
        // directly.
        const panel = $.const(ex.linkVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });

    // =========================================================================
    // Basic Creation — { value, href, external?, style } shape
    // =========================================================================

    test("creates link with value and href", $ => {
        const link = $.let(Link.Root("Click here", { href: "https://example.com" }));

        $(Assert.equal(link.unwrap().unwrap("Link").value, "Click here"));
        $(Assert.equal(link.unwrap().unwrap("Link").href, "https://example.com"));
    });

    test("creates link with no style — style is none", $ => {
        const link = $.let(Link.Root("Link", { href: "/about" }));

        $(Assert.equal(link.unwrap().unwrap("Link").value, "Link"));
        $(Assert.equal(link.unwrap().unwrap("Link").href, "/about"));
        $(Assert.equal(link.unwrap().unwrap("Link").external.hasTag("none"), true));
        $(Assert.equal(link.unwrap().unwrap("Link").style.hasTag("none"), true));
    });

    // =========================================================================
    // External (main — state)
    // =========================================================================

    test("creates external link", $ => {
        const link = $.let(Link.Root("External", {
            href: "https://google.com",
            external: true,
        }));

        $(Assert.equal(link.unwrap().unwrap("Link").external.hasTag("some"), true));
        $(Assert.equal(link.unwrap().unwrap("Link").external.unwrap("some"), true));
    });

    test("creates non-external link", $ => {
        const link = $.let(Link.Root("Internal", {
            href: "/home",
            external: false,
        }));

        $(Assert.equal(link.unwrap().unwrap("Link").external.unwrap("some"), false));
    });

    // =========================================================================
    // Variants (inside style)
    // =========================================================================

    test("creates underline variant link", $ => {
        const link = $.let(Link.Root("Underlined", { href: "/page", variant: "underline" }));
        const style = link.unwrap().unwrap("Link").style.unwrap("some");
        $(Assert.equal(style.variant.hasTag("some"), true));
        $(Assert.equal(style.variant.unwrap("some").hasTag("underline"), true));
    });

    test("creates plain variant link", $ => {
        const link = $.let(Link.Root("Plain", { href: "/page", variant: "plain" }));
        const style = link.unwrap().unwrap("Link").style.unwrap("some");
        $(Assert.equal(style.variant.unwrap("some").hasTag("plain"), true));
    });

    // =========================================================================
    // Color Palette (inside style)
    // =========================================================================

    test("creates link with colorPalette", $ => {
        const link = $.let(Link.Root("Colored", { href: "/page", colorPalette: "brand" }));
        const style = link.unwrap().unwrap("Link").style.unwrap("some");
        $(Assert.equal(style.colorPalette.hasTag("some"), true));
        $(Assert.equal(style.colorPalette.unwrap("some"), "brand"));
    });

    test("creates link with brand colorPalette", $ => {
        const link = $.let(Link.Root("Teal", { href: "/page", colorPalette: "brand" }));
        const style = link.unwrap().unwrap("Link").style.unwrap("some");
        $(Assert.equal(style.colorPalette.unwrap("some"), "brand"));
    });

    // =========================================================================
    // Colour escape hatches (inside style)
    // =========================================================================

    test("creates link with explicit color / hoverColor / visitedColor", $ => {
        const link = $.let(Link.Root("Branded", {
            href: "/page",
            color: "fg.danger",
            hoverColor: "link.hover",
            visitedColor: "fg.muted",
        }));
        const style = link.unwrap().unwrap("Link").style.unwrap("some");
        $(Assert.equal(style.color.unwrap("some"), "fg.danger"));
        $(Assert.equal(style.hoverColor.unwrap("some"), "link.hover"));
        $(Assert.equal(style.visitedColor.unwrap("some"), "fg.muted"));
    });

    // =========================================================================
    // Combined Options
    // =========================================================================

    test("creates link with all options", $ => {
        const link = $.let(Link.Root("Documentation", {
            href: "https://docs.example.com",
            external: true,
            variant: "underline",
            colorPalette: "brand",
        }));
        const style = link.unwrap().unwrap("Link").style.unwrap("some");

        $(Assert.equal(link.unwrap().unwrap("Link").value, "Documentation"));
        $(Assert.equal(link.unwrap().unwrap("Link").href, "https://docs.example.com"));
        $(Assert.equal(link.unwrap().unwrap("Link").external.unwrap("some"), true));
        $(Assert.equal(style.variant.unwrap("some").hasTag("underline"), true));
        $(Assert.equal(style.colorPalette.unwrap("some"), "brand"));
    });

    test("creates navigation link", $ => {
        const link = $.let(Link.Root("Home", { href: "/", variant: "plain" }));
        const style = link.unwrap().unwrap("Link").style.unwrap("some");

        $(Assert.equal(link.unwrap().unwrap("Link").value, "Home"));
        $(Assert.equal(link.unwrap().unwrap("Link").href, "/"));
        $(Assert.equal(style.variant.unwrap("some").hasTag("plain"), true));
    });

    test("creates social link", $ => {
        const link = $.let(Link.Root("GitHub", {
            href: "https://github.com",
            external: true,
            colorPalette: "gray",
        }));

        $(Assert.equal(link.unwrap().unwrap("Link").value, "GitHub"));
        $(Assert.equal(link.unwrap().unwrap("Link").external.unwrap("some"), true));
    });
}, { platformFns: TestImpl });
