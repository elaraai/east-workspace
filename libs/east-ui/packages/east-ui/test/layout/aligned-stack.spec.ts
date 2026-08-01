/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { type ExprType } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./aligned-stack.examples.js";

describeEast("AlignedStack", (test) => {
    // Compiling each example validates the AlignedStack IR — the `gutter`
    // (fixed{left,right} / auto) + children encode + round-trip as valid East IR.
    Assert.examples(test, {
        alignedStackAll: ex.alignedStackAll,
        alignedStackPairs: ex.alignedStackPairs,
        alignedStackDensity: ex.alignedStackDensity,
        alignedStackAxis: ex.alignedStackAxis,
        alignedStackLibraryDnd: ex.alignedStackLibraryDnd,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#460).
    // The mono-uppercase Text captions are the stable per-mini anchors.
    // =========================================================================

    test("alignedStackPairs panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.alignedStackPairs.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 7n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "STACK CHARTS"));
        $(Assert.equal(rows.get(1n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "STACK CHART TRACE"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "STACK CHART CALENDAR"));
        $(Assert.equal(rows.get(3n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "STACK CHART MATRIX"));
        $(Assert.equal(rows.get(4n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "STACK CHART TABLE"));
        $(Assert.equal(rows.get(5n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "STACK CHART PLANNER"));
        $(Assert.equal(rows.get(6n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "STACK CHART GANTT"));
    });

    test("alignedStackDensity panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.alignedStackDensity.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 2n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "STACK ALL COMPACT"));
        $(Assert.equal(rows.get(1n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "STACK ALL CONDENSED"));
    });

    test("alignedStackAxis panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.alignedStackAxis.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 3n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "STACK CHART TITLES"));
        $(Assert.equal(rows.get(1n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "STACK DATE AXIS"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "STACK AUTO"));
    });
}, { platformFns: TestImpl });
