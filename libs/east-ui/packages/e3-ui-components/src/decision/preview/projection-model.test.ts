/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the queue's words load east-ui-components' entry,
 * which needs one as it loads (#1179).
 *
 * A projection target's preview, worked out (#1454, `Decision Queue Spec.md`
 * P8, P25): each option's series a line on one plot from zero to a nice top,
 * the chosen one last; one tick up the side at the largest round value under
 * the highest point, and the limit; the first and the last x and the round
 * steps between them; each line's label at its first rise, else over its last
 * run — and the sentence it says.
 */

import { describe, expect, test } from "vitest";
import { decisionQueueMessages as m } from "../messages.js";
import { projectionPreview, roundFloor, type ProjectionLineInput, type ProjectionModel } from "./projection-model.js";

/** An option's series over weeks 9 to 16. */
const line = (key: string, label: string, ys: readonly number[], rest: Partial<ProjectionLineInput> = {}): ProjectionLineInput => ({
    key, label, points: ys.map((y, i) => ({ x: 9 + i, y })), chosen: false, asis: false, ...rest,
});
const LINES = [
    line("0", "No order", [1_200, 1_000, 800, 600, 400, 200, 0, 0], { asis: true }),
    line("1", "1,500", [1_200, 1_000, 800, 2_300, 2_100, 1_900, 1_700, 1_500]),
    line("2", "2,000", [1_200, 1_000, 800, 2_550, 2_350, 2_150, 1_950, 1_750], { chosen: true }),
];

/** A place on the plot, to a hundredth of a percent. */
const near = (value: number) => Math.round(value * 100) / 100;
const ticksOf = (model: ProjectionModel) => model.x.map(tick => [tick.value, near(tick.at)]);

describe("roundFloor", () => {
    test("the largest of one, two or five of the value's power of ten at or under it", () => {
        expect([roundFloor(2_550), roundFloor(7 / 3), roundFloor(500), roundFloor(0.9), roundFloor(0)]).toEqual([2_000, 2, 500, 0.5, 0]);
    });
});

describe("projectionPreview", () => {
    test("from zero to a nice top over the highest point; the round tick under it and the limit up the side; the first, the round steps and the last x along the bottom", () => {
        const model = projectionPreview(LINES, 400);
        expect(model.top).toBe(2_600);
        expect([model.y?.value, near(model.y!.at)]).toEqual([2_000, 23.08]);
        expect([model.limit?.value, near(model.limit!.at)]).toEqual([400, 84.62]);
        expect(ticksOf(model)).toEqual([[9, 0], [11, 28.57], [13, 57.14], [16, 100]]);
    });

    test("the chosen line last; each label at the top of its line's first rise, else over its last run; each line's lowest point", () => {
        const model = projectionPreview(LINES, 400);
        expect(model.lines.map(l => [l.label, l.chosen, l.asis, l.low])).toEqual([["No order", false, true, 0], ["1,500", false, false, 800], ["2,000", true, false, 800]]);
        expect(model.lines.map(l => [l.run, near(l.at.x), near(l.at.y)])).toEqual([[true, 92.86, 100], [false, 42.86, 11.54], [false, 42.86, 1.92]]);
        expect(model.lines[0]!.path.map(p => [near(p.x), near(p.y)]).slice(0, 2)).toEqual([[0, 53.85], [14.29, 61.54]]);
    });

    test("without a limit the top follows the points alone, and nothing is drawn for it; a short span steps by its own round fraction", () => {
        const model = projectionPreview([line("0", "Only", [100, 340, 120])], undefined);
        expect([model.top, model.limit, model.y?.value]).toEqual([340, undefined, 200]);
        expect(ticksOf(model)).toEqual([[9, 0], [9.5, 25], [10, 50], [10.5, 75], [11, 100]]);
    });
});

describe("the projection's words", () => {
    test("each line's lowest point, and whether it falls under the limit", () => {
        expect(m.previewProjection({
            lines: [{ label: "2,000", chosen: true, low: "800", under: false }, { label: "No order", chosen: false, low: "0", under: true }], limit: "min",
        })).toBe("2,000 (chosen) stays at 800 or above; No order falls to 0, under min");
        expect(m.previewProjection({ lines: [{ label: "Only", chosen: false, low: "0", under: true }], limit: undefined })).toBe("Only falls to 0, under the limit");
    });
});
