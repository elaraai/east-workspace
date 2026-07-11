/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, NullType } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Matrix } from "@elaraai/east-ui/internal";
import * as ex from "./matrix.examples.js";

describeEast("Matrix", (test) => {
    Assert.examples(test, {
        matrixHeatGrid: ex.matrixHeatGrid,
        matrixSegments: ex.matrixSegments,
        matrixVertical: ex.matrixVertical,
        matrixMarkers: ex.matrixMarkers,
        matrixPopover: ex.matrixPopover,
        matrixReactiveAdjust: ex.matrixReactiveAdjust,
        matrixBounded: ex.matrixBounded,
        matrixFill: ex.matrixFill,
    });

    // =========================================================================
    // Root: rows × columns
    // =========================================================================

    test("Root builds the Matrix variant with rows, columns, and default orientation", $ => {
        const m = $.let(Matrix.Root(
            [{ name: "Alice", booked: new Map([["mon", 0.7]]) }],
            {
                columns: [Matrix.column({ key: "mon", label: "Mon" })],
                rowKey: r => r.name,
                cell: (r, col) => Matrix.cell({ segments: [Matrix.segment({ fill: "brand", weight: r.booked.get(col.key) })] }),
            },
        ));
        const root = $.let(m.unwrap().unwrap("Matrix"));
        $(Assert.equal(root.rows.length(), 1n));
        $(Assert.equal(root.columns.length(), 1n));
        $(Assert.equal(root.columns.get(0n).key, "mon"));
        $(Assert.equal(root.orientation.hasTag("horizontal"), true));
        $(Assert.equal(root.rows.get(0n).key, "Alice"));
    });

    test("rowHeader sets the corner header; rowValue/rowSublabel fill the row header", $ => {
        const m = $.let(Matrix.Root(
            [{ name: "Alice", role: "PM", booked: new Map([["mon", 0.5]]) }],
            {
                columns: [Matrix.column({ key: "mon" })],
                rowKey: r => r.name,
                rowHeader: "Resource",
                rowValue: r => r.name,
                rowSublabel: r => r.role,
                cell: (r, col) => Matrix.cell({ segments: [Matrix.segment({ fill: "brand", weight: r.booked.get(col.key) })] }),
            },
        ));
        const root = $.let(m.unwrap().unwrap("Matrix"));
        $(Assert.equal(root.rowHeader.unwrap("some"), "Resource"));
        $(Assert.equal(root.rows.get(0n).value, "Alice"));
        $(Assert.equal(root.rows.get(0n).sublabel.unwrap("some"), "PM"));
    });

    test("value defaults to the row key when rowValue is omitted", $ => {
        const m = $.let(Matrix.Root(
            [{ name: "Alice", booked: new Map([["mon", 0.5]]) }],
            {
                columns: [Matrix.column({ key: "mon" })],
                rowKey: r => r.name,
                cell: (r, col) => Matrix.cell({ segments: [Matrix.segment({ fill: "brand", weight: r.booked.get(col.key) })] }),
            },
        ));
        const row = $.let(m.unwrap().unwrap("Matrix").rows.get(0n));
        $(Assert.equal(row.value, "Alice"));
        $(Assert.equal(row.sublabel.hasTag("none"), true));
    });

    test("vertical orientation is carried on the root", $ => {
        const m = $.let(Matrix.Root(
            [{ name: "A", booked: new Map([["mon", 0.5]]) }],
            {
                columns: [Matrix.column({ key: "mon" })],
                rowKey: r => r.name,
                orientation: "vertical",
                cell: (r, col) => Matrix.cell({ segments: [Matrix.segment({ fill: "brand", weight: r.booked.get(col.key) })] }),
            },
        ));
        $(Assert.equal(m.unwrap().unwrap("Matrix").orientation.hasTag("vertical"), true));
    });

    // =========================================================================
    // Segments + fills (the planner-marker-shaped builder)
    // =========================================================================

    test("a segment carries its fill + weight; the fill string shorthand resolves", $ => {
        const seg = $.let(Matrix.segment({ fill: "warning", weight: 30.0 }));
        $(Assert.equal(seg.fill.hasTag("warning"), true));
        $(Assert.equal(seg.weight, 30.0));
        $(Assert.equal(seg.label.hasTag("none"), true));
    });

    test("a cell holds its segments, and markers default to empty", $ => {
        const cell = $.let(Matrix.cell({ segments: [
            Matrix.segment({ fill: "brand", weight: 0.7 }),
            Matrix.segment({ fill: "free", weight: 0.3 }),
        ] }));
        $(Assert.equal(cell.segments.length(), 2n));
        $(Assert.equal(cell.segments.get(0n).fill.hasTag("brand"), true));
        $(Assert.equal(cell.segments.get(1n).fill.hasTag("free"), true));
        $(Assert.equal(cell.markers.length(), 0n));
    });

    // =========================================================================
    // Markers (the Matrix analogue of Planner.marker)
    // =========================================================================

    test("a marker carries its status + message; corner and label default", $ => {
        const mk = $.let(Matrix.marker({ status: "danger", message: "Over capacity" }));
        $(Assert.equal(mk.at.hasTag("tr"), true));
        $(Assert.equal(mk.status.hasTag("danger"), true));
        $(Assert.equal(mk.message, "Over capacity"));
        $(Assert.equal(mk.label.hasTag("none"), true));
    });

    // =========================================================================
    // groupBy + callbacks
    // =========================================================================

    test("groupBy fills the per-row group label", $ => {
        const m = $.let(Matrix.Root(
            [{ name: "Alice", team: "Web", booked: new Map([["mon", 0.5]]) }],
            {
                columns: [Matrix.column({ key: "mon" })],
                rowKey: r => r.name,
                groupBy: r => r.team,
                cell: (r, col) => Matrix.cell({ segments: [Matrix.segment({ fill: "brand", weight: r.booked.get(col.key) })] }),
            },
        ));
        $(Assert.equal(m.unwrap().unwrap("Matrix").rows.get(0n).group.unwrap("some"), "Web"));
    });

    test("onSegmentChange presence is preserved on the root", $ => {
        const m = $.let(Matrix.Root(
            [{ name: "A", booked: new Map([["mon", 0.5]]) }],
            {
                columns: [Matrix.column({ key: "mon" })],
                rowKey: r => r.name,
                cell: (r, col) => Matrix.cell({ segments: [Matrix.segment({ fill: "brand", weight: r.booked.get(col.key) })] }),
                onSegmentChange: East.function([Matrix.Types.SegmentChangeEvent], NullType, _$ => null),
            },
        ));
        $(Assert.equal(m.unwrap().unwrap("Matrix").onSegmentChange.hasTag("some"), true));
    });

    test("legend entries carry fill + label", $ => {
        const m = $.let(Matrix.Root(
            [{ name: "A", booked: new Map([["mon", 0.5]]) }],
            {
                columns: [Matrix.column({ key: "mon" })],
                rowKey: r => r.name,
                cell: (r, col) => Matrix.cell({ segments: [Matrix.segment({ fill: "brand", weight: r.booked.get(col.key) })] }),
                legend: [{ fill: "brand", label: "Booked" }],
            },
        ));
        const legend = $.let(m.unwrap().unwrap("Matrix").legend.unwrap("some"));
        $(Assert.equal(legend.get(0n).fill.hasTag("brand"), true));
        $(Assert.equal(legend.get(0n).label, "Booked"));
    });
}, { platformFns: TestImpl });
