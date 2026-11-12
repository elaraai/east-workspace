/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * East's containers on an engine with no `Iterator` built-in, and on one with it.
 *
 * Every Dict and Set a browser holds is a {@link SortedMap} or a {@link SortedSet}, and a collection opened lazily
 * is one of their lazy readers. An iPhone's browsers — each runs on the system's own engine — gained the `Iterator`
 * built-in in iOS 18.4; before it, a container that named it threw `Can't find variable: Iterator` the moment it
 * was iterated, and a page stopped at its first draw. Each case below is run both ways: the same values in the same
 * order, and the iterator helpers there exactly where the engine has them.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { compareFor } from "../comparison.js";
import { encodeBeast2SegmentsFor, openBeast2LazyFor } from "../serialization/beast2/index.js";
import { DictType, IntegerType, SetType, StringType } from "../types.js";
import { SortedMap } from "./sortedmap.js";
import { SortedSet } from "./sortedset.js";

/** The engine's `Iterator` built-in, where it has one. */
const builtin = (): unknown => (globalThis as { Iterator?: unknown }).Iterator;

/** Whether this engine has the built-in to begin with: the suite is also run on one that has none (`make test-floor`). */
const HAS = typeof builtin() === "function";

/** Runs `body` as an engine with no `Iterator` built-in runs it, and puts the built-in back. */
function without<T>(body: () => T): T {
    const held = Object.getOwnPropertyDescriptor(globalThis, "Iterator");
    if (held === undefined) return body();
    delete (globalThis as { Iterator?: unknown }).Iterator;
    try {
        assert.equal(builtin(), undefined);
        return body();
    } finally {
        Object.defineProperty(globalThis, "Iterator", held);
    }
}

/** The engines a case is run on: this one as it is, where it has the built-in, and this one without it. */
const ENGINES: readonly { name: string; skip: boolean; run: <T>(body: () => T) => T }[] = [
    { name: "with the Iterator built-in", skip: !HAS, run: (body) => body() },
    { name: "with no Iterator built-in", skip: false, run: without },
];

const byInteger = compareFor(IntegerType);
const byString = compareFor(StringType);

const Table = DictType(IntegerType, StringType);
const Tags = SetType(StringType);

const ROWS: [bigint, string][] = Array.from({ length: 25 }, (_, i) => [BigInt(i * 2), `row-${i * 2}`]);
const NAMES: string[] = Array.from({ length: 25 }, (_, i) => `tag-${String(i * 2).padStart(2, "0")}`);

/** A blob of ten-element segments, so a lazy reader of it reads several. */
function segments(type: typeof Table | typeof Tags, items: readonly unknown[]): Uint8Array {
    const batches: unknown[] = [];
    for (let i = 0; i < items.length; i += 10) {
        const chunk = items.slice(i, i + 10);
        batches.push(type.type === "Dict" ? new Map(chunk as [unknown, unknown][]) : new Set(chunk));
    }
    return encodeBeast2SegmentsFor(type)(batches as never);
}

/** The maps a case is run over: one held in memory, and one read lazily from a blob, a segment at a time. */
const MAPS: readonly { name: string; make: () => SortedMap<bigint, string> }[] = [
    { name: "SortedMap", make: () => new SortedMap(ROWS, byInteger) },
    { name: "a lazy Dict", make: () => openBeast2LazyFor(Table)(segments(Table, ROWS)) as SortedMap<bigint, string> },
];

const SETS: readonly { name: string; make: () => SortedSet<string> }[] = [
    { name: "SortedSet", make: () => new SortedSet(NAMES, byString) },
    { name: "a lazy Set", make: () => openBeast2LazyFor(Tags)(segments(Tags, NAMES)) as SortedSet<string> },
];

/** An iterator's values, taken by its `next` alone: what any engine's `for…of` does. */
function drain<T>(iterator: Iterator<T>): T[] {
    const out: T[] = [];
    for (let step = iterator.next(); step.done !== true; step = iterator.next()) out.push(step.value);
    return out;
}

