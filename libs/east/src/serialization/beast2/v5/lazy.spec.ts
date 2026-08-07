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
  FloatType, OptionType, RecursiveType, VariantType, RefType, VectorType, FunctionType,
} from "../../../types.js";
import { compareFor, equalFor } from "../../../comparison.js";
import { SortedMap, SortedSet, isEastDict, isEastSet } from "../../../index.js";
import {
  decodeBeast2For,
  encodeBeast2For,
  encodeBeast2PagedFor,
  encodeBeast2SegmentsFor,
  openBeast2LazyFor,
  openBeast2PagesFor,
  isBeast2LazySafe,
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

  test("hydration mid-generator keeps the in-flight iterator on the original sequence", () => {
    const value = makeTable(250);
    const blob = encodeBeast2PagedFor(TableType, PAGED)(value);
    const lazy = openBeast2LazyFor(TableType)(blob);

    const it = lazy.entries();
    const head = [it.next().value!, it.next().value!, it.next().value!];
    lazy.set(9999n, { id: 9999n, name: "added" });  // hydrates mid-generator
    const rest = [...it];
    const keys = [...head, ...rest].map(([k]) => k);
    assert.equal(keys.length, 250, "the in-flight iterator completes the pre-hydration sequence");
    for (let i = 1; i < keys.length; i++) {
      assert.ok(keys[i - 1]! < keys[i]!, "canonical ascending order throughout");
    }
    assert.equal([...lazy].length, 251, "a new iteration sees the mutation");
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

  test("hydration mid-iteration keeps the in-flight iterator on the original sequence", () => {
    const blob = encodeBeast2PagedFor(Rows, PAGED)(rows);
    const lazy = openBeast2LazyFor(Rows)(blob);

    const it = lazy[Symbol.iterator]();
    const head = [it.next().value!, it.next().value!];
    lazy.push("appended");  // hydrates mid-generator
    const rest = [...it];
    assert.deepEqual([...head, ...rest], rows, "the in-flight iterator completes the pre-hydration sequence");
    assert.equal(lazy.length, 261, "a fresh read sees the mutation");
  });

  test("non-canonical index strings behave exactly like the eager array", () => {
    const blob = encodeBeast2PagedFor(Rows, PAGED)(rows);
    const eager = decodeBeast2For(Rows)(blob);
    const lazy = openBeast2LazyFor(Rows)(blob);
    // `Number("01")` parses to 1, but "01" is an ordinary (absent) property
    // on an eager array — the proxy must not serve an element for it.
    for (const prop of ["", "01", " 2", "1e2", "-0", "2.0"]) {
      assert.equal(
        (lazy as unknown as Record<string, unknown>)[prop],
        (eager as unknown as Record<string, unknown>)[prop],
        `property ${JSON.stringify(prop)}`,
      );
    }
    assert.equal(lazy[2], "row-2", "canonical index reads still serve elements");
  });

  test("hydration handles very large segments without argument-limit overflow", () => {
    const IntRows = ArrayType(IntegerType);
    const big = Array.from({ length: 200_000 }, (_, i) => BigInt(i));
    // One batch → one 200k-element segment: a spread-push hydration would
    // overflow the engine's argument limit here.
    const blob = encodeBeast2SegmentsFor(IntRows)([big]);
    const lazy = openBeast2LazyFor(IntRows)(blob);
    lazy.push(200_000n);  // hydrates
    assert.equal(lazy.length, 200_001);
    assert.equal(lazy[0], 0n);
    assert.equal(lazy[199_999], 199_999n);
    assert.equal(lazy[200_000], 200_000n);
  });
});

describe("Beast2 v5 — lazy shape gate (isBeast2LazySafe)", () => {
  test("value-semantic element shapes are lazy-eligible", () => {
    assert.ok(isBeast2LazySafe(ArrayType(IntegerType)));
    assert.ok(isBeast2LazySafe(SetType(StringType)));
    assert.ok(isBeast2LazySafe(DictType(IntegerType, StructType({ id: IntegerType, name: StringType }))));
    assert.ok(isBeast2LazySafe(ArrayType(OptionType(StructType({ a: FloatType })))));
    const Tree = RecursiveType((t) => VariantType({ leaf: IntegerType, pair: StructType({ l: t, r: t }) }));
    assert.ok(isBeast2LazySafe(ArrayType(Tree)), "recursion without containers stays eligible");
  });

  test("mutable-nested and identity-compared element shapes open eager", () => {
    assert.ok(!isBeast2LazySafe(ArrayType(ArrayType(IntegerType))), "nested array — writes through a read-out element would drop");
    assert.ok(!isBeast2LazySafe(DictType(IntegerType, StructType({ xs: ArrayType(IntegerType) }))));
    assert.ok(!isBeast2LazySafe(DictType(IntegerType, SetType(IntegerType))));
    assert.ok(!isBeast2LazySafe(ArrayType(DictType(StringType, IntegerType))));
    assert.ok(!isBeast2LazySafe(ArrayType(StructType({ r: RefType(IntegerType) }))));
    assert.ok(!isBeast2LazySafe(ArrayType(VectorType(FloatType))), "`is()` compares vectors by identity");
    assert.ok(!isBeast2LazySafe(SetType(VectorType(FloatType))));
    assert.ok(!isBeast2LazySafe(ArrayType(FunctionType([], IntegerType))), "closures can capture mutable state");
    const TreeWithList = RecursiveType((t) => VariantType({ leaf: ArrayType(IntegerType), pair: StructType({ l: t, r: t }) }));
    assert.ok(!isBeast2LazySafe(ArrayType(TreeWithList)), "a container anywhere on the recursion is reachable");
  });

  test("non-collection roots are never lazy-eligible", () => {
    assert.ok(!isBeast2LazySafe(StringType));
    assert.ok(!isBeast2LazySafe(StructType({ a: IntegerType })));
  });
});

describe("Beast2 v5 — pages segment cache", () => {
  const RowsT = ArrayType(RowType);
  const structRows = Array.from({ length: 500 }, (_, i) => ({ id: BigInt(i), name: `r-${i}` }));

  test("element reads reuse the decoded segment; eviction decodes fresh", () => {
    const pages = openBeast2PagesFor(RowsT)(encodeBeast2PagedFor(RowsT, PAGED)(structRows));
    const a = pages.element(42);
    const b = pages.element(43);
    assert.equal(a, pages.element(42), "a re-read within the cache window returns the cached decode");
    assert.equal((a as { id: bigint }).id, 42n);
    assert.equal((b as { id: bigint }).id, 43n);
    // Touch more segments than the cache holds; the first segment is evicted
    // and re-decodes to a fresh (equal) object.
    for (const row of [142, 242, 342, 442]) pages.element(row);
    const again = pages.element(42);
    assert.notEqual(again, a, "evicted segments decode fresh");
    assert.deepEqual(again, a, "with identical content");
  });

  test("keyed reads reuse the decoded segment; the public segment() stays fresh", () => {
    const pages = openBeast2PagesFor(TableType)(encodeBeast2PagedFor(TableType, PAGED)(makeTable(350)));
    const v1 = pages.get(42n);
    const v2 = pages.get(42n);
    assert.equal(v1, v2, "the same cached segment serves repeated keyed reads");
    assert.equal((v1 as { name: string }).name, "row-42");
    assert.notEqual(pages.segment(0), pages.segment(0), "segment() decodes fresh so callers cannot poison the cache");
  });
});
