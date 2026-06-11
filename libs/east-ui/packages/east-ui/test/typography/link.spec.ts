/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Link } from "@elaraai/east-ui/internal";
import * as ex from "./link.examples.js";

describeEast("Link", (test) => {
    Assert.examples(test, {
        linkBasic: ex.linkBasic,
        linkExternal: ex.linkExternal,
        linkUnderline: ex.linkUnderline,
        linkPlain: ex.linkPlain,
        linkColors: ex.linkColors,
        linkInContext: ex.linkInContext,
        linkCombined: ex.linkCombined,
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
        const link = $.let(Link.Root("Colored", { href: "/page", colorPalette: "blue" }));
        const style = link.unwrap().unwrap("Link").style.unwrap("some");
        $(Assert.equal(style.colorPalette.hasTag("some"), true));
        $(Assert.equal(style.colorPalette.unwrap("some"), "blue"));
    });

    test("creates link with teal colorPalette", $ => {
        const link = $.let(Link.Root("Teal", { href: "/page", colorPalette: "teal" }));
        const style = link.unwrap().unwrap("Link").style.unwrap("some");
        $(Assert.equal(style.colorPalette.unwrap("some"), "teal"));
    });

    // =========================================================================
    // Colour escape hatches (inside style)
    // =========================================================================

    test("creates link with explicit color / hoverColor / visitedColor", $ => {
        const link = $.let(Link.Root("Branded", {
            href: "/page",
            color: "#7a3b2e",
            hoverColor: "#552417",
            visitedColor: "#3d1a11",
        }));
        const style = link.unwrap().unwrap("Link").style.unwrap("some");
        $(Assert.equal(style.color.unwrap("some"), "#7a3b2e"));
        $(Assert.equal(style.hoverColor.unwrap("some"), "#552417"));
        $(Assert.equal(style.visitedColor.unwrap("some"), "#3d1a11"));
    });

    // =========================================================================
    // Combined Options
    // =========================================================================

    test("creates link with all options", $ => {
        const link = $.let(Link.Root("Documentation", {
            href: "https://docs.example.com",
            external: true,
            variant: "underline",
            colorPalette: "blue",
        }));
        const style = link.unwrap().unwrap("Link").style.unwrap("some");

        $(Assert.equal(link.unwrap().unwrap("Link").value, "Documentation"));
        $(Assert.equal(link.unwrap().unwrap("Link").href, "https://docs.example.com"));
        $(Assert.equal(link.unwrap().unwrap("Link").external.unwrap("some"), true));
        $(Assert.equal(style.variant.unwrap("some").hasTag("underline"), true));
        $(Assert.equal(style.colorPalette.unwrap("some"), "blue"));
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
