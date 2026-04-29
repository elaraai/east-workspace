/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Matrix, Text, UIComponentType } from "@elaraai/east-ui";
import * as ex from "./matrix.examples.js";

describeEast("Matrix", (test) => {
    Assert.examples(test, {
        matrixBasic: ex.matrixBasic,
        matrixMultiSegment: ex.matrixMultiSegment,
        matrixWithOverlays: ex.matrixWithOverlays,
        matrixEmphasis: ex.matrixEmphasis,
        matrixVerticalOrientation: ex.matrixVerticalOrientation,
        matrixBrushSelection: ex.matrixBrushSelection,
        matrixReactiveClick: ex.matrixReactiveClick,
        matrixReactiveSegmentEdit: ex.matrixReactiveSegmentEdit,
        matrixReactiveSegmentEditMulti: ex.matrixReactiveSegmentEditMulti,
        matrixReactiveSegmentEditVertical: ex.matrixReactiveSegmentEditVertical,
        matrixCellPopover: ex.matrixCellPopover,
        matrixMinLabelSize: ex.matrixMinLabelSize,
    });

    // =========================================================================
    // Matrix.Root - Basic Creation
    // =========================================================================

    test("creates matrix with dict-keyed cells", $ => {
        const m = $.let(Matrix.Root(
            [{ key: "alice", cells: { mon: { segments: [{ category: "booked", weight: 1.0 }] } } }],
            [{ key: "mon" }],
        ), UIComponentType);

        $(Assert.equal(m.unwrap().unwrap("Matrix").rows.size(), 1n));
        $(Assert.equal(m.unwrap().unwrap("Matrix").columns.size(), 1n));
    });

    test("creates matrix with rich headers", $ => {
        const m = $.let(Matrix.Root(
            [{ key: "alice", header: Text.Root("Alice"), cells: {} }],
            [{ key: "mon", header: Text.Root("Monday") }],
        ), UIComponentType);

        $(Assert.equal(m.unwrap().unwrap("Matrix").rows.get(0n).header.hasTag("some"), true));
        $(Assert.equal(m.unwrap().unwrap("Matrix").columns.get(0n).header.hasTag("some"), true));
    });

    // =========================================================================
    // Matrix.Root - Segments
    // =========================================================================

    test("creates cell with multi-segment fill", $ => {
        const m = $.let(Matrix.Root(
            [{ key: "alice", cells: {
                mon: { segments: [
                    { category: "booked", weight: 0.6 },
                    { category: "free", weight: 0.4 },
                ] },
            } }],
            [{ key: "mon" }],
        ), UIComponentType);

        $(Assert.equal(m.unwrap().unwrap("Matrix").rows.get(0n).cells.get("mon").segments.size(), 2n));
    });

    test("segment resize constraints are preserved", $ => {
        const m = $.let(Matrix.Root(
            [{ key: "alice", cells: {
                mon: { segments: [{ category: "booked", weight: 0.5, min: 0.1, max: 0.9, step: 0.05 }] },
            } }],
            [{ key: "mon" }],
        ), UIComponentType);

        const seg = m.unwrap().unwrap("Matrix").rows.get(0n).cells.get("mon").segments.get(0n);
        $(Assert.equal(seg.min.unwrap("some"), 0.1));
        $(Assert.equal(seg.max.unwrap("some"), 0.9));
        $(Assert.equal(seg.step.unwrap("some"), 0.05));
    });

    // =========================================================================
    // Matrix.Root - Overlays (no kind field)
    // =========================================================================

    test("creates cell with overlays at multiple positions", $ => {
        const m = $.let(Matrix.Root(
            [{ key: "alice", cells: {
                mon: {
                    segments: [],
                    overlays: [
                        { align: "end", verticalAlign: "start", content: Text.Root("!") },
                        { align: "start", verticalAlign: "end", content: Text.Root("4h") },
                    ],
                },
            } }],
            [{ key: "mon" }],
        ), UIComponentType);

        $(Assert.equal(m.unwrap().unwrap("Matrix").rows.get(0n).cells.get("mon").overlays.size(), 2n));
    });

    // =========================================================================
    // Matrix.Root - Emphasis (via emphasisColor presence)
    // =========================================================================

    test("emphasis expressed via emphasisColor presence", $ => {
        const m = $.let(Matrix.Root(
            [{ key: "alice", cells: {
                mon: { segments: [], emphasisColor: "red.500" },
                tue: { segments: [] },
            } }],
            [{ key: "mon" }, { key: "tue" }],
        ), UIComponentType);

        $(Assert.equal(m.unwrap().unwrap("Matrix").rows.get(0n).cells.get("mon").emphasisColor.hasTag("some"), true));
        $(Assert.equal(m.unwrap().unwrap("Matrix").rows.get(0n).cells.get("tue").emphasisColor.hasTag("none"), true));
    });

    // =========================================================================
    // Matrix.Root - Note (rich UIComponent tooltip content)
    // =========================================================================

    test("note is a UIComponent for rich tooltip content", $ => {
        const m = $.let(Matrix.Root(
            [{ key: "alice", cells: {
                mon: { segments: [], tooltip: Text.Root("Conflict with Bob's schedule") },
            } }],
            [{ key: "mon" }],
        ), UIComponentType);

        $(Assert.equal(m.unwrap().unwrap("Matrix").rows.get(0n).cells.get("mon").tooltip.hasTag("some"), true));
    });

    // =========================================================================
    // Matrix.Root - Legend + auto-colour
    // =========================================================================

    test("legend entries carry explicit colours", $ => {
        const m = $.let(Matrix.Root(
            [{ key: "alice", cells: {} }],
            [{ key: "mon" }],
            {
                legend: [
                    { category: "booked", color: "blue.400", label: "Booked" },
                    { category: "free", color: "gray.200", label: "Free" },
                ],
            },
        ), UIComponentType);

        $(Assert.equal(m.unwrap().unwrap("Matrix").legend.unwrap("some").size(), 2n));
    });

    test("legend auto-derives colour from matching segment when omitted", $ => {
        const m = $.let(Matrix.Root(
            [{ key: "alice", cells: {
                mon: { segments: [{ category: "booked", weight: 1.0, color: "blue.400" }] },
            } }],
            [{ key: "mon" }],
            {
                legend: [
                    { category: "booked", label: "Booked" },
                ],
            },
        ), UIComponentType);

        $(Assert.equal(m.unwrap().unwrap("Matrix").legend.unwrap("some").get(0n).color, "blue.400"));
    });

    // =========================================================================
    // Matrix.Root - Style
    // =========================================================================

    test("cellBorderRadius and cellOrientation applied via style", $ => {
        const m = $.let(Matrix.Root(
            [{ key: "alice", cells: {} }],
            [{ key: "mon" }],
            { cellBorderRadius: "4px", cellOrientation: "vertical" },
        ), UIComponentType);

        const style = m.unwrap().unwrap("Matrix").style.unwrap("some");
        $(Assert.equal(style.cellBorderRadius.unwrap("some"), "4px"));
        $(Assert.equal(style.cellOrientation.unwrap("some").hasTag("vertical"), true));
    });

    test("colour overrides applied via style", $ => {
        const m = $.let(Matrix.Root(
            [{ key: "alice", cells: {} }],
            [{ key: "mon" }],
            {
                gridColor: "blue.200",
                headerBackground: "blue.50",
                headerColor: "blue.900",
                cellBackground: "white",
                emphasisColor: "red.500",
                selectedBackground: "blue.100",
                selectedBorderColor: "blue.500",
                hoverHighlightColor: "blue.50",
            },
        ), UIComponentType);

        const style = m.unwrap().unwrap("Matrix").style.unwrap("some");
        $(Assert.equal(style.gridColor.unwrap("some"), "blue.200"));
        $(Assert.equal(style.emphasisColor.unwrap("some"), "red.500"));
        $(Assert.equal(style.selectedBackground.unwrap("some"), "blue.100"));
        $(Assert.equal(style.hoverHighlightColor.unwrap("some"), "blue.50"));
    });

    // =========================================================================
    // Plan 1.10 J — popover + minLabelSize coverage
    // =========================================================================

    test("cell with popover slot round-trips as some(UIComp)", $ => {
        const m = $.let(Matrix.Root(
            [{ key: "r1", header: Text.Root("R1"), cells: {
                c1: {
                    segments: [{ category: "a", weight: 1.0 }],
                    popover: Text.Root("clicked"),
                },
            } }],
            [{ key: "c1", header: Text.Root("C1") }],
        ));
        const cell = $.let(m.unwrap().unwrap("Matrix").rows.get(0n).cells.get("c1"));
        $(Assert.equal(cell.popover.hasTag("some"), true));
        $(Assert.equal(cell.popover.unwrap("some").unwrap().hasTag("Text"), true));
    });

    test("cell without popover is none", $ => {
        const m = $.let(Matrix.Root(
            [{ key: "r1", header: Text.Root("R1"), cells: {
                c1: { segments: [{ category: "a", weight: 1.0 }] },
            } }],
            [{ key: "c1", header: Text.Root("C1") }],
        ));
        const cell = $.let(m.unwrap().unwrap("Matrix").rows.get(0n).cells.get("c1"));
        $(Assert.equal(cell.popover.hasTag("none"), true));
    });

    test("style.minLabelSize round-trips", $ => {
        const m = $.let(Matrix.Root(
            [{ key: "r1", header: Text.Root("R1"), cells: { c1: { segments: [] } } }],
            [{ key: "c1", header: Text.Root("C1") }],
            { minLabelSize: "32px" },
        ));
        const style = $.let(m.unwrap().unwrap("Matrix").style.unwrap("some"));
        $(Assert.equal(style.minLabelSize.unwrap("some"), "32px"));
    });

}, { platformFns: TestImpl });
