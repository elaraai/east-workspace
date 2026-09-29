/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The SnapGrid's rows and spans (#989): rows by their first appearance among the
 * cells, cells in their order; a span held to the grid, and the one it takes
 * at a medium width. Geometry is measured in the showcase probe.
 */

import { expect, test } from "vitest";
import { none, variant } from "@elaraai/east";
import { snapGridRows, snapGridSpans, type SnapGridCellValue } from "./index.js";

test("rows take the order their keys first appear in, and each keeps its cells' order", () => {
    const content = variant("Text", {});
    const top = variant("top", null);
    const cells = [
        { key: "a", row: "top", span: 6n, height: none, align: top, frame: true, content },
        { key: "b", row: "bottom", span: 6n, height: none, align: top, frame: true, content },
        { key: "c", row: "top", span: 6n, height: none, align: top, frame: true, content },
        { key: "d", row: "middle", span: 6n, height: none, align: top, frame: true, content },
    ] as unknown as SnapGridCellValue[];
    const rows = snapGridRows(cells);
    expect(rows.map(r => r.key)).toEqual(["top", "bottom", "middle"]);
    expect(rows.map(r => r.cells.map(c => c.key))).toEqual([["a", "c"], ["b"], ["d"]]);
});

test("a span is held to the grid's 1–12, and at a medium width a span under 6 takes 6 and any other 12", () => {
    expect(snapGridSpans(4n)).toEqual({ span: 4, medium: 6 });
    expect(snapGridSpans(5n)).toEqual({ span: 5, medium: 6 });
    expect(snapGridSpans(6n)).toEqual({ span: 6, medium: 12 });
    expect(snapGridSpans(8n)).toEqual({ span: 8, medium: 12 });
    expect(snapGridSpans(0n)).toEqual({ span: 1, medium: 6 });
    expect(snapGridSpans(20n)).toEqual({ span: 12, medium: 12 });
});
