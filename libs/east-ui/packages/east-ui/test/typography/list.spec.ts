/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { List, Text } from "@elaraai/east-ui/internal";
import * as ex from "./list.examples.js";

describeEast("List", (test) => {
    Assert.examples(test, {
        listUnordered: ex.listUnordered,
        listOrdered: ex.listOrdered,
        listWithGap: ex.listWithGap,
        listColored: ex.listColored,
        listGreen: ex.listGreen,
        listFeatures: ex.listFeatures,
        listSteps: ex.listSteps,
        listEmpty: ex.listEmpty,
        listCheckmarks: ex.listCheckmarks,
        listDashed: ex.listDashed,
        listRichItems: ex.listRichItems,
    });

    // =========================================================================
    // Basic Creation — { items, style } container shape
    // =========================================================================

    test("creates list with string items (coerced to Text.Root)", $ => {
        const list = $.let(List.Root(["Item 1", "Item 2", "Item 3"]));

        $(Assert.equal(list.unwrap().unwrap("List").items.size(), 3n));
        // Each coerced item is a Text variant.
        $(Assert.equal(list.unwrap().unwrap("List").items.get(0n).unwrap().unwrap("Text").value, "Item 1"));
    });

    test("creates list with no style — style is none", $ => {
        const list = $.let(List.Root(["Item"]));

        $(Assert.equal(list.unwrap().unwrap("List").items.size(), 1n));
        $(Assert.equal(list.unwrap().unwrap("List").style.hasTag("none"), true));
    });

    test("creates list with rich UIComp items (pass-through)", $ => {
        const list = $.let(List.Root([
            Text.Root("A", { fontWeight: "bold" }),
            Text.Root("B"),
        ]));

        $(Assert.equal(list.unwrap().unwrap("List").items.size(), 2n));
        $(Assert.equal(
            list.unwrap().unwrap("List").items.get(0n).unwrap().unwrap("Text").style.unwrap("some").fontWeight.unwrap("some").hasTag("bold"),
            true,
        ));
    });

    // =========================================================================
    // Variants (inside style)
    // =========================================================================

    test("creates unordered list", $ => {
        const list = $.let(List.Root(["A", "B"], { variant: "unordered" }));
        const style = list.unwrap().unwrap("List").style.unwrap("some");
        $(Assert.equal(style.variant.unwrap("some").hasTag("unordered"), true));
    });

    test("creates ordered list", $ => {
        const list = $.let(List.Root(["First", "Second"], { variant: "ordered" }));
        const style = list.unwrap().unwrap("List").style.unwrap("some");
        $(Assert.equal(style.variant.unwrap("some").hasTag("ordered"), true));
    });

    // =========================================================================
    // Marker (inside style) — disc / circle / square / decimal / none / check / dash
    // =========================================================================

    test("creates list with check markers", $ => {
        const list = $.let(List.Root(["OK", "Clear"], { marker: "check" }));
        const style = list.unwrap().unwrap("List").style.unwrap("some");
        $(Assert.equal(style.marker.unwrap("some").hasTag("check"), true));
    });

    test("creates list with dash markers", $ => {
        const list = $.let(List.Root(["Issue"], { marker: "dash" }));
        const style = list.unwrap().unwrap("List").style.unwrap("some");
        $(Assert.equal(style.marker.unwrap("some").hasTag("dash"), true));
    });

    test("creates list with disc marker", $ => {
        const list = $.let(List.Root(["A"], { marker: "disc" }));
        const style = list.unwrap().unwrap("List").style.unwrap("some");
        $(Assert.equal(style.marker.unwrap("some").hasTag("disc"), true));
    });

    test("creates list with no marker", $ => {
        const list = $.let(List.Root(["A"], { marker: "none" }));
        const style = list.unwrap().unwrap("List").style.unwrap("some");
        $(Assert.equal(style.marker.unwrap("some").hasTag("none"), true));
    });

    // =========================================================================
    // Gap (inside style)
    // =========================================================================

    test("creates list with gap", $ => {
        const list = $.let(List.Root(["A", "B"], { gap: "4" }));
        const style = list.unwrap().unwrap("List").style.unwrap("some");
        $(Assert.equal(style.gap.unwrap("some"), "4"));
    });

    test("creates list with large gap", $ => {
        const list = $.let(List.Root(["A", "B"], { gap: "8" }));
        const style = list.unwrap().unwrap("List").style.unwrap("some");
        $(Assert.equal(style.gap.unwrap("some"), "8"));
    });

    // =========================================================================
    // Color Palette + markerColor (inside style)
    // =========================================================================

    test("creates list with colorPalette", $ => {
        const list = $.let(List.Root(["A", "B"], { colorPalette: "blue" }));
        const style = list.unwrap().unwrap("List").style.unwrap("some");
        $(Assert.equal(style.colorPalette.unwrap("some"), "blue"));
    });

    test("creates list with green colorPalette", $ => {
        const list = $.let(List.Root(["A", "B"], { colorPalette: "green" }));
        const style = list.unwrap().unwrap("List").style.unwrap("some");
        $(Assert.equal(style.colorPalette.unwrap("some"), "green"));
    });

    test("creates list with explicit markerColor + color", $ => {
        const list = $.let(List.Root(["OK"], {
            marker: "check",
            markerColor: "fg.success",
            color: "fg.default",
        }));
        const style = list.unwrap().unwrap("List").style.unwrap("some");
        $(Assert.equal(style.markerColor.unwrap("some"), "fg.success"));
        $(Assert.equal(style.color.unwrap("some"), "fg.default"));
    });

    // =========================================================================
    // Combined Options
    // =========================================================================

    test("creates list with all options", $ => {
        const list = $.let(List.Root(
            ["Step 1", "Step 2", "Step 3"],
            { variant: "ordered", gap: "2", colorPalette: "gray" },
        ));
        const style = list.unwrap().unwrap("List").style.unwrap("some");

        $(Assert.equal(style.variant.unwrap("some").hasTag("ordered"), true));
        $(Assert.equal(style.gap.unwrap("some"), "2"));
        $(Assert.equal(style.colorPalette.unwrap("some"), "gray"));
    });

    test("creates feature list", $ => {
        const list = $.let(List.Root([
            "Fast performance",
            "Type safe",
            "Easy to use",
        ], {
            variant: "unordered",
            gap: "3",
            colorPalette: "green",
        }));
        const style = list.unwrap().unwrap("List").style.unwrap("some");

        $(Assert.equal(style.variant.unwrap("some").hasTag("unordered"), true));
        $(Assert.equal(style.gap.unwrap("some"), "3"));
        $(Assert.equal(style.colorPalette.unwrap("some"), "green"));
    });

    test("creates empty list", $ => {
        const list = $.let(List.Root([]));

        $(Assert.equal(list.unwrap().unwrap("List").items.size(), 0n));
        $(Assert.equal(list.unwrap().unwrap("List").style.hasTag("none"), true));
    });

    test("creates numbered steps list", $ => {
        const list = $.let(List.Root([
            "Install dependencies",
            "Configure settings",
            "Run the application",
        ], { variant: "ordered" }));
        const style = list.unwrap().unwrap("List").style.unwrap("some");

        $(Assert.equal(style.variant.unwrap("some").hasTag("ordered"), true));
    });

    test("creates bullet point list", $ => {
        const list = $.let(List.Root([
            "Point one",
            "Point two",
            "Point three",
        ], { variant: "unordered", colorPalette: "gray" }));
        const style = list.unwrap().unwrap("List").style.unwrap("some");

        $(Assert.equal(style.variant.unwrap("some").hasTag("unordered"), true));
        $(Assert.equal(style.colorPalette.unwrap("some"), "gray"));
    });
}, { platformFns: TestImpl });
