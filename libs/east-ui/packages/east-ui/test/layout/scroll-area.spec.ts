/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { ScrollArea, Text } from "@elaraai/east-ui";
import * as ex from "./scroll-area.examples.js";

describeEast("ScrollArea", (test) => {
    Assert.examples(test, {
        scrollAreaDriverList: ex.scrollAreaDriverList,
        scrollAreaTableInDrawer: ex.scrollAreaTableInDrawer,
    });

    // =========================================================================
    // Basic creation
    // =========================================================================

    test("creates a scroll area with bare content (defaults)", $ => {
        const sa = $.let(ScrollArea.Root(Text.Root("Content")));

        $(Assert.equal(sa.unwrap().unwrap("ScrollArea").scrollbarStyle.hasTag("none"), true));
        $(Assert.equal(sa.unwrap().unwrap("ScrollArea").style.hasTag("none"), true));
    });

    // =========================================================================
    // Orientation
    // =========================================================================

    test("creates a scroll area with vertical orientation", $ => {
        const sa = $.let(ScrollArea.Root(Text.Root("Content"), { orientation: "vertical" }));
        const sv = sa.unwrap().unwrap("ScrollArea").style.unwrap("some");
        $(Assert.equal(sv.orientation.unwrap("some").hasTag("vertical"), true));
    });

    test("creates a scroll area with horizontal orientation", $ => {
        const sa = $.let(ScrollArea.Root(Text.Root("Content"), { orientation: "horizontal" }));
        const sv = sa.unwrap().unwrap("ScrollArea").style.unwrap("some");
        $(Assert.equal(sv.orientation.unwrap("some").hasTag("horizontal"), true));
    });

    test("creates a scroll area with both orientation", $ => {
        const sa = $.let(ScrollArea.Root(Text.Root("Content"), { orientation: "both" }));
        const sv = sa.unwrap().unwrap("ScrollArea").style.unwrap("some");
        $(Assert.equal(sv.orientation.unwrap("some").hasTag("both"), true));
    });

    // =========================================================================
    // Scrollbar style
    // =========================================================================

    test("creates a scroll area with overlay scrollbar style", $ => {
        const sa = $.let(ScrollArea.Root(Text.Root("Content"), { scrollbarStyle: "overlay" }));

        $(Assert.equal(sa.unwrap().unwrap("ScrollArea").scrollbarStyle.unwrap("some").hasTag("overlay"), true));
    });

    test("creates a scroll area with reserved scrollbar style", $ => {
        const sa = $.let(ScrollArea.Root(Text.Root("Content"), { scrollbarStyle: "reserved" }));

        $(Assert.equal(sa.unwrap().unwrap("ScrollArea").scrollbarStyle.unwrap("some").hasTag("reserved"), true));
    });

    // =========================================================================
    // Style escape hatches
    // =========================================================================

    test("creates a scroll area with all style hatches", $ => {
        const sa = $.let(ScrollArea.Root(Text.Root("Content"), {
            thumbColor: "gray.400",
            trackColor: "gray.100",
            background: "white",
        }));

        $(Assert.equal(sa.unwrap().unwrap("ScrollArea").style.hasTag("some"), true));
        $(Assert.equal(sa.unwrap().unwrap("ScrollArea").style.unwrap("some").thumbColor.unwrap("some"), "gray.400"));
        $(Assert.equal(sa.unwrap().unwrap("ScrollArea").style.unwrap("some").trackColor.unwrap("some"), "gray.100"));
        $(Assert.equal(sa.unwrap().unwrap("ScrollArea").style.unwrap("some").background.unwrap("some"), "white"));
    });
}, { platformFns: TestImpl });
