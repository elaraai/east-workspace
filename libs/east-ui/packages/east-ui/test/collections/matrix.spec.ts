/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, test as hostTest } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, DictType, East, EastTypeType, FloatType, NullType, RecursiveType, StringType, StructType, toEastTypeValue, type ExprType,
} from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Matrix } from "@elaraai/east-ui/internal";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./matrix.examples.js";

// East TYPE VALUES — the form the arm-equality test compares them in.
const MATRIX_ARM = toEastTypeValue(UIComponentType.node.cases.Matrix);
const MATRIX_ROOT = toEastTypeValue(Matrix.Types.Root);

/** A tree row (#955): a name, its bookings, and its own rows. */
const Node = RecursiveType((self) => StructType({
    name: StringType,
    booked: DictType(StringType, FloatType),
    rows: ArrayType(self),
}));

/** Two top-level rows: `a` holds `a1` (which holds `a1x`) and `a2`; `b` is a leaf. */
const TREE = [
    { name: "a", booked: new Map([["mon", 0.5]]), rows: [
        { name: "a1", booked: new Map([["mon", 0.4]]), rows: [
            { name: "a1x", booked: new Map([["mon", 0.3]]), rows: [] },
        ] },
        { name: "a2", booked: new Map([["mon", 0.2]]), rows: [] },
    ] },
    { name: "b", booked: new Map([["mon", 0.1]]), rows: [] },
];

