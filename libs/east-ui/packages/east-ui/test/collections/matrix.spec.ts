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
        matrixBrushSelection: ex.matrixBrushSelection,
    });

    // =========================================================================
    // Matrix.Root - Basic Creation
    // =========================================================================

    test("creates matrix with rows and columns", $ => {
        const m = $.let(Matrix.Root(
            [{ key: "alice", cells: [{ columnKey: "mon", segments: [{ category: "booked", value: 1.0 }] }] }],
            [{ key: "mon" }],
        ), UIComponentType);

        $(Assert.equal(m.unwrap().unwrap("Matrix").rows.size(), 1n));
        $(Assert.equal(m.unwrap().unwrap("Matrix").columns.size(), 1n));
    });

    test("creates matrix with rich headers", $ => {
        const m = $.let(Matrix.Root(
            [{ key: "alice", header: Text.Root("Alice"), cells: [{ columnKey: "mon", segments: [] }] }],
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
            [{ key: "alice", cells: [{ columnKey: "mon", segments: [
                { category: "booked", value: 0.6 },
                { category: "free", value: 0.4 },
            ] }] }],
            [{ key: "mon" }],
        ), UIComponentType);

        $(Assert.equal(m.unwrap().unwrap("Matrix").rows.get(0n).cells.get(0n).segments.size(), 2n));
    });

    // =========================================================================
    // Matrix.Root - Overlays
    // =========================================================================

    test("creates cell with overlays at multiple positions", $ => {
        const m = $.let(Matrix.Root(
            [{ key: "alice", cells: [{
                columnKey: "mon",
                segments: [],
                overlays: [
                    { kind: "icon", position: "tr", content: Text.Root("!") },
                    { kind: "text", position: "bl", content: Text.Root("4h") },
                ],
            }] }],
            [{ key: "mon" }],
        ), UIComponentType);

        $(Assert.equal(m.unwrap().unwrap("Matrix").rows.get(0n).cells.get(0n).overlays.size(), 2n));
    });

    // =========================================================================
    // Matrix.Root - Legend
    // =========================================================================

    test("creates matrix with legend entries", $ => {
        const m = $.let(Matrix.Root(
            [{ key: "alice", cells: [] }],
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

    // =========================================================================
    // Matrix.Root - Style
    // =========================================================================

    test("creates matrix with size preset", $ => {
        const m = $.let(Matrix.Root(
            [{ key: "alice", cells: [] }],
            [{ key: "mon" }],
            { size: "lg" },
        ), UIComponentType);

        $(Assert.equal(m.unwrap().unwrap("Matrix").style.unwrap("some").size.unwrap("some").hasTag("lg"), true));
    });

    test("creates matrix with colour overrides", $ => {
        const m = $.let(Matrix.Root(
            [{ key: "alice", cells: [] }],
            [{ key: "mon" }],
            {
                gridColor: "blue.200",
                headerBackground: "blue.50",
                headerColor: "blue.900",
                cellBackground: "white",
            },
        ), UIComponentType);

        const style = m.unwrap().unwrap("Matrix").style.unwrap("some");
        $(Assert.equal(style.gridColor.unwrap("some"), "blue.200"));
        $(Assert.equal(style.headerBackground.unwrap("some"), "blue.50"));
        $(Assert.equal(style.headerColor.unwrap("some"), "blue.900"));
        $(Assert.equal(style.cellBackground.unwrap("some"), "white"));
    });

}, { platformFns: TestImpl });
