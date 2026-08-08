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
        alignedStackLibraryDnd: ex.alignedStackLibraryDnd,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row
    // (#460 → epic #455). The mono-uppercase Text captions are the stable
    // per-mini anchors.
    // =========================================================================

    test("alignedStackAll panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.alignedStackAll.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 26n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "STACK ALL"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "STACK CHARTS"));
        $(Assert.equal(rows.get(4n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "STACK CHART TRACE"));
        $(Assert.equal(rows.get(6n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "STACK CHART CALENDAR"));
        $(Assert.equal(rows.get(8n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "STACK CHART MATRIX"));
        $(Assert.equal(rows.get(10n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "STACK CHART TABLE"));
        $(Assert.equal(rows.get(12n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "STACK CHART PLANNER"));
        $(Assert.equal(rows.get(14n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "STACK CHART GANTT"));
        $(Assert.equal(rows.get(16n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "STACK ALL COMPACT"));
        $(Assert.equal(rows.get(18n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "STACK ALL CONDENSED"));
        $(Assert.equal(rows.get(20n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "STACK CHART TITLES"));
        $(Assert.equal(rows.get(22n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "STACK DATE AXIS"));
        $(Assert.equal(rows.get(24n).unwrap().unwrap("Separator").label.unwrap("some").unwrap().unwrap("Text").value, "STACK AUTO"));
    });
}, { platformFns: TestImpl });