describeEast("Matrix", (test) => {
    Assert.examples(test, {
        matrixHeatGrid: ex.matrixHeatGrid,
        matrixVariants: ex.matrixVariants,
        matrixAdjust: ex.matrixAdjust,
        matrixPivot: ex.matrixPivot,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#461).
    // The mono-uppercase Text captions are the stable per-mini anchors.
    // =========================================================================

    test("matrixVariants drives its preview from inline option tables", $ => {
        // Everything the configurator needs — the cell-preset and orientation
        // tables — is declared inside the example body, because the
        // documentation capture only extracts `fn`. That puts the tables
        // inside the Reactive body, which TestImpl does not execute, so they
        // cannot be asserted from here; `Assert.examples` above still
        // compiles and evaluates the outer function. The per-option coverage
        // lives in the Matrix.Root tests below, which construct each option
        // directly.
        const panel = $.const(ex.matrixVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
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
    // #955 — rows nest to any depth; the wire is the rows in pre-order
    // =========================================================================

    test("a tree flattens to its rows in pre-order — a parent, then its subtree — each with its depth and its own cells (#955)", $ => {
        const tree = $.const(TREE, ArrayType(Node));
        const m = $.let(Matrix.Root(tree, {
            columns: [Matrix.column({ key: "mon" })],
            // A recursive row reaches every accessor as its node.
            rowKey: r => r.name,
            tree: { children: (r) => r.rows },
            cell: (r, col) => Matrix.cell({ segments: [Matrix.segment({ fill: "brand", weight: r.booked.get(col.key) })] }),
        }));
        const rows = $.let(m.unwrap().unwrap("Matrix").rows);
        $(Assert.equal(rows.map((_$, r) => r.key), ["a", "a1", "a1x", "a2", "b"]));
        $(Assert.equal(rows.map((_$, r) => r.depth), [0n, 1n, 2n, 1n, 0n]));
        $(Assert.equal(rows.map((_$, r) => r.collapsed), [false, false, false, false, false]));
        // A parent draws its own cells, from the same builder.
        $(Assert.equal(rows.get(0n).cells.get("mon").segments.get(0n).weight, 0.5));
        $(Assert.equal(rows.get(1n).cells.get("mon").segments.get(0n).weight, 0.4));
    });

    test("`collapsed` closes the parents it names — every one for `true` — and never a leaf (#955)", $ => {
        const tree = $.const(TREE, ArrayType(Node));
        const byRow = $.let(Matrix.Root(tree, {
            columns: [Matrix.column({ key: "mon" })],
            rowKey: r => r.name,
            cell: (r, col) => Matrix.cell({ segments: [Matrix.segment({ fill: "brand", weight: r.booked.get(col.key) })] }),
            tree: { children: (r) => r.rows, collapsed: (r) => r.name.startsWith("a") },
        }));
        // `a1x` and `a2` start with "a" too, but they are leaves.
        $(Assert.equal(byRow.unwrap().unwrap("Matrix").rows.map((_$, r) => r.collapsed), [true, true, false, false, false]));
        const all = $.let(Matrix.Root(tree, {
            columns: [Matrix.column({ key: "mon" })],
            rowKey: r => r.name,
            cell: (r, col) => Matrix.cell({ segments: [Matrix.segment({ fill: "brand", weight: r.booked.get(col.key) })] }),
            tree: { children: (r) => r.rows, collapsed: true },
        }));
        $(Assert.equal(all.unwrap().unwrap("Matrix").rows.map((_$, r) => r.collapsed), [true, true, false, false, false]));
    });

    test("a flat matrix's rows are all at depth 0, uncollapsed, in data order (#955)", $ => {
        const m = $.let(Matrix.Root(
            [{ name: "x", booked: new Map([["mon", 0.5]]) }, { name: "y", booked: new Map([["mon", 0.6]]) }],
            {
                columns: [Matrix.column({ key: "mon" })],
                rowKey: r => r.name,
                cell: (r, col) => Matrix.cell({ segments: [Matrix.segment({ fill: "brand", weight: r.booked.get(col.key) })] }),
            },
        ));
        const rows = $.let(m.unwrap().unwrap("Matrix").rows);
        $(Assert.equal(rows.map((_$, r) => r.key), ["x", "y"]));
        $(Assert.equal(rows.map((_$, r) => r.depth), [0n, 0n]));
        $(Assert.equal(rows.map((_$, r) => r.collapsed), [false, false]));
    });

    test("matrixHeatGrid: people nest under their teams, each team a row with its own bars (#955)", $ => {
        const grid = $.const(ex.matrixHeatGrid.fn() as ExprType<UIComponentType>);
        const rows = $.let(grid.unwrap().unwrap("Matrix").rows);
        $(Assert.equal(rows.map((_$, r) => r.key), ["Web", "Alice", "Bob", "Batch", "Carol"]));
        $(Assert.equal(rows.map((_$, r) => r.depth), [0n, 1n, 1n, 0n, 1n]));
        $(Assert.equal(rows.get(0n).cells.size(), 5n));
    });

    test("the component.ts Matrix arm and MatrixRootType are one East type (#955)", $ => {
        // `component.ts` spells the arm inline, because a cell's slot and
        // popover need the recursion `node`; `MatrixRootType` names the same
        // shape at the resolved `UIComponentType`, and the renderer decodes the
        // arm's values through that name. A field only one of them has would
        // reach the other side silently. This is the check that notices.
        const arm = $.const(MATRIX_ARM, EastTypeType);
        const root = $.const(MATRIX_ROOT, EastTypeType);
        const armFields = $.let(arm.unwrap().unwrap("Struct"));
        const rootFields = $.let(root.unwrap().unwrap("Struct"));
        $(Assert.equal(armFields.map((_$, f) => f.name), rootFields.map((_$, f) => f.name)));
        $(Assert.equal(
            rootFields.filter((_$, f, i) => East.equal(f.type, armFields.get(i).type).not()).map((_$, f) => f.name),
            [],
        ));
    });

    // =========================================================================
    // Callbacks
    // =========================================================================

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

describe("Matrix tree refusals (#955)", () => {
    hostTest("a `tree.children` that returns anything but more of the matrix's rows is refused at build, naming them", () => {
        const Row = StructType({ name: StringType, tags: ArrayType(StringType), booked: DictType(StringType, FloatType) });
        const rows = East.value([{ name: "x", tags: ["t"], booked: new Map([["mon", 0.5]]) }], ArrayType(Row));
        assert.throws(
            () => Matrix.Root(rows, {
                columns: [Matrix.column({ key: "mon" })],
                rowKey: r => r.name,
                tree: { children: (r) => r.tags },
                cell: (r, col) => Matrix.cell({ segments: [Matrix.segment({ fill: "brand", weight: r.booked.get(col.key) })] }),
            }),
            /`tree\.children` returns a row's child rows — more of the matrix's own rows/,
        );
    });
});
