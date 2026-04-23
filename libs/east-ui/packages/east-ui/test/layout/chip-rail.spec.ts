/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { ChipRail, Tag } from "@elaraai/east-ui";
import * as ex from "./chip-rail.examples.js";

describeEast("ChipRail", (test) => {
    Assert.examples(test, {
        chipRailBasic: ex.chipRailBasic,
        chipRailDots: ex.chipRailDots,
        chipRailOverflow: ex.chipRailOverflow,
    });

    // =========================================================================
    // Basic creation
    // =========================================================================

    test("creates a chip rail with an empty chip list (defaults)", $ => {
        const rail = $.let(ChipRail.Root([]));

        $(Assert.equal(rail.unwrap().unwrap("ChipRail").density.hasTag("none"), true));
        $(Assert.equal(rail.unwrap().unwrap("ChipRail").separator.hasTag("none"), true));
        $(Assert.equal(rail.unwrap().unwrap("ChipRail").overflow.hasTag("none"), true));
        $(Assert.equal(rail.unwrap().unwrap("ChipRail").style.hasTag("none"), true));
    });

    test("creates a chip rail holding Tag children", $ => {
        const rail = $.let(ChipRail.Root([
            Tag.Root("A"),
            Tag.Root("B"),
            Tag.Root("C"),
        ]));

        $(Assert.equal(rail.unwrap().unwrap("ChipRail").chips.size(), 3n));
    });

    // =========================================================================
    // Density
    // =========================================================================

    test("creates a chip rail with comfortable density", $ => {
        const rail = $.let(ChipRail.Root([Tag.Root("A")], { density: "comfortable" }));

        $(Assert.equal(rail.unwrap().unwrap("ChipRail").density.unwrap("some").hasTag("comfortable"), true));
    });

    test("creates a chip rail with compact density", $ => {
        const rail = $.let(ChipRail.Root([Tag.Root("A")], { density: "compact" }));

        $(Assert.equal(rail.unwrap().unwrap("ChipRail").density.unwrap("some").hasTag("compact"), true));
    });

    test("creates a chip rail with condensed density", $ => {
        const rail = $.let(ChipRail.Root([Tag.Root("A")], { density: "condensed" }));

        $(Assert.equal(rail.unwrap().unwrap("ChipRail").density.unwrap("some").hasTag("condensed"), true));
    });

    // =========================================================================
    // Separator
    // =========================================================================

    test("creates a chip rail with line separator", $ => {
        const rail = $.let(ChipRail.Root([Tag.Root("A")], { separator: "line" }));

        $(Assert.equal(rail.unwrap().unwrap("ChipRail").separator.unwrap("some").hasTag("line"), true));
    });

    test("creates a chip rail with dot separator", $ => {
        const rail = $.let(ChipRail.Root([Tag.Root("A")], { separator: "dot" }));

        $(Assert.equal(rail.unwrap().unwrap("ChipRail").separator.unwrap("some").hasTag("dot"), true));
    });

    test("creates a chip rail with no separator", $ => {
        const rail = $.let(ChipRail.Root([Tag.Root("A")], { separator: "none" }));

        $(Assert.equal(rail.unwrap().unwrap("ChipRail").separator.unwrap("some").hasTag("none"), true));
    });

    // =========================================================================
    // Overflow
    // =========================================================================

    test("creates a chip rail with wrap overflow", $ => {
        const rail = $.let(ChipRail.Root([Tag.Root("A")], { overflow: "wrap" }));

        $(Assert.equal(rail.unwrap().unwrap("ChipRail").overflow.unwrap("some").hasTag("wrap"), true));
    });

    test("creates a chip rail with scroll overflow", $ => {
        const rail = $.let(ChipRail.Root([Tag.Root("A")], { overflow: "scroll" }));

        $(Assert.equal(rail.unwrap().unwrap("ChipRail").overflow.unwrap("some").hasTag("scroll"), true));
    });

    // =========================================================================
    // Style escape hatches
    // =========================================================================

    test("creates a chip rail with all style hatches", $ => {
        const rail = $.let(ChipRail.Root([Tag.Root("A")], {
            style: {
                background: "gray.50",
                separatorColor: "gray.200",
                overflowTriggerColor: "gray.600",
            },
        }));

        $(Assert.equal(rail.unwrap().unwrap("ChipRail").style.hasTag("some"), true));
        $(Assert.equal(rail.unwrap().unwrap("ChipRail").style.unwrap("some").background.unwrap("some"), "gray.50"));
        $(Assert.equal(rail.unwrap().unwrap("ChipRail").style.unwrap("some").separatorColor.unwrap("some"), "gray.200"));
        $(Assert.equal(rail.unwrap().unwrap("ChipRail").style.unwrap("some").overflowTriggerColor.unwrap("some"), "gray.600"));
    });
}, { platformFns: TestImpl });
