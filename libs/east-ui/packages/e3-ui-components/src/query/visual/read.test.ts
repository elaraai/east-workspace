/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Reading a visual's answers (#1671): each period's program joined into one
 * group a key, in the first value's order; totals; a trend's buckets read
 * back to their first instant; a group's rest folded into Other exactly, or
 * left out and counted. Every answer is a printed program's, asked as e3
 * asks it.
 */

import { describe, expect, it } from "vitest";
import { DateTimeType, equalFor } from "@elaraai/east";
import { Studio } from "@elaraai/e3-ui";
import { utcAt as at } from "../../plan/plan.test-utils.js";
import type { ValueParts } from "./ask.js";
import { bucketStart, firstKeys, foldGroups, foldRest, partsAt, readGroups, readTotal, type ReadGroup } from "./read.js";
import { answered } from "./visual.test-utils.js";

const v = Studio.visual;
const sameInstant = equalFor(DateTimeType);

/** A group's value at an index, made of its parts. */
function valueAt(group: ReadGroup, index: number): number | undefined {
    return partsAt(group.parts, index);
}

describe("readGroups", () => {
    it("joins each period's program into one group a key, in the order of the first value's program, a group only another period has after", async () => {
        const { asks, answers, values } = await answered(v.of("orders", v.column({
            x: v.group("region", { sort: "high" }), values: [v.sum("revenue"), v.sum("revenue", { period: "year_ago" })],
        })));
        const read = readGroups(asks, answers, values, "groups")!;
        expect(read.groups.map(g => [g.keys[0], valueAt(g, 0), valueAt(g, 1), g.rows])).toEqual([
            ["SA", 170, undefined, 2], ["NSW", 50, undefined, 1], ["VIC", 30, 40, 1], ["WA", 20, undefined, 1],
            // Only a year ago: its rows are that period's.
            ["QLD", undefined, 10, 1],
        ]);
        expect([read.keyTypes.length, read.of]).toEqual([1, 4]);
    });

    it("keys a split chart's groups by its x and its split", async () => {
        const { asks, answers, values } = await answered(v.of("orders", v.column({
            x: v.group("ordered_at", { bucket: "month" }), values: [v.count()], split: "region", stack: "stacked",
        })));
        const read = readGroups(asks, answers, values, "groups")!;
        expect(read.groups.map(g => g.keys)).toEqual([
            [2026n * 12n + 6n, "NSW"], [2026n * 12n + 6n, "SA"], [2026n * 12n + 7n, "SA"], [2026n * 12n + 7n, "VIC"], [2026n * 12n + 8n, "WA"],
        ]);
    });

    it("reads a summary's heads from their own program: a distinct count among them", async () => {
        const { asks, answers, values } = await answered(v.of("orders", v.summary({
            rows: [v.group("region"), v.group("customer")], values: [v.distinct("customer"), v.sum("revenue")], total: true,
        })));
        const heads = readGroups(asks, answers, values, "heads")!;
        expect(heads.groups.map(g => [g.keys, valueAt(g, 0), valueAt(g, 1)])).toEqual([
            [["NSW"], 1, 50], [["SA"], 2, 170], [["VIC"], 1, 30], [["WA"], 1, 20],
        ]);
        const rows = readGroups(asks, answers, values, "groups")!;
        expect(rows.groups.map(g => g.keys)).toEqual([["NSW", "Harbour"], ["SA", "Northwind"], ["SA", "Summit"], ["VIC", "Northwind"], ["WA", "Summit"]]);
        expect(valueAt({ ...rows.groups[0]!, parts: readTotal(asks, answers, values)!.parts }, 0)).toBe(3);
    });

    it("reads a list's caption from each group's first row", async () => {
        const { asks, answers, values } = await answered(v.of("orders", v.list({ item: v.group("customer"), caption: "region", values: [v.sum("revenue")] })));
        const read = readGroups(asks, answers, values, "groups")!;
        expect(read.groups.map(g => [g.keys[0], g.extras.get("c")])).toEqual([["Harbour", "NSW"], ["Northwind", "SA"], ["Summit", "SA"]]);
    });
});

describe("readTotal", () => {
    it("reads a KPI's value and its compare over another period, and the current period's rows", async () => {
        const { asks, answers, values } = await answered(v.of("orders", v.kpi({ value: v.sum("revenue"), compare: v.sum("revenue", { period: "year_ago" }) })));
        const total = readTotal(asks, answers, values)!;
        expect([partsAt(total.parts, 0), partsAt(total.parts, 1), total.rows]).toEqual([270, 50, 5]);
    });
});

describe("partsAt", () => {
    it("makes a value of the parts at an index: none where there are no parts, nor of a mean over nothing", () => {
        const parts = new Map<number, ValueParts>([
            [0, { kind: "added", top: 12, bottom: 0 }],
            [1, { kind: "divided", top: 6, bottom: 4 }],
            [2, { kind: "divided", top: undefined, bottom: 0 }],
            [3, { kind: "least", top: undefined, bottom: 0 }],
        ]);
        expect([0, 1, 2, 3, 4].map((index) => partsAt(parts, index))).toEqual([12, 1.5, undefined, undefined, undefined]);
    });
});

