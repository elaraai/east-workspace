/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * An unloaded run's rows (#1398, CL2): only where the run meets the view, at
 * the collection's pitch, one per visible row whatever the run's size — a
 * flat run's, and a grouped run's bands and lines.
 */

import { describe, expect, test } from "vitest";
import { barShare, runRows, runView } from "./run-rows.js";

describe("an unloaded run's rows (CL2)", () => {
    test("a run of 16,000 rows at 36px draws only the rows in a 700px view", () => {
        const run = { height: 16_000 * 36, pitch: 36 };
        // The view 300,000px down the run.
        const rows = runRows(run, { top: 300_000, bottom: 300_700 });
        // Rows 8,333 (at 299,988px) to 8,352 (to 300,708px): the twenty the view meets.
        expect(rows.length).toBe(20);
        expect(rows[0]).toEqual({ index: 8333, element: 8333, band: false, line: -1, top: 8333 * 36, height: 36 });
        // Each row at the pitch, one after another.
        rows.forEach((row, i) => expect(row.top).toBe((8333 + i) * 36));
        // A larger run draws no more.
        expect(runRows({ height: 1e7, pitch: 36 }, { top: 300_000, bottom: 300_700 }).length).toBe(rows.length);
    });

    test("a run out of view draws nothing; one cut by the view's edge draws what shows", () => {
        expect(runRows({ height: 3600, pitch: 36 }, { top: -800, bottom: -100 })).toEqual([]);
        expect(runRows({ height: 3600, pitch: 36 }, { top: 3600, bottom: 4300 })).toEqual([]);
        // The run starts 100px into the view: its rows from its own top.
        const top = runRows({ height: 3600, pitch: 36 }, { top: -100, bottom: 600 });
        expect([top[0]!.index, top.at(-1)!.index]).toEqual([0, 16]);
        // Its end cut by the view: the last row, cut short, is drawn whole.
        const end = runRows({ height: 100, pitch: 36 }, { top: 0, bottom: 700 });
        expect(end.map((row) => row.top)).toEqual([0, 36, 72]);
    });

    test("overscan draws rows either side of the view", () => {
        const rows = runRows({ height: 36_000, pitch: 36 }, { top: 3600, bottom: 3636 }, 2);
        expect(rows.map((row) => row.index)).toEqual([98, 99, 100, 101, 102]);
    });

    test("a grouped run repeats its band and its lines: each band at its height, its lines at the pitch", () => {
        const run = { height: 10 * (42 + 3 * 36), pitch: 36, group: { band: 42, lines: 3 } };
        const rows = runRows(run, { top: 0, bottom: 300 });
        expect(rows.map((row) => [row.band, row.element, row.line, row.top, row.height])).toEqual([
            [true, 0, -1, 0, 42], [false, 0, 0, 42, 36], [false, 0, 1, 78, 36], [false, 0, 2, 114, 36],
            [true, 1, -1, 150, 42], [false, 1, 0, 192, 36], [false, 1, 1, 228, 36], [false, 1, 2, 264, 36],
        ]);
        // Deep in the run, only the element in view: its last line and the next band.
        const deep = runRows(run, { top: 5 * 150 + 120, bottom: 5 * 150 + 160 });
        expect(deep.map((row) => [row.element, row.line])).toEqual([[5, 2], [6, -1]]);
        expect(deep.map((row) => row.index)).toEqual([5 * 4 + 3, 6 * 4]);
    });

    test("the view as the run sees it: the scroll offset less where the run starts", () => {
        expect(runView(1000, 1200, 700)).toEqual({ top: 200, bottom: 900 });
    });

    test("a text bar's share is keyed to its row, so the pattern never crawls as the run scrolls", () => {
        expect([0, 1, 2, 3, 4, 5].map(barShare)).toEqual([1, 0.74, 0.88, 0.62, 0.94, 1]);
        expect(barShare(-1)).toBe(0.94);
    });
});
