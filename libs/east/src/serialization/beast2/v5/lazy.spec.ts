/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Lazy pager-backed collection values — observational equivalence with the
 * eager decode: lazy reads (size / get / has / iteration / index reads) and
 * transparent hydration on everything else, for Dict, Set and Array roots.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  IntegerType, StringType, ArrayType, SetType, DictType, StructType,
} from "../../../types.js";
import { compareFor, equalFor } from "../../../comparison.js";
import { SortedMap, SortedSet, isEastDict, isEastSet } from "../../../index.js";
import {
  decodeBeast2For,
  encodeBeast2For,
  encodeBeast2PagedFor,
  openBeast2LazyFor,
  spliceBeast2,
} from "../index.js";

const RowType = StructType({ id: IntegerType, name: StringType });
const TableType = DictType(IntegerType, RowType);
const PAGED = { batchSize: 100 };

function makeTable(n: number, offset = 0): SortedMap<bigint, { id: bigint; name: string }> {
  const entries: [bigint, { id: bigint; name: string }][] = [];
  for (let i = 0; i < n; i++) {
    const id = BigInt(i + offset);
    entries.push([id, { id, name: `row-${i + offset}` }]);
  }
  return new SortedMap(entries, compareFor(IntegerType));
}

describe("Beast2 v5 — lazy Dict", () => {
  test("lazy reads match the eager decode without hydration", () => {
    const value = makeTable(350);
    const blob = encodeBeast2PagedFor(TableType, PAGED)(value);
    const lazy = openBeast2LazyFor(TableType)(blob);

    assert.ok(lazy instanceof SortedMap);
    assert.ok(isEastDict(lazy));
    assert.equal(lazy.size, 350);
    assert.equal(lazy.get(42n)?.name, "row-42");
    assert.equal(lazy.get(9999n), undefined);
    assert.ok(lazy.has(0n));
    assert.ok(!lazy.has(-1n));
    assert.equal(lazy.minKey(), 0n);
    assert.equal(lazy.maxKey(), 349n);
    assert.deepEqual([...lazy.keys()].slice(0, 3), [0n, 1n, 2n]);

    const eq = equalFor(TableType);
    assert.ok(eq(new SortedMap([...lazy], compareFor(IntegerType)), value), "iteration yields the whole value in canonical order");
  });

  test("mutation hydrates transparently and preserves identity semantics", () => {
    const value = makeTable(250);
    const blob = encodeBeast2PagedFor(TableType, PAGED)(value);
    const lazy = openBeast2LazyFor(TableType)(blob);

    lazy.set(9999n, { id: 9999n, name: "added" });
    assert.equal(lazy.size, 251);
    assert.equal(lazy.get(123n)?.name, "row-123");
    assert.equal(lazy.get(9999n)?.name, "added");
    assert.ok(lazy.delete(0n));
    assert.equal(lazy.size, 250);
  });

  test("re-encoding a lazy value round-trips", () => {
    const value = makeTable(150);
    const blob = encodeBeast2PagedFor(TableType, PAGED)(value);
    const lazy = openBeast2LazyFor(TableType)(blob);
    const reencoded = encodeBeast2For(TableType)(lazy);
    const eq = equalFor(TableType);
    assert.ok(eq(decodeBeast2For(TableType)(reencoded), value));
  });

  test("empty blobs open as empty values", () => {
    const blob = encodeBeast2PagedFor(TableType, PAGED)(makeTable(0));
    const lazy = openBeast2LazyFor(TableType)(blob);
    assert.ok(lazy instanceof SortedMap);
    assert.equal(lazy.size, 0);
    assert.equal(lazy.minKey(), undefined);
    assert.equal(lazy.maxKey(), undefined);
    assert.deepEqual([...lazy], []);
  });

  test("cross-segment order violations surface the canonical error", () => {
    const high = encodeBeast2PagedFor(TableType, PAGED)(makeTable(100, 1000));
    const low = encodeBeast2PagedFor(TableType, PAGED)(makeTable(100, 0));
    const corrupt = spliceBeast2([high, low]);
    const lazy = openBeast2LazyFor(TableType)(corrupt);
    assert.throws(() => [...lazy], /not disjoint ascending key ranges/);
  });
});

describe("Beast2 v5 — lazy Set", () => {
  const Tags = SetType(StringType);

  function makeTags(n: number): SortedSet<string> {
    return new SortedSet(
      Array.from({ length: n }, (_, i) => `tag-${String(i).padStart(4, "0")}`),
      compareFor(StringType),
    );
  }

  test("lazy reads match the eager decode without hydration", () => {
    const value = makeTags(300);
    const blob = encodeBeast2PagedFor(Tags, PAGED)(value);
    const lazy = openBeast2LazyFor(Tags)(blob);

    assert.ok(lazy instanceof SortedSet);
    assert.ok(isEastSet(lazy));
    assert.equal(lazy.size, 300);
    assert.ok(lazy.has("tag-0042"));
    assert.ok(!lazy.has("missing"));
    assert.equal(lazy.minKey(), "tag-0000");
    assert.equal(lazy.maxKey(), "tag-0299");
    assert.deepEqual([...lazy].slice(0, 2), ["tag-0000", "tag-0001"]);
  });

  test("set algebra hydrates transparently", () => {
    const value = makeTags(120);
    const blob = encodeBeast2PagedFor(Tags, PAGED)(value);
    const lazy = openBeast2LazyFor(Tags)(blob);

    const other = new SortedSet(["tag-0000", "extra"], compareFor(StringType));
    const union = lazy.union(other);
    assert.equal(union.size, 121);
    assert.ok(lazy.isSupersetOf(new SortedSet(["tag-0001"], compareFor(StringType))));
  });
});

describe("Beast2 v5 — lazy Array", () => {
  const Rows = ArrayType(StringType);
  const rows = Array.from({ length: 260 }, (_, i) => `row-${i}`);

  test("length, index reads, and iteration are lazy", () => {
    const blob = encodeBeast2PagedFor(Rows, PAGED)(rows);
    const lazy = openBeast2LazyFor(Rows)(blob);

    assert.ok(Array.isArray(lazy));
    assert.equal(lazy.length, 260);
    assert.equal(lazy[0], "row-0");
    assert.equal(lazy[259], "row-259");
    assert.equal(lazy[260], undefined);
    assert.deepEqual([...lazy], rows);
    const collected: [number, string][] = [];
    for (const [i, v] of lazy.entries()) collected.push([i, v]);
    assert.deepEqual(collected[0], [0, "row-0"]);
    assert.equal(collected.length, 260);
  });

  test("any other operation hydrates transparently", () => {
    const blob = encodeBeast2PagedFor(Rows, PAGED)(rows);
    const lazy = openBeast2LazyFor(Rows)(blob);

    assert.deepEqual(lazy.slice(10, 12), ["row-10", "row-11"]);
    lazy.push("appended");
    assert.equal(lazy.length, 261);
    assert.equal(lazy[260], "appended");
    assert.equal(lazy[0], "row-0");
  });
});