describe("a trend's buckets", () => {
    it("reads a KPI's trend a week a bucket over a quarter's window, each back to its Monday", async () => {
        const { asks, answers, values } = await answered(v.of("orders", v.kpi({ value: v.sum("revenue"), trend: "ordered_at" })));
        const trend = readGroups(asks, answers, values, "trend")!;
        const starts = trend.groups.map(g => bucketStart(g.keys[0] as bigint, "week"));
        expect(sameInstant(starts[0]!, at("2026-06-29T00:00:00"))).toBe(true);
        expect(trend.groups.map(g => valueAt(g, 0))).toEqual([100, 50, 70, 30, 20]);
    });

    it("reads each unit's period number back to its first instant", () => {
        const cases: readonly (readonly [bigint, Parameters<typeof bucketStart>[1], string])[] = [
            [2026n * 12n + 6n, "month", "2026-07-01T00:00:00"],
            [2026n * 12n + 6n, "auto", "2026-07-01T00:00:00"],
            [2026n * 4n + 2n, "quarter", "2026-07-01T00:00:00"],
            [2026n, "year", "2026-01-01T00:00:00"],
            [20_637n, "day", "2026-07-03T00:00:00"],
            [495_298n, "hour", "2026-07-03T10:00:00"],
            [2_948n, "week", "2026-06-29T00:00:00"],
            // Before 1970: the day before, and the week holding 1 January 1970, from its Monday.
            [-1n, "day", "1969-12-31T00:00:00"],
            [0n, "week", "1969-12-29T00:00:00"],
        ];
        for (const [period, unit, start] of cases) expect(sameInstant(bucketStart(period, unit), at(start)), `${unit} ${period}`).toBe(true);
    });
});

describe("foldRest", () => {
    it("folds a category past its first N into Other: sums, means and ratios of their parts", async () => {
        const { asks, answers, values } = await answered(v.of("orders", v.bar({
            x: v.group("region", { sort: "high", top: 2n }), values: [v.sum("revenue"), v.mean("margin"), v.ratio("revenue", "units")],
        })));
        const read = readGroups(asks, answers, values, "groups")!;
        const folded = foldRest(read, 0, firstKeys(read, 0, 2));
        expect(folded.kept.map(g => g.keys[0])).toEqual(["SA", "NSW"]);
        const [other] = folded.other;
        // Victoria and Western Australia: 30 + 20; margins 0.3 and 0.4; 50 revenue over 6 units.
        expect([other!.other, other!.keys, valueAt(other!, 0), valueAt(other!, 1), valueAt(other!, 2), other!.rows]).toEqual([true, [undefined], 50, 0.35, 50 / 6, 2]);
        expect([folded.hidden, folded.exact]).toEqual([2, true]);
    });

    it("leaves a distinct count's rest out, and counts it", async () => {
        const { asks, answers, values } = await answered(v.of("orders", v.bar({ x: v.group("region", { sort: "high" }), values: [v.distinct("customer")] })));
        const read = readGroups(asks, answers, values, "groups")!;
        const folded = foldRest(read, 0, firstKeys(read, 0, 2));
        expect([folded.kept.length, folded.other, folded.hidden, folded.exact]).toEqual([2, [], 2, false]);
    });

    it("leaves a cut answer's rest out: its rows are not all answered", async () => {
        const { asks, answers, values } = await answered(v.of("orders", v.bar({ x: v.group("region"), values: [v.sum("revenue")] })));
        const read = readGroups(asks, answers, values, "groups")!;
        const folded = foldRest({ ...read, of: read.groups.length + 1 }, 0, firstKeys(read, 0, 2));
        expect([folded.other, folded.hidden, folded.exact]).toEqual([[], 2, false]);
    });

    it("folds a level's groups into one Other — sums, means and ratios of their parts, their rows added — and no distinct count over two", async () => {
        const { asks, answers, values } = await answered(v.of("orders", v.bar({
            x: v.group("region", { sort: "high" }), values: [v.sum("revenue"), v.mean("margin"), v.ratio("revenue", "units")],
        })));
        const read = readGroups(asks, answers, values, "groups")!;
        // Victoria and Western Australia, past the first two.
        const other = foldGroups(read.groups.slice(2))!;
        expect([other.other, other.keys, valueAt(other, 0), valueAt(other, 1), valueAt(other, 2), other.rows]).toEqual([true, [], 50, 0.35, 50 / 6, 2]);
        expect(foldGroups([])).toBeUndefined();
        const distinct = await answered(v.of("orders", v.bar({ x: v.group("region"), values: [v.distinct("customer")] })));
        const groups = readGroups(distinct.asks, distinct.answers, distinct.values, "groups")!.groups;
        expect([valueAt(foldGroups(groups.slice(0, 1))!, 0), foldGroups(groups)]).toEqual([1, undefined]);
    });

    it("folds a split's rest at each x: one Other a month", async () => {
        const { asks, answers, values } = await answered(v.of("orders", v.column({
            x: v.group("ordered_at", { bucket: "month" }), values: [v.sum("revenue")], split: "region", stack: "stacked",
        })));
        const read = readGroups(asks, answers, values, "groups")!;
        // The first split key, in the groups' order: New South Wales.
        const folded = foldRest(read, 1, firstKeys(read, 1, 1));
        expect(folded.kept.map(g => g.keys)).toEqual([[2026n * 12n + 6n, "NSW"]]);
        expect(folded.other.map(g => [g.keys, valueAt(g, 0)])).toEqual([
            [[2026n * 12n + 6n, undefined], 100], [[2026n * 12n + 7n, undefined], 100], [[2026n * 12n + 8n, undefined], 20],
        ]);
    });
});
