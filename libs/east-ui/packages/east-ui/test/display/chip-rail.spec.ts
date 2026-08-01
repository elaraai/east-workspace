/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { type ExprType } from "@elaraai/east";
import { ChipRail, Tag, UIComponentType } from "@elaraai/east-ui/internal";
import * as ex from "./chip-rail.examples.js";

describeEast("ChipRail", (test) => {
    Assert.examples(test, {
        chipRailBasic: ex.chipRailBasic,
        chipRailOverflow: ex.chipRailOverflow,
        chipRailVariants: ex.chipRailVariants,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#462).
    // The mono-uppercase Text captions are the stable per-mini anchors.
    // =========================================================================

    test("chipRailVariants panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.chipRailVariants.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 4n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "RAIL MIXED"));
        $(Assert.equal(rows.get(1n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "RAIL DOTS"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "RAIL LABELED"));
        $(Assert.equal(rows.get(3n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "RAIL DENSITIES"));
    });

    // =========================================================================
    // Basic creation
    // =========================================================================

    test("creates a chip rail with an empty chip list (defaults)", $ => {
        const rail = $.let(ChipRail.Root([]));

        $(Assert.equal(rail.unwrap().unwrap("ChipRail").density.hasTag("none"), true));
        $(Assert.equal(rail.unwrap().unwrap("ChipRail").separator.hasTag("none"), true));
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
    // Labels (labeled mode)
    // =========================================================================

    test("creates a chip rail with no labels by default", $ => {
        const rail = $.let(ChipRail.Root([Tag.Root("A")]));

        $(Assert.equal(rail.unwrap().unwrap("ChipRail").labels.hasTag("none"), true));
    });

    test("creates a labeled chip rail carrying per-chip captions", $ => {
        const rail = $.let(ChipRail.Root([Tag.Root("A"), Tag.Root("B")], {
            labels: ["Week", "Region"],
        }));
        const labels = $.let(rail.unwrap().unwrap("ChipRail").labels.unwrap("some"));

        $(Assert.equal(labels.size(), 2n));
        $(Assert.equal(labels.get(0n), "Week"));
        $(Assert.equal(labels.get(1n), "Region"));
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
        const sv = rail.unwrap().unwrap("ChipRail").style.unwrap("some");
        $(Assert.equal(sv.overflow.unwrap("some").hasTag("wrap"), true));
    });

    test("creates a chip rail with scroll overflow", $ => {
        const rail = $.let(ChipRail.Root([Tag.Root("A")], { overflow: "scroll" }));
        const sv = rail.unwrap().unwrap("ChipRail").style.unwrap("some");
        $(Assert.equal(sv.overflow.unwrap("some").hasTag("scroll"), true));
    });

    // =========================================================================
    // Style escape hatches
    // =========================================================================

    test("creates a chip rail with all style hatches", $ => {
        const rail = $.let(ChipRail.Root([Tag.Root("A")], {
            background: "gray.50",
            separatorColor: "gray.200",
            overflowTriggerColor: "gray.600",
        }));

        $(Assert.equal(rail.unwrap().unwrap("ChipRail").style.hasTag("some"), true));
        $(Assert.equal(rail.unwrap().unwrap("ChipRail").style.unwrap("some").background.unwrap("some"), "gray.50"));
        $(Assert.equal(rail.unwrap().unwrap("ChipRail").style.unwrap("some").separatorColor.unwrap("some"), "gray.200"));
        $(Assert.equal(rail.unwrap().unwrap("ChipRail").style.unwrap("some").overflowTriggerColor.unwrap("some"), "gray.600"));
    });
}, { platformFns: TestImpl });
