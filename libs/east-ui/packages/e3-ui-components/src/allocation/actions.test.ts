/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 * @vitest-environment jsdom
 *
 * What `Split…` takes of a bin (A71, #1362), pure: with some of it
 * unallocated, that; with none, a quantity off a part — its largest, or the
 * one named — half of it by default, both parts keeping some.
 */
import { describe, expect, test } from "vitest";
import { SortedMap, StringType, compareFor, none, some, variant } from "@elaraai/east";
import { splitOf } from "./actions.js";
import type { Bin } from "./model.js";

const byString = compareFor(StringType);
const bin = (event: string | undefined, quantity: number, parts: [string, number][]): Bin => ({
    lane: "B-1", at: new Date(Date.UTC(2027, 4, 11, 6, 15)), event: event === undefined ? none : some(event), quantity, kind: none, hold: variant("days", 8),
    parts: new SortedMap(parts, byString), values: null,
}) as unknown as Bin;

describe("what Split… takes (A71, #1362)", () => {
    test("A71 — with some unallocated, that: all of it by default and at most, at least 1 of it, all of it under 1; a part named changes nothing", () => {
        expect(splitOf(bin("LD-1", 30, [["K-601", 20], ["K-208", 6]]))).toEqual({ from: undefined, held: 4, least: 1, most: 4, initial: 4 });
        expect(splitOf(bin("LD-1", 30, []))).toEqual({ from: undefined, held: 30, least: 1, most: 30, initial: 30 });
        expect(splitOf(bin("LD-1", 10.5, [["K-1", 10]]))).toEqual({ from: undefined, held: 0.5, least: 0.5, most: 0.5, initial: 0.5 });
        expect(splitOf(bin("LD-1", 30, [["K-601", 20], ["K-208", 6]]), "K-208")).toEqual({ from: undefined, held: 4, least: 1, most: 4, initial: 4 });
    });

    test("#1362 — with none, off its largest part, or the one named: half by default, at least 1 and at most the part less that; a part under 2, half each way", () => {
        expect(splitOf(bin("LD-1", 32, [["K-108", 32]]))).toEqual({ from: "K-108", held: 32, least: 1, most: 31, initial: 16 });
        expect(splitOf(bin("LD-1", 35, [["K-108", 35]]))).toEqual({ from: "K-108", held: 35, least: 1, most: 34, initial: 17.5 });
        // Two parts: the largest; of two alike, the first in key order.
        expect(splitOf(bin("LD-1", 18, [["K-110", 6], ["K-107", 12]]))?.from).toBe("K-107");
        expect(splitOf(bin("LD-1", 12, [["K-2", 6], ["K-1", 6]]))?.from).toBe("K-1");
        expect(splitOf(bin("LD-1", 18, [["K-110", 6], ["K-107", 12]]), "K-110")).toEqual({ from: "K-110", held: 6, least: 1, most: 5, initial: 3 });
        expect(splitOf(bin("LD-1", 1.5, [["K-1", 1.5]]))).toEqual({ from: "K-1", held: 1.5, least: 0.75, most: 0.75, initial: 0.75 });
    });

    test("#1362 — nothing to split: a reservation, a part the bin does not have, a bin of nothing", () => {
        expect(splitOf(bin(undefined, 0, [["K-305", 0]]))).toBeUndefined();
        expect(splitOf(bin("LD-1", 32, [["K-108", 32]]), "K-999")).toBeUndefined();
        expect(splitOf(bin("LD-1", 0, []))).toBeUndefined();
    });
});
