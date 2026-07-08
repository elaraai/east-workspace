/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BooleanType, NullType } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Expandable, Box, Text } from "@elaraai/east-ui/internal";
import * as ex from "./expandable.examples.js";

describeEast("Expandable", (test) => {
    Assert.examples(test, {
        expandableRegion: ex.expandableRegion,
        expandableControlled: ex.expandableControlled,
    });

    // =========================================================================
    // Basic creation
    // =========================================================================

    test("creates an expandable region with bare content (defaults)", $ => {
        const region = $.let(Expandable.Root(Text.Root("Region")));

        $(Assert.equal(region.unwrap().unwrap("Expandable").expanded.hasTag("none"), true));
        $(Assert.equal(region.unwrap().unwrap("Expandable").onExpandedChange.hasTag("none"), true));
        $(Assert.equal(region.unwrap().unwrap("Expandable").label.hasTag("none"), true));
        $(Assert.equal(region.unwrap().unwrap("Expandable").style.hasTag("none"), true));
    });

    // =========================================================================
    // Expanded state
    // =========================================================================

    test("creates an expandable region with an initial expanded state", $ => {
        const region = $.let(Expandable.Root(Text.Root("Region"), { expanded: true }));

        $(Assert.equal(region.unwrap().unwrap("Expandable").expanded.hasTag("some"), true));
        $(Assert.equal(region.unwrap().unwrap("Expandable").expanded.unwrap("some"), true));
    });

    test("creates an expandable region with an onExpandedChange callback", $ => {
        const onExpandedChange = $.const(East.function([BooleanType], NullType, (_$, _next) => null));
        const region = $.let(Expandable.Root(Text.Root("Region"), { onExpandedChange }));

        $(Assert.equal(region.unwrap().unwrap("Expandable").onExpandedChange.hasTag("some"), true));
    });

    // =========================================================================
    // Label
    // =========================================================================

    test("creates an expandable region with an accessible label", $ => {
        const region = $.let(Expandable.Root(Box.Root([Text.Root("Chart")]), { label: "Schedule" }));

        $(Assert.equal(region.unwrap().unwrap("Expandable").label.hasTag("some"), true));
        $(Assert.equal(region.unwrap().unwrap("Expandable").label.unwrap("some"), "Schedule"));
    });

    // =========================================================================
    // Style escape hatches
    // =========================================================================

    test("creates an expandable region with zIndex and background style", $ => {
        const region = $.let(Expandable.Root(Text.Root("Region"), {
            zIndex: 1100n,
            background: "bg.surface",
        }));

        $(Assert.equal(region.unwrap().unwrap("Expandable").style.hasTag("some"), true));
        $(Assert.equal(region.unwrap().unwrap("Expandable").style.unwrap("some").zIndex.unwrap("some"), 1100n));
        $(Assert.equal(region.unwrap().unwrap("Expandable").style.unwrap("some").background.unwrap("some"), "bg.surface"));
    });
}, { platformFns: TestImpl });
