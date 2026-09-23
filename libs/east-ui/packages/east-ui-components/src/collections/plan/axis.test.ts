/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * When the canvas scale depends on its rows (#812). The canvas keys its scale
 * on the rows only when `scaleReadsRows` says the window is FITTED to them —
 * so every other canvas keeps one scale while rows land under it. That is
 * only sound if, whenever the answer is no, the rows cannot change the scale.
 */

import { describe, test, expect } from "vitest";
import { none, some, variant } from "@elaraai/east";
import { resolveScale, scaleReadsRows, type PlanAxisValue } from "./axis.js";
import type { PlanRowValue } from "./model.js";

const W27 = new Date("2026-06-29T00:00:00Z");
const W39 = new Date("2026-09-21T00:00:00Z");

const timeAxis = (window: boolean): PlanAxisValue => variant("time", {
    window: window ? some({ min: W27, max: W39 }) : none,
    resolution: variant("week", null), resolutions: [], now: none, format: none,
}) as PlanAxisValue;
const numberAxis = (window: boolean): PlanAxisValue => variant("number", {
    window: window ? some({ min: 0, max: 10 }) : none, step: 1, now: none, format: none,
}) as PlanAxisValue;
const ordinalAxis = variant("ordinal", { values: ["A", "B", "C"], now: none }) as PlanAxisValue;

/** One span row whose single run covers `[from, to)` on the given arm. */
function spanRow(key: string, from: unknown, to: unknown): PlanRowValue {
    return {
        key, parent: none,
        gutter: { label: key, id: none, sub: none, value: none, meta: none, stacked: none, swatches: [] },
        kind: variant("span", {
            runs: [{ key: "r", start: from, end: to, label: "R", quantity: none, qty: none,
                state: variant("actual", null), status: none, moved: none, icon: none }],
            decisions: [], ports: [], rollup: none, unit: none,
        }),
        pinned: none, height: none, status: none, approval: none, expand: none,
    } as unknown as PlanRowValue;
}
const timeRows = [spanRow("a", variant("time", new Date("2026-01-05Z")), variant("time", new Date("2026-02-02Z")))];
const numberRows = [spanRow("a", variant("number", 40), variant("number", 55))];

describe("scaleReadsRows (#812)", () => {
    test("only an unpaged time or number axis with no stated window is fitted to its rows", () => {
        expect(scaleReadsRows(timeAxis(false), undefined, false)).toBe(true);
        expect(scaleReadsRows(numberAxis(false), undefined, false)).toBe(true);
        // A declared window, a bound slice window, a paged source (which must
        // state one), or an ordinal list — the rows are no input.
        expect(scaleReadsRows(timeAxis(true), undefined, false)).toBe(false);
        expect(scaleReadsRows(timeAxis(false), [W27.getTime(), W39.getTime()], false)).toBe(false);
        expect(scaleReadsRows(timeAxis(false), undefined, true)).toBe(false);
        expect(scaleReadsRows(ordinalAxis, undefined, false)).toBe(false);
    });

    test("whenever it says no, the rows cannot move the scale — and when it says yes, they do", () => {
        const cases: Array<{ axis: PlanAxisValue; slice: readonly [number, number] | undefined; paged: boolean; rows: PlanRowValue[] }> = [
            { axis: timeAxis(true), slice: undefined, paged: false, rows: timeRows },
            { axis: timeAxis(false), slice: [W27.getTime(), W39.getTime()], paged: false, rows: timeRows },
            { axis: numberAxis(true), slice: undefined, paged: false, rows: numberRows },
            { axis: ordinalAxis, slice: undefined, paged: false, rows: [] },
            { axis: timeAxis(false), slice: undefined, paged: false, rows: timeRows },
            { axis: numberAxis(false), slice: undefined, paged: false, rows: numberRows },
        ];
        for (const c of cases) {
            const at = (rows: readonly PlanRowValue[]) => resolveScale({
                axis: c.axis, sliceWindow: c.slice, sliceResolution: undefined, rows, paged: c.paged,
            });
            const withRows = at(c.rows);
            const without = at([]);
            if (scaleReadsRows(c.axis, c.slice, c.paged)) {
                // Fitted: the rows ARE the window (and none leaves nothing to fit).
                expect(withRows).toBeDefined();
                expect(without).toBeUndefined();
            } else {
                expect(withRows?.window).toEqual(without?.window);
                expect(withRows?.n).toBe(without?.n);
            }
        }
    });
});
