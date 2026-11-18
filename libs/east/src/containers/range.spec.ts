/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The entries of a sorted map, or the elements of a sorted set, between two
 * bounds (#1616, D3): what a range holds, that it is a new collection and
 * never a frozen one, and what finding it costs — counted, never timed. A
 * range is found by a search down the tree, so its cost follows the range and
 * never the collection: the map's own comparison is not called at all, and
 * the bounds' tests are called fewer times than the range has entries, plus
 * a few for the two searches.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { compareFor } from "../comparison.js";
import { encodeBeast2SegmentsFor, openBeast2LazyFor } from "../serialization/index.js";
import { DictType, IntegerType, SetType } from "../types.js";
import { SortedMap } from "./sortedmap.js";
import { SortedSet } from "./sortedset.js";

/** A comparison of numbers that counts its calls. */
function counting(): { compare: (a: number, b: number) => number; calls: () => number; reset: () => void } {
    let calls = 0;
    return {
        compare: (a, b) => { calls += 1; return a < b ? -1 : a > b ? 1 : 0; },
        calls: () => calls,
        reset: () => { calls = 0; },
    };
}

/** The test "at or past `bound`" over numbers, counting its calls. */
function atOrPast(bound: number, count: { calls: number }): (key: number) => boolean {
    return (key) => { count.calls += 1; return key >= bound; };
}

/** A map of the even numbers below `2 * size`, each to its half. */
function evens(size: number, compare?: (a: number, b: number) => number): SortedMap<number, number> {
    const map = new SortedMap<number, number>(undefined, compare);
    for (let i = 0; i < size; i++) map.set(2 * i, i);
    return map;
}

describe("the entries of a SortedMap between two bounds (#1616)", () => {
    test("from the first key at or past `from` up to, and not including, the first at or past `to`", () => {
        const map = evens(10);
        const count = { calls: 0 };
        assert.deepEqual([...map.range(atOrPast(4, count), atOrPast(10, count))], [[4, 2], [6, 3], [8, 4]]);
        // A bound between two keys: the next key is the first kept, and the last before it the last.
        assert.deepEqual([...map.range(atOrPast(5, count), atOrPast(11, count)).keys()], [6, 8, 10]);
    });

    test("a bound left out is that end of the map, and both left out is every entry", () => {
        const map = evens(6);
        const count = { calls: 0 };
        assert.deepEqual([...map.range(atOrPast(7, count)).keys()], [8, 10]);
        assert.deepEqual([...map.range(undefined, atOrPast(5, count)).keys()], [0, 2, 4]);
        assert.deepEqual([...map.range()], [...map]);
    });

    test("`from` past `to`, a range past either end, and a range of an empty map hold nothing", () => {
        const map = evens(6);
        const count = { calls: 0 };
        assert.equal(map.range(atOrPast(8, count), atOrPast(2, count)).size, 0);
        assert.equal(map.range(atOrPast(4, count), atOrPast(4, count)).size, 0);
        assert.equal(map.range(atOrPast(100, count)).size, 0);
        assert.equal(map.range(undefined, atOrPast(-1, count)).size, 0);
        assert.equal(new SortedMap<number, number>().range(atOrPast(1, count), atOrPast(2, count)).size, 0);
    });

    test("every range of a map of 3,000 keys is what a walk of the whole keeps, for bounds on, between and beyond its keys", () => {
        const map = evens(3_000);
        const all = [...map];
        const count = { calls: 0 };
        const bounds = [-3, 0, 1, 2, 31, 32, 33, 63, 64, 1_000, 1_023, 1_024, 2_999, 3_000, 5_997, 5_998, 5_999, 7_000];
        for (const from of bounds) {
            for (const to of bounds) {
                const kept = all.filter(([key]) => key >= from && !(key >= to));
                assert.deepEqual([...map.range(atOrPast(from, count), atOrPast(to, count))], kept, `from ${from} to ${to}`);
            }
        }
    });

    test("a range is a new map with the source's comparison: read by key, added to and iterated from a key as any map is", () => {
        const order = counting();
        const map = evens(500, order.compare);
        const count = { calls: 0 };
        const range = map.range(atOrPast(100, count), atOrPast(300, count));
        assert.equal(range.size, 100);
        for (let key = 100; key < 300; key += 2) assert.equal(range.get(key), key / 2);
        assert.equal(range.get(98), undefined);
        assert.equal(range.has(300), false);
        assert.equal(range.minKey(), 100);
        assert.equal(range.maxKey(), 298);
        // Added to, in and out of order, it stays sorted: the comparison is the source's again.
        range.set(151, -1).set(50, -2).set(400, -3);
        assert.deepEqual([...range.keys(149)].slice(0, 3), [150, 151, 152]);
        assert.deepEqual([[...range.keys()][0], [...range.keys()].at(-1)], [50, 400]);
        assert.equal(range.size, 103);
        // The source is as it was.
        assert.equal(map.size, 500);
        assert.equal(map.has(151), false);
    });

    test("a range of a frozen map is not frozen, and the frozen map is left as it is", () => {
        const map = evens(40);
        Object.freeze(map);
        const count = { calls: 0 };
        const range = map.range(atOrPast(10, count), atOrPast(20, count));
        assert.equal(Object.isFrozen(range), false);
        range.set(11, 0);
        range.delete(10);
        assert.deepEqual([...range.keys()], [11, 12, 14, 16, 18]);
        assert.equal(map.size, 40);
        assert.throws(() => map.set(11, 0), TypeError);
    });

    test("the values a range holds are the source's own", () => {
        const first = { n: 1 };
        const second = { n: 2 };
        const map = new SortedMap<number, { n: number }>([[1, first], [2, second]]);
        assert.equal(map.range((key) => key >= 2).get(2), second);
    });

    test("a test that throws leaves the source as it was, its comparison its own", () => {
        const order = counting();
        const map = evens(200, order.compare);
        assert.throws(() => map.range(() => { throw new Error("no"); }), /no/);
        order.reset();
        assert.equal(map.get(100), 50);
        assert.ok(order.calls() > 0, "the map's own comparison answers a keyed read again");
        assert.deepEqual([...map.range((key) => key >= 396)].map(([key]) => key), [396, 398]);
    });

    test("a range is found by a search: the map's comparison is never called, and the tests fewer times than the range has entries", () => {
        const order = counting();
        const size = 100_000;
        const map = evens(size, order.compare);
        // The two searches come to a few binary searches down the tree: far below the map's size.
        const SEARCH = 200;
        const cases: [from: number, to: number][] = [
            [100_000, 100_100],        // 50 entries in the middle
            [0, 20],                   // 10 at the start
            [199_980, 200_000],        // 10 at the end
            [100_001, 100_001],        // none
            [60_000, 140_000],         // 40,000 across many nodes
        ];
        for (const [from, to] of cases) {
            order.reset();
            const count = { calls: 0 };
            const range = map.range(atOrPast(from, count), atOrPast(to, count));
            const kept = Math.max(0, Math.ceil((to - from) / 2));
            assert.equal(range.size, kept, `from ${from} to ${to}`);
            assert.equal(order.calls(), 0, `the map's comparison, from ${from} to ${to}`);
            assert.ok(count.calls <= kept + SEARCH, `${count.calls} test calls for ${kept} entries, from ${from} to ${to}`);
        }
        // An end left out costs nothing: its test is never made.
        order.reset();
        const count = { calls: 0 };
        assert.equal(map.range(undefined, atOrPast(20, count)).size, 10);
        assert.ok(count.calls <= SEARCH, `${count.calls} test calls for an open start`);
        assert.equal(order.calls(), 0);
    });
});

describe("the elements of a SortedSet between two bounds (#1616)", () => {
    /** The multiples of three below `3 * size`. */
    const threes = (size: number, compare?: (a: number, b: number) => number): SortedSet<number> => {
        const set = new SortedSet<number>(undefined, compare);
        for (let i = 0; i < size; i++) set.add(3 * i);
        return set;
    };

    test("the elements a walk of the whole keeps, for bounds on, between and beyond its elements; an end left out is that end", () => {
        const set = threes(2_000);
        const all = [...set];
        const count = { calls: 0 };
        const bounds = [-1, 0, 1, 3, 95, 96, 97, 3_000, 5_996, 5_997, 5_998, 9_000];
        for (const from of bounds) {
            for (const to of bounds) {
                assert.deepEqual([...set.range(atOrPast(from, count), atOrPast(to, count))], all.filter((key) => key >= from && !(key >= to)), `from ${from} to ${to}`);
            }
            assert.deepEqual([...set.range(atOrPast(from, count))], all.filter((key) => key >= from), `from ${from}`);
            assert.deepEqual([...set.range(undefined, atOrPast(from, count))], all.filter((key) => !(key >= from)), `to ${from}`);
        }
        assert.deepEqual([...set.range()], all);
        assert.equal(new SortedSet<number>().range(atOrPast(1, count)).size, 0);
    });

    test("a range is a new set with the source's comparison, never frozen, and the source is left as it is", () => {
        const order = counting();
        const set = threes(300, order.compare);
        Object.freeze(set);
        const count = { calls: 0 };
        const range = set.range(atOrPast(30, count), atOrPast(45, count));
        assert.deepEqual([...range], [30, 33, 36, 39, 42]);
        assert.equal(Object.isFrozen(range), false);
        range.add(31).add(1_000);
        range.delete(42);
        assert.deepEqual([...range], [30, 31, 33, 36, 39, 1_000]);
        assert.equal(range.has(33), true);
        assert.equal(range.has(42), false);
        // Its set algebra gives sets of the same order.
        assert.deepEqual([...range.union(new SortedSet([2, 32], order.compare))], [2, 30, 31, 32, 33, 36, 39, 1_000]);
        assert.equal(set.size, 300);
        assert.throws(() => set.add(31), TypeError);
    });

    test("a range is found by a search: the set's comparison is never called, and the tests fewer times than the range has elements", () => {
        const order = counting();
        const set = threes(100_000, order.compare);
        const SEARCH = 200;
        for (const [from, to] of [[150_000, 150_150], [0, 30], [90_000, 210_000]] as const) {
            order.reset();
            const count = { calls: 0 };
            const range = set.range(atOrPast(from, count), atOrPast(to, count));
            const kept = (to - from) / 3;
            assert.equal(range.size, kept, `from ${from} to ${to}`);
            assert.equal(order.calls(), 0, `the set's comparison, from ${from} to ${to}`);
            assert.ok(count.calls <= kept + SEARCH, `${count.calls} test calls for ${kept} elements, from ${from} to ${to}`);
        }
    });
});

describe("a range of a lazily opened collection (#1616)", () => {
    // What the pager decodes for a range is counted where the pager serves one (D4); here, that a
    // range of a collection opened lazily holds what a range of the same collection held in memory does.
    const Squares = DictType(IntegerType, IntegerType);
    const Evens = SetType(IntegerType);
    const squares = new SortedMap<bigint, bigint>(Array.from({ length: 5_000 }, (_, i) => [BigInt(i), BigInt(i * i)]), compareFor(IntegerType));
    const evens = new SortedSet<bigint>(Array.from({ length: 5_000 }, (_, i) => BigInt(2 * i)), compareFor(IntegerType));
    const from = (key: bigint): boolean => key >= 1_990n;
    const to = (key: bigint): boolean => key >= 2_010n;
    /** The entries, or the elements, in segments of 64. */
    const segments = <E>(all: readonly E[]): E[][] => Array.from({ length: Math.ceil(all.length / 64) }, (_, i) => all.slice(64 * i, 64 * (i + 1)));

    test("a Dict's range is the held Dict's, whether the source is opened plain or frozen, and is never frozen", () => {
        const blob = encodeBeast2SegmentsFor(Squares)(segments([...squares]).map((entries) => new Map(entries)));
        const held = [...squares.range(from, to)];
        assert.equal(held.length, 20);
        for (const frozen of [false, true]) {
            const lazy = openBeast2LazyFor(Squares, { frozen })(blob) as SortedMap<bigint, bigint>;
            const range = lazy.range(from, to);
            assert.deepEqual([...range], held, `frozen ${frozen}`);
            assert.equal(Object.isFrozen(range), false);
            range.set(-1n, 1n);
            assert.equal(range.size, 21);
            // The source answers as before.
            assert.equal(lazy.size, 5_000);
            assert.equal(lazy.get(-1n), undefined);
            assert.equal(lazy.get(2_000n), 4_000_000n);
        }
    });

    test("a Set's range is the held Set's, whether the source is opened plain or frozen, and is never frozen", () => {
        const blob = encodeBeast2SegmentsFor(Evens)(segments([...evens]).map((elements) => new Set(elements)));
        const held = [...evens.range(from, to)];
        assert.deepEqual(held, [1_990n, 1_992n, 1_994n, 1_996n, 1_998n, 2_000n, 2_002n, 2_004n, 2_006n, 2_008n]);
        for (const frozen of [false, true]) {
            const lazy = openBeast2LazyFor(Evens, { frozen })(blob) as SortedSet<bigint>;
            const range = lazy.range(from, to);
            assert.deepEqual([...range], held, `frozen ${frozen}`);
            range.add(1_991n);
            assert.equal(range.has(1_991n), true);
            assert.equal(lazy.has(1_991n), false);
            assert.equal(lazy.size, 5_000);
        }
    });
});