for (const engine of ENGINES) {
    describe(`containers ${engine.name}`, { skip: engine.skip }, () => {
        for (const { name, make } of MAPS) {
            test(`${name}: keys, values and entries in key order`, () => {
                engine.run(() => {
                    const map = make();
                    assert.deepEqual([...map.keys()], ROWS.map(([k]) => k));
                    assert.deepEqual([...map.values()], ROWS.map(([, v]) => v));
                    assert.deepEqual([...map.entries()], ROWS);
                    assert.deepEqual([...map], ROWS);
                    assert.deepEqual(Array.from(map), ROWS);
                    assert.deepEqual(drain(map[Symbol.iterator]()), ROWS);
                    const seen: [bigint, string][] = [];
                    for (const [key, value] of map) seen.push([key, value]);
                    assert.deepEqual(seen, ROWS);
                    assert.deepEqual([...new Map(map)], ROWS);
                });
            });

            test(`${name}: a range begins at its key, or at the next where the key is not held`, () => {
                engine.run(() => {
                    const map = make();
                    const from = ROWS.filter(([k]) => k >= 20n);
                    assert.deepEqual([...map.keys(20n)], from.map(([k]) => k));
                    assert.deepEqual([...map.values(20n)], from.map(([, v]) => v));
                    assert.deepEqual([...map.entries(20n)], from);
                    assert.deepEqual([...map.keys(21n)], ROWS.filter(([k]) => k >= 21n).map(([k]) => k));
                    assert.deepEqual([...map.keys(1000n)], []);
                });
            });

            test(`${name}: each iterator is its own iterable, taken a step at a time`, () => {
                engine.run(() => {
                    const map = make();
                    const iterators: IterableIterator<unknown>[] = [map.keys(), map.values(), map.entries(), map[Symbol.iterator]()];
                    for (const iterator of iterators) {
                        assert.equal(iterator[Symbol.iterator](), iterator);
                        const first = iterator.next();
                        assert.equal(first.done === true, false);
                        assert.equal(drain(iterator).length, ROWS.length - 1);
                        assert.equal(iterator.next().done, true);
                    }
                });
            });

            test(`${name}: the iterator helpers are there where the engine has them`, () => {
                engine.run(() => {
                    const keys = make().keys();
                    const helper = (keys as { map?: unknown }).map;
                    if (builtin() === undefined) {
                        // What an engine with no built-in hands on is the source itself: a generator has no helper
                        // there either, and sorted-btree's iterator never had one.
                        if (!HAS) assert.equal(helper, undefined);
                        return;
                    }
                    assert.equal(typeof helper, "function");
                    assert.deepEqual(make().keys().map((k) => k + 1n).toArray(), ROWS.map(([k]) => k + 1n));
                    assert.deepEqual(make().entries().filter(([k]) => k < 4n).toArray(), ROWS.slice(0, 2));
                    assert.equal(make().values().take(3).toArray().join(), "row-0,row-2,row-4");
                });
            });
        }

        for (const { name, make } of SETS) {
            test(`${name}: keys, values and entries in order`, () => {
                engine.run(() => {
                    const set = make();
                    assert.deepEqual([...set.keys()], NAMES);
                    assert.deepEqual([...set.values()], NAMES);
                    assert.deepEqual([...set.entries()], NAMES.map((k) => [k, k]));
                    assert.deepEqual([...set], NAMES);
                    assert.deepEqual(Array.from(set), NAMES);
                    assert.deepEqual(drain(set[Symbol.iterator]()), NAMES);
                    const seen: string[] = [];
                    for (const key of set) seen.push(key);
                    assert.deepEqual(seen, NAMES);
                    assert.deepEqual([...new Set(set)], NAMES);
                });
            });

            test(`${name}: a range begins at its key, or at the next where the key is not held`, () => {
                engine.run(() => {
                    const set = make();
                    const from = NAMES.filter((k) => k >= "tag-20");
                    assert.deepEqual([...set.keys("tag-20")], from);
                    assert.deepEqual([...set.values("tag-20")], from);
                    assert.deepEqual([...set.entries("tag-20")], from.map((k) => [k, k]));
                    assert.deepEqual([...set.keys("tag-21")], NAMES.filter((k) => k >= "tag-21"));
                    assert.deepEqual([...set.keys("zzz")], []);
                });
            });

            test(`${name}: each iterator is its own iterable, taken a step at a time`, () => {
                engine.run(() => {
                    const set = make();
                    const iterators: IterableIterator<unknown>[] = [set.keys(), set.values(), set.entries(), set[Symbol.iterator]()];
                    for (const iterator of iterators) {
                        assert.equal(iterator[Symbol.iterator](), iterator);
                        const first = iterator.next();
                        assert.equal(first.done === true, false);
                        assert.equal(drain(iterator).length, NAMES.length - 1);
                        assert.equal(iterator.next().done, true);
                    }
                });
            });

            test(`${name}: the set operations read the other set through its keys`, () => {
                engine.run(() => {
                    const set = make();
                    const other = new SortedSet(["tag-00", "tag-02", "zzz"], byString);
                    assert.deepEqual([...set.intersection(other)], ["tag-00", "tag-02"]);
                    assert.deepEqual([...set.union(other)], [...NAMES, "zzz"]);
                    assert.deepEqual([...set.difference(other)], NAMES.slice(2));
                    assert.deepEqual([...set.symmetricDifference(other)], [...NAMES.slice(2), "zzz"]);
                    assert.equal(new SortedSet(["tag-00"], byString).isSubsetOf(set), true);
                    assert.equal(set.isSupersetOf(new SortedSet(["tag-00"], byString)), true);
                    assert.equal(set.isDisjointFrom(new SortedSet(["zzz"], byString)), true);
                });
            });

            test(`${name}: the iterator helpers are there where the engine has them`, () => {
                engine.run(() => {
                    const helper = (make().keys() as { map?: unknown }).map;
                    if (builtin() === undefined) {
                        if (!HAS) assert.equal(helper, undefined);
                        return;
                    }
                    assert.equal(typeof helper, "function");
                    assert.deepEqual(make().keys().map((k) => k.toUpperCase()).take(2).toArray(), ["TAG-00", "TAG-02"]);
                    assert.deepEqual(make().entries().take(1).toArray(), [["tag-00", "tag-00"]]);
                });
            });
        }
    });
}
