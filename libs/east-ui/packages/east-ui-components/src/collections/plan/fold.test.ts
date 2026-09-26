/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Temporal fold (`fold.ts`, #824) — what a bucket shows when it holds several
 * of a row's cells or points: one, their declared fold; and what it keeps when
 * it holds one.
 */

import { describe, test, expect } from "vitest";
import { none, some, variant } from "@elaraai/east";
import { bucketGroups, foldChartPoints, foldHeatArm, foldNumbers, foldSegmentCells, foldTableCells, foldWeightCells } from "./fold.js";
import { planScale } from "./scale.js";
import type { PlanInstantValue } from "./instant.js";
import { PLAN_WORDS } from "./words.js";

const t = (iso: string): PlanInstantValue => variant("time", new Date(iso)) as PlanInstantValue;
const n = (v: number): PlanInstantValue => variant("number", v) as PlanInstantValue;
const o = (v: string): PlanInstantValue => variant("ordinal", v) as PlanInstantValue;

const MONTH = planScale({ kind: "time", window: { min: new Date("2026-06-01T00:00:00Z"), max: new Date("2026-09-01T00:00:00Z") }, resolution: "month" })!.period;
const WEEKS = ["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27"].map((d) => t(`${d}T00:00:00Z`));
const JUL = t("2026-07-01T00:00:00Z");

/** A heat arm's cells — the fold hands back the whole cells union, and these tests build the heat arm. */
function heatCellsOf(arm: ReturnType<typeof foldHeatArm>) {
    if (arm.type !== "heat") throw new Error(`expected the heat arm, got ${arm.type}`);
    return arm.value.cells;
}

describe("foldNumbers", () => {
    test("each fold over a bucket's values, in axis order", () => {
        const v = [4, 1, 3, 2];
        expect(foldNumbers(v, "sum")).toBe(10);
        expect(foldNumbers(v, "mean")).toBe(2.5);
        expect(foldNumbers(v, "min")).toBe(1);
        expect(foldNumbers(v, "max")).toBe(4);
        expect(foldNumbers(v, "last")).toBe(2);
        expect(foldNumbers(v, "count")).toBe(4);
    });

    test("no values: `count` is 0, every other fold is no value", () => {
        expect(foldNumbers([], "count")).toBe(0);
        for (const f of ["sum", "mean", "min", "max", "last"] as const) expect(foldNumbers([], f)).toBeUndefined();
    });

    test("250,000 values fold without a spread (#810)", () => {
        const many = Array.from({ length: 250_000 }, (_, i) => i);
        expect(foldNumbers(many, "max")).toBe(249_999);
        expect(foldNumbers(many, "min")).toBe(0);
    });
});

describe("bucketGroups", () => {
    test("group by the period holding each instant; a shared instant is kept, mixed ones sit at the period start", () => {
        const items = [{ at: WEEKS[1]! }, { at: WEEKS[0]! }, { at: t("2026-06-29T00:00:00Z") }];
        const groups = bucketGroups(items, (c) => c.at, MONTH);
        // Buckets in axis order; members in axis order within one.
        expect(groups.map((g) => g.at)).toEqual([t("2026-06-29T00:00:00Z"), JUL]);
        expect(groups[1]!.members).toEqual([{ at: WEEKS[0]! }, { at: WEEKS[1]! }]);
        // Two cells at one instant keep it.
        expect(bucketGroups([{ at: WEEKS[2]! }, { at: WEEKS[2]! }], (c) => c.at, MONTH)[0]!.at).toEqual(WEEKS[2]);
    });

    test("without a period, by instant — an ordinal set with no index keeps insertion order", () => {
        const groups = bucketGroups([{ at: o("QC") }, { at: o("PREP") }, { at: o("QC") }], (c) => c.at, undefined);
        expect(groups.map((g) => g.at)).toEqual([o("QC"), o("PREP")]);
        expect(groups[0]!.members).toHaveLength(2);
        const indexed = bucketGroups([{ at: o("QC") }, { at: o("PREP") }], (c) => c.at, undefined, new Map([["PREP", 0], ["QC", 1]]));
        expect(indexed.map((g) => g.at)).toEqual([o("PREP"), o("QC")]);
    });

    test("a number period floors to the step", () => {
        const step = planScale({ kind: "number", window: { min: 0, max: 10 }, step: 2 })!.period;
        const groups = bucketGroups([{ at: n(2.5) }, { at: n(3.5) }, { at: n(4) }], (c) => c.at, step);
        expect(groups.map((g) => g.at)).toEqual([n(2), n(4)]);
    });
});

describe("the per-kind folds", () => {
    test("nothing to fold hands back the very array — a row memo keyed on it holds", () => {
        const cells = [{ at: WEEKS[0]!, value: some(1), text: none, tone: none }];
        expect(foldTableCells(cells, "sum", MONTH, undefined)).toBe(cells);
        const arm = variant("heat", { cells: [{ at: JUL, value: some(1), label: none }], scale: { min: none, max: none, warnAt: none }, fold: variant("mean", null), format: none });
        expect(foldHeatArm(arm, MONTH, undefined, PLAN_WORDS)).toBe(arm);
    });

    test("`count` always counts — even a lone member becomes its count", () => {
        const cells = [{ at: WEEKS[0]!, value: some(9), text: some("nine"), tone: none }];
        expect(foldTableCells(cells, "count", MONTH, undefined)).toEqual([{ at: WEEKS[0], value: some(1), text: none, tone: none }]);
    });

    test("a folded heat cell prints through the arm's format, and only where its members printed", () => {
        const fmt = variant("percent", { minimumFractionDigits: none, maximumFractionDigits: some(0n), signDisplay: none });
        const labelled = WEEKS.map((at, i) => ({ at, value: some([0.5, 0.6, 0.7, 0.8][i]!), label: some("x") }));
        const arm = variant("heat", { cells: labelled, scale: { min: none, max: none, warnAt: none }, fold: variant("mean", null), format: some(fmt) });
        const folded = foldHeatArm(arm, MONTH, undefined, PLAN_WORDS);
        expect(folded.value.cells).toEqual([{ at: JUL, value: some(0.65), label: some("65%") }]);
        const bare = variant("heat", { ...arm.value, cells: labelled.map((c) => ({ ...c, label: none })) });
        expect(heatCellsOf(foldHeatArm(bare, MONTH, undefined, PLAN_WORDS))[0]!.label).toEqual(none);
        // A bucket of no-data cells stays no data.
        const empty = variant("heat", { ...arm.value, cells: WEEKS.map((at) => ({ at, value: none, label: none })) });
        expect(heatCellsOf(foldHeatArm(empty, MONTH, undefined, PLAN_WORDS))[0]!.value).toEqual(none);
    });

    test("weight bars fold their fractions, and are planned only when every member is", () => {
        const cells = WEEKS.map((at, i) => ({ at, fraction: [0.2, 0.4, 0.6, 0.8][i]!, planned: i > 0 }));
        expect(foldWeightCells(cells, "mean", MONTH, undefined)).toEqual([{ at: JUL, fraction: 0.5, planned: false }]);
        expect(foldWeightCells(cells.slice(1), "max", MONTH, undefined)).toEqual([{ at: JUL, fraction: 0.8, planned: true }]);
    });

    test("segment compositions fold fill by fill — an absent fill weighs 0, `count` counts its carriers — and drop in-bar labels", () => {
        const cells = [
            { at: WEEKS[0]!, segments: [
                { fill: variant("brand", null), weight: 3, label: some("3") },
                { fill: variant("slack", null), weight: 1, label: some("1") },
            ] },
            { at: WEEKS[1]!, segments: [{ fill: variant("brand", null), weight: 1, label: some("1") }] },
        ];
        expect(foldSegmentCells(cells, "sum", MONTH, undefined)).toEqual([{
            at: JUL, segments: [{ fill: variant("brand", null), weight: 4, label: none }, { fill: variant("slack", null), weight: 1, label: none }],
        }]);
        expect(foldSegmentCells(cells, "count", MONTH, undefined)[0]!.segments.map((s) => s.weight)).toEqual([2, 1]);
        expect(foldSegmentCells(cells, "min", MONTH, undefined)[0]!.segments.map((s) => s.weight)).toEqual([1, 0]);
    });

    test("chart points fold their finite values; a bucket of gaps stays a gap", () => {
        const points = WEEKS.map((at, i) => ({ t: at, y: [1, Number.NaN, 3, 4][i]! }));
        expect(foldChartPoints(points, "mean", MONTH, undefined)).toEqual([{ t: JUL, y: 8 / 3 }]);
        const gaps = WEEKS.map((at) => ({ t: at, y: Number.NaN }));
        expect(Number.isNaN(foldChartPoints(gaps, "sum", MONTH, undefined)[0]!.y)).toBe(true);
    });
});
