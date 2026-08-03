/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Sticky, Text } from "@elaraai/east-ui/internal";
import * as ex from "./sticky.examples.js";

describeEast("Sticky", (test) => {
    Assert.examples(test, {
        stickyHeader: ex.stickyHeader,
        stickySubnav: ex.stickySubnav,
    });

    // =========================================================================
    // Basic creation
    // =========================================================================

    test("creates a sticky region with bare content (defaults)", $ => {
        const sticky = $.let(Sticky.Root(Text.Root("Stuck")));

        $(Assert.equal(sticky.unwrap().unwrap("Sticky").offset.hasTag("none"), true));
        $(Assert.equal(sticky.unwrap().unwrap("Sticky").boundary.hasTag("none"), true));
        $(Assert.equal(sticky.unwrap().unwrap("Sticky").style.hasTag("none"), true));
    });

    // =========================================================================
    // Offset
    // =========================================================================

    test("creates a sticky region with offset", $ => {
        const sticky = $.let(Sticky.Root(Text.Root("Header"), { offset: "12px" }));

        $(Assert.equal(sticky.unwrap().unwrap("Sticky").offset.hasTag("some"), true));
        $(Assert.equal(sticky.unwrap().unwrap("Sticky").offset.unwrap("some"), "12px"));
    });

    // =========================================================================
    // Boundary
    // =========================================================================

    test("creates a sticky region with parent boundary", $ => {
        const sticky = $.let(Sticky.Root(Text.Root("Header"), { boundary: "parent" }));

        $(Assert.equal(sticky.unwrap().unwrap("Sticky").boundary.hasTag("some"), true));
        $(Assert.equal(sticky.unwrap().unwrap("Sticky").boundary.unwrap("some").hasTag("parent"), true));
    });

    test("creates a sticky region with viewport boundary", $ => {
        const sticky = $.let(Sticky.Root(Text.Root("Header"), { boundary: "viewport" }));

        $(Assert.equal(sticky.unwrap().unwrap("Sticky").boundary.unwrap("some").hasTag("viewport"), true));
    });

    // =========================================================================
    // Style escape hatches
    // =========================================================================

    test("creates a sticky region with all style hatches", $ => {
        const sticky = $.let(Sticky.Root(Text.Root("Header"), {
            offset: "0",
            boundary: "parent",
            background: "bg.surface",
            borderColor: "border.subtle",
            shadowColor: "shadows.raised",
        }));

        $(Assert.equal(sticky.unwrap().unwrap("Sticky").style.hasTag("some"), true));
        $(Assert.equal(sticky.unwrap().unwrap("Sticky").style.unwrap("some").background.unwrap("some"), "bg.surface"));
        $(Assert.equal(sticky.unwrap().unwrap("Sticky").style.unwrap("some").borderColor.unwrap("some"), "border.subtle"));
        $(Assert.equal(sticky.unwrap().unwrap("Sticky").style.unwrap("some").shadowColor.unwrap("some"), "shadows.raised"));
    });
}, { platformFns: TestImpl });
