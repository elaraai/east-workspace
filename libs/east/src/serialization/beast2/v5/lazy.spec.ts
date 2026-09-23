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
  type EastType,
} from "../../../types.js";
import { compareFor, equalFor } from "../../../comparison.js";
import { SortedMap, SortedSet, isEastDict, isEastSet } from "../../../index.js";
import {
  decodeBeast2For,
  encodeBeast2For,
  encodeBeast2SegmentsFor,
  openBeast2LazyFor,
  openBeast2PagesFor,
  isBeast2LazySafe,
  readBeast2Extents,
  spliceBeast2,
  type Beast2Codec,
} from "../index.js";
import type { Beast2SyncRangeReader } from "../index.js";

const RowType = StructType({ id: IntegerType, name: StringType });
const TableType = DictType(IntegerType, RowType);

/** A collection in canonical order as a blob of 100-element segments — a
 *  geometry chosen here rather than by the cut rule, so that a small value
 *  still spans several segments. */
function paged(type: EastType, value: Iterable<unknown>, codec?: Beast2Codec): Uint8Array {
  const items = [...value];
  const batches: unknown[] = [];
  for (let i = 0; i < items.length; i += 100) {
    const chunk = items.slice(i, i + 100);
    batches.push(type.type === "Dict" ? new Map(chunk as [unknown, unknown][]) : type.type === "Set" ? new Set(chunk) : chunk);
  }
  return encodeBeast2SegmentsFor(type, codec === undefined ? undefined : { codec })(batches as never);
}

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
    const blob = paged(TableType, value);
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
    const blob = paged(TableType, value);
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
    const blob = paged(TableType, value);
    const lazy = openBeast2LazyFor(TableType)(blob);
    const reencoded = encodeBeast2For(TableType)(lazy);
    const eq = equalFor(TableType);
    assert.ok(eq(decodeBeast2For(TableType)(reencoded), value));
  });

  test("empty blobs open as empty values", () => {
    const blob = paged(TableType, makeTable(0));
    const lazy = openBeast2LazyFor(TableType)(blob);
    assert.ok(lazy instanceof SortedMap);
    assert.equal(lazy.size, 0);
    assert.equal(lazy.minKey(), undefined);
    assert.equal(lazy.maxKey(), undefined);
    assert.deepEqual([...lazy], []);
  });

  test("cross-segment order violations surface the eager decoder's error", () => {
    const high = paged(TableType, makeTable(100, 1000));
    const low = paged(TableType, makeTable(100, 0));
    const corrupt = spliceBeast2([high, low]);
    const lazy = openBeast2LazyFor(TableType)(corrupt);
    assert.throws(() => [...lazy], {
      message: "beast2 v5: Dict keys are not strictly ascending in East order — the wire must hold the canonical value (corrupt or pre-contract blob)",
    });
  });

  test("hydration mid-generator keeps the in-flight iterator on the original sequence", () => {
    const value = makeTable(250);
    const blob = paged(TableType, value);
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

  test("iteration from a key seeks the owning segment through the fences and streams from there", () => {
    // Rows wide enough that a fence probe (a 4 KiB prefix) is not the whole
    // frame, so the reads say which segments were decoded and which only
    // probed.
    const WideRow = StructType({ id: IntegerType, name: StringType });
    const WideTable = DictType(IntegerType, WideRow);
    const entries: [bigint, { id: bigint; name: string }][] = [];
    for (let i = 0; i < 350; i++) entries.push([BigInt(i), { id: BigInt(i), name: `row-${i}-`.padEnd(200, "x") }]);
    const value = new SortedMap(entries, compareFor(IntegerType));
    const blob = paged(WideTable, value, "none");
    const extents = readBeast2Extents(blob);
    assert.equal(extents.offsets.length, 4);
    const frame = (i: number): { offset: number; length: number } => ({
      offset: extents.offsets[i]!,
      length: (i + 1 < extents.offsets.length ? extents.offsets[i + 1]! : extents.segmentsEnd) - extents.offsets[i]!,
    });
    assert.ok(frame(0).length > 8192, "a frame is wider than a fence probe");

    const reads: { offset: number; length: number }[] = [];
    const reader: Beast2SyncRangeReader = {
      size: blob.length,
      read(offset, length) {
        reads.push({ offset, length });
        return blob.subarray(offset, offset + length);
      },
    };
    // The decoded values are SortedMaps (range iteration is theirs), typed
    // as Maps by the decoder's signature.
    const sorted = (value: unknown): SortedMap<bigint, { id: bigint; name: string }> => value as SortedMap<bigint, { id: bigint; name: string }>;
    const eager = sorted(decodeBeast2For(WideTable)(blob));
    const lazy = sorted(openBeast2LazyFor(WideTable)(reader));

    // From a key inside segment 2: the same entries as the eager value's
    // range iteration, segments 2 and 3 decoded, segments 0 and 1 only
    // probed for their fences.
    reads.length = 0;
    assert.deepEqual([...lazy.entries(250n)], [...eager.entries(250n)]);
    assert.equal([...lazy.keys(250n)].length, 100);
    const decodedWhole = (i: number): boolean => reads.some((r) => r.offset === frame(i).offset && r.length === frame(i).length);
    assert.ok(decodedWhole(2) && decodedWhole(3), "the owning segment and the ones after it are read whole");
    assert.ok(!decodedWhole(0) && !decodedWhole(1), "the segments before the key are only probed");
    assert.ok(reads.every((r) => r.length <= 4096 || r.offset >= frame(2).offset), "no read before the owning segment exceeds a fence probe");
    assert.equal(lazy.size, 350, "the value did not hydrate");

    // A second seek on the same value keeps the verified fences: no fence
    // is probed again, and only the owning segment is read.
    reads.length = 0;
    assert.deepEqual([...lazy.entries(320n)], [...eager.entries(320n)]);
    assert.ok(reads.length > 0 && reads.every((r) => r.length > 4096), "no read of a later seek is a fence probe");
    assert.ok(decodedWhole(3) && !decodedWhole(2), "only the owning segment is read");

    // Every kind of key: absent between two keys, exactly a fence, the last
    // key, before the first, after the last.
    const absentTable = new SortedMap(entries.filter(([k]) => k % 2n === 0n), compareFor(IntegerType));
    const absentBlob = paged(WideTable, absentTable);
    const absentEager = sorted(decodeBeast2For(WideTable)(absentBlob));
    const absentLazy = sorted(openBeast2LazyFor(WideTable)(absentBlob));
    for (const key of [251n, 200n, 348n, -5n, 10_000n, 0n]) {
      assert.deepEqual([...absentLazy.entries(key)], [...absentEager.entries(key)], `entries from ${key}`);
      assert.deepEqual([...absentLazy.keys(key)], [...absentEager.keys(key)], `keys from ${key}`);
      assert.deepEqual([...absentLazy.values(key)], [...absentEager.values(key)], `values from ${key}`);
    }
    assert.deepEqual([...sorted(openBeast2LazyFor(WideTable)(paged(WideTable, makeTable(0)))).entries(5n)], []);
  });

  test("iteration from a key refuses a blob whose fences do not ascend, in the words every keyed read uses", () => {
    // The seek goes through the pager's own verified fences, so a fence
    // violation reads the same here as from `get`, from `slice`, and from
    // east-c — one sentence per condition, whatever path reaches it.
    const high = paged(TableType, makeTable(100, 1000));
    const low = paged(TableType, makeTable(100, 0));
    const blob = spliceBeast2([high, low]);
    const lazy = openBeast2LazyFor(TableType)(blob) as SortedMap<bigint, { id: bigint; name: string }>;
    const fenceError = {
      message: "beast2 v5: segments 0 and 1 are not disjoint ascending key ranges — the wire must hold the canonical value (corrupt or pre-contract blob)",
    };
    assert.throws(() => [...lazy.entries(1050n)], fenceError);
    assert.throws(() => openBeast2PagesFor(TableType)(blob).get(1050n), fenceError, "the keyed read says the same");
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
    const blob = paged(Tags, value);
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

  test("iteration from an element seeks the owning segment without hydrating", () => {
    const value = makeTags(300);
    const blob = paged(Tags, value);
    const eager = decodeBeast2For(Tags)(blob) as SortedSet<string>;
    const lazy = openBeast2LazyFor(Tags)(blob) as SortedSet<string>;
    for (const from of ["tag-0250", "tag-0250x", "tag-0100", "tag-0299", "a", "z"]) {
      assert.deepEqual([...lazy.keys(from)], [...eager.keys(from)], `keys from ${from}`);
      assert.deepEqual([...lazy.entries(from)], [...eager.entries(from)], `entries from ${from}`);
    }
    assert.equal(lazy.size, 300);
    const corrupt = openBeast2LazyFor(Tags)(spliceBeast2([
      paged(Tags, new SortedSet(["z-1", "z-2"], compareFor(StringType))),
      blob,
    ])) as SortedSet<string>;
    assert.throws(() => [...corrupt.keys("tag-0100")], {
      message: "beast2 v5: segments 0 and 1 are not disjoint ascending element ranges — the wire must hold the canonical value (corrupt or pre-contract blob)",
    });
  });

  test("set algebra hydrates transparently", () => {
    const value = makeTags(120);
    const blob = paged(Tags, value);
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
    const blob = paged(Rows, rows);
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
    const blob = paged(Rows, rows);
    const lazy = openBeast2LazyFor(Rows)(blob);

    assert.deepEqual(lazy.slice(10, 12), ["row-10", "row-11"]);
    lazy.push("appended");
    assert.equal(lazy.length, 261);
    assert.equal(lazy[260], "appended");
    assert.equal(lazy[0], "row-0");
  });

  test("hydration mid-iteration keeps the in-flight iterator on the original sequence", () => {
    const blob = paged(Rows, rows);
    const lazy = openBeast2LazyFor(Rows)(blob);

    const it = lazy[Symbol.iterator]();
    const head = [it.next().value!, it.next().value!];
    lazy.push("appended");  // hydrates mid-generator
    const rest = [...it];
    assert.deepEqual([...head, ...rest], rows, "the in-flight iterator completes the pre-hydration sequence");
    assert.equal(lazy.length, 261, "a fresh read sees the mutation");
  });

  test("non-canonical index strings behave exactly like the eager array", () => {
    const blob = paged(Rows, rows);
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
    const pages = openBeast2PagesFor(RowsT)(paged(RowsT, structRows));
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
    const pages = openBeast2PagesFor(TableType)(paged(TableType, makeTable(350)));
    const v1 = pages.get(42n);
    const v2 = pages.get(42n);
    assert.equal(v1, v2, "the same cached segment serves repeated keyed reads");
    assert.equal((v1 as { name: string }).name, "row-42");
    assert.notEqual(pages.segment(0), pages.segment(0), "segment() decodes fresh so callers cannot poison the cache");
  });
});
